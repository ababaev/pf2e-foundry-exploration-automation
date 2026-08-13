import { escapeHTML } from "./shared/html.js";
import { DIFFICULTIES, DC_ADJUSTMENTS, RANK_LETTERS, getDegreeOfSuccess, getResultStyle } from "./shared/checks.js";
import { getActiveGMs } from "./shared/gm.js";
import { MODULE_ID } from "../module-id.js";

/*
 * Normally leave this as null. Set it to 1 or 20 only when testing
 * natural-roll behavior.
 */
const FORCED_NATURAL_ROLL = null;

/**
 * Resolve PF2e modifiers for one statistic (skill or lore), applying
 * the Recall Knowledge roll options.
 */
function resolveStatistic(statistic, naturalRoll) {
    const slug = statistic.slug;
    const rollOptions = ["action:recall-knowledge", `action:recall-knowledge:${slug}`];

    const resolved = typeof statistic.withRollOptions === "function" ? statistic.withRollOptions({ extraRollOptions: rollOptions }) : statistic;

    const modifier = Number(resolved.check?.mod ?? resolved.mod ?? 0);
    const rank = Number(resolved.rank ?? statistic.rank ?? 0);

    return {
        statistic: resolved,
        slug,
        label: resolved.label ?? statistic.label ?? slug,
        modifier,
        rank,
        rankLetter: RANK_LETTERS[rank] ?? "U",
        total: naturalRoll + modifier,
        breakdown: resolved.check?.breakdown ?? "",
        rollOptions,
    };
}

/**
 * Split the seven configured-difficulty skill columns into ordinary
 * statistic rows (rolled against their assigned DC) and Lore
 * placeholder references ("Specified Lore" / "Unspecified Lore" only
 * carry a DC — the GM compares an actual Lore roll against them).
 */
function resolveConfiguredSkills(actor, baseDC, configuredSkills) {
    const loreReferences = [];
    const ordinaryRows = [];
    const seenOrdinary = new Set();
    const seenLoreReferences = new Set();

    for (const difficulty of DIFFICULTIES) {
        const entries = Array.isArray(configuredSkills[difficulty]) ? configuredSkills[difficulty] : [];
        const dc = baseDC + DC_ADJUSTMENTS[difficulty];

        for (const slug of entries) {
            if (slug === "specified-lore" || slug === "unspecified-lore") {
                if (!seenLoreReferences.has(slug)) {
                    seenLoreReferences.add(slug);
                    loreReferences.push({
                        slug,
                        label: slug === "specified-lore" ? "Specified Lore" : "Unspecified Lore",
                        difficulty,
                        dc,
                    });
                }

                continue;
            }

            if (seenOrdinary.has(slug)) {
                console.warn(`Region Automation | Duplicate configured skill ignored: ${slug}`);
                continue;
            }

            seenOrdinary.add(slug);

            const statistic = actor.getStatistic?.(slug) ?? actor.skills?.[slug] ?? null;

            if (!statistic) {
                console.warn(`Region Automation | Actor statistic not found: ${slug}`);
                continue;
            }

            ordinaryRows.push({ statistic, difficulty, dc });
        }
    }

    return { loreReferences, ordinaryRows };
}

function statisticRowHTML(label, rankLetter, style, total, extra = "") {
    return `
        <tr>
            <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                ${escapeHTML(label)} (${escapeHTML(rankLetter)})
            </td>
            <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); ${style}">
                ${escapeHTML(total)}${extra}
            </td>
        </tr>
    `;
}

function buildContent({ subject, naturalRoll, ordinaryResults, loreReferences, loreResults, hint }) {
    const ordinaryRowsHTML = ordinaryResults
        .map(result => statisticRowHTML(result.label, result.rankLetter, getResultStyle(result.degree), result.total, ` vs DC ${escapeHTML(result.dc)}`))
        .join("");

    /*
     * One combined Lore table:
     *
     * Specified Lore      DC 15
     * Unspecified Lore    DC 18
     * Circus Lore (T)     10
     * Warfare Lore (E)    14
     */
    const loreRowsHTML = [
        ...loreReferences.map(
            reference => `
                <tr>
                    <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); font-weight: 700;">
                        ${escapeHTML(reference.label)}
                    </td>
                    <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); font-weight: 700;">
                        DC ${escapeHTML(reference.dc)}
                    </td>
                </tr>
            `,
        ),
        ...loreResults.map(result => statisticRowHTML(result.label, result.rankLetter, "font-weight: 600;", result.total)),
    ].join("");

    return `
        <section class="pf2e-exploration-automation investigate-result">
            <header style="margin-bottom: 0.6rem;">
                <strong>${escapeHTML(subject ?? "Investigation")}</strong>
            </header>

            <p style="margin: 0 0 0.6rem;">
                Natural roll: <strong>${escapeHTML(naturalRoll)}</strong>
                ${FORCED_NATURAL_ROLL !== null ? "<em> (forced test value)</em>" : ""}
            </p>

            ${
                ordinaryResults.length > 0
                    ? `
                        <h4 style="margin: 0.7rem 0 0.3rem;">Skill Results</h4>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Statistic</th>
                                    <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Result</th>
                                </tr>
                            </thead>
                            <tbody>${ordinaryRowsHTML}</tbody>
                        </table>
                    `
                    : ""
            }

            ${
                loreReferences.length > 0
                    ? `
                        <h4 style="margin: 0.7rem 0 0.3rem;">Lore</h4>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Statistic</th>
                                    <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">DC / Result</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${loreRowsHTML}
                                ${
                                    loreResults.length === 0
                                        ? `
                                            <tr>
                                                <td colspan="2" style="padding: 0.4rem; font-style: italic;">
                                                    This actor has no Lore skills.
                                                </td>
                                            </tr>
                                        `
                                        : ""
                                }
                            </tbody>
                        </table>
                    `
                    : ""
            }

            ${hint ? `<p style="margin-top: 0.7rem; font-style: italic;">${escapeHTML(hint)}</p>` : ""}
        </section>
    `;
}

export async function runInvestigateRoll({ actor = null, token = null, behavior = null, event = null, region = null, scene = null, debug = true } = {}) {
    const tokenDocument = token?.document ?? token ?? null;

    if (!actor || !tokenDocument || !behavior) {
        const result = { ok: false, reason: "incomplete-context", actor, token: tokenDocument, behavior };
        console.error("Region Automation | Investigation roll helper received incomplete context", result);
        return result;
    }

    const config = behavior.flags?.[MODULE_ID]?.config ?? {};
    const baseDC = Number(config.baseDC);

    if (!Number.isFinite(baseDC)) {
        const result = { ok: false, reason: "invalid-base-dc", baseDC: config.baseDC };
        console.error("Region Automation | Invalid Investigation base DC", result);
        return result;
    }

    const { loreReferences, ordinaryRows } = resolveConfiguredSkills(actor, baseDC, config.skills ?? {});

    if (ordinaryRows.length === 0 && loreReferences.length === 0) {
        const result = { ok: false, reason: "no-configured-statistics", config };
        console.warn("Region Automation | Investigation contains no configured statistics", result);
        return result;
    }

    /*
     * Every actual Lore statistic is rolled once. It is not assigned
     * to either Specified Lore or Unspecified Lore — the GM compares
     * the Lore total manually against the reference DCs.
     */
    const loreStatistics =
        loreReferences.length > 0
            ? Object.values(actor.skills ?? {})
                  .filter(statistic => statistic?.lore === true)
                  .sort((left, right) => String(left.label ?? left.slug).localeCompare(String(right.label ?? right.slug)))
            : [];

    /*
     * Roll exactly one d20 and reuse it for every configured statistic.
     */
    let d20Roll = null;
    let naturalRoll;

    if (Number.isInteger(FORCED_NATURAL_ROLL) && FORCED_NATURAL_ROLL >= 1 && FORCED_NATURAL_ROLL <= 20) {
        naturalRoll = FORCED_NATURAL_ROLL;
    } else {
        d20Roll = await new Roll("1d20").evaluate();
        naturalRoll = Number(d20Roll.total);
    }

    const ordinaryResults = ordinaryRows.map(row => {
        const resolved = resolveStatistic(row.statistic, naturalRoll);
        const degree = getDegreeOfSuccess(resolved.total, row.dc, naturalRoll);
        return { type: "ordinary", ...resolved, dc: row.dc, difficulty: row.difficulty, degree };
    });

    const loreResults = loreStatistics.map(statistic => {
        const resolved = resolveStatistic(statistic, naturalRoll);
        return { type: "lore", ...resolved, dc: null, difficulty: null, degree: null };
    });

    const activeGMs = getActiveGMs();

    if (activeGMs.length === 0) {
        const result = { ok: false, reason: "no-active-gm" };
        console.error("Region Automation | No active GM can receive the Investigation result", result);
        return result;
    }

    const message = await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor.name ?? tokenDocument.name ?? "Investigation" },
        whisper: activeGMs.map(user => user.id),
        content: buildContent({
            subject: config.subject,
            naturalRoll,
            ordinaryResults,
            loreReferences,
            loreResults,
            hint: config.hint,
        }),
    });

    /*
     * Publish successful technical execution. Individual PF2e
     * failures or critical failures are normal results and do not
     * change this object's ok status.
     */
    const result = {
        ok: true,
        reason: "rolled",
        naturalRoll,
        roll: d20Roll,
        loreReferences,
        ordinaryResults,
        loreResults,
        message,
        actorUuid: actor.uuid,
        tokenUuid: tokenDocument.uuid,
        behaviorUuid: behavior.uuid,
        regionUuid: region?.uuid ?? null,
        sceneUuid: scene?.uuid ?? null,
        eventName: event?.name ?? null,
    };

    if (debug) {
        console.group(`Region Automation | Investigation roll helper | ${actor.name}`);
        console.log("Natural d20", naturalRoll);
        console.table(loreReferences.map(reference => ({ category: reference.label, dc: reference.dc, difficulty: reference.difficulty })));
        console.table(
            ordinaryResults.map(result => ({
                statistic: result.label,
                rank: result.rankLetter,
                modifier: result.modifier,
                natural: naturalRoll,
                total: result.total,
                dc: result.dc,
                degree: result.degree,
                breakdown: result.breakdown,
            })),
        );
        console.table(
            loreResults.map(result => ({
                lore: result.label,
                rank: result.rankLetter,
                modifier: result.modifier,
                natural: naturalRoll,
                total: result.total,
                breakdown: result.breakdown,
            })),
        );
        console.log("Complete helper result", result);
        console.groupEnd();
    }

    return result;
}
