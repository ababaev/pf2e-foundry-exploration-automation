import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeToken } from "../helpers/mock-foundry.mjs";
import { runSavingThrow } from "../../scripts/world-macros/SavingThrowFunctionMacros.js";

function makeSaveStatistic({ total, degreeOfSuccess, naturalRoll, modifier, label = "Reflex", rank = 1 }) {
    return {
        label,
        rank,
        async roll() {
            return {
                total,
                degreeOfSuccess,
                dice: [{ faces: 20, total: naturalRoll }],
                options: { totalModifier: modifier },
            };
        },
    };
}

function actorWithSave(saveType, statistic) {
    return makeActor({ name: "Passerby", exploration: [], statistics: { [saveType]: statistic } });
}

function makeSavingThrowBehavior(config = {}) {
    return makeBehavior({
        functionality: "saving-throw",
        config: { subject: "Spike Trap", saveType: "reflex", dc: 18, consequence: "1d6 piercing damage", ...config },
    });
}

test("Saving Throw: fires even for an actor performing no exploration activity at all (no gate)", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = actorWithSave("reflex", makeSaveStatistic({ total: 20, degreeOfSuccess: 2, naturalRoll: 15, modifier: 5 }));
    const token = makeToken(actor);
    const behavior = makeSavingThrowBehavior();

    const result = await runSavingThrow({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.rolled, true);
    assert.equal(chatMessages.length, 1);
});

test("Saving Throw: rolls the configured save type against the configured DC and reports the degree", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = actorWithSave("fortitude", makeSaveStatistic({ total: 12, degreeOfSuccess: 0, naturalRoll: 3, modifier: 9 }));
    const token = makeToken(actor);
    const behavior = makeSavingThrowBehavior({ saveType: "fortitude", dc: 22 });

    const result = await runSavingThrow({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.result.degree, "criticalFailure");
    assert.equal(result.result.total, 12);
    assert.equal(result.result.naturalRoll, 3);
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /12 vs DC 22/);
});

test("Saving Throw: enriches @UUID links in the consequence text into the whispered chat message", async () => {
    installBaseGlobals();
    const actor = actorWithSave("will", makeSaveStatistic({ total: 18, degreeOfSuccess: 2, naturalRoll: 10, modifier: 8 }));
    const token = makeToken(actor);
    const behavior = makeSavingThrowBehavior({ saveType: "will", dc: 15, consequence: "See @UUID[JournalEntry.abc]{Trap Notes}" });

    const result = await runSavingThrow({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.match(result.result.message.content, /See @UUID\[JournalEntry\.abc\]\{Trap Notes\}/);
});

test("Saving Throw: invalid configuration (bad saveType) never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = actorWithSave("reflex", makeSaveStatistic({ total: 10, degreeOfSuccess: 1, naturalRoll: 5, modifier: 5 }));
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "saving-throw", config: { subject: "Trap", saveType: "perception", dc: 15 } });

    const result = await runSavingThrow({
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

test("Saving Throw: a missing statistic on the actor is a technical failure and rolls back registration", async () => {
    installBaseGlobals();
    const actor = makeActor({ name: "No Reflexes", exploration: [], statistics: {} });
    const token = makeToken(actor);
    const behavior = makeSavingThrowBehavior({ saveType: "reflex" });

    const result = await runSavingThrow({
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

test("Saving Throw: a second tokenEnter for the same token does not roll again", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = actorWithSave("reflex", makeSaveStatistic({ total: 18, degreeOfSuccess: 2, naturalRoll: 10, modifier: 8 }));
    const token = makeToken(actor);
    const behavior = makeSavingThrowBehavior();
    const event = { name: "tokenEnter", data: { token } };

    await runSavingThrow({ behavior, event, region: {}, scene: {}, token, actor });
    await runSavingThrow({ behavior, event, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 1);
});
