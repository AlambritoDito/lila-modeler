/**
 * `runInWorker` con un `Worker` de mentira instalado en el global: en Node no hay Web Workers, y
 * lo que hay que probar del cliente no es el hilo sino su protocolo —qué mensaje manda, cuándo
 * resuelve, cuándo rechaza y, sobre todo, que cancelar **mata** el worker en vez de mandarle un
 * mensaje que nunca leería (ver la cabecera de `simulationClient.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInWorker } from './simulationClient.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';
import type { ProcessIR, SimScenario } from '@lila/engine';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');

const IR = { id: 'P', elements: {}, flows: {} } as unknown as ProcessIR;
const SCENARIO = { model: 'm.bpmn', run: { seed: 1 } } as unknown as SimScenario;

class FakeWorker {
  static last: FakeWorker | undefined;
  static created = 0;

  posted: WorkerRequest[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | undefined;
  onerror: ((event: ErrorEvent) => void) | undefined;

  constructor() {
    FakeWorker.last = this;
    FakeWorker.created += 1;
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** Empuja una respuesta como lo haría el worker de verdad. */
  reply(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.last;
  if (worker === undefined) throw new Error('no se creó ningún worker');
  return worker;
}

const doneResponse = { type: 'done', result: { warnings: [] }, logSample: [] } as unknown as WorkerResponse;

beforeEach(() => {
  FakeWorker.last = undefined;
  FakeWorker.created = 0;
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runInWorker', () => {
  it('manda un único mensaje run y resuelve al recibir done, terminando el worker', async () => {
    const promise = runInWorker(IR, SCENARIO, { seed: 7, logSampleLimit: 3 });
    const worker = lastWorker();

    expect(worker.posted).toEqual([
      // #280: el idioma activo de la app viaja en el propio mensaje (esta suite lo fija en `es`).
      { type: 'run', ir: IR, scenario: SCENARIO, seed: 7, logSampleLimit: 3, locale: 'es' },
    ]);

    worker.reply(doneResponse);
    await expect(promise).resolves.toEqual({ result: { warnings: [] }, logSample: [] });
    expect(worker.terminated).toBe(1);
  });

  /**
   * #280: el worker no importa `i18n.ts` —el bundle no puede crecer—, así que el idioma se
   * decide aquí y viaja como dato. Una corrida ya guardada conserva el idioma en el que se
   * produjo: lo que cambia el interruptor son las corridas que empiezan después.
   */
  it('el mensaje lleva el idioma activo, y `locale` explícito manda sobre él (#280)', async () => {
    setLocale('en');
    try {
      void runInWorker(IR, SCENARIO);
      expect(lastWorker().posted[0]).toMatchObject({ locale: 'en' });

      setLocale('es');
      void runInWorker(IR, SCENARIO);
      expect(lastWorker().posted[0]).toMatchObject({ locale: 'es' });

      void runInWorker(IR, SCENARIO, { locale: 'en' });
      expect(lastWorker().posted[0]).toMatchObject({ locale: 'en' });
    } finally {
      setLocale('es');
    }
  });

  it('reenvía el progreso sin terminar el worker', async () => {
    const onProgress = vi.fn();
    const promise = runInWorker(IR, SCENARIO, { onProgress });
    const worker = lastWorker();

    worker.reply({ type: 'progress', progress: { fraction: 0.5 } } as unknown as WorkerResponse);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(0);

    worker.reply(doneResponse);
    await promise;
  });

  it('convierte la respuesta error en un rechazo y termina el worker', async () => {
    const promise = runInWorker(IR, SCENARIO);
    const worker = lastWorker();

    worker.reply({ type: 'error', message: 'E-REC-DESCONOCIDO: el pool X no existe.' });

    await expect(promise).rejects.toThrow('E-REC-DESCONOCIDO');
    expect(worker.terminated).toBe(1);
  });

  it('un onerror del worker también rechaza y termina', async () => {
    const promise = runInWorker(IR, SCENARIO);
    const worker = lastWorker();

    worker.onerror?.({ message: 'boom' } as ErrorEvent);

    await expect(promise).rejects.toThrow('boom');
    expect(worker.terminated).toBe(1);
  });

  it('una señal ya abortada rechaza sin llegar a crear el worker', async () => {
    await expect(runInWorker(IR, SCENARIO, { signal: AbortSignal.abort() })).rejects.toThrow(
      /canceló/,
    );
    expect(FakeWorker.created).toBe(0);
  });

  it('cancelar a mitad mata el worker en vez de mandarle un mensaje', async () => {
    const controller = new AbortController();
    const promise = runInWorker(IR, SCENARIO, { signal: controller.signal });
    const worker = lastWorker();

    worker.reply({ type: 'progress', progress: { fraction: 0.3 } } as unknown as WorkerResponse);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(1);
    // Nada de `{ type: 'cancel' }`: el worker no leería su cola mientras `simulate` corre.
    expect(worker.posted.map((message) => message.type)).toEqual(['run']);
  });

  it('abortar dos veces, o después de terminar, no vuelve a tocar el worker', async () => {
    const controller = new AbortController();
    const promise = runInWorker(IR, SCENARIO, { signal: controller.signal });
    const worker = lastWorker();

    worker.reply(doneResponse);
    await promise;
    controller.abort();
    controller.abort();

    expect(worker.terminated).toBe(1);
  });
});
