/**
 * PF2e Exploration Automation
 * scripts/world-macros/shared/html.js
 *
 * Shared by every ported RollHelper's GM chat output.
 */

const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
};

export function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}
