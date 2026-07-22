/**
 * PF2e Exploration Automation
 * scripts/main.js
 *
 * MODULE ENTRY POINT
 * ==================
 *
 * This file:
 *
 * 1. Exposes the module API used by Region Behaviors.
 * 2. Registers the player-to-GM socket.
 * 3. Migrates existing Region Behavior scripts.
 * 4. Normalizes newly created Region Automation Behaviors.
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

const AUTO_MIGRATE_BEHAVIORS =
    true;

/**
 * Expose the API immediately.
 *
 * We do not wait for the init hook, because init fires only once.
 */
function exposeApi() {
    const module =
        game.modules.get(
            MODULE_ID,
        );

    if (!module) {
        console.error(
            `PF2e Exploration Automation | Module "${MODULE_ID}" was not found.`,
        );

        return false;
    }

    module.api = {
        requestBehaviorExecution,
        migrateWorldBehaviors,
        normalizeBehaviorSource,
        genericBehaviorSource:
            GENERIC_BEHAVIOR_SOURCE,
        getPrimaryGM,
        isPrimaryGM,
    };

    console.log(
        "PF2e Exploration Automation | API initialized.",
    );

    return true;
}

exposeApi();

/**
 * Normalize newly created Region Automation Behaviors.
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
                "PF2e Exploration Automation | Failed to normalize a new RegionBehavior.",
                {
                    behaviorUuid:
                        behavior?.uuid,

                    error,
                },
            );
        }
    },
);

/**
 * Socket registration and world migration require a ready world.
 */
Hooks.once(
    "ready",
    async () => {
        registerSocket();

        if (!isPrimaryGM()) {
            console.log(
                "PF2e Exploration Automation | Player or secondary GM ready.",
            );

            return;
        }

        console.log(
            "PF2e Exploration Automation | Primary GM ready.",
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

            console.log(
                "PF2e Exploration Automation | Behavior migration finished.",
                summary,
            );
        } catch (error) {
            console.error(
                "PF2e Exploration Automation | Behavior migration failed.",
                error,
            );
        }
    },
);