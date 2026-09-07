/**
 * Tests de `projectIO.ts` con carpetas temporales reales (`mkdtemp`) — sin Electron, tal como
 * permite que sea puro. Una de las carpetas lleva espacios y tilde a propósito (OP-08, "rutas con
 * espacios/tildes" del ticket).
 */
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectIOError, readProjectFolder, writeProjectFolder, type WriteProjectFsImpl } from './projectIO.js';
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

describe('symlinks — lectura', () => {
  let fuera: string;

  beforeEach(async () => {
    fuera = await mkdtemp(join(tmpdir(), 'lila-projectIO-fuera-'));
  });

  afterEach(async () => {
    await rm(fuera, { recursive: true, force: true });
  });

  it('un *.scenario.json que es symlink a un archivo externo se excluye y queda en problems', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    const secreto = join(fuera, 'secreto.scenario.json');
    await writeFile(secreto, JSON.stringify({ version: 1, robado: true }), 'utf8');
    await symlink(secreto, join(dir, 'enlazado.scenario.json'));

    const { document, problems } = await readProjectFolder(dir);

    expect(document.scenarios).toEqual({});
    expect(problems).toEqual([
      { file: 'enlazado.scenario.json', message: expect.stringContaining('symlink') },
    ]);
  });

  it('la carpeta runs como symlink a fuera se excluye entera y queda en problems', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    const runsFuera = join(fuera, 'runs-externas');
    await mkdir(runsFuera, { recursive: true });
    await writeFile(
      join(runsFuera, 'ajeno.result.json'),
      JSON.stringify({ id: 'ajeno', scenarioName: 'x', inputs: {} }),
      'utf8',
    );
    await symlink(runsFuera, join(dir, 'runs'));

    const { document, problems } = await readProjectFolder(dir);

    expect(document.runs).toEqual([]);
    expect(problems).toEqual([{ file: 'runs', message: expect.stringContaining('symlink') }]);
  });

  it('model.bpmn symlink a un archivo externo: E-SYMLINK, no se lee el contenido ajeno (OP-14, issue #71)', async () => {
    const secreto = join(fuera, 'secreto.bpmn');
    await writeFile(secreto, '<?xml version="1.0"?><robado/>', 'utf8');
    await symlink(secreto, join(dir, 'model.bpmn'));

    const error = await captureError(() => readProjectFolder(dir));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-SYMLINK');
  });

  it('lila-project.json symlink a un archivo externo: se excluye, queda en problems, y el manifiesto se reconstruye (OP-14, issue #71)', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    const ajeno = join(fuera, 'ajeno-project.json');
    await writeFile(
      ajeno,
      JSON.stringify({ version: 1, id: 'robado', name: 'Robado', model: { id: 'x', name: 'x', revision: 99 } }),
      'utf8',
    );
    await symlink(ajeno, join(dir, 'lila-project.json'));

    const { document, problems } = await readProjectFolder(dir);

    expect(problems).toEqual([{ file: 'lila-project.json', message: expect.stringContaining('symlink') }]);
    // Reconstruido como si faltara: no hereda el `id`/`name`/revisión del archivo ajeno enlazado.
    expect(document.id).not.toBe('robado');
    expect(document.model.revision).toBe(0);
  });
});

describe('symlinks — escritura', () => {
  let fuera: string;

  beforeEach(async () => {
    fuera = await mkdtemp(join(tmpdir(), 'lila-projectIO-fuera-'));
  });

  afterEach(async () => {
    await rm(fuera, { recursive: true, force: true });
  });

  it('un *.scenario.json que es symlink a un archivo externo: escritura rechazada, destino externo intacto', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    const externo = join(fuera, 'ajeno.json');
    await writeFile(externo, 'contenido original', 'utf8');
    await symlink(externo, join(dir, 'as-is.scenario.json'));

    const doc = documentoBase();
    const error = await captureError(() => writeProjectFolder(dir, doc));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-SYMLINK');

    expect(await readFile(externo, 'utf8')).toBe('contenido original');
    const entradas = await readdir(dir);
    expect(entradas.some((nombre) => nombre.includes('.tmp-'))).toBe(false);
  });

  it('la carpeta runs como symlink a fuera: escritura rechazada, nada se toca', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    const runsFuera = join(fuera, 'runs-externas');
    await mkdir(runsFuera, { recursive: true });
    await symlink(runsFuera, join(dir, 'runs'));

    const run: StoredRun = {
      id: 'run-1',
      scenarioName: 'as-is.scenario.json',
      result: { kpis: { total: 1 } },
      inputs: { modelRevision: 1, scenarioRevision: 1, xml: XML_MINIMO, scenario: {} },
    };
    const doc = documentoBase({ runs: [run] });
    const error = await captureError(() => writeProjectFolder(dir, doc));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-SYMLINK');

    expect(await readdir(runsFuera)).toEqual([]);
  });
});

describe('writeProjectFolder — "Guardar como" en carpeta ocupada (E-CARPETA-OCUPADA)', () => {
  it('rechaza si la carpeta ya tiene lila-project.json de otro id', async () => {
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    await writeFile(
      join(dir, 'lila-project.json'),
      JSON.stringify({ version: 1, id: 'otro-proyecto', name: 'Ajeno', model: { id: 'm', name: 'm', revision: 0 }, scenarioRevisions: {} }),
      'utf8',
    );

    const doc = documentoBase({ id: 'proyecto-1' });
    const error = await captureError(() => writeProjectFolder(dir, doc, { saveAs: true }));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-CARPETA-OCUPADA');
  });

  it('rechaza si hay un model.bpmn ajeno sin manifiesto', async () => {
    await writeFile(join(dir, 'model.bpmn'), '<otro-xml/>', 'utf8');

    const doc = documentoBase();
    const error = await captureError(() => writeProjectFolder(dir, doc, { saveAs: true }));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-CARPETA-OCUPADA');
  });

  it('acepta una carpeta vacía con saveAs', async () => {
    const doc = documentoBase();
    await expect(writeProjectFolder(dir, doc, { saveAs: true })).resolves.toBeUndefined();
  });

  it('acepta una carpeta con el manifiesto del mismo proyecto con saveAs', async () => {
    const doc = documentoBase({ id: 'proyecto-1' });
    await writeProjectFolder(dir, doc);
    await expect(writeProjectFolder(dir, doc, { saveAs: true })).resolves.toBeUndefined();
  });

  it('sin saveAs, no bloquea guardar sobre una carpeta abierta con un model.bpmn puesto a mano', async () => {
    // Caso legítimo: abrir una carpeta con solo `model.bpmn` (sin manifiesto) y guardar ahí
    // normalmente no debe tratarse como "ocupada" — solo "Guardar como" hace esa comprobación.
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    const doc = documentoBase();
    await expect(writeProjectFolder(dir, doc)).resolves.toBeUndefined();
  });
});

describe('writeProjectFolder — cambios externos (E-CAMBIO-EXTERNO)', () => {
  it('un escenario modificado en disco desde la última lectura: rechaza sin escribir nada, el archivo externo queda intacto', async () => {
    const doc = documentoBase();
    await writeProjectFolder(dir, doc); // primera escritura: registra el snapshot de cada archivo.

    // Alguien más (otro proceso, otra sesión) edita el escenario directamente en disco.
    const editadoExternamente = JSON.stringify({ version: 1, name: 'EDITADO EXTERNAMENTE, más largo que el original' });
    await writeFile(join(dir, 'as-is.scenario.json'), editadoExternamente, 'utf8');

    const docNuevo = documentoBase({ name: 'Pedido v2' });
    const error = await captureError(() => writeProjectFolder(dir, docNuevo));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-CAMBIO-EXTERNO');
    expect((error as ProjectIOError).message).toContain('as-is.scenario.json');

    // Nada se tocó: ni el escenario editado externamente, ni el modelo (que sí iba a cambiar).
    expect(await readFile(join(dir, 'as-is.scenario.json'), 'utf8')).toBe(editadoExternamente);
    expect(await readFile(join(dir, 'model.bpmn'), 'utf8')).toBe(XML_MINIMO);
    const entradas = await readdir(dir);
    expect(entradas.some((nombre) => nombre.includes('.tmp-'))).toBe(false);
  });

  it('con overwrite:true, escribe encima del cambio externo', async () => {
    const doc = documentoBase();
    await writeProjectFolder(dir, doc);
    await writeFile(join(dir, 'as-is.scenario.json'), JSON.stringify({ version: 1, name: 'EDITADO EXTERNAMENTE' }), 'utf8');

    const docNuevo = documentoBase({ name: 'Pedido v2' });
    await expect(writeProjectFolder(dir, docNuevo, { overwrite: true })).resolves.toBeUndefined();

    const { document } = await readProjectFolder(dir);
    expect(document.name).toBe('Pedido v2');
    expect(document.scenarios).toEqual(doc.scenarios);
  });

  it('readProjectFolder también registra snapshot: escribir después sin cambios externos funciona', async () => {
    const doc = documentoBase();
    await writeProjectFolder(dir, doc);
    await readProjectFolder(dir); // p.ej. reabrir el proyecto más tarde.
    await expect(writeProjectFolder(dir, documentoBase({ name: 'Pedido v2' }))).resolves.toBeUndefined();
  });

  it('sin snapshot previo (nunca leído ni escrito en este proceso), no bloquea: no hay base para decir "cambió"', async () => {
    // Caso legítimo (igual que el test de "carpeta ocupada" de arriba): un model.bpmn puesto a
    // mano, nunca visto por este proceso, no debe tratarse como "cambio externo" — no hay un
    // snapshot anterior con el que compararlo.
    await writeFile(join(dir, 'model.bpmn'), XML_MINIMO, 'utf8');
    await expect(writeProjectFolder(dir, documentoBase())).resolves.toBeUndefined();
  });
});

describe('writeProjectFolder — transaccional (OP-08, revisión de A, issue #71)', () => {
  it('reproducción exacta de A: destino de escenario que es un directorio → E-DESTINO-INVALIDO, model.bpmn intacto, sin residuos', async () => {
    // Reproducción de A (43a29cf, worktree `/tmp/lila-atomic-review-uRTH8j`): con los `rename` en
    // un `Promise.all`, un destino `bad.scenario.json` que resulta ser un directorio fallaba con
    // EISDIR después de que `model.bpmn` YA hubiera cambiado. El preflight de abajo debe rechazar
    // ANTES de escribir un solo byte.
    const doc = documentoBase();
    await writeProjectFolder(dir, doc); // MODELO_ANTERIOR en disco.
    const modeloAnterior = await readFile(join(dir, 'model.bpmn'), 'utf8');

    await mkdir(join(dir, 'bad.scenario.json')); // el destino ya existe, pero como carpeta.

    const docNuevo = documentoBase({
      model: { ...doc.model, xml: '<MODELO_NUEVO/>' },
      scenarios: { ...doc.scenarios, 'bad.scenario.json': { version: 1, name: 'BAD' } },
      scenarioRevisions: { ...doc.scenarioRevisions, 'bad.scenario.json': 1 },
    });

    const error = await captureError(() => writeProjectFolder(dir, docNuevo));
    expect(error).toBeInstanceOf(ProjectIOError);
    expect((error as ProjectIOError).code).toBe('E-DESTINO-INVALIDO');

    expect(await readFile(join(dir, 'model.bpmn'), 'utf8')).toBe(modeloAnterior);
    const entradas = await readdir(dir);
    expect(entradas.some((nombre) => nombre.includes('.tmp-'))).toBe(false);
    expect(entradas.some((nombre) => nombre.includes('.prev-'))).toBe(false);
    expect(entradas.some((nombre) => nombre === 'lila-recovery.json')).toBe(false);
  });

  it('fallo inyectado a mitad de los renames (vía fsImpl): todos los archivos previos quedan restaurados', async () => {
    const doc = documentoBase();
    await writeProjectFolder(dir, doc); // primera escritura real: model.bpmn, manifiesto y escenario en disco.

    const modeloPrevio = await readFile(join(dir, 'model.bpmn'), 'utf8');
    const manifiestoPrevio = await readFile(join(dir, 'lila-project.json'), 'utf8');
    const escenarioPrevio = await readFile(join(dir, 'as-is.scenario.json'), 'utf8');

    const destinoManifiesto = join(dir, 'lila-project.json');
    // El orden de `trackedWrites` es [modelo, manifiesto, ...escenarios]: el modelo ya se habrá
    // commiteado por completo cuando el manifiesto falle, así que esto SÍ ejercita "un archivo
    // previo ya confirmado, deshacerlo cuando uno posterior falla a mitad de la transacción".
    const fsImpl: WriteProjectFsImpl = {
      rename: async (oldPath, newPath) => {
        if (newPath === destinoManifiesto && oldPath.includes('.tmp-')) {
          throw new Error('fallo inyectado a mitad de los renames (prueba)');
        }
        await rename(oldPath, newPath);
      },
    };

    const docNuevo = documentoBase({
      model: { ...doc.model, xml: '<cambiado/>' },
      name: 'Pedido v2',
    });

    const error = await captureError(() => writeProjectFolder(dir, docNuevo, {}, fsImpl));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('fallo inyectado a mitad de los renames (prueba)');

    expect(await readFile(join(dir, 'model.bpmn'), 'utf8')).toBe(modeloPrevio);
    expect(await readFile(join(dir, 'lila-project.json'), 'utf8')).toBe(manifiestoPrevio);
    expect(await readFile(join(dir, 'as-is.scenario.json'), 'utf8')).toBe(escenarioPrevio);

    const entradas = await readdir(dir);
    expect(entradas.some((nombre) => nombre.includes('.tmp-'))).toBe(false);
    expect(entradas.some((nombre) => nombre.includes('.prev-'))).toBe(false);
    expect(entradas.some((nombre) => nombre === 'lila-recovery.json')).toBe(false);
  });

  it('éxito: sin residuos .tmp-*/.prev-* al terminar', async () => {
    const doc = documentoBase();
    await writeProjectFolder(dir, doc);
    await writeProjectFolder(dir, documentoBase({ name: 'Pedido v2' }));

    const entradas = await readdir(dir);
    expect(entradas.some((nombre) => nombre.includes('.tmp-'))).toBe(false);
    expect(entradas.some((nombre) => nombre.includes('.prev-'))).toBe(false);
    expect(entradas.some((nombre) => nombre === 'lila-recovery.json')).toBe(false);

    const { document } = await readProjectFolder(dir);
    expect(document.name).toBe('Pedido v2');
  });
});
