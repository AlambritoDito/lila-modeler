/**
 * Worker de simulación (LILA-059). Importa solo `@lila/engine` (que a su vez solo re-exporta
 * `core/`, sin bpmn-moddle/zod/React — ver packages/engine/test/worker-bundle.test.ts) y ejecuta
 * `simulate` fuera del hilo principal: progreso y muestreo del log.
 *
 * `handleMessage` es la parte pura y testeable (sin estado de módulo, sin `self.postMessage`
 * real); el bloque final la conecta al Worker de verdad. Así el test de igualdad byte a byte y el
 * de rendimiento (10 000 × 30 casos) corren en Node llamando directo a la función, sin necesitar
 * un Web Worker real.
 *
 * Cancelar **no** es un mensaje: `simulate` es síncrono, así que mientras corre el worker no
 * vacía su cola de mensajes y un `postMessage({ type: 'cancel' })` no se leería hasta que la
 * corrida hubiese terminado sola. La cancelación la hace el cliente matando el worker
 * (`simulationClient.ts`), que además libera la CPU al instante.
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

/**
 * El worker no conoce el idioma de la app a propósito: `@lila/engine` es lo único que importa
 * (`worker.bundle.test.ts` vigila que no entren ni el catálogo ni `i18n.ts` en sus 100 KB), y los
 * mensajes que devuelve son los del motor. Cuando #280 le pase el idioma al motor, `RunRequest`
 * ganará un `locale` y el cliente lo mandará; hasta entonces no hay nada que traducir aquí.
 */
export interface RunRequest {
  type: 'run';
  ir: ProcessIR;
  scenario: SimScenario;
  /** Sobrescribe `scenario.run.seed` sin mutar el escenario recibido. */
  seed?: number | undefined;
  /** Tope configurable de filas de log retenidas (solo replicación 0). */
  logSampleLimit?: number | undefined;
}

export type WorkerRequest = RunRequest;

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

function withSeed(scenario: SimScenario, seed: number | undefined): SimScenario {
  if (seed === undefined) return scenario;
  return { ...scenario, run: { ...scenario.run, seed } };
}

/** Función pura: sin estado de módulo, sin `self`, sin `postMessage`. Es lo que testean las pruebas. */
export function handleMessage(post: Post, message: WorkerRequest): void {
  const limit = message.logSampleLimit ?? DEFAULT_LOG_SAMPLE_LIMIT;
  const logSample: EventLogRow[] = [];
  let lastProgressAt = -Infinity;
  let lastCompletedReplications = -1;

  try {
    const result = simulate(message.ir, withSeed(message.scenario, message.seed), {
      onEvent: (row) => {
        // Solo la primera replicación se retiene en memoria (docs/RESULTS_FORMAT.md §7).
        if (row.replication === 0 && logSample.length < limit) logSample.push(row);
      },
      onProgress: (progress) => {
        const now = Date.now();
        // Los límites de replicación nunca se tiran: así el 100 % final siempre llega.
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
  }
}

// ponytail: wiring real del Web Worker; nada de lo de arriba depende de esto.
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).postMessage === 'function') {
  const worker = self as unknown as Worker;
  worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
    handleMessage((message) => worker.postMessage(message), event.data);
  };
}
