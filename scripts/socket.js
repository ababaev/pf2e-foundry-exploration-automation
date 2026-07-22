/**
 * Region Automation
 * scripts/socket.js
 *
 * PLAYER-TO-GM COMMUNICATION
 * ==========================
 *
 * A player is not allowed to:
 *
 * - update RegionBehavior flags;
 * - execute GM-owned helper macros;
 * - perform and inspect secret Region Automation checks.
 *
 * Therefore, a player client sends a small socket request containing
 * only UUIDs.
 *
 * Exactly one active GM is elected to handle each request.
 */

import {
    executeBehaviorRequest,
} from "./executor.js";

export const MODULE_ID =
    "region-automation";

export const SOCKET_CHANNEL =
    `module.${MODULE_ID}`;

const REQUEST_TYPE =
    "execute-behavior";

let socketRegistered =
    false;

/**
 * Return the elected active GM.
 *
 * When several GMs are online, sorting by user ID ensures that every
 * client independently chooses the same GM.
 */
export function getPrimaryGM() {
    const activeGMs =
        Array.from(
            game.users ?? [],
        )
            .filter(
                user =>
                    user.active &&
                    user.isGM,
            )
            .sort(
                (left, right) =>
                    String(
                        left.id,
                    ).localeCompare(
                        String(
                            right.id,
                        ),
                    ),
            );

    return (
        activeGMs[0] ??
        null
    );
}

/**
 * Check whether this client is the elected primary GM.
 */
export function isPrimaryGM() {
    const primaryGM =
        getPrimaryGM();

    return Boolean(
        game.user?.isGM &&
        primaryGM &&
        primaryGM.id ===
            game.user.id,
    );
}

/**
 * Produce a request ID.
 *
 * The ID is useful for logging and duplicate-request protection.
 */
function createRequestId() {
    if (
        typeof foundry.utils
            ?.randomID ===
        "function"
    ) {
        return foundry.utils.randomID();
    }

    if (
        typeof crypto
            ?.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return [
        Date.now(),
        Math.random()
            .toString(36)
            .slice(2),
    ].join("-");
}

/**
 * Validate a UUID-like request field.
 */
function normalizeUuid(value) {
    return (
        typeof value ===
        "string"
            ? value.trim()
            : ""
    );
}

/**
 * Called by the Region Behavior script.
 *
 * When this client is the primary GM, the request is executed
 * immediately.
 *
 * When this client is a player or secondary GM, the request is sent
 * through the module socket.
 */
export async function requestBehaviorExecution({
    behaviorUuid,
    tokenUuid,
    eventName =
        "tokenEnter",
} = {}) {
    const resolvedBehaviorUuid =
        normalizeUuid(
            behaviorUuid,
        );

    const resolvedTokenUuid =
        normalizeUuid(
            tokenUuid,
        );

    const resolvedEventName =
        String(
            eventName ??
            "tokenEnter",
        ).trim();

    if (
        !resolvedBehaviorUuid ||
        !resolvedTokenUuid
    ) {
        const result = {
            ok: false,

            reason:
                "missing-request-uuid",

            behaviorUuid:
                resolvedBehaviorUuid,

            tokenUuid:
                resolvedTokenUuid,
        };

        console.error(
            "Region Automation | Region Behavior supplied an incomplete request.",
            result,
        );

        return result;
    }

    const primaryGM =
        getPrimaryGM();

    if (!primaryGM) {
        const result = {
            ok: false,

            reason:
                "no-active-gm",

            behaviorUuid:
                resolvedBehaviorUuid,

            tokenUuid:
                resolvedTokenUuid,
        };

        console.error(
            "Region Automation | A token entered a Region, but no active GM is available.",
            result,
        );

        ui.notifications.warn(
            "Region Automation requires an active GM.",
        );

        return result;
    }

    /**
     * Only plain serializable values are sent through the socket.
     *
     * Never send Actor, Token, Region, or Behavior document objects.
     */
    const request = {
        type:
            REQUEST_TYPE,

        requestId:
            createRequestId(),

        requesterUserId:
            game.user.id,

        behaviorUuid:
            resolvedBehaviorUuid,

        tokenUuid:
            resolvedTokenUuid,

        eventName:
            resolvedEventName,
    };

    /**
     * The primary GM does not need to send a socket message to itself.
     */
    if (
        primaryGM.id ===
        game.user.id
    ) {
        return executeBehaviorRequest(
            request,
        );
    }

    game.socket.emit(
        SOCKET_CHANNEL,
        request,
    );

    return {
        ok: true,

        reason:
            "sent-to-gm",

        requestId:
            request.requestId,

        primaryGMId:
            primaryGM.id,
    };
}

/**
 * Register the socket listener on this client.
 *
 * Every client receives socket events, but only the primary GM acts
 * on Region Automation execution requests.
 */
export function registerSocket() {
    if (socketRegistered) {
        return;
    }

    if (!game.socket) {
        throw new Error(
            "Foundry game.socket is unavailable.",
        );
    }

    game.socket.on(
        SOCKET_CHANNEL,
        async request => {
            if (!isPrimaryGM()) {
                return;
            }

            if (
                !request ||
                request.type !==
                    REQUEST_TYPE
            ) {
                return;
            }

            try {
                await executeBehaviorRequest(
                    request,
                );
            } catch (error) {
                console.error(
                    "Region Automation | Unhandled GM execution error.",
                    {
                        request,
                        error,
                    },
                );
            }
        },
    );

    socketRegistered =
        true;

    console.log(
        `Region Automation | Socket listener registered on "${SOCKET_CHANNEL}".`,
    );
}
