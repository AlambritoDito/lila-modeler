/**
 * QA adversarial de `lila compare` (LILA-047), por un agente distinto al implementador.
 *
 * Los ataques van numerados como en el encargo: coherencia con `lila run` y trato de `calendars`,
 * formato (signo, guiones, `baseTimeUnit`, porcentajes), tres o más escenarios, errores de carga,
 * replicaciones sin IC95, semillas, `--json`, `--all`, robustez de la tabla, ayuda y calidad.
 */

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../src/cli.js';
import { formatDuration, formatNumber, formatSignedPercent } from '../src/format.js';

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

const LONG_ID = `Task_${'X'.repeat(48)}`;

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_CompareQa" exporter="Lila test" exporterVersion="1">
  <bpmn:process id="Process_CompareQa" name="Proceso compare QA" isExecutable="false">
    <bpmn:startEvent id="Start" name="Inicio" />
    <bpmn:task id="${LONG_ID}" name="Atención al público, sección ñandú — área común" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_Start_Task" sourceRef="Start" targetRef="${LONG_ID}" />
    <bpmn:sequenceFlow id="Flow_Task_End" sourceRef="${LONG_ID}" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

interface ScenarioOverrides {
  readonly name?: string;
  readonly capacity?: number;
  readonly seed?: number;
  readonly replications?: number;
  readonly baseTimeUnit?: string;
  readonly withCalendar?: boolean;
  readonly withoutResources?: boolean;
}

let root: string;
let model: string;
let output: string[];

/** Escenario mínimo pero con cola real: 12 llegadas cada 30 s y una tarea de 60 s. */
function writeScenario(file: string, overrides: ScenarioOverrides = {}): string {
  const path = join(root, file);
  const capacity = overrides.capacity ?? 1;
  const calendars = overrides.withCalendar === true
    ? { calendars: { oficina: { intervals: [{ days: ['MON'], from: '09:00', to: '18:00' }] } } }
    : {};
  const resources = overrides.withoutResources === true
    ? {}
    : {
        resources: {
          agente: {
            name: 'Agente de mostrador',
            capacity,
            costPerHour: 120,
            ...(overrides.withCalendar === true ? { calendar: 'oficina' } : {}),
          },
        },
      };
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      name: overrides.name ?? file.replace('.scenario.json', ''),
      model: 'model.bpmn',
      run: {
        start: '2026-09-07T08:00:00-06:00',
        seed: overrides.seed ?? 7,
        replications: overrides.replications ?? 3,
        baseTimeUnit: overrides.baseTimeUnit ?? 'min',
      },
      ...calendars,
      ...resources,
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 30 }, triggerCount: 12 },
        [LONG_ID]: {
          processingTime: { type: 'constant', value: 60 },
          ...(overrides.withoutResources === true ? {} : { resources: [{ ref: 'agente' }] }),
        },
      },
    }),
    'utf8',
  );
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lila-cli-compare-qa-'));
  model = join(root, 'model.bpmn');
  writeFileSync(model, MODEL_XML, 'utf8');
  output = [];
  const capture = (...args: unknown[]) => void output.push(args.join(' '));
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function text(): string {
  return output.join('\n');
}

/** Las líneas de una tabla (título, cabecera, guiones y filas) hasta la primera línea en blanco. */
function tableBlock(all: string, title: string): string[] {
  const lines = all.split('\n');
  const start = lines.indexOf(title);
  expect(start, `no aparece la tabla ${title} en:\n${all}`).toBeGreaterThanOrEqual(0);
  const block: string[] = [];
  for (let index = start + 1; index < lines.length && lines[index] !== ''; index++) {
    block.push(lines[index]!);
  }
  return block;
}

function rowLine(all: string, needle: string, metricLabel: string): string {
  const line = all.split('\n').find((candidate) => candidate.includes(needle) && candidate.includes(metricLabel));
  expect(line, `sin fila ${needle} / ${metricLabel} en:\n${all}`).toBeDefined();
  return line!;
}

describe('QA LILA-047 · ataque 1: coherencia con `lila run` y trato de los calendarios', () => {
  test('`lila run` y `lila compare` aceptan el mismo escenario con recursos (LILA-184)', async () => {
    const a = writeScenario('a.scenario.json', { capacity: 1 });
    const b = writeScenario('b.scenario.json', { capacity: 3 });

    // Antes de LILA-184, `run` rechazaba con E-NIVEL-M2 lo que `compare` ya simulaba: la
    // incoherencia que fijaba este test. Ahora ambos aceptan el mismo escenario e imprimen la
    // misma tabla de recursos.
    expect(await main(['run', model, a])).toBe(0);
    expect(tableBlock(text(), 'Resources')[0]).toContain('Utilization (%)');
    const runRow = rowLine(text(), 'agente', 'Agente de mostrador').split(/ {2,}/);

    output = [];
    expect(await main(['compare', model, a, b])).toBe(0);
    const compareRow = rowLine(text(), 'agente', 'Utilization (%)').split(/ {2,}/);

    // Coherencia de verdad: los dos comandos imprimen el mismo pool con el mismo número, no solo
    // una tabla con el mismo título. `compare` marca el porcentaje en la celda; `run`, en la
    // cabecera de columna.
    expect(compareRow[3]).toBe(`${runRow[2]}%`);
  });

  // Invertida por LILA-041: hasta M3 esta prueba anclaba que el motor **ignoraba** los
  // calendarios; ahora los simula y el ataque consiste en comprobar que de verdad mueven los
  // números que tienen que moverse.
  test('los `calendars` declarados sí mueven los números: el motor los simula (LILA-041)', async () => {
    const sinCalendario = writeScenario('sin.scenario.json', { name: 'Sin calendario', capacity: 1 });
    const conCalendario = writeScenario('con.scenario.json', {
      name: 'Con calendario',
      capacity: 1,
      withCalendar: true,
    });

    expect(await main(['compare', model, sinCalendario, conCalendario])).toBe(0);
    const all = text();

    // Calendario L 09:00–18:00 y run.start un lunes a las 08:00: las 12 llegadas caen entre las
    // 08:00 y las 08:05:30 y ninguna puede arrancar antes de las 09:00, así que la cola pasa a
    // servirse en bloque. La espera abierta media sube de 30·5,5 s a 60·5,5 s (R-REC-8/R-CAL-7).
    expect(rowLine(all, LONG_ID, 'Average time (waiting for resource)')).toContain('2.75');
    expect(rowLine(all, LONG_ID, 'Average time (waiting for resource)')).toContain('5.5 (+100%)');
    // El tiempo de proceso no se mueve: 60 s abiertos siguen siendo 60 s (R-CAL-5).
    expect(rowLine(all, LONG_ID, 'Average time  ')).toMatch(/\(0%\)/);
  });

  test('los avisos de modelo y escenario de `lila run` no se pierden en `lila compare`', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', withoutResources: true });
    const b = writeScenario('b.scenario.json', { name: 'B', withoutResources: true });
    // Sin la tarea en `elements` no hay processingTime (W-TAREA-SIN-TIEMPO) y quedan dos elementos
    // del modelo sin parámetros (W-ELEMENTO-SIN-PARAMETROS dos veces, con textos distintos).
    const raw = JSON.parse(readFileSync(a, 'utf8')) as { elements: Record<string, unknown> };
    delete raw.elements[LONG_ID];
    writeFileSync(a, JSON.stringify(raw), 'utf8');

    expect(await main(['compare', model, a, b])).toBe(0);
    const all = text();
    expect(all).toContain('Avisos:');
    expect(all).toContain('"A" W-TAREA-SIN-TIEMPO');

    // Compare es una vista de resumen: una línea por código y escenario, diciendo cuántas más hubo.
    const sinTiempo = all.split('\n').filter((line) => line.includes('W-TAREA-SIN-TIEMPO'));
    expect(sinTiempo).toHaveLength(1);
    const sinParametros = all.split('\n').filter((line) => line.includes('W-ELEMENTO-SIN-PARAMETROS'));
    expect(sinParametros).toHaveLength(2);
    expect(sinParametros.find((line) => line.includes('"A"'))).toContain('+1 aviso más con el mismo código');
  });
});

describe('QA LILA-047 · ataque 2: formato de valores y deltas', () => {
  test('formatSignedPercent nunca imprime "-0%" ni "-0.00"', () => {
    expect(formatSignedPercent(-1e-11)).toBe('0%');
    expect(formatSignedPercent(-0)).toBe('0%');
    expect(formatSignedPercent(0)).toBe('0%');
    expect(formatSignedPercent(-1e-9)).toBe('0%');
    expect(formatSignedPercent(-0.853343)).toBe('-85.3343%');
    expect(formatSignedPercent(0.915272)).toBe('+91.5272%');
    // Y no aparece un cero con signo por ninguna otra vía de formato.
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-1e-9)).toBe('0');
  });

  test('KPI ausente ⇒ guion; base 0 ⇒ guion en el relativo, con los dos valores absolutos a la vista', async () => {
    const sinPool = writeScenario('sin.scenario.json', { name: 'Sin pool', withoutResources: true });
    const conPool = writeScenario('con.scenario.json', { name: 'Con pool', capacity: 1 });

    expect(await main(['compare', model, sinPool, conPool])).toBe(0);
    const all = text();

    // El pool `agente` no existe en la base: valor `-` y ningún delta inventado.
    expect(rowLine(all, 'agente', 'Utilization (%)')).toMatch(/Utilization \(%\)\s+-\s/);
    // Base 0 (espera de recurso del escenario sin pool): relativo indefinido ⇒ guion, nunca ±Infinity.
    const espera = rowLine(all, LONG_ID, 'Average time (waiting for resource)');
    expect(espera).toMatch(/\(-\)/);
    expect(all).not.toContain('Infinity');
    expect(all).not.toContain('NaN');
  });

  test('baseTimeUnit escala los tiempos y no toca costos ni porcentajes, y la unidad se imprime', async () => {
    const enMinutos = writeScenario('min.scenario.json', { name: 'Min', baseTimeUnit: 'min' });
    const enSegundos = writeScenario('s.scenario.json', { name: 'Seg', baseTimeUnit: 's' });

    expect(await main(['compare', model, enMinutos, enSegundos, '--all'])).toBe(0);
    const conBaseMin = text();
    output = [];
    expect(await main(['compare', model, enSegundos, enMinutos, '--all'])).toBe(0);
    const conBaseSeg = text();

    expect(conBaseMin).toContain('Unidad de tiempo min');
    expect(conBaseSeg).toContain('Unidad de tiempo s');
    // La unidad la fija el escenario base, y cuando difieren se avisa.
    expect(conBaseMin).toContain('no comparten baseTimeUnit');

    const cell = (all: string, metric: string): number =>
      Number(rowLine(all, LONG_ID, metric).trim().split(/\s{2,}/).at(-2)!.replace(/[()%*+]/g, ''));

    // Tiempo: 60 s de proceso ⇒ 1 en minutos, 60 en segundos.
    expect(cell(conBaseMin, 'Average time')).toBeCloseTo(1, 9);
    expect(cell(conBaseSeg, 'Average time')).toBeCloseTo(60, 9);
    // Costo fijo: mismo número en las dos unidades (no es un tiempo).
    expect(cell(conBaseMin, 'Total fixed cost')).toBe(cell(conBaseSeg, 'Total fixed cost'));
    // Utilización: porcentaje, idéntico con cualquier baseTimeUnit.
    const utilizacion = (all: string): string => rowLine(all, 'agente', 'Utilization (%)');
    expect(utilizacion(conBaseMin).includes('%')).toBe(true);
    expect(utilizacion(conBaseMin).replace(/Min|Seg/g, '')).toBe(utilizacion(conBaseSeg).replace(/Min|Seg/g, ''));
  });

  test('`busyTime` es una duración y se convierte como las demás (antes salía en segundos crudos)', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', baseTimeUnit: 'min' });
    const b = writeScenario('b.scenario.json', { name: 'B', baseTimeUnit: 'min', capacity: 3 });

    expect(await main(['compare', model, a, b, '--all'])).toBe(0);
    const all = text();
    const busy = rowLine(all, 'agente', 'Busy time');
    const unitCost = rowLine(all, 'agente', 'Unit cost');

    // 12 tareas × 60 s = 720 s = 12 min ocupados; unitCost = 120 $/h × 720/3600 = 24.
    expect(busy).toContain(formatDuration(720, 'min'));
    expect(busy).not.toContain('720');
    expect(unitCost).toContain('24');
  });

  test('los números usan el mismo formateo que `lila run` (mismos decimales, sin locale)', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', withoutResources: true });
    const b = writeScenario('b.scenario.json', { name: 'B', withoutResources: true });

    expect(await main(['compare', model, a, b])).toBe(0);
    // `run` y `compare` comparten formatDuration/formatNumber: 60 s en minutos es "1", no "1.00".
    expect(rowLine(text(), LONG_ID, 'Average time')).toContain(` ${formatDuration(60, 'min')} `);
    expect(formatDuration(60, 'min')).toBe('1');
  });
});

describe('QA LILA-047 · ataque 3: tres o más escenarios', () => {
  test('orden de columnas = orden de argumentos, `*` por columna y anchuras estables', async () => {
    const a = writeScenario('a.scenario.json', { name: 'Uno', capacity: 1 });
    const b = writeScenario('b.scenario.json', { name: 'Dos', capacity: 6 });
    const c = writeScenario('c.scenario.json', { name: 'Tres', capacity: 12 });

    // Orden a propósito distinto del alfabético y del de capacidad.
    expect(await main(['compare', model, a, c, b])).toBe(0);
    const all = text();

    const header = tableBlock(all, 'Process elements')[0]!;
    expect(header.indexOf('Uno (base)')).toBeLessThan(header.indexOf('Tres'));
    expect(header.indexOf('Tres')).toBeLessThan(header.indexOf('Dos'));

    // La base con capacidad 1 hace cola; con 6 y con 12 no, y las dos columnas se marcan aparte.
    const espera = rowLine(all, LONG_ID, 'Average time (waiting for resource)');
    expect(espera.match(/\*/g)?.length).toBe(2);

    for (const title of ['Escenarios comparados', 'Process elements', 'Resources', 'Process']) {
      const block = tableBlock(all, title);
      const separator = block[1]!;
      const gaps = [...separator.matchAll(/ {2}/g)].map((match) => match.index);
      for (const line of block) {
        for (const gap of gaps) {
          if (line.length <= gap + 1) continue;
          expect(line.slice(gap, gap + 2), `${title}: columna desalineada en «${line}»`).toBe('  ');
        }
      }
    }
  });
});

describe('QA LILA-047 · ataque 4: carga de modelo y escenarios', () => {
  test('un escenario inválido en el segundo argumento aborta con su nombre, exit 1 y sin tabla', async () => {
    const a = writeScenario('a.scenario.json');
    const roto = join(root, 'roto.scenario.json');
    writeFileSync(
      roto,
      JSON.stringify({
        version: 1,
        name: 'Roto',
        model: 'model.bpmn',
        run: { start: '2026-09-07T08:00:00-06:00', duration: 60 },
        elements: { NoExiste: { processingTime: { type: 'constant', value: 1 } } },
      }),
      'utf8',
    );

    expect(await main(['compare', model, a, roto])).toBe(1);
    const all = text();
    expect(all).toContain('roto.scenario.json');
    expect(all).toContain('E-ELEMENTO-DESCONOCIDO');
    expect(all).not.toContain('Process elements');
    expect(all).not.toContain('Escenarios comparados');
  });

  test('un escenario con JSON inválido cita el archivo y no imprime tabla parcial', async () => {
    const a = writeScenario('a.scenario.json');
    const invalido = join(root, 'malo.scenario.json');
    writeFileSync(invalido, '{ "version": 1, ', 'utf8');

    expect(await main(['compare', model, a, invalido])).toBe(1);
    expect(text()).toContain('malo.scenario.json');
    expect(text()).not.toContain('Escenarios comparados');
  });

  test('`model` distinto del bpmn posicional se rechaza citando el archivo del escenario', async () => {
    const a = writeScenario('a.scenario.json');
    const otro = join(root, 'otro.scenario.json');
    writeFileSync(
      otro,
      JSON.stringify({
        version: 1,
        name: 'Otro modelo',
        model: 'otro.bpmn',
        run: { start: '2026-09-07T08:00:00-06:00', duration: 60 },
      }),
      'utf8',
    );

    expect(await main(['compare', model, a, otro])).toBe(1);
    expect(text()).toContain('no coincide con scenario.model');
    expect(text()).toContain('otro.scenario.json');
  });

  test('un modelo con errores de validación aborta antes de simular nada', async () => {
    const invalido = join(root, 'boundary.bpmn');
    writeFileSync(
      invalido,
      `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="T" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T" />
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
      'utf8',
    );
    const a = writeScenario('a.scenario.json');

    expect(await main(['compare', invalido, a, a])).toBe(1);
    expect(text()).not.toContain('Escenarios comparados');
  });
});

describe('QA LILA-047 · ataque 5: replicaciones sin IC95', () => {
  test('--replications 1 avisa y deja la tabla sin ninguna marca de significancia', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', capacity: 1 });
    const b = writeScenario('b.scenario.json', { name: 'B', capacity: 4 });

    expect(await main(['compare', model, a, b, '--replications', '1'])).toBe(0);
    const all = text();
    expect(all).toContain('sin IC95 no hay marca de significancia posible');
    expect(all).toContain('"A"');
    expect(all).toContain('"B"');
    expect(all).not.toContain('%)*');
    expect(all).not.toContain('-)*');
  });

  test('un escenario que declara replications 1 sin flag recibe el mismo aviso', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', capacity: 1, replications: 1 });
    const b = writeScenario('b.scenario.json', { name: 'B', capacity: 4, replications: 3 });

    expect(await main(['compare', model, a, b])).toBe(0);
    const all = text();
    expect(all).toContain('"A" corrió sin al menos dos replicaciones completas');
    expect(all).not.toContain('"B" corrió sin');
    // Sin IC95 en la base no hay significancia posible para ninguna columna.
    expect(all).not.toContain('%)*');
  });
});

describe('QA LILA-047 · ataque 6: semillas y `extends`', () => {
  test('--seed se aplica a todos los escenarios y la salida es determinista', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', seed: 11, capacity: 1 });
    const b = writeScenario('b.scenario.json', { name: 'B', seed: 999, capacity: 2 });
    const args = ['compare', model, a, b, '--seed', '123'];

    expect(await main(args)).toBe(0);
    const first = text();
    output = [];
    expect(await main(args)).toBe(0);
    expect(text()).toBe(first);

    const semillas = tableBlock(first, 'Escenarios comparados').slice(2);
    for (const line of semillas) expect(line).toMatch(/\s123\s/);
    expect(first).not.toContain('semillas distintas');
  });

  test('sin --seed cada escenario usa la suya, se muestran y se avisa de la pérdida de R-DET-3', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', seed: 11 });
    const b = writeScenario('b.scenario.json', { name: 'B', seed: 999 });

    expect(await main(['compare', model, a, b])).toBe(0);
    const all = text();
    expect(all).toMatch(/\s11\s/);
    expect(all).toMatch(/\s999\s/);
    expect(all).toContain('semillas distintas');
    expect(all).toContain('R-DET-3');
  });

  test('un escenario con `extends` resuelve y hereda modelo, run y elementos del padre', async () => {
    const padre = writeScenario('padre.scenario.json', { name: 'Padre', capacity: 1 });
    const hijo = join(root, 'hijo.scenario.json');
    writeFileSync(
      hijo,
      JSON.stringify({
        version: 1,
        name: 'Hijo por extends',
        extends: 'padre.scenario.json',
        resources: { agente: { capacity: 6 } },
      }),
      'utf8',
    );

    expect(await main(['compare', model, padre, hijo])).toBe(0);
    const all = text();
    expect(all).toContain('Hijo por extends');
    // Heredó el pool y solo cambió la capacidad: la espera cae de forma significativa.
    expect(rowLine(all, LONG_ID, 'Average time (waiting for resource)')).toMatch(/\(-\d[\d.]*%\)\*/);
  });
});

describe('QA LILA-047 · ataque 7: --json', () => {
  test('escribe exactamente el CompareResult y dos corridas dan bytes idénticos', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', capacity: 1 });
    const b = writeScenario('b.scenario.json', { name: 'B', capacity: 2 });
    const c = writeScenario('c.scenario.json', { name: 'C', capacity: 3 });
    const first = join(root, 'out', 'first.json');
    const second = join(root, 'out', 'second.json');
    const args = ['compare', model, a, b, c];

    expect(await main([...args, '--json', first])).toBe(0);
    expect(await main([...args, '--json', second])).toBe(0);
    expect(readFileSync(first)).toEqual(readFileSync(second));

    const parsed = JSON.parse(readFileSync(first, 'utf8')) as {
      count: number;
      rows: Array<Record<string, unknown>>;
    };
    // Ni una clave de más ni de menos respecto de RESULTS_FORMAT §11.
    expect(Object.keys(parsed).sort()).toEqual(['count', 'rows']);
    expect(parsed.count).toBe(3);
    expect(Object.keys(parsed.rows[0]!).sort()).toEqual([
      'base',
      'deltaAbs',
      'deltaRel',
      'id',
      'kpi',
      'metric',
      'scope',
      'significant',
      'values',
    ]);
    for (const row of parsed.rows) {
      expect((row.values as unknown[]).length).toBe(3);
      expect((row.significant as boolean[])[0]).toBe(false);
    }
    // El JSON no lleva nada de presentación: sigue en segundos y en fracción, no en min ni en %.
    const utilization = parsed.rows.find((row) => row.kpi === 'resources.agente.utilization');
    expect(utilization).toBeDefined();
    expect((utilization!.values as number[])[0]).toBeLessThanOrEqual(1);
  });
});

describe('QA LILA-047 · ataque 8: --all y la lista curada', () => {
  test('cada métrica de la lista curada existe de verdad y `--all` es un superconjunto', async () => {
    const a = writeScenario('a.scenario.json', { name: 'A', capacity: 1 });
    const b = writeScenario('b.scenario.json', { name: 'B', capacity: 2 });

    expect(await main(['compare', model, a, b])).toBe(0);
    const curada = text();
    output = [];
    expect(await main(['compare', model, a, b, '--all'])).toBe(0);
    const todas = text();

    // Nombres de columna de RESULTS_FORMAT §10 en la vista por defecto.
    for (const label of [
      'Instances started',
      'Instances completed',
      'Average time',
      'Average time (waiting for resource)',
      'Utilization (%)',
      'Total cost',
    ]) {
      expect(curada, `falta la fila ${label}`).toContain(label);
    }
    // Y los KPI que Bizagi no tiene conservan su path interno, sin inventarles nombre.
    expect(curada).toContain('queueLength.mean');
    expect(curada).toContain('cycleTime.mean');

    // La curada no trae flujos ni percentiles; `--all` sí, y no pierde ninguna fila de la curada.
    expect(curada).not.toContain('Sequence flows');
    expect(curada).not.toContain('cycleTime.p95');
    expect(todas).toContain('Sequence flows');
    expect(todas).toContain('cycleTime.p95');
    expect(todas).toContain('Instances/Tokens completed');
    for (const label of ['Minimum time', 'Maximum time', 'Total time', 'Fixed cost', 'Unit cost']) {
      expect(todas, `--all debería traer ${label}`).toContain(label);
    }
  });
});

describe('QA LILA-047 · ataque 9: robustez de la tabla', () => {
  test('ids largos, nombres con espacios y acentos no desbordan ni rompen la alineación', async () => {
    const a = writeScenario('a.scenario.json', { name: 'Escenario base con nombre larguísimo y ñ', capacity: 1 });
    const b = writeScenario('b.scenario.json', { name: 'Ç', capacity: 4 });

    expect(await main(['compare', model, a, b])).toBe(0);
    const all = text();

    expect(all).toContain(LONG_ID);
    expect(all).toContain('Atención al público, sección ñandú — área común');
    expect(all).toContain('Agente de mostrador');

    const block = tableBlock(all, 'Process elements');
    const separator = block[1]!;
    // La cabecera y todas las filas caben en el ancho que anuncian los guiones.
    for (const line of block) expect(line.length).toBeLessThanOrEqual(separator.length);
    // Y el id largo no queda pegado a la columna siguiente.
    expect(rowLine(all, LONG_ID, 'Instances started')).toContain(`${LONG_ID}  `);
  });

  test('el nombre de un pool que solo existe en el escenario no base también se resuelve', async () => {
    const sinPool = writeScenario('sin.scenario.json', { name: 'Sin pool', withoutResources: true });
    const conPool = writeScenario('con.scenario.json', { name: 'Con pool', capacity: 1 });

    expect(await main(['compare', model, sinPool, conPool])).toBe(0);
    expect(rowLine(text(), 'agente', 'Utilization (%)')).toContain('Agente de mostrador');
  });
});

describe('QA LILA-047 · ataque 10: ayuda y argumentos', () => {
  test('la ayuda documenta compare y `lila` sin argumentos sale con 1', async () => {
    expect(await main([])).toBe(1);
    expect(text()).toContain('lila compare');

    output = [];
    expect(await main(['--help'])).toBe(0);
    expect(text()).toContain('lila compare');
    expect(text()).toContain('--all');

    output = [];
    expect(await main(['compare', '--help'])).toBe(0);
    expect(text()).toContain('Opciones de compare');
  });

  test('un solo escenario, o ninguno, es un error claro con exit 1', async () => {
    const a = writeScenario('a.scenario.json');
    for (const args of [['compare'], ['compare', model], ['compare', model, a]]) {
      output = [];
      expect(await main(args)).toBe(1);
      expect(text()).toContain('al menos dos escenarios');
    }
  });

  test('--replications 0 y --seed no entero se rechazan antes de simular', async () => {
    const a = writeScenario('a.scenario.json');
    const b = writeScenario('b.scenario.json');

    expect(await main(['compare', model, a, b, '--replications', '0'])).toBe(1);
    expect(text()).toContain('--replications requiere un entero >= 1');

    output = [];
    expect(await main(['compare', model, a, b, '--seed', 'x'])).toBe(1);
    expect(text()).toContain('--seed requiere un entero');
    expect(text()).not.toContain('Escenarios comparados');
  });
});

describe('QA LILA-047 · ataque 11: calidad del código', () => {
  test('cli.ts y format.ts no usan `any` ni dejan a compare duplicando la carga del modelo', () => {
    const cli = readFileSync(join(sourceDir, 'cli.ts'), 'utf8');
    // LILA-054: `loadValidatedModel` se extrajo de `cli.ts` a `cli-shared.ts` para que
    // `@lila/mcp` (`run_simulation`/`compare_scenarios`) también lo use, sin duplicarlo.
    const cliShared = readFileSync(join(sourceDir, 'cli-shared.ts'), 'utf8');
    const format = readFileSync(join(sourceDir, 'format.ts'), 'utf8');

    for (const [name, source] of [['cli.ts', cli], ['format.ts', format]] as const) {
      expect(source, `${name} usa any`).not.toMatch(/[:<]\s*any\b/);
      expect(source, `${name} usa as any`).not.toMatch(/\bas any\b/);
    }

    // `compare` reutiliza el parseo y la validación del modelo de `run` (loadValidatedModel).
    const compareSource = cli.slice(cli.indexOf('async function compareCommand('));
    expect(compareSource).not.toContain('parseBpmn(');
    expect(compareSource).toContain('loadValidatedModel(');
    expect(cli).not.toContain('function loadValidatedModel(');
    expect(cliShared.match(/export async function loadValidatedModel\(/g)?.length).toBe(1);
  });
});
