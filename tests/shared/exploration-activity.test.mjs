import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeExplorationItem, makeToken } from "../helpers/mock-foundry.mjs";
import { checkExplorationActivity } from "../../scripts/world-macros/ExplorationActivityMacros.js";

async function check(args) {
    const resultBox = { value: null };
    await checkExplorationActivity({ ...args, resultBox });
    return resultBox.value;
}

test("checkExplorationActivity: active when the actor has a matching exploration item", async () => {
    installBaseGlobals();
    const itemId = "item-1";
    const actor = makeActor({
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "search", name: "Search" })],
    });
    const token = makeToken(actor);

    const result = await check({ token, actor, activity: "search" });

    assert.equal(result.ok, true);
    assert.equal(result.active, true);
    assert.equal(result.item.id, itemId);
});

test("checkExplorationActivity: inactive when the actor has no matching exploration item", async () => {
    installBaseGlobals();
    const actor = makeActor({ exploration: [] });
    const token = makeToken(actor);

    const result = await check({ token, actor, activity: "search" });

    assert.equal(result.ok, true);
    assert.equal(result.active, false);
    assert.equal(result.item, null);
});

test("checkExplorationActivity: matches by item slug even when the name differs", async () => {
    installBaseGlobals();
    const itemId = "item-2";
    const actor = makeActor({
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "investigate", name: "Investigate (Custom Renamed Feat)" })],
    });

    const result = await check({ token: makeToken(actor), actor, activity: "investigate" });
    assert.equal(result.active, true);
});

test("checkExplorationActivity: matches by normalized name when no slug is set", async () => {
    installBaseGlobals();
    const itemId = "item-3";
    const actor = makeActor({
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: undefined, name: "Detect Magic" })],
    });

    const result = await check({ token: makeToken(actor), actor, activity: "detect-magic" });
    assert.equal(result.active, true);
});

test("checkExplorationActivity: ignores exploration item ids that no longer resolve to a real item", async () => {
    installBaseGlobals();
    const actor = makeActor({ exploration: ["missing-item-id"], items: [] });

    const result = await check({ token: makeToken(actor), actor, activity: "search" });

    assert.equal(result.ok, true);
    assert.equal(result.active, false);
    assert.deepEqual(result.missingItemIds, ["missing-item-id"]);
});

test("checkExplorationActivity: fails gracefully with no actor", async () => {
    installBaseGlobals();
    const result = await check({ token: null, actor: null, activity: "search" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-actor");
});
