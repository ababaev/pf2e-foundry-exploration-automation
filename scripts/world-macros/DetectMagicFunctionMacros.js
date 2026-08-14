import { runTriggeredCheck } from "./shared/trigger-flow.js";
import { runDetectMagicRoll, resolveConfiguredSkills } from "./DetectMagicRollHelperMacros.js";

function validateConfig(config) {
    const baseDC = Number(config.baseDC);

    const ok =
        Boolean(String(config.subject ?? "").trim()) &&
        Boolean(String(config.detection ?? "").trim()) &&
        Number.isFinite(baseDC) &&
        Number.isInteger(baseDC) &&
        resolveConfiguredSkills(baseDC, config.skills ?? {}).length > 0;

    return { ok };
}

export async function runDetectMagic({ behavior = null, event = null, region = null, scene = null, token = null, actor = null, skipRegistration = false } = {}) {
    return runTriggeredCheck({
        label: "Detect Magic",
        activity: "detect-magic",
        skipRegistration,
        behavior,
        event,
        region,
        scene,
        token,
        actor,
        validateConfig,
        runRoll: context => runDetectMagicRoll(context),
    });
}
