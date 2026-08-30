import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, MODULE_ID } from "./helpers/mock-foundry.mjs";
import { syncWorldMacros } from "../scripts/macro-sync.js";

const MANAGED_NAMES = [
    "RegionAutomationMainMacros",
    "UnregisterRegionMacros",
    "TriggerRegionForPartyMacros",
];

function installMacroWorld() {
    const macros = [];
    let folder = null;

    globalThis.Macro = {
        create: async data => {
            const macro = { ...data, id: `macro-${macros.length}`, folder: { id: data.folder } };
            macro.update = async changes => {
                if (Object.hasOwn(changes, "command")) macro.command = changes.command;
                if (Object.hasOwn(changes, "img")) macro.img = changes.img;
                if (Object.hasOwn(changes, "folder")) macro.folder = { id: changes.folder };
            };
            macro.delete = async () => {
                const index = macros.indexOf(macro);
                if (index !== -1) macros.splice(index, 1);
            };
            macros.push(macro);
            return macro;
        },
    };

    globalThis.Folder = {
        create: async data => {
            folder = { ...data, id: "folder-0" };
            return folder;
        },
    };

    globalThis.game.macros = {
        find: predicate => macros.find(predicate),
        filter: predicate => macros.filter(predicate),
    };

    globalThis.game.folders = {
        find: predicate => (folder && predicate(folder) ? folder : undefined),
    };

    return { macros, getFolder: () => folder };
}

/** Serves a fixed body for every managed file, or a per-name override. */
function installFetch(overrides = {}) {
    globalThis.fetch = async url => {
        const matchedName = Object.keys(overrides).find(name => url.href.includes(name));

        if (matchedName && overrides[matchedName] === null) {
            return { ok: false, status: 404 };
        }

        const body = matchedName ? overrides[matchedName] : `// source for ${url.href}`;
        return { ok: true, async text() { return body; } };
    };
}

test("syncWorldMacros: requires a GM", async () => {
    installBaseGlobals({ isGM: false });
    installMacroWorld();
    installFetch();

    const summary = await syncWorldMacros();
    assert.equal(summary.ok, false);
    assert.equal(summary.reason, "gm-required");
});

test("syncWorldMacros: creates every managed macro, filed under the shared folder, flagged as managed", async () => {
    installBaseGlobals();
    const { macros, getFolder } = installMacroWorld();
    installFetch();

    const summary = await syncWorldMacros();

    assert.equal(summary.ok, true);
    assert.equal(summary.created, MANAGED_NAMES.length);
    assert.equal(summary.updated, 0);
    assert.equal(summary.unchanged, 0);
    assert.equal(macros.length, MANAGED_NAMES.length);
    assert.deepEqual(macros.map(m => m.name).sort(), [...MANAGED_NAMES].sort());

    const folder = getFolder();
    for (const macro of macros) {
        assert.equal(macro.folder.id, folder.id);
        assert.equal(macro.flags[MODULE_ID].managed, true);
        assert.equal(macro.ownership.default, globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    }
});

test("syncWorldMacros: a second sync with unchanged sources touches nothing", async () => {
    installBaseGlobals();
    installMacroWorld();
    installFetch();

    await syncWorldMacros();
    const second = await syncWorldMacros();

    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, MANAGED_NAMES.length);
});

test("syncWorldMacros: a changed source file is synced as an update, not a duplicate create", async () => {
    installBaseGlobals();
    const { macros } = installMacroWorld();
    installFetch();

    await syncWorldMacros();

    installFetch({ TriggerRegionForPartyMacros: "// updated TriggerRegionForParty source" });
    const summary = await syncWorldMacros();

    assert.equal(summary.updated, 1);
    assert.equal(summary.created, 0);
    assert.equal(macros.length, MANAGED_NAMES.length);
    const trigger = macros.find(m => m.name === "TriggerRegionForPartyMacros");
    assert.equal(trigger.command, "// updated TriggerRegionForParty source");
});

test("syncWorldMacros: prunes a macro it previously managed that's no longer in the table", async () => {
    installBaseGlobals();
    const { macros } = installMacroWorld();
    installFetch();

    // Simulate a leftover from an older MANAGED_MACROS table (e.g. the old
    // SavingThrowFunctionMacros entry, orphaned once Saving Throw was ported).
    macros.push({
        id: "macro-orphan",
        name: "SavingThrowFunctionMacros",
        type: "script",
        flags: { [MODULE_ID]: { managed: true } },
        async delete() {
            const index = macros.indexOf(this);
            if (index !== -1) macros.splice(index, 1);
        },
    });

    const summary = await syncWorldMacros();

    assert.equal(summary.pruned, 1);
    assert.equal(macros.some(m => m.name === "SavingThrowFunctionMacros"), false);
});

test("syncWorldMacros: never touches a macro that isn't flagged as managed, even with a name outside the table", async () => {
    installBaseGlobals();
    const { macros } = installMacroWorld();
    installFetch();

    const handCreated = { id: "macro-hand", name: "My Own Utility Macro", type: "script", flags: {} };
    macros.push(handCreated);

    const summary = await syncWorldMacros();

    assert.equal(summary.pruned, 0);
    assert.ok(macros.includes(handCreated));
});

test("syncWorldMacros: a fetch failure for one entry is reported without blocking the rest", async () => {
    installBaseGlobals();
    const { macros } = installMacroWorld();
    installFetch({ UnregisterRegionMacros: null });

    const summary = await syncWorldMacros();

    assert.equal(summary.ok, false);
    assert.equal(summary.failed, 1);
    assert.equal(summary.created, MANAGED_NAMES.length - 1);
    assert.equal(macros.some(m => m.name === "UnregisterRegionMacros"), false);
});

test("syncWorldMacros: notify:true reports a GM-facing summary via ui.notifications", async () => {
    const { notifications } = installBaseGlobals();
    installMacroWorld();
    installFetch();

    await syncWorldMacros({ notify: true });

    assert.match(notifications.info[0], new RegExp(`${MANAGED_NAMES.length} created`));
});
