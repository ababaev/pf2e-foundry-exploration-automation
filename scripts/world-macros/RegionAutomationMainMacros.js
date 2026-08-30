await (async () => {

    const raModuleId =
        "pf2e-exploration-automation";

    const functionalityLabels = {
        investigate:
            "Investigation",

        "detect-magic":
            "Detect Magic",

        search:
            "Search",

        "saving-throw":
            "Saving Throw",
    };

    const escapeHTML = value =>
        String(value ?? "").replace(
            /[&<>"']/g,
            character =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;",
                })[character],
        );

    /*
     * Resolved lazily, right before it's actually needed, so a GM
     * choosing "Edit Existing" on a Region with no automations (which
     * never reaches a dispatch call) doesn't require the module API
     * to be available.
     */
    const resolveApi = () => {
        const raApi =
            game.modules
                .get(raModuleId)
                ?.api;

        if (
            !raApi ||
            typeof raApi.openConfigurationDialog !==
                "function"
        ) {
            ui.notifications.error(
                "Region Automation: the module API is unavailable. See the console.",
            );

            console.error(
                "PF2e Exploration Automation | Module API is unavailable.",
            );

            return null;
        }

        return raApi;
    };

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can add automations.",
        );

        return;
    }

    if (!canvas?.ready || !canvas.scene) {
        ui.notifications.error(
            "Region Automation: there is no active Scene.",
        );

        return;
    }

    const selectedRegions =
        Array.from(
            canvas.regions?.controlled ?? [],
        );

    if (selectedRegions.length !== 1) {
        ui.notifications.warn(
            `Region Automation: select exactly one Region. Selected: ${selectedRegions.length}.`,
        );

        return;
    }

    const raRegion =
        selectedRegions[0]?.document;

    if (!raRegion) {
        ui.notifications.error(
            "Region Automation: the selected Region document is unavailable.",
        );

        return;
    }

    /*
     * The NPC roster is stored on its own service RegionBehavior
     * (functionality: "npc-roster"), created the moment the roster
     * goes from empty to non-empty and deleted when it empties out
     * again. It carries no events/source, so it can never fire — it's
     * pure data, deliberately absent from migrate-behaviors.js's
     * SUPPORTED_FUNCTIONALITIES and executor.js's MODULE_FUNCTIONS,
     * and (via functionalityLabels below) invisible to "Edit
     * Existing". Future work teaches something to actually use it.
     */
    const findRosterBehavior = () =>
        Array.from(
            raRegion.behaviors ?? [],
        ).find(
            raBehavior =>
                raBehavior.flags?.[raModuleId]
                    ?.functionality ===
                "npc-roster",
        ) ?? null;

    const saveRoster = async npcs => {
        const rosterBehavior =
            findRosterBehavior();

        if (npcs.length === 0) {
            if (rosterBehavior) {
                await rosterBehavior.delete();
            }

            return;
        }

        if (!rosterBehavior) {
            await raRegion.createEmbeddedDocuments(
                "RegionBehavior",
                [
                    {
                        name:
                            `[RA-npc-roster] ${raRegion.name}`,

                        type:
                            "executeScript",

                        system: {
                            events:
                                [],

                            source:
                                "",
                        },

                        disabled:
                            false,

                        flags: {
                            [raModuleId]: {
                                schemaVersion:
                                    1,

                                functionality:
                                    "npc-roster",

                                config: {
                                    npcs,
                                },

                                triggeredTokenUuids:
                                    [],
                            },
                        },
                    },
                ],
            );

            return;
        }

        await rosterBehavior.update({
            [`flags.${raModuleId}.config.npcs`]:
                npcs,
        });
    };

    let raRosterNpcs =
        Array.from(
            findRosterBehavior()?.flags?.[raModuleId]
                ?.config?.npcs ?? [],
        );

    /*
     * DialogV2 requires the outer content element to have
     * no attributes.
     */
    const content =
        document.createElement("div");

    content.innerHTML = `
        <div
            style="
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            "
        >
            <p style="margin: 0;">
                Manage exploration automations for
                <strong>
                    ${escapeHTML(raRegion.name)}
                </strong>.
            </p>

            <div
                style="
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 0.75rem;
                "
            >
                <div
                    data-ra-npc-dropzone
                    style="
                        border: 2px dashed var(--color-border-light-primary);
                        border-radius: 4px;
                        padding: 1rem;
                        min-height: 140px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        font-size: 0.9em;
                        opacity: 0.85;
                    "
                >
                    Drag an NPC token here to add it to this Region’s roster.
                </div>

                <div
                    style="
                        display: flex;
                        flex-direction: column;
                        gap: 0.35rem;
                        max-height: 140px;
                        overflow-y: auto;
                    "
                >
                    <div data-ra-npc-list></div>
                </div>
            </div>

            <p
                style="
                    margin: 0;
                    font-size: 0.85em;
                    opacity: 0.8;
                "
            >
                Double-click an NPC below to remove it from the roster.
                Existing single-activity automations are still managed
                through the Region’s native Behaviors tab.
            </p>
        </div>
    `;

    const result =
        await foundry.applications.api.DialogV2.wait({
            window: {
                title:
                    `RadioArkadio — Exploration Automation (${raRegion.name})`,
            },

            position: {
                width: 720,
            },

            modal: true,
            rejectClose: false,
            content,

            render: (
                event,
                dialog,
            ) => {
                const root =
                    dialog.element instanceof HTMLElement
                        ? dialog.element
                        : dialog.element?.[0] ?? null;

                if (!root) {
                    console.error(
                        "Region Automation | Add Automation dialog root unavailable",
                        {
                            event,
                            dialog,
                        },
                    );

                    return;
                }

                const dropZone =
                    root.querySelector(
                        "[data-ra-npc-dropzone]",
                    );

                const rosterList =
                    root.querySelector(
                        "[data-ra-npc-list]",
                    );

                const renderRoster =
                    () => {
                        if (!rosterList) {
                            return;
                        }

                        if (
                            raRosterNpcs.length ===
                            0
                        ) {
                            rosterList.innerHTML = `
                                <div class="ra-npc-empty">
                                    No NPCs added
                                </div>
                            `;

                            return;
                        }

                        rosterList.innerHTML =
                            raRosterNpcs
                                .map(
                                    raNpc => `
                                        <div
                                            class="ra-npc-chip"
                                            data-ra-chip="${escapeHTML(
                                                raNpc.uuid,
                                            )}"
                                            title="Double-click to remove"
                                        >
                                            <span>
                                                ${escapeHTML(
                                                    raNpc.name,
                                                )} (${escapeHTML(
                                                    raNpc.tokenId,
                                                )})
                                            </span>
                                        </div>
                                    `,
                                )
                                .join("");

                        for (
                            const raChip
                            of rosterList.querySelectorAll(
                                "[data-ra-chip]",
                            )
                        ) {
                            raChip.addEventListener(
                                "dblclick",
                                async () => {
                                    const raUuid =
                                        raChip.dataset
                                            .raChip;

                                    if (!raUuid) {
                                        return;
                                    }

                                    raRosterNpcs =
                                        raRosterNpcs.filter(
                                            raNpc =>
                                                raNpc.uuid !==
                                                raUuid,
                                        );

                                    renderRoster();

                                    try {
                                        await saveRoster(
                                            raRosterNpcs,
                                        );
                                    } catch (error) {
                                        console.error(
                                            "Region Automation | Could not update the NPC roster",
                                            error,
                                        );

                                        ui.notifications.error(
                                            "Region Automation: the NPC roster could not be updated. See the console.",
                                        );
                                    }
                                },
                            );
                        }
                    };

                if (dropZone) {
                    dropZone.addEventListener(
                        "dragover",
                        event =>
                            event.preventDefault(),
                    );

                    dropZone.addEventListener(
                        "drop",
                        async event => {
                            event.preventDefault();

                            const TextEditorClass =
                                foundry.applications
                                    ?.ux
                                    ?.TextEditor
                                    ?.implementation ??
                                foundry.applications
                                    ?.ux
                                    ?.TextEditor ??
                                globalThis.TextEditor ??
                                null;

                            let data =
                                null;

                            try {
                                data =
                                    TextEditorClass?.getDragEventData
                                        ? TextEditorClass.getDragEventData(
                                              event,
                                          )
                                        : JSON.parse(
                                              event.dataTransfer.getData(
                                                  "text/plain",
                                              ),
                                          );
                            } catch (error) {
                                console.warn(
                                    "Region Automation | Could not read dropped data",
                                    error,
                                );

                                return;
                            }

                            if (
                                data?.type !==
                                    "Token" ||
                                !data.uuid
                            ) {
                                ui.notifications.warn(
                                    "Region Automation: drag a Token from the canvas to add it to the NPC roster.",
                                );

                                return;
                            }

                            let droppedToken =
                                null;

                            try {
                                droppedToken =
                                    await fromUuid(
                                        data.uuid,
                                    );
                            } catch (error) {
                                console.warn(
                                    "Region Automation | Could not resolve dropped Token",
                                    error,
                                );
                            }

                            if (!droppedToken) {
                                ui.notifications.warn(
                                    "Region Automation: the dropped Token could not be resolved.",
                                );

                                return;
                            }

                            if (
                                droppedToken.actor
                                    ?.type !==
                                "npc"
                            ) {
                                ui.notifications.warn(
                                    "Region Automation: only NPC tokens can be added to this Region’s roster.",
                                );

                                return;
                            }

                            if (
                                raRosterNpcs.some(
                                    raNpc =>
                                        raNpc.uuid ===
                                        droppedToken.uuid,
                                )
                            ) {
                                ui.notifications.warn(
                                    `Region Automation: "${droppedToken.name}" is already in this Region’s roster.`,
                                );

                                return;
                            }

                            raRosterNpcs = [
                                ...raRosterNpcs,
                                {
                                    uuid:
                                        droppedToken.uuid,

                                    tokenId:
                                        droppedToken.id,

                                    name:
                                        droppedToken.name,
                                },
                            ];

                            renderRoster();

                            try {
                                await saveRoster(
                                    raRosterNpcs,
                                );
                            } catch (error) {
                                console.error(
                                    "Region Automation | Could not save the NPC roster",
                                    error,
                                );

                                ui.notifications.error(
                                    "Region Automation: the NPC roster could not be saved. See the console.",
                                );
                            }
                        },
                    );
                }

                renderRoster();
            },

            buttons: [
                {
                    action:
                        "investigate",

                    label:
                        "Investigation",

                    icon:
                        "fa-solid fa-book-open",

                    default:
                        true,

                    callback: () => ({
                        action:
                            "investigate",
                    }),
                },

                {
                    action:
                        "detect-magic",

                    label:
                        "Detect Magic",

                    icon:
                        "fa-solid fa-wand-magic-sparkles",

                    callback: () => ({
                        action:
                            "detect-magic",
                    }),
                },

                {
                    action:
                        "search",

                    label:
                        "Search",

                    icon:
                        "fa-solid fa-magnifying-glass",

                    callback: () => ({
                        action:
                            "search",
                    }),
                },

                {
                    action:
                        "saving-throw",

                    label:
                        "Saving Throw",

                    icon:
                        "fa-solid fa-shield-halved",

                    callback: () => ({
                        action:
                            "saving-throw",
                    }),
                },

                {
                    action:
                        "edit",

                    label:
                        "Edit Existing…",

                    icon:
                        "fa-solid fa-pen",

                    callback: () => ({
                        action:
                            "edit",
                    }),
                },

                {
                    action:
                        "cancel",

                    label:
                        "Close",

                    icon:
                        "fa-solid fa-xmark",

                    callback: () => ({
                        action:
                            "cancel",
                    }),
                },
            ],
        });

    if (
        !result ||
        result.action === "cancel"
    ) {
        return;
    }

    if (result.action === "edit") {
        const raAutomationBehaviors =
            Array.from(
                raRegion.behaviors ?? [],
            ).filter(
                raBehavior =>
                    raBehavior.flags?.[raModuleId] &&
                    typeof raBehavior.flags[raModuleId] ===
                        "object" &&
                    functionalityLabels[
                        raBehavior.flags[raModuleId]
                            .functionality
                    ],
            );

        if (raAutomationBehaviors.length === 0) {
            ui.notifications.info(
                `Region Automation: "${raRegion.name}" has no automations to edit.`,
            );

            return;
        }

        const behaviorOptionsHTML =
            raAutomationBehaviors
                .map(
                    (raBehavior, raIndex) => `
                        <option value="${raIndex}">
                            ${escapeHTML(
                                functionalityLabels[
                                    raBehavior.flags[raModuleId]
                                        .functionality
                                ],
                            )} — ${escapeHTML(raBehavior.name)}
                        </option>
                    `,
                )
                .join("");

        const editContent =
            document.createElement("div");

        editContent.innerHTML = `
            <div
                style="
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                "
            >
                <p style="margin: 0;">
                    Choose an automation on
                    <strong>
                        ${escapeHTML(raRegion.name)}
                    </strong>
                    to edit.
                </p>

                <select
                    name="behaviorIndex"
                    style="width: 100%;"
                    autofocus
                >
                    ${behaviorOptionsHTML}
                </select>
            </div>
        `;

        const editResult =
            await foundry.applications.api.DialogV2.wait({
                window: {
                    title:
                        "Region Automation — Edit Existing",
                },

                position: {
                    width: 560,
                },

                modal: false,
                rejectClose: false,
                content: editContent,

                buttons: [
                    {
                        action:
                            "edit",

                        label:
                            "Edit",

                        icon:
                            "fa-solid fa-pen",

                        default:
                            true,

                        callback: (
                            event,
                            button,
                        ) => ({
                            action:
                                "edit",

                            behaviorIndex: Number(
                                button.form?.elements
                                    ?.namedItem(
                                        "behaviorIndex",
                                    )?.value ?? 0,
                            ),
                        }),
                    },

                    {
                        action:
                            "cancel",

                        label:
                            "Cancel",

                        icon:
                            "fa-solid fa-xmark",

                        callback: () => ({
                            action:
                                "cancel",
                        }),
                    },
                ],
            });

        if (
            !editResult ||
            editResult.action === "cancel"
        ) {
            return;
        }

        const raChosenBehavior =
            raAutomationBehaviors[
                editResult.behaviorIndex
            ];

        if (!raChosenBehavior) {
            ui.notifications.error(
                "Region Automation: the selected automation is no longer available.",
            );

            return;
        }

        const raChosenFunctionality =
            raChosenBehavior.flags[raModuleId]
                .functionality;

        const raApi =
            resolveApi();

        if (!raApi) {
            return;
        }

        await raApi.openConfigurationDialog({
            activity:
                raChosenFunctionality,

            region:
                raRegion,

            existingBehavior:
                raChosenBehavior,
        });

        return;
    }

    const raApi =
        resolveApi();

    if (!raApi) {
        return;
    }

    await raApi.openConfigurationDialog({
        activity:
            result.action,

        region:
            raRegion,
    });
})();
