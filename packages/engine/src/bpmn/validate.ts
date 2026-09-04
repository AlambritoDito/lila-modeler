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
import { validateIr, type IrProblem, type ProcessIR } from '../core/ir.js';
import type { UnsupportedElement } from './parse.js';

/**
 * Errores (abortan: la CLI sale con 1 y `simulate` se niega a correr, R-NOSOP-4) y avisos (no
 * abortan) por separado, tal como los distingue `docs/SEMANTICS.md` § 17.
 */
export interface ValidationResult {
  errors: IrProblem[];
  warnings: IrProblem[];
}

/** Segundo argumento de `validate`: lo que el parser sabe y el IR ya no. */
export interface ValidateOptions {
  /** `ParseResult.unsupported`, en orden de aparición en el documento. */
  unsupported?: readonly UnsupportedElement[];
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
 * ponytail: `ParseResult.unsupported` solo trae `{ id, qname, name }`, así que las filas del
 * catálogo que dependen de un detalle del XML —el `eventDefinition` concreto (`evento de
 * mensaje`, `de señal`, `de enlace`…), `startQuantity`/`completionQuantity`, los marcadores de
 * bucle y multi-instancia, y el disparador de un `start`/`end` fuera de perfil— caen aquí.
 * Techo: el error se emite igual y cita el id y el qname, pero con este texto genérico en vez
 * del de la tabla; los casos que el parser hoy ni siquiera descarta (start/end con disparador,
 * marcadores de bucle, quantities) no producen error todavía. Camino: que `parse.ts` amplíe
 * `UnsupportedElement` con el `$type` del `eventDefinition` y detecte esas filas (va con
 * LILA-020 / un ticket propio del parser); aquí basta con ampliar `CONSTRUCTIONS`.
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
  const construction = CONSTRUCTIONS[el.qname] ?? FALLBACK_CONSTRUCTION;
  return {
    code: 'E-NOSOP',
    id: el.id,
    message: `${head}: ${construction} no soportado por el simulador.`,
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
  const warnings: IrProblem[] = [];

  for (const el of opts.unsupported ?? []) {
    if (NOT_A_NODE.has(el.qname)) continue;
    errors.push(unsupportedProblem(el));
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

  // ponytail: `warnings` sale vacío hasta que haya quien los produzca. Los dos avisos que
  // `docs/SEMANTICS.md` § 18 asigna a este ticket, `W-MSGFLOW` (R-PERF-3) y `W-COND`
  // (R-PERF-4), dependen de datos que hoy no llegan hasta aquí: `parse.ts` ni cuenta los
  // `bpmn:messageFlow` ni conserva el `conditionExpression` de los flujos, y el IR tampoco.
  // Techo: un modelo con message flows o con condiciones se valida en silencio. Camino:
  // que `ParseResult` los reporte y emitirlos aquí; el resto de los avisos del catálogo son
  // del escenario o de la corrida, no del IR.
  return { errors, warnings };
}
