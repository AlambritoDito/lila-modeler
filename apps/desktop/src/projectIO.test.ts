/**
 * Tests de `projectIO.ts` con carpetas temporales reales (`mkdtemp`) — sin Electron, tal como
 * permite que sea puro. Una de las carpetas lleva espacios y tilde a propósito (OP-08, "rutas con
 * espacios/tildes" del ticket).
 */
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectIOError, readProjectFolder, writeProjectFolder } from './projectIO.js';
import type { ProjectDocument, StoredRun } from './projectTypes.js';

/** Ejecuta `fn`, espera que rechace, y devuelve el error capturado (o falla la prueba si no rechaza). */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba que la promesa rechazara.');
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lila-projectIO-Prueba canción-'));
});

afterEach(async () => {
  // La carpeta de permisos-insuficientes queda en 0o500; hay que devolverle escritura antes de
  // poder borrarla, o `rm` falla con el mismo EACCES que estamos probando.
  await chmod(dir, 0o700).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

const XML_MINIMO = '<?xml version="1.0"?><definitions xmlns="http://example.org"/>';

function documentoBase(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    version: 1,
    id: 'proyecto-1',
    name: 'Pedido',
    model: { id: 'Process_1', name: 'Pedido', xml: XML_MINIMO, revision: 3 },
    scenarios: {
      'as-is.scenario.json': { version: 1, name: 'AS-IS', model: 'model.bpmn', run: { start: '2026-01-01T00:00:00-06:00' } },
    },
    scenarioRevisions: { 'as-is.scenario.json': 1 },
    runs: [],
    ...overrides,
  };
}

describe('readProjectFolder / writeProjectFolder — ida y vuelta', () => {
  it('escribe y relee un documento completo, incluida una corrida', async () => {
    const run: StoredRun = {
      id: 'run-1',
      scenarioName: 'as-is.scenario.json',
      result: { kpis: { total: 42 } },
      inputs: { modelRevision: 3, scenarioRevision: 1, xml: XML_MINIMO, scenario: { version: 1 } },
    };
    const doc = documentoBase({ runs: [run] });

    await writeProjectFolder(dir, doc);
    const { document, problems } = await readProjectFolder(dir);

    expect(problems).toEqual([]);
    expect(document.id).toBe('proyecto-1');
    expect(document.name).toBe('Pedido');
    expect(document.model).toEqual({ id: 'Process_1', name: 'Pedido', xml: XML_MINIMO, revision: 3 });
    expect(document.scenarios).toEqual(doc.scenarios);
    expect(document.scenarioRevisions).toEqual(doc.scenarioRevisions);
    expect(document.runs).toEqual([run]);
  });

  it('conserva "extends" literal, sin resolverlo ni reescribirlo', async () => {
    const doc = documentoBase({
      scenarios: {
        'as-is.scenario.json': { version: 1, name: 'AS-IS' },
        'to-be.scenario.json': { version: 1, name: 'TO-BE', extends: 'as-is.scenario.json', resources: { cajero: { capacity: 3 } } },
      },
    });

    await writeProjectFolder(dir, doc);
    const { document } = await readProjectFolder(dir);

    expect(document.scenarios['to-be.scenario.json']).toEqual(doc.scenarios['to-be.scenario.json']);
    expect((document.scenarios['to-be.scenario.json'] as { extends: string }).extends).toBe('as-is.scenario.json');
  });

  it('funciona en una ruta con espacios y tilde', async () => {
    expect(dir).toContain('canción');
    const doc = documentoBase();
    await writeProjectFolder(dir, doc);
    const { document } = await readProjectFolder(dir);
    expect(document.name).toBe('Pedido');
  });
});

describe('readProjectFolder — tolerancia', () => {
  it('falta model.bpmn: E-SIN-MODELO', async () => {
    const error = await captureError(() => readProjectFolder(dir));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-SIN-MODELO');
  });

  it('falta lila-project.json: se reconstruye con id nuevo y revisiones 0', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');

    const { document, problems } = await readProjectFolder(dir);

    expect(problems).toEqual([]);
    expect(document.id).toEqual(expect.any(String));
    expect(document.id.length).toBeGreaterThan(0);
    expect(document.model.revision).toBe(0);
    expect(document.scenarioRevisions).toEqual({});
    expect(document.model.xml).toBe(XML_MINIMO);
  });

  it('un *.scenario.json con JSON roto se excluye y queda en problems, sin descartar el proyecto', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    await writeFile(join(dir, 'as-is.scenario.json'), '{ "version": 1,', 'utf8');
    await writeFile(join(dir, 'ok.scenario.json'), JSON.stringify({ version: 1 }), 'utf8');

    const { document, problems } = await readProjectFolder(dir);

    expect(document.scenarios).toEqual({ 'ok.scenario.json': { version: 1 } });
    expect(problems).toEqual([{ file: 'as-is.scenario.json', message: expect.any(String) }]);
  });

  it('un *.scenario.json que no es un objeto (array) también se excluye y queda en problems', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    await writeFile(join(dir, 'raro.scenario.json'), '[1, 2, 3]', 'utf8');

    const { document, problems } = await readProjectFolder(dir);

    expect(document.scenarios).toEqual({});
    expect(problems).toEqual([{ file: 'raro.scenario.json', message: expect.any(String) }]);
  });

  it('lila-project.json roto se reconstruye y queda anotado en problems', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    await writeFile(join(dir, 'lila-project.json'), 'esto no es json', 'utf8');

    const { document, problems } = await readProjectFolder(dir);

    expect(document.model.revision).toBe(0);
    expect(problems).toEqual([{ file: 'lila-project.json', message: expect.any(String) }]);
  });
});

describe('writeProjectFolder — corridas duplicadas', () => {
  it('misma corrida con el mismo contenido: no-op, no lanza', async () => {
    const run: StoredRun = {
      id: 'run-1',
      scenarioName: 'as-is.scenario.json',
      result: { kpis: { total: 1 } },
      inputs: { modelRevision: 1, scenarioRevision: 1, xml: XML_MINIMO, scenario: {} },
    };
    const doc = documentoBase({ runs: [run] });
    await writeProjectFolder(dir, doc);
    await expect(writeProjectFolder(dir, doc)).resolves.toBeUndefined();
  });

  it('misma corrida con otro contenido: E-RUN-DUPLICADO, no se sobrescribe', async () => {
    const run: StoredRun = {
      id: 'run-1',
      scenarioName: 'as-is.scenario.json',
      result: { kpis: { total: 1 } },
      inputs: { modelRevision: 1, scenarioRevision: 1, xml: XML_MINIMO, scenario: {} },
    };
    const doc = documentoBase({ runs: [run] });
    await writeProjectFolder(dir, doc);

    const runDistinto: StoredRun = { ...run, result: { kpis: { total: 999 } } };
    const error = await captureError(() => writeProjectFolder(dir, documentoBase({ runs: [runDistinto] })));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-RUN-DUPLICADO');

    const enDisco = JSON.parse(await readFile(join(dir, 'runs', 'run-1.result.json'), 'utf8')) as StoredRun;
    expect(enDisco.result).toEqual({ kpis: { total: 1 } });
  });
});

describe('writeProjectFolder — fallo de escritura', () => {
  it('carpeta sin permiso de escritura: el archivo previo sigue intacto y no queda .tmp-*', async () => {
    if (process.getuid?.() === 0) return; // root ignora los bits de permiso; nada que probar.

    const doc = documentoBase();
    await writeProjectFolder(dir, doc);
    const previo = await readFile(join(dir, 'model.bpmn'), 'utf8');

    await chmod(dir, 0o500);
    const docNuevo = documentoBase({ model: { ...doc.model, xml: '<cambiado/>' } });
    await expect(writeProjectFolder(dir, docNuevo)).rejects.toThrow();
    await chmod(dir, 0o700);

    const actual = await readFile(join(dir, 'model.bpmn'), 'utf8');
    expect(actual).toBe(previo);

    const entradas = await readdir(dir);
    expect(entradas.some((nombre) => nombre.includes('.tmp-'))).toBe(false);
  });
});
