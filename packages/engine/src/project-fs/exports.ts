/**
 * App-free exports for agents (#538): the diagram as SVG, the process document as Word or HTML and
 * the results of a stored run as `.xlsx` or CSV, from a `.lila` (or, for the diagram, a `.bpmn`).
 * The CLI (`lila export`) and the MCP server (`export_diagram`, `export_document`,
 * `export_results`) are thin layers over these functions; the work itself is the engine's own
 * `renderSvg`, `buildProcessDocument`/`toDocx`/`toHtml`, `scenarioWorkbook` and the `*Csv`
 * functions, the same ones the app and `lila run` use.
 *
 * Runs. A `.lila` stores the runs the app saved, each with the model and scenario revisions it ran
 * on. A run is **current** when both revisions are still the project's (what the app shows).
 * `run: '<id>'` picks one by id; `'latest'` (the default) picks the current run, of `scenario` when
 * given; several scenarios with a current run need `scenario` or an id, as there is no order
 * between them (run ids are random). The document only takes a current run, as it mixes the
 * model of today with the results; the results of an older run are still exported from the model
 * that run saw.
 *
 * ponytail: no rasteriser (see `process-document.ts`), so the Word document carries no diagram and
 * neither format carries the run's charts; every export says so in its `notes`.
 */
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parseBpmn, readAnnotations, renderSvg } from '../bpmn/index.js';
import type { RunResult } from '../core/result.js';
import { elementsCsv, flowsCsv, processCsv, resourcesCsv } from '../csv.js';
import { messages, type Locale } from '../messages/index.js';
import { buildProcessDocument, toDocx, toHtml } from '../process-document.js';
import type { StoredRun } from '../project/index.js';
import { parseScenario, resolveExtends, schemaIssueLines, type ResolvedScenario } from '../scenario.js';
import { resourceNamesOf, scenarioWorkbook } from '../xlsx-report.js';
import { findLilaScenario, lilaScenarioPath, lilaScenarioReader, openLilaProcess, type LilaProcess } from './input.js';
import { isLilaPath } from './paths.js';

export interface ExportSource {
  /** A `.lila` (or, for `exportDiagram` only, a `.bpmn`). */
  readonly file: string;
  /** Slug of the process; implicit when the project has one. */
  readonly process?: string | undefined;
  readonly locale?: Locale | undefined;
}

export interface RunSelection {
  /** A run id, or `'latest'` (the default): the current run, of `scenario` when given. */
  readonly run?: string | undefined;
  /** Narrows `'latest'` to one scenario: its entry name, that name without `.scenario.json`, or its `"name"`. */
  readonly scenario?: string | undefined;
}

/** The run an export used. */
export interface ExportedRun {
  readonly id: string;
  readonly scenario: string;
  /** `false`: the model or the scenario changed after this run. */
  readonly current: boolean;
}

function absolute(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

async function openLila(source: ExportSource): Promise<LilaProcess> {
  const locale = source.locale ?? 'en';
  if (!isLilaPath(source.file)) throw new Error(messages(locale).cli.exportNeedsLila(absolute(source.file)));
  return openLilaProcess(source.file, { process: source.process, locale });
}

/** The diagram of a `.bpmn`, or of one process of a `.lila`, as SVG (`renderSvg`). */
export async function exportDiagram(source: ExportSource): Promise<{ svg: string; file: string; process?: string }> {
  const locale = source.locale ?? 'en';
  if (isLilaPath(source.file)) {
    const lila = await openLilaProcess(source.file, { process: source.process, locale });
    return { svg: await renderSvg(lila.process.model.xml), file: lila.file, process: lila.process.slug };
  }
  if (source.process !== undefined) throw new Error(messages(locale).cli.processOnlyForLila());
  const file = absolute(source.file);
  if (!existsSync(file)) throw new Error(messages(locale).mcp.fileMissing(file));
  return { svg: await renderSvg(readFileSync(file, 'utf8')), file };
}

function isCurrent(lila: LilaProcess, run: StoredRun): boolean {
  const process = lila.process;
  return run.inputs.modelRevision === process.model.revision &&
    run.inputs.scenarioRevision === (process.scenarioRevisions[run.scenarioName] ?? 0);
}

function runList(runs: readonly StoredRun[]): string {
  return runs.map((run) => `${run.id} (${run.scenarioName})`).join(', ');
}

/**
 * The run `selection` names (see the header), or `undefined` when `'latest'` was implied, there is
 * no current run and `optional` (the document goes without results then).
 */
function selectRun(lila: LilaProcess, selection: RunSelection, optional: boolean, locale: Locale): StoredRun | undefined {
  const C = messages(locale).cli;
  const runs = lila.process.runs;
  const where = { file: lila.file, slug: lila.process.slug };
  if (selection.run !== undefined && selection.run !== 'latest') {
    const found = runs.find((run) => run.id === selection.run);
    if (found === undefined) throw new Error(C.exportRunUnknown(selection.run, where.slug, where.file, runList(runs)));
    return found;
  }
  const entry = selection.scenario === undefined ? undefined : findLilaScenario(lila, selection.scenario, locale);
  const candidates = runs.filter((run) => isCurrent(lila, run) && (entry === undefined || run.scenarioName === entry));
  if (candidates.length === 0) {
    if (optional && selection.run === undefined) return undefined;
    const ofScenario = entry === undefined ? runs : runs.filter((run) => run.scenarioName === entry);
    throw new Error(
      ofScenario.length === 0
        ? C.exportNoRun(where.file, where.slug, entry ?? '')
        : C.exportNoCurrentRun(where.file, where.slug, runList(ofScenario)),
    );
  }
  const scenarios = [...new Set(candidates.map((run) => run.scenarioName))].sort();
  if (scenarios.length > 1) throw new Error(C.exportRunAmbiguous(where.file, where.slug, scenarios.join(', ')));
  // Several current runs of one scenario ran the same inputs; any of them is that scenario's run.
  return candidates[candidates.length - 1];
}

/**
 * The scenario `run` ran, resolved: its own stored copy, with any `extends` read from the project
 * (and, outside it, from disk).
 */
function scenarioOfRun(lila: LilaProcess, run: StoredRun, locale: Locale): ResolvedScenario {
  const C = messages(locale).cli;
  const path = lilaScenarioPath(lila, run.scenarioName);
  const project = lilaScenarioReader(lila, (file) => JSON.parse(readFileSync(file, 'utf8')) as unknown, locale);
  const raw = resolveExtends(path, (file) => (file === path ? run.inputs.scenario : project(file)));
  const parsed = parseScenario(raw, { locale });
  if (!parsed.success) {
    throw new Error(`${run.id} (${run.scenarioName}): ${C.invalidScenarioLabel()}\n${schemaIssueLines(parsed.error.issues, { locale }).join('\n')}`);
  }
  return parsed.data as ResolvedScenario;
}

export interface DocumentExport {
  readonly format: 'docx' | 'html';
  readonly data: Uint8Array | string;
  readonly file: string;
  readonly process: string;
  readonly run: ExportedRun | null;
  /** What the document leaves out, in `locale`. */
  readonly notes: readonly string[];
}

/** Today as `YYYY-MM-DD`, local time. */
function today(): string {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}

/**
 * The process document of one process of a `.lila`, like the app's «Export document»: diagram,
 * descriptions, the scenario and the results of the current run when there is one.
 */
export async function exportDocument(
  source: ExportSource & RunSelection & { readonly format: 'docx' | 'html'; readonly date?: string | undefined },
): Promise<DocumentExport> {
  const locale = source.locale ?? 'en';
  const C = messages(locale).cli;
  const lila = await openLila(source);
  const run = selectRun(lila, source, true, locale);
  if (run !== undefined && !isCurrent(lila, run)) throw new Error(C.exportRunStale(run.id, lila.process.slug, lila.file));
  const xml = lila.process.model.xml;
  const { ir, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types } = await parseBpmn(xml);
  // A model bpmn-moddle cannot rewrite still gets its document, without the descriptions (as in the app).
  const annotations = await readAnnotations(xml).catch(() => ({}));
  const notes: string[] = [];
  let svg: string | undefined;
  try {
    svg = await renderSvg(xml);
  } catch {
    notes.push(C.exportNoDiagram());
  }
  if (svg !== undefined && source.format === 'docx') notes.push(C.exportDocxNoDiagram());
  const results = run === undefined
    ? {}
    : { scenario: scenarioOfRun(lila, run, locale), result: run.result as RunResult };
  if (run === undefined) notes.push(C.exportDocumentNoRun());
  else notes.push(C.exportNoCharts());
  const title = lila.slugs.length > 1 ? lila.process.name : lila.document.name;
  const doc = buildProcessDocument({
    ir, annotations, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types,
    title, date: source.date ?? today(), locale, ...(svg === undefined ? {} : { svg }), ...results,
  });
  return {
    format: source.format,
    data: source.format === 'docx' ? toDocx(doc) : toHtml(doc),
    file: lila.file,
    process: lila.process.slug,
    run: run === undefined ? null : { id: run.id, scenario: run.scenarioName, current: true },
    notes,
  };
}

export interface ResultsExport {
  readonly format: 'xlsx' | 'csv';
  /** `.xlsx` bytes, or the CSV files by name (`elements.csv`, `flows.csv`, `resources.csv`, `process.csv`). */
  readonly data: Uint8Array | Readonly<Record<string, string>>;
  readonly file: string;
  readonly process: string;
  readonly run: ExportedRun;
}

/**
 * The results of a stored run, like `lila run --xlsx`/`--csv` (no `log.csv`: a stored run keeps no
 * event log). Read against the model that run saw, so an older run exports too.
 */
export async function exportResults(
  source: ExportSource & RunSelection & { readonly format: 'xlsx' | 'csv' },
): Promise<ResultsExport> {
  const locale = source.locale ?? 'en';
  const lila = await openLila(source);
  const run = selectRun(lila, source, false, locale)!;
  const { ir } = await parseBpmn(run.inputs.xml);
  const scenario = scenarioOfRun(lila, run, locale);
  const result = run.result as RunResult;
  const names = resourceNamesOf(scenario);
  const data = source.format === 'xlsx'
    ? scenarioWorkbook(ir, scenario, result, names, locale)
    : {
        'elements.csv': elementsCsv(ir, result),
        'flows.csv': flowsCsv(ir, result),
        'resources.csv': resourcesCsv(result, names),
        'process.csv': processCsv(result),
      };
  return {
    format: source.format,
    data,
    file: lila.file,
    process: lila.process.slug,
    run: { id: run.id, scenario: run.scenarioName, current: isCurrent(lila, run) },
  };
}

/* ------------------------------------------------------------------ *
 * Writing: atomic, and never over an existing file unless asked
 * ------------------------------------------------------------------ */

let sequence = 0;

/** A temporary file next to `target`, created exclusively, holding `contents`. */
function stage(target: string, contents: string | Uint8Array): string {
  for (;;) {
    const temporary = `${target}.tmp-${process.pid}-${sequence++}`;
    let fd: number;
    try {
      fd = openSync(temporary, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    try {
      writeFileSync(fd, contents);
      closeSync(fd);
    } catch (error) {
      try {
        closeSync(fd);
      } catch {
        // closed already: the write succeeded and the close failed
      }
      unlinkSync(temporary);
      throw error;
    }
    return temporary;
  }
}

/**
 * Publishes `temporary` as `target`: a `rename` with `overwrite`, otherwise a hard link, which
 * fails if `target` appeared in the meantime (no check-then-write race). Where hard links are not
 * supported, an existence check and a `rename`.
 */
function publish(temporary: string, target: string, overwrite: boolean, locale: Locale): void {
  if (overwrite) {
    renameSync(temporary, target);
    return;
  }
  try {
    linkSync(temporary, target);
    unlinkSync(temporary);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new Error(messages(locale).cli.exportTargetExists(target));
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS') throw error;
    if (existsSync(target)) throw new Error(messages(locale).cli.exportTargetExists(target));
    renameSync(temporary, target);
  }
}

function assertWritable(target: string, overwrite: boolean, locale: Locale): void {
  if (!existsSync(target)) return;
  if (lstatSync(target).isDirectory()) throw new Error(messages(locale).cli.cannotWrite(target));
  if (!overwrite) throw new Error(messages(locale).cli.exportTargetExists(target));
}

/** Writes one export file atomically; refused if it exists, unless `overwrite`. Returns its absolute path. */
export function writeExportFile(
  file: string,
  contents: string | Uint8Array,
  options: { readonly overwrite?: boolean | undefined; readonly locale?: Locale | undefined } = {},
): string {
  const locale = options.locale ?? 'en';
  const overwrite = options.overwrite === true;
  const target = absolute(file);
  assertWritable(target, overwrite, locale);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = stage(target, contents);
  try {
    publish(temporary, target, overwrite, locale);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // published, or already gone
    }
    throw error;
  }
  return target;
}

/**
 * Writes several files into `directory` (the CSV export): every conflict is reported before the
 * first file is written, then each file is published atomically. Returns their absolute paths.
 */
export function writeExportDirectory(
  directory: string,
  files: Readonly<Record<string, string | Uint8Array>>,
  options: { readonly overwrite?: boolean | undefined; readonly locale?: Locale | undefined } = {},
): string[] {
  const locale = options.locale ?? 'en';
  const root = absolute(directory);
  if (existsSync(root) && !lstatSync(root).isDirectory()) throw new Error(messages(locale).cli.exportNotDirectory(root));
  const targets = Object.keys(files).map((name) => `${root}/${name}`);
  for (const target of targets) assertWritable(target, options.overwrite === true, locale);
  return Object.entries(files).map(([name, contents]) => writeExportFile(`${root}/${name}`, contents, options));
}
