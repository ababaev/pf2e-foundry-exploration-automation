/**
 * PF2e Exploration Automation
 * tests/helpers/mock-foundry.mjs
 *
 * Shared, minimal Foundry VTT globals for tests. Every test file installs
 * only what it needs on top of installBaseGlobals(); nothing here tries to
 * be a full Foundry emulator. Node's test runner spawns one process per
 * test file by default, so mutating globalThis in one file never leaks
 * into another.
 */

const MODULE_ID = "pf2e-exploration-automation";

/**
 * Installs game/ui/CONST/ChatMessage/Roll/canvas/foundry/fromUuid on
 * globalThis. Returns handles to inspect what happened (notifications
 * raised, chat messages created).
 */
export function installBaseGlobals({ isGM = true, userId = "gm-1" } = {}) {
    const notifications = { info: [], warn: [], error: [] };
    const chatMessages = [];
    const journals = [];

    const gmUser = { id: userId, active: true, isGM, settings: { showCheckDialogs: false } };

    const users = Object.assign([gmUser], { get: findUserId => users.find(user => user.id === findUserId) ?? null });

    globalThis.game = {
        user: gmUser,
        users,
        userId,
        modules: new Map(),
        macros: { find: () => undefined, filter: () => [], getName: () => undefined },
        journal: { find: predicate => journals.find(predicate) },
        pf2e: {},
        time: { worldTime: 0 },
    };

    globalThis.ui = {
        notifications: {
            info: message => notifications.info.push(message),
            warn: message => notifications.warn.push(message),
            error: message => notifications.error.push(message),
        },
    };

    globalThis.CONST = {
        DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
        JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1, MARKDOWN: 2 },
    };

    globalThis.ChatMessage = {
        create: async data => {
            const message = { id: `msg-${chatMessages.length}`, ...data };
            chatMessages.push(message);
            return message;
        },
    };

    globalThis.JournalEntry = {
        create: async data => {
            // A real Foundry document creation is never instantaneous (it's
            // at minimum a socket round-trip). Yielding here for real lets
            // concurrent callers actually interleave, so a test using this
            // mock can catch a check-then-create race instead of masking it
            // behind a same-tick, fully-synchronous mock.
            await new Promise(resolve => setTimeout(resolve, 0));

            const pages = [];
            const journal = {
                id: `journal-${journals.length}`,
                pages,
                ...data,
                async createEmbeddedDocuments(documentType, dataArray) {
                    const created = dataArray.map((entry, index) => ({ ...entry, id: `page-${pages.length + index}` }));
                    if (documentType === "JournalEntryPage") pages.push(...created);
                    return created;
                },
            };
            journals.push(journal);
            return journal;
        },
    };

    globalThis.Roll = class MockRoll {
        constructor(formula) {
            this.formula = formula;
        }

        async evaluate() {
            this.total = MockRoll.nextTotal ?? 10;
            return this;
        }
    };
    globalThis.Roll.nextTotal = 10;

    globalThis.canvas = {
        ready: true,
        scene: { uuid: "Scene.mock" },
        regions: { controlled: [] },
        tokens: { placeables: [], controlled: [] },
    };

    globalThis.__uuidDocuments = {};
    const resolveUuid = async uuid => globalThis.__uuidDocuments?.[uuid] ?? null;

    globalThis.foundry = {
        applications: {
            api: { DialogV2: { wait: async () => null } },
            ux: {},
        },
        utils: { fromUuid: resolveUuid },
    };

    globalThis.fromUuid = resolveUuid;

    globalThis.PointerEvent = globalThis.PointerEvent ?? class MockPointerEvent {
        constructor(type, options = {}) {
            this.type = type;
            Object.assign(this, options);
        }
    };

    /*
     * Several *ConfigurationMacros.js render callbacks do
     * `dialog.element instanceof HTMLElement`. Real Foundry always runs in
     * a browser where this exists; here we just need the class to exist
     * so the check doesn't throw. tests/helpers/fake-dialog.mjs makes its
     * fake root an instance of this.
     */
    globalThis.HTMLElement = globalThis.HTMLElement ?? class MockHTMLElement {};

    return { notifications, chatMessages, journals, gmUser };
}

/** Registers a document so fromUuid(uuid) resolves it. */
export function registerUuidDocument(uuid, document) {
    globalThis.__uuidDocuments ??= {};
    globalThis.__uuidDocuments[uuid] = document;
}

let nextId = 0;
function id(prefix) {
    nextId += 1;
    return `${prefix}-${nextId}`;
}

/**
 * A PF2e character actor with just enough shape for the activities'
 * exploration-activity gate, skill/save statistics, and roll helpers.
 */
export function makeActor({
    name = "Test Actor",
    type = "character",
    exploration = [],
    items = [],
    statistics = {},
    system = {},
    testUserPermission = () => false,
} = {}) {
    const itemMap = new Map(items.map(item => [item.id, item]));

    return {
        id: id("actor"),
        uuid: `Actor.${id("uuid")}`,
        name,
        type,
        system: { exploration, ...system },
        items: { get: itemId => itemMap.get(itemId) ?? null, find: predicate => items.find(predicate) ?? null },
        skills: statistics,
        saves: statistics,
        getStatistic(slug) {
            return statistics[slug] ?? null;
        },
        testUserPermission,
    };
}

/** An exploration-activity Item, as found via actor.items.get(itemId). */
export function makeExplorationItem({ name, slug, id: itemId = id("item"), traits = [] } = {}) {
    return { id: itemId, uuid: `Item.${itemId}`, name, slug, type: "action", system: { traits: { value: traits } } };
}

export function makeToken(actor, { name, parent = globalThis.canvas?.scene ?? null } = {}) {
    const tokenId = id("token");

    const document = {
        id: tokenId,
        uuid: `Token.${tokenId}`,
        documentName: "Token",
        actor,
        name: name ?? actor?.name,
        parent,
    };
    return { document, actor, name: name ?? actor?.name };
}

/**
 * Attaches a real (in-memory) dotted-path .update() and a .delete() that
 * splices the behavior out of `getBehaviors()` to a plain behavior object,
 * so registration/rollback/roster logic can exercise both for real.
 */
function withBehaviorMutators(behavior, getBehaviors) {
    behavior.update = async changes => {
        for (const [path, value] of Object.entries(changes)) {
            const parts = path.split(".");
            let cursor = behavior;
            for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]] ??= {};
            cursor[parts.at(-1)] = value;
        }
    };

    behavior.delete = async () => {
        const list = getBehaviors();
        const index = list.indexOf(behavior);
        if (index !== -1) list.splice(index, 1);
    };

    return behavior;
}

/**
 * A RegionBehavior document with a mutable flags[MODULE_ID] payload and a
 * real (in-memory) .update()/.delete() so registration/rollback logic can
 * be exercised for real.
 */
export function makeBehavior({ functionality, config = {}, triggeredTokenUuids = [], active = true, parent = null } = {}) {
    const behavior = {
        uuid: `RegionBehavior.${id("uuid")}`,
        documentName: "RegionBehavior",
        type: "executeScript",
        active,
        parent,
        flags: { [MODULE_ID]: { functionality, config, triggeredTokenUuids: [...triggeredTokenUuids] } },
    };
    return withBehaviorMutators(behavior, () => parent?.behaviors ?? []);
}

export function makeRegion({ name = "Test Region", behaviors = [] } = {}) {
    const region = {
        uuid: `Region.${id("uuid")}`,
        name,
        behaviors,
        parent: globalThis.canvas?.scene ?? null,
        async createEmbeddedDocuments(documentType, dataArray) {
            const created = dataArray.map(data =>
                withBehaviorMutators({ ...data, id: id("behavior"), uuid: `RegionBehavior.${id("uuid")}` }, () => region.behaviors),
            );
            if (documentType === "RegionBehavior") region.behaviors.push(...created);
            return created;
        },
        async updateEmbeddedDocuments(documentType, updates) {
            for (const update of updates) {
                const target = region.behaviors.find(behavior => behavior.id === update._id);
                if (!target) continue;
                for (const [path, value] of Object.entries(update)) {
                    if (path === "_id") continue;
                    const parts = path.split(".");
                    let cursor = target;
                    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]] ??= {};
                    cursor[parts.at(-1)] = value;
                }
            }
            return updates;
        },
    };
    return region;
}

export { MODULE_ID };
