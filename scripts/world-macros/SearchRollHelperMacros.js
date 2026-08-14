import { escapeHTML } from "./shared/html.js";
import { RANK_LETTERS, getResultStyle } from "./shared/checks.js";
import { getActiveGMs } from "./shared/gm.js";
import { MODULE_ID } from "../module-id.js";

const TARGET_TYPES = Object.freeze({
    npc: {
        label: "NPC / Creature",
        detail: "Undetected creature within 30 feet",
    },
    "non-npc": {
        label: "Item / Hazard",
        detail: "Concealed object, feature, trap, or hazard within 30 feet",
    },
});

/**
 * Native Seek supplies action:seek automatically. It is included
 * explicitly here as well so the complete conceptual context is
 * visible in debug output. PF2e later converts the options to a Set,
 * so the duplicate is harmless.
 *
 * NPC mode includes both target:undetected and
 * target:condition:undetected, to support the current Keen Eyes
 * predicate seen in the actor data while retaining compatibility with
 * contexts that use the condition-prefixed form.
 */
function getTargetRollOptions(targetType) {
    if (targetType === "npc") {
        return [
            "action:seek",
            "target:creature",
            "target:type:npc",
            "target:actor:type:npc",
            "target:undetected",
            "target:condition:undetected",
            "target:distance:30",
            "pf2e-exploration-automation",
            "pf2e-exploration-automation:search",
            "pf2e-exploration-automation:search:npc",
        ];
    }

    return [
        "action:seek",
        "target:non-creature",
        "target:object",
        "target:type:hazard",
        "target:actor:type:hazard",
        "target:distance:30",
        "pf2e-exploration-automation",
        "pf2e-exploration-automation:search",
        "pf2e-exploration-automation:search:non-npc",
        "pf2e-exploration-automation:search:concealed-object",
    ];
}

/**
 * Extract the active natural d20 result from the completed native
 * PF2e CheckRoll. This does not calculate the roll, it only reads the
 * die result PF2e already produced.
 */
function getNaturalD20(roll) {
    const candidates = [...(roll?.dice ?? []), ...(roll?.terms ?? [])];
    const seen = new Set();

    for (const term of candidates) {
        if (!term || seen.has(term)) continue;
        seen.add(term);

        if (Number(term.faces) !== 20) continue;

        const activeResult = (term.results ?? []).find(result => result.active !== false && !result.discarded);
        const value = Number(activeResult?.result);

        if (Number.isFinite(value)) return value;

        const termTotal = Number(term.total);
        if (Number.isFinite(termTotal)) return termTotal;
    }

    return null;
}

function buildContent({ subject, targetDefinition, naturalRoll, statisticLabel, rankLetter, outcome, total, searchDC, hint }) {
    return `
        <section class="pf2e-exploration-automation search-result">
            <header style="margin-bottom: 0.6rem;">
                <strong>${escapeHTML(subject)}</strong>
            </header>

            <p style="margin: 0 0 0.6rem; font-size: 0.9em; opacity: 0.85;">
                Target: <strong>${escapeHTML(targetDefinition.label)}</strong> — ${escapeHTML(targetDefinition.detail)}
            </p>

            <p style="margin: 0 0 0.6rem;">
                Natural roll: <strong>${naturalRoll === null ? "—" : escapeHTML(naturalRoll)}</strong>
            </p>

            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Statistic</th>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Result</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                            ${escapeHTML(statisticLabel)} (${escapeHTML(rankLetter)})
                        </td>
                        <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); ${getResultStyle(outcome)}">
                            ${escapeHTML(total)} vs DC ${escapeHTML(searchDC)}
                        </td>
                    </tr>
                </tbody>
            </table>

            ${hint ? `<p style="margin-top: 0.7rem; font-style: italic;">${escapeHTML(hint)}</p>` : ""}
        </section>
    `;
}

/**
 * Perform the check entirely through PF2e's native Seek action.
 *
 * Region Automation does not roll a d20, build a Perception modifier,
 * test Keen Eyes, apply stacking, or determine the degree of success —
 * PF2e performs all of those operations.
 */
export async function runSearchRoll({ actor = null, token = null, behavior = null, event = null, region = null, scene = null, debug = true } = {}) {
    const tokenDocument = token?.document ?? token ?? null;

    if (!actor || !tokenDocument || !behavior) {
        const result = { ok: false, reason: "incomplete-context", actor, token: tokenDocument, behavior };
        console.error("Region Automation | Search roll helper received incomplete context", result);
        return result;
    }

    const config = behavior.flags?.[MODULE_ID]?.config ?? {};
    const subject = String(config.subject ?? "Search").trim() || "Search";
    const hint = String(config.hint ?? "").trim();
    const searchDC = Number(config.dc);

    /*
     * Older Search Behaviors without targetType default conservatively
     * to Item / Hazard.
     */
    const configuredTargetType = String(config.targetType ?? "non-npc").trim();
    const targetType = Object.hasOwn(TARGET_TYPES, configuredTargetType) ? configuredTargetType : null;

    if (!Number.isFinite(searchDC) || !Number.isInteger(searchDC) || !targetType) {
        const result = { ok: false, reason: "invalid-configuration", config, dc: config.dc, targetType: config.targetType };
        console.error("Region Automation | Search roll helper received invalid configuration", result);
        return result;
    }

    const seekAction = game.pf2e?.actions?.get?.("seek") ?? null;

    if (!seekAction || typeof seekAction.use !== "function") {
        const result = { ok: false, reason: "native-seek-action-not-found" };
        console.error("Region Automation | PF2e native Seek action was not found", result);
        return result;
    }

    const targetDefinition = TARGET_TYPES[targetType];
    const rollOptions = getTargetRollOptions(targetType);

    /*
     * PF2e uses the event's Shift state to invert the executing user's
     * normal "show check dialogs" preference. Matching shiftKey to the
     * current setting guarantees skipDialog:
     *
     * showCheckDialogs = true  + Shift = skip
     * showCheckDialogs = false + no Shift = skip
     */
    const suppressDialogEvent = new PointerEvent("click", {
        shiftKey: Boolean(game.user.settings.showCheckDialogs),
        ctrlKey: false,
        metaKey: false,
        bubbles: false,
        cancelable: false,
    });

    let actionResults;

    try {
        actionResults = await seekAction.use({
            actors: [actor],
            difficultyClass: searchDC,
            rollOptions,
            message: { create: false },
            event: suppressDialogEvent,
        });
    } catch (error) {
        const result = { ok: false, reason: "native-seek-action-failed", error, rollOptions, actorUuid: actor.uuid };
        console.error("Region Automation | PF2e native Seek action failed", result);
        return result;
    }

    if (!Array.isArray(actionResults) || actionResults.length === 0) {
        const result = { ok: false, reason: "native-seek-returned-no-results", actionResults, rollOptions, actorUuid: actor.uuid };
        console.error("Region Automation | PF2e native Seek action returned no result", result);
        return result;
    }

    /*
     * Only one actor was supplied, so use that actor's completed
     * native Seek result.
     */
    const actionResult = actionResults.find(entry => entry?.actor?.uuid === actor.uuid) ?? actionResults[0];
    const searchRoll = actionResult?.roll ?? null;

    if (!searchRoll) {
        const result = { ok: false, reason: "native-seek-result-has-no-roll", actionResult, rollOptions, actorUuid: actor.uuid };
        console.error("Region Automation | Native Seek result contained no CheckRoll", result);
        return result;
    }

    /*
     * All values below come directly from PF2e's completed result.
     */
    const total = Number(searchRoll.total);
    const naturalRoll = getNaturalD20(searchRoll);
    const nativeModifierValue = Number(searchRoll.options?.totalModifier);
    const nativeModifier = Number.isFinite(nativeModifierValue) ? nativeModifierValue : null;
    const outcome = actionResult.outcome ?? null;
    const formula = String(searchRoll.formula ?? "");

    /*
     * Resolve display-only statistic information; not used to
     * calculate the result.
     */
    const perceptionStatistic = actor.getStatistic?.("perception") ?? actor.perception ?? null;
    const statisticLabel = perceptionStatistic?.label ?? "Perception";
    const rank = Number(perceptionStatistic?.rank ?? 0);
    const rankLetterValue = RANK_LETTERS[rank] ?? "U";

    const activeGMs = getActiveGMs();

    if (activeGMs.length === 0) {
        const result = { ok: false, reason: "no-active-gm" };
        console.error("Region Automation | No active GM can receive the Search result", result);
        return result;
    }

    const message = await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor.name ?? tokenDocument.name ?? "Search" },
        whisper: activeGMs.map(user => user.id),
        content: buildContent({
            subject,
            targetDefinition,
            naturalRoll,
            statisticLabel,
            rankLetter: rankLetterValue,
            outcome,
            total,
            searchDC,
            hint,
        }),
    });

    /*
     * Failure and critical failure remain valid game results.
     */
    const result = {
        ok: true,
        reason: "rolled",
        subject,
        targetType,
        targetLabel: targetDefinition.label,
        naturalRoll,
        modifier: nativeModifier,
        total,
        dc: searchDC,
        outcome,
        formula,
        rollOptions,
        nativeAction: seekAction,
        nativeActionResult: actionResult,
        nativeRoll: searchRoll,
        statistic: {
            slug: "perception",
            label: statisticLabel,
            rank,
            rankLetter: rankLetterValue,
            modifier: nativeModifier,
            total,
            dc: searchDC,
            outcome,
            formula,
        },
        message,
        actorUuid: actor.uuid,
        tokenUuid: tokenDocument.uuid,
        behaviorUuid: behavior.uuid,
        regionUuid: region?.uuid ?? null,
        sceneUuid: scene?.uuid ?? null,
        eventName: event?.name ?? null,
    };

    if (debug) {
        console.group(`Region Automation | Native Seek action | ${actor.name}`);
        console.log("Search target", { targetType, label: targetDefinition.label, detail: targetDefinition.detail });
        console.log("Roll options supplied to native Seek", rollOptions);
        console.table([{ statistic: statisticLabel, rank: rankLetterValue, nativeModifier, natural: naturalRoll, total, dc: searchDC, outcome, formula }]);
        console.log("Native Seek action result", actionResult);
        console.log("Native PF2e CheckRoll", searchRoll);
        console.log("Complete Search result", result);
        console.groupEnd();
    }

    return result;
}
