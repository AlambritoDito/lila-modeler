/**
 * What bpmn-js would say on opening a model (#638): its `importXML` is `moddle.fromXML` (with Lila's
 * descriptor in the app) plus the DI walk, so a model opens with no import warning when the reader
 * has none, every diagram element points at an element of the model, no element is drawn twice on
 * one plane, and (for what Lila draws) every text annotation, data object and association of the
 * main process has its shape or edge.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { expect } from 'vitest';

import lila from '../../src/bpmn/lila.moddle.json' with { type: 'json' };

const DRAWN = new Set([
  'bpmn:TextAnnotation',
  'bpmn:Association',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

/** Returns the problems; `expectCleanImport` asserts there are none. */
export async function importProblems(xml: string): Promise<string[]> {
  const { rootElement, warnings } = await BpmnModdle({ lila }).fromXML(xml);
  const problems = warnings.map((w) => `reader: ${w.message}`);
  const definitions = rootElement as any;
  const ids = new Set<string>();
  const walk = (value: unknown, seen = new Set<unknown>()): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach((v) => walk(v, seen));
    const el = value as Record<string, unknown>;
    if (typeof el['$type'] === 'string' && typeof el['id'] === 'string') ids.add(el['id']);
    for (const key of Object.keys(el)) if (key !== '$parent' && key !== 'diagrams') walk(el[key], seen);
  };
  walk(definitions.rootElements);
  const drawn = new Set<string>();
  for (const diagram of definitions.diagrams ?? []) {
    const onPlane = new Set<string>();
    for (const di of diagram.plane?.planeElement ?? []) {
      const id = di.bpmnElement?.id as string | undefined;
      if (id === undefined || !ids.has(id)) problems.push(`${di.id}: no element of the model`);
      else if (onPlane.has(id)) problems.push(`${id}: drawn twice`);
      else onPlane.add(id);
      if (id !== undefined) drawn.add(id);
    }
  }
  const process = (definitions.rootElements as any[]).find((r) => r.$type === 'bpmn:Process' && (r.flowElements ?? []).length > 0);
  const collaborations = (definitions.rootElements as any[]).filter((r) => r.$type === 'bpmn:Collaboration');
  const elements: any[] = [...(process?.flowElements ?? []), ...(process?.artifacts ?? []), ...collaborations.flatMap((c) => c.artifacts ?? [])];
  for (const el of process?.flowElements ?? []) elements.push(...(el.dataInputAssociations ?? []), ...(el.dataOutputAssociations ?? []));
  for (const el of elements) if (DRAWN.has(el.$type) && !drawn.has(el.id)) problems.push(`${el.id} (${el.$type}): not drawn`);
  return problems;
}

export async function expectCleanImport(xml: string): Promise<void> {
  expect(await importProblems(xml)).toEqual([]);
}
