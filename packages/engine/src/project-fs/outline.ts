/**
 * An outline (#97) into a `.lila` and back: what `create_process`/`get_process_outline` (MCP) and
 * `lila process create|show` (CLI) do. Both are thin layers over these two functions.
 *
 * `createLilaProcess` adds `processes/<slug>/` to an existing `.lila` (a version 1 project becomes
 * a repository, ADR-029) or writes a new `.lila` when the file does not exist. It never replaces a
 * process: a slug already in the file is an error and nothing is written. Every other process is
 * carried through unchanged, through the same codec the app saves with.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { bpmnToOutline, outlineToBpmn, type NormalOutline } from '../bpmn/outline.js';
import type { ValidationResult } from '../bpmn/validate.js';
import { messages, type Locale } from '../messages/index.js';
import {
  decodeLila,
  isProcessSlug,
  processesOf,
  processSlug,
  ProjectFormatError,
  withProcesses,
  type ProcessDocument,
  type ProjectDocument,
} from '../project/index.js';
import { writeLilaFile } from './lilaFile.js';
import { openLilaProcess, writeLilaProject, type LilaProcess } from './input.js';
import { isLilaPath } from './paths.js';
import { ProjectIOError } from './projectIO.js';

/** The scenario every created process gets (`outlineToBpmn`'s base scenario). */
export const BASE_SCENARIO = 'as-is.scenario.json';

export interface CreateLilaProcessOptions {
  /** Name of the process (tab and pool). Default: the outline's `name`. */
  name?: string | undefined;
  /** Slug of its `processes/<slug>/` folder. Default: derived from the name. */
  process?: string | undefined;
  /** Build and check everything, write nothing. */
  dryRun?: boolean | undefined;
  locale?: Locale | undefined;
}

export interface CreatedLilaProcess {
  /** Absolute path of the `.lila`, `/`-separated. */
  readonly file: string;
  readonly slug: string;
  readonly name: string;
  /** `true` when the `.lila` did not exist and is (or, with `dryRun`, would be) created. */
  readonly newFile: boolean;
  readonly dryRun: boolean;
  /** Validator warnings on the generated model. */
  readonly warnings: ValidationResult['warnings'];
  /** Lila's own warnings on the outline (`OutlineBpmn.notes`). */
  readonly notes: readonly string[];
  /** The outline as stored, in normal form. */
  readonly outline: NormalOutline;
  /** One line for a person: what was (or would be) created where. */
  readonly summary: string;
  /** Every slug of the project after the write, in tab order. */
  readonly slugs: readonly string[];
}

function absolute(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

/**
 * The `.lila` at `path` opened for writing (`openLilaProcess`, so the write is checked against its
 * snapshot), or `null` when there is no such file. The process opened is just the first one: what
 * matters here is the whole document and the snapshot.
 */
async function existing(path: string, locale: Locale): Promise<LilaProcess | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
  let first: string;
  try {
    first = processesOf(decodeLila(bytes))[0]!.slug;
  } catch (error) {
    if (error instanceof ProjectFormatError) {
      throw new Error(messages(locale).cli.lilaUnreadable(path, `${error.code}: ${error.message}`));
    }
    throw error;
  }
  return openLilaProcess(path, { process: first, locale });
}

/** Process id of a created model: `Process_<slug>`, `-` turned into `_` (an NCName either way). */
function processIdOf(slug: string): string {
  return `Process_${slug.replaceAll('-', '_')}`;
}

/**
 * Builds the process of `outline` and writes it into `file` (see the header). Throws `OutlineError`
 * for a bad outline and `Error` with a catalog message for everything else; nothing is written in
 * either case.
 */
export async function createLilaProcess(
  file: string,
  outline: unknown,
  options: CreateLilaProcessOptions = {},
): Promise<CreatedLilaProcess> {
  const locale = options.locale ?? 'en';
  const C = messages(locale).cli;
  const path = absolute(file);
  if (!isLilaPath(path)) throw new Error(C.processNotLila(path));
  if (options.process !== undefined && !isProcessSlug(options.process)) {
    throw new Error(C.processBadSlug(options.process));
  }

  const opened = await existing(path, locale);
  const document = opened === null ? null : opened.document;
  const others = document === null ? [] : processesOf(document);
  const outlineName =
    typeof outline === 'object' && outline !== null && typeof (outline as { name?: unknown }).name === 'string'
      ? (outline as { name: string }).name
      : '';
  const name = options.name ?? outlineName;
  // A new `.lila` holds one process, written as a version 1 project: its slug is its name's.
  const slug = document === null ? processSlug(name) : (options.process ?? processSlug(name));
  // A new `.lila` is a version 1 project: its one process cannot carry a slug of its own.
  if (document === null && options.process !== undefined && options.process !== slug) {
    throw new Error(C.processSlugNewFile(options.process, slug));
  }
  if (others.some((p) => p.slug === slug)) throw new Error(C.processExists(slug, path));

  const built = await outlineToBpmn(name === outlineName ? outline : { ...(outline as object), name }, {
    locale,
    processId: processIdOf(slug),
  });
  const created: ProcessDocument = {
    slug,
    name,
    model: { id: processIdOf(slug), name: 'model.bpmn', xml: built.xml, revision: 1 },
    scenarios: { [BASE_SCENARIO]: built.scenario },
    scenarioRevisions: { [BASE_SCENARIO]: 1 },
    runs: [],
  };

  let next: ProjectDocument;
  if (document === null) {
    next = {
      version: 1,
      id: randomUUID(),
      name,
      model: created.model,
      scenarios: created.scenarios,
      scenarioRevisions: created.scenarioRevisions,
      runs: [],
    };
  } else {
    const { problems: _problems, loose: _loose, ...base } = document;
    next = withProcesses(base, [...others, created]);
  }

  const steps = built.outline.steps.length;
  const lanes = built.outline.lanes?.length ?? 0;
  const dryRun = options.dryRun === true;
  if (!dryRun) {
    if (opened !== null) await writeLilaProject(opened, next, locale);
    else {
      try {
        // A new file: `saveAs` refuses one that appeared meanwhile holding another project.
        await writeLilaFile(path, next, { saveAs: true });
      } catch (error) {
        if (error instanceof ProjectIOError) throw new Error(`${path}: ${error.code}: ${error.message}`);
        throw error;
      }
    }
  }
  return {
    file: path,
    slug,
    name,
    newFile: document === null,
    dryRun,
    warnings: built.warnings,
    notes: built.notes,
    outline: built.outline,
    summary: (dryRun ? C.processDryRun : C.processCreated)(name, slug, path, steps, lanes, document === null),
    slugs: processesOf(next).map((p) => p.slug),
  };
}

export interface LilaOutline {
  readonly file: string;
  readonly slug: string;
  readonly name: string;
  readonly outline: NormalOutline;
  /** What the outline could not carry. */
  readonly warnings: readonly string[];
}

/**
 * The outline of one process of `file`. Durations, resources and branch probabilities come from
 * its `as-is.scenario.json` when it has one (the scenario `createLilaProcess` writes).
 */
export async function readLilaOutline(
  file: string,
  options: { process?: string | undefined; locale?: Locale | undefined } = {},
): Promise<LilaOutline> {
  const input = await openLilaProcess(file, options);
  const scenario = input.process.scenarios[BASE_SCENARIO];
  const reading = await bpmnToOutline(input.process.model.xml, { locale: options.locale, scenario, name: input.process.name });
  return {
    file: input.file,
    slug: input.process.slug,
    name: input.process.name,
    outline: reading.outline,
    warnings: reading.warnings,
  };
}
