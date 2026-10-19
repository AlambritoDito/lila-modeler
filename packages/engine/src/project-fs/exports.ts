/**
 * App-free exports for agents (#538): the diagram as SVG, the process document as Word or HTML and
 * the results of a stored run as `.xlsx` or CSV, from a `.lila` (or, for the diagram, a `.bpmn`).
 * The CLI (`lila export`) and the MCP server (`export_diagram`, `export_document`,
 * `export_results`) are thin layers over these functions; the work itself is the engine's own
 * `renderSvg`, `buildProcessDocument`/`toDocx`/`toHtml`, `scenarioSheets` and the `*Csv`
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
 * no charts; the HTML carries both as SVG (`chartsSvg`, #636), except the cycle time histogram, as
 * a stored run keeps no per-case times. Every export says what it left out in its `notes`.
 */
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { parseBpmn, readAnnotations, renderSvg, type SvgTint } from '../bpmn/index.js';
import { chartsSvg } from '../charts.js';
import { bottleneckCut, heatMap, WAIT_LEVEL_COLOURS, type WaitLevel } from '../bottleneck-levels.js';
import type { ProcessIR } from '../core/ir.js';
import { simulate } from '../core/run.js';
import type { RunResult } from '../core/result.js';
import { elementsCsv, flowsCsv, percentilesCsv, processCsv, resourcesCsv } from '../csv.js';
import { RESOURCE_WAIT, elementSampler } from '../element-percentiles.js';
import { formatDuration, SECONDS_PER_UNIT, type BaseTimeUnit } from '../format.js';
import { messages, type Locale } from '../messages/index.js';
import { buildProcessDocument, toDocx, toHtml } from '../process-document.js';
import { isCurrentRun, type StoredRun } from '../project/index.js';
import { parseScenario, resolveExtends, schemaIssueLines, type ResolvedScenario } from '../scenario.js';
import { percentilesSheet, resourceNamesOf, scenarioSheets } from '../xlsx-report.js';
import { workbook } from '../xlsx.js';
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

/** A stored run drawn over the diagram (#669), with the app's scale (`bottleneck-levels.ts`). */
export type DiagramOverlay = 'bottlenecks' | 'heatmap';

export const DIAGRAM_OVERLAYS: readonly DiagramOverlay[] = ['bottlenecks', 'heatmap'];

/**
 * The diagram of a `.bpmn`, or of one process of a `.lila`, as SVG (`renderSvg`). With `overlay`,
 * coloured with a stored run of the `.lila` (selected as for the document, see the header), as the
 * app colours it: `'bottlenecks'` tints the canvas's bottleneck cut, `'heatmap'` every measured task
 * as the Results heat map does, with the cut marked. The run is drawn on the model it ran on.
 */
export async function exportDiagram(
  source: ExportSource & RunSelection & { readonly overlay?: DiagramOverlay | undefined },
): Promise<{ svg: string; file: string; process?: string; run?: ExportedRun }> {
  const locale = source.locale ?? 'en';
  const C = messages(locale).cli;
  if (source.overlay !== undefined && !DIAGRAM_OVERLAYS.includes(source.overlay)) throw new Error(C.exportInvalidOverlay(String(source.overlay)));
  if (source.overlay === undefined && (source.run !== undefined || source.scenario !== undefined)) throw new Error(C.exportRunNeedsOverlay());
  if (isLilaPath(source.file)) {
    const lila = await openLilaProcess(source.file, { process: source.process, locale });
    if (source.overlay === undefined) return { svg: await renderSvg(lila.process.model.xml), file: lila.file, process: lila.process.slug };
    // No run at all says what the overlay needs; any other selection error speaks for itself.
    if (lila.process.runs.length === 0) {
      throw new Error(C.exportOverlayNoRun(source.overlay, C.exportNoRun(lila.file, lila.process.slug, '')));
    }
    const run = selectRun(lila, source, false, locale)!;
    const tint = await overlayTint(lila, run, source.overlay, locale);
    return {
      svg: await renderSvg(run.inputs.xml, { tint }),
      file: lila.file,
      process: lila.process.slug,
      run: { id: run.id, scenario: run.scenarioName, current: isCurrent(lila, run) },
    };
  }
  if (source.process !== undefined) throw new Error(C.processOnlyForLila());
  const file = absolute(source.file);
  if (source.overlay !== undefined) throw new Error(C.exportOverlayNeedsLila(file));
  if (!existsSync(file)) throw new Error(messages(locale).mcp.fileMissing(file));
  return { svg: await renderSvg(readFileSync(file, 'utf8')), file };
}

/** From the coarsest unit to the finest: the first one in which the wait is 1 or more wins. */
const SHORT_UNITS: readonly BaseTimeUnit[] = ['day', 'h', 'min', 's'];
const SHORT_UNIT_LABELS: Readonly<Record<BaseTimeUnit, string>> = { day: 'd', h: 'h', min: 'min', s: 's' };

/** A wait as the app's canvas label writes it: its coarsest unit, at most one decimal. */
function shortWait(seconds: number): string {
  const unit = SHORT_UNITS.find((u) => seconds >= SECONDS_PER_UNIT[u]) ?? 's';
  const step = SECONDS_PER_UNIT[unit] / 10;
  return `${formatDuration(Math.round(seconds / step) * step, unit)} ${SHORT_UNIT_LABELS[unit]}`;
}

/** `renderSvg`'s `tint` for `overlay` of `run`, keyed by the ids of the file the run saw. */
async function overlayTint(lila: LilaProcess, run: StoredRun, overlay: DiagramOverlay, locale: Locale): Promise<Record<string, SvgTint>> {
  const C = messages(locale).cli;
  // #546: the process that run simulated, chosen as the app chose it.
  const { ir } = await parseBpmn(run.inputs.xml, { scenarios: [run.inputs.scenario, ...Object.values(lila.process.scenarios)] });
  const result = run.result as RunResult;
  // Result keys are IR ids; the drawing is keyed by the ids written in the file.
  const fileId = (id: string): string => (Object.hasOwn(ir.source.originalIds, id) ? ir.source.originalIds[id]! : id);
  const colour = (level: WaitLevel): Pick<SvgTint, 'fill' | 'stroke'> => ({ fill: WAIT_LEVEL_COLOURS[level], stroke: WAIT_LEVEL_COLOURS[level] });
  // No prototype: a BPMN id may be `__proto__`.
  const tint: Record<string, SvgTint> = Object.create(null) as Record<string, SvgTint>;
  const cut = bottleneckCut(result);
  if (overlay === 'bottlenecks') {
    for (const entry of cut) {
      tint[fileId(entry.elementId)] = { ...colour(entry.level), badge: `${shortWait(entry.resourceWaitMean)} · ${Math.round(entry.utilization * 100)}%` };
    }
    return tint;
  }
  const tasks = Object.keys(ir.nodes).filter((id) => ir.nodes[id]!.type === 'task');
  for (const [id, entry] of Object.entries(heatMap(result, tasks))) {
    tint[fileId(id)] = { ...colour(entry.level), badge: C.exportOverlayWait(shortWait(entry.resourceWaitMean)) };
  }
  // The ranking's cut is painted over the map with its own level, its badge marked (as in Results).
  for (const entry of cut) {
    tint[fileId(entry.elementId)] = {
      ...colour(entry.level),
      badge: `${C.exportOverlayBottleneck()} ${C.exportOverlayWait(shortWait(entry.resourceWaitMean))}`,
    };
  }
  return tint;
}

function isCurrent(lila: LilaProcess, run: StoredRun): boolean {
  return isCurrentRun(run, lila.process.model.revision, lila.process.scenarioRevisions);
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
  if (selection.run !== undefined && selection.run !== 'latest' && selection.scenario !== undefined) {
    throw new Error(C.exportRunAndScenario());
  }
  if (selection.run !== undefined && selection.run !== 'latest') {
    const found = runs.find((run) => run.id === selection.run);
    if (found === undefined) throw new Error(C.exportRunUnknown(selection.run, where.slug, where.file, runList(runs)));
    return found;
  }
  const entry = selection.scenario === undefined ? undefined : findLilaScenario(lila, selection.scenario, locale);
  const candidates = runs.filter((run) => isCurrent(lila, run) && (entry === undefined || run.scenarioName === entry));
  if (candidates.length === 0) {
    // Only an implied `latest` may come back empty: a run or a scenario asked for by name must exist.
    if (optional && selection.run === undefined && selection.scenario === undefined) return undefined;
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
  const raw = resolveExtends(path, (file) => (file === path ? run.inputs.scenario : project(file)), locale);
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
  // #546: the process the run and the process's scenarios target, the one the app simulates.
  const { ir, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types } = await parseBpmn(xml, {
    scenarios: [run?.inputs.scenario, ...Object.values(lila.process.scenarios)],
  });
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
  else notes.push(source.format === 'docx' ? C.exportDocxNoCharts() : C.exportNoHistogram());
  // Word skips SVG-only charts, so only the HTML draws them.
  const charts = results.result === undefined || source.format === 'docx'
    ? []
    : chartsSvg({ ir, scenario: results.scenario, result: results.result, locale });
  const title = lila.slugs.length > 1 ? lila.process.name : lila.document.name;
  const doc = buildProcessDocument({
    ir, annotations, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types,
    title, date: source.date ?? today(), locale, ...(svg === undefined ? {} : { svg }), ...results,
    ...(charts.length === 0 ? {} : { charts }),
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
  /**
   * `.xlsx` bytes, or the CSV files by name (`elements.csv`, `flows.csv`, `resources.csv`,
   * `process.csv`, and `percentiles.csv` when `percentiles.included`).
   */
  readonly data: Uint8Array | Readonly<Record<string, string>>;
  readonly file: string;
  readonly process: string;
  readonly run: ExportedRun;
  /** #666: whether the `Percentiles` sheet / `percentiles.csv` is there; `note`, in `locale`, says why not. */
  readonly percentiles: { readonly included: boolean; readonly note?: string };
}

/** JSON with the keys of every object sorted, so two results compare by value, not key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner);
}

/**
 * #666: the resource-wait sample per element of a stored run, which keeps no event log, from
 * simulating its own inputs again (same seed); the rows stream into the sampler and none is kept.
 * The sample counts only when the re-run gives the stored `process` and `elements` metrics back
 * exactly (compared as JSON, as they were stored); otherwise a note says why it is left out. A different engine version
 * or platform can change the last digit, so a mismatch is expected there, not an error.
 */
function rerunSamples(
  ir: ProcessIR,
  scenario: ResolvedScenario,
  stored: RunResult,
  locale: Locale,
): { samples: Map<string, number[]> } | { note: string } {
  const C = messages(locale).cli;
  // A cancelled run, or one with another number of replications, cannot come back: skip the cost.
  if (stored.cancelled === true || (stored.replications?.count ?? 1) !== (scenario.run.replications ?? 1)) {
    return { note: C.exportPercentilesNotReproduced() };
  }
  const sampler = elementSampler(scenario.run.warmup, RESOURCE_WAIT, { replicationsInOrder: true });
  let again: RunResult;
  try {
    again = simulate(ir, scenario, { locale, onEvent: (row) => sampler.add(row) });
  } catch (error) {
    return { note: C.exportPercentilesFailed(error instanceof Error ? error.message : String(error)) };
  }
  const same = (result: RunResult): string => canonicalJson({ process: result.process, elements: result.elements });
  if (same(again) !== same(stored)) return { note: C.exportPercentilesNotReproduced() };
  return { samples: sampler.samples() };
}

/**
 * The results of a stored run, like `lila run --xlsx`/`--csv` (no `log.csv`: a stored run keeps no
 * event log), plus the resource-wait percentiles per element when a re-run reproduces it
 * (`rerunSamples`, #666). Read against the model that run saw, so an older run exports too.
 */
export async function exportResults(
  source: ExportSource & RunSelection & { readonly format: 'xlsx' | 'csv' },
): Promise<ResultsExport> {
  const locale = source.locale ?? 'en';
  const lila = await openLila(source);
  const run = selectRun(lila, source, false, locale)!;
  // #546: the process that run simulated, chosen as the app chose it.
  const { ir } = await parseBpmn(run.inputs.xml, { scenarios: [run.inputs.scenario, ...Object.values(lila.process.scenarios)] });
  const scenario = scenarioOfRun(lila, run, locale);
  const result = run.result as RunResult;
  const names = resourceNamesOf(scenario);
  const rerun = rerunSamples(ir, scenario, result, locale);
  const samples = 'samples' in rerun ? rerun.samples : undefined;
  const data = source.format === 'xlsx'
    ? workbook([
        ...scenarioSheets(ir, scenario, result, names, locale),
        ...(samples === undefined ? [] : [percentilesSheet(ir, result, samples, locale)]),
      ])
    : {
        'elements.csv': elementsCsv(ir, result),
        'flows.csv': flowsCsv(ir, result),
        'resources.csv': resourcesCsv(result, names),
        'process.csv': processCsv(result),
        ...(samples === undefined ? {} : { 'percentiles.csv': percentilesCsv(ir, result, samples) }),
      };
  return {
    format: source.format,
    data,
    file: lila.file,
    process: lila.process.slug,
    run: { id: run.id, scenario: run.scenarioName, current: isCurrent(lila, run) },
    percentiles: 'samples' in rerun ? { included: true } : { included: false, note: rerun.note },
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

/**
 * Refuses `target` when it is the file the export was read from (QA of #552): with `overwrite`,
 * an export to the project's own path would replace the `.lila` with an SVG or a document. An
 * existing target is compared by device and inode, which also catches another spelling on a
 * case-insensitive disk, a hard link and a symlink; a missing one by its real path.
 */
function assertNotSource(target: string, source: string | undefined, locale: Locale): void {
  if (source === undefined) return;
  let origin: { dev: number; ino: number };
  try {
    origin = statSync(source);
  } catch {
    return;
  }
  let same: boolean;
  try {
    const info = statSync(target);
    same = info.dev === origin.dev && info.ino === origin.ino;
  } catch {
    try {
      same = join(realpathSync(dirname(target)), basename(target)) === realpathSync(source);
    } catch {
      same = false;
    }
  }
  if (same) throw new Error(messages(locale).cli.exportTargetIsSource(target));
}

/** Options of `writeExportFile`/`writeExportDirectory`. */
export interface WriteExportOptions {
  /** Replace an existing file. */
  readonly overwrite?: boolean | undefined;
  /** The file the export was read from: never written over, `overwrite` or not. */
  readonly source?: string | undefined;
  readonly locale?: Locale | undefined;
}

function assertWritable(target: string, options: WriteExportOptions, locale: Locale): void {
  assertNotSource(target, options.source, locale);
  if (!existsSync(target)) return;
  const overwrite = options.overwrite === true;
  if (lstatSync(target).isDirectory()) throw new Error(messages(locale).cli.cannotWrite(target));
  if (!overwrite) throw new Error(messages(locale).cli.exportTargetExists(target));
}

/** Writes one export file atomically; refused if it exists, unless `overwrite`. Returns its absolute path. */
export function writeExportFile(file: string, contents: string | Uint8Array, options: WriteExportOptions = {}): string {
  const locale = options.locale ?? 'en';
  const overwrite = options.overwrite === true;
  // `out/` names a directory; resolving it would silently drop the slash and write a file there.
  if (/[\\/]$/.test(file)) throw new Error(messages(locale).cli.exportFileNeeded(file));
  const target = absolute(file);
  assertWritable(target, options, locale);
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
  options: WriteExportOptions = {},
): string[] {
  const locale = options.locale ?? 'en';
  const root = absolute(directory);
  if (existsSync(root) && !lstatSync(root).isDirectory()) throw new Error(messages(locale).cli.exportNotDirectory(root));
  const targets = Object.keys(files).map((name) => `${root}/${name}`);
  for (const target of targets) assertWritable(target, options, locale);
  return Object.entries(files).map(([name, contents]) => writeExportFile(`${root}/${name}`, contents, options));
}
