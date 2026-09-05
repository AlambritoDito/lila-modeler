#!/usr/bin/env node
/** CLI `lila`: validación y simulación reproducible desde archivos. */

import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parseBpmn } from './bpmn/parse.js';
import { validate, type ValidationResult } from './bpmn/validate.js';
import { validateBpmnXml } from './bpmn/validate-report.js';
import {
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
  formatDuration,
  formatNumber,
  formatSignedPercent,
  formatTable,
  type BaseTimeUnit,
} from './format.js';
import {
  resolveExtends,
  ScenarioSchema,
  scenarioErrors,
  validateScenario,
  type ResolvedScenario,
  type ScenarioProblem,
} from './scenario.js';

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

function absolutePath(file: string): string {
  // `resolveExtends` usa `/` también en el FS virtual. Node acepta esa forma en Windows.
  return resolve(file).replaceAll('\\', '/');
}

function comparablePath(file: string): string {
  // Dos rutas distintas pueden nombrar el mismo archivo mediante un symlink. El contrato compara
  // el modelo real, no la ortografía usada para llegar a él.
  const normalized = existsSync(file) ? realpathSync(file) : resolve(file);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${file}: JSON inválido: ${error.message}`);
    throw error;
  }
}

function loadResolvedScenario(file: string): ResolvedScenario {
  const raw = resolveExtends(file, readJson);
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? '$' : issue.path.map(String).join('.');
      return `${path}: ${issue.message}`;
    });
    throw new Error(`${file}: escenario inválido:\n${issues.join('\n')}`);
  }
  if (parsed.data.model === undefined) throw new Error(`${file}: el escenario resuelto no declara model.`);
  if (parsed.data.run === undefined) throw new Error(`${file}: el escenario resuelto no declara run.`);
  return parsed.data as ResolvedScenario;
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

/** Overrides comunes de `--seed`/`--replications`; `run` y `compare` los aplican igual. */
function withRunOverrides(
  scenario: ResolvedScenario,
  options: { seed?: number | undefined; replications?: number | undefined },
): ResolvedScenario {
  return {
    ...scenario,
    run: {
      ...scenario.run,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.replications === undefined ? {} : { replications: options.replications }),
    },
  };
}

/** ¿El escenario declara calendarios, en `calendars` o en la referencia de un pool/elemento? */
function declaresCalendars(scenario: ResolvedScenario): boolean {
  if (Object.keys(scenario.calendars ?? {}).length > 0) return true;
  if (Object.values(scenario.resources ?? {}).some((resource) => resource.calendar !== undefined)) return true;
  return Object.values(scenario.elements ?? {}).some((element) => element.calendar !== undefined);
}

/**
 * Aviso de que un escenario declara calendarios que el motor todavía no simula (M3, LILA-041):
 * sus números salen 24×7. Compartido por `lila run` y `lila compare` (LILA-184) para que ambos
 * avisen exactamente igual; antes `run` rechazaba estos escenarios con `E-NIVEL-M3` y `compare`
 * no aplicaba ningún gate.
 */
function calendarsWarning(scenarioName: string): string {
  return `"${scenarioName}" declara calendarios; el motor todavía no los simula (M3, LILA-041) y sus números salen 24×7.`;
}

/** Avisos de nivel 3 (M3) pendientes de un escenario: hoy solo calendarios. Usado por `lila run`. */
function pendingM3Warnings(scenario: ResolvedScenario): string[] {
  return declaresCalendars(scenario) ? [calendarsWarning(scenario.name)] : [];
}

function printScenarioProblems(problems: readonly ScenarioProblem[]): void {
  for (const problem of problems) {
    console.log(`${problem.severity === 'error' ? 'error' : 'aviso'}  ${problem.code}  ${problem.message}`);
  }
}

function resultWithBoundaryWarnings(
  result: RunResult,
  modelValidation: ValidationResult,
  scenarioProblems: readonly ScenarioProblem[],
  extraWarnings: readonly string[] = [],
): RunResult {
  const warnings = new Set<string>();
  for (const warning of modelValidation.warnings) warnings.add(`${warning.code}: ${warning.message}`);
  for (const warning of scenarioProblems) {
    if (warning.severity === 'warning') warnings.add(`${warning.code}: ${warning.message}`);
  }
  for (const warning of result.warnings) warnings.add(warning);
  for (const warning of extraWarnings) warnings.add(warning);
  return { ...result, warnings: [...warnings] };
}

type ParsedIr = Awaited<ReturnType<typeof parseBpmn>>['ir'];

/** Lee y valida el modelo posicional; `run` y `compare` arrancan exactamente igual. */
async function loadValidatedModel(
  modelFile: string,
): Promise<{ path: string; ir: ParsedIr; validation: ValidationResult }> {
  const path = absolutePath(modelFile);
  const parsed = await parseBpmn(readFileSync(path, 'utf8'));
  const validation = validate(parsed.ir, {
    unsupported: parsed.unsupported,
    messageFlowCount: parsed.messageFlowCount,
    conditionFlowIds: parsed.conditionFlowIds,
  });
  return { path, ir: parsed.ir, validation };
}

/** Imprime los problemas del modelo y responde si hay errores que aborten el comando. */
function modelHasErrors(validation: ValidationResult): boolean {
  if (validation.errors.length === 0) return false;
  printValidationProblems(validation);
  console.log(`${validation.errors.length} errores, ${validation.warnings.length} avisos.`);
  return true;
}

function printRunResult(ir: ParsedIr, scenario: ResolvedScenario, result: RunResult): void {
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  console.log(`Escenario ${scenario.name}`);
  console.log(`Proceso ${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`);
  console.log(
    `Semilla ${scenario.run.seed} · Replicaciones ${scenario.run.replications} · Unidad de tiempo ${unit}`,
  );

  console.log('');
  console.log('Process elements');
  console.log(
    formatTable(
      [
        'Id',
        'Name',
        'Type',
        'Instances started',
        'Instances completed',
        `Minimum time (${unit})`,
        `Maximum time (${unit})`,
        `Average time (${unit})`,
        `Total time (${unit})`,
      ],
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
        ];
      }),
    ),
  );

  console.log('');
  console.log('Sequence flows');
  console.log(
    formatTable(
      ['Id', 'Name', 'From', 'To', 'Instances/Tokens completed'],
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
        ['Id', 'Name', 'Utilization (%)', `Busy time (${unit})`, 'Fixed cost', 'Unit cost', 'Total cost'],
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

  const process = result.process;
  console.log('');
  console.log('Process summary (extras)');
  console.log(
    formatTable(
      [
        'Instances started',
        'Instances completed',
        'In flight',
        `Average cycle (${unit})`,
        `p50 (${unit})`,
        `p90 (${unit})`,
        `p95 (${unit})`,
        'Throughput/hour',
      ],
      [[
        formatNumber(process.started),
        formatNumber(process.completed),
        formatNumber(process.inFlight),
        formatDuration(process.cycleTime.mean, unit),
        formatDuration(process.cycleTime.p50, unit),
        formatDuration(process.cycleTime.p90, unit),
        formatDuration(process.cycleTime.p95, unit),
        formatNumber(process.throughputPerHour),
      ]],
    ),
  );

  if (result.warnings.length > 0) {
    console.log('');
    console.log('Avisos:');
    for (const warning of result.warnings) console.log(`  ${warning}`);
  }
}

interface StagedFile {
  readonly target: string;
  write(contents: string): void;
  close(): void;
  commit(): void;
  abort(): void;
}

let temporarySequence = 0;

/** Crea un temporal exclusivo en el mismo directorio: `rename` publica cada archivo atómicamente. */
function stageFile(target: string): StagedFile {
  let temporary = '';
  let descriptor: number | undefined;
  for (;;) {
    temporary = `${target}.tmp-${process.pid}-${temporarySequence++}`;
    try {
      descriptor = openSync(temporary, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  const close = (): void => {
    if (descriptor === undefined) return;
    const openDescriptor = descriptor;
    descriptor = undefined;
    closeSync(openDescriptor);
  };

  return {
    target,
    write(contents) {
      if (descriptor === undefined) throw new Error(`archivo temporal ya cerrado: ${temporary}`);
      // `writeFileSync(fd, ...)` completa todo el buffer; un único `writeSync` puede ser parcial.
      writeFileSync(descriptor, contents, 'utf8');
    },
    close,
    commit() {
      close();
      renameSync(temporary, target);
    },
    abort() {
      try {
        close();
      } catch {
        // El error original de escritura/publicación es el que debe llegar al usuario.
      }
      try {
        unlinkSync(temporary);
      } catch {
        // Si ya se publicó o nunca llegó a crearse, no queda temporal que limpiar.
      }
    },
  };
}

function assertReplaceableFile(target: string): void {
  if (existsSync(target) && lstatSync(target).isDirectory()) {
    throw new Error(`no se puede escribir ${target}: existe un directorio con ese nombre.`);
  }
}

/** Publica cualquier valor serializable como JSON determinista; usado por `run` y `compare`. */
function writeJson(file: string, data: unknown): void {
  const target = absolutePath(file);
  mkdirSync(dirname(target), { recursive: true });
  assertReplaceableFile(target);
  const staged = stageFile(target);
  try {
    staged.write(`${JSON.stringify(data, null, 2)}\n`);
    staged.commit();
  } catch (error) {
    staged.abort();
    throw error;
  }
  console.log(`JSON: ${target}`);
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
    const result = resultWithBoundaryWarnings(
      simulated,
      modelValidation,
      scenarioProblems,
      pendingM3Warnings(scenario),
    );

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

interface LoadedScenarioResult {
  file: string;
  scenario: ResolvedScenario;
  result: RunResult;
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

/** Nombres de columna Bizagi (docs/RESULTS_FORMAT.md §10); lo que no tiene equivalente conserva el path interno. */
const BIZAGI_COMPARE_LABELS: Readonly<Record<string, string>> = {
  'elements:started': 'Instances started',
  'elements:completed': 'Instances completed',
  'elements:processing.min': 'Minimum time',
  'elements:processing.max': 'Maximum time',
  'elements:processing.mean': 'Average time',
  'elements:processing.total': 'Total time',
  'elements:resourceWait.min': 'Minimum time (waiting for resource)',
  'elements:resourceWait.max': 'Maximum time (waiting for resource)',
  'elements:resourceWait.mean': 'Average time (waiting for resource)',
  'elements:resourceWait.sd': 'Standard deviation (waiting for resource)',
  'elements:resourceWait.total': 'Total time (waiting for resource)',
  'elements:fixedCostTotal': 'Total fixed cost',
  'resources:utilization': 'Utilization (%)',
  'resources:busyTime': 'Busy time',
  'resources:fixedCost': 'Fixed cost',
  'resources:unitCost': 'Unit cost',
  'resources:totalCost': 'Total cost',
  'flows:count': 'Instances/Tokens completed',
};

/**
 * Métricas cuyo valor son segundos y por tanto se convierten a `baseTimeUnit` al imprimir
 * (R-DURA-2). `busyTime` son segundos-unidad (RESULTS_FORMAT.md § 4) y también se convierte: dejar
 * la única duración que solo aparece con `--all` en segundos crudos, junto a costos derivados de
 * ella ya convertidos, hacía ilegible la tabla de recursos.
 */
const DURATION_METRIC_PREFIXES: ReadonlySet<string> = new Set([
  'processing',
  'resourceWait',
  'offHoursWait',
  'cycleTime',
  'waitTime',
  'busyTime',
]);

function isDurationMetric(metric: string): boolean {
  return DURATION_METRIC_PREFIXES.has(metric.split('.')[0] ?? '');
}

function compareMetricLabel(scope: CompareScope, metric: string): string {
  return BIZAGI_COMPARE_LABELS[`${scope}:${metric}`] ?? metric;
}

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

/**
 * Avisos de la corrida completa, en un solo bloque al pie de la tabla.
 *
 * Incluye los avisos de modelo y escenario que `lila run` ya imprime (`resultWithBoundaryWarnings`)
 * y tres que solo tienen sentido comparando: unidad de tiempo distinta entre escenarios —la tabla
 * usa siempre la del base—, semillas distintas —se pierden los números aleatorios comunes de
 * R-DET-3, sobre los que descansa la lectura limpia de los deltas (RESULTS_FORMAT.md § 11)— y
 * calendarios declarados, que el motor todavía no simula (M3, LILA-041).
 */
function compareWarnings(loaded: readonly LoadedScenarioResult[], unit: BaseTimeUnit): string[] {
  const lines: string[] = [];
  const label = (entry: LoadedScenarioResult): string => `"${entry.scenario.name}"`;

  const otherUnits = loaded.filter((entry) => entry.scenario.run.baseTimeUnit !== unit);
  if (otherUnits.length > 0) {
    lines.push(
      `los escenarios no comparten baseTimeUnit; toda la tabla usa ${unit}, la del escenario base. ` +
        `Declaran otra: ${otherUnits.map((entry) => `${label(entry)} (${entry.scenario.run.baseTimeUnit})`).join(', ')}.`,
    );
  }

  const seeds = new Set(loaded.map((entry) => entry.scenario.run.seed));
  if (seeds.size > 1) {
    lines.push(
      `los escenarios corren con semillas distintas (${[...seeds].join(', ')}): se pierden los números ` +
        'aleatorios comunes (R-DET-3) y los deltas mezclan el efecto del cambio con el del muestreo. ' +
        'Usa --seed para forzar la misma semilla en todos.',
    );
  }

  for (const entry of loaded.filter((entry) => declaresCalendars(entry.scenario))) {
    lines.push(calendarsWarning(entry.scenario.name));
  }

  for (const entry of loaded.filter((entry) => entry.result.replications === undefined)) {
    lines.push(
      `${label(entry)} corrió sin al menos dos replicaciones completas; sin IC95 no hay marca de ` +
        'significancia posible para ese escenario.',
    );
  }

  // Los avisos del motor llegan uno por replicación (W-JOIN-BLOQUEADO cita un conteo distinto en
  // cada una): 30 réplicas × N escenarios enterrarían la tabla. `compare` es una vista de resumen,
  // así que se queda con el primero de cada código y dice cuántos más hubo; el detalle completo
  // está en `lila run` y en su `--json`.
  for (const entry of loaded) {
    const byCode = new Map<string, { first: string; count: number }>();
    for (const warning of entry.result.warnings) {
      const code = warning.split(':')[0] ?? warning;
      const group = byCode.get(code);
      if (group === undefined) byCode.set(code, { first: warning, count: 1 });
      else group.count++;
    }
    for (const { first, count } of byCode.values()) {
      const more = count > 1 ? ` (+${count - 1} aviso${count === 2 ? '' : 's'} más con el mismo código)` : '';
      lines.push(`${label(entry)} ${first}${more}`);
    }
  }
  return lines;
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
        formatNumber(entry.scenario.run.seed),
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
          compareMetricLabel(scope, row.metric),
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

  // `compare` y `run` aceptan el mismo escenario (LILA-184): ninguno rechaza `resources`, que el
  // motor simula desde LILA-033…036 (LILA-038 ya los agrega a `compare()`). Los `calendars` de M3
  // sí siguen sin simularse —el motor los ignora, sus números salen 24×7— pero tampoco se rechazan:
  // ambos comandos avisan igual al pie (`pendingM3Warnings`/`compareWarnings`, `calendarsWarning`).
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
