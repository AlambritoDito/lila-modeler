/**
 * IR del proceso: la representación intermedia que consume el motor.
 *
 * Este archivo es `core/`: no importa nada (ni zod, ni bpmn-moddle, ni `node:*`, ni React).
 * El validador es manual y sin dependencias a propósito; el esquema zod del IR, si hace falta,
 * vive fuera de `core/`.
 *
 * Reglas fijas: el `id` BPMN es la única clave (nunca el nombre) y todos los tiempos van en
 * segundos. Ver `docs/SEMANTICS.md` y `LILA_MODELER_ESTRUCTURA.md` § 6.
 */

/** Tipos de nodo del perfil soportado. Toda variante de tarea se aplana a `task`. */
export type NodeType = 'start' | 'end' | 'terminate' | 'task' | 'xor' | 'or' | 'and' | 'timer';

/** Nodo del proceso, keyed por su `id` BPMN en `ProcessIR.nodes`. */
export interface Node {
  type: NodeType;
  name: string;
  /** Carril (pool/lane) al que pertenece, si el diagrama lo declara. */
  lane?: string;
  /** Id del `bpmn:subProcess` embebido del que proviene, tras aplanar (R-PLAN-1). */
  subprocessId?: string;
  /** Ids de los flujos entrantes, en orden de aparición. */
  incoming: string[];
  /** Ids de los flujos salientes, en orden de aparición. */
  outgoing: string[];
}

/** Sequence flow, keyed por su `id` BPMN en `ProcessIR.flows`. */
export interface Flow {
  /** Id del nodo origen. */
  from: string;
  /** Id del nodo destino. */
  to: string;
  name: string;
  /** `true` si es el flujo por defecto del gateway origen. */
  isDefault: boolean;
}

/**
 * Un aviso que `bpmn-moddle` emitió al leer el XML (`fromXML().warnings`), tal cual —
 * `parseBpmn` no los clasifica ni descarta, solo los conserva (LILA-185/#198). `validate(ir)`
 * es quien decide si cada uno implica un elemento descartado del grafo (`E-PARSE-INCOMPLETO`)
 * o es inofensivo (`W-PARSE`); ver `docs/SEMANTICS.md` § 3 y § 17.
 */
export interface SourceWarning {
  /** Texto de moddle, en una sola línea (sin los saltos de línea que trae "unparsable content"). */
  message: string;
  /** Id del elemento afectado, cuando moddle lo identifica o se puede extraer del mensaje. */
  elementId?: string;
  /** Propiedad de moddle-xml en la referencia rota (p. ej. `bpmn:sourceRef`), si el aviso es de ese tipo. */
  property?: string;
  /**
   * Id del `bpmn:process` donde ocurrió el aviso, cuando se puede ubicar. Los avisos son del
   * archivo entero y el IR es de **un** proceso: si este id no es el del proceso simulado, lo que
   * se perdió no estaba en el grafo (R-NOSOP-6).
   */
  processId?: string;
}

/** Procedencia del modelo: quién lo exportó y con qué ids venía. */
export interface IrSource {
  exporter: string;
  exporterVersion: string;
  /**
   * Ids originales del `.bpmn` por id del IR, para los casos en que el id se reescribe
   * (aplanado de subprocesos, desambiguación). Identidad cuando no se reescribió nada.
   */
  originalIds: Record<string, string>;
  /** Avisos de `bpmn-moddle` al leer el XML, en el orden en que los devolvió `fromXML`. */
  warnings: SourceWarning[];
}

/** Proceso completo. `nodes` y `flows` comparten el espacio de ids de BPMN. */
export interface ProcessIR {
  id: string;
  name: string;
  nodes: Record<string, Node>;
  flows: Record<string, Flow>;
  source: IrSource;
}

/** Códigos de error de validación (secciones 3 y 17 de `docs/SEMANTICS.md`). */
export type IrProblemCode =
  | 'E-NOSOP'
  | 'E-PARSE-INCOMPLETO'
  | 'E-FLUJO-COLGANTE'
  | 'E-ID-DUPLICADO'
  | 'E-REF-INEXISTENTE'
  | 'E-GATEWAY-SIN-ARISTAS'
  | 'E-INALCANZABLE'
  | 'E-SIN-START'
  | 'E-SIN-END';

/** Un problema estructural del IR, siempre atribuido a un id. */
export interface IrProblem {
  code: IrProblemCode;
  /** Id del nodo o flujo que lo provoca. */
  id: string;
  message: string;
}

/**
 * Valida la estructura del IR: flujos colgantes, ids duplicados entre nodos y flujos, y
 * referencias `incoming`/`outgoing` a flujos inexistentes.
 *
 * Devuelve la lista completa en una pasada, en orden de aparición (R-NOSOP-3). Un IR sin
 * problemas devuelve `[]`.
 *
 * El resto del catálogo (`E-NOSOP`, `E-GATEWAY-SIN-ARISTAS`, `E-INALCANZABLE`, `E-SIN-START`,
 * `E-SIN-END`) lo añade `bpmn/validate.ts`, que reutiliza esta función: vive fuera de `core/`
 * porque necesita los elementos no soportados que descartó el parser y que el IR ya no tiene.
 */
export function validateIr(ir: ProcessIR): IrProblem[] {
  const problems: IrProblem[] = [];

  for (const id of Object.keys(ir.nodes)) {
    if (Object.prototype.hasOwnProperty.call(ir.flows, id)) {
      problems.push({
        code: 'E-ID-DUPLICADO',
        id,
        message: `${id}: el id está declarado a la vez como nodo y como flujo.`,
      });
    }
  }

  for (const [id, node] of Object.entries(ir.nodes)) {
    for (const flowId of node.incoming) {
      if (!Object.prototype.hasOwnProperty.call(ir.flows, flowId)) {
        problems.push({
          code: 'E-REF-INEXISTENTE',
          id,
          message: `${id}: el flujo entrante ${flowId} no existe en el proceso.`,
        });
      }
    }
    for (const flowId of node.outgoing) {
      if (!Object.prototype.hasOwnProperty.call(ir.flows, flowId)) {
        problems.push({
          code: 'E-REF-INEXISTENTE',
          id,
          message: `${id}: el flujo saliente ${flowId} no existe en el proceso.`,
        });
      }
    }
  }

  for (const [id, flow] of Object.entries(ir.flows)) {
    if (!Object.prototype.hasOwnProperty.call(ir.nodes, flow.from)) {
      problems.push({
        code: 'E-FLUJO-COLGANTE',
        id,
        message: `${id}: el flujo sale del nodo ${flow.from}, que no existe en el proceso.`,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(ir.nodes, flow.to)) {
      problems.push({
        code: 'E-FLUJO-COLGANTE',
        id,
        message: `${id}: el flujo entra al nodo ${flow.to}, que no existe en el proceso.`,
      });
    }
  }

  return problems;
}
