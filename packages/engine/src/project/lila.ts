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
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { version as engineVersion } from '../version.js';
import { ProjectFormatError, isPlainObject, isRevision, readProjectDocument, runProblem } from './document.js';
import type { ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from './types.js';

const MANIFEST_FILE = 'lila-project.json';
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

  put(MANIFEST_FILE, json(manifestOf(valid)));
  put(MODEL_FILE, strToU8(valid.model.xml));
  for (const name of Object.keys(valid.scenarios).sort()) {
    if (!isScenarioEntry(name)) {
      throw new ProjectFormatError(
        'LILA-ENTRY-PATH',
        `scenario names must be a flat "<name>${SCENARIO_SUFFIX}"; got ${JSON.stringify(name)}.`,
      );
    }
    put(name, json(valid.scenarios[name]));
  }
  for (const run of [...valid.runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const name = `${RUNS_DIR}/${run.id}${RUN_SUFFIX}`;
    if (!isRunEntry(name)) {
      throw new ProjectFormatError('LILA-ENTRY-PATH', `run ids must be flat names; got ${JSON.stringify(run.id)}.`);
    }
    put(name, json(run));
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
      `"${MANIFEST_FILE}" declares version ${JSON.stringify(parsed.version)}; this reader only understands version 1.`,
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
