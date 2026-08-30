const onceHooks =
    new Map();

const persistentHooks =
    new Map();

globalThis.Hooks = {
    once(
        name,
        callback,
    ) {
        onceHooks.set(
            name,
            callback,
        );
    },

    on(
        name,
        callback,
    ) {
        persistentHooks.set(
            name,
            callback,
        );
    },
};

const gmUser = {
    id:
        "test-gm",

    active:
        true,

    isGM:
        true,
};

globalThis.game = {
    /*
     * Intentionally absent during import.
     *
     * This reproduces the Foundry startup state that caused the
     * game.modules.get crash.
     */
    modules:
        undefined,

    ready:
        false,

    user:
        gmUser,

    users: [
        gmUser,
    ],

    scenes:
        [],

    socket: {
        on() {
            // Socket registration test stub.
        },
    },
};

globalThis.ui = {
    notifications: {
        info() {},
        warn() {},
        error() {},
    },
};

globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
        OWNER:
            3,
    },
};

globalThis.fetch =
    async () => ({
        ok:
            true,

        async text() {
            return "// smoke-test macro source";
        },
    });

const createdMacros =
    [];

globalThis.Macro = {
    create:
        async data => {
            const macro =
                { ...data, id: `macro-${createdMacros.length}` };

            macro.delete =
                async () => {
                    const index =
                        createdMacros.indexOf(
                            macro,
                        );

                    if (index !== -1) {
                        createdMacros.splice(
                            index,
                            1,
                        );
                    }
                };

            createdMacros.push(
                macro,
            );

            return macro;
        },
};

globalThis.Folder = {
    create:
        async data => ({
            ...data,
            id:
                "folder-0",
        }),
};

game.macros = {
    find(
        predicate,
    ) {
        return createdMacros.find(
            predicate,
        );
    },

    filter(
        predicate,
    ) {
        return createdMacros.filter(
            predicate,
        );
    },
};

game.folders = {
    find() {
        return undefined;
    },
};

await import(
    `../scripts/main.js?smoke=${Date.now()}`
);

if (!onceHooks.has("init")) {
    throw new Error(
        "main.js did not register an init hook.",
    );
}

if (!onceHooks.has("ready")) {
    throw new Error(
        "main.js did not register a ready hook.",
    );
}

const packageModule = {
    api:
        undefined,
};

game.modules =
    new Map([
        [
            "pf2e-exploration-automation",
            packageModule,
        ],
    ]);

await onceHooks.get("init")();

if (
    typeof packageModule
        .api
        ?.requestBehaviorExecution !==
    "function"
) {
    throw new Error(
        "The module API was not exposed during init.",
    );
}

if (
    typeof packageModule
        .api
        ?.logToGMJournal !==
    "function"
) {
    throw new Error(
        "logToGMJournal was not exposed on the module API during init.",
    );
}

if (
    typeof packageModule
        .api
        ?.gmLogJournalName !==
    "string"
) {
    throw new Error(
        "gmLogJournalName was not exposed on the module API during init.",
    );
}

if (
    typeof packageModule
        .api
        ?.openConfigurationDialog !==
    "function"
) {
    throw new Error(
        "openConfigurationDialog was not exposed on the module API during init.",
    );
}

if (
    typeof packageModule
        .api
        ?.runFoundryCompatCheck !==
    "function"
) {
    throw new Error(
        "runFoundryCompatCheck was not exposed on the module API during init.",
    );
}

/*
 * Simulate a macro left over from a MANAGED_MACROS entry that was later
 * removed (e.g. SavingThrowFunctionMacros, once it became ES-only).
 * syncWorldMacros should prune this during the ready hook below.
 */
const orphanedMacro = {
    id: "macro-orphan",
    name: "SomeRemovedManagedMacro",
    type: "script",
    flags: { "pf2e-exploration-automation": { managed: true } },
};

orphanedMacro.delete =
    async () => {
        const index =
            createdMacros.indexOf(
                orphanedMacro,
            );

        if (index !== -1) {
            createdMacros.splice(
                index,
                1,
            );
        }
    };

createdMacros.push(
    orphanedMacro,
);

game.ready =
    true;

await onceHooks.get("ready")();

if (
    createdMacros.some(
        macro =>
            macro.name ===
            "SomeRemovedManagedMacro",
    )
) {
    throw new Error(
        "syncWorldMacros did not prune an orphaned managed macro during the ready hook.",
    );
}

if (
    createdMacros.length ===
    0
) {
    throw new Error(
        "syncWorldMacros did not create any macros during the ready hook.",
    );
}

console.log(
    "PF2e Exploration Automation | Startup smoke test passed.",
);
