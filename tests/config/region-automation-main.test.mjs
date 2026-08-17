import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeBehavior, makeRegion, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { runPastedMacro } from "../helpers/run-macro.mjs";

const MACRO_URL = new URL("../../scripts/world-macros/RegionAutomationMainMacros.js", import.meta.url);
const SEARCH_CONFIG_URL = new URL("../../scripts/world-macros/SearchConfigurationMacros.js", import.meta.url);

async function runMacro() {
    await runPastedMacro(MACRO_URL);
}

function setupWorld({ isGM = true, hasScene = true, regions = [] } = {}) {
    const handles = installBaseGlobals({ isGM });
    globalThis.canvas.ready = hasScene;
    globalThis.canvas.scene = hasScene ? { uuid: "Scene.mock" } : null;
    globalThis.canvas.regions.controlled = regions;
    globalThis.document = { createElement: () => ({ innerHTML: "" }) };
    return handles;
}

/** A spy stand-in for one of the *ConfigurationMacros.js world Macros. */
function makeSpyMacro(name) {
    const calls = [];
    return {
        macro: { name, type: "script", execute: async scope => { calls.push(scope); } },
        calls,
    };
}

function installMacros(macros) {
    globalThis.game.macros = {
        filter: predicate => macros.filter(predicate),
    };
}

test("RegionAutomationMainMacros: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runMacro();
    assert.match(notifications.error[0], /only a GM can add automations/);
});

test("RegionAutomationMainMacros: rejects when zero or multiple Regions are selected", async () => {
    const { notifications } = setupWorld({ regions: [] });
    await runMacro();
    assert.match(notifications.warn[0], /select exactly one Region/);
});

test("RegionAutomationMainMacros: 'Add Automation' still dispatches to the chosen activity's Configuration macro with no scope", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    const search = makeSpyMacro("SearchConfigurationMacros");
    installMacros([search.macro]);

    // The picker dialog's buttons map action -> callback, so simulate
    // picking "search" by driving the mock through its button lookup
    // rather than form fields (there's no form on this dialog).
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        const button = config.buttons.find(b => b.action === "search");
        return button.callback();
    };

    await runMacro();

    assert.equal(search.calls.length, 1);
    assert.equal(search.calls[0], undefined);
});

test("RegionAutomationMainMacros: 'Edit Existing' with no automations on the Region reports there's nothing to edit", async () => {
    const region = makeRegion({ behaviors: [] });
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        const button = config.buttons.find(b => b.action === "edit");
        return button.callback();
    };

    await runMacro();

    assert.match(notifications.info[0], /has no automations to edit/);
});

test("RegionAutomationMainMacros: 'Edit Existing' lists every automation and dispatches to the right Configuration macro with existingBehavior", async () => {
    const region = makeRegion();
    const searchBehavior = makeBehavior({ functionality: "search", config: { subject: "Cache" }, parent: region });
    const savingThrowBehavior = makeBehavior({ functionality: "saving-throw", config: { subject: "Trap" }, parent: region });
    region.behaviors.push(searchBehavior, savingThrowBehavior);

    setupWorld({ regions: [{ document: region }] });

    const search = makeSpyMacro("SearchConfigurationMacros");
    const savingThrow = makeSpyMacro("SavingThrowConfigurationMacros");
    installMacros([search.macro, savingThrow.macro]);

    let callIndex = 0;
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        callIndex += 1;

        if (callIndex === 1) {
            // The top-level Add/Edit picker: choose "Edit Existing".
            const button = config.buttons.find(b => b.action === "edit");
            return button.callback();
        }

        // The behavior picker: select the second listed automation
        // (the Saving Throw one, index 1) via its <select>.
        const button = config.buttons.find(b => b.action === "edit");
        return button.callback({}, { form: { elements: { namedItem: () => ({ value: "1" }) } } });
    };

    await runMacro();

    assert.equal(search.calls.length, 0);
    assert.equal(savingThrow.calls.length, 1);
    assert.equal(savingThrow.calls[0].existingBehavior, savingThrowBehavior);
});

test("RegionAutomationMainMacros: canceling the behavior picker dispatches nothing", async () => {
    const region = makeRegion();
    region.behaviors.push(makeBehavior({ functionality: "search", config: {}, parent: region }));
    setupWorld({ regions: [{ document: region }] });

    const search = makeSpyMacro("SearchConfigurationMacros");
    installMacros([search.macro]);

    let callIndex = 0;
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        callIndex += 1;

        if (callIndex === 1) {
            return config.buttons.find(b => b.action === "edit").callback();
        }

        return config.buttons.find(b => b.action === "cancel").callback();
    };

    await runMacro();

    assert.equal(search.calls.length, 0);
});

test("RegionAutomationMainMacros end-to-end: editing dispatches into the real SearchConfigurationMacros.js, which updates the Behavior in place", async () => {
    const region = makeRegion();
    const existing = makeBehavior({
        functionality: "search",
        config: { subject: "Old Cache", hint: "", dc: 15, targetType: "npc" },
        triggeredTokenUuids: ["Token.already-triggered"],
        parent: region,
    });
    region.behaviors.push(existing);

    setupWorld({ regions: [{ document: region }] });

    // The real Configuration macro this dispatches to opens its own
    // DialogV2 too, so the mock has to route by dialog title/content
    // rather than a fixed call index.
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        if (config.window.title === "Region Automation — Add Automation") {
            return config.buttons.find(b => b.action === "edit").callback();
        }

        if (config.window.title === "Region Automation — Edit Existing") {
            return config.buttons
                .find(b => b.action === "edit")
                .callback({}, { form: { elements: { namedItem: () => ({ value: "0" }) } } });
        }

        // Search's own "Edit Search" dialog: submit a changed DC.
        const button = config.buttons.find(b => b.action !== "cancel");
        return button.callback({}, { form: { elements: { namedItem: name => (name === "dc" ? { value: "30" } : null) } } });
    };

    installMacros([
        {
            name: "SearchConfigurationMacros",
            type: "script",
            execute: scope => runPastedMacro(SEARCH_CONFIG_URL, scope),
        },
    ]);

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    assert.equal(existing.flags[MODULE_ID].config.dc, 30);
    // Fields not touched by this submission fell back to the existing config.
    assert.equal(existing.flags[MODULE_ID].config.subject, "Old Cache");
    assert.deepEqual(existing.flags[MODULE_ID].triggeredTokenUuids, ["Token.already-triggered"]);
});
