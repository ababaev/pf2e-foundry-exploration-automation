import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeToken } from "../helpers/mock-foundry.mjs";
import { runTriggeredCheck } from "../../scripts/world-macros/shared/trigger-flow.js";

function searchingActor() {
    const itemId = "item-search";
    return makeActor({
        name: "Searcher",
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "search", name: "Search" })],
    });
}

function idleActor() {
    return makeActor({ name: "Idler", exploration: [] });
}

function actorPerforming(...slugs) {
    const items = slugs.map(slug => makeExplorationItem({ id: `item-${slug}`, slug, name: slug }));
    return makeActor({ name: "Adventurer", exploration: items.map(item => item.id), items });
}

function baseArgs(overrides = {}) {
    const actor = overrides.actor ?? searchingActor();
    const token = overrides.token ?? makeToken(actor);
    const behavior = overrides.behavior ?? makeBehavior({ functionality: "search", config: { dc: 15 } });

    return {
        label: "Search",
        activity: "search",
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: { uuid: "Region.mock" },
        scene: { uuid: "Scene.mock" },
        validateConfig: () => ({ ok: true }),
        runRoll: async () => ({ ok: true, reason: "rolled" }),
        ...overrides,
    };
}

test("runTriggeredCheck: ignores events other than tokenEnter", async () => {
    installBaseGlobals();
    const result = await runTriggeredCheck(baseArgs({ event: { name: "tokenMove" } }));
    assert.deepEqual(result, { ok: true, rolled: false, reason: "ignored-event" });
});

test("runTriggeredCheck: reports incomplete context without throwing", async () => {
    installBaseGlobals();
    const result = await runTriggeredCheck(baseArgs({ behavior: null }));
    assert.equal(result.ok, false);
    assert.equal(result.rolled, false);
    assert.equal(result.reason, "incomplete-context");
});

test("runTriggeredCheck: rejects a Behavior whose functionality flag doesn't match activity", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "investigate", config: {} });
    const result = await runTriggeredCheck(baseArgs({ behavior }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "wrong-functionality-flag");
});

test("runTriggeredCheck: rejects invalid configuration before touching registration", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "search", config: {} });
    const result = await runTriggeredCheck(baseArgs({ behavior, validateConfig: () => ({ ok: false }) }));
    assert.equal(result.reason, "invalid-configuration");
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("runTriggeredCheck: gates on the exploration activity by default, and never registers a non-matching actor", async () => {
    installBaseGlobals();
    const actor = idleActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    let rollCalled = false;
    const result = await runTriggeredCheck(baseArgs({ actor, token, behavior, runRoll: async () => { rollCalled = true; return { ok: true }; } }));

    assert.deepEqual(result, { ok: true, rolled: false, reason: "not-performing-activity" });
    assert.equal(rollCalled, false);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("runTriggeredCheck: requireExplorationActivity:false skips the gate entirely (Saving Throw semantics)", async () => {
    installBaseGlobals();
    const actor = idleActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "saving-throw", config: {} });

    let rollCalled = false;
    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            activity: "saving-throw",
            requireExplorationActivity: false,
            runRoll: async () => { rollCalled = true; return { ok: true }; },
        }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.rolled, true);
    assert.equal(rollCalled, true);
});

test("runTriggeredCheck: explorationActivity lets the exploration-activity gate diverge from the functionality flag (npc-roster semantics)", async () => {
    installBaseGlobals();
    // Performing "search", not an exploration activity literally called
    // "npc-roster" (which doesn't exist).
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "npc-roster", config: { npcs: [] } });

    let rollCalled = false;
    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            activity: "npc-roster",
            explorationActivity: "search",
            runRoll: async () => { rollCalled = true; return { ok: true }; },
        }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.rolled, true);
    assert.equal(rollCalled, true);
});

test("runTriggeredCheck: explorationActivity defaults to activity, so an npc-roster Behavior still gates on an actor literally performing 'npc-roster' if explorationActivity is omitted", async () => {
    installBaseGlobals();
    // Performing "search" only -- with no explorationActivity override,
    // the gate falls back to checking "npc-roster" itself, which this
    // actor is not performing.
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "npc-roster", config: { npcs: [] } });

    let rollCalled = false;
    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            activity: "npc-roster",
            runRoll: async () => { rollCalled = true; return { ok: true }; },
        }),
    );

    assert.equal(result.reason, "not-performing-activity");
    assert.equal(rollCalled, false);
});

test("runTriggeredCheck: explorationActivity as an array gates on any candidate, not just the first", async () => {
    installBaseGlobals();
    const actor = actorPerforming("avoid-notice"); // not "search", the first candidate
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "npc-roster", config: { npcs: [] } });

    let capturedActivities = null;
    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            activity: "npc-roster",
            explorationActivity: ["search", "avoid-notice"],
            runRoll: async context => { capturedActivities = context.explorationActivities; return { ok: true }; },
        }),
    );

    assert.equal(result.rolled, true);
    assert.deepEqual(capturedActivities, ["avoid-notice"]);
});

test("runTriggeredCheck: explorationActivity as an array passes every matching candidate through, not just one, when the actor is performing more than one at once", async () => {
    installBaseGlobals();
    const actor = actorPerforming("search", "avoid-notice");
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "npc-roster", config: { npcs: [] } });

    let capturedActivities = null;
    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            activity: "npc-roster",
            explorationActivity: ["search", "avoid-notice"],
            runRoll: async context => { capturedActivities = context.explorationActivities; return { ok: true }; },
        }),
    );

    assert.equal(result.rolled, true);
    assert.deepEqual(capturedActivities, ["search", "avoid-notice"]);
});

test("runTriggeredCheck: explorationActivity as an array gates out when none of the candidates are active", async () => {
    installBaseGlobals();
    const actor = idleActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "npc-roster", config: { npcs: [] } });

    let rollCalled = false;
    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            activity: "npc-roster",
            explorationActivity: ["search", "avoid-notice"],
            runRoll: async () => { rollCalled = true; return { ok: true }; },
        }),
    );

    assert.equal(result.reason, "not-performing-activity");
    assert.equal(rollCalled, false);
});

test("runTriggeredCheck: registers the token exactly once and runs the roll", async () => {
    installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    const result = await runTriggeredCheck(baseArgs({ actor, token, behavior }));

    assert.equal(result.ok, true);
    assert.equal(result.rolled, true);
    assert.equal(result.reason, "completed");
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, [token.document.uuid]);
});

test("runTriggeredCheck: a successful roll duplicates its chat message into the GM log Journal", async () => {
    const { journals } = installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });
    const region = { uuid: "Region.mock", name: "Trap Hallway" };

    await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            region,
            runRoll: async () => ({ ok: true, message: { content: "<p>18 vs DC 15</p>" } }),
        }),
    );

    assert.equal(journals.length, 1);
    assert.equal(journals[0].pages.length, 1);
    assert.match(journals[0].pages[0].name, /^Trap Hallway — Searcher — /);
    assert.match(journals[0].pages[0].text.content, /<p>18 vs DC 15<\/p>/);
});

test("runTriggeredCheck: a roll with no chat message (e.g. a fake runRoll in another test) never logs to the Journal", async () => {
    const { journals } = installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    await runTriggeredCheck(baseArgs({ actor, token, behavior, runRoll: async () => ({ ok: true }) }));

    assert.equal(journals.length, 0);
});

test("runTriggeredCheck: a second run for the same token is a no-op ('already-triggered')", async () => {
    installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    await runTriggeredCheck(baseArgs({ actor, token, behavior }));

    let rollCalledAgain = false;
    const second = await runTriggeredCheck(
        baseArgs({ actor, token, behavior, runRoll: async () => { rollCalledAgain = true; return { ok: true }; } }),
    );

    assert.deepEqual(second, { ok: true, rolled: false, reason: "already-triggered" });
    assert.equal(rollCalledAgain, false);
    assert.equal(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids.length, 1);
});

test("runTriggeredCheck: skipRegistration never touches triggeredTokenUuids, and the same token can roll repeatedly", async () => {
    installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    let rollCount = 0;
    const runRoll = async () => {
        rollCount += 1;
        return { ok: true };
    };

    const first = await runTriggeredCheck(baseArgs({ actor, token, behavior, skipRegistration: true, runRoll }));
    const second = await runTriggeredCheck(baseArgs({ actor, token, behavior, skipRegistration: true, runRoll }));

    assert.equal(first.rolled, true);
    assert.equal(second.rolled, true);
    assert.equal(rollCount, 2);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("runTriggeredCheck: rolls back registration when the roll helper throws (skipRegistration:false)", async () => {
    installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    const result = await runTriggeredCheck(
        baseArgs({
            actor,
            token,
            behavior,
            runRoll: async () => {
                throw new Error("native Seek exploded");
            },
        }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "roll-helper-failed");
    // Rolled back: the token is no longer marked as triggered, so a real retry could succeed.
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("runTriggeredCheck: rolls back registration when the roll helper returns ok:false", async () => {
    installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    const result = await runTriggeredCheck(
        baseArgs({ actor, token, behavior, runRoll: async () => ({ ok: false, reason: "native-seek-action-not-found" }) }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "roll-unsuccessful");
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("runTriggeredCheck: a failed roll with skipRegistration:true does not attempt any rollback", async () => {
    installBaseGlobals();
    const actor = searchingActor();
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "search", config: { dc: 15 } });

    let updateCalls = 0;
    const originalUpdate = behavior.update.bind(behavior);
    behavior.update = async changes => {
        updateCalls += 1;
        return originalUpdate(changes);
    };

    const result = await runTriggeredCheck(
        baseArgs({ actor, token, behavior, skipRegistration: true, runRoll: async () => ({ ok: false, reason: "boom" }) }),
    );

    assert.equal(result.ok, false);
    assert.equal(updateCalls, 0);
});
