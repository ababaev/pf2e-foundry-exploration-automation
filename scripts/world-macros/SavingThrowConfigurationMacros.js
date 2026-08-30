import { MODULE_ID } from "../module-id.js";
import { GENERIC_BEHAVIOR_SOURCE as BEHAVIOR_SOURCE } from "../migrate-behaviors.js";

export async function runSavingThrowConfiguration({ region, existingBehavior } = {}) {

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

    /*
     * Lets a GM drag a Journal/Actor/Item link onto a textarea and
     * have it inserted as a proper @UUID[...] reference, instead of
     * only being able to type or paste one by hand.
     */
    const wireDocumentDrop =
        textarea => {
            if (!textarea) return;

            textarea.addEventListener(
                "dragover",
                event =>
                    event.preventDefault(),
            );

            textarea.addEventListener(
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

                    if (!data?.uuid) return;

                    let droppedDoc =
                        null;

                    try {
                        droppedDoc =
                            await fromUuid(
                                data.uuid,
                            );
                    } catch (error) {
                        console.warn(
                            "Region Automation | Could not resolve dropped document",
                            error,
                        );
                    }

                    const link =
                        `@UUID[${data.uuid}]{${droppedDoc?.name ?? data.uuid}}`;

                    const start =
                        textarea.selectionStart ??
                        textarea.value.length;

                    const end =
                        textarea.selectionEnd ??
                        textarea.value.length;

                    textarea.value =
                        `${textarea.value.slice(0, start)}${link}${textarea.value.slice(end)}`;

                    const caret =
                        start +
                        link.length;

                    textarea.setSelectionRange(
                        caret,
                        caret,
                    );

                    textarea.dispatchEvent(
                        new Event(
                            "input",
                            { bubbles: true },
                        ),
                    );

                    textarea.focus();
                },
            );
        };

    /*
     * When invoked as `.execute({ existingBehavior })` (by
     * RegionAutomationMainMacros.js's "Edit Existing" flow), this dialog
     * edits that Behavior in place instead of creating a new one.
     */
    const raExistingBehavior =
        existingBehavior ?? null;

    if (!game.user.isGM) {
        ui.notifications.error(
            raExistingBehavior
                ? "Region Automation: only a GM can edit a Saving Throw automation."
                : "Region Automation: only a GM can add a Saving Throw automation.",
        );

        return;
    }

    const raRegion =
        region ?? raExistingBehavior?.parent ?? null;

    if (!raRegion) {
        ui.notifications.error(
            "Region Automation: the Region is unavailable.",
        );

        return;
    }

    const raExistingConfig =
        raExistingBehavior?.flags?.[MODULE_ID]?.config ?? {};

    const editorState = raExistingBehavior
        ? {
            subject: String(raExistingConfig.subject ?? "Hazard"),
            saveType: String(raExistingConfig.saveType ?? "fortitude"),
            dc: Number(raExistingConfig.dc ?? 20),
            consequence: String(raExistingConfig.consequence ?? ""),
        }
        : {
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
                    ${raExistingBehavior ? "Editing the Saving Throw automation on" : "Add a new Saving Throw automation to"}
                    <strong>
                        ${escapeHTML(raRegion?.name ?? "")}
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
                    title: raExistingBehavior ? "Edit Saving Throw" : "Add Saving Throw",
                },

                position: {
                    width: 640,
                },

                modal: false,
                rejectClose: false,
                content,

                buttons: [
                    {
                        action: "create",
                        label: raExistingBehavior ? "Save Changes" : "Create",
                        icon: raExistingBehavior ? "fa-solid fa-floppy-disk" : "fa-solid fa-plus",
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

                render: (event, dialog) => {
                    const root =
                        dialog.element instanceof HTMLElement
                            ? dialog.element
                            : dialog.element?.[0] ?? null;

                    if (!root) {
                        console.error(
                            "Region Automation | Saving Throw editor root unavailable",
                            { event, dialog },
                        );

                        return;
                    }

                    wireDocumentDrop(
                        root.querySelector('[name="consequence"]'),
                    );
                },
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

    if (raExistingBehavior) {
        try {
            await raExistingBehavior.update({
                name: behaviorName,
                [`flags.${MODULE_ID}.config`]: submittedConfiguration,
            });

            console.log(
                "Region Automation | Saving Throw updated",
                {
                    behavior: raExistingBehavior,
                    configuration:
                        submittedConfiguration,
                },
            );

            ui.notifications.info(
                `Region Automation: updated "${behaviorName}".`,
            );
        } catch (error) {
            console.error(
                "Region Automation | Saving Throw could not be updated",
                error,
            );

            ui.notifications.error(
                "Region Automation: the Saving Throw automation could not be updated. See the console.",
            );
        }

        return;
    }

    const moduleData = {
        schemaVersion: 1,
        functionality: "saving-throw",
        config: submittedConfiguration,
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
}
