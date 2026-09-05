/**
 * Servidor MCP de Lila Modeler (LILA-053): dos tools sobre `@lila/engine`, sin lógica propia.
 * `createServer()` solo registra tools; conectar un transporte (stdio, in-memory para tests) es
 * responsabilidad de quien lo use — ver `src/bin.ts` para el caso stdio real.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateBpmnXml, type ValidateBpmnReport } from '@lila/engine/bpmn';
import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends, ScenarioSchema, type ResolvedScenario } from '@lila/engine/schema';
import type { ProcessIR } from '@lila/engine';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';

const NAME = 'lila-mcp';
const VERSION = '0.0.0';

/** Ruta absoluta relativa al cwd del proceso; `/` también en Windows (igual que `cli.ts`). */
function absolutePath(file: string): string {
  return resolve(process.cwd(), file).replaceAll('\\', '/');
}

function textResult(payload: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Lee un JSON de disco; usado como `ScenarioReader` de `resolveExtends`. */
function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
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

/** Arma el resumen legible en español pedido por LILA-053: nodos, gateways, lanes, subprocesos. */
function describeIr(ir: ProcessIR, resources: string[]): string {
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

  lines.push('');
  if (resources.length > 0) {
    lines.push('Recursos referenciados:');
    for (const line of resources) lines.push(`  ${line}`);
  } else {
    lines.push('Recursos referenciados: (sin escenario, o el escenario no referencia recursos)');
  }

  return lines.join('\n');
}

/** Referencias a recursos por elemento, a partir de un escenario ya resuelto (`extends` incluido). */
function resourceLines(scenario: ResolvedScenario): string[] {
  const lines: string[] = [];
  for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
    const refs = element.resources ?? [];
    if (refs.length === 0) continue;
    const parts = refs.map((use) => `${use.ref} x${use.quantity}`);
    lines.push(`${elementId}: ${parts.join(', ')}`);
  }
  return lines;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    'validate_bpmn',
    {
      title: 'Validar BPMN',
      description:
        'Parsea y valida un archivo .bpmn (por ruta o XML inline) y devuelve el mismo JSON que ' +
        '`lila validate --json`: el IR, los procesos ignorados, y errores/avisos estructurados. ' +
        'No lanza por un modelo inválido: isError es true cuando hay errores de validación.',
      inputSchema: z.object({
        path: z.string().optional().describe('Ruta al .bpmn, relativa al cwd del proceso.'),
        xml: z.string().optional().describe('Contenido XML del .bpmn, en vez de una ruta.'),
      }),
    },
    async ({ path, xml }): Promise<CallToolResult> => {
      if (path === undefined && xml === undefined) {
        return errorResult('validate_bpmn: hay que pasar `path` o `xml`.');
      }
      let content: string;
      if (xml !== undefined) {
        content = xml;
      } else {
        const file = absolutePath(path as string);
        if (!existsSync(file)) return errorResult(`validate_bpmn: no existe el archivo ${file}.`);
        content = readFileSync(file, 'utf8');
      }

      let report: ValidateBpmnReport;
      try {
        report = await validateBpmnXml(content);
      } catch (error) {
        return errorResult(`validate_bpmn: ${error instanceof Error ? error.message : String(error)}`);
      }
      return textResult(report, report.errors.length > 0);
    },
  );

  server.registerTool(
    'describe_process',
    {
      title: 'Describir proceso',
      description:
        'Parsea un .bpmn y devuelve su IR (ProcessIR) junto con un resumen legible en español: ' +
        'conteo de nodos por tipo, gateways con sus salidas, lanes y subprocesos. Con `scenario` ' +
        'opcional (ruta a un escenario .json), agrega los recursos referenciados por elemento.',
      inputSchema: z.object({
        path: z.string().describe('Ruta al .bpmn, relativa al cwd del proceso.'),
        scenario: z.string().optional().describe('Ruta a un escenario .json, relativa al cwd.'),
      }),
    },
    async ({ path, scenario }): Promise<CallToolResult> => {
      const modelFile = absolutePath(path);
      if (!existsSync(modelFile)) return errorResult(`describe_process: no existe el archivo ${modelFile}.`);

      let ir: ProcessIR;
      try {
        ir = (await parseBpmn(readFileSync(modelFile, 'utf8'))).ir;
      } catch (error) {
        return errorResult(`describe_process: ${error instanceof Error ? error.message : String(error)}`);
      }

      let resources: string[] = [];
      let scenarioWarning: string | undefined;
      if (scenario !== undefined) {
        try {
          const scenarioFile = absolutePath(scenario);
          const raw = resolveExtends(scenarioFile, readJson);
          const parsed = ScenarioSchema.safeParse(raw);
          if (parsed.success) {
            resources = resourceLines(parsed.data as ResolvedScenario);
          } else {
            scenarioWarning = `no se pudo leer el escenario: ${parsed.error.message}`;
          }
        } catch (error) {
          scenarioWarning = `no se pudo leer el escenario: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      const resumen = describeIr(ir, resources) + (scenarioWarning === undefined ? '' : `\n\n${scenarioWarning}`);
      return textResult({ ir, resumen });
    },
  );

  return server;
}
