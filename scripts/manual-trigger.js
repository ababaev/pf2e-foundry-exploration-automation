/**
 * PF2e Exploration Automation
 * scripts/manual-trigger.js
 *
 * ON-DEMAND REGION TRIGGERING
 * ===========================
 *
 * Lets a GM run every Region Automation Behavior on a Region against a
 * given set of tokens right now, as if each token had just walked in —
 * for Regions that don't correspond to a real place on the map (e.g. a
 * "roll for the whole party" trigger a GM fires whenever it's
 * narratively appropriate, such as once per hour of travel).
 *
 * Runs entirely on the calling GM client (no player → GM socket
 * routing needed, since only a GM can call this) and always passes
 * skipRegistration: true, so it never touches triggeredTokenUuids and
 * can be run again immediately without an UnregisterRegionMacros reset.
 */

import { MODULE_ID } from "./module-id.js";
import { runInvestigate } from "./world-macros/InvestigateFunctionMacros.js";
import { runSearch } from "./world-macros/SearchFunctionMacros.js";
import { runDetectMagic } from "./world-macros/DetectMagicFunctionMacros.js";
import { runSavingThrow } from "./world-macros/SavingThrowFunctionMacros.js";

const MANUAL_FUNCTIONS = Object.freeze({
    investigate: runInvestigate,
    search: runSearch,
    "detect-magic": runDetectMagic,
    "saving-throw": runSavingThrow,
});

/**
 * Run every Region Automation Behavior on `region` against every
 * token in `tokens`, skipping the one-shot triggeredTokenUuids
 * registration entirely.
 *
 * @param {object} region - Region document.
 * @param {object[]} tokens - Token placeables or documents, each with a resolvable .actor.
 * @returns {Promise<{ ok: boolean, reason?: string, ran: number, skipped: number, results: object[] }>}
 */
export async function triggerRegionAutomationForTokens({ region = null, tokens = [] } = {}) {
    if (!game.user?.isGM) {
        const result = { ok: false, reason: "gm-required", ran: 0, skipped: 0, results: [] };
        console.error("Region Automation | Only a GM can manually trigger a Region.", result);
        return result;
    }

    if (!region) {
        const result = { ok: false, reason: "missing-region", ran: 0, skipped: 0, results: [] };
        console.error("Region Automation | Manual trigger received no Region.", result);
        return result;
    }

    const scene = region.parent ?? canvas?.scene ?? null;

    const behaviors = Array.from(region.behaviors ?? []).filter(
        behavior => behavior.flags?.[MODULE_ID] && typeof behavior.flags[MODULE_ID] === "object",
    );

    const results = [];
    let ran = 0;
    let skipped = 0;

    for (const behavior of behaviors) {
        const functionality = behavior.flags[MODULE_ID].functionality;
        const runActivity = MANUAL_FUNCTIONS[functionality];

        if (!runActivity) {
            console.warn("Region Automation | Manual trigger skipped a Behavior with no supported functionality.", {
                behaviorUuid: behavior.uuid,
                functionality,
            });
            skipped += tokens.length;
            continue;
        }

        for (const token of tokens) {
            const actor = token.actor ?? token.document?.actor ?? null;

            if (!actor) {
                console.warn("Region Automation | Manual trigger skipped a token with no actor.", { token });
                skipped += 1;
                continue;
            }

            const event = { name: "tokenEnter", data: { token } };

            try {
                const outcome = await runActivity({ behavior, event, region, scene, token, actor, skipRegistration: true });

                if (outcome?.rolled) {
                    ran += 1;
                } else {
                    skipped += 1;
                }

                results.push({
                    ok: Boolean(outcome?.ok),
                    rolled: Boolean(outcome?.rolled),
                    reason: outcome?.reason ?? "unknown",
                    behaviorUuid: behavior.uuid,
                    functionality,
                    actorUuid: actor.uuid,
                });
            } catch (error) {
                console.error("Region Automation | Manual trigger failed for one Behavior/token pair.", {
                    behaviorUuid: behavior.uuid,
                    functionality,
                    actorUuid: actor.uuid,
                    error,
                });
                skipped += 1;
                results.push({ ok: false, rolled: false, reason: "threw", behaviorUuid: behavior.uuid, functionality, actorUuid: actor.uuid, error });
            }
        }
    }

    return { ok: true, ran, skipped, results };
}
