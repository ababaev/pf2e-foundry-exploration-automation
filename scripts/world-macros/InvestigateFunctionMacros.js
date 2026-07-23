(async () => {
    "use strict";

    const MODULE_ID = "region-automation";

    const findSingleMacro = name => {
        const matches = game.macros.filter(
            macro => macro.name === name,
        );

        if (matches.length !== 1) {
            console.error(
                `Region Automation | Expected exactly one "${name}" macro`,
                matches,
            );

            if (game.user.isGM) {
                ui.notifications.error(
                    `Region Automation: expected exactly one "${name}" macro, but found ${matches.length}.`,
                );
            }

            return null;
        }

        return matches[0];
    };

    /*
     * Resolve the variables passed by the Region Behavior.
     *
     * Do not redeclare event, behavior, region, scene, token, or actor
     * using those exact names because they are supplied in Macro scope.
     */
    const raEvent =
        typeof event !== "undefined"
            ? event
            : null;

    const raPassedRegion =
        typeof region !== "undefined"
            ? region
            : null;

    const raRegion =
        raPassedRegion ??
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

    const raPassedBehavior =
        typeof behavior !== "undefined"
            ? behavior
            : null;

    const raBehavior =
        raPassedBehavior ??
        Array.from(
            raRegion?.behaviors ?? [],
        ).find(candidate =>
            candidate.flags?.[MODULE_ID]
                ?.functionality === "investigate"
        ) ??
        null;

    console.log(
        "Region Automation | Investigation started",
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

    /*
     * This workflow responds only to Token Enters.
     */
    if (raEvent?.name !== "tokenEnter") {
        console.debug(
            "Region Automation | Ignored Region event",
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
                "Region Automation: the Investigation received incomplete context. See the console.",
            );
        }

        return;
    }

    /*
     * Resolve all helper macros before registering the token.
     *
     * A missing helper must not consume the Investigation.
     */
    const raExplorationMacro =
        findSingleMacro(
            "ExplorationActivityMacros",
        );

    if (!raExplorationMacro) {
        return;
    }

    const raRegistrationMacro =
        findSingleMacro(
            "RegistrationMacros",
        );

    if (!raRegistrationMacro) {
        return;
    }

    const raRollHelperMacro =
        findSingleMacro(
            "InvestigateRollHelperMacros",
        );

    if (!raRollHelperMacro) {
        return;
    }

    /*
     * Validate basic Behavior data before registration.
     */
    const raStoredData =
        raBehavior.flags?.[MODULE_ID] ?? {};

    const raConfig =
        raStoredData.config ?? {};

    const raBaseDC =
        Number(raConfig.baseDC);

    if (!Number.isFinite(raBaseDC)) {
        console.error(
            "Region Automation | Invalid Investigation base DC",
            {
                baseDC: raConfig.baseDC,
                config: raConfig,
                behavior: raBehavior,
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
     * Step 1: Exploration activity check.
     */
    let raExplorationResult;

    try {
        const raResultBox = {
            value: null,
        };

        await raExplorationMacro.execute({
            token: raToken,
            actor: raActor,
            activity: "investigate",
            debug: true,
            resultBox: raResultBox,
        });

        raExplorationResult =
            raResultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | ExplorationActivityMacros failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the exploration activity check failed. See the console.",
            );
        }

        return;
    }

    if (!raExplorationResult?.ok) {
        console.error(
            "Region Automation | Exploration activity could not be checked",
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
     * Step 2: Register the token.
     */
    let raRegistrationResult;

    try {
        const raResultBox = {
            value: null,
        };

        await raRegistrationMacro.execute({
            behavior: raBehavior,
            token: raToken,
            debug: true,
            resultBox: raResultBox,
        });

        raRegistrationResult =
            raResultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | RegistrationMacros failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: token registration failed. See the console.",
            );
        }

        return;
    }

    if (!raRegistrationResult?.ok) {
        console.error(
            "Region Automation | Token registration was unsuccessful",
            raRegistrationResult,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the token could not be registered. See the console.",
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
        `Region Automation | ${raToken.name} registered for the first time; continuing.`,
        raRegistrationResult,
    );

    /*
     * If rolling fails after registration, remove this token again.
     */
    const rollbackRegistration = async () => {
        try {
            const currentRegistrations =
                raBehavior.flags?.[MODULE_ID]
                    ?.triggeredTokenUuids;

            const updatedRegistrations =
                Array.isArray(currentRegistrations)
                    ? currentRegistrations.filter(
                        uuid => uuid !== raToken.uuid,
                    )
                    : [];

            await raBehavior.update({
                [`flags.${MODULE_ID}.triggeredTokenUuids`]:
                    updatedRegistrations,
            });

            console.warn(
                "Region Automation | Registration rolled back",
                {
                    tokenUuid: raToken.uuid,
                    behaviorUuid: raBehavior.uuid,
                },
            );
        } catch (rollbackError) {
            console.error(
                "Region Automation | Registration rollback failed",
                rollbackError,
            );
        }
    };

    /*
     * Step 3: Execute the Investigation roll helper.
     *
     * InvestigateRollHelperMacros is responsible for:
     * - rolling one d20;
     * - resolving all configured skills;
     * - expanding every Lore;
     * - calculating totals and DCs;
     * - creating the secret GM chat card;
     * - publishing its result through resultBox.
     */
    let raRollResult;

    try {
        const raResultBox = {
            value: null,
        };

        await raRollHelperMacro.execute({
            actor: raActor,
            token: raToken,
            behavior: raBehavior,
            event: raEvent,
            region: raRegion,
            scene: raScene,
            debug: true,
            resultBox: raResultBox,
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
            "Region Automation | Investigation roll was unsuccessful",
            raRollResult,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Investigation roll was unsuccessful. Registration was rolled back. See the console.",
            );
        }

        return;
    }

    console.log(
        "Region Automation | Investigation completed",
        raRollResult,
    );
})();
