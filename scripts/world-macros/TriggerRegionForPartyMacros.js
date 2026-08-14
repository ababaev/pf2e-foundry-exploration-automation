(async () => {

    const raModuleId =
        "pf2e-exploration-automation";

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can manually trigger a Region.",
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
     * "The party" is every token on the active Scene whose actor is a
     * PF2e character. This runs regardless of where those tokens are
     * actually placed on the map — the Region only supplies the
     * configured automations, not a physical area to be inside of.
     */
    const raPartyTokens =
        Array.from(
            canvas.tokens?.placeables ?? [],
        ).filter(
            raToken =>
                raToken.actor?.type === "character",
        );

    if (raPartyTokens.length === 0) {
        ui.notifications.warn(
            "Region Automation: no player character tokens were found on the active Scene.",
        );

        return;
    }

    const raModuleApi =
        game.modules
            .get(raModuleId)
            ?.api;

    if (
        !raModuleApi ||
        typeof raModuleApi.triggerRegionAutomationForTokens !==
            "function"
    ) {
        ui.notifications.error(
            "Region Automation: the module API is unavailable. See the console.",
        );

        console.error(
            "PF2e Exploration Automation | Module API is unavailable.",
            { region: raRegion },
        );

        return;
    }

    const raSummary =
        await raModuleApi.triggerRegionAutomationForTokens({
            region: raRegion,
            tokens: raPartyTokens,
        });

    console.log(
        "Region Automation | Manual party trigger finished",
        {
            region: raRegion,
            tokens: raPartyTokens,
            summary: raSummary,
        },
    );

    if (!raSummary?.ok) {
        ui.notifications.error(
            `Region Automation: the manual trigger could not run (${raSummary?.reason ?? "unknown reason"}). See the console.`,
        );

        return;
    }

    ui.notifications.info(
        `Region Automation: ran ${raSummary.ran} check${raSummary.ran === 1 ? "" : "s"} for ${raPartyTokens.length} character${raPartyTokens.length === 1 ? "" : "s"} in "${raRegion.name}"${raSummary.skipped > 0 ? ` (${raSummary.skipped} skipped, see console)` : ""}.`,
    );
})();
