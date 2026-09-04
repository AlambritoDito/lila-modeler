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
import {
  elementsCsv,
  eventLogCsvHeader,
  eventLogRowCsv,
  flowsCsv,
  processCsv,
  resourcesCsv,
  runStartMs,
} from './csv.js';
import { simulate } from './core/run.js';
import type { EventLogRow, RunResult } from './core/result.js';
import { formatDuration, formatNumber, formatTable, type BaseTimeUnit } from './format.js';
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

Comandos:
  validate   Parsea el BPMN, imprime su IR y valida el modelo.
  run        Valida modelo y escenario, simula y muestra tablas de resultados.

Opciones de validate:
  --json     Imprime el IR y los problemas por stdout.

Opciones de run:
  --seed n          Sobrescribe run.seed con un entero.
  --replications n  Sobrescribe run.replications con un entero >= 1.
  --json archivo    Escribe el RunResult determinista como JSON.
  --csv directorio  Escribe elements, flows, resources, process y log como CSV RFC 4180.
                    log.csv se escribe en streaming y lleva timestamps ISO desde run.start.

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
  const { ir, ignoredProcessIds, unsupported, messageFlowCount, conditionFlowIds } =
    await parseBpmn(xml);
  const validation = validate(ir, {
    unsupported,
    messageFlowCount,
    conditionFlowIds,
  });

  if (json) {
    console.log(
      JSON.stringify(
        { ir, ignoredProcessIds, errors: validation.errors, warnings: validation.warnings },
        null,
        2,
      ),
    );
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

/** Campos válidos de v1 cuyo comportamiento aún no existe en el motor de M1. */
function unsupportedM1(scenario: ResolvedScenario): string[] {
  const errors: string[] = [];
  if (Object.keys(scenario.resources ?? {}).length > 0) {
    errors.push('E-NIVEL-M2 resources: los pools de recursos todavía no están soportados por lila run.');
  }
  if (Object.keys(scenario.calendars ?? {}).length > 0) {
    errors.push('E-NIVEL-M3 calendars: los calendarios todavía no están soportados por lila run.');
  }
  for (const [id, element] of Object.entries(scenario.elements ?? {})) {
    if ((element.resources?.length ?? 0) > 0 || element.selection !== undefined) {
      errors.push(
        `E-NIVEL-M2 elements.${id}.resources: la asignación de recursos todavía no está soportada por lila run.`,
      );
    }
    if (element.calendar !== undefined) {
      errors.push(
        `E-NIVEL-M3 elements.${id}.calendar: los calendarios de elemento todavía no están soportados por lila run.`,
      );
    }
  }
  return errors;
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
): RunResult {
  const warnings = new Set<string>();
  for (const warning of modelValidation.warnings) warnings.add(`${warning.code}: ${warning.message}`);
  for (const warning of scenarioProblems) {
    if (warning.severity === 'warning') warnings.add(`${warning.code}: ${warning.message}`);
  }
  for (const warning of result.warnings) warnings.add(warning);
  return { ...result, warnings: [...warnings] };
}

type ParsedIr = Awaited<ReturnType<typeof parseBpmn>>['ir'];

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

function writeJson(file: string, result: RunResult): void {
  const target = absolutePath(file);
  mkdirSync(dirname(target), { recursive: true });
  assertReplaceableFile(target);
  const staged = stageFile(target);
  try {
    staged.write(`${JSON.stringify(result, null, 2)}\n`);
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
  const modelPath = absolutePath(modelFile);
  const parsedModel = await parseBpmn(readFileSync(modelPath, 'utf8'));
  const modelValidation = validate(parsedModel.ir, {
    unsupported: parsedModel.unsupported,
    messageFlowCount: parsedModel.messageFlowCount,
    conditionFlowIds: parsedModel.conditionFlowIds,
  });
  if (modelValidation.errors.length > 0) {
    printValidationProblems(modelValidation);
    console.log(`${modelValidation.errors.length} errores, ${modelValidation.warnings.length} avisos.`);
    return 1;
  }

  const scenarioPath = absolutePath(scenarioFile);
  const resolvedScenario = loadResolvedScenario(scenarioPath);
  if (comparablePath(modelPath) !== comparablePath(resolvedScenario.model)) {
    console.error(
      `lila run: el modelo posicional (${modelPath}) no coincide con scenario.model (${resolvedScenario.model}).`,
    );
    return 1;
  }

  const scenario: ResolvedScenario = {
    ...resolvedScenario,
    run: {
      ...resolvedScenario.run,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.replications === undefined ? {} : { replications: options.replications }),
    },
  };

  const unsupported = unsupportedM1(scenario);
  if (unsupported.length > 0) {
    for (const message of unsupported) console.error(`lila run: ${message}`);
    return 1;
  }

  const scenarioProblems = validateScenario(scenario, parsedModel.ir);
  const errors = scenarioErrors(scenarioProblems);
  if (errors.length > 0) {
    printScenarioProblems(scenarioProblems);
    return 1;
  }

  const logSink =
    options.csv === undefined ? undefined : openEventLogSink(options.csv, runStartMs(scenario.run.start));
  try {
    const simulated = simulate(parsedModel.ir, scenario, {
      log: logSink !== undefined,
      ...(logSink === undefined ? {} : { onEvent: (row: EventLogRow) => logSink.onEvent(row) }),
    });
    logSink?.close();
    const result = resultWithBoundaryWarnings(simulated, modelValidation, scenarioProblems);

    printRunResult(parsedModel.ir, scenario, result);
    if (options.json !== undefined) writeJson(options.json, result);
    if (options.csv !== undefined) {
      writeCsvDirectory(options.csv, parsedModel.ir, scenario, result);
      logSink?.commit();
      console.log(`CSV: ${absolutePath(options.csv)}`);
    }
    return 0;
  } catch (error) {
    logSink?.abort();
    throw error;
  }
}

function positionalError(command: 'validate' | 'run', expected: string): number {
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
    console.error(`lila: comando desconocido "${command}".`);
    console.error(USAGE);
    return 1;
  } catch (error) {
    console.error(`lila ${command}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
