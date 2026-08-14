import { escapeHTML } from "./shared/html.js";
import { DIFFICULTIES, DC_ADJUSTMENTS, RANK_LETTERS, getDegreeOfSuccess, getResultStyle } from "./shared/checks.js";
import { getActiveGMs } from "./shared/gm.js";
import { MODULE_ID } from "../module-id.js";

/*
 * Normally leave this as null. Set it to 1 or 20 only when testing
 * natural-roll behavior.
 */
const FORCED_NATURAL_ROLL = null;

export const VALID_IDENTIFICATION_SKILLS = new Set(["arcana", "nature", "occultism", "religion"]);

/**
 * Convert the seven difficulty columns into one entry per configured
 * identification skill, each carrying its own adjusted DC.
 */
export function resolveConfiguredSkills(baseDC, configuredSkills) {
    const resolved = [];
    const seen = new Set();

    for (const difficulty of DIFFICULTIES) {
        const slugs = Array.isArray(configuredSkills[difficulty]) ? configuredSkills[difficulty] : [];

        for (const slug of slugs) {
            if (!VALID_IDENTIFICATION_SKILLS.has(slug) || seen.has(slug)) continue;

            seen.add(slug);
            resolved.push({ slug, difficulty, adjustment: DC_ADJUSTMENTS[difficulty], dc: baseDC + DC_ADJUSTMENTS[difficulty] });
        }
    }

    return resolved;
}

function resolveStatistic(actor, configured) {
    const baseStatistic = actor.getStatistic?.(configured.slug) ?? actor.skills?.[configured.slug] ?? null;

    if (!baseStatistic) return null;

    /*
     * PF2e Identify Magic uses the statistic-specific action roll
     * option.
     */
    const rollOptions = ["action:identify-magic", `action:identify-magic:${configured.slug}`];

    let resolvedStatistic = baseStatistic;

    if (typeof baseStatistic.withRollOptions === "function") {
        try {
            resolvedStatistic = baseStatistic.withRollOptions({ extraRollOptions: rollOptions });
        } catch (error) {
            console.warn(`Region Automation | Could not rebuild ${configured.slug} with Identify Magic roll options`, error);
            resolvedStatistic = baseStatistic;
        }
    }

    return { baseStatistic, resolvedStatistic, rollOptions };
}

function buildContent({ subject, detection, naturalRoll, skillResults, hint }) {
    const resultRows = skillResults
        .map(
            skill => `
                <tr>
                    <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                        ${escapeHTML(skill.label)} (${escapeHTML(skill.rankLetter)})
                    </td>
                    <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); ${getResultStyle(skill.degree)}">
                        ${escapeHTML(skill.total)} vs DC ${escapeHTML(skill.dc)}
                    </td>
                </tr>
            `,
        )
        .join("");

    return `
        <section class="pf2e-exploration-automation detect-magic-result">
            <header style="margin-bottom: 0.6rem;">
                <strong>${escapeHTML(subject)}</strong>
            </header>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 0.7rem;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Detection</th>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Result</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); font-weight: 600;">Detect Magic</td>
                        <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); color: #6f42c1; font-weight: 700;">
                            ${escapeHTML(detection)}
                        </td>
                    </tr>
                </tbody>
            </table>

            <p style="margin: 0 0 0.6rem;">
                Identification natural roll: <strong>${escapeHTML(naturalRoll)}</strong>
                ${FORCED_NATURAL_ROLL !== null ? "<em> (forced test value)</em>" : ""}
            </p>

            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Identification Skill</th>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Result</th>
                    </tr>
                </thead>
                <tbody>${resultRows}</tbody>
            </table>

            ${hint ? `<p style="margin-top: 0.7rem; font-style: italic;">${escapeHTML(hint)}</p>` : ""}
        </section>
    `;
}

export async function runDetectMagicRoll({ actor = null, token = null, behavior = null, event = null, region = null, scene = null, debug = true } = {}) {
    const tokenDocument = token?.document ?? token ?? null;

    if (!actor || !tokenDocument || !behavior) {
        const result = { ok: false, reason: "incomplete-context", actor, token: tokenDocument, behavior };
        console.error("Region Automation | Detect Magic roll helper received incomplete context", result);
        return result;
    }

    const config = behavior.flags?.[MODULE_ID]?.config ?? {};
    const subject = String(config.subject ?? "").trim();
    const detection = String(config.detection ?? "").trim();
    const hint = String(config.hint ?? "").trim();
    const baseDC = Number(config.baseDC);

    if (!subject || !detection || !Number.isFinite(baseDC) || !Number.isInteger(baseDC)) {
        const result = { ok: false, reason: "invalid-configuration", config };
        console.error("Region Automation | Detect Magic roll helper received invalid configuration", result);
        return result;
    }

    const configuredSkills = resolveConfiguredSkills(baseDC, config.skills ?? {});

    if (configuredSkills.length === 0) {
        const result = { ok: false, reason: "no-configured-skills" };
        console.error("Region Automation | Detect Magic has no configured identification skills", result);
        return result;
    }

    /*
     * Roll one d20 and reuse it for every configured tradition.
     */
    let d20Roll = null;
    let naturalRoll;

    if (Number.isInteger(FORCED_NATURAL_ROLL) && FORCED_NATURAL_ROLL >= 1 && FORCED_NATURAL_ROLL <= 20) {
        naturalRoll = FORCED_NATURAL_ROLL;
    } else {
        d20Roll = await new Roll("1d20").evaluate();
        naturalRoll = Number(d20Roll.total);
    }

    const skillResults = [];

    for (const configured of configuredSkills) {
        const resolved = resolveStatistic(actor, configured);

        if (!resolved) {
            console.warn(`Region Automation | Detect Magic could not resolve "${configured.slug}" for ${actor.name}`);
            continue;
        }

        const { baseStatistic, resolvedStatistic, rollOptions } = resolved;
        const modifier = Number(resolvedStatistic.check?.mod ?? resolvedStatistic.mod ?? 0);
        const rank = Number(resolvedStatistic.rank ?? baseStatistic.rank ?? 0);
        const total = naturalRoll + modifier;
        const degree = getDegreeOfSuccess(total, configured.dc, naturalRoll);

        skillResults.push({
            slug: configured.slug,
            label: resolvedStatistic.label ?? baseStatistic.label ?? configured.slug,
            rank,
            rankLetter: RANK_LETTERS[rank] ?? "U",
            modifier,
            total,
            dc: configured.dc,
            difficulty: configured.difficulty,
            adjustment: configured.adjustment,
            degree,
            breakdown: resolvedStatistic.check?.breakdown ?? "",
            rollOptions,
        });
    }

    if (skillResults.length === 0) {
        const result = { ok: false, reason: "statistics-not-found" };
        console.error("Region Automation | No configured Detect Magic statistics could be resolved", result);
        return result;
    }

    const activeGMs = getActiveGMs();

    if (activeGMs.length === 0) {
        const result = { ok: false, reason: "no-active-gm" };
        console.error("Region Automation | No active GM can receive the Detect Magic result", result);
        return result;
    }

    const message = await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor.name ?? tokenDocument.name ?? "Detect Magic" },
        whisper: activeGMs.map(user => user.id),
        content: buildContent({ subject, detection, naturalRoll, skillResults, hint }),
    });

    /*
     * ok: true means the automation completed technically. Individual
     * skill failures remain normal game results.
     */
    const result = {
        ok: true,
        reason: "rolled",
        subject,
        detection,
        hint,
        baseDC,
        naturalRoll,
        roll: d20Roll,
        skillResults,
        message,
        actorUuid: actor.uuid,
        tokenUuid: tokenDocument.uuid,
        behaviorUuid: behavior.uuid,
        regionUuid: region?.uuid ?? null,
        sceneUuid: scene?.uuid ?? null,
        eventName: event?.name ?? null,
    };

    if (debug) {
        console.group(`Region Automation | Detect Magic roll helper | ${actor.name}`);
        console.log("Automatic detection", detection);
        console.log("Natural d20", naturalRoll);
        console.table(
            skillResults.map(skill => ({
                statistic: skill.label,
                rank: skill.rankLetter,
                modifier: skill.modifier,
                natural: naturalRoll,
                total: skill.total,
                dc: skill.dc,
                degree: skill.degree,
                difficulty: skill.difficulty,
                breakdown: skill.breakdown,
            })),
        );
        console.log("Complete Detect Magic result", result);
        console.groupEnd();
    }

    return result;
}
