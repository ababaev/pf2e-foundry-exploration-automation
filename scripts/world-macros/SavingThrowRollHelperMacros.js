import { escapeHTML } from "./shared/html.js";
import { RANK_LETTERS, getDegreeOfSuccess, getResultStyle } from "./shared/checks.js";
import { getActiveGMs } from "./shared/gm.js";
import { MODULE_ID } from "../module-id.js";

const SAVE_LABELS = { fortitude: "Fortitude", reflex: "Reflex", will: "Will" };
const VALID_SAVE_TYPES = new Set(Object.keys(SAVE_LABELS));

const DEGREE_SLUGS = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEGREE_DISPLAY_LABELS = {
    criticalFailure: "Critical Failure",
    failure: "Failure",
    success: "Success",
    criticalSuccess: "Critical Success",
};

function buildContent({ subject, statisticLabel, rankLetter, degree, total, saveDC, naturalRoll, modifier, enrichedConsequence }) {
    return `
        <section class="pf2e-exploration-automation saving-throw-result">
            <header style="margin-bottom: 0.6rem;">
                <strong>${escapeHTML(subject)}</strong>
            </header>

            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Saving Throw</th>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Result</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                            ${escapeHTML(statisticLabel)} (${escapeHTML(rankLetter)})
                        </td>
                        <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); ${getResultStyle(degree)}">
                            ${escapeHTML(total)} vs DC ${escapeHTML(saveDC)}
                        </td>
                    </tr>
                </tbody>
            </table>

            <p style="margin: 0.65rem 0 0; font-size: 0.9em; opacity: 0.8;">
                Natural d20: <strong>${naturalRoll === null ? "—" : escapeHTML(naturalRoll)}</strong>
                &nbsp;|&nbsp;
                Modifier: <strong>${modifier >= 0 ? "+" : ""}${escapeHTML(modifier)}</strong>
            </p>

            ${
                enrichedConsequence
                    ? `
                        <hr style="margin: 0.75rem 0;">
                        <div class="ra-saving-throw-consequence">
                            <strong>GM Notes / Consequences</strong>
                            <div style="margin-top: 0.4rem;">${enrichedConsequence}</div>
                        </div>
                    `
                    : ""
            }
        </section>
    `;
}

/**
 * Escape GM-authored consequence text, preserve line breaks, and
 * enrich Foundry links such as @UUID and @Check.
 */
async function enrichConsequence(consequence) {
    let enriched = escapeHTML(consequence).replace(/\r?\n/g, "<br>");

    if (!consequence) return enriched;

    try {
        const TextEditorClass =
            foundry.applications?.ux?.TextEditor?.implementation ?? foundry.applications?.ux?.TextEditor ?? globalThis.TextEditor ?? null;

        if (TextEditorClass && typeof TextEditorClass.enrichHTML === "function") {
            enriched = await TextEditorClass.enrichHTML(enriched, { secrets: true });
        }
    } catch (error) {
        console.warn("Region Automation | Saving Throw GM Notes could not be enriched; showing escaped text", error);
    }

    return enriched;
}

/**
 * Perform the check through PF2e's native Statistic.roll, which
 * already computes the degree of success against the supplied DC.
 */
export async function runSavingThrowRoll({ actor = null, token = null, behavior = null, event = null, region = null, scene = null, debug = true } = {}) {
    const tokenDocument = token?.document ?? token ?? null;

    if (!actor || !tokenDocument || !behavior) {
        const result = { ok: false, reason: "incomplete-context", actor, token: tokenDocument, behavior };
        console.error("Region Automation | Saving Throw helper received incomplete context", result);
        return result;
    }

    const config = behavior.flags?.[MODULE_ID]?.config ?? {};
    const subject = String(config.subject ?? "").trim();
    const saveType = String(config.saveType ?? "").trim();
    const saveDC = Number(config.dc);
    const consequence = String(config.consequence ?? "").trim();

    if (!subject || !VALID_SAVE_TYPES.has(saveType) || !Number.isFinite(saveDC) || !Number.isInteger(saveDC)) {
        const result = { ok: false, reason: "invalid-configuration", config };
        console.error("Region Automation | Saving Throw helper received invalid configuration", result);
        return result;
    }

    const activeGMs = getActiveGMs();

    if (activeGMs.length === 0) {
        const result = { ok: false, reason: "no-active-gm" };
        console.error("Region Automation | No active GM can receive the Saving Throw result", result);
        return result;
    }

    const saveStatistic = actor.getStatistic?.(saveType) ?? actor.saves?.[saveType] ?? null;

    if (!saveStatistic || typeof saveStatistic.roll !== "function") {
        const result = { ok: false, reason: "saving-throw-statistic-not-found", saveType, actorUuid: actor.uuid };
        console.error("Region Automation | Saving Throw statistic was not found", result);
        return result;
    }

    /*
     * createMessage:false prevents PF2e from creating its own chat
     * card. A custom GM-only result is created below.
     */
    const saveRoll = await saveStatistic.roll({
        dc: saveDC,
        token: tokenDocument,
        skipDialog: true,
        createMessage: false,
        messageMode: "blindroll",
        title: subject,
        slug: "pf2e-exploration-automation-saving-throw",
        extraRollOptions: ["pf2e-exploration-automation", "pf2e-exploration-automation:saving-throw", `pf2e-exploration-automation:saving-throw:${saveType}`],
    });

    if (!saveRoll) {
        const result = { ok: false, reason: "saving-throw-roll-returned-null", saveType, actorUuid: actor.uuid };
        console.error("Region Automation | PF2e returned no Saving Throw roll", result);
        return result;
    }

    const total = Number(saveRoll.total);
    const d20Die = saveRoll.dice?.find(die => Number(die.faces) === 20) ?? null;
    const possibleNaturalRoll = Number(d20Die?.total);
    const naturalRoll = Number.isFinite(possibleNaturalRoll) ? possibleNaturalRoll : null;

    const possibleModifier = Number(saveRoll.options?.totalModifier);
    const modifier = Number.isFinite(possibleModifier)
        ? possibleModifier
        : naturalRoll !== null
          ? total - naturalRoll
          : Number(saveStatistic.mod ?? saveStatistic.check?.mod ?? 0);

    const rank = Number(saveStatistic.rank ?? 0);
    const rankLetter = RANK_LETTERS[rank] ?? "U";
    const statisticLabel = saveStatistic.label ?? SAVE_LABELS[saveType] ?? saveType;

    const nativeDegreeIndex = Number(saveRoll.degreeOfSuccess);
    const degree =
        Number.isInteger(nativeDegreeIndex) && nativeDegreeIndex >= 0 && nativeDegreeIndex <= 3
            ? DEGREE_SLUGS[nativeDegreeIndex]
            : getDegreeOfSuccess(total, saveDC, naturalRoll);

    const enrichedConsequence = await enrichConsequence(consequence);

    const message = await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor.name ?? tokenDocument.name ?? "Saving Throw" },
        whisper: activeGMs.map(user => user.id),
        content: buildContent({ subject, statisticLabel, rankLetter, degree, total, saveDC, naturalRoll, modifier, enrichedConsequence }),
    });

    /*
     * ok:true means the automation completed technically. Failure and
     * critical failure remain normal game results.
     */
    const result = {
        ok: true,
        reason: "rolled",
        subject,
        saveType,
        saveDC,
        naturalRoll,
        modifier,
        total,
        degree,
        degreeLabel: DEGREE_DISPLAY_LABELS[degree] ?? "Unknown",
        roll: saveRoll,
        message,
        statistic: {
            slug: saveType,
            label: statisticLabel,
            rank,
            rankLetter,
            modifier,
            total,
            dc: saveDC,
            degree,
            breakdown: saveStatistic.check?.breakdown ?? "",
        },
        actorUuid: actor.uuid,
        tokenUuid: tokenDocument.uuid,
        behaviorUuid: behavior.uuid,
        regionUuid: region?.uuid ?? null,
        sceneUuid: scene?.uuid ?? null,
        eventName: event?.name ?? null,
    };

    if (debug) {
        console.group(`Region Automation | Saving Throw helper | ${actor.name}`);
        console.table([
            {
                statistic: statisticLabel,
                rank: rankLetter,
                modifier,
                natural: naturalRoll,
                total,
                dc: saveDC,
                outcome: result.degreeLabel,
                breakdown: saveStatistic.check?.breakdown ?? "",
            },
        ]);
        console.log("Native PF2e CheckRoll", saveRoll);
        console.log("Complete Saving Throw result", result);
        console.groupEnd();
    }

    return result;
}
