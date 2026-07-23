import {
    checkExplorationActivity,
} from "./ExplorationActivityMacros.js";

import {
    registerTokenTrigger,
} from "./RegistrationMacros.js";

import {
    runInvestigateRoll,
} from "./InvestigateRollHelperMacros.js";

export async function runInvestigate({
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
        "Region Automation | Investigation started",
        {
            event:
                raEvent,

            behavior:
                raBehavior,

            region:
                raRegion,

            scene:
                raScene,

            token:
                raToken,

            actor:
                raActor,

            executingUser:
                game.user,
        },
    );

    /*
     * Investigation responds only to tokenEnter.
     */
    if (
        raEvent?.name !==
        "tokenEnter"
    ) {
        console.debug(
            "Region Automation | Ignored Investigation event",
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
            "Region Automation | Incomplete Investigation context",
            {
                behavior:
                    raBehavior,

                event:
                    raEvent,

                region:
                    raRegion,

                scene:
                    raScene,

                token:
                    raToken,

                actor:
                    raActor,
            },
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Investigation received incomplete context. See the console.",
            );
        }

        return;
    }

    /*
     * Validate that the executor sent an Investigation Behavior.
     */
    const raStoredData =
        raBehavior.flags
            ?.[MODULE_ID] ??
        {};

    if (
        raStoredData.functionality !==
        "investigate"
    ) {
        console.error(
            "Region Automation | Investigation Behavior has the wrong functionality flag",
            {
                behavior:
                    raBehavior,

                functionality:
                    raStoredData.functionality,
            },
        );

        return;
    }

    const raConfig =
        raStoredData.config ??
        {};

    const raBaseDC =
        Number(
            raConfig.baseDC,
        );

    if (
        !Number.isFinite(
            raBaseDC,
        ) ||
        !Number.isInteger(
            raBaseDC,
        )
    ) {
        console.error(
            "Region Automation | Invalid Investigation base DC",
            {
                baseDC:
                    raConfig.baseDC,

                config:
                    raConfig,

                behavior:
                    raBehavior,
            },
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: this Investigation has an invalid base DC.",
            );
        }

        return;
    }

    /*
     * Step 1: Investigate exploration activity gate.
     */
    let raExplorationResult;

    try {
        const raResultBox = {
            value:
                null,
        };

        await checkExplorationActivity({
            token:
                raToken,

            actor:
                raActor,

            activity:
                "investigate",

            debug:
                true,

            resultBox:
                raResultBox,
        });

        raExplorationResult =
            raResultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Investigation exploration activity check failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Investigation exploration activity check failed. See the console.",
            );
        }

        return;
    }

    if (!raExplorationResult?.ok) {
        console.error(
            "Region Automation | Investigation exploration activity could not be checked",
            raExplorationResult,
        );

        return;
    }

    if (!raExplorationResult.active) {
        console.info(
            `Region Automation | ${raActor.name} is not Investigating; execution stopped.`,
            raExplorationResult,
        );

        return;
    }

    console.log(
        `Region Automation | ${raActor.name} is Investigating; continuing.`,
        raExplorationResult,
    );

    /*
     * Step 2: Register this token for this specific Behavior.
     */
    let raRegistrationResult;

    try {
        const raResultBox = {
            value:
                null,
        };

        await registerTokenTrigger({
            behavior:
                raBehavior,

            token:
                raToken,

            debug:
                true,

            resultBox:
                raResultBox,
        });

        raRegistrationResult =
            raResultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Investigation registration failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Investigation registration failed. See the console.",
            );
        }

        return;
    }

    if (!raRegistrationResult?.ok) {
        console.error(
            "Region Automation | Investigation token registration was unsuccessful",
            raRegistrationResult,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Investigation token could not be registered.",
            );
        }

        return;
    }

    if (!raRegistrationResult.firstTrigger) {
        console.info(
            `Region Automation | ${raToken.name} has already triggered this Investigation; execution stopped.`,
            raRegistrationResult,
        );

        return;
    }

    console.log(
        `Region Automation | ${raToken.name} registered for this Investigation; continuing.`,
        raRegistrationResult,
    );

    /*
     * Rollback is only for technical failures.
     *
     * A failed Recall Knowledge check is a valid completed execution
     * and must remain registered.
     */
    const rollbackRegistration =
        async () => {
            try {
                const currentRegistrations =
                    raBehavior.flags
                        ?.[MODULE_ID]
                        ?.triggeredTokenUuids;

                const updatedRegistrations =
                    Array.isArray(
                        currentRegistrations,
                    )
                        ? currentRegistrations.filter(
                            uuid =>
                                uuid !==
                                raToken.uuid,
                        )
                        : [];

                await raBehavior.update({
                    [`flags.${MODULE_ID}.triggeredTokenUuids`]:
                        updatedRegistrations,
                });

                console.warn(
                    "Region Automation | Investigation registration rolled back after technical failure",
                    {
                        tokenUuid:
                            raToken.uuid,

                        behaviorUuid:
                            raBehavior.uuid,
                    },
                );
            } catch (rollbackError) {
                console.error(
                    "Region Automation | Investigation registration rollback failed",
                    rollbackError,
                );
            }
        };

    /*
     * Step 3: Execute the Investigation roll helper.
     */
    let raRollResult;

    try {
        const raResultBox = {
            value:
                null,
        };

        await runInvestigateRoll({
            actor:
                raActor,

            token:
                raToken,

            behavior:
                raBehavior,

            event:
                raEvent,

            region:
                raRegion,

            scene:
                raScene,

            debug:
                true,

            resultBox:
                raResultBox,
        });

        raRollResult =
            raResultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | InvestigateRollHelperMacros failed",
            error,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Investigation roll helper failed. Registration was rolled back. See the console.",
            );
        }

        return;
    }

    if (!raRollResult?.ok) {
        console.error(
            "Region Automation | Investigation automation was technically unsuccessful",
            raRollResult,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Investigation could not complete. Registration was rolled back.",
            );
        }

        return;
    }

    console.log(
        "Region Automation | Investigation completed",
        raRollResult,
    );
}
