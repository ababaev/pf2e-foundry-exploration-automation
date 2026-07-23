await (async () => {

    const MODULE_ID =
        "pf2e-exploration-automation";

    const VALID_SAVE_TYPES =
        new Set([
            "fortitude",
            "reflex",
            "will",
        ]);

    const findSingleMacro = name => {
        const matches =
            game.macros.filter(
                macro =>
                    macro.name === name,
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
        "Region Automation | Saving Throw started",
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
            "Region Automation | Ignored Saving Throw event",
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
            "Region Automation | Incomplete Saving Throw context",
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
                "Region Automation: Saving Throw received incomplete context. See the console.",
            );
        }

        return;
    }

    const moduleData =
        raBehavior.flags?.[
            MODULE_ID
        ] ?? {};

    if (
        moduleData.functionality !==
        "saving-throw"
    ) {
        console.error(
            "Region Automation | Saving Throw Behavior has the wrong functionality flag",
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

    const subject =
        String(
            config.subject ?? "",
        ).trim();

    const saveType =
        String(
            config.saveType ?? "",
        ).trim();

    const saveDC =
        Number(config.dc);

    if (
        !subject ||
        !VALID_SAVE_TYPES.has(saveType) ||
        !Number.isFinite(saveDC) ||
        !Number.isInteger(saveDC)
    ) {
        console.error(
            "Region Automation | Saving Throw Behavior has invalid configuration",
            {
                behavior: raBehavior,
                config,
            },
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: this Saving Throw Behavior has invalid configuration.",
            );
        }

        return;
    }

    /*
     * Resolve all helpers before registration.
     */
    const registrationMacro =
        findSingleMacro(
            "RegistrationMacros",
        );

    if (!registrationMacro) {
        return;
    }

    const rollHelperMacro =
        findSingleMacro(
            "SavingThrowRollHelperMacros",
        );

    if (!rollHelperMacro) {
        return;
    }

    /*
     * Step 1: Register this token for this specific Behavior.
     */
    let registrationResult;

    try {
        const resultBox = {
            value: null,
        };

        await registrationMacro.execute({
            behavior: raBehavior,
            token: raToken,
            debug: true,
            resultBox,
        });

        registrationResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Saving Throw registration failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Saving Throw registration failed. See the console.",
            );
        }

        return;
    }

    if (!registrationResult?.ok) {
        console.error(
            "Region Automation | Saving Throw token registration was unsuccessful",
            registrationResult,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Saving Throw token could not be registered.",
            );
        }

        return;
    }

    if (!registrationResult.firstTrigger) {
        console.info(
            `Region Automation | ${raToken.name} has already triggered this Saving Throw Behavior; execution stopped.`,
            registrationResult,
        );

        return;
    }

    /*
     * Registration is rolled back only for technical failures.
     *
     * A failed or critically failed saving throw is a normal
     * completed automation result.
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
                    "Region Automation | Saving Throw registration rolled back after technical failure",
                    {
                        tokenUuid:
                            raToken.uuid,

                        behaviorUuid:
                            raBehavior.uuid,
                    },
                );
            } catch (rollbackError) {
                console.error(
                    "Region Automation | Saving Throw registration rollback failed",
                    rollbackError,
                );
            }
        };

    /*
     * Step 2: Perform the secret native PF2e saving throw.
     */
    let rollResult;

    try {
        const resultBox = {
            value: null,
        };

        await rollHelperMacro.execute({
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
            "Region Automation | SavingThrowRollHelperMacros failed",
            error,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Saving Throw helper failed. Registration was rolled back.",
            );
        }

        return;
    }

    if (!rollResult?.ok) {
        console.error(
            "Region Automation | Saving Throw automation was technically unsuccessful",
            rollResult,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Saving Throw could not complete. Registration was rolled back.",
            );
        }

        return;
    }

    console.log(
        "Region Automation | Saving Throw completed",
        rollResult,
    );
})();
