import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  ScenarioSchema,
  resolveExtends,
  resolveScenarioPath,
  scenarioErrors,
  validateScenario,
  type ScenarioReader,
} from '../src/scenario.js';
import { AS_IS, TO_BE, clone, pedidoIr } from './pedido.fixtures.js';

/** FS en memoria: `resolveExtends` no toca disco, se le inyecta el lector. */
function reader(files: Record<string, unknown>): ScenarioReader {
  return (path) => {
    if (!(path in files)) throw new Error(`no existe ${path}`);
    return clone(files[path]);
  };
}

const repoRoot = new URL('../../../', import.meta.url);

/** Lector real sobre el repo: los escenarios del ejemplo existen desde LILA-008. */
const readFromRepo: ScenarioReader = (path) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, repoRoot)), 'utf8'));

const PEDIDO = {
  'examples/pedido/as-is.scenario.json': AS_IS,
  'examples/pedido/to-be-3-cajeros.scenario.json': { ...TO_BE, extends: 'as-is.scenario.json' },
};

describe('resolveExtends', () => {
  test('to-be-3-cajeros resuelve a un objeto igual al AS-IS salvo capacity = 3', () => {
    const read = readFromRepo;
    // Los dos pasan por la misma resolución, así que `model` queda normalizado igual en ambos.
    const asIs = resolveExtends('examples/pedido/as-is.scenario.json', read);
    const toBe = resolveExtends('examples/pedido/to-be-3-cajeros.scenario.json', read);

    const resources = asIs['resources'] as Record<string, Record<string, unknown>>;
    expect(toBe).toEqual({
      ...asIs,
      // Lo propio del delta: su nombre. `extends` ya está aplicado y no viaja al resuelto.
      name: 'TO-BE 3 cashiers',
      resources: { ...resources, cajero: { ...resources['cajero'], capacity: 3 } },
    });
    expect(toBe['extends']).toBeUndefined();
  });

  test('el resuelto valida como escenario completo', () => {
    const resolved = ScenarioSchema.parse(
      resolveExtends('examples/pedido/to-be-3-cajeros.scenario.json', readFromRepo),
    );
    expect(resolved.resources?.['cajero']?.capacity).toBe(3);
    expect(resolved.model).toBe('examples/pedido/model.bpmn');
    expect(scenarioErrors(validateScenario(resolved, pedidoIr()))).toEqual([]);
  });

  test('los fixtures inline de docs/SCENARIO_FORMAT.md no han derivado de examples/', () => {
    expect(readFromRepo('examples/pedido/as-is.scenario.json')).toEqual(AS_IS);
    expect(readFromRepo('examples/pedido/to-be-3-cajeros.scenario.json')).toEqual(
      PEDIDO['examples/pedido/to-be-3-cajeros.scenario.json'],
    );
  });

  test('un ciclo A -> B -> A produce error que cita los archivos', () => {
    const read = reader({
      'a.scenario.json': { version: 1, name: 'A', extends: 'b.scenario.json' },
      'b.scenario.json': { version: 1, name: 'B', extends: 'a.scenario.json' },
    });

    expect(() => resolveExtends('a.scenario.json', read)).toThrow(/ciclo/);
    expect(() => resolveExtends('a.scenario.json', read)).toThrow(
      'a.scenario.json -> b.scenario.json -> a.scenario.json',
    );
  });

  test('un archivo que se hereda a sí mismo también es ciclo', () => {
    const read = reader({ 'a.scenario.json': { version: 1, name: 'A', extends: 'a.scenario.json' } });
    expect(() => resolveExtends('a.scenario.json', read)).toThrow(/ciclo/);
  });

  test('cadenas de herencia: se resuelve de la raíz hacia abajo', () => {
    const read = reader({
      'c.json': { version: 1, name: 'C', model: 'model.bpmn', run: { start: '2026-09-07T08:00:00-06:00', duration: 60, seed: 1 } },
      'b.json': { version: 1, name: 'B', extends: 'c.json', run: { duration: 120 } },
      'a.json': { version: 1, name: 'A', extends: 'b.json', run: { seed: 7 } },
    });

    expect(resolveExtends('a.json', read)).toEqual({
      version: 1,
      name: 'A',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', duration: 120, seed: 7 },
    });
  });

  test('null borra la clave', () => {
    const read = reader({
      'padre.json': { version: 1, name: 'padre', resources: { cajero: { capacity: 2 }, horno: { capacity: 1 } } },
      'hijo.json': { version: 1, name: 'hijo', extends: 'padre.json', resources: { horno: null } },
    });

    const resolved = resolveExtends('hijo.json', read);
    expect(resolved['resources']).toEqual({ cajero: { capacity: 2 } });
  });

  test('los arrays se reemplazan enteros, no se fusionan', () => {
    const read = reader({
      'padre.json': {
        version: 1,
        name: 'padre',
        elements: { Task_1: { resources: [{ ref: 'cajero' }, { ref: 'cocinero' }] } },
        calendars: { oficina: { intervals: [{ days: ['MON'], from: '09:00', to: '18:00' }] } },
      },
      'hijo.json': {
        version: 1,
        name: 'hijo',
        extends: 'padre.json',
        elements: { Task_1: { resources: [{ ref: 'horno' }] } },
      },
    });

    const elements = resolveExtends('hijo.json', read)['elements'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(elements['Task_1']?.['resources']).toEqual([{ ref: 'horno' }]);
  });

  test('las rutas son relativas al archivo del hijo, no al directorio de trabajo', () => {
    const read = reader({
      'base/comun.scenario.json': { version: 1, name: 'común', model: '../modelos/model.bpmn', run: { start: '2026-09-07T08:00:00-06:00', duration: 60 } },
      'proyectos/uno/hijo.scenario.json': { version: 1, name: 'hijo', extends: '../../base/comun.scenario.json' },
    });

    const resolved = resolveExtends('proyectos/uno/hijo.scenario.json', read);
    // `model` estaba escrito en `base/`, así que se reescribe relativo a ese archivo.
    expect(resolved['model']).toBe('modelos/model.bpmn');
  });

  test('resolveScenarioPath normaliza `.` y `..` sobre el archivo base', () => {
    expect(resolveScenarioPath('examples/pedido/to-be.json', 'as-is.json')).toBe(
      'examples/pedido/as-is.json',
    );
    expect(resolveScenarioPath('examples/pedido/to-be.json', './as-is.json')).toBe(
      'examples/pedido/as-is.json',
    );
    expect(resolveScenarioPath('examples/pedido/to-be.json', '../base/comun.json')).toBe(
      'examples/base/comun.json',
    );
    expect(resolveScenarioPath('to-be.json', 'as-is.json')).toBe('as-is.json');
    expect(resolveScenarioPath('examples/pedido/to-be.json', '/abs/comun.json')).toBe(
      '/abs/comun.json',
    );
  });

  test('un padre que no existe propaga el error del lector', () => {
    const read = reader({ 'a.json': { version: 1, name: 'A', extends: 'no-esta.json' } });
    expect(() => resolveExtends('a.json', read)).toThrow(/no existe no-esta.json/);
  });
});
