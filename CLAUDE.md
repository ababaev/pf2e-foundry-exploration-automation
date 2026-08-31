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

- Run the whole test suite: `node --test` (from the repo root, no arguments — Node's built-in `node:test`
  runner, no dependency or `package.json` needed; passing an explicit directory/file path instead, e.g.
  `node --test tests/config/`, silently fails to discover anything in this Node version, so always run it
  bare and use `--test-name-pattern` to narrow down if needed). This also sweeps up
  `tools/smoke-test.mjs` (see below) as a bonus single pass/fail test, since it throws on failure and
  otherwise completes normally. See `tests/README.md` for the suite's structure and the testing techniques
  (`AsyncFunction`-based macro execution, the `DialogV2.wait` mock, module-level-state gotchas) it relies on
  before adding to it.
- The startup smoke test alone (mocks `game`/`Hooks`/`ui`/`fetch`/`Macro`/`Folder` and imports
  `scripts/main.js` to catch startup crashes, e.g. `game.modules` being unavailable during early init, and
  asserts `syncWorldMacros` creates macros and prunes orphans during the `ready` hook): `node tools/smoke-test.mjs`
- No linter or build tool is configured. `node --check <file>` catches syntax errors in the module-only
  files (those with `import`/`export`); it cannot check the paste-only `scripts/world-macros/*.js` files that
  have neither (Node can't unambiguously detect them as ESM and falls back to CommonJS, where their
  top-level `await` is a syntax error) — `tests/helpers/run-macro.mjs`'s `AsyncFunction` approach is what
  actually runs those under Node. For anything not covered by the suite, verify with a throwaway
  mocked-Foundry script (mock `game`/`ui`/`ChatMessage`/`Roll`/`ui.notifications`, import or run the real
  file under test, assert on its output) before calling a change done.
- None of the above can tell you whether a real Foundry/`pf2e` install still matches what's mocked. Run
  `await game.modules.get("pf2e-exploration-automation").api.runFoundryCompatCheck()` inside a real Foundry
  world for that — see "Foundry/pf2e compatibility check" below.

## Architecture

### Two code populations

- `scripts/main.js`, `scripts/socket.js`, `scripts/executor.js`, `scripts/migrate-behaviors.js`,
  `scripts/macro-sync.js`, `scripts/configuration-dialogs.js`, `scripts/foundry-compat-check.js`,
  `scripts/module-id.js`, `scripts/manual-trigger.js` — the actual module code, loaded via `module.json`.
  Normal camelCase, standard JS module conventions, free to `import` from anywhere else in this population.
- `scripts/world-macros/*.js` — source-of-truth copies of Foundry **world Macros**: scripts that get loaded
  into Foundry as standalone `Macro` documents, which therefore cannot use static `import`. Only 4 of them —
  `RegionAutomationMainMacros.js`, `UnregisterRegionMacros.js`, `TriggerRegionForPartyMacros.js`,
  `FoundryCompatCheckMacros.js` — still need to exist as `Macro` documents at all, and purely because a GM
  clicks them directly from the hotbar/macro directory; nothing in the codebase looks any of the four up by
  name. A GM does **not** paste these in by hand: `scripts/macro-sync.js` creates/updates them automatically
  as the primary GM reaches `ready`, fetching each one's live source straight from these same files (see
  "World Macro provisioning" below).
  `ExplorationActivityMacros.js`, `RegistrationMacros.js`, and the 4 `*ConfigurationMacros.js` files are all
  deliberately excluded from `macro-sync.js`'s list — every one of them is a real ES module now
  (`export async function ...`), imported directly rather than looked up by
  `game.macros.getName(...)`/`.find(...)` (`checkExplorationActivity`/`registerTokenTrigger` via
  `shared/trigger-flow.js`; the 4 Configuration dialogs via `scripts/configuration-dialogs.js`, called from
  `RegionAutomationMainMacros.js` through the module API — see "Editing an existing automation" below). A
  top-level `export` is invalid inside a Macro's command body, so Foundry would reject any of them if
  `macro-sync.js` tried to create/update them as Documents.

  `RegionAutomationMainMacros.js`, `UnregisterRegionMacros.js`, `TriggerRegionForPartyMacros.js`, and
  `FoundryCompatCheckMacros.js` use an `ra`-prefixed variable naming convention (`raBehavior`, `raToken`,
  `raResult`, ...) and
  `typeof x !== "undefined"` guards instead of relying on parameter defaults, because inside a `Macro`'s
  script body those names are Foundry-injected scope variables that may not exist at all — referencing an
  undeclared variable directly would throw. Preserve this whenever touching these files.

  Every other file under `scripts/world-macros/` — the 4 `*ConfigurationMacros.js`, every activity's
  `*FunctionMacros.js`/`*RollHelperMacros.js`, `ExplorationActivityMacros.js`, `RegistrationMacros.js` — is
  by contrast **only** loaded as a real ES module (imported from `executor.js` / `configuration-dialogs.js` /
  each other / `scripts/world-macros/shared/`), so they're free to use normal parameter defaults, `import`,
  and plain `return` instead of the `resultBox` sidecar pattern (see below).

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

### On-demand triggering (no physical Region entry)

Some Regions don't correspond to a real place on the map — e.g. an abstract "roll for the whole party" trigger
a GM fires once per hour of travel, or whenever else it's narratively appropriate. `TriggerRegionForPartyMacros`
(a GM-facing world Macro, provisioned like the other paste-only macros) lets a GM run every Region Automation
Behavior on a selected Region against every player-character token on the active Scene, right now, as if each
had just walked in:

1. The macro validates GM/Scene/exactly-one-Region-selected (same checks as `UnregisterRegionMacros`), collects
   every token on the active Scene whose `actor.type === "character"`, then calls
   `game.modules.get(MODULE_ID).api.triggerRegionAutomationForTokens({ region, tokens })`.
2. `triggerRegionAutomationForTokens` (`scripts/manual-trigger.js`) runs entirely on the calling GM client — no
   player → GM socket routing, since only a GM can call it (unlike the real `tokenEnter` path, which must
   support player clients). It finds every Region Automation Behavior on the Region and, for each
   Behavior × token pair, calls that functionality's `runX` function (the same ones in `executor.js`'s
   `MODULE_FUNCTIONS`) with a synthetic `{ name: "tokenEnter", data: { token } }` event and
   `skipRegistration: true`.
3. `skipRegistration: true` flows into `runTriggeredCheck` (`shared/trigger-flow.js`) and skips step 4
   (`registerTokenTrigger`/`triggeredTokenUuids`) entirely — this run is never recorded as "already
   triggered," so a GM can fire the same macro again immediately without needing `UnregisterRegionMacros`
   first. Everything else about the run (the `functionality`-flag check, `validateConfig`, the
   `requireExplorationActivity` gate, the roll, the whispered chat message) behaves exactly as it would for a
   real Region entry.
4. `runTriggeredCheck` returns `{ ok, rolled, reason, result? }` at every exit point (see its JSDoc) instead of
   `undefined` — `rolled` is only true when the roll actually executed, so a gated-out pair (e.g. an actor not
   performing the matching exploration activity) is distinguishable from one that actually rolled.
   `triggerRegionAutomationForTokens` uses this to report accurate `ran`/`skipped` counts; the real
   `tokenEnter` path (`executor.js`) still ignores the return value entirely, so this is additive.

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
route prefix, with `cache: "no-store"` — this fetch runs during the `ready` hook, well after the page's own
initial load, so without it a browser hard-reload does nothing to stop a stale cached response from being
served indefinitely; this was the actual cause of a real "my macro edit isn't showing up no matter how many
times I hard-reload" incident), then creates a `Macro` document with that name/command if none exists, or
updates the existing one in place if its stored `command` has drifted from the source — so a `git pull` +
world reload is the
entire update story, never a manual re-paste. Managed macros are filed under a `"PF2e Exploration
Automation"` Macro folder and created with `ownership.default: OWNER` so any GM (not just whichever one's
client ran the sync) can see and run them. All 4 entries — `RegionAutomationMainMacros`,
`UnregisterRegionMacros`, `TriggerRegionForPartyMacros`, `FoundryCompatCheckMacros` — get a custom `img` under
`assets/icons/`; a future entry with no custom `img` falls back to a default core Foundry icon. Every created
macro carries
`flags[MODULE_ID].managed = true`. On every run, `syncWorldMacros()` also deletes any `type: "script"` macro
carrying that flag whose name is no longer in `MANAGED_MACROS` (`pruneOrphanedMacros`) — this is what keeps a
macro from a since-removed table entry (e.g. `SavingThrowFunctionMacros`/`SavingThrowRollHelperMacros`/
`RegistrationMacros` when Saving Throw was ported to ES-only, or the 4 `*ConfigurationMacros.js` once they
were ported — see "Editing an existing automation" below) from lingering forever; it only touches macros
carrying the flag, so anything a GM created or renamed into the folder by hand is left alone. This does
**not** run when the module itself is disabled — Foundry gives modules no hook for that, so the Macro folder
and any macros in it are untouched until the module is enabled again and a sync actually runs. Exposed on the
module API as `syncWorldMacros` for manual re-runs.

### Foundry/pf2e compatibility check

`tests/` (see `tests/README.md`) verifies this module's logic against `tests/helpers/mock-foundry.mjs`'s
hand-rolled Foundry/`pf2e` globals — it can never notice that a mock has drifted from what a real install
actually does. `scripts/foundry-compat-check.js`'s `runFoundryCompatCheck()` is the other half: it runs
**inside a real Foundry client**, not under `node --test`, exercising every Foundry/`pf2e` surface this module
touches (grouped into core-Foundry/Document-CRUD/`pf2e`-system tiers) and reporting what's changed. Deliberately
**not** run automatically (`ready`-hook or otherwise) — its Document-CRUD tier does real create/update/delete
round-trips, each broadcasting to every connected client, so it stays opt-in and GM-triggered only. Run it
whenever `module.json`'s `compatibility.verified` is bumped to a new Foundry version, or after a notable `pf2e`
system update, either by clicking the provisioned `FoundryCompatCheckMacros` macro, or from the browser
console:

```js
await game.modules.get("pf2e-exploration-automation").api.runFoundryCompatCheck();
```

Mutating checks (Macro/Folder/ChatMessage/JournalEntry/Scene/Region/RegionBehavior CRUD) create their own
`"[RA-compat-check]"`-named throwaway documents and delete them in a `finally`, so it's safe to run against a
real world. `pf2e`-system checks are deliberately read-only (existence/`typeof` only) — they never call
`.roll(...)`/`.use(...)`/`.withRollOptions(...)`, since those perform real game actions against a live actor;
see the file's header comment for what a green result does and doesn't guarantee. Each check's comment names
the `tests/helpers/mock-foundry.mjs` mock it corresponds to, so a failure points straight at what to update on
the Node-test side too.

### Functionality dispatch and porting an activity

`RegionBehavior.flags["pf2e-exploration-automation"].functionality` is one of `investigate`, `search`,
`detect-magic`, `saving-throw`, `npc-roster` (`FUNCTION_MACRO_NAMES` / `SUPPORTED_FUNCTIONALITIES`). All five
are ported into the module proper (`MODULE_FUNCTIONS` in `executor.js`, backed by
`world-macros/InvestigateFunctionMacros.js` / `SearchFunctionMacros.js` / `DetectMagicFunctionMacros.js` /
`SavingThrowFunctionMacros.js` / `NpcRosterFunctionMacros.js`). `FUNCTION_MACRO_NAMES` and `executor.js`'s
`game.macros.getName(...)` fallback path are kept only for a future not-yet-ported activity — currently every
functionality resolves through `MODULE_FUNCTIONS` and the fallback is dead code.
`npc-roster` isn't part of the "per-activity macro triad" below — it has no Configuration dialog (see "NPC
roster" further down) and its exploration-activity gate deliberately diverges from its functionality flag
(gates on PF2e's real `"search"`/`"avoid-notice"` activities, not an activity called "npc-roster", and on
*either one independently* — a character can be doing both at once) via `runTriggeredCheck`'s
`explorationActivity` parameter, which accepts an array for exactly this case.

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
4. A new activity's `*ConfigurationMacros.js` should `import { GENERIC_BEHAVIOR_SOURCE as BEHAVIOR_SOURCE }
   from "../migrate-behaviors.js";` (every existing one already does) so newly-created Behaviors get the
   socket-routed source immediately instead of relying on the `createRegionBehavior` migration hook to fix it
   up after the fact.
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
- `shared/gm-log.js` — `logToGMJournal({ regionName, actorName, content })` and the `JOURNAL_NAME` constant
  it's keyed on. Duplicates a successful roll's already-whispered chat message into a persistent, GM-only
  Journal named `"Log: Important Events"` — deliberately generic, not module-branded, so other modules can
  write their own GM-only events into the same shared log rather than each spawning their own
  (`ownership.default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE`, find-or-created on first use, same pattern as
  `macro-sync.js`'s `ensureFolder`). Both `logToGMJournal` and the journal name are re-exported on the module
  API (`main.js`) as `logToGMJournal`/`gmLogJournalName` for exactly that purpose — another module can call
  `game.modules.get(MODULE_ID).api.logToGMJournal(...)` directly, or just target the same Journal by name
  with its own page-creation logic if `regionName`/`actorName`/`content` doesn't fit its data. Each call
  appends one `JournalEntryPage` (`type: "text"`, name `"<Region> — <Character> — <real-time timestamp>"`,
  `sort: Date.now()` so later pages always sort after earlier ones), whose content includes both a game-time
  label (from PF2e's `game.pf2e.worldClock`, falling back to a labeled raw `game.time.worldTime` seconds
  value if that API isn't present) and a real-time timestamp, the character and Region names, and then the
  chat message's `content` HTML verbatim (already escaped by the RollHelper that built it — only the
  region/character names get `escapeHTML`'d here). Called from exactly one place in this module —
  `runTriggeredCheck`, below — so no per-activity wiring is needed; failures are caught and logged, never
  thrown, so a broken Journal can't take down the chat message a GM actually needs.
- `shared/trigger-flow.js` — `runTriggeredCheck(...)`, the gate → register → roll → rollback → GM-log
  orchestration described above, parameterized by
  `label`/`activity`/`explorationActivity`/`requireExplorationActivity`/`skipRegistration`/`validateConfig`/`runRoll`
  (`requireExplorationActivity: false` skips the exploration-activity gate — see Saving Throw;
  `skipRegistration: true` skips the one-shot registration and its rollback — see "On-demand triggering"
  above; `explorationActivity` defaults to `activity` and only needs to be passed when they diverge — see
  `npc-roster`, which gates on PF2e's real `"search"`/`"avoid-notice"` exploration activities while its own
  functionality flag is `"npc-roster"`). `explorationActivity` may be a single slug or an **array** — every
  candidate currently active (not just the first) is passed through to `runRoll`'s context as
  `explorationActivities`, since an actor can be performing more than one at once; `npc-roster`'s own
  `runRoll` checks each independently and rolls whichever applies. It imports `checkExplorationActivity` and
  `registerTokenTrigger` directly and drives them through
  the same `resultBox` contract those two paste-style files still expose internally. On a successful roll
  (`rollResult.message` present), it also calls `logToGMJournal` — this fires for every trigger path (real
  Region entry, the on-demand "run for the party" macro, skipRegistration or not) since they all funnel
  through this one function. (`npc-roster` is the one exception: it can produce two messages from a single
  trigger, so it bypasses this generic single-message auto-log and calls `logToGMJournal` itself instead —
  see "NPC roster" below.)

### Per-activity macro triad

Each exploration activity (`Search`, `Investigate`, `DetectMagic`, `SavingThrow`) follows the same
three-file shape in `scripts/world-macros/`:

- **`*ConfigurationMacros.js`** — GM-facing `DialogV2` UI for attaching/configuring the automation on a
  selected Region, `export async function run<Activity>Configuration({ region, existingBehavior } = {})`.
  Invoked from `RegionAutomationMainMacros.js`'s "Add Automation" dialog via
  `raApi.openConfigurationDialog({ activity, region, existingBehavior })` — see
  `scripts/configuration-dialogs.js`'s dispatch table and "Editing an existing automation" below. Also
  doubles as the **edit** UI for an existing Behavior of that activity.
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

### Editing an existing automation

`RegionAutomationMainMacros.js`'s first dialog has an "Edit Existing…" button alongside the four
per-activity "Add" buttons. Picking it opens a second dialog listing every Region Automation Behavior on the
selected Region (label: `"<Activity> — <Behavior name>"`, built from
`raRegion.behaviors.filter(b => b.flags[MODULE_ID] is an object with a known functionality)` — the same
predicate `UnregisterRegionMacros.js` uses); choosing one and confirming calls
`raApi.openConfigurationDialog({ activity: chosenBehavior's functionality, region: raRegion, existingBehavior:
chosenBehavior })` — `raApi` is `game.modules.get(MODULE_ID).api`, resolved lazily right before each dispatch
call (add or edit) so a GM picking "Edit Existing" on a Region with zero automations never needs the module
API at all. `scripts/configuration-dialogs.js`'s `openConfigurationDialog` looks up the right
`run<Activity>Configuration` function by activity slug and calls it with the same `{ region, existingBehavior
}` shape either path uses — the Add path just omits `existingBehavior`.

Each `run<Activity>Configuration` detects edit mode via `const raExistingBehavior = existingBehavior ?? null;`
and, if present:
- Resolves `raRegion` from `region ?? raExistingBehavior?.parent ?? null` instead of re-deriving it from
  `canvas.regions.controlled` — `RegionAutomationMainMacros.js` already resolved `raRegion` once, up front,
  for both the Add and Edit paths, so the callee just trusts what it's given (falling back to
  `existingBehavior.parent` is defensive, not load-bearing in the normal flow). If neither yields a Region,
  the function reports "the Region is unavailable" and returns — the GM-canvas-selection validation that used
  to live here (no active Scene / zero-or-multiple Regions selected) is now solely `RegionAutomationMainMacros.js`'s
  responsibility, since it's the only caller and always resolves the Region before dispatching.
- Seeds `editorState` from `raExistingBehavior.flags[MODULE_ID].config` instead of the hardcoded defaults
  (Investigate/DetectMagic route this through their existing `normalizeSkills()`, so a corrupted/partial
  stored `skills` object is sanitized the same way a fresh submission would be).
- Swaps the dialog's title/intro text/button label from "Add"/"Create" to "Edit"/"Save Changes".
- On submit, updates the existing Behavior in place with `raExistingBehavior.update(...)` — a dotted-path
  update to `name` and `flags.<MODULE_ID>.config` only — instead of `raRegion.createEmbeddedDocuments(...)`.
  Touching only that one flag path leaves `schemaVersion`/`functionality`/`triggeredTokenUuids` untouched, so
  editing a Behavior's settings never resets who's already triggered it.

Every other part of the dialog (the field-validation loop, the skill-picker Add/Move UI, `wireDocumentDrop`)
is unchanged and shared between add and edit — a `*ConfigurationMacros.js` file has exactly one branch point
near the top (guard clauses + `editorState` seeding) and one near the bottom (create vs. update), everything
in between operates purely on `editorState`/`submittedConfiguration` and doesn't know or care which mode
it's in.

### NPC roster (Search vs. Stealth, Avoid Notice vs. Perception — both ways, independently)

`RegionAutomationMainMacros.js`'s top dialog also manages a per-Region roster of NPC tokens (select NPC
tokens on the canvas and click "Add Selected Token(s)"; double-click an entry to remove it). The roster is
stored on its own service `RegionBehavior` (`functionality: "npc-roster"`, `flags[MODULE_ID].config.npcs:
[{ uuid, tokenId, name }]`), created the moment the roster goes from empty to non-empty and deleted when it
empties out again (`findRosterBehavior`/`saveRoster` in `RegionAutomationMainMacros.js`) — same overall shape
(`schemaVersion`/`functionality`/`config`/`triggeredTokenUuids`) as every other automation's flags.

It's a real, active automation: `system.events: ["tokenEnter"]` and `system.source` is a literal copy of
`GENERIC_BEHAVIOR_SOURCE` (this paste-only file can't `import` it — `migrate-behaviors.js`'s
`SUPPORTED_FUNCTIONALITIES` including `"npc-roster"` self-heals that copy back to the canonical source on the
next `ready` if it ever drifts). `world-macros/NpcRosterFunctionMacros.js` (registered in `executor.js`'s
`MODULE_FUNCTIONS`) handles **two independent directions**, since a character can be performing PF2e's real
`"search"` and `"avoid-notice"` exploration activities **at the same time** (not mutually exclusive) — it
checks each one separately and runs whichever applies (zero, one, or both), from **one shared** one-shot
registration regardless of how many directions fire (a token that already triggered anything on this
Behavior doesn't get a free second entry later):

- **Search** (`NpcRosterSearchRollHelperMacros.js`, `runNpcRosterSearchRoll`): rolls the entering character's
  Perception once, compares it against **every roster NPC's own Stealth DC** (10 + their Stealth modifier).
- **Avoid Notice** (`NpcRosterAvoidNoticeRollHelperMacros.js`, `runNpcRosterAvoidNoticeRoll`): rolls the
  entering character's Stealth once, compares it against **every roster NPC's own passive Perception DC** (10
  + their Perception modifier) — the mirror image of Search.

Both are the same "one shared roll vs several DCs" pattern Investigate/DetectMagic already use, just keyed by
NPC instead of by skill; the row-resolution/table-rendering logic itself (`resolveNpcRow`/`npcRowHTML`,
parameterized by which statistic to check on the NPC) is factored into `shared/npc-roster.js` so the two
directions share it instead of duplicating it. Both roll through PF2e's Check API
(`statistic.roll({ extraRollOptions })`, the same mechanism `SavingThrowRollHelperMacros.js` uses for saves)
rather than a raw `new Roll("1d20")` plus a manually-added static modifier — that's what lets PF2e's own Rule
Elements (Keen Eyes, Sensate Gnome, Sharp-Eared Catfolk, etc. for Search) apply automatically. Search reuses
the *exact* roll options native Search's Seek action already relies on for those feats
(`getTargetRollOptions("npc")`/`getNaturalD20`, exported from `SearchRollHelperMacros.js` for this reuse, so
there's no second copy to drift). Avoid Notice's own roll options have no existing precedent in this codebase
to copy from — they're a best-effort guess (`"action:avoid-notice"`, `"action:hide"`, ...), unverified against
a real PF2e install. Both directions also show PF2e's own modifier breakdown string in the chat message
(`resolved.check.breakdown`, resolved the same way `InvestigateRollHelperMacros.js`'s `resolveStatistic()`
does — a second, read-only `statistic.withRollOptions({ extraRollOptions })` call purely to read the
breakdown off, alongside the actual `.roll()` call), so the GM sees *which* named modifiers contributed to
the total, not just the number. If the searching character has a `"sense-the-unseen"` item, Search's message
adds a note flagging that to the GM — its effect isn't computed automatically, just surfaced. A roster entry
whose Token can no longer be resolved, or whose Actor lacks the statistic being checked, is reported in the
table either way, not silently dropped.

**How "check each independently, roll each that applies" is wired**: `shared/trigger-flow.js`'s
`runTriggeredCheck` accepts `explorationActivity` as a string (existing activities) *or an array*
(`["search", "avoid-notice"]` here) — every candidate that's currently active (via
`checkExplorationActivity`'s `activeActivities`, which already lists everything active regardless of which
single slug is asked about — no change needed there) is passed through to `runRoll`'s context as
`explorationActivities` (plural), not just the first match. `NpcRosterFunctionMacros.js`'s `runRoll` is two
independent `if (context.explorationActivities.includes(...))` checks, each calling its own roll helper if it
applies; `runTriggeredCheck`'s own generic single-message GM-journal auto-log is bypassed here (the combined
result carries no top-level `.message`, since there can be two) — `NpcRosterFunctionMacros.js` calls
`logToGMJournal` itself for each message actually produced.

This is intentionally independent of, and can coexist on the same Region with, the pre-existing
manually-configured single-target Search triad (`SearchConfigurationMacros.js` / `SearchFunctionMacros.js` /
`SearchRollHelperMacros.js`, DC entered by hand for one specific thing) — that triad is unmodified; both fire
from the same `tokenEnter` event independently, as separate Behaviors.

`"npc-roster"` stays absent from `RegionAutomationMainMacros.js`'s own `functionalityLabels` (which is what
makes it automatically invisible to "Edit Existing" — that list is filtered by
`functionalityLabels[functionality]` being truthy) since it has no dedicated Configuration dialog to route to
— this roster section is already its full editing UI.

There is deliberately no drag-and-drop of canvas tokens onto this dialog. A placed Token is a PIXI sprite
drawn inside a single `<canvas>` element, not a DOM element, so unlike a sidebar/compendium document (which
`wireDocumentDrop` in every `*ConfigurationMacros.js` *does* handle, via native HTML5 drag-and-drop) a canvas
Token can't be a native drag source — there's no `drop` event to receive. Instead, "Add Selected Token(s)"
reads `canvas.tokens.controlled` at click time: the GM switches the canvas to Token Controls and selects NPC
tokens *while this dialog stays open* (it's non-modal, `modal: false`, same as every other dialog in this
module, so the canvas remains interactive), then clicks the button. Selecting tokens before opening the
dialog also works, since `canvas.tokens.controlled` reflects whatever was selected regardless of when.

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
