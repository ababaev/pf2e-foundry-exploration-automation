import {
    registerSocket,
    requestBehaviorExecution,
} from "./socket.js";

Hooks.once("init", () => {
    const module =
        game.modules.get(
            "region-automation",
        );

    module.api = {
        requestBehaviorExecution,
    };
});

Hooks.once("ready", () => {
    registerSocket();
});
