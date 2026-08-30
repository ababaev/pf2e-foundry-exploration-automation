import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeBehavior, makeRegion, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { queueDialogResponses } from "../helpers/fake-dialog.mjs";
import { runDetectMagicConfiguration } from "../../scripts/world-macros/DetectMagicConfigurationMacros.js";

function setupWorld({ isGM = true } = {}) {
    const handles = installBaseGlobals({ isGM });
    globalThis.document = { createElement: () => ({ innerHTML: "" }) };
    return handles;
}

test("Detect Magic configuration: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runDetectMagicConfiguration({ region: makeRegion() });
    assert.match(notifications.error[0], /only a GM can add a Detect Magic automation/);
});

test("Detect Magic configuration: rejects when no Region is provided", async () => {
    const { notifications } = setupWorld();
    await runDetectMagicConfiguration({});
    assert.match(notifications.error[0], /Region is unavailable/);
});

test("Detect Magic configuration: editing an existing Behavior pre-fills its current subject/detection/DC/skills and updates in place", async () => {
    const region = makeRegion();
    const existing = makeBehavior({
        functionality: "detect-magic",
        config: { subject: "Old Aura", detection: "Old detection", baseDC: 17, skills: { hard: ["occultism"] } },
        triggeredTokenUuids: ["Token.already-triggered"],
        parent: region,
    });
    setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ fields: { subject: "Renamed Aura" } }]).wait;

    await runDetectMagicConfiguration({ existingBehavior: existing });

    assert.equal(region.behaviors.length, 0);
    assert.equal(existing.name, "[RA-detect-magic] Renamed Aura");
    assert.equal(existing.flags[MODULE_ID].config.subject, "Renamed Aura");
    assert.equal(existing.flags[MODULE_ID].config.detection, "Old detection");
    assert.equal(existing.flags[MODULE_ID].config.baseDC, 17);
    assert.deepEqual(existing.flags[MODULE_ID].config.skills.hard, ["occultism"]);
    assert.deepEqual(existing.flags[MODULE_ID].triggeredTokenUuids, ["Token.already-triggered"]);
});

test("Detect Magic configuration: rejects a non-GM user trying to edit", async () => {
    const region = makeRegion();
    const existing = makeBehavior({
        functionality: "detect-magic",
        config: { subject: "X", detection: "Y", baseDC: 20, skills: {} },
        parent: region,
    });
    const { notifications } = setupWorld({ isGM: false });

    await runDetectMagicConfiguration({ existingBehavior: existing });

    assert.match(notifications.error[0], /only a GM can edit a Detect Magic automation/);
});

test("Detect Magic configuration: valid submission keeps the default skill column (arcana/nature/occultism/religion under normal)", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        {
            fields: {
                subject: "Aura",
                detection: "A faint aura of necromancy",
                hint: "Check the altar",
                baseDC: "19",
            },
        },
    ]).wait;

    await runDetectMagicConfiguration({ region });

    assert.equal(region.behaviors.length, 1);
    const behavior = region.behaviors[0];

    assert.equal(behavior.name, "[RA-detect-magic] Aura");
    assert.match(behavior.system.source, /\.requestBehaviorExecution/);

    const moduleData = behavior.flags[MODULE_ID];
    assert.equal(moduleData.schemaVersion, 2);
    assert.equal(moduleData.functionality, "detect-magic");
    assert.equal(moduleData.config.subject, "Aura");
    assert.equal(moduleData.config.detection, "A faint aura of necromancy");
    assert.equal(moduleData.config.baseDC, 19);
    assert.deepEqual(moduleData.config.skills.normal.sort(), ["arcana", "nature", "occultism", "religion"]);
    assert.equal(notifications.error.length, 0);
});

test("Detect Magic configuration: the Add / Move picker moves a skill into the chosen difficulty column", async () => {
    const region = makeRegion();
    setupWorld();

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Aura", detection: "Something's off", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "religion" },
                "[data-ra-difficulty-picker]": { value: "easy" },
                "[data-ra-add-skill]": {},
            },
            interact: async elements => {
                await elements["[data-ra-add-skill]"].fire("click");
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runDetectMagicConfiguration({ region });

    const config = region.behaviors[0].flags[MODULE_ID].config;
    // "religion" moves out of its default "normal" column into "easy".
    assert.deepEqual(config.skills.easy, ["religion"]);
    assert.equal(config.skills.normal.includes("religion"), false);
});

test("Detect Magic configuration: the Add / Move picker warns and ignores an invalid skill/difficulty pair", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Aura", detection: "Something's off", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "religion" },
                "[data-ra-difficulty-picker]": { value: "not-a-difficulty" },
                "[data-ra-add-skill]": {},
            },
            interact: async elements => {
                await elements["[data-ra-add-skill]"].fire("click");
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runDetectMagicConfiguration({ region });

    assert.match(notifications.warn.find(m => /valid skill and difficulty/.test(m)) ?? "", /choose a valid skill and difficulty/);
    // Untouched: religion is still in its default "normal" column.
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.skills.normal.includes("religion"), true);
});

test("Detect Magic configuration: empty subject is rejected and re-prompts", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "", detection: "Something", hint: "", baseDC: "20" } },
        { fields: { subject: "Retry", detection: "Something", hint: "", baseDC: "20" } },
    ]).wait;

    await runDetectMagicConfiguration({ region });

    assert.match(notifications.warn.find(m => /subject cannot be empty/.test(m)) ?? "", /Detect Magic subject cannot be empty/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].name, "[RA-detect-magic] Retry");
});

test("Detect Magic configuration: empty detection description is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Aura", detection: "  ", hint: "", baseDC: "20" } },
        { fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "20" } },
    ]).wait;

    await runDetectMagicConfiguration({ region });

    assert.match(
        notifications.warn.find(m => /detection description cannot be empty/.test(m)) ?? "",
        /detection description cannot be empty/,
    );
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.detection, "It glows");
});

test("Detect Magic configuration: out-of-range base DC is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "-1" } },
        { fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "20" } },
    ]).wait;

    await runDetectMagicConfiguration({ region });

    assert.match(notifications.warn.find(m => /Base DC must be a whole number/.test(m)) ?? "", /whole number from 0 to 100/);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.baseDC, 20);
});

test("Detect Magic configuration: removing every default skill is rejected as 'no identification skill configured'", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld();

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "20" },
            elements: { '[data-chip-list="normal"]': {} },
            interact: async elements => {
                const chips = elements['[data-chip-list="normal"]'].querySelectorAll("[data-ra-chip]");
                for (const chip of [...chips]) {
                    // eslint-disable-next-line no-await-in-loop
                    await chip.fire("dblclick");
                }
            },
        },
        {
            fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "occultism" },
                "[data-ra-difficulty-picker]": { value: "normal" },
                "[data-ra-add-skill]": {},
            },
            interact: async elements => {
                await elements["[data-ra-add-skill]"].fire("click");
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runDetectMagicConfiguration({ region });

    assert.match(
        notifications.warn.find(m => /configure at least one identification skill/.test(m)) ?? "",
        /configure at least one identification skill/,
    );
    assert.equal(region.behaviors.length, 1);
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills.normal, ["occultism"]);
});

test("Detect Magic configuration: canceling creates no Behavior", async () => {
    const region = makeRegion();
    setupWorld();
    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ action: "cancel" }]).wait;
    await runDetectMagicConfiguration({ region });
    assert.equal(region.behaviors.length, 0);
});

test("Detect Magic configuration: dropping a document onto the detection field inserts an @UUID reference", async () => {
    const region = makeRegion();
    setupWorld();
    globalThis.__uuidDocuments["Item.relic"] = { name: "Cursed Relic" };

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Aura", detection: "", hint: "", baseDC: "20" },
            elements: { '[name="detection"]': {} },
            interact: async elements => {
                await elements['[name="detection"]'].fire("drop", {
                    preventDefault() {},
                    dataTransfer: { getData: () => JSON.stringify({ type: "Item", uuid: "Item.relic" }) },
                });
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runDetectMagicConfiguration({ region });

    assert.equal(region.behaviors[0].flags[MODULE_ID].config.detection, "@UUID[Item.relic]{Cursed Relic}");
});
