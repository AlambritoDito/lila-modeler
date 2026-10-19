/**
 * The `.lila` project container (ADR-027): the ADR-018 project FOLDER, zipped, with the same
 * layout and the same file names. `zip -r project.lila project-folder/*` produces a valid `.lila`
 * and `unzip` turns one back into a folder the desktop app already knows how to open — that
 * equivalence is the whole point of the format, so nothing here may invent a name the folder
 * reader does not use.
 *
 *   lila-project.json          manifest; `engine` is the only field the folder does not have
 *   model.bpmn                 the BPMN XML as-is
 *   <name>.scenario.json       the raw ScenarioDocument, one per scenario, `extends` untouched
 *   runs/<id>.result.json      the full StoredRun
 *
 * Anything else in the archive (`notes.md`, a newer build's `maps/`) is KEPT, byte for byte, and
 * written back by the next save (RM-01 § 1.4, ADR-032) — but beside the document, never inside it:
 * `decodeLilaArchive` returns those entries as `LilaPreserved`, and `encodeLila` takes them back.
 * `ProjectDocument` travels through `structuredClone` over IPC and through `JSON.stringify` into
 * the browser's `localStorage` mirror, and neither carries a `Uint8Array` honestly. An entry this
 * build does not understand is reported in `problems` ("not understood by this version; kept as
 * is"), except the reserved names of RM-01 § 1.1 and catalog files of unknown types, which are
 * expected; operating-system litter (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) and the writers' own
 * leftovers (`*.tmp-*`, `*.prev-*`, `*.lock`) are dropped without a word. See
 * `docs/PROJECT_FORMAT.md`.
 *
 * Output is deterministic — fixed mtime, canonical entry order — so two saves of the same
 * document are byte-identical and a round-trip test can compare archives, not just documents.
 *
 * Version 2 (ADR-029, #498) is the repository: the same manifest file with `"version": 2` and a
 * `processes` list, and each process's version 1 layout (model, scenarios, runs — no manifest of
 * its own) under `processes/<slug>/`. It is written ONLY when the document has more than one
 * process: a project that never grew a second one keeps producing the version 1 archive, byte for
 * byte, so the builds that only read version 1 go on opening it.
 *
 * Version 3 (RM-01 § 1, ADR-032) is the version 2 layout plus one file per catalog object,
 * `catalog/<type>/<id>.json`, and a process id per process in the manifest. It is written when the
 * document needs it (`formatVersionOf`) and, once read or written, it stays.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { version as engineVersion } from '../version.js';
import {
  canonicalCatalogObject,
  catalogObjectPath,
  catalogObjectProblem,
  compareCatalogObjects,
  isCatalogId,
  isCatalogType,
  newProcessId,
  type CatalogObject,
} from './catalog.js';
import { ProjectFormatError, isPlainObject, isRevision, readProjectDocument, runProblem } from './document.js';
import { isProcessSlug, processesOf, withProcesses } from './repository.js';
import type { ProcessDocument, ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from './types.js';
import { asVersion3, formatVersionOf } from './upgrade.js';

const MANIFEST_FILE = 'lila-project.json';
const PROCESSES_DIR = 'processes';
const MODEL_FILE = 'model.bpmn';
const RUNS_DIR = 'runs';
const SCENARIO_SUFFIX = '.scenario.json';
const RUN_SUFFIX = '.result.json';

/**
 * Fixed timestamp for every entry, so two saves of one document are byte-identical. Built from
 * LOCAL components on purpose: the ZIP date field stores local wall-clock fields with no zone, so
 * `new Date(1980, 0, 2, 12)` writes the same bytes everywhere, while a UTC instant would land on
 * 1979-12-31 west of Greenwich — outside the 1980-2099 the format can represent at all. Midday
 * keeps a spring-forward midnight from moving the date.
 */
const FIXED_MTIME = new Date(1980, 0, 2, 12, 0, 0, 0);

/** What `lila-project.json` holds. Same as the folder's, plus the optional `engine` stamp. */
interface Manifest {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly model: { readonly id: string; readonly name: string; readonly revision: number };
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  /** Engine version that wrote the runs in this archive. Informational; readers ignore it. */
  readonly engine?: string;
}

/**
 * One entry of a version 2 or 3 manifest's `processes`: the version 1 manifest minus the project.
 * `id` is the process id, in a version 3 manifest only (RM-01 § 1.2).
 */
export interface ProcessManifest {
  readonly id?: string;
  readonly slug: string;
  readonly name: string;
  readonly model: { readonly id: string; readonly name: string; readonly revision: number };
  readonly scenarioRevisions: Readonly<Record<string, number>>;
}

/**
 * What `lila-project.json` holds in a repository (ADR-029). Exported, with `repositoryManifestOf`
 * and `readRepositoryManifest`, so the desktop folder writes and reads the same manifest the
 * archive does — it just leaves `engine` out, like its version 1 manifest.
 */
export interface RepositoryManifest {
  readonly version: 2;
  readonly id: string;
  readonly name: string;
  readonly processes: readonly ProcessManifest[];
  readonly engine?: string;
}

/**
 * A ZIP entry name is attacker-controlled: `../../.ssh/authorized_keys` and `/etc/passwd` are
 * both legal strings in the archive. The project layout only ever needs flat names plus a single
 * `runs/` level, so anything with a traversal segment, a root, a drive letter or a backslash is
 * refused outright — a zip that carries one is not a project that lost a file, it is a zip built
 * to escape, and opening the rest of it anyway would be doing half of what it asked for.
 */
function assertSafeEntryName(name: string): void {
  const bad =
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split('/').some((segment) => segment === '..');
  if (bad) {
    throw new ProjectFormatError('LILA-ENTRY-PATH', `unsafe entry name in the .lila archive: ${JSON.stringify(name)}`);
  }
}

/**
 * The bytes a `.lila` held that are not part of the document (RM-01 § 1.4, § 5.3), kept beside it
 * so the next `encodeLila` writes them back. Never put inside `ProjectDocument`: it would have to
 * cross IPC and the browser's `localStorage`, which cannot carry bytes.
 */
export interface LilaPreserved {
  /**
   * Entries kept as read and written back unchanged, by entry name: entries this build does not
   * understand, broken catalog objects, and the reserved names of RM-01 § 1.1.
   */
  readonly entries: Readonly<Record<string, Uint8Array>>;
  /** The bytes each catalog object was read from, by entry name: an unchanged object is written back with them. */
  readonly objects: Readonly<Record<string, Uint8Array>>;
  /**
   * The slugs the manifest listed when the entries were read. A kept entry under
   * `processes/<slug>/` of a listed slug that is no longer a process left with that process.
   */
  readonly slugs: readonly string[];
}

/** Top-level folders RM-01 § 1.1 reserves for later phases (and `attachments/`, not read in A1): kept silently. */
const RESERVED_DIRS = ['analysis/', 'attachments/', 'dashboards/', 'maps/', 'records/'];

/** `catalog/<type>/<file>.json`, one level deep (RM-01 § 2.4). */
const CATALOG_ENTRY = /^catalog\/([^/]+)\/([^/]+)\.json$/;

/** Operating-system litter and the writers' own leftovers: dropped without a report (RM-01 § 1.4). */
function isLitter(name: string): boolean {
  const segments = name.split('/');
  const base = segments[segments.length - 1] ?? '';
  return (
    segments[0] === '__MACOSX' ||
    segments.includes('.DS_Store') ||
    base === 'Thumbs.db' ||
    base.includes('.tmp-') ||
    base.includes('.prev-') ||
    base.endsWith('.lock')
  );
}

/** What the readers of every version collect besides the processes. */
interface Extras {
  readonly problems: ProjectProblem[];
  readonly catalog: CatalogObject[];
  readonly entries: Record<string, Uint8Array>;
  readonly objects: Record<string, Uint8Array>;
  /** Slugs listed by the manifest (none in version 1): their `process.json` is a reserved name. */
  readonly slugs: readonly string[];
  /** `true` once something only version 3 holds was found (RM-01 § 1.3): a catalog object or a reserved name. */
  version3: boolean;
}

function newExtras(slugs: readonly string[]): Extras {
  return { problems: [], catalog: [], entries: {}, objects: {}, slugs, version3: false };
}

/**
 * An entry that is not part of a process: a catalog object, a reserved name, litter, or an entry
 * this build does not understand (RM-01 § 1.4, § 2.4). Everything but litter is kept.
 */
function readOtherEntry(name: string, raw: Uint8Array, extras: Extras): void {
  if (isLitter(name)) return;
  const object = CATALOG_ENTRY.exec(name);
  if (object !== null && isCatalogType(object[1])) {
    extras.version3 = true;
    const [, type, id] = object as unknown as [string, string, string];
    let problem: string | null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(raw));
      problem = isCatalogId(id) ? catalogObjectProblem(parsed, { type, id }) : `the file name is not an object id (^[a-z0-9][a-z0-9-]{0,63}$).`;
    } catch (error) {
      problem = (error as Error).message;
    }
    if (problem === null) {
      extras.catalog.push(parsed as CatalogObject);
      extras.objects[name] = raw;
    } else {
      // Excluded and explained, never dropped: other objects may point at it (RM-01 § 2.4).
      extras.problems.push({ file: name, message: `${problem} Not loaded; kept as is.` });
      extras.entries[name] = raw;
    }
    return;
  }
  const reserved =
    RESERVED_DIRS.some((dir) => name.startsWith(dir)) ||
    extras.slugs.some((slug) => name === `${PROCESSES_DIR}/${slug}/process.json`);
  if (reserved) {
    extras.version3 = true;
    extras.entries[name] = raw;
    return;
  }
  extras.entries[name] = raw;
  extras.problems.push({ file: name, message: 'not understood by this version; kept as is.' });
}

/**
 * The catalog as read, in catalog order, with an id found under two types reported (RM-01 § 2.3):
 * both objects are loaded, and each typed reference resolves against the type it expects.
 */
function finishCatalog(extras: Extras): CatalogObject[] {
  const catalog = [...extras.catalog].sort(compareCatalogObjects);
  const first = new Map<string, CatalogObject>();
  for (const object of catalog) {
    const seen = first.get(object.id);
    if (seen === undefined) {
      first.set(object.id, object);
      continue;
    }
    extras.problems.push({
      file: catalogObjectPath(object),
      message: `the id ${JSON.stringify(object.id)} is also used by ${catalogObjectPath(seen)}; references resolve by the type they expect.`,
    });
  }
  return catalog;
}

/** `true` for a flat `<name>.scenario.json` at the root of the archive. */
function isScenarioEntry(name: string): boolean {
  return !name.includes('/') && name.endsWith(SCENARIO_SUFFIX) && name.length > SCENARIO_SUFFIX.length;
}

/** `true` for a `runs/<id>.result.json` one level deep. */
function isRunEntry(name: string): boolean {
  if (!name.startsWith(`${RUNS_DIR}/`) || !name.endsWith(RUN_SUFFIX)) return false;
  const rest = name.slice(RUNS_DIR.length + 1);
  return !rest.includes('/') && rest.length > RUN_SUFFIX.length;
}

/** The version 2 manifest of `document`, without the `engine` stamp. */
export function repositoryManifestOf(document: ProjectDocument): RepositoryManifest {
  return {
    version: 2,
    id: document.id,
    name: document.name,
    processes: processesOf(document).map((p) => ({
      slug: p.slug,
      name: p.name,
      model: { id: p.model.id, name: p.model.name, revision: p.model.revision },
      scenarioRevisions: p.scenarioRevisions,
    })),
  };
}

function manifestOf(document: ProjectDocument): Manifest {
  return {
    version: 1,
    id: document.id,
    name: document.name,
    model: { id: document.model.id, name: document.model.name, revision: document.model.revision },
    scenarioRevisions: document.scenarioRevisions,
    engine: engineVersion,
  };
}

/** The version 3 manifest of `document` (RM-01 § 1.2); every process must already have its id. */
function version3ManifestOf(document: ProjectDocument, processes: readonly ProcessDocument[]): Record<string, unknown> {
  return {
    version: 3,
    id: document.id,
    name: document.name,
    processes: processes.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      model: { id: p.model.id, name: p.model.name, revision: p.model.revision },
      scenarioRevisions: p.scenarioRevisions,
    })),
    ...(document.limits !== undefined ? { limits: document.limits } : {}),
    engine: engineVersion,
  };
}

function json(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The canonical entry order: manifest, model, scenarios sorted by name, runs sorted by id; in a
 * version 3 archive the catalog objects next, by type and then id (RM-01 § 1.5); and last the
 * entries `preserved` keeps, attachments first and then the rest, each sorted by name. It is what
 * makes two encodings of the same document byte-identical, and it is the order `lilaEntryNames`
 * reports.
 *
 * `preserved` is what `decodeLilaArchive` returned for the archive this document came from (or
 * `null`): its entries are written back as they were read, except those of a process deleted
 * since (in a version 2 or 3 archive; a version 1 archive keeps them, as the folder keeps an old
 * `processes/` folder), and an unchanged catalog object is written with the bytes it was read from.
 * A version 3 document whose processes lack an id gets fresh ones here; call `asVersion3` first to
 * keep them stable across saves.
 */
export function encodeLila(document: ProjectDocument, preserved: LilaPreserved | null = null): Uint8Array<ArrayBuffer> {
  const valid = readProjectDocument(document);
  const files: Record<string, [Uint8Array, { mtime: Date; level: 0 | 6 }]> = {};
  const put = (name: string, bytes: Uint8Array, level: 0 | 6 = 6): void => {
    assertSafeEntryName(name);
    files[name] = [bytes, { mtime: FIXED_MTIME, level }];
  };
  /** One process's version 1 layout under `prefix` (`''` for a version 1 archive). */
  const putProcess = (prefix: string, process: Pick<ProcessDocument, 'model' | 'scenarios' | 'runs'>): void => {
    put(`${prefix}${MODEL_FILE}`, strToU8(process.model.xml));
    for (const name of Object.keys(process.scenarios).sort()) {
      if (!isScenarioEntry(name)) {
        throw new ProjectFormatError(
          'LILA-ENTRY-PATH',
          `scenario names must be a flat "<name>${SCENARIO_SUFFIX}"; got ${JSON.stringify(name)}.`,
        );
      }
      put(`${prefix}${name}`, json(process.scenarios[name]));
    }
    for (const run of [...process.runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const name = `${RUNS_DIR}/${run.id}${RUN_SUFFIX}`;
      if (!isRunEntry(name)) {
        throw new ProjectFormatError('LILA-ENTRY-PATH', `run ids must be flat names; got ${JSON.stringify(run.id)}.`);
      }
      put(`${prefix}${name}`, json(run));
    }
  };

  const version = formatVersionOf(valid);
  let slugs: string[] = [];
  if (version === 1) {
    put(MANIFEST_FILE, json(manifestOf(valid)));
    putProcess('', valid);
  } else if (version === 2) {
    put(MANIFEST_FILE, json({ ...repositoryManifestOf(valid), engine: engineVersion }));
    slugs = processesOf(valid).map((p) => p.slug);
    for (const process of processesOf(valid)) putProcess(`${PROCESSES_DIR}/${process.slug}/`, process);
  } else {
    const processes = processesOf(valid).map((p) => (p.id !== undefined ? p : { ...p, id: newProcessId() }));
    slugs = processes.map((p) => p.slug);
    put(MANIFEST_FILE, json(version3ManifestOf(valid, processes)));
    for (const process of processes) putProcess(`${PROCESSES_DIR}/${process.slug}/`, process);
    for (const object of [...(valid.catalog ?? [])].sort(compareCatalogObjects)) {
      const path = catalogObjectPath(object);
      const bytes = json(canonicalCatalogObject(object));
      put(path, sameObject(preserved?.objects[path], bytes) ?? bytes);
    }
  }

  if (preserved !== null) {
    const gone = new Set(version === 1 ? [] : preserved.slugs.filter((slug) => !slugs.includes(slug)));
    const names = Object.keys(preserved.entries)
      .filter((name) => !Object.hasOwn(files, name))
      .filter((name) => ![...gone].some((slug) => name.startsWith(`${PROCESSES_DIR}/${slug}/`)))
      .sort((a, b) => {
        const aa = a.startsWith('attachments/') ? 0 : 1;
        const bb = b.startsWith('attachments/') ? 0 : 1;
        return aa !== bb ? aa - bb : a < b ? -1 : a > b ? 1 : 0;
      });
    // Attachments are stored, not compressed (RM-01 § 1.5): they usually are already.
    for (const name of names) put(name, preserved.entries[name] as Uint8Array, name.startsWith('attachments/') ? 0 : 6);
  }
  // `zipSync` allocates a plain `ArrayBuffer`; the cast only narrows `ArrayBufferLike`, which the
  // DOM's `BlobPart` refuses because a `SharedArrayBuffer` would also satisfy it.
  return zipSync(files) as Uint8Array<ArrayBuffer>;
}

/**
 * `original` when it is the same object as `canonical` (the canonical bytes of the object now),
 * however it was formatted: an object nobody changed keeps the bytes it was read with.
 */
function sameObject(original: Uint8Array | undefined, canonical: Uint8Array): Uint8Array | undefined {
  if (original === undefined) return undefined;
  try {
    const parsed = JSON.parse(strFromU8(original)) as CatalogObject;
    return strFromU8(json(canonicalCatalogObject(parsed))) === strFromU8(canonical) ? original : undefined;
  } catch {
    return undefined;
  }
}

/** Entry names of a `.lila`, in the order the archive stores them. */
export function lilaEntryNames(bytes: Uint8Array): readonly string[] {
  return Object.keys(unzip(bytes));
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch (error) {
    throw new ProjectFormatError('LILA-ZIP', `the file is not a readable .lila archive: ${(error as Error).message}`);
  }
}

function readManifest(raw: Uint8Array, problems: ProjectProblem[]): Manifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(raw));
  } catch (error) {
    problems.push({ file: MANIFEST_FILE, message: (error as Error).message });
    return null;
  }
  if (
    !isPlainObject(parsed) ||
    typeof parsed.id !== 'string' ||
    typeof parsed.name !== 'string' ||
    !isPlainObject(parsed.model) ||
    typeof parsed.model.id !== 'string' ||
    typeof parsed.model.name !== 'string' ||
    !isRevision(parsed.model.revision)
  ) {
    throw new ProjectFormatError('LILA-MANIFEST', `"${MANIFEST_FILE}" does not describe a Lila project.`);
  }
  if (parsed.version !== 1) {
    throw new ProjectFormatError(
      'LILA-MANIFEST',
      `"${MANIFEST_FILE}" declares version ${JSON.stringify(parsed.version)}; this reader understands versions 1, 2 and 3.`,
    );
  }
  const revisions = isPlainObject(parsed.scenarioRevisions) ? parsed.scenarioRevisions : {};
  return {
    version: 1,
    id: parsed.id,
    name: parsed.name,
    model: { id: parsed.model.id, name: parsed.model.name, revision: parsed.model.revision },
    scenarioRevisions: Object.fromEntries(Object.entries(revisions).filter(([, v]) => isRevision(v))) as Record<string, number>,
  };
}

/** What `decodeLilaArchive` returns: the document, and the entries kept beside it. */
export interface DecodedLila {
  readonly document: ProjectDocument;
  readonly preserved: LilaPreserved;
}

/**
 * Reads a `.lila`. Tolerant in exactly the same places as the folder reader: a broken scenario or
 * run is excluded and explained in `problems`, while a missing manifest or a missing `model.bpmn`
 * is fatal — without them there is no project and nothing to model. The document only: use
 * `decodeLilaArchive` to keep the entries this build does not interpret.
 */
export function decodeLila(bytes: Uint8Array): ProjectDocument {
  return decodeLilaArchive(bytes).document;
}

/**
 * `decodeLila`, plus what the archive held besides the document (`LilaPreserved`), for the next
 * `encodeLila` to write back. Versions 1, 2 and 3; anything above is refused with `LILA-MANIFEST`.
 */
export function decodeLilaArchive(bytes: Uint8Array): DecodedLila {
  const entries = unzip(bytes);
  for (const name of Object.keys(entries)) assertSafeEntryName(name);

  const manifestRaw = entries[MANIFEST_FILE];
  if (manifestRaw === undefined) {
    throw new ProjectFormatError('LILA-NO-MANIFEST', `the archive has no "${MANIFEST_FILE}": it is not a .lila project.`);
  }
  // A repository has no `model.bpmn` at the root, so the version has to be known before the
  // version 1 checks below run. Anything that is not a version 2 or 3 manifest takes the version
  // 1 path untouched, errors included.
  const peeked = peekManifest(manifestRaw);
  if (isPlainObject(peeked) && (peeked.version === 2 || peeked.version === 3)) return decodeRepository(peeked, entries);
  // A newer version says so, instead of being blamed for a missing root `model.bpmn` its layout
  // never promised.
  if (isPlainObject(peeked) && typeof peeked.version === 'number' && peeked.version > 3) {
    throw new ProjectFormatError(
      'LILA-MANIFEST',
      `"${MANIFEST_FILE}" declares version ${peeked.version}; this reader understands versions 1, 2 and 3.`,
    );
  }
  const modelRaw = entries[MODEL_FILE];
  if (modelRaw === undefined) {
    throw new ProjectFormatError('LILA-NO-MODEL', `the archive has no "${MODEL_FILE}".`);
  }

  const extras = newExtras([]);
  const problems = extras.problems;
  const manifest = readManifest(manifestRaw, problems);
  if (manifest === null) {
    throw new ProjectFormatError('LILA-MANIFEST', `"${MANIFEST_FILE}" could not be parsed.`);
  }

  const scenarios: Record<string, ScenarioDocument> = {};
  const runs: StoredRun[] = [];
  for (const name of Object.keys(entries).sort()) {
    if (name === MANIFEST_FILE || name === MODEL_FILE) continue;
    // Directory entries carry no content and need no complaint: `zip -r` writes them.
    if (name.endsWith('/')) continue;
    const raw = entries[name] as Uint8Array;
    if (isScenarioEntry(name)) {
      try {
        const parsed: unknown = JSON.parse(strFromU8(raw));
        if (!isPlainObject(parsed)) throw new Error('the content is not a JSON object.');
        scenarios[name] = parsed;
      } catch (error) {
        problems.push({ file: name, message: (error as Error).message });
      }
      continue;
    }
    if (isRunEntry(name)) {
      try {
        const parsed: unknown = JSON.parse(strFromU8(raw));
        const problem = runProblem(parsed);
        if (problem !== null) throw problem;
        runs.push(parsed as unknown as StoredRun);
      } catch (error) {
        problems.push({ file: name, message: (error as Error).message });
      }
      continue;
    }
    readOtherEntry(name, raw, extras);
  }
  const catalog = finishCatalog(extras);

  const document: ProjectDocument = {
    version: 1,
    id: manifest.id,
    name: manifest.name,
    model: { id: manifest.model.id, name: manifest.model.name, xml: strFromU8(modelRaw), revision: manifest.model.revision },
    scenarios,
    scenarioRevisions: manifest.scenarioRevisions,
    runs,
    // Only when there is something to say: an empty `problems` would make an untouched
    // encode/decode round-trip stop being an identity.
    ...(problems.length > 0 ? { problems } : {}),
  };
  // A catalog object or a reserved name in a version 1 archive (added by hand or by another tool)
  // is loaded, and makes the document version 3 (RM-01 § 1.3): its next save writes it as one.
  const read = extras.version3 ? asVersion3({ ...document, catalog }) : document;
  return { document: readProjectDocument(read), preserved: preservedOf(extras) };
}

function preservedOf(extras: Extras): LilaPreserved {
  return { entries: extras.entries, objects: extras.objects, slugs: extras.slugs };
}

function peekManifest(raw: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(raw));
  } catch {
    return undefined;
  }
}

/**
 * The `processes` of a parsed version 2 or 3 manifest, or a `LILA-MANIFEST` saying why not: at
 * least one, each with a valid slug (`isProcessSlug`), a name and a model, and no slug twice. In a
 * version 3 manifest (`parsed.version === 3`) each also needs its process id, unique (RM-01 § 1.2).
 */
export function readRepositoryManifest(parsed: Record<string, unknown>): ProcessManifest[] {
  const bad = (why: string): never => {
    throw new ProjectFormatError('LILA-MANIFEST', `"${MANIFEST_FILE}" does not describe a Lila repository: ${why}`);
  };
  const version3 = parsed.version === 3;
  if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') bad('"id" and "name" must be text.');
  if (!Array.isArray(parsed.processes) || parsed.processes.length === 0) bad('"processes" must list at least one process.');
  const seen = new Set<string>();
  const ids = new Set<string>();
  return (parsed.processes as unknown[]).map((entry) => {
    if (
      !isPlainObject(entry) ||
      !isProcessSlug(entry.slug) ||
      typeof entry.name !== 'string' ||
      !isPlainObject(entry.model) ||
      typeof entry.model.id !== 'string' ||
      typeof entry.model.name !== 'string' ||
      !isRevision(entry.model.revision)
    ) {
      return bad('a process needs a slug (a-z, 0-9, -), a name and a model.');
    }
    if (seen.has(entry.slug)) bad(`the slug ${JSON.stringify(entry.slug)} is repeated.`);
    seen.add(entry.slug);
    if (version3) {
      if (!isCatalogId(entry.id)) bad(`the process ${JSON.stringify(entry.slug)} needs an "id" (a-z, 0-9, -).`);
      if (ids.has(entry.id as string)) bad(`the process id ${JSON.stringify(entry.id)} is repeated.`);
      ids.add(entry.id as string);
    }
    const revisions = isPlainObject(entry.scenarioRevisions) ? entry.scenarioRevisions : {};
    return {
      ...(version3 ? { id: entry.id as string } : {}),
      slug: entry.slug,
      name: entry.name,
      model: { id: entry.model.id, name: entry.model.name, revision: entry.model.revision },
      scenarioRevisions: Object.fromEntries(Object.entries(revisions).filter(([, v]) => isRevision(v))) as Record<string, number>,
    };
  });
}

/** The largest size a `.lila` can hold (no ZIP64): the ceiling of each `limits` member (RM-01 § 1.2). */
const MAX_LIMIT = 4_294_967_295;

/**
 * Reports what is wrong with a version 3 manifest's `limits` (RM-01 § 1.2). Nothing is refused or
 * fixed: the defaults apply where a value is invalid, and the value is written back as found.
 */
function checkLimits(limits: unknown, problems: ProjectProblem[]): void {
  if (!isPlainObject(limits)) {
    problems.push({ file: MANIFEST_FILE, message: '"limits" is not an object; the default limits apply.' });
    return;
  }
  for (const member of ['attachmentBytes', 'repositoryBytes']) {
    const value = limits[member];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
      problems.push({
        file: MANIFEST_FILE,
        message: `"limits.${member}" must be a positive integer no larger than ${MAX_LIMIT}; the default applies.`,
      });
    }
  }
}

/**
 * Reads a version 2 or 3 archive (ADR-029, RM-01 § 1): each listed process from its
 * `processes/<slug>/` folder, with exactly the tolerance of the version 1 reader — a missing
 * `model.bpmn` is fatal, a broken scenario or run is excluded and explained — plus the catalog
 * objects, and every other entry kept (`readOtherEntry`).
 */
function decodeRepository(parsed: Record<string, unknown>, entries: Record<string, Uint8Array>): DecodedLila {
  const manifests = readRepositoryManifest(parsed);
  const extras = newExtras(manifests.map((m) => m.slug));
  const problems = extras.problems;
  const byPrefix = new Map(manifests.map((m) => [`${PROCESSES_DIR}/${m.slug}/`, {
    manifest: m,
    scenarios: {} as Record<string, ScenarioDocument>,
    runs: [] as StoredRun[],
  }]));
  for (const [prefix] of byPrefix) {
    if (entries[`${prefix}${MODEL_FILE}`] === undefined) {
      throw new ProjectFormatError('LILA-NO-MODEL', `the archive has no "${prefix}${MODEL_FILE}".`);
    }
  }
  const version3 = parsed.version === 3;
  if (version3 && parsed.limits !== undefined) checkLimits(parsed.limits, problems);

  for (const name of Object.keys(entries).sort()) {
    if (name === MANIFEST_FILE || name.endsWith('/')) continue;
    const raw = entries[name] as Uint8Array;
    const slash = name.indexOf('/', PROCESSES_DIR.length + 1);
    const target = name.startsWith(`${PROCESSES_DIR}/`) && slash > 0 ? byPrefix.get(name.slice(0, slash + 1)) : undefined;
    const rest = target === undefined ? '' : name.slice(slash + 1);
    if (target !== undefined && rest === MODEL_FILE) continue;
    if (target !== undefined && isScenarioEntry(rest)) {
      try {
        const scenario: unknown = JSON.parse(strFromU8(raw));
        if (!isPlainObject(scenario)) throw new Error('the content is not a JSON object.');
        target.scenarios[rest] = scenario;
      } catch (error) {
        problems.push({ file: name, message: (error as Error).message });
      }
      continue;
    }
    if (target !== undefined && isRunEntry(rest)) {
      try {
        const run: unknown = JSON.parse(strFromU8(raw));
        const problem = runProblem(run);
        if (problem !== null) throw problem;
        target.runs.push(run as unknown as StoredRun);
      } catch (error) {
        problems.push({ file: name, message: (error as Error).message });
      }
      continue;
    }
    readOtherEntry(name, raw, extras);
  }
  const catalog = finishCatalog(extras);

  const processes: ProcessDocument[] = [...byPrefix].map(([prefix, { manifest, scenarios, runs }]) => ({
    ...(manifest.id !== undefined ? { id: manifest.id } : {}),
    slug: manifest.slug,
    name: manifest.name,
    model: { ...manifest.model, xml: strFromU8(entries[`${prefix}${MODEL_FILE}`] as Uint8Array) },
    scenarios,
    scenarioRevisions: manifest.scenarioRevisions,
    runs,
  }));
  const first = processes[0] as ProcessDocument;
  const base: ProjectDocument = {
    version: 1,
    id: parsed.id as string,
    name: parsed.name as string,
    model: first.model,
    scenarios: first.scenarios,
    scenarioRevisions: first.scenarioRevisions,
    runs: first.runs,
    ...(version3 ? { formatVersion: 3 as const, catalog } : {}),
    ...(version3 && parsed.limits !== undefined ? { limits: parsed.limits } : {}),
    ...(problems.length > 0 ? { problems } : {}),
  };
  const read = withProcesses(base, processes, { repository: true });
  // A version 2 archive with a catalog object or a reserved name becomes version 3 (RM-01 § 1.3).
  const document = !version3 && extras.version3 ? asVersion3({ ...read, catalog }) : read;
  return { document: readProjectDocument(document), preserved: preservedOf(extras) };
}
