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
 * Only the 4 GM-clicked entry points remain here. ExplorationActivityMacros.js,
 * RegistrationMacros.js, and the 4 *ConfigurationMacros.js files are all
 * deliberately absent — every one of them is now an `export async
 * function ...` real ES module, imported directly (checkExplorationActivity/
 * registerTokenTrigger via shared/trigger-flow.js; the 4 Configuration
 * dialogs via scripts/configuration-dialogs.js, called from
 * RegionAutomationMainMacros.js through the module API). A top-level
 * `export` is invalid inside a Macro's command body, so Foundry would
 * reject any of them if macro-sync.js tried to create/update them. Add
 * an entry back here only if a future file reverts to being looked up
 * via game.macros.getName(...)/.find(...) instead of imported.
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
        name: "FoundryCompatCheckMacros",
        file: "./world-macros/FoundryCompatCheckMacros.js",
        img: `modules/${MODULE_ID}/assets/icons/RA-module-compatibility.jpg`,
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
 * Delete any macro this module previously created (flags[MODULE_ID].managed
 * === true) whose name is no longer in MANAGED_MACROS.
 *
 * Without this, a macro that's removed from MANAGED_MACROS (e.g. because
 * its source file was converted from a pasted Macro to an ES-only module,
 * as happened when Saving Throw was ported) is created once and then
 * orphaned forever — syncWorldMacros only ever creates/updates entries in
 * the table, it never notices an entry disappeared. Only touches macros
 * carrying our own managed flag, so anything a GM created or renamed into
 * the folder by hand is left alone.
 */
async function pruneOrphanedMacros() {
    const managedNames = new Set(MANAGED_MACROS.map(entry => entry.name));

    const orphaned = game.macros.filter(
        macro => macro.type === "script" && macro.flags?.[MODULE_ID]?.managed === true && !managedNames.has(macro.name),
    );

    for (const macro of orphaned) {
        try {
            await macro.delete();
        } catch (error) {
            console.error(`Region Automation | Failed to delete orphaned macro "${macro.name}".`, error);
        }
    }

    return orphaned.length;
}

/**
 * Create/update every managed macro from its source file, and delete any
 * previously-managed macro that's no longer in MANAGED_MACROS.
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
            pruned: 0,
            failed: 0,
        };

        console.warn("Region Automation | Only a GM can sync world Macros.", summary);
        return summary;
    }

    const summary = { ok: true, reason: "sync-complete", created: 0, updated: 0, unchanged: 0, pruned: 0, failed: 0 };
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

    try {
        summary.pruned = await pruneOrphanedMacros();
    } catch (error) {
        summary.ok = false;
        console.error("Region Automation | Failed to prune orphaned macros.", error);
    }

    console.log("Region Automation | World macro sync finished.", summary);

    if (notify) {
        if (summary.failed > 0) {
            ui.notifications.warn(
                `Region Automation synced macros (${summary.created} created, ${summary.updated} updated, ${summary.pruned} pruned), but ${summary.failed} failed. See the console.`,
            );
        } else {
            ui.notifications.info(
                `Region Automation synced macros (${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.pruned} pruned).`,
            );
        }
    }

    return summary;
}
