import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeToken } from "../helpers/mock-foundry.mjs";
import { registerTokenTrigger } from "../../scripts/world-macros/RegistrationMacros.js";

async function register(args) {
    const resultBox = { value: null };
    await registerTokenTrigger({ ...args, resultBox });
    return resultBox.value;
}

test("registerTokenTrigger: first registration succeeds and records the token uuid", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "search" });
    const token = makeToken(makeActor());

    const result = await register({ behavior, token });

    assert.equal(result.ok, true);
    assert.equal(result.firstTrigger, true);
    assert.equal(result.alreadyRegistered, false);
    assert.equal(result.reason, "registered");
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, [token.document.uuid]);
});

test("registerTokenTrigger: a second registration for the same token/behavior is a no-op", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "search" });
    const token = makeToken(makeActor());

    await register({ behavior, token });
    const second = await register({ behavior, token });

    assert.equal(second.ok, true);
    assert.equal(second.firstTrigger, false);
    assert.equal(second.alreadyRegistered, true);
    assert.equal(second.reason, "already-registered");
    assert.equal(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids.length, 1);
});

test("registerTokenTrigger: different tokens against the same Behavior both register", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "search" });
    const tokenA = makeToken(makeActor({ name: "A" }));
    const tokenB = makeToken(makeActor({ name: "B" }));

    await register({ behavior, token: tokenA });
    await register({ behavior, token: tokenB });

    assert.deepEqual(
        behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids.sort(),
        [tokenA.document.uuid, tokenB.document.uuid].sort(),
    );
});

test("registerTokenTrigger: fails cleanly with a missing behavior or token", async () => {
    installBaseGlobals();
    const missingBehavior = await register({ behavior: null, token: makeToken(makeActor()) });
    assert.equal(missingBehavior.ok, false);
    assert.equal(missingBehavior.reason, "missing-behavior");

    const missingToken = await register({ behavior: makeBehavior({ functionality: "search" }), token: null });
    assert.equal(missingToken.ok, false);
    assert.equal(missingToken.reason, "missing-token-uuid");
});

test("registerTokenTrigger: two near-simultaneous registrations for the same token are serialized (no double count)", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "search" });
    const token = makeToken(makeActor());

    const [first, second] = await Promise.all([register({ behavior, token }), register({ behavior, token })]);

    const outcomes = [first.reason, second.reason].sort();
    // One call wins the lock and registers; the other either sees the lock
    // (registration-in-progress) or, if it runs after the first finished,
    // sees the token already recorded (already-registered). Either way,
    // the token is only ever recorded once.
    assert.ok(outcomes.includes("registered"));
    assert.equal(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids.length, 1);
});

test("registerTokenTrigger: sanitizes a corrupted triggeredTokenUuids array (non-string/duplicate entries)", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({ functionality: "search", triggeredTokenUuids: ["Token.a", "Token.a", 42, null, ""] });
    const token = makeToken(makeActor());

    const result = await register({ behavior, token });

    assert.equal(result.firstTrigger, true);
    assert.deepEqual(
        behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids.sort(),
        ["Token.a", token.document.uuid].sort(),
    );
});
