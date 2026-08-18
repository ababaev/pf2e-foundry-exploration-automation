import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBaseGlobals } from "../helpers/mock-foundry.mjs";
import { JOURNAL_NAME, logToGMJournal, __resetGMLogCacheForTests } from "../../scripts/world-macros/shared/gm-log.js";

// gm-log.js memoizes the Journal lookup at module scope (deliberately, to
// fix a real duplicate-Journal race) — that state otherwise leaks between
// test()s in this file, since Node only imports the module once per file.
beforeEach(() => {
    __resetGMLogCacheForTests();
});

test("logToGMJournal: creates the log Journal on first use, with GM-only visibility", async () => {
    const { journals } = installBaseGlobals();

    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>Result</p>" });

    assert.equal(journals.length, 1);
    assert.equal(journals[0].name, JOURNAL_NAME);
    assert.equal(journals[0].ownership.default, globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
});

test("logToGMJournal: reuses the same Journal across multiple calls instead of creating a new one each time", async () => {
    const { journals } = installBaseGlobals();

    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>First</p>" });
    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Borin", content: "<p>Second</p>" });

    assert.equal(journals.length, 1);
    assert.equal(journals[0].pages.length, 2);
});

test("logToGMJournal: each page's name includes the region, character, and a real-time timestamp", async () => {
    const { journals } = installBaseGlobals();

    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>Result</p>" });

    const page = journals[0].pages[0];
    assert.match(page.name, /^Trap Hallway — Aria — /);
});

test("logToGMJournal: page content includes game time, real time, character, region, and the exact chat content", async () => {
    const { journals } = installBaseGlobals();

    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>18 vs DC 20</p>" });

    const page = journals[0].pages[0];
    assert.equal(page.type, "text");
    assert.equal(page.text.format, globalThis.CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML);
    assert.match(page.text.content, /Game time:/);
    assert.match(page.text.content, /Real time:/);
    assert.match(page.text.content, /Character:.*Aria/s);
    assert.match(page.text.content, /Region:.*Trap Hallway/s);
    assert.match(page.text.content, /<p>18 vs DC 20<\/p>/);
});

test("logToGMJournal: later pages sort after earlier ones, so the last record is last", async () => {
    const { journals } = installBaseGlobals();

    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>First</p>" });
    await logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>Second</p>" });

    const [first, second] = journals[0].pages;
    assert.ok(second.sort >= first.sort);
});

test("logToGMJournal: escapes region/character names but leaves the chat content HTML intact", async () => {
    const { journals } = installBaseGlobals();

    await logToGMJournal({
        regionName: "<script>alert(1)</script>",
        actorName: "O'Malley & Sons",
        content: "<p>Safe pre-escaped content</p>",
    });

    const page = journals[0].pages[0];
    assert.doesNotMatch(page.text.content, /<script>alert/);
    assert.match(page.text.content, /&lt;script&gt;/);
    assert.match(page.text.content, /O&#039;Malley &amp; Sons/);
    assert.match(page.text.content, /<p>Safe pre-escaped content<\/p>/);
});

test("logToGMJournal: several Behaviors resolving on the same token around the same time create only one Journal (no duplicates)", async () => {
    const { journals } = installBaseGlobals();

    // Simulates a token triggering several Behaviors simultaneously (e.g.
    // a Region with both a Search and a Saving Throw automation) -- before
    // the fix, each of these independently saw "no Journal yet" and each
    // created its own.
    await Promise.all([
        logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>Search result</p>" }),
        logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>Saving Throw result</p>" }),
        logToGMJournal({ regionName: "Trap Hallway", actorName: "Aria", content: "<p>Detect Magic result</p>" }),
    ]);

    assert.equal(journals.length, 1);
    assert.equal(journals[0].pages.length, 3);
});

test("logToGMJournal: never throws, even if the Journal API is unavailable", async () => {
    installBaseGlobals();
    globalThis.game.journal = undefined;

    await assert.doesNotReject(logToGMJournal({ regionName: "X", actorName: "Y", content: "<p>Z</p>" }));
});
