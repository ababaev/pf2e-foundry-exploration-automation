/**
 * PF2e Exploration Automation
 * scripts/world-macros/shared/npc-roster.js
 *
 * Shared between NpcRosterSearchRollHelperMacros.js (Perception vs. every
 * roster NPC's Stealth) and NpcRosterAvoidNoticeRollHelperMacros.js (Stealth
 * vs. every roster NPC's Perception) — same "resolve one roster entry, build
 * its table row" logic either direction needs, parameterized by which
 * statistic to check on the NPC.
 */

import { escapeHTML } from "./html.js";
import { getDegreeOfSuccess, getResultStyle } from "./checks.js";

/**
 * Resolve one roster entry's current Token/Actor and DC (10 + their
 * `statisticSlug` modifier).
 *
 * Returns a row descriptor either way — an entry whose Token can no
 * longer be resolved (deleted from the Scene since being added to the
 * roster) or whose Actor has no matching statistic is reported in the
 * table rather than silently dropped, with `dc`/`degree` left null.
 */
export async function resolveNpcRow(npc, { statisticSlug, statisticLabel, total, naturalRoll }) {
    let tokenDocument = null;

    try {
        tokenDocument = await fromUuid(npc.uuid);
    } catch (error) {
        console.warn("Region Automation | Could not resolve a roster Token", { npc, error });
    }

    const npcActor = tokenDocument?.actor ?? null;

    if (!npcActor) {
        return { npc, statisticLabel, unavailable: true, noStatistic: false, dc: null, degree: null };
    }

    const statistic = npcActor.getStatistic?.(statisticSlug) ?? npcActor.skills?.[statisticSlug] ?? npcActor[statisticSlug] ?? null;

    if (!statistic) {
        return { npc, statisticLabel, unavailable: false, noStatistic: true, dc: null, degree: null };
    }

    const modifier = Number(statistic.check?.mod ?? statistic.mod ?? 0);
    const dc = 10 + modifier;
    const degree = getDegreeOfSuccess(total, dc, naturalRoll);

    return { npc, statisticLabel, unavailable: false, noStatistic: false, dc, degree };
}

export function npcRowHTML(row) {
    const label = escapeHTML(row.npc.name ?? "Unknown NPC");

    if (row.unavailable) {
        return `
            <tr>
                <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                    ${label}
                </td>
                <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); font-style: italic; opacity: 0.7;">
                    Token no longer available
                </td>
            </tr>
        `;
    }

    if (row.noStatistic) {
        return `
            <tr>
                <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                    ${label}
                </td>
                <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); font-style: italic; opacity: 0.7;">
                    No ${escapeHTML(row.statisticLabel)} statistic
                </td>
            </tr>
        `;
    }

    return `
        <tr>
            <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary);">
                ${label}
            </td>
            <td style="padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-light-primary); ${getResultStyle(row.degree)}">
                vs DC ${escapeHTML(row.dc)}
            </td>
        </tr>
    `;
}
