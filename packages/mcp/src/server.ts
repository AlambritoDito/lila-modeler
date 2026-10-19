/**
 * Servidor MCP de Lila Modeler: tools sobre `@lila-modeler/engine`, sin lógica propia. `validate_bpmn` y
 * `describe_process` son de LILA-053; `run_simulation` y `compare_scenarios` de LILA-054, sobre
 * `@lila-modeler/engine/cli-shared` (extraído de `cli.ts` en el mismo ticket, sin cambiar su salida).
 * `createServer()` registra tools, resources y el prompt (#637); conectar un transporte (stdio, in-memory para tests) es
 * responsabilidad de quien lo use — ver `src/bin.ts` para el caso stdio real.
 *
 * Idioma (LILA-211, parte 2): `title`, `description` y los `.describe()` son **fijos en inglés**
 * —son la superficie del protocolo, la que un cliente ya leyó en `tools/list`, y un `locale` por
 * llamada no puede reescribirla—. Todo lo demás (el resumen de `describe_process`, los mensajes de
 * `isError` y los problemas que devuelve el motor) sale del catálogo: `createServer({ locale })`
 * fija el idioma por defecto del servidor y cada tool acepta `locale` para una llamada suelta.
 */
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { validateBpmnXml, type TargetingScenario, type ValidateBpmnReport, type ValidationResult } from '@lila-modeler/engine/bpmn';
import {
  absolutePath,
  comparablePath,
  compareWarnings,
  loadModelSource,
  loadResolvedScenario,
  loadValidatedModel,
  readJsonFile,
  resultWithBoundaryWarnings,
  scenarioSource,
  stageTarget,
  targetScenarios,
  validatedModelOf,
  withRunOverrides,
  writeBytesAtomic,
  writeJsonAtomic,
  type LoadedScenarioResult,
  type ParsedIr,
  type StagedFile,
  type ValidatedModel,
} from '@lila-modeler/engine/cli-shared';
import {
  applyJsonPatch,
  buildPatchDelta,
  createLilaProcess,
  editLilaProcess,
  isLilaPath,
  openLilaProcess,
  patchLilaScenario,
  readLilaOutline,
  sameScenario,
  validatePatchedScenario,
  withoutPhantomFile,
  withRelativeModel,
  exportDiagram,
  exportDocument,
  exportResults,
  saveSimulationRun,
  writeExportDirectory,
  writeExportFile,
  type JsonPatchOp,
  type LilaProcess,
} from '@lila-modeler/engine/project-fs';
import { runResultSchema } from '@lila-modeler/engine/result-schema';
import {
  resolveExtends,
  scenarioErrors,
  parseScenario,
  validateScenario,
  type ResolvedScenario,
  type Scenario,
  type ScenarioProblem,
} from '@lila-modeler/engine/schema';
import { compare, type CompareResult, type RunResult } from '@lila-modeler/engine';
import { compareWorkbook } from '@lila-modeler/engine/xlsx-report';
import { agentToolMessages, messages, resolveLocale, type Locale } from '@lila-modeler/engine/messages';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { registerAgentTools } from './agent-tools.js';
import { resolveScenarioInput, type ScenarioInput } from './scenario-input.js';
import { compareDetailSchema, detailSchema, runSummarySchema, summarizeComparison, summarizeRun, type Detail } from './result-summary.js';
import { registerResourcesAndPrompts } from './resources.js';
import { requestProgress, simulateInWorker, type RequestProgress } from './simulate-in-worker.js';

const NAME = 'lila-mcp';
const VERSION = '1.0.0-beta.28';

/** Idioma por llamada: sobrescribe el del servidor solo para esa respuesta. */
const localeSchema = z
  .enum(['en', 'es'])
  .optional()
  .describe('Language of the texts this call returns. Defaults to the server locale (LILA_LANG).');

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Los mensajes del catálogo son cuerpos; el nombre de la tool lo pone siempre quien llama. */
function toolMessage(tool: string, body: string): string {
  return `${tool}: ${body}`;
}

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
}

/**
 * `isError` marca que **la tool** falló (argumentos malos, archivo ilegible, XML impenetrable,
 * escenario inválido), no que el modelo tenga errores de validación en `validate_bpmn`: eso es un
 * resultado correcto y viaja en el JSON (`errors[]`). Ver `docs/MCP.md`.
 */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Lee un archivo del que ya se validó la existencia; devuelve el error legible si no se puede. */
function readModel(tool: string, file: string, locale: Locale): { xml: string } | { error: string } {
  const M = messages(locale).mcp;
  if (!existsSync(file)) return { error: toolMessage(tool, M.fileMissing(file)) };
  try {
    return { xml: readFileSync(file, 'utf8') };
  } catch (error) {
    return { error: toolMessage(tool, message(error)) };
  }
}

/**
 * Resuelve el par `path` | `xml` que aceptan `validate_bpmn` y `describe_process`: exactamente uno
 * de los dos, nunca los dos a la vez (pasar ambos sería una precedencia silenciosa sobre un modelo
 * que el usuario no pidió).
 */
async function modelXml(
  tool: string,
  path: string | undefined,
  xml: string | undefined,
  process: string | undefined,
  locale: Locale,
): Promise<{ xml: string; lila?: LilaProcess | undefined } | { error: string }> {
  const M = messages(locale).mcp;
  if (path !== undefined && xml !== undefined) {
    return { error: toolMessage(tool, M.bothPathAndXml()) };
  }
  // `process` selects a process of a `.lila` (#466); with a `.bpmn` or inline XML it is a mistake.
  if (process !== undefined && (path === undefined || !isLilaPath(path))) {
    return { error: toolMessage(tool, messages(locale).cli.processOnlyForLila()) };
  }
  if (xml !== undefined) return { xml };
  if (path !== undefined && isLilaPath(path)) {
    try {
      const source = await loadModelSource(path, { process, locale });
      return { xml: source.xml, lila: source.lila };
    } catch (error) {
      return { error: toolMessage(tool, message(error)) };
    }
  }
  if (path !== undefined) return readModel(tool, absolutePath(path), locale);
  return { error: toolMessage(tool, M.pathOrXml()) };
}

/**
 * The `.lila` named by `model` (#466), opened on `process`; `undefined` for a `.bpmn` or no model.
 * A `process` without a `.lila` model is refused instead of being ignored.
 */
async function lilaModel(
  model: string | undefined,
  process: string | undefined,
  locale: Locale,
): Promise<LilaProcess | undefined> {
  if (model !== undefined && isLilaPath(model)) return openLilaProcess(model, { process, locale });
  if (process !== undefined) throw new Error(messages(locale).cli.processOnlyForLila());
  return undefined;
}

const GATEWAY_TYPES = new Set(['xor', 'or', 'and', 'eventGateway']);

/** Resumen legible pedido por LILA-053: nodos, gateways, lanes, subprocesos, en `locale`. */
function describeIr(
  report: ValidateBpmnReport,
  resources: string[],
  scenarioError: string | undefined,
  locale: Locale,
): string {
  const catalog = messages(locale);
  const M = catalog.mcp;
  const C = catalog.cli;
  const { ir, ignoredProcessIds, errors, warnings } = report;
  const lines: string[] = [];
  lines.push(C.process(`${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`));

  const counts = new Map<string, number>();
  for (const node of Object.values(ir.nodes)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  lines.push('');
  lines.push(M.nodes(Object.keys(ir.nodes).length));
  for (const [type, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${M.nodeType(type)}: ${n}`);
  }

  const gatewayIds = Object.entries(ir.nodes).filter(([, node]) => GATEWAY_TYPES.has(node.type));
  if (gatewayIds.length > 0) {
    lines.push('');
    lines.push(M.gateways());
    for (const [id, node] of gatewayIds) {
      lines.push(`  ${id}${node.name === '' ? '' : ` (${node.name})`} [${node.type}]:`);
      for (const flowId of node.outgoing) {
        const flow = ir.flows[flowId];
        if (flow === undefined) continue;
        const mark = flow.isDefault ? `  ${C.defaultFlow()}` : '';
        lines.push(`    -> ${flow.to}${flow.name === '' ? '' : `  ${flow.name}`}${mark}`);
      }
    }
  }

  const lanes = new Map<string, string[]>();
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.lane === undefined) continue;
    (lanes.get(node.lane) ?? lanes.set(node.lane, []).get(node.lane))?.push(id);
  }
  if (lanes.size > 0) {
    lines.push('');
    lines.push(M.lanes());
    for (const [lane, ids] of lanes) lines.push(`  ${lane}: ${ids.join(', ')}`);
  }

  const subprocesses = new Map<string, string[]>();
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.subprocessId === undefined) continue;
    (subprocesses.get(node.subprocessId) ?? subprocesses.set(node.subprocessId, []).get(node.subprocessId))?.push(
      id,
    );
  }
  if (subprocesses.size > 0) {
    lines.push('');
    lines.push(M.embeddedSubprocesses());
    for (const [id, ids] of subprocesses) lines.push(`  ${id}: ${ids.join(', ')}`);
  }

  if (ignoredProcessIds.length > 0) {
    lines.push('');
    lines.push(C.otherProcesses(ignoredProcessIds.join(', ')));
  }

  // Un modelo fuera del perfil se describe igual, pero no se puede simular: decirlo aquí evita
  // que un agente encadene describe_process -> run_simulation sobre un modelo que no corre.
  lines.push('');
  const counted = `${M.errorCount(errors.length)}, ${M.warningCount(warnings.length)}`;
  lines.push(errors.length > 0 ? M.validationWithErrors(counted) : M.validation(counted));

  lines.push('');
  if (scenarioError !== undefined) {
    lines.push(M.referencedResourcesUnreadable(scenarioError));
  } else if (resources.length > 0) {
    lines.push(M.referencedResources());
    for (const line of resources) lines.push(`  ${line}`);
  } else {
    lines.push(M.referencedResourcesNone());
  }

  return lines.join('\n');
}

/** Referencias a recursos por elemento, a partir de un escenario ya resuelto (`extends` incluido). */
function resourceLines(scenario: Scenario): string[] {
  const lines: string[] = [];
  for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
    const refs = element.resources ?? [];
    if (refs.length === 0) continue;
    const parts = refs.map((use) => `${use.ref} x${use.quantity}`);
    lines.push(`${elementId}: ${parts.join(', ')}`);
  }
  return lines;
}

/** Recursos por elemento del escenario, o el motivo por el que no se pudo leer. */
function scenarioResources(
  file: string,
  locale: Locale,
  lila?: LilaProcess | undefined,
): { resources: string[]; scenario: TargetingScenario } | { error: string } {
  try {
    const source = scenarioSource(file, lila, locale);
    const raw = resolveExtends(source.path, source.read, locale);
    const parsed = parseScenario(raw, { locale });
    if (parsed.success) return { resources: resourceLines(parsed.data), scenario: parsed.data };
    // `$` para la raíz, igual que `schemaIssueLines` del motor: no es texto traducible.
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`)
      .join('; ');
    return { error: detail };
  } catch (error) {
    return { error: message(error) };
  }
}

/* ------------------------------------------------------------------ *
 * `run_simulation` / `compare_scenarios` (LILA-054)
 * ------------------------------------------------------------------ */

const scenarioInputSchema = z.union([
  z.string().describe('Path to a .json scenario, relative to the cwd of the server process.'),
  z.record(z.string(), z.unknown()).describe('The already resolved scenario, inline.'),
]);

interface RunSimulationInput {
  model?: string | undefined;
  process?: string | undefined;
  scenario: ScenarioInput;
  seed?: number | undefined;
  replications?: number | undefined;
  saveTo?: string | undefined;
  saveRun?: boolean | undefined;
  logTo?: string | undefined;
  detail?: Detail | undefined;
  locale?: Locale | undefined;
}

/**
 * Igual pipeline que `runCommand` de `cli.ts` (compartida en `@lila-modeler/engine/cli-shared`): valida
 * modelo y escenario, aplica overrides y simula con `log: false` (with `logTo`, #665, the event
 * log is streamed to that file instead). Ningún campo de nivel 2/3 se
 * rechaza (LILA-184): `resources` y `calendars` los simula el motor desde LILA-033…036 y LILA-041.
 * El `RunResult` devuelto es el mismo objeto que produce `lila run --json`.
 */
async function runSimulation(
  { model, process, scenario, seed, replications, saveTo, saveRun, logTo, detail }: RunSimulationInput,
  locale: Locale,
  progress: RequestProgress = requestProgress(undefined),
): Promise<CallToolResult> {
  const M = messages(locale).mcp;
  const fail = (body: string): CallToolResult => errorResult(toolMessage('run_simulation', body));

  let lila: LilaProcess | undefined;
  let resolved: ResolvedScenario;
  try {
    lila = await lilaModel(model, process, locale);
    resolved = resolveScenarioInput(scenario, locale, lila);
  } catch (error) {
    return fail(message(error));
  }
  // `saveRun` (#538) stores the run in the archive: it needs a `.lila` and one of its scenarios.
  if (saveRun === true && lila === undefined) return fail(messages(locale).cli.saveRunNeedsLila());
  if (saveRun === true && typeof scenario !== 'string') {
    return fail(messages(locale).cli.saveRunNeedsArchiveScenario(M.inlineScenario()));
  }

  const modelPath =
    lila !== undefined ? lila.modelPath : model === undefined ? resolved.model : absolutePath(model);
  if (model !== undefined && comparablePath(modelPath) !== comparablePath(resolved.model)) {
    return fail(M.modelMismatch(modelPath, resolved.model));
  }

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  let elsewhere: ValidatedModel['elsewhere'];
  try {
    // #546: the process the scenario targets is the one simulated.
    ({ ir, validation: modelValidation, elsewhere } =
      lila === undefined
        ? await loadValidatedModel(modelPath, locale, { scenarios: [resolved] })
        : await validatedModelOf({ path: lila.modelPath, xml: lila.process.model.xml, lila }, locale, [resolved]));
  } catch (error) {
    return fail(message(error));
  }
  if (modelValidation.errors.length > 0) {
    return fail(M.modelInvalid(JSON.stringify(modelValidation.errors)));
  }

  const withOverrides = withRunOverrides(resolved, { seed, replications });
  const scenarioProblems = validateScenario(withOverrides, ir, { locale, elsewhere });
  const scenarioIssues = scenarioErrors(scenarioProblems);
  if (scenarioIssues.length > 0) return fail(M.scenarioInvalid(JSON.stringify(scenarioIssues)));

  // #665: the log never replaces a file this call reads or writes (the model, the `.lila`, the
  // scenario, `saveTo`).
  if (logTo !== undefined) {
    const taken = [lila?.file ?? modelPath];
    if (typeof scenario === 'string') taken.push(absolutePath(scenario));
    if (saveTo !== undefined) taken.push(absolutePath(saveTo));
    const target = absolutePath(logTo);
    // macOS volumes ignore case and Unicode normalization by default: `Run.json` and `run.json` are one file there.
    const key = (file: string): string =>
      globalThis.process.platform === 'darwin' ? comparablePath(file).normalize('NFC').toLowerCase() : comparablePath(file);
    if (taken.some((file) => key(file) === key(target))) return fail(M.logToTaken(target));
  }

  // #665: the log is staged here, before the run, so that whatever ends this call (an error, the
  // client's cancellation) the temporary file is removed. It is published last, once `saveTo` and
  // `saveRun` succeeded: a call that fails leaves no log behind.
  let log: StagedFile | undefined;
  try {
    if (logTo !== undefined) log = stageTarget(logTo, locale);
    // #637: in a worker, with a progress notification per replication and the request's cancellation.
    const simulated = await simulateInWorker(
      { ir, scenario: withOverrides, locale, logDescriptor: log?.descriptor },
      { signal: progress.signal, onReplication: progress.report },
    );
    const result = resultWithBoundaryWarnings(simulated, modelValidation, scenarioProblems);
    // A cancellation that arrives once the worker is done still saves nothing (docs/MCP.md). This is
    // the only cut-off: past it, `saveTo`, `saveRun` and the log are written together.
    progress.signal?.throwIfAborted();

    if (saveTo !== undefined) writeJsonAtomic(saveTo, result, locale);

    // #629: the answer is a summary unless `detail: "full"`; what is saved above is always the full result.
    const answer = detail === 'full' ? result : summarizeRun(result, ir, withOverrides);
    const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(answer, null, 2) }];
    // The `RunResult` stays the structured content (its `outputSchema`); where the log and the run
    // went is a second text block.
    const written: { log?: string; savedRun?: Awaited<ReturnType<typeof saveSimulationRun>> } = {};
    if (log !== undefined) written.log = log.target;
    if (saveRun === true) {
      written.savedRun = await saveSimulationRun(lila!, scenario as string, withOverrides, result, locale);
    }
    log?.commit();
    if (Object.keys(written).length > 0) content.push({ type: 'text', text: JSON.stringify(written, null, 2) });
    return { content, isError: false, structuredContent: answer };
  } catch (error) {
    return fail(message(error));
  } finally {
    // Removes the temporary file unless `commit` already published it.
    log?.abort();
  }
}

interface CompareScenariosInput {
  model?: string | undefined;
  process?: string | undefined;
  scenarios: ScenarioInput[];
  seed?: number | undefined;
  replications?: number | undefined;
  saveTo?: string | undefined;
  format?: 'json' | 'xlsx' | undefined;
  all?: boolean | undefined;
  detail?: Detail | undefined;
  locale?: Locale | undefined;
}

/** Etiqueta de un escenario en los mensajes de error: su ruta, o su posición si vino inline. */
function scenarioLabel(entry: ScenarioInput, index: number): string {
  return typeof entry === 'string' ? entry : `scenarios[${index}]`;
}

/**
 * Igual pipeline que `compareCommand` de `cli.ts`: todo escenario se resuelve y valida contra el
 * mismo modelo antes de simular ninguno (un escenario inválido en la posición n no cuesta simular
 * los n − 1 anteriores). El `CompareResult` devuelto es el mismo objeto que produce
 * `lila compare --json`; los avisos que la CLI imprime aparte de la tabla (semillas distintas,
 * `baseTimeUnit` distinto, réplicas insuficientes) van en `notes`, sin tocar `comparison`.
 * With `format: "xlsx"` (#665), `saveTo` gets the workbook of `lila compare --xlsx`; `all: true` is
 * the name of `--all` for `detail: "full"`, since the full comparison already has every row.
 */
async function compareScenarios(
  { model, process, scenarios, seed, replications, saveTo, format, all: allRows, detail }: CompareScenariosInput,
  locale: Locale,
  progress: RequestProgress = requestProgress(undefined),
): Promise<CallToolResult> {
  const M = messages(locale).mcp;
  const fail = (body: string): CallToolResult => errorResult(toolMessage('compare_scenarios', body));
  if (scenarios.length < 2) return fail(M.atLeastTwoScenarios());
  if (format === 'xlsx' && saveTo === undefined) return fail(M.xlsxNeedsSaveTo());
  if (allRows === true && detail === 'summary') return fail(M.allWithSummary());

  let lila: LilaProcess | undefined;
  try {
    lila = await lilaModel(model, process, locale);
  } catch (error) {
    return fail(message(error));
  }

  const resolved: Array<{ label: string; scenario: ResolvedScenario }> = [];
  for (const [index, entry] of scenarios.entries()) {
    const label = scenarioLabel(entry, index);
    try {
      resolved.push({ label, scenario: resolveScenarioInput(entry, locale, lila) });
    } catch (error) {
      return fail(`${label}: ${message(error)}`);
    }
  }

  const referenceModel =
    lila !== undefined
      ? lila.modelPath
      : model === undefined
        ? resolved[0]!.scenario.model
        : absolutePath(model);
  for (const { label, scenario } of resolved) {
    if (comparablePath(referenceModel) !== comparablePath(scenario.model)) {
      return fail(`${label}: ${M.modelMismatch(referenceModel, scenario.model)}`);
    }
  }

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  let elsewhere: ValidatedModel['elsewhere'];
  const all = resolved.map(({ scenario }) => scenario);
  try {
    ({ ir, validation: modelValidation, elsewhere } =
      lila === undefined
        ? await loadValidatedModel(referenceModel, locale, { scenarios: all })
        : await validatedModelOf({ path: lila.modelPath, xml: lila.process.model.xml, lila }, locale, all));
  } catch (error) {
    return fail(message(error));
  }
  if (modelValidation.errors.length > 0) {
    return fail(M.modelInvalid(JSON.stringify(modelValidation.errors)));
  }

  // Todo se valida antes de simular nada, igual que `compareCommand`.
  const validated: Array<{ label: string; scenario: ResolvedScenario; problems: readonly ScenarioProblem[] }> = [];
  for (const { label, scenario } of resolved) {
    const withOverrides = withRunOverrides(scenario, { seed, replications });
    const problems = validateScenario(withOverrides, ir, { locale, elsewhere });
    const issues = scenarioErrors(problems);
    if (issues.length > 0) return fail(`${label}: ${M.scenarioInvalid(JSON.stringify(issues))}`);
    validated.push({ label, scenario: withOverrides, problems });
  }

  // #637: one worker per scenario, in order; progress counts the replications of all of them.
  const loaded: LoadedScenarioResult[] = [];
  const total = validated.reduce((sum, { scenario }) => sum + (scenario.run.replications ?? 1), 0);
  let done = 0;
  try {
    for (const { label, scenario, problems } of validated) {
      const simulated = await simulateInWorker(
        { ir, scenario, locale },
        { signal: progress.signal, onReplication: (completed) => progress.report(done + completed, total) },
      );
      done += scenario.run.replications ?? 1;
      loaded.push({ file: label, scenario, result: resultWithBoundaryWarnings(simulated, modelValidation, problems) });
    }
  } catch (error) {
    return fail(message(error));
  }

  let comparison: CompareResult;
  try {
    comparison = compare(loaded.map((entry) => entry.result), { locale });
  } catch (error) {
    // E-COMPARE-VACIO u otro error de `compare()`: no debería pasar tras el check de arriba, pero
    // se atrapa igual para no tumbar el servidor (mismo criterio que #53).
    return fail(message(error));
  }

  const notes = compareWarnings(loaded, loaded[0]!.scenario.run.baseTimeUnit, locale);

  if (saveTo !== undefined) {
    try {
      if (format === 'xlsx') writeBytesAtomic(saveTo, compareWorkbook(ir, loaded, comparison, locale), locale);
      else writeJsonAtomic(saveTo, comparison, locale);
    } catch (error) {
      return fail(message(error));
    }
  }

  const full = detail === 'full' || allRows === true;
  const payload = { comparison: full ? comparison : summarizeComparison(comparison), notes };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false, structuredContent: payload };
}

/* ------------------------------------------------------------------ *
 * `patch_scenario` (LILA-055)
 * ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON at `file`, or `undefined` when there is none or it cannot be read (it is then written over). */
function existingJson(file: string, locale: Locale): unknown {
  try {
    return existsSync(file) ? readJsonFile(file, locale) : undefined;
  } catch {
    return undefined;
  }
}

interface PatchScenarioInput {
  scenario: string;
  project?: string | undefined;
  process?: string | undefined;
  patch: JsonPatchOp[];
  saveTo?: string | undefined;
  extendsFrom?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  dryRun?: boolean | undefined;
  locale?: Locale | undefined;
}

/**
 * Dos modos (LILA-055): sin `saveTo`, parchea `scenario` en sitio (escenario resuelto completo,
 * sin `extends`: el patch se aplica sobre el escenario ya fusionado). Con `saveTo`, crea un
 * archivo nuevo que declara `extends: extendsFrom` (por defecto, el propio `scenario`) y contiene
 * solo el delta del patch — como `to-be-3-cajeros.scenario.json`. En ambos casos, solo se escribe
 * si el escenario resultante valida contra el modelo; nunca dos veces (primero se valida, después
 * se escribe una única vez). With `project`, the engine's `patchLilaScenario` does it inside the
 * `.lila` (#635: the same function as `lila scenario patch`). `dryRun` validates and writes nothing.
 */
async function patchScenario(input: PatchScenarioInput, locale: Locale): Promise<CallToolResult> {
  const fail = (body: string): CallToolResult => errorResult(toolMessage('patch_scenario', body));
  if (input.project !== undefined) {
    if (!isLilaPath(input.project)) return fail(messages(locale).mcp.projectNotLila(input.project));
    try {
      return textResult(await patchLilaScenario({ ...input, file: input.project, locale }));
    } catch (error) {
      return fail(message(error));
    }
  }
  if (input.process !== undefined) return fail(messages(locale).cli.processOnlyForLila());
  const { scenario, patch, saveTo, extendsFrom, name, description } = input;
  const dryRun = input.dryRun === true;
  const M = messages(locale).mcp;
  const scenarioPath = absolutePath(scenario);
  let base: ResolvedScenario;
  try {
    base = loadResolvedScenario(scenarioPath, undefined, locale);
  } catch (error) {
    return fail(message(error));
  }

  let patchedRaw: unknown;
  try {
    patchedRaw = applyJsonPatch(base, patch, locale);
  } catch (error) {
    return fail(message(error));
  }

  if (saveTo === undefined) {
    // Modo (a): patchear en sitio.
    if (isPlainObject(patchedRaw)) {
      if (name !== undefined) patchedRaw.name = name;
      if (description !== undefined) patchedRaw.description = description;
    }
    const outcome = await validatePatchedScenario(patchedRaw, locale);
    if (!outcome.ok) return fail(outcome.error);
    if (sameScenario(outcome.scenario, base)) {
      return textResult({ scenario: outcome.scenario, file: scenarioPath, written: false, dryRun, notes: [M.patchNoChange(), ...outcome.notes] });
    }
    if (dryRun) {
      return textResult({ scenario: outcome.scenario, file: scenarioPath, written: false, dryRun, notes: [agentToolMessages(locale).patchDryRun(scenarioPath), ...outcome.notes] });
    }
    try {
      const file = writeJsonAtomic(
        scenarioPath,
        withRelativeModel(outcome.scenario, scenarioPath),
        locale,
      );
      return textResult({ scenario: outcome.scenario, file, written: true, dryRun, notes: outcome.notes });
    } catch (error) {
      return fail(message(error));
    }
  }

  // Modo (b): archivo nuevo con `extends` al padre, solo el delta del patch.
  if (!isPlainObject(patchedRaw)) return fail(M.patchNotAnObject());
  const saveToPath = absolutePath(saveTo);
  const extendsFromPath = absolutePath(extendsFrom ?? scenario);
  const relExtends = posix.relative(posix.dirname(saveToPath), extendsFromPath);
  const delta = buildPatchDelta(patch, patchedRaw, locale);

  const candidate: Record<string, unknown> = { version: base.version, extends: relExtends, ...delta };
  candidate['name'] =
    name ?? (typeof delta['name'] === 'string' ? delta['name'] : M.patchedName(base.name));
  if (description !== undefined) candidate['description'] = description;

  let resolvedCandidate: ResolvedScenario;
  try {
    resolvedCandidate = loadResolvedScenario(
      saveToPath,
      (file) => (file === saveToPath ? candidate : readJsonFile(file, locale)),
      locale,
    );
  } catch (error) {
    return fail(withoutPhantomFile(error, saveToPath, locale));
  }

  const outcome = await validatePatchedScenario(resolvedCandidate, locale);
  if (!outcome.ok) return fail(outcome.error);
  if (sameScenario(existingJson(saveToPath, locale), candidate)) {
    return textResult({ scenario: outcome.scenario, file: saveToPath, written: false, dryRun, notes: [M.patchSameTarget(saveToPath), ...outcome.notes] });
  }
  if (dryRun) {
    return textResult({ scenario: outcome.scenario, file: saveToPath, written: false, dryRun, notes: [agentToolMessages(locale).patchDryRun(saveToPath), ...outcome.notes] });
  }

  try {
    const file = writeJsonAtomic(saveToPath, candidate, locale);
    return textResult({ scenario: outcome.scenario, file, written: true, dryRun, notes: outcome.notes });
  } catch (error) {
    return fail(message(error));
  }
}

/** Opciones de arranque comunes a `createServer` y `startStdioServer`. */
export interface ServerOptions {
  /** Idioma por defecto de las respuestas; cada llamada puede pedir otro con `locale`. */
  locale?: Locale | undefined;
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });
  // El idioma del servidor: lo que pidió `lila mcp --lang`/`LILA_LANG`, o inglés.
  const fallbackLocale: Locale = options.locale ?? 'en';
  const localeOf = (locale: Locale | undefined): Locale => locale ?? fallbackLocale;

  server.registerTool(
    'validate_bpmn',
    {
      title: 'Validate BPMN',
      description:
        'Parses and validates a .bpmn file or one process of a .lila project (by path or inline ' +
        'XML, one of the two) and returns the ' +
        'same JSON as `lila validate --json`: the IR, the ignored processes, and structured ' +
        'errors/warnings. A model with a non-empty `errors` cannot be simulated, but that is a ' +
        'valid result of the tool: isError only marks that the tool failed (bad arguments, ' +
        'unreadable file, impenetrable XML).',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Path to the .bpmn or .lila, relative to the cwd of the server process.'),
        xml: z.string().optional().describe('XML content of the .bpmn, instead of a path.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process when the .lila holds several; implicit when it holds one.'),
        locale: localeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ path, xml, process, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      const read = await modelXml('validate_bpmn', path, xml, process, language);
      if ('error' in read) return errorResult(read.error);

      try {
        // #546: in a `.lila`, the process its scenarios target, as `run_simulation` simulates it.
        return textResult(await validateBpmnXml(read.xml, { locale: language, scenarios: targetScenarios(read.lila) }));
      } catch (error) {
        return errorResult(toolMessage('validate_bpmn', message(error)));
      }
    },
  );

  server.registerTool(
    'describe_process',
    {
      title: 'Describe process',
      description:
        'Parses a .bpmn or one process of a .lila (by path or inline XML, one of the two) and ' +
        'returns its IR (ProcessIR) ' +
        'together with a readable summary (the `resumen` key): node count by type, gateways with ' +
        'their outgoing flows, lanes, subprocesses, other processes in the file and whether the ' +
        'model passes validation. With the optional `scenario` (path to a .json scenario, resolves ' +
        '`extends`; with a .lila, also the name of a scenario of that process) it adds the ' +
        'resources referenced by element.',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Path to the .bpmn or .lila, relative to the cwd of the server process.'),
        xml: z.string().optional().describe('XML content of the .bpmn, instead of a path.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process when the .lila holds several; implicit when it holds one.'),
        scenario: z
          .string()
          .optional()
          .describe('Path to a .json scenario, relative to the cwd; with a .lila, or a scenario name in it.'),
        locale: localeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ path, xml, process, scenario, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      const read = await modelXml('describe_process', path, xml, process, language);
      if ('error' in read) return errorResult(read.error);

      const scenarioResult = scenario === undefined ? undefined : scenarioResources(scenario, language, read.lila);
      // #546: the process described is the one the scenarios target, as `run_simulation` runs it.
      const given = scenarioResult !== undefined && 'scenario' in scenarioResult ? [scenarioResult.scenario] : [];
      let report: ValidateBpmnReport;
      try {
        report = await validateBpmnXml(read.xml, { locale: language, scenarios: targetScenarios(read.lila, given) });
      } catch (error) {
        return errorResult(toolMessage('describe_process', message(error)));
      }

      const resources = scenarioResult !== undefined && 'resources' in scenarioResult ? scenarioResult.resources : [];
      const scenarioError = scenarioResult !== undefined && 'error' in scenarioResult ? scenarioResult.error : undefined;

      // `resumen` es el nombre de la clave desde LILA-053 y es contrato documentado
      // (`docs/MCP.md`): no se renombra al traducir, solo cambia el idioma de su contenido.
      return textResult({ ir: report.ir, resumen: describeIr(report, resources, scenarioError, language) });
    },
  );

  server.registerTool(
    'run_simulation',
    {
      title: 'Run simulation',
      description:
        'Validates model and scenario, simulates and returns the same `RunResult` ' +
        'as `lila run --json` (elements, flows, resources, process, bottlenecks and warnings). ' +
        '`scenario` accepts a .json path (resolves `extends`) or the already resolved scenario as an ' +
        'inline object. `model` may be a .lila project: `scenario` is then also the name of a ' +
        'scenario of that process (a .json path that exists wins), and `process` picks the process ' +
        'when there are several. `saveTo` writes the same JSON atomically, like `lila run --json <path>`; ' +
        '`saveRun` stores the run in the .lila, like `lila run --save`. `logTo` streams the event log ' +
        'to a CSV file, the same bytes as the `log.csv` of `lila run --csv`, published only after a ' +
        'complete run. A second content block returns where the log and the run went. ' +
        'By default the answer is a summary (`detail: "summary"`: process, bottlenecks, per-resource ' +
        'utilization/wait/cost, `topWaits`, grouped warnings); `detail: "full"` returns the whole ' +
        '`RunResult`. `saveTo` and `saveRun` always store the full result. ' +
        'isError only marks that the tool failed (invalid model/scenario, unreadable file).',
      inputSchema: z.object({
        model: z.string().optional().describe('Path to the .bpmn or .lila; defaults to scenario.model.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process when the .lila holds several; implicit when it holds one.'),
        scenario: scenarioInputSchema,
        seed: z.number().int().optional().describe('Overrides run.seed.'),
        replications: z.number().int().min(1).optional().describe('Overrides run.replications.'),
        saveTo: z.string().optional().describe('Path to write the RunResult as JSON.'),
        saveRun: z
          .boolean()
          .optional()
          .describe(
            'With a .lila `model` and a scenario of it: store the run in the project, as the app does ' +
              '(it opens as the current run; export_document/export_results use it). A second content ' +
              'block returns { savedRun: { id, file, process, scenario } } (with `logTo`, { log, savedRun }).',
          ),
        logTo: z
          .string()
          .optional()
          .describe(
            'Path of a CSV file for the event log, as the log.csv of `lila run --csv`. Written only after ' +
              'a complete run; the second content block returns { log: <absolute path> } (with `saveRun`, { log, savedRun }).',
          ),
        detail: detailSchema,
        locale: localeSchema,
      }),
      outputSchema: z.union([runSummarySchema, runResultSchema]),
    },
    async (input, ctx: ServerContext): Promise<CallToolResult> => runSimulation(input, localeOf(input.locale), requestProgress(ctx)),
  );

  server.registerTool(
    'compare_scenarios',
    {
      title: 'Compare scenarios',
      description:
        'Validates and simulates two or more scenarios on the same model (the first one is the ' +
        'base) and returns the same `CompareResult` as `lila compare --json`, plus `notes`: the ' +
        'warnings the CLI prints beside the table (different seeds, different `baseTimeUnit`, too ' +
        'few replications for a 95% CI). `scenarios` accepts .json paths and inline objects, mixed; ' +
        'with a .lila `model`, also scenario names of that process (`process` picks it). ' +
        '`saveTo` writes `comparison` as JSON, like `lila compare --json`, or with `format: "xlsx"` the ' +
        'workbook of `lila compare --xlsx`. By default `comparison` is a ' +
        'summary (`detail: "summary"`: the process and resource rows plus every row marked significant, ' +
        'and `omittedRows`); `detail: "full"` (or `all: true`, the name of `lila compare --all`) returns ' +
        'every row. `saveTo` always writes the full comparison.',
      inputSchema: z.object({
        model: z
          .string()
          .optional()
          .describe('Path to the .bpmn or .lila; defaults to the model of the first scenario.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process when the .lila holds several; implicit when it holds one.'),
        // Sin `.min(2)`: así el mensaje lo da `compareScenarios` en el idioma pedido, no el
        // validador del SDK, que solo habla inglés.
        scenarios: z.array(scenarioInputSchema),
        seed: z.number().int().optional().describe('Overrides run.seed in every scenario.'),
        replications: z.number().int().min(1).optional().describe('Overrides run.replications in every scenario.'),
        saveTo: z.string().optional().describe('Path to write the CompareResult as JSON, or the workbook with format "xlsx".'),
        format: z
          .enum(['json', 'xlsx'])
          .optional()
          .describe('What saveTo writes: "json" (default) or "xlsx", the workbook of `lila compare --xlsx`. "xlsx" needs saveTo.'),
        all: z
          .boolean()
          .optional()
          .describe('Every row, like `lila compare --all`: the same as detail "full"; refused with detail "summary".'),
        detail: compareDetailSchema,
        locale: localeSchema,
      }),
    },
    async (input, ctx: ServerContext): Promise<CallToolResult> => compareScenarios(input, localeOf(input.locale), requestProgress(ctx)),
  );

  server.registerTool(
    'patch_scenario',
    {
      title: 'Patch scenario',
      description:
        'Applies a JSON Patch (RFC 6902; only add/replace/remove/test, no move/copy) to a scenario, ' +
        'validates the result against its model and writes it to disk only if it validates. Without ' +
        '`saveTo` it patches `scenario` in place (the full resolved scenario, without `extends`). ' +
        'With `saveTo` it creates a new file with `extends` towards `extendsFrom` (by default, ' +
        '`scenario` itself) and only the keys the patch touched — like ' +
        '`to-be-3-cajeros.scenario.json`. Returns the resulting resolved scenario, the path written, ' +
        '`written` and `notes` with the lint warnings. A patch that changes nothing (only `test`, or ' +
        'the target already holds the result) writes nothing: `written: false`, the scenario keeps its ' +
        'revision and its saved runs stay current. A patch that leaves the scenario invalid (`probability` ' +
        'outside `[0,1]`, `capacity` < 1, a `ref` that does not exist in `resources`, …) is rejected ' +
        'without writing anything. With `project` (a .lila), `scenario`, `extendsFrom` and `saveTo` ' +
        'are scenario names inside that process, and the archive is rewritten atomically with every ' +
        'other process unchanged. `dryRun: true` validates and writes nothing. Like `lila scenario ' +
        'patch` (for a .lila).',
      inputSchema: z.object({
        scenario: z
          .string()
          .describe('Path to the .json scenario to read and patch, relative to the cwd; with `project`, its name.'),
        project: z
          .string()
          .optional()
          .describe('Path to a .lila: patch a scenario inside it instead of a .json on disk.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process of `project` when it holds several; implicit when it holds one.'),
        patch: z
          .array(
            z.object({
              op: z.string().describe('add | replace | remove | test (move/copy are not supported).'),
              path: z.string().describe('RFC 6901 pointer, e.g. "/resources/cajero/capacity".'),
              value: z.unknown().optional().describe('Required by add/replace/test.'),
              from: z.string().optional().describe('Unused: move/copy are not implemented.'),
            }),
          )
          .min(1),
        saveTo: z
          .string()
          .optional()
          .describe('Absent: writes over `scenario`. Present: creates a new scenario with `extends` there.'),
        extendsFrom: z
          .string()
          .optional()
          .describe('Parent of the `extends` of the new file (only with `saveTo`). Defaults to `scenario`.'),
        name: z.string().optional().describe('Name of the resulting scenario; defaults to a generated one.'),
        description: z.string().optional().describe('Description of the resulting scenario.'),
        dryRun: z.boolean().optional().describe('Validate everything and write nothing (`written: false`). Default false.'),
        locale: localeSchema,
      }),
    },
    async (input): Promise<CallToolResult> => patchScenario(input, localeOf(input.locale)),
  );

  // App-free exports (#538): thin layers over `@lila-modeler/engine/project-fs`, like `lila export`.
  const processSchema = z
    .string()
    .optional()
    .describe('Slug of the process when the .lila holds several; implicit when it holds one.');
  const runSchema = z
    .string()
    .optional()
    .describe('A stored run id, or "latest" (default): the run of the current model and scenario.');
  const scenarioSchema = z
    .string()
    .optional()
    .describe('With "latest", the run of this scenario (needed when several scenarios have one).');
  const overwriteSchema = z.boolean().optional().describe('Replace an existing file. Default false: existing files are never overwritten.');

  server.registerTool(
    'export_diagram',
    {
      title: 'Export diagram',
      description:
        'Draws the diagram of a .bpmn, or of one process of a .lila, as SVG with the engine\'s own ' +
        'renderer (no app, no browser): the BPMN DI geometry in the Lila Light colours on white. ' +
        'With `overlay`, coloured with a stored run of the .lila (`run`/`scenario` select it as in ' +
        '`export_document`) on the app\'s scale: "bottlenecks" tints the canvas\'s bottleneck cut, ' +
        '"heatmap" every measured task as the Results heat map does; `run` in the answer says which. ' +
        'Without `saveTo` the SVG comes back in `svg`; with it, it is written atomically and `file` ' +
        'is the absolute path. Like `lila export diagram`.',
      inputSchema: z.object({
        project: z.string().optional().describe('Path to a .lila, relative to the cwd of the server process.'),
        path: z.string().optional().describe('Path to a .bpmn (or .lila), instead of `project`.'),
        process: processSchema,
        overlay: z
          .enum(['bottlenecks', 'heatmap'])
          .optional()
          .describe('Colour the diagram with a stored run (needs a .lila with one): the bottleneck cut or the heat map.'),
        run: runSchema,
        scenario: scenarioSchema,
        saveTo: z.string().optional().describe('Path of the .svg to write.'),
        overwrite: overwriteSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, path, process, overlay, run, scenario, saveTo, overwrite, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      const M = messages(language).mcp;
      if (project !== undefined && path !== undefined) return errorResult(toolMessage('export_diagram', M.bothProjectAndPath()));
      const file = project ?? path;
      if (file === undefined) return errorResult(toolMessage('export_diagram', M.projectOrPath()));
      try {
        const exported = await exportDiagram({ file, process, overlay, run, scenario, locale: language });
        const { svg, process: slug, file: source } = exported;
        // `run` only with an overlay, so the answer without one is as before.
        const used = exported.run === undefined ? {} : { run: exported.run };
        if (saveTo === undefined) return textResult({ process: slug ?? null, ...used, svg });
        return textResult({ process: slug ?? null, ...used, file: writeExportFile(saveTo, svg, { overwrite, source, locale: language }) });
      } catch (error) {
        return errorResult(toolMessage('export_diagram', message(error)));
      }
    },
  );

  server.registerTool(
    'create_process',
    {
      title: 'Create process',
      description:
        'Creates a process from an outline — lanes plus an ordered list of steps with branches — ' +
        'laid out automatically (pool, lanes, flows) and validated, and writes it as a new ' +
        '`processes/<slug>/` of the .lila `project`, or as a new .lila when the file does not exist. ' +
        'It never replaces an existing process: a slug already in the file is an error and nothing ' +
        'is written. List order is the flow: each step follows the previous one unless it has ' +
        '`next`, `branches` or `end`. End events are added, and one start before the first step ' +
        'unless `starts` lists them (several, or a timer start; steps name theirs with `from`). ' +
        'Step ids become the BPMN ids. Also: terminate ends (`end: "terminate"`), default flows, ' +
        'the task variants, boundary timers (deadlines and escalations, `boundary`) and the event ' +
        'gateway (`eventGateway` → `message` | `timer` steps). The process gets a base scenario ' +
        '`as-is.scenario.json` with arrivals (each start brings its own stream of cases) and every ' +
        '`duration`, `resources` and branch `probability` given; the delay of a timer, message or ' +
        'boundary step is its `duration`. Its run lasts 1 h: raise `run.duration` with ' +
        '`patch_scenario` before simulating longer timers (e.g. a 48 h deadline). Returns the slug, the outline as ' +
        'stored (normal form), the validator warnings and a one-line `summary`. With `dryRun`, ' +
        'builds and checks everything and writes nothing.',
      inputSchema: z.object({
        // A plain object on purpose (QA of #553): a strict schema here would let the SDK reject the
        // call before the handler, in English and one problem at a time. `createLilaProcess` checks
        // everything in one pass, in the call's language, with `steps[i].field` paths.
        outline: z
          .record(z.string(), z.unknown())
          .describe(
            'The process: {name, lanes?: [lane names], starts?: [{id, name?, type? (none | timer), lane?}], ' +
              'steps: [{id, name?, lane?, type? (task | userTask | serviceTask | sendTask | receiveTask | ' +
              'manualTask | scriptTask | businessRuleTask | callActivity | xor | and | or | eventGateway | ' +
              'timer | message | subprocess), from? (start id or ids, with starts), next? (id or ids), ' +
              'branches? (gateways: [{label?, to | end: true | "terminate", probability? (xor/or), default? ' +
              '(xor/or)}]; an eventGateway\'s go to timer or message steps), end?: true | "terminate", ' +
              'duration? ("20m", "normal(20m, 5m)", seconds or a distribution object), resources? ([name | ' +
              '{name, quantity}]), selection? ("and" | "or"), boundary? (tasks and call activities: [{id, ' +
              'type: "timer", name?, label?, duration?, interrupting? (default true), to | end}]), notes? ' +
              '([text]: text annotations), data? (activities: [{name, direction: "in" | "out"}]: data objects ' +
              'by name, shared)}]}. ' +
              'List order is the flow. See docs/MCP.md.',
          ),
        project: z.string().describe('Path to the .lila (created if missing), relative to the cwd of the server process.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the new process folder in an existing .lila. Defaults to one derived from the name.'),
        name: z.string().optional().describe('Name of the process; defaults to outline.name.'),
        dryRun: z.boolean().optional().describe('true: build and validate, write nothing.'),
        locale: localeSchema,
      }),
    },
    async ({ outline, project, process, name, dryRun, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      try {
        const created = await createLilaProcess(project, outline, { process, name, dryRun, locale: language });
        return textResult(created);
      } catch (error) {
        return errorResult(toolMessage('create_process', message(error)));
      }
    },
  );

  server.registerTool(
    'export_document',
    {
      title: 'Export process document',
      description:
        'Writes the process document of one process of a .lila, like the app\'s Export document: ' +
        'diagram, element descriptions in flow order, the scenario and the results of a stored run. ' +
        '`run` "latest" (default) takes the run of the current model and scenario, and the document ' +
        'goes without results when there is none; an older run is refused. `format` docx or html; ' +
        'the HTML embeds the SVG diagram and the run\'s charts as SVG (no cycle time histogram: a ' +
        'stored run keeps no per-case times); the Word file has neither (no rasteriser). `notes` says ' +
        'what was left out. Like `lila export doc`.',
      inputSchema: z.object({
        project: z.string().describe('Path to the .lila, relative to the cwd of the server process.'),
        process: processSchema,
        run: runSchema,
        scenario: scenarioSchema,
        format: z.enum(['docx', 'html']),
        saveTo: z.string().describe('Path of the .docx or .html to write.'),
        overwrite: overwriteSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, process, run, scenario, format, saveTo, overwrite, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      try {
        const doc = await exportDocument({ file: project, process, run, scenario, format, locale: language });
        const file = writeExportFile(saveTo, doc.data, { overwrite, source: doc.file, locale: language });
        return textResult({ file, format, project: doc.file, process: doc.process, run: doc.run, notes: doc.notes });
      } catch (error) {
        return errorResult(toolMessage('export_document', message(error)));
      }
    },
  );

  server.registerTool(
    'export_results',
    {
      title: 'Export results',
      description:
        'Writes the results of a run stored in a .lila, like `lila run --xlsx`/`--csv`: `xlsx` is ' +
        'one workbook (Summary, Elements, Flows, Resources, Parameters, Percentiles) at `saveTo`; ' +
        '`csv` writes elements, flows, resources, process and percentiles .csv into the directory ' +
        '`saveTo`. Percentiles are the p50/p90/p95 resource wait per element in seconds, over all ' +
        'replications, from simulating the run\'s stored inputs again (a stored run keeps no event ' +
        'log); `percentiles.included` is false, with a `note`, when that re-run does not reproduce ' +
        'the stored process KPIs. `run` "latest" (default) is the run of the current model and ' +
        'scenario; an older run is exported by id against the model it ran on. An error says so ' +
        'when the process has no run. Like `lila export results`.',
      inputSchema: z.object({
        project: z.string().describe('Path to the .lila, relative to the cwd of the server process.'),
        process: processSchema,
        run: runSchema,
        scenario: scenarioSchema,
        format: z.enum(['xlsx', 'csv']),
        saveTo: z.string().describe('Path of the .xlsx, or the directory for the CSV files.'),
        overwrite: overwriteSchema,
        locale: localeSchema,
      }),
    },
    async ({ project, process, run, scenario, format, saveTo, overwrite, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      try {
        const results = await exportResults({ file: project, process, run, scenario, format, locale: language });
        const files = results.data instanceof Uint8Array
          ? [writeExportFile(saveTo, results.data, { overwrite, source: results.file, locale: language })]
          : writeExportDirectory(saveTo, results.data, { overwrite, source: results.file, locale: language });
        return textResult({ files, format, project: results.file, process: results.process, run: results.run, percentiles: results.percentiles });
      } catch (error) {
        return errorResult(toolMessage('export_results', message(error)));
      }
    },
  );

  server.registerTool(
    'get_process_outline',
    {
      title: 'Get process outline',
      description:
        'Reads one process of a .lila as an outline (the format `create_process` takes, in normal ' +
        'form: every step names its lane, `next` only when it is not the following step, `end: ' +
        'true` (or "terminate") where the process ends, `starts` unless there is one plain start ' +
        '`StartEvent`, durations as scenario distributions in seconds). Boundary timers, event ' +
        'gateways, default flows, the task variants, text annotations (`notes`) and data objects (`data`) ' +
        'are read too. Durations, delays, resources ' +
        'and branch probabilities come from its `as-is.scenario.json` when it has one. `warnings` ' +
        'lists what the outline could not carry (other pools, other event types, nested lanes…).',
      inputSchema: z.object({
        project: z.string().describe('Path to the .lila, relative to the cwd of the server process.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process when the .lila holds several; implicit when it holds one.'),
        locale: localeSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, process, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      try {
        return textResult(await readLilaOutline(project, { process, locale: language }));
      } catch (error) {
        return errorResult(toolMessage('get_process_outline', message(error)));
      }
    },
  );
  // Annotate, RACI, scenario sheets and project creation (#99, #403, #514).
  registerAgentTools(server, localeOf);

  server.registerTool(
    'edit_process',
    {
      title: 'Edit process',
      description:
        'Applies a list of operations to one process of a .lila, all or none: `add` (a step, as in ' +
        'an outline, `after` a step or `between` two connected steps, or unconnected), `connect` ' +
        '(`default: true` out of an xor/or marks the default flow), `remove` (a step, reconnecting ' +
        'its predecessors to its successor when that is unambiguous, a flow, a boundary event or an ' +
        'artifact; an end event left with no way in goes too), `rename` (a lane also by its name), ' +
        '`setType` (also `end` ↔ `terminate` on an end event), `moveToLane` (with the step\'s boundary ' +
        'events), `addLane`, `removeLane` (its nodes to `moveStepsTo`), `moveLane` (among its ' +
        'siblings), `addBoundary` (a boundary timer, as in an outline), `annotate`/`removeAnnotation` ' +
        '(a text annotation on a step), `addDataObject`/`removeDataObject` (by name; an object goes ' +
        'when nothing uses it) and `setCalledProcess` (the process a call activity calls, by the slug of ' +
        'another process of the .lila: its `calledElement` becomes that process\'s BPMN process id, ' +
        'refused when another process declares the same id; `process: null` removes it). Start events are neither added nor retyped. Ids never change, so renamed ' +
        'or retyped steps keep their scenario entries; durations, resources and probabilities given ' +
        'go into the base scenario `as-is.scenario.json`. The result is validated; any problem ' +
        'refuses the whole edit, writes nothing and lists every issue with the index of its ' +
        'operation (`operations[i]`). Documentation, annotations, extended attributes and other ' +
        'pools are kept. With `layout` (default true) the process is laid out again; with ' +
        '`layout: false` every shape keeps its place and only new ones are placed (removeLane and ' +
        'moveLane move whole bands, each step keeping its x). Returns what ' +
        'each operation did (`changes`), the removed ids, the scenario entries that no longer apply ' +
        '(removed, each one reported with its values in `scenarioRemovals`), notes, the validator ' +
        'warnings and the outline after the edit. With `dryRun`, ' +
        'nothing is written.',
      inputSchema: z.object({
        project: z.string().describe('Path to the .lila, relative to the cwd of the server process.'),
        process: z
          .string()
          .optional()
          .describe('Slug of the process when the .lila holds several; implicit when it holds one.'),
        // Loose on purpose: the engine checks the operations itself and reports every problem with
        // the index of its operation and a catalog message, instead of the SDK's schema error.
        operations: z
          .unknown()
          .describe(
          'In order. Each one of: {op:"add", step:{id, name?, type?, lane?, duration?, resources?}, after?:id | between?:[from,to]}; ' +
            '{op:"connect", from, to, label?, probability?, default?, id?}; {op:"remove", id}; {op:"rename", id, name}; ' +
            '{op:"setType", id, type: an outline step type, or end|terminate (id: an end event or a step leading to one)}; ' +
            '{op:"moveToLane", id, lane}; {op:"addLane", name, id?, after?|before?}; ' +
            '{op:"removeLane", lane, moveStepsTo?}; {op:"moveLane", lane, before | after}; ' +
            '{op:"addBoundary", on, boundary:{id, type:"timer", name?, label?, duration?, interrupting?, to | end}}; ' +
            '{op:"annotate", on, text}; {op:"removeAnnotation", on, text}; ' +
            '{op:"addDataObject", name, on, direction: "in" | "out"}; {op:"removeDataObject", name, on?}; ' +
            '{op:"setCalledProcess", id: a call activity, process: slug of another process | null}. ' +
            'E.g. [{"op":"add","step":{"id":"verify","name":"Verify ID","duration":"5m"},"after":"receive"}, ' +
            '{"op":"connect","from":"ok","to":"verify","label":"Retry","probability":0.1}, {"op":"remove","id":"check"}, ' +
            '{"op":"rename","id":"issue","name":"Issue card"}, {"op":"setType","id":"check","type":"serviceTask"}, ' +
            '{"op":"addLane","name":"Back office"}, {"op":"moveToLane","id":"issue","lane":"Back office"}, ' +
            '{"op":"addBoundary","on":"check","boundary":{"id":"sla","type":"timer","duration":"48h","interrupting":false,"to":"escalate"}}].',
        ),
        dryRun: z.boolean().optional().describe('true: apply and validate in memory, write nothing.'),
        layout: z.boolean().optional().describe('Default true: lay the process out again. false: keep positions, place only new shapes.'),
        locale: localeSchema,
      }),
    },
    async ({ project, process, operations, dryRun, layout, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      try {
        return textResult(await editLilaProcess(project, operations, { process, dryRun, layout, locale: language }));
      } catch (error) {
        return errorResult(toolMessage('edit_process', message(error)));
      }
    },
  );

  // The agent guide and the formats as resources, and the guide's flow as a prompt (#637).
  registerResourcesAndPrompts(server, fallbackLocale);

  return server;
}

/**
 * Arranca el servidor sobre stdio. Lo usan el bin `lila-mcp` de este paquete y el subcomando
 * `lila mcp` de `@lila-modeler/engine` (LILA-056), que lo carga con `import()` dinámico para no crear un
 * ciclo de dependencia entre los dos paquetes. stdout es el transporte: nada más puede escribir ahí.
 *
 * Sin `locale`, el idioma sale del entorno (`LILA_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`), la misma
 * regla que la CLI: quien lo lanza desde `lila mcp` ya resolvió `--lang` y lo pasa explícito.
 */
export async function startStdioServer(options: ServerOptions = {}): Promise<void> {
  const locale = options.locale ?? resolveLocale(undefined, process.env);
  await createServer({ locale }).connect(new StdioServerTransport());
}
