import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { encodeLila } from '@lila/engine/project';
import { readLilaFile, writeLilaFile } from './lilaFile.js';
import { isLilaPath } from './openPath.js';
import { ProjectIOError } from './projectIO.js';
import type { ProjectDocument } from './projectTypes.js';

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

  it('un archivo que no es un zip falla como error de proyecto, con código', async () => {
    const file = join(await carpeta(), 'roto.lila');
    await writeFile(file, 'esto no es un zip', 'utf8');

    await expect(readLilaFile(file)).rejects.toThrow(ProjectIOError);
    await expect(readLilaFile(file)).rejects.toMatchObject({ code: 'E-ZIP' });
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
