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

- Run the startup smoke test (mocks `game`/`Hooks`/`ui` and imports `scripts/main.js` to catch startup
  crashes, e.g. `game.modules` being unavailable during early init): `node tools/smoke-test.mjs`
- No other test runner, linter, or build tool is configured.

## Architecture

### Two code populations

- `scripts/main.js`, `scripts/socket.js`, `scripts/executor.js`, `scripts/migrate-behaviors.js` — the
  actual module code, loaded via `module.json`. These use normal camelCase and standard JS module
  conventions.
- `scripts/world-macros/*.js` — source-of-truth copies of Foundry **world Macros**. Their exported function
  bodies are deliberately written *unindented* relative to the function signature and use an `ra`-prefixed
  variable naming convention (`raBehavior`, `raToken`, `raResult`, ...). This mirrors how the code
  originally ran when pasted directly as a macro body (where Foundry supplies `behavior`, `token`, `event`,
  etc. as implicit scope variables) — preserve this style when editing so the function body stays a valid
  drop-in macro script. `SavingThrowFunctionMacros.js` (and its Configuration/RollHelper siblings) is still
  a plain unexported IIFE meant to be pasted verbatim into Foundry's macro editor — it has not yet been
  ported into the module (see below). `*ConfigurationMacros.js` files remain IIFEs for every activity,
  ported or not — only the `*FunctionMacros.js`/`*RollHelperMacros.js` pair gets converted to exports when
  an activity is ported.

Whitespace style throughout the repo is unusually vertical (one value per line, e.g. `const x =\n    1;`).
Match existing style in a file rather than reflowing it.

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

### Functionality dispatch and migration-in-progress state

`RegionBehavior.flags["pf2e-exploration-automation"].functionality` is one of `investigate`, `search`,
`detect-magic`, `saving-throw` (`FUNCTION_MACRO_NAMES` / `SUPPORTED_FUNCTIONALITIES`). `investigate`,
`search`, and `detect-magic` have been ported into the module proper (`MODULE_FUNCTIONS` in `executor.js`,
backed by `world-macros/InvestigateFunctionMacros.js` / `SearchFunctionMacros.js` /
`DetectMagicFunctionMacros.js`); `saving-throw` still falls back to
`game.macros.getName(functionMacroName).execute(...)`, meaning a world Macro named
`SavingThrowFunctionMacros` must exist in the target Foundry world. When porting an activity into the
module, follow the `runSearch`/`runInvestigate`/`runDetectMagic` pattern: convert its `*FunctionMacros.js`
IIFE to `export async function runX(...)`, convert its `*RollHelperMacros.js` IIFE the same way (import it
directly instead of resolving it via `findSingleMacro`/`game.macros.getName`), register the function in
`MODULE_FUNCTIONS`, and update the activity's `*ConfigurationMacros.js` `BEHAVIOR_SOURCE` template string to
the `moduleApi.requestBehaviorExecution(...)` dispatcher (copy it from `SearchConfigurationMacros.js`) so
newly-created Behaviors get the socket-routed source immediately instead of relying on the
`createRegionBehavior` migration hook to fix it up after the fact.

### Per-activity macro triad

Each exploration activity (`Search`, `Investigate`, `DetectMagic`, `SavingThrow`) follows the same
three-file shape in `scripts/world-macros/`:

- **`*ConfigurationMacros.js`** — GM-facing `DialogV2` UI for attaching/configuring the automation on a
  selected Region (invoked from `RegionAutomationMainMacros.js`'s "Add Automation" dialog, which picks the
  right Configuration macro by name via `findSingleMacro`).
- **`*FunctionMacros.js`** — orchestration run on `tokenEnter` (via the executor). Order of operations,
  e.g. in `runSearch`: (1) `checkExplorationActivity` — is the actor currently performing this exploration
  activity; bail if not; (2) `registerTokenTrigger` — one-shot dedup so the same token can't retrigger the
  same Behavior, stored in `flags[MODULE_ID].triggeredTokenUuids`; (3) call the matching
  `*RollHelperMacros.js` to perform the actual secret check; on technical failure after registration,
  roll back the registration (a *failed skill check* is a normal successful run and must NOT be rolled
  back — only infrastructure failures are).
- **`*RollHelperMacros.js`** — performs the actual PF2e roll/check and message output.

Shared helpers used by the triads:
- `ExplorationActivityMacros.js` (`checkExplorationActivity`) — checks whether an actor's `system.exploration`
  items include the requested activity slug.
- `RegistrationMacros.js` (`registerTokenTrigger`) — the one-shot trigger tracking described above; uses a
  `globalThis.RegionAutomationRegistrationLocks` Set to prevent a race between near-simultaneous events on
  the same client (multi-GM synchronization is explicitly not yet handled here).
- `UnregisterRegionMacros.js` — GM world macro that clears `triggeredTokenUuids` for every Region Automation
  Behavior on the selected Region.

### Conventions to preserve

- `MODULE_ID` (`"pf2e-exploration-automation"`) is redefined locally in most files rather than imported
  from one shared constants module — match this when adding new files in `world-macros/`.
- Functions that report results back to a Foundry Macro's execution scope take a `resultBox = { value: null }`
  parameter and write to `resultBox.value` instead of returning it directly (so a macro caller with its own
  local scope can read the result out).
- Only plain, serializable data (strings/UUIDs) crosses `game.socket` — never Actor/Token/Region/Behavior
  document objects.
