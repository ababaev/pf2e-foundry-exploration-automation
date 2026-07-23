await (async () => {
    "use strict";

    const MODULE_ID =
        "region-automation";

    const VALID_SKILLS =
        new Set([
            "arcana",
            "nature",
            "occultism",
            "religion",
        ]);

    const DIFFICULTIES = [
        "incredibly-easy",
        "very-easy",
        "easy",
        "normal",
        "hard",
        "very-hard",
        "incredibly-hard",
    ];

    const findSingleMacro =
        name => {
            const matches =
                game.macros.filter(
                    macro =>
                        macro.name ===
                        name,
                );

            if (
                matches.length !==
                1
            ) {
                console.error(
                    `Region Automation | Expected exactly one "${name}" macro`,
                    matches,
                );

                if (
                    game.user.isGM
                ) {
                    ui.notifications.error(
                        `Region Automation: expected exactly one "${name}" macro, but found ${matches.length}.`,
                    );
                }

                return null;
            }

            return matches[0];
        };

    const raEvent =
        typeof event !==
            "undefined"
            ? event
            : null;

    const raBehavior =
        typeof behavior !==
            "undefined"
            ? behavior
            : null;

    const raRegion =
        (
            typeof region !==
                "undefined"
                ? region
                : null
        ) ??
        raEvent?.region ??
        null;

    const raScene =
        (
            typeof scene !==
                "undefined"
                ? scene
                : null
        ) ??
        raRegion?.parent ??
        canvas?.scene ??
        null;

    const raToken =
        raEvent?.data?.token ??
        (
            typeof token !==
                "undefined"
                ? token
                : null
        );

    const raActor =
        raToken?.actor ??
        (
            typeof actor !==
                "undefined"
                ? actor
                : null
        );

    console.log(
        "Region Automation | Detect Magic started",
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

    if (
        raEvent?.name !==
        "tokenEnter"
    ) {
        console.debug(
            "Region Automation | Ignored Detect Magic event",
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
            "Region Automation | Incomplete Detect Magic context",
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
                "Region Automation: Detect Magic received incomplete context. See the console.",
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
        "detect-magic"
    ) {
        console.error(
            "Region Automation | Detect Magic Behavior has the wrong functionality flag",
            {
                behavior:
                    raBehavior,

                functionality:
                    moduleData
                        .functionality,
            },
        );

        return;
    }

    const config =
        moduleData.config ?? {};

    const baseDC =
        Number(
            config.baseDC,
        );

    let configuredSkillCount =
        0;

    const seen =
        new Set();

    for (
        const difficulty
        of DIFFICULTIES
    ) {
        const entries =
            Array.isArray(
                config.skills?.[
                    difficulty
                ],
            )
                ? config.skills[
                    difficulty
                ]
                : [];

        for (
            const slug
            of entries
        ) {
            if (
                VALID_SKILLS.has(
                    slug,
                ) &&
                !seen.has(slug)
            ) {
                seen.add(slug);
                configuredSkillCount++;
            }
        }
    }

    if (
        !String(
            config.subject ??
            "",
        ).trim() ||
        !String(
            config.detection ??
            "",
        ).trim() ||
        !Number.isFinite(
            baseDC,
        ) ||
        !Number.isInteger(
            baseDC,
        ) ||
        configuredSkillCount ===
            0
    ) {
        console.error(
            "Region Automation | Detect Magic Behavior has invalid configuration",
            {
                behavior:
                    raBehavior,

                config,

                configuredSkillCount,
            },
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: this Detect Magic Behavior has invalid configuration.",
            );
        }

        return;
    }

    /*
     * Resolve all helpers before registration.
     */
    const explorationMacro =
        findSingleMacro(
            "ExplorationActivityMacros",
        );

    if (!explorationMacro) {
        return;
    }

    const registrationMacro =
        findSingleMacro(
            "RegistrationMacros",
        );

    if (!registrationMacro) {
        return;
    }

    const rollHelperMacro =
        findSingleMacro(
            "DetectMagicRollHelperMacros",
        );

    if (!rollHelperMacro) {
        return;
    }

    /*
     * Step 1: Detect Magic exploration activity gate.
     */
    let explorationResult;

    try {
        const resultBox = {
            value:
                null,
        };

        await explorationMacro
            .execute({
                token:
                    raToken,

                actor:
                    raActor,

                activity:
                    "detect-magic",

                debug:
                    true,

                resultBox,
            });

        explorationResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Detect Magic exploration activity check failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Detect Magic exploration activity check failed. See the console.",
            );
        }

        return;
    }

    if (
        !explorationResult?.ok
    ) {
        console.error(
            "Region Automation | Detect Magic exploration activity could not be checked",
            explorationResult,
        );

        return;
    }

    if (
        !explorationResult.active
    ) {
        console.info(
            `Region Automation | ${raActor.name} is not Detecting Magic; execution stopped.`,
            explorationResult,
        );

        return;
    }

    console.log(
        `Region Automation | ${raActor.name} is Detecting Magic; continuing.`,
        explorationResult,
    );

    /*
     * Step 2: Register the token for this Behavior.
     */
    let registrationResult;

    try {
        const resultBox = {
            value:
                null,
        };

        await registrationMacro
            .execute({
                behavior:
                    raBehavior,

                token:
                    raToken,

                debug:
                    true,

                resultBox,
            });

        registrationResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | Detect Magic registration failed",
            error,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Detect Magic registration failed. See the console.",
            );
        }

        return;
    }

    if (
        !registrationResult?.ok
    ) {
        console.error(
            "Region Automation | Detect Magic token registration was unsuccessful",
            registrationResult,
        );

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Detect Magic token could not be registered.",
            );
        }

        return;
    }

    if (
        !registrationResult
            .firstTrigger
    ) {
        console.info(
            `Region Automation | ${raToken.name} has already triggered this Detect Magic Behavior; execution stopped.`,
            registrationResult,
        );

        return;
    }

    const rollbackRegistration =
        async () => {
            try {
                const current =
                    raBehavior.flags
                        ?.[MODULE_ID]
                        ?.triggeredTokenUuids;

                const updated =
                    Array.isArray(
                        current,
                    )
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
                    "Region Automation | Detect Magic registration rolled back after technical failure",
                    {
                        tokenUuid:
                            raToken.uuid,

                        behaviorUuid:
                            raBehavior.uuid,
                    },
                );
            } catch (
                rollbackError
            ) {
                console.error(
                    "Region Automation | Detect Magic registration rollback failed",
                    rollbackError,
                );
            }
        };

    /*
     * Step 3: Perform the shared-d20 identification checks.
     */
    let rollResult;

    try {
        const resultBox = {
            value:
                null,
        };

        await rollHelperMacro
            .execute({
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

                resultBox,
            });

        rollResult =
            resultBox.value;
    } catch (error) {
        console.error(
            "Region Automation | DetectMagicRollHelperMacros failed",
            error,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: the Detect Magic roll helper failed. Registration was rolled back.",
            );
        }

        return;
    }

    if (!rollResult?.ok) {
        console.error(
            "Region Automation | Detect Magic automation was technically unsuccessful",
            rollResult,
        );

        await rollbackRegistration();

        if (game.user.isGM) {
            ui.notifications.error(
                "Region Automation: Detect Magic could not complete. Registration was rolled back.",
            );
        }

        return;
    }

    console.log(
        "Region Automation | Detect Magic completed",
        rollResult,
    );
})();
