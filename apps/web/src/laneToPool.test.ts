/**
 * LILA-334. The acceptance of the ticket, without any DOM: the three lanes of the credit-card
 * example, assigned to their three pools, have to produce exactly the `resources` that
 * `examples/tarjeta-credito/as-is.scenario.json` already carries by hand. If the bulk edit and
 * the file ever disagree, this is the test that says so.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';

import { laneAssignmentDelta, tasksByLane } from './laneToPool.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');

type Json = Record<string, unknown>;

let ir: ProcessIR;
let asIs: Json;

beforeAll(async () => {
  const xml = readFileSync(resolve(RAIZ, 'examples/tarjeta-credito/model.bpmn'), 'utf8');
  ir = (await parseBpmn(xml)).ir;
  asIs = JSON.parse(
    readFileSync(resolve(RAIZ, 'examples/tarjeta-credito/as-is.scenario.json'), 'utf8'),
  ) as Json;
}, 120_000);

/** `elements[id].resources` of a scenario, only for the elements that declare it. */
function recursos(escenario: Json): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [id, elemento] of Object.entries(escenario['elements'] as Record<string, Json>)) {
    if (elemento['resources'] !== undefined) salida[id] = elemento['resources'];
  }
  return salida;
}

/** The same scenario with every `resources` stripped: the starting point of the three clicks. */
function sinRecursos(escenario: Json): Json {
  const elementos: Record<string, Json> = {};
  for (const [id, elemento] of Object.entries(escenario['elements'] as Record<string, Json>)) {
    const { resources: _fuera, ...resto } = elemento;
    elementos[id] = resto;
  }
  return { ...escenario, elements: elementos };
}

const POOL_DE_CARRIL: Record<string, string> = {
  'Account Executive': 'executive',
  'Credit Analyst': 'analyst',
  'Production Operator': 'operator',
};

describe('tasksByLane', () => {
  it('groups only tasks, in IR order, and leaves events and gateways out', () => {
    const porCarril = tasksByLane(ir);
    expect([...porCarril.keys()].sort()).toEqual([
      'Account Executive',
      'Credit Analyst',
      'Production Operator',
    ]);
    for (const [, ids] of porCarril) {
      for (const id of ids) expect(ir.nodes[id]?.type).toBe('task');
    }
    // 13 tasks in total: the ticket's "13 identical assignments".
    expect([...porCarril.values()].flat()).toHaveLength(13);
    const ordenIr = Object.keys(ir.nodes);
    for (const [, ids] of porCarril) {
      const posiciones = ids.map((id) => ordenIr.indexOf(id));
      expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
    }
  });

  it('is empty without an IR', () => {
    expect(tasksByLane(null).size).toBe(0);
  });
});

describe('laneAssignmentDelta', () => {
  it('three assignments reproduce the resources of the credit-card AS-IS', () => {
    let escenario = sinRecursos(asIs);
    const porCarril = tasksByLane(ir);
    for (const [carril, pool] of Object.entries(POOL_DE_CARRIL)) {
      const { fragment, alreadyAssigned } = laneAssignmentDelta(
        escenario,
        porCarril.get(carril) ?? [],
        pool,
      );
      expect(alreadyAssigned).toEqual([]);
      const elementos = { ...(escenario['elements'] as Record<string, Json>) };
      for (const [id, elemento] of Object.entries(fragment.elements)) {
        elementos[id] = { ...(elementos[id] ?? {}), ...elemento };
      }
      escenario = { ...escenario, elements: elementos };
    }
    expect(recursos(escenario)).toEqual(recursos(asIs));
  });

  it('keeps the other fields of the element (processingTime survives)', () => {
    const escenario = sinRecursos(asIs);
    const ids = tasksByLane(ir).get('Production Operator') ?? [];
    const { fragment } = laneAssignmentDelta(escenario, ids, 'operator');
    const id = ids[0]!;
    expect(Object.keys(fragment.elements[id]!)).toEqual(['resources']);
    expect(fragment.elements[id]).toEqual({ resources: [{ ref: 'operator', quantity: 1 }] });
  });

  it('lists the tasks that already have resources, and only those', () => {
    const ids = tasksByLane(ir).get('Credit Analyst') ?? [];
    const { alreadyAssigned } = laneAssignmentDelta(asIs, ids, 'executive');
    expect(alreadyAssigned).toEqual(ids);

    const parcial = sinRecursos(asIs);
    const elementos = parcial['elements'] as Record<string, Json>;
    elementos[ids[0]!] = { ...elementos[ids[0]!], resources: [{ ref: 'analyst', quantity: 1 }] };
    // An empty array is not an assignment: there is nothing to lose by overwriting it.
    elementos[ids[1]!] = { ...elementos[ids[1]!], resources: [] };
    expect(laneAssignmentDelta(parcial, ids, 'executive').alreadyAssigned).toEqual([ids[0]!]);
  });
});
