import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeLila } from '@lila-modeler/engine/project';
import type { ProjectDocument } from '@lila-modeler/engine/project';
import { writeLilaFile } from '@lila-modeler/engine/project-fs';
import { findBpmnArg, isBpmnPath, isMiscasedModelFile, openPathRequest, withLilaExtension } from './openPath.js';

describe('isBpmnPath', () => {
  it('acepta .bpmn en cualquier combinación de mayúsculas/minúsculas', () => {
    expect(isBpmnPath('/ruta/model.bpmn')).toBe(true);
    expect(isBpmnPath('/ruta/Model.BPMN')).toBe(true);
  });

  it('rechaza otras extensiones', () => {
    expect(isBpmnPath('/ruta/model.xml')).toBe(false);
    expect(isBpmnPath('/ruta/sin-extension')).toBe(false);
  });
});

describe('isMiscasedModelFile (LILA-206, P3 del QA)', () => {
  it('detecta model.bpmn escrito con otras mayúsculas', () => {
    expect(isMiscasedModelFile('Model.bpmn')).toBe(true);
    expect(isMiscasedModelFile('MODEL.BPMN')).toBe(true);
    expect(isMiscasedModelFile('model.BPMN')).toBe(true);
  });

  it('el model.bpmn exacto no lo es: es el modelo del proyecto y se abre con normalidad', () => {
    expect(isMiscasedModelFile('model.bpmn')).toBe(false);
  });

  it('otro diagrama de la misma carpeta no lo es, con las mayúsculas que sea', () => {
    expect(isMiscasedModelFile('ventas.bpmn')).toBe(false);
    expect(isMiscasedModelFile('Ventas.BPMN')).toBe(false);
    expect(isMiscasedModelFile('modelo.bpmn')).toBe(false);
  });
});

describe('findBpmnArg', () => {
  it('encuentra la primera ruta .bpmn a partir de "skip"', () => {
    const argv = ['/usr/bin/electron', '/app', '--flag', '/ruta/model.bpmn'];
    expect(findBpmnArg(argv, 2)).toBe('/ruta/model.bpmn');
  });

  it('ignora lo que hay antes de "skip"', () => {
    const argv = ['/ruta/anterior.bpmn', '/app', '/ruta/actual.bpmn'];
    expect(findBpmnArg(argv, 1)).toBe('/ruta/actual.bpmn');
  });

  it('null si ningún argumento califica', () => {
    expect(findBpmnArg(['/usr/bin/electron', '/app', '--flag'], 2)).toBeNull();
  });

  it('ignora una flag que "termina" en .bpmn (empieza por "-")', () => {
    expect(findBpmnArg(['/usr/bin/electron', '/app', '--modelo.bpmn'], 2)).toBeNull();
  });

  it('second-instance: skip=1 salta solo el propio ejecutable', () => {
    expect(findBpmnArg(['/usr/bin/lila-modeler', '/ruta/model.bpmn'], 1)).toBe('/ruta/model.bpmn');
  });
});

describe('withLilaExtension', () => {
  it('pone la extensión cuando el diálogo de guardar no la puso', () => {
    expect(withLilaExtension('/proyectos/pedido')).toBe('/proyectos/pedido.lila');
    // Un nombre con punto tampoco es un `.lila`: se le añade, no se le reemplaza nada.
    expect(withLilaExtension('/proyectos/pedido v1.2')).toBe('/proyectos/pedido v1.2.lila');
  });

  it('respeta la que ya está, en cualquier combinación de mayúsculas', () => {
    expect(withLilaExtension('/proyectos/pedido.lila')).toBe('/proyectos/pedido.lila');
    expect(withLilaExtension('/proyectos/PEDIDO.LILA')).toBe('/proyectos/PEDIDO.LILA');
  });

  // Moved here from `lilaFile.test.ts` when the `.lila` disk IO moved to the engine (#466).
  it('un nombre sin extensión produce un .lila que decodeLila abre', async () => {
    // Lo que `lila:chooseSaveFile` hace con lo que devuelve `showSaveDialog` antes de dárselo al
    // renderer (ADR-027): la parte que no necesita Electron para probarse.
    const documento: ProjectDocument = {
      version: 1,
      id: 'p1',
      name: 'pedido',
      model: {
        id: 'Process_1',
        name: 'model.bpmn',
        xml: '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>',
        revision: 3,
      },
      scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS' } },
      scenarioRevisions: { 'as-is.scenario.json': 2 },
      runs: [],
    };
    const elegido = join(await mkdtemp(join(tmpdir(), 'lila-file-')), 'pedido nuevo');
    const file = withLilaExtension(elegido);
    expect(file.endsWith('.lila')).toBe(true);

    await writeLilaFile(file, documento, { saveAs: true });
    expect(decodeLila(new Uint8Array(await readFile(file)))).toEqual(documento);
  });
});

describe('openPathRequest (issue #378)', () => {
  it('un .bpmn manda dir + file, el nombre plano dentro de la carpeta', () => {
    expect(openPathRequest('/descargas/ventas.bpmn', '/descargas')).toEqual({
      dir: '/descargas',
      file: 'ventas.bpmn',
    });
  });

  it('un .lila NO manda file: dir ya es la ruta del propio archivo', () => {
    expect(openPathRequest('/descargas/launch.lila', '/descargas/launch.lila')).toEqual({
      dir: '/descargas/launch.lila',
    });
    // La forma resultante no tiene la clave "file" en absoluto (ni siquiera `undefined`),
    // para que `exactOptionalPropertyTypes` y un `JSON.stringify` de IPC se comporten igual.
    expect(Object.keys(openPathRequest('/descargas/launch.lila', '/descargas/launch.lila'))).toEqual(['dir']);
  });

  it('un .lila con nombre no-ASCII (regresión) tampoco manda file', () => {
    const ruta = '/descargas/Trámite de Licencia — Completo.lila';
    expect(openPathRequest(ruta, ruta)).toEqual({ dir: ruta });
  });

  it('.bpmn en mayúsculas también manda file (insensible a mayúsculas, como isBpmnPath)', () => {
    expect(openPathRequest('/carpeta/Model.BPMN', '/carpeta')).toEqual({ dir: '/carpeta', file: 'Model.BPMN' });
  });

  it('un symlink "algo.lila" que resuelve a una CARPETA se rechaza con E-ARGUMENTO, no se abre como carpeta de proyecto', () => {
    // `realDir` es lo que `fs.realpath` da tras seguir el symlink: una carpeta cualquiera, sin
    // `.lila` en el nombre. Antes de este chequeo esto devolvía `{ dir: realDir }` sin `file`, y el
    // otro extremo (`lila:openRecent`/`readProject`, que decide por `isLilaPath(dir)`) la abría en
    // silencio como carpeta de proyecto — no lo que el nombre `.lila` prometía.
    expect(() => openPathRequest('/descargas/atajo.lila', '/otra/carpeta')).toThrow(/E-ARGUMENTO/);
  });

  it('un symlink "algo.lila" que resuelve a un archivo que no es .lila también se rechaza', () => {
    expect(() => openPathRequest('/descargas/atajo.lila', '/descargas/modelo.bpmn')).toThrow(/E-ARGUMENTO/);
  });

  it('un .lila cuyo realpath SÍ termina en .lila (el caso normal, sin symlink de por medio) no se rechaza', () => {
    expect(openPathRequest('/descargas/launch.lila', '/descargas/launch.lila')).toEqual({ dir: '/descargas/launch.lila' });
  });
});
