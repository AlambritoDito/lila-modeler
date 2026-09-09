import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  ScenarioSchema,
  resolveExtends,
  scenarioErrors,
  validateScenario,
  type ScenarioReader,
} from '../src/scenario.js';
import { runReplication, type SimScenario } from '../src/core/sim.js';
import { coded, messages } from '../src/messages/index.js';
import { validateJsonSchema } from './mini-json-schema.js';
import { AS_IS, clone, pedidoIr } from './pedido.fixtures.js';

/**
 * QA adversarial de LILA-164 en el borde del escenario: zod, JSON Schema, `extends` y los textos
 * de error de § 17 de `docs/SEMANTICS.md`.
 */

const repoRoot = new URL('../../../', import.meta.url);
const schema: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('docs/scenario.schema.json', repoRoot)), 'utf8'),
);

const DIA = { intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '08:00', to: '20:00' }] };

const escenario = (resource: Record<string, unknown>): Record<string, unknown> => ({
  version: 1,
  name: 'turnos',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
  calendars: { dia: DIA },
  resources: { enfermera: resource },
});

/* ------------------------------------------------------------------ *
 * (8) Validación: código, ruta y paridad zod ↔ JSON Schema
 * ------------------------------------------------------------------ */

describe('(8) validación de `capacity` por tramos', () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ['lista vacía', { capacity: [] }],
    ['capacity 0 en un tramo', { capacity: [{ calendar: 'dia', capacity: 0 }] }],
    ['capacity no entera', { capacity: [{ calendar: 'dia', capacity: 1.5 }] }],
    ['tramo sin calendar', { capacity: [{ capacity: 2 }] }],
    ['clave de más en el tramo', { capacity: [{ calendar: 'dia', capacity: 2, turno: 'a' }] }],
  ];

  for (const [nombre, resource] of casos) {
    test(`zod y el JSON Schema rechazan los dos la ${nombre}`, () => {
      expect(ScenarioSchema.safeParse(escenario(resource)).success, 'zod').toBe(false);
      expect(validateJsonSchema(schema, escenario(resource)).length, 'json schema').toBeGreaterThan(0);
    });
  }

  test('un `calendar` inexistente es `E-REF-DESCONOCIDA` citando `capacity[i].calendar`', () => {
    const parsed = ScenarioSchema.parse(
      escenario({ capacity: [{ calendar: 'dia', capacity: 2 }, { calendar: 'fantasma', capacity: 1 }] }),
    );
    const problems = scenarioErrors(validateScenario(parsed, pedidoIr()));
    const problem = problems.find((p) => p.path === 'resources.enfermera.capacity[1].calendar');
    expect(problem?.code).toBe('E-REF-DESCONOCIDA');
    expect(problem?.message).toContain('the calendar fantasma does not exist');
  });

  test('`capacity` por tramos junto a `calendar` es `E-CAPACIDAD-Y-CALENDARIO` en `resources.<pool>.capacity`', () => {
    const parsed = ScenarioSchema.parse(
      escenario({ capacity: [{ calendar: 'dia', capacity: 2 }], calendar: 'dia' }),
    );
    const problem = scenarioErrors(validateScenario(parsed, pedidoIr()))
      .find((p) => p.code === 'E-CAPACIDAD-Y-CALENDARIO');
    expect(problem?.path).toBe('resources.enfermera.capacity');
  });

  test('el mismo escenario pasa por el JSON Schema (la exclusión mutua es del lint, no del tipo)', () => {
    // Se fija a propósito: `anyOf` no puede expresar R16, así que el schema acepta lo que el lint
    // rechaza. Quien valide solo con el schema tiene que correr `validateScenario` después.
    expect(validateJsonSchema(schema, escenario({ capacity: [{ calendar: 'dia', capacity: 2 }], calendar: 'dia' }))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * (11) `extends`: los arrays se reemplazan enteros (§ 6)
 * ------------------------------------------------------------------ */

describe('(11) `extends` con `capacity` por tramos', () => {
  const reader = (files: Record<string, unknown>): ScenarioReader => (path) => {
    if (!(path in files)) throw new Error(`no existe ${path}`);
    return clone(files[path]);
  };

  const padre = (capacity: unknown, extra: Record<string, unknown> = {}) => ({
    ...clone(AS_IS),
    calendars: { dia: DIA },
    resources: { cajero: { capacity, ...extra } },
  });

  test('un hijo que pasa de entero a lista reemplaza la clave entera', () => {
    const files = {
      'p.scenario.json': padre(2),
      'h.scenario.json': {
        extends: 'p.scenario.json',
        name: 'hijo',
        resources: { cajero: { capacity: [{ calendar: 'dia', capacity: 5 }] } },
      },
    };
    const resolved = resolveExtends('h.scenario.json', reader(files));
    expect((resolved['resources'] as Record<string, Record<string, unknown>>)['cajero']!['capacity']).toEqual([
      { calendar: 'dia', capacity: 5 },
    ]);
  });

  test('un hijo que pasa de lista a entero reemplaza la lista entera, no la fusiona por índice', () => {
    const files = {
      'p.scenario.json': padre([
        { calendar: 'dia', capacity: 3 },
        { calendar: 'dia', capacity: 1 },
      ]),
      'h.scenario.json': { extends: 'p.scenario.json', name: 'hijo', resources: { cajero: { capacity: 4 } } },
    };
    const resolved = resolveExtends('h.scenario.json', reader(files));
    expect((resolved['resources'] as Record<string, Record<string, unknown>>)['cajero']!['capacity']).toBe(4);
  });

  test('el `calendar` heredado del padre sobrevive y choca con la lista: hay que borrarlo con `null`', () => {
    const files = {
      'p.scenario.json': padre(2, { calendar: 'dia' }),
      'h.scenario.json': {
        extends: 'p.scenario.json',
        name: 'hijo',
        resources: { cajero: { capacity: [{ calendar: 'dia', capacity: 5 }] } },
      },
    };
    const chocan = ScenarioSchema.parse(resolveExtends('h.scenario.json', reader(files)));
    expect(
      scenarioErrors(validateScenario(chocan, pedidoIr())).map((p) => p.code),
    ).toContain('E-CAPACIDAD-Y-CALENDARIO');

    const files2 = {
      ...files,
      'h.scenario.json': {
        ...files['h.scenario.json'],
        resources: { cajero: { capacity: [{ calendar: 'dia', capacity: 5 }], calendar: null } },
      },
    };
    const limpio = ScenarioSchema.parse(resolveExtends('h.scenario.json', reader(files2)));
    expect(
      scenarioErrors(validateScenario(limpio, pedidoIr())).map((p) => p.code),
    ).not.toContain('E-CAPACIDAD-Y-CALENDARIO');
  });
});

/* ------------------------------------------------------------------ *
 * (13) Los textos de § 17 son los que emite `core/`
 * ------------------------------------------------------------------ */

describe('(13) catálogo de errores de § 17', () => {
  const semantics = readFileSync(fileURLToPath(new URL('docs/SEMANTICS.md', repoRoot)), 'utf8');

  const ir = {
    id: 'P',
    name: '',
    nodes: {
      Start: { type: 'start' as const, name: '', incoming: [], outgoing: ['F1'] },
      Tarea: { type: 'task' as const, name: '', incoming: ['F1'], outgoing: ['F2'] },
      End: { type: 'end' as const, name: '', incoming: ['F2'], outgoing: [] },
    },
    flows: {
      F1: { from: 'Start', to: 'Tarea', name: '', isDefault: false },
      F2: { from: 'Tarea', to: 'End', name: '', isDefault: false },
    },
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };

  const sim = (capacity: unknown, extra: Record<string, unknown> = {}): SimScenario => ({
    run: { start: '2026-09-07T08:00:00-06:00', seed: 1, duration: 3600 },
    calendars: { dia: DIA },
    elements: {
      Start: { triggerCount: 1 },
      Tarea: { processingTime: { type: 'constant', value: 60 }, resources: [{ ref: 'enfermera' }] },
    },
    resources: { enfermera: { capacity, ...extra } as never },
  });

  const mensajeDe = (scenario: SimScenario): string => {
    try {
      // § 17 es normativo para el **español**: el catálogo `es` es el que tiene que decir
      // exactamente lo que dice el documento (LILA-211).
      runReplication(ir, scenario, 0, { locale: 'es' });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('se esperaba un error y no lo hubo');
  };

  test('`E-CAPACIDAD-Y-CALENDARIO` sale carácter a carácter como está documentado', () => {
    const mensaje = mensajeDe(sim([{ calendar: 'dia', capacity: 2 }], { calendar: 'dia' }));
    expect(mensaje).toBe(
      'E-CAPACIDAD-Y-CALENDARIO: enfermera: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.',
    );
    expect(semantics).toContain(
      'E-CAPACIDAD-Y-CALENDARIO: <pool>: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.',
    );
  });

  test('las dos formas de `E-REC-CAPACIDAD` salen como están documentadas', () => {
    expect(mensajeDe(sim([]))).toBe('E-REC-CAPACIDAD: enfermera: capacity debe declarar al menos un tramo.');
    expect(semantics).toContain('E-REC-CAPACIDAD: <pool>: capacity debe declarar al menos un tramo.');

    expect(mensajeDe(sim([{ calendar: 'dia', capacity: 0 }]))).toBe(
      'E-REC-CAPACIDAD: enfermera: capacity debe ser un entero mayor o igual que 1.',
    );
    expect(semantics).toContain('E-REC-CAPACIDAD: <pool>: capacity debe ser un entero mayor o igual que 1.');
  });

  /**
   * LILA-204: el QA de LILA-164 encontró dos textos de `E-REC-CAPACIDAD` en `core/calendar.ts` que
   * § 17 no recogía. Eran guardias internos, no errores del escenario, y ahora lanzan sin código.
   *
   * Desde LILA-211 los dos textos salen del catálogo en vez de estar escritos aquí, y la guarda de
   * que no queda ningún `"CÓDIGO: …"` fuera del catálogo —la parte de este test que valía para
   * todos los códigos y no solo para `E-REC-CAPACIDAD`— vive en `test/messages.test.ts`.
   */
  test('§ 17 recoge los dos textos de `E-REC-CAPACIDAD` que emite el motor', () => {
    const M = messages('es').codes;
    const textos = [
      coded('E-REC-CAPACIDAD', M['E-REC-CAPACIDAD/sin-tramos']('<pool>')),
      coded('E-REC-CAPACIDAD', M['E-REC-CAPACIDAD/entero']('<pool>')),
    ].sort();

    expect(textos).toEqual([
      'E-REC-CAPACIDAD: <pool>: capacity debe declarar al menos un tramo.',
      'E-REC-CAPACIDAD: <pool>: capacity debe ser un entero mayor o igual que 1.',
    ]);
    for (const texto of textos) expect(semantics).toContain(texto);
  });
});
