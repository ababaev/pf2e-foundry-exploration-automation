import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeRegion, MODULE_ID } from "../helpers/mock-foundry.mjs";
import { queueDialogResponses } from "../helpers/fake-dialog.mjs";
import { runPastedMacro } from "../helpers/run-macro.mjs";

const MACRO_URL = new URL("../../scripts/world-macros/InvestigateConfigurationMacros.js", import.meta.url);

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

test("Investigate configuration: rejects a non-GM user", async () => {
    const { notifications } = setupWorld({ isGM: false });
    await runMacro();
    assert.match(notifications.error[0], /only a GM can add an Investigation/);
});

test("Investigate configuration: rejects when there is no active Scene", async () => {
    const { notifications } = setupWorld({ hasScene: false });
    await runMacro();
    assert.match(notifications.error[0], /there is no active Scene/);
});

test("Investigate configuration: rejects when zero Regions are selected", async () => {
    const { notifications } = setupWorld({ regions: [] });
    await runMacro();
    assert.match(notifications.warn[0], /select exactly one Region/);
});

test("Investigate configuration: valid submission keeps the default skill columns (Specified/Unspecified Lore)", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Strange Runes", hint: "Occult in nature", baseDC: "22" } },
    ]).wait;

    await runMacro();

    assert.equal(region.behaviors.length, 1);
    const behavior = region.behaviors[0];

    assert.equal(behavior.name, "[RA-investigate] Strange Runes");
    assert.match(behavior.system.source, /moduleApi\.requestBehaviorExecution/);

    const moduleData = behavior.flags[MODULE_ID];
    assert.equal(moduleData.schemaVersion, 2);
    assert.equal(moduleData.functionality, "investigate");
    assert.equal(moduleData.config.subject, "Strange Runes");
    assert.equal(moduleData.config.baseDC, 22);
    assert.deepEqual(moduleData.config.skills["very-easy"], ["specified-lore"]);
    assert.deepEqual(moduleData.config.skills.easy, ["unspecified-lore"]);
    assert.equal(notifications.error.length, 0);
});

test("Investigate configuration: the Add / Move picker moves a skill into the chosen difficulty column", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Strange Runes", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "arcana" },
                "[data-ra-difficulty-picker]": { value: "hard" },
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
    assert.deepEqual(config.skills.hard, ["arcana"]);
});

test("Investigate configuration: Performance, Stealth, Survival, and Thievery are selectable skills", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Strange Runes", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "survival" },
                "[data-ra-difficulty-picker]": { value: "normal" },
                "[data-ra-add-skill]": {},
            },
            interact: async elements => {
                await elements["[data-ra-add-skill]"].fire("click");
                elements["[data-ra-skill-picker]"].value = "stealth";
                elements["[data-ra-difficulty-picker]"].value = "hard";
                await elements["[data-ra-add-skill]"].fire("click");
                elements["[data-ra-skill-picker]"].value = "thievery";
                elements["[data-ra-difficulty-picker]"].value = "hard";
                await elements["[data-ra-add-skill]"].fire("click");
                elements["[data-ra-skill-picker]"].value = "performance";
                elements["[data-ra-difficulty-picker]"].value = "easy";
                await elements["[data-ra-add-skill]"].fire("click");
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    const config = region.behaviors[0].flags[MODULE_ID].config;
    assert.deepEqual(config.skills.normal, ["survival"]);
    assert.deepEqual(config.skills.hard, ["stealth", "thievery"]);
    assert.deepEqual(config.skills.easy, ["unspecified-lore", "performance"]);
});

test("Investigate configuration: Add / Move only rewrites the difficulty column(s) that actually changed", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });

    let veryEasyRewriteCount = 0;

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Strange Runes", hint: "", baseDC: "20" },
            elements: {
                "[data-chip-list=\"very-easy\"]": {},
                "[data-chip-list=\"normal\"]": {},
                "[data-ra-skill-picker]": { value: "arcana" },
                "[data-ra-difficulty-picker]": { value: "normal" },
                "[data-ra-add-skill]": {},
            },
            interact: async elements => {
                // Count writes to the untouched "very-easy" column (which
                // already holds the default Specified Lore chip) by
                // wrapping its innerHTML setter.
                const veryEasy = elements['[data-chip-list="very-easy"]'];
                const descriptor = Object.getOwnPropertyDescriptor(veryEasy, "innerHTML");
                Object.defineProperty(veryEasy, "innerHTML", {
                    configurable: true,
                    get: descriptor.get,
                    set(html) {
                        veryEasyRewriteCount += 1;
                        descriptor.set.call(veryEasy, html);
                    },
                });

                // The initial render already wrote every column once
                // (including very-easy's default chip) before this
                // interact() ran; reset the counter to isolate what
                // Add/Move itself does.
                veryEasyRewriteCount = 0;

                await elements["[data-ra-add-skill]"].fire("click");
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(veryEasyRewriteCount, 0, "adding a skill to 'normal' must not rewrite the unrelated 'very-easy' column");
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills.normal, ["arcana"]);
});

test("Investigate configuration: the Add / Move picker warns and ignores an invalid skill/difficulty pair", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Strange Runes", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "not-a-skill" },
                "[data-ra-difficulty-picker]": { value: "hard" },
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
    // Defaults are untouched since the add was rejected.
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills.hard, []);
});

test("Investigate configuration: empty subject is rejected and re-prompts", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "  ", hint: "", baseDC: "20" } },
        { fields: { subject: "Retry", hint: "", baseDC: "20" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /subject cannot be empty/.test(m)) ?? "", /Investigation subject cannot be empty/);
    assert.equal(region.behaviors.length, 1);
    assert.equal(region.behaviors[0].name, "[RA-investigate] Retry");
});

test("Investigate configuration: out-of-range base DC is rejected", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([
        { fields: { subject: "Runes", hint: "", baseDC: "500" } },
        { fields: { subject: "Runes", hint: "", baseDC: "25" } },
    ]).wait;

    await runMacro();

    assert.match(notifications.warn.find(m => /Base DC must be a whole number/.test(m)) ?? "", /whole number from 0 to 100/);
    assert.equal(region.behaviors[0].flags[MODULE_ID].config.baseDC, 25);
});

test("Investigate configuration: removing every default skill (double-click each chip) is rejected as 'no skills configured'", async () => {
    const region = makeRegion();
    const { notifications } = setupWorld({ regions: [{ document: region }] });

    const { wait } = queueDialogResponses([
        {
            // Double-click the two default chips (Specified Lore under
            // very-easy, Unspecified Lore under easy) to remove them via
            // the real removeSkill/renderSkills handlers.
            fields: { subject: "Runes", hint: "", baseDC: "20" },
            elements: { '[data-chip-list="very-easy"]': {}, '[data-chip-list="easy"]': {} },
            interact: async elements => {
                const veryEasyChip = elements['[data-chip-list="very-easy"]'].querySelectorAll("[data-ra-chip]")[0];
                await veryEasyChip.fire("dblclick");

                const easyChip = elements['[data-chip-list="easy"]'].querySelectorAll("[data-ra-chip]")[0];
                await easyChip.fire("dblclick");
            },
        },
        {
            // Now zero skills are configured; add one back so the retry succeeds.
            fields: { subject: "Runes", hint: "", baseDC: "20" },
            elements: {
                "[data-ra-skill-picker]": { value: "arcana" },
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

    assert.match(notifications.warn.find(m => /configure at least one skill/.test(m)) ?? "", /configure at least one skill/);
    assert.equal(region.behaviors.length, 1);
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills.normal, ["arcana"]);
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills["very-easy"], []);
    assert.deepEqual(region.behaviors[0].flags[MODULE_ID].config.skills.easy, []);
});

test("Investigate configuration: canceling creates no Behavior", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });
    globalThis.foundry.applications.api.DialogV2.wait = queueDialogResponses([{ action: "cancel" }]).wait;
    await runMacro();
    assert.equal(region.behaviors.length, 0);
});

test("Investigate configuration: dropping a document onto the hint field inserts an @UUID reference", async () => {
    const region = makeRegion();
    setupWorld({ regions: [{ document: region }] });
    globalThis.__uuidDocuments["Actor.witness"] = { name: "Local Witness" };

    const { wait } = queueDialogResponses([
        {
            fields: { subject: "Runes", hint: "Ask ", baseDC: "20" },
            elements: { '[name="hint"]': {} },
            interact: async elements => {
                const hint = elements['[name="hint"]'];
                hint.selectionStart = hint.value.length;
                hint.selectionEnd = hint.value.length;
                await hint.fire("drop", {
                    preventDefault() {},
                    dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: "Actor.witness" }) },
                });
            },
        },
    ]);
    globalThis.foundry.applications.api.DialogV2.wait = wait;

    await runMacro();

    assert.equal(region.behaviors[0].flags[MODULE_ID].config.hint, "Ask @UUID[Actor.witness]{Local Witness}");
});
