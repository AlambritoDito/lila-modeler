/**
 * Pruebas de aceptación de LILA-059. `handleMessage` es la función pura del worker (sin
 * `postMessage` real), así que estas pruebas corren en Node sobre el mismo `examples/pedido`
 * usado por el golden del motor (packages/engine/test/golden/pedido.ts).
 *
 * Deliberadamente NO se importa `packages/engine/test/golden/pedido.ts`: esa fuente arrastra
 * `src/bpmn/parse.ts`, cuyo shim de tipos de `bpmn-moddle` (`src/bpmn/bpmn-moddle.d.ts`) solo se
 * incluye en el *programa* de TypeScript de `packages/engine` (su `tsconfig.json` lo agrega vía
 * `include`); bajo el `tsconfig.json` de `apps/web` esos mismos símbolos llegan como `any` (falla
 * `tsc --noEmit`). Aquí se repiten los mismos cuatro pasos que `renderPedidoScenario`, pero
 * consumiendo solo los subpaths públicos y ya compilados de `@lila/engine` (`.`, `./bpmn`,
 * `./schema`), que es exactamente lo que hará la UI real.
 *
 * Equivalencia con `lila run --json` (criterio a): esta canonicalización —parsear el mismo
 * `model.bpmn`, validar el mismo escenario y llamar a `simulate(ir, scenario, { log: false })`— es
 * la misma que usa `packages/engine/test/golden/pedido.ts` y la misma que ejecuta `lila run` antes
 * de fusionar avisos de frontera de la CLI (ver `packages/engine/src/cli.ts`,
 * `resultWithBoundaryWarnings`: solo añade avisos de validación de modelo/escenario y el aviso de
 * calendarios M3, ninguno de los cuales depende de `log: false` vs `onEvent`). El worker llama a
 * `simulate` con `onEvent` en vez de `log: false` para muestrear el log; por contrato de
 * `simulate` (packages/engine/src/core/run.ts) `result.log` queda `undefined` en ambos casos, así
 * que la comparación de bytes no depende de qué modo de log se use.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBpmn, validate } from '@lila/engine/bpmn';
import { ScenarioSchema, scenarioErrors, validateScenario, type ResolvedScenario } from '@lila/engine/schema';
import { simulate, type EventLogRow, type ProcessIR, type RunResult, type SimScenario } from '@lila/engine';
import { DEFAULT_LOG_SAMPLE_LIMIT, handleMessage, type WorkerResponse } from './worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, '../../../examples/pedido');

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

async function loadPedidoIr(): Promise<ProcessIR> {
  const xml = readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8');
  const parsed = await parseBpmn(xml);
  const modelValidation = validate(parsed.ir, { unsupported: parsed.unsupported });
  if (modelValidation.errors.length > 0) {
    throw new Error(`model.bpmn inválido: ${canonicalJson(modelValidation.errors)}`);
  }
  return parsed.ir;
}

/** Igual que `renderPedidoScenario` del golden del motor, sobre el `ir` ya cargado. */
function renderExpectedJson(ir: ProcessIR, scenario: ResolvedScenario): string {
  const errors = scenarioErrors(validateScenario(scenario, ir));
  if (errors.length > 0) {
    throw new Error(`examples/pedido/as-is.scenario.json inválido: ${canonicalJson(errors)}`);
  }
  return canonicalJson(simulate(ir, scenario, { log: false }));
}

/**
 * Copia reducida de `examples/pedido` (menos casos, menos replicaciones) para las pruebas que no
 * necesitan igualdad de bytes con el golden — así no repiten el costo de 10 000 × 30 varias veces.
 */
function smallPedidoScenario(base: ResolvedScenario): SimScenario {
  return {
    ...base,
    run: { ...base.run, replications: 3 },
    elements: {
      ...base.elements,
      StartEvent_Pedido: { ...base.elements?.['StartEvent_Pedido'], triggerCount: 40 },
    },
  } as SimScenario;
}

/** Ejecuta `handleMessage` como una promesa: junta progreso, recoge `done`/`error`. */
function runWorker(
  ir: ProcessIR,
  scenario: SimScenario,
  overrides: { seed?: number; logSampleLimit?: number } = {},
): Promise<{ result: RunResult; logSample: EventLogRow[]; progress: number }> {
  return new Promise((resolvePromise, reject) => {
    let progress = 0;
    handleMessage((message: WorkerResponse) => {
      if (message.type === 'progress') {
        progress += 1;
      } else if (message.type === 'done') {
        resolvePromise({ result: message.result, logSample: message.logSample, progress });
      } else {
        reject(new Error(message.message));
      }
    }, { type: 'run', ir, scenario, ...overrides });
  });
}

describe('worker: igualdad byte a byte con lila run --json (criterio a)', () => {
  it('el RunResult del worker canonicaliza exactamente igual que el pipeline de la CLI', async () => {
    const scenario = loadPedidoScenario(42);
    const ir = await loadPedidoIr();

    const expectedJson = renderExpectedJson(ir, scenario);
    const { result } = await runWorker(ir, scenario);
    const actualJson = canonicalJson(result);

    expect(actualJson).toBe(expectedJson);
  }, 20_000);
});

describe('worker: muestreo del log (solo primera replicación)', () => {
  it('retiene únicamente filas de replication === 0, hasta el tope configurable', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42));
    const ir = await loadPedidoIr();

    const { result, logSample } = await runWorker(ir, scenario, { logSampleLimit: 5 });

    expect(result.log).toBeUndefined();
    expect(logSample.length).toBeLessThanOrEqual(5);
    expect(logSample.every((row) => row.replication === 0)).toBe(true);
  });

  it('el tope por defecto es DEFAULT_LOG_SAMPLE_LIMIT', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42));
    const ir = await loadPedidoIr();

    const { logSample } = await runWorker(ir, scenario);

    expect(logSample.length).toBeLessThanOrEqual(DEFAULT_LOG_SAMPLE_LIMIT);
  });
});

describe('worker: cancelación cooperativa', () => {
  it('un cancel entre mensajes aborta la corrida y el resultado queda marcado', async () => {
    const scenario = smallPedidoScenario(loadPedidoScenario(42));
    const ir = await loadPedidoIr();

    const { result } = await new Promise<{ result: RunResult }>((resolvePromise, reject) => {
      let cancelled = false;
      handleMessage((message: WorkerResponse) => {
        if (message.type === 'progress' && !cancelled) {
          cancelled = true;
          // El propio handler dispara el cancel de vuelta, simulando al cliente real.
          handleMessage(() => {}, { type: 'cancel' });
        } else if (message.type === 'done') {
          resolvePromise({ result: message.result });
        } else if (message.type === 'error') {
          reject(new Error(message.message));
        }
      }, { type: 'run', ir, scenario });
    });

    expect(result.cancelled).toBe(true);
    expect(result.completedReplications).toBeLessThan(scenario.run.replications ?? 1);
  });
});

describe('worker: rendimiento (criterio b)', () => {
  it('10 000 casos x 30 replicaciones corren en menos de 15 s', async () => {
    const scenario = loadPedidoScenario(42);
    expect(scenario.elements?.['StartEvent_Pedido']?.triggerCount).toBe(10_000);
    expect(scenario.run.replications).toBe(30);
    const ir = await loadPedidoIr();

    const start = performance.now();
    await runWorker(ir, scenario);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(15_000);
  }, 20_000);
});
