export async function checkExplorationActivity({
    token = null,
    actor = null,
    activity = "investigate",
    debug = false,
    resultBox = null,
} = {}) {
    "use strict";

/*
 * Expected Macro.execute scope:
 *
 * {
 *     token,
 *     actor,
 *     activity: "investigate",
 *     debug: true,
 *     resultBox: { value: null }
 * }
 */

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

    return value;
};

const raNormalizeActivitySlug = value =>
    String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

const raInputToken =
    typeof token !== "undefined"
        ? token
        : null;

const raTokenDocument =
    raInputToken?.document ??
    raInputToken ??
    null;

const raInputActor =
    typeof actor !== "undefined"
        ? actor
        : null;

const raActor =
    raInputActor ??
    raTokenDocument?.actor ??
    raInputToken?.actor ??
    null;

const raRequestedActivity = raNormalizeActivitySlug(
    typeof activity !== "undefined"
        ? activity
        : "investigate",
);

const raDebug =
    typeof debug !== "undefined"
        ? Boolean(debug)
        : false;

if (!raActor) {
    const raResult = {
        ok: false,
        active: false,
        requestedActivity: raRequestedActivity,
        reason: "no-actor",
        actor: null,
        token: raTokenDocument,
        item: null,
        activeActivities: [],
        missingItemIds: [],
    };

    raPublishResult(raResult);

    if (raDebug) {
        console.warn(
            "Region Automation | Exploration activity check has no actor",
            raResult,
        );
    }

    return;
}

const raExplorationSource =
    raActor.system?.exploration ?? [];

const raExplorationItemIds =
    Array.isArray(raExplorationSource)
        ? [...raExplorationSource]
        : Array.from(raExplorationSource);

const raActivityItems = [];
const raMissingItemIds = [];

for (const raItemId of raExplorationItemIds) {
    const raItem =
        raActor.items?.get(raItemId) ?? null;

    if (raItem) {
        raActivityItems.push(raItem);
    } else {
        raMissingItemIds.push(raItemId);
    }
}

const raGetItemSlug = item =>
    raNormalizeActivitySlug(
        item?.slug ??
        item?.system?.slug ??
        item?.name ??
        "",
    );

const raMatchingItem =
    raActivityItems.find(
        item =>
            raGetItemSlug(item) ===
            raRequestedActivity,
    ) ?? null;

const raActivitySummaries =
    raActivityItems.map(item => ({
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        slug: raGetItemSlug(item),
        type: item.type,

        traits: Array.isArray(
            item.system?.traits?.value,
        )
            ? [...item.system.traits.value]
            : [],
    }));

const raResult = {
    ok: true,
    active: Boolean(raMatchingItem),

    requestedActivity: raRequestedActivity,

    reason: raMatchingItem
        ? "activity-active"
        : "activity-not-active",

    actor: raActor,
    token: raTokenDocument,
    item: raMatchingItem,

    actorSummary: {
        id: raActor.id,
        uuid: raActor.uuid,
        name: raActor.name,
        type: raActor.type,
    },

    tokenSummary: raTokenDocument
        ? {
            id: raTokenDocument.id,
            uuid: raTokenDocument.uuid,
            name: raTokenDocument.name,
        }
        : null,

    matchedActivity: raMatchingItem
        ? {
            id: raMatchingItem.id,
            uuid: raMatchingItem.uuid,
            name: raMatchingItem.name,
            slug: raGetItemSlug(
                raMatchingItem,
            ),
            type: raMatchingItem.type,

            traits: Array.isArray(
                raMatchingItem.system
                    ?.traits?.value,
            )
                ? [
                    ...raMatchingItem.system
                        .traits.value,
                ]
                : [],
        }
        : null,

    activeActivities: raActivitySummaries,
    missingItemIds: raMissingItemIds,
};

raPublishResult(raResult);

if (raDebug) {
    console.log(
        "Region Automation | Exploration activity check",
        raResult,
    );
}

}
