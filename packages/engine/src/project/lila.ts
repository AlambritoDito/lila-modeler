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
 * Anything else in the archive (`notes.md`, `attachments/…`) is REPORTED and DROPPED: it lands in
 * `document.problems` when opening and is not written back. Keeping it would mean carrying opaque
 * bytes inside `ProjectDocument`, which travels through `structuredClone` over IPC and through
 * `JSON.stringify` into the browser's `localStorage` mirror — neither survives a `Uint8Array`
 * honestly. Saying so out loud beats pretending the round-trip is lossless. See
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
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { version as engineVersion } from '../version.js';
import { ProjectFormatError, isPlainObject, isRevision, readProjectDocument, runProblem } from './document.js';
import { isProcessSlug, processesOf, withProcesses } from './repository.js';
import type { ProcessDocument, ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from './types.js';

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

/** One entry of a version 2 manifest's `processes`: the version 1 manifest minus the project. */
export interface ProcessManifest {
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

function json(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The canonical entry order: manifest, model, scenarios sorted by name, runs sorted by id. It is
 * what makes two encodings of the same document byte-identical, and it is the order
 * `lilaEntryNames` reports.
 */
export function encodeLila(document: ProjectDocument): Uint8Array<ArrayBuffer> {
  const valid = readProjectDocument(document);
  const files: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  const put = (name: string, bytes: Uint8Array): void => {
    assertSafeEntryName(name);
    files[name] = [bytes, { mtime: FIXED_MTIME, level: 6 }];
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

  if (valid.processes === undefined || valid.processes.length === 0) {
    put(MANIFEST_FILE, json(manifestOf(valid)));
    putProcess('', valid);
  } else {
    put(MANIFEST_FILE, json({ ...repositoryManifestOf(valid), engine: engineVersion }));
    for (const process of processesOf(valid)) putProcess(`${PROCESSES_DIR}/${process.slug}/`, process);
  }
  // `zipSync` allocates a plain `ArrayBuffer`; the cast only narrows `ArrayBufferLike`, which the
  // DOM's `BlobPart` refuses because a `SharedArrayBuffer` would also satisfy it.
  return zipSync(files) as Uint8Array<ArrayBuffer>;
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
      `"${MANIFEST_FILE}" declares version ${JSON.stringify(parsed.version)}; this reader understands versions 1 and 2.`,
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

/**
 * Reads a `.lila`. Tolerant in exactly the same places as the folder reader: a broken scenario or
 * run is excluded and explained in `problems`, while a missing manifest or a missing `model.bpmn`
 * is fatal — without them there is no project and nothing to model.
 */
export function decodeLila(bytes: Uint8Array): ProjectDocument {
  const entries = unzip(bytes);
  for (const name of Object.keys(entries)) assertSafeEntryName(name);

  const manifestRaw = entries[MANIFEST_FILE];
  if (manifestRaw === undefined) {
    throw new ProjectFormatError('LILA-NO-MANIFEST', `the archive has no "${MANIFEST_FILE}": it is not a .lila project.`);
  }
  // A repository has no `model.bpmn` at the root, so the version has to be known before the
  // version 1 checks below run. Anything that is not a version 2 manifest takes the version 1
  // path untouched, errors included.
  const peeked = peekManifest(manifestRaw);
  if (isPlainObject(peeked) && peeked.version === 2) return decodeRepository(peeked, entries);
  // A newer version says so, instead of being blamed for a missing root `model.bpmn` its layout
  // never promised.
  if (isPlainObject(peeked) && typeof peeked.version === 'number' && peeked.version > 2) {
    throw new ProjectFormatError(
      'LILA-MANIFEST',
      `"${MANIFEST_FILE}" declares version ${peeked.version}; this reader understands versions 1 and 2.`,
    );
  }
  const modelRaw = entries[MODEL_FILE];
  if (modelRaw === undefined) {
    throw new ProjectFormatError('LILA-NO-MODEL', `the archive has no "${MODEL_FILE}".`);
  }

  const problems: ProjectProblem[] = [];
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
    problems.push({ file: name, message: 'not part of the Lila project layout; ignored and not written back.' });
  }

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
  return readProjectDocument(document);
}

function peekManifest(raw: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(raw));
  } catch {
    return undefined;
  }
}

/**
 * The `processes` of a parsed version 2 manifest, or a `LILA-MANIFEST` saying why not: at least
 * one, each with a valid slug (`isProcessSlug`), a name and a model, and no slug twice.
 */
export function readRepositoryManifest(parsed: Record<string, unknown>): ProcessManifest[] {
  const bad = (why: string): never => {
    throw new ProjectFormatError('LILA-MANIFEST', `"${MANIFEST_FILE}" does not describe a Lila repository: ${why}`);
  };
  if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') bad('"id" and "name" must be text.');
  if (!Array.isArray(parsed.processes) || parsed.processes.length === 0) bad('"processes" must list at least one process.');
  const seen = new Set<string>();
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
    const revisions = isPlainObject(entry.scenarioRevisions) ? entry.scenarioRevisions : {};
    return {
      slug: entry.slug,
      name: entry.name,
      model: { id: entry.model.id, name: entry.model.name, revision: entry.model.revision },
      scenarioRevisions: Object.fromEntries(Object.entries(revisions).filter(([, v]) => isRevision(v))) as Record<string, number>,
    };
  });
}

/**
 * Reads a version 2 archive (ADR-029): each listed process from its `processes/<slug>/` folder,
 * with exactly the tolerance of the version 1 reader — a missing `model.bpmn` is fatal, a broken
 * scenario or run is excluded and explained, and anything outside the listed folders is reported
 * and dropped.
 */
function decodeRepository(parsed: Record<string, unknown>, entries: Record<string, Uint8Array>): ProjectDocument {
  const manifests = readRepositoryManifest(parsed);
  const problems: ProjectProblem[] = [];
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
    problems.push({ file: name, message: 'not part of the Lila repository layout; ignored and not written back.' });
  }

  const processes: ProcessDocument[] = [...byPrefix].map(([prefix, { manifest, scenarios, runs }]) => ({
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
    ...(problems.length > 0 ? { problems } : {}),
  };
  return readProjectDocument(withProcesses(base, processes, { repository: true }));
}
