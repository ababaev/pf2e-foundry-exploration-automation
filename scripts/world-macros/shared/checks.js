/**
 * PF2e Exploration Automation
 * scripts/world-macros/shared/checks.js
 *
 * Shared degree-of-success and difficulty-ladder helpers used by the
 * ported RollHelpers that roll one shared d20 against several
 * statistics (Investigate, Detect Magic). Search delegates its degree
 * of success to PF2e's native Seek action instead, so it only uses
 * RANK_LETTERS/getResultStyle from here.
 */

export const DIFFICULTIES = [
    "incredibly-easy",
    "very-easy",
    "easy",
    "normal",
    "hard",
    "very-hard",
    "incredibly-hard",
];

export const DC_ADJUSTMENTS = {
    "incredibly-easy": -10,
    "very-easy": -5,
    easy: -2,
    normal: 0,
    hard: 2,
    "very-hard": 5,
    "incredibly-hard": 10,
};

export const RANK_LETTERS = { 0: "U", 1: "T", 2: "E", 3: "M", 4: "L" };

export function rankLetter(rank) {
    return RANK_LETTERS[rank] ?? "U";
}

/**
 * PF2e degree of success from a total vs. a DC, with the standard
 * natural-20/natural-1 step adjustment.
 */
export function getDegreeOfSuccess(total, dc, naturalRoll) {
    let degree;

    if (total >= dc + 10) degree = 3;
    else if (total >= dc) degree = 2;
    else if (total <= dc - 10) degree = 0;
    else degree = 1;

    if (naturalRoll === 20) degree = Math.min(3, degree + 1);
    else if (naturalRoll === 1) degree = Math.max(0, degree - 1);

    return ["criticalFailure", "failure", "success", "criticalSuccess"][degree];
}

export function getResultStyle(degree) {
    switch (degree) {
        case "criticalSuccess":
            return "color: #198754; font-weight: 700";
        case "success":
            return "color: #2563eb; font-weight: 700";
        case "criticalFailure":
            return "color: #b91c1c; font-weight: 700";
        default:
            return "";
    }
}
