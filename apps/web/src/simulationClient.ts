/**
 * Cliente mínimo del Worker de simulación (LILA-059). Sin React: crea el Worker, traduce
 * `signal.abort()` al mensaje `cancel` y resuelve con el `RunResult` (+ muestra del log) cuando
 * llega `done`. `Modeler.tsx` (LILA-057) es quien lo llama desde la UI.
 */
import type { ProcessIR, RunResult, EventLogRow, SimScenario, SimulationProgress } from '@lila/engine';
import type { DoneResponse, WorkerRequest, WorkerResponse } from './worker.js';

export interface RunInWorkerOptions {
  onProgress?: ((progress: SimulationProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  seed?: number | undefined;
  logSampleLimit?: number | undefined;
}

export type RunInWorkerResult = Pick<DoneResponse, 'result' | 'logSample'>;

function createWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

/** Corre `simulate` en un Worker aparte; el worker se termina siempre al resolver o rechazar. */
export function runInWorker(
  ir: ProcessIR,
  scenario: SimScenario,
  options: RunInWorkerOptions = {},
): Promise<RunInWorkerResult> {
  if (options.signal?.aborted === true) {
    return Promise.reject(new DOMException('La simulación se canceló antes de empezar.', 'AbortError'));
  }

  const worker = createWorker();

  return new Promise<RunInWorkerResult>((resolve, reject) => {
    const onAbort = (): void => worker.postMessage({ type: 'cancel' } satisfies WorkerRequest);
    const cleanup = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    options.signal?.addEventListener('abort', onAbort);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        options.onProgress?.(message.progress);
        return;
      }
      cleanup();
      if (message.type === 'done') resolve({ result: message.result, logSample: message.logSample });
      else reject(new Error(message.message));
    };
    worker.onerror = (event: ErrorEvent) => {
      cleanup();
      reject(event.error instanceof Error ? event.error : new Error(event.message));
    };

    worker.postMessage({
      type: 'run',
      ir,
      scenario,
      seed: options.seed,
      logSampleLimit: options.logSampleLimit,
    } satisfies WorkerRequest);
  });
}

export type { RunResult, EventLogRow };
