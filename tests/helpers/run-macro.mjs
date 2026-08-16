/**
 * PF2e Exploration Automation
 * tests/helpers/run-macro.mjs
 *
 * Runs a scripts/world-macros/*.js paste-only file the same way Foundry
 * actually runs a world Macro: reads its source text and executes it as
 * the body of a fresh AsyncFunction, rather than importing it as an ES
 * module. These files intentionally have no import/export (they're pasted
 * into a Macro document, which can't use static import), so Node can't
 * unambiguously detect them as ESM and top-level `await` would otherwise
 * fail under Node's CommonJS fallback. Executing them as an AsyncFunction
 * body sidesteps that entirely and matches production semantics: no
 * caching to worry about (each call re-reads the file and builds a fresh
 * function), and undeclared identifiers (game, ui, canvas, ...) resolve
 * against globalThis exactly like a real Macro.execute(scope) does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * @param {URL|string} fileUrlOrPath - Absolute file URL or path to the macro source.
 * @param {Record<string, unknown>} [scope] - Extra names to bind as parameters, mirroring Macro.execute(scope).
 */
export async function runPastedMacro(fileUrlOrPath, scope = {}) {
    const path = fileUrlOrPath instanceof URL ? fileURLToPath(fileUrlOrPath) : fileUrlOrPath;
    const source = readFileSync(path, "utf8");
    const paramNames = Object.keys(scope);
    const fn = new AsyncFunction(...paramNames, source);
    return fn(...paramNames.map(name => scope[name]));
}
