/**
 * PF2e Exploration Automation
 * scripts/configuration-dialogs.js
 *
 * Dispatches "Add"/"Edit" automation requests from RegionAutomationMainMacros.js
 * (a paste-only macro, so it can't import these directly) to the right
 * activity's Configuration dialog. Structurally mirrors executor.js's
 * MODULE_FUNCTIONS dispatch table.
 */

import { runSearchConfiguration } from "./world-macros/SearchConfigurationMacros.js";
import { runInvestigateConfiguration } from "./world-macros/InvestigateConfigurationMacros.js";
import { runDetectMagicConfiguration } from "./world-macros/DetectMagicConfigurationMacros.js";
import { runSavingThrowConfiguration } from "./world-macros/SavingThrowConfigurationMacros.js";

const CONFIGURATION_DIALOGS = Object.freeze({
    investigate: runInvestigateConfiguration,
    search: runSearchConfiguration,
    "detect-magic": runDetectMagicConfiguration,
    "saving-throw": runSavingThrowConfiguration,
});

/**
 * Open the Add/Edit Configuration dialog for one activity.
 */
export async function openConfigurationDialog({ activity, region, existingBehavior } = {}) {
    const dialogFn = CONFIGURATION_DIALOGS[activity] ?? null;

    if (!dialogFn) {
        ui.notifications.error("Region Automation: the selected automation type is unavailable.");
        return;
    }

    return dialogFn({ region, existingBehavior });
}
