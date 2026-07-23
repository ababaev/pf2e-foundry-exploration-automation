await (async () => {
    "use strict";

    const MODULE_ID =
        "region-automation";

    const BEHAVIOR_SOURCE = `
await game.macros.getName("DetectMagicFunctionMacros")?.execute({
    behavior,
    event,
    region,
    scene,
    token: event?.data?.token,
    actor: event?.data?.token?.actor
});
`.trim();

    const DIFFICULTIES = [
        "incredibly-easy",
        "very-easy",
        "easy",
        "normal",
        "hard",
        "very-hard",
        "incredibly-hard",
    ];

    const DIFFICULTY_LABELS = {
        "incredibly-easy":
            "Incredibly Easy",

        "very-easy":
            "Very Easy",

        easy:
            "Easy",

        normal:
            "Normal",

        hard:
            "Hard",

        "very-hard":
            "Very Hard",

        "incredibly-hard":
            "Incredibly Hard",
    };

    const DC_ADJUSTMENTS = {
        "incredibly-easy":
            -10,

        "very-easy":
            -5,

        easy:
            -2,

        normal:
            0,

        hard:
            2,

        "very-hard":
            5,

        "incredibly-hard":
            10,
    };

    const SKILLS = [
        {
            slug:
                "arcana",

            label:
                "Arcana",
        },

        {
            slug:
                "nature",

            label:
                "Nature",
        },

        {
            slug:
                "occultism",

            label:
                "Occultism",
        },

        {
            slug:
                "religion",

            label:
                "Religion",
        },
    ];

    const SKILL_LABELS =
        Object.fromEntries(
            SKILLS.map(
                ({
                    slug,
                    label,
                }) => [
                    slug,
                    label,
                ],
            ),
        );

    const VALID_SKILLS =
        new Set(
            SKILLS.map(
                ({ slug }) =>
                    slug,
            ),
        );

    /*
     * By default, all four magical traditions use the normal DC.
     * The GM can move or remove any of them.
     */
    const DEFAULT_SKILLS = {
        "incredibly-easy":
            [],

        "very-easy":
            [],

        easy:
            [],

        normal: [
            "arcana",
            "nature",
            "occultism",
            "religion",
        ],

        hard:
            [],

        "very-hard":
            [],

        "incredibly-hard":
            [],
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

    const createEmptySkills = () =>
        Object.fromEntries(
            DIFFICULTIES.map(
                difficulty => [
                    difficulty,
                    [],
                ],
            ),
        );

    const cloneSkills = skills =>
        Object.fromEntries(
            DIFFICULTIES.map(
                difficulty => [
                    difficulty,
                    [
                        ...(
                            skills?.[
                                difficulty
                            ] ?? []
                        ),
                    ],
                ],
            ),
        );

    const normalizeSkills = source => {
        const result =
            createEmptySkills();

        const seen =
            new Set();

        for (
            const difficulty
            of DIFFICULTIES
        ) {
            const entries =
                Array.isArray(
                    source?.[
                        difficulty
                    ],
                )
                    ? source[
                        difficulty
                    ]
                    : [];

            for (
                const slug
                of entries
            ) {
                if (
                    !VALID_SKILLS.has(
                        slug,
                    ) ||
                    seen.has(slug)
                ) {
                    continue;
                }

                seen.add(slug);

                result[
                    difficulty
                ].push(slug);
            }
        }

        return result;
    };

    const countConfiguredSkills =
        skills =>
            DIFFICULTIES.reduce(
                (
                    total,
                    difficulty,
                ) =>
                    total +
                    (
                        skills?.[
                            difficulty
                        ]?.length ??
                        0
                    ),
                0,
            );

    const signedAdjustment =
        adjustment =>
            adjustment > 0
                ? `+${adjustment}`
                : String(
                    adjustment,
                );

    if (!game.user.isGM) {
        ui.notifications.error(
            "Region Automation: only a GM can add a Detect Magic automation.",
        );

        return;
    }

    if (
        !canvas?.ready ||
        !canvas.scene
    ) {
        ui.notifications.error(
            "Region Automation: there is no active Scene.",
        );

        return;
    }

    const selectedRegions =
        Array.from(
            canvas.regions
                ?.controlled ??
            [],
        );

    if (
        selectedRegions.length !==
        1
    ) {
        ui.notifications.warn(
            `Region Automation: select exactly one Region. Selected: ${selectedRegions.length}.`,
        );

        return;
    }

    const raRegion =
        selectedRegions[0]
            ?.document;

    if (!raRegion) {
        ui.notifications.error(
            "Region Automation: the selected Region document is unavailable.",
        );

        return;
    }

    const editorState = {
        subject:
            "Magical Presence",

        detection:
            "Magic is present in this area.",

        hint:
            "",

        baseDC:
            20,

        skills:
            normalizeSkills(
                DEFAULT_SKILLS,
            ),
    };

    let submittedConfiguration =
        null;

    while (
        !submittedConfiguration
    ) {
        const skillOptionsHTML =
            SKILLS.map(
                ({
                    slug,
                    label,
                }) => `
                    <option
                        value="${escapeHTML(
                            slug,
                        )}"
                    >
                        ${escapeHTML(
                            label,
                        )}
                    </option>
                `,
            ).join("");

        const difficultyOptionsHTML =
            DIFFICULTIES.map(
                difficulty => `
                    <option
                        value="${escapeHTML(
                            difficulty,
                        )}"
                    >
                        ${escapeHTML(
                            DIFFICULTY_LABELS[
                                difficulty
                            ],
                        )}
                    </option>
                `,
            ).join("");

        const difficultyColumnsHTML =
            DIFFICULTIES.map(
                difficulty => `
                    <section
                        class="ra-dm-column"
                        data-difficulty-column="${escapeHTML(
                            difficulty,
                        )}"
                    >
                        <header
                            class="ra-dm-column-header"
                        >
                            <strong>
                                ${escapeHTML(
                                    DIFFICULTY_LABELS[
                                        difficulty
                                    ],
                                )}
                            </strong>

                            <span
                                class="ra-dm-adjustment"
                            >
                                ${escapeHTML(
                                    signedAdjustment(
                                        DC_ADJUSTMENTS[
                                            difficulty
                                        ],
                                    ),
                                )}
                            </span>

                            <span
                                class="ra-dm-column-dc"
                                data-dc-for="${escapeHTML(
                                    difficulty,
                                )}"
                            >
                            </span>
                        </header>

                        <div
                            class="ra-dm-chip-list"
                            data-chip-list="${escapeHTML(
                                difficulty,
                            )}"
                        >
                        </div>
                    </section>
                `,
            ).join("");

        /*
         * DialogV2 requires the outer content element to have
         * no attributes.
         */
        const content =
            document.createElement(
                "div",
            );

        content.innerHTML = `
            <div
                class="ra-dm-editor"
            >
                <style>
                    .ra-dm-editor {
                        display: flex;
                        flex-direction: column;
                        gap: 0.8rem;
                        min-width: 0;
                    }

                    .ra-dm-fields {
                        display: grid;
                        grid-template-columns:
                            8rem
                            minmax(0, 1fr);
                        gap: 0.55rem 0.75rem;
                        align-items: center;
                    }

                    .ra-dm-fields textarea {
                        resize: vertical;
                    }

                    .ra-dm-picker {
                        display: grid;
                        grid-template-columns:
                            minmax(10rem, 1fr)
                            minmax(10rem, 1fr)
                            auto;
                        gap: 0.5rem;
                        align-items: end;
                        padding: 0.65rem;
                        border:
                            1px solid
                            var(--color-border-light-primary);
                        border-radius: 4px;
                    }

                    .ra-dm-picker-field {
                        display: flex;
                        flex-direction: column;
                        gap: 0.25rem;
                    }

                    .ra-dm-columns-wrapper {
                        overflow-x: auto;
                        padding-bottom: 0.25rem;
                    }

                    .ra-dm-columns {
                        display: grid;
                        grid-template-columns:
                            repeat(
                                7,
                                minmax(
                                    145px,
                                    1fr
                                )
                            );
                        gap: 0.45rem;
                        min-width: 1080px;
                    }

                    .ra-dm-column {
                        display: flex;
                        flex-direction: column;
                        min-height: 10rem;
                        border:
                            1px solid
                            var(--color-border-light-primary);
                        border-radius: 4px;
                        background:
                            rgb(
                                0 0 0 /
                                0.025
                            );
                    }

                    .ra-dm-column-header {
                        display: flex;
                        flex-direction: column;
                        gap: 0.1rem;
                        padding: 0.45rem;
                        text-align: center;
                        border-bottom:
                            1px solid
                            var(--color-border-light-primary);
                    }

                    .ra-dm-adjustment {
                        font-size: 0.85em;
                        opacity: 0.75;
                    }

                    .ra-dm-column-dc {
                        font-size: 0.9em;
                        font-weight: 600;
                    }

                    .ra-dm-chip-list {
                        display: flex;
                        flex-direction: column;
                        gap: 0.35rem;
                        padding: 0.45rem;
                        min-height: 6rem;
                    }

                    .ra-dm-chip {
                        display: flex;
                        justify-content:
                            space-between;
                        align-items: center;
                        gap: 0.35rem;
                        width: 100%;
                        padding:
                            0.35rem
                            0.45rem;
                        border:
                            1px solid
                            var(--color-border-light-primary);
                        border-radius: 4px;
                        background:
                            var(--color-bg-option);
                        cursor: default;
                        user-select: none;
                    }

                    .ra-dm-chip:hover {
                        outline:
                            1px solid
                            var(--color-border-highlight);
                    }

                    .ra-dm-chip-remove {
                        font-size: 0.72em;
                        opacity: 0.65;
                        white-space: nowrap;
                    }

                    .ra-dm-empty {
                        padding:
                            0.45rem
                            0.15rem;
                        text-align: center;
                        font-style: italic;
                        opacity: 0.6;
                    }

                    .ra-dm-help {
                        margin: 0;
                        font-size: 0.9em;
                        opacity: 0.8;
                    }

                    .ra-dm-summary {
                        margin: 0;
                        font-weight: 600;
                    }
                </style>

                <p style="margin: 0;">
                    Add a new Detect Magic automation to
                    <strong>
                        ${escapeHTML(
                            raRegion.name,
                        )}
                    </strong>.
                </p>

                <div
                    class="ra-dm-fields"
                >
                    <label
                        for="ra-dm-subject"
                    >
                        Subject
                    </label>

                    <input
                        id="ra-dm-subject"
                        name="subject"
                        type="text"
                        value="${escapeHTML(
                            editorState.subject,
                        )}"
                        required
                        autofocus
                    >

                    <label
                        for="ra-dm-base-dc"
                    >
                        Base DC
                    </label>

                    <input
                        id="ra-dm-base-dc"
                        name="baseDC"
                        type="number"
                        value="${escapeHTML(
                            editorState.baseDC,
                        )}"
                        min="0"
                        max="100"
                        step="1"
                        required
                    >

                    <label
                        for="ra-dm-detection"
                        style="
                            align-self: start;
                            padding-top: 0.35rem;
                        "
                    >
                        Detection
                    </label>

                    <textarea
                        id="ra-dm-detection"
                        name="detection"
                        rows="4"
                        required
                        placeholder="What is detected automatically when the actor is Detecting Magic."
                    >${escapeHTML(
                        editorState.detection,
                    )}</textarea>

                    <label
                        for="ra-dm-hint"
                        style="
                            align-self: start;
                            padding-top: 0.35rem;
                        "
                    >
                        GM Hint
                    </label>

                    <textarea
                        id="ra-dm-hint"
                        name="hint"
                        rows="4"
                        placeholder="Optional details for interpreting successful identification checks."
                    >${escapeHTML(
                        editorState.hint,
                    )}</textarea>
                </div>

                <div
                    class="ra-dm-picker"
                >
                    <div
                        class="ra-dm-picker-field"
                    >
                        <label
                            for="ra-dm-skill-picker"
                        >
                            Skill
                        </label>

                        <select
                            id="ra-dm-skill-picker"
                            data-ra-skill-picker
                        >
                            ${skillOptionsHTML}
                        </select>
                    </div>

                    <div
                        class="ra-dm-picker-field"
                    >
                        <label
                            for="ra-dm-difficulty-picker"
                        >
                            Difficulty
                        </label>

                        <select
                            id="ra-dm-difficulty-picker"
                            data-ra-difficulty-picker
                        >
                            ${difficultyOptionsHTML}
                        </select>
                    </div>

                    <button
                        type="button"
                        data-ra-add-skill
                    >
                        <i
                            class="fa-solid fa-plus"
                        ></i>

                        Add / Move
                    </button>
                </div>

                <p
                    class="ra-dm-help"
                >
                    Assign each magical tradition skill to a
                    difficulty. A skill can appear in only one
                    column. Double-click a chip to remove it.
                </p>

                <div
                    class="ra-dm-columns-wrapper"
                >
                    <div
                        class="ra-dm-columns"
                    >
                        ${difficultyColumnsHTML}
                    </div>
                </div>

                <p
                    class="ra-dm-summary"
                    data-ra-summary
                >
                </p>

                <p
                    class="ra-dm-help"
                >
                    One secret d20 will be reused for every
                    configured tradition skill.
                </p>
            </div>
        `;

        const dialogResult =
            await foundry.applications.api.DialogV2.wait({
                window: {
                    title:
                        "Add Detect Magic",
                },

                position: {
                    width:
                        1180,
                },

                modal:
                    true,

                rejectClose:
                    false,

                content,

                buttons: [
                    {
                        action:
                            "create",

                        label:
                            "Create",

                        icon:
                            "fa-solid fa-plus",

                        default:
                            true,

                        callback: (
                            event,
                            button,
                        ) => {
                            const form =
                                button.form;

                            return {
                                action:
                                    "create",

                                subject:
                                    String(
                                        form?.elements
                                            ?.namedItem(
                                                "subject",
                                            )
                                            ?.value ??
                                        editorState
                                            .subject,
                                    ).trim(),

                                detection:
                                    String(
                                        form?.elements
                                            ?.namedItem(
                                                "detection",
                                            )
                                            ?.value ??
                                        editorState
                                            .detection,
                                    ).trim(),

                                hint:
                                    String(
                                        form?.elements
                                            ?.namedItem(
                                                "hint",
                                            )
                                            ?.value ??
                                        editorState
                                            .hint,
                                    ).trim(),

                                baseDC:
                                    Number(
                                        form?.elements
                                            ?.namedItem(
                                                "baseDC",
                                            )
                                            ?.value ??
                                        editorState
                                            .baseDC,
                                    ),

                                skills:
                                    cloneSkills(
                                        editorState
                                            .skills,
                                    ),
                            };
                        },
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

                render: (
                    event,
                    dialog,
                ) => {
                    const root =
                        dialog.element
                        instanceof
                        HTMLElement
                            ? dialog.element
                            : dialog.element
                                ?.[0] ??
                            null;

                    if (!root) {
                        console.error(
                            "Region Automation | Detect Magic editor root unavailable",
                            {
                                event,
                                dialog,
                            },
                        );

                        return;
                    }

                    const subjectInput =
                        root.querySelector(
                            '[name="subject"]',
                        );

                    const detectionInput =
                        root.querySelector(
                            '[name="detection"]',
                        );

                    const hintInput =
                        root.querySelector(
                            '[name="hint"]',
                        );

                    const baseDCInput =
                        root.querySelector(
                            '[name="baseDC"]',
                        );

                    const skillPicker =
                        root.querySelector(
                            "[data-ra-skill-picker]",
                        );

                    const difficultyPicker =
                        root.querySelector(
                            "[data-ra-difficulty-picker]",
                        );

                    const addSkillButton =
                        root.querySelector(
                            "[data-ra-add-skill]",
                        );

                    const summary =
                        root.querySelector(
                            "[data-ra-summary]",
                        );

                    const updateDCLabels =
                        () => {
                            const baseDC =
                                Number(
                                    baseDCInput
                                        ?.value,
                                );

                            for (
                                const difficulty
                                of DIFFICULTIES
                            ) {
                                const dcElement =
                                    root.querySelector(
                                        `[data-dc-for="${difficulty}"]`,
                                    );

                                if (!dcElement) {
                                    continue;
                                }

                                dcElement.textContent =
                                    Number.isFinite(
                                        baseDC,
                                    )
                                        ? `DC ${
                                            Math.trunc(
                                                baseDC,
                                            ) +
                                            DC_ADJUSTMENTS[
                                                difficulty
                                            ]
                                        }`
                                        : "DC —";
                            }
                        };

                    const removeSkill =
                        slug => {
                            for (
                                const difficulty
                                of DIFFICULTIES
                            ) {
                                editorState.skills[
                                    difficulty
                                ] =
                                    editorState.skills[
                                        difficulty
                                    ].filter(
                                        candidate =>
                                            candidate !==
                                            slug,
                                    );
                            }
                        };

                    const renderSkills =
                        () => {
                            for (
                                const difficulty
                                of DIFFICULTIES
                            ) {
                                const chipList =
                                    root.querySelector(
                                        `[data-chip-list="${difficulty}"]`,
                                    );

                                if (!chipList) {
                                    continue;
                                }

                                const slugs =
                                    editorState.skills[
                                        difficulty
                                    ] ?? [];

                                if (
                                    slugs.length ===
                                    0
                                ) {
                                    chipList.innerHTML = `
                                        <div
                                            class="ra-dm-empty"
                                        >
                                            No skills
                                        </div>
                                    `;

                                    continue;
                                }

                                chipList.innerHTML =
                                    slugs.map(
                                        slug => `
                                            <div
                                                class="ra-dm-chip"
                                                data-ra-chip="${escapeHTML(
                                                    slug,
                                                )}"
                                                title="Double-click to remove"
                                            >
                                                <span>
                                                    ${escapeHTML(
                                                        SKILL_LABELS[
                                                            slug
                                                        ] ??
                                                        slug,
                                                    )}
                                                </span>

                                                <span
                                                    class="ra-dm-chip-remove"
                                                >
                                                    double-click
                                                </span>
                                            </div>
                                        `,
                                    ).join("");

                                for (
                                    const chip
                                    of chipList.querySelectorAll(
                                        "[data-ra-chip]",
                                    )
                                ) {
                                    chip.addEventListener(
                                        "dblclick",
                                        () => {
                                            const slug =
                                                chip.dataset
                                                    .raChip;

                                            if (!slug) {
                                                return;
                                            }

                                            removeSkill(
                                                slug,
                                            );

                                            renderSkills();
                                        },
                                    );
                                }
                            }

                            const count =
                                countConfiguredSkills(
                                    editorState
                                        .skills,
                                );

                            if (summary) {
                                summary.textContent =
                                    `${count} skill${
                                        count === 1
                                            ? ""
                                            : "s"
                                    } configured.`;
                            }
                        };

                    subjectInput
                        ?.addEventListener(
                            "input",
                            () => {
                                editorState
                                    .subject =
                                    subjectInput
                                        .value;
                            },
                        );

                    detectionInput
                        ?.addEventListener(
                            "input",
                            () => {
                                editorState
                                    .detection =
                                    detectionInput
                                        .value;
                            },
                        );

                    hintInput
                        ?.addEventListener(
                            "input",
                            () => {
                                editorState
                                    .hint =
                                    hintInput
                                        .value;
                            },
                        );

                    baseDCInput
                        ?.addEventListener(
                            "input",
                            () => {
                                editorState
                                    .baseDC =
                                    Number(
                                        baseDCInput
                                            .value,
                                    );

                                updateDCLabels();
                            },
                        );

                    addSkillButton
                        ?.addEventListener(
                            "click",
                            () => {
                                const slug =
                                    skillPicker
                                        ?.value;

                                const difficulty =
                                    difficultyPicker
                                        ?.value;

                                if (
                                    !VALID_SKILLS.has(
                                        slug,
                                    ) ||
                                    !DIFFICULTIES.includes(
                                        difficulty,
                                    )
                                ) {
                                    ui.notifications.warn(
                                        "Region Automation: choose a valid skill and difficulty.",
                                    );

                                    return;
                                }

                                removeSkill(
                                    slug,
                                );

                                editorState.skills[
                                    difficulty
                                ].push(slug);

                                renderSkills();
                            },
                        );

                    updateDCLabels();
                    renderSkills();
                },
            });

        if (
            !dialogResult ||
            dialogResult.action ===
                "cancel"
        ) {
            console.info(
                "Region Automation | Add Detect Magic canceled",
            );

            return;
        }

        editorState.subject =
            dialogResult.subject;

        editorState.detection =
            dialogResult.detection;

        editorState.hint =
            dialogResult.hint;

        editorState.baseDC =
            dialogResult.baseDC;

        editorState.skills =
            normalizeSkills(
                dialogResult.skills,
            );

        if (
            !editorState.subject
        ) {
            ui.notifications.warn(
                "Region Automation: the Detect Magic subject cannot be empty.",
            );

            continue;
        }

        if (
            !editorState.detection
        ) {
            ui.notifications.warn(
                "Region Automation: the detection description cannot be empty.",
            );

            continue;
        }

        if (
            !Number.isFinite(
                editorState.baseDC,
            ) ||
            !Number.isInteger(
                editorState.baseDC,
            ) ||
            editorState.baseDC <
                0 ||
            editorState.baseDC >
                100
        ) {
            ui.notifications.warn(
                "Region Automation: Base DC must be a whole number from 0 to 100.",
            );

            continue;
        }

        if (
            countConfiguredSkills(
                editorState.skills,
            ) === 0
        ) {
            ui.notifications.warn(
                "Region Automation: configure at least one identification skill.",
            );

            continue;
        }

        submittedConfiguration = {
            subject:
                editorState.subject,

            detection:
                editorState.detection,

            hint:
                editorState.hint,

            baseDC:
                editorState.baseDC,

            skills:
                cloneSkills(
                    editorState.skills,
                ),
        };
    }

    const behaviorName =
        `[RA-detect-magic] ${submittedConfiguration.subject}`;

    const moduleData = {
        schemaVersion:
            2,

        functionality:
            "detect-magic",

        config:
            submittedConfiguration,

        triggeredTokenUuids:
            [],
    };

    try {
        const createdBehaviors =
            await raRegion
                .createEmbeddedDocuments(
                    "RegionBehavior",
                    [
                        {
                            name:
                                behaviorName,

                            type:
                                "executeScript",

                            system: {
                                events: [
                                    "tokenEnter",
                                ],

                                source:
                                    BEHAVIOR_SOURCE,
                            },

                            disabled:
                                false,

                            flags: {
                                [MODULE_ID]:
                                    moduleData,
                            },
                        },
                    ],
                );

        const createdBehavior =
            createdBehaviors[0] ??
            null;

        if (!createdBehavior) {
            throw new Error(
                "Foundry returned no created Region Behavior.",
            );
        }

        console.log(
            "Region Automation | Detect Magic created",
            {
                region:
                    raRegion,

                behavior:
                    createdBehavior,

                configuration:
                    submittedConfiguration,
            },
        );

        ui.notifications.info(
            `Region Automation: created "${behaviorName}" in "${raRegion.name}".`,
        );
    } catch (error) {
        console.error(
            "Region Automation | Detect Magic could not be created",
            error,
        );

        ui.notifications.error(
            "Region Automation: the Detect Magic automation could not be created. See the console.",
        );
    }
})();
