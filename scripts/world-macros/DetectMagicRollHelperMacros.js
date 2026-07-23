await (async () => {
    "use strict";

    const MODULE_ID =
        "region-automation";

    /*
     * Leave null during normal use.
     * Set to 1 or 20 only for testing natural-roll adjustments.
     */
    const FORCED_NATURAL_ROLL =
        null;

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
        easy: -2,
        normal: 0,
        hard: 2,
        "very-hard": 5,
        "incredibly-hard": 10,
    };

    const VALID_SKILLS =
        new Set([
            "arcana",
            "nature",
            "occultism",
            "religion",
        ]);

    const RANK_LETTERS = {
        0: "U",
        1: "T",
        2: "E",
        3: "M",
        4: "L",
    };

    /*
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

    const publishResult = value => {
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
            degree =
                Math.min(
                    3,
                    degree + 1,
                );
        } else if (naturalRoll === 1) {
            degree =
                Math.max(
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

    const getResultStyle =
        degree => {
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
            "Region Automation | Detect Magic roll helper received incomplete context",
            result,
        );

        return;
    }

    /*
     * Read configuration from this individual Region Behavior.
     */
    const moduleData =
        raBehavior.flags?.[
            MODULE_ID
        ] ?? {};

    const config =
        moduleData.config ?? {};

    const subject =
        String(
            config.subject ?? "",
        ).trim();

    const detection =
        String(
            config.detection ?? "",
        ).trim();

    const hint =
        String(
            config.hint ?? "",
        ).trim();

    const baseDC =
        Number(
            config.baseDC,
        );

    if (
        !subject ||
        !detection ||
        !Number.isFinite(baseDC) ||
        !Number.isInteger(baseDC)
    ) {
        const result = {
            ok: false,
            reason:
                "invalid-configuration",

            config,
        };

        publishResult(result);

        console.error(
            "Region Automation | Detect Magic roll helper received invalid configuration",
            result,
        );

        return;
    }

    /*
     * Convert the seven difficulty columns into one entry per
     * configured identification skill.
     */
    const configuredSkills =
        [];

    const seen =
        new Set();

    for (
        const difficulty
        of DIFFICULTIES
    ) {
        const slugs =
            Array.isArray(
                config.skills?.[
                    difficulty
                ],
            )
                ? config.skills[
                    difficulty
                ]
                : [];

        for (const slug of slugs) {
            if (
                !VALID_SKILLS.has(slug) ||
                seen.has(slug)
            ) {
                continue;
            }

            seen.add(slug);

            configuredSkills.push({
                slug,

                difficulty,

                adjustment:
                    DC_ADJUSTMENTS[
                        difficulty
                    ],

                dc:
                    baseDC +
                    DC_ADJUSTMENTS[
                        difficulty
                    ],
            });
        }
    }

    if (
        configuredSkills.length ===
        0
    ) {
        const result = {
            ok: false,
            reason:
                "no-configured-skills",
        };

        publishResult(result);

        console.error(
            "Region Automation | Detect Magic has no configured identification skills",
            result,
        );

        return;
    }

    /*
     * Roll one d20 and reuse it for every configured tradition.
     */
    let d20Roll =
        null;

    let naturalRoll;

    if (
        Number.isInteger(
            FORCED_NATURAL_ROLL,
        ) &&
        FORCED_NATURAL_ROLL >= 1 &&
        FORCED_NATURAL_ROLL <= 20
    ) {
        naturalRoll =
            FORCED_NATURAL_ROLL;
    } else {
        d20Roll =
            await new Roll(
                "1d20",
            ).evaluate();

        naturalRoll =
            Number(
                d20Roll.total,
            );
    }

    const skillResults =
        [];

    for (
        const configured
        of configuredSkills
    ) {
        const baseStatistic =
            raActor.getStatistic?.(
                configured.slug,
            ) ??
            raActor.skills?.[
                configured.slug
            ] ??
            null;

        if (!baseStatistic) {
            console.warn(
                `Region Automation | Detect Magic could not resolve "${configured.slug}" for ${raActor.name}`,
            );

            continue;
        }

        /*
         * PF2e Identify Magic uses the statistic-specific action
         * roll option.
         */
        const rollOptions = [
            "action:identify-magic",
            `action:identify-magic:${configured.slug}`,
        ];

        let resolvedStatistic =
            baseStatistic;

        if (
            typeof baseStatistic
                .withRollOptions ===
            "function"
        ) {
            try {
                resolvedStatistic =
                    baseStatistic.withRollOptions({
                        extraRollOptions:
                            rollOptions,
                    });
            } catch (error) {
                console.warn(
                    `Region Automation | Could not rebuild ${configured.slug} with Identify Magic roll options`,
                    error,
                );

                resolvedStatistic =
                    baseStatistic;
            }
        }

        const modifier =
            Number(
                resolvedStatistic
                    .check?.mod ??
                resolvedStatistic
                    .mod ??
                0,
            );

        const rank =
            Number(
                resolvedStatistic.rank ??
                baseStatistic.rank ??
                0,
            );

        const total =
            naturalRoll +
            modifier;

        const degree =
            getDegreeOfSuccess(
                total,
                configured.dc,
                naturalRoll,
            );

        skillResults.push({
            slug:
                configured.slug,

            label:
                resolvedStatistic.label ??
                baseStatistic.label ??
                configured.slug,

            rank,

            rankLetter:
                RANK_LETTERS[
                    rank
                ] ?? "U",

            modifier,

            total,

            dc:
                configured.dc,

            difficulty:
                configured.difficulty,

            adjustment:
                configured.adjustment,

            degree,

            breakdown:
                resolvedStatistic
                    .check?.breakdown ??
                "",

            rollOptions,
        });
    }

    if (
        skillResults.length ===
        0
    ) {
        const result = {
            ok: false,
            reason:
                "statistics-not-found",
        };

        publishResult(result);

        console.error(
            "Region Automation | No configured Detect Magic statistics could be resolved",
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
        activeGMs.length ===
        0
    ) {
        const result = {
            ok: false,
            reason:
                "no-active-gm",
        };

        publishResult(result);

        console.error(
            "Region Automation | No active GM can receive the Detect Magic result",
            result,
        );

        return;
    }

    /*
     * Two-column output only.
     *
     * The degree is represented by the result's color.
     */
    const resultRows =
        skillResults.map(
            skill => `
                <tr>
                    <td
                        style="
                            padding:
                                0.3rem
                                0.4rem;
                            border-bottom:
                                1px solid
                                var(--color-border-light-primary);
                        "
                    >
                        ${escapeHTML(
                            skill.label,
                        )}
                        (${escapeHTML(
                            skill.rankLetter,
                        )})
                    </td>

                    <td
                        style="
                            padding:
                                0.3rem
                                0.4rem;
                            border-bottom:
                                1px solid
                                var(--color-border-light-primary);
                            ${getResultStyle(
                                skill.degree,
                            )}
                        "
                    >
                        ${escapeHTML(
                            skill.total,
                        )}
                        vs DC
                        ${escapeHTML(
                            skill.dc,
                        )}
                    </td>
                </tr>
            `,
        ).join("");

    const content = `
        <section
            class="region-automation detect-magic-result"
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
                    margin-bottom: 0.7rem;
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
                            Detection
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
                                font-weight: 600;
                            "
                        >
                            Detect Magic
                        </td>

                        <td
                            style="
                                padding: 0.3rem 0.4rem;
                                border-bottom:
                                    1px solid
                                    var(--color-border-light-primary);
                                color: #6f42c1;
                                font-weight: 700;
                            "
                        >
                            ${escapeHTML(
                                detection,
                            )}
                        </td>
                    </tr>
                </tbody>
            </table>

            <p
                style="
                    margin: 0 0 0.6rem;
                "
            >
                Identification natural roll:
                <strong>
                    ${escapeHTML(
                        naturalRoll,
                    )}
                </strong>

                ${
                    FORCED_NATURAL_ROLL !==
                    null
                        ? "<em> (forced test value)</em>"
                        : ""
                }
            </p>

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
                            Identification Skill
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
                    ${resultRows}
                </tbody>
            </table>

            ${
                hint
                    ? `
                        <p
                            style="
                                margin-top: 0.7rem;
                                font-style: italic;
                            "
                        >
                            ${escapeHTML(
                                hint,
                            )}
                        </p>
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
                    "Detect Magic",
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
     * Individual skill failures remain normal game results.
     */
    const result = {
        ok: true,
        reason:
            "rolled",

        subject,

        detection,

        hint,

        baseDC,

        naturalRoll,

        roll:
            d20Roll,

        skillResults,

        message,

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
            `Region Automation | Detect Magic roll helper | ${raActor.name}`,
        );

        console.log(
            "Automatic detection",
            detection,
        );

        console.log(
            "Natural d20",
            naturalRoll,
        );

        console.table(
            skillResults.map(
                skill => ({
                    statistic:
                        skill.label,

                    rank:
                        skill.rankLetter,

                    modifier:
                        skill.modifier,

                    natural:
                        naturalRoll,

                    total:
                        skill.total,

                    dc:
                        skill.dc,

                    degree:
                        skill.degree,

                    difficulty:
                        skill.difficulty,

                    breakdown:
                        skill.breakdown,
                }),
            ),
        );

        console.log(
            "Complete Detect Magic result",
            result,
        );

        console.groupEnd();
    }
})();
