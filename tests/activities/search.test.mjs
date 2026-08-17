import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeToken } from "../helpers/mock-foundry.mjs";
import { runSearch } from "../../scripts/world-macros/SearchFunctionMacros.js";

function searchingActor(overrides = {}) {
    const itemId = "item-search";
    return makeActor({
        name: "Searcher",
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "search", name: "Search" })],
        statistics: { perception: { label: "Perception", rank: 2 } },
        ...overrides,
    });
}

function installSeekAction({ outcome = "success", total = 18, naturalRoll = 14, modifier = 4 } = {}) {
    let lastCall = null;

    globalThis.game.pf2e.actions = {
        get: slug => {
            if (slug !== "seek") return null;
            return {
                use: async options => {
                    lastCall = options;
                    return [
                        {
                            actor: options.actors[0],
                            outcome,
                            roll: {
                                total,
                                formula: "1d20+4",
                                dice: [{ faces: 20, results: [{ result: naturalRoll, active: true }] }],
                                options: { totalModifier: modifier },
                            },
                        },
                    ];
                },
            };
        },
    };

    return () => lastCall;
}

function makeSearchBehavior(config = {}) {
    return makeBehavior({ functionality: "search", config: { subject: "Hidden Cache", dc: 20, targetType: "non-npc", ...config } });
}

test("Search: an actor not performing Search never rolls or whispers a chat message", async () => {
    const { chatMessages } = installBaseGlobals();
    installSeekAction();
    const actor = makeActor({ exploration: [] });
    const token = makeToken(actor);
    const behavior = makeSearchBehavior();

    await runSearch({ behavior, event: { name: "tokenEnter", data: { token } }, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 0);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("Search: a searching actor rolls native Seek with the configured DC and target-type roll options", async () => {
    const { chatMessages, journals } = installBaseGlobals();
    const getLastCall = installSeekAction({ outcome: "success", total: 18, naturalRoll: 14, modifier: 4 });
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeSearchBehavior({ dc: 18, targetType: "npc" });
    const region = { name: "Trap Hallway" };

    const result = await runSearch({ behavior, event: { name: "tokenEnter", data: { token } }, region, scene: {}, token, actor });

    assert.equal(result.ok, true);
    assert.equal(result.rolled, true);
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /Hidden Cache/);
    assert.match(chatMessages[0].content, /vs DC 18/);

    const call = getLastCall();
    assert.equal(call.difficultyClass, 18);
    assert.ok(call.rollOptions.includes("target:creature"));
    assert.ok(call.rollOptions.includes("pf2e-exploration-automation:search:npc"));

    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, [token.document.uuid]);

    // The same GM-whispered result was also duplicated into the GM-only log Journal.
    assert.equal(journals.length, 1);
    assert.match(journals[0].pages[0].name, /^Trap Hallway — Searcher — /);
    assert.ok(journals[0].pages[0].text.content.includes(chatMessages[0].content));
});

test("Search: a second tokenEnter for the same token does not roll again", async () => {
    const { chatMessages } = installBaseGlobals();
    installSeekAction();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeSearchBehavior();
    const event = { name: "tokenEnter", data: { token } };

    await runSearch({ behavior, event, region: {}, scene: {}, token, actor });
    await runSearch({ behavior, event, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 1);
});

test("Search: invalid configuration (missing DC) never registers or rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    installSeekAction();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { subject: "Trap", targetType: "non-npc" } });

    const result = await runSearch({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.reason, "invalid-configuration");
    assert.equal(chatMessages.length, 0);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("Search: a technical failure (native Seek action unavailable) rolls back registration so a retry can succeed later", async () => {
    const { chatMessages, notifications } = installBaseGlobals();
    globalThis.game.pf2e.actions = { get: () => null };
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeSearchBehavior();

    const result = await runSearch({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.ok, false);
    assert.equal(chatMessages.length, 0);
    // The bug this regression-tests: rollback must actually clear the
    // registration (it previously silently no-opped because it read
    // token.uuid instead of token.document.uuid), otherwise the token
    // stays "already triggered" forever even after Seek becomes available.
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
    assert.ok(notifications.error.some(message => /could not complete/.test(message)));

    // Retrying after the underlying problem is fixed should now succeed.
    installSeekAction();
    const retry = await runSearch({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(retry.rolled, true);
    assert.equal(chatMessages.length, 1);
});
