import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeToken, registerUuidDocument } from "../helpers/mock-foundry.mjs";
import { runNpcRoster } from "../../scripts/world-macros/NpcRosterFunctionMacros.js";

/**
 * A statistic that rolls through PF2e's Check API (`.roll({ extraRollOptions })`),
 * matching how NpcRosterSearchRollHelperMacros.js/NpcRosterAvoidNoticeRollHelperMacros.js
 * actually call it (same shape SavingThrowRollHelperMacros.js's tests use for
 * saveStatistic.roll()) — a raw new Roll("1d20") mock wouldn't exercise that call at all.
 */
function rollingStatistic({ label, total, naturalRoll, modifier = 8, onRoll, breakdown } = {}) {
    return {
        label,
        rank: 2,
        mod: modifier,
        async roll(args) {
            onRoll?.(args);
            return {
                total,
                dice: naturalRoll == null ? [] : [{ faces: 20, total: naturalRoll }],
                options: { totalModifier: modifier },
            };
        },
        // Mirrors the real PF2e Statistic#withRollOptions() shape enough for
        // the roll helpers' breakdown lookup (resolved.check.breakdown).
        withRollOptions: breakdown === undefined ? undefined : () => ({ check: { breakdown } }),
    };
}

function explorationActor({ activities = [], perception, stealth, items = [] } = {}) {
    const activityItems = activities.map(slug => makeExplorationItem({ id: `item-${slug}`, slug, name: slug }));

    return makeActor({
        name: "Adventurer",
        exploration: activityItems.map(item => item.id),
        items: [...activityItems, ...items],
        statistics: {
            perception: perception ?? rollingStatistic({ label: "Perception", total: 18, naturalRoll: 10 }),
            stealth: stealth ?? rollingStatistic({ label: "Stealth", total: 18, naturalRoll: 10 }),
        },
    });
}

function npcWithStealth(name, stealthMod) {
    const actor = makeActor({ name, type: "npc", statistics: { stealth: { label: "Stealth", rank: 1, mod: stealthMod } } });
    const token = makeToken(actor, { name });
    registerUuidDocument(token.document.uuid, token.document);
    return { uuid: token.document.uuid, tokenId: token.document.id, name };
}

function npcWithPerception(name, perceptionMod) {
    const actor = makeActor({ name, type: "npc", statistics: { perception: { label: "Perception", rank: 1, mod: perceptionMod } } });
    const token = makeToken(actor, { name });
    registerUuidDocument(token.document.uuid, token.document);
    return { uuid: token.document.uuid, tokenId: token.document.id, name };
}

function makeRosterBehavior(npcs) {
    return makeBehavior({ functionality: "npc-roster", config: { npcs } });
}

async function enter({ behavior, actor, token = makeToken(actor) }) {
    return runNpcRoster({ behavior, event: { name: "tokenEnter", data: { token } }, region: {}, scene: {}, token, actor });
}

// --- Gating: zero, one, or both directions, independently ---

test("NPC Roster: an actor performing neither Search nor Avoid Notice never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: [] });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.rolled, false);
    assert.equal(chatMessages.length, 0);
});

test("NPC Roster: performing only Search produces exactly one (Search) message", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["search"] });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.rolled, true);
    assert.deepEqual(Object.keys(result.result.entries), ["search"]);
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /NPC Roster Search/);
});

test("NPC Roster: performing only Avoid Notice produces exactly one (Avoid Notice) message", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["avoid-notice"] });
    const behavior = makeRosterBehavior([npcWithPerception("Goblin", 5)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.rolled, true);
    assert.deepEqual(Object.keys(result.result.entries), ["avoid-notice"]);
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /NPC Roster Avoid Notice/);
});

test("NPC Roster: performing both Search and Avoid Notice at once produces two messages from one shared registration", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["search", "avoid-notice"] });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.rolled, true);
    assert.deepEqual(Object.keys(result.result.entries), ["search", "avoid-notice"]);
    assert.equal(chatMessages.length, 2);
    assert.match(chatMessages[0].content, /NPC Roster Search/);
    assert.match(chatMessages[1].content, /NPC Roster Avoid Notice/);

    // One shared registration, not two — re-entering doesn't roll again for either direction.
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids.length, 1);
});

// --- Search direction (Perception vs. every NPC's Stealth) ---

test("NPC Roster Search: rolls Perception once and compares it against every roster NPC's own Stealth DC", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({
        activities: ["search"],
        perception: rollingStatistic({ label: "Perception", total: 23, naturalRoll: 15 }),
    });
    // Goblin: DC 10 + 5 = 15 -> 23 vs 15 is a success.
    // Assassin: DC 10 + 20 = 30 -> 23 vs 30 is a failure.
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5), npcWithStealth("Assassin", 20)]);

    const result = await enter({ behavior, actor });

    const search = result.result.entries.search;
    assert.equal(search.ok, true);
    assert.equal(search.naturalRoll, 15);
    assert.equal(search.total, 23);
    assert.equal(search.rows.length, 2);
    assert.equal(search.rows[0].dc, 15);
    assert.equal(search.rows[0].degree, "success");
    assert.equal(search.rows[1].dc, 30);
    assert.equal(search.rows[1].degree, "failure");
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /Goblin/);
    assert.match(chatMessages[0].content, /Assassin/);
});

test("NPC Roster Search: rolls through PF2e's Check API with the same NPC-Seek roll options native Search uses, so Keen Eyes/Sensate Gnome/Sharp-Eared Catfolk apply", async () => {
    installBaseGlobals();
    let capturedArgs = null;
    const actor = explorationActor({
        activities: ["search"],
        perception: rollingStatistic({ label: "Perception", total: 20, naturalRoll: 12, onRoll: args => { capturedArgs = args; } }),
    });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    await enter({ behavior, actor });

    assert.ok(capturedArgs, "perceptionStatistic.roll() was called");
    assert.ok(Array.isArray(capturedArgs.extraRollOptions));
    assert.ok(capturedArgs.extraRollOptions.includes("target:undetected"));
    assert.ok(capturedArgs.extraRollOptions.includes("action:seek"));
});

test("NPC Roster Search: notes when the searching character has Sense the Unseen", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({
        activities: ["search"],
        items: [makeExplorationItem({ id: "item-stu", slug: "sense-the-unseen", name: "Sense the Unseen" })],
    });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    await enter({ behavior, actor });

    assert.match(chatMessages[0].content, /Sense the Unseen/);
});

test("NPC Roster Search: says nothing about Sense the Unseen when the character doesn't have it", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["search"] });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    await enter({ behavior, actor });

    assert.doesNotMatch(chatMessages[0].content, /Sense the Unseen/);
});

test("NPC Roster Search: shows the modifier breakdown (Keen Eyes, Sensate Gnome, Sharp-Eared Catfolk, etc.) so the GM can see where the total comes from", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({
        activities: ["search"],
        perception: rollingStatistic({ label: "Perception", total: 25, naturalRoll: 15, breakdown: "Perception +8, Keen Eyes +2" }),
    });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.result.entries.search.breakdown, "Perception +8, Keen Eyes +2");
    assert.match(chatMessages[0].content, /Keen Eyes/);
});

test("NPC Roster Search: an unresolvable roster Token is reported in the table instead of silently dropped", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["search"] });
    // Not registered via registerUuidDocument, so fromUuid resolves nothing.
    const behavior = makeRosterBehavior([{ uuid: "Token.deleted", tokenId: "deleted", name: "Vanished Goblin" }]);

    const result = await enter({ behavior, actor });

    assert.equal(result.result.entries.search.ok, true);
    assert.equal(result.result.entries.search.rows[0].unavailable, true);
    assert.equal(result.result.entries.search.rows[0].dc, null);
    assert.match(chatMessages[0].content, /no longer available/);
});

// --- Avoid Notice direction (Stealth vs. every NPC's passive Perception) ---

test("NPC Roster Avoid Notice: rolls Stealth once and compares it against every roster NPC's own passive Perception DC", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({
        activities: ["avoid-notice"],
        stealth: rollingStatistic({ label: "Stealth", total: 18, naturalRoll: 12 }),
    });
    // Guard: DC 10 + 6 = 16 -> 18 vs 16 is a success (unnoticed).
    // Watcher: DC 10 + 12 = 22 -> 18 vs 22 is a failure (noticed).
    const behavior = makeRosterBehavior([npcWithPerception("Guard", 6), npcWithPerception("Watcher", 12)]);

    const result = await enter({ behavior, actor });

    const avoidNotice = result.result.entries["avoid-notice"];
    assert.equal(avoidNotice.ok, true);
    assert.equal(avoidNotice.naturalRoll, 12);
    assert.equal(avoidNotice.total, 18);
    assert.equal(avoidNotice.rows[0].dc, 16);
    assert.equal(avoidNotice.rows[0].degree, "success");
    assert.equal(avoidNotice.rows[1].dc, 22);
    assert.equal(avoidNotice.rows[1].degree, "failure");
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /Guard/);
    assert.match(chatMessages[0].content, /Watcher/);
});

test("NPC Roster Avoid Notice: rolls through PF2e's Check API with extraRollOptions, so roll-option-gated Stealth bonuses apply", async () => {
    installBaseGlobals();
    let capturedArgs = null;
    const actor = explorationActor({
        activities: ["avoid-notice"],
        stealth: rollingStatistic({ label: "Stealth", total: 15, naturalRoll: 9, onRoll: args => { capturedArgs = args; } }),
    });
    const behavior = makeRosterBehavior([npcWithPerception("Guard", 6)]);

    await enter({ behavior, actor });

    assert.ok(capturedArgs, "stealthStatistic.roll() was called");
    assert.ok(Array.isArray(capturedArgs.extraRollOptions));
    assert.ok(capturedArgs.extraRollOptions.includes("action:avoid-notice"));
});

test("NPC Roster Avoid Notice: shows the modifier breakdown so the GM can see where the total comes from", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({
        activities: ["avoid-notice"],
        stealth: rollingStatistic({ label: "Stealth", total: 20, naturalRoll: 12, breakdown: "Stealth +8" }),
    });
    const behavior = makeRosterBehavior([npcWithPerception("Guard", 6)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.result.entries["avoid-notice"].breakdown, "Stealth +8");
    assert.match(chatMessages[0].content, /Stealth \+8/);
});

test("NPC Roster Avoid Notice: an NPC with no Perception statistic is reported in the table instead of silently dropped", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["avoid-notice"] });
    const noPerceptionNpc = makeActor({ name: "Statue", type: "npc", statistics: {} });
    const noPerceptionToken = makeToken(noPerceptionNpc, { name: "Statue" });
    registerUuidDocument(noPerceptionToken.document.uuid, noPerceptionToken.document);
    const behavior = makeRosterBehavior([{ uuid: noPerceptionToken.document.uuid, tokenId: noPerceptionToken.document.id, name: "Statue" }]);

    const result = await enter({ behavior, actor });

    assert.equal(result.result.entries["avoid-notice"].rows[0].noStatistic, true);
    assert.match(chatMessages[0].content, /No Perception statistic/);
});

// --- Shared plumbing: empty roster, dedup, rollback ---

test("NPC Roster: an empty roster is invalid configuration and never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["search"] });
    const behavior = makeRosterBehavior([]);

    const result = await enter({ behavior, actor });

    assert.equal(result.reason, "invalid-configuration");
    assert.equal(chatMessages.length, 0);
});

test("NPC Roster: a second tokenEnter for the same token does not roll again", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = explorationActor({ activities: ["search"] });
    const token = makeToken(actor);
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);
    const event = { name: "tokenEnter", data: { token } };

    await runNpcRoster({ behavior, event, region: {}, scene: {}, token, actor });
    await runNpcRoster({ behavior, event, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 1);
});

test("NPC Roster: a roll-helper technical failure rolls back the shared registration", async () => {
    installBaseGlobals();
    // No perception statistic at all (not even a fallback actor.perception)
    // triggers "perception-statistic-not-found" in the Search roll helper.
    const itemId = "item-search";
    const actor = makeActor({
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "search", name: "Search" })],
        statistics: {},
    });
    const behavior = makeRosterBehavior([npcWithStealth("Goblin", 5)]);

    const result = await enter({ behavior, actor });

    assert.equal(result.ok, false);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});
