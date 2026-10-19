/**
 * Runs one `simulate` off the server's thread (#637), so the server keeps answering — pings, other
 * calls, and the client's cancellation — while a long run works. It reports each completed
 * replication and posts the `RunResult` back. Cancelling is the server terminating this worker.
 * With `logDescriptor` (#665, `logTo`) it streams the event log as CSV into that descriptor, the
 * temporary file the server staged: the server commits or removes the file, never this worker.
 *
 * Only erasable TypeScript and package imports here: the tests run `src/` directly, and Node strips
 * the types of this file when the server starts it from `src/simulate-worker.ts`.
 */
import { writeFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

import { simulate } from '@lila-modeler/engine';
import { eventLogCsvWriter, runStartMs } from '@lila-modeler/engine/csv';
import type { SimulateOptions } from '@lila-modeler/engine';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';

export interface SimulateRequest {
  ir: Parameters<typeof simulate>[0];
  scenario: ResolvedScenario;
  locale: SimulateOptions['locale'];
  /** An open descriptor of the process (worker threads share them) to write the event log to. */
  logDescriptor?: number | undefined;
}

export type SimulateMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; result: ReturnType<typeof simulate> }
  | { type: 'error'; message: string };

const { ir, scenario, locale, logDescriptor } = workerData as SimulateRequest;
const post = (message: SimulateMessage): void => parentPort!.postMessage(message);
// The same rows and bytes as the `log.csv` of `lila run --csv`.
const log =
  logDescriptor === undefined
    ? undefined
    : eventLogCsvWriter((chunk) => writeFileSync(logDescriptor, chunk, 'utf8'), runStartMs(scenario.run.start));
let reported = 0;
try {
  const result = simulate(ir, scenario, {
    log: log !== undefined,
    ...(log === undefined ? {} : { onEvent: log.onEvent }),
    locale,
    onProgress: ({ completedReplications, totalReplications }) => {
      if (completedReplications === reported) return;
      reported = completedReplications;
      post({ type: 'progress', completed: completedReplications, total: totalReplications });
    },
  });
  log?.flush();
  post({ type: 'result', result });
} catch (error) {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
