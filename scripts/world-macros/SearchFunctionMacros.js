import { runTriggeredCheck } from "./shared/trigger-flow.js";
import { runSearchRoll } from "./SearchRollHelperMacros.js";

function validateConfig(config) {
    const dc = Number(config.dc);
    return { ok: Number.isFinite(dc) && Number.isInteger(dc) };
}

export async function runSearch({ behavior = null, event = null, region = null, scene = null, token = null, actor = null, skipRegistration = false } = {}) {
    return runTriggeredCheck({
        label: "Search",
        activity: "search",
        skipRegistration,
        behavior,
        event,
        region,
        scene,
        token,
        actor,
        validateConfig,
        runRoll: context => runSearchRoll(context),
    });
}
