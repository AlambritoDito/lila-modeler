import { mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unzipSync } from 'fflate';

import { decodeLila, encodeLila, withCatalog } from '../../src/project/index.js';
import type { ProjectDocument } from '../../src/project/index.js';
import {
  isLilaPath,
  isOwnSnapshot,
  openLilaProcess,
  ProjectIOError,
  readLilaFile,
  writeLilaFile,
  writeLilaScenario,
  writeProjectFolder,
} from '../../src/project-fs/index.js';
import { BROKEN, v3Entries, v3Fixture } from '../project/fixtures/lila-v3.js';

/**
 * Carpetas reales con `mkdtemp`, igual que `projectIO.test.ts`: lo que se comprueba aquí es el
 * lado de disco del `.lila` (ADR-027) —el temporal + `rename` y la traducción de errores de
 * formato a `ProjectIOError`—, no el formato en sí, que tiene sus propias pruebas en el motor.
 */
const XML = '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>';

function documento(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    version: 1,
    id: 'p1',
    name: 'pedido',
    model: { id: 'Process_1', name: 'model.bpmn', xml: XML, revision: 3 },
    scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS' } },
    scenarioRevisions: { 'as-is.scenario.json': 2 },
    runs: [],
    ...overrides,
  };
}

async function carpeta(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'lila-file-'));
}

describe('isLilaPath', () => {
  it('acepta la extensión sin importar las mayúsculas y rechaza el resto', () => {
    expect(isLilaPath('/x/pedido.lila')).toBe(true);
    expect(isLilaPath('/x/PEDIDO.LILA')).toBe(true);
    expect(isLilaPath('/x/model.bpmn')).toBe(false);
    expect(isLilaPath('/x/pedido.lila.json')).toBe(false);
  });
});

describe('writeLilaFile / readLilaFile', () => {
  it('escribe y vuelve a leer el proyecto entero', async () => {
    const file = join(await carpeta(), 'pedido.lila');
    await writeLilaFile(file, documento());

    const { document, problems, loose } = await readLilaFile(file);
    expect(document).toEqual(documento());
    expect(problems).toEqual([]);
    // Un `.lila` es un proyecto por construcción: nunca un diagrama suelto.
    expect(loose).toBe(false);
  });

  it('no deja temporales detrás', async () => {
    const dir = await carpeta();
    await writeLilaFile(join(dir, 'pedido.lila'), documento());
    expect(await readdir(dir)).toEqual(['pedido.lila']);
  });

  it('sobrescribe sin dejar el archivo anterior a medias', async () => {
    const file = join(await carpeta(), 'pedido.lila');
    await writeLilaFile(file, documento());
    await writeLilaFile(file, documento({ name: 'pedido v2', model: { id: 'Process_1', name: 'model.bpmn', xml: XML, revision: 4 } }));

    const { document } = await readLilaFile(file);
    expect(document.name).toBe('pedido v2');
    expect(document.model.revision).toBe(4);
  });

  it('un archivo que no es un zip falla como error de proyecto, con código y mensaje en español', async () => {
    const file = join(await carpeta(), 'roto.lila');
    await writeFile(file, 'esto no es un zip', 'utf8');

    await expect(readLilaFile(file)).rejects.toThrow(ProjectIOError);
    // El código viene de un mapa explícito, no de recortarle el prefijo al del motor (hallazgo 6
    // del QA a #323), y el mensaje es propio: el del motor está en inglés.
    await expect(readLilaFile(file)).rejects.toMatchObject({
      code: 'E-ZIP',
      message: 'El archivo no es un .lila legible (no se pudo descomprimir).',
    });
  });

  it('un documento inválido al escribir también sale traducido', async () => {
    const file = join(await carpeta(), 'pedido.lila');
    const roto = { ...documento(), runs: [{ id: 'r1' }] } as unknown as ProjectDocument;
    await expect(writeLilaFile(file, roto)).rejects.toMatchObject({ code: 'E-CORRIDA' });
  });

  it('un archivo que no existe se distingue de uno ilegible', async () => {
    const file = join(await carpeta(), 'ausente.lila');
    await expect(readLilaFile(file)).rejects.toMatchObject({ code: 'E-SIN-MODELO' });
  });

  it('un zip sin manifiesto no se abre como proyecto', async () => {
    const file = join(await carpeta(), 'ajeno.lila');
    const bytes = encodeLila(documento());
    // Se reusa un `.lila` válido y se le quita el manifiesto por el camino más corto: escribir el
    // zip de otro contenido cualquiera bastaría, pero así el resto de la estructura sigue siendo
    // la real y lo único distinto es lo que la prueba dice.
    const { unzipSync, zipSync } = await import('fflate');
    const entries = unzipSync(bytes);
    delete entries['lila-project.json'];
    await writeFile(file, zipSync(entries));

    await expect(readLilaFile(file)).rejects.toMatchObject({ code: 'E-NO-MANIFEST' });
  });

  it('el archivo escrito es un zip de verdad (empieza por PK)', async () => {
    const file = join(await carpeta(), 'pedido.lila');
    await writeLilaFile(file, documento());
    expect((await readFile(file)).subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

/**
 * Las mismas guardias que `writeProjectFolder` aplica a la carpeta (hallazgo 3 del QA a #323):
 * el contenedor cambia, el contrato del puente no. Se prueban con archivos reales porque lo que
 * distingue "lo tocó otro" de "lo escribí yo" es el `stat` del archivo, no un mock.
 */
describe('writeLilaFile: guardias de "Guardar como" y de cambio externo', () => {
  it('«Guardar como» sobre el .lila de OTRO proyecto se rechaza con E-CARPETA-OCUPADA', async () => {
    const file = join(await carpeta(), 'ajeno.lila');
    await writeLilaFile(file, documento({ id: 'otro-proyecto' }));

    await expect(writeLilaFile(file, documento({ id: 'p1' }), { saveAs: true })).rejects.toMatchObject({
      code: 'E-CARPETA-OCUPADA',
    });
    // Y no lo tocó: el archivo sigue siendo el del otro proyecto.
    expect((await readLilaFile(file)).document.id).toBe('otro-proyecto');
  });

  it('«Guardar como» sobre el .lila del MISMO proyecto, o sobre un archivo que no existe, pasa', async () => {
    const dir = await carpeta();
    const nuevo = join(dir, 'nuevo.lila');
    await writeLilaFile(nuevo, documento(), { saveAs: true });
    expect((await readLilaFile(nuevo)).document.id).toBe('p1');

    await writeLilaFile(nuevo, documento({ name: 'pedido v2' }), { saveAs: true });
    expect((await readLilaFile(nuevo)).document.name).toBe('pedido v2');
  });

  it('un cambio externo desde la última lectura se rechaza, y con overwrite se acepta', async () => {
    const file = join(await carpeta(), 'pedido.lila');
    await writeLilaFile(file, documento());
    await readLilaFile(file);

    // Otro proceso reescribe el archivo: distinto tamaño y distinta mtime.
    await writeFile(file, 'tocado por fuera');
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));

    await expect(writeLilaFile(file, documento({ name: 'pedido v2' }))).rejects.toMatchObject({
      code: 'E-CAMBIO-EXTERNO',
    });
    await writeLilaFile(file, documento({ name: 'pedido v2' }), { overwrite: true });
    expect((await readLilaFile(file)).document.name).toBe('pedido v2');
  });

  it('guardados propios consecutivos no disparan nada', async () => {
    const file = join(await carpeta(), 'pedido.lila');
    await writeLilaFile(file, documento());
    await writeLilaFile(file, documento({ name: 'v2' }));
    await writeLilaFile(file, documento({ name: 'v3' }));
    expect((await readLilaFile(file)).document.name).toBe('v3');
  });
});

describe('isOwnSnapshot (#539)', () => {
  it('tells this process\'s own write from a later one by someone else, without updating the snapshot', async () => {
    const dir = await carpeta();
    const file = join(dir, 'pedido.lila');
    expect(await isOwnSnapshot(file)).toBe(true); // Never seen and absent: nothing to report.
    await writeLilaFile(file, documento());
    expect(await isOwnSnapshot(file)).toBe(true);
    await writeFile(file, encodeLila(documento({ name: 'de un agente' })));
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(await isOwnSnapshot(file)).toBe(false);
    expect(await isOwnSnapshot(file)).toBe(false); // Still foreign: asking does not remember it.
    await expect(writeLilaFile(file, documento())).rejects.toMatchObject({ code: 'E-CAMBIO-EXTERNO' });
    await readLilaFile(file);
    expect(await isOwnSnapshot(file)).toBe(true);
  });

  it('a file this process never saw that exists is not its own', async () => {
    const file = join(await carpeta(), 'nuevo.lila');
    await writeFile(file, encodeLila(documento()));
    expect(await isOwnSnapshot(file)).toBe(false);
  });
});

describe('version 3 and the entries kept beside the document (#92, RM-01 § 1.4, § 8)', () => {
  /** Every entry of `bytes`, as text, minus the ones named. */
  function untouched(bytes: Uint8Array, except: (name: string) => boolean): Record<string, string> {
    return Object.fromEntries(
      Object.entries(unzipSync(bytes))
        .filter(([name]) => !except(name))
        .map(([name, data]) => [name, Buffer.from(data).toString('base64')]),
    );
  }

  it('a save carries the entries of the archive it overwrites, byte for byte', async () => {
    const file = join(await carpeta(), 'hotel.lila');
    const fixture = v3Fixture({ notes: true });
    await writeFile(file, fixture);
    const { document } = await readLilaFile(file);
    // The document alone does not hold them; `writeLilaFile` takes them from the file, in the lock.
    await writeLilaFile(file, document);
    expect(Buffer.from(await readFile(file)).equals(Buffer.from(fixture))).toBe(true);
  });

  it('an agent write (a scenario) keeps the catalog, the broken object, maps/ and notes.md untouched', async () => {
    const file = join(await carpeta(), 'hotel.lila');
    const fixture = v3Fixture({ notes: true });
    await writeFile(file, fixture);
    const input = await openLilaProcess(file, { process: 'billing' });
    await writeLilaScenario(input, 'to-be', { version: 1, name: 'TO-BE', extends: 'as-is.scenario.json' });
    const after = new Uint8Array(await readFile(file));
    const touched = (name: string): boolean => name === 'lila-project.json' || name.startsWith('processes/billing/');
    expect(untouched(after, touched)).toEqual(untouched(fixture, touched));
    expect(Object.keys(unzipSync(after))).toEqual(
      expect.arrayContaining([`catalog/role/${BROKEN}.json`, 'maps/x.json', 'notes.md', 'processes/billing/to-be.scenario.json']),
    );
    const manifest = JSON.parse(Buffer.from(unzipSync(after)['lila-project.json']!).toString('utf8')) as { version: number };
    expect(manifest.version).toBe(3);
    expect(v3Entries({ notes: true }).length + 1).toBe(Object.keys(unzipSync(after)).length);
  });

  it('a «Save as» starts a new copy: it does not take the entries of the file it replaces', async () => {
    const file = join(await carpeta(), 'hotel.lila');
    await writeFile(file, v3Fixture({ notes: true }));
    const { document } = await readLilaFile(file);
    await writeLilaFile(file, document, { saveAs: true, overwrite: true });
    const names = Object.keys(unzipSync(new Uint8Array(await readFile(file))));
    expect(names).not.toContain('notes.md');
    expect(names).toContain('catalog/role/role-7k2m9q4x1pzd.json');
  });

  it('a file of another project lends nothing; `preserved: null` writes none', async () => {
    const file = join(await carpeta(), 'hotel.lila');
    await writeFile(file, v3Fixture({ notes: true }));
    const other = withCatalog(documento(), [{ type: 'role', id: 'rol-1', name: 'Cashier', revision: 1 }]);
    await writeLilaFile(file, other, { overwrite: true });
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(file))))).not.toContain('notes.md');
    await writeFile(file, v3Fixture({ notes: true }));
    const { document } = await readLilaFile(file);
    await writeLilaFile(file, document, { overwrite: true, preserved: null });
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(file))))).not.toContain('notes.md');
  });

  it('a version 3 project is not written to a folder until the folder adapter exists (#671)', async () => {
    const dir = await carpeta();
    const v3 = decodeLila(v3Fixture());
    await expect(writeProjectFolder(dir, v3)).rejects.toMatchObject({ code: 'E-DOCUMENTO' });
    expect(await readdir(dir)).toEqual([]);
  });
});
