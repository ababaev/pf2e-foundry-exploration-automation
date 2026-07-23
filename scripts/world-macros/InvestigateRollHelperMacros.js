await (async () => {
    "use strict";

    const MODULE_ID = "region-automation";

    /*
     * Normally leave this as null.
     * Set it to 1 or 20 only when testing natural-roll behavior.
     */
    const FORCED_NATURAL_ROLL = null;

    const DIFFICULTIES = [
        "incredibly-easy",
        "very-easy",
        "easy",
        "normal",
        "hard",
        "very-hard",
        "incredibly-hard",
    ];

    const DC_ADJUSTMENTS = {
        "incredibly-easy": -10,
        "very-easy": -5,
        "easy": -2,
        "normal": 0,
        "hard": 2,
        "very-hard": 5,
        "incredibly-hard": 10,
    };

    const RANK_LETTERS = {
        0: "U",
        1: "T",
        2: "E",
        3: "M",
        4: "L",
    };

    /*
     * Read values supplied through Macro.execute().
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

    const publishResult = value => {
        if (raResultBox) {
            raResultBox.value = value;
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

    const getDegreeOfSuccess = (
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
            degree = Math.min(
                3,
                degree + 1,
            );
        } else if (naturalRoll === 1) {
            degree = Math.max(
                0,
                degree - 1,
            );
        }

        return [
            "criticalFailure",
            "failure",
            "success",
            "criticalSuccess",
        ][degree];
    };

    const getResultStyle = degree => {
        switch (degree) {
            case "criticalSuccess":
                return [
                    "color: #198754",
                    "font-weight: 700",
                ].join(";");

            case "success":
                return [
                    "color: #2563eb",
                    "font-weight: 700",
                ].join(";");

            case "criticalFailure":
                return [
                    "color: #b91c1c",
                    "font-weight: 700",
                ].join(";");

            default:
                return "";
        }
    };

    /*
     * Validate execution context.
     */
    if (
        !raActor ||
        !raToken ||
        !raBehavior
    ) {
        const result = {
            ok: false,
            reason: "incomplete-context",
            actor: raActor,
            token: raToken,
            behavior: raBehavior,
        };

        publishResult(result);

        console.error(
            "Region Automation | Investigation roll helper received incomplete context",
            result,
        );

        return;
    }

    /*
     * Read Region Behavior configuration.
     */
    const raStoredData =
        raBehavior.flags?.[MODULE_ID] ?? {};

    const raConfig =
        raStoredData.config ?? {};

    const raBaseDC =
        Number(raConfig.baseDC);

    if (!Number.isFinite(raBaseDC)) {
        const result = {
            ok: false,
            reason: "invalid-base-dc",
            baseDC: raConfig.baseDC,
        };

        publishResult(result);

        console.error(
            "Region Automation | Invalid Investigation base DC",
            result,
        );

        return;
    }

    const raConfiguredSkills =
        raConfig.skills ?? {};

    /*
     * Generic Lore entries become DC reference rows.
     *
     * They do not receive rolls or degrees of success.
     */
    const raLoreReferences = [];

    /*
     * Ordinary configured skills are rolled against their assigned DC.
     */
    const raOrdinaryStatisticRows = [];

    const raSeenOrdinarySkills =
        new Set();

    const raSeenLoreReferences =
        new Set();

    for (const raDifficulty of DIFFICULTIES) {
        const raEntries =
            Array.isArray(
                raConfiguredSkills[raDifficulty],
            )
                ? raConfiguredSkills[raDifficulty]
                : [];

        const raDC =
            raBaseDC +
            DC_ADJUSTMENTS[raDifficulty];

        for (const raConfiguredSlug of raEntries) {
            if (
                raConfiguredSlug ===
                "specified-lore"
            ) {
                if (
                    !raSeenLoreReferences.has(
                        "specified-lore",
                    )
                ) {
                    raSeenLoreReferences.add(
                        "specified-lore",
                    );

                    raLoreReferences.push({
                        slug:
                            "specified-lore",

                        label:
                            "Specified Lore",

                        difficulty:
                            raDifficulty,

                        dc:
                            raDC,
                    });
                }

                continue;
            }

            if (
                raConfiguredSlug ===
                "unspecified-lore"
            ) {
                if (
                    !raSeenLoreReferences.has(
                        "unspecified-lore",
                    )
                ) {
                    raSeenLoreReferences.add(
                        "unspecified-lore",
                    );

                    raLoreReferences.push({
                        slug:
                            "unspecified-lore",

                        label:
                            "Unspecified Lore",

                        difficulty:
                            raDifficulty,

                        dc:
                            raDC,
                    });
                }

                continue;
            }

            if (
                raSeenOrdinarySkills.has(
                    raConfiguredSlug,
                )
            ) {
                console.warn(
                    `Region Automation | Duplicate configured skill ignored: ${raConfiguredSlug}`,
                );

                continue;
            }

            raSeenOrdinarySkills.add(
                raConfiguredSlug,
            );

            const raStatistic =
                raActor.getStatistic?.(
                    raConfiguredSlug,
                ) ??
                raActor.skills?.[
                    raConfiguredSlug
                ] ??
                null;

            if (!raStatistic) {
                console.warn(
                    `Region Automation | Actor statistic not found: ${raConfiguredSlug}`,
                );

                continue;
            }

            raOrdinaryStatisticRows.push({
                statistic:
                    raStatistic,

                difficulty:
                    raDifficulty,

                dc:
                    raDC,
            });
        }
    }

    /*
     * Every actual Lore statistic is rolled once.
     *
     * It is not assigned to either Specified Lore or Unspecified Lore.
     * The GM compares the Lore total manually against the reference DCs.
     */
    const raLoreStatistics =
        raLoreReferences.length > 0
            ? Object.values(
                raActor.skills ?? {},
            )
                .filter(
                    statistic =>
                        statistic?.lore === true,
                )
                .sort((left, right) =>
                    String(
                        left.label ??
                        left.slug,
                    ).localeCompare(
                        String(
                            right.label ??
                            right.slug,
                        ),
                    ),
                )
            : [];

    if (
        raOrdinaryStatisticRows.length === 0 &&
        raLoreReferences.length === 0
    ) {
        const result = {
            ok: false,
            reason: "no-configured-statistics",
            config: raConfig,
        };

        publishResult(result);

        console.warn(
            "Region Automation | Investigation contains no configured statistics",
            result,
        );

        return;
    }

    /*
     * Roll exactly one d20.
     */
    let raD20Roll = null;
    let raNaturalRoll;

    if (
        Number.isInteger(
            FORCED_NATURAL_ROLL,
        ) &&
        FORCED_NATURAL_ROLL >= 1 &&
        FORCED_NATURAL_ROLL <= 20
    ) {
        raNaturalRoll =
            FORCED_NATURAL_ROLL;
    } else {
        raD20Roll =
            await new Roll(
                "1d20",
            ).evaluate();

        raNaturalRoll =
            Number(
                raD20Roll.total,
            );
    }

    /*
     * Resolve PF2e modifiers for one statistic.
     */
    const resolveStatistic = statistic => {
        const statisticSlug =
            statistic.slug;

        const rollOptions = [
            "action:recall-knowledge",
            `action:recall-knowledge:${statisticSlug}`,
        ];

        const resolvedStatistic =
            typeof statistic.withRollOptions ===
                "function"
                ? statistic.withRollOptions({
                    extraRollOptions:
                        rollOptions,
                })
                : statistic;

        const modifier =
            Number(
                resolvedStatistic.check?.mod ??
                resolvedStatistic.mod ??
                0,
            );

        const rank =
            Number(
                resolvedStatistic.rank ??
                statistic.rank ??
                0,
            );

        return {
            statistic:
                resolvedStatistic,

            slug:
                statisticSlug,

            label:
                resolvedStatistic.label ??
                statistic.label ??
                statisticSlug,

            modifier,

            rank,

            rankLetter:
                RANK_LETTERS[rank] ??
                "U",

            total:
                raNaturalRoll +
                modifier,

            breakdown:
                resolvedStatistic
                    .check?.breakdown ??
                "",

            rollOptions,
        };
    };

    /*
     * Resolve ordinary skill results.
     */
    const raOrdinaryResults =
        raOrdinaryStatisticRows.map(row => {
            const resolved =
                resolveStatistic(
                    row.statistic,
                );

            const degree =
                getDegreeOfSuccess(
                    resolved.total,
                    row.dc,
                    raNaturalRoll,
                );

            return {
                type:
                    "ordinary",

                ...resolved,

                dc:
                    row.dc,

                difficulty:
                    row.difficulty,

                degree,
            };
        });

    /*
     * Resolve each actual Lore once, without assigning a DC.
     */
    const raLoreResults =
        raLoreStatistics.map(statistic => {
            const resolved =
                resolveStatistic(
                    statistic,
                );

            return {
                type:
                    "lore",

                ...resolved,

                dc:
                    null,

                difficulty:
                    null,

                degree:
                    null,
            };
        });

    /*
     * Build ordinary skill table rows.
     */
    const raOrdinaryResultRowsHTML =
        raOrdinaryResults.map(result => `
            <tr>
                <td style="
                    padding: 0.3rem 0.4rem;
                    border-bottom: 1px solid var(--color-border-light-primary);
                ">
                    ${escapeHTML(
                        result.label,
                    )}
                    (${escapeHTML(
                        result.rankLetter,
                    )})
                </td>

                <td style="
                    padding: 0.3rem 0.4rem;
                    border-bottom: 1px solid var(--color-border-light-primary);
                    ${getResultStyle(
                        result.degree,
                    )}
                ">
                    ${escapeHTML(
                        result.total,
                    )}
                    vs DC
                    ${escapeHTML(
                        result.dc,
                    )}
                </td>
            </tr>
        `).join("");

    /*
     * Build one combined Lore table:
     *
     * Specified Lore      DC 15
     * Unspecified Lore    DC 18
     * Circus Lore (T)     10
     * Warfare Lore (E)    14
     */
    const raLoreRowsHTML = [
        ...raLoreReferences.map(reference => `
            <tr>
                <td style="
                    padding: 0.3rem 0.4rem;
                    border-bottom: 1px solid var(--color-border-light-primary);
                    font-weight: 700;
                ">
                    ${escapeHTML(
                        reference.label,
                    )}
                </td>

                <td style="
                    padding: 0.3rem 0.4rem;
                    border-bottom: 1px solid var(--color-border-light-primary);
                    font-weight: 700;
                ">
                    DC ${escapeHTML(
                        reference.dc,
                    )}
                </td>
            </tr>
        `),

        ...raLoreResults.map(result => `
            <tr>
                <td style="
                    padding: 0.3rem 0.4rem;
                    border-bottom: 1px solid var(--color-border-light-primary);
                ">
                    ${escapeHTML(
                        result.label,
                    )}
                    (${escapeHTML(
                        result.rankLetter,
                    )})
                </td>

                <td style="
                    padding: 0.3rem 0.4rem;
                    border-bottom: 1px solid var(--color-border-light-primary);
                    font-weight: 600;
                ">
                    ${escapeHTML(
                        result.total,
                    )}
                </td>
            </tr>
        `),
    ].join("");

    const raActiveGMs =
        game.users.filter(
            user =>
                user.active &&
                user.isGM,
        );

    if (raActiveGMs.length === 0) {
        const result = {
            ok: false,
            reason: "no-active-gm",
        };

        publishResult(result);

        console.error(
            "Region Automation | No active GM can receive the Investigation result",
            result,
        );

        return;
    }

    /*
     * Create secret GM chat output.
     */
    const raContent = `
        <section class="region-automation investigate-result">
            <header style="
                margin-bottom: 0.6rem;
            ">
                <strong>
                    ${escapeHTML(
                        raConfig.subject ??
                        "Investigation",
                    )}
                </strong>
            </header>

            <p style="
                margin: 0 0 0.6rem;
            ">
                Natural roll:
                <strong>
                    ${escapeHTML(
                        raNaturalRoll,
                    )}
                </strong>

                ${
                    FORCED_NATURAL_ROLL !== null
                        ? "<em> (forced test value)</em>"
                        : ""
                }
            </p>

            ${
                raOrdinaryResults.length > 0
                    ? `
                        <h4 style="
                            margin: 0.7rem 0 0.3rem;
                        ">
                            Skill Results
                        </h4>

                        <table style="
                            width: 100%;
                            border-collapse: collapse;
                        ">
                            <thead>
                                <tr>
                                    <th style="
                                        text-align: left;
                                        padding: 0.3rem 0.4rem;
                                        border-bottom: 1px solid var(--color-border-dark);
                                    ">
                                        Statistic
                                    </th>

                                    <th style="
                                        text-align: left;
                                        padding: 0.3rem 0.4rem;
                                        border-bottom: 1px solid var(--color-border-dark);
                                    ">
                                        Result
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                ${raOrdinaryResultRowsHTML}
                            </tbody>
                        </table>
                    `
                    : ""
            }

            ${
                raLoreReferences.length > 0
                    ? `
                        <h4 style="
                            margin: 0.7rem 0 0.3rem;
                        ">
                            Lore
                        </h4>

                        <table style="
                            width: 100%;
                            border-collapse: collapse;
                        ">
                            <thead>
                                <tr>
                                    <th style="
                                        text-align: left;
                                        padding: 0.3rem 0.4rem;
                                        border-bottom: 1px solid var(--color-border-dark);
                                    ">
                                        Statistic
                                    </th>

                                    <th style="
                                        text-align: left;
                                        padding: 0.3rem 0.4rem;
                                        border-bottom: 1px solid var(--color-border-dark);
                                    ">
                                        DC / Result
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                ${raLoreRowsHTML}

                                ${
                                    raLoreResults.length === 0
                                        ? `
                                            <tr>
                                                <td
                                                    colspan="2"
                                                    style="
                                                        padding: 0.4rem;
                                                        font-style: italic;
                                                    "
                                                >
                                                    This actor has no Lore skills.
                                                </td>
                                            </tr>
                                        `
                                        : ""
                                }
                            </tbody>
                        </table>
                    `
                    : ""
            }

            ${
                raConfig.hint
                    ? `
                        <p style="
                            margin-top: 0.7rem;
                            font-style: italic;
                        ">
                            ${escapeHTML(
                                raConfig.hint,
                            )}
                        </p>
                    `
                    : ""
            }
        </section>
    `;

    const raMessage =
        await ChatMessage.create({
            author:
                game.user.id,

            speaker: {
                alias:
                    raActor.name ??
                    raToken.name ??
                    "Investigation",
            },

            whisper:
                raActiveGMs.map(
                    user => user.id,
                ),

            content:
                raContent,
        });

    /*
     * Publish successful technical execution.
     *
     * Individual PF2e failures or critical failures are normal results and
     * do not change this object's ok status.
     */
    const result = {
        ok: true,
        reason: "rolled",

        naturalRoll:
            raNaturalRoll,

        roll:
            raD20Roll,

        loreReferences:
            raLoreReferences,

        ordinaryResults:
            raOrdinaryResults,

        loreResults:
            raLoreResults,

        message:
            raMessage,

        actorUuid:
            raActor.uuid,

        tokenUuid:
            raToken.uuid,

        behaviorUuid:
            raBehavior.uuid,

        regionUuid:
            raRegion?.uuid ?? null,

        sceneUuid:
            raScene?.uuid ?? null,

        eventName:
            raEvent?.name ?? null,
    };

    publishResult(result);

    if (raDebug) {
        console.group(
            `Region Automation | Investigation roll helper | ${raActor.name}`,
        );

        console.log(
            "Natural d20",
            raNaturalRoll,
        );

        console.table(
            raLoreReferences.map(reference => ({
                category:
                    reference.label,

                dc:
                    reference.dc,

                difficulty:
                    reference.difficulty,
            })),
        );

        console.table(
            raOrdinaryResults.map(result => ({
                statistic:
                    result.label,

                rank:
                    result.rankLetter,

                modifier:
                    result.modifier,

                natural:
                    raNaturalRoll,

                total:
                    result.total,

                dc:
                    result.dc,

                degree:
                    result.degree,

                breakdown:
                    result.breakdown,
            })),
        );

        console.table(
            raLoreResults.map(result => ({
                lore:
                    result.label,

                rank:
                    result.rankLetter,

                modifier:
                    result.modifier,

                natural:
                    raNaturalRoll,

                total:
                    result.total,

                breakdown:
                    result.breakdown,
            })),
        );

        console.log(
            "Complete helper result",
            result,
        );

        console.groupEnd();
    }
})();
