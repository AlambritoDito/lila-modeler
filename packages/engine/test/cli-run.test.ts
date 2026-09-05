import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../src/cli.js';
import { formatDuration, formatNumber } from '../src/format.js';
import { runResultSchema } from '../src/result.schema.js';

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/pedido');

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_CLI" exporter="Lila test" exporterVersion="1">
  <bpmn:process id="Process_CLI" name="Proceso CLI" isExecutable="false">
    <bpmn:startEvent id="Start" name="Inicio" />
    <bpmn:task id="Task" name="Atender, &quot;rápido&quot;" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_Start_Task" name="entrada, principal" sourceRef="Start" targetRef="Task" />
    <bpmn:sequenceFlow id="Flow_Task_End" sourceRef="Task" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

interface Fixture {
  root: string;
  model: string;
  scenario: string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'lila-cli-run-'));
  const modelDirectory = join(root, 'models');
  const scenarioDirectory = join(root, 'scenarios');
  const baseDirectory = join(scenarioDirectory, 'base');
  mkdirSync(modelDirectory, { recursive: true });
  mkdirSync(baseDirectory, { recursive: true });

  const model = join(modelDirectory, 'model.bpmn');
  const base = join(baseDirectory, 'base.scenario.json');
  const scenario = join(scenarioDirectory, 'child.scenario.json');
  writeFileSync(model, MODEL_XML, 'utf8');
  writeFileSync(
    base,
    JSON.stringify({
      version: 1,
      name: 'Base',
      model: '../../models/model.bpmn',
      run: {
        start: '2026-09-07T08:00:00-06:00',
        seed: 42,
        baseTimeUnit: 'min',
      },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
        Task: { processingTime: { type: 'uniform', min: 60, max: 120 } },
      },
    }),
    'utf8',
  );
  writeFileSync(
    scenario,
    JSON.stringify({ version: 1, name: 'Hijo por extends', extends: 'base/base.scenario.json' }),
    'utf8',
  );
  return { root, model, scenario };
}

let fixture: Fixture;
let output: string[];

beforeEach(() => {
  fixture = createFixture();
  output = [];
  const capture = (...args: unknown[]) => void output.push(args.join(' '));
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(fixture.root, { recursive: true, force: true });
});

describe('lila run (LILA-046)', () => {
  test('carga extends/model relativos, aplica overrides y muestra columnas Bizagi + extras', async () => {
    const code = await main([
      'run',
      fixture.model,
      fixture.scenario,
      '--seed',
      '7',
      '--replications',
      '2',
    ]);
    const text = output.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('Escenario Hijo por extends');
    expect(text).toContain('Semilla 7 · Replicaciones 2 · Unidad de tiempo min');
    expect(text).toContain('Process elements');
    expect(text).toContain('Instances started');
    expect(text).toContain('Instances completed');
    expect(text).toContain('Average time (min)');
    expect(text).toContain('Process summary (extras)');
    // R-DEG-1: sin `resources` en el escenario no hay tabla de recurso (SEMANTICS.md § 14). La
    // salida tiene que seguir siendo la de M1, byte a byte, después de LILA-184.
    expect(text).not.toContain('Resources');
    expect(formatDuration(90, 'min')).toBe('1.5');
  });

  test('--json es una ruta en run y dos ejecuciones con la misma semilla son byte-idénticas', async () => {
    const first = join(fixture.root, 'out', 'first.json');
    const second = join(fixture.root, 'out', 'second.json');
    const args = ['run', fixture.model, fixture.scenario, '--seed', '99', '--replications', '2'];

    expect(await main([...args, '--json', first])).toBe(0);
    expect(await main([...args, '--json', second])).toBe(0);
    expect(readFileSync(first)).toEqual(readFileSync(second));

    const parsed = JSON.parse(readFileSync(first, 'utf8')) as {
      replications?: { count: number };
      process: { started: number; completed: number };
    };
    expect(runResultSchema.safeParse(parsed).success).toBe(true);
    expect(parsed.replications?.count).toBe(2);
    expect(parsed.process).toMatchObject({ started: 3, completed: 3 });
    expect(readdirSync(join(fixture.root, 'out')).some((name) => name.includes('.tmp-'))).toBe(false);
  });

  test('--csv crea cinco archivos deterministas RFC 4180; resources queda solo con header', async () => {
    const first = join(fixture.root, 'csv-a');
    const second = join(fixture.root, 'csv-b');
    const names = ['elements.csv', 'flows.csv', 'resources.csv', 'process.csv', 'log.csv'];

    expect(await main(['run', fixture.model, fixture.scenario, '--csv', first])).toBe(0);
    expect(await main(['run', fixture.model, fixture.scenario, '--csv', second])).toBe(0);

    for (const name of names) {
      const a = readFileSync(join(first, name));
      const b = readFileSync(join(second, name));
      expect(a, name).toEqual(b);
      const text = a.toString('utf8');
      expect(text, name).toMatch(/\r\n$/);
      expect(text, name).not.toMatch(/(^|[^\r])\n/);
    }

    const elements = readFileSync(join(first, 'elements.csv'), 'utf8');
    expect(elements).toContain('Instances started,Instances completed,Minimum time');
    expect(elements).toContain('"Atender, ""rápido"""');
    expect(readFileSync(join(first, 'flows.csv'), 'utf8')).toContain('"entrada, principal"');
    expect(readFileSync(join(first, 'resources.csv'), 'utf8').split('\r\n')).toHaveLength(2);
    expect(readFileSync(join(first, 'log.csv'), 'utf8').split('\r\n')).toHaveLength(5);
    expect(readdirSync(first).some((name) => name.includes('.tmp-'))).toBe(false);
  });

  test('acepta recursos y calendarios sin gate ni aviso de nivel (LILA-184, LILA-041)', async () => {
    const scenario = join(fixture.root, 'con-recursos.scenario.json');
    const jsonOutput = join(fixture.root, 'con-recursos.json');
    const csvOutput = join(fixture.root, 'con-recursos-csv');
    writeFileSync(
      scenario,
      JSON.stringify({
        version: 1,
        name: 'Con recursos y calendarios',
        model: 'models/model.bpmn',
        run: { start: '2026-09-07T08:00:00-06:00', duration: 60 },
        calendars: {
          oficina: { intervals: [{ days: ['MON'], from: '09:00', to: '18:00' }] },
        },
        resources: { agente: { capacity: 1 } },
        elements: {
          Start: { triggerCount: 1 },
          Task: { resources: [{ ref: 'agente' }], calendar: 'oficina' },
        },
      }),
      'utf8',
    );

    expect(
      await main([
        'run',
        fixture.model,
        scenario,
        '--json',
        jsonOutput,
        '--csv',
        csvOutput,
      ]),
    ).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('Resources');
    expect(text).toContain('Utilization (%)');
    // LILA-041 simula los calendarios, así que ya no queda ni gate ni aviso de nivel pendiente.
    expect(text).not.toContain('declara calendarios');
    expect(text).not.toContain('E-NIVEL-M2');
    expect(text).not.toContain('E-NIVEL-M3');
    expect(existsSync(jsonOutput)).toBe(true);
    expect(existsSync(csvOutput)).toBe(true);

    const json = JSON.parse(readFileSync(jsonOutput, 'utf8')) as {
      resources: Record<string, unknown>;
      warnings: string[];
    };
    expect(Object.keys(json.resources)).toContain('agente');
    expect(json.warnings.some((warning) => warning.includes('declara calendarios'))).toBe(false);
  });

  test('rechaza un model posicional distinto de scenario.model', async () => {
    const scenario = join(fixture.root, 'mismatch.scenario.json');
    writeFileSync(
      scenario,
      JSON.stringify({
        version: 1,
        name: 'Modelo distinto',
        model: 'otro.bpmn',
        run: { start: '2026-09-07T08:00:00-06:00', duration: 60 },
      }),
      'utf8',
    );

    expect(await main(['run', fixture.model, scenario])).toBe(1);
    expect(output.join('\n')).toContain('no coincide con scenario.model');
  });

  test('acepta que el modelo posicional sea un symlink al scenario.model real', async () => {
    const alias = join(fixture.root, 'model-alias.bpmn');
    symlinkSync(fixture.model, alias);

    expect(await main(['run', alias, fixture.scenario])).toBe(0);
    expect(output.join('\n')).not.toContain('no coincide con scenario.model');
  });

  test('un conflicto en un CSV no publica un conjunto parcial ni deja temporales', async () => {
    const directory = join(fixture.root, 'csv-conflict');
    mkdirSync(join(directory, 'flows.csv'), { recursive: true });
    writeFileSync(join(directory, 'elements.csv'), 'resultado anterior\r\n', 'utf8');

    expect(await main(['run', fixture.model, fixture.scenario, '--csv', directory])).toBe(1);
    expect(readFileSync(join(directory, 'elements.csv'), 'utf8')).toBe('resultado anterior\r\n');
    expect(existsSync(join(directory, 'resources.csv'))).toBe(false);
    expect(existsSync(join(directory, 'process.csv'))).toBe(false);
    expect(existsSync(join(directory, 'log.csv'))).toBe(false);
    expect(readdirSync(directory).some((name) => name.includes('.tmp-'))).toBe(false);
  });

  test('separa --json booleano de validate y --json con ruta de run', async () => {
    expect(await main(['validate', fixture.model, '--json'])).toBe(0);
    expect(() => JSON.parse(output.join('\n'))).not.toThrow();

    output = [];
    expect(await main(['run', fixture.model, fixture.scenario, '--json'])).toBe(1);
    expect(output.join('\n')).toContain('--json');
  });

  test('rechaza overrides inválidos y argumentos posicionales de más', async () => {
    expect(await main(['run', fixture.model, fixture.scenario, '--replications', '0'])).toBe(1);
    expect(output.join('\n')).toContain('--replications requiere un entero >= 1');

    output = [];
    expect(await main(['run', fixture.model, fixture.scenario, 'extra'])).toBe(1);
    expect(output.join('\n')).toContain('se esperaba las rutas');
  });
});

describe('lila run · aceptación LILA-184 (examples/pedido)', () => {
  test(
    'AS-IS sale 0, imprime Resources sin aviso de nivel; --json es determinista con resources y bottlenecks',
    async () => {
      const model = join(exampleDir, 'model.bpmn');
      const scenario = join(exampleDir, 'as-is.scenario.json');

      // ponytail: 3 replicaciones bastan para la aceptación; el escenario declara 30 (~25 s en CI).
      const args = ['run', model, scenario, '--replications', '3'];

      const first = await main(args);
      const firstText = output.join('\n');
      output = [];
      const second = await main(args);
      const secondText = output.join('\n');

      expect(first).toBe(0);
      expect(second).toBe(0);
      expect(firstText).toBe(secondText);
      // El escenario declara `oficina` y desde LILA-041 el motor lo simula: sin aviso de nivel.
      expect(firstText).not.toContain('declara calendarios');

      // Nombres de columna exactos de RESULTS_FORMAT.md § 10 y unidad en `Busy time`, que son
      // segundos-unidad convertidos a `baseTimeUnit` como en `lila compare` (QA de #47).
      const lines = firstText.split('\n');
      const header = lines[lines.indexOf('Resources') + 1];
      expect(header).toMatch(
        /^Id +Name +Utilization \(%\) +Busy time \(min\) +Fixed cost +Unit cost +Total cost$/,
      );

      const firstJson = join(fixture.root, 'as-is-1.json');
      const secondJson = join(fixture.root, 'as-is-2.json');
      expect(await main([...args, '--json', firstJson])).toBe(0);
      expect(await main([...args, '--json', secondJson])).toBe(0);
      expect(readFileSync(firstJson)).toEqual(readFileSync(secondJson));

      const parsed = JSON.parse(readFileSync(firstJson, 'utf8')) as {
        resources: Record<string, { utilization: number; busyTime: number }>;
        bottlenecks: Array<{ elementId: string; resourceWaitTotal: number; utilization: number }>;
        process: { costPerCase: number };
      };
      expect(runResultSchema.safeParse(parsed).success).toBe(true);
      expect(Object.keys(parsed.resources)).toContain('cajero');
      // El ranking solo existe con contención de recursos: vacío significaría que el gate sigue
      // recortando lo que la corrida mide, no que el escenario no tenga cuellos de botella.
      expect(parsed.bottlenecks.length).toBeGreaterThan(0);

      // La consola imprime los mismos números que el JSON, con la conversión de presentación.
      const cajero = parsed.resources.cajero!;
      const row = lines.find((line) => line.startsWith('cajero'))!.split(/ {2,}/);
      expect(row.slice(0, 4)).toEqual([
        'cajero',
        'Cajero',
        formatNumber(cajero.utilization * 100),
        formatDuration(cajero.busyTime, 'min'),
      ]);

      // LILA-188: run.currency en la cabecera de la corrida (docs/RESULTS_FORMAT.md §8, mismo
      // criterio que ResultsView en apps/web/src/ResultsView.tsx).
      expect(firstText).toContain('Semilla 42 · Replicaciones 3 · Unidad de tiempo min · Moneda MXN');

      // LILA-188: tabla "Cuellos de botella" con el ranking de RunResult.bottlenecks
      // (docs/RESULTS_FORMAT.md §6), tras las tablas Bizagi.
      expect(firstText).toContain('Cuellos de botella');
      const bottleneckHeaderIndex = lines.indexOf('Cuellos de botella') + 1;
      expect(lines[bottleneckHeaderIndex]).toMatch(
        /^Id +Name +Total time \(waiting for resource\) \(min\) +Utilization \(%\)$/,
      );
      const firstBottleneck = parsed.bottlenecks[0]!;
      const bottleneckRow = lines
        .slice(bottleneckHeaderIndex + 2)
        .find((line) => line.startsWith(firstBottleneck.elementId))!
        .split(/ {2,}/);
      expect(bottleneckRow[0]).toBe(firstBottleneck.elementId);
      expect(bottleneckRow[2]).toBe(formatDuration(firstBottleneck.resourceWaitTotal, 'min'));
      expect(bottleneckRow[3]).toBe(formatNumber(firstBottleneck.utilization * 100));

      // LILA-188: costPerCase en la tabla de proceso (docs/RESULTS_FORMAT.md §5).
      const processHeaderIndex = lines.indexOf('Process summary (extras)') + 1;
      expect(lines[processHeaderIndex]!.split(/ {2,}/).at(-1)).toBe('Cost per case');
      expect(lines[processHeaderIndex + 2]!.split(/ {2,}/).at(-1)).toBe(
        formatNumber(parsed.process.costPerCase),
      );
    },
    60_000,
  );

  test(
    '--csv produce log.csv con resourceId no nulo',
    async () => {
      const model = join(exampleDir, 'model.bpmn');
      const scenario = join(exampleDir, 'as-is.scenario.json');
      const csvOutput = join(fixture.root, 'as-is-csv');

      expect(
        await main(['run', model, scenario, '--replications', '3', '--csv', csvOutput]),
      ).toBe(0);

      const log = readFileSync(join(csvOutput, 'log.csv'), 'utf8');
      const [header, ...rows] = log.trim().split('\r\n');
      const resourceIdColumn = header!.split(',').indexOf('resourceId');
      expect(resourceIdColumn).toBeGreaterThanOrEqual(0);
      expect(rows.some((row) => row.split(',')[resourceIdColumn] !== '')).toBe(true);
    },
    30_000,
  );
});
