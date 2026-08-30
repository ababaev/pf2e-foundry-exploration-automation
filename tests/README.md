# Test suite

Run everything with `node --test` from the repo root (no arguments — see `CLAUDE.md`'s Commands section for
why an explicit path doesn't work here). Uses Node's built-in `node:test`/`node:assert` — no dependency, no
`package.json`, matching the rest of the project.

## Layout

- `tests/helpers/` — shared test infrastructure, described below.
- `tests/config/` — one file per activity's `*ConfigurationMacros.js` (the "Add Automation" `DialogV2` a GM
  fills in): field validation, the created `RegionBehavior`'s shape, and (Investigate/DetectMagic) the
  skill-picker's Add/Move and chip-removal interactions.
- `tests/activities/` — one file per activity's real `run*`/`run*Roll` functions (`SearchFunctionMacros.js` +
  `SearchRollHelperMacros.js`, etc.): the exploration-activity gate, the actual roll/degree computation,
  chat-message output, one-shot registration, and rollback-on-technical-failure.
- `tests/shared/` — the orchestration every activity is built on: `runTriggeredCheck`
  (`shared/trigger-flow.js`), `checkExplorationActivity`, `registerTokenTrigger`.
- `tests/executor.test.mjs`, `tests/socket.test.mjs` — the player → GM socket bridge: primary-GM election,
  request validation/locking/permission checks.
- `tests/migrate-behaviors.test.mjs`, `tests/macro-sync.test.mjs` — Behavior source normalization and world
  Macro provisioning/pruning.
- `tests/manual-trigger.test.mjs` — the "run this Region for the whole party right now" on-demand path.

## Helpers (`tests/helpers/`)

- **`mock-foundry.mjs`** — `installBaseGlobals()` sets up `game`/`ui`/`canvas`/`ChatMessage`/`Roll`/`foundry`/
  `fromUuid`/`CONST`/`HTMLElement` on `globalThis`; call it first in every test. Returns handles
  (`notifications`, `chatMessages`) to assert against. `makeActor`/`makeToken`/`makeBehavior`/`makeRegion`/
  `makeExplorationItem` build minimal fixtures with real (in-memory) `.update()`/`.createEmbeddedDocuments()`
  methods, so registration/rollback/creation logic runs for real rather than being stubbed out.
- **`run-macro.mjs`** — `runPastedMacro(fileUrl)` runs a `scripts/world-macros/*.js` **paste-only** file
  (`RegionAutomationMainMacros.js`, `UnregisterRegionMacros.js`, `TriggerRegionForPartyMacros.js`) the same
  way Foundry actually runs a world Macro: reads the source text and executes it as an `AsyncFunction` body,
  rather than `import()`-ing it. These files intentionally have no `import`/`export` (they get pasted into a
  `Macro` document, which can't use static `import`), so Node can't unambiguously detect them as ESM and
  top-level `await` fails under Node's CommonJS fallback if you try to `import()` them directly — this
  sidesteps that, and is more faithful to production besides. Every call re-reads the file and builds a fresh
  function, so there's no caching to fight and no need for cache-busting query strings. Everything else under
  `scripts/world-macros/` — `*ConfigurationMacros.js`, `*FunctionMacros.js`, `*RollHelperMacros.js`,
  `ExplorationActivityMacros.js`, `RegistrationMacros.js` — **does** have `export`, is a real ES module, and
  should just be `import`-ed normally (`tests/config/*` imports `run<Activity>Configuration` directly;
  `tests/activities/*` does the same for `run<Activity>`/`run<Activity>Roll`).
- **`fake-dialog.mjs`** — `queueDialogResponses([...])` stands in for `foundry.applications.api.DialogV2.wait`
  so `tests/config/*` can drive a Configuration macro's dialog loop without a real browser DOM. Each queued
  response covers one `DialogV2.wait()` call (the macros loop and re-open the dialog when validation fails,
  so a retry-path test queues two responses); a response can supply `fields` (read by the clicked button's
  own `callback` via `button.form.elements.namedItem(...)`) and/or `elements` (fake DOM nodes with
  `addEventListener`/`.value`/`.innerHTML`, found via the dialog's `render` callback's `root.querySelector`,
  for testing wiring like `wireDocumentDrop` or the skill-picker's Add/Move button). A registered `[name="x"]`
  element's live `.value` wins over the queued field for that name, so a "drop" handler that mutates the
  element is correctly reflected in what gets submitted — matching how a real `<form>` behaves. Chip removal
  (double-click to remove a configured skill) is supported by parsing `data-ra-chip="..."` back out of
  whatever HTML string a test element's `.innerHTML` setter receives.

## Gotchas

- **Module-level state persists across every `test()` in the same file.** `executor.js` (`recentRequestIds`,
  `activeExecutionKeys`) and `socket.js` (`socketRegistered`) hold real state at module scope, and Node only
  imports a given module once per process — so it survives between `test()` blocks in the same file (this is
  accurate to production; it's a Node-test-runner authoring hazard, not a bug). Give every request a unique
  `requestId` unless a test is deliberately checking dedupe, and only call `registerSocket()`'s
  once-per-process behavior from a single `test()`.
- **Node's test runner isolates by *file*, not by `test()` block.** Mutating `globalThis.game`/`ui`/etc. in
  one file never leaks into another (each file gets its own process by default), but two `test()`s in the
  *same* file share `globalThis` — always call `installBaseGlobals()` (or reinstall whatever globals you
  need) at the top of each `test()`, don't rely on state a previous test in the file happened to leave
  behind.
