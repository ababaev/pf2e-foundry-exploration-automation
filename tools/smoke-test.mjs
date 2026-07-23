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

game.ready =
    true;

await onceHooks.get("ready")();

console.log(
    "PF2e Exploration Automation | Startup smoke test passed.",
);
