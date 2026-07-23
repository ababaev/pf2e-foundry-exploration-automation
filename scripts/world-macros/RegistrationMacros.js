export async function registerTokenTrigger({
    behavior = null,
    token = null,
    debug = false,
    resultBox = null,
} = {}) {
    "use strict";

/*
 * RegistrationMacros
 *
 * Expected Macro.execute scope:
 * {
 *   behavior: RegionBehavior,
 *   token: TokenDocument,
 *   resultBox: { value: null },
 *   debug: true
 * }
 *
 * Result:
 * {
 *   ok: boolean,
 *   firstTrigger: boolean,
 *   alreadyRegistered: boolean,
 *   reason: string,
 *   tokenUuid: string | null,
 *   behaviorUuid: string | null
 * }
 */

const raModuleId = "pf2e-exploration-automation";

const raResultBox =
    typeof resultBox !== "undefined" &&
    resultBox &&
    typeof resultBox === "object"
        ? resultBox
        : null;

const raPublishResult = value => {
    if (raResultBox) {
        raResultBox.value = value;
    }
};

const raBehavior =
    typeof behavior !== "undefined"
        ? behavior
        : null;

const raInputToken =
    typeof token !== "undefined"
        ? token
        : null;

const raTokenDocument =
    raInputToken?.document ??
    raInputToken ??
    null;

const raDebug =
    typeof debug !== "undefined"
        ? Boolean(debug)
        : false;

if (!raBehavior || !raTokenDocument?.uuid) {
    const raResult = {
        ok: false,
        firstTrigger: false,
        alreadyRegistered: false,

        reason: !raBehavior
            ? "missing-behavior"
            : "missing-token-uuid",

        behaviorUuid:
            raBehavior?.uuid ?? null,

        tokenUuid:
            raTokenDocument?.uuid ?? null,
    };

    raPublishResult(raResult);

    console.error(
        "Region Automation | Registration received incomplete context",
        raResult,
    );

    return;
}

const raTokenUuid =
    raTokenDocument.uuid;

const raBehaviorUuid =
    raBehavior.uuid;

/*
 * Prevent two nearly simultaneous events on the same client from both
 * passing before the Behavior update completes.
 *
 * Multi-GM synchronization will be handled later.
 */
globalThis.RegionAutomationRegistrationLocks ??=
    new Set();

const raLockKey =
    `${raBehaviorUuid}::${raTokenUuid}`;

if (
    globalThis.RegionAutomationRegistrationLocks.has(
        raLockKey,
    )
) {
    const raResult = {
        ok: true,
        firstTrigger: false,
        alreadyRegistered: true,
        reason: "registration-in-progress",
        behaviorUuid: raBehaviorUuid,
        tokenUuid: raTokenUuid,
    };

    raPublishResult(raResult);

    if (raDebug) {
        console.info(
            "Region Automation | Registration already in progress",
            raResult,
        );
    }

    return;
}

globalThis.RegionAutomationRegistrationLocks.add(
    raLockKey,
);

try {
    const raStoredTokenUuids =
        raBehavior.flags?.[raModuleId]
            ?.triggeredTokenUuids;

    /*
     * Sanitize stored data in case the array was manually changed.
     */
    const raRegisteredTokenUuids =
        Array.isArray(raStoredTokenUuids)
            ? Array.from(
                new Set(
                    raStoredTokenUuids.filter(
                        value =>
                            typeof value === "string" &&
                            value.length > 0,
                    ),
                ),
            )
            : [];

    if (
        raRegisteredTokenUuids.includes(
            raTokenUuid,
        )
    ) {
        const raResult = {
            ok: true,
            firstTrigger: false,
            alreadyRegistered: true,
            reason: "already-registered",
            behaviorUuid: raBehaviorUuid,
            tokenUuid: raTokenUuid,
            registeredTokenUuids:
                raRegisteredTokenUuids,
        };

        raPublishResult(raResult);

        if (raDebug) {
            console.info(
                "Region Automation | Token already registered",
                raResult,
            );
        }

        return;
    }

    const raUpdatedTokenUuids = [
        ...raRegisteredTokenUuids,
        raTokenUuid,
    ];

    await raBehavior.update({
        [`flags.${raModuleId}.triggeredTokenUuids`]:
            raUpdatedTokenUuids,
    });

    const raResult = {
        ok: true,
        firstTrigger: true,
        alreadyRegistered: false,
        reason: "registered",
        behaviorUuid: raBehaviorUuid,
        tokenUuid: raTokenUuid,
        registeredTokenUuids:
            raUpdatedTokenUuids,
    };

    raPublishResult(raResult);

    if (raDebug) {
        console.log(
            "Region Automation | Token registered",
            raResult,
        );
    }
} catch (error) {
    const raResult = {
        ok: false,
        firstTrigger: false,
        alreadyRegistered: false,
        reason: "behavior-update-failed",
        behaviorUuid: raBehaviorUuid,
        tokenUuid: raTokenUuid,
        error,
    };

    raPublishResult(raResult);

    console.error(
        "Region Automation | Registration update failed",
        error,
    );
} finally {
    globalThis.RegionAutomationRegistrationLocks.delete(
        raLockKey,
    );
}

}
