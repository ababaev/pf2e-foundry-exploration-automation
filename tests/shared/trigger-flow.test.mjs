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
