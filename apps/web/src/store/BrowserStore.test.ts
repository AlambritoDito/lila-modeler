// @vitest-environment jsdom
/**
 * Aceptación de LILA-058: «la demo abre y descarga archivos». `BrowserStore` no persiste nada,
 * así que lo único que hay que verificar es que habla con el DOM como se espera: `getProcess`
 * dispara un `<input type=file>` real y resuelve con lo que el usuario elige; `put*` crean un
 * Blob y hacen clic en un `<a download>`. `jsdom` es la única dependencia nueva de este ticket
 * — `apps/web` no la traía porque LILA-057 no montaba el DOM en sus tests (ver
 * `exportar.test.ts`); aquí sí hace falta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserStore } from './BrowserStore';
import type { ProcessData } from './ProjectStore';

/** Simula la elección del usuario: encuentra el `<input>` que crea `getProcess` y lo dispara. */
function elegirArchivo(file: File): void {
  const input = document.body.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('getProcess no creó el input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('BrowserStore', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('getProcess', () => {
    it('devuelve el proceso ya cargado sin tocar el DOM', async () => {
      const semilla: ProcessData = { xml: '<xml-pedido/>', name: 'model.bpmn' };
      const store = new BrowserStore(new Map([['pedido', semilla]]));

      await expect(store.getProcess('pedido')).resolves.toEqual(semilla);
      expect(document.body.querySelector('input[type="file"]')).toBeNull();
    });

    it('abre un selector de archivo cuando el id no está en memoria', async () => {
      const store = new BrowserStore();
      const promesa = store.getProcess('nuevo');

      const archivo = new File(['<xml-elegido/>'], 'elegido.bpmn', { type: 'application/xml' });
      elegirArchivo(archivo);

      await expect(promesa).resolves.toEqual({ xml: '<xml-elegido/>', name: 'elegido.bpmn' });
      // El input se retira del DOM tras resolver: no deja huérfanos entre aperturas.
      expect(document.body.querySelector('input[type="file"]')).toBeNull();
    });

    it('deja el archivo elegido disponible para próximas llamadas con el mismo id', async () => {
      const store = new BrowserStore();
      const primera = store.getProcess('x');
      elegirArchivo(new File(['<a/>'], 'a.bpmn', { type: 'application/xml' }));
      await primera;

      await expect(store.getProcess('x')).resolves.toEqual({ xml: '<a/>', name: 'a.bpmn' });
    });

    it('rechaza si el selector se cierra sin elegir nada', async () => {
      const store = new BrowserStore();
      const promesa = store.getProcess('nuevo');
      const input = document.body.querySelector('input[type="file"]');
      input?.dispatchEvent(new Event('change'));

      await expect(promesa).rejects.toThrow('No se eligió ningún archivo.');
    });
  });

  describe('listProcesses', () => {
    it('incluye la semilla inicial', async () => {
      const store = new BrowserStore(
        new Map([['pedido', { xml: '<x/>', name: 'model.bpmn' }]]),
      );

      await expect(store.listProcesses()).resolves.toEqual([
        { id: 'pedido', name: 'model.bpmn' },
      ]);
    });
  });

  describe('descargas', () => {
    beforeEach(() => {
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn(() => 'blob:mock'),
        revokeObjectURL: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('putProcess descarga el xml con el nombre del proceso', async () => {
      const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const store = new BrowserStore(
        new Map([['pedido', { xml: '<viejo/>', name: 'model.bpmn' }]]),
      );

      await store.putProcess('pedido', '<nuevo/>');

      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(clic).toHaveBeenCalledTimes(1);
      // El anchor que disparó el clic es el mismo al que se le puso el nombre de descarga.
      expect(clic.mock.instances[0]).toMatchObject({ download: 'model.bpmn', href: 'blob:mock' });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
      // Sin persistencia real, pero el estado en memoria sí queda al día para la próxima lectura.
      await expect(store.getProcess('pedido')).resolves.toEqual({
        xml: '<nuevo/>',
        name: 'model.bpmn',
      });
    });

    it('putScenario descarga un .scenario.json y queda en listScenarios', async () => {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const store = new BrowserStore();
      const escenario = { version: 1, name: 'as-is', model: 'model.bpmn', run: {} } as never;

      await store.putScenario('pedido', 'as-is', escenario);

      expect(URL.createObjectURL).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'application/json' }),
      );
      await expect(store.listScenarios('pedido')).resolves.toEqual(['as-is']);
    });

    it('putRun descarga un .result.json sin exigir un putScenario previo', async () => {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const store = new BrowserStore();
      const resultado = { elements: {}, flows: {}, resources: {}, bottlenecks: [] } as never;

      await expect(store.putRun('pedido', 'as-is', resultado)).resolves.toBeUndefined();
      expect(URL.createObjectURL).toHaveBeenCalled();
    });
  });
});
