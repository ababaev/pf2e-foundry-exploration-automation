await (async () => {
    "use strict";

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
