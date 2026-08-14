/**
 * PF2e Exploration Automation
 * scripts/macro-sync.js
 *
 * WORLD MACRO PROVISIONING
 * =========================
 *
 * Several files under scripts/world-macros/ can't be loaded as ES
 * modules (they're pasted into Foundry as standalone world Macros,
 * looked up by name via game.macros.getName(...)/find(...)). Rather
 * than requiring a GM to manually create each one and paste its
 * contents in, this file creates and keeps them in sync automatically,
 * fetching the live source of the very files checked into this repo.
 *
 * This runs automatically for the primary GM when the world starts.
 * It may also be called manually through the module API.
 */

import { MODULE_ID } from "./module-id.js";

const FOLDER_NAME = "PF2e Exploration Automation";

const DEFAULT_ICON = "icons/svg/dice-target.svg";

/**
 * Every world Macro this module provisions, and the world-macros/
 * source file it's kept in sync with.
 *
 * ExplorationActivityMacros.js and RegistrationMacros.js are
 * deliberately absent. Both files are `export async function ...`
 * wrappers so shared/trigger-flow.js can import them directly
 * (checkExplorationActivity, registerTokenTrigger) — and a top-level
 * `export` is invalid inside a Macro's command body, so Foundry
 * rejects it during validation. Now that every supported
 * functionality (search/investigate/detect-magic/saving-throw) has
 * been ported into the module, nothing looks either of them up by
 * name anymore; add an entry back here only if a future *FunctionMacros.js
 * reverts to looking one of them up via game.macros.getName(...)
 * instead of importing it.
 */
const MANAGED_MACROS = Object.freeze([
    {
        name: "RegionAutomationMainMacros",
        file: "./world-macros/RegionAutomationMainMacros.js",
        img: `modules/${MODULE_ID}/assets/icons/region-automation-main.png`,
    },
    {
        name: "UnregisterRegionMacros",
        file: "./world-macros/UnregisterRegionMacros.js",
        img: `modules/${MODULE_ID}/assets/icons/unregister-region.png`,
    },
    {
        name: "TriggerRegionForPartyMacros",
        file: "./world-macros/TriggerRegionForPartyMacros.js",
        img: `modules/${MODULE_ID}/assets/icons/region-manual-automation-run.png`,
    },
    {
        name: "SearchConfigurationMacros",
        file: "./world-macros/SearchConfigurationMacros.js",
    },
    {
        name: "InvestigateConfigurationMacros",
        file: "./world-macros/InvestigateConfigurationMacros.js",
    },
    {
        name: "DetectMagicConfigurationMacros",
        file: "./world-macros/DetectMagicConfigurationMacros.js",
    },
    {
        name: "SavingThrowConfigurationMacros",
        file: "./world-macros/SavingThrowConfigurationMacros.js",
    },
]);

/**
 * Fetch a managed macro's source, live, from the module's own files.
 *
 * Resolving against import.meta.url (rather than hand-building a
 * modules/<id>/... path) keeps this correct under any route prefix or
 * reverse proxy, since it's the exact URL the browser loaded this
 * module from.
 */
async function fetchMacroSource(file) {
    const url = new URL(file, import.meta.url);
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Could not fetch macro source "${url}" (${response.status}).`);
    }

    return (await response.text()).trim();
}

/**
 * Find or create the Macro folder every managed macro is filed under.
 */
async function ensureFolder() {
    const existing = game.folders.find(folder => folder.type === "Macro" && folder.name === FOLDER_NAME);

    if (existing) return existing;

    return Folder.create({ name: FOLDER_NAME, type: "Macro" });
}

/**
 * Create or update a single managed macro so its command matches the
 * given source.
 *
 * Returns "created", "updated", or "unchanged".
 */
async function syncOneMacro(entry, source, folder) {
    const img = entry.img ?? DEFAULT_ICON;
    const existing = game.macros.find(macro => macro.name === entry.name && macro.type === "script");

    if (!existing) {
        await Macro.create({
            name: entry.name,
            type: "script",
            command: source,
            img,
            folder: folder.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
            flags: { [MODULE_ID]: { managed: true } },
        });

        return "created";
    }

    const needsUpdate =
        existing.command !== source || existing.img !== img || existing.folder?.id !== folder.id;

    if (!needsUpdate) return "unchanged";

    await existing.update({ command: source, img, folder: folder.id });

    return "updated";
}

/**
 * Create/update every managed macro from its source file.
 *
 * This runs automatically for the primary GM when the world starts.
 * It may also be called manually through the module API.
 */
export async function syncWorldMacros({ notify = false } = {}) {
    if (!game.user?.isGM) {
        const summary = {
            ok: false,
            reason: "gm-required",
            created: 0,
            updated: 0,
            unchanged: 0,
            failed: 0,
        };

        console.warn("Region Automation | Only a GM can sync world Macros.", summary);
        return summary;
    }

    const summary = { ok: true, reason: "sync-complete", created: 0, updated: 0, unchanged: 0, failed: 0 };
    const folder = await ensureFolder();

    for (const entry of MANAGED_MACROS) {
        try {
            const source = await fetchMacroSource(entry.file);
            const outcome = await syncOneMacro(entry, source, folder);

            summary[outcome] += 1;
        } catch (error) {
            summary.ok = false;
            summary.failed += 1;

            console.error(`Region Automation | Failed to sync macro "${entry.name}".`, error);
        }
    }

    console.log("Region Automation | World macro sync finished.", summary);

    if (notify) {
        if (summary.failed > 0) {
            ui.notifications.warn(
                `Region Automation synced macros (${summary.created} created, ${summary.updated} updated), but ${summary.failed} failed. See the console.`,
            );
        } else {
            ui.notifications.info(
                `Region Automation synced macros (${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged).`,
            );
        }
    }

    return summary;
}
