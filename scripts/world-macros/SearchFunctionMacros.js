import {
    checkExplorationActivity,
} from "./ExplorationActivityMacros.js";

import {
    registerTokenTrigger,
} from "./RegistrationMacros.js";

import {
    runSearchRoll,
} from "./SearchRollHelperMacros.js";

export async function runSearch({
    behavior = null,
    event = null,
    region = null,
    scene = null,
    token = null,
    actor = null,
} = {}) {

    const MODULE_ID =
        "pf2e-exploration-automation";

    const raEvent =
        typeof event !== "undefined"
            ? event
            : null;

    const raBehavior =
        typeof behavior !== "undefined"
            ? behavior
            : null;

    const raRegion =
        (
            typeof region !== "undefined"
                ? region
                : null
        ) ??
        raEvent?.region ??
        null;

    const raScene =
        (
            typeof scene !== "undefined"
                ? scene
                : null
        ) ??
        raRegion?.parent ??
        canvas?.scene ??
        null;

    const raToken =
        raEvent?.data?.token ??
        (
            typeof token !== "undefined"
                ? token
                : null
        );

    const raActor =
        raToken?.actor ??
        (
            typeof actor !== "undefined"
                ? actor
                : null
        );

    console.log(
        "Region Automation | Search started",
        {
            event: raEvent,
            behavior: raBehavior,
            region: raRegion,
            scene: raScene,
            token: raToken,
            actor: raActor,
            executingUser: game.user,
        },
    );

    if (raEvent?.name !== "tokenEnter") {
        console.debug(
            "Region Automation | Ignored Search event",
            raEvent?.name,
        );

        return;
    }

    if (
        !raBehavior ||
        !raRegion ||
        !raScene ||
        !raToken ||
        !raActor
    ) {
        console.error(
            "Region Automation | Incomplete Search context",
            {
                behavior: raBehavior,
                event: raEvent,
                region: raRegion,
                scene: raScene,
                token: raToken,
                actor: raActor,
            },
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Search received incomplete context. See the console.",
            );
        }

        return;
    }

    const moduleData =
        raBehavior.flags?.[MODULE_ID] ??
        {};

    if (
        moduleData.functionality !==
        "search"
    ) {
        console.error(
            "Region Automation | Search behavior has the wrong functionality flag",
            {
                behavior: raBehavior,
                functionality:
                    moduleData.functionality,
            },
        );

        return;
    }

    const config =
        moduleData.config ?? {};

    const searchDC =
        Number(config.dc);

    if (
        !Number.isFinite(searchDC) ||
        !Number.isInteger(searchDC)
    ) {
        console.error(
            "Region Automation | Search has an invalid DC",
            {
                dc: config.dc,
                config,
            },
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: this Search has an invalid DC.",
            );
        }

        return;
    }

    /*
     * Step 1: Search exploration activity gate.
     */
    let explorationResult;

    try {
        const resultBox = {
            value: null,
        };

        await checkExplorationActivity({
            token: raToken,
            actor: raActor,
            activity: "search",
            debug: true,
            resultBox,
        });

        explorationResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Search exploration activity check failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Search exploration activity check failed. See the console.",
            );
        }

        return;
    }

    if (!explorationResult?.ok) {
        console.error(
            "Region Automation | Search exploration activity could not be checked",
            explorationResult,
        );

        return;
    }

    if (!explorationResult.active) {
        console.info(
            `Region Automation | ${raActor.name} is not Searching; execution stopped.`,
            explorationResult,
        );

        return;
    }

    console.log(
        `Region Automation | ${raActor.name} is Searching; continuing.`,
        explorationResult,
    );

    /*
     * Step 2: Register this token for this specific Behavior.
     */
    let registrationResult;

    try {
        const resultBox = {
            value: null,
        };

        await registerTokenTrigger({
            behavior: raBehavior,
            token: raToken,
            debug: true,
            resultBox,
        });

        registrationResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Search registration failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Search registration failed. See the console.",
            );
        }

        return;
    }

    if (!registrationResult?.ok) {
        console.error(
            "Region Automation | Search token registration was unsuccessful",
            registrationResult,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Search token could not be registered.",
            );
        }

        return;
    }

    if (!registrationResult.firstTrigger) {
        console.info(
            `Region Automation | ${raToken.name} has already triggered this Search; execution stopped.`,
            registrationResult,
        );

        return;
    }

    /*
     * Rollback is only for technical automation failures.
     * A failed Perception check is a normal successful execution.
     */
    const rollbackRegistration =
        async () => {
            try {
                const current =
                    raBehavior.flags
                        ?.[MODULE_ID]
                        ?.triggeredTokenUuids;

                const updated =
                    Array.isArray(current)
                        ? current.filter(
                            uuid =>
                                uuid !==
                                raToken.uuid,
                        )
                        : [];

                await raBehavior.update({
                    [`flags.${MODULE_ID}.triggeredTokenUuids`]:
                        updated,
                });

                console.warn(
                    "Region Automation | Search registration rolled back after technical failure",
                    {
                        tokenUuid:
                            raToken.uuid,

                        behaviorUuid:
                            raBehavior.uuid,
                    },
                );
            } catch (rollbackError) {
                console.error(
                    "Region Automation | Search registration rollback failed",
                    rollbackError,
                );
            }
        };

    /*
     * Step 3: Secret Perception roll.
     */
    let rollResult;

    try {
        const resultBox = {
            value: null,
        };

        await runSearchRoll({
            actor: raActor,
            token: raToken,
            behavior: raBehavior,
            event: raEvent,
            region: raRegion,
            scene: raScene,
            debug: true,
            resultBox,
        });

        rollResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | SearchRollHelperMacros failed",
            error,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Search roll helper failed. Registration was rolled back.",
            );
        }

        return;
    }

    if (!rollResult?.ok) {
        console.error(
            "Region Automation | Search automation was technically unsuccessful",
            rollResult,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Search could not complete. Registration was rolled back.",
            );
        }

        return;
    }

    console.log(
        "Region Automation | Search completed",
        rollResult,
    );
}
