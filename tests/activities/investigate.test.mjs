import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeToken } from "../helpers/mock-foundry.mjs";
import { runInvestigate } from "../../scripts/world-macros/InvestigateFunctionMacros.js";

function investigatingActor(statistics) {
    const itemId = "item-investigate";
    return makeActor({
        name: "Detective",
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "investigate", name: "Investigate" })],
        statistics,
    });
}

function makeInvestigateBehavior(config = {}) {
    return makeBehavior({
        functionality: "investigate",
        config: { subject: "Strange Runes", hint: "", baseDC: 20, skills: { normal: ["arcana"] }, ...config },
    });
}

test("Investigate: an actor not performing Investigate never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = makeActor({ exploration: [], statistics: { arcana: { label: "Arcana", rank: 2, mod: 8 } } });
    const token = makeToken(actor);
    const behavior = makeInvestigateBehavior();

    await runInvestigate({ behavior, event: { name: "tokenEnter", data: { token } }, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 0);
});

test("Investigate: rolls one shared d20 against every configured skill and reports the degree of success", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 15;
    const actor = investigatingActor({ arcana: { label: "Arcana", rank: 2, mod: 8 } });
    const token = makeToken(actor);
    const behavior = makeInvestigateBehavior({ baseDC: 20, skills: { normal: ["arcana"] } });

    const result = await runInvestigate({
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
    assert.equal(result.result.ordinaryResults.length, 1);
    assert.equal(result.result.ordinaryResults[0].total, 23); // 15 natural + 8 modifier
    assert.equal(result.result.ordinaryResults[0].degree, "success");
    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /Strange Runes/);
});

test("Investigate: a natural 20 upgrades a would-be failure into a success (step-up rule)", async () => {
    installBaseGlobals();
    globalThis.Roll.nextTotal = 20;
    // total = 20 (natural) + 1 (modifier) = 21, dc 30 -> normally a failure (21 < 30),
    // but nat 20 steps the degree up by one: failure -> success.
    const actor = investigatingActor({ arcana: { label: "Arcana", rank: 0, mod: 1 } });
    const token = makeToken(actor);
    const behavior = makeInvestigateBehavior({ baseDC: 30, skills: { normal: ["arcana"] } });

    const result = await runInvestigate({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.result.ordinaryResults[0].degree, "success");
});

test("Investigate: also rolls every actual Lore statistic on the actor, separate from the configured columns", async () => {
    installBaseGlobals();
    globalThis.Roll.nextTotal = 10;
    const actor = investigatingActor({
        arcana: { label: "Arcana", rank: 2, mod: 8 },
        "circus-lore": { label: "Circus Lore", rank: 1, mod: 5, lore: true },
    });
    const token = makeToken(actor);
    // Reference-only Lore columns (Specified/Unspecified Lore) trigger the actual Lore roll.
    const behavior = makeInvestigateBehavior({ skills: { "very-easy": ["specified-lore"] } });

    const result = await runInvestigate({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.result.loreReferences.length, 1);
    assert.equal(result.result.loreResults.length, 1);
    assert.equal(result.result.loreResults[0].label, "Circus Lore");
    assert.equal(result.result.loreResults[0].total, 15); // 10 natural + 5 modifier
});

test("Investigate: invalid configuration (non-finite base DC) never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = investigatingActor({ arcana: { label: "Arcana", rank: 2, mod: 8 } });
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "investigate", config: { subject: "x", skills: { normal: ["arcana"] } } });

    const result = await runInvestigate({
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

test("Investigate: no configured statistics at all is a technical failure and rolls back registration", async () => {
    installBaseGlobals();
    const actor = investigatingActor({});
    const token = makeToken(actor);
    const behavior = makeInvestigateBehavior({ skills: {} });

    const result = await runInvestigate({
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

test("Investigate: a second tokenEnter for the same token does not roll again", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 10;
    const actor = investigatingActor({ arcana: { label: "Arcana", rank: 2, mod: 8 } });
    const token = makeToken(actor);
    const behavior = makeInvestigateBehavior();
    const event = { name: "tokenEnter", data: { token } };

    await runInvestigate({ behavior, event, region: {}, scene: {}, token, actor });
    await runInvestigate({ behavior, event, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 1);
});
