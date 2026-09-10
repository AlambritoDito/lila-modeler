/**
 * Message catalog of the engine (LILA-211): every `E-*`/`W-*` text in one place, English by
 * default and Spanish as a translation.
 *
 * `messages(locale)` composes the `core/` subset (`src/core/messages/`, which cannot import
 * anything outside `core/`) with the namespaces that live outside it: the model validator, the
 * scenario lint and the zod texts. `docs/SEMANTICS.md` stays normative for the Spanish texts.
 *
 * PR-2 of LILA-211 adds the `cli` and `mcp` namespaces (the chrome of the CLI and of the MCP
 * server) and re-exports `resolveLocale`, the single rule that turns `--lang`/`LILA_LANG`/`LANG`
 * into a `Locale`.
 */
import { coreMessages } from '../core/messages/index.js';
import { en } from './en.js';
import { es } from './es.js';
import type { Catalog, Locale, ProblemCode } from './types.js';

export type {
  Catalog,
  CliMessages,
  CodeMessages,
  CodeOf,
  Constructions,
  Locale,
  McpMessages,
  OuterCodeMessages,
  ProblemCode,
  ZodMessages,
} from './types.js';
export { LOCALES, LOCALE_LIST, isLocale, resolveLocale } from '../locale.js';
export type { CoreCatalog, CoreChrome, CoreCodeMessages } from '../core/messages/index.js';
export { coded, coreMessages } from '../core/messages/index.js';
export {
  CONSTRUCTION_BY_QNAME,
  FALLBACK_CONSTRUCTION,
  type ConstructionId,
} from './constructions.js';
export { en } from './en.js';
export { es } from './es.js';

/** The catalog for a locale. English is the default for anything unknown. */
export function messages(locale: Locale = 'en'): Catalog {
  return locale === 'es' ? es : en;
}

/**
 * Codes that `docs/SEMANTICS.md` § 17 does **not** document because they are guards of the
 * internal API of `core/`, unreachable from a model or a scenario: they signal a bug in a caller
 * that builds the input by hand, not a defect the user can fix. Everything else in
 * `ProblemCode` is in § 17, and a test keeps both lists in step.
 */
export const INTERNAL_CODES: ReadonlySet<ProblemCode> = new Set<ProblemCode>([
  'E-AGREGADO-NO-NUMERICO',
  'E-COMPARE-VACIO',
  'E-KPI-INCONSISTENTE',
  'E-KPI-NO-FINITO',
  'E-REC-ESTADO',
  'E-REC-LIBERACION',
  'E-REC-SIN-ASIGNACION',
  'E-REC-SOLICITUD-DUPLICADA',
  'E-REF-INEXISTENTE',
  'E-REPLICACIONES-INSUFICIENTES',
  'E-REPLICACIONES-VACIAS',
]);
