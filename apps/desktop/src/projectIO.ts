/**
 * Lectura/escritura de la carpeta de proyecto (OP-08, ADR-018). Puro: solo `node:fs/promises` y
 * `node:path` (más `crypto`/`process`, globales de Node — sin `import`), para poder probarlo con
 * `mkdtemp` y carpetas reales sin levantar Electron. `main.ts` es el único que llama a estas
 * funciones desde un handler IPC, después de validar `dir` contra la carpeta autorizada y los
 * nombres de escenario/run contra `resolveWithin` (eso vive ahí, no aquí: ver `bridge.ts`).
 *
 * Disposición de carpeta (decisión del coordinador, no se reabre):
 * - `model.bpmn`: el XML tal cual.
 * - `<nombre>.scenario.json`: el `ScenarioDocument` crudo, uno por escenario, `extends` literal
 *   (nunca se resuelve ni se reescribe aquí — se pasa a través sin tocarlo).
 * - `lila-project.json`: `{ version: 1, id, name, model: { id, name, revision }, scenarioRevisions }`.
 * - `runs/<runId>.result.json`: el `StoredRun` completo.
 */
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isSymlink } from './safePaths.js';
import type { ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from './projectTypes.js';

const MODEL_FILE = 'model.bpmn';
const MANIFEST_FILE = 'lila-project.json';
const RUNS_DIR = 'runs';
const SCENARIO_SUFFIX = '.scenario.json';
const RUN_SUFFIX = '.result.json';

/** Error con código estable para que la UI/tests distingan el motivo sin parsear el mensaje. */
export class ProjectIOError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectIOError';
  }
}

interface Manifest {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly model: { readonly id: string; readonly name: string; readonly revision: number };
  readonly scenarioRevisions: Readonly<Record<string, number>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `ENOENT` de Node trae siempre este `code`; el resto de errores de fs se re-lanzan tal cual. */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

// -- Detección de cambios externos (OP-14, incremento 2) ----------------------------------------
// `lastSeen` recuerda, por ruta absoluta, el `{mtimeMs, size}` de la última vez que ESTE proceso
// leyó o escribió con éxito `model.bpmn`, `lila-project.json` o un `*.scenario.json` — así
// `writeProjectFolder` puede distinguir "nadie más tocó esto desde que lo vimos" de "alguien más
// lo modificó en disco mientras tanto" antes de sobrescribirlo sin avisar. Deliberadamente no
// cubre `runs/*.result.json` (ya tienen su propia guardia, `E-RUN-DUPLICADO`, con otra semántica:
// comparar contenido, no momento de modificación) ni sobrevive a un reinicio del proceso (reabrir
// el proyecto vía `readProjectFolder` vuelve a poblar el snapshot, que es exactamente "ya lo vi").
interface FileSnapshot {
  readonly mtimeMs: number;
  readonly size: number;
}

const lastSeen = new Map<string, FileSnapshot>();

async function currentSnapshot(path: string): Promise<FileSnapshot | null> {
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function sameSnapshot(a: FileSnapshot | null, b: FileSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/** Registra el snapshot actual de `path` tras una lectura/escritura con éxito. */
async function rememberSnapshot(path: string): Promise<void> {
  const snap = await currentSnapshot(path);
  if (snap === null) lastSeen.delete(path);
  else lastSeen.set(path, snap);
}

/** Manifiesto por defecto cuando `lila-project.json` falta o no se pudo interpretar. */
function defaultManifest(dir: string): Manifest {
  const nombre = basename(dir);
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: nombre,
    model: { id: crypto.randomUUID(), name: nombre, revision: 0 },
    scenarioRevisions: {},
  };
}

async function readManifest(dir: string, problems: ProjectProblem[]): Promise<Manifest> {
  const target = join(dir, MANIFEST_FILE);
  let raw: string;
  try {
    raw = await readFile(target, 'utf8');
    await rememberSnapshot(target);
  } catch (error) {
    if (isNotFound(error)) return defaultManifest(dir);
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error('el JSON raíz no es un objeto.');
    }
    const { id, name, model, scenarioRevisions } = parsed;
    if (typeof id !== 'string' || typeof name !== 'string') {
      throw new Error('"id"/"name" deben ser texto.');
    }
    if (!isPlainObject(model)) {
      throw new Error('"model" no es un objeto.');
    }
    if (typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.revision !== 'number') {
      throw new Error('"model.id"/"model.name"/"model.revision" tienen forma inválida.');
    }
    return {
      version: 1,
      id,
      name,
      model: { id: model.id, name: model.name, revision: model.revision },
      scenarioRevisions: isPlainObject(scenarioRevisions)
        ? (scenarioRevisions as Record<string, number>)
        : {},
    };
  } catch (error) {
    // `lila-project.json` roto no descarta el proyecto (mismo espíritu que los escenarios): se
    // reconstruye como si faltara y se dice por qué en `problems`, en vez de tirar el intento de
    // abrir por un manifiesto corrupto que los escenarios y el modelo no necesitan para nada.
    problems.push({ file: MANIFEST_FILE, message: (error as Error).message });
    return defaultManifest(dir);
  }
}

async function readScenarios(
  dir: string,
  problems: ProjectProblem[],
): Promise<Record<string, ScenarioDocument>> {
  let entries: string[];
  try {
    // `entry.isFile()`/`isSymbolicLink()` vienen de `d_type` (sin stat adicional) y son
    // mutuamente excluyentes: un symlink NO cuenta como `isFile()`, así que sin incluir también
    // `isSymbolicLink()` aquí, un `*.scenario.json` que sea enlace desaparecería en silencio en
    // vez de quedar excluido con su motivo en `problems` (OP-14, revisión de A: "sigue symlinks
    // fuera de la carpeta autorizada", issue #71).
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(SCENARIO_SUFFIX))
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }

  const scenarios: Record<string, ScenarioDocument> = {};
  for (const name of entries) {
    const filePath = join(dir, name);
    try {
      if (await isSymlink(filePath)) {
        throw new Error('es un symlink; se excluye por seguridad (no se sigue fuera de la carpeta autorizada).');
      }
      const raw = await readFile(filePath, 'utf8');
      await rememberSnapshot(filePath);
      const parsed: unknown = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        throw new Error('el contenido no es un objeto JSON.');
      }
      scenarios[name] = parsed;
    } catch (error) {
      problems.push({ file: name, message: (error as Error).message });
    }
  }
  return scenarios;
}

async function readRuns(dir: string, problems: ProjectProblem[]): Promise<StoredRun[]> {
  const runsDir = join(dir, RUNS_DIR);

  // `runs` en sí como symlink hacia fuera: `readdir(runsDir)` seguiría el enlace y listaría el
  // contenido de una carpeta ajena sin que ningún archivo individual "parezca" un enlace (OP-14,
  // revisión de A, issue #71). Se excluye entera, igual que un `*.scenario.json` roto: no se
  // aborta la lectura del proyecto por esto.
  if (await isSymlink(runsDir)) {
    problems.push({
      file: RUNS_DIR,
      message: 'es un symlink; se excluye por seguridad (no se sigue fuera de la carpeta autorizada).',
    });
    return [];
  }

  let entries: string[];
  try {
    entries = (await readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(RUN_SUFFIX))
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const runs: StoredRun[] = [];
  for (const name of entries) {
    const file = `${RUNS_DIR}/${name}`;
    try {
      if (await isSymlink(join(runsDir, name))) {
        throw new Error('es un symlink; se excluye por seguridad (no se sigue fuera de la carpeta autorizada).');
      }
      const raw = await readFile(join(runsDir, name), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        !isPlainObject(parsed) ||
        typeof parsed.id !== 'string' ||
        typeof parsed.scenarioName !== 'string' ||
        !isPlainObject(parsed.inputs)
      ) {
        throw new Error('el contenido no tiene forma de StoredRun (id/scenarioName/inputs).');
      }
      runs.push(parsed as unknown as StoredRun);
    } catch (error) {
      problems.push({ file, message: (error as Error).message });
    }
  }
  return runs;
}

/**
 * Lee una carpeta de proyecto. Tolerante: un `*.scenario.json` o `runs/*.result.json` roto, o un
 * `lila-project.json` roto/ausente, no aborta la lectura — se excluye y queda en `problems`
 * (`lila-project.json` ausente es el único caso silencioso: es el estado normal de "carpeta recién
 * elegida con un `model.bpmn` puesto a mano", así que no genera problema, solo reconstrucción).
 * `model.bpmn` ausente sí es fatal (`E-SIN-MODELO`): sin él no hay nada que abrir en el modelador.
 */
export async function readProjectFolder(
  dir: string,
): Promise<{ document: ProjectDocument; problems: readonly ProjectProblem[] }> {
  let xml: string;
  try {
    const modelPath = join(dir, MODEL_FILE);
    xml = await readFile(modelPath, 'utf8');
    await rememberSnapshot(modelPath);
  } catch (error) {
    if (isNotFound(error)) {
      throw new ProjectIOError('E-SIN-MODELO', `Falta "${MODEL_FILE}" en la carpeta del proyecto: ${dir}`);
    }
    throw error;
  }

  const problems: ProjectProblem[] = [];
  const manifest = await readManifest(dir, problems);
  const scenarios = await readScenarios(dir, problems);
  const runs = await readRuns(dir, problems);

  const document: ProjectDocument = {
    version: 1,
    id: manifest.id,
    name: manifest.name,
    model: { id: manifest.model.id, name: manifest.model.name, xml, revision: manifest.model.revision },
    scenarios,
    scenarioRevisions: manifest.scenarioRevisions,
    runs,
  };
  return { document, problems };
}

interface PendingWrite {
  readonly dest: string;
  readonly content: string;
}

function randomSuffix(): string {
  return `${process.pid}-${crypto.randomUUID()}`;
}

export interface WriteProjectOptions {
  /**
   * `true` cuando esta escritura es un "Guardar como" hacia una carpeta recién elegida (no la
   * activa hasta ahora): dispara la comprobación de "carpeta ocupada" (ver `assertFolderNotOccupied`).
   * Un guardado normal a la carpeta ya activa no la necesita (y no debe bloquear el caso legítimo
   * de "abrí una carpeta con un `model.bpmn` puesto a mano y ahora guardo ahí").
   */
  readonly saveAs?: boolean;
  /**
   * `true` para saltar la detección de cambios externos (OP-14, incremento 2): ver
   * `assertNoExternalChanges`.
   */
  readonly overwrite?: boolean;
}

/**
 * Guardia de "Guardar como" (OP-14, revisión de A: "openProject no debe permitir guardar el
 * proyecto anterior en la carpeta nueva", issues #74/#70). Antes de escribir en una carpeta recién
 * elegida (no la que ya se venía usando), rechaza si esa carpeta ya contiene otro proyecto:
 * `lila-project.json` con un `id` distinto, o un `model.bpmn` sin manifiesto (contenido ajeno sin
 * forma de saber si es "el mismo proyecto"). Una carpeta vacía, o con el manifiesto del mismo
 * `documentId`, es válida. Un manifiesto ilegible se trata como ausente (mismo criterio que
 * `readManifest`): no bloquea una carpeta que en realidad podría ser propia por un JSON roto.
 */
async function assertFolderNotOccupied(dir: string, documentId: string): Promise<void> {
  let manifestId: string | null = null;
  try {
    const raw = await readFile(join(dir, MANIFEST_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed) && typeof parsed.id === 'string') manifestId = parsed.id;
  } catch (error) {
    if (!isNotFound(error)) {
      // Manifiesto ilegible (no JSON, permisos, etc.): no se puede determinar el dueño: se sigue
      // como si no existiera en vez de bloquear con un falso positivo.
    }
  }
  if (manifestId !== null) {
    if (manifestId !== documentId) {
      throw new ProjectIOError(
        'E-CARPETA-OCUPADA',
        `La carpeta ya contiene el proyecto "${manifestId}"; "Guardar como" no puede escribir ahí el proyecto "${documentId}".`,
      );
    }
    return;
  }
  try {
    await stat(join(dir, MODEL_FILE));
  } catch (error) {
    if (isNotFound(error)) return; // sin manifiesto ni modelo: carpeta vacía, válida.
    throw error;
  }
  throw new ProjectIOError(
    'E-CARPETA-OCUPADA',
    `La carpeta ya contiene "${MODEL_FILE}" de otro proyecto sin manifiesto; "Guardar como" no puede escribir ahí.`,
  );
}

/** Rechaza (`E-SYMLINK`) si `dest` ya existe como symlink: no se escribe para no reemplazar ni seguir un enlace hacia fuera de la carpeta autorizada. */
async function assertNotSymlinkDestination(dest: string): Promise<void> {
  if (await isSymlink(dest)) {
    throw new ProjectIOError(
      'E-SYMLINK',
      `"${dest}" es un symlink; no se escribe para no seguirlo fuera de la carpeta autorizada.`,
    );
  }
}

/**
 * Rechaza (`E-CAMBIO-EXTERNO`) si algún archivo de `trackedWrites` cambió en disco desde el último
 * snapshot que este proceso registró de él (`lastSeen`, poblado por `readProjectFolder`/una
 * escritura anterior). Sin snapshot conocido para un archivo (nunca se leyó ni se escribió en este
 * proceso) no hay base para decir que "cambió" — se deja pasar, aunque exista con contenido ajeno;
 * eso es responsabilidad de `assertFolderNotOccupied` (solo en "Guardar como"), no de esto.
 * `options.overwrite === true` salta la comprobación entera (el llamador ya decidió sobrescribir).
 */
async function assertNoExternalChanges(trackedWrites: readonly PendingWrite[], overwrite: boolean): Promise<void> {
  if (overwrite) return;
  const changed: string[] = [];
  for (const { dest } of trackedWrites) {
    const known = lastSeen.get(dest) ?? null;
    if (known === null) continue;
    const current = await currentSnapshot(dest);
    if (!sameSnapshot(current, known)) changed.push(basename(dest));
  }
  if (changed.length > 0) {
    throw new ProjectIOError(
      'E-CAMBIO-EXTERNO',
      `Cambiaron en disco desde la última lectura/escritura, sin guardar: ${changed.join(', ')}.`,
    );
  }
}

/**
 * Escribe el documento completo. Antes de tocar el disco: (a) si `options.saveAs`, verifica que la
 * carpeta no esté ocupada por otro proyecto (`assertFolderNotOccupied`); (b) salvo
 * `options.overwrite`, rechaza si el modelo/manifiesto/algún escenario cambió en disco desde la
 * última lectura o escritura de este proceso (`assertNoExternalChanges`, `E-CAMBIO-EXTERNO`); (c)
 * resuelve todas las corridas — una que ya existe con **otro** contenido es `E-RUN-DUPLICADO` y
 * aborta sin escribir nada (ni el modelo, ni los escenarios, ni el manifiesto) — "no reemplazar
 * archivos válidos parcialmente" del contrato; una corrida con el mismo contenido es no-op; (d)
 * rechaza si algún destino (incluida la propia carpeta `runs`) ya es un symlink, sin tocar el
 * enlace ni lo que apunte fuera (OP-14, revisión de A, issue #71). El resto de archivos (modelo,
 * escenarios, manifiesto) siempre se reescriben.
 */
export async function writeProjectFolder(
  dir: string,
  document: ProjectDocument,
  options: WriteProjectOptions = {},
): Promise<void> {
  if (options.saveAs === true) {
    await assertFolderNotOccupied(dir, document.id);
  }

  const runsDir = join(dir, RUNS_DIR);
  const runWrites: PendingWrite[] = [];

  if (document.runs.length > 0) {
    // La carpeta `runs` en sí como symlink hacia fuera: `readFile`/`mkdir` de abajo la seguirían.
    await assertNotSymlinkDestination(runsDir);
  }

  for (const run of document.runs) {
    const dest = join(runsDir, `${run.id}${RUN_SUFFIX}`);
    await assertNotSymlinkDestination(dest);
    const content = `${JSON.stringify(run, null, 2)}\n`;
    let existing: string | null = null;
    try {
      existing = await readFile(dest, 'utf8');
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (existing === null) {
      runWrites.push({ dest, content });
    } else if (existing !== content) {
      throw new ProjectIOError(
        'E-RUN-DUPLICADO',
        `La corrida "${run.id}" ya existe en "${dest}" con contenido distinto; no se sobrescribe.`,
      );
    }
    // `existing === content`: no-op, ni siquiera se reprograma la escritura.
  }

  const manifest: Manifest = {
    version: 1,
    id: document.id,
    name: document.name,
    model: { id: document.model.id, name: document.model.name, revision: document.model.revision },
    scenarioRevisions: document.scenarioRevisions,
  };

  const trackedWrites: PendingWrite[] = [
    { dest: join(dir, MODEL_FILE), content: document.model.xml },
    { dest: join(dir, MANIFEST_FILE), content: `${JSON.stringify(manifest, null, 2)}\n` },
    ...Object.entries(document.scenarios).map(([name, scenario]) => ({
      dest: join(dir, name),
      content: `${JSON.stringify(scenario, null, 2)}\n`,
    })),
  ];
  await assertNoExternalChanges(trackedWrites, options.overwrite === true);

  const writes: PendingWrite[] = [...trackedWrites, ...runWrites];

  // Defensa en profundidad además del chequeo puntual de `runsDir`/cada corrida de arriba: vuelve
  // a comprobar TODOS los destinos (modelo, manifiesto, escenarios incluidos) justo antes de tocar
  // disco, para que ningún camino nuevo que se añada aquí pueda olvidarse de la comprobación.
  for (const { dest } of writes) {
    await assertNotSymlinkDestination(dest);
  }

  if (runWrites.length > 0) {
    await mkdir(runsDir, { recursive: true });
  }

  // Fase 1: todos los temporales. Si alguno falla, se borran los ya creados y no se renombra
  // nada — los destinos anteriores (si existían) quedan exactamente como estaban.
  const tmpPaths: string[] = [];
  try {
    for (const { dest, content } of writes) {
      const tmp = `${dest}.tmp-${randomSuffix()}`;
      await writeFile(tmp, content, 'utf8');
      tmpPaths.push(tmp);
    }
  } catch (error) {
    await Promise.all(tmpPaths.map((tmp) => unlink(tmp).catch(() => {})));
    throw error;
  }

  // Fase 2: todos los renames. Cada uno es atómico por sí solo (mismo volumen); no hay una
  // garantía transaccional multi-archivo más allá de eso (ver comentario del ticket).
  await Promise.all(writes.map(({ dest }, i) => rename(tmpPaths[i]!, dest)));

  // Snapshot posterior a la escritura: para el próximo `writeProjectFolder` de este proceso, "lo
  // que acabamos de escribir" ya cuenta como "lo último que vimos" (solo para los archivos
  // rastreados; ver `assertNoExternalChanges`).
  for (const { dest } of trackedWrites) {
    await rememberSnapshot(dest);
  }
}
