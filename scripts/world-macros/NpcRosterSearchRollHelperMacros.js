import { escapeHTML } from "./shared/html.js";
import { getActiveGMs } from "./shared/gm.js";
import { getNaturalD20, getTargetRollOptions } from "./SearchRollHelperMacros.js";
import { resolveNpcRow, npcRowHTML } from "./shared/npc-roster.js";
import { MODULE_ID } from "../module-id.js";

const STATISTIC_SLUG = "stealth";
const STATISTIC_LABEL = "Stealth";

function buildContent({ naturalRoll, total, rows, hasSenseTheUnseen, breakdown }) {
    const rowsHTML = rows.map(npcRowHTML).join("");

    return `
        <section class="pf2e-exploration-automation npc-roster-search-result">
            <header style="margin-bottom: 0.6rem;">
                <strong>NPC Roster Search</strong>
            </header>

            <p style="margin: 0 0 0.6rem;">
                Perception total: <strong>${escapeHTML(total)}</strong>
                (natural ${escapeHTML(naturalRoll)})
                ${
                    breakdown
                        ? `
                            <br>
                            <span style="font-size: 0.85em; opacity: 0.8;">
                                ${escapeHTML(breakdown)}
                            </span>
                        `
                        : ""
                }
            </p>

            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">NPC</th>
                        <th style="text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--color-border-dark);">Result</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>

            ${
                hasSenseTheUnseen
                    ? `
                        <p style="margin-top: 0.7rem; font-style: italic;">
                            This character has <strong>Sense the Unseen</strong> — consider its effect on any
                            failed results above.
                        </p>
                    `
                    : ""
            }
        </section>
    `;
}

/**
 * Rolls the entering character's Perception exactly once and compares
 * it against every roster NPC's own Stealth DC (10 + their Stealth
 * modifier) — the mirror image of Investigate/DetectMagic's "one
 * shared d20 vs several DCs" pattern, keyed by NPC instead of by
 * skill. See NpcRosterAvoidNoticeRollHelperMacros.js for the reverse
 * direction (Stealth vs. every NPC's passive Perception).
 */
export async function runNpcRosterSearchRoll({ actor = null, token = null, behavior = null, event = null, region = null, scene = null, debug = true } = {}) {
    const tokenDocument = token?.document ?? token ?? null;

    if (!actor || !tokenDocument || !behavior) {
        const result = { ok: false, reason: "incomplete-context", actor, token: tokenDocument, behavior };
        console.error("Region Automation | NPC Roster Search roll helper received incomplete context", result);
        return result;
    }

    const config = behavior.flags?.[MODULE_ID]?.config ?? {};
    const npcs = Array.isArray(config.npcs) ? config.npcs : [];

    if (npcs.length === 0) {
        const result = { ok: false, reason: "empty-roster" };
        console.warn("Region Automation | NPC Roster Search has no roster NPCs configured", result);
        return result;
    }

    const perceptionStatistic = actor.getStatistic?.("perception") ?? actor.perception ?? null;

    if (!perceptionStatistic) {
        const result = { ok: false, reason: "perception-statistic-not-found", actorUuid: actor.uuid };
        console.error("Region Automation | Perception statistic was not found", result);
        return result;
    }

    if (typeof perceptionStatistic.roll !== "function") {
        const result = { ok: false, reason: "perception-roll-not-supported", actorUuid: actor.uuid };
        console.error("Region Automation | Perception statistic does not support .roll()", result);
        return result;
    }

    const activeGMs = getActiveGMs();

    if (activeGMs.length === 0) {
        const result = { ok: false, reason: "no-active-gm" };
        console.error("Region Automation | No active GM can receive the NPC Roster Search result", result);
        return result;
    }

    const rollOptions = getTargetRollOptions("npc");

    /*
     * Rolling through PF2e's own Check API (rather than a raw
     * new Roll("1d20")) — with the same roll options native Seek uses
     * for an NPC target — is what lets PF2e's own Rule Elements for
     * Keen Eyes, Sensate Gnome, Sharp-Eared Catfolk, etc. apply
     * automatically, exactly like the single-target Search automation
     * already gets via its native Seek action call.
     */
    const perceptionRoll = await perceptionStatistic.roll({
        skipDialog: true,
        createMessage: false,
        messageMode: "blindroll",
        title: "NPC Roster Search",
        slug: "pf2e-exploration-automation-npc-roster-search",
        extraRollOptions: rollOptions,
    });

    if (!perceptionRoll) {
        const result = { ok: false, reason: "perception-roll-returned-null", actorUuid: actor.uuid };
        console.error("Region Automation | PF2e returned no Perception roll", result);
        return result;
    }

    const naturalRoll = getNaturalD20(perceptionRoll);
    const total = Number(perceptionRoll.total);
    const hasSenseTheUnseen = Boolean(actor.items?.find?.(item => item.slug === "sense-the-unseen"));

    /*
     * A second, read-only resolution of the same roll options (same
     * pattern InvestigateRollHelperMacros.js's resolveStatistic()
     * uses) purely to read off .check.breakdown — the human-readable
     * "which modifiers actually applied" string PF2e computes, so the
     * GM can see *why* the total is what it is (Keen Eyes, Sensate
     * Gnome, Sharp-Eared Catfolk, etc.) instead of just a number. This
     * doesn't affect the roll itself, which already happened above.
     */
    const resolvedStatistic =
        typeof perceptionStatistic.withRollOptions === "function"
            ? perceptionStatistic.withRollOptions({ extraRollOptions: rollOptions })
            : perceptionStatistic;
    const breakdown = resolvedStatistic.check?.breakdown ?? "";

    const rows = await Promise.all(
        npcs.map(npc => resolveNpcRow(npc, { statisticSlug: STATISTIC_SLUG, statisticLabel: STATISTIC_LABEL, total, naturalRoll })),
    );

    const message = await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor.name ?? tokenDocument.name ?? "NPC Roster Search" },
        whisper: activeGMs.map(user => user.id),
        content: buildContent({ naturalRoll, total, rows, hasSenseTheUnseen, breakdown }),
    });

    const result = {
        ok: true,
        reason: "rolled",
        naturalRoll,
        total,
        roll: perceptionRoll,
        rows,
        hasSenseTheUnseen,
        breakdown,
        message,
        actorUuid: actor.uuid,
        tokenUuid: tokenDocument.uuid,
        behaviorUuid: behavior.uuid,
        regionUuid: region?.uuid ?? null,
        sceneUuid: scene?.uuid ?? null,
        eventName: event?.name ?? null,
    };

    if (debug) {
        console.group(`Region Automation | NPC Roster Search roll helper | ${actor.name}`);
        console.log("Natural d20", naturalRoll, "Total", total);
        console.table(
            rows.map(row => ({
                npc: row.npc.name,
                dc: row.dc,
                degree: row.degree,
                unavailable: row.unavailable ?? false,
                noStatistic: row.noStatistic ?? false,
            })),
        );
        console.log("Complete helper result", result);
        console.groupEnd();
    }

    return result;
}
