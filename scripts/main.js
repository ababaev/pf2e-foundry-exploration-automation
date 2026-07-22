/**
 * Region Automation
 * scripts/main.js
 *
 * MODULE ENTRY POINT
 * ==================
 *
 * This file is loaded by module.json when Foundry starts.
 *
 * It performs four jobs:
 *
 * 1. Exposes the public Region Automation API.
 * 2. Registers the module socket listener.
 * 3. Migrates existing Region Behaviors to the new safe dispatcher.
 * 4. Automatically fixes newly created Region Automation Behaviors.
 *
 * This file does not perform rolls itself.
 */

import {
    MODULE_ID,
    getPrimaryGM,
    isPrimaryGM,
    registerSocket,
    requestBehaviorExecution,
} from "./socket.js";

import {
    GENERIC_BEHAVIOR_SOURCE,
    migrateWorldBehaviors,
    normalizeBehaviorSource,
} from "./migrate-behaviors.js";

/**
 * Existing Region Automation Behaviors are checked whenever the
 * world starts.
 *
 * Only the elected primary GM performs the migration.
 */
const AUTO_MIGRATE_BEHAVIORS = true;

/**
 * Foundry's init hook runs while modules are being initialized.
 *
 * We expose a small API that Region Behavior scripts can call.
 */
Hooks.once("init", () => {
    const module =
        game.modules.get(
            MODULE_ID,
        );

    if (!module) {
        console.error(
            `Region Automation | Module "${MODULE_ID}" was not found during init.`,
        );

        return;
    }

    module.api = {
        /**
         * Called by a Region Behavior when a token enters.
         *
         * A player sends a socket request.
         * The primary GM executes it directly.
         */
        requestBehaviorExecution,

        /**
         * Manual migration function.
         *
         * It can be called from the browser console with:
         *
         * game.modules
         *     .get("pf2e-exploration-automation")
         *     .api
         *     .migrateWorldBehaviors({ notify: true });
         */
        migrateWorldBehaviors,

        /**
         * Normalize a single Behavior.
         */
        normalizeBehaviorSource,

        /**
         * Exposed mainly for configuration and debugging.
         */
        genericBehaviorSource:
            GENERIC_BEHAVIOR_SOURCE,

        getPrimaryGM,
        isPrimaryGM,
    };

    /**
     * When a new RegionBehavior is created, immediately replace its
     * old macro-calling source with the safe generic dispatcher.
     *
     * This means your existing configuration macros can continue
     * creating Behaviors during the current testing phase.
     */
    Hooks.on(
        "createRegionBehavior",
        async behavior => {
            if (!isPrimaryGM()) {
                return;
            }

            try {
                await normalizeBehaviorSource(
                    behavior,
                );
            } catch (error) {
                console.error(
                    "Region Automation | Failed to normalize a newly created RegionBehavior.",
                    {
                        behaviorUuid:
                            behavior?.uuid,

                        error,
                    },
                );
            }
        },
    );

    console.log(
        "Region Automation | API initialized.",
    );
});

/**
 * The socket is available once Foundry reaches the ready hook.
 */
Hooks.once("ready", async () => {
    try {
        registerSocket();
    } catch (error) {
        console.error(
            "Region Automation | Failed to register the socket listener.",
            error,
        );

        return;
    }

    /**
     * Every connected client registers the listener, but only the
     * elected primary GM responds to execution requests.
     */
    if (!isPrimaryGM()) {
        console.log(
            "Region Automation | Player or secondary-GM client ready.",
        );

        return;
    }

    console.log(
        "Region Automation | Primary GM client ready.",
    );

    if (!AUTO_MIGRATE_BEHAVIORS) {
        return;
    }

    try {
        const summary =
            await migrateWorldBehaviors({
                notify:
                    false,
            });

        if (
            summary.updatedBehaviors >
            0
        ) {
            ui.notifications.info(
                `Region Automation updated ${summary.updatedBehaviors} Region Behavior(s).`,
            );
        }
    } catch (error) {
        console.error(
            "Region Automation | Automatic Region Behavior migration failed.",
            error,
        );

        ui.notifications.error(
            "Region Automation could not migrate existing Region Behaviors. See the browser console.",
        );
    }
});