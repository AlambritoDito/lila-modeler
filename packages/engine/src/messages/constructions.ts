/**
 * Identifiers of the closed `{construcción}` catalogue of `docs/SEMANTICS.md` § 3 (R-NOSOP-2).
 *
 * Until LILA-211 the identifier **was** the Spanish display text and travelled as data in
 * `ParseResult.unsupported[].construction`. Now the id is language-neutral and the display text
 * lives in the message catalog (`messages(locale).constructions`), so `E-NOSOP` can be emitted in
 * any language without changing what the parser reports.
 */

/** One row of the R-NOSOP-2 table, plus the fallback for hand-built `unsupported` lists. */
export type ConstructionId =
  | 'boundaryEvent'
  | 'messageEvent'
  | 'signalEvent'
  | 'linkEvent'
  | 'errorEvent'
  | 'escalationEvent'
  | 'compensationEvent'
  | 'conditionalEvent'
  | 'cancelEvent'
  | 'multipleTriggerEvent'
  | 'intermediateThrowEvent'
  | 'eventBasedGateway'
  | 'complexGateway'
  | 'multiInstanceMarker'
  | 'loopMarker'
  | 'transactionSubProcess'
  | 'adHocSubProcess'
  | 'eventSubProcess'
  | 'choreographyDiagram'
  | 'conversationDiagram'
  | 'startQuantity'
  | 'completionQuantity'
  | 'endEventTrigger'
  | 'startEventTrigger'
  | 'outOfProfile';

/**
 * `{construcción}` of R-NOSOP-2 by moddle `$type`, for the `unsupported` lists that reach
 * `validate` without one. Closed catalogue: no other row is valid.
 */
export const CONSTRUCTION_BY_QNAME: Record<string, ConstructionId> = {
  'bpmn:BoundaryEvent': 'boundaryEvent',
  'bpmn:IntermediateThrowEvent': 'intermediateThrowEvent',
  'bpmn:EventBasedGateway': 'eventBasedGateway',
  'bpmn:ComplexGateway': 'complexGateway',
  'bpmn:Transaction': 'transactionSubProcess',
  'bpmn:AdHocSubProcess': 'adHocSubProcess',
  // El parser solo descarta un `bpmn:subProcess` cuando es `triggeredByEvent="true"`; el
  // embebido lo aplana (R-PLAN-1), así que aquí solo llega el subproceso de eventos.
  'bpmn:SubProcess': 'eventSubProcess',
  'bpmn:ChoreographyTask': 'choreographyDiagram',
  'bpmn:Choreography': 'choreographyDiagram',
  'bpmn:GlobalChoreographyTask': 'choreographyDiagram',
  'bpmn:Conversation': 'conversationDiagram',
  'bpmn:CallConversation': 'conversationDiagram',
  'bpmn:SubConversation': 'conversationDiagram',
};

/**
 * Respaldo para listas `unsupported` construidas a mano por consumidores antiguos. LILA-163 hace
 * que `parseBpmn` entregue siempre la construcción concreta del catálogo cuando puede detectarla.
 */
export const FALLBACK_CONSTRUCTION: ConstructionId = 'outOfProfile';
