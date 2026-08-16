import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeRegion, makeToken, registerUuidDocument } from "./helpers/mock-foundry.mjs";
import { SOCKET_CHANNEL, getPrimaryGM, isPrimaryGM, registerSocket, requestBehaviorExecution } from "../scripts/socket.js";

function installMockSocket() {
    const emitted = [];
    const listeners = new Map();

    globalThis.game.socket = {
        emit(channel, data) {
            emitted.push({ channel, data });
        },
        on(channel, handler) {
            (listeners.get(channel) ?? listeners.set(channel, []).get(channel)).push(handler);
        },
    };

    return { emitted, listeners };
}

function addUser({ id, isGM = true, active = true }) {
    globalThis.game.users.push({ id, active, isGM });
    return globalThis.game.users.get(id);
}

test("getPrimaryGM: null when no GM is active", () => {
    installBaseGlobals({ isGM: false });
    assert.equal(getPrimaryGM(), null);
});

test("getPrimaryGM: the alphabetically-first active GM user id wins, ignoring inactive/non-GM users", () => {
    installBaseGlobals({ userId: "gm-zebra" });
    globalThis.game.user.isGM = true;
    addUser({ id: "gm-alpha", isGM: true, active: true });
    addUser({ id: "gm-inactive", isGM: true, active: false });
    addUser({ id: "player-aaa", isGM: false, active: true });

    const primary = getPrimaryGM();
    assert.equal(primary.id, "gm-alpha");
});

test("isPrimaryGM: true only for the client whose user is the elected primary", () => {
    installBaseGlobals({ userId: "gm-alpha" });
    addUser({ id: "gm-zebra", isGM: true, active: true });

    assert.equal(isPrimaryGM(), true);

    globalThis.game.user = globalThis.game.users.get("gm-zebra");
    assert.equal(isPrimaryGM(), false);
});

test("isPrimaryGM: false for a player, even if they happen to sort first", () => {
    installBaseGlobals({ userId: "aaa-player", isGM: false });
    addUser({ id: "gm-zzz", isGM: true, active: true });
    assert.equal(isPrimaryGM(), false);
});

test("requestBehaviorExecution: rejects a request missing behaviorUuid/tokenUuid", async () => {
    installBaseGlobals();
    const result = await requestBehaviorExecution({ behaviorUuid: "", tokenUuid: "Token.x" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-request-uuid");
});

test("requestBehaviorExecution: warns and fails when no GM is active", async () => {
    const { notifications } = installBaseGlobals({ isGM: false });
    const result = await requestBehaviorExecution({ behaviorUuid: "RegionBehavior.x", tokenUuid: "Token.x" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-active-gm");
    assert.ok(notifications.warn.length > 0);
});

test("requestBehaviorExecution: the primary GM executes in-process without touching the socket", async () => {
    const { chatMessages } = installBaseGlobals({ userId: "gm-1" });
    const { emitted } = installMockSocket();

    const actor = makeActor({ name: "Passerby", exploration: [] });
    actor.testUserPermission = () => true;
    actor.saves = {
        reflex: { label: "Reflex", rank: 1, async roll() { return { total: 15, degreeOfSuccess: 2, dice: [{ faces: 20, total: 10 }], options: {} }; } },
    };
    const region = makeRegion();
    const behavior = makeBehavior({ functionality: "saving-throw", config: { subject: "Trap", saveType: "reflex", dc: 10, consequence: "" }, parent: region });
    const token = makeToken(actor);
    registerUuidDocument(behavior.uuid, behavior);
    registerUuidDocument(token.document.uuid, token.document);

    const result = await requestBehaviorExecution({ behaviorUuid: behavior.uuid, tokenUuid: token.document.uuid });

    assert.equal(result.ok, true);
    assert.equal(result.reason, "executed-as-gm");
    assert.equal(emitted.length, 0);
    assert.equal(chatMessages.length, 1);
});

test("requestBehaviorExecution: a non-primary client (player or secondary GM) sends the request over the socket instead of executing locally", async () => {
    const { chatMessages } = installBaseGlobals({ userId: "player-1", isGM: false });
    addUser({ id: "gm-alpha", isGM: true, active: true });
    const { emitted } = installMockSocket();

    const result = await requestBehaviorExecution({ behaviorUuid: "RegionBehavior.x", tokenUuid: "Token.x" });

    assert.equal(result.ok, true);
    assert.equal(result.reason, "sent-to-gm");
    assert.equal(result.primaryGMId, "gm-alpha");
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].channel, SOCKET_CHANNEL);
    assert.equal(emitted[0].data.behaviorUuid, "RegionBehavior.x");
    assert.equal(chatMessages.length, 0);
});

test("registerSocket: registers exactly one listener even if called more than once, and it only acts when this client is the primary GM with a matching request type", async () => {
    // registerSocket() guards itself with module-level state (socketRegistered)
    // that persists for the lifetime of this process, so both assertions
    // have to share the one registration this file will ever get.
    const { chatMessages } = installBaseGlobals({ userId: "gm-alpha" });
    const { listeners } = installMockSocket();

    registerSocket();
    registerSocket();

    assert.equal(listeners.get(SOCKET_CHANNEL).length, 1);
    const handler = listeners.get(SOCKET_CHANNEL)[0];

    const actor = makeActor({ name: "Passerby", exploration: [] });
    actor.testUserPermission = () => true;
    actor.saves = {
        reflex: { label: "Reflex", rank: 1, async roll() { return { total: 15, degreeOfSuccess: 2, dice: [{ faces: 20, total: 10 }], options: {} }; } },
    };
    const region = makeRegion();
    const behavior = makeBehavior({ functionality: "saving-throw", config: { subject: "Trap", saveType: "reflex", dc: 10, consequence: "" }, parent: region });
    const token = makeToken(actor);
    registerUuidDocument(behavior.uuid, behavior);
    registerUuidDocument(token.document.uuid, token.document);

    // Wrong type: ignored.
    await handler({ type: "not-execute-behavior" });
    assert.equal(chatMessages.length, 0);

    // Correct type, and this client is the (only, thus primary) GM: acted on.
    await handler({
        type: "execute-behavior",
        requestId: "req-socket-1",
        requesterUserId: "gm-alpha",
        behaviorUuid: behavior.uuid,
        tokenUuid: token.document.uuid,
        eventName: "tokenEnter",
    });
    assert.equal(chatMessages.length, 1);
});
