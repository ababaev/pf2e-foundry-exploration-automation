await (async () => {

    const raModuleId =
        "pf2e-exploration-automation";

    const macroNames = {
        investigate:
            "InvestigateConfigurationMacros",

        "detect-magic":
            "DetectMagicConfigurationMacros",

        search:
            "SearchConfigurationMacros",

        "saving-throw":
            "SavingThrowConfigurationMacros",
    };

    const functionalityLabels = {
        investigate:
            "Investigation",

        "detect-magic":
            "Detect Magic",

        search:
            "Search",

        "saving-throw":
            "Saving Throw",
    };

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

            ui.notifications.error(
                `Region Automation: expected exactly one "${name}" macro, but found ${matches.length}.`,
            );

            return null;
        }

        return matches[0];
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

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can add automations.",
        );

        return;
    }

    if (!canvas?.ready || !canvas.scene) {
        ui.notifications.error(
            "Region Automation: there is no active Scene.",
        );

        return;
    }

    const selectedRegions =
        Array.from(
            canvas.regions?.controlled ?? [],
        );

    if (selectedRegions.length !== 1) {
        ui.notifications.warn(
            `Region Automation: select exactly one Region. Selected: ${selectedRegions.length}.`,
        );

        return;
    }

    const raRegion =
        selectedRegions[0]?.document;

    if (!raRegion) {
        ui.notifications.error(
            "Region Automation: the selected Region document is unavailable.",
        );

        return;
    }

    /*
     * DialogV2 requires the outer content element to have
     * no attributes.
     */
    const content =
        document.createElement("div");

    content.innerHTML = `
        <div
            style="
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            "
        >
            <p style="margin: 0;">
                Add an automation to
                <strong>
                    ${escapeHTML(raRegion.name)}
                </strong>.
            </p>

            <p
                style="
                    margin: 0;
                    font-size: 0.9em;
                    opacity: 0.8;
                "
            >
                Existing automations are managed through the Region’s
                native Behaviors tab.
            </p>
        </div>
    `;

    const result =
        await foundry.applications.api.DialogV2.wait({
            window: {
                title:
                    "Region Automation — Add Automation",
            },

            position: {
                width: 660,
            },

            modal: true,
            rejectClose: false,
            content,

            buttons: [
                {
                    action:
                        "investigate",

                    label:
                        "Investigation",

                    icon:
                        "fa-solid fa-book-open",

                    default:
                        true,

                    callback: () => ({
                        action:
                            "investigate",
                    }),
                },

                {
                    action:
                        "detect-magic",

                    label:
                        "Detect Magic",

                    icon:
                        "fa-solid fa-wand-magic-sparkles",

                    callback: () => ({
                        action:
                            "detect-magic",
                    }),
                },

                {
                    action:
                        "search",

                    label:
                        "Search",

                    icon:
                        "fa-solid fa-magnifying-glass",

                    callback: () => ({
                        action:
                            "search",
                    }),
                },

                {
                    action:
                        "saving-throw",

                    label:
                        "Saving Throw",

                    icon:
                        "fa-solid fa-shield-halved",

                    callback: () => ({
                        action:
                            "saving-throw",
                    }),
                },

                {
                    action:
                        "edit",

                    label:
                        "Edit Existing…",

                    icon:
                        "fa-solid fa-pen",

                    callback: () => ({
                        action:
                            "edit",
                    }),
                },

                {
                    action:
                        "cancel",

                    label:
                        "Close",

                    icon:
                        "fa-solid fa-xmark",

                    callback: () => ({
                        action:
                            "cancel",
                    }),
                },
            ],
        });

    if (
        !result ||
        result.action === "cancel"
    ) {
        return;
    }

    if (result.action === "edit") {
        const raAutomationBehaviors =
            Array.from(
                raRegion.behaviors ?? [],
            ).filter(
                raBehavior =>
                    raBehavior.flags?.[raModuleId] &&
                    typeof raBehavior.flags[raModuleId] ===
                        "object" &&
                    functionalityLabels[
                        raBehavior.flags[raModuleId]
                            .functionality
                    ],
            );

        if (raAutomationBehaviors.length === 0) {
            ui.notifications.info(
                `Region Automation: "${raRegion.name}" has no automations to edit.`,
            );

            return;
        }

        const behaviorOptionsHTML =
            raAutomationBehaviors
                .map(
                    (raBehavior, raIndex) => `
                        <option value="${raIndex}">
                            ${escapeHTML(
                                functionalityLabels[
                                    raBehavior.flags[raModuleId]
                                        .functionality
                                ],
                            )} — ${escapeHTML(raBehavior.name)}
                        </option>
                    `,
                )
                .join("");

        const editContent =
            document.createElement("div");

        editContent.innerHTML = `
            <div
                style="
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                "
            >
                <p style="margin: 0;">
                    Choose an automation on
                    <strong>
                        ${escapeHTML(raRegion.name)}
                    </strong>
                    to edit.
                </p>

                <select
                    name="behaviorIndex"
                    style="width: 100%;"
                    autofocus
                >
                    ${behaviorOptionsHTML}
                </select>
            </div>
        `;

        const editResult =
            await foundry.applications.api.DialogV2.wait({
                window: {
                    title:
                        "Region Automation — Edit Existing",
                },

                position: {
                    width: 560,
                },

                modal: false,
                rejectClose: false,
                content: editContent,

                buttons: [
                    {
                        action:
                            "edit",

                        label:
                            "Edit",

                        icon:
                            "fa-solid fa-pen",

                        default:
                            true,

                        callback: (
                            event,
                            button,
                        ) => ({
                            action:
                                "edit",

                            behaviorIndex: Number(
                                button.form?.elements
                                    ?.namedItem(
                                        "behaviorIndex",
                                    )?.value ?? 0,
                            ),
                        }),
                    },

                    {
                        action:
                            "cancel",

                        label:
                            "Cancel",

                        icon:
                            "fa-solid fa-xmark",

                        callback: () => ({
                            action:
                                "cancel",
                        }),
                    },
                ],
            });

        if (
            !editResult ||
            editResult.action === "cancel"
        ) {
            return;
        }

        const raChosenBehavior =
            raAutomationBehaviors[
                editResult.behaviorIndex
            ];

        if (!raChosenBehavior) {
            ui.notifications.error(
                "Region Automation: the selected automation is no longer available.",
            );

            return;
        }

        const raChosenFunctionality =
            raChosenBehavior.flags[raModuleId]
                .functionality;

        const editMacroName =
            macroNames[raChosenFunctionality];

        if (!editMacroName) {
            ui.notifications.error(
                "Region Automation: this automation's type is unavailable for editing.",
            );

            return;
        }

        const editMacro =
            findSingleMacro(
                editMacroName,
            );

        if (!editMacro) {
            return;
        }

        await editMacro.execute({
            existingBehavior:
                raChosenBehavior,
        });

        return;
    }

    const macroName =
        macroNames[result.action];

    if (!macroName) {
        ui.notifications.error(
            "Region Automation: the selected automation type is unavailable.",
        );

        return;
    }

    const macro =
        findSingleMacro(
            macroName,
        );

    if (!macro) {
        return;
    }

    await macro.execute();
})();
