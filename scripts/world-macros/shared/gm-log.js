/**
 * PF2e Exploration Automation
 * scripts/world-macros/shared/gm-log.js
 *
 * Duplicates every GM-whispered result chat message into a persistent,
 * GM-only Journal ("Log: Important Events"), one page per result, so a GM
 * can review past secret checks without scrolling chat history. The
 * Journal's name is deliberately generic (not module-branded) so other
 * modules can write their own GM-only events into the same shared log
 * rather than each spawning their own.
 * Called once, generically, from shared/trigger-flow.js after a roll
 * succeeds — every activity's RollHelper already builds a whispered
 * ChatMessage with the exact HTML this reuses verbatim, so no per-activity
 * changes are needed.
 */

import { escapeHTML } from "./html.js";

/**
 * Exported (and mirrored on the module API as `gmLogJournalName`) so other
 * modules can target this exact Journal without hardcoding the string
 * themselves.
 */
export const JOURNAL_NAME = "Log: Important Events";

/**
 * Foundry's own worldTime is seconds since an arbitrary epoch, not a
 * calendar date. PF2e's World Clock (when present) formats it against the
 * configured in-world calendar; fall back to a labeled raw value if that
 * API isn't available or its shape differs from what's expected here.
 */
function formatGameTime() {
    try {
        const worldClockTime = game.pf2e?.worldClock?.worldTime;

        if (worldClockTime && typeof worldClockTime.toFormat === "function") {
            return worldClockTime.toFormat("MMMM d, yyyy, h:mm a");
        }

        if (worldClockTime && typeof worldClockTime.toLocaleString === "function") {
            return worldClockTime.toLocaleString();
        }
    } catch (error) {
        console.warn("Region Automation | Could not read the PF2e World Clock", error);
    }

    const rawWorldTime = game.time?.worldTime;
    return Number.isFinite(rawWorldTime) ? `${rawWorldTime}s (world time)` : "Unknown";
}

/**
 * Find or create the module's log Journal, filed with GM-only visibility.
 *
 * Memoized as a single in-flight promise so that several Behaviors
 * resolving around the same time on the same token (e.g. a Region with
 * both a Search and a Saving Throw automation) all await the *same*
 * creation instead of each independently seeing "no Journal yet" and
 * creating their own duplicate — the same class of check-then-create race
 * RegistrationMacros.js's lock already guards against, just not previously
 * handled here. Only protects a single GM client, same caveat as that
 * lock (multi-GM synchronization isn't handled).
 */
let logJournalPromise = null;

async function ensureLogJournal() {
    if (!logJournalPromise) {
        logJournalPromise = (async () => {
            const existing = game.journal.find(journal => journal.name === JOURNAL_NAME);

            if (existing) return existing;

            return JournalEntry.create({
                name: JOURNAL_NAME,
                ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
            });
        })();

        // Let a later call retry from scratch instead of staying stuck on
        // a permanently-rejected cached promise.
        logJournalPromise.catch(() => {
            logJournalPromise = null;
        });
    }

    return logJournalPromise;
}

/**
 * Test-only escape hatch: clears the cached in-flight/resolved Journal
 * promise. Without this, tests/helpers/mock-foundry.mjs's fresh `journal`
 * mock per test() would be masked by whatever this module cached from an
 * earlier test in the same file/process (see tests/README.md's note on
 * module-level state persisting across test() calls).
 */
export function __resetGMLogCacheForTests() {
    logJournalPromise = null;
}

/**
 * Append one page to the GM log Journal. Never throws — a logging failure
 * should not interfere with the chat message the GM already received.
 *
 * @param {string} regionName
 * @param {string} actorName
 * @param {string} content - The exact HTML already sent to chat.
 */
export async function logToGMJournal({ regionName, actorName, content }) {
    try {
        const journal = await ensureLogJournal();

        const realTime = new Date();
        const realTimeLabel = realTime.toLocaleString();
        const gameTimeLabel = formatGameTime();

        const pageName = `${regionName} — ${actorName} — ${realTimeLabel}`;

        const pageContent = `
            <p><strong>Game time:</strong> ${escapeHTML(gameTimeLabel)}</p>
            <p><strong>Real time:</strong> ${escapeHTML(realTimeLabel)}</p>
            <p><strong>Character:</strong> ${escapeHTML(actorName)}</p>
            <p><strong>Region:</strong> ${escapeHTML(regionName)}</p>
            <hr>
            ${content}
        `;

        await journal.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: pageName,
                type: "text",
                text: { content: pageContent, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
                // Monotonically increasing, so newly-appended pages always
                // sort after every earlier one in the Journal's TOC.
                sort: Date.now(),
            },
        ]);
    } catch (error) {
        console.error("Region Automation | Could not log a result to the GM journal", { regionName, actorName, error });
    }
}
