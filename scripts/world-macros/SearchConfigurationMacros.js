import { MODULE_ID } from "../module-id.js";
import { GENERIC_BEHAVIOR_SOURCE as BEHAVIOR_SOURCE } from "../migrate-behaviors.js";

export async function runSearchConfiguration({ region, existingBehavior } = {}) {

    const TARGET_TYPES = Object.freeze({
        npc: {
            label: "NPC / Creature",
            description:
                "An undetected creature within 30 feet. Creature-specific Seek modifiers, such as Keen Eyes, can apply.",
        },

        "non-npc": {
            label: "Item / Hazard",
            description:
                "A concealed object, feature, trap, or hazard. Creature-specific Seek modifiers do not apply.",
        },
    });

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
     * Lets a GM drag a Journal/Actor/Item link (e.g. from a Journal
     * entry) onto a textarea and have it inserted as a proper
     * @UUID[...] reference, instead of only being able to type or
     * paste one by hand.
     */
    const wireDocumentDrop = textarea => {
        if (!textarea) return;

        textarea.addEventListener("dragover", event => event.preventDefault());

        textarea.addEventListener("drop", async event => {
            event.preventDefault();

            const TextEditorClass =
                foundry.applications?.ux?.TextEditor?.implementation ??
                foundry.applications?.ux?.TextEditor ??
                globalThis.TextEditor ??
                null;

            let data = null;

            try {
                data = TextEditorClass?.getDragEventData
                    ? TextEditorClass.getDragEventData(event)
                    : JSON.parse(event.dataTransfer.getData("text/plain"));
            } catch (error) {
                console.warn("Region Automation | Could not read dropped data", error);
                return;
            }

            if (!data?.uuid) return;

            let droppedDoc = null;

            try {
                droppedDoc = await fromUuid(data.uuid);
            } catch (error) {
                console.warn("Region Automation | Could not resolve dropped document", error);
            }

            const link = `@UUID[${data.uuid}]{${droppedDoc?.name ?? data.uuid}}`;

            const start = textarea.selectionStart ?? textarea.value.length;
            const end = textarea.selectionEnd ?? textarea.value.length;

            textarea.value = `${textarea.value.slice(0, start)}${link}${textarea.value.slice(end)}`;

            const caret = start + link.length;
            textarea.setSelectionRange(caret, caret);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            textarea.focus();
        });
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
                ? "Region Automation: only a GM can edit a Search automation."
                : "Region Automation: only a GM can add a Search automation.",
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
            subject: String(raExistingConfig.subject ?? "Search"),
            hint: String(raExistingConfig.hint ?? ""),
            dc: Number(raExistingConfig.dc ?? 20),
            targetType: String(raExistingConfig.targetType ?? "non-npc"),
        }
        : {
            subject: "Search",
            hint: "",
            dc: 20,
            targetType: "non-npc",
        };

    let submittedConfiguration = null;

    while (!submittedConfiguration) {
        const targetOptionsHTML = Object.entries(TARGET_TYPES)
            .map(
                ([value, data]) => `
                    <option
                        value="${escapeHTML(value)}"
                        ${editorState.targetType === value ? "selected" : ""}
                    >
                        ${escapeHTML(data.label)}
                    </option>
                `,
            )
            .join("");

        /*
         * Foundry v14 requires the outer HTMLDivElement supplied to
         * DialogV2 to have no attributes.
         */
        const content = document.createElement("div");

        content.innerHTML = `
            <div
                style="
                    display: flex;
                    flex-direction: column;
                    gap: 0.8rem;
                "
            >
                <p style="margin: 0;">
                    ${raExistingBehavior ? "Editing the Search automation on" : "Add a new Search automation to"}
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
                    <label for="ra-search-subject">
                        Subject
                    </label>

                    <input
                        id="ra-search-subject"
                        name="subject"
                        type="text"
                        value="${escapeHTML(editorState.subject)}"
                        required
                        autofocus
                    >

                    <label for="ra-search-dc">
                        Perception DC
                    </label>

                    <input
                        id="ra-search-dc"
                        name="dc"
                        type="number"
                        value="${escapeHTML(editorState.dc)}"
                        min="0"
                        max="100"
                        step="1"
                        required
                    >

                    <label for="ra-search-target-type">
                        Search Target
                    </label>

                    <select
                        id="ra-search-target-type"
                        name="targetType"
                        required
                    >
                        ${targetOptionsHTML}
                    </select>

                    <div></div>

                    <div
                        data-ra-target-description
                        style="
                            padding: 0.55rem 0.65rem;
                            border: 1px solid var(--color-border-light-primary);
                            border-radius: 4px;
                            font-size: 0.9em;
                            opacity: 0.85;
                        "
                    ></div>

                    <label
                        for="ra-search-hint"
                        style="
                            align-self: start;
                            padding-top: 0.35rem;
                        "
                    >
                        Hint
                    </label>

                    <textarea
                        id="ra-search-hint"
                        name="hint"
                        rows="5"
                        style="resize: vertical;"
                        placeholder="Optional information shown to the GM beneath the result."
                    >${escapeHTML(editorState.hint)}</textarea>
                </div>

                <p
                    style="
                        margin: 0;
                        font-size: 0.9em;
                        opacity: 0.8;
                    "
                >
                    The token must have the Search exploration activity active.
                    The automation performs one secret Perception check when the
                    token enters the Region.
                </p>
            </div>
        `;

        const dialogResult =
            await foundry.applications.api.DialogV2.wait({
                window: {
                    title: raExistingBehavior ? "Edit Search" : "Add Search",
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
                            const form = button.form;

                            return {
                                action: "create",

                                subject: String(
                                    form?.elements
                                        ?.namedItem("subject")
                                        ?.value ??
                                        editorState.subject,
                                ).trim(),

                                hint: String(
                                    form?.elements
                                        ?.namedItem("hint")
                                        ?.value ??
                                        editorState.hint,
                                ).trim(),

                                dc: Number(
                                    form?.elements
                                        ?.namedItem("dc")
                                        ?.value ??
                                        editorState.dc,
                                ),

                                targetType: String(
                                    form?.elements
                                        ?.namedItem("targetType")
                                        ?.value ??
                                        editorState.targetType,
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
                            "Region Automation | Search editor root unavailable",
                            {
                                event,
                                dialog,
                            },
                        );

                        return;
                    }

                    const targetSelect =
                        root.querySelector(
                            '[name="targetType"]',
                        );

                    const description =
                        root.querySelector(
                            "[data-ra-target-description]",
                        );

                    wireDocumentDrop(
                        root.querySelector(
                            '[name="hint"]',
                        ),
                    );

                    const updateDescription = () => {
                        const selected =
                            TARGET_TYPES[
                                targetSelect?.value
                            ] ??
                            TARGET_TYPES[
                                "non-npc"
                            ];

                        if (description) {
                            description.textContent =
                                selected.description;
                        }
                    };

                    targetSelect?.addEventListener(
                        "change",
                        updateDescription,
                    );

                    updateDescription();
                },
            });

        if (
            !dialogResult ||
            dialogResult.action === "cancel"
        ) {
            console.info(
                "Region Automation | Add Search canceled",
            );

            return;
        }

        editorState.subject =
            dialogResult.subject;

        editorState.hint =
            dialogResult.hint;

        editorState.dc =
            dialogResult.dc;

        editorState.targetType =
            dialogResult.targetType;

        if (!editorState.subject) {
            ui.notifications.warn(
                "Region Automation: the Search subject cannot be empty.",
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
                "Region Automation: Perception DC must be a whole number from 0 to 100.",
            );

            continue;
        }

        if (
            !Object.hasOwn(
                TARGET_TYPES,
                editorState.targetType,
            )
        ) {
            ui.notifications.warn(
                "Region Automation: choose NPC / Creature or Item / Hazard.",
            );

            continue;
        }

        submittedConfiguration = {
            subject: editorState.subject,
            hint: editorState.hint,
            dc: editorState.dc,
            targetType: editorState.targetType,
        };
    }

    const behaviorName =
        `[RA-search] ${submittedConfiguration.subject}`;

    if (raExistingBehavior) {
        try {
            await raExistingBehavior.update({
                name: behaviorName,
                [`flags.${MODULE_ID}.config`]: submittedConfiguration,
            });

            console.log(
                "Region Automation | Search updated",
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
                "Region Automation | Search could not be updated",
                error,
            );

            ui.notifications.error(
                "Region Automation: the Search automation could not be updated. See the console.",
            );
        }

        return;
    }

    const moduleData = {
        schemaVersion: 2,
        functionality: "search",
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
            "Region Automation | Search created",
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
            "Region Automation | Search could not be created",
            error,
        );

        ui.notifications.error(
            "Region Automation: the Search automation could not be created. See the console.",
        );
    }
}
