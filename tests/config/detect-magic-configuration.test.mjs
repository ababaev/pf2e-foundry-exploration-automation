import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeRegion, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { queueDialogResponses } from "../helpers/fake-dialog.mjs";
import { runPastedMacro } from "../helpers/run-macro.mjs";

const MACRO_URL = new URL("../../scripts/world-macros/DetectMagicConfigurationMacros.js", import.meta.url);

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

test("Detect Magic configuration: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runMacro();
    assert.match(notifications.error[0], /only a GM can add a Detect Magic automation/);
});

test("Detect Magic configuration: rejects when there is no active Scene", async () => {
    const { notifications } = setupWorld({ hasScene: false });
    await runMacro();
    assert.match(notifications.error[0], /there is no active Scene/);
});

test("Detect Magic configuration: rejects when zero Regions are selected", async () => {
    const { notifications } = setupWorld({ regions: [] });
    await runMacro();
    assert.match(notifications.warn[0], /select exactly one Region/);
});

test("Detect Magic configuration: valid submission keeps the default skill column (arcana/nature/occultism/religion under normal)", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

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

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    const behavior = region.behaviors[0];

    assert.equal(behavior.name, "[RA-detect-magic] Aura");
    assert.match(behavior.system.source, /moduleApi\.requestBehaviorExecution/);

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
    setupWorld({ regions: [{ document: region }] });

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

    await runMacro();

    const config = region.behaviors[0].flags[MODULE_ID].config;
    // "religion" moves out of its default "normal" column into "easy".
    assert.deepEqual(config.skills.easy, ["religion"]);
    assert.equal(config.skills.normal.includes("religion"), false);
});

test("Detect Magic configuration: the Add / Move picker warns and ignores an invalid skill/difficulty pair", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

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

    await runMacro();

    assert.match(notifications.warn.find(m => /valid skill and difficulty/.test(m)) ?? "", /choose a valid skill and difficulty/);
    // Untouched: religion is still in its default "normal" column.
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.skills.normal.includes("religion"), true);
});

test("Detect Magic configuration: empty subject is rejected and re-prompts", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "", detection: "Something", hint: "", baseDC: "20" } },
        { fields: { subject: "Retry", detection: "Something", hint: "", baseDC: "20" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /subject cannot be empty/.test(m)) ?? "", /Detect Magic subject cannot be empty/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].name, "[RA-detect-magic] Retry");
});

test("Detect Magic configuration: empty detection description is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Aura", detection: "  ", hint: "", baseDC: "20" } },
        { fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "20" } },
    ]).wait;

    await runMacro();

    assert.match(
        notifications.warn.find(m => /detection description cannot be empty/.test(m)) ?? "",
        /detection description cannot be empty/,
    );
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.detection, "It glows");
});

test("Detect Magic configuration: out-of-range base DC is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "-1" } },
        { fields: { subject: "Aura", detection: "It glows", hint: "", baseDC: "20" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /Base DC must be a whole number/.test(m)) ?? "", /whole number from 0 to 100/);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.baseDC, 20);
});

test("Detect Magic configuration: removing every default skill is rejected as 'no identification skill configured'", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

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

    await runMacro();

    assert.match(
        notifications.warn.find(m => /configure at least one identification skill/.test(m)) ?? "",
        /configure at least one identification skill/,
    );
    assert.equal(region.behaviors.length, 1);
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills.normal, ["occultism"]);
});

test("Detect Magic configuration: canceling creates no Behavior", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });
    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ action: "cancel" }]).wait;
    await runMacro();
    assert.equal(region.behaviors.length, 0);
});

test("Detect Magic configuration: dropping a document onto the detection field inserts an @UUID reference", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });
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

    await runMacro();

    assert.equal(region.behaviors[0].flags[MODULE_ID].config.detection, "@UUID[Item.relic]{Cursed Relic}");
});
