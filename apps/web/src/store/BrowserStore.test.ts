// @vitest-environment jsdom
/**
 * Aceptación de LILA-058: «la demo abre y descarga archivos». Lo que hay que verificar es que
 * `BrowserStore` habla con el DOM como se espera: `getProcess` dispara un `<input type=file>`
 * real y resuelve con lo que el usuario elige; `put*` crean un Blob y hacen clic en un
 * `<a download>`. `jsdom` es la única dependencia nueva de este ticket — `apps/web` no la traía
 * porque LILA-057 no montaba el DOM en sus tests (ver `exportar.test.ts`); aquí sí hace falta.
 *
 * LILA-067 adds the `localStorage` mirror, and the last block below covers the three cases that
 * decide whether the public demo is trustworthy: the session comes back in a new instance (a
 * reload), corrupt stored content falls back to the seed instead of breaking the boot, and a
 * full quota leaves the store working in memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeLila, encodeLila } from '@lila/engine/project';
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
  // Cada caso arranca sin sesión guardada: desde LILA-067 el store escribe en `localStorage`, y
  // sin esto lo que persiste un test lo hereda el siguiente al construir su propio store.
  beforeEach(() => {
    localStorage.clear();
  });

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

    // Lo que dispara de verdad cerrar el diálogo nativo: `cancel`, no `change`. Antes no se
    // escuchaba, así que la promesa se quedaba pendiente para siempre y el `<input>` vivía en
    // el `<body>` hasta recargar la página: seis «Abrir .bpmn» cancelados, seis huérfanos.
    it('resuelve con null y limpia el DOM si el diálogo se cierra sin elegir nada', async () => {
      const store = new BrowserStore();
      const promesa = store.getProcess('nuevo');
      document.body.querySelector('input[type="file"]')?.dispatchEvent(new Event('cancel'));

      await expect(promesa).resolves.toBeNull();
      expect(document.body.querySelector('input[type="file"]')).toBeNull();
    }, 1000);

    it('no deja inputs huérfanos tras varias cancelaciones seguidas', async () => {
      const store = new BrowserStore();
      for (let i = 0; i < 5; i++) {
        const promesa = store.getProcess(`nuevo-${String(i)}`);
        document.body.querySelector('input[type="file"]')?.dispatchEvent(new Event('cancel'));
        await promesa;
      }

      expect(document.body.querySelectorAll('input[type="file"]')).toHaveLength(0);
    }, 1000);

    it('un `change` sin archivo también se trata como cancelación', async () => {
      const store = new BrowserStore();
      const promesa = store.getProcess('nuevo');
      document.body.querySelector('input[type="file"]')?.dispatchEvent(new Event('change'));

      await expect(promesa).resolves.toBeNull();
    }, 1000);
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

  /**
   * El contenedor `.lila` (ADR-027, #317): la demo pasa a descargar el proyecto zipeado en vez de
   * un `.lila.json`. Lo que hay que fijar es que lo escrito se puede volver a abrir y que el
   * formato viejo —el que ya está en el disco de quien usó la demo antes— sigue abriéndose.
   */
  describe('proyectos .lila', () => {
    const DOC = {
      version: 1 as const,
      id: 'p1',
      name: 'Pedido',
      model: { id: 'Process_1', name: 'model.bpmn', xml: '<definitions/>', revision: 4 },
      scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS' } },
      scenarioRevisions: { 'as-is.scenario.json': 2 },
      runs: [],
    };

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

    it('saveProject descarga un .lila con su propio MIME', async () => {
      const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const store = new BrowserStore();

      await store.saveProject(DOC);

      expect(clic.mock.instances[0]).toMatchObject({ download: 'Pedido.lila' });
      const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
      expect(blob.type).toBe('application/vnd.lila-modeler+zip');
      // Lo descargado es exactamente lo que `decodeLila` vuelve a leer: la ida y la vuelta del
      // formato ya la cubre el motor, aquí importa que sea ESTO lo que se escribe.
      expect(decodeLila(new Uint8Array(await blob.arrayBuffer()))).toEqual(DOC);
    });

    it('openProject abre el .lila que acaba de descargarse', async () => {
      const store = new BrowserStore();
      const promesa = store.openProject();
      elegirArchivo(new File([encodeLila(DOC)], 'Pedido.lila'));

      await expect(promesa).resolves.toEqual(DOC);
    });

    it('openProject sigue abriendo el .lila.json de antes de ADR-027', async () => {
      const store = new BrowserStore();
      const promesa = store.openProject();
      elegirArchivo(new File([JSON.stringify(DOC)], 'Pedido.lila.json', { type: 'application/json' }));

      await expect(promesa).resolves.toEqual(DOC);
    });
  });

  // El espejo en `localStorage` (LILA-067): lo que hace que la demo publicada en GitHub Pages
  // aguante un F5. Las descargas siguen ocurriendo en todos estos casos, así que hace falta el
  // mismo doblaje de `URL` y del clic que en el bloque anterior.
  describe('persistencia en localStorage', () => {
    it('restores the exact saved project rather than the seed collections', async () => {
      const store = new BrowserStore();
      const doc = { version: 1 as const, id: 'custom', name: 'Saved project',
        model: { id: 'P', name: 'model.bpmn', xml: '<definitions/>', revision: 4 },
        // El nombre lleva el sufijo del formato: desde ADR-027 guardar produce un `.lila`, cuyas
        // entradas son las MISMAS que las de la carpeta ADR-018 (`<nombre>.scenario.json`), y el
        // escritor de carpetas ya lo exigía. El resto del caso —el borrador inválido— no cambia.
        scenarios: { 'draft.scenario.json': { version: 1, name: 'Draft', run: { duration: -1 } } },
        scenarioRevisions: { 'draft.scenario.json': 2 }, runs: [] };
      await store.saveProject(doc);
      expect(new BrowserStore().restoreSession()).toEqual(doc);
      doc.name = 'Later unsaved edit';
      expect(store.restoreSession()?.name).toBe('Saved project');
    });

    const SEMILLA = new Map([['pedido', { xml: '<viejo/>', name: 'model.bpmn' }]]);
    const ESCENARIO = { version: 1, name: 'as-is', model: 'model.bpmn', run: {} } as never;

    beforeEach(() => {
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn(() => 'blob:mock'),
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('una instancia nueva recupera procesos y escenarios de la sesión anterior', async () => {
      const store = new BrowserStore(SEMILLA);
      await store.putProcess('pedido', '<nuevo/>');
      await store.putScenario('pedido', 'as-is', ESCENARIO);

      // Lo que ve el navegador al recargar: mismo `main.tsx`, misma semilla, otro objeto.
      const recargado = new BrowserStore(SEMILLA);

      await expect(recargado.getProcess('pedido')).resolves.toEqual({
        xml: '<nuevo/>',
        name: 'model.bpmn',
      });
      await expect(recargado.listScenarios('pedido')).resolves.toEqual(['as-is']);
    });

    it('la semilla sigue disponible para los ids que la sesión guardada no cubre', async () => {
      const store = new BrowserStore();
      await store.putScenario('otro', 'as-is', ESCENARIO);

      // La sesión guardada no tiene ni un proceso: si pisara a la semilla en vez de escribirse
      // encima, quien guardó un escenario antes de tocar el modelo se quedaría sin el ejemplo.
      await expect(new BrowserStore(SEMILLA).listProcesses()).resolves.toEqual([
        { id: 'pedido', name: 'model.bpmn' },
      ]);
    });

    it.each([
      ['JSON roto', '{esto no es json'],
      ['forma inesperada', '{"processes":42,"scenarios":{},"runs":{}}'],
    ])('arranca con la semilla si lo guardado no sirve (%s)', async (_caso, guardado) => {
      localStorage.setItem('lila.project.v1', guardado);
      const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const store = new BrowserStore(SEMILLA);

      await expect(store.getProcess('pedido')).resolves.toEqual({
        xml: '<viejo/>',
        name: 'model.bpmn',
      });
      expect(aviso).toHaveBeenCalledTimes(1);
      // Y la clave rota se retira: el siguiente guardado escribe sobre terreno limpio y el
      // aviso no vuelve en cada recarga.
      expect(localStorage.getItem('lila.project.v1')).toBeNull();
    });

    it('sigue funcionando en memoria si `setItem` se queda sin cuota', async () => {
      const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('cuota agotada', 'QuotaExceededError');
      });
      const store = new BrowserStore(SEMILLA);

      await store.putProcess('pedido', '<nuevo/>');
      await store.putScenario('pedido', 'as-is', ESCENARIO);

      // Ni la excepción sale del store ni se pierde nada de lo que la pestaña ya tenía.
      await expect(store.getProcess('pedido')).resolves.toEqual({
        xml: '<nuevo/>',
        name: 'model.bpmn',
      });
      await expect(store.listScenarios('pedido')).resolves.toEqual(['as-is']);
      // Dos escrituras fallidas, un solo aviso: el problema se ve en la consola sin inundarla.
      expect(aviso).toHaveBeenCalledTimes(1);
    });
  });
});
