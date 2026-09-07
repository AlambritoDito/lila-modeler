// @vitest-environment jsdom
/**
 * `DesktopStore` con un `LilaBridge` falso (sin Electron): cubre cancelación, error, "guardar
 * como" cancelado y la ida y vuelta de escenarios/corridas que pide OP-08.
 */
import { describe, expect, it } from 'vitest';
import type { LilaBridge, LilaProjectDocument, OpenPathRequest, Recent } from '../../../desktop/src/bridge.js';
import { DesktopStore } from './DesktopStore';
import type { ProjectDocument } from './ProjectStore';

const XML_MINIMO = '<?xml version="1.0"?><definitions xmlns="http://example.org"/>';

function documentoBase(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    version: 1,
    id: 'proyecto-1',
    name: 'Pedido',
    model: { id: 'Process_1', name: 'Pedido', xml: XML_MINIMO, revision: 1 },
    scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS' } },
    scenarioRevisions: { 'as-is.scenario.json': 1 },
    runs: [],
    ...overrides,
  };
}

class FakeBridge implements LilaBridge {
  readonly platform = 'desktop' as const;
  readonly version = 'test';

  private readonly chooseFolderQueue: (string | null)[] = [];
  readonly writes: { dir: string; document: ProjectDocument; options?: { saveAs?: boolean; overwrite?: boolean } }[] = [];
  writeShouldFail = false;
  readProjectImpl: ((dir: string) => Promise<LilaProjectDocument>) | null = null;
  readonly dirtyHistory: boolean[] = [];
  private closeRequestedCb: (() => Promise<boolean>) | null = null;

  /** Encola el próximo (o los próximos) resultado(s) de `chooseFolder`. */
  queueChooseFolder(...results: (string | null)[]): void {
    this.chooseFolderQueue.push(...results);
  }

  async chooseFolder(): Promise<string | null> {
    if (this.chooseFolderQueue.length === 0) {
      throw new Error('FakeBridge.chooseFolder: no queda ningún resultado encolado en el test.');
    }
    return this.chooseFolderQueue.shift() as string | null;
  }

  async readProject(dir: string): Promise<LilaProjectDocument> {
    if (this.readProjectImpl === null) {
      throw new Error('FakeBridge.readProject: no se configuró `readProjectImpl` en el test.');
    }
    return this.readProjectImpl(dir);
  }

  async writeProject(
    dir: string,
    document: ProjectDocument,
    options?: { saveAs?: boolean; overwrite?: boolean },
  ): Promise<void> {
    if (this.writeShouldFail) throw new Error('E-FALLO-SIMULADO: escritura rechazada por el test.');
    this.writes.push(options === undefined ? { dir, document } : { dir, document, options });
  }

  setDirty(dirty: boolean): void {
    this.dirtyHistory.push(dirty);
  }

  onCloseRequested(cb: () => Promise<boolean>): () => void {
    this.closeRequestedCb = cb;
    return () => {
      this.closeRequestedCb = null;
    };
  }

  /** Simula que main pidió guardar antes de cerrar (`lila:close-requested`). */
  async triggerCloseRequested(): Promise<boolean> {
    if (this.closeRequestedCb === null) {
      throw new Error('FakeBridge.triggerCloseRequested: no hay callback registrado (onSaveRequested).');
    }
    return this.closeRequestedCb();
  }

  recents: Recent[] = [];
  openRecentImpl: ((dir: string) => Promise<LilaProjectDocument | null>) | null = null;
  private openPathCb: ((path: OpenPathRequest) => void) | null = null;
  pendingOpenPathQueue: (OpenPathRequest | null)[] = [];

  async listRecents(): Promise<readonly Recent[]> {
    return this.recents;
  }

  async openRecent(dir: string): Promise<LilaProjectDocument | null> {
    if (this.openRecentImpl === null) {
      throw new Error('FakeBridge.openRecent: no se configuró `openRecentImpl` en el test.');
    }
    return this.openRecentImpl(dir);
  }

  async pendingOpenPath(): Promise<OpenPathRequest | null> {
    return this.pendingOpenPathQueue.shift() ?? null;
  }

  onOpenPath(cb: (path: OpenPathRequest) => void): () => void {
    this.openPathCb = cb;
    return () => {
      this.openPathCb = null;
    };
  }

  triggerOpenPath(path: OpenPathRequest): void {
    if (this.openPathCb === null) {
      throw new Error('FakeBridge.triggerOpenPath: no hay callback registrado (onOpenPath).');
    }
    this.openPathCb(path);
  }
}

describe('DesktopStore.createProject', () => {
  it('cancelación (chooseFolder → null) devuelve null y no escribe nada', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder(null);
    const store = new DesktopStore(bridge);

    await expect(store.createProject(documentoBase())).resolves.toBeNull();
    expect(bridge.writes).toEqual([]);
  });

  it('éxito: escribe el documento y lo devuelve', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/nueva');
    const store = new DesktopStore(bridge);
    const doc = documentoBase();

    await expect(store.createProject(doc)).resolves.toEqual(doc);
    expect(bridge.writes).toEqual([{ dir: '/carpeta/nueva', document: doc, options: { saveAs: true } }]);
  });

  it('carpeta ocupada (writeProject rechaza E-CARPETA-OCUPADA): rechaza y no deja el proyecto como activo (OP-14, revisión de A, issues #71/#74)', async () => {
    // Simula lo que hace `assertFolderNotOccupied` en `projectIO.ts` cuando main recibe
    // `saveAs: true` sobre una carpeta con otro proyecto: rechaza sin escribir. La cobertura real
    // de esa lógica (con fs real) vive en `projectIO.test.ts`; esto verifica que `DesktopStore`
    // realmente le manda `saveAs: true` para que esa comprobación llegue a correr.
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/ocupada');
    bridge.writeProject = async (_dir, _document, options) => {
      if (options?.saveAs === true) throw new Error('E-CARPETA-OCUPADA: la carpeta ya contiene otro proyecto.');
    };
    const store = new DesktopStore(bridge);

    await expect(store.createProject(documentoBase())).rejects.toThrow('E-CARPETA-OCUPADA');
  });

  it('el error de writeProject rechaza la promesa', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/nueva');
    bridge.writeShouldFail = true;
    const store = new DesktopStore(bridge);

    await expect(store.createProject(documentoBase())).rejects.toThrow('E-FALLO-SIMULADO');
  });
});

describe('DesktopStore.openProject', () => {
  it('cancelación devuelve null', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder(null);
    const store = new DesktopStore(bridge);

    await expect(store.openProject()).resolves.toBeNull();
  });

  it('ida y vuelta: separa "problems" y castea runs[].result a RunResult', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const run = {
      id: 'run-1',
      scenarioName: 'as-is.scenario.json',
      result: { kpis: { total: 7 } },
      inputs: { modelRevision: 1, scenarioRevision: 1, xml: XML_MINIMO, scenario: {} },
    };
    const raw: LilaProjectDocument = {
      ...documentoBase(),
      runs: [run],
      problems: [{ file: 'roto.scenario.json', message: 'JSON inválido' }],
    };
    bridge.readProjectImpl = async () => raw;
    const store = new DesktopStore(bridge);

    const document = await store.openProject();

    expect(document?.runs).toEqual([run]);
    expect(document?.scenarios).toEqual(raw.scenarios);
    expect(store.lastProblems).toEqual([{ file: 'roto.scenario.json', message: 'JSON inválido' }]);
  });

  it('el error de readProject rechaza la promesa', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    bridge.readProjectImpl = async () => {
      throw new Error('E-SIN-MODELO: falta model.bpmn');
    };
    const store = new DesktopStore(bridge);

    await expect(store.openProject()).rejects.toThrow('E-SIN-MODELO');
  });
});

describe('DesktopStore.saveProject', () => {
  it('sin carpeta activa: pide carpeta; cancelar devuelve null sin escribir', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder(null);
    const store = new DesktopStore(bridge);

    await expect(store.saveProject(documentoBase())).resolves.toBeNull();
    expect(bridge.writes).toEqual([]);
  });

  it('sin carpeta activa (primer guardado): pasa { saveAs: true } aunque no se pida "Guardar como" (OP-14, revisión de A: P0 "nuevo proyecto sobre carpeta ocupada aún sobrescribe", issues #71/#74)', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/recien-elegida');
    const store = new DesktopStore(bridge);
    const doc = documentoBase();

    await expect(store.saveProject(doc)).resolves.toEqual(doc);
    expect(bridge.writes).toEqual([
      { dir: '/carpeta/recien-elegida', document: doc, options: { saveAs: true, overwrite: false } },
    ]);
  });

  it('con carpeta activa (de un createProject previo): guarda sin volver a preguntar', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase());

    const doc2 = documentoBase({ name: 'Pedido v2' });
    await expect(store.saveProject(doc2)).resolves.toEqual(doc2);
    expect(bridge.writes).toEqual([
      { dir: '/carpeta/pedido', document: documentoBase(), options: { saveAs: true } },
      { dir: '/carpeta/pedido', document: doc2, options: { saveAs: false, overwrite: false } },
    ]);
  });

  it('"guardar como" cancelado conserva la carpeta activa anterior', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/original');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase());

    bridge.queueChooseFolder(null); // el diálogo de "guardar como" se cierra sin elegir
    await expect(store.saveProject(documentoBase({ name: 'otro' }), { saveAs: true })).resolves.toBeNull();

    // La carpeta activa sigue siendo la original: el siguiente guardado normal escribe ahí.
    const doc2 = documentoBase({ name: 'tercero' });
    await store.saveProject(doc2);
    expect(bridge.writes.at(-1)).toEqual({
      dir: '/carpeta/original',
      document: doc2,
      options: { saveAs: false, overwrite: false },
    });
  });

  it('el error de writeProject rechaza y no cambia la carpeta activa', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase());

    bridge.writeShouldFail = true;
    await expect(store.saveProject(documentoBase({ name: 'roto' }))).rejects.toThrow('E-FALLO-SIMULADO');

    // La carpeta activa sigue siendo la de antes del fallo: un guardado que sí funcione escribe
    // en la misma carpeta, sin volver a preguntar.
    bridge.writeShouldFail = false;
    const docBueno = documentoBase({ name: 'bueno' });
    await store.saveProject(docBueno);
    expect(bridge.writes.at(-1)).toEqual({
      dir: '/carpeta/pedido',
      document: docBueno,
      options: { saveAs: false, overwrite: false },
    });
  });
});

describe('DesktopStore.saveProject — guardia de identidad (E-PROYECTO-DISTINTO)', () => {
  it('rechaza guardar (sin saveAs) un documento con otro id que el proyecto activo', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase({ id: 'proyecto-1' }));

    const otro = documentoBase({ id: 'proyecto-2' });
    await expect(store.saveProject(otro)).rejects.toThrow('E-PROYECTO-DISTINTO');
    // No se tocó el bridge: ni siquiera se preguntó por una carpeta ni se escribió nada.
    expect(bridge.writes).toEqual([
      { dir: '/carpeta/pedido', document: documentoBase({ id: 'proyecto-1' }), options: { saveAs: true } },
    ]);
  });

  it('así el shell nunca escribe el proyecto anterior en la carpeta recién abierta', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/anterior');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase({ id: 'proyecto-anterior' }));

    bridge.queueChooseFolder('/carpeta/nueva');
    bridge.readProjectImpl = async () => ({ ...documentoBase({ id: 'proyecto-nuevo' }), problems: [] });
    await store.openProject();

    // Un guardado (normal) con el documento viejo en memoria debe rechazarse, no escribirse en
    // "/carpeta/nueva" (la que acaba de quedar activa tras `openProject`).
    await expect(store.saveProject(documentoBase({ id: 'proyecto-anterior' }))).rejects.toThrow(
      'E-PROYECTO-DISTINTO',
    );
    expect(bridge.writes).toEqual([
      { dir: '/carpeta/anterior', document: documentoBase({ id: 'proyecto-anterior' }), options: { saveAs: true } },
    ]);
  });

  it('"Guardar como" (saveAs) sí permite escribir un documento con otro id', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase({ id: 'proyecto-1' }));

    bridge.queueChooseFolder('/carpeta/otra');
    const otro = documentoBase({ id: 'proyecto-2' });
    await expect(store.saveProject(otro, { saveAs: true })).resolves.toEqual(otro);
    expect(bridge.writes.at(-1)).toEqual({
      dir: '/carpeta/otra',
      document: otro,
      options: { saveAs: true, overwrite: false },
    });
  });

  it('sin proyecto activo (primer guardado), cualquier id es válido', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/nueva');
    const store = new DesktopStore(bridge);

    const doc = documentoBase({ id: 'lo-que-sea' });
    await expect(store.saveProject(doc)).resolves.toEqual(doc);
  });
});

describe('DesktopStore.setDirty / onSaveRequested', () => {
  it('setDirty reenvía al bridge', () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    store.setDirty(true);
    store.setDirty(false);
    expect(bridge.dirtyHistory).toEqual([true, false]);
  });

  it('onSaveRequested registra el callback en el bridge; su resultado vuelve tal cual', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    const unsubscribe = store.onSaveRequested(async () => true);

    await expect(bridge.triggerCloseRequested()).resolves.toBe(true);
    unsubscribe();
    await expect(bridge.triggerCloseRequested()).rejects.toThrow('no hay callback registrado');
  });
});

describe('DesktopStore — métodos históricos de ProjectStore (mínimo viable)', () => {
  it('putScenario/putRun sobre un proyecto ya abierto actualizan y persisten el documento activo', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase());

    await store.putScenario('Process_1', 'to-be', { version: 1, name: 'TO-BE' } as never);
    const nombres = await store.listScenarios('Process_1');
    expect([...nombres].sort()).toEqual(['as-is.scenario.json', 'to-be.scenario.json']);

    await store.putRun('Process_1', 'to-be', { kpis: { total: 3 } } as never);
    const ultimo = bridge.writes.at(-1)!.document;
    expect(ultimo.runs).toHaveLength(1);
    expect(ultimo.runs[0]?.scenarioName).toBe('to-be.scenario.json');
    expect(ultimo.runs[0]?.result).toEqual({ kpis: { total: 3 } });
  });

  it('getProcess con el mismo id que el modelo activo no vuelve a abrir carpeta', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase());

    const datos = await store.getProcess('Process_1');
    expect(datos).toEqual({ xml: XML_MINIMO, name: 'Pedido' });
  });
});

describe('DesktopStore — extensiones de OP-14 incremento 2 (recientes, apertura pendiente)', () => {
  it('listRecents reenvía al bridge', async () => {
    const bridge = new FakeBridge();
    bridge.recents = [{ dir: '/carpeta/pedido', name: 'Pedido', openedAt: '2026-01-01T00:00:00.000Z' }];
    const store = new DesktopStore(bridge);

    await expect(store.listRecents()).resolves.toEqual(bridge.recents);
  });

  it('openRecent: éxito, activa la carpeta/documento para guardados posteriores', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    const raw: LilaProjectDocument = { ...documentoBase(), problems: [] };
    bridge.openRecentImpl = async () => raw;

    const document = await store.openRecent('/carpeta/pedido');
    expect(document?.id).toBe('proyecto-1');

    // Queda activo: un guardado normal posterior escribe en la misma carpeta sin preguntar.
    await store.saveProject(documentoBase({ name: 'v2' }));
    expect(bridge.writes.at(-1)?.dir).toBe('/carpeta/pedido');
  });

  it('openRecent: la carpeta ya no existe (bridge devuelve null), no lanza', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    bridge.openRecentImpl = async () => null;

    await expect(store.openRecent('/carpeta/borrada')).resolves.toBeNull();
  });

  it('pendingOpenPath/onOpenPath reenvían al bridge', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    bridge.pendingOpenPathQueue = [{ dir: '/carpeta/pedido', file: 'model.bpmn' }];

    await expect(store.pendingOpenPath()).resolves.toEqual({ dir: '/carpeta/pedido', file: 'model.bpmn' });
    await expect(store.pendingOpenPath()).resolves.toBeNull(); // se consume una vez.

    const recibidos: OpenPathRequest[] = [];
    store.onOpenPath((path) => recibidos.push(path));
    bridge.triggerOpenPath({ dir: '/otra', file: 'model.bpmn' });
    expect(recibidos).toEqual([{ dir: '/otra', file: 'model.bpmn' }]);
  });
});
