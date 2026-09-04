import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../src/cli.js';
import { simulate } from '../src/core/run.js';
import type { EventLogRow } from '../src/core/result.js';
import { eventLogCsv, eventLogCsvHeader, eventLogRowCsv, runStartMs } from '../src/csv.js';
import { eventLogRowSchema } from '../src/result.schema.js';
import { ScenarioSchema, resolveExtends } from '../src/scenario.js';
import { parseBpmn } from '../src/bpmn/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const pedidoModel = resolve(repoRoot, 'examples/pedido/model.bpmn');
const pedidoScenario = resolve(repoRoot, 'examples/pedido/as-is.scenario.json');

/** IR mínimo y lineal: dos tareas encadenadas, sin gateways ni recursos. */
const IR = {
  id: 'P',
  name: '',
  source: { exporter: '', exporterVersion: '' },
  nodes: {
    Start: { type: 'start' as const, name: '', incoming: [], outgoing: ['F1'] },
    A: { type: 'task' as const, name: '', incoming: ['F1'], outgoing: ['F2'] },
    End: { type: 'end' as const, name: '', incoming: ['F2'], outgoing: [] },
  },
  flows: {
    F1: { name: '', from: 'Start', to: 'A', isDefault: false },
    F2: { name: '', from: 'A', to: 'End', isDefault: false },
  },
};

function scenario(replications = 2) {
  return {
    run: { seed: 42, replications },
    elements: {
      Start: { interTriggerTimer: { type: 'constant' as const, value: 10 }, triggerCount: 3 },
      A: { processingTime: { type: 'constant' as const, value: 5 }, fixedCost: 2 },
    },
  };
}

/** `simulate` acepta el IR estructuralmente; el cast evita reconstruir `ProcessIR` en cada test. */
const ir = IR as unknown as Parameters<typeof simulate>[0];

describe('contrato de result.log (LILA-037)', () => {
  test('sin onEvent el resultado trae el log completo, en orden de simulación y replicación', () => {
    const result = simulate(ir, scenario());

    expect(result.log).toHaveLength(6);
    expect(result.log?.map((row) => `${row.replication}:${row.caseId}:${row.elementId}`)).toEqual([
      '0:1:A',
      '0:2:A',
      '0:3:A',
      '1:1:A',
      '1:2:A',
      '1:3:A',
    ]);
    for (const row of result.log ?? []) expect(eventLogRowSchema.safeParse(row).success).toBe(true);
  });

  test('con onEvent las filas llegan por callback y result.log no se materializa', () => {
    const streamed: EventLogRow[] = [];
    const retained = simulate(ir, scenario());
    const streaming = simulate(ir, scenario(), { onEvent: (row) => streamed.push(row) });

    expect(streaming.log).toBeUndefined();
    expect(streamed).toEqual(retained.log);
    expect(streamed).toHaveLength(retained.log?.length ?? 0);
    // Suprimir la retención no puede mover ninguna métrica.
    expect({ ...streaming, log: retained.log }).toEqual(retained);
  });

  test('log: false no emite ni retiene, y deja exactamente las mismas métricas', () => {
    let calls = 0;
    const retained = simulate(ir, scenario());
    const disabled = simulate(ir, scenario(), { log: false, onEvent: () => calls++ });

    expect(calls).toBe(0);
    expect(disabled.log).toBeUndefined();
    expect('log' in disabled).toBe(false);
    expect({ ...disabled, log: retained.log }).toEqual(retained);
    // El conteo de filas no depende del modo: lo que cambia es quién se queda con ellas.
    const counted: EventLogRow[] = [];
    simulate(ir, scenario(), { onEvent: (row) => counted.push(row) });
    expect(counted).toHaveLength(retained.log?.length ?? 0);
  });
});

describe('log.csv: columnas, ISO y escape (LILA-037)', () => {
  const startMs = runStartMs('2026-09-07T08:00:00-06:00');

  const row: EventLogRow = {
    replication: 0,
    caseId: '1',
    activityInstanceId: 'a1',
    elementId: 'Task,"raro"\n',
    resourceId: null,
    allocationIndex: null,
    resourceQuantity: null,
    status: 'completed',
    enabledAt: 0,
    startedAt: 30.25,
    endedAt: 90.5,
    observedUntil: 90.5,
    resourceWait: 30.25,
    offHoursWait: 0,
    elementCost: 2.5,
    resourceCost: 0,
    cost: 2.5,
  };

  test('conserva las 17 columnas del contrato de ADR-025 y no añade ISO sin run.start', () => {
    expect(eventLogCsvHeader()).toBe(
      'replication,caseId,activityInstanceId,elementId,resourceId,allocationIndex,' +
        'resourceQuantity,status,enabledAt,startedAt,endedAt,observedUntil,resourceWait,' +
        'offHoursWait,elementCost,resourceCost,cost\r\n',
    );
    expect(eventLogRowCsv(row)).toBe(
      '0,1,a1,"Task,""raro""\n",,,,completed,0,30.25,90.5,90.5,30.25,0,2.5,0,2.5\r\n',
    );
  });

  test('con run.start añade los tres timestamps ISO 8601 derivados', () => {
    expect(eventLogCsvHeader(startMs)).toMatch(/,enabledAtIso,startedAtIso,endedAtIso\r\n$/);
    expect(eventLogRowCsv(row, startMs)).toMatch(
      /,2026-09-07T14:00:00\.000Z,2026-09-07T14:00:30\.250Z,2026-09-07T14:01:30\.500Z\r\n$/,
    );
  });

  test('startedAt/endedAt nulos dejan la celda ISO vacía y el CSV sigue siendo RFC 4180', () => {
    const queued: EventLogRow = {
      ...row,
      status: 'inFlight',
      startedAt: null,
      endedAt: null,
      elementCost: 0,
      resourceCost: 0,
      cost: 0,
    };
    const csv = eventLogCsv([queued], startMs);
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toMatch(/,2026-09-07T14:00:00\.000Z,,\r\n$/);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('un run.start ilegible vacía las columnas ISO en vez de romper el CSV', () => {
    expect(runStartMs('no es una fecha')).toBeNaN();
    expect(eventLogRowCsv(row, runStartMs('no es una fecha'))).toMatch(/,,,\r\n$/);
  });
});

describe('lila run --csv escribe el mismo log que simulate (LILA-037)', () => {
  let root = '';
  let output: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lila-event-log-'));
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      output.push(parts.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
      output.push(parts.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * `examples/pedido` en su forma simulable por `lila run` hoy: el escenario AS-IS declara pools y
   * calendarios, que la CLI todavía rechaza (M2/M3, ver `unsupportedM1`). Se reutilizan el modelo
   * y los parámetros reales quitando esos dos bloques, y se recorta el volumen para el test.
   */
  function pedidoSinRecursos(): string {
    const base = JSON.parse(readFileSync(pedidoScenario, 'utf8')) as Record<string, unknown>;
    const elements = base['elements'] as Record<string, Record<string, unknown>>;
    for (const element of Object.values(elements)) {
      delete element['resources'];
      delete element['selection'];
      delete element['calendar'];
    }
    elements['StartEvent_Pedido']!['triggerCount'] = 40;
    const file = join(root, 'pedido.scenario.json');
    writeFileSync(
      file,
      JSON.stringify({
        ...base,
        model: pedidoModel,
        calendars: undefined,
        resources: undefined,
        run: { ...(base['run'] as Record<string, unknown>), replications: 2, warmup: 0 },
        elements,
      }),
      'utf8',
    );
    return file;
  }

  test('log.csv coincide byte a byte con eventLogCsv(result.log) y es determinista', async () => {
    const file = pedidoSinRecursos();
    const first = join(root, 'csv-a');
    const second = join(root, 'csv-b');

    expect(await main(['run', pedidoModel, file, '--csv', first])).toBe(0);
    expect(await main(['run', pedidoModel, file, '--csv', second])).toBe(0);

    const { ir: pedidoIr } = await parseBpmn(readFileSync(pedidoModel, 'utf8'));
    const resolved = ScenarioSchema.parse(
      resolveExtends(file.replaceAll('\\', '/'), (path) => JSON.parse(readFileSync(path, 'utf8'))),
    );
    const result = simulate(pedidoIr, resolved as never);

    const written = readFileSync(join(first, 'log.csv'), 'utf8');
    expect(result.log?.length).toBeGreaterThan(0);
    expect(written).toBe(eventLogCsv(result.log ?? [], runStartMs(resolved.run!.start)));
    expect(written.split('\r\n')).toHaveLength((result.log?.length ?? 0) + 2);
    // R-DET-6: dos corridas con la misma semilla producen el mismo archivo byte a byte.
    expect(readFileSync(join(second, 'log.csv'))).toEqual(readFileSync(join(first, 'log.csv')));
  });
});

describe('memoria de lila run --csv (LILA-037)', () => {
  /**
   * Aceptación del ticket: 30 × 10 000 casos por debajo de 200 MB. La medición se hace con un
   * techo duro de heap en un proceso hijo (`--max-old-space-size`) en vez de comparar
   * `heapUsed` antes/después: ese delta depende de cuándo corrió el GC y varía entre 65 y 220 MB
   * en la misma máquina, mientras que el techo falla con OOM si el pico real lo supera. Con el
   * log retenido (900 000 filas vivas) este mismo proceso muere; en streaming termina.
   */
  test('30 × 10 000 casos escriben 900 000 filas con un techo de heap de 200 MB', () => {
    const root = mkdtempSync(join(tmpdir(), 'lila-event-log-mem-'));
    const model = join(root, 'model.bpmn');
    const scenarioFile = join(root, 'scenario.json');
    const out = join(root, 'out');
    // `.mts` para que tsx trate el script como ESM sin depender del package.json del temporal.
    const driver = join(root, 'run.mts');

    writeFileSync(
      model,
      `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" exporter="lila test" exporterVersion="1">
  <bpmn:process id="P" name="Lineal" isExecutable="false">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="T1" />
    <bpmn:task id="T2" />
    <bpmn:task id="T3" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T1" />
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="T2" />
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="T3" />
    <bpmn:sequenceFlow id="F4" sourceRef="T3" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`,
      'utf8',
    );
    writeFileSync(
      scenarioFile,
      JSON.stringify({
        version: 1,
        name: 'memoria',
        model: 'model.bpmn',
        run: {
          start: '2026-09-07T08:00:00-06:00',
          seed: 42,
          replications: 30,
          baseTimeUnit: 's',
          currency: 'MXN',
        },
        elements: {
          Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 10_000 },
          T1: { processingTime: { type: 'constant', value: 5 }, fixedCost: 1 },
          T2: { processingTime: { type: 'constant', value: 3 } },
          T3: { processingTime: { type: 'constant', value: 2 } },
        },
      }),
      'utf8',
    );
    writeFileSync(
      driver,
      `import { main } from ${JSON.stringify(resolve(here, '../src/cli.ts'))};
const original = console.log;
console.log = () => {};
const code = await main(['run', ${JSON.stringify(model)}, ${JSON.stringify(scenarioFile)}, '--csv', ${JSON.stringify(out)}]);
console.log = original;
console.log(JSON.stringify({ code, heapUsed: process.memoryUsage().heapUsed }));
`,
      'utf8',
    );

    const stdout = execFileSync(
      process.execPath,
      ['--max-old-space-size=200', '--import', 'tsx', driver],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const { code, heapUsed } = JSON.parse(stdout.trim().split('\n').at(-1)!) as {
      code: number;
      heapUsed: number;
    };

    expect(code).toBe(0);
    expect(heapUsed).toBeLessThan(200 * 1024 * 1024);
    expect(readFileSync(join(out, 'log.csv'), 'utf8').split('\r\n')).toHaveLength(900_002);
  }, 120_000);
});
