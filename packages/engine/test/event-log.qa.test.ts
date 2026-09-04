/**
 * QA adversarial de LILA-037 (#37), por un agente distinto del que implementó el ticket.
 *
 * Cubre lo que `event-log.test.ts` deja fuera: warmup > 0 con varias replicaciones, cancelación a
 * mitad en los dos modos con filas, equivalencia byte a byte del `--json` con y sin `--csv`,
 * serialización numérica idéntica a `JSON.stringify`, estabilidad de las columnas ISO frente a
 * offsets equivalentes, y el sink cuando la corrida falla después de haber vaciado el búfer.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../src/cli.js';
import { simulate } from '../src/core/run.js';
import type { EventLogRow } from '../src/core/result.js';
import { eventLogRowCsv, runStartMs } from '../src/csv.js';
import { eventLogRowSchema, runResultSchema } from '../src/result.schema.js';

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" exporter="lila qa" exporterVersion="1">
  <bpmn:process id="P" name="Lineal" isExecutable="false">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="T" name="Atender" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T" />
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

/** IR equivalente al XML anterior, para atacar `simulate` sin pasar por el parser. */
const IR = {
  id: 'P',
  name: '',
  source: { exporter: '', exporterVersion: '' },
  nodes: {
    Start: { type: 'start' as const, name: '', incoming: [], outgoing: ['F1'] },
    T: { type: 'task' as const, name: '', incoming: ['F1'], outgoing: ['F2'] },
    End: { type: 'end' as const, name: '', incoming: ['F2'], outgoing: [] },
  },
  flows: {
    F1: { name: '', from: 'Start', to: 'T', isDefault: false },
    F2: { name: '', from: 'T', to: 'End', isDefault: false },
  },
} as unknown as Parameters<typeof simulate>[0];

/** `warmup` y `replications` explícitos: el conteo de filas no debe depender de ninguno. */
function simScenario(overrides: Record<string, unknown> = {}, triggerCount = 6) {
  return {
    run: { seed: 42, replications: 3, warmup: 25, ...overrides },
    elements: {
      Start: { interTriggerTimer: { type: 'constant' as const, value: 10 }, triggerCount },
      T: { processingTime: { type: 'constant' as const, value: 5 }, fixedCost: 2 },
    },
  } as unknown as Parameters<typeof simulate>[1];
}

interface Fixture {
  root: string;
  model: string;
  scenario: string;
}

function createFixture(triggerCount = 6, run: Record<string, unknown> = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'lila-event-log-qa-'));
  const model = join(root, 'model.bpmn');
  const scenario = join(root, 'scenario.json');
  writeFileSync(model, MODEL_XML, 'utf8');
  writeFileSync(
    scenario,
    JSON.stringify({
      version: 1,
      name: 'QA event log',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', seed: 42, replications: 3, warmup: 25, ...run },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount },
        T: { processingTime: { type: 'constant', value: 5 }, fixedCost: 2 },
      },
    }),
    'utf8',
  );
  return { root, model, scenario };
}

let fixture: Fixture | undefined;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (fixture !== undefined) rmSync(fixture.root, { recursive: true, force: true });
  fixture = undefined;
});

describe('QA LILA-037 · conteo de filas con warmup y replicaciones', () => {
  test('las filas pre-warmup llegan al CSV y los tres modos cuentan lo mismo', async () => {
    fixture = createFixture();
    const directory = join(fixture.root, 'out');
    expect(await main(['run', fixture.model, fixture.scenario, '--csv', directory])).toBe(0);

    const retained = simulate(IR, simScenario());
    const streamed: EventLogRow[] = [];
    simulate(IR, simScenario(), { onEvent: (row) => streamed.push(row) });

    const lines = readFileSync(join(directory, 'log.csv'), 'utf8').split('\r\n');
    // Encabezado + filas + el vacío que deja el CRLF final.
    const csvRows = lines.length - 2;

    expect(retained.log).toHaveLength(3 * 6);
    expect(streamed).toHaveLength(retained.log?.length ?? 0);
    expect(csvRows).toBe(retained.log?.length ?? 0);

    // R-ARR-7 y § 8: el warmup excluye cohortes de las métricas, no filas del log.
    const preWarmup = lines.slice(1, -1).filter((line) => Number(line.split(',')[8]) < 25);
    expect(preWarmup.length).toBeGreaterThan(0);
    expect(retained.log?.filter((row) => row.enabledAt < 25).length).toBe(preWarmup.length);
    // Y las tres replicaciones aparecen enteras, en orden.
    expect(lines.slice(1, -1).map((line) => line.split(',')[0])).toEqual(
      [...Array(3).keys()].flatMap((replication) => Array(6).fill(String(replication))),
    );
  });
});

describe('QA LILA-037 · cancelación a mitad', () => {
  test('la réplica parcial entra en result.log y en el stream con las mismas filas', () => {
    const cut = (): { rows: EventLogRow[]; signal: { aborted: boolean }; trip: () => void } => {
      const signal = { aborted: false };
      let steps = 0;
      return { rows: [], signal, trip: () => { if (++steps === 3) signal.aborted = true; } };
    };

    const retainedCut = cut();
    const retained = simulate(IR, simScenario({ duration: 1_000 }), {
      signal: retainedCut.signal,
      onProgress: retainedCut.trip,
    });
    const streamCut = cut();
    const streaming = simulate(IR, simScenario({ duration: 1_000 }), {
      signal: streamCut.signal,
      onEvent: (row) => streamCut.rows.push(row),
      onProgress: streamCut.trip,
    });

    expect(retained.cancelled).toBe(true);
    expect(streaming.cancelled).toBe(true);
    expect(retained.completedReplications).toBe(streaming.completedReplications);
    // El modo retenido conserva las filas de la réplica parcial (§ 7); el streaming las entregó.
    expect((retained.log ?? []).length).toBeGreaterThan(0);
    expect(streamCut.rows).toEqual(retained.log);
    expect('log' in streaming).toBe(false);
    for (const row of retained.log ?? []) expect(eventLogRowSchema.safeParse(row).success).toBe(true);
  });
});

describe('QA LILA-037 · --csv no mueve el RunResult', () => {
  test('el --json es byte-idéntico con y sin --csv y nunca lleva la clave log', async () => {
    fixture = createFixture();
    const alone = join(fixture.root, 'alone.json');
    const withCsv = join(fixture.root, 'with-csv.json');

    expect(await main(['run', fixture.model, fixture.scenario, '--json', alone])).toBe(0);
    expect(
      await main([
        'run',
        fixture.model,
        fixture.scenario,
        '--json',
        withCsv,
        '--csv',
        join(fixture.root, 'out'),
      ]),
    ).toBe(0);

    expect(readFileSync(withCsv)).toEqual(readFileSync(alone));
    const parsed = JSON.parse(readFileSync(alone, 'utf8')) as Record<string, unknown>;
    expect('log' in parsed).toBe(false);
    expect(runResultSchema.safeParse(parsed).success).toBe(true);
  });

  test('runResultSchema valida el log retenido y rechaza una fila incoherente', () => {
    const retained = simulate(IR, simScenario());
    expect(runResultSchema.safeParse(retained).success).toBe(true);

    const broken = {
      ...retained,
      // `cost` deja de ser `elementCost + resourceCost`: la fila debe hacer fallar el resultado.
      log: [{ ...(retained.log ?? [])[0]!, cost: 999 }],
    };
    expect(runResultSchema.safeParse(broken).success).toBe(false);
  });
});

describe('QA LILA-037 · serialización determinista de log.csv', () => {
  const base: EventLogRow = {
    replication: 0,
    caseId: '1',
    activityInstanceId: 'a1',
    elementId: 'T',
    resourceId: null,
    allocationIndex: null,
    resourceQuantity: null,
    status: 'completed',
    enabledAt: 0,
    startedAt: 0,
    endedAt: 0,
    observedUntil: 0,
    resourceWait: 0,
    offHoursWait: 0,
    elementCost: 0,
    resourceCost: 0,
    cost: 0,
  };

  test('cada número se escribe igual que JSON.stringify (R-DET-6)', () => {
    // -0, subnormales de presentación, notación exponencial y enteros por encima de 2^53.
    for (const value of [-0, 1e-7, 1e21, 0.1 + 0.2, 9_007_199_254_740_993, 1e-320]) {
      const cell = eventLogRowCsv({ ...base, enabledAt: value }).split(',')[8];
      expect(cell, String(value)).toBe(JSON.stringify(value));
    }
  });

  test('las columnas ISO son UTC estable: offsets equivalentes dan el mismo instante', () => {
    const offsets = ['2026-09-07T08:00:00-06:00', '2026-09-07T14:00:00Z', '2026-09-07T16:00:00+02:00'];
    const rendered = offsets.map((start) =>
      eventLogRowCsv({ ...base, enabledAt: 1.5 }, runStartMs(start)).trimEnd().split(',').slice(-3),
    );
    expect(rendered[0]).toEqual(['2026-09-07T14:00:01.500Z', '2026-09-07T14:00:00.000Z', '2026-09-07T14:00:00.000Z']);
    expect(rendered[1]).toEqual(rendered[0]);
    expect(rendered[2]).toEqual(rendered[0]);
  });

  test('un run.start con fracción de segundo se redondea al milisegundo, no se trunca', () => {
    const startMs = runStartMs('2026-09-07T08:00:00.5-06:00');
    const cells = eventLogRowCsv({ ...base, enabledAt: 0.0005 }, startMs).trimEnd().split(',');
    expect(cells.at(-3)).toBe('2026-09-07T14:00:00.501Z');
    // El valor autoritativo sigue siendo el segundo relativo, sin pérdida.
    expect(cells[8]).toBe('0.0005');
  });
});

describe('QA LILA-037 · el sink no publica nada si la corrida falla tras vaciar el búfer', () => {
  test('un conflicto en otro CSV deja el directorio sin log.csv ni temporales', async () => {
    // 3 × 6 000 filas ≈ 1,9 MiB: garantiza varios `flush()` antes del fallo.
    fixture = createFixture(6_000);
    const ok = join(fixture.root, 'ok');
    expect(await main(['run', fixture.model, fixture.scenario, '--csv', ok])).toBe(0);
    expect(statSync(join(ok, 'log.csv')).size).toBeGreaterThan(1_048_576);

    const blocked = join(fixture.root, 'blocked');
    mkdirSync(join(blocked, 'flows.csv'), { recursive: true });
    expect(await main(['run', fixture.model, fixture.scenario, '--csv', blocked])).toBe(1);

    expect(existsSync(join(blocked, 'log.csv'))).toBe(false);
    expect(existsSync(join(blocked, 'elements.csv'))).toBe(false);
    expect(readdirSync(blocked).some((name) => name.includes('.tmp-'))).toBe(false);
  }, 30_000);
});

describe('QA LILA-037 · el techo de memoria del test de aceptación discrimina', () => {
  /**
   * Control negativo del test de `event-log.test.ts`: si el mismo volumen (30 × 10 000 casos,
   * 900 000 filas) cupiera en 200 MB también reteniendo el log, aquel test pasaría sin demostrar
   * nada y podría degradarse en silencio al encoger el escenario. Aquí se comprueba lo contrario:
   * en modo retenido el proceso muere con ese mismo techo de heap.
   */
  test('el mismo volumen con result.log retenido muere con --max-old-space-size=200', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = mkdtempSync(join(tmpdir(), 'lila-event-log-qa-neg-'));
    const driver = join(root, 'retained.mts');
    writeFileSync(
      driver,
      `import { simulate } from ${JSON.stringify(resolve(here, '../src/core/run.ts'))};
const ir = {
  id: 'P', name: '', source: { exporter: '', exporterVersion: '' },
  nodes: {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['F1'] },
    T1: { type: 'task', name: '', incoming: ['F1'], outgoing: ['F2'] },
    T2: { type: 'task', name: '', incoming: ['F2'], outgoing: ['F3'] },
    T3: { type: 'task', name: '', incoming: ['F3'], outgoing: ['F4'] },
    End: { type: 'end', name: '', incoming: ['F4'], outgoing: [] },
  },
  flows: {
    F1: { name: '', from: 'Start', to: 'T1', isDefault: false },
    F2: { name: '', from: 'T1', to: 'T2', isDefault: false },
    F3: { name: '', from: 'T2', to: 'T3', isDefault: false },
    F4: { name: '', from: 'T3', to: 'End', isDefault: false },
  },
};
const scenario = {
  run: { seed: 42, replications: 30, warmup: 0 },
  elements: {
    Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 10000 },
    T1: { processingTime: { type: 'constant', value: 5 }, fixedCost: 1 },
    T2: { processingTime: { type: 'constant', value: 3 } },
    T3: { processingTime: { type: 'constant', value: 2 } },
  },
};
// Sin opciones: modo retenido, las 900 000 filas quedan vivas en result.log.
console.log(simulate(ir, scenario).log.length);
`,
      'utf8',
    );

    let failed = false;
    try {
      execFileSync(process.execPath, ['--max-old-space-size=200', '--import', 'tsx', driver], {
        cwd: resolve(here, '../../..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      failed = true;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    expect(failed).toBe(true);
  }, 120_000);
});
