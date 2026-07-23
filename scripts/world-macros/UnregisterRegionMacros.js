(async () => {
    "use strict";

    const raModuleId =
        "pf2e-exploration-automation";

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can reset registrations.",
        );

        return;
    }

    if (!canvas?.ready || !canvas.scene) {
        ui.notifications.error(
            "Region Automation: there is no active Scene.",
        );

        return;
    }

    const raSelectedRegions =
        Array.from(
            canvas.regions?.controlled ?? [],
        );

    if (raSelectedRegions.length !== 1) {
        const raDetails =
            raSelectedRegions.length === 0
                ? "No Region is selected."
                : `${raSelectedRegions.length} Regions are selected.`;

        ui.notifications.warn(
            `Region Automation: select exactly one Region. ${raDetails}`,
        );

        return;
    }

    const raRegion =
        raSelectedRegions[0]?.document;

    if (!raRegion) {
        ui.notifications.error(
            "Region Automation: the selected Region document is unavailable.",
        );

        return;
    }

    /*
     * Reset every Behavior belonging to Region Automation.
     * This will later also cover Seek, Detect Magic, and saving throws.
     */
    const raAutomationBehaviors =
        Array.from(
            raRegion.behaviors ?? [],
        ).filter(
            raBehavior =>
                raBehavior.flags?.[raModuleId] &&
                typeof raBehavior.flags[raModuleId] ===
                    "object",
        );

    if (raAutomationBehaviors.length === 0) {
        ui.notifications.info(
            `Region Automation: "${raRegion.name}" contains no automation registrations.`,
        );

        return;
    }

    const raUpdates =
        raAutomationBehaviors.map(
            raBehavior => ({
                _id: raBehavior.id,

                [`flags.${raModuleId}.triggeredTokenUuids`]:
                    [],
            }),
        );

    try {
        await raRegion.updateEmbeddedDocuments(
            "RegionBehavior",
            raUpdates,
        );

        console.log(
            "Region Automation | Registrations reset",
            {
                region: raRegion,
                behaviors:
                    raAutomationBehaviors,
            },
        );

        ui.notifications.info(
            `Region Automation: reset ${raAutomationBehaviors.length} Behavior${raAutomationBehaviors.length === 1 ? "" : "s"} in "${raRegion.name}".`,
        );
    } catch (error) {
        console.error(
            "Region Automation | Registration reset failed",
            error,
        );

        ui.notifications.error(
            "Region Automation: registrations could not be reset. See the console.",
        );
    }
})();
