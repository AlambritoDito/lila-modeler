/**
 * Spanish translation of the engine message catalog outside `core/` (LILA-211).
 *
 * `docs/SEMANTICS.md` is normative for these texts (§ 3 for `E-NOSOP` and the parse notices,
 * § 17 for the rest): they are byte-for-byte the ones the engine emitted before the catalog
 * existed.
 */
import { coreEs } from '../core/messages/es.js';
import type { Catalog } from './types.js';

/** Nombres de tipo de zod en español, para `invalid_type`. */
const TIPOS: Record<string, string> = {
  array: 'una lista',
  bigint: 'un entero',
  boolean: 'un booleano',
  int: 'un entero',
  null: 'null',
  number: 'un número',
  object: 'un objeto',
  record: 'un objeto',
  string: 'un texto',
  undefined: 'nada',
};

export const es: Catalog = {
  codes: {
    ...coreEs.codes,

    'E-NOSOP': (id, qname, name, construction) =>
      `${name === '' ? `${id} (${qname})` : `${id} (${qname}, "${name}")`}: ${construction} no soportado por el simulador.`,
    'E-PARSE-INCOMPLETO': (id, notice) =>
      `${id}: el lector XML descartó contenido del modelo, que quedó incompleto: ${notice}.`,
    'W-PARSE/otro-proceso': (id, processId, notice) =>
      `${id}: aviso del lector XML en ${processId}, otro proceso del archivo que Lila no simula: ${notice}.`,
    'W-PARSE/flujo-ausente': (id, notice) =>
      `${id}: el lector XML no encontró un flujo que este elemento declara; el grafo se construye sin él: ${notice}.`,
    'W-PARSE/inofensivo': (id, notice) =>
      `${id}: aviso del lector XML, sin pérdida de nodos ni flujos: ${notice}.`,
    'W-XOR-DEFAULT-ROTO': (id, notice) =>
      `${id}: el flujo por defecto declarado no existe; se ignora la marca isDefault y el reparto sigue las reglas del XOR sin default: ${notice}.`,
    'W-MSGFLOW': (processId, count) =>
      `${processId}: se ignoraron ${count} flujos de mensaje (bpmn:messageFlow).`,
    'W-COND': (flowId) => `${flowId}: conditionExpression se ignora; el ramaje es probabilístico.`,
    'E-GATEWAY-SIN-ARISTAS/sin-entradas': (id) => `${id}: el gateway no tiene entradas.`,
    'E-GATEWAY-SIN-ARISTAS/sin-salidas': (id) => `${id}: el gateway no tiene salidas.`,
    'E-SIN-START': (processId) => `${processId}: el proceso no tiene ningún evento de inicio.`,
    'E-SIN-END': (processId) =>
      `${processId}: el proceso no tiene ningún evento de fin ni terminate.`,
    'E-INALCANZABLE': (id) => `${id}: el nodo no es alcanzable desde ningún evento de inicio.`,

    'E-RESERVADO': (path) => `${path}: campo reservado, no soportado por el simulador en v1.`,
    'E-REF-DESCONOCIDA': (path, calendar) =>
      `${path}: el calendario ${calendar} no existe en calendars.`,
    'E-SUBPROC-PARAMETRO': (path, id) =>
      `${path}: ${id} es un subproceso embebido y no tiene tiempo, recursos ni costo propios; su tiempo es la suma de lo que ocurre dentro.`,
    'E-ELEMENTO-DESCONOCIDO': (path, id) => `${path}: el id ${id} no existe en el modelo.`,
    'E-PROB-EN-NODO': (path) => `${path}: solo se admite en un sequence flow.`,
    'E-PROB-RANGO': (path, value) => `${path}: ${value} está fuera de [0, 1].`,
    'E-CAMPO-NO-APLICA/solo-inicio': (path) => `${path}: solo se admite en un evento de inicio.`,
    'E-CAMPO-NO-APLICA/solo-tarea': (path) => `${path}: solo una tarea puede consumir recursos.`,
    'E-CAMPO-NO-APLICA/selection': (path) => `${path}: solo tiene sentido con resources.`,
    'E-TIMER-RECURSO': (path) => `${path}: un timer es un retardo y no consume recursos.`,
    'E-REC-DESCONOCIDO/recurso': (path, ref) => `${path}: el recurso ${ref} no existe en resources.`,
    'E-REC-DUPLICADO/ref': (path, ref) => `${path}: ${ref} aparece más de una vez; usa quantity.`,
    'E-REC-CANTIDAD/excede-ruta': (path, quantity, capacity, ref) =>
      `${path}: ${quantity} excede capacity ${capacity} de ${ref}.`,
    'E-XOR-SUMA-CERO': (path) => `${path}: las probabilidades del XOR suman 0; no hay ruta posible.`,
    'E-SIN-PARADA': (path) =>
      `${path}: falta una condición de parada; declara run.duration o un triggerCount.`,
    'W-SIN-SEED': (path) => `${path}: el escenario no declara seed; la corrida usa seed = 1.`,
    'W-ELEMENTO-SIN-PARAMETROS': (path) =>
      `${path}: el elemento existe en el modelo y no tiene parámetros; toma sus defaults.`,

    'E-CLAVE-DESCONOCIDA': (keys) => `clave no reconocida por el esquema: ${keys}.`,
  },
  chrome: coreEs.chrome,
  constructions: {
    boundaryEvent: 'evento adjunto a actividad (boundary event)',
    messageEvent: 'evento de mensaje',
    signalEvent: 'evento de señal',
    linkEvent: 'evento de enlace',
    errorEvent: 'evento de error',
    escalationEvent: 'evento de escalamiento',
    compensationEvent: 'evento de compensación',
    conditionalEvent: 'evento condicional',
    cancelEvent: 'evento de cancelación',
    multipleTriggerEvent: 'evento con disparadores múltiples',
    intermediateThrowEvent: 'evento intermedio de lanzamiento',
    eventBasedGateway: 'gateway basado en eventos',
    complexGateway: 'gateway complejo',
    multiInstanceMarker: 'marcador de multi-instancia',
    loopMarker: 'marcador de bucle en la actividad',
    transactionSubProcess: 'subproceso transaccional',
    adHocSubProcess: 'subproceso ad-hoc',
    eventSubProcess: 'subproceso de eventos',
    choreographyDiagram: 'diagrama de coreografía',
    conversationDiagram: 'diagrama de conversación',
    startQuantity: 'atributo startQuantity distinto de 1',
    completionQuantity: 'atributo completionQuantity distinto de 1',
    endEventTrigger: 'evento de fin con ese disparador',
    startEventTrigger: 'evento de inicio con ese disparador',
    outOfProfile: 'elemento fuera del perfil v1',
  },
  zod: {
    typeName: (name) => TIPOS[name] ?? name,
    units: (origin, amount) => {
      const one = amount === 1 || amount === 1n;
      if (origin === 'string') return one ? 'carácter' : 'caracteres';
      return one ? 'elemento' : 'elementos';
    },
    required: (expected) => `es obligatorio y debe ser ${expected}`,
    wrongType: (expected, received) => `debe ser ${expected}, no ${received}`,
    tooBigNumber: (operator, maximum) => `debe ser ${operator} ${maximum}`,
    tooBigSize: (maximum, units) => `debe tener como mucho ${maximum} ${units}`,
    tooSmallNumber: (operator, minimum) => `debe ser ${operator} ${minimum}`,
    tooSmallSize: (minimum, units) => `debe tener al menos ${minimum} ${units}`,
    invalidValue: (value) => `debe ser ${value}`,
    invalidValues: (values) => `debe ser uno de: ${values}`,
    unrecognizedKey: (key) => `clave desconocida: ${key}`,
    unrecognizedKeys: (keys) => `claves desconocidas: ${keys}`,
    invalidUnion: () => 'no encaja con ninguna de las formas admitidas',

    distributionMinMax: (type) => `${type}: se requiere min ≤ max`,
    distributionMinModeMax: (type) => `${type}: se requiere min ≤ mode ≤ max`,
    startIso: () => 'run.start debe ser ISO 8601 con offset',
    startInvalidDate: (start, monthDay) =>
      `run.start: ${start} no es una fecha válida; ${monthDay} no existe en el calendario civil.`,
    startInvalidTime: (start, clock) =>
      `run.start: ${start} no es una hora válida; ${clock} no existe en el reloj civil.`,
    startInvalidOffset: (start, offset) =>
      `run.start: ${start} no tiene un offset válido; ${offset} no es un desplazamiento horario.`,
    currencyIso: () => 'run.currency debe ser un código ISO 4217',
    intervalFrom: () => 'from debe ser "HH:MM"',
    intervalTo: () => 'to debe ser "HH:MM" (se admite "24:00")',
    intervalOrder: () =>
      'R13: se requiere to > from; una ventana nocturna se declara como dos intervalos',
  },
};
