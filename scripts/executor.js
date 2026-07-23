import {
    runInvestigate,
} from "./world-macros/InvestigateFunctionMacros.js";

import {
    runSearch,
} from "./world-macros/SearchFunctionMacros.js";

/**
 * Region Automation
 * scripts/executor.js
 *
 * GM-SIDE EXECUTION
 * =================
 *
 * This file handles a validated Region Automation request on the
 * elected GM client.
 *
 * It:
 *
 * 1. Resolves the RegionBehavior and Token from their UUIDs.
 * 2. Verifies that the request is legitimate.
 * 3. Determines which automation is configured.
 * 4. Executes the existing GM-owned function macro.
 *
 * The existing function macros continue to call:
 *
 * - RegistrationMacros;
 * - ExplorationActivityMacros;
 * - their corresponding RollHelper macro.
 *
 * Because this happens on the GM client, those macros can update the
 * RegionBehavior and perform secret checks safely.
 */

export const MODULE_ID =
    "pf2e-exploration-automation";

/**
 * The functionality flag stored in the RegionBehavior determines
 * which existing macro should execute.
 *
 * These names must exactly match your world macro names.
 */
export const FUNCTION_MACRO_NAMES =
    Object.freeze({
        investigate:
            "InvestigateFunctionMacros",

        search:
            "SearchFunctionMacros",

        "detect-magic":
            "DetectMagicFunctionMacros",

        "saving-throw":
            "SavingThrowFunctionMacros",
    });

/**
 * Functionality already moved from world macros into the module.
 */
const MODULE_FUNCTIONS =
    Object.freeze({
        investigate:
            runInvestigate,

        search:
            runSearch,
    });

/**
 * Requests for the same Behavior and Token can occasionally arrive
 * from more than one client.
 *
 * This lock prevents simultaneous execution on the GM client.
 */
const activeExecutionKeys =
    new Set();

/**
 * Remember recently completed request IDs.
 *
 * This protects against accidental delivery of the exact same socket
 * request more than once.
 */
const recentRequestIds =
    new Map();

const REQUEST_RETENTION_MS =
    30_000;

/**
 * Remove expired request IDs from memory.
 */
function cleanRecentRequestIds() {
    const cutoff =
        Date.now() -
        REQUEST_RETENTION_MS;

    for (
        const [
            requestId,
            completedAt,
        ]
        of recentRequestIds
    ) {
        if (
            completedAt <
            cutoff
        ) {
            recentRequestIds.delete(
                requestId,
            );
        }
    }
}

/**
 * Read the Region Automation functionality from the Behavior flags.
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
 * Determine whether the requesting user is allowed to control the
 * actor that entered the Region.
 *
 * GMs always pass this test.
 */
function requesterMayUseActor({
    requester,
    actor,
}) {
    if (!requester) {
        return false;
    }

    if (requester.isGM) {
        return true;
    }

    const ownerLevel =
        CONST
            .DOCUMENT_OWNERSHIP_LEVELS
            .OWNER;

    return Boolean(
        actor
            ?.testUserPermission
            ?.(requester, ownerLevel),
    );
}

/**
 * Resolve a Foundry document from a UUID.
 */
async function resolveDocument(
    uuid,
) {
    const resolver =
        foundry.utils
            ?.fromUuid ??
        globalThis.fromUuid;

    if (
        typeof resolver !==
        "function"
    ) {
        throw new Error(
            "Foundry fromUuid resolver is unavailable.",
        );
    }

    return resolver(
        uuid,
    );
}

/**
 * Execute one Region Automation request on the GM client.
 */
export async function executeBehaviorRequest(
    request,
) {
    cleanRecentRequestIds();

    if (!game.user?.isGM) {
        const result = {
            ok: false,

            reason:
                "execution-client-is-not-gm",
        };

        console.error(
            "Region Automation | A non-GM client attempted GM execution.",
            {
                request,
                result,
            },
        );

        return result;
    }

    const requestId =
        String(
            request?.requestId ??
            "",
        ).trim();

    const requesterUserId =
        String(
            request
                ?.requesterUserId ??
            "",
        ).trim();

    const behaviorUuid =
        String(
            request
                ?.behaviorUuid ??
            "",
        ).trim();

    const tokenUuid =
        String(
            request
                ?.tokenUuid ??
            "",
        ).trim();

    const eventName =
        String(
            request?.eventName ??
            "tokenEnter",
        ).trim();

    if (
        !requestId ||
        !requesterUserId ||
        !behaviorUuid ||
        !tokenUuid
    ) {
        const result = {
            ok: false,

            reason:
                "invalid-request-data",

            request,
        };

        console.error(
            "Region Automation | GM received an incomplete execution request.",
            result,
        );

        return result;
    }

    if (
        recentRequestIds.has(
            requestId,
        )
    ) {
        return {
            ok: true,

            reason:
                "duplicate-request-ignored",

            requestId,
        };
    }

    /**
     * Region Automation currently handles tokenEnter only.
     */
    if (
        eventName !==
        "tokenEnter"
    ) {
        const result = {
            ok: false,

            reason:
                "unsupported-region-event",

            eventName,

            requestId,
        };

        console.warn(
            "Region Automation | Unsupported Region event ignored.",
            result,
        );

        return result;
    }

    let behavior;
    let token;

    try {
        [
            behavior,
            token,
        ] =
            await Promise.all([
                resolveDocument(
                    behaviorUuid,
                ),

                resolveDocument(
                    tokenUuid,
                ),
            ]);
    } catch (error) {
        const result = {
            ok: false,

            reason:
                "document-resolution-failed",

            behaviorUuid,

            tokenUuid,

            error,
        };

        console.error(
            "Region Automation | Could not resolve the request documents.",
            result,
        );

        return result;
    }

    if (
        !behavior ||
        behavior.documentName !==
            "RegionBehavior"
    ) {
        const result = {
            ok: false,

            reason:
                "region-behavior-not-found",

            behaviorUuid,
        };

        console.error(
            "Region Automation | The requested RegionBehavior could not be found.",
            result,
        );

        return result;
    }

    if (
        !token ||
        token.documentName !==
            "Token"
    ) {
        const result = {
            ok: false,

            reason:
                "token-not-found",

            tokenUuid,
        };

        console.error(
            "Region Automation | The requested Token could not be found.",
            result,
        );

        return result;
    }

    /**
     * RegionBehavior.active is false when Foundry considers the
     * Behavior inactive.
     */
    if (
        behavior.active ===
        false
    ) {
        return {
            ok: true,

            reason:
                "behavior-inactive",

            behaviorUuid,
        };
    }

    /**
     * Only Execute Script Behaviors should call this bridge.
     *
     * The check is conditional for defensive compatibility in case
     * the document does not expose a type property.
     */
    if (
        behavior.type &&
        behavior.type !==
            "executeScript"
    ) {
        const result = {
            ok: false,

            reason:
                "unexpected-behavior-type",

            behaviorType:
                behavior.type,

            behaviorUuid,
        };

        console.warn(
            "Region Automation | Request came from a non-script RegionBehavior.",
            result,
        );

        return result;
    }

    const region =
        behavior.parent ??
        null;

    const scene =
        region?.parent ??
        token.parent ??
        null;

    const actor =
        token.actor ??
        null;

    if (
        !region ||
        !scene ||
        !actor
    ) {
        const result = {
            ok: false,

            reason:
                "incomplete-document-context",

            behaviorUuid,

            tokenUuid,

            hasRegion:
                Boolean(region),

            hasScene:
                Boolean(scene),

            hasActor:
                Boolean(actor),
        };

        console.error(
            "Region Automation | Resolved documents have incomplete context.",
            result,
        );

        return result;
    }

    const requester =
        game.users.get(
            requesterUserId,
        );

    if (
        !requesterMayUseActor({
            requester,
            actor,
        })
    ) {
        const result = {
            ok: false,

            reason:
                "requester-does-not-own-actor",

            requesterUserId,

            actorUuid:
                actor.uuid,

            tokenUuid,
        };

        console.warn(
            "Region Automation | Rejected an unauthorized execution request.",
            result,
        );

        return result;
    }

    const functionality =
        getFunctionality(
            behavior,
        );

    const moduleFunction =
        MODULE_FUNCTIONS[
            functionality
        ] ??
        null;

    const functionMacroName =
        FUNCTION_MACRO_NAMES[
            functionality
        ] ??
        null;

    if (
        !moduleFunction &&
        !functionMacroName
    ) {
        const result = {
            ok: false,

            reason:
                "unsupported-functionality",

            functionality,

            behaviorUuid,
        };

        console.error(
            "Region Automation | RegionBehavior has an unsupported functionality flag.",
            result,
        );

        return result;
    }

    const executionKey =
        [
            behaviorUuid,
            tokenUuid,
        ].join("::");

    if (
        activeExecutionKeys.has(
            executionKey,
        )
    ) {
        return {
            ok: true,

            reason:
                "execution-already-in-progress",

            executionKey,

            requestId,
        };
    }

    activeExecutionKeys.add(
        executionKey,
    );

    try {
        let functionMacro =
            null;

        if (!moduleFunction) {
            functionMacro =
                game.macros.getName(
                    functionMacroName,
                );
        }

        if (
            !moduleFunction &&
            !functionMacro
        ) {
            const result = {
                ok: false,

                reason:
                    "function-macro-not-found",

                functionMacroName,

                functionality,
            };

            console.error(
                "Region Automation | Required function macro was not found.",
                result,
            );

            return result;
        }

        /**
         * Reconstruct the small part of the Region event used by the
         * existing macro architecture.
         */
        const syntheticEvent = {
            name:
                eventName,

            data: {
                token,
            },

            requesterUserId,

            requestId,
        };

        console.debug(
            "Region Automation | Executing Behavior as GM.",
            {
                requestId,

                functionality,

                functionMacroName,

                behaviorUuid,

                tokenUuid,

                actorUuid:
                    actor.uuid,

                requesterUserId,
            },
        );

        /**
         * This is deliberately executed only on the GM client.
         */
        const executionContext = {
            behavior,
            event:
                syntheticEvent,
            region,
            scene,
            token,
            actor,
        };

        if (moduleFunction) {
            await moduleFunction(
                executionContext,
            );
        } else {
            await functionMacro.execute(
                executionContext,
            );
        }

        recentRequestIds.set(
            requestId,
            Date.now(),
        );

        return {
            ok: true,

            reason:
                "executed-as-gm",

            requestId,

            functionality,

            functionMacroName,

            behaviorUuid,

            tokenUuid,

            actorUuid:
                actor.uuid,
        };
    } catch (error) {
        const result = {
            ok: false,

            reason:
                "function-macro-execution-failed",

            requestId,

            functionality,

            functionMacroName,

            behaviorUuid,

            tokenUuid,

            error,
        };

        console.error(
            "Region Automation | GM-side function macro execution failed.",
            result,
        );

        return result;
    } finally {
        activeExecutionKeys.delete(
            executionKey,
        );
    }
}
