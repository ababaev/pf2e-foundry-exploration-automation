/**
 * PF2e Exploration Automation
 * scripts/world-macros/shared/gm.js
 */

export function getActiveGMs() {
    return game.users.filter(user => user.active && user.isGM);
}
