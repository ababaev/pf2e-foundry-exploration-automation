(async () => {

    const raModuleId =
        "pf2e-exploration-automation";

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can run the Foundry compatibility check.",
        );

        return;
    }

    const raApi =
        game.modules
            .get(raModuleId)
            ?.api;

    if (
        !raApi ||
        typeof raApi.runFoundryCompatCheck !==
            "function"
    ) {
        ui.notifications.error(
            "Region Automation: the module API is unavailable. See the console.",
        );

        console.error(
            "PF2e Exploration Automation | Module API is unavailable.",
        );

        return;
    }

    /*
     * runFoundryCompatCheck() already reports its own summary via
     * ui.notifications and console.table — nothing else to do here.
     */
    await raApi.runFoundryCompatCheck();
})();
