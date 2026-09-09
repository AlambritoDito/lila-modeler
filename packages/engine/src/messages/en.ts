/**
 * English message catalog of the engine outside `core/` (LILA-211). This is the default locale.
 */
import { coreEn } from '../core/messages/en.js';
import type { Catalog } from './types.js';

/** zod type names in English, for `invalid_type`. */
const TYPES: Record<string, string> = {
  array: 'a list',
  bigint: 'an integer',
  boolean: 'a boolean',
  int: 'an integer',
  null: 'null',
  number: 'a number',
  object: 'an object',
  record: 'an object',
  string: 'a string',
  undefined: 'nothing',
};

export const en: Catalog = {
  codes: {
    ...coreEn.codes,

    'E-NOSOP': (id, qname, name, construction) =>
      `${name === '' ? `${id} (${qname})` : `${id} (${qname}, "${name}")`}: ${construction} not supported by the simulator.`,
    'E-PARSE-INCOMPLETO': (id, notice) =>
      `${id}: the XML reader discarded model content, which was left incomplete: ${notice}.`,
    'W-PARSE/otro-proceso': (id, processId, notice) =>
      `${id}: XML reader notice in ${processId}, another process of the file that Lila does not simulate: ${notice}.`,
    'W-PARSE/flujo-ausente': (id, notice) =>
      `${id}: the XML reader did not find a flow this element declares; the graph is built without it: ${notice}.`,
    'W-PARSE/inofensivo': (id, notice) =>
      `${id}: XML reader notice, with no loss of nodes or flows: ${notice}.`,
    'W-XOR-DEFAULT-ROTO': (id, notice) =>
      `${id}: the declared default flow does not exist; the isDefault mark is ignored and the split follows the rules of a XOR without a default: ${notice}.`,
    'W-MSGFLOW': (processId, count) =>
      `${processId}: ${count} message flows (bpmn:messageFlow) were ignored.`,
    'W-COND': (flowId) => `${flowId}: conditionExpression is ignored; branching is probabilistic.`,
    'E-GATEWAY-SIN-ARISTAS/sin-entradas': (id) => `${id}: the gateway has no incoming flows.`,
    'E-GATEWAY-SIN-ARISTAS/sin-salidas': (id) => `${id}: the gateway has no outgoing flows.`,
    'E-SIN-START': (processId) => `${processId}: the process has no start event.`,
    'E-SIN-END': (processId) => `${processId}: the process has no end event and no terminate.`,
    'E-INALCANZABLE': (id) => `${id}: the node is not reachable from any start event.`,

    'E-RESERVADO': (path) => `${path}: reserved field, not supported by the simulator in v1.`,
    'E-REF-DESCONOCIDA': (path, calendar) =>
      `${path}: the calendar ${calendar} does not exist in calendars.`,
    'E-SUBPROC-PARAMETRO': (path, id) =>
      `${path}: ${id} is an embedded subprocess and has no processing time, resources or cost of its own; its time is the sum of what happens inside.`,
    'E-ELEMENTO-DESCONOCIDO': (path, id) => `${path}: the id ${id} does not exist in the model.`,
    'E-PROB-EN-NODO': (path) => `${path}: only accepted on a sequence flow.`,
    'E-PROB-RANGO': (path, value) => `${path}: ${value} is outside [0, 1].`,
    'E-CAMPO-NO-APLICA/solo-inicio': (path) => `${path}: only accepted on a start event.`,
    'E-CAMPO-NO-APLICA/solo-tarea': (path) => `${path}: only a task can consume resources.`,
    'E-CAMPO-NO-APLICA/selection': (path) => `${path}: it only makes sense together with resources.`,
    'E-TIMER-RECURSO': (path) => `${path}: a timer is a delay and consumes no resources.`,
    'E-REC-DESCONOCIDO/recurso': (path, ref) =>
      `${path}: the resource ${ref} does not exist in resources.`,
    'E-REC-DUPLICADO/ref': (path, ref) => `${path}: ${ref} appears more than once; use quantity.`,
    'E-REC-CANTIDAD/excede-ruta': (path, quantity, capacity, ref) =>
      `${path}: ${quantity} exceeds capacity ${capacity} of ${ref}.`,
    'E-XOR-SUMA-CERO': (path) =>
      `${path}: the probabilities of the XOR add up to 0; there is no possible route.`,
    'E-SIN-PARADA': (path) =>
      `${path}: a stopping condition is missing; declare run.duration or a triggerCount.`,
    'W-SIN-SEED': (path) => `${path}: the scenario declares no seed; the run uses seed = 1.`,
    'W-ELEMENTO-SIN-PARAMETROS': (path) =>
      `${path}: the element exists in the model and has no parameters; it takes its defaults.`,

    'E-CLAVE-DESCONOCIDA': (keys) => `key not recognised by the schema: ${keys}.`,
  },
  chrome: coreEn.chrome,
  constructions: {
    boundaryEvent: 'event attached to an activity (boundary event)',
    messageEvent: 'message event',
    signalEvent: 'signal event',
    linkEvent: 'link event',
    errorEvent: 'error event',
    escalationEvent: 'escalation event',
    compensationEvent: 'compensation event',
    conditionalEvent: 'conditional event',
    cancelEvent: 'cancel event',
    multipleTriggerEvent: 'event with multiple triggers',
    intermediateThrowEvent: 'intermediate throw event',
    eventBasedGateway: 'event-based gateway',
    complexGateway: 'complex gateway',
    multiInstanceMarker: 'multi-instance marker',
    loopMarker: 'loop marker on the activity',
    transactionSubProcess: 'transaction subprocess',
    adHocSubProcess: 'ad-hoc subprocess',
    eventSubProcess: 'event subprocess',
    choreographyDiagram: 'choreography diagram',
    conversationDiagram: 'conversation diagram',
    startQuantity: 'startQuantity attribute other than 1',
    completionQuantity: 'completionQuantity attribute other than 1',
    endEventTrigger: 'end event with that trigger',
    startEventTrigger: 'start event with that trigger',
    outOfProfile: 'element outside the v1 profile',
  },
  zod: {
    typeName: (name) => TYPES[name] ?? name,
    units: (origin, amount) => {
      const one = amount === 1 || amount === 1n;
      if (origin === 'string') return one ? 'character' : 'characters';
      return one ? 'element' : 'elements';
    },
    required: (expected) => `is required and must be ${expected}`,
    wrongType: (expected, received) => `must be ${expected}, not ${received}`,
    tooBigNumber: (operator, maximum) => `must be ${operator} ${maximum}`,
    tooBigSize: (maximum, units) => `must have at most ${maximum} ${units}`,
    tooSmallNumber: (operator, minimum) => `must be ${operator} ${minimum}`,
    tooSmallSize: (minimum, units) => `must have at least ${minimum} ${units}`,
    invalidValue: (value) => `must be ${value}`,
    invalidValues: (values) => `must be one of: ${values}`,
    unrecognizedKey: (key) => `unknown key: ${key}`,
    unrecognizedKeys: (keys) => `unknown keys: ${keys}`,
    invalidUnion: () => 'does not match any of the accepted shapes',

    distributionMinMax: (type) => `${type}: min ≤ max is required`,
    distributionMinModeMax: (type) => `${type}: min ≤ mode ≤ max is required`,
    startIso: () => 'run.start must be ISO 8601 with an explicit offset',
    startInvalidDate: (start, monthDay) =>
      `run.start: ${start} is not a valid date; ${monthDay} does not exist in the civil calendar.`,
    startInvalidTime: (start, clock) =>
      `run.start: ${start} is not a valid time; ${clock} does not exist on the civil clock.`,
    startInvalidOffset: (start, offset) =>
      `run.start: ${start} does not have a valid offset; ${offset} is not a time offset.`,
    currencyIso: () => 'run.currency must be an ISO 4217 code',
    intervalFrom: () => 'from must be "HH:MM"',
    intervalTo: () => 'to must be "HH:MM" ("24:00" is accepted)',
    intervalOrder: () =>
      'R13: to > from is required; a night window is declared as two intervals',
  },
};
