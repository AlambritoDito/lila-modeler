/**
 * QA of #599 (must-fix 1): renaming a calendar has to follow into the scenarios that `extends` the
 * renamed file, or a Duplicate's what-if hours stop applying (its KPIs change) and its own
 * references end in E-REF-DESCONOCIDA. Based on the QA's pencil test over `examples/pedido`: the
 * rename is applied exactly as `GestorCalendarios` does it (`renombrarCalendario` on the edited
 * file, `renombrarEnDescendiente` on every descendant) and the child is simulated before and after.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { simulate } from '@lila-modeler/engine';
import { resolveExtends, resolveScenarioPath } from '@lila-modeler/engine/schema';
import { describe, expect, it } from 'vitest';

import {
  cambiosDeDelta,
  descendientesDe,
  escribir,
  nombraCalendario,
  renombrarCalendario,
  renombrarEnDescendiente,
} from './escenarioModelo';
import { setLocale } from './i18n';
import { prepareSimulation } from './simulationGate';

setLocale('es');
type J = Record<string, unknown>;

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const xml = readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8');
const asis = JSON.parse(readFileSync(resolve(RAIZ, 'examples/pedido/as-is.scenario.json'), 'utf8')) as J;
const ASIS = 'as-is.scenario.json';
const TOBE = 'tobe.scenario.json';

/** What the manager does on Enter in the name field, for every file of the process. */
function renombrar(archivo: string, files: Record<string, J>, viejo: string, nuevo: string): Record<string, J> {
  const lector = (p: string): J => files[p]!;
  const delta = files[archivo]!;
  const ext = delta['extends'];
  const padre = typeof ext === 'string' ? resolveExtends(resolveScenarioPath(archivo, ext), lector) : null;
  const despues = renombrarCalendario(delta, resolveExtends(archivo, lector), padre, viejo, nuevo);
  let propio = delta;
  for (const { ruta, valor } of cambiosDeDelta(delta, despues)) propio = escribir(propio, ruta, valor);
  const salida: Record<string, J> = { ...files, [archivo]: propio };
  for (const hijo of descendientesDe(archivo, files)) salida[hijo] = renombrarEnDescendiente(files[hijo]!, viejo, nuevo);
  return salida;
}

async function kpis(file: string, files: Record<string, J>): Promise<unknown> {
  const prepared = await prepareSimulation(xml, file, files);
  const r = simulate(prepared.ir, { ...prepared.scenario, run: { ...prepared.scenario.run, replications: 3, seed: 42 } } as never, {
    log: false,
  });
  return JSON.parse(JSON.stringify((r as unknown as J)['kpis'] ?? r)) as unknown;
}

describe('descendants', () => {
  it('finds children and grandchildren, with extends relative to the child', () => {
    const files: Record<string, J> = {
      'a.scenario.json': {},
      'b.scenario.json': { extends: 'a.scenario.json' },
      'sub/c.scenario.json': { extends: '../b.scenario.json' },
      'd.scenario.json': {},
    };
    expect(descendientesDe('a.scenario.json', files)).toEqual(['b.scenario.json', 'sub/c.scenario.json']);
    expect(descendientesDe('d.scenario.json', files)).toEqual([]);
  });

  it('a descendant delta that does not name the calendar is returned as is', () => {
    const hijo: J = { version: 1, name: 'x', extends: ASIS, resources: { cajero: { capacity: 3 } } };
    expect(renombrarEnDescendiente(hijo, 'oficina', 'ofi2')).toBe(hijo);
    expect(nombraCalendario(hijo, 'oficina')).toBe(false);
    expect(nombraCalendario({ calendars: { oficina: null } }, 'oficina')).toBe(true);
  });
});

describe('rename in a parent with children (QA of #599)', () => {
  it('(a) a child that overrides the calendar keeps its what-if hours and its KPIs', async () => {
    const files: Record<string, J> = {
      [ASIS]: asis,
      [TOBE]: {
        version: 1,
        name: 'tobe',
        extends: ASIS,
        calendars: { oficina: { intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], from: '07:00', to: '20:00' }] } },
      },
    };
    const antes = await kpis(TOBE, files);
    const despues = renombrar(ASIS, files, 'oficina', 'ofi2');
    expect(despues[TOBE]!['calendars']).toEqual({
      ofi2: { intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], from: '07:00', to: '20:00' }] },
    });
    const hijo = resolveExtends(TOBE, (p) => despues[p]!);
    expect(Object.keys(hijo['calendars'] as J)).toEqual(['ofi2']);
    expect(await kpis(TOBE, despues)).toEqual(antes);
    // And the parent itself still simulates the same.
    expect(await kpis(ASIS, despues)).toEqual(await kpis(ASIS, files));
  });

  it('(b) a child with its own reference to the calendar still simulates', async () => {
    const files: Record<string, J> = {
      [ASIS]: asis,
      [TOBE]: { version: 1, name: 'tobe', extends: ASIS, resources: { nuevo: { capacity: 1, calendar: 'oficina' } } },
    };
    const antes = await kpis(TOBE, files);
    const despues = renombrar(ASIS, files, 'oficina', 'ofi2');
    expect(despues[TOBE]!['resources']).toEqual({ nuevo: { capacity: 1, calendar: 'ofi2' } });
    expect(await kpis(TOBE, despues)).toEqual(antes);
  });

  it('a child of a copy that renamed an inherited calendar follows too', async () => {
    const copia = 'copia.scenario.json';
    const files: Record<string, J> = {
      [ASIS]: asis,
      [copia]: { version: 1, name: 'copia', extends: ASIS },
      [TOBE]: { version: 1, name: 'tobe', extends: copia, elements: { StartEvent_Pedido: { calendar: 'oficina' } } },
    };
    const antes = await kpis(TOBE, files);
    const despues = renombrar(copia, files, 'oficina', 'ofi2');
    expect(despues[ASIS]).toBe(asis);
    expect(await kpis(TOBE, despues)).toEqual(antes);
  });
});
