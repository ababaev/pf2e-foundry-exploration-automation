import { runTriggeredCheck } from "./shared/trigger-flow.js";
import { runSavingThrowRoll } from "./SavingThrowRollHelperMacros.js";

const VALID_SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);

function validateConfig(config) {
    const subject = String(config.subject ?? "").trim();
    const saveType = String(config.saveType ?? "").trim();
    const dc = Number(config.dc);
    return { ok: Boolean(subject) && VALID_SAVE_TYPES.has(saveType) && Number.isFinite(dc) && Number.isInteger(dc) };
}

/**
 * Saving Throw has no exploration-activity gate
 * (requireExplorationActivity: false) — unlike Search/Investigate/
 * Detect Magic, it isn't tied to a PF2e exploration activity a player
 * selects; it fires for any token that enters the Region. `activity`
 * is still "saving-throw" since it must match the Behavior's own
 * functionality flag.
 */
export async function runSavingThrow({ behavior = null, event = null, region = null, scene = null, token = null, actor = null, skipRegistration = false } = {}) {
    return runTriggeredCheck({
        label: "Saving Throw",
        activity: "saving-throw",
        requireExplorationActivity: false,
        skipRegistration,
        behavior,
        event,
        region,
        scene,
        token,
        actor,
        validateConfig,
        runRoll: context => runSavingThrowRoll(context),
    });
}
