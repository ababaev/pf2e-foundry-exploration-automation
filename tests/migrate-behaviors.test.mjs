import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, MODULE_ID } from "./helpers/mock-foundry.mjs";
import { GENERIC_BEHAVIOR_SOURCE, migrateWorldBehaviors, normalizeBehaviorSource } from "../scripts/migrate-behaviors.js";

let nextId = 0;
function makeOldStyleBehavior({ functionality = "search", source = "await game.macros.getName(\"SearchFunctionMacros\")?.execute();" } = {}) {
    nextId += 1;
    const behavior = {
        id: `behavior-${nextId}`,
        uuid: `RegionBehavior.${nextId}`,
        system: { source },
        flags: { [MODULE_ID]: { functionality, config: {}, triggeredTokenUuids: [] } },
        async update(changes) {
            Object.assign(behavior.system, changes["system.source"] !== undefined ? { source: changes["system.source"] } : {});
        },
    };
    return behavior;
}

function makeRegionWithBehaviors(behaviors) {
    const region = {
        uuid: `Region.${++nextId}`,
        behaviors,
        async updateEmbeddedDocuments(documentType, updates) {
            for (const update of updates) {
                const target = behaviors.find(behavior => behavior.id === update._id);
                if (!target) continue;
                if (Object.hasOwn(update, "system.source")) target.system.source = update["system.source"];
            }
            return updates;
        },
    };
    return region;
}

test("normalizeBehaviorSource: a non-GM never updates a Behavior", async () => {
    installBaseGlobals({ isGM: false });
    const behavior = makeOldStyleBehavior();
    const changed = await normalizeBehaviorSource(behavior);
    assert.equal(changed, false);
    assert.notEqual(behavior.system.source, GENERIC_BEHAVIOR_SOURCE);
});

test("normalizeBehaviorSource: ignores a Behavior with an unsupported/missing functionality flag", async () => {
    installBaseGlobals();
    const behavior = makeOldStyleBehavior({ functionality: "" });
    const changed = await normalizeBehaviorSource(behavior);
    assert.equal(changed, false);
});

test("normalizeBehaviorSource: rewrites an old-style source to the generic dispatcher", async () => {
    installBaseGlobals();
    const behavior = makeOldStyleBehavior({ functionality: "search" });
    const changed = await normalizeBehaviorSource(behavior);
    assert.equal(changed, true);
    assert.equal(behavior.system.source, GENERIC_BEHAVIOR_SOURCE);
});

test("normalizeBehaviorSource: a Behavior already on the generic source is left alone (no update call)", async () => {
    installBaseGlobals();
    const behavior = makeOldStyleBehavior({ functionality: "search", source: GENERIC_BEHAVIOR_SOURCE });
    let updateCalls = 0;
    behavior.update = async () => { updateCalls += 1; };

    const changed = await normalizeBehaviorSource(behavior);
    assert.equal(changed, false);
    assert.equal(updateCalls, 0);
});

test("migrateWorldBehaviors: requires a GM", async () => {
    installBaseGlobals({ isGM: false });
    globalThis.game.scenes = [];
    const summary = await migrateWorldBehaviors();
    assert.equal(summary.ok, false);
    assert.equal(summary.reason, "gm-required");
});

test("migrateWorldBehaviors: scans every Scene/Region/Behavior and only migrates the ones that need it", async () => {
    installBaseGlobals();

    const alreadyMigrated = makeOldStyleBehavior({ functionality: "investigate", source: GENERIC_BEHAVIOR_SOURCE });
    const needsMigration = makeOldStyleBehavior({ functionality: "search" });
    const notOurs = makeOldStyleBehavior({ functionality: "" });

    const region = makeRegionWithBehaviors([alreadyMigrated, needsMigration, notOurs]);
    globalThis.game.scenes = [{ uuid: "Scene.1", regions: [region] }];

    const summary = await migrateWorldBehaviors();

    assert.equal(summary.ok, true);
    assert.equal(summary.scannedScenes, 1);
    assert.equal(summary.scannedRegions, 1);
    assert.equal(summary.scannedBehaviors, 3);
    assert.equal(summary.updatedBehaviors, 1);
    assert.equal(needsMigration.system.source, GENERIC_BEHAVIOR_SOURCE);
    assert.equal(notOurs.system.source, "await game.macros.getName(\"SearchFunctionMacros\")?.execute();");
});

test("migrateWorldBehaviors: a Region that fails to update is counted, without stopping the rest of the scan", async () => {
    const { notifications } = installBaseGlobals();

    const brokenRegion = makeRegionWithBehaviors([makeOldStyleBehavior({ functionality: "search" })]);
    brokenRegion.updateEmbeddedDocuments = async () => {
        throw new Error("Foundry rejected the update");
    };

    const workingRegion = makeRegionWithBehaviors([makeOldStyleBehavior({ functionality: "detect-magic" })]);

    globalThis.game.scenes = [{ uuid: "Scene.1", regions: [brokenRegion, workingRegion] }];

    const summary = await migrateWorldBehaviors({ notify: true });

    assert.equal(summary.failedRegions, 1);
    assert.equal(summary.updatedBehaviors, 1);
    assert.match(notifications.warn[0], /1 Region\(s\) failed/);
});

test("migrateWorldBehaviors: reports nothing to migrate cleanly", async () => {
    installBaseGlobals();
    globalThis.game.scenes = [];
    const summary = await migrateWorldBehaviors();
    assert.equal(summary.updatedBehaviors, 0);
    assert.equal(summary.failedRegions, 0);
});
