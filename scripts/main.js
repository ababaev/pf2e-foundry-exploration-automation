/**
 * PF2e Exploration Automation
 * scripts/main.js
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

let apiInitialized =
    false;

let readyInitialized =
    false;

/**
 * Expose the public module API.
 *
 * During early ES-module evaluation, game may exist while
 * game.modules is still unavailable. Therefore this function must
 * tolerate being called before Foundry's init hook.
 */
function exposeApi() {
    if (apiInitialized) {
        return true;
    }

    const packageModule =
        globalThis.game
            ?.modules
            ?.get?.(
                MODULE_ID,
            ) ??
        null;

    if (!packageModule) {
        return false;
    }

    packageModule.api = {
        requestBehaviorExecution,
        migrateWorldBehaviors,
        normalizeBehaviorSource,

        genericBehaviorSource:
            GENERIC_BEHAVIOR_SOURCE,

        getPrimaryGM,
        isPrimaryGM,
    };

    apiInitialized =
        true;

    console.log(
        "PF2e Exploration Automation | API initialized.",
    );

    return true;
}

/**
 * Normalize newly created automation Behaviors.
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
 * Initialize everything that requires a ready world.
 */
async function initializeReady() {
    if (readyInitialized) {
        return;
    }

    readyInitialized =
        true;

    /*
     * Normally the API was exposed during init.
     * Retry here defensively in case game.modules was not ready then.
     */
    if (!exposeApi()) {
        console.error(
            `PF2e Exploration Automation | Module "${MODULE_ID}" is unavailable after the ready hook.`,
        );

        return;
    }

    try {
        registerSocket();
    } catch (error) {
        console.error(
            "PF2e Exploration Automation | Socket registration failed.",
            error,
        );

        return;
    }

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
}

/*
 * Normal startup:
 * module file loads first, API is exposed during init.
 *
 * Late diagnostic import:
 * game.modules already exists, so expose it immediately.
 */
if (
    globalThis.game
        ?.modules
        ?.get?.(
            MODULE_ID,
        )
) {
    exposeApi();
} else {
    Hooks.once(
        "init",
        () => {
            if (!exposeApi()) {
                console.warn(
                    "PF2e Exploration Automation | API was not available during init; ready will retry.",
                );
            }
        },
    );
}

/*
 * Normal startup waits for ready.
 * A late import after ready initializes immediately.
 */
if (globalThis.game?.ready) {
    void initializeReady();
} else {
    Hooks.once(
        "ready",
        initializeReady,
    );
}
