await (async () => {

    const MODULE_ID = "pf2e-exploration-automation";

    const BEHAVIOR_SOURCE = `
await game.macros.getName("SavingThrowFunctionMacros")?.execute({
    behavior,
    event,
    region,
    scene,
    token: event?.data?.token,
    actor: event?.data?.token?.actor
});
`.trim();

    const SAVE_TYPES = {
        fortitude: "Fortitude",
        reflex: "Reflex",
        will: "Will",
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

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can add a Saving Throw automation.",
        );

        return;
    }

    if (!canvas?.ready || !canvas.scene) {
        ui.notifications.error(
            "Region Automation: there is no active Scene.",
        );

        return;
    }

    const selectedRegions = Array.from(
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

    const editorState = {
        subject: "Hazard",
        saveType: "fortitude",
        dc: 20,
        consequence: "",
    };

    let submittedConfiguration = null;

    while (!submittedConfiguration) {
        const saveOptionsHTML =
            Object.entries(SAVE_TYPES)
                .map(
                    ([slug, label]) => `
                        <option
                            value="${escapeHTML(slug)}"
                            ${
                                editorState.saveType === slug
                                    ? "selected"
                                    : ""
                            }
                        >
                            ${escapeHTML(label)}
                        </option>
                    `,
                )
                .join("");

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
                    gap: 0.8rem;
                "
            >
                <p style="margin: 0;">
                    Add a new Saving Throw automation to
                    <strong>
                        ${escapeHTML(raRegion.name)}
                    </strong>.
                </p>

                <div
                    style="
                        display: grid;
                        grid-template-columns: 9rem minmax(0, 1fr);
                        gap: 0.55rem 0.75rem;
                        align-items: center;
                    "
                >
                    <label for="ra-save-subject">
                        Subject
                    </label>

                    <input
                        id="ra-save-subject"
                        name="subject"
                        type="text"
                        value="${escapeHTML(editorState.subject)}"
                        required
                        autofocus
                    >

                    <label for="ra-save-type">
                        Saving Throw
                    </label>

                    <select
                        id="ra-save-type"
                        name="saveType"
                        required
                    >
                        ${saveOptionsHTML}
                    </select>

                    <label for="ra-save-dc">
                        DC
                    </label>

                    <input
                        id="ra-save-dc"
                        name="dc"
                        type="number"
                        value="${escapeHTML(editorState.dc)}"
                        min="0"
                        max="100"
                        step="1"
                        required
                    >

                    <label
                        for="ra-save-consequence"
                        style="
                            align-self: start;
                            padding-top: 0.35rem;
                        "
                    >
                        GM Notes
                    </label>

                    <textarea
                        id="ra-save-consequence"
                        name="consequence"
                        rows="8"
                        style="resize: vertical;"
                        placeholder="Optional consequences, instructions, document links, inline checks, damage links, conditions, or other GM notes."
                    >${escapeHTML(editorState.consequence)}</textarea>
                </div>

                <p
                    style="
                        margin: 0;
                        font-size: 0.9em;
                        opacity: 0.8;
                    "
                >
                    The save is rolled secretly when the token enters
                    the Region. The result and these notes are visible
                    only to active GMs.
                </p>

                <p
                    style="
                        margin: 0;
                        font-size: 0.9em;
                        opacity: 0.8;
                    "
                >
                    Foundry links such as
                    <code>@UUID[...]</code>,
                    <code>@Check[...]</code>, and other enriched links
                    can be pasted into GM Notes.
                </p>
            </div>
        `;

        const dialogResult =
            await foundry.applications.api.DialogV2.wait({
                window: {
                    title: "Add Saving Throw",
                },

                position: {
                    width: 640,
                },

                modal: true,
                rejectClose: false,
                content,

                buttons: [
                    {
                        action: "create",
                        label: "Create",
                        icon: "fa-solid fa-plus",
                        default: true,

                        callback: (
                            event,
                            button,
                        ) => {
                            const form =
                                button.form;

                            return {
                                action: "create",

                                subject: String(
                                    form?.elements
                                        ?.namedItem("subject")
                                        ?.value ??
                                    editorState.subject,
                                ).trim(),

                                saveType: String(
                                    form?.elements
                                        ?.namedItem("saveType")
                                        ?.value ??
                                    editorState.saveType,
                                ).trim(),

                                dc: Number(
                                    form?.elements
                                        ?.namedItem("dc")
                                        ?.value ??
                                    editorState.dc,
                                ),

                                consequence: String(
                                    form?.elements
                                        ?.namedItem("consequence")
                                        ?.value ??
                                    editorState.consequence,
                                ).trim(),
                            };
                        },
                    },

                    {
                        action: "cancel",
                        label: "Cancel",
                        icon: "fa-solid fa-xmark",

                        callback: () => ({
                            action: "cancel",
                        }),
                    },
                ],
            });

        if (
            !dialogResult ||
            dialogResult.action === "cancel"
        ) {
            console.info(
                "Region Automation | Add Saving Throw canceled",
            );

            return;
        }

        editorState.subject =
            dialogResult.subject;

        editorState.saveType =
            dialogResult.saveType;

        editorState.dc =
            dialogResult.dc;

        editorState.consequence =
            dialogResult.consequence;

        if (!editorState.subject) {
            ui.notifications.warn(
                "Region Automation: the Saving Throw subject cannot be empty.",
            );

            continue;
        }

        if (
            !Object.hasOwn(
                SAVE_TYPES,
                editorState.saveType,
            )
        ) {
            ui.notifications.warn(
                "Region Automation: choose Fortitude, Reflex, or Will.",
            );

            continue;
        }

        if (
            !Number.isFinite(editorState.dc) ||
            !Number.isInteger(editorState.dc) ||
            editorState.dc < 0 ||
            editorState.dc > 100
        ) {
            ui.notifications.warn(
                "Region Automation: DC must be a whole number from 0 to 100.",
            );

            continue;
        }

        submittedConfiguration = {
            subject: editorState.subject,
            saveType: editorState.saveType,
            dc: editorState.dc,
            consequence: editorState.consequence,
        };
    }

    const behaviorName =
        `[RA-save] ${submittedConfiguration.subject}`;

    const moduleData = {
        schemaVersion: 1,
        functionality: "saving-throw",

        config: {
            subject:
                submittedConfiguration.subject,

            saveType:
                submittedConfiguration.saveType,

            dc:
                submittedConfiguration.dc,

            consequence:
                submittedConfiguration.consequence,
        },

        triggeredTokenUuids: [],
    };

    try {
        const createdBehaviors =
            await raRegion.createEmbeddedDocuments(
                "RegionBehavior",
                [
                    {
                        name: behaviorName,
                        type: "executeScript",

                        system: {
                            events: [
                                "tokenEnter",
                            ],

                            source:
                                BEHAVIOR_SOURCE,
                        },

                        disabled: false,

                        flags: {
                            [MODULE_ID]:
                                moduleData,
                        },
                    },
                ],
            );

        const createdBehavior =
            createdBehaviors[0] ?? null;

        if (!createdBehavior) {
            throw new Error(
                "Foundry returned no created Region Behavior.",
            );
        }

        console.log(
            "Region Automation | Saving Throw created",
            {
                region: raRegion,
                behavior: createdBehavior,
                configuration:
                    submittedConfiguration,
            },
        );

        ui.notifications.info(
            `Region Automation: created "${behaviorName}" in "${raRegion.name}".`,
        );
    } catch (error) {
        console.error(
            "Region Automation | Saving Throw could not be created",
            error,
        );

        ui.notifications.error(
            "Region Automation: the Saving Throw automation could not be created. See the console.",
        );
    }
})();
