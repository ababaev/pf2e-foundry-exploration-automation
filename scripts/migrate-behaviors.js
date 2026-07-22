/**
 * Region Automation
 * scripts/migrate-behaviors.js
 *
 * REGION BEHAVIOR MIGRATION
 * =========================
 *
 * Older Region Automation Behaviors directly execute macros such as:
 *
 * game.macros
 *     .getName("SearchFunctionMacros")
 *     .execute(...);
 *
 * That causes permission errors when the Region event runs on a
 * player client.
 *
 * This file replaces those old scripts with one generic dispatcher
 * that calls the module API.
 *
 * The configured functionality, DC, hint, subject, skills, and
 * triggeredTokenUuids flags are not changed.
 */

const MODULE_ID =
    "region-automation";

const SUPPORTED_FUNCTIONALITIES =
    new Set([
        "investigate",
        "search",
        "detect-magic",
        "saving-throw",
    ]);

/**
 * This is the script stored inside every Region Automation
 * Execute Script Behavior.
 *
 * It performs no roll and executes no macro.
 *
 * It only sends the Behavior UUID and Token UUID to the module API.
 */
export const GENERIC_BEHAVIOR_SOURCE = `
const raApi =
    game.modules
        .get("region-automation")
        ?.api;

if (
    !raApi ||
    typeof raApi.requestBehaviorExecution !== "function"
) {
    console.error(
        "Region Automation | Module API is unavailable.",
        {
            behavior,
            event,
            region,
            scene
        }
    );
} else {
    await raApi.requestBehaviorExecution({
        behaviorUuid:
            behavior?.uuid,

        tokenUuid:
            event?.data?.token?.document?.uuid ??
            event?.data?.token?.uuid,

        eventName:
            event?.name ??
            "tokenEnter"
    });
}
`.trim();

/**
 * Read the functionality flag from a RegionBehavior.
 */
function getFunctionality(
    behavior,
) {
    return String(
        behavior
            ?.flags
            ?.[MODULE_ID]
            ?.functionality ??
        "",
    ).trim();
}

/**
 * Check whether a Behavior belongs to Region Automation.
 */
function isRegionAutomationBehavior(
    behavior,
) {
    return SUPPORTED_FUNCTIONALITIES.has(
        getFunctionality(
            behavior,
        ),
    );
}

/**
 * Read a Region's Behavior collection defensively.
 */
function getRegionBehaviors(
    region,
) {
    if (region?.behaviors) {
        return Array.from(
            region.behaviors,
        );
    }

    const collection =
        region
            ?.getEmbeddedCollection
            ?.("RegionBehavior");

    return collection
        ? Array.from(collection)
        : [];
}

/**
 * Read a Scene's Region collection defensively.
 */
function getSceneRegions(
    scene,
) {
    if (scene?.regions) {
        return Array.from(
            scene.regions,
        );
    }

    const collection =
        scene
            ?.getEmbeddedCollection
            ?.("Region");

    return collection
        ? Array.from(collection)
        : [];
}

/**
 * Replace the source of one Region Automation Behavior.
 *
 * Returns true when an update was made.
 */
export async function normalizeBehaviorSource(
    behavior,
) {
    if (!game.user?.isGM) {
        return false;
    }

    if (
        !isRegionAutomationBehavior(
            behavior,
        )
    ) {
        return false;
    }

    const currentSource =
        String(
            behavior
                ?.system
                ?.source ??
            "",
        ).trim();

    if (
        currentSource ===
        GENERIC_BEHAVIOR_SOURCE
    ) {
        return false;
    }

    await behavior.update({
        "system.source":
            GENERIC_BEHAVIOR_SOURCE,
    });

    console.log(
        "Region Automation | Normalized RegionBehavior source.",
        {
            behaviorUuid:
                behavior.uuid,

            functionality:
                getFunctionality(
                    behavior,
                ),
        },
    );

    return true;
}

/**
 * Scan every Scene and update existing Region Automation Behaviors.
 *
 * This runs automatically for the primary GM when the world starts.
 * It may also be called manually through the module API.
 */
export async function migrateWorldBehaviors({
    notify =
        false,
} = {}) {
    if (!game.user?.isGM) {
        const summary = {
            ok: false,

            reason:
                "gm-required",

            scannedScenes:
                0,

            scannedRegions:
                0,

            scannedBehaviors:
                0,

            updatedBehaviors:
                0,

            failedRegions:
                0,
        };

        console.warn(
            "Region Automation | Only a GM can migrate Region Behaviors.",
            summary,
        );

        return summary;
    }

    const summary = {
        ok: true,

        reason:
            "migration-complete",

        scannedScenes:
            0,

        scannedRegions:
            0,

        scannedBehaviors:
            0,

        updatedBehaviors:
            0,

        failedRegions:
            0,
    };

    for (
        const scene
        of Array.from(
            game.scenes ?? [],
        )
    ) {
        summary.scannedScenes +=
            1;

        const regions =
            getSceneRegions(
                scene,
            );

        for (
            const region
            of regions
        ) {
            summary.scannedRegions +=
                1;

            const behaviors =
                getRegionBehaviors(
                    region,
                );

            summary.scannedBehaviors +=
                behaviors.length;

            const updates =
                behaviors
                    .filter(
                        behavior =>
                            isRegionAutomationBehavior(
                                behavior,
                            ),
                    )
                    .filter(
                        behavior =>
                            String(
                                behavior
                                    ?.system
                                    ?.source ??
                                "",
                            ).trim() !==
                            GENERIC_BEHAVIOR_SOURCE,
                    )
                    .map(
                        behavior => ({
                            _id:
                                behavior.id,

                            "system.source":
                                GENERIC_BEHAVIOR_SOURCE,
                        }),
                    );

            if (
                updates.length ===
                0
            ) {
                continue;
            }

            try {
                await region.updateEmbeddedDocuments(
                    "RegionBehavior",
                    updates,
                );

                summary.updatedBehaviors +=
                    updates.length;
            } catch (error) {
                summary.failedRegions +=
                    1;

                console.error(
                    "Region Automation | Could not migrate Behaviors in a Region.",
                    {
                        sceneUuid:
                            scene.uuid,

                        regionUuid:
                            region.uuid,

                        behaviorIds:
                            updates.map(
                                update =>
                                    update._id,
                            ),

                        error,
                    },
                );
            }
        }
    }

    console.log(
        "Region Automation | Region Behavior migration finished.",
        summary,
    );

    if (notify) {
        if (
            summary.failedRegions >
            0
        ) {
            ui.notifications.warn(
                `Region Automation updated ${summary.updatedBehaviors} Behavior(s), but ${summary.failedRegions} Region(s) failed. See the console.`,
            );
        } else {
            ui.notifications.info(
                `Region Automation updated ${summary.updatedBehaviors} Behavior(s).`,
            );
        }
    }

    return summary;
}
