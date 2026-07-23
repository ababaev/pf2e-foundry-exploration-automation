await (async () => {
    "use strict";

    const MODULE_ID =
        "region-automation";

    const TARGET_TYPES =
        Object.freeze({
            npc: {
                label:
                    "NPC / Creature",

                detail:
                    "Undetected creature within 30 feet",
            },

            "non-npc": {
                label:
                    "Item / Hazard",

                detail:
                    "Concealed object, feature, trap, or hazard within 30 feet",
            },
        });

    const RANK_LETTERS = {
        0: "U",
        1: "T",
        2: "E",
        3: "M",
        4: "L",
    };

    /*
     * Do not declare another local variable named resultBox.
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

    const escapeHTML =
        value =>
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

    const getResultStyle =
        outcome => {
            switch (outcome) {
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
     * Native Seek supplies action:seek automatically.
     *
     * It is included explicitly here as well so the complete
     * conceptual context is visible in debug output. PF2e later
     * converts the options to a Set, so the duplicate is harmless.
     *
     * NPC mode includes both forms:
     *
     * target:undetected
     * target:condition:undetected
     *
     * This supports the current Keen Eyes predicate seen in the
     * actor data while retaining compatibility with contexts that
     * use the condition-prefixed form.
     */
    const getTargetRollOptions =
        targetType => {
            if (targetType === "npc") {
                return [
                    "action:seek",

                    "target:creature",
                    "target:type:npc",
                    "target:actor:type:npc",

                    "target:undetected",
                    "target:condition:undetected",

                    "target:distance:30",

                    "region-automation",
                    "region-automation:search",
                    "region-automation:search:npc",
                ];
            }

            return [
                "action:seek",

                "target:non-creature",
                "target:object",
                "target:type:hazard",
                "target:actor:type:hazard",

                "target:distance:30",

                "region-automation",
                "region-automation:search",
                "region-automation:search:non-npc",
                "region-automation:search:concealed-object",
            ];
        };

    /*
     * Extract the active natural d20 result from the completed
     * native PF2e CheckRoll.
     *
     * This does not calculate the roll. It only reads the die
     * result created by PF2e.
     */
    const getNaturalD20 =
        roll => {
            const candidates = [
                ...(roll?.dice ?? []),
                ...(roll?.terms ?? []),
            ];

            const seen =
                new Set();

            for (
                const term
                of candidates
            ) {
                if (
                    !term ||
                    seen.has(term)
                ) {
                    continue;
                }

                seen.add(term);

                if (
                    Number(term.faces) !==
                    20
                ) {
                    continue;
                }

                const activeResult =
                    (
                        term.results ??
                        []
                    ).find(
                        result =>
                            result.active !==
                                false &&
                            !result.discarded,
                    );

                const value =
                    Number(
                        activeResult
                            ?.result,
                    );

                if (
                    Number.isFinite(
                        value,
                    )
                ) {
                    return value;
                }

                const termTotal =
                    Number(
                        term.total,
                    );

                if (
                    Number.isFinite(
                        termTotal,
                    )
                ) {
                    return termTotal;
                }
            }

            return null;
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
            "Region Automation | Search roll helper received incomplete context",
            result,
        );

        return;
    }

    /*
     * Read this Search Behavior's configuration.
     */
    const moduleData =
        raBehavior.flags?.[
            MODULE_ID
        ] ?? {};

    const config =
        moduleData.config ?? {};

    const subject =
        String(
            config.subject ??
            "Search",
        ).trim() ||
        "Search";

    const hint =
        String(
            config.hint ??
            "",
        ).trim();

    const searchDC =
        Number(
            config.dc,
        );

    /*
     * Older Search Behaviors without targetType default
     * conservatively to Item / Hazard.
     */
    const configuredTargetType =
        String(
            config.targetType ??
            "non-npc",
        ).trim();

    const targetType =
        Object.hasOwn(
            TARGET_TYPES,
            configuredTargetType,
        )
            ? configuredTargetType
            : null;

    if (
        !Number.isFinite(
            searchDC,
        ) ||
        !Number.isInteger(
            searchDC,
        ) ||
        !targetType
    ) {
        const result = {
            ok: false,

            reason:
                "invalid-configuration",

            config,

            dc:
                config.dc,

            targetType:
                config.targetType,
        };

        publishResult(result);

        console.error(
            "Region Automation | Search roll helper received invalid configuration",
            result,
        );

        return;
    }

    /*
     * Resolve PF2e's native Seek action.
     */
    const seekAction =
        game.pf2e
            ?.actions
            ?.get?.(
                "seek",
            ) ??
        null;

    if (
        !seekAction ||
        typeof seekAction.use !==
            "function"
    ) {
        const result = {
            ok: false,

            reason:
                "native-seek-action-not-found",
        };

        publishResult(result);

        console.error(
            "Region Automation | PF2e native Seek action was not found",
            result,
        );

        return;
    }

    const targetDefinition =
        TARGET_TYPES[
            targetType
        ];

    const rollOptions =
        getTargetRollOptions(
            targetType,
        );

    /*
     * Perform the check entirely through PF2e's native Seek action.
     *
     * Region Automation does not:
     *
     * - roll a d20;
     * - build a Perception modifier;
     * - test Keen Eyes;
     * - apply stacking;
     * - determine the degree of success.
     *
     * PF2e performs all of those operations.
     */
    /*
     * PF2e uses the event's Shift state to invert the executing user's
     * normal "show check dialogs" preference.
     *
     * Matching shiftKey to the current setting guarantees skipDialog:
     *
     * showCheckDialogs = true  + Shift = skip
     * showCheckDialogs = false + no Shift = skip
     */
    const suppressDialogEvent =
        new PointerEvent(
            "click",
            {
                shiftKey:
                    Boolean(
                        game.user.settings
                            .showCheckDialogs,
                    ),
    
                ctrlKey:
                    false,
    
                metaKey:
                    false,
    
                bubbles:
                    false,
    
                cancelable:
                    false,
            },
        );
    
    let actionResults;
    
    try {
        actionResults =
            await seekAction.use({
                actors: [
                    raActor,
                ],
    
                difficultyClass:
                    searchDC,
    
                rollOptions,
    
                message: {
                    create:
                        false,
                },
    
                event:
                    suppressDialogEvent,
            });
    } catch (error) {
        const result = {
            ok: false,
    
            reason:
                "native-seek-action-failed",
    
            error,
    
            rollOptions,
    
            actorUuid:
                raActor.uuid,
        };
    
        publishResult(result);
    
        console.error(
            "Region Automation | PF2e native Seek action failed",
            result,
        );
    
        return;
    }

    if (
        !Array.isArray(
            actionResults,
        ) ||
        actionResults.length === 0
    ) {
        const result = {
            ok: false,

            reason:
                "native-seek-returned-no-results",

            actionResults,

            rollOptions,

            actorUuid:
                raActor.uuid,
        };

        publishResult(result);

        console.error(
            "Region Automation | PF2e native Seek action returned no result",
            result,
        );

        return;
    }

    /*
     * Only one actor was supplied, so use that actor's completed
     * native Seek result.
     */
    const actionResult =
        actionResults.find(
            entry =>
                entry?.actor?.uuid ===
                raActor.uuid,
        ) ??
        actionResults[0];

    const searchRoll =
        actionResult?.roll ??
        null;

    if (!searchRoll) {
        const result = {
            ok: false,

            reason:
                "native-seek-result-has-no-roll",

            actionResult,

            rollOptions,

            actorUuid:
                raActor.uuid,
        };

        publishResult(result);

        console.error(
            "Region Automation | Native Seek result contained no CheckRoll",
            result,
        );

        return;
    }

    /*
     * All values below come directly from PF2e's completed result.
     */
    const total =
        Number(
            searchRoll.total,
        );

    const naturalRoll =
        getNaturalD20(
            searchRoll,
        );

    const nativeModifierValue =
        Number(
            searchRoll.options
                ?.totalModifier,
        );

    const nativeModifier =
        Number.isFinite(
            nativeModifierValue,
        )
            ? nativeModifierValue
            : null;

    const outcome =
        actionResult.outcome ??
        null;

    const formula =
        String(
            searchRoll.formula ??
            "",
        );

    /*
     * Resolve display-only statistic information.
     *
     * This is not used to calculate the result.
     */
    const perceptionStatistic =
        raActor.getStatistic?.(
            "perception",
        ) ??
        raActor.perception ??
        null;

    const statisticLabel =
        perceptionStatistic
            ?.label ??
        "Perception";

    const rank =
        Number(
            perceptionStatistic
                ?.rank ??
            0,
        );

    const rankLetter =
        RANK_LETTERS[
            rank
        ] ?? "U";

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
            "Region Automation | No active GM can receive the Search result",
            result,
        );

        return;
    }

    /*
     * Create the custom GM-only output from PF2e's completed native
     * Seek result.
     */
    const content = `
        <section
            class="region-automation search-result"
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

            <p
                style="
                    margin: 0 0 0.6rem;
                    font-size: 0.9em;
                    opacity: 0.85;
                "
            >
                Target:
                <strong>
                    ${escapeHTML(
                        targetDefinition.label,
                    )}
                </strong>

                —
                ${escapeHTML(
                    targetDefinition.detail,
                )}
            </p>

            <p
                style="
                    margin: 0 0 0.6rem;
                "
            >
                Natural roll:
                <strong>
                    ${
                        naturalRoll === null
                            ? "—"
                            : escapeHTML(
                                naturalRoll,
                            )
                    }
                </strong>
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
                            Statistic
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
                                ${getResultStyle(
                                    outcome,
                                )}
                            "
                        >
                            ${escapeHTML(
                                total,
                            )}
                            vs DC
                            ${escapeHTML(
                                searchDC,
                            )}
                        </td>
                    </tr>
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
                    "Search",
            },

            whisper:
                activeGMs.map(
                    user =>
                        user.id,
                ),

            content,
        });

    /*
     * Failure and critical failure remain valid game results.
     */
    const result = {
        ok: true,

        reason:
            "rolled",

        subject,

        targetType,

        targetLabel:
            targetDefinition.label,

        naturalRoll,

        modifier:
            nativeModifier,

        total,

        dc:
            searchDC,

        outcome,

        formula,

        rollOptions,

        nativeAction:
            seekAction,

        nativeActionResult:
            actionResult,

        nativeRoll:
            searchRoll,

        statistic: {
            slug:
                "perception",

            label:
                statisticLabel,

            rank,

            rankLetter,

            modifier:
                nativeModifier,

            total,

            dc:
                searchDC,

            outcome,

            formula,
        },

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
            `Region Automation | Native Seek action | ${raActor.name}`,
        );

        console.log(
            "Search target",
            {
                targetType,

                label:
                    targetDefinition.label,

                detail:
                    targetDefinition.detail,
            },
        );

        console.log(
            "Roll options supplied to native Seek",
            rollOptions,
        );

        console.table([
            {
                statistic:
                    statisticLabel,

                rank:
                    rankLetter,

                nativeModifier,

                natural:
                    naturalRoll,

                total,

                dc:
                    searchDC,

                outcome,

                formula,
            },
        ]);

        console.log(
            "Native Seek action result",
            actionResult,
        );

        console.log(
            "Native PF2e CheckRoll",
            searchRoll,
        );

        console.log(
            "Complete Search result",
            result,
        );

        console.groupEnd();
    }
})();
