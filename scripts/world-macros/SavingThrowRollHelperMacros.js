await (async () => {

    const MODULE_ID =
        "pf2e-exploration-automation";

    const SAVE_LABELS = {
        fortitude: "Fortitude",
        reflex: "Reflex",
        will: "Will",
    };

    const VALID_SAVE_TYPES =
        new Set(
            Object.keys(
                SAVE_LABELS,
            ),
        );

    const RANK_LETTERS = {
        0: "U",
        1: "T",
        2: "E",
        3: "M",
        4: "L",
    };

    const DEGREE_LABELS = [
        "Critical Failure",
        "Failure",
        "Success",
        "Critical Success",
    ];

    /*
     * Read the resultBox supplied by SavingThrowFunctionMacros.
     *
     * Do not declare a local variable named resultBox.
     */
    const raResultBox =
        typeof resultBox !== "undefined" &&
        resultBox &&
        typeof resultBox === "object"
            ? resultBox
            : null;

    const raActor =
        typeof actor !== "undefined"
            ? actor
            : null;

    const raInputToken =
        typeof token !== "undefined"
            ? token
            : null;

    const raToken =
        raInputToken?.document ??
        raInputToken ??
        null;

    const raBehavior =
        typeof behavior !== "undefined"
            ? behavior
            : null;

    const raEvent =
        typeof event !== "undefined"
            ? event
            : null;

    const raRegion =
        typeof region !== "undefined"
            ? region
            : null;

    const raScene =
        typeof scene !== "undefined"
            ? scene
            : null;

    const raDebug =
        typeof debug !== "undefined"
            ? Boolean(debug)
            : false;

    const publishResult =
        value => {
            if (raResultBox) {
                raResultBox.value =
                    value;
            }

            return value;
        };

    const escapeHTML = value =>
        String(value ?? "").replace(
            /[&<>"']/g,
            character =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;",
                })[character],
        );

    const getDegreeStyle =
        degreeIndex => {
            switch (degreeIndex) {
                case 3:
                    return [
                        "color: #198754",
                        "font-weight: 700",
                    ].join(";");

                case 2:
                    return [
                        "color: #2563eb",
                        "font-weight: 700",
                    ].join(";");

                case 0:
                    return [
                        "color: #b91c1c",
                        "font-weight: 700",
                    ].join(";");

                default:
                    return "";
            }
        };

    const fallbackDegree = (
        total,
        dc,
        naturalRoll,
    ) => {
        let degree;

        if (total >= dc + 10) {
            degree = 3;
        } else if (total >= dc) {
            degree = 2;
        } else if (total <= dc - 10) {
            degree = 0;
        } else {
            degree = 1;
        }

        if (naturalRoll === 20) {
            degree =
                Math.min(
                    3,
                    degree + 1,
                );
        } else if (
            naturalRoll === 1
        ) {
            degree =
                Math.max(
                    0,
                    degree - 1,
                );
        }

        return degree;
    };

    if (
        !raActor ||
        !raToken ||
        !raBehavior
    ) {
        const result = {
            ok: false,

            reason:
                "incomplete-context",

            actor:
                raActor,

            token:
                raToken,

            behavior:
                raBehavior,
        };

        publishResult(result);

        console.error(
            "Region Automation | Saving Throw helper received incomplete context",
            result,
        );

        return;
    }

    const moduleData =
        raBehavior.flags?.[
            MODULE_ID
        ] ?? {};

    const config =
        moduleData.config ?? {};

    const subject =
        String(
            config.subject ??
            "",
        ).trim();

    const saveType =
        String(
            config.saveType ??
            "",
        ).trim();

    const saveDC =
        Number(
            config.dc,
        );

    const consequence =
        String(
            config.consequence ??
            "",
        ).trim();

    if (
        !subject ||
        !VALID_SAVE_TYPES.has(
            saveType,
        ) ||
        !Number.isFinite(
            saveDC,
        ) ||
        !Number.isInteger(
            saveDC,
        )
    ) {
        const result = {
            ok: false,

            reason:
                "invalid-configuration",

            config,
        };

        publishResult(result);

        console.error(
            "Region Automation | Saving Throw helper received invalid configuration",
            result,
        );

        return;
    }

    const activeGMs =
        game.users.filter(
            user =>
                user.active &&
                user.isGM,
        );

    if (
        activeGMs.length === 0
    ) {
        const result = {
            ok: false,

            reason:
                "no-active-gm",
        };

        publishResult(result);

        console.error(
            "Region Automation | No active GM can receive the Saving Throw result",
            result,
        );

        return;
    }

    /*
     * Resolve the PF2e Saving Throw Statistic.
     */
    const saveStatistic =
        raActor.getStatistic?.(
            saveType,
        ) ??
        raActor.saves?.[
            saveType
        ] ??
        null;

    if (
        !saveStatistic ||
        typeof saveStatistic.roll !==
            "function"
    ) {
        const result = {
            ok: false,

            reason:
                "saving-throw-statistic-not-found",

            saveType,

            actorUuid:
                raActor.uuid,
        };

        publishResult(result);

        console.error(
            "Region Automation | Saving Throw statistic was not found",
            result,
        );

        return;
    }

    /*
     * Use PF2e's native Statistic.roll.
     *
     * createMessage:false prevents PF2e from creating its own
     * chat card. A custom GM-only result is created below.
     */
    const saveRoll =
        await saveStatistic.roll({
            dc:
                saveDC,

            token:
                raToken,

            skipDialog:
                true,

            createMessage:
                false,

            messageMode:
                "blindroll",

            title:
                subject,

            slug:
                "pf2e-exploration-automation-saving-throw",

            extraRollOptions: [
                "pf2e-exploration-automation",
                "pf2e-exploration-automation:saving-throw",
                `pf2e-exploration-automation:saving-throw:${saveType}`,
            ],
        });

    if (!saveRoll) {
        const result = {
            ok: false,

            reason:
                "saving-throw-roll-returned-null",

            saveType,

            actorUuid:
                raActor.uuid,
        };

        publishResult(result);

        console.error(
            "Region Automation | PF2e returned no Saving Throw roll",
            result,
        );

        return;
    }

    const total =
        Number(
            saveRoll.total,
        );

    const d20Die =
        saveRoll.dice?.find(
            die =>
                Number(
                    die.faces,
                ) === 20,
        ) ??
        null;

    const possibleNaturalRoll =
        Number(
            d20Die?.total,
        );

    const naturalRoll =
        Number.isFinite(
            possibleNaturalRoll,
        )
            ? possibleNaturalRoll
            : null;

    const possibleModifier =
        Number(
            saveRoll.options
                ?.totalModifier,
        );

    const modifier =
        Number.isFinite(
            possibleModifier,
        )
            ? possibleModifier
            : (
                naturalRoll !== null
                    ? total -
                        naturalRoll
                    : Number(
                        saveStatistic.mod ??
                        saveStatistic
                            .check?.mod ??
                        0,
                    )
            );

    const rank =
        Number(
            saveStatistic.rank ??
            0,
        );

    const rankLetter =
        RANK_LETTERS[
            rank
        ] ?? "U";

    const statisticLabel =
        saveStatistic.label ??
        SAVE_LABELS[
            saveType
        ] ??
        saveType;

    const nativeDegree =
        Number(
            saveRoll
                .degreeOfSuccess,
        );

    const degreeIndex =
        Number.isInteger(
            nativeDegree,
        ) &&
        nativeDegree >= 0 &&
        nativeDegree <= 3
            ? nativeDegree
            : fallbackDegree(
                total,
                saveDC,
                naturalRoll,
            );

    /*
     * The degree label remains available internally and in debug
     * output, but is not displayed as a separate chat column.
     */
    const degreeLabel =
        DEGREE_LABELS[
            degreeIndex
        ] ??
        "Unknown";

    /*
     * Escape GM-authored text, preserve line breaks, and enrich
     * Foundry links such as @UUID and @Check.
     */
    let enrichedConsequence =
        escapeHTML(
            consequence,
        ).replace(
            /\r?\n/g,
            "<br>",
        );

    if (consequence) {
        try {
            const TextEditorClass =
                foundry.applications
                    ?.ux
                    ?.TextEditor
                    ?.implementation ??
                foundry.applications
                    ?.ux
                    ?.TextEditor ??
                globalThis.TextEditor ??
                null;

            if (
                TextEditorClass &&
                typeof TextEditorClass
                    .enrichHTML ===
                    "function"
            ) {
                enrichedConsequence =
                    await TextEditorClass
                        .enrichHTML(
                            enrichedConsequence,
                            {
                                secrets:
                                    true,
                            },
                        );
            }
        } catch (error) {
            console.warn(
                "Region Automation | Saving Throw GM Notes could not be enriched; showing escaped text",
                error,
            );
        }
    }

    /*
     * Two-column result table.
     *
     * The degree of success is represented only through color.
     */
    const content = `
        <section
            class="pf2e-exploration-automation saving-throw-result"
        >
            <header
                style="
                    margin-bottom: 0.6rem;
                "
            >
                <strong>
                    ${escapeHTML(
                        subject,
                    )}
                </strong>
            </header>

            <table
                style="
                    width: 100%;
                    border-collapse: collapse;
                "
            >
                <thead>
                    <tr>
                        <th
                            style="
                                text-align: left;
                                padding: 0.3rem 0.4rem;
                                border-bottom:
                                    1px solid
                                    var(--color-border-dark);
                            "
                        >
                            Saving Throw
                        </th>

                        <th
                            style="
                                text-align: left;
                                padding: 0.3rem 0.4rem;
                                border-bottom:
                                    1px solid
                                    var(--color-border-dark);
                            "
                        >
                            Result
                        </th>
                    </tr>
                </thead>

                <tbody>
                    <tr>
                        <td
                            style="
                                padding: 0.3rem 0.4rem;
                                border-bottom:
                                    1px solid
                                    var(--color-border-light-primary);
                            "
                        >
                            ${escapeHTML(
                                statisticLabel,
                            )}
                            (${escapeHTML(
                                rankLetter,
                            )})
                        </td>

                        <td
                            style="
                                padding: 0.3rem 0.4rem;
                                border-bottom:
                                    1px solid
                                    var(--color-border-light-primary);
                                ${getDegreeStyle(
                                    degreeIndex,
                                )}
                            "
                        >
                            ${escapeHTML(
                                total,
                            )}
                            vs DC
                            ${escapeHTML(
                                saveDC,
                            )}
                        </td>
                    </tr>
                </tbody>
            </table>

            <p
                style="
                    margin: 0.65rem 0 0;
                    font-size: 0.9em;
                    opacity: 0.8;
                "
            >
                Natural d20:
                <strong>
                    ${
                        naturalRoll ===
                        null
                            ? "—"
                            : escapeHTML(
                                naturalRoll,
                            )
                    }
                </strong>

                &nbsp;|&nbsp;

                Modifier:
                <strong>
                    ${
                        modifier >= 0
                            ? "+"
                            : ""
                    }${escapeHTML(
                        modifier,
                    )}
                </strong>
            </p>

            ${
                consequence
                    ? `
                        <hr
                            style="
                                margin:
                                    0.75rem
                                    0;
                            "
                        >

                        <div
                            class="ra-saving-throw-consequence"
                        >
                            <strong>
                                GM Notes / Consequences
                            </strong>

                            <div
                                style="
                                    margin-top: 0.4rem;
                                "
                            >
                                ${enrichedConsequence}
                            </div>
                        </div>
                    `
                    : ""
            }
        </section>
    `;

    const message =
        await ChatMessage.create({
            author:
                game.user.id,

            speaker: {
                alias:
                    raActor.name ??
                    raToken.name ??
                    "Saving Throw",
            },

            whisper:
                activeGMs.map(
                    user =>
                        user.id,
                ),

            content,
        });

    /*
     * ok:true means the automation completed technically.
     *
     * Failure and critical failure remain normal game results.
     */
    const result = {
        ok: true,

        reason:
            "rolled",

        subject,

        saveType,

        saveDC,

        naturalRoll,

        modifier,

        total,

        degreeIndex,

        degreeLabel,

        roll:
            saveRoll,

        message,

        statistic: {
            slug:
                saveType,

            label:
                statisticLabel,

            rank,

            rankLetter,

            modifier,

            total,

            dc:
                saveDC,

            degreeIndex,

            degreeLabel,

            breakdown:
                saveStatistic
                    .check?.breakdown ??
                "",
        },

        actorUuid:
            raActor.uuid,

        tokenUuid:
            raToken.uuid,

        behaviorUuid:
            raBehavior.uuid,

        regionUuid:
            raRegion?.uuid ??
            null,

        sceneUuid:
            raScene?.uuid ??
            null,

        eventName:
            raEvent?.name ??
            null,
    };

    publishResult(result);

    if (raDebug) {
        console.group(
            `Region Automation | Saving Throw helper | ${raActor.name}`,
        );

        console.table([
            {
                statistic:
                    statisticLabel,

                rank:
                    rankLetter,

                modifier,

                natural:
                    naturalRoll,

                total,

                dc:
                    saveDC,

                outcome:
                    degreeLabel,

                breakdown:
                    saveStatistic
                        .check?.breakdown ??
                    "",
            },
        ]);

        console.log(
            "Native PF2e CheckRoll",
            saveRoll,
        );

        console.log(
            "Complete Saving Throw result",
            result,
        );

        console.groupEnd();
    }
})();
