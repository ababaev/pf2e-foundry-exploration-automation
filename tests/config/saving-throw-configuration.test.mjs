import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeBehavior, makeRegion, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { queueDialogResponses } from "../helpers/fake-dialog.mjs";
import { runSavingThrowConfiguration } from "../../scripts/world-macros/SavingThrowConfigurationMacros.js";

function setupWorld({ isGM = true } = {}) {
    const handles = installBaseGlobals({ isGM });
    globalThis.document = { createElement: () => ({ innerHTML: "" }) };
    return handles;
}

test("Saving Throw configuration: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runSavingThrowConfiguration({ region: makeRegion() });
    assert.match(notifications.error[0], /only a GM can add a Saving Throw automation/);
});

test("Saving Throw configuration: rejects when no Region is provided", async () => {
    const { notifications } = setupWorld();
    await runSavingThrowConfiguration({});
    assert.match(notifications.error[0], /Region is unavailable/);
});

test("Saving Throw configuration: editing an existing Behavior updates it in place, pre-filling unspecified fields", async () => {
    const region = makeRegion();
    const existing = makeBehavior({
        functionality: "saving-throw",
        config: { subject: "Old Trap", saveType: "will", dc: 14, consequence: "old consequence" },
        triggeredTokenUuids: ["Token.already-triggered"],
        parent: region,
    });
    setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ fields: { dc: "19" } }]).wait;

    await runSavingThrowConfiguration({ existingBehavior: existing });

    assert.equal(region.behaviors.length, 0);
    assert.equal(existing.name, "[RA-save] Old Trap");
    assert.deepEqual(existing.flags[MODULE_ID].config, {
        subject: "Old Trap",
        saveType: "will",
        dc: 19,
        consequence: "old consequence",
    });
    assert.deepEqual(existing.flags[MODULE_ID].triggeredTokenUuids, ["Token.already-triggered"]);
});

test("Saving Throw configuration: rejects a non-GM user trying to edit", async () => {
    const region = makeRegion();
    const existing = makeBehavior({ functionality: "saving-throw", config: { subject: "X", saveType: "will", dc: 10 }, parent: region });
    const { notifications } = setupWorld({ isGM: false });

    await runSavingThrowConfiguration({ region, existingBehavior: existing });

    assert.match(notifications.error[0], /only a GM can edit a Saving Throw automation/);
});

test("Saving Throw configuration: valid submission creates a RegionBehavior with schemaVersion 1", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Spike Trap", saveType: "reflex", dc: "18", consequence: "1d6 piercing damage" } },
    ]).wait;

    await runSavingThrowConfiguration({ region });

    assert.equal(region.behaviors.length, 1);
    const behavior = region.behaviors[0];

    assert.equal(behavior.name, "[RA-save] Spike Trap");
    assert.match(behavior.system.source, /\.requestBehaviorExecution/);

    const moduleData = behavior.flags[MODULE_ID];
    assert.equal(moduleData.schemaVersion, 1);
    assert.equal(moduleData.functionality, "saving-throw");
    assert.deepEqual(moduleData.config, {
        subject: "Spike Trap",
        saveType: "reflex",
        dc: 18,
        consequence: "1d6 piercing damage",
    });
    assert.equal(notifications.error.length, 0);
});

test("Saving Throw configuration: empty subject is rejected and re-prompts", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "", saveType: "reflex", dc: "20", consequence: "" } },
        { fields: { subject: "Retry", saveType: "reflex", dc: "20", consequence: "" } },
    ]).wait;

    await runSavingThrowConfiguration({ region });

    assert.match(notifications.warn.find(m => /subject cannot be empty/.test(m)) ?? "", /Saving Throw subject cannot be empty/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].name, "[RA-save] Retry");
});

test("Saving Throw configuration: invalid saveType is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Trap", saveType: "perception", dc: "20", consequence: "" } },
        { fields: { subject: "Trap", saveType: "will", dc: "20", consequence: "" } },
    ]).wait;

    await runSavingThrowConfiguration({ region });

    assert.match(notifications.warn.find(m => /Fortitude, Reflex, or Will/.test(m)) ?? "", /choose Fortitude, Reflex, or Will/);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.saveType, "will");
});

test("Saving Throw configuration: out-of-range DC is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Trap", saveType: "fortitude", dc: "-5", consequence: "" } },
        { fields: { subject: "Trap", saveType: "fortitude", dc: "15", consequence: "" } },
    ]).wait;

    await runSavingThrowConfiguration({ region });

    assert.match(notifications.warn.find(m => /DC must be a whole number/.test(m)) ?? "", /whole number from 0 to 100/);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.dc, 15);
});

test("Saving Throw configuration: canceling creates no Behavior", async () => {
    const region = makeRegion();
    setupWorld();
    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ action: "cancel" }]).wait;
    await runSavingThrowConfiguration({ region });
    assert.equal(region.behaviors.length, 0);
});

test("Saving Throw configuration: dropping a document onto GM Notes inserts an @UUID reference", async () => {
    const region = makeRegion();
    setupWorld();
    globalThis.__uuidDocuments["JournalEntry.hazardNotes"] = { name: "Hazard Writeup" };

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Trap", saveType: "fortitude", dc: "15", consequence: "" },
            elements: { '[name="consequence"]': {} },
            interact: async elements => {
                const consequence = elements['[name="consequence"]'];
                await consequence.fire("drop", {
                    preventDefault() {},
                    dataTransfer: { getData: () => JSON.stringify({ type: "JournalEntry", uuid: "JournalEntry.hazardNotes" }) },
                });
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runSavingThrowConfiguration({ region });

    assert.equal(
        region.behaviors[0].flags[MODULE_ID].config.consequence,
        "@UUID[JournalEntry.hazardNotes]{Hazard Writeup}",
    );
});
