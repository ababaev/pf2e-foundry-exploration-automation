import { runTriggeredCheck } from "./shared/trigger-flow.js";
import { runInvestigateRoll } from "./InvestigateRollHelperMacros.js";

function validateConfig(config) {
    const baseDC = Number(config.baseDC);
    return { ok: Number.isFinite(baseDC) && Number.isInteger(baseDC) };
}

export async function runInvestigate({ behavior = null, event = null, region = null, scene = null, token = null, actor = null } = {}) {
    await runTriggeredCheck({
        label: "Investigation",
        activity: "investigate",
        behavior,
        event,
        region,
        scene,
        token,
        actor,
        validateConfig,
        runRoll: context => runInvestigateRoll(context),
    });
}
