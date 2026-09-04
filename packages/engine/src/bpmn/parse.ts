/**
 * `parseBpmn`: XML de BPMN 2.0 -> `ProcessIR`.
 *
 * Vive fuera de `core/`, así que sí puede importar `bpmn-moddle`. A cambio, no lee disco ni
 * red: recibe el XML ya leído como cadena (quien abre el archivo es la CLI). Funciona en Node
 * puro: bpmn-moddle usa `saxen`, no `DOMParser` ni `window`.
 *
 * Reglas: el `id` BPMN es la única clave (nunca el nombre), el perfil soportado es el de
 * `docs/SEMANTICS.md` sección 2 y el aplanado de subprocesos y call activities es su sección 4.
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import lila from './lila.moddle.json' with { type: 'json' };
import { newId, sanitizeXmlIds } from './ids.js';
import type { Flow, Node, NodeType, ProcessIR } from '../core/ir.js';

/** Toda variante de tarea se aplana a `task` (R-PERF-1); la call activity también (R-PLAN-4). */
const TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
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

/**
 * Elemento del XML que quedó fuera del IR por no estar en el perfil soportado
 * (`docs/SEMANTICS.md` § 2). El parser solo devuelve el dato en bruto: componer el mensaje
 * `E-NOSOP` con el catálogo de la sección 3 es LILA-021.
 */
export interface UnsupportedElement {
  id: string;
  /** Nombre calificado BPMN tal como lo reporta moddle, p. ej. `bpmn:BoundaryEvent`. */
  qname: string;
  /** Nombre visible, o cadena vacía si el elemento no lo declara. */
  name: string;
}

/** Un `bpmn:subProcess` embebido: solo existe hasta que se aplana (R-PLAN-1). */
interface SubprocessBox {
  id: string;
  startIds: string[];
  endIds: string[];
}

interface Collector {
  nodes: Record<string, Node>;
  flows: Record<string, Flow>;
  originalIds: Record<string, string>;
  /**
   * `id sanitizado -> id original`, para los ids del documento que no eran NCName válido
   * (p. ej. los que puede emitir Bizagi) y ya se reescribieron en el texto del XML por
   * `sanitizeXmlIds` antes de llegar aquí — `el.id` de moddle ya es el id sanitizado. Sirve
   * solo para poblar `source.originalIds` con el id que traía el archivo.
   */
  sanitizedToOriginal: Map<string, string>;
  /** Ids ya ocupados: nodos, flujos y subprocesos comparten el espacio de ids. */
  used: Set<string>;
  /** Id final de cada elemento moddle, que solo difiere del suyo si hubo colisión. */
  idOf: Map<ModdleElement, string>;
  laneOf: Map<string, string>;
  defaultFlowIds: Set<string>;
  sequenceFlows: ModdleElement[];
  /** Subprocesos en post-orden: el más interno se aplana primero. */
  boxes: SubprocessBox[];
  boxIds: Set<string>;
  /** Posición en el documento de cada `flowElement`, para ordenar `unsupported`. */
  order: Map<ModdleElement, number>;
  /** Elementos fuera del perfil soportado, ya descartados del IR. */
  unsupportedEls: Set<ModdleElement>;
  unsupported: { at: number; element: UnsupportedElement }[];
}

/**
 * Id definitivo del elemento. `el.id` ya viene sanitizado si el XML lo necesitaba
 * (`sanitizeXmlIds`, aplicado antes de `moddle.fromXML`), así que aquí solo queda la rama de
 * colisión, que se activa con archivos mal formados o al aplanar ids que ya venían repetidos.
 * El id nuevo (o el sanitizado) queda registrado en `source.originalIds`.
 */
function claimId(el: ModdleElement, c: Collector): string {
  const cached = c.idOf.get(el);
  if (cached !== undefined) return cached;

  let id = el.id;
  if (c.used.has(id)) id = newId(el.$type.replace('bpmn:', ''));

  c.used.add(id);
  c.originalIds[id] = c.sanitizedToOriginal.get(el.id) ?? el.id;
  c.idOf.set(el, id);
  return id;
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

/**
 * Recorre un contenedor (`bpmn:process` o `bpmn:subProcess`) en orden de documento y registra
 * sus nodos. Los subprocesos embebidos se recorren en línea, así que el IR sale ya plano salvo
 * por el recableado, que hace `flattenBox`.
 */
function walk(container: ModdleElement, subprocessId: string | undefined, c: Collector): void {
  collectLanes(container.laneSets ?? [], c.laneOf);

  for (const el of container.flowElements ?? []) {
    c.order.set(el, c.order.size);

    if (el.$type === 'bpmn:SequenceFlow') {
      c.sequenceFlows.push(el);
      continue;
    }
    if (el.default) c.defaultFlowIds.add(el.default.id);

    // `bpmn:transaction`, `bpmn:adHocSubProcess` y el subproceso de eventos no son perfil
    // soportado (docs/SEMANTICS.md § 3): no se aplanan, se omiten como cualquier no soportado.
    if (el.$type === 'bpmn:SubProcess' && el.triggeredByEvent !== true) {
      const id = claimId(el, c);
      c.boxIds.add(id);
      walk(el, id, c);

      const box: SubprocessBox = { id, startIds: [], endIds: [] };
      for (const child of el.flowElements ?? []) {
        const childId = c.idOf.get(child);
        if (childId === undefined) continue;
        const type = c.nodes[childId]?.type;
        // `terminate` no es pass-through: mata el caso entero (R-EVT-5), sobrevive al aplanado.
        if (type === 'start') box.startIds.push(childId);
        else if (type === 'end') box.endIds.push(childId);
      }
      // Post-orden: el subproceso más interno se aplana antes que el que lo contiene.
      c.boxes.push(box);
      continue;
    }

    const type = nodeTypeOf(el);
    // Lo que está fuera del perfil (boundary events, gateways complejos, marcadores de bucle…)
    // no entra al IR, pero se devuelve en `ParseResult.unsupported` para que LILA-021 pueda
    // emitir `E-NOSOP` sin volver a leer el XML.
    if (type === undefined) {
      c.unsupportedEls.add(el);
      c.unsupported.push({
        at: c.order.get(el) ?? c.order.size,
        element: { id: el.id, qname: el.$type, name: el.name ?? '' },
      });
      continue;
    }

    const id = claimId(el, c);
    const lane = c.laneOf.get(el.id);
    c.nodes[id] = {
      type,
      name: el.name ?? '',
      ...(lane === undefined ? {} : { lane }),
      ...(subprocessId === undefined ? {} : { subprocessId }),
      incoming: [],
      outgoing: [],
    };
  }
}

/**
 * Aplana un subproceso embebido (R-PLAN-1 y R-PLAN-2): el subproceso desaparece como nodo, sus
 * flujos entrantes pasan a apuntar al sucesor del `start` interno y los flujos que entraban a
 * cada `end` interno pasan a apuntar al destino de la salida del subproceso. El `start` y el
 * `end` internos desaparecen: son pass-through, y el IR no tiene un tipo de nodo pass-through
 * (dejarlos como `start`/`end` los convertiría en generador de casos y en sumidero de tokens,
 * que es justo lo que R-PLAN-2 y R-PLAN-5 prohíben).
 */
function flattenBox(box: SubprocessBox, c: Collector): void {
  const entries = Object.entries(c.flows);
  const inflowIds = entries.filter(([, f]) => f.to === box.id).map(([id]) => id);
  const outflowIds = entries.filter(([, f]) => f.from === box.id).map(([id]) => id);

  // ponytail: con varios `start` internos solo se recablea el primero; los demás quedan como
  // nodos `start` sueltos. Techo: un subproceso multi-start (poco frecuente) arranca una sola
  // rama. Camino: emitir un `and` fork sintético si aparece un caso real que lo pida.
  const firstStart = box.startIds[0];
  if (inflowIds.length > 0 && firstStart !== undefined) {
    const startOut = entries.filter(([, f]) => f.from === firstStart);
    const entry = startOut[0]?.[1].to;
    if (entry !== undefined) {
      for (const id of inflowIds) c.flows[id]!.to = entry;
      for (const [id] of startOut) delete c.flows[id];
      delete c.nodes[firstStart];
    }
  }

  // Con varios `end` internos, todos apuntan a la salida del subproceso (R-PLAN-2).
  const exit = outflowIds[0] === undefined ? undefined : c.flows[outflowIds[0]]?.to;
  if (exit !== undefined) {
    for (const endId of box.endIds) {
      for (const [id, flow] of entries) {
        if (flow.to === endId && c.flows[id] !== undefined) c.flows[id]!.to = exit;
      }
      delete c.nodes[endId];
    }
  }

  // Lo que quede tocando al subproceso (sus salidas ya recableadas, o flujos que no se pudieron
  // recablear porque el subproceso no declara start/end) se elimina: el subproceso ya no existe
  // como nodo y un flujo colgante rompería el IR.
  for (const [id, flow] of Object.entries(c.flows)) {
    if (flow.from === box.id || flow.to === box.id) delete c.flows[id];
  }
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
  /**
   * Elementos del XML que no entraron al IR por estar fuera del perfil soportado, en orden de
   * aparición en el documento: los nodos no soportados y los `sequenceFlow` descartados por
   * tocarlos. `parseBpmn` no emite el error ni formatea el texto — eso es LILA-021.
   */
  unsupported: UnsupportedElement[];
}

function isNonEmptyProcess(el: ModdleElement): boolean {
  return (el.flowElements ?? []).length > 0;
}

/**
 * Lee el XML con bpmn-moddle (con la extensión `lila` cargada) y produce el IR ya aplanado.
 *
 * Antes de tocar bpmn-moddle, sanitiza en el propio texto del XML los ids que no son NCName
 * válido (`sanitizeXmlIds`): moddle-xml descarta de raíz cualquier elemento cuyo `id` no pase
 * su validación, así que un id ajeno inválido (algunos exports de Bizagi) tiene que arreglarse
 * antes de que bpmn-moddle lo vea, no después.
 */
export async function parseBpmn(xmlIn: string): Promise<ParseResult> {
  const { xml, sanitizedToOriginal } = sanitizeXmlIds(xmlIn);
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

  const c: Collector = {
    nodes: {},
    flows: {},
    originalIds: {},
    sanitizedToOriginal,
    used: new Set(),
    idOf: new Map(),
    laneOf: new Map(),
    defaultFlowIds: new Set(),
    sequenceFlows: [],
    boxes: [],
    boxIds: new Set(),
    order: new Map(),
    unsupportedEls: new Set(),
    unsupported: [],
  };

  walk(main, undefined, c);

  for (const el of c.sequenceFlows) {
    const from = el.sourceRef === undefined ? undefined : c.idOf.get(el.sourceRef);
    const to = el.targetRef === undefined ? undefined : c.idOf.get(el.targetRef);
    // Un flujo hacia un elemento fuera del perfil se omite en vez de dejarlo colgante, y se
    // reporta junto a él.
    if (from === undefined || to === undefined) {
      const touchesUnsupported =
        (el.sourceRef !== undefined && c.unsupportedEls.has(el.sourceRef)) ||
        (el.targetRef !== undefined && c.unsupportedEls.has(el.targetRef));
      if (touchesUnsupported) {
        c.unsupported.push({
          at: c.order.get(el) ?? c.order.size,
          element: { id: el.id, qname: el.$type, name: el.name ?? '' },
        });
      }
      continue;
    }

    c.flows[claimId(el, c)] = {
      from,
      to,
      name: el.name ?? '',
      isDefault: c.defaultFlowIds.has(el.id),
    };
  }

  for (const box of c.boxes) flattenBox(box, c);

  // `incoming`/`outgoing` se derivan al final, con los flujos ya recableados, en orden de
  // aparición en el documento.
  for (const [id, flow] of Object.entries(c.flows)) {
    c.nodes[flow.from]?.outgoing.push(id);
    c.nodes[flow.to]?.incoming.push(id);
  }

  const originalIds: Record<string, string> = {};
  for (const id of [...Object.keys(c.nodes), ...Object.keys(c.flows)]) {
    originalIds[id] = c.originalIds[id] ?? id;
  }

  return {
    ir: {
      id: main.id,
      name: main.name ?? '',
      nodes: c.nodes,
      flows: c.flows,
      source: {
        exporter: definitions.exporter ?? '',
        exporterVersion: definitions.exporterVersion ?? '',
        originalIds,
      },
    },
    ignoredProcessIds: processes.filter((el) => el !== main).map((el) => el.id),
    unsupported: c.unsupported.sort((a, b) => a.at - b.at).map(({ element }) => element),
  };
}

/**
 * Lee el XML con bpmn-moddle y lo vuelve a serializar tal cual, sin pasar por el IR. Existe
 * para probar que el round-trip conserva lo que `parseBpmn` descarta (namespaces ajenos como
 * `bizagi:*`, que bpmn-moddle preserva de fábrica al no tener registrado su propio descriptor)
 * y porque la app (LILA-020+) la va a necesitar para exportar de vuelta al formato original.
 *
 * Mismo saneo de ids que `parseBpmn` y por la misma razón: un id no-NCName sin sanitizar hace
 * que moddle-xml descarte el elemento entero al leerlo (con sus `bizagi:*` adentro), antes de
 * que haya nada que reserializar.
 */
export async function roundTripXml(xmlIn: string): Promise<string> {
  const { xml } = sanitizeXmlIds(xmlIn);
  const moddle = BpmnModdle({ lila });
  const { rootElement } = await moddle.fromXML(xml);
  const { xml: out } = await moddle.toXML(rootElement);
  return out;
}
