#!/usr/bin/env node
/**
 * CLI `lila`: validación y simulación reproducible desde archivos.
 *
 * Todo el texto sale del catálogo (`messages(locale).cli`, LILA-211). El idioma se decide una sola
 * vez en `main()`, **antes** de los `parseArgs` de cada subcomando: `--lang` no es una opción de
 * ninguno de ellos, se puede escribir en cualquier posición y se quita de `argv` antes de repartir
 * (si no, `lila mcp --lang es` moriría con «no acepta argumentos»). Los nombres de columna y los
 * títulos de las tablas estilo Bizagi no se traducen: son el contrato de paridad de
 * `docs/BIZAGI_PARITY.md`.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { ValidationResult } from './bpmn/validate.js';
import { validateBpmnXml } from './bpmn/validate-report.js';
import {
  absolutePath,
  assertReplaceableFile,
  comparablePath,
  compareWarnings,
  loadResolvedScenario,
  loadValidatedModel,
  resultWithBoundaryWarnings,
  stageFile,
  withRunOverrides,
  writeJsonAtomic,
  type LoadedScenarioResult,
  type ParsedIr,
  type StagedFile,
} from './cli-shared.js';
import {
  ELEMENT_COLUMNS,
  RESOURCE_COLUMNS,
  elementsCsv,
  eventLogCsvHeader,
  eventLogRowCsv,
  flowsCsv,
  processCsv,
  resourcesCsv,
  runStartMs,
} from './csv.js';
import { compare, type CompareResult, type CompareScope } from './core/compare.js';
import { compareWorkbook, resourceNamesOf, scenarioWorkbook } from './xlsx-report.js';
import { simulate } from './core/run.js';
import type { EventLogRow, RunResult } from './core/result.js';
import {
  columnHeader,
  columnLabel,
  formatDuration,
  formatNumber,
  formatSignedPercent,
  formatTable,
  isDurationMetric,
  splitOutcomeMetric,
  type BaseTimeUnit,
} from './format.js';
import { LOCALE_LIST, isLocale, messages, resolveLocale, type Locale } from './messages/index.js';
import { scenarioErrors, validateScenario, type ResolvedScenario, type ScenarioProblem } from './scenario.js';

export { resolveLocale } from './locale.js';

/** Lo que `extractLang` saca de la línea de comandos: el resto de `argv` y el idioma pedido. */
export interface ExtractedLang {
  /** `argv` sin `--lang` ni su valor, listo para el `parseArgs` del subcomando. */
  readonly argv: string[];
  /** El idioma pedido, ya validado; ausente si nadie pidió ninguno. */
  readonly lang?: Locale | undefined;
  /**
   * El valor rechazado, o `''` cuando `--lang` llegó sin valor. Ausente si no hubo problema:
   * quien llama decide qué mensaje imprimir, para que esta función siga siendo pura.
   */
  readonly invalid?: string | undefined;
}

/**
 * Quita `--lang xx` / `--lang=xx` de cualquier posición de `argv` y devuelve el idioma pedido.
 *
 * Se ejecuta antes que `parseArgs` porque `--lang` es global, no de un subcomando: declararlo en
 * los cuatro `parseArgs` obligaría a repetirlo y dejaría fuera a `lila mcp`, que no acepta
 * opciones. Un `es_MX.UTF-8` o un `ES` valen (misma normalización que las variables de entorno);
 * cualquier otra cosa se rechaza, porque aquí sí hubo una petición explícita que contestar.
 */
export function extractLang(argv: readonly string[]): ExtractedLang {
  const rest: string[] = [];
  let raw: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === '--lang') {
      raw = argv[index + 1];
      index++; // el valor de `--lang` no es un positional del subcomando
      if (raw === undefined) return { argv: rest, invalid: '' };
      continue;
    }
    if (argument.startsWith('--lang=')) {
      raw = argument.slice('--lang='.length);
      continue;
    }
    rest.push(argument);
  }

  if (raw === undefined) return { argv: rest };
  const tag = raw.toLowerCase().split(/[_.@-]/)[0] ?? '';
  return isLocale(tag) ? { argv: rest, lang: tag } : { argv: rest, invalid: raw };
}

/** Cuenta los nodos por tipo para la línea de resumen de `validate`. */
function countByType(nodes: Record<string, { type: string }>): string {
  const counts = new Map<string, number>();
  for (const node of Object.values(nodes)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');
}

function printValidationProblems({ errors, warnings }: ValidationResult, locale: Locale): void {
  const C = messages(locale).cli;
  for (const warning of warnings) console.log(`${C.warningLabel()}  ${warning.code}  ${warning.message}`);
  for (const error of errors) console.log(`${C.errorLabel()}  ${error.code}  ${error.message}`);
}

async function validateCommand(file: string, json: boolean, locale: Locale): Promise<number> {
  const C = messages(locale).cli;
  const xml = readFileSync(file, 'utf8');
  // ponytail: el reporte lo arma `validateBpmnXml`, compartido con el servidor MCP (LILA-053).
  const report = await validateBpmnXml(xml, { locale });
  const { ir, ignoredProcessIds } = report;
  const validation: ValidationResult = { errors: report.errors, warnings: report.warnings };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return validation.errors.length > 0 ? 1 : 0;
  }

  console.log(C.process(`${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`));
  if (ir.source.exporter !== '') {
    console.log(C.exportedBy(ir.source.exporter, ir.source.exporterVersion).trimEnd());
  }
  console.log('');

  const nodeIds = Object.keys(ir.nodes);
  console.log(C.nodes(nodeIds.length, countByType(ir.nodes)));
  for (const id of nodeIds) {
    const node = ir.nodes[id];
    if (node === undefined) continue;
    const lane = node.lane === undefined ? '' : `  [${node.lane}]`;
    console.log(`  ${node.type.padEnd(9)} ${id}${node.name === '' ? '' : `  ${node.name}`}${lane}`);
  }

  const flowIds = Object.keys(ir.flows);
  console.log('');
  console.log(C.flows(flowIds.length));
  for (const id of flowIds) {
    const flow = ir.flows[id];
    if (flow === undefined) continue;
    const mark = flow.isDefault ? `  ${C.defaultFlow()}` : '';
    console.log(`  ${id}: ${flow.from} -> ${flow.to}${flow.name === '' ? '' : `  ${flow.name}`}${mark}`);
  }

  if (ignoredProcessIds.length > 0) {
    console.log('');
    console.log(C.otherProcesses(ignoredProcessIds.join(', ')));
  }

  console.log('');
  printValidationProblems(validation, locale);
  console.log(C.problemCounts(validation.errors.length, validation.warnings.length));

  return validation.errors.length > 0 ? 1 : 0;
}

function integerOption(
  name: string,
  raw: string | undefined,
  locale: Locale,
  minimum?: number,
): number | undefined {
  if (raw === undefined) return undefined;
  const C = messages(locale).cli;
  if (!/^-?\d+$/.test(raw)) throw new Error(C.integerRequired(name, raw));
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(
      minimum === undefined ? C.safeIntegerRequired(name, raw) : C.minimumIntegerRequired(name, minimum, raw),
    );
  }
  return value;
}

function printScenarioProblems(problems: readonly ScenarioProblem[], locale: Locale): void {
  const C = messages(locale).cli;
  for (const problem of problems) {
    const label = problem.severity === 'error' ? C.errorLabel() : C.warningLabel();
    console.log(`${label}  ${problem.code}  ${problem.message}`);
  }
}

/** Imprime los problemas del modelo y responde si hay errores que aborten el comando. */
function modelHasErrors(validation: ValidationResult, locale: Locale): boolean {
  if (validation.errors.length === 0) return false;
  printValidationProblems(validation, locale);
  console.log(messages(locale).cli.problemCounts(validation.errors.length, validation.warnings.length));
  return true;
}

/**
 * Subconjunto de `PROCESS_COLUMNS` que imprime la tabla "Process summary": las 20 columnas de
 * `process.csv` no caben legibles en una sola fila de consola, así que la CLI se queda con la
 * media y los percentiles de ciclo y espera más los tres agregados de costo/rendimiento
 * (docs/RESULTS_FORMAT.md § 10). Los mínimos, máximos y desviaciones siguen en `--json` y en el
 * CSV, que no tienen ancho de terminal.
 * ponytail: lista literal en vez de un filtro sobre `PROCESS_COLUMNS`; si algún día la tabla
 * imprime las 20, se sustituye por `PROCESS_COLUMNS` y se borra esta constante.
 */
const PROCESS_SUMMARY_COLUMNS = [
  'started',
  'completed',
  'inFlight',
  'cycleTime.mean',
  'cycleTime.p50',
  'cycleTime.p90',
  'cycleTime.p95',
  'waitTime.mean',
  'waitTime.p50',
  'waitTime.p90',
  'waitTime.p95',
  'throughputPerHour',
  'costPerCase',
  'totalCost',
] as const;

/**
 * Columnas de la tabla "Outcomes" (#316). Solo lo que distingue un desenlace de otro de un
 * vistazo: cuántos casos acabaron ahí y cómo de largo fue su ciclo. El resto de percentiles y
 * la espera completa siguen en `--json` y en `process.csv`.
 */
const OUTCOME_SUMMARY_COLUMNS = [
  'completed',
  'cycleTime.mean',
  'cycleTime.p50',
  'cycleTime.p95',
  'waitTime.mean',
] as const;

/** Fracción 0..1 como porcentaje, igual que `utilization` en las tablas de la CLI. */
function formatPercent(fraction: number): string {
  return `${formatNumber(fraction * 100)}%`;
}

function printRunResult(
  ir: ParsedIr,
  scenario: ResolvedScenario,
  result: RunResult,
  locale: Locale,
): void {
  const C = messages(locale).cli;
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const currency = scenario.run.currency;
  console.log(C.scenario(scenario.name));
  console.log(C.process(`${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`));
  console.log(
    C.runHeader(scenario.run.seed ?? 1, scenario.run.replications, unit) +
      (currency === undefined ? '' : ` · ${C.currency(currency)}`),
  );

  console.log('');
  console.log('Process elements');
  console.log(
    formatTable(
      ['Id', 'Name', 'Type', ...ELEMENT_COLUMNS.map((metric) => columnHeader('elements', metric, unit))],
      Object.entries(result.elements).map(([id, metrics]) => {
        const node = ir.nodes[id];
        return [
          id,
          node?.name ?? '',
          node?.type ?? '',
          formatNumber(metrics.started),
          formatNumber(metrics.completed),
          formatDuration(metrics.processing.min, unit),
          formatDuration(metrics.processing.max, unit),
          formatDuration(metrics.processing.mean, unit),
          formatDuration(metrics.processing.total, unit),
          formatDuration(metrics.resourceWait.min, unit),
          formatDuration(metrics.resourceWait.max, unit),
          formatDuration(metrics.resourceWait.mean, unit),
          formatDuration(metrics.resourceWait.sd, unit),
          formatDuration(metrics.resourceWait.total, unit),
          formatNumber(metrics.fixedCostTotal),
        ];
      }),
    ),
  );

  console.log('');
  console.log('Sequence flows');
  console.log(
    formatTable(
      ['Id', 'Name', 'From', 'To', columnLabel('flows', 'count')],
      Object.entries(result.flows).map(([id, metrics]) => {
        const flow = ir.flows[id];
        return [id, flow?.name ?? '', flow?.from ?? '', flow?.to ?? '', formatNumber(metrics.count)];
      }),
    ),
  );

  if (Object.keys(result.resources).length > 0) {
    const resourceNames: Record<string, string> = {};
    for (const [id, resource] of Object.entries(scenario.resources ?? {})) resourceNames[id] = resource.name ?? id;
    console.log('');
    console.log('Resources');
    console.log(
      formatTable(
        ['Id', 'Name', ...RESOURCE_COLUMNS.map((metric) => columnHeader('resources', metric, unit))],
        Object.entries(result.resources).map(([id, metrics]) => [
          id,
          resourceNames[id] ?? '',
          formatNumber(metrics.utilization * 100),
          formatDuration(metrics.busyTime, unit),
          formatNumber(metrics.fixedCost),
          formatNumber(metrics.unitCost),
          formatNumber(metrics.totalCost),
        ]),
      ),
    );
  }

  // La sección se imprime siempre, con pools o sin ellos (docs/RESULTS_FORMAT.md § 10): un
  // ranking vacío es información —nadie hizo cola— y así la CLI dice lo mismo que la tarjeta de
  // `ResultsView` en la web, que nunca se ocultó.
  console.log('');
  console.log(C.bottlenecks());
  if (result.bottlenecks.length === 0) {
    console.log(C.noResourceWait());
  } else {
    console.log(
      formatTable(
        [
          'Id',
          'Name',
          columnHeader('elements', 'resourceWait.total', unit),
          columnLabel('resources', 'utilization'),
        ],
        result.bottlenecks.map((entry) => [
          entry.elementId,
          ir.nodes[entry.elementId]?.name ?? '',
          formatDuration(entry.resourceWaitTotal, unit),
          formatNumber(entry.utilization * 100),
        ]),
      ),
    );
  }

  const process = result.process;
  // `withinServiceLevel` solo existe cuando el escenario declara `run.serviceLevel` (#316): sin
  // umbral la columna no se imprime, en vez de mostrar un cero que se leería como "0 % cumplido".
  const tracksServiceLevel = process.withinServiceLevel !== undefined;
  console.log('');
  console.log('Process summary (extras)');
  console.log(
    formatTable(
      [
        ...PROCESS_SUMMARY_COLUMNS.map((metric) => columnHeader('process', metric, unit)),
        ...(tracksServiceLevel ? [columnLabel('process', 'withinServiceLevel')] : []),
      ],
      [[
        formatNumber(process.started),
        formatNumber(process.completed),
        formatNumber(process.inFlight),
        formatDuration(process.cycleTime.mean, unit),
        formatDuration(process.cycleTime.p50, unit),
        formatDuration(process.cycleTime.p90, unit),
        formatDuration(process.cycleTime.p95, unit),
        formatDuration(process.waitTime.mean, unit),
        formatDuration(process.waitTime.p50, unit),
        formatDuration(process.waitTime.p90, unit),
        formatDuration(process.waitTime.p95, unit),
        formatNumber(process.throughputPerHour),
        formatNumber(process.costPerCase),
        formatNumber(process.totalCost),
        ...(tracksServiceLevel ? [formatPercent(process.withinServiceLevel ?? 0)] : []),
      ]],
    ),
  );

  // Desglose por desenlace (#316): una fila por `end`/`terminate` del modelo.
  const outcomes = Object.entries(process.byEndEvent ?? {});
  if (outcomes.length > 0) {
    console.log('');
    console.log(C.outcomes());
    console.log(
      formatTable(
        [
          'Id',
          'Name',
          ...OUTCOME_SUMMARY_COLUMNS.map((metric) => columnHeader('process', metric, unit)),
          ...(tracksServiceLevel ? [columnLabel('process', 'withinServiceLevel')] : []),
        ],
        outcomes.map(([id, outcome]) => [
          id,
          ir.nodes[id]?.name ?? '',
          formatNumber(outcome.completed),
          formatDuration(outcome.cycleTime.mean, unit),
          formatDuration(outcome.cycleTime.p50, unit),
          formatDuration(outcome.cycleTime.p95, unit),
          formatDuration(outcome.waitTime.mean, unit),
          ...(tracksServiceLevel ? [formatPercent(outcome.withinServiceLevel ?? 0)] : []),
        ]),
      ),
    );
  }

  if (result.warnings.length > 0) {
    console.log('');
    console.log(C.warnings());
    for (const warning of result.warnings) console.log(`  ${warning}`);
  }
}

/** Publica cualquier valor serializable como JSON determinista; usado por `run` y `compare`. */
function writeJson(file: string, data: unknown, locale: Locale): void {
  console.log(`JSON: ${writeJsonAtomic(file, data, locale)}`);
}

/**
 * Publica un `.xlsx` con la misma técnica atómica que el CSV y el JSON: temporal + `rename`, y
 * nada se escribe encima de un archivo que ya existía sin pasar por `assertReplaceableFile`.
 */
function writeXlsx(file: string, bytes: Uint8Array, locale: Locale): void {
  const target = absolutePath(file);
  assertReplaceableFile(target, locale);
  const staged = stageFile(target, locale);
  try {
    staged.write(bytes);
    staged.commit();
  } catch (error) {
    staged.abort();
    throw error;
  }
  console.log(`XLSX: ${target}`);
}

function writeCsvDirectory(
  directory: string,
  ir: ParsedIr,
  scenario: ResolvedScenario,
  result: RunResult,
  locale: Locale,
): void {
  const target = absolutePath(directory);
  mkdirSync(target, { recursive: true });
  const resourceNames = resourceNamesOf(scenario);
  const files: Readonly<Record<string, string>> = {
    'elements.csv': elementsCsv(ir, result),
    'flows.csv': flowsCsv(ir, result),
    'resources.csv': resourcesCsv(result, resourceNames),
    'process.csv': processCsv(result),
  };
  const entries = Object.entries(files).map(([name, contents]) => ({
    contents,
    path: resolve(target, name),
  }));

  // Detecta todos los conflictos antes de publicar el primero y evita un conjunto mezclado.
  for (const entry of entries) assertReplaceableFile(entry.path, locale);
  const staged: Array<(typeof entries)[number] & { file: StagedFile }> = [];
  try {
    for (const entry of entries) staged.push({ ...entry, file: stageFile(entry.path, locale) });
    for (const entry of staged) {
      entry.file.write(entry.contents);
      entry.file.close();
    }
    for (const entry of staged) entry.file.commit();
  } catch (error) {
    for (const entry of staged) entry.file.abort();
    throw error;
  }
}

interface EventLogSink {
  onEvent(row: EventLogRow): void;
  close(): void;
  commit(): void;
  abort(): void;
}

/**
 * Escribe el log por bloques mientras corre `simulate`, sin retener todas las replicaciones.
 * El archivo temporal solo se publica como `log.csv` después de una corrida completa.
 *
 * ponytail: buffer de 1 MiB + `writeFileSync(fd, ...)` en vez de un `WriteStream`. `simulate` es
 * síncrona y no admite pausa, así que un stream asíncrono no podría aplicar backpressure: se
 * limitaría a acumular en memoria justo lo que este ticket quiere evitar. La escritura bloqueante
 * sí acota el pico al tamaño del buffer, y el `rename` del temporal conserva la publicación
 * atómica de LILA-046. Si algún día `simulate` se vuelve reanudable, aquí entra `once(s,'drain')`.
 */
function openEventLogSink(directory: string, startMs: number, locale: Locale): EventLogSink {
  const targetDirectory = absolutePath(directory);
  mkdirSync(targetDirectory, { recursive: true });
  const target = resolve(targetDirectory, 'log.csv');
  assertReplaceableFile(target, locale);
  const staged = stageFile(target, locale);
  let buffer = eventLogCsvHeader(startMs);
  let closed = false;

  const flush = (): void => {
    if (buffer === '') return;
    staged.write(buffer);
    buffer = '';
  };
  const close = (): void => {
    if (closed) return;
    flush();
    staged.close();
    closed = true;
  };

  return {
    onEvent(row) {
      buffer += eventLogRowCsv(row, startMs);
      if (buffer.length >= 1_048_576) flush();
    },
    close,
    commit() {
      close();
      staged.commit();
    },
    abort() {
      staged.abort();
    },
  };
}

interface RunCommandOptions {
  seed?: number | undefined;
  replications?: number | undefined;
  json?: string | undefined;
  csv?: string | undefined;
  xlsx?: string | undefined;
  locale: Locale;
}

async function runCommand(
  modelFile: string,
  scenarioFile: string,
  options: RunCommandOptions,
): Promise<number> {
  const locale = options.locale;
  const C = messages(locale).cli;
  const { path: modelPath, ir, validation: modelValidation } = await loadValidatedModel(modelFile, locale);
  if (modelHasErrors(modelValidation, locale)) return 1;

  const scenarioPath = absolutePath(scenarioFile);
  const resolvedScenario = loadResolvedScenario(scenarioPath, undefined, locale);
  if (comparablePath(modelPath) !== comparablePath(resolvedScenario.model)) {
    console.error(C.commandError('run', C.modelMismatch(modelPath, resolvedScenario.model)));
    return 1;
  }

  const scenario = withRunOverrides(resolvedScenario, options);

  const scenarioProblems = validateScenario(scenario, ir, { locale });
  const errors = scenarioErrors(scenarioProblems);
  if (errors.length > 0) {
    printScenarioProblems(scenarioProblems, locale);
    return 1;
  }

  const logSink =
    options.csv === undefined
      ? undefined
      : openEventLogSink(options.csv, runStartMs(scenario.run.start), locale);
  try {
    const simulated = simulate(ir, scenario, {
      log: logSink !== undefined,
      locale,
      ...(logSink === undefined ? {} : { onEvent: (row: EventLogRow) => logSink.onEvent(row) }),
    });
    logSink?.close();
    const result = resultWithBoundaryWarnings(simulated, modelValidation, scenarioProblems);

    printRunResult(ir, scenario, result, locale);
    if (options.json !== undefined) writeJson(options.json, result, locale);
    if (options.csv !== undefined) {
      writeCsvDirectory(options.csv, ir, scenario, result, locale);
      logSink?.commit();
      console.log(`CSV: ${absolutePath(options.csv)}`);
    }
    if (options.xlsx !== undefined) {
      writeXlsx(
        options.xlsx,
        scenarioWorkbook(ir, scenario, result, resourceNamesOf(scenario), locale),
        locale,
      );
    }
    return 0;
  } catch (error) {
    logSink?.abort();
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * `lila compare` (LILA-047)
 * ------------------------------------------------------------------ */

interface CompareCommandOptions {
  seed?: number | undefined;
  replications?: number | undefined;
  json?: string | undefined;
  xlsx?: string | undefined;
  all: boolean;
  locale: Locale;
}

/**
 * ponytail: subconjunto curado de KPIs para la tabla por defecto, no las decenas de percentiles
 * y variantes min/max/sd que produce `compare()` para cada elemento y recurso — un vistazo a
 * `lila compare` debe caber en una pantalla. `--all` restaura la lista completa sin filtrar.
 * Selección (LILA-047): por elemento started/completed/processing.mean/resourceWait.mean/
 * queueLength.mean; por recurso utilization/totalCost; por proceso cycleTime.mean/waitTime.mean/
 * throughputPerHour/costPerCase/totalCost.
 */
const DEFAULT_COMPARE_METRICS: ReadonlySet<string> = new Set([
  'elements:started',
  'elements:completed',
  'elements:processing.mean',
  'elements:resourceWait.mean',
  'elements:queueLength.mean',
  'resources:utilization',
  'resources:totalCost',
  'process:cycleTime.mean',
  'process:waitTime.mean',
  'process:throughputPerHour',
  'process:costPerCase',
  'process:totalCost',
  'process:withinServiceLevel',
]);

/**
 * Métricas por desenlace que entran en la tabla por defecto (#316): la media de ciclo de cada
 * `end` y su nivel de servicio. Sus paths llevan el id dentro, así que no caben en un `Set`.
 */
function isDefaultOutcomeMetric(scope: CompareScope, metric: string): boolean {
  if (scope !== 'process') return false;
  const outcome = splitOutcomeMetric(metric);
  return outcome !== null && (outcome.metric === 'cycleTime.mean' || outcome.metric === 'withinServiceLevel');
}

/** Valor de una sola celda, sin delta: usado también para la columna base. */
function formatCompareValue(metric: string, value: number | null, unit: BaseTimeUnit): string {
  if (value === null) return '-';
  if (isDurationMetric(metric)) return formatDuration(value, unit);
  if (metric === 'utilization') return formatPercent(value);
  if (metric === 'withinServiceLevel' || splitOutcomeMetric(metric)?.metric === 'withinServiceLevel') {
    return formatPercent(value);
  }
  return formatNumber(value);
}

/** Valor + delta relativo con signo + marca `*` de significancia, para las columnas no base. */
function formatCompareCell(
  metric: string,
  value: number | null,
  deltaRel: number | null,
  significant: boolean,
  unit: BaseTimeUnit,
): string {
  const valueText = formatCompareValue(metric, value, unit);
  if (value === null) return valueText;
  const deltaText = deltaRel === null ? '-' : formatSignedPercent(deltaRel);
  return `${valueText} (${deltaText})${significant ? '*' : ''}`;
}

function compareColumnHeader(name: string, index: number, locale: Locale): string {
  return index === 0 ? messages(locale).cli.baseColumn(name) : name;
}

function rowLabel(ir: ParsedIr, resourceNames: Readonly<Record<string, string>>, scope: CompareScope, id: string | null): string {
  if (id === null) return '';
  if (scope === 'elements') return ir.nodes[id]?.name ?? '';
  if (scope === 'flows') return ir.flows[id]?.name ?? '';
  if (scope === 'resources') return resourceNames[id] ?? '';
  return '';
}

function printCompareResult(
  ir: ParsedIr,
  loaded: readonly LoadedScenarioResult[],
  comparison: CompareResult,
  allRows: boolean,
  locale: Locale,
): void {
  const C = messages(locale).cli;
  const base = loaded[0]!;
  const unit = base.scenario.run.baseTimeUnit as BaseTimeUnit;
  // El nombre de un pool puede venir de cualquier escenario: el TO-BE puede estrenar un pool que
  // el base no declara, y esa fila existe igual en la tabla (`compare()` la da con base `null`).
  const resourceNames: Record<string, string> = {};
  for (const entry of loaded) {
    for (const [id, resource] of Object.entries(entry.scenario.resources ?? {})) {
      resourceNames[id] ??= resource.name ?? id;
    }
  }

  console.log(C.process(`${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`));
  console.log(C.timeUnitHeader(unit));
  console.log('');
  console.log(C.comparedScenarios());
  console.log(
    formatTable(
      ['#', C.columnName(), C.columnFile(), C.columnSeed(), C.columnReplications()],
      loaded.map((entry, index) => [
        String(index),
        compareColumnHeader(entry.scenario.name, index, locale),
        entry.file,
        formatNumber(entry.scenario.run.seed ?? 1),
        formatNumber(entry.scenario.run.replications),
      ]),
    ),
  );

  const scopes: CompareScope[] = allRows
    ? ['elements', 'resources', 'process', 'flows']
    : ['elements', 'resources', 'process'];
  const titles: Readonly<Record<CompareScope, string>> = {
    elements: 'Process elements',
    resources: 'Resources',
    process: 'Process',
    flows: 'Sequence flows',
  };

  for (const scope of scopes) {
    const rows = comparison.rows.filter(
      (row) =>
        row.scope === scope &&
        (allRows ||
          DEFAULT_COMPARE_METRICS.has(`${scope}:${row.metric}`) ||
          isDefaultOutcomeMetric(scope, row.metric)),
    );
    if (rows.length === 0) continue;

    const withId = scope !== 'process';
    console.log('');
    console.log(titles[scope]);
    console.log(
      formatTable(
        [
          ...(withId ? ['Id', 'Name'] : []),
          'Metric',
          ...loaded.map((entry, index) => compareColumnHeader(entry.scenario.name, index, locale)),
        ],
        rows.map((row) => [
          ...(withId ? [row.id ?? '', rowLabel(ir, resourceNames, scope, row.id)] : []),
          columnLabel(scope, row.metric),
          ...row.values.map((value, index) =>
            index === 0
              ? formatCompareValue(row.metric, value, unit)
              : formatCompareCell(
                  row.metric,
                  value,
                  row.deltaRel[index] ?? null,
                  row.significant[index] ?? false,
                  unit,
                ),
          ),
        ]),
      ),
    );
  }

  console.log('');
  console.log(C.significantMark());

  const warnings = compareWarnings(loaded, unit, locale);
  if (warnings.length > 0) {
    console.log('');
    console.log(C.warnings());
    for (const warning of warnings) console.log(`  ${warning}`);
  }
}

async function compareCommand(
  modelFile: string,
  scenarioFiles: readonly string[],
  options: CompareCommandOptions,
): Promise<number> {
  const locale = options.locale;
  const C = messages(locale).cli;
  const { path: modelPath, ir, validation: modelValidation } = await loadValidatedModel(modelFile, locale);
  if (modelHasErrors(modelValidation, locale)) return 1;

  // `compare` y `run` aceptan el mismo escenario (LILA-184): ninguno rechaza `resources` ni
  // `calendars`, que el motor simula desde LILA-033…036 y LILA-041. Ya no queda ningún aviso de
  // nivel pendiente que dar al pie de la tabla.
  const validated: Array<{
    file: string;
    scenario: ResolvedScenario;
    problems: readonly ScenarioProblem[];
  }> = [];
  // Todo se valida antes de simular nada: un escenario inválido en la posición n no debe costar la
  // simulación completa de los n − 1 anteriores.
  for (const scenarioFile of scenarioFiles) {
    const resolvedScenario = loadResolvedScenario(absolutePath(scenarioFile), undefined, locale);
    if (comparablePath(modelPath) !== comparablePath(resolvedScenario.model)) {
      console.error(
        C.commandError('compare', C.modelMismatchIn(modelPath, resolvedScenario.model, scenarioFile)),
      );
      return 1;
    }

    const scenario = withRunOverrides(resolvedScenario, options);
    const problems = validateScenario(scenario, ir, { locale });
    if (scenarioErrors(problems).length > 0) {
      console.error(C.commandError('compare', scenarioFile));
      printScenarioProblems(problems, locale);
      return 1;
    }
    validated.push({ file: scenarioFile, scenario, problems });
  }

  const loaded: LoadedScenarioResult[] = validated.map((entry) => ({
    file: entry.file,
    scenario: entry.scenario,
    result: resultWithBoundaryWarnings(
      simulate(ir, entry.scenario, { log: false, locale }),
      modelValidation,
      entry.problems,
    ),
  }));

  const comparison = compare(loaded.map((entry) => entry.result), { locale });
  printCompareResult(ir, loaded, comparison, options.all, locale);
  if (options.json !== undefined) writeJson(options.json, comparison, locale);
  if (options.xlsx !== undefined) {
    writeXlsx(options.xlsx, compareWorkbook(ir, loaded, comparison, locale), locale);
  }
  return 0;
}

function positionalError(
  command: 'validate' | 'run' | 'compare',
  expected: string,
  locale: Locale,
): number {
  const C = messages(locale).cli;
  console.error(C.commandError(command, C.expectedPositionals(expected)));
  return 1;
}

async function dispatchValidate(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  const C = messages(locale).cli;
  if (values.help === true) {
    console.log(C.usage());
    return 0;
  }
  if (positionals.length === 0) {
    console.error(C.commandError('validate', C.missingBpmnPath()));
    return 1;
  }
  if (positionals.length > 1) return positionalError('validate', C.bpmnPath(), locale);
  return validateCommand(positionals[0]!, values.json === true, locale);
}

async function dispatchRun(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      seed: { type: 'string' },
      replications: { type: 'string' },
      json: { type: 'string' },
      csv: { type: 'string' },
      xlsx: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  const C = messages(locale).cli;
  if (values.help === true) {
    console.log(C.usage());
    return 0;
  }
  if (positionals.length !== 2) return positionalError('run', C.runPaths(), locale);
  return runCommand(positionals[0]!, positionals[1]!, {
    seed: integerOption('seed', values.seed, locale),
    replications: integerOption('replications', values.replications, locale, 1),
    json: values.json,
    csv: values.csv,
    xlsx: values.xlsx,
    locale,
  });
}

async function dispatchCompare(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      seed: { type: 'string' },
      replications: { type: 'string' },
      json: { type: 'string' },
      xlsx: { type: 'string' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  const C = messages(locale).cli;
  if (values.help === true) {
    console.log(C.usage());
    return 0;
  }
  if (positionals.length < 3) return positionalError('compare', C.comparePaths(), locale);
  const [model, ...scenarios] = positionals;
  return compareCommand(model!, scenarios, {
    seed: integerOption('seed', values.seed, locale),
    replications: integerOption('replications', values.replications, locale, 1),
    json: values.json,
    xlsx: values.xlsx,
    all: values.all === true,
    locale,
  });
}

/**
 * `@lila/mcp` depende de `@lila/engine`, así que importarlo estáticamente desde aquí sería un ciclo
 * entre paquetes. Se carga con `import()` y el especificador en una constante: así el especificador
 * no es literal para TypeScript, `tsc --build` de este paquete no pasa a depender del `dist/` de
 * `@lila/mcp` (que se compila después) y el paquete solo se resuelve cuando alguien corre `lila mcp`.
 */
const MCP_PACKAGE = '@lila/mcp';

async function dispatchMcp(argv: readonly string[], locale: Locale): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  const C = messages(locale).cli;
  if (values.help === true) {
    console.log(C.usage());
    return 0;
  }
  if (positionals.length > 0) {
    console.error(C.commandError('mcp', C.mcpNoArguments()));
    return 1;
  }

  let start: (options?: { locale?: Locale }) => Promise<void>;
  try {
    ({ startStdioServer: start } = (await import(MCP_PACKAGE)) as {
      startStdioServer: (options?: { locale?: Locale }) => Promise<void>;
    });
  } catch (error) {
    // stdout es el transporte MCP: todo diagnóstico va por stderr, que es lo único que ve
    // quien registró el servidor en Claude Code.
    console.error(
      C.commandError(
        'mcp',
        (error as { code?: string } | null)?.code === 'ERR_MODULE_NOT_FOUND'
          ? C.mcpMissingPackage(MCP_PACKAGE)
          : error instanceof Error
            ? error.message
            : String(error),
      ),
    );
    return 1;
  }

  // El idioma que resolvió la CLI es el del servidor; cada llamada puede pedir otro con `locale`.
  // Devuelve en cuanto el transporte queda conectado; el proceso sigue vivo mientras stdin lo esté.
  await start({ locale });
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  // `--lang` se resuelve antes de repartir: es global, no de un subcomando (ver `extractLang`).
  const { argv: rest, lang, invalid } = extractLang(argv);
  const locale = resolveLocale(lang, process.env);
  const C = messages(locale).cli;
  if (invalid !== undefined) {
    console.error(invalid === '' ? C.missingLangValue(LOCALE_LIST) : C.invalidLang(invalid, LOCALE_LIST));
    return 1;
  }

  const [command, ...args] = rest;
  if (command === undefined) {
    console.log(C.usage());
    return 1;
  }
  if (command === '--help' || command === '-h') {
    console.log(C.usage());
    return 0;
  }

  try {
    if (command === 'validate') return await dispatchValidate(args, locale);
    if (command === 'run') return await dispatchRun(args, locale);
    if (command === 'compare') return await dispatchCompare(args, locale);
    if (command === 'mcp') return await dispatchMcp(args, locale);
    console.error(C.unknownCommand(command));
    console.error(C.usage());
    return 1;
  } catch (error) {
    console.error(C.commandError(command, error instanceof Error ? error.message : String(error)));
    return 1;
  }
}
