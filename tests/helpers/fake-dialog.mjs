/**
 * PF2e Exploration Automation
 * tests/helpers/fake-dialog.mjs
 *
 * A stand-in for foundry.applications.api.DialogV2.wait, used to test the
 * *ConfigurationMacros.js paste-only macros without a real browser DOM.
 *
 * These macros build their submitted config two ways:
 *  1. Simple fields (subject/dc/hint/...) are read from `button.form`
 *     inside the clicked button's own `callback`.
 *  2. Investigate/DetectMagic's skill picker is read directly from the
 *     macro's closure (`editorState.skills`), mutated by an "Add / Move"
 *     click listener wired in the dialog's `render` callback.
 *
 * queueDialogResponses lets a test drive both: each queued response
 * supplies the form field values for one DialogV2.wait() call (the
 * *ConfigurationMacros.js files loop and call DialogV2.wait again when
 * validation fails, so a test covering a validation-retry path queues more
 * than one response), and can optionally interact with the rendered dialog
 * (e.g. click "Add / Move") via `interact(elements)` before the button
 * fires.
 */

function makeElement(overrides = {}) {
    const listeners = {};
    const element = {
        value: "",
        textContent: "",
        dataset: {},
        ...overrides,
        addEventListener(type, handler) {
            (listeners[type] ??= []).push(handler);
        },
        async fire(type, ...args) {
            for (const handler of listeners[type] ?? []) {
                // eslint-disable-next-line no-await-in-loop
                await handler(...args);
            }
        },
        querySelector: () => null,
        setSelectionRange(start, end) {
            this.selectionStart = start;
            this.selectionEnd = end;
        },
        focus() {},
        dispatchEvent() {},
    };

    /*
     * Investigate/DetectMagic's skill-chip columns are re-rendered by
     * setting chipList.innerHTML to a string of `data-ra-chip="<slug>"`
     * divs, then wiring a dblclick listener onto each one found via
     * chipList.querySelectorAll("[data-ra-chip]"). Parsing that out of the
     * HTML string (rather than a real DOM) is enough to let a test
     * double-click a chip and exercise the real removal handler.
     */
    Object.defineProperty(element, "innerHTML", {
        enumerable: true,
        configurable: true,
        get: () => element._innerHTML ?? "",
        set(html) {
            element._innerHTML = html;
            element._chips = [...html.matchAll(/data-ra-chip="([^"]*)"/g)].map(([, slug]) => makeElement({ dataset: { raChip: slug } }));
        },
    });

    element.querySelectorAll = selector => (selector === "[data-ra-chip]" ? element._chips ?? [] : []);

    return element;
}

/**
 * @param {Array<{ action?: string, fields?: object, interact?: (elements: Record<string, ReturnType<typeof makeElement>>) => void }>} responses
 * @returns {{ wait: Function, elementsByCall: Array<Record<string, ReturnType<typeof makeElement>>> }}
 */
export function queueDialogResponses(responses) {
    let callIndex = 0;
    const elementsByCall = [];

    async function wait(config) {
        const response = responses[Math.min(callIndex, responses.length - 1)];
        callIndex += 1;

        if (!response) {
            throw new Error(`DialogV2.wait called more times (${callIndex}) than queued responses (${responses.length})`);
        }

        const elements = new Map();
        const root = Object.assign(Object.create(globalThis.HTMLElement.prototype), {
            querySelector(selector) {
                return elements.get(selector) ?? null;
            },
        });

        if (response.elements) {
            const fieldsForSeeding = response.fields ?? {};

            for (const [selector, overrides] of Object.entries(response.elements)) {
                const nameMatch = /^\[name="(.+)"\]$/.exec(selector);
                const seededValue = nameMatch && Object.hasOwn(fieldsForSeeding, nameMatch[1]) ? fieldsForSeeding[nameMatch[1]] : "";

                elements.set(selector, makeElement({ value: seededValue, ...overrides }));
            }
        }

        if (typeof config.render === "function") {
            config.render({}, { element: root });
        }

        await response.interact?.(Object.fromEntries(elements));
        elementsByCall.push(Object.fromEntries(elements));

        if (response.action === "cancel") {
            const cancelButton = config.buttons.find(button => button.action === "cancel");
            return cancelButton.callback({}, { form: null });
        }

        const submitButton = config.buttons.find(button => button.action !== "cancel");
        const fields = response.fields ?? {};

        /*
         * A real <form>'s namedItem reads the live, current DOM value — so
         * if a "drop" handler mutated a registered element (e.g. the hint
         * textarea), that mutation is reflected here too, same as in
         * Foundry. Falls back to the queued field value for names with no
         * matching registered element.
         */
        const form = {
            elements: {
                namedItem: name => {
                    const element = elements.get(`[name="${name}"]`);
                    if (element) return { value: element.value };
                    return Object.hasOwn(fields, name) ? { value: fields[name] } : null;
                },
            },
        };

        return submitButton.callback({}, { form });
    }

    return { wait, elementsByCall };
}
