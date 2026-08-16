import { test } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals, makeActor, makeBehavior, makeExplorationItem, makeRegion, makeToken } from "./helpers/mock-foundry.mjs";
import { triggerRegionAutomationForTokens } from "../scripts/manual-trigger.js";

function installSeekAction() {
    globalThis.game.pf2e.actions = {
        get: slug =>
            slug === "seek"
                ? {
                      use: async options => [
                          {
                              actor: options.actors[0],
                              outcome: "success",
                              roll: {
                                  total: 18,
                                  formula: "1d20+4",
                                  dice: [{ faces: 20, results: [{ result: 14, active: true }] }],
                                  options: { totalModifier: 4 },
                              },
                          },
                      ],
                  }
                : null,
    };
}

function makeSaveStatistic() {
    return {
        label: "Reflex",
        rank: 1,
        async roll() {
            return { total: 15, degreeOfSuccess: 2, dice: [{ faces: 20, total: 10 }], options: { totalModifier: 5 } };
        },
    };
}

test("triggerRegionAutomationForTokens: requires a GM", async () => {
    installBaseGlobals({ isGM: false });
    const result = await triggerRegionAutomationForTokens({ region: makeRegion(), tokens: [] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "gm-required");
});

test("triggerRegionAutomationForTokens: requires a Region", async () => {
    installBaseGlobals();
    const result = await triggerRegionAutomationForTokens({ region: null, tokens: [] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-region");
});

test("triggerRegionAutomationForTokens: runs every automation on the Region against every token, skipping non-matching gates", async () => {
    const { chatMessages } = installBaseGlobals();
    installSeekAction();

    const searchItemId = "item-search";
    const searchingActor = makeActor({
        name: "Aria",
        exploration: [searchItemId],
        items: [makeExplorationItem({ id: searchItemId, slug: "search", name: "Search" })],
    });
    const idleActor = makeActor({ name: "Borin", exploration: [] });

    const searchBehavior = makeBehavior({ functionality: "search", config: { subject: "Cache", dc: 18, targetType: "non-npc" } });
    const saveBehavior = makeBehavior({
        functionality: "saving-throw",
        config: { subject: "Rockslide", saveType: "reflex", dc: 16, consequence: "" },
    });
    searchingActor.getStatistic = () => null;
    idleActor.getStatistic = slug => (slug === "reflex" ? makeSaveStatistic() : null);
    searchingActor.saves = { reflex: makeSaveStatistic() };
    idleActor.saves = { reflex: makeSaveStatistic() };

    const region = makeRegion({ behaviors: [searchBehavior, saveBehavior] });
    const tokens = [makeToken(searchingActor), makeToken(idleActor)];

    const summary = await triggerRegionAutomationForTokens({ region, tokens });

    // search x searchingActor: rolls. search x idleActor: gated out (not
    // performing Search). saving-throw x both: no gate, both roll.
    assert.equal(summary.ran, 3);
    assert.equal(summary.skipped, 1);
    assert.equal(chatMessages.length, 3);

    const searchResult = summary.results.find(r => r.functionality === "search" && r.actorUuid === idleActor.uuid);
    assert.equal(searchResult.rolled, false);
    assert.equal(searchResult.reason, "not-performing-activity");
});

test("triggerRegionAutomationForTokens: never marks tokens as triggered, so a second run rolls again", async () => {
    const { chatMessages } = installBaseGlobals();
    const actor = makeActor({ name: "Aria", exploration: [] });
    actor.saves = { reflex: makeSaveStatistic() };
    const token = makeToken(actor);
    const behavior = makeBehavior({
        functionality: "saving-throw",
        config: { subject: "Rockslide", saveType: "reflex", dc: 16, consequence: "" },
    });
    const region = makeRegion({ behaviors: [behavior] });

    const first = await triggerRegionAutomationForTokens({ region, tokens: [token] });
    const second = await triggerRegionAutomationForTokens({ region, tokens: [token] });

    assert.equal(first.ran, 1);
    assert.equal(second.ran, 1);
    assert.equal(chatMessages.length, 2);
    assert.deepEqual(behavior.flags["pf2e-exploration-automation"].triggeredTokenUuids, []);
});

test("triggerRegionAutomationForTokens: skips Behaviors with an unsupported/unknown functionality", async () => {
    installBaseGlobals();
    const actor = makeActor({ name: "Aria", exploration: [] });
    const token = makeToken(actor);
    const behavior = makeBehavior({ functionality: "avoid-notice", config: {} });
    const region = makeRegion({ behaviors: [behavior] });

    const summary = await triggerRegionAutomationForTokens({ region, tokens: [token] });

    assert.equal(summary.ran, 0);
    assert.equal(summary.skipped, 1);
});

test("triggerRegionAutomationForTokens: skips a token with no resolvable actor", async () => {
    installBaseGlobals();
    const behavior = makeBehavior({
        functionality: "saving-throw",
        config: { subject: "Rockslide", saveType: "reflex", dc: 16, consequence: "" },
    });
    const region = makeRegion({ behaviors: [behavior] });

    const summary = await triggerRegionAutomationForTokens({ region, tokens: [{ document: { uuid: "Token.orphan" } }] });

    assert.equal(summary.ran, 0);
    assert.equal(summary.skipped, 1);
});

test("triggerRegionAutomationForTokens: ignores Behaviors on the Region that don't belong to this module", async () => {
    installBaseGlobals();
    const actor = makeActor({ name: "Aria", exploration: [] });
    const token = makeToken(actor);
    const foreignBehavior = { uuid: "RegionBehavior.foreign", flags: {} };
    const region = makeRegion({ behaviors: [foreignBehavior] });

    const summary = await triggerRegionAutomationForTokens({ region, tokens: [token] });

    assert.equal(summary.ran, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.results.length, 0);
});
