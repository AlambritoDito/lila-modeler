import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../src/cli.js';

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/pedido');

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_Compare" exporter="Lila test" exporterVersion="1">
  <bpmn:process id="Process_Compare" name="Proceso compare" isExecutable="false">
    <bpmn:startEvent id="Start" name="Inicio" />
    <bpmn:task id="Task" name="Atender" />
    <bpmn:endEvent id="End" name="Fin" />
    <bpmn:sequenceFlow id="Flow_Start_Task" sourceRef="Start" targetRef="Task" />
    <bpmn:sequenceFlow id="Flow_Task_End" sourceRef="Task" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

interface Fixture {
  root: string;
  model: string;
  /** Sin `resources`: `resources.agente.*` no existe en ningún KPI de este escenario. */
  base: string;
  /** Mismo modelo, con un pool `agente` que `base` no declara. */
  withResource: string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'lila-cli-compare-'));
  const model = join(root, 'model.bpmn');
  const base = join(root, 'base.scenario.json');
  const withResource = join(root, 'with-resource.scenario.json');
  writeFileSync(model, MODEL_XML, 'utf8');
  writeFileSync(
    base,
    JSON.stringify({
      version: 1,
      name: 'Base sin recursos',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', seed: 7, replications: 2, baseTimeUnit: 'min' },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 5 },
        Task: { processingTime: { type: 'uniform', min: 60, max: 120 } },
      },
    }),
    'utf8',
  );
  writeFileSync(
    withResource,
    JSON.stringify({
      version: 1,
      name: 'Con agente',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', seed: 7, replications: 2, baseTimeUnit: 'min' },
      resources: { agente: { capacity: 1, costPerHour: 10 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 5 },
        Task: {
          processingTime: { type: 'uniform', min: 60, max: 120 },
          resources: [{ ref: 'agente' }],
        },
      },
    }),
    'utf8',
  );
  return { root, model, base, withResource };
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

/** Línea de tabla que menciona tanto el id/kpi buscado como la etiqueta de su métrica. */
function rowLine(text: string, needle: string, metricLabel: string): string | undefined {
  return text.split('\n').find((line) => line.includes(needle) && line.includes(metricLabel));
}

describe('lila compare (LILA-047)', () => {
  test(
    'aceptación: AS-IS vs TO-BE (examples/pedido) muestra menor utilización y espera del cajero, y es determinista',
    async () => {
      const args = [
        'compare',
        join(exampleDir, 'model.bpmn'),
        join(exampleDir, 'as-is.scenario.json'),
        join(exampleDir, 'to-be-3-cajeros.scenario.json'),
        '--seed',
        '42',
      ];

      const first = await main(args);
      const firstText = output.join('\n');
      output = [];
      const second = await main(args);
      const secondText = output.join('\n');

      expect(first).toBe(0);
      expect(second).toBe(0);
      expect(firstText).toBe(secondText);

      expect(firstText).toContain('Compared scenarios');
      expect(firstText).toContain('Process elements');
      expect(firstText).toContain('Resources');
      expect(firstText).toContain('* significant difference (95% CI without overlap)');

      // Task_TomarPedido: la espera de recurso baja mucho y de forma significativa (TO-BE).
      const wait = rowLine(firstText, 'Task_TomarPedido', 'Average time (waiting for resource)');
      expect(wait, firstText).toBeDefined();
      expect(wait).toMatch(/\(-\d[\d.]*%\)\*/);

      // Task_Preparar: el cuello de botella es el horno, que TO-BE no toca — no significativo.
      const preparar = rowLine(firstText, 'Task_Preparar', 'Average time (waiting for resource)');
      expect(preparar, firstText).toBeDefined();
      expect(preparar).not.toContain(')*');

      // La utilización del cajero baja de forma significativa.
      const utilization = rowLine(firstText, 'cajero', 'Utilization (%)');
      expect(utilization, firstText).toBeDefined();
      expect(utilization).toMatch(/\(-\d[\d.]*%\)\*/);
    },
    120_000, // ponytail: cuatro simulaciones de examples/pedido con 30 réplicas (~25 s en CI); techo holgado, no medida de rendimiento
  );

  test('error claro con menos de dos escenarios', async () => {
    const code = await main(['compare', fixture.model, fixture.base]);
    expect(code).toBe(1);
    expect(output.join('\n')).toContain('at least two scenarios');
  });

  test('guion para un KPI ausente en la base (pool nuevo en el otro escenario)', async () => {
    const code = await main(['compare', fixture.model, fixture.base, fixture.withResource]);
    expect(code).toBe(0);
    const text = output.join('\n');

    const line = rowLine(text, 'agente', 'Utilization (%)');
    expect(line, text).toBeDefined();
    // Columna base (`Base sin recursos`): el pool `agente` no existe ahí, por lo tanto guion.
    expect(line).toMatch(/Utilization \(%\)\s+-\s/);
  });

  test('avisa cuando un escenario corre sin replicaciones suficientes para IC95', async () => {
    const code = await main([
      'compare',
      fixture.model,
      fixture.base,
      fixture.withResource,
      '--replications',
      '1',
    ]);
    expect(code).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('without a 95% CI there is no significance mark possible');
    expect(text).toContain('Base sin recursos');
    expect(text).toContain('Con agente');
  });

  test('el modelo posicional debe coincidir con scenario.model de cada escenario', async () => {
    const mismatch = join(fixture.root, 'mismatch.scenario.json');
    writeFileSync(
      mismatch,
      JSON.stringify({
        version: 1,
        name: 'Modelo distinto',
        model: 'otro.bpmn',
        run: { start: '2026-09-07T08:00:00-06:00', duration: 60 },
      }),
      'utf8',
    );

    const code = await main(['compare', fixture.model, fixture.base, mismatch]);
    expect(code).toBe(1);
    expect(output.join('\n')).toContain('does not match scenario.model');
  });

  // LILA-211 parte 2: mismo compare, `--lang es`, chrome en español y avisos traducidos.
  test('`--lang es` traduce la cabecera, la tabla de escenarios y los avisos de compare', async () => {
    const code = await main([
      'compare',
      fixture.model,
      fixture.base,
      fixture.withResource,
      '--replications',
      '1',
      '--lang',
      'es',
    ]);
    expect(code).toBe(0);
    const text = output.join('\n');

    expect(text).toContain('Unidad de tiempo min (escenario base) · Utilización en %');
    expect(text).toContain('Escenarios comparados');
    expect(text).toContain('Base sin recursos (base)');
    expect(text).toContain('* diferencia significativa (IC95 sin solapamiento)');
    expect(text).toContain('Avisos:');
    expect(text).toContain('sin IC95 no hay marca de significancia posible');
    // Los nombres de columna Bizagi no cambian de idioma.
    expect(text).toContain('Utilization (%)');
  });

  test('--json escribe el CompareResult tal cual', async () => {
    const outFile = join(fixture.root, 'out', 'compare.json');
    const code = await main([
      'compare',
      fixture.model,
      fixture.base,
      fixture.withResource,
      '--json',
      outFile,
    ]);
    expect(code).toBe(0);

    const parsed = JSON.parse(readFileSync(outFile, 'utf8')) as { count: number; rows: unknown[] };
    expect(parsed.count).toBe(2);
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  test('--all imprime también las filas fuera del subconjunto curado (p. ej. sequence flows)', async () => {
    const code = await main(['compare', fixture.model, fixture.base, fixture.withResource, '--all']);
    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Sequence flows');
  });
});
