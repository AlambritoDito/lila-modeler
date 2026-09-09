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
import { access, constants, lstat, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isSymlink } from './safePaths.js';
import type { ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from './projectTypes.js';

const MODEL_FILE = 'model.bpmn';
const MANIFEST_FILE = 'lila-project.json';
const RUNS_DIR = 'runs';
const SCENARIO_SUFFIX = '.scenario.json';
const RUN_SUFFIX = '.result.json';
/** Dejado en la carpeta del proyecto solo cuando el rollback de un guardado fallido también falla
 *  a mitad de camino (`E-RECUPERACION-PENDIENTE`, ver `commitWithRollback`) — lista los `.prev-*`
 *  que quedaron pendientes de restaurar a mano. En el resto de casos (éxito, o fallo con rollback
 *  completo) este archivo ni se toca ni se crea. */
const RECOVERY_FILE = 'lila-recovery.json';

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
  // `lstat` antes de leer (OP-14, revisión de A, issue #71: "lectura de model.bpmn (y
  // manifiesto) sigue symlinks"): un `lila-project.json` que sea enlace hacia fuera de la carpeta
  // autorizada devolvería el contenido ajeno como si fuera el manifiesto propio. Mismo criterio
  // que un manifiesto roto/ilegible: no aborta la lectura del proyecto — se anota en `problems` y
  // se reconstruye como si faltara, en vez de seguir el enlace.
  if (await isSymlink(target)) {
    problems.push({
      file: MANIFEST_FILE,
      message: 'es un symlink; se excluye por seguridad (no se sigue fuera de la carpeta autorizada).',
    });
    return defaultManifest(dir);
  }
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
 * `lila-project.json` roto/ausente/symlink, no aborta la lectura — se excluye y queda en
 * `problems` (`lila-project.json` ausente es el único caso silencioso: es el estado normal de
 * "carpeta recién elegida con un `model.bpmn` puesto a mano", así que no genera problema, solo
 * reconstrucción). `model.bpmn` es la excepción: ausente (`E-SIN-MODELO`) o symlink (`E-SYMLINK`)
 * son fatales — sin él, o sin confiar en su origen, no hay nada que abrir en el modelador.
 *
 * `modelFile` (LILA-072) es el `.bpmn` a leer como modelo cuando NO es el `model.bpmn` del
 * proyecto: doble clic en `ventas.bpmn`, o en un `.bpmn` suelto en una carpeta que no es un
 * proyecto Lila. Se abre igual —el manifiesto ausente ya se reconstruye por defecto y los
 * escenarios/corridas salen vacíos— y `model.name` pasa a ser ESE nombre en vez del del
 * manifiesto: es el archivo que el usuario pulsó y el que la UI debe mostrar. `main.ts` valida que
 * sea un nombre plano dentro de `dir` antes de llegar aquí.
 */
export async function readProjectFolder(
  dir: string,
  modelFile: string = MODEL_FILE,
): Promise<{ document: ProjectDocument; problems: readonly ProjectProblem[]; loose: boolean }> {
  const modelPath = join(dir, modelFile);
  // `lstat` antes de leer (OP-14, revisión de A, issue #71: "lectura de model.bpmn sigue
  // symlinks"): a diferencia de un `*.scenario.json` (que se puede excluir y seguir abriendo el
  // resto del proyecto), `model.bpmn` es el único archivo sin el que no hay nada que modelar —
  // igual que "ausente" (`E-SIN-MODELO`), un enlace hacia fuera de la carpeta autorizada es fatal
  // (`E-SYMLINK`), no un `problems` silencioso: leerlo devolvería contenido ajeno como si fuera el
  // modelo del proyecto.
  if (await isSymlink(modelPath)) {
    throw new ProjectIOError(
      'E-SYMLINK',
      `"${modelFile}" es un symlink; no se lee para no seguirlo fuera de la carpeta autorizada.`,
    );
  }
  let xml: string;
  try {
    xml = await readFile(modelPath, 'utf8');
    await rememberSnapshot(modelPath);
  } catch (error) {
    if (isNotFound(error)) {
      throw new ProjectIOError('E-SIN-MODELO', `Falta "${modelFile}" en la carpeta del proyecto: ${dir}`);
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
    // El nombre del manifiesto solo vale para el `model.bpmn` del proyecto; si se pidió otro
    // `.bpmn`, el nombre honesto es el del archivo abierto (LILA-072).
    model: {
      id: manifest.model.id,
      name: modelFile === MODEL_FILE ? manifest.model.name : modelFile,
      xml,
      revision: manifest.model.revision,
    },
    scenarios,
    scenarioRevisions: manifest.scenarioRevisions,
    runs,
  };
  // «Diagrama suelto» (LILA-072, hallazgo 7 del QA): un `.bpmn` que no es el `model.bpmn` de un
  // proyecto y cuya carpeta tampoco tiene manifiesto — el caso normal del doble clic en
  // `~/Descargas`. Guardar ahí no debe sembrar la carpeta del usuario con un proyecto entero; lo
  // decide la LECTURA (cómo estaba la carpeta al abrir) y lo obedece `writeProjectFolder`.
  const loose = modelFile !== MODEL_FILE && !(await pathExists(join(dir, MANIFEST_FILE)));
  return { document, problems, loose };
}

/**
 * `true` si `dir` tiene un `model.bpmn` legible como archivo — o sea, si reabrir esa carpeta como
 * proyecto (recientes, menú Archivo) va a funcionar. `main.ts` lo usa para no anotar en recientes
 * la carpeta de un `.bpmn` suelto, que prometería un proyecto que no existe (hallazgo 9 del QA).
 */
export async function hasProjectModel(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, MODEL_FILE))).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
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
  /**
   * `.bpmn` donde va el XML del modelo (LILA-072, hallazgo 7 del QA). Por defecto `model.bpmn`;
   * un proyecto abierto por otro `.bpmn` de la misma carpeta (doble clic en `ventas.bpmn`) guarda
   * en ESE archivo, no en el `model.bpmn` de al lado, que se quedaría con el diagrama equivocado.
   * `main.ts` valida que sea un nombre plano `.bpmn` dentro de `dir` antes de llegar aquí.
   * Un `modelFile` distinto de `model.bpmn` implica `diagramOnly` (LILA-206): el manifiesto
   * describe solo el `model.bpmn`, así que no se reescribe por guardar otro diagrama al lado.
   */
  readonly modelFile?: string;
  /**
   * `true` cuando lo abierto es un diagrama suelto (`readProjectFolder(...).loose`): un `.bpmn` en
   * una carpeta que no es un proyecto Lila. Entonces se escribe SOLO ese `.bpmn` — ni manifiesto,
   * ni escenarios, ni corridas: un guardado normal no puede sembrar `~/Descargas` con cuatro
   * archivos que el usuario no pidió. «Guardar como» crea el proyecto completo en la carpeta que
   * el usuario elija (ahí `saveAs: true` y sin `diagramOnly`).
   */
  readonly diagramOnly?: boolean;
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

/** `true` si `target` existe (como lo que sea — archivo, carpeta, symlink); `false` si no. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Rechaza (`E-SYMLINK`) si `runsDir` ya existe como symlink, o (`E-DESTINO-INVALIDO`) si existe
 * pero no es una carpeta — en ambos casos sin seguir el enlace ni tocar lo que apunte fuera de la
 * carpeta autorizada. Ausente es válido: `writeProjectFolder` la crea con `mkdir(…, {recursive})`.
 */
async function assertRunsDirUsable(runsDir: string): Promise<void> {
  if (await isSymlink(runsDir)) {
    throw new ProjectIOError(
      'E-SYMLINK',
      `"${runsDir}" es un symlink; no se escribe para no seguirlo fuera de la carpeta autorizada.`,
    );
  }
  let info;
  try {
    info = await stat(runsDir);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  if (!info.isDirectory()) {
    throw new ProjectIOError(
      'E-DESTINO-INVALIDO',
      `"${runsDir}" existe y no es una carpeta; no se pueden guardar corridas ahí.`,
    );
  }
}

/**
 * Preflight de un destino de escritura (OP-08, revisión de A: reproducción del P0 — un
 * `*.scenario.json` que en disco resulta ser un directorio hacía fallar el `rename` a mitad de un
 * `Promise.all`, con `model.bpmn` ya cambiado). Se llama para TODOS los destinos antes de escribir
 * un solo byte (ni siquiera los `.tmp-*`): rechaza (`E-SYMLINK`) si `dest` ya es un symlink;
 * (`E-DESTINO-INVALIDO`) si existe pero no es un archivo regular (p. ej. un directorio), o si su
 * carpeta padre no existe o no admite escritura — salvo que el padre sea `runsDir` y aún no exista
 * (`writeProjectFolder` la crea sola). Ausente y con padre válido: destino aceptado.
 */
async function assertValidDestination(dest: string, runsDir: string): Promise<void> {
  const parent = dirname(dest);
  const parentEsRunsDirAusente = parent === runsDir && !(await pathExists(parent));
  if (!parentEsRunsDirAusente) {
    try {
      await access(parent, constants.W_OK);
    } catch {
      throw new ProjectIOError(
        'E-DESTINO-INVALIDO',
        `La carpeta de "${dest}" no existe o no admite escritura.`,
      );
    }
  }

  if (await isSymlink(dest)) {
    throw new ProjectIOError(
      'E-SYMLINK',
      `"${dest}" es un symlink; no se escribe para no seguirlo fuera de la carpeta autorizada.`,
    );
  }
  let info;
  try {
    info = await stat(dest);
  } catch (error) {
    if (isNotFound(error)) return; // no existe: destino válido para crear.
    throw error;
  }
  if (!info.isFile()) {
    throw new ProjectIOError(
      'E-DESTINO-INVALIDO',
      `"${dest}" existe y no es un archivo regular (por ejemplo, un directorio); no se puede guardar ahí.`,
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
 * Seam de prueba (OP-08, revisión de A: P0 de guardado no transaccional, issue #71): permite a los
 * tests reemplazar `rename` para inyectar un fallo a mitad de la fase de commit sin depender de
 * permisos del sistema de archivos, que varían por plataforma/usuario (root los ignora). Sin este
 * parámetro, `writeProjectFolder` usa el `rename` real de `node:fs/promises`; no es una API para
 * producción.
 */
export interface WriteProjectFsImpl {
  readonly rename?: (oldPath: string, newPath: string) => Promise<void>;
}

/** Estado de un destino durante la fase de commit — lo que hace falta para deshacerlo si algo después falla. */
interface CommitStep {
  readonly dest: string;
  /** Ruta `.prev-*` a la que se movió el contenido anterior de `dest`, o `null` si `dest` no existía. */
  readonly prevPath: string | null;
  /** `true` una vez `rename(dest, prevPath)` completó con éxito (solo relevante si `prevPath` no es `null`). */
  movedToPrev: boolean;
  /** `true` una vez `rename(tmp, dest)` completó con éxito: el contenido nuevo ya está en `dest`. */
  tmpMoved: boolean;
}

/** Deshace un único `CommitStep` en el estado en el que haya quedado. `true` si el deshacer funcionó. */
async function undoCommitStep(step: CommitStep, doRename: NonNullable<WriteProjectFsImpl['rename']>): Promise<boolean> {
  try {
    if (step.tmpMoved) {
      await unlink(step.dest); // quita el contenido nuevo que se acaba de mover ahí.
    }
    if (step.movedToPrev) {
      await doRename(step.prevPath!, step.dest); // restaura el contenido anterior.
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Deshace todos los `steps` ya intentados, en orden inverso (LIFO: el último destino tocado se
 * deshace primero). Devuelve las rutas `.prev-*` (o, a falta de una, el propio destino) que
 * quedaron sin poder restaurar — vacío si el rollback fue completo.
 */
async function rollbackCommit(
  steps: readonly CommitStep[],
  doRename: NonNullable<WriteProjectFsImpl['rename']>,
): Promise<readonly string[]> {
  const pending: string[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    const ok = await undoCommitStep(step, doRename);
    if (!ok) pending.push(step.prevPath ?? step.dest);
  }
  return pending;
}

/** Escribe `lila-recovery.json` con los `.prev-*` que un rollback fallido dejó pendientes de restaurar a mano. */
async function writeRecoveryFile(dir: string, pending: readonly string[]): Promise<void> {
  const payload = { version: 1, createdAt: new Date().toISOString(), pending };
  await writeFile(join(dir, RECOVERY_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Fase de commit (OP-08, revisión de A: P0 de guardado no transaccional). A diferencia de la
 * versión anterior (todos los `rename` en un `Promise.all`, donde un fallo a mitad de camino podía
 * dejar, p. ej., `model.bpmn` ya cambiado mientras un escenario fallaba), esto renombra
 * secuencialmente y lleva un journal en memoria (`steps`): por archivo, primero aparta el destino
 * existente (si lo había) a `<destino>.prev-<token>`, luego mueve el temporal al destino. Si
 * cualquier paso falla, deshace TODO lo ya hecho en orden inverso (`rollbackCommit`) y rechaza con
 * el error original. Si el propio rollback no logra restaurar algún `.prev-*`, en vez de perderlo
 * en silencio se escribe `lila-recovery.json` y se rechaza con `E-RECUPERACION-PENDIENTE`. Al
 * terminar con éxito, borra los `.prev-*` (ya no hacen falta).
 */
async function commitWithRollback(
  dir: string,
  writes: readonly PendingWrite[],
  tmpPaths: readonly string[],
  fsImpl: WriteProjectFsImpl,
): Promise<void> {
  const doRename = fsImpl.rename ?? rename;
  const steps: CommitStep[] = [];

  try {
    for (let i = 0; i < writes.length; i++) {
      const dest = writes[i]!.dest;
      const tmp = tmpPaths[i]!;
      const existedBefore = await pathExists(dest);
      const prevPath = existedBefore ? `${dest}.prev-${randomSuffix()}` : null;
      const step: CommitStep = { dest, prevPath, movedToPrev: false, tmpMoved: false };
      steps.push(step); // ya en el journal ANTES de intentar nada: si algo de abajo lanza, el rollback lo ve.

      if (prevPath !== null) {
        await doRename(dest, prevPath);
        step.movedToPrev = true;
      }
      await doRename(tmp, dest);
      step.tmpMoved = true;
    }
  } catch (error) {
    const pending = await rollbackCommit(steps, doRename);
    // Limpia cualquier `.tmp-*` que no llegó a moverse (los ya movidos ya no existen en su ruta
    // temporal: `unlink` sobre ellos es un ENOENT silencioso).
    await Promise.all(tmpPaths.map((tmp) => unlink(tmp).catch(() => {})));
    if (pending.length > 0) {
      await writeRecoveryFile(dir, pending).catch(() => {});
      throw new ProjectIOError(
        'E-RECUPERACION-PENDIENTE',
        `El guardado falló y el deshacer no pudo restaurar por completo: ${pending.join(', ')}. Revisa ` +
          `"${RECOVERY_FILE}" en la carpeta del proyecto. Causa original: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
    throw error;
  }

  // Éxito: los `.prev-*` ya no hacen falta.
  await Promise.all(
    steps.filter((step) => step.movedToPrev).map((step) => unlink(step.prevPath!).catch(() => {})),
  );
}

/**
 * Escribe el documento completo — o solo el `.bpmn`, si `options.diagramOnly` o si
 * `options.modelFile` no es `model.bpmn` (ver `WriteProjectOptions` y LILA-206); el XML va a
 * `options.modelFile` (por defecto `model.bpmn`). Antes de
 * tocar el disco: (a) si `options.saveAs`, verifica que la
 * carpeta no esté ocupada por otro proyecto (`assertFolderNotOccupied`); (b) salvo
 * `options.overwrite`, rechaza si el modelo/manifiesto/algún escenario cambió en disco desde la
 * última lectura o escritura de este proceso (`assertNoExternalChanges`, `E-CAMBIO-EXTERNO`); (c)
 * resuelve todas las corridas — una que ya existe con **otro** contenido es `E-RUN-DUPLICADO` y
 * aborta sin escribir nada (ni el modelo, ni los escenarios, ni el manifiesto) — "no reemplazar
 * archivos válidos parcialmente" del contrato; una corrida con el mismo contenido es no-op; (d)
 * preflight de TODOS los destinos (`assertValidDestination`/`assertRunsDirUsable`): symlink
 * (`E-SYMLINK`), directorio u otro no-archivo, o carpeta padre inexistente/sin permiso de escritura
 * (`E-DESTINO-INVALIDO`) — nada de esto toca el disco (OP-08, revisión de A, issue #71: reproducción
 * del P0 con un destino de escenario que resultaba ser un directorio). Solo tras pasar todo eso se
 * escribe: primero los temporales (fase 1), luego el commit con rollback (`commitWithRollback`,
 * fase 2) que dejaría los destinos anteriores intactos si cualquier `rename` de la fase 2 falla.
 */
export async function writeProjectFolder(
  dir: string,
  document: ProjectDocument,
  options: WriteProjectOptions = {},
  fsImpl: WriteProjectFsImpl = {},
): Promise<void> {
  if (options.saveAs === true) {
    await assertFolderNotOccupied(dir, document.id);
  }

  const modelFile = options.modelFile ?? MODEL_FILE;
  // ponytail: el manifiesto describe UN solo diagrama, el `model.bpmn` de la carpeta (LILA-206,
  // #266). Así que guardar otro `.bpmn` de la misma carpeta —doble clic en `ventas.bpmn` dentro de
  // un proyecto Lila— escribe SOLO ese archivo: reescribir el manifiesto dejaba
  // `manifest.model.name = "ventas.bpmn"` y la revisión avanzada sobre un `model.bpmn` que nadie
  // tocó, y al reabrir la UI enseñaba «ventas.bpmn» encima del contenido de `model.bpmn`. El techo
  // es ese: un diagrama por manifiesto. Listar varios diagramas (y sus revisiones) es otro ticket.
  // Defensivo en la capa de disco a propósito: el llamador (`main.ts` → `writeProject`) manda
  // `diagramOnly` según el `loose` de la lectura, que aquí es `false` (la carpeta SÍ es proyecto).
  const diagramOnly = options.diagramOnly === true || modelFile !== MODEL_FILE;
  const runsDir = join(dir, RUNS_DIR);
  const runWrites: PendingWrite[] = [];

  if (!diagramOnly && document.runs.length > 0) {
    // La carpeta `runs` en sí como symlink hacia fuera, o algo que no sea una carpeta: `readFile`/
    // `mkdir` de abajo la seguirían o fallarían de forma confusa.
    await assertRunsDirUsable(runsDir);
  }

  for (const run of diagramOnly ? [] : document.runs) {
    const dest = join(runsDir, `${run.id}${RUN_SUFFIX}`);
    await assertValidDestination(dest, runsDir);
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
    { dest: join(dir, modelFile), content: document.model.xml },
    ...(diagramOnly
      ? []
      : [
          { dest: join(dir, MANIFEST_FILE), content: `${JSON.stringify(manifest, null, 2)}\n` },
          ...Object.entries(document.scenarios).map(([name, scenario]) => ({
            dest: join(dir, name),
            content: `${JSON.stringify(scenario, null, 2)}\n`,
          })),
        ]),
  ];
  await assertNoExternalChanges(trackedWrites, options.overwrite === true);

  const writes: PendingWrite[] = [...trackedWrites, ...runWrites];

  // Preflight final: vuelve a validar TODOS los destinos (modelo, manifiesto, escenarios y
  // corridas incluidos) justo antes de tocar disco, para que ningún camino nuevo que se añada aquí
  // pueda olvidarse de la comprobación. Nada se ha escrito todavía en este punto.
  for (const { dest } of writes) {
    await assertValidDestination(dest, runsDir);
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

  // Fase 2: commit secuencial con rollback (ver `commitWithRollback`) — ya no es un `Promise.all`
  // de renames independientes: un fallo a mitad de camino deshace lo ya hecho en vez de dejar el
  // guardado a medias.
  await commitWithRollback(dir, writes, tmpPaths, fsImpl);

  // Snapshot posterior a la escritura: para el próximo `writeProjectFolder` de este proceso, "lo
  // que acabamos de escribir" ya cuenta como "lo último que vimos" (solo para los archivos
  // rastreados; ver `assertNoExternalChanges`).
  for (const { dest } of trackedWrites) {
    await rememberSnapshot(dest);
  }
}
