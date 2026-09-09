/**
 * Cliente mínimo del Worker de simulación (LILA-059). Sin React: crea el Worker, resuelve con el
 * `RunResult` (+ muestra del log) cuando llega `done` y traduce `signal.abort()` a matar el
 * worker. `Modeler.tsx` (LILA-057) es quien lo llama desde la UI.
 *
 * Cancelar = `worker.terminate()`, no un mensaje: `simulate` es síncrono y mientras corre el
 * worker no procesa su cola, así que un `postMessage({ type: 'cancel' })` recién se leería cuando
 * la corrida ya hubiese terminado por su cuenta (verificado en navegador: cancelar a los 1,2 s de
 * una corrida de 5 s no la detenía). Matarlo corta el cálculo al instante; el precio es que no
 * hay `RunResult` parcial con `cancelled: true` (docs/RESULTS_FORMAT.md §8): `runInWorker`
 * **rechaza** con `AbortError`. Recuperar el parcial exigiría o bien `SharedArrayBuffer` —y con él
 * cabeceras COOP/COEP que GitHub Pages (LILA-067) no sirve— o un `simulate` por trozos.
 */
import type { ProcessIR, RunResult, EventLogRow, SimScenario, SimulationProgress } from '@lila/engine';
import type { DoneResponse, WorkerRequest, WorkerResponse } from './worker.js';
import { strings } from './i18n';

export interface RunInWorkerOptions {
  onProgress?: ((progress: SimulationProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  seed?: number | undefined;
  logSampleLimit?: number | undefined;
}

export type RunInWorkerResult = Pick<DoneResponse, 'result' | 'logSample'>;

function abortError(): DOMException {
  const S = strings();
  return new DOMException(S.simulacion.cancelada, 'AbortError');
}

function createWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

/** Corre `simulate` en un Worker aparte; el worker se termina siempre al resolver o rechazar. */
export function runInWorker(
  ir: ProcessIR,
  scenario: SimScenario,
  options: RunInWorkerOptions = {},
): Promise<RunInWorkerResult> {
  if (options.signal?.aborted === true) return Promise.reject(abortError());

  const worker = createWorker();

  return new Promise<RunInWorkerResult>((resolve, reject) => {
    const cleanup = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    function onAbort(): void {
      cleanup();
      reject(abortError());
    }

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
