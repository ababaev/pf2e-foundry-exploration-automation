import { runTriggeredCheck } from "./shared/trigger-flow.js";
import { runNpcRosterSearchRoll } from "./NpcRosterSearchRollHelperMacros.js";
import { runNpcRosterAvoidNoticeRoll } from "./NpcRosterAvoidNoticeRollHelperMacros.js";
import { logToGMJournal } from "./shared/gm-log.js";

function validateConfig(config) {
    return { ok: Array.isArray(config.npcs) && config.npcs.length > 0 };
}

/**
 * A token can be performing Search and Avoid Notice at once — neither is
 * exclusive of the other. Runs whichever of the two applies, independently
 * (zero, one, or both), from the single shared registration
 * runTriggeredCheck already performs once regardless of how many of these
 * fire.
 *
 * runTriggeredCheck's own auto-log step only handles one rollResult.message
 * — there can be two here — so this logs each produced message itself
 * instead; the combined result below deliberately carries no top-level
 * `.message`, so that auto-log step no-ops.
 */
async function runRosterChecks(context) {
    const activities = context.explorationActivities ?? [];
    const entries = [];

    if (activities.includes("search")) {
        entries.push(["search", await runNpcRosterSearchRoll(context)]);
    }

    if (activities.includes("avoid-notice")) {
        entries.push(["avoid-notice", await runNpcRosterAvoidNoticeRoll(context)]);
    }

    for (const [direction, rollResult] of entries) {
        if (!rollResult?.message?.content) continue;

        try {
            await logToGMJournal({
                regionName: context.region?.name ?? "Unknown Region",
                actorName: context.actor?.name ?? "Unknown Character",
                content: rollResult.message.content,
            });
        } catch (error) {
            console.error(`Region Automation | Could not log NPC Roster ${direction} result to the GM journal`, error);
        }
    }

    return {
        ok: entries.length > 0 && entries.every(([, rollResult]) => rollResult?.ok),
        reason: entries.length === 0 ? "no-matching-direction" : "rolled",
        entries: Object.fromEntries(entries),
    };
}

export async function runNpcRoster({ behavior = null, event = null, region = null, scene = null, token = null, actor = null, skipRegistration = false } = {}) {
    return runTriggeredCheck({
        label: "NPC Roster",
        activity: "npc-roster",
        explorationActivity: ["search", "avoid-notice"],
        skipRegistration,
        behavior,
        event,
        region,
        scene,
        token,
        actor,
        validateConfig,
        runRoll: context => runRosterChecks(context),
    });
}
