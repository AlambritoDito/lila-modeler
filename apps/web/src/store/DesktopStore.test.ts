// @vitest-environment jsdom
/**
 * `DesktopStore` con un `LilaBridge` falso (sin Electron): cubre cancelación, error, "guardar
 * como" cancelado y la ida y vuelta de escenarios/corridas que pide OP-08.
 */
import { describe, expect, it } from 'vitest';
import type { LilaBridge, LilaProjectDocument } from '../../../desktop/src/bridge.js';
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
  readonly writes: { dir: string; document: ProjectDocument }[] = [];
  writeShouldFail = false;
  readProjectImpl: ((dir: string) => Promise<LilaProjectDocument>) | null = null;

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

  async writeProject(dir: string, document: ProjectDocument): Promise<void> {
    if (this.writeShouldFail) throw new Error('E-FALLO-SIMULADO: escritura rechazada por el test.');
    this.writes.push({ dir, document });
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
    expect(bridge.writes).toEqual([{ dir: '/carpeta/nueva', document: doc }]);
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

  it('con carpeta activa (de un createProject previo): guarda sin volver a preguntar', async () => {
    const bridge = new FakeBridge();
    bridge.queueChooseFolder('/carpeta/pedido');
    const store = new DesktopStore(bridge);
    await store.createProject(documentoBase());

    const doc2 = documentoBase({ name: 'Pedido v2' });
    await expect(store.saveProject(doc2)).resolves.toEqual(doc2);
    expect(bridge.writes).toEqual([
      { dir: '/carpeta/pedido', document: documentoBase() },
      { dir: '/carpeta/pedido', document: doc2 },
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
    expect(bridge.writes.at(-1)).toEqual({ dir: '/carpeta/original', document: doc2 });
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
    expect(bridge.writes.at(-1)).toEqual({ dir: '/carpeta/pedido', document: docBueno });
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
