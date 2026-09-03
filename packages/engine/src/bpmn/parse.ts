/**
 * `parseBpmn`: XML de BPMN 2.0 -> `ProcessIR`.
 *
 * Vive fuera de `core/`, así que sí puede importar `bpmn-moddle`. A cambio, no lee disco ni
 * red: recibe el XML ya leído como cadena (quien abre el archivo es la CLI). Funciona en Node
 * puro: bpmn-moddle usa `saxen`, no `DOMParser` ni `window`.
 *
 * Reglas: el `id` BPMN es la única clave (nunca el nombre) y el perfil soportado es el de
 * `docs/SEMANTICS.md` sección 2.
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import lila from './lila.moddle.json' with { type: 'json' };
import type { Flow, Node, NodeType, ProcessIR } from '../core/ir.js';

/** Toda variante de tarea se aplana a `task` (R-PERF-1). */
const TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
]);

const GATEWAY_TYPES: Record<string, NodeType> = {
  'bpmn:ExclusiveGateway': 'xor',
  'bpmn:InclusiveGateway': 'or',
  'bpmn:ParallelGateway': 'and',
};

function hasEventDefinition(el: ModdleElement, type: string): boolean {
  return (el.eventDefinitions ?? []).some((definition) => definition.$type === type);
}

/** Tipo del IR para un elemento moddle, o `undefined` si está fuera del perfil soportado. */
function nodeTypeOf(el: ModdleElement): NodeType | undefined {
  if (TASK_TYPES.has(el.$type)) return 'task';

  const gateway = GATEWAY_TYPES[el.$type];
  if (gateway !== undefined) return gateway;

  switch (el.$type) {
    case 'bpmn:StartEvent':
      return 'start';
    case 'bpmn:EndEvent':
      return hasEventDefinition(el, 'bpmn:TerminateEventDefinition') ? 'terminate' : 'end';
    case 'bpmn:IntermediateCatchEvent':
      return hasEventDefinition(el, 'bpmn:TimerEventDefinition') ? 'timer' : undefined;
    default:
      return undefined;
  }
}

/** `id de nodo -> etiqueta del carril`, recursivo por `childLaneSet`. */
function collectLanes(laneSets: readonly ModdleElement[], laneOf: Map<string, string>): void {
  for (const laneSet of laneSets) {
    for (const lane of laneSet.lanes ?? []) {
      const label = lane.name ?? lane.id;
      for (const ref of lane.flowNodeRef ?? []) laneOf.set(ref.id, label);
      if (lane.childLaneSet) collectLanes([lane.childLaneSet], laneOf);
    }
  }
}

function isNonEmptyProcess(el: ModdleElement): boolean {
  return (el.flowElements ?? []).length > 0;
}

export interface ParseResult {
  ir: ProcessIR;
  /**
   * Ids de los demás `bpmn:process` del archivo, que no se parsearon. Multiproceso: el IR es
   * de **un** proceso (un solo grafo de tokens, `LILA_MODELER_ESTRUCTURA.md` § 6), así que se
   * toma el primer `bpmn:process` ejecutable y no vacío; si ninguno es ejecutable, el primero
   * no vacío. Los demás se listan aquí para que la CLI avise, no se simulan.
   */
  ignoredProcessIds: string[];
}

/** Lee el XML con bpmn-moddle (con la extensión `lila` cargada) y produce el IR. */
export async function parseBpmn(xml: string): Promise<ParseResult> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(xml);

  const processes = (definitions.rootElements ?? []).filter((el) => el.$type === 'bpmn:Process');
  const main =
    processes.find((el) => el.isExecutable === true && isNonEmptyProcess(el)) ??
    processes.find(isNonEmptyProcess) ??
    processes[0];
  if (main === undefined) {
    throw new Error('El archivo no contiene ningún bpmn:process.');
  }

  const laneOf = new Map<string, string>();
  collectLanes(main.laneSets ?? [], laneOf);

  const nodes: Record<string, Node> = {};
  const flows: Record<string, Flow> = {};
  const defaultFlowIds = new Set<string>();
  const sequenceFlows: ModdleElement[] = [];

  // Una sola pasada en orden de documento: así `incoming`/`outgoing` y las claves del IR
  // quedan en orden de aparición, y el snapshot es determinista.
  for (const el of main.flowElements ?? []) {
    if (el.$type === 'bpmn:SequenceFlow') {
      sequenceFlows.push(el);
      continue;
    }
    if (el.default) defaultFlowIds.add(el.default.id);

    const type = nodeTypeOf(el);
    // ponytail: lo que está fuera del perfil (boundary events, subprocesos, call activities,
    // gateways complejos…) se omite del IR en lugar de reportarse. Techo: el usuario no se
    // entera de por qué falta un nodo. Camino: LILA-019 aplana subproceso y call activity, y
    // LILA-021 emite E-NOSOP con el catálogo de docs/SEMANTICS.md § 3.
    if (type === undefined) continue;

    const lane = laneOf.get(el.id);
    nodes[el.id] = {
      type,
      name: el.name ?? '',
      ...(lane === undefined ? {} : { lane }),
      incoming: [],
      outgoing: [],
    };
  }

  for (const el of sequenceFlows) {
    const from = el.sourceRef?.id ?? '';
    const to = el.targetRef?.id ?? '';
    const fromNode = nodes[from];
    const toNode = nodes[to];
    // Un flujo hacia un elemento fuera del perfil se omite en vez de dejarlo colgante
    // (ver el `ponytail` de arriba: el reporte es LILA-021).
    if (fromNode === undefined || toNode === undefined) continue;

    flows[el.id] = {
      from,
      to,
      name: el.name ?? '',
      isDefault: defaultFlowIds.has(el.id),
    };
    fromNode.outgoing.push(el.id);
    toNode.incoming.push(el.id);
  }

  // Identidad: aquí todavía no se reescribe ningún id (LILA-019 y LILA-020 sí lo harán).
  const originalIds: Record<string, string> = {};
  for (const id of [...Object.keys(nodes), ...Object.keys(flows)]) originalIds[id] = id;

  return {
    ir: {
      id: main.id,
      name: main.name ?? '',
      nodes,
      flows,
      source: {
        exporter: definitions.exporter ?? '',
        exporterVersion: definitions.exporterVersion ?? '',
        originalIds,
      },
    },
    ignoredProcessIds: processes.filter((el) => el !== main).map((el) => el.id),
  };
}
