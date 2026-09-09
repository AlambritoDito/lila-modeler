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

/** Tipos de nodo del IR en prosa, para el resumen de `describe_process`. */
const TIPOS_NODO: Record<string, string> = {
  start: 'inicio',
  end: 'fin',
  terminate: 'terminación',
  task: 'tarea',
  xor: 'gateway XOR',
  or: 'gateway OR',
  and: 'gateway AND',
  timer: 'temporizador',
};

const ES_USAGE = `Uso: lila validate <archivo.bpmn> [--json]
     lila run <modelo.bpmn> <escenario.json> [--seed n] [--replications n]
              [--json resultado.json] [--csv directorio]
     lila compare <modelo.bpmn> <a.json> <b.json> [...] [--seed n] [--replications n]
                  [--json resultado.json] [--all]
     lila mcp

Comandos:
  validate   Parsea el BPMN, imprime su IR y valida el modelo.
  run        Valida modelo y escenario, simula y muestra tablas de resultados.
  compare    Simula dos o más escenarios sobre el mismo modelo y los compara lado a lado.
  mcp        Arranca el servidor MCP por stdio (para Claude Code / Desktop). Ver docs/MCP.md.

Opciones de validate:
  --json     Imprime el IR y los problemas por stdout.

Opciones de run:
  --seed n          Sobrescribe run.seed con un entero.
  --replications n  Sobrescribe run.replications con un entero >= 1.
  --json archivo    Escribe el RunResult determinista como JSON.
  --csv directorio  Escribe elements, flows, resources, process y log como CSV RFC 4180.
                    log.csv se escribe en streaming y lleva timestamps ISO desde run.start.

Opciones de compare:
  --seed n          Sobrescribe run.seed en todos los escenarios comparados.
  --replications n  Sobrescribe run.replications en todos los escenarios comparados.
  --json archivo    Escribe el CompareResult determinista como JSON.
  --all             Imprime todos los KPI de compare(), no solo el subconjunto curado.
                    El primer escenario listado es la base: los demás se comparan contra él.

Opciones de mcp:
  Ninguna. Habla MCP por stdin/stdout; las rutas de las tools se resuelven contra el
  directorio desde el que se lanzó. No se ejecuta a mano: lo lanza el cliente MCP.

Opciones generales:
  --lang en|es  Idioma de la salida. Por defecto, LILA_LANG y luego LANG; inglés si no hay.
  -h, --help    Muestra esta ayuda.`;

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
  cli: {
    usage: () => ES_USAGE,

    process: (subject) => `Proceso ${subject}`,
    exportedBy: (exporter, version) => `Exportado por ${exporter} ${version}`,
    nodes: (count, byType) => `Nodos (${count}): ${byType}`,
    flows: (count) => `Flujos (${count}):`,
    defaultFlow: () => '(por defecto)',
    otherProcesses: (ids) => `Otros procesos del archivo, no simulados: ${ids}`,
    problemCounts: (errors, warnings) => `${errors} errores, ${warnings} avisos.`,
    errorLabel: () => 'error',
    warningLabel: () => 'aviso',

    scenario: (name) => `Escenario ${name}`,
    runHeader: (seed, replications, unit) =>
      `Semilla ${seed} · Replicaciones ${replications} · Unidad de tiempo ${unit}`,
    currency: (currency) => `Moneda ${currency}`,
    bottlenecks: () => 'Cuellos de botella',
    noResourceWait: () => 'Sin espera por recurso detectada.',
    warnings: () => 'Avisos:',

    comparedScenarios: () => 'Escenarios comparados',
    timeUnitHeader: (unit) => `Unidad de tiempo ${unit} (escenario base) · Utilización en %`,
    columnName: () => 'Nombre',
    columnFile: () => 'Archivo',
    columnSeed: () => 'Semilla',
    columnReplications: () => 'Replicaciones',
    baseColumn: (name) => `${name} (base)`,
    significantMark: () => '* diferencia significativa (IC95 sin solapamiento)',

    mixedTimeUnit: (unit, others) =>
      `los escenarios no comparten baseTimeUnit; toda la tabla usa ${unit}, la del escenario base. ` +
      `Declaran otra: ${others}.`,
    differentSeeds: (seeds) =>
      `los escenarios corren con semillas distintas (${seeds}): se pierden los números ` +
      'aleatorios comunes (R-DET-3) y los deltas mezclan el efecto del cambio con el del muestreo. ' +
      'Usa --seed para forzar la misma semilla en todos.',
    fewReplications: (label) =>
      `${label} corrió sin al menos dos replicaciones completas; sin IC95 no hay marca de ` +
      'significancia posible para ese escenario.',
    moreWarnings: (count) =>
      count === 1
        ? '(+1 aviso más con el mismo código)'
        : `(+${count} avisos más con el mismo código)`,

    invalidJson: (file, detail) => `${file}: JSON inválido: ${detail}`,
    invalidScenarioLabel: () => 'escenario inválido:',
    missingModel: (file) => `${file}: el escenario resuelto no declara model.`,
    missingRun: (file) => `${file}: el escenario resuelto no declara run.`,
    temporaryFileClosed: (file) => `archivo temporal ya cerrado: ${file}`,
    cannotWrite: (target) => `no se puede escribir ${target}: existe un directorio con ese nombre.`,

    commandError: (command, body) => `lila ${command}: ${body}`,
    unknownCommand: (command) => `lila: comando desconocido "${command}".`,
    integerRequired: (option, raw) => `--${option} requiere un entero; se recibió "${raw}".`,
    safeIntegerRequired: (option, raw) =>
      `--${option} requiere un entero seguro; se recibió "${raw}".`,
    minimumIntegerRequired: (option, minimum, raw) =>
      `--${option} requiere un entero >= ${minimum}; se recibió "${raw}".`,
    expectedPositionals: (expected) => `se esperaba ${expected}.`,
    bpmnPath: () => 'una ruta .bpmn',
    runPaths: () => 'las rutas <modelo.bpmn> <escenario.json>',
    comparePaths: () => 'un <modelo.bpmn> y al menos dos escenarios <a.json> <b.json>',
    missingBpmnPath: () => 'falta la ruta del archivo .bpmn.',
    modelMismatch: (modelPath, scenarioModel) =>
      `el modelo posicional (${modelPath}) no coincide con scenario.model (${scenarioModel}).`,
    modelMismatchIn: (modelPath, scenarioModel, file) =>
      `el modelo posicional (${modelPath}) no coincide con scenario.model (${scenarioModel}) en ${file}.`,
    mcpNoArguments: () => 'no acepta argumentos.',
    mcpMissingPackage: (packageName) =>
      `falta el paquete ${packageName}. En el repo, \`npm ci && npm run build\` desde la raíz.`,
    invalidLang: (value, accepted) => `lila: --lang solo acepta: ${accepted}; se recibió "${value}".`,
    missingLangValue: (accepted) => `lila: --lang requiere un valor: ${accepted}.`,
  },
  mcp: {
    nodeType: (type) => TIPOS_NODO[type] ?? type,
    nodes: (count) => `Nodos (${count}):`,
    gateways: () => 'Gateways y sus salidas:',
    lanes: () => 'Lanes:',
    embeddedSubprocesses: () => 'Subprocesos embebidos (aplanados):',
    validation: (counts) => `Validación: ${counts}.`,
    validationWithErrors: (counts) =>
      `Validación: ${counts}. El modelo NO se puede simular; usa validate_bpmn para el detalle.`,
    errorCount: (count) => `${count} ${count === 1 ? 'error' : 'errores'}`,
    warningCount: (count) => `${count} ${count === 1 ? 'aviso' : 'avisos'}`,
    referencedResources: () => 'Recursos referenciados:',
    referencedResourcesNone: () =>
      'Recursos referenciados: (sin escenario, o el escenario no referencia recursos)',
    referencedResourcesUnreadable: (detail) =>
      `Recursos referenciados: no se pudo leer el escenario: ${detail}`,

    fileMissing: (file) => `no existe el archivo ${file}.`,
    bothPathAndXml: () => 'hay que pasar `path` o `xml`, no los dos.',
    pathOrXml: () => 'hay que pasar `path` o `xml`.',
    modelMismatch: (modelPath, scenarioModel) =>
      `el modelo (${modelPath}) no coincide con scenario.model (${scenarioModel}).`,
    modelInvalid: (detail) => `el modelo no pasa la validación: ${detail}`,
    scenarioInvalid: (detail) => `escenario inválido: ${detail}`,
    atLeastTwoScenarios: () => 'hacen falta al menos dos escenarios.',
    patchNotAnObject: () => 'el patch no produjo un objeto de escenario.',
    invalidAfterPatchLabel: () => 'escenario inválido tras el patch:',
    patchedMissingModel: () => 'el escenario resultante no declara model.',
    patchedMissingRun: () => 'el escenario resultante no declara run.',
    patchedName: (name) => `${name} (parcheado)`,
    inlineScenario: () => 'escenario inline',
  },
};
