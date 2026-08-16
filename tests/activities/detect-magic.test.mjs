import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeToken } from "../helpers/mock-foundry.mjs";
import { runDetectMagic } from "../../scripts/world-macros/DetectMagicFunctionMacros.js";

function detectingActor(statistics) {
    const itemId = "item-detect-magic";
    return makeActor({
        name: "Diviner",
        exploration: [itemId],
        items: [makeExplorationItem({ id: itemId, slug: "detect-magic", name: "Detect Magic" })],
        statistics,
    });
}

function makeDetectMagicBehavior(config = {}) {
    return makeBehavior({
        functionality: "detect-magic",
        config: {
            subject: "Aura",
            detection: "A faint aura of necromancy",
            hint: "",
            baseDC: 20,
            skills: { normal: ["occultism"] },
            ...config,
        },
    });
}

test("Detect Magic: an actor not performing Detect Magic never rolls", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = makeActor({ exploration: [], statistics: { occultism: { label: "Occultism", rank: 2, mod: 7 } } });
    const token = makeToken(actor);
    const behavior = makeDetectMagicBehavior();

    await runDetectMagic({ behavior, event: { name: "tokenEnter", data: { token } }, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 0);
});

test("Detect Magic: rolls one shared d20 against every configured identification skill", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 12;
    const actor = detectingActor({
        occultism: { label: "Occultism", rank: 2, mod: 7 },
        religion: { label: "Religion", rank: 1, mod: 4 },
    });
    const token = makeToken(actor);
    const behavior = makeDetectMagicBehavior({ baseDC: 18, skills: { normal: ["occultism"], hard: ["religion"] } });

    const result = await runDetectMagic({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.rolled, true);
    assert.equal(result.result.skillResults.length, 2);

    const occultism = result.result.skillResults.find(entry => entry.slug === "occultism");
    assert.equal(occultism.dc, 18); // normal: +0 adjustment
    assert.equal(occultism.total, 19); // 12 natural + 7 modifier

    const religion = result.result.skillResults.find(entry => entry.slug === "religion");
    assert.equal(religion.dc, 20); // hard: +2 adjustment
    assert.equal(religion.total, 16); // 12 natural + 4 modifier
    assert.equal(religion.degree, "failure");

    assert.equal(chatMessages.length, 1);
    assert.match(chatMessages[0].content, /A faint aura of necromancy/);
});

test("Detect Magic: skills outside arcana/nature/occultism/religion are ignored even if configured", async () => {
    installBaseGlobals();
    globalThis.Roll.nextTotal = 10;
    const actor = detectingActor({ occultism: { label: "Occultism", rank: 2, mod: 7 } });
    const token = makeToken(actor);
    // "stealth" is not a valid identification skill for Detect Magic.
    const behavior = makeDetectMagicBehavior({ skills: { normal: ["occultism", "stealth"] } });

    const result = await runDetectMagic({
        behavior,
        event: { name: "tokenEnter", data: { token } },
        region: {},
        scene: {},
        token,
        actor,
    });

    assert.equal(result.result.skillResults.length, 1);
    assert.equal(result.result.skillResults[0].slug, "occultism");
});

test("Detect Magic: empty subject or detection text is an invalid configuration", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = detectingActor({ occultism: { label: "Occultism", rank: 2, mod: 7 } });
    const token = makeToken(actor);
    const behavior = makeBehavior({
        functionality: "detect-magic",
        config: { subject: "Aura", detection: "", baseDC: 20, skills: { normal: ["occultism"] } },
    });

    const result = await runDetectMagic({
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

test("Detect Magic: no configured identification skills is a technical failure and rolls back registration", async () => {
    installBaseGlobals();
    const actor = detectingActor({});
    const token = makeToken(actor);
    const behavior = makeDetectMagicBehavior({ skills: {} });

    const result = await runDetectMagic({
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

test("Detect Magic: a second tokenEnter for the same token does not roll again", async () => {
    const { chatMessages } = installBaseGlobals();
    globalThis.Roll.nextTotal = 10;
    const actor = detectingActor({ occultism: { label: "Occultism", rank: 2, mod: 7 } });
    const token = makeToken(actor);
    const behavior = makeDetectMagicBehavior();
    const event = { name: "tokenEnter", data: { token } };

    await runDetectMagic({ behavior, event, region: {}, scene: {}, token, actor });
    await runDetectMagic({ behavior, event, region: {}, scene: {}, token, actor });

    assert.equal(chatMessages.length, 1);
});
