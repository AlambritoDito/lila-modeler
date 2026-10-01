/**
 * A `.lila` as the input of the CLI and the MCP server (#466): open one process of the archive,
 * find its scenarios by name, and write one scenario back. Everything goes through the engine's
 * own codec (`decodeLila`/`encodeLila` via `lilaFile.ts`); there is no second ZIP reader here.
 *
 * Paths. The CLI and MCP resolve a scenario's `model` and `extends` as paths relative to the
 * scenario file (`resolveExtends`). A process inside a `.lila` is given a **virtual folder** under
 * the archive's own path, mirroring the archive layout:
 *
 *   version 1:  /abs/pedido.lila/model.bpmn, /abs/pedido.lila/as-is.scenario.json
 *   version 2:  /abs/repo.lila/processes/<slug>/model.bpmn, …/<name>.scenario.json
 *
 * so `"model": "model.bpmn"` and `"extends": "as-is.scenario.json"` resolve exactly as they do in
 * the project folder and in the web app, and the CLI's model-mismatch check needs no special case.
 * Those paths never exist on disk; `lilaScenarioReader` serves them from memory.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { messages, type Locale } from '../messages/index.js';
import {
  decodeLila,
  processesOf,
  ProjectFormatError,
  withProcesses,
  type ProcessDocument,
  type ProjectDocument,
  type ScenarioDocument,
} from '../project/index.js';
import { writeLilaFile } from './lilaFile.js';
import { ProjectIOError, rememberSnapshot } from './projectIO.js';

const SCENARIO_SUFFIX = '.scenario.json';
const MODEL_FILE = 'model.bpmn';

/** One process of a `.lila`, opened for reading (and, through `writeLilaScenario`, writing). */
export interface LilaProcess {
  /** Absolute path of the `.lila`, with `/` separators. */
  readonly file: string;
  /** The whole decoded project: every process, so a write can carry the others unchanged. */
  readonly document: ProjectDocument;
  /** The selected process. */
  readonly process: ProcessDocument;
  /** Every slug of the project, in tab order. */
  readonly slugs: readonly string[];
  /** Virtual folder of the process, ending in `/` (see the header). */
  readonly root: string;
  /** Virtual path of the process's `model.bpmn`: `${root}model.bpmn`. */
  readonly modelPath: string;
}

/** `/`-separated absolute path, the same rule as `absolutePath` in `cli-shared.ts`. */
function absolute(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

function isVersion2(document: ProjectDocument): boolean {
  return document.processes !== undefined && document.processes.length > 0;
}

/**
 * Opens `file` and selects one process: `process` (a slug) when given, the only one when there is
 * one, and an error listing the slugs when there are several and none was named. Records the
 * file's mtime/size snapshot, so a later `writeLilaScenario` refuses to overwrite a file somebody
 * else changed in between (`E-CAMBIO-EXTERNO`, same bookkeeping as the desktop).
 */
export async function openLilaProcess(
  file: string,
  options: { process?: string | undefined; locale?: Locale | undefined } = {},
): Promise<LilaProcess> {
  const C = messages(options.locale ?? 'en').cli;
  const path = absolute(file);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      throw new Error(messages(options.locale ?? 'en').mcp.fileMissing(path));
    }
    throw error;
  }
  let document: ProjectDocument;
  try {
    document = decodeLila(bytes);
  } catch (error) {
    if (error instanceof ProjectFormatError) throw new Error(C.lilaUnreadable(path, `${error.code}: ${error.message}`));
    throw error;
  }
  await rememberSnapshot(path);

  const all = processesOf(document);
  const slugs = all.map((p) => p.slug);
  let selected: ProcessDocument | undefined;
  if (options.process !== undefined) {
    selected = all.find((p) => p.slug === options.process);
    if (selected === undefined) throw new Error(C.lilaUnknownProcess(path, options.process, slugs.join(', ')));
  } else if (all.length === 1) {
    selected = all[0];
  } else {
    throw new Error(C.lilaProcessRequired(path, slugs.join(', ')));
  }
  const process = selected as ProcessDocument;
  const root = isVersion2(document) ? `${path}/processes/${process.slug}/` : `${path}/`;
  return { file: path, document, process, slugs, root, modelPath: `${root}${MODEL_FILE}` };
}

/**
 * The entry name (`<name>.scenario.json`) of the scenario `name` in `input`'s process. Accepted,
 * in this order: the entry name itself, the entry name without `.scenario.json`, and the
 * scenario's own `"name"` field (which must then be unique in the process).
 */
export function findLilaScenario(input: LilaProcess, name: string, locale: Locale = 'en'): string {
  const C = messages(locale).cli;
  const scenarios = input.process.scenarios;
  if (Object.hasOwn(scenarios, name)) return name;
  if (Object.hasOwn(scenarios, `${name}${SCENARIO_SUFFIX}`)) return `${name}${SCENARIO_SUFFIX}`;
  const byName = Object.keys(scenarios)
    .sort()
    .filter((entry) => scenarios[entry]?.['name'] === name);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new Error(C.lilaScenarioAmbiguous(name, byName.join(', ')));
  throw new Error(
    C.lilaScenarioNotFound(name, input.process.slug, input.file, Object.keys(scenarios).sort().join(', ')),
  );
}

/** Virtual path of the scenario `entry` of `input` (see the header). */
export function lilaScenarioPath(input: LilaProcess, entry: string): string {
  return `${input.root}${entry}`;
}

/**
 * A `ScenarioReader` for `resolveExtends`/`loadResolvedScenario`: a path inside the `.lila`
 * (anything under `<file>/`) is served from the process's scenarios in memory, and an unknown one
 * is an error — never a read of a disk path that happens to look like it. Any other path goes to
 * `fallback` (the disk reader), so an inline scenario may still `extends` a real file.
 */
export function lilaScenarioReader(
  input: LilaProcess,
  fallback: (path: string) => unknown,
  locale: Locale = 'en',
): (path: string) => unknown {
  return (path) => {
    if (!path.startsWith(`${input.file}/`)) return fallback(path);
    const entry = path.startsWith(input.root) ? path.slice(input.root.length) : '';
    const scenario = entry === '' || entry.includes('/') ? undefined : input.process.scenarios[entry];
    if (scenario === undefined || !Object.hasOwn(input.process.scenarios, entry)) {
      throw new Error(
        messages(locale).cli.lilaScenarioNotFound(
          path.slice(input.file.length + 1),
          input.process.slug,
          input.file,
          Object.keys(input.process.scenarios).sort().join(', '),
        ),
      );
    }
    return scenario;
  };
}

/** `name` as a flat scenario entry name: `.scenario.json` appended when missing, no folders. */
export function lilaScenarioEntryName(name: string, locale: Locale = 'en'): string {
  const entry = name.endsWith(SCENARIO_SUFFIX) ? name : `${name}${SCENARIO_SUFFIX}`;
  if (
    entry.length <= SCENARIO_SUFFIX.length ||
    entry.includes('/') ||
    entry.includes('\\') ||
    entry.startsWith('.')
  ) {
    throw new Error(messages(locale).cli.lilaScenarioEntryName(name));
  }
  return entry;
}

/**
 * Writes `scenario` as the entry `entry` of `input`'s process and saves the `.lila` atomically
 * (`writeLilaFile`: a temporary file and a `rename`, so an error never leaves a partial archive).
 * The scenario's revision goes up by one, so the app sees the runs of the old version as stale.
 * Every other process, scenario and run is carried through unchanged; the archive is re-encoded
 * canonically (`encodeLila`), so an archive the app or the engine wrote keeps every other entry
 * byte for byte. Entries outside the project layout are dropped, as in any save of a `.lila`.
 *
 * Refuses, writing nothing, when the file changed on disk since `openLilaProcess` read it.
 * Returns the project as written.
 */
export async function writeLilaScenario(
  input: LilaProcess,
  entry: string,
  scenario: ScenarioDocument,
  locale: Locale = 'en',
): Promise<ProjectDocument> {
  const name = lilaScenarioEntryName(entry, locale);
  const processes = processesOf(input.document).map((p): ProcessDocument => {
    if (p.slug !== input.process.slug) return p;
    return {
      ...p,
      scenarios: { ...p.scenarios, [name]: scenario },
      scenarioRevisions: { ...p.scenarioRevisions, [name]: (p.scenarioRevisions[name] ?? 0) + 1 },
    };
  });
  const { problems: _problems, loose: _loose, ...base } = input.document;
  const document = withProcesses(base, processes);
  try {
    await writeLilaFile(input.file, document);
  } catch (error) {
    if (error instanceof ProjectIOError && error.code === 'E-CAMBIO-EXTERNO') {
      throw new Error(messages(locale).cli.lilaChangedOnDisk(input.file));
    }
    if (error instanceof ProjectIOError) throw new Error(`${input.file}: ${error.code}: ${error.message}`);
    throw error;
  }
  return document;
}
