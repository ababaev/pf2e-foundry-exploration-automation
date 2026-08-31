import { escapeHTML } from "./shared/html.js";
import { getActiveGMs } from "./shared/gm.js";
import { getNaturalD20 } from "./SearchRollHelperMacros.js";
import { resolveNpcRow, npcRowHTML } from "./shared/npc-roster.js";
import { MODULE_ID } from "../module-id.js";

const STATISTIC_SLUG = "perception";
const STATISTIC_LABEL = "Perception";

/*
 * Unlike Search's roll options (copied verbatim from this codebase's own
 * working native-Seek call), there's no existing precedent here for Avoid
 * Notice's roll options — this is a best-effort set, unverified against a
 * real PF2e install. Covers both an "action:avoid-notice" and an
 * "action:hide" form since Avoid Notice is mechanically a Hide-like Stealth
 * roll, the same "cover both forms" approach Search already takes for
 * target:undetected/target:condition:undetected.
 */
const AVOID_NOTICE_ROLL_OPTIONS = Object.freeze([
    "action:avoid-notice",
    "action:hide",
    "avoid-notice",
    "pf2e-exploration-automation",
    "pf2e-exploration-automation:npc-roster",
    "pf2e-exploration-automation:npc-roster:avoid-notice",
]);

function buildContent({ naturalRoll, total, rows, breakdown }) {
    const rowsHTML = rows.map(npcRowHTML).join("");

    return `
        <section class="pf2e-exploration-automation npc-roster-avoid-notice-result">
            <header style="margin-bottom: 0.6rem;">
                <strong>NPC Roster Avoid Notice</strong>
            </header>

            <p style="margin: 0 0 0.6rem;">
                Stealth total: <strong>${escapeHTML(total)}</strong>
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
        </section>
    `;
}

/**
 * Rolls the entering character's Stealth exactly once and compares it
 * against every roster NPC's own passive Perception DC (10 + their
 * Perception modifier) — the reverse of
 * NpcRosterSearchRollHelperMacros.js's Perception-vs-every-NPC's-Stealth
 * check.
 */
export async function runNpcRosterAvoidNoticeRoll({ actor = null, token = null, behavior = null, event = null, region = null, scene = null, debug = true } = {}) {
    const tokenDocument = token?.document ?? token ?? null;

    if (!actor || !tokenDocument || !behavior) {
        const result = { ok: false, reason: "incomplete-context", actor, token: tokenDocument, behavior };
        console.error("Region Automation | NPC Roster Avoid Notice roll helper received incomplete context", result);
        return result;
    }

    const config = behavior.flags?.[MODULE_ID]?.config ?? {};
    const npcs = Array.isArray(config.npcs) ? config.npcs : [];

    if (npcs.length === 0) {
        const result = { ok: false, reason: "empty-roster" };
        console.warn("Region Automation | NPC Roster Avoid Notice has no roster NPCs configured", result);
        return result;
    }

    const stealthStatistic = actor.getStatistic?.("stealth") ?? actor.stealth ?? null;

    if (!stealthStatistic) {
        const result = { ok: false, reason: "stealth-statistic-not-found", actorUuid: actor.uuid };
        console.error("Region Automation | Stealth statistic was not found", result);
        return result;
    }

    if (typeof stealthStatistic.roll !== "function") {
        const result = { ok: false, reason: "stealth-roll-not-supported", actorUuid: actor.uuid };
        console.error("Region Automation | Stealth statistic does not support .roll()", result);
        return result;
    }

    const activeGMs = getActiveGMs();

    if (activeGMs.length === 0) {
        const result = { ok: false, reason: "no-active-gm" };
        console.error("Region Automation | No active GM can receive the NPC Roster Avoid Notice result", result);
        return result;
    }

    const stealthRoll = await stealthStatistic.roll({
        skipDialog: true,
        createMessage: false,
        messageMode: "blindroll",
        title: "NPC Roster Avoid Notice",
        slug: "pf2e-exploration-automation-npc-roster-avoid-notice",
        extraRollOptions: AVOID_NOTICE_ROLL_OPTIONS,
    });

    if (!stealthRoll) {
        const result = { ok: false, reason: "stealth-roll-returned-null", actorUuid: actor.uuid };
        console.error("Region Automation | PF2e returned no Stealth roll", result);
        return result;
    }

    const naturalRoll = getNaturalD20(stealthRoll);
    const total = Number(stealthRoll.total);

    const resolvedStatistic =
        typeof stealthStatistic.withRollOptions === "function"
            ? stealthStatistic.withRollOptions({ extraRollOptions: AVOID_NOTICE_ROLL_OPTIONS })
            : stealthStatistic;
    const breakdown = resolvedStatistic.check?.breakdown ?? "";

    const rows = await Promise.all(
        npcs.map(npc => resolveNpcRow(npc, { statisticSlug: STATISTIC_SLUG, statisticLabel: STATISTIC_LABEL, total, naturalRoll })),
    );

    const message = await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: actor.name ?? tokenDocument.name ?? "NPC Roster Avoid Notice" },
        whisper: activeGMs.map(user => user.id),
        content: buildContent({ naturalRoll, total, rows, breakdown }),
    });

    const result = {
        ok: true,
        reason: "rolled",
        naturalRoll,
        total,
        roll: stealthRoll,
        rows,
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
        console.group(`Region Automation | NPC Roster Avoid Notice roll helper | ${actor.name}`);
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
