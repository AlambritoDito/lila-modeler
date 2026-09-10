/**
 * Servidor MCP de Lila Modeler: tools sobre `@lila/engine`, sin lógica propia. `validate_bpmn` y
 * `describe_process` son de LILA-053; `run_simulation` y `compare_scenarios` de LILA-054, sobre
 * `@lila/engine/cli-shared` (extraído de `cli.ts` en el mismo ticket, sin cambiar su salida).
 * `createServer()` solo registra tools; conectar un transporte (stdio, in-memory para tests) es
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

import { validateBpmnXml, type ValidateBpmnReport, type ValidationResult } from '@lila/engine/bpmn';
import {
  absolutePath,
  comparablePath,
  compareWarnings,
  loadResolvedScenario,
  loadValidatedModel,
  readJsonFile,
  resultWithBoundaryWarnings,
  withRunOverrides,
  writeJsonAtomic,
  type LoadedScenarioResult,
  type ParsedIr,
} from '@lila/engine/cli-shared';
import { runResultSchema } from '@lila/engine/result-schema';
import {
  resolveExtends,
  schemaIssueLines,
  scenarioErrors,
  parseScenario,
  validateScenario,
  type ResolvedScenario,
  type Scenario,
  type ScenarioProblem,
} from '@lila/engine/schema';
import { compare, simulate, type CompareResult, type RunResult } from '@lila/engine';
import { messages, resolveLocale, type Locale } from '@lila/engine/messages';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { applyJsonPatch, buildPatchDelta, type JsonPatchOp } from './json-patch.js';
import { resolveScenarioInput, type ScenarioInput } from './scenario-input.js';

const NAME = 'lila-mcp';
const VERSION = '0.0.0';

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
function modelXml(
  tool: string,
  path: string | undefined,
  xml: string | undefined,
  locale: Locale,
): { xml: string } | { error: string } {
  const M = messages(locale).mcp;
  if (path !== undefined && xml !== undefined) {
    return { error: toolMessage(tool, M.bothPathAndXml()) };
  }
  if (xml !== undefined) return { xml };
  if (path !== undefined) return readModel(tool, absolutePath(path), locale);
  return { error: toolMessage(tool, M.pathOrXml()) };
}

const GATEWAY_TYPES = new Set(['xor', 'or', 'and']);

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
function scenarioResources(file: string, locale: Locale): { resources: string[] } | { error: string } {
  try {
    const raw = resolveExtends(absolutePath(file), (path) => readJsonFile(path, locale));
    const parsed = parseScenario(raw, { locale });
    if (parsed.success) return { resources: resourceLines(parsed.data) };
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
  scenario: ScenarioInput;
  seed?: number | undefined;
  replications?: number | undefined;
  saveTo?: string | undefined;
  locale?: Locale | undefined;
}

/**
 * Igual pipeline que `runCommand` de `cli.ts` (compartida en `@lila/engine/cli-shared`): valida
 * modelo y escenario, aplica overrides y simula con `log: false`. Ningún campo de nivel 2/3 se
 * rechaza (LILA-184): `resources` y `calendars` los simula el motor desde LILA-033…036 y LILA-041.
 * El `RunResult` devuelto es el mismo objeto que produce `lila run --json`.
 */
async function runSimulation(
  { model, scenario, seed, replications, saveTo }: RunSimulationInput,
  locale: Locale,
): Promise<CallToolResult> {
  const M = messages(locale).mcp;
  const fail = (body: string): CallToolResult => errorResult(toolMessage('run_simulation', body));

  let resolved: ResolvedScenario;
  try {
    resolved = resolveScenarioInput(scenario, locale);
  } catch (error) {
    return fail(message(error));
  }

  const modelPath = model === undefined ? resolved.model : absolutePath(model);
  if (model !== undefined && comparablePath(modelPath) !== comparablePath(resolved.model)) {
    return fail(M.modelMismatch(modelPath, resolved.model));
  }

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  try {
    ({ ir, validation: modelValidation } = await loadValidatedModel(modelPath, locale));
  } catch (error) {
    return fail(message(error));
  }
  if (modelValidation.errors.length > 0) {
    return fail(M.modelInvalid(JSON.stringify(modelValidation.errors)));
  }

  const withOverrides = withRunOverrides(resolved, { seed, replications });
  const scenarioProblems = validateScenario(withOverrides, ir, { locale });
  const scenarioIssues = scenarioErrors(scenarioProblems);
  if (scenarioIssues.length > 0) return fail(M.scenarioInvalid(JSON.stringify(scenarioIssues)));

  let result: RunResult;
  try {
    const simulated = simulate(ir, withOverrides, { log: false, locale });
    result = resultWithBoundaryWarnings(simulated, modelValidation, scenarioProblems);
  } catch (error) {
    return fail(message(error));
  }

  if (saveTo !== undefined) {
    try {
      writeJsonAtomic(saveTo, result, locale);
    } catch (error) {
      return fail(message(error));
    }
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false, structuredContent: result };
}

interface CompareScenariosInput {
  model?: string | undefined;
  scenarios: ScenarioInput[];
  seed?: number | undefined;
  replications?: number | undefined;
  saveTo?: string | undefined;
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
 */
async function compareScenarios(
  { model, scenarios, seed, replications, saveTo }: CompareScenariosInput,
  locale: Locale,
): Promise<CallToolResult> {
  const M = messages(locale).mcp;
  const fail = (body: string): CallToolResult => errorResult(toolMessage('compare_scenarios', body));
  if (scenarios.length < 2) return fail(M.atLeastTwoScenarios());

  const resolved: Array<{ label: string; scenario: ResolvedScenario }> = [];
  for (const [index, entry] of scenarios.entries()) {
    const label = scenarioLabel(entry, index);
    try {
      resolved.push({ label, scenario: resolveScenarioInput(entry, locale) });
    } catch (error) {
      return fail(`${label}: ${message(error)}`);
    }
  }

  const referenceModel = model === undefined ? resolved[0]!.scenario.model : absolutePath(model);
  for (const { label, scenario } of resolved) {
    if (comparablePath(referenceModel) !== comparablePath(scenario.model)) {
      return fail(`${label}: ${M.modelMismatch(referenceModel, scenario.model)}`);
    }
  }

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  try {
    ({ ir, validation: modelValidation } = await loadValidatedModel(referenceModel, locale));
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
    const problems = validateScenario(withOverrides, ir, { locale });
    const issues = scenarioErrors(problems);
    if (issues.length > 0) return fail(`${label}: ${M.scenarioInvalid(JSON.stringify(issues))}`);
    validated.push({ label, scenario: withOverrides, problems });
  }

  let loaded: LoadedScenarioResult[];
  try {
    loaded = validated.map(({ label, scenario, problems }) => ({
      file: label,
      scenario,
      result: resultWithBoundaryWarnings(simulate(ir, scenario, { log: false, locale }), modelValidation, problems),
    }));
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
      writeJsonAtomic(saveTo, comparison, locale);
    } catch (error) {
      return fail(message(error));
    }
  }

  const payload = { comparison, notes };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false, structuredContent: payload };
}

/* ------------------------------------------------------------------ *
 * `patch_scenario` (LILA-055)
 * ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Esquema + modelo + `validateScenario`, en una sola pasada: la misma comprobación sirve
 * para el modo (a) sobre el escenario ya parcheado, y para el modo (b) sobre el candidato que
 * realmente se va a escribir (que puede no coincidir con el parcheado si `extendsFrom` no es el
 * mismo archivo que `scenario`). Solo si esto no devuelve error se escribe algo a disco.
 * El esquema se pasa por `parseScenario` (LILA-202), no por `ScenarioSchema.safeParse`: los
 * defectos del escenario parcheado salen en español, igual que en la CLI y en `run_simulation`.
 */
async function validatePatchedScenario(
  raw: unknown,
  locale: Locale,
): Promise<{ ok: true; scenario: ResolvedScenario; notes: string[] } | { ok: false; error: string }> {
  const M = messages(locale).mcp;
  const parsed = parseScenario(raw, { locale });
  if (!parsed.success) {
    // `schemaIssueLines` es la que pone los códigos de § 17 (`E-CLAVE-DESCONOCIDA`) que la CLI ya
    // emite (LILA-198); formatear los defectos aquí a mano los perdía.
    const detail = schemaIssueLines(parsed.error.issues, { locale }).join('; ');
    return { ok: false, error: `${M.invalidAfterPatchLabel()} ${detail}` };
  }
  // `ScenarioSchema` tiene `model` y `run` opcionales (un archivo con `extends` los hereda), así
  // que un patch puede borrarlos y aun así pasar el esquema. `loadResolvedScenario` los exige y es
  // lo que hace el modo (b); sin este par de guardas el modo (a) escribía un escenario que la
  // propia `run_simulation` rechaza después — y el `remove /model` filtraba el TypeError de
  // `node:path` en vez de un mensaje del dominio.
  if (parsed.data.model === undefined) return { ok: false, error: M.patchedMissingModel() };
  if (parsed.data.run === undefined) return { ok: false, error: M.patchedMissingRun() };
  const scenario = parsed.data as ResolvedScenario;

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  try {
    ({ ir, validation: modelValidation } = await loadValidatedModel(scenario.model, locale));
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  if (modelValidation.errors.length > 0) {
    return { ok: false, error: M.modelInvalid(JSON.stringify(modelValidation.errors)) };
  }

  const problems = validateScenario(scenario, ir, { locale });
  const issues = scenarioErrors(problems);
  if (issues.length > 0) {
    return { ok: false, error: `${M.invalidAfterPatchLabel()} ${JSON.stringify(issues)}` };
  }

  const notes = problems.filter((p) => p.severity === 'warning').map((p) => `${p.code}: ${p.message}`);
  return { ok: true, scenario, notes };
}

/**
 * `loadResolvedScenario` prefija sus errores con la ruta del archivo. En el modo (b) esa ruta es
 * la de `saveTo`: un archivo que todavía no existe y que, si el escenario no valida, no se va a
 * escribir. Citarlo manda al agente a abrir una ruta fantasma — el mismo problema que el escenario
 * inline de LILA-054. Se le quita el prefijo y se alinea el texto con el del modo (a).
 */
function withoutPhantomFile(error: unknown, phantom: string, locale: Locale): string {
  const catalog = messages(locale);
  const raw = message(error).replaceAll('\n', ' ');
  return raw.startsWith(`${phantom}: `)
    ? raw
        .slice(phantom.length + 2)
        .replace(catalog.cli.invalidScenarioLabel(), catalog.mcp.invalidAfterPatchLabel())
    : raw;
}

/**
 * El escenario resuelto trae `model` como ruta absoluta: `resolveExtends` la ancla al archivo que
 * la declara. Escribirla tal cual en el modo (a) vuelve el archivo dependiente de la máquina que
 * corrió la tool (`/Users/quien-sea/...`), y deja de resolver en cualquier otro checkout. Se
 * reescribe relativa al propio escenario, que es como la declaran los del repo y la misma regla
 * que el modo (b) aplica a `extends`.
 */
function withRelativeModel(scenario: ResolvedScenario, file: string): ResolvedScenario {
  return { ...scenario, model: posix.relative(posix.dirname(file), scenario.model) };
}

interface PatchScenarioInput {
  scenario: string;
  patch: JsonPatchOp[];
  saveTo?: string | undefined;
  extendsFrom?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  locale?: Locale | undefined;
}

/**
 * Dos modos (LILA-055): sin `saveTo`, parchea `scenario` en sitio (escenario resuelto completo,
 * sin `extends`: el patch se aplica sobre el escenario ya fusionado). Con `saveTo`, crea un
 * archivo nuevo que declara `extends: extendsFrom` (por defecto, el propio `scenario`) y contiene
 * solo el delta del patch — como `to-be-3-cajeros.scenario.json`. En ambos casos, solo se escribe
 * si el escenario resultante valida contra el modelo; nunca dos veces (primero se valida, después
 * se escribe una única vez).
 */
async function patchScenario(
  { scenario, patch, saveTo, extendsFrom, name, description }: PatchScenarioInput,
  locale: Locale,
): Promise<CallToolResult> {
  const M = messages(locale).mcp;
  const fail = (body: string): CallToolResult => errorResult(toolMessage('patch_scenario', body));
  const scenarioPath = absolutePath(scenario);
  let base: ResolvedScenario;
  try {
    base = loadResolvedScenario(scenarioPath, undefined, locale);
  } catch (error) {
    return fail(message(error));
  }

  let patchedRaw: unknown;
  try {
    patchedRaw = applyJsonPatch(base, patch);
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
    try {
      const file = writeJsonAtomic(
        scenarioPath,
        withRelativeModel(outcome.scenario, scenarioPath),
        locale,
      );
      return textResult({ scenario: outcome.scenario, file, notes: outcome.notes });
    } catch (error) {
      return fail(message(error));
    }
  }

  // Modo (b): archivo nuevo con `extends` al padre, solo el delta del patch.
  if (!isPlainObject(patchedRaw)) return fail(M.patchNotAnObject());
  const saveToPath = absolutePath(saveTo);
  const extendsFromPath = absolutePath(extendsFrom ?? scenario);
  const relExtends = posix.relative(posix.dirname(saveToPath), extendsFromPath);
  const delta = buildPatchDelta(patch, patchedRaw);

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

  try {
    const file = writeJsonAtomic(saveToPath, candidate, locale);
    return textResult({ scenario: outcome.scenario, file, notes: outcome.notes });
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
        'Parses and validates a .bpmn file (by path or inline XML, one of the two) and returns the ' +
        'same JSON as `lila validate --json`: the IR, the ignored processes, and structured ' +
        'errors/warnings. A model with a non-empty `errors` cannot be simulated, but that is a ' +
        'valid result of the tool: isError only marks that the tool failed (bad arguments, ' +
        'unreadable file, impenetrable XML).',
      inputSchema: z.object({
        path: z.string().optional().describe('Path to the .bpmn, relative to the cwd of the server process.'),
        xml: z.string().optional().describe('XML content of the .bpmn, instead of a path.'),
        locale: localeSchema,
      }),
    },
    async ({ path, xml, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      const read = modelXml('validate_bpmn', path, xml, language);
      if ('error' in read) return errorResult(read.error);

      try {
        return textResult(await validateBpmnXml(read.xml, { locale: language }));
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
        'Parses a .bpmn (by path or inline XML, one of the two) and returns its IR (ProcessIR) ' +
        'together with a readable summary (the `resumen` key): node count by type, gateways with ' +
        'their outgoing flows, lanes, subprocesses, other processes in the file and whether the ' +
        'model passes validation. With the optional `scenario` (path to a .json scenario, resolves ' +
        '`extends`) it adds the resources referenced by element.',
      inputSchema: z.object({
        path: z.string().optional().describe('Path to the .bpmn, relative to the cwd of the server process.'),
        xml: z.string().optional().describe('XML content of the .bpmn, instead of a path.'),
        scenario: z.string().optional().describe('Path to a .json scenario, relative to the cwd.'),
        locale: localeSchema,
      }),
    },
    async ({ path, xml, scenario, locale }): Promise<CallToolResult> => {
      const language = localeOf(locale);
      const read = modelXml('describe_process', path, xml, language);
      if ('error' in read) return errorResult(read.error);

      let report: ValidateBpmnReport;
      try {
        report = await validateBpmnXml(read.xml, { locale: language });
      } catch (error) {
        return errorResult(toolMessage('describe_process', message(error)));
      }

      const scenarioResult = scenario === undefined ? undefined : scenarioResources(scenario, language);
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
        'Validates model and scenario, simulates with `log: false` and returns the same `RunResult` ' +
        'as `lila run --json` (elements, flows, resources, process, bottlenecks and warnings). ' +
        '`scenario` accepts a .json path (resolves `extends`) or the already resolved scenario as an ' +
        'inline object. `saveTo` writes the same JSON atomically, like `lila run --json <path>`. ' +
        'isError only marks that the tool failed (invalid model/scenario, unreadable file).',
      inputSchema: z.object({
        model: z.string().optional().describe('Path to the .bpmn; defaults to scenario.model.'),
        scenario: scenarioInputSchema,
        seed: z.number().int().optional().describe('Overrides run.seed.'),
        replications: z.number().int().min(1).optional().describe('Overrides run.replications.'),
        saveTo: z.string().optional().describe('Path to write the RunResult as JSON.'),
        locale: localeSchema,
      }),
      outputSchema: runResultSchema,
    },
    async (input): Promise<CallToolResult> => runSimulation(input, localeOf(input.locale)),
  );

  server.registerTool(
    'compare_scenarios',
    {
      title: 'Compare scenarios',
      description:
        'Validates and simulates two or more scenarios on the same model (the first one is the ' +
        'base) and returns the same `CompareResult` as `lila compare --json`, plus `notes`: the ' +
        'warnings the CLI prints beside the table (different seeds, different `baseTimeUnit`, too ' +
        'few replications for a 95% CI). `scenarios` accepts .json paths and inline objects, mixed. ' +
        '`saveTo` writes `comparison` as JSON, like `lila compare --json`.',
      inputSchema: z.object({
        model: z.string().optional().describe('Path to the .bpmn; defaults to the model of the first scenario.'),
        // Sin `.min(2)`: así el mensaje lo da `compareScenarios` en el idioma pedido, no el
        // validador del SDK, que solo habla inglés.
        scenarios: z.array(scenarioInputSchema),
        seed: z.number().int().optional().describe('Overrides run.seed in every scenario.'),
        replications: z.number().int().min(1).optional().describe('Overrides run.replications in every scenario.'),
        saveTo: z.string().optional().describe('Path to write the CompareResult as JSON.'),
        locale: localeSchema,
      }),
    },
    async (input): Promise<CallToolResult> => compareScenarios(input, localeOf(input.locale)),
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
        '`to-be-3-cajeros.scenario.json`. Returns the resulting resolved scenario, the path written ' +
        'and `notes` with the lint warnings. A patch that leaves the scenario invalid (`probability` ' +
        'outside `[0,1]`, `capacity` < 1, a `ref` that does not exist in `resources`, …) is rejected ' +
        'without writing anything.',
      inputSchema: z.object({
        scenario: z.string().describe('Path to the .json scenario to read and patch, relative to the cwd.'),
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
        locale: localeSchema,
      }),
    },
    async (input): Promise<CallToolResult> => patchScenario(input, localeOf(input.locale)),
  );

  return server;
}

/**
 * Arranca el servidor sobre stdio. Lo usan el bin `lila-mcp` de este paquete y el subcomando
 * `lila mcp` de `@lila/engine` (LILA-056), que lo carga con `import()` dinámico para no crear un
 * ciclo de dependencia entre los dos paquetes. stdout es el transporte: nada más puede escribir ahí.
 *
 * Sin `locale`, el idioma sale del entorno (`LILA_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`), la misma
 * regla que la CLI: quien lo lanza desde `lila mcp` ya resolvió `--lang` y lo pasa explícito.
 */
export async function startStdioServer(options: ServerOptions = {}): Promise<void> {
  const locale = options.locale ?? resolveLocale(undefined, process.env);
  await createServer({ locale }).connect(new StdioServerTransport());
}
