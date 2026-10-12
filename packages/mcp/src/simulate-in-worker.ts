/**
 * `simulate` in a worker thread (#637): the server's event loop stays free during a run, so it can
 * send progress, answer other requests and act on the client's `notifications/cancelled`, which
 * aborts the request's signal and terminates the worker. Errors of the engine come back as errors
 * with their message (catalog text and code included), as when `simulate` ran in the server.
 */
import { Worker } from 'node:worker_threads';

import type { RunResult } from '@lila-modeler/engine';
import type { ServerContext } from '@modelcontextprotocol/server';

import type { SimulateMessage, SimulateRequest } from './simulate-worker.js';

/**
 * The compiled worker next to this file; from `src/` (the tests) the `.ts` itself, which Node runs
 * with its type stripping.
 */
const workerUrl = new URL(import.meta.url.endsWith('.ts') ? './simulate-worker.ts' : './simulate-worker.js', import.meta.url);

export interface WorkerRunOptions {
  /** The request's signal: aborting it stops the run, and the promise rejects. */
  signal?: AbortSignal | undefined;
  /** Called once per completed replication. */
  onReplication?: ((completed: number, total: number) => void) | undefined;
}

export function simulateInWorker(request: SimulateRequest, { signal, onReplication }: WorkerRunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'));
      return;
    }
    const worker = new Worker(workerUrl, { workerData: request });
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      outcome();
    };
    const cancel = (): void => {
      void worker.terminate();
      settle(() => reject(signal?.reason instanceof Error ? signal.reason : new Error('cancelled')));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', (message: SimulateMessage) => {
      if (message.type === 'progress') onReplication?.(message.completed, message.total);
      else if (message.type === 'result') settle(() => resolve(message.result));
      else settle(() => reject(new Error(message.message)));
    });
    worker.on('error', (error) => settle(() => reject(error)));
    worker.on('exit', (code) => settle(() => reject(new Error(`the simulation worker stopped (exit code ${code})`))));
  });
}

/** The request's signal, and progress notifications when the client asked for them (`_meta.progressToken`). */
export interface RequestProgress {
  signal?: AbortSignal | undefined;
  report: (progress: number, total: number) => void;
}

export function requestProgress(ctx: ServerContext | undefined): RequestProgress {
  const token = ctx?.mcpReq._meta?.progressToken;
  return {
    signal: ctx?.mcpReq.signal,
    report: (progress, total) => {
      if (token === undefined) return;
      ctx!.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress, total } }).catch(() => undefined);
    },
  };
}
