/**
 * Servidor MCP de Lila Modeler (LILA-053): dos tools sobre `@lila/engine`, sin lógica propia.
 * `createServer()` solo registra tools; conectar un transporte (stdio, in-memory para tests) es
 * responsabilidad de quien lo use — ver `src/bin.ts` para el caso stdio real.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateBpmnXml, type ValidateBpmnReport } from '@lila/engine/bpmn';
import { resolveExtends, ScenarioSchema, type Scenario } from '@lila/engine/schema';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';

const NAME = 'lila-mcp';
const VERSION = '0.0.0';

/** Ruta absoluta relativa al cwd del proceso; `/` también en Windows (igual que `cli.ts`). */
function absolutePath(file: string): string {
  return resolve(process.cwd(), file).replaceAll('\\', '/');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
}

/**
 * `isError` marca que **la tool** falló (argumentos malos, archivo ilegible, XML impenetrable),
 * no que el modelo tenga errores de validación: eso es un resultado correcto y viaja en el JSON
 * (`errors[]`). Ver `docs/MCP.md`.
 */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Lee un JSON de disco; usado como `ScenarioReader` de `resolveExtends`. */
function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
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
    const parsed = ScenarioSchema.safeParse(resolveExtends(absolutePath(file), readJson));
    if (parsed.success) return { resources: resourceLines(parsed.data) };
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('; ');
    return { error: detail };
  } catch (error) {
    return { error: message(error) };
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

  return server;
}
