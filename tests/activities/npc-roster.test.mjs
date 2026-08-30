import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeToken, registerUuidDocument } from "../helpers/mock-foundry.mjs";
import { runNpcRoster } from "../../scripts/world-macros/NpcRosterFunctionMacros.js";

function searchingActor(statistics = {}) {
    const itemId = "item-search";
    return makeActor({
        name: "Scout",
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "search", name: "Search" })],
        statistics: { perception: { label: "Perception", rank: 2, mod: 8 }, ...statistics },
    });
}

function npcWithStealth(name, stealthMod) {
    const actor = makeActor({ name, type: "npc", statistics: { stealth: { label: "Stealth", rank: 1, mod: stealthMod } } });
    const token = makeToken(actor, { name });
    registerUuidDocument(token.document.uuid, token.document);
    return { uuid: token.document.uuid, tokenId: token.document.id, name };
}

function makeRosterBehavior(npcs) {
    return makeBehavior({ functionality: "npc-roster", config: { npcs } });
}

test("NPC Roster Search: gates on the PF2e 'search' exploration activity, not an activity literally called 'npc-roster'", async () => {
    const { chatMessages } = installBaseGlobals();
    // No exploration items at all — not performing Search.
    const actor = makeActor({ exploration: [], statistics: { perception: { label: "Perception", rank: 2, mod: 8 } } });
    const token = makeToken(actor);
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await runNpcRoster({ behavior, event: { name: "tokenEnter", data: { token } }, region: {}, scene: {}, token, actor });

    assert.equal(result.rolled, false);
    assert.equal(chatMessages.length, 0);
});

test("NPC Roster Search: rolls Perception once and compares it against every roster NPC's own Stealth DC", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 15;
    const actor = searchingActor();
    const token = makeToken(actor);
    // total = 15 natural + 8 modifier = 23.
    // Goblin: DC 10 + 5 = 15 -> 23 vs 15 is a success.
    // Assassin: DC 10 + 20 = 30 -> 23 vs 30 is a failure.
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5), npcWithStealth("Assassin", 20)]);

    const result = await runNpcRoster({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.rolled, true);
    assert.equal(result.result.ok, true);
    assert.equal(result.result.naturalRoll, 15);
    assert.equal(result.result.total, 23);
    assert.equal(result.result.rows.length, 2);
    assert.equal(result.result.rows[0].dc, 15);
    assert.equal(result.result.rows[0].degree, "success");
    assert.equal(result.result.rows[1].dc, 30);
    assert.equal(result.result.rows[1].degree, "failure");
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /Goblin/);
    assert.match(chatMessages[0].content, /Assassin/);
});

test("NPC Roster Search: an unresolvable roster Token is reported in the table instead of silently dropped", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 10;
    const actor = searchingActor();
    const token = makeToken(actor);
    // Not registered via registerUuidDocument, so fromUuid resolves nothing.
    const behavior = makeRosterBehavior([{ uuid: "Token.deleted", tokenId: "deleted", name: "Vanished Goblin" }]);

    const result = await runNpcRoster({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.result.ok, true);
    assert.equal(result.result.rows[0].unavailable, true);
    assert.equal(result.result.rows[0].dc, null);
    assert.match(chatMessages[0].content, /no longer available/);
});

test("NPC Roster Search: an empty roster is invalid configuration and never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeRosterBehavior([]);

    const result = await runNpcRoster({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.reason, "invalid-configuration");
    assert.equal(chatMessages.length, 0);
});

test("NPC Roster Search: a second tokenEnter for the same token does not roll again", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 10;
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);
    const event = { name: "tokenEnter", data: { token } };

    await runNpcRoster({ behavior, event, region: {}, scene: {}, token, actor });
    await runNpcRoster({ behavior, event, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 1);
});

test("NPC Roster Search: a roll-helper technical failure rolls back registration", async () => {
    installBaseGlobals();
    // searchingActor() without a perception statistic triggers
    // "perception-statistic-not-found" in the roll helper.
    const itemId = "item-search";
    const actor = makeActor({
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "search", name: "Search" })],
        statistics: {},
    });
    actor.perception = null;
    const token = makeToken(actor);
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await runNpcRoster({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});
