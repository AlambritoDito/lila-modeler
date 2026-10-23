/**
 * The catalog lint (#95, RM-01 § 3.4): two warnings computed from the usage index (§ 4), so the CLI
 * and the MCP server report them identically.
 *
 * - `W-REF-SIN-CATALOGO`: a BPMN reference (`roleRef`, or the `ref` of a `lila:*Ref`/`lila:input`/
 *   `lila:output`) whose id matches no object of the type it expects (RM-01 § 3.1). The reference
 *   stays in the file as it is; this only says so.
 * - `W-ACTIVIDAD-SIN-RESPONSABLE`: a task, sub-process or call activity without a
 *   `lila:responsibility type="R"`. Lila's own check: ADONIS documents none like it.
 *
 * Only a version 3 repository is linted: a version 1 or 2 project has no catalog to check against,
 * and its typed ids get no warnings. Read-only and never fatal: these are warnings, not errors.
 */
import { annotatableElements } from '../bpmn/annotate.js';
import { messages, type Locale } from '../messages/index.js';
import { processesOf } from './repository.js';
import type { ProjectDocument } from './types.js';
import { formatVersionOf } from './upgrade.js';
import { usageIndex, type CatalogUse, type ProcessUse, type UsageIndex } from './usage.js';

export type CatalogWarningCode = 'W-REF-SIN-CATALOGO' | 'W-ACTIVIDAD-SIN-RESPONSABLE';

export interface CatalogWarning {
  readonly code: CatalogWarningCode;
  /** The process id (RM-01 § 3.2); absent only for a process that has none yet. */
  readonly process?: string;
  /** The slug of the process: what `lila validate --process` takes. */
  readonly slug: string;
  /** The BPMN id of the element. */
  readonly element: string;
  /** `W-REF-SIN-CATALOGO` only: the relation, as in the usage index (`responsibility:R`, `systemRef`…). */
  readonly relation?: string;
  /** `W-REF-SIN-CATALOGO` only: the type the reference expects. */
  readonly type?: string;
  /** `W-REF-SIN-CATALOGO` only: the id that matches no object. */
  readonly ref?: string;
  readonly message: string;
}

/** The BPMN types `W-ACTIVIDAD-SIN-RESPONSABLE` looks at: tasks, sub-processes and call activities. */
const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ManualTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:SubProcess',
  'bpmn:AdHocSubProcess',
  'bpmn:Transaction',
  'bpmn:CallActivity',
]);

function isProcessUse(use: CatalogUse): use is ProcessUse {
  return 'element' in use;
}

/**
 * The catalog warnings of `document`, in process order; inside a process, its unresolved references
 * in document order, then its activities without a Responsible in document order. `[]` for a
 * version 1 or 2 document. `index` is `usageIndex(document)` when the caller already has it.
 * Throws `AnnotationContentLossError` where `usageIndex` would.
 */
export async function lintCatalog(
  document: ProjectDocument,
  index?: UsageIndex,
  options: { readonly locale?: Locale | undefined } = {},
): Promise<CatalogWarning[]> {
  if (formatVersionOf(document) !== 3) return [];
  const M = messages(options.locale ?? 'en').codes;
  const usage = index ?? (await usageIndex(document));

  // Every element with an R, resolved or not: a Responsible whose role is missing is still one.
  const responsible = new Set<string>();
  const uses = [...Object.values(usage.uses).flat(), ...usage.unresolved];
  for (const use of uses) {
    if (isProcessUse(use) && use.relation === 'responsibility:R') responsible.add(`${use.slug}\n${use.element}`);
  }

  const warnings: CatalogWarning[] = [];
  for (const process of processesOf(document)) {
    const label = process.id ?? process.slug;
    const where = { ...(process.id !== undefined ? { process: process.id } : {}), slug: process.slug };
    const seen = new Set<string>();
    for (const use of usage.unresolved) {
      if (!isProcessUse(use) || use.slug !== process.slug) continue;
      const key = `${use.element}\n${use.relation}\n${use.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({
        code: 'W-REF-SIN-CATALOGO',
        ...where,
        element: use.element,
        relation: use.relation,
        type: use.type,
        ref: use.id,
        message: M['W-REF-SIN-CATALOGO'](label, use.element, use.relation, use.id, use.type),
      });
    }
    const elements = await annotatableElements(process.model.xml);
    for (const [element, { type }] of Object.entries(elements)) {
      if (!ACTIVITY_TYPES.has(type) || responsible.has(`${process.slug}\n${element}`)) continue;
      warnings.push({
        code: 'W-ACTIVIDAD-SIN-RESPONSABLE',
        ...where,
        element,
        message: M['W-ACTIVIDAD-SIN-RESPONSABLE'](label, element),
      });
    }
  }
  return warnings;
}
