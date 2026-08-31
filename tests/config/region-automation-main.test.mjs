import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeRegion, makeToken, registerUuidDocument, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { runPastedMacro } from "../helpers/run-macro.mjs";
import { queueDialogResponses } from "../helpers/fake-dialog.mjs";
import { runSearchConfiguration } from "../../scripts/world-macros/SearchConfigurationMacros.js";

const MACRO_URL = new URL("../../scripts/world-macros/RegionAutomationMainMacros.js", import.meta.url);

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

/** A spy stand-in for the module API's openConfigurationDialog. */
function installApiSpy(impl) {
    const calls = [];

    globalThis.game.modules.set(MODULE_ID, {
        api: {
            openConfigurationDialog: async args => {
                calls.push(args);
                if (impl) await impl(args);
            },
        },
    });

    return calls;
}

test("RegionAutomationMainMacros: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runMacro();
    assert.match(notifications.error[0], /only a GM can add automations/);
});

test("RegionAutomationMainMacros: rejects when there is no active Scene", async () => {
    const { notifications } = setupWorld({ hasScene: false });
    await runMacro();
    assert.match(notifications.error[0], /there is no active Scene/);
});

test("RegionAutomationMainMacros: rejects when zero or multiple Regions are selected", async () => {
    const { notifications } = setupWorld({ regions: [] });
    await runMacro();
    assert.match(notifications.warn[0], /select exactly one Region/);
});

test("RegionAutomationMainMacros: rejects when the module API is unavailable", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });
    // No entry in game.modules for this module id.

    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        const button = config.buttons.find(b => b.action === "search");
        return button.callback();
    };

    await runMacro();

    assert.match(notifications.error[0], /module API is unavailable/);
});

test("RegionAutomationMainMacros: 'Add Automation' dispatches to the chosen activity via the module API", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    const calls = installApiSpy();

    // The picker dialog's buttons map action -> callback, so simulate
    // picking "search" by driving the mock through its button lookup
    // rather than form fields (there's no form on this dialog).
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        const button = config.buttons.find(b => b.action === "search");
        return button.callback();
    };

    await runMacro();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].activity, "search");
    assert.equal(calls[0].region, region);
    assert.equal(calls[0].existingBehavior, undefined);
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

test("RegionAutomationMainMacros: 'Edit Existing' lists every automation and dispatches to the right one via the module API", async () => {
    const region = makeRegion();
    const searchBehavior = makeBehavior({ functionality: "search", config: { subject: "Cache" }, parent: region });
    const savingThrowBehavior = makeBehavior({ functionality: "saving-throw", config: { subject: "Trap" }, parent: region });
    region.behaviors.push(searchBehavior, savingThrowBehavior);

    setupWorld({ regions: [{ document: region }] });

    const calls = installApiSpy();

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

    assert.equal(calls.length, 1);
    assert.equal(calls[0].activity, "saving-throw");
    assert.equal(calls[0].region, region);
    assert.equal(calls[0].existingBehavior, savingThrowBehavior);
});

test("RegionAutomationMainMacros: canceling the behavior picker dispatches nothing", async () => {
    const region = makeRegion();
    region.behaviors.push(makeBehavior({ functionality: "search", config: {}, parent: region }));
    setupWorld({ regions: [{ document: region }] });

    const calls = installApiSpy();

    let callIndex = 0;
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        callIndex += 1;

        if (callIndex === 1) {
            return config.buttons.find(b => b.action === "edit").callback();
        }

        return config.buttons.find(b => b.action === "cancel").callback();
    };

    await runMacro();

    assert.equal(calls.length, 0);
});

test("RegionAutomationMainMacros end-to-end: editing dispatches into the real runSearchConfiguration, which updates the Behavior in place", async () => {
    const region = makeRegion();
    const existing = makeBehavior({
        functionality: "search",
        config: { subject: "Old Cache", hint: "", dc: 15, targetType: "npc" },
        triggeredTokenUuids: ["Token.already-triggered"],
        parent: region,
    });
    region.behaviors.push(existing);

    setupWorld({ regions: [{ document: region }] });

    globalThis.game.modules.set(MODULE_ID, {
        api: {
            openConfigurationDialog: args => runSearchConfiguration(args),
        },
    });

    // The real Configuration function this dispatches to opens its own
    // DialogV2 too, so the mock has to route by dialog title/content
    // rather than a fixed call index.
    globalThis.foundry.applications.api.DialogV2.wait = async config => {
        if (config.window.title.startsWith("RadioArkadio")) {
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

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    assert.equal(existing.flags[MODULE_ID].config.dc, 30);
    // Fields not touched by this submission fell back to the existing config.
    assert.equal(existing.flags[MODULE_ID].config.subject, "Old Cache");
    assert.deepEqual(existing.flags[MODULE_ID].triggeredTokenUuids, ["Token.already-triggered"]);
});

function rosterDialogResponse({ elements = {}, interact }) {
    return {
        action: "cancel",
        elements: { "[data-ra-npc-list]": {}, "[data-ra-npc-add-selected]": {}, ...elements },
        interact,
    };
}

test("RegionAutomationMainMacros: double-clicking the last roster NPC removes it and deletes the npc-roster Behavior", async () => {
    const region = makeRegion();
    const npcToken = makeToken(makeActor({ name: "Goblin Scout", type: "npc" }));

    const rosterBehavior = makeBehavior({
        functionality: "npc-roster",
        config: { npcs: [{ uuid: npcToken.document.uuid, tokenId: npcToken.document.id, name: "Goblin Scout" }] },
        parent: region,
    });
    region.behaviors.push(rosterBehavior);

    setupWorld({ regions: [{ document: region }] });

    const { wait } = queueDialogResponses([
        rosterDialogResponse({
            interact: async elements => {
                const chip = elements["[data-ra-npc-list]"].querySelectorAll("[data-ra-chip]")[0];
                await chip.fire("dblclick");
            },
        }),
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(region.behaviors.length, 0);
});

test("RegionAutomationMainMacros: reopening the dialog seeds the roster list from the Region's existing npc-roster Behavior", async () => {
    const region = makeRegion();
    const npcToken = makeToken(makeActor({ name: "Goblin Scout", type: "npc" }));

    const rosterBehavior = makeBehavior({
        functionality: "npc-roster",
        config: { npcs: [{ uuid: npcToken.document.uuid, tokenId: npcToken.document.id, name: "Goblin Scout" }] },
        parent: region,
    });
    region.behaviors.push(rosterBehavior);

    setupWorld({ regions: [{ document: region }] });

    const { wait, elementsByCall } = queueDialogResponses([rosterDialogResponse({})]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    // The initial render seeded Zone B's list from the existing Behavior.
    assert.match(elementsByCall[0]["[data-ra-npc-list]"].innerHTML, /Goblin Scout/);
    assert.match(elementsByCall[0]["[data-ra-npc-list]"].innerHTML, new RegExp(npcToken.document.id));

    // The Behavior wasn't touched (no add/remove happened), just read.
    assert.equal(region.behaviors.length, 1);
    assert.deepEqual(region.behaviors[0], rosterBehavior);
});

async function clickAddSelected(elements) {
    await elements["[data-ra-npc-add-selected]"].fire("click");
}

test("RegionAutomationMainMacros: 'Add Selected Token(s)' adds every currently-controlled NPC token, skipping non-NPCs", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    const npcTokenA = makeToken(makeActor({ name: "Goblin A", type: "npc" }));
    const npcTokenB = makeToken(makeActor({ name: "Goblin B", type: "npc" }));
    const heroToken = makeToken(makeActor({ name: "Hero", type: "character" }));

    // canvas.tokens.controlled holds Token placeables (.document/.actor/.name),
    // exactly the shape makeToken() returns — selected on canvas before the
    // dialog was opened.
    globalThis.canvas.tokens.controlled = [npcTokenA, npcTokenB, heroToken];

    const { wait } = queueDialogResponses([
        rosterDialogResponse({
            interact: clickAddSelected,
        }),
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    const rosterBehavior = region.behaviors[0];
    const npcs = rosterBehavior.flags[MODULE_ID].config.npcs;
    assert.equal(npcs.length, 2);
    assert.deepEqual(npcs.map(npc => npc.name).sort(), ["Goblin A", "Goblin B"]);

    // The roster Behavior is a real, active automation now — not the
    // inert system.events: []/source: "" it started as.
    assert.deepEqual(rosterBehavior.system.events, ["tokenEnter"]);
    assert.match(rosterBehavior.system.source, /\.requestBehaviorExecution/);
});

test("RegionAutomationMainMacros: 'Add Selected Token(s)' captures the Token's own current name, not a stale name held by the canvas placeable (e.g. right after a rename or duplicate)", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    // The canvas placeable's own held .document.name is stale ("Azomi") —
    // e.g. because it was renamed to "Azomi-duplicate" moments ago and the
    // placeable's cached reference hasn't caught up. registerUuidDocument
    // registers what a fresh fromUuid() lookup would actually return.
    const npcToken = makeToken(makeActor({ name: "Azomi", type: "npc" }), { name: "Azomi" });
    registerUuidDocument(npcToken.document.uuid, { ...npcToken.document, name: "Azomi-duplicate" });

    globalThis.canvas.tokens.controlled = [npcToken];

    const { wait } = queueDialogResponses([
        rosterDialogResponse({
            interact: clickAddSelected,
        }),
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    const npcs = region.behaviors[0].flags[MODULE_ID].config.npcs;
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].name, "Azomi-duplicate");
});

test("RegionAutomationMainMacros: 'Add Selected Token(s)' with nothing selected warns and creates no Behavior", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.canvas.tokens.controlled = [];

    const { wait } = queueDialogResponses([
        rosterDialogResponse({
            interact: clickAddSelected,
        }),
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(region.behaviors.length, 0);
    assert.match(notifications.warn.find(m => /select one or more NPC tokens/.test(m)) ?? "", /select one or more NPC tokens/);
});

test("RegionAutomationMainMacros: 'Add Selected Token(s)' with only non-NPC tokens selected warns and creates no Behavior", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.canvas.tokens.controlled = [makeToken(makeActor({ name: "Hero", type: "character" }))];

    const { wait } = queueDialogResponses([
        rosterDialogResponse({
            interact: clickAddSelected,
        }),
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(region.behaviors.length, 0);
    assert.match(notifications.warn.find(m => /none of the selected tokens are NPCs/.test(m)) ?? "", /none of the selected tokens are NPCs/);
});
