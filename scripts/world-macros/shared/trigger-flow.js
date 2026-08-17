/**
 * PF2e Exploration Automation
 * scripts/world-macros/shared/trigger-flow.js
 *
 * The orchestration every ported activity's FunctionMacro repeats:
 *
 * 1. Resolve the tokenEnter event's region/scene/token/actor.
 * 2. Confirm the Behavior carries this activity's functionality flag
 *    and a valid config.
 * 3. Gate on the actor currently performing the matching exploration
 *    activity (checkExplorationActivity). Skipped entirely when
 *    requireExplorationActivity is false — Saving Throw (and other
 *    Region triggers that aren't tied to a PF2e exploration activity
 *    a player selects) fires regardless of what the actor is doing.
 * 4. One-shot register the token against this Behavior
 *    (registerTokenTrigger). Skipped entirely when skipRegistration is
 *    true — used by on-demand, GM-initiated runs (e.g. "run this
 *    Region's checks for the whole party right now") that have no
 *    physical Region entry to dedupe against and should be free to
 *    run again whenever the GM wants.
 * 5. Run the activity's own secret check.
 * 6. Roll back the registration on technical failure only — a failed
 *    or critically failed check is a normal, successful run. Skipped
 *    when registration itself was skipped (nothing to roll back).
 * 7. On a successful roll, duplicate its whispered chat message into the
 *    GM-only log Journal (shared/gm-log.js) — every activity's RollHelper
 *    result already carries the created ChatMessage, so this is generic
 *    and needs no per-activity wiring.
 */

import { MODULE_ID } from "../../module-id.js";
import { checkExplorationActivity } from "../ExplorationActivityMacros.js";
import { registerTokenTrigger } from "../RegistrationMacros.js";
import { logToGMJournal } from "./gm-log.js";

async function callWithResultBox(fn, args) {
    const resultBox = { value: null };
    await fn({ ...args, resultBox });
    return resultBox.value;
}

async function rollBackTriggeredToken({ label, behavior, token }) {
    /*
     * token is typically the Token placeable passed through from the
     * Region event (event.data.token), whose uuid lives at .document.uuid,
     * not directly on the placeable itself — the same unwrapping
     * registerTokenTrigger already does before it stores this token's
     * uuid in the first place.
     */
    const tokenUuid = token?.document?.uuid ?? token?.uuid ?? null;

    try {
        const current = behavior.flags?.[MODULE_ID]?.triggeredTokenUuids;
        const updated = Array.isArray(current) ? current.filter(uuid => uuid !== tokenUuid) : [];

        await behavior.update({ [`flags.${MODULE_ID}.triggeredTokenUuids`]: updated });

        console.warn(`Region Automation | ${label} registration rolled back after technical failure`, {
            tokenUuid,
            behaviorUuid: behavior.uuid,
        });
    } catch (rollbackError) {
        console.error(`Region Automation | ${label} registration rollback failed`, rollbackError);
    }
}

/**
 * @param {string} label - Human-readable activity name for logs/notifications, e.g. "Search".
 * @param {string} activity - Functionality flag this Behavior's flags.functionality must match, e.g. "search". Also used as the exploration-activity slug for the checkExplorationActivity gate unless `requireExplorationActivity` is false.
 * @param {boolean} [requireExplorationActivity] - Whether the actor must currently be performing the `activity` exploration activity. Defaults to true; pass false for triggers not tied to a selectable PF2e exploration activity (e.g. Saving Throw), which then fire regardless of what the actor is doing.
 * @param {boolean} [skipRegistration] - Skip the one-shot triggeredTokenUuids registration (and its technical-failure rollback) entirely. Defaults to false; pass true for on-demand runs with no physical Region entry to dedupe against.
 * @param {object} behavior - RegionBehavior document.
 * @param {object} event - Region event ({ name, data: { token }, ... }).
 * @param {object} region - Region document (falls back to event.region).
 * @param {object} scene - Scene document (falls back to region.parent / canvas.scene).
 * @param {object} token - TokenDocument (falls back to event.data.token).
 * @param {object} actor - Actor document (falls back to token.actor).
 * @param {(config: object) => { ok: boolean }} validateConfig - Validates behavior.flags[MODULE_ID].config.
 * @param {(context: { actor, token, behavior, event, region, scene }) => Promise<{ ok: boolean }>} runRoll
 * @returns {Promise<{ ok: boolean, rolled: boolean, reason: string, result?: object }>} `rolled` is true only
 *   when `runRoll` actually executed and returned `{ ok: true }` — everything gated out earlier (wrong event,
 *   invalid config, exploration-activity gate, already registered) comes back `rolled: false` with a `reason`
 *   instead, which callers that need to know whether a check actually happened (e.g. a batch "run this Region
 *   for every token" trigger) can inspect. Nothing currently ignores this return value, but nothing besides the
 *   batch trigger consumes it either — it's safe to add to.
 */
export async function runTriggeredCheck({
    label,
    activity,
    requireExplorationActivity = true,
    skipRegistration = false,
    behavior = null,
    event = null,
    region = null,
    scene = null,
    token = null,
    actor = null,
    validateConfig,
    runRoll,
}) {
    const resolvedRegion = region ?? event?.region ?? null;
    const resolvedScene = scene ?? resolvedRegion?.parent ?? canvas?.scene ?? null;
    const resolvedToken = event?.data?.token ?? token ?? null;
    const resolvedActor = resolvedToken?.actor ?? actor ?? null;

    console.log(`Region Automation | ${label} started`, {
        event,
        behavior,
        region: resolvedRegion,
        scene: resolvedScene,
        token: resolvedToken,
        actor: resolvedActor,
        executingUser: game.user,
    });

    if (event?.name !== "tokenEnter") {
        console.debug(`Region Automation | Ignored ${label} event`, event?.name);
        return { ok: true, rolled: false, reason: "ignored-event" };
    }

    if (!behavior || !resolvedRegion || !resolvedScene || !resolvedToken || !resolvedActor) {
        const context = {
            behavior,
            event,
            region: resolvedRegion,
            scene: resolvedScene,
            token: resolvedToken,
            actor: resolvedActor,
        };

        console.error(`Region Automation | Incomplete ${label} context`, context);

        if (game.user.isGM) {
            ui.notifications.error(`Region Automation: ${label} received incomplete context. See the console.`);
        }

        return { ok: false, rolled: false, reason: "incomplete-context" };
    }

    const moduleData = behavior.flags?.[MODULE_ID] ?? {};

    if (moduleData.functionality !== activity) {
        console.error(`Region Automation | ${label} Behavior has the wrong functionality flag`, {
            behavior,
            functionality: moduleData.functionality,
        });

        return { ok: false, rolled: false, reason: "wrong-functionality-flag" };
    }

    const config = moduleData.config ?? {};

    if (!validateConfig(config)?.ok) {
        console.error(`Region Automation | ${label} Behavior has invalid configuration`, { behavior, config });

        if (game.user.isGM) {
            ui.notifications.error(`Region Automation: this ${label} Behavior has invalid configuration.`);
        }

        return { ok: false, rolled: false, reason: "invalid-configuration" };
    }

    /*
     * Step 1: exploration activity gate. Skipped when
     * requireExplorationActivity is false.
     */
    if (requireExplorationActivity) {
        let explorationResult;

        try {
            explorationResult = await callWithResultBox(checkExplorationActivity, {
                token: resolvedToken,
                actor: resolvedActor,
                activity,
                debug: true,
            });
        } catch (error) {
            console.error(`Region Automation | ${label} exploration activity check failed`, error);

            if (game.user.isGM) {
                ui.notifications.error(`Region Automation: the ${label} exploration activity check failed. See the console.`);
            }

            return { ok: false, rolled: false, reason: "exploration-activity-check-failed" };
        }

        if (!explorationResult?.ok) {
            console.error(`Region Automation | ${label} exploration activity could not be checked`, explorationResult);
            return { ok: false, rolled: false, reason: "exploration-activity-could-not-be-checked" };
        }

        if (!explorationResult.active) {
            console.info(`Region Automation | ${resolvedActor.name} is not performing ${label}; execution stopped.`, explorationResult);
            return { ok: true, rolled: false, reason: "not-performing-activity" };
        }

        console.log(`Region Automation | ${resolvedActor.name} is performing ${label}; continuing.`, explorationResult);
    }

    /*
     * Step 2: one-shot register this token against this Behavior.
     * Skipped entirely for on-demand runs (skipRegistration).
     */
    if (!skipRegistration) {
        let registrationResult;

        try {
            registrationResult = await callWithResultBox(registerTokenTrigger, {
                behavior,
                token: resolvedToken,
                debug: true,
            });
        } catch (error) {
            console.error(`Region Automation | ${label} registration failed`, error);

            if (game.user.isGM) {
                ui.notifications.error(`Region Automation: ${label} registration failed. See the console.`);
            }

            return { ok: false, rolled: false, reason: "registration-failed" };
        }

        if (!registrationResult?.ok) {
            console.error(`Region Automation | ${label} token registration was unsuccessful`, registrationResult);

            if (game.user.isGM) {
                ui.notifications.error(`Region Automation: the ${label} token could not be registered.`);
            }

            return { ok: false, rolled: false, reason: "registration-unsuccessful" };
        }

        if (!registrationResult.firstTrigger) {
            console.info(
                `Region Automation | ${resolvedToken.name} has already triggered this ${label}; execution stopped.`,
                registrationResult,
            );

            return { ok: true, rolled: false, reason: "already-triggered" };
        }
    }

    /*
     * Step 3: the activity's own secret check.
     */
    let rollResult;

    try {
        rollResult = await runRoll({
            actor: resolvedActor,
            token: resolvedToken,
            behavior,
            event,
            region: resolvedRegion,
            scene: resolvedScene,
        });
    } catch (error) {
        console.error(`Region Automation | ${label} roll helper failed`, error);

        if (!skipRegistration) await rollBackTriggeredToken({ label, behavior, token: resolvedToken });

        if (game.user.isGM) {
            ui.notifications.error(
                `Region Automation: the ${label} roll helper failed.${skipRegistration ? "" : " Registration was rolled back."}`,
            );
        }

        return { ok: false, rolled: false, reason: "roll-helper-failed" };
    }

    if (!rollResult?.ok) {
        console.error(`Region Automation | ${label} automation was technically unsuccessful`, rollResult);

        if (!skipRegistration) await rollBackTriggeredToken({ label, behavior, token: resolvedToken });

        if (game.user.isGM) {
            ui.notifications.error(
                `Region Automation: ${label} could not complete.${skipRegistration ? "" : " Registration was rolled back."}`,
            );
        }

        return { ok: false, rolled: false, reason: "roll-unsuccessful" };
    }

    console.log(`Region Automation | ${label} completed`, rollResult);

    if (rollResult.message?.content) {
        await logToGMJournal({
            regionName: resolvedRegion?.name ?? "Unknown Region",
            actorName: resolvedActor?.name ?? "Unknown Character",
            content: rollResult.message.content,
        });
    }

    return { ok: true, rolled: true, reason: "completed", result: rollResult };
}
