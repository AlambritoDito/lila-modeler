/**
 * `validate`: comprueba que un `ProcessIR` (y lo que el parser descartó al construirlo) cabe en
 * el perfil soportado y es estructuralmente simulable.
 *
 * Vive en `bpmn/` y no en `core/` porque su insumo principal —la lista de elementos fuera de
 * perfil— la produce el parser: el IR ya no los contiene. No lee XML ni disco: recibe el
 * `ParseResult` ya construido.
 *
 * El texto de los errores `E-NOSOP` es normativo y sale literal de `docs/SEMANTICS.md` § 3
 * (R-NOSOP-1 y R-NOSOP-2); los códigos, de la § 17.
 */
import { validateIr, type IrProblem, type ProcessIR, type SourceWarning } from '../core/ir.js';
import type { UnsupportedElement } from './parse.js';

/**
 * Errores (abortan: la CLI sale con 1 y `simulate` se niega a correr, R-NOSOP-4) y avisos (no
 * abortan) por separado, tal como los distingue `docs/SEMANTICS.md` § 17.
 */
export interface ValidationResult {
  errors: IrProblem[];
  warnings: ValidationWarning[];
}

export interface ValidationWarning {
  code: 'W-MSGFLOW' | 'W-COND' | 'W-PARSE' | 'W-XOR-DEFAULT-ROTO';
  id: string;
  message: string;
}

/** Segundo argumento de `validate`: lo que el parser sabe y el IR ya no. */
export interface ValidateOptions {
  /** `ParseResult.unsupported`, en orden de aparición en el documento. */
  unsupported?: readonly UnsupportedElement[];
  /** `ParseResult.messageFlowCount`; se agrega en un solo W-MSGFLOW por archivo. */
  messageFlowCount?: number;
  /** `ParseResult.conditionFlowIds`; un W-COND por sequence flow. */
  conditionFlowIds?: readonly string[];
}

/**
 * `{construcción}` de R-NOSOP-2, por `$type` de moddle. Catálogo cerrado: ningún otro texto es
 * válido.
 */
const CONSTRUCTIONS: Record<string, string> = {
  'bpmn:BoundaryEvent': 'evento adjunto a actividad (boundary event)',
  'bpmn:IntermediateThrowEvent': 'evento intermedio de lanzamiento',
  'bpmn:EventBasedGateway': 'gateway basado en eventos',
  'bpmn:ComplexGateway': 'gateway complejo',
  'bpmn:Transaction': 'subproceso transaccional',
  'bpmn:AdHocSubProcess': 'subproceso ad-hoc',
  // El parser solo descarta un `bpmn:subProcess` cuando es `triggeredByEvent="true"`; el
  // embebido lo aplana (R-PLAN-1), así que aquí solo llega el subproceso de eventos.
  'bpmn:SubProcess': 'subproceso de eventos',
  'bpmn:ChoreographyTask': 'diagrama de coreografía',
  'bpmn:Choreography': 'diagrama de coreografía',
  'bpmn:GlobalChoreographyTask': 'diagrama de coreografía',
  'bpmn:Conversation': 'diagrama de conversación',
  'bpmn:CallConversation': 'diagrama de conversación',
  'bpmn:SubConversation': 'diagrama de conversación',
};

/**
 * Elementos que **sí** están en el perfil (§ 2: «se leen y se preservan, no afectan a la
 * simulación») pero que no son nodos del grafo de tokens, así que el parser los deja fuera del
 * IR y los devuelve en `unsupported`. No son error.
 */
const NOT_A_NODE = new Set([
  'bpmn:DataObject',
  'bpmn:DataObjectReference',
  'bpmn:DataStore',
  'bpmn:DataStoreReference',
  'bpmn:TextAnnotation',
  'bpmn:Association',
  'bpmn:Group',
  // Un sequence flow descartado por tocar un elemento no soportado viaja en la misma lista,
  // pero no es la causa: el error es el nodo, y duplicarlo solo sería ruido.
  'bpmn:SequenceFlow',
]);

/**
 * Respaldo para listas `unsupported` construidas a mano por consumidores antiguos. LILA-163 hace
 * que `parseBpmn` entregue siempre la construcción concreta del catálogo cuando puede detectarla.
 */
const FALLBACK_CONSTRUCTION = 'elemento fuera del perfil v1';

/** `bpmn:BoundaryEvent` (moddle) -> `bpmn:boundaryEvent` (nombre calificado del XML, R-NOSOP-1). */
function xmlQName(qname: string): string {
  const colon = qname.indexOf(':');
  const local = qname.slice(colon + 1);
  return `${qname.slice(0, colon + 1)}${local.charAt(0).toLowerCase()}${local.slice(1)}`;
}

function unsupportedProblem(el: UnsupportedElement): IrProblem {
  const qname = xmlQName(el.qname);
  const head = el.name === '' ? `${el.id} (${qname})` : `${el.id} (${qname}, "${el.name}")`;
  const construction = el.construction ?? CONSTRUCTIONS[el.qname] ?? FALLBACK_CONSTRUCTION;
  return {
    code: 'E-NOSOP',
    id: el.id,
    message: `${head}: ${construction} no soportado por el simulador.`,
  };
}

/**
 * `unparsable content <X> ... nested error: illegal ID <Y>` / `... duplicate ID <Y>`: moddle-xml
 * tiró el elemento entero (y todo su contenido) al leer el XML. Un `unknown type <...>` también
 * es "unparsable content", pero lo que se pierde ahí es un elemento que el perfil no conoce
 * (`bpmn:LoopCounter` de Bizagi, extensiones ajenas): no era ni iba a ser un nodo del IR.
 */
const DISCARDED_ID_MESSAGE = /(?:illegal|duplicate) ID </;

/** Nombre calificado del elemento que moddle no pudo leer, en `unparsable content <bpmn:task>`. */
const UNPARSABLE_QNAME = /unparsable content <([^\s>/]+)>/;

/**
 * Prefijos de la capa de diagrama (BPMN DI: `bpmndi`, `di`, `dc`, `dd`). Es geometría pura —
 * `parseBpmn` no la lee y el IR no la guarda —, así que un id repetido o ilegal ahí descarta una
 * forma del dibujo, nunca un nodo ni un flujo: se queda en `W-PARSE` (R-NOSOP-6).
 */
const DIAGRAM_PREFIXES = new Set(['bpmndi', 'di', 'dc', 'dd']);

/**
 * Elementos que la sección 2 «lee y preserva» pero no simula: no son nodos ni flujos del grafo de
 * tokens, así que perder uno no deja el modelo incompleto (LILA-196). Nombres locales del XML.
 */
const NOT_A_GRAPH_ELEMENT = new Set([
  'dataObject',
  'dataObjectReference',
  'dataStore',
  'dataStoreReference',
  'textAnnotation',
  'association',
  'group',
  'documentation',
  'extensionElements',
  'laneSet',
  'lane',
]);

/**
 * ¿Lo que moddle descartó habría sido nodo o flujo del proceso simulado? La capa de diagrama y los
 * elementos de la lista de arriba no entran al IR; cualquier otro descarte cuenta como pérdida,
 * incluido el de un tipo desconocido: más vale abortar que simular un grafo con un nodo menos.
 */
function discardsGraphElement(message: string): boolean {
  const qname = UNPARSABLE_QNAME.exec(message)?.[1];
  if (qname === undefined) return true;
  const colon = qname.indexOf(':');
  if (colon !== -1 && DIAGRAM_PREFIXES.has(qname.slice(0, colon))) return false;
  return !NOT_A_GRAPH_ELEMENT.has(qname.slice(colon + 1));
}

/**
 * Propiedades de moddle-xml que son topología del grafo de tokens: una referencia rota ahí
 * significa que un nodo o un flujo desapareció del IR sin dejar rastro. Las demás que
 * bpmn-moddle reporta en los exports reales (`bpmn:messageRef`, `bpmn:dataStoreRef`,
 * `bpmn:categoryValueRef`, …) cuelgan de construcciones que el perfil v1 ya ignora (mensajes,
 * data stores, categorías): una referencia rota ahí no descarta nada del grafo.
 *
 * `bpmn:default` e `bpmn:incoming`/`bpmn:outgoing` no están aquí aunque sean topología: no
 * descartan nada por sí mismos y tienen su propio aviso (LILA-196).
 */
const GRAPH_REFERENCE_PROPERTIES = new Set([
  'bpmn:sourceRef',
  'bpmn:targetRef',
  'bpmn:attachedToRef',
  'bpmn:flowNodeRef',
]);

/**
 * `docs/SEMANTICS.md` R-NOSOP-6: los cinco desenlaces de un aviso de bpmn-moddle. Solo `perdida`
 * aborta; los demás avisan sin mentir sobre lo que se perdió (LILA-196).
 */
type ParseWarningKind =
  /** Se fue del grafo un nodo o un flujo del proceso simulado: `E-PARSE-INCOMPLETO`. */
  | 'perdida'
  /** El aviso es de otro `bpmn:process` del archivo, que Lila no simula. */
  | 'otro-proceso'
  /** Un `bpmn:incoming`/`bpmn:outgoing` que nombra un flujo ausente del modelo cargado. */
  | 'flujo-ausente'
  /** `bpmn:default` roto: solo se pierde la marca `isDefault` (§ 6, R-XOR-1/2). */
  | 'default-roto'
  /** Cualquier otro aviso: no toca el grafo. */
  | 'inofensivo';

function classifyParseWarning(w: SourceWarning, processId: string): ParseWarningKind {
  // Los avisos son del archivo entero y el IR es de un solo proceso: lo que se perdió en otro
  // pool no puede dejar incompleto el que se simula.
  if (w.processId !== undefined && w.processId !== processId) return 'otro-proceso';
  if (w.property === 'bpmn:default') return 'default-roto';
  if (w.property === 'bpmn:incoming' || w.property === 'bpmn:outgoing') return 'flujo-ausente';
  if (DISCARDED_ID_MESSAGE.test(w.message)) {
    return discardsGraphElement(w.message) ? 'perdida' : 'inofensivo';
  }
  return w.property !== undefined && GRAPH_REFERENCE_PROPERTIES.has(w.property)
    ? 'perdida'
    : 'inofensivo';
}

/** Texto normativo de R-NOSOP-6; `w.message` es el aviso de moddle, ya aplanado a una línea. */
function parseWarningProblem(w: SourceWarning, fallbackId: string): IrProblem {
  const id = w.elementId ?? fallbackId;
  return {
    code: 'E-PARSE-INCOMPLETO',
    id,
    message: `${id}: el lector XML descartó contenido del modelo, que quedó incompleto: ${w.message}.`,
  };
}

/** Textos normativos de R-NOSOP-6 para los avisos que no abortan, uno por caso. */
function parseWarningNotice(
  w: SourceWarning,
  kind: Exclude<ParseWarningKind, 'perdida'>,
  fallbackId: string,
): ValidationWarning {
  const id = w.elementId ?? fallbackId;
  if (kind === 'otro-proceso') {
    return {
      code: 'W-PARSE',
      id,
      message: `${id}: aviso del lector XML en ${w.processId}, otro proceso del archivo que Lila no simula: ${w.message}.`,
    };
  }
  if (kind === 'flujo-ausente') {
    return {
      code: 'W-PARSE',
      id,
      message: `${id}: el lector XML no encontró un flujo que este elemento declara; el grafo se construye sin él: ${w.message}.`,
    };
  }
  if (kind === 'default-roto') {
    return {
      code: 'W-XOR-DEFAULT-ROTO',
      id,
      message: `${id}: el flujo por defecto declarado no existe; se ignora la marca isDefault y el reparto sigue las reglas del XOR sin default: ${w.message}.`,
    };
  }
  return {
    code: 'W-PARSE',
    id,
    message: `${id}: aviso del lector XML, sin pérdida de nodos ni flujos: ${w.message}.`,
  };
}

/** Ids alcanzables siguiendo los flujos salientes desde cada `start`. */
function reachableFrom(ir: ProcessIR, starts: string[]): Set<string> {
  const seen = new Set<string>(starts);
  const pending = [...starts];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const flowId of ir.nodes[id]?.outgoing ?? []) {
      const next = ir.flows[flowId]?.to;
      if (next !== undefined && !seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return seen;
}

/**
 * Devuelve **todos** los problemas en una pasada, nunca se detiene en el primero (R-NOSOP-3):
 * primero los `E-NOSOP` en orden de aparición en el XML, después los estructurales en orden de
 * aparición en el IR.
 *
 * Un modelo sin errores devuelve `errors: []`; los avisos no impiden simular.
 */
export function validate(ir: ProcessIR, opts: ValidateOptions = {}): ValidationResult {
  const errors: IrProblem[] = [];
  const warnings: ValidationWarning[] = [];

  for (const el of opts.unsupported ?? []) {
    if (NOT_A_NODE.has(el.qname)) continue;
    errors.push(unsupportedProblem(el));
  }

  for (const w of ir.source.warnings) {
    const kind = classifyParseWarning(w, ir.id);
    if (kind === 'perdida') errors.push(parseWarningProblem(w, ir.id));
    else warnings.push(parseWarningNotice(w, kind, ir.id));
  }

  if ((opts.messageFlowCount ?? 0) > 0) {
    const count = opts.messageFlowCount!;
    warnings.push({
      code: 'W-MSGFLOW',
      id: ir.id,
      message: `${ir.id}: se ignoraron ${count} flujos de mensaje (bpmn:messageFlow).`,
    });
  }
  for (const flowId of opts.conditionFlowIds ?? []) {
    warnings.push({
      code: 'W-COND',
      id: flowId,
      message: `${flowId}: conditionExpression se ignora; el ramaje es probabilístico.`,
    });
  }

  // Flujo colgante, id duplicado y referencia inexistente (E-FLUJO-COLGANTE, E-ID-DUPLICADO,
  // E-REF-INEXISTENTE) ya los cubre `core/`.
  errors.push(...validateIr(ir));

  const starts: string[] = [];
  let hasEnd = false;
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.type === 'start') starts.push(id);
    if (node.type === 'end' || node.type === 'terminate') hasEnd = true;

    if (node.type === 'xor' || node.type === 'or' || node.type === 'and') {
      // Un gateway con una entrada y una salida es pass-through legítimo (R-AND-6, R-PERF-2):
      // solo se exige que tenga al menos una de cada.
      if (node.incoming.length === 0 || node.outgoing.length === 0) {
        errors.push({
          code: 'E-GATEWAY-SIN-ARISTAS',
          id,
          message: `${id}: el gateway no tiene ${node.incoming.length === 0 ? 'entradas' : 'salidas'}.`,
        });
      }
    }
  }

  if (starts.length === 0) {
    errors.push({
      code: 'E-SIN-START',
      id: ir.id,
      message: `${ir.id}: el proceso no tiene ningún evento de inicio.`,
    });
  }
  if (!hasEnd) {
    errors.push({
      code: 'E-SIN-END',
      id: ir.id,
      message: `${ir.id}: el proceso no tiene ningún evento de fin ni terminate.`,
    });
  }

  // Sin `start` no hay nada alcanzable: repetir el diagnóstico nodo a nodo solo taparía el
  // error de verdad, que es `E-SIN-START`.
  if (starts.length > 0) {
    const reachable = reachableFrom(ir, starts);
    for (const id of Object.keys(ir.nodes)) {
      if (!reachable.has(id)) {
        errors.push({
          code: 'E-INALCANZABLE',
          id,
          message: `${id}: el nodo no es alcanzable desde ningún evento de inicio.`,
        });
      }
    }
  }

  return { errors, warnings };
}
