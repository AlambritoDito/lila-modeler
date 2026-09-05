/**
 * Worker de simulación (LILA-059). Importa solo `@lila/engine` (que a su vez solo re-exporta
 * `core/`, sin bpmn-moddle/zod/React — ver packages/engine/test/worker-bundle.test.ts) y ejecuta
 * `simulate` fuera del hilo principal: progreso, cancelación y muestreo del log.
 *
 * `handleMessage` es la parte pura y testeable (sin `self.postMessage` real); el bloque final la
 * conecta al Worker de verdad. Así el test de igualdad byte a byte y el de rendimiento (10 000 ×
 * 30 casos) corren en Node llamando directo a la función, sin necesitar un Web Worker real.
 */
import {
  simulate,
  type EventLogRow,
  type ProcessIR,
  type RunResult,
  type SimScenario,
  type SimulationProgress,
} from '@lila/engine';

/** ponytail: tope por defecto de filas retenidas de la primera replicación (docs/RESULTS_FORMAT.md §7). */
export const DEFAULT_LOG_SAMPLE_LIMIT = 10_000;

export interface RunRequest {
  type: 'run';
  ir: ProcessIR;
  scenario: SimScenario;
  /** Sobrescribe `scenario.run.seed` sin mutar el escenario recibido. */
  seed?: number | undefined;
  /** Tope configurable de filas de log retenidas (solo replicación 0). */
  logSampleLimit?: number | undefined;
}

export interface CancelRequest {
  type: 'cancel';
}

export type WorkerRequest = RunRequest | CancelRequest;

export interface ProgressResponse {
  type: 'progress';
  progress: SimulationProgress;
}

export interface DoneResponse {
  type: 'done';
  result: RunResult;
  /** Filas de la replicación 0, hasta `logSampleLimit`; el resto del log se descarta en el worker. */
  logSample: EventLogRow[];
}

export interface ErrorResponse {
  type: 'error';
  message: string;
}

export type WorkerResponse = ProgressResponse | DoneResponse | ErrorResponse;

type Post = (message: WorkerResponse) => void;

/** No más de ~10 mensajes de progreso por segundo de reloj real hacia el hilo principal. */
const PROGRESS_THROTTLE_MS = 100;

let activeController: AbortController | undefined;

function withSeed(scenario: SimScenario, seed: number | undefined): SimScenario {
  if (seed === undefined) return scenario;
  return { ...scenario, run: { ...scenario.run, seed } };
}

function runSimulation(post: Post, request: RunRequest): void {
  const controller = new AbortController();
  activeController = controller;
  const limit = request.logSampleLimit ?? DEFAULT_LOG_SAMPLE_LIMIT;
  const logSample: EventLogRow[] = [];
  let lastProgressAt = -Infinity;
  let lastCompletedReplications = -1;

  try {
    const result = simulate(request.ir, withSeed(request.scenario, request.seed), {
      signal: controller.signal,
      onEvent: (row) => {
        // Solo la primera replicación se retiene en memoria (docs/RESULTS_FORMAT.md §7).
        if (row.replication === 0 && logSample.length < limit) logSample.push(row);
      },
      onProgress: (progress) => {
        const now = Date.now();
        const replicationBoundary = progress.completedReplications !== lastCompletedReplications;
        if (!replicationBoundary && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
        lastProgressAt = now;
        lastCompletedReplications = progress.completedReplications;
        post({ type: 'progress', progress });
      },
    });
    post({ type: 'done', result, logSample });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (activeController === controller) activeController = undefined;
  }
}

/** Función pura: sin `self`, sin `postMessage`. Es lo que testean los tests de aceptación. */
export function handleMessage(post: Post, message: WorkerRequest): void {
  if (message.type === 'cancel') {
    activeController?.abort();
    return;
  }
  runSimulation(post, message);
}

// ponytail: wiring real del Web Worker; nada de lo de arriba depende de esto.
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).postMessage === 'function') {
  const worker = self as unknown as Worker;
  worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
    handleMessage((message) => worker.postMessage(message), event.data);
  };
}
