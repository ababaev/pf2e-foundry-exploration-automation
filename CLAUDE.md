# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Foundry VTT module (`pf2e-exploration-automation`) for the PF2e game system. It automates exploration
activities (Search, Investigate, Detect Magic, saving throws) that trigger when a token enters a Foundry
Scene Region. See `module.json` for the module manifest (Foundry v14, requires the `pf2e` system ≥8.3.0).

There is no build step, no bundler, and no `package.json` — the module is loaded by Foundry directly as a
native ES module (`scripts/main.js`, referenced from `module.json`'s `esmodules`). Do not introduce a
bundler/transpiler unless explicitly asked.

## Commands

- Run the startup smoke test (mocks `game`/`Hooks`/`ui`/`fetch`/`Macro`/`Folder` and imports `scripts/main.js`
  to catch startup crashes, e.g. `game.modules` being unavailable during early init, and asserts
  `syncWorldMacros` actually creates macros during the `ready` hook): `node tools/smoke-test.mjs`
- No other test runner, linter, or build tool is configured. `node --check <file>` catches syntax errors;
  there is no automated coverage of runtime behavior beyond the smoke test, so verify non-trivial changes
  with a throwaway mocked-Foundry script (mock `game`/`ui`/`ChatMessage`/`Roll`/`ui.notifications`, import
  the real file under test, assert on its output) before calling a change done.

## Architecture

### Two code populations

- `scripts/main.js`, `scripts/socket.js`, `scripts/executor.js`, `scripts/migrate-behaviors.js`,
  `scripts/macro-sync.js`, `scripts/module-id.js` — the actual module code, loaded via `module.json`. Normal
  camelCase, standard JS module conventions, free to `import` from anywhere else in this population.
- `scripts/world-macros/*.js` — source-of-truth copies of Foundry **world Macros**: scripts that get loaded
  into Foundry as standalone `Macro` documents, which therefore cannot use static `import`. Six of them
  (everything except `ExplorationActivityMacros.js` and `RegistrationMacros.js`, see below) are looked up by
  name at runtime (`game.macros.getName(...)`/`.find(...)`) by `RegionAutomationMainMacros.js` — so a matching
  `Macro` document must exist in the world. A GM does **not** paste these in by hand: `scripts/macro-sync.js`
  creates/updates them automatically as the primary GM reaches `ready`, fetching each one's live source
  straight from these same files (see "World Macro provisioning" below). `ExplorationActivityMacros.js` and
  `RegistrationMacros.js` are the two files in this population not currently looked up by name by anything —
  every activity now imports `checkExplorationActivity`/`registerTokenTrigger` from them directly as ES
  modules instead (via `shared/trigger-flow.js`) — kept in the same paste-compatible style for consistency in
  case a future activity needs to look one up by name again, and deliberately excluded from `macro-sync.js`'s
  list until then (a top-level `export` — needed for the ES import — is invalid inside a Macro's command
  body, so Foundry rejects the document if `macro-sync.js` tries to create/update it from either file).

  Every file in this population uses an `ra`-prefixed variable naming convention (`raBehavior`, `raToken`,
  `raResult`, ...) and `typeof x !== "undefined"` guards instead of relying on parameter defaults, because
  inside a `Macro`'s script body those names are Foundry-injected scope variables that may not exist at all —
  referencing an undeclared variable directly would throw. Preserve this whenever touching these files.

  Every activity's `*FunctionMacros.js` and `*RollHelperMacros.js` files, by contrast, are **only** loaded as
  real ES modules (imported from `executor.js` / each other / `scripts/world-macros/shared/`) — nothing looks
  them up by macro name anymore, so they are free to use normal parameter defaults, `import`, and plain
  `return` instead of the `resultBox` sidecar pattern (see below).

Whitespace style in the paste-only macro files (listed above) is unusually vertical (one value per line,
e.g. `const x =\n    1;`) — match it there. The module-only files use conventional, denser formatting.

### Player → GM socket bridge

Players can't update `RegionBehavior` flags, run GM-owned macros, or see secret checks. So the flow is:

1. A Region's `executeScript` Behavior contains only `GENERIC_BEHAVIOR_SOURCE`
   (`scripts/migrate-behaviors.js`), a tiny script that calls `game.modules.get(MODULE_ID).api
   .requestBehaviorExecution({ behaviorUuid, tokenUuid, eventName })` — no game logic lives in the Behavior
   itself.
2. `requestBehaviorExecution` (`scripts/socket.js`) elects a **primary GM**: among online GMs, the one
   whose Foundry user ID sorts first alphabetically (`getPrimaryGM`/`isPrimaryGM`). Every client computes
   this independently and agrees.
   - If the caller *is* the primary GM, the request executes immediately, in-process.
   - Otherwise it's serialized to plain UUIDs/strings and emitted over `game.socket` on channel
     `module.pf2e-exploration-automation`; only the primary GM's listener acts on it.
3. `executeBehaviorRequest` (`scripts/executor.js`) runs GM-side only. It validates the request (dedupes by
   `requestId` for ~30s, locks on `behaviorUuid::tokenUuid` to prevent concurrent double-execution),
   resolves the `RegionBehavior`/`Token` from UUID, checks the requesting user actually controls the actor
   (`requesterMayUseActor` — owner permission or GM), reads the `functionality` flag, and dispatches.

### Behavior migration

Older Behaviors had macro-execution logic pasted directly into their script, which broke on player clients
(permission errors). `migrate-behaviors.js` scans every Scene → Region → RegionBehavior on world ready (as
the primary GM) and rewrites any Region Automation behavior's `system.source` to the generic dispatcher
script, without touching its configured flags (DC, hint, subject, skills, `triggeredTokenUuids`, etc.).
Newly created Behaviors are normalized the same way via the `createRegionBehavior` hook in `main.js`.

### World Macro provisioning

`scripts/macro-sync.js`'s `syncWorldMacros()` runs right before behavior migration, in the same primary-GM
`ready`-hook block in `main.js`. For each entry in its `MANAGED_MACROS` table it `fetch()`es the live source of
the matching `scripts/world-macros/*.js` file (resolved against `import.meta.url`, so it's correct under any
route prefix), then creates a `Macro` document with that name/command if none exists, or updates the existing
one in place if its stored `command` has drifted from the source — so a `git pull` + world reload is the
entire update story, never a manual re-paste. Managed macros are filed under a `"PF2e Exploration
Automation"` Macro folder and created with `ownership.default: OWNER` so any GM (not just whichever one's
client ran the sync) can see and run them. `RegionAutomationMainMacros` and `UnregisterRegionMacros` — the two
a GM actually clicks — get a custom `img`; the rest fall back to a default core Foundry icon. Exposed on the
module API as `syncWorldMacros` for manual re-runs.

### Functionality dispatch and porting an activity

`RegionBehavior.flags["pf2e-exploration-automation"].functionality` is one of `investigate`, `search`,
`detect-magic`, `saving-throw` (`FUNCTION_MACRO_NAMES` / `SUPPORTED_FUNCTIONALITIES`). All four have been
ported into the module proper (`MODULE_FUNCTIONS` in `executor.js`, backed by
`world-macros/InvestigateFunctionMacros.js` / `SearchFunctionMacros.js` / `DetectMagicFunctionMacros.js` /
`SavingThrowFunctionMacros.js`). `FUNCTION_MACRO_NAMES` and `executor.js`'s `game.macros.getName(...)`
fallback path are kept only for a future not-yet-ported activity (e.g. Avoid Notice) — currently every
functionality resolves through `MODULE_FUNCTIONS` and the fallback is dead code.

To port a future activity, follow `SearchFunctionMacros.js` as the template — it's the thinnest:

1. Convert `*FunctionMacros.js` from an IIFE to `export async function runX({ behavior, event, region,
   scene, token, actor } = {}) { await runTriggeredCheck({ label, activity, ...args, validateConfig,
   runRoll }); }`, delegating the gate → register → roll → rollback-on-technical-failure orchestration to
   `scripts/world-macros/shared/trigger-flow.js` instead of reimplementing it. `validateConfig(config)`
   returns `{ ok: boolean }` and should only check what's needed to safely register the token (full
   validation still belongs in the RollHelper too — see Search's DC-only pre-check vs. its DC+targetType
   RollHelper check for the intentional pattern of "cheap enough to check before burning a one-shot
   registration"). Pass `requireExplorationActivity: false` if the trigger isn't tied to a PF2e exploration
   activity a player selects (as Saving Throw does) — `runTriggeredCheck` skips the
   `checkExplorationActivity` gate entirely in that case and registers/rolls unconditionally. `activity`
   itself is still required either way: it must match the Behavior's own `functionality` flag.
2. Convert `*RollHelperMacros.js` from an IIFE (which built its own `escapeHTML`/`RANK_LETTERS`/
   `getResultStyle`/`getDegreeOfSuccess`/`DIFFICULTIES`/`DC_ADJUSTMENTS` and used a `resultBox` sidecar) to
   `export async function runXRoll({ actor, token, behavior, event, region, scene, debug = true } = {})`
   that imports those from `scripts/world-macros/shared/{html,checks,gm}.js` and simply `return result;` at
   every exit point instead of `publishResult(result); return;`.
3. Register the function in `MODULE_FUNCTIONS` in `executor.js`.
4. Update the activity's `*ConfigurationMacros.js` `BEHAVIOR_SOURCE` template string to the
   `moduleApi.requestBehaviorExecution(...)` dispatcher (copy it from `SearchConfigurationMacros.js`) so
   newly-created Behaviors get the socket-routed source immediately instead of relying on the
   `createRegionBehavior` migration hook to fix it up after the fact.
5. If the not-yet-ported `*FunctionMacros.js` looked up `RegistrationMacros` via `game.macros.getName(...)`,
   drop that lookup — `shared/trigger-flow.js` already does `import { registerTokenTrigger } from
   "../RegistrationMacros.js"`, so this happens automatically once step 1 is done.

### Shared helpers (`scripts/module-id.js`, `scripts/world-macros/shared/`)

Only used by the module-only files (never by the paste-only macros, which can't `import`):

- `scripts/module-id.js` — the single `MODULE_ID` constant. `socket.js` and `executor.js` re-export it, so
  `import { MODULE_ID } from "./socket.js"` (used by `main.js`) keeps working.
- `shared/html.js` — `escapeHTML`.
- `shared/checks.js` — `DIFFICULTIES`/`DC_ADJUSTMENTS` (the seven-step difficulty ladder), `RANK_LETTERS`,
  `getDegreeOfSuccess(total, dc, naturalRoll)` (manual PF2e degree-of-success with the nat-1/nat-20 step
  adjustment — used by Investigate and Detect Magic, which each roll one shared d20 against several
  statistics themselves), and `getResultStyle(degree)` (chat-message CSS by degree; also used by Search,
  which gets its `outcome` from PF2e's native Seek action instead of computing it locally).
- `shared/gm.js` — `getActiveGMs()`.
- `shared/trigger-flow.js` — `runTriggeredCheck(...)`, the gate → register → roll → rollback orchestration
  described above, parameterized by `label`/`activity`/`requireExplorationActivity`/`validateConfig`/`runRoll`
  (`requireExplorationActivity: false` skips the exploration-activity gate — see Saving Throw). It imports `checkExplorationActivity` and
  `registerTokenTrigger` directly and drives them through the same `resultBox` contract those two
  paste-style files still expose internally.

### Per-activity macro triad

Each exploration activity (`Search`, `Investigate`, `DetectMagic`, `SavingThrow`) follows the same
three-file shape in `scripts/world-macros/`:

- **`*ConfigurationMacros.js`** — GM-facing `DialogV2` UI for attaching/configuring the automation on a
  selected Region (invoked from `RegionAutomationMainMacros.js`'s "Add Automation" dialog, which picks the
  right Configuration macro by name via `findSingleMacro`). Always provisioned as a `Macro` document (via
  `macro-sync.js`), never an ES module, even once its activity is ported.
- **`*FunctionMacros.js`** — orchestration run on `tokenEnter` (via the executor). A thin wrapper around
  `runTriggeredCheck` (see above) for every currently supported activity; a not-yet-ported future activity
  would instead be the full IIFE looking up `RegistrationMacros`/its RollHelper by `game.macros.getName(...)`
  until it's ported.
- **`*RollHelperMacros.js`** — performs the actual PF2e roll/check and message output.

Shared helpers used by every triad:
- `ExplorationActivityMacros.js` (`checkExplorationActivity`) — checks whether an actor's `system.exploration`
  items include the requested activity slug.
- `RegistrationMacros.js` (`registerTokenTrigger`) — the one-shot trigger tracking, stored in
  `flags[MODULE_ID].triggeredTokenUuids`; uses a `globalThis.RegionAutomationRegistrationLocks` Set to
  prevent a race between near-simultaneous events on the same client (multi-GM synchronization is
  explicitly not yet handled here).
- `UnregisterRegionMacros.js` — GM world macro that clears `triggeredTokenUuids` for every Region Automation
  Behavior on the selected Region.

### Conventions to preserve

- `MODULE_ID`: module-only files `import { MODULE_ID } from "./module-id.js"` (or re-export it, see above).
  Paste-only macro files still redefine it locally under a private name (`raModuleId` in
  `RegistrationMacros.js`, etc.) since they can't import — match that when touching those files.
- The `resultBox = { value: null }` sidecar-parameter convention (write to `resultBox.value` instead of
  returning, because `Macro.execute(scope)` can't return a value to its caller) still applies to
  `checkExplorationActivity`/`registerTokenTrigger` and to every paste-only macro. Module-only functions
  (the ported `*RollHelperMacros.js`, `runTriggeredCheck`) just `return` their result directly — there's no
  reason to keep the sidecar once a function is only ever called as a real function.
- Only plain, serializable data (strings/UUIDs) crosses `game.socket` — never Actor/Token/Region/Behavior
  document objects.
