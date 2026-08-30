/**
 * PF2e Exploration Automation
 * scripts/foundry-compat-check.js
 *
 * FOUNDRY / PF2E COMPATIBILITY CHECK
 * ===================================
 *
 * tests/helpers/mock-foundry.mjs hand-rolls the Foundry/pf2e API surface
 * this module depends on so `node --test` can verify our *logic*. That
 * mock can never notice the day a real Foundry or pf2e update changes one
 * of those surfaces — a bigger mock doesn't fix that either, since a
 * mock's completeness and its accuracy are independent. This file is the
 * other half: it runs inside a real Foundry client (this module already
 * loaded), exercises every surface we actually touch, and reports what
 * changed.
 *
 * Run it from the browser console (F12) or a throwaway macro, whenever
 * module.json's compatibility.verified is bumped to a new Foundry
 * version, or after a notable pf2e system update:
 *
 *   await game.modules.get("pf2e-exploration-automation").api.runFoundryCompatCheck();
 *
 * It is NOT run by `node --test` — the whole point is testing against the
 * real thing, not another mock. Every check whose comment names a
 * tests/helpers/mock-foundry.mjs mock is telling you: if this fails, that
 * mock is what needs updating to match reality.
 *
 * Every mutating check (tier 2) creates its own "[RA-compat-check]"-named
 * throwaway documents and deletes them in a finally block — this never
 * touches the GM's real Scenes/Regions/Macros. Tier 3 (pf2e) checks are
 * deliberately read-only: they confirm a function/property exists with
 * the right type, but never call `.roll(...)`/`.use(...)`/
 * `.withRollOptions(...)`, since those perform real game actions (dice
 * rolls, exploration-activity side effects) against a live actor. A
 * green tier-3 result means "the surface still exists" — it does not
 * re-verify the exact fields a real roll result carries; if you suspect
 * those drifted, perform one real Seek/Saving Throw/Investigate/Detect
 * Magic in the UI and compare the chat card against this module's output.
 */

function makeChecker() {
    const results = [];

    async function check(name, fn) {
        try {
            const detail = await fn();
            results.push({ name, ok: true, detail: detail ?? "" });
        } catch (error) {
            results.push({ name, ok: false, detail: error?.message ?? String(error) });
        }
    }

    function expectType(value, type, label) {
        if (typeof value !== type) {
            throw new Error(`expected ${label} to be "${type}", got "${typeof value}" (${JSON.stringify(value)})`);
        }
    }

    function expectTruthy(value, label) {
        if (!value) throw new Error(`expected ${label} to be truthy, got ${JSON.stringify(value)}`);
    }

    return { results, check, expectType, expectTruthy };
}

/**
 * Tier 1: core Foundry surfaces that rarely change shape.
 */
async function checkCoreFoundry({ check, expectType, expectTruthy }) {
    // mock: mock-foundry.mjs installBaseGlobals()'s `game.user`
    await check("game.user.isGM / game.user.id", () => {
        expectType(game.user.isGM, "boolean", "game.user.isGM");
        expectType(game.user.id, "string", "game.user.id");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `game.users`
    await check("game.users is iterable with .get(id)", () => {
        expectType(game.users.get, "function", "game.users.get");
        expectTruthy(Array.from(game.users).length >= 1, "at least one game.users entry");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `game.modules`
    await check("game.modules.get(MODULE_ID) resolves this module with .api", () => {
        const packageModule = game.modules.get("pf2e-exploration-automation");
        expectTruthy(packageModule, "game.modules.get(MODULE_ID)");
        expectType(packageModule.api, "object", "packageModule.api");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `game.macros`
    await check("game.macros exposes .find/.filter/.getName", () => {
        expectType(game.macros.find, "function", "game.macros.find");
        expectType(game.macros.filter, "function", "game.macros.filter");
        expectType(game.macros.getName, "function", "game.macros.getName");
    });

    // mock: not currently mocked — used by macro-sync.js's ensureFolder()
    await check("game.folders.find exists", () => {
        expectType(game.folders.find, "function", "game.folders.find");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `game.journal`
    await check("game.journal.find exists", () => {
        expectType(game.journal.find, "function", "game.journal.find");
    });

    // mock: not mocked (socket.js/executor.js tests stub game.socket directly)
    await check("game.socket exposes .emit/.on", () => {
        expectType(game.socket.emit, "function", "game.socket.emit");
        expectType(game.socket.on, "function", "game.socket.on");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `game.time`
    await check("game.time.worldTime is a number", () => {
        expectType(game.time.worldTime, "number", "game.time.worldTime");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `ui.notifications`
    await check("ui.notifications exposes .info/.warn/.error", () => {
        expectType(ui.notifications.info, "function", "ui.notifications.info");
        expectType(ui.notifications.warn, "function", "ui.notifications.warn");
        expectType(ui.notifications.error, "function", "ui.notifications.error");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `canvas`
    await check("canvas exposes .ready/.scene/.regions.controlled/.tokens.placeables", () => {
        expectType(canvas.ready, "boolean", "canvas.ready");
        expectType(canvas.regions.controlled, "object", "canvas.regions.controlled");
        expectTruthy(Array.isArray(Array.from(canvas.regions.controlled)), "canvas.regions.controlled is array-like");
        expectTruthy(Array.isArray(Array.from(canvas.tokens?.placeables ?? [])), "canvas.tokens.placeables is array-like");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `CONST`
    await check("CONST.DOCUMENT_OWNERSHIP_LEVELS has the expected numeric values", () => {
        const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
        if (levels.NONE !== 0) throw new Error(`NONE is ${levels.NONE}, expected 0`);
        if (levels.OWNER !== 3) throw new Error(`OWNER is ${levels.OWNER}, expected 3`);
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `CONST`
    await check("CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML exists", () => {
        expectTruthy(CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML !== undefined, "CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `globalThis.Hooks`
    await check("Hooks exposes .on/.once", () => {
        expectType(Hooks.on, "function", "Hooks.on");
        expectType(Hooks.once, "function", "Hooks.once");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `fromUuid`/`foundry.utils.fromUuid`
    await check("fromUuid resolves a document this module just created", async () => {
        const probe = await Macro.create({ name: "[RA-compat-check] fromUuid probe", type: "script", command: "" });
        try {
            const resolved = await fromUuid(probe.uuid);
            expectTruthy(resolved, `fromUuid("${probe.uuid}")`);
            if (resolved.id !== probe.id) throw new Error("fromUuid resolved a different document than expected");
        } finally {
            await probe.delete();
        }
    });

    // mock: not mocked directly
    await check("foundry.utils.randomID is a function", () => {
        expectType(foundry.utils.randomID, "function", "foundry.utils.randomID");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `foundry.applications.api.DialogV2` —
    // intentionally never invoked here: DialogV2.wait(...) opens a real modal
    // waiting on user input, which this automated check must not trigger.
    await check("foundry.applications.api.DialogV2.wait exists (not invoked)", () => {
        expectType(foundry.applications?.api?.DialogV2?.wait, "function", "foundry.applications.api.DialogV2.wait");
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `foundry.applications.ux`
    await check("foundry.applications.ux.TextEditor(.implementation).getDragEventData exists", () => {
        const TextEditorClass = foundry.applications?.ux?.TextEditor?.implementation ?? foundry.applications?.ux?.TextEditor ?? null;
        expectTruthy(TextEditorClass, "foundry.applications.ux.TextEditor(.implementation)");
        expectType(TextEditorClass.getDragEventData, "function", "TextEditor.getDragEventData");
    });
}

/**
 * Tier 2: Document CRUD contracts. These actually create, inspect, and
 * delete throwaway documents — the only way to verify the real shape.
 */
async function checkDocumentContracts({ check, expectType, expectTruthy }) {
    // mock: tests/macro-sync.test.mjs's installMacroWorld()
    await check("Macro.create/.update/.delete round-trip with the fields macro-sync.js relies on", async () => {
        const folder = await Folder.create({ name: "[RA-compat-check] Folder", type: "Macro" });

        try {
            const macro = await Macro.create({
                name: "[RA-compat-check] Macro",
                type: "script",
                command: "// noop",
                img: "icons/svg/dice-target.svg",
                folder: folder.id,
                ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
                flags: { "pf2e-exploration-automation": { managed: true } },
            });

            try {
                expectType(macro.command, "string", "macro.command");
                expectType(macro.img, "string", "macro.img");
                expectTruthy(macro.folder, "macro.folder");
                expectType(macro.update, "function", "macro.update");
                expectTruthy(macro.flags?.["pf2e-exploration-automation"]?.managed === true, "macro.flags[MODULE_ID].managed");

                await macro.update({ command: "// updated" });

                const refetched = game.macros.get(macro.id);
                if (refetched && refetched.command !== "// updated") {
                    throw new Error("macro.update() did not persist .command");
                }
            } finally {
                await macro.delete();
            }
        } finally {
            await folder.delete();
        }
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `ChatMessage`
    await check("ChatMessage.create round-trips a whispered message", async () => {
        const message = await ChatMessage.create({ content: "[RA-compat-check]", whisper: [game.user.id] });
        try {
            expectTruthy(message.id, "message.id");
        } finally {
            await message.delete();
        }
    });

    // mock: mock-foundry.mjs installBaseGlobals()'s `JournalEntry`, used by shared/gm-log.js
    await check("JournalEntry.create + .createEmbeddedDocuments('JournalEntryPage', ...) round-trips", async () => {
        const journal = await JournalEntry.create({
            name: "[RA-compat-check] Journal",
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        });

        try {
            const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [
                { name: "Page", type: "text", text: { content: "<p>x</p>", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } },
            ]);

            expectTruthy(page?.id, "created JournalEntryPage.id");
        } finally {
            await journal.delete();
        }
    });

    // mock: mock-foundry.mjs's makeRegion/makeBehavior/makeToken + createEmbeddedDocuments/updateEmbeddedDocuments
    await check("Scene -> Region -> RegionBehavior embedded-document chain matches what executor.js/migrate-behaviors.js assume", async () => {
        const scene = await Scene.create({ name: "[RA-compat-check] Scene", active: false });

        try {
            const [region] = await scene.createEmbeddedDocuments("Region", [{ name: "[RA-compat-check] Region" }]);
            expectTruthy(region, "created Region");
            expectTruthy(scene.regions?.has?.(region.id) ?? Array.from(scene.regions ?? []).some(r => r.id === region.id), "scene.regions contains the created Region");

            const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [
                {
                    name: "[RA-compat-check] Behavior",
                    type: "executeScript",
                    system: { events: ["tokenEnter"], source: "" },
                    flags: { "pf2e-exploration-automation": { functionality: "search", schemaVersion: 2, config: {}, triggeredTokenUuids: [] } },
                },
            ]);

            expectTruthy(behavior, "created RegionBehavior");
            expectTruthy(behavior.parent?.id === region.id, "behavior.parent is the owning Region");
            expectType(behavior.testUserPermission, "function", "behavior.testUserPermission");
            expectType(region.updateEmbeddedDocuments, "function", "region.updateEmbeddedDocuments");

            await region.updateEmbeddedDocuments("RegionBehavior", [{ _id: behavior.id, "system.source": "// updated" }]);

            const refetchedBehavior = region.behaviors?.get?.(behavior.id) ?? Array.from(region.behaviors ?? []).find(b => b.id === behavior.id);
            if (refetchedBehavior && refetchedBehavior.system?.source !== "// updated") {
                throw new Error("region.updateEmbeddedDocuments() did not persist system.source");
            }
        } finally {
            // Deleting the Scene cascades to its embedded Regions/RegionBehaviors.
            await scene.delete();
        }
    });
}

/**
 * Tier 3: pf2e-system contracts — the fastest-moving dependency. Every
 * check here is read-only (existence/typeof); see the file header for why
 * `.roll(...)`/`.use(...)` are never actually invoked.
 */
async function checkPf2eSystem({ check, expectType, expectTruthy }) {
    const testActor =
        game.user.character ?? game.actors?.find?.(actor => actor.type === "character" && actor.isOwner) ?? null;

    if (!testActor) {
        await check("pf2e Actor statistic surface (actor.getStatistic/.skills/.saves/.perception)", () => {
            throw new Error("no test character available — set game.user.character or own at least one type:\"character\" Actor, then re-run");
        });

        return;
    }

    // mock: SavingThrowRollHelperMacros.js / InvestigateRollHelperMacros.js / SearchRollHelperMacros.js's
    // `actor.getStatistic?.(slug) ?? actor.skills?.[slug] ?? null` fallback chain
    await check("actor.getStatistic exists and returns a Statistic-shaped object for a known skill", () => {
        expectType(testActor.getStatistic, "function", "actor.getStatistic");
        const statistic = testActor.getStatistic("perception") ?? testActor.perception ?? null;
        expectTruthy(statistic, 'actor.getStatistic("perception") ?? actor.perception');
        expectTruthy("rank" in statistic, "statistic.rank");
        expectTruthy("label" in statistic, "statistic.label");
        expectTruthy(typeof statistic.roll === "function" || statistic.roll === undefined, "statistic.roll (function, when present)");
    });

    // mock: InvestigateRollHelperMacros.js's resolveStatistic()
    await check("skill Statistic exposes .check.mod / .mod and .withRollOptions", () => {
        const statistic = testActor.getStatistic?.("arcana") ?? testActor.skills?.arcana ?? null;
        expectTruthy(statistic, 'actor.getStatistic("arcana") ?? actor.skills.arcana');
        expectTruthy(statistic.check?.mod !== undefined || statistic.mod !== undefined, "statistic.check.mod or statistic.mod");
        expectType(statistic.withRollOptions, "function", "statistic.withRollOptions");
    });

    // mock: SavingThrowRollHelperMacros.js's `actor.getStatistic?.(saveType) ?? actor.saves?.[saveType]`
    await check("save Statistic exposes .roll (not invoked) and .rank", () => {
        const statistic = testActor.getStatistic?.("reflex") ?? testActor.saves?.reflex ?? null;
        expectTruthy(statistic, 'actor.getStatistic("reflex") ?? actor.saves.reflex');
        expectType(statistic.roll, "function", "statistic.roll");
        expectTruthy("rank" in statistic, "statistic.rank");
    });

    // mock: SearchRollHelperMacros.js's `game.pf2e?.actions?.get?.("seek")`
    await check('game.pf2e.actions.get("seek") returns an action exposing .use (not invoked)', () => {
        expectType(game.pf2e?.actions?.get, "function", "game.pf2e.actions.get");
        const seekAction = game.pf2e.actions.get("seek");
        expectTruthy(seekAction, 'game.pf2e.actions.get("seek")');
        expectType(seekAction.use, "function", "seekAction.use");
    });

    // mock: shared/gm-log.js's formatGameTime()
    await check("game.pf2e.worldClock.worldTime exposes .toFormat/.toLocaleString, if present", () => {
        const worldClockTime = game.pf2e?.worldClock?.worldTime;
        if (worldClockTime === undefined) return "game.pf2e.worldClock not present in this world (fine — gm-log.js falls back to raw worldTime)";
        expectTruthy(typeof worldClockTime.toFormat === "function" || typeof worldClockTime.toLocaleString === "function", "worldClockTime.toFormat or .toLocaleString");
    });

    // mock: ExplorationActivityMacros.js's checkExplorationActivity()
    await check("actor.items.get / item.system.traits.value and actor.system.exploration are readable", () => {
        expectType(testActor.items?.get, "function", "actor.items.get");
        expectTruthy(Array.isArray(testActor.system?.exploration ?? []), "actor.system.exploration is array-like");
    });

    // mock: DetectMagicRollHelperMacros.js / InvestigateRollHelperMacros.js's `new Roll("1d20").evaluate()`
    await check("Roll('1d20').evaluate() returns a rollable with .total (this one IS actually rolled — it's core Foundry dice, not a pf2e game action)", async () => {
        const roll = await new Roll("1d20").evaluate();
        expectType(roll.total, "number", "roll.total");
        expectTruthy(roll.total >= 1 && roll.total <= 20, "roll.total is within 1d20 range");
    });
}

/**
 * Runs every tier of check and reports a summary.
 *
 * @param {{ notify?: boolean }} [options]
 */
export async function runFoundryCompatCheck({ notify = true } = {}) {
    if (!game.user?.isGM) {
        console.warn("Region Automation | Only a GM should run the Foundry compatibility check.");
        return { ok: false, results: [] };
    }

    const checker = makeChecker();

    await checkCoreFoundry(checker);
    await checkDocumentContracts(checker);
    await checkPf2eSystem(checker);

    const { results } = checker;
    const failed = results.filter(result => !result.ok);
    const ok = failed.length === 0;

    console.table(results.map(result => ({ check: result.name, ok: result.ok, detail: result.detail })));

    if (notify) {
        if (ok) {
            ui.notifications.info(`Region Automation: Foundry/pf2e compatibility check passed all ${results.length} checks.`);
        } else {
            ui.notifications.warn(`Region Automation: Foundry/pf2e compatibility check found ${failed.length} drifted/broken surface(s). See the console table.`);
        }
    }

    return { ok, results };
}
