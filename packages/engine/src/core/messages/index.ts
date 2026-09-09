/**
 * Entry point of the `core/` message catalog (LILA-211).
 *
 * `core/` cannot import the full catalog (`src/messages/`), which pulls in the bpmn, scenario and
 * zod namespaces: this module is the subset the simulation kernel needs, and the full catalog
 * composes it (ADR-009).
 */
import { coreEn } from './en.js';
import { coreEs } from './es.js';
import type { CoreCatalog, Locale } from './types.js';

export type { CoreCatalog, CoreChrome, CoreCodeMessages, Locale } from './types.js';
export { coreEn } from './en.js';
export { coreEs } from './es.js';

/** The `core/` catalog for a locale. English is the default for anything unknown. */
export function coreMessages(locale: Locale = 'en'): CoreCatalog {
  return locale === 'es' ? coreEs : coreEn;
}

/**
 * `CODE: body`, the shape the engine uses where the code travels **inside** the string: the
 * warnings of `RunResult.warnings[]` and the `Error.message` of the guards in `core/`. Problems
 * that carry their own `code` field (`IrProblem`, `ScenarioProblem`) use the body alone.
 *
 * It exists so that no `"CODE: …"` literal is left outside the catalog: a test walks
 * `packages/engine/src` and fails on one (LILA-204, generalised in LILA-211).
 */
export function coded(code: string, body: string): string {
  return `${code}: ${body}`;
}
