/**
 * Runs one `simulate` off the server's thread (#637), so the server keeps answering — pings, other
 * calls, and the client's cancellation — while a long run works. It reports each completed
 * replication and posts the `RunResult` back. Cancelling is the server terminating this worker.
 *
 * Only erasable TypeScript and package imports here: the tests run `src/` directly, and Node strips
 * the types of this file when the server starts it from `src/simulate-worker.ts`.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { simulate } from '@lila-modeler/engine';
import type { SimulateOptions } from '@lila-modeler/engine';

export interface SimulateRequest {
  ir: Parameters<typeof simulate>[0];
  scenario: Parameters<typeof simulate>[1];
  locale: SimulateOptions['locale'];
}

export type SimulateMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; result: ReturnType<typeof simulate> }
  | { type: 'error'; message: string };

const { ir, scenario, locale } = workerData as SimulateRequest;
const post = (message: SimulateMessage): void => parentPort!.postMessage(message);
let reported = 0;
try {
  const result = simulate(ir, scenario, {
    log: false,
    locale,
    onProgress: ({ completedReplications, totalReplications }) => {
      if (completedReplications === reported) return;
      reported = completedReplications;
      post({ type: 'progress', completed: completedReplications, total: totalReplications });
    },
  });
  post({ type: 'result', result });
} catch (error) {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
