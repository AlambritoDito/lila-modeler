/**
 * Servidor MCP de Lila Modeler: tools sobre `@lila/engine`, sin lógica propia. `validate_bpmn` y
 * `describe_process` son de LILA-053; `run_simulation` y `compare_scenarios` de LILA-054, sobre
 * `@lila/engine/cli-shared` (extraído de `cli.ts` en el mismo ticket, sin cambiar su salida).
 * `createServer()` solo registra tools; conectar un transporte (stdio, in-memory para tests) es
 * responsabilidad de quien lo use — ver `src/bin.ts` para el caso stdio real.
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
  scenarioErrors,
  parseScenario,
  validateScenario,
  type ResolvedScenario,
  type Scenario,
  type ScenarioProblem,
} from '@lila/engine/schema';
import { compare, simulate, type CompareResult, type RunResult } from '@lila/engine';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { applyJsonPatch, buildPatchDelta, type JsonPatchOp } from './json-patch.js';
import { resolveScenarioInput, type ScenarioInput } from './scenario-input.js';

const NAME = 'lila-mcp';
const VERSION = '0.0.0';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
function readModel(tool: string, file: string): { xml: string } | { error: string } {
  if (!existsSync(file)) return { error: `${tool}: no existe el archivo ${file}.` };
  try {
    return { xml: readFileSync(file, 'utf8') };
  } catch (error) {
    return { error: `${tool}: ${message(error)}` };
  }
}

const CONTEO_TIPOS: Record<string, string> = {
  start: 'inicio',
  end: 'fin',
  terminate: 'terminación',
  task: 'tarea',
  xor: 'gateway XOR',
  or: 'gateway OR',
  and: 'gateway AND',
  timer: 'temporizador',
};

const GATEWAY_TYPES = new Set(['xor', 'or', 'and']);

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/** Arma el resumen legible en español pedido por LILA-053: nodos, gateways, lanes, subprocesos. */
function describeIr(report: ValidateBpmnReport, resources: string[], scenarioError?: string): string {
  const { ir, ignoredProcessIds, errors, warnings } = report;
  const lines: string[] = [];
  lines.push(`Proceso ${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`);

  const counts = new Map<string, number>();
  for (const node of Object.values(ir.nodes)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  lines.push('');
  lines.push(`Nodos (${Object.keys(ir.nodes).length}):`);
  for (const [type, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${CONTEO_TIPOS[type] ?? type}: ${n}`);
  }

  const gatewayIds = Object.entries(ir.nodes).filter(([, node]) => GATEWAY_TYPES.has(node.type));
  if (gatewayIds.length > 0) {
    lines.push('');
    lines.push('Gateways y sus salidas:');
    for (const [id, node] of gatewayIds) {
      lines.push(`  ${id}${node.name === '' ? '' : ` (${node.name})`} [${node.type}]:`);
      for (const flowId of node.outgoing) {
        const flow = ir.flows[flowId];
        if (flow === undefined) continue;
        const mark = flow.isDefault ? '  (por defecto)' : '';
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
    lines.push('Lanes:');
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
    lines.push('Subprocesos embebidos (aplanados):');
    for (const [id, ids] of subprocesses) lines.push(`  ${id}: ${ids.join(', ')}`);
  }

  if (ignoredProcessIds.length > 0) {
    lines.push('');
    lines.push(`Otros procesos del archivo, no simulados: ${ignoredProcessIds.join(', ')}`);
  }

  // Un modelo fuera del perfil se describe igual, pero no se puede simular: decirlo aquí evita
  // que un agente encadene describe_process -> run_simulation sobre un modelo que no corre.
  lines.push('');
  const cuenta = `${plural(errors.length, 'error', 'errores')}, ${plural(warnings.length, 'aviso', 'avisos')}`;
  lines.push(
    errors.length > 0
      ? `Validación: ${cuenta}. El modelo NO se puede simular; usa validate_bpmn para el detalle.`
      : `Validación: ${cuenta}.`,
  );

  lines.push('');
  if (scenarioError !== undefined) {
    lines.push(`Recursos referenciados: no se pudo leer el escenario: ${scenarioError}`);
  } else if (resources.length > 0) {
    lines.push('Recursos referenciados:');
    for (const line of resources) lines.push(`  ${line}`);
  } else {
    lines.push('Recursos referenciados: (sin escenario, o el escenario no referencia recursos)');
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
function scenarioResources(file: string): { resources: string[] } | { error: string } {
  try {
    const parsed = parseScenario(resolveExtends(absolutePath(file), readJsonFile));
    if (parsed.success) return { resources: resourceLines(parsed.data) };
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
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
  z.string().describe('Ruta a un escenario .json, relativa al cwd del proceso servidor.'),
  z.record(z.string(), z.unknown()).describe('Escenario ya resuelto, inline.'),
]);

interface RunSimulationInput {
  model?: string | undefined;
  scenario: ScenarioInput;
  seed?: number | undefined;
  replications?: number | undefined;
  saveTo?: string | undefined;
}

/**
 * Igual pipeline que `runCommand` de `cli.ts` (compartida en `@lila/engine/cli-shared`): valida
 * modelo y escenario, aplica overrides y simula con `log: false`. Ningún campo de nivel 2/3 se
 * rechaza (LILA-184): `resources` y `calendars` los simula el motor desde LILA-033…036 y LILA-041.
 * El `RunResult` devuelto es el mismo objeto que produce `lila run --json`.
 */
async function runSimulation({
  model,
  scenario,
  seed,
  replications,
  saveTo,
}: RunSimulationInput): Promise<CallToolResult> {
  let resolved: ResolvedScenario;
  try {
    resolved = resolveScenarioInput(scenario);
  } catch (error) {
    return errorResult(`run_simulation: ${message(error)}`);
  }

  const modelPath = model === undefined ? resolved.model : absolutePath(model);
  if (model !== undefined && comparablePath(modelPath) !== comparablePath(resolved.model)) {
    return errorResult(
      `run_simulation: el modelo (${modelPath}) no coincide con scenario.model (${resolved.model}).`,
    );
  }

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  try {
    ({ ir, validation: modelValidation } = await loadValidatedModel(modelPath));
  } catch (error) {
    return errorResult(`run_simulation: ${message(error)}`);
  }
  if (modelValidation.errors.length > 0) {
    return errorResult(`run_simulation: el modelo no pasa la validación: ${JSON.stringify(modelValidation.errors)}`);
  }

  const withOverrides = withRunOverrides(resolved, { seed, replications });
  const scenarioProblems = validateScenario(withOverrides, ir);
  const scenarioIssues = scenarioErrors(scenarioProblems);
  if (scenarioIssues.length > 0) return errorResult(`run_simulation: escenario inválido: ${JSON.stringify(scenarioIssues)}`);

  let result: RunResult;
  try {
    const simulated = simulate(ir, withOverrides, { log: false });
    result = resultWithBoundaryWarnings(simulated, modelValidation, scenarioProblems);
  } catch (error) {
    return errorResult(`run_simulation: ${message(error)}`);
  }

  if (saveTo !== undefined) {
    try {
      writeJsonAtomic(saveTo, result);
    } catch (error) {
      return errorResult(`run_simulation: ${message(error)}`);
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
async function compareScenarios({
  model,
  scenarios,
  seed,
  replications,
  saveTo,
}: CompareScenariosInput): Promise<CallToolResult> {
  if (scenarios.length < 2) return errorResult('compare_scenarios: hacen falta al menos dos escenarios.');

  const resolved: Array<{ label: string; scenario: ResolvedScenario }> = [];
  for (const [index, entry] of scenarios.entries()) {
    const label = scenarioLabel(entry, index);
    try {
      resolved.push({ label, scenario: resolveScenarioInput(entry) });
    } catch (error) {
      return errorResult(`compare_scenarios: ${label}: ${message(error)}`);
    }
  }

  const referenceModel = model === undefined ? resolved[0]!.scenario.model : absolutePath(model);
  for (const { label, scenario } of resolved) {
    if (comparablePath(referenceModel) !== comparablePath(scenario.model)) {
      return errorResult(
        `compare_scenarios: ${label}: el modelo (${referenceModel}) no coincide con scenario.model (${scenario.model}).`,
      );
    }
  }

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  try {
    ({ ir, validation: modelValidation } = await loadValidatedModel(referenceModel));
  } catch (error) {
    return errorResult(`compare_scenarios: ${message(error)}`);
  }
  if (modelValidation.errors.length > 0) {
    return errorResult(`compare_scenarios: el modelo no pasa la validación: ${JSON.stringify(modelValidation.errors)}`);
  }

  // Todo se valida antes de simular nada, igual que `compareCommand`.
  const validated: Array<{ label: string; scenario: ResolvedScenario; problems: readonly ScenarioProblem[] }> = [];
  for (const { label, scenario } of resolved) {
    const withOverrides = withRunOverrides(scenario, { seed, replications });
    const problems = validateScenario(withOverrides, ir);
    const issues = scenarioErrors(problems);
    if (issues.length > 0) return errorResult(`compare_scenarios: ${label}: escenario inválido: ${JSON.stringify(issues)}`);
    validated.push({ label, scenario: withOverrides, problems });
  }

  let loaded: LoadedScenarioResult[];
  try {
    loaded = validated.map(({ label, scenario, problems }) => ({
      file: label,
      scenario,
      result: resultWithBoundaryWarnings(simulate(ir, scenario, { log: false }), modelValidation, problems),
    }));
  } catch (error) {
    return errorResult(`compare_scenarios: ${message(error)}`);
  }

  let comparison: CompareResult;
  try {
    comparison = compare(loaded.map((entry) => entry.result));
  } catch (error) {
    // E-COMPARE-VACIO u otro error de `compare()`: no debería pasar tras el check de arriba, pero
    // se atrapa igual para no tumbar el servidor (mismo criterio que #53).
    return errorResult(`compare_scenarios: ${message(error)}`);
  }

  const notes = compareWarnings(loaded, loaded[0]!.scenario.run.baseTimeUnit);

  if (saveTo !== undefined) {
    try {
      writeJsonAtomic(saveTo, comparison);
    } catch (error) {
      return errorResult(`compare_scenarios: ${message(error)}`);
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
 * ScenarioSchema + modelo + `validateScenario`, en una sola pasada: la misma comprobación sirve
 * para el modo (a) sobre el escenario ya parcheado, y para el modo (b) sobre el candidato que
 * realmente se va a escribir (que puede no coincidir con el parcheado si `extendsFrom` no es el
 * mismo archivo que `scenario`). Solo si esto no devuelve error se escribe algo a disco.
 */
async function validatePatchedScenario(
  raw: unknown,
): Promise<{ ok: true; scenario: ResolvedScenario; notes: string[] } | { ok: false; error: string }> {
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
    return { ok: false, error: `escenario inválido tras el patch: ${issues.join('; ')}` };
  }
  const scenario = parsed.data as ResolvedScenario;

  let ir: ParsedIr;
  let modelValidation: ValidationResult;
  try {
    ({ ir, validation: modelValidation } = await loadValidatedModel(scenario.model));
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  if (modelValidation.errors.length > 0) {
    return { ok: false, error: `el modelo no pasa la validación: ${JSON.stringify(modelValidation.errors)}` };
  }

  const problems = validateScenario(scenario, ir);
  const issues = scenarioErrors(problems);
  if (issues.length > 0) return { ok: false, error: `escenario inválido tras el patch: ${JSON.stringify(issues)}` };

  const notes = problems.filter((p) => p.severity === 'warning').map((p) => `${p.code}: ${p.message}`);
  return { ok: true, scenario, notes };
}

interface PatchScenarioInput {
  scenario: string;
  patch: JsonPatchOp[];
  saveTo?: string | undefined;
  extendsFrom?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
}

/**
 * Dos modos (LILA-055): sin `saveTo`, parchea `scenario` en sitio (escenario resuelto completo,
 * sin `extends`: el patch se aplica sobre el escenario ya fusionado). Con `saveTo`, crea un
 * archivo nuevo que declara `extends: extendsFrom` (por defecto, el propio `scenario`) y contiene
 * solo el delta del patch — como `to-be-3-cajeros.scenario.json`. En ambos casos, solo se escribe
 * si el escenario resultante valida contra el modelo; nunca dos veces (primero se valida, después
 * se escribe una única vez).
 */
async function patchScenario({
  scenario,
  patch,
  saveTo,
  extendsFrom,
  name,
  description,
}: PatchScenarioInput): Promise<CallToolResult> {
  const scenarioPath = absolutePath(scenario);
  let base: ResolvedScenario;
  try {
    base = loadResolvedScenario(scenarioPath);
  } catch (error) {
    return errorResult(`patch_scenario: ${message(error)}`);
  }

  let patchedRaw: unknown;
  try {
    patchedRaw = applyJsonPatch(base, patch);
  } catch (error) {
    return errorResult(`patch_scenario: ${message(error)}`);
  }

  if (saveTo === undefined) {
    // Modo (a): patchear en sitio.
    if (isPlainObject(patchedRaw)) {
      if (name !== undefined) patchedRaw.name = name;
      if (description !== undefined) patchedRaw.description = description;
    }
    const outcome = await validatePatchedScenario(patchedRaw);
    if (!outcome.ok) return errorResult(`patch_scenario: ${outcome.error}`);
    try {
      const file = writeJsonAtomic(scenarioPath, outcome.scenario);
      return textResult({ scenario: outcome.scenario, file, notes: outcome.notes });
    } catch (error) {
      return errorResult(`patch_scenario: ${message(error)}`);
    }
  }

  // Modo (b): archivo nuevo con `extends` al padre, solo el delta del patch.
  if (!isPlainObject(patchedRaw)) {
    return errorResult('patch_scenario: el patch no produjo un objeto de escenario.');
  }
  const saveToPath = absolutePath(saveTo);
  const extendsFromPath = absolutePath(extendsFrom ?? scenario);
  const relExtends = posix.relative(posix.dirname(saveToPath), extendsFromPath);
  const delta = buildPatchDelta(patch, patchedRaw);

  const candidate: Record<string, unknown> = { version: base.version, extends: relExtends, ...delta };
  candidate['name'] = name ?? (typeof delta['name'] === 'string' ? delta['name'] : `${base.name} (parcheado)`);
  if (description !== undefined) candidate['description'] = description;

  let resolvedCandidate: ResolvedScenario;
  try {
    resolvedCandidate = loadResolvedScenario(saveToPath, (file) => (file === saveToPath ? candidate : readJsonFile(file)));
  } catch (error) {
    return errorResult(`patch_scenario: ${message(error)}`);
  }

  const outcome = await validatePatchedScenario(resolvedCandidate);
  if (!outcome.ok) return errorResult(`patch_scenario: ${outcome.error}`);

  try {
    const file = writeJsonAtomic(saveToPath, candidate);
    return textResult({ scenario: outcome.scenario, file, notes: outcome.notes });
  } catch (error) {
    return errorResult(`patch_scenario: ${message(error)}`);
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    'validate_bpmn',
    {
      title: 'Validar BPMN',
      description:
        'Parsea y valida un archivo .bpmn (por ruta o XML inline, uno de los dos) y devuelve el ' +
        'mismo JSON que `lila validate --json`: el IR, los procesos ignorados, y errores/avisos ' +
        'estructurados. Un modelo con `errors` no vacío no se puede simular, pero eso es un ' +
        'resultado válido de la tool: isError solo marca que la tool falló (argumentos malos, ' +
        'archivo ilegible, XML impenetrable).',
      inputSchema: z.object({
        path: z.string().optional().describe('Ruta al .bpmn, relativa al cwd del proceso servidor.'),
        xml: z.string().optional().describe('Contenido XML del .bpmn, en vez de una ruta.'),
      }),
    },
    async ({ path, xml }): Promise<CallToolResult> => {
      if (path !== undefined && xml !== undefined) {
        return errorResult('validate_bpmn: hay que pasar `path` o `xml`, no los dos.');
      }
      let content: string;
      if (xml !== undefined) {
        content = xml;
      } else if (path !== undefined) {
        const read = readModel('validate_bpmn', absolutePath(path));
        if ('error' in read) return errorResult(read.error);
        content = read.xml;
      } else {
        return errorResult('validate_bpmn: hay que pasar `path` o `xml`.');
      }

      try {
        return textResult(await validateBpmnXml(content));
      } catch (error) {
        return errorResult(`validate_bpmn: ${message(error)}`);
      }
    },
  );

  server.registerTool(
    'describe_process',
    {
      title: 'Describir proceso',
      description:
        'Parsea un .bpmn y devuelve su IR (ProcessIR) junto con un resumen legible en español: ' +
        'conteo de nodos por tipo, gateways con sus salidas, lanes, subprocesos, otros procesos ' +
        'del archivo y si el modelo pasa la validación. Con `scenario` opcional (ruta a un ' +
        'escenario .json, resuelve `extends`), agrega los recursos referenciados por elemento.',
      inputSchema: z.object({
        path: z.string().describe('Ruta al .bpmn, relativa al cwd del proceso servidor.'),
        scenario: z.string().optional().describe('Ruta a un escenario .json, relativa al cwd.'),
      }),
    },
    async ({ path, scenario }): Promise<CallToolResult> => {
      const read = readModel('describe_process', absolutePath(path));
      if ('error' in read) return errorResult(read.error);

      let report: ValidateBpmnReport;
      try {
        report = await validateBpmnXml(read.xml);
      } catch (error) {
        return errorResult(`describe_process: ${message(error)}`);
      }

      const scenarioResult = scenario === undefined ? undefined : scenarioResources(scenario);
      const resources = scenarioResult !== undefined && 'resources' in scenarioResult ? scenarioResult.resources : [];
      const scenarioError = scenarioResult !== undefined && 'error' in scenarioResult ? scenarioResult.error : undefined;

      return textResult({ ir: report.ir, resumen: describeIr(report, resources, scenarioError) });
    },
  );

  server.registerTool(
    'run_simulation',
    {
      title: 'Correr simulación',
      description:
        'Valida modelo y escenario, simula con `log: false` y devuelve el mismo `RunResult` que ' +
        '`lila run --json` (elementos, flujos, recursos, proceso, bottlenecks y avisos). `scenario` ' +
        'acepta una ruta .json (resuelve `extends`) o el escenario ya resuelto como objeto inline. ' +
        '`saveTo` escribe el mismo JSON de forma atómica, como `lila run --json <ruta>`. ' +
        'isError solo marca que la tool falló (modelo/escenario inválido, archivo ilegible).',
      inputSchema: z.object({
        model: z.string().optional().describe('Ruta al .bpmn; por defecto, scenario.model.'),
        scenario: scenarioInputSchema,
        seed: z.number().int().optional().describe('Sobrescribe run.seed.'),
        replications: z.number().int().min(1).optional().describe('Sobrescribe run.replications.'),
        saveTo: z.string().optional().describe('Ruta donde escribir el RunResult como JSON.'),
      }),
      outputSchema: runResultSchema,
    },
    runSimulation,
  );

  server.registerTool(
    'compare_scenarios',
    {
      title: 'Comparar escenarios',
      description:
        'Valida y simula dos o más escenarios sobre el mismo modelo (el primero es la base) y ' +
        'devuelve el mismo `CompareResult` que `lila compare --json`, más `notes`: los avisos que ' +
        'la CLI imprime aparte de la tabla (semillas distintas, `baseTimeUnit` distinto, réplicas ' +
        'insuficientes para IC95). `scenarios` acepta rutas .json u objetos inline, mezclados. ' +
        '`saveTo` escribe `comparison` como JSON, igual que `lila compare --json`.',
      inputSchema: z.object({
        model: z.string().optional().describe('Ruta al .bpmn; por defecto, el model del primer escenario.'),
        // Sin `.min(2)`: así el mensaje lo da `compareScenarios` en español, no el validador del SDK.
        scenarios: z.array(scenarioInputSchema),
        seed: z.number().int().optional().describe('Sobrescribe run.seed en todos los escenarios.'),
        replications: z.number().int().min(1).optional().describe('Sobrescribe run.replications en todos.'),
        saveTo: z.string().optional().describe('Ruta donde escribir el CompareResult como JSON.'),
      }),
    },
    compareScenarios,
  );

  server.registerTool(
    'patch_scenario',
    {
      title: 'Parchear escenario',
      description:
        'Aplica un JSON Patch (RFC 6902; solo add/replace/remove/test, sin move/copy) a un ' +
        'escenario, valida el resultado contra su modelo y solo si valida lo escribe a disco. Sin ' +
        '`saveTo`, parchea `scenario` en sitio (escenario resuelto completo, sin `extends`). Con ' +
        '`saveTo`, crea un archivo nuevo con `extends` hacia `extendsFrom` (por defecto, el propio ' +
        '`scenario`) y solo las claves que tocó el patch — como `to-be-3-cajeros.scenario.json`. ' +
        'Devuelve el escenario resultante ya resuelto, la ruta escrita y `notes` con los avisos de ' +
        'lint. Un patch que deja el escenario inválido (`probability` fuera de `[0,1]`, `capacity` ' +
        '< 1, una `ref` que no existe en `resources`, …) se rechaza sin escribir nada.',
      inputSchema: z.object({
        scenario: z.string().describe('Ruta al escenario .json a leer y patchear, relativa al cwd.'),
        patch: z
          .array(
            z.object({
              op: z.string().describe('add | replace | remove | test (move/copy no soportadas).'),
              path: z.string().describe('Puntero RFC 6901, p. ej. "/resources/cajero/capacity".'),
              value: z.unknown().optional().describe('Requerido por add/replace/test.'),
              from: z.string().optional().describe('No usado: move/copy no están implementadas.'),
            }),
          )
          .min(1),
        saveTo: z
          .string()
          .optional()
          .describe('Ausente: escribe sobre `scenario`. Presente: crea un escenario nuevo con `extends` ahí.'),
        extendsFrom: z
          .string()
          .optional()
          .describe('Padre del `extends` del archivo nuevo (solo con `saveTo`). Por defecto, `scenario`.'),
        name: z.string().optional().describe('Nombre del escenario resultante; por defecto, uno generado.'),
        description: z.string().optional().describe('Descripción del escenario resultante.'),
      }),
    },
    patchScenario,
  );

  return server;
}
