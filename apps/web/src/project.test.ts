import { expect, it } from 'vitest';
import { compare, simulate } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { defaultScenarios, newModelXml, nextScenarioRevisions, readProject } from './project';
import { prepareSimulation } from './simulationGate';
import type { ProjectDocument } from './store/ProjectStore';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');
it('modelo propio → dos escenarios → simular → snapshot JSON → reabrir → comparar', async () => {
  const xml = newModelXml(); const { ir } = await parseBpmn(xml); const scenarios = defaultScenarios(ir);
  const runs = await Promise.all(Object.keys(scenarios).map(async (name) => {
    const prepared = await prepareSimulation(xml, name, scenarios);
    return { id: name, scenarioName: name, result: simulate(prepared.ir, prepared.scenario),
      inputs: { modelRevision: 0, scenarioRevision: 0, xml, scenario: prepared.scenario as unknown as Record<string, unknown> } };
  }));
  const doc: ProjectDocument = { version: 1, id: 'own', name: 'Proyecto con tildes á', model: { id: ir.id, name: 'model.bpmn', xml, revision: 0 }, scenarios, scenarioRevisions: {}, runs };
  const reopened = readProject(JSON.parse(JSON.stringify(doc)) as unknown);
  expect(reopened).toEqual(doc);
  const corrupt = structuredClone(doc);
  (corrupt.runs[0]!.inputs as { scenario: Record<string, unknown> }).scenario = {};
  expect(() => readProject(corrupt)).toThrow('entradas');
  expect(compare(reopened.runs.map((r) => r.result)).rows.length).toBeGreaterThan(0);
  const again = await prepareSimulation(reopened.model.xml, 'as-is.scenario.json', reopened.scenarios);
  expect(simulate(again.ir, again.scenario)).toEqual(runs[0]!.result);
});
it('nuevo diagrama usa ids únicos y tres nodos conectados', async () => {
  const a = (await parseBpmn(newModelXml())).ir, b = (await parseBpmn(newModelXml())).ir;
  expect(a.id).not.toBe(b.id); expect(Object.keys(a.nodes)).toHaveLength(3); expect(Object.keys(a.flows)).toHaveLength(2);
});
it('solo invalida el escenario editado y sus descendientes', () => {
  const scenarios = { base: {}, child: { extends: 'base' }, grandchild: { extends: 'child' }, other: {} };
  expect(nextScenarioRevisions('child', scenarios, {})).toEqual({ child: 1, grandchild: 1 });
  expect(nextScenarioRevisions('base', scenarios, {})).toEqual({ base: 1, child: 1, grandchild: 1 });
});
it('rechaza documentos de versión desconocida y corridas corruptas', () => {
  expect(() => readProject({ version: 99 })).toThrow();
});
