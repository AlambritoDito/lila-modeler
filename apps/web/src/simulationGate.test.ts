import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prepareSimulation } from './simulationGate';
const xml = readFileSync('examples/pedido/model.bpmn', 'utf8');
const raw = JSON.parse(readFileSync('examples/pedido/as-is.scenario.json', 'utf8')) as Record<string, unknown>;
it('resuelve y valida el escenario real antes de simular', async () => {
  const prepared = await prepareSimulation(xml, 'as-is.scenario.json', { 'as-is.scenario.json': raw });
  expect(prepared.ir.id).toBeTruthy(); expect(prepared.scenario.run).toBeDefined();
});
it('bloquea parámetros inválidos', async () => {
  await expect(prepareSimulation(xml, 'bad', { bad: { ...raw, run: { duration: -1 } } })).rejects.toThrow();
});
it('bloquea elementos BPMN fuera del perfil antes de simular', async () => {
  const bad = xml.replace(/bpmn:task/g, 'bpmn:adHocSubProcess');
  await expect(prepareSimulation(bad, 'base', { base: raw })).rejects.toThrow();
});

it('un escenario que apunta a otro modelo no simula el modelo activo por accidente', async () => {
  await expect(prepareSimulation(xml, 'base', { base: { ...raw, model: 'otro.bpmn' } })).rejects.toThrow('modelo activo');
});
