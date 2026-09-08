#!/usr/bin/env node
/** CLI `lila`: validación y simulación reproducible desde archivos. */

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
  type BaseTimeUnit,
} from './format.js';
import { scenarioErrors, validateScenario, type ResolvedScenario, type ScenarioProblem } from './scenario.js';

const USAGE = `Uso: lila validate <archivo.bpmn> [--json]
     lila run <modelo.bpmn> <escenario.json> [--seed n] [--replications n]
              [--json resultado.json] [--csv directorio]
     lila compare <modelo.bpmn> <a.json> <b.json> [...] [--seed n] [--replications n]
                  [--json resultado.json] [--all]

Comandos:
  validate   Parsea el BPMN, imprime su IR y valida el modelo.
  run        Valida modelo y escenario, simula y muestra tablas de resultados.
  compare    Simula dos o más escenarios sobre el mismo modelo y los compara lado a lado.

Opciones de validate:
  --json     Imprime el IR y los problemas por stdout.

Opciones de run:
  --seed n          Sobrescribe run.seed con un entero.
  --replications n  Sobrescribe run.replications con un entero >= 1.
  --json archivo    Escribe el RunResult determinista como JSON.
  --csv directorio  Escribe elements, flows, resources, process y log como CSV RFC 4180.
                    log.csv se escribe en streaming y lleva timestamps ISO desde run.start.

Opciones de compare:
  --seed n          Sobrescribe run.seed en todos los escenarios comparados.
  --replications n  Sobrescribe run.replications en todos los escenarios comparados.
  --json archivo    Escribe el CompareResult determinista como JSON.
  --all             Imprime todos los KPI de compare(), no solo el subconjunto curado.
                    El primer escenario listado es la base: los demás se comparan contra él.

Opciones generales:
  -h, --help Muestra esta ayuda.`;

/** Cuenta los nodos por tipo para la línea de resumen de `validate`. */
function countByType(nodes: Record<string, { type: string }>): string {
  const counts = new Map<string, number>();
  for (const node of Object.values(nodes)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');
}

function printValidationProblems({ errors, warnings }: ValidationResult): void {
  for (const warning of warnings) console.log(`aviso  ${warning.code}  ${warning.message}`);
  for (const error of errors) console.log(`error  ${error.code}  ${error.message}`);
}

async function validateCommand(file: string, json: boolean): Promise<number> {
  const xml = readFileSync(file, 'utf8');
  // ponytail: el reporte lo arma `validateBpmnXml`, compartido con el servidor MCP (LILA-053).
  const report = await validateBpmnXml(xml);
  const { ir, ignoredProcessIds } = report;
  const validation: ValidationResult = { errors: report.errors, warnings: report.warnings };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return validation.errors.length > 0 ? 1 : 0;
  }

  console.log(`Proceso ${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`);
  if (ir.source.exporter !== '') {
    console.log(`Exportado por ${ir.source.exporter} ${ir.source.exporterVersion}`.trimEnd());
  }
  console.log('');

  const nodeIds = Object.keys(ir.nodes);
  console.log(`Nodos (${nodeIds.length}): ${countByType(ir.nodes)}`);
  for (const id of nodeIds) {
    const node = ir.nodes[id];
    if (node === undefined) continue;
    const lane = node.lane === undefined ? '' : `  [${node.lane}]`;
    console.log(`  ${node.type.padEnd(9)} ${id}${node.name === '' ? '' : `  ${node.name}`}${lane}`);
  }

  const flowIds = Object.keys(ir.flows);
  console.log('');
  console.log(`Flujos (${flowIds.length}):`);
  for (const id of flowIds) {
    const flow = ir.flows[id];
    if (flow === undefined) continue;
    const mark = flow.isDefault ? '  (por defecto)' : '';
    console.log(`  ${id}: ${flow.from} -> ${flow.to}${flow.name === '' ? '' : `  ${flow.name}`}${mark}`);
  }

  if (ignoredProcessIds.length > 0) {
    console.log('');
    console.log(`Otros procesos del archivo, no simulados: ${ignoredProcessIds.join(', ')}`);
  }

  console.log('');
  printValidationProblems(validation);
  console.log(`${validation.errors.length} errores, ${validation.warnings.length} avisos.`);

  return validation.errors.length > 0 ? 1 : 0;
}

function integerOption(name: string, raw: string | undefined, minimum?: number): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw)) throw new Error(`--${name} requiere un entero; se recibió "${raw}".`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    const range = minimum === undefined ? 'un entero seguro' : `un entero >= ${minimum}`;
    throw new Error(`--${name} requiere ${range}; se recibió "${raw}".`);
  }
  return value;
}

function printScenarioProblems(problems: readonly ScenarioProblem[]): void {
  for (const problem of problems) {
    console.log(`${problem.severity === 'error' ? 'error' : 'aviso'}  ${problem.code}  ${problem.message}`);
  }
}

/** Imprime los problemas del modelo y responde si hay errores que aborten el comando. */
function modelHasErrors(validation: ValidationResult): boolean {
  if (validation.errors.length === 0) return false;
  printValidationProblems(validation);
  console.log(`${validation.errors.length} errores, ${validation.warnings.length} avisos.`);
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

function printRunResult(ir: ParsedIr, scenario: ResolvedScenario, result: RunResult): void {
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const currency = scenario.run.currency;
  console.log(`Escenario ${scenario.name}`);
  console.log(`Proceso ${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`);
  console.log(
    `Semilla ${scenario.run.seed ?? 1} · Replicaciones ${scenario.run.replications} · Unidad de tiempo ${unit}` +
      (currency === undefined ? '' : ` · Moneda ${currency}`),
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
  console.log('Cuellos de botella');
  if (result.bottlenecks.length === 0) {
    console.log('Sin espera por recurso detectada.');
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
  console.log('');
  console.log('Process summary (extras)');
  console.log(
    formatTable(
      PROCESS_SUMMARY_COLUMNS.map((metric) => columnHeader('process', metric, unit)),
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
      ]],
    ),
  );

  if (result.warnings.length > 0) {
    console.log('');
    console.log('Avisos:');
    for (const warning of result.warnings) console.log(`  ${warning}`);
  }
}

/** Publica cualquier valor serializable como JSON determinista; usado por `run` y `compare`. */
function writeJson(file: string, data: unknown): void {
  console.log(`JSON: ${writeJsonAtomic(file, data)}`);
}

function writeCsvDirectory(
  directory: string,
  ir: ParsedIr,
  scenario: ResolvedScenario,
  result: RunResult,
): void {
  const target = absolutePath(directory);
  mkdirSync(target, { recursive: true });
  const resourceNames = Object.fromEntries(
    Object.entries(scenario.resources ?? {}).map(([id, resource]) => [id, resource.name]),
  );
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
  for (const entry of entries) assertReplaceableFile(entry.path);
  const staged: Array<(typeof entries)[number] & { file: StagedFile }> = [];
  try {
    for (const entry of entries) staged.push({ ...entry, file: stageFile(entry.path) });
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
function openEventLogSink(directory: string, startMs: number): EventLogSink {
  const targetDirectory = absolutePath(directory);
  mkdirSync(targetDirectory, { recursive: true });
  const target = resolve(targetDirectory, 'log.csv');
  assertReplaceableFile(target);
  const staged = stageFile(target);
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
}

async function runCommand(
  modelFile: string,
  scenarioFile: string,
  options: RunCommandOptions,
): Promise<number> {
  const { path: modelPath, ir, validation: modelValidation } = await loadValidatedModel(modelFile);
  if (modelHasErrors(modelValidation)) return 1;

  const scenarioPath = absolutePath(scenarioFile);
  const resolvedScenario = loadResolvedScenario(scenarioPath);
  if (comparablePath(modelPath) !== comparablePath(resolvedScenario.model)) {
    console.error(
      `lila run: el modelo posicional (${modelPath}) no coincide con scenario.model (${resolvedScenario.model}).`,
    );
    return 1;
  }

  const scenario = withRunOverrides(resolvedScenario, options);

  const scenarioProblems = validateScenario(scenario, ir);
  const errors = scenarioErrors(scenarioProblems);
  if (errors.length > 0) {
    printScenarioProblems(scenarioProblems);
    return 1;
  }

  const logSink =
    options.csv === undefined ? undefined : openEventLogSink(options.csv, runStartMs(scenario.run.start));
  try {
    const simulated = simulate(ir, scenario, {
      log: logSink !== undefined,
      ...(logSink === undefined ? {} : { onEvent: (row: EventLogRow) => logSink.onEvent(row) }),
    });
    logSink?.close();
    const result = resultWithBoundaryWarnings(simulated, modelValidation, scenarioProblems);

    printRunResult(ir, scenario, result);
    if (options.json !== undefined) writeJson(options.json, result);
    if (options.csv !== undefined) {
      writeCsvDirectory(options.csv, ir, scenario, result);
      logSink?.commit();
      console.log(`CSV: ${absolutePath(options.csv)}`);
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
  all: boolean;
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
]);

/** Valor de una sola celda, sin delta: usado también para la columna base. */
function formatCompareValue(metric: string, value: number | null, unit: BaseTimeUnit): string {
  if (value === null) return '-';
  if (isDurationMetric(metric)) return formatDuration(value, unit);
  if (metric === 'utilization') return `${formatNumber(value * 100)}%`;
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

function compareColumnHeader(name: string, index: number): string {
  return index === 0 ? `${name} (base)` : name;
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
): void {
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

  console.log(`Proceso ${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`);
  console.log(`Unidad de tiempo ${unit} (escenario base) · Utilización en %`);
  console.log('');
  console.log('Escenarios comparados');
  console.log(
    formatTable(
      ['#', 'Nombre', 'Archivo', 'Semilla', 'Replicaciones'],
      loaded.map((entry, index) => [
        String(index),
        compareColumnHeader(entry.scenario.name, index),
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
      (row) => row.scope === scope && (allRows || DEFAULT_COMPARE_METRICS.has(`${scope}:${row.metric}`)),
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
          ...loaded.map((entry, index) => compareColumnHeader(entry.scenario.name, index)),
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
  console.log('* diferencia significativa (IC95 sin solapamiento)');

  const warnings = compareWarnings(loaded, unit);
  if (warnings.length > 0) {
    console.log('');
    console.log('Avisos:');
    for (const warning of warnings) console.log(`  ${warning}`);
  }
}

async function compareCommand(
  modelFile: string,
  scenarioFiles: readonly string[],
  options: CompareCommandOptions,
): Promise<number> {
  const { path: modelPath, ir, validation: modelValidation } = await loadValidatedModel(modelFile);
  if (modelHasErrors(modelValidation)) return 1;

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
    const resolvedScenario = loadResolvedScenario(absolutePath(scenarioFile));
    if (comparablePath(modelPath) !== comparablePath(resolvedScenario.model)) {
      console.error(
        `lila compare: el modelo posicional (${modelPath}) no coincide con scenario.model ` +
          `(${resolvedScenario.model}) en ${scenarioFile}.`,
      );
      return 1;
    }

    const scenario = withRunOverrides(resolvedScenario, options);
    const problems = validateScenario(scenario, ir);
    if (scenarioErrors(problems).length > 0) {
      console.error(`lila compare: ${scenarioFile}`);
      printScenarioProblems(problems);
      return 1;
    }
    validated.push({ file: scenarioFile, scenario, problems });
  }

  const loaded: LoadedScenarioResult[] = validated.map((entry) => ({
    file: entry.file,
    scenario: entry.scenario,
    result: resultWithBoundaryWarnings(
      simulate(ir, entry.scenario, { log: false }),
      modelValidation,
      entry.problems,
    ),
  }));

  const comparison = compare(loaded.map((entry) => entry.result));
  printCompareResult(ir, loaded, comparison, options.all);
  if (options.json !== undefined) writeJson(options.json, comparison);
  return 0;
}

function positionalError(command: 'validate' | 'run' | 'compare', expected: string): number {
  console.error(`lila ${command}: se esperaba ${expected}.`);
  return 1;
}

async function dispatchValidate(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length === 0) {
    console.error('lila validate: falta la ruta del archivo .bpmn.');
    return 1;
  }
  if (positionals.length > 1) return positionalError('validate', 'una ruta .bpmn');
  return validateCommand(positionals[0]!, values.json === true);
}

async function dispatchRun(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      seed: { type: 'string' },
      replications: { type: 'string' },
      json: { type: 'string' },
      csv: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 2) {
    return positionalError('run', 'las rutas <modelo.bpmn> <escenario.json>');
  }
  return runCommand(positionals[0]!, positionals[1]!, {
    seed: integerOption('seed', values.seed),
    replications: integerOption('replications', values.replications, 1),
    json: values.json,
    csv: values.csv,
  });
}

async function dispatchCompare(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      seed: { type: 'string' },
      replications: { type: 'string' },
      json: { type: 'string' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length < 3) {
    return positionalError('compare', 'un <modelo.bpmn> y al menos dos escenarios <a.json> <b.json>');
  }
  const [model, ...scenarios] = positionals;
  return compareCommand(model!, scenarios, {
    seed: integerOption('seed', values.seed),
    replications: integerOption('replications', values.replications, 1),
    json: values.json,
    all: values.all === true,
  });
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) {
    console.log(USAGE);
    return 1;
  }
  if (command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  try {
    if (command === 'validate') return await dispatchValidate(args);
    if (command === 'run') return await dispatchRun(args);
    if (command === 'compare') return await dispatchCompare(args);
    console.error(`lila: comando desconocido "${command}".`);
    console.error(USAGE);
    return 1;
  } catch (error) {
    console.error(`lila ${command}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
