import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../src/cli.js';
import { formatDuration } from '../src/format.js';
import { runResultSchema } from '../src/result.schema.js';

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
    expect(existsSync(join(first, '.log.csv.tmp'))).toBe(false);
  });

  test('rechaza explícitamente recursos y calendarios de hitos posteriores', async () => {
    const scenario = join(fixture.root, 'unsupported.scenario.json');
    const jsonOutput = join(fixture.root, 'should-not-exist.json');
    const csvOutput = join(fixture.root, 'should-not-exist-csv');
    writeFileSync(
      scenario,
      JSON.stringify({
        version: 1,
        name: 'Fuera de M1',
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
    ).toBe(1);
    expect(output.join('\n')).toContain('E-NIVEL-M2 resources');
    expect(output.join('\n')).toContain('E-NIVEL-M3 calendars');
    expect(output.join('\n')).toContain('elements.Task.resources');
    expect(output.join('\n')).toContain('elements.Task.calendar');
    expect(existsSync(jsonOutput)).toBe(false);
    expect(existsSync(csvOutput)).toBe(false);
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
