import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeRegion, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { queueDialogResponses } from "../helpers/fake-dialog.mjs";
import { runPastedMacro } from "../helpers/run-macro.mjs";

const MACRO_URL = new URL("../../scripts/world-macros/SearchConfigurationMacros.js", import.meta.url);

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

test("Search configuration: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runMacro();
    assert.equal(notifications.error.length, 1);
    assert.match(notifications.error[0], /only a GM can add a Search automation/);
});

test("Search configuration: rejects when there is no active Scene", async () => {
    const { notifications } = setupWorld({ hasScene: false });
    await runMacro();
    assert.match(notifications.error[0], /there is no active Scene/);
});

test("Search configuration: rejects when zero Regions are selected", async () => {
    const { notifications } = setupWorld({ regions: [] });
    await runMacro();
    assert.match(notifications.warn[0], /select exactly one Region/);
});

test("Search configuration: rejects when more than one Region is selected", async () => {
    const { notifications } = setupWorld({
        regions: [{ document: makeRegion() }, { document: makeRegion() }],
    });
    await runMacro();
    assert.match(notifications.warn[0], /select exactly one Region/);
});

test("Search configuration: valid submission creates a RegionBehavior wired through the socket dispatcher", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Hidden Cache", hint: "Under the loose floorboard", dc: "18", targetType: "non-npc" } },
    ]).wait;

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    const behavior = region.behaviors[0];

    assert.equal(behavior.name, "[RA-search] Hidden Cache");
    assert.equal(behavior.type, "executeScript");
    assert.deepEqual(behavior.system.events, ["tokenEnter"]);
    assert.match(behavior.system.source, /moduleApi\.requestBehaviorExecution/);
    assert.equal(behavior.disabled, false);

    const moduleData = behavior.flags[MODULE_ID];
    assert.equal(moduleData.functionality, "search");
    assert.deepEqual(moduleData.triggeredTokenUuids, []);
    assert.deepEqual(moduleData.config, {
        subject: "Hidden Cache",
        hint: "Under the loose floorboard",
        dc: 18,
        targetType: "non-npc",
    });

    assert.equal(notifications.error.length, 0);
    assert.match(notifications.info[0], /created "\[RA-search\] Hidden Cache" in "Test Region"/);
});

test("Search configuration: empty subject is rejected and re-prompts instead of creating a Behavior", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "   ", hint: "", dc: "20", targetType: "non-npc" } },
        { fields: { subject: "Second Try", hint: "", dc: "20", targetType: "non-npc" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /subject cannot be empty/.test(m)) ?? "", /Search subject cannot be empty/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].name, "[RA-search] Second Try");
});

test("Search configuration: out-of-range DC is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Trap", hint: "", dc: "999", targetType: "non-npc" } },
        { fields: { subject: "Trap", hint: "", dc: "20", targetType: "non-npc" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /Perception DC/.test(m)) ?? "", /whole number from 0 to 100/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.dc, 20);
});

test("Search configuration: invalid targetType is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Trap", hint: "", dc: "20", targetType: "not-a-real-type" } },
        { fields: { subject: "Trap", hint: "", dc: "20", targetType: "npc" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /NPC \/ Creature/.test(m)) ?? "", /NPC \/ Creature or Item \/ Hazard/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.targetType, "npc");
});

test("Search configuration: canceling creates no Behavior", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ action: "cancel" }]).wait;

    await runMacro();

    assert.equal(region.behaviors.length, 0);
});

test("Search configuration: dropping a document onto the hint field inserts an @UUID reference", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });
    globalThis.__uuidDocuments["Actor.hazard1"] = { name: "Spike Trap" };

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Trap", hint: "See attached: ", dc: "20", targetType: "non-npc" },
            elements: { '[name="hint"]': {}, '[name="targetType"]': {}, "[data-ra-target-description]": {} },
            interact: async elements => {
                const hint = elements['[name="hint"]'];
                hint.selectionStart = hint.value.length;
                hint.selectionEnd = hint.value.length;
                await hint.fire("drop", {
                    preventDefault() {},
                    dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: "Actor.hazard1" }) },
                });
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.hint, 'See attached: @UUID[Actor.hazard1]{Spike Trap}');
});
