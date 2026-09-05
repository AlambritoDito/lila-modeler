/**
 * Pruebas de aceptación de LILA-059. `handleMessage` es la función pura del worker (sin
 * `postMessage` real), así que estas pruebas corren en Node sobre el mismo `examples/pedido`
 * usado por el golden del motor (packages/engine/test/golden/pedido.ts).
 *
 * Deliberadamente NO se importa `packages/engine/test/golden/pedido.ts`: esa fuente arrastra
 * `src/bpmn/parse.ts`, cuyo shim de tipos de `bpmn-moddle` (`src/bpmn/bpmn-moddle.d.ts`) solo se
 * incluye en el *programa* de TypeScript de `packages/engine` (su `tsconfig.json` lo agrega vía
 * `include`); bajo el `tsconfig.json` de `apps/web` esos mismos símbolos llegan como `any` (falla
 * `tsc --noEmit`). Aquí se consumen solo los subpaths públicos y ya compilados de `@lila/engine`
 * (`.`, `./bpmn`, `./schema`), que es exactamente lo que hará la UI real.
 *
 * Criterio (a), igualdad byte a byte, contra dos oráculos externos —nunca contra el mismo
 * pipeline reejecutado dentro del test—: el archivo golden ya versionado
 * (`packages/engine/test/golden/pedido.seed-42.json`, sin recursos) y la salida de la CLI de
 * verdad (`lila run --json`, con recursos), invocada como subproceso.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseBpmn, validate } from '@lila/engine/bpmn';
import { ScenarioSchema, scenarioErrors, validateScenario, type ResolvedScenario } from '@lila/engine/schema';
import {
  simulate,
  type EventLogRow,
  type ProcessIR,
  type RunResult,
  type SimScenario,
  type SimulationProgress,
} from '@lila/engine';
import { DEFAULT_LOG_SAMPLE_LIMIT, handleMessage, type WorkerResponse } from './worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const EXAMPLE_DIR = resolve(REPOSITORY_ROOT, 'examples/pedido');
const GOLDEN_PATH = resolve(REPOSITORY_ROOT, 'packages/engine/test/golden/pedido.seed-42.json');
const CLI_BIN = resolve(REPOSITORY_ROOT, 'packages/engine/bin/lila.js');

/** Serialización canónica y auditable, idéntica a `writeJson`/`canonicalJson` de la CLI. */
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Igual que `loadPedidoScenario` del golden del motor: mismo archivo, semilla explícita. */
function loadPedidoScenario(seed: number): ResolvedScenario {
  const scenarioInput: unknown = JSON.parse(
    readFileSync(resolve(EXAMPLE_DIR, 'as-is.scenario.json'), 'utf8'),
  );
  const parsed = ScenarioSchema.parse(scenarioInput);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error('examples/pedido/as-is.scenario.json no es un escenario resuelto.');
  }
  return { ...parsed, model: parsed.model, run: { ...parsed.run, seed } };
}

/** Copia de `withoutResourcesAndCalendars` del golden: la entrada que describe `pedido.seed-42.json`. */
function withoutResourcesAndCalendars(scenario: ResolvedScenario): ResolvedScenario {
  const degraded: ResolvedScenario = {
    ...scenario,
    elements: Object.fromEntries(
      Object.entries(scenario.elements ?? {}).map(([elementId, configuration]) => {
        const element = { ...configuration };
        delete element.resources;
        delete element.selection;
        delete element.calendar;
        return [elementId, element];
      }),
    ),
  };
  delete degraded.resources;
  delete degraded.calendars;
  return degraded;
}

async function loadPedidoIr(): Promise<ProcessIR> {
  const xml = readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8');
  const parsed = await parseBpmn(xml);
  const modelValidation = validate(parsed.ir, { unsupported: parsed.unsupported });
  if (modelValidation.errors.length > 0) {
    throw new Error(`model.bpmn inválido: ${canonicalJson(modelValidation.errors)}`);
  }
  return parsed.ir;
}

function assertScenarioIsValid(ir: ProcessIR, scenario: ResolvedScenario): void {
  const errors = scenarioErrors(validateScenario(scenario, ir));
  if (errors.length > 0) {
    throw new Error(`examples/pedido/as-is.scenario.json inválido: ${canonicalJson(errors)}`);
  }
}

/**
 * Copia reducida de `examples/pedido` (menos casos, menos replicaciones) para las pruebas que no
 * necesitan igualdad de bytes con un oráculo — así no repiten el costo de 10 000 × 30.
 */
function smallPedidoScenario(base: ResolvedScenario, replications = 3): SimScenario {
  return {
    ...base,
    run: { ...base.run, replications },
    elements: {
      ...base.elements,
      StartEvent_Pedido: { ...base.elements?.['StartEvent_Pedido'], triggerCount: 40 },
    },
  } as SimScenario;
}

interface WorkerRun {
  result: RunResult;
  logSample: EventLogRow[];
  progress: SimulationProgress[];
}

/** Ejecuta `handleMessage` como una promesa: junta progreso, recoge `done`/`error`. */
function runWorker(
  ir: ProcessIR,
  scenario: SimScenario,
  overrides: { seed?: number; logSampleLimit?: number } = {},
): Promise<WorkerRun> {
  return new Promise((resolvePromise, reject) => {
    const progress: SimulationProgress[] = [];
    handleMessage((message: WorkerResponse) => {
      if (message.type === 'progress') progress.push(message.progress);
      else if (message.type === 'done')
        resolvePromise({ result: message.result, logSample: message.logSample, progress });
      else reject(new Error(message.message));
    }, { type: 'run', ir, scenario, ...overrides });
  });
}

describe('worker: igualdad byte a byte con el golden del motor, sin recursos (criterio a)', () => {
  it('reproduce packages/engine/test/golden/pedido.seed-42.json byte a byte', async () => {
    const scenario = withoutResourcesAndCalendars(loadPedidoScenario(42));
    const ir = await loadPedidoIr();
    assertScenarioIsValid(ir, scenario);

    const { result } = await runWorker(ir, scenario);

    expect(canonicalJson(result)).toBe(readFileSync(GOLDEN_PATH, 'utf8'));
  }, 60_000);
});

describe('worker: examples/pedido completo, 10 000 × 30 con recursos', () => {
  let run: WorkerRun;
  let elapsedMs = 0;
  let cliResult: RunResult;

  beforeAll(async () => {
    const scenario = loadPedidoScenario(42);
    expect(scenario.elements?.['StartEvent_Pedido']?.triggerCount).toBe(10_000);
    expect(scenario.run.replications).toBe(30);
    const ir = await loadPedidoIr();
    assertScenarioIsValid(ir, scenario);

    const start = performance.now();
    run = await runWorker(ir, scenario);
    elapsedMs = performance.now() - start;

    // La CLI de verdad, con el mismo modelo, el mismo escenario y la misma semilla.
    const outputDir = mkdtempSync(resolve(tmpdir(), 'lila-59-'));
    const outputPath = resolve(outputDir, 'run.json');
    try {
      execFileSync(
        process.execPath,
        [CLI_BIN, 'run', resolve(EXAMPLE_DIR, 'model.bpmn'), resolve(EXAMPLE_DIR, 'as-is.scenario.json'), '--json', outputPath],
        { cwd: REPOSITORY_ROOT, stdio: 'ignore' },
      );
      cliResult = JSON.parse(readFileSync(outputPath, 'utf8')) as RunResult;
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  }, 120_000);

  it('corre en menos de 15 s (criterio b)', () => {
    expect(elapsedMs).toBeLessThan(15_000);
  });

  it('coincide byte a byte con lila run --json salvo los avisos que la CLI fusiona aparte', () => {
    // `lila run` añade al `RunResult` los avisos de validación de modelo y escenario y el aviso de
    // calendarios M3 (`resultWithBoundaryWarnings`, packages/engine/src/cli.ts). Esos avisos nacen
    // de `parseBpmn`/`validateScenario`, que viven en el hilo principal —fuera del bundle del
    // worker a propósito—, así que fusionarlos es tarea de quien llama (LILA-062). Todo lo demás,
    // incluidos los avisos que produce el propio `simulate`, sale idéntico byte a byte.
    expect(canonicalJson({ ...cliResult, warnings: [] })).toBe(canonicalJson({ ...run.result, warnings: [] }));
    expect(cliResult.warnings).toEqual(expect.arrayContaining(run.result.warnings));
  });

  it('no retiene result.log y la muestra se corta en el tope por defecto', () => {
    expect(run.result.log).toBeUndefined();
    expect(run.logSample).toHaveLength(DEFAULT_LOG_SAMPLE_LIMIT);
    expect(run.logSample.every((row) => row.replication === 0)).toBe(true);
  });

  it('el progreso es estrictamente monótono y termina en 1', () => {
    const fractions = run.progress.map((progress) => progress.fraction);
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.every((fraction, index) => index === 0 || fraction > fractions[index - 1]!)).toBe(true);
  });
});

describe('worker: muestreo del log (solo primera replicación)', () => {
  it('retiene las mismas filas y en el mismo orden que el log retenido de la replicación 0', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42));
    const ir = await loadPedidoIr();

    const { result, logSample } = await runWorker(ir, scenario);
    const retained = simulate(ir, scenario).log?.filter((row) => row.replication === 0);

    expect(result.log).toBeUndefined();
    expect(logSample.length).toBeGreaterThan(0);
    expect(logSample).toEqual(retained);
  });

  it('corta exactamente en el tope pedido, incluido 0', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42));
    const ir = await loadPedidoIr();

    const capped = await runWorker(ir, scenario, { logSampleLimit: 5 });
    const none = await runWorker(ir, scenario, { logSampleLimit: 0 });

    expect(capped.logSample).toHaveLength(5);
    expect(capped.logSample.every((row) => row.replication === 0)).toBe(true);
    expect(none.logSample).toHaveLength(0);
  });
});

describe('worker: progreso', () => {
  it('con una sola replicación emite el 0 % y el 100 %', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42), 1);
    const ir = await loadPedidoIr();

    const { progress } = await runWorker(ir, scenario);

    expect(progress.map((entry) => entry.fraction)).toEqual([0, 1]);
    expect(progress.at(-1)?.completedReplications).toBe(1);
  });

  it('el throttle nunca se traga un límite de replicación', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42), 4);
    const ir = await loadPedidoIr();

    const { progress } = await runWorker(ir, scenario);

    expect(progress.map((entry) => entry.completedReplications)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('worker: errores', () => {
  it('un pool desconocido llega como respuesta error, no como excepción', async () => {
    const base = loadPedidoScenario(42);
    const scenario = {
      ...smallPedidoScenario(base),
      elements: {
        ...smallPedidoScenario(base).elements,
        Task_Empacar: { ...base.elements?.['Task_Empacar'], resources: [{ ref: 'NoExiste' }] },
      },
    } as SimScenario;
    const ir = await loadPedidoIr();

    const messages: WorkerResponse[] = [];
    expect(() => {
      handleMessage((message) => messages.push(message), { type: 'run', ir, scenario });
    }).not.toThrow();

    const last = messages.at(-1);
    expect(last?.type).toBe('error');
    expect(last?.type === 'error' && last.message).toContain('E-REC-DESCONOCIDO');
  });

  it('una excepción de simulate no deja la respuesta a medias', async () => {
    const ir = await loadPedidoIr();
    const messages: WorkerResponse[] = [];

    handleMessage((message) => messages.push(message), {
      type: 'run',
      ir,
      scenario: { ...loadPedidoScenario(42), resources: { Almacen: { capacity: 0 } } } as SimScenario,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('error');
  });
});
