import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeRegion, makeToken, registerUuidDocument } from "./helpers/mock-foundry.mjs";
import { executeBehaviorRequest } from "../scripts/executor.js";

function installSavingThrowFixture({ requesterUserId = "gm-1", requesterIsGM = true } = {}) {
    const actor = makeActor({ name: "Passerby", exploration: [] });
    actor.testUserPermission = () => true;
    actor.saves = {
        reflex: {
            label: "Reflex",
            rank: 1,
            async roll() {
                return { total: 15, degreeOfSuccess: 2, dice: [{ faces: 20, total: 10 }], options: { totalModifier: 5 } };
            },
        },
    };

    const region = makeRegion();
    const behavior = makeBehavior({
        functionality: "saving-throw",
        config: { subject: "Trap", saveType: "reflex", dc: 16, consequence: "" },
        parent: region,
    });
    const token = makeToken(actor);

    registerUuidDocument(behavior.uuid, behavior);
    registerUuidDocument(token.document.uuid, token.document);

    if (!globalThis.game.users.get(requesterUserId)) {
        globalThis.game.users.push({ id: requesterUserId, active: true, isGM: requesterIsGM });
    }

    return { actor, region, behavior, token };
}

let nextRequestId = 0;

/*
 * executor.js's requestId dedupe cache (recentRequestIds) is real
 * module-level state that persists across every test() in this file (the
 * module is only imported once per process) -- so each request needs its
 * own unique id unless a test is deliberately checking dedupe.
 */
function request(overrides = {}) {
    nextRequestId += 1;
    return {
        requestId: `req-${nextRequestId}`,
        requesterUserId: "gm-1",
        behaviorUuid: "RegionBehavior.mock",
        tokenUuid: "Token.mock",
        eventName: "tokenEnter",
        ...overrides,
    };
}

test("executeBehaviorRequest: rejects execution on a non-GM client", async () => {
    installBaseGlobals({ isGM: false });
    const result = await executeBehaviorRequest(request());
    assert.equal(result.ok, false);
    assert.equal(result.reason, "execution-client-is-not-gm");
});

test("executeBehaviorRequest: rejects an incomplete request", async () => {
    installBaseGlobals();
    const result = await executeBehaviorRequest({ requestId: "req-1" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid-request-data");
});

test("executeBehaviorRequest: ignores non-tokenEnter events", async () => {
    installBaseGlobals();
    const result = await executeBehaviorRequest(request({ eventName: "tokenExit" }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported-region-event");
});

test("executeBehaviorRequest: the same requestId is only ever executed once", async () => {
    const { chatMessages } = installBaseGlobals();
    const { behavior, token } = installSavingThrowFixture();

    const req = request({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid });
    const first = await executeBehaviorRequest(req);
    const second = await executeBehaviorRequest(req);

    assert.equal(first.reason, "executed-as-gm");
    assert.equal(second.reason, "duplicate-request-ignored");
    assert.equal(chatMessages.length, 1);
});

test("executeBehaviorRequest: rejects a request for a Behavior that no longer resolves", async () => {
    installBaseGlobals();
    const result = await executeBehaviorRequest(request());
    assert.equal(result.ok, false);
    assert.equal(result.reason, "region-behavior-not-found");
});

test("executeBehaviorRequest: does nothing for an inactive Behavior", async () => {
    installBaseGlobals();
    const { behavior, token } = installSavingThrowFixture();
    behavior.active = false;

    const result = await executeBehaviorRequest(request({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid }));
    assert.equal(result.ok, true);
    assert.equal(result.reason, "behavior-inactive");
});

test("executeBehaviorRequest: rejects a requester who doesn't own or GM the actor", async () => {
    const { chatMessages } = installBaseGlobals();
    const { behavior, token, actor } = installSavingThrowFixture({ requesterUserId: "player-1", requesterIsGM: false });
    actor.testUserPermission = () => false;

    const result = await executeBehaviorRequest(
        request({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid, requesterUserId: "player-1" }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "requester-does-not-own-actor");
    assert.equal(chatMessages.length, 0);
});

test("executeBehaviorRequest: allows a requester who owns the actor (not just a GM)", async () => {
    const { chatMessages } = installBaseGlobals();
    const { behavior, token, actor } = installSavingThrowFixture({ requesterUserId: "player-1", requesterIsGM: false });
    actor.testUserPermission = () => true;

    const result = await executeBehaviorRequest(
        request({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid, requesterUserId: "player-1" }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.reason, "executed-as-gm");
    assert.equal(chatMessages.length, 1);
});

test("executeBehaviorRequest: runs the ported module function for a supported functionality", async () => {
    const { chatMessages } = installBaseGlobals();
    const { behavior, token } = installSavingThrowFixture();

    const result = await executeBehaviorRequest(request({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid }));

    assert.equal(result.ok, true);
    assert.equal(result.functionality, "saving-throw");
    assert.equal(chatMessages.length, 1);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, [token.document.uuid]);
});

test("executeBehaviorRequest: rejects an unsupported functionality flag", async () => {
    installBaseGlobals();
    const region = makeRegion();
    const actor = makeActor();
    const behavior = makeBehavior({ functionality: "avoid-notice", config: {}, parent: region });
    const token = makeToken(actor);

    registerUuidDocument(behavior.uuid, behavior);
    registerUuidDocument(token.document.uuid, token.document);

    const result = await executeBehaviorRequest(request({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported-functionality");
});

test("executeBehaviorRequest: concurrent requests for the same Behavior/token pair don't double-execute", async () => {
    const { chatMessages } = installBaseGlobals();
    const { behavior, token } = installSavingThrowFixture();

    const [first, second] = await Promise.all([
        executeBehaviorRequest(request({ requestId: "req-a", behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid })),
        executeBehaviorRequest(request({ requestId: "req-b", behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid })),
    ]);

    const reasons = [first.reason, second.reason].sort();
    assert.ok(reasons.includes("execution-already-in-progress") || chatMessages.length === 1);
});
