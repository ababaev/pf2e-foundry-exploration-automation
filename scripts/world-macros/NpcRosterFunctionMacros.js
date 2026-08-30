import { runTriggeredCheck } from "./shared/trigger-flow.js";
import { runNpcRosterRoll } from "./NpcRosterRollHelperMacros.js";

function validateConfig(config) {
    return { ok: Array.isArray(config.npcs) && config.npcs.length > 0 };
}

export async function runNpcRoster({ behavior = null, event = null, region = null, scene = null, token = null, actor = null, skipRegistration = false } = {}) {
    return runTriggeredCheck({
        label: "NPC Roster Search",
        activity: "npc-roster",
        explorationActivity: "search",
        skipRegistration,
        behavior,
        event,
        region,
        scene,
        token,
        actor,
        validateConfig,
        runRoll: context => runNpcRosterRoll(context),
    });
}
