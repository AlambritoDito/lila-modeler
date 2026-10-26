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
  eventGateway: 'gateway basado en eventos',
};

const ES_USAGE = `Uso: lila validate <archivo.bpmn|proyecto.lila> [--process slug] [--json]
     lila run <modelo.bpmn|proyecto.lila> <escenario> [--process slug] [--seed n]
              [--replications n] [--json resultado.json] [--csv directorio] [--xlsx libro.xlsx]
              [--save]
     lila compare <modelo.bpmn|proyecto.lila> <a> <b> [...] [--process slug] [--seed n]
                  [--replications n] [--json resultado.json] [--xlsx libro.xlsx] [--all]
     lila export diagram <modelo.bpmn|proyecto.lila> [--process slug] [--out archivo.svg] [--force]
                         [--overlay bottlenecks|heatmap] [--run id|latest] [--scenario nombre]
     lila export doc <proyecto.lila> --out archivo.docx|archivo.html [--format docx|html]
                     [--process slug] [--run id|latest] [--scenario nombre] [--force]
     lila export results <proyecto.lila> --out libro.xlsx|directorio [--format xlsx|csv]
                         [--process slug] [--run id|latest] [--scenario nombre] [--force]
     lila process create --outline <esquema.json> -p <proyecto.lila> [--name nombre]
                         [--process slug] [--dry-run] [--json]
     lila process show -p <proyecto.lila> [--process slug] [--json]
     lila process edit -p <proyecto.lila> --ops <operaciones.json> [--process slug]
                       [--dry-run] [--no-layout] [--json]
     lila process annotate <proyecto.lila> <idElemento> [--process slug] [--documentation texto]
                           [--responsibility R|A|C|I:rol ...] [--clear-responsibilities]
                           [--ref tipo=id ...] [--attribute id=valor ...] [--dry-run] [--json]
     lila process raci <proyecto.lila> [--process slug] [--json|--csv]
     lila process export-bpmn -p <proyecto.lila> [--process slug] [--out archivo.bpmn] [--force]
     lila process import -p <proyecto.lila> --bpmn <archivo.bpmn> [--replace] [--process slug]
                         [--name nombre] [--no-layout] [--allow-unsimulatable] [--dry-run] [--json]
     lila process attribute define <proyecto.lila> --name nombre --type text|number|list|date
                                   --applies-to task|gateway|event|subProcess|lane|process
                                   [--option valor ...] [--default valor] [--id id]
                                   [--process slug] [--dry-run] [--json]
     lila process attribute define <proyecto.lila> --remove --id id|--name nombre --applies-to tipo
     lila process attribute list <proyecto.lila> [--process slug] [--json]
     lila process rename <proyecto.lila> <slug> --name nombre [--dry-run] [--json]
     lila process delete <proyecto.lila> <slug> [--dry-run] [--json]
     lila scenario import <proyecto.lila> <escenario> <hoja.xlsx|hoja.csv> [--process slug]
                          [--dry-run] [--json]
     lila scenario template <proyecto.lila> <escenario> --out hoja.xlsx [--process slug] [--force]
     lila scenario show <proyecto.lila> <escenario> [--process slug] [--resolved] [--json]
     lila scenario patch <proyecto.lila> <escenario> --patch <ops.json> [--process slug]
                         [--save-to nombre] [--extends-from nombre] [--name n] [--description d]
                         [--dry-run] [--json]
     lila scenario rename <proyecto.lila> <escenario> --name nombre [--process slug] [--dry-run] [--json]
     lila scenario delete <proyecto.lila> <escenario> [--process slug] [--dry-run] [--json]
     lila project show <proyecto.lila> [--json]
     lila project create <ruta.lila> --name nombre --bpmn <archivo.bpmn>
                         [--scenario nombre=archivo.json ...] [--force] [--allow-unsimulatable] [--json]
     lila mcp

Comandos:
  validate   Parsea el BPMN, imprime su IR y valida el modelo.
  run        Valida modelo y escenario, simula y muestra tablas de resultados.
  compare    Simula dos o más escenarios sobre el mismo modelo y los compara lado a lado.
  export     Exporta sin la app: el diagrama como SVG, el documento del proceso como Word o
             HTML, o los resultados de una corrida guardada en el .lila como .xlsx o CSV.
  process    create: arma un proceso maquetado desde un esquema (lista de pasos) en un .lila.
             show: imprime un proceso de un .lila como esquema.
             edit: aplica una lista de operaciones a un proceso, todas o ninguna. Ver docs/CLI.md.
             annotate: escribe en el .lila la descripción, el RACI, las referencias al catálogo y
             los atributos extendidos de un elemento. raci: imprime la matriz RACI del documento.
             export-bpmn: imprime o escribe el BPMN de un proceso. import: añade un .bpmn como
             proceso nuevo de un .lila, o con --replace reemplaza el modelo de uno.
             attribute: define (o quita) un atributo extendido, o los lista.
             rename: renombra un proceso (su slug no cambia). delete: borra un proceso con sus
             escenarios y sus corridas guardadas.
  scenario   import: aplica una hoja de escenario (.xlsx/.csv) a un escenario del .lila, como
             Importar Excel/CSV de la app. template: escribe esa hoja, rellenada, para una persona.
             show: imprime un escenario como está guardado (o --resolved) con las notas del validador.
             patch: aplica un JSON Patch a un escenario, en sitio o como un escenario nuevo que
             hereda de él (--save-to); solo se escribe si el resultado valida.
             rename: renombra un escenario (su archivo no cambia). delete: borra un escenario con
             sus corridas guardadas.
  project    show: lista los procesos de un .lila, sus escenarios y sus corridas guardadas. Solo lee.
             create: crea un .lila nuevo a partir de un .bpmn y escenarios opcionales.
  mcp        Arranca el servidor MCP por stdio (para Claude Code / Desktop). Ver docs/MCP.md.

Un modelo puede ser un .bpmn o un proyecto .lila. Con un .lila, un escenario es una ruta .json o,
si no existe ese archivo, el nombre de un escenario de ese proceso (su nombre de archivo, con o sin
.scenario.json, o su "name"). Un .lila con varios procesos necesita --process.

Opciones de validate, run y compare:
  --process slug    El proceso de un .lila con varios procesos (implícito si hay uno).

Opciones de validate:
  --json     Imprime el IR y los problemas por stdout.

Opciones de run:
  --seed n          Sobrescribe run.seed con un entero.
  --replications n  Sobrescribe run.replications con un entero >= 1.
  --json archivo    Escribe el RunResult determinista como JSON.
  --csv directorio  Escribe elements, flows, resources, process y log como CSV RFC 4180.
                    log.csv se escribe en streaming y lleva timestamps ISO desde run.start.
  --xlsx archivo    Escribe un libro .xlsx con las hojas Resumen, Elementos, Flujos,
                    Recursos y Parámetros. El event log solo está en --csv.
  --save            Guarda la corrida en el .lila (un escenario del archivo), como la app:
                    la app la muestra como corrida actual y lila export la usa.

Opciones de compare:
  --seed n          Sobrescribe run.seed en todos los escenarios comparados.
  --replications n  Sobrescribe run.replications en todos los escenarios comparados.
  --json archivo    Escribe el CompareResult determinista como JSON.
  --xlsx archivo    Escribe un libro .xlsx con una hoja Resumen por escenario y una hoja
                    Comparación (valor, IC95, delta y solape del IC por KPI).
  --all             Imprime todos los KPI de compare(), no solo el subconjunto curado.
                    El primer escenario listado es la base: los demás se comparan contra él.

Opciones de export:
  --out ruta        Dónde escribir. Sin ella, export diagram imprime el SVG por stdout.
  --format f        docx|html (doc) o xlsx|csv (results); por defecto según la extensión de --out
                    (.docx, .html, .xlsx). csv escribe elements, flows, resources y process
                    .csv en el directorio --out.
  --run id|latest   La corrida guardada: latest (por defecto) es la del modelo y escenario actuales;
                    el documento solo admite una corrida actual y, si no hay, va sin resultados.
  --scenario nombre Con latest, la corrida de ese escenario (necesario si varios tienen una).
  --overlay c       diagram: lo colorea con una corrida guardada del .lila, como la app:
                    bottlenecks (el corte de cuellos del lienzo) o heatmap (el mapa de calor).
  --force           Reemplaza archivos existentes; sin él no se sobrescribe nada.
  El documento Word va sin diagrama y sin las gráficas de la corrida: el motor no rasteriza. El
  documento HTML lleva ambos, salvo el histograma del tiempo de ciclo (una corrida guardada no
  conserva los tiempos por caso).
Opciones de process:
  --outline archivo  create: el JSON del esquema (carriles y pasos; docs/MCP.md).
  -p, --project a    El .lila; create lo crea si no existe.
  --ops archivo      edit: el JSON con la lista de operaciones (docs/CLI.md).
  --process slug     create: slug del proceso nuevo (por defecto, del nombre). show, edit: cuál.
  --name nombre      create: nombre del proceso (por defecto, el del esquema).
  --dry-run          create, edit: arma y comprueba todo, no escribe nada.
  --no-layout        edit: conserva todas las posiciones; solo coloca las formas nuevas.
  --json             Imprime el resultado (create, edit) o el esquema (show) como JSON.

Opciones de process annotate:
  --documentation t Reemplaza la descripción ("" la quita).
  --responsibility  TIPO:rol, repetible; reemplaza toda la lista RACI del elemento.
  --clear-responsibilities  Quita todas las responsabilidades.
  --ref tipo=id     systemRef, documentRef, riskRef, controlRef, kpiRef, input u output;
                    repetible; reemplaza las listas de los tipos dados (tipo= vacía uno).
  --attribute k=v   Un atributo extendido por id o nombre; repetible; "k=" quita su valor.
  --dry-run         Muestra el resultado sin escribir.

Opciones de process import:
  --bpmn archivo    El archivo BPMN 2.0 (una exportación de Bizagi, por ejemplo).
  --replace         Reemplaza el modelo del proceso (--process) en vez de añadir uno.
  --process slug    Sin --replace: slug del proceso nuevo (por defecto, de su nombre).
  --name nombre     Sin --replace: nombre del proceso nuevo (por defecto, el de su pool, el de
                    su proceso o el del archivo).
  --no-layout       Deja tal cual un modelo sin diagrama (por defecto, se maqueta).
  --allow-unsimulatable  Guarda un modelo con errores de validación, como diagrama que no se
                    simula; los errores salen como notas.
  --dry-run         Comprueba todo y no escribe nada.

Opciones de process attribute define:
  --name, --type, --applies-to  La definición entera, siempre; se busca por --id, si no por nombre
                    (sin mayúsculas) y --applies-to, y si no se crea con un id nuevo.
  --option v        Una opción de una lista; repetible. --default v: lo que muestra un elemento sin valor.
  --remove          Quita la definición y sus valores. Cambiar el tipo, --applies-to o quitar
                    opciones también quita los valores que ya no encajan; los dos casos los listan.
  --dry-run         Muestra el resultado sin escribir.

Opciones de scenario import:
  --dry-run         Muestra los cambios previstos y las filas no aplicadas sin escribir.

Opciones de scenario patch:
  --patch archivo   La lista JSON de operaciones (RFC 6902 add/replace/remove/test).
  --save-to nombre  Crea este escenario con extends y solo las claves que tocó el patch, en
                    vez de parchear el escenario en sitio.
  --extends-from n  Con --save-to: el padre de extends (por defecto, el escenario parcheado).
  --name, --description  Del escenario resultante.
  --dry-run         Valida todo y no escribe nada.

Opciones de project create:
  --name nombre     Nombre del proyecto.
  --bpmn archivo    El modelo; un modelo con errores de validación se rechaza.
  --scenario n=a    Un JSON de escenario que se guarda como n.scenario.json; repetible. Los
                    borradores se guardan y se listan con lo que les falta.
  --force           Reemplaza un archivo que ya existe.
  --allow-unsimulatable  Guarda un modelo con errores de validación, como un diagrama que no
                    simula; los errores se imprimen como notas.

Opciones de mcp:
  Ninguna. Habla MCP por stdin/stdout; las rutas de las tools se resuelven contra el
  directorio desde el que se lanzó. No se ejecuta a mano: lo lanza el cliente MCP.

Opciones generales:
  --lang en|es     Idioma de la salida. Por defecto, LILA_LANG y luego LANG; inglés si no hay.
  -h, --help       Muestra esta ayuda.
  -v, --version    Imprime la versión instalada.`;

/** `count` con su sustantivo, en singular para uno: «1 paso», «2 pasos». */
const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

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
      `${id}: el flujo por defecto declarado no existe; se ignora la marca de flujo por defecto (\`isDefault\`) y el reparto sigue las reglas de un XOR sin flujo por defecto: ${notice}.`,
    'W-MSGFLOW': (processId, count) =>
      `${processId}: ${count === 1 ? 'se ignoró' : 'se ignoraron'} ${n(count, 'flujo', 'flujos')} de mensaje (bpmn:messageFlow).`,
    'W-COND': (flowId) => `${flowId}: la condición del flujo (\`conditionExpression\`) se ignora; el ramaje es probabilístico.`,
    'E-GATEWAY-SIN-ARISTAS/sin-entradas': (id) => `${id}: la compuerta no tiene entradas.`,
    'E-GATEWAY-SIN-ARISTAS/sin-salidas': (id) => `${id}: la compuerta no tiene salidas.`,
    'E-SIN-START': (processId) => `${processId}: el proceso no tiene ningún evento de inicio.`,
    'E-SIN-END': (processId) =>
      `${processId}: el proceso no tiene ningún evento de fin, ni normal ni terminal.`,
    'E-INALCANZABLE': (id) => `${id}: el nodo no es alcanzable desde ningún evento de inicio.`,

    'E-RESERVADO': (path) => `campo reservado, no soportado por el simulador en v1 (${path}).`,
    'E-REF-DESCONOCIDA': (path, calendar) =>
      `el calendario ${calendar} no existe en la lista de calendarios (${path}).`,
    'E-REF-DESCONOCIDA/flujo': (path, flowId) =>
      `el flujo de secuencia ${flowId} no existe en el modelo (${path}).`,
    'E-SUBPROC-PARAMETRO': (path, id) =>
      `${id} es un subproceso embebido y no tiene tiempo, recursos ni costo propios; su tiempo es la suma de lo que ocurre dentro (${path}).`,
    'E-ELEMENTO-DESCONOCIDO': (path, id) => `el id ${id} no existe en el modelo (${path}).`,
    'E-ELEMENTO-DESCONOCIDO/otro-proceso': (path, id, ownerId, ownerName, simulatedId, simulatedName) => {
      const label = (pid: string, name: string) => (name === '' ? pid : `«${name}» (${pid})`);
      return `el id ${id} pertenece al proceso ${label(ownerId, ownerName)}, pero el proceso simulado es ${label(simulatedId, simulatedName)}. Se simula el proceso que contiene la mayoría de los elementos que configuran los escenarios del proceso, y en un empate el primero del archivo: quita de los escenarios las entradas del proceso que no quieres simular (${path}).`;
    },
    'E-PROB-EN-NODO': (path) => `la probabilidad solo se admite en un flujo de secuencia (${path}).`,
    'E-PROB-RANGO': (path, value) => `${value} está fuera de [0, 1] (${path}).`,
    'E-CAMPO-NO-APLICA/solo-inicio': (path) => `solo se admite en un evento de inicio (${path}).`,
    'E-CAMPO-NO-APLICA/solo-tarea': (path) => `solo una tarea puede consumir recursos (${path}).`,
    'E-CAMPO-NO-APLICA/selection': (path) =>
      `la selección de recursos solo tiene sentido junto con los recursos de la tarea (${path}).`,
    'E-CAMPO-NO-APLICA/solo-flujo-xor': (path) =>
      `solo se admite en un flujo de secuencia que sale de una compuerta exclusiva divergente (${path}).`,
    'E-TIMER-RECURSO': (path) => `un temporizador es un retardo y no consume recursos (${path}).`,
    'E-REC-DESCONOCIDO/recurso': (path, ref) =>
      `el recurso ${ref} no existe en la lista de recursos (${path}).`,
    'E-REC-DUPLICADO/ref': (path, ref) =>
      `${ref} aparece más de una vez; usa la cantidad en lugar de repetirlo (${path}).`,
    'E-REC-CANTIDAD/excede-ruta': (path, quantity, capacity, ref) =>
      `la cantidad ${quantity} excede la capacidad ${capacity} de ${ref} (${path}).`,
    'E-XOR-SUMA-CERO': (path) =>
      `las probabilidades del XOR suman 0; no hay ruta posible (${path}).`,
    'E-SIN-PARADA': (path) =>
      `falta una condición de parada; declara la duración de la corrida o las llegadas máximas (${path}).`,
    'W-SIN-SEED': (path) =>
      `el escenario no declara semilla; la corrida usa la semilla 1 (${path}).`,
    'W-ELEMENTO-SIN-PARAMETROS': (path) =>
      `el elemento existe en el modelo y no tiene parámetros; toma sus valores por defecto (${path}).`,
    'W-COND-INALCANZABLE': (path, flowId, gatewayId) =>
      `${flowId} no se alcanza antes de ${gatewayId} por ningún camino secuencial; la condición solo aplica si una rama paralela lo recorre (${path}).`,
    'W-OR-PROB-PARCIAL': (path, flowId, gatewayId) =>
      `${flowId} no declara probabilidad, pero ${gatewayId} tiene otras salidas que sí; el flujo sin declarar siempre se toma, porque la probabilidad ausente vale 1 (${path}).`,

    'E-CLAVE-DESCONOCIDA': (keys) => `clave no reconocida por el esquema: ${keys}.`,

    'W-REF-SIN-CATALOGO': (process, element, relation, ref, type) =>
      `${element} (proceso ${process}): la referencia ${relation} "${ref}" no coincide con ningún objeto ${type} del catálogo; se conserva tal cual.`,
    'W-ACTIVIDAD-SIN-RESPONSABLE': (process, element) =>
      `${element} (proceso ${process}): la actividad no tiene ningún rol Responsable (lila:responsibility type="R").`,
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
    startQuantity: 'atributo `startQuantity` distinto de 1',
    completionQuantity: 'atributo `completionQuantity` distinto de 1',
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

    distributionMinMax: (type) => `${type}: se requiere mínimo ≤ máximo`,
    distributionMinModeMax: (type) => `${type}: se requiere mínimo ≤ moda ≤ máximo`,
    startIso: () => 'la fecha de inicio debe ser ISO 8601 con desfase horario',
    startInvalidDate: (start, monthDay) =>
      `la fecha de inicio ${start} no es una fecha válida; ${monthDay} no existe en el calendario civil.`,
    startInvalidTime: (start, clock) =>
      `la fecha de inicio ${start} no tiene una hora válida; ${clock} no existe en el reloj civil.`,
    startInvalidOffset: (start, offset) =>
      `la fecha de inicio ${start} no tiene un desfase horario válido; ${offset} no es un desplazamiento horario.`,
    currencyIso: () => 'la moneda debe ser un código ISO 4217',
    intervalFrom: () => 'la hora de inicio del intervalo debe ser "HH:MM"',
    intervalTo: () => 'la hora de fin del intervalo debe ser "HH:MM" (se admite "24:00")',
    intervalOrder: () =>
      'R13: la hora de fin debe ser posterior a la de inicio; una ventana nocturna se declara como dos intervalos',
    monthDay: () =>
      'días del mes: 0 no es un día; usa 1…31, o -1…-31 contando desde el final del mes',
    monthWeekdayNth: () =>
      'semana del mes: 0 no es una semana; usa 1…5, o -1…-5 contando desde el final del mes',
    annualDate: () =>
      'fechas anuales: una fecha anual es "MM-DD" y tiene que existir en algún año (se admite "02-29")',
    holidayDate: () =>
      'festivos: un festivo es "YYYY-MM-DD" (una vez) o "MM-DD" (cada año) y tiene que ser una fecha real',
    intervalSelector: () =>
      'cada intervalo declara exactamente uno de estos: días de la semana, días del mes, días de la semana del mes o fechas anuales',
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
    catalogWarnings: (count) => `Avisos del catálogo (${count}):`,
    errorLabel: () => 'error',
    warningLabel: () => 'aviso',

    scenario: (name) => `Escenario ${name}`,
    runHeader: (seed, replications, unit) =>
      `Semilla ${seed} · Replicaciones ${replications} · Unidad de tiempo ${unit}`,
    currency: (currency) => `Moneda ${currency}`,
    bottlenecks: () => 'Cuellos de botella',
    outcomes: () => 'Desenlaces',
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

    xlsxSheetSummary: () => 'Resumen',
    xlsxSheetElements: () => 'Elementos',
    xlsxSheetFlows: () => 'Flujos',
    xlsxSheetResources: () => 'Recursos',
    xlsxSheetParameters: () => 'Parámetros',
    xlsxSheetPercentiles: () => 'Percentiles',
    xlsxSheetComparison: () => 'Comparación',
    xlsxColumnSection: () => 'Sección',
    xlsxColumnParameter: () => 'Parámetro',
    xlsxColumnValue: () => 'Valor',
    xlsxSectionProcess: () => 'Proceso',
    xlsxSectionOutcomes: () => 'Finales',
    xlsxSectionPayroll: () => 'Nómina',
    xlsxSectionRun: () => 'Corrida',
    xlsxSectionArrivals: () => 'Llegadas',
    xlsxSectionTasks: () => 'Tareas',
    xlsxSectionGateways: () => 'Compuertas',
    xlsxSectionCalendars: () => 'Calendarios',
    xlsxCapacity: () => 'Capacidad',
    xlsxWorkingHours: () => 'Horas laborables',
    xlsxPayrollCost: () => 'Costo de nómina',
    xlsxTotal: () => 'Total',
    xlsxSectionNotes: () => 'Notas',
    xlsxNoteDurations: () => 'Duraciones',
    xlsxNoteSeconds: () =>
      'Toda duración de las hojas Elementos y Recursos está en segundos, incluida la columna ' +
      'Busy time de Recursos, cualquiera sea la unidad base que declare el escenario; la app las ' +
      'convierte para mostrarlas, este libro no.',
    xlsxCostPerCase: () => 'Costo por caso',
    xlsxNoteCostPerCase: () =>
      'El costo por caso es el costo medio de los casos que terminaron, no el costo total ' +
      'dividido entre las instancias completadas: el costo de los casos en curso forma parte del ' +
      'costo total y no de esta media.',
    xlsxNotePayroll: () =>
      'El costo de nómina cobra la disponibilidad (capacidad x costo por hora x las horas ' +
      'abiertas de la corrida, ocupada u ociosa); el costo unitario de la hoja Recursos cobra ' +
      'solo las horas realmente ocupadas. Son dos preguntas distintas, no dos estimaciones de una.',
    xlsxDelta: (escenario) => `Delta ${escenario}`,
    xlsxDeltaRelative: (escenario) => `Delta % ${escenario}`,
    xlsxCi95Low: (escenario) => `IC95 inferior ${escenario}`,
    xlsxCi95High: (escenario) => `IC95 superior ${escenario}`,
    xlsxOverlap: (escenario) => `Solape IC95 ${escenario}`,

    docVersion: (version) => `Versión ${version}`,
    docDate: (date) => `Fecha: ${date}`,
    docGeneratedBy: (version) => `Generado por Lila Modeler ${version}`,
    docDescription: () => 'Descripción del proceso',
    docNoDescription: () => 'El proceso no tiene descripción.',
    docAttributeNoRef: () => 'Atributo sin referencia',
    docElements: () => 'Elementos',
    docNoLane: () => 'Sin carril',
    docType: () => 'Tipo',
    docId: () => 'Id',
    docLane: () => 'Carril',
    docSubprocess: () => 'Subproceso',
    docAttachedTo: () => 'Adjunto a',
    docDocumentation: () => 'Descripción',
    docNote: () => 'Nota',
    docResponsibilities: () => 'Responsabilidades (RACI)',
    docScenario: (name) => `Escenario: ${name}`,
    docResults: () => 'Resultados',
    docDiagramAlt: () => 'Diagrama del proceso',

    chartUtilization: () => 'Utilización por recurso (%)',
    chartInstances: () => 'Instancias iniciadas por tarea',
    chartPercentiles: (unit) => `Percentiles de tiempo de ciclo y de espera (${unit})`,
    chartCycle: () => 'Tiempo de ciclo',
    chartWait: () => 'Tiempo de espera',
    chartHistogram: (unit) => `Tiempo de ciclo por caso (${unit})`,
    chartHistogramSub: (cases, replications) =>
      replications > 1 ? `${cases} casos terminados de la réplica 1 de ${replications}` : `${cases} casos terminados`,
    chartValue: (label, text) => `${label}: ${text}`,
    chartNoValue: () => '-',
    chartCases: (n) => (n === 1 ? '1 caso' : `${n} casos`),
    chartCasesAxis: () => 'Casos',
    chartUnit: (unit) => (unit === 'day' ? 'd' : unit),

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
        : `(+${n(count, 'aviso', 'avisos')} más con el mismo código)`,

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
    bpmnPath: () => 'una ruta .bpmn o .lila',
    runPaths: () => 'un <modelo.bpmn|proyecto.lila> y un <escenario>',
    comparePaths: () => 'un <modelo.bpmn|proyecto.lila> y al menos dos escenarios <a> <b>',
    missingBpmnPath: () => 'falta la ruta del archivo .bpmn o .lila.',
    modelMismatch: (modelPath, scenarioModel) =>
      `el modelo posicional (${modelPath}) no coincide con scenario.model (${scenarioModel}).`,
    modelMismatchIn: (modelPath, scenarioModel, file) =>
      `el modelo posicional (${modelPath}) no coincide con scenario.model (${scenarioModel}) en ${file}.`,
    mcpNoArguments: () => 'no acepta argumentos.',
    mcpMissingPackage: (packageName) =>
      `falta el paquete ${packageName}. Instálalo junto al motor o corre \`npx -y ${packageName}\`; en el repo, \`npm ci && npm run build\` desde la raíz.`,
    invalidLang: (value, accepted) => `lila: --lang solo acepta: ${accepted}; se recibió "${value}".`,
    missingLangValue: (accepted) => `lila: --lang requiere un valor: ${accepted}.`,

    lilaProcessRequired: (file, slugs) =>
      `${file} contiene varios procesos (${slugs}): elige uno con --process <slug> (\`process\` en MCP).`,
    lilaUnknownProcess: (file, slug, slugs) => `${file} no tiene el proceso "${slug}"; sus procesos son: ${slugs}.`,
    processOnlyForLila: () => 'el slug de proceso solo aplica cuando el modelo es un archivo .lila.',
    lilaUnreadable: (file, detail) => `${file} no se puede abrir como proyecto .lila: ${detail}`,
    lilaScenarioNotFound: (name, slug, file, available) =>
      `no existe el archivo "${name}" ni un escenario con ese nombre en el proceso "${slug}" de ${file}; ` +
      (available === '' ? 'ese proceso no tiene escenarios.' : `sus escenarios son: ${available}.`),
    lilaScenarioUnknown: (name, slug, file, available) =>
      `no hay un escenario "${name}" en el proceso "${slug}" de ${file}; ` +
      (available === '' ? 'ese proceso no tiene escenarios.' : `sus escenarios son: ${available}.`),
    lilaScenarioAmbiguous: (name, matches) =>
      `hay varios escenarios llamados "${name}": ${matches}. Usa el nombre de archivo.`,
    lilaScenarioEntryName: (name) =>
      `"${name}" no es un nombre de escenario dentro de un .lila: usa un <nombre>.scenario.json plano, sin carpetas.`,
    lilaBusy: (file) =>
      `otro programa está guardando ${file} ahora mismo; no se escribió nada. Vuelve a intentarlo en un momento.`,
    lilaChangedOnDisk: (file) =>
      `${file} cambió en disco mientras esta llamada trabajaba con él; no se escribió nada. Vuelve a intentarlo.`,

    exportNeedsLila: (file) => `${file} no es un proyecto .lila: el documento y los resultados se exportan de uno.`,
    exportRunUnknown: (id, slug, file, runs) =>
      `el proceso "${slug}" de ${file} no tiene la corrida "${id}"; ` +
      (runs === '' ? 'no tiene corridas guardadas.' : `sus corridas son: ${runs}.`),
    exportNoRun: (file, slug, scenario) =>
      `el proceso "${slug}" de ${file} no tiene corridas guardadas${scenario === '' ? '' : ` de ${scenario}`}. ` +
      'Simúlalo con `lila run <archivo> <escenario> --save` (`saveRun` en MCP), o en Lila Modeler y guarda el proyecto.',
    exportNoCurrentRun: (file, slug, runs) =>
      `el proceso "${slug}" de ${file} no tiene corridas de su modelo y escenario actuales; corridas anteriores: ${runs}. ` +
      'Pasa una por id (--run, `run` en MCP) o vuelve a simular (`lila run … --save`).',
    exportRunAmbiguous: (file, slug, scenarios) =>
      `el proceso "${slug}" de ${file} tiene corridas actuales de varios escenarios (${scenarios}): ` +
      'elige uno con --scenario (`scenario` en MCP) o pasa el id de una corrida.',
    exportRunStale: (id, slug, file) =>
      `la corrida "${id}" del proceso "${slug}" de ${file} es de un modelo o escenario anterior: el documento ` +
      'mezclaría el modelo de hoy con resultados viejos. Exporta sus resultados o vuelve a simular.',
    exportNoDiagram: () => 'El modelo no tiene diagrama (BPMN DI): el documento va sin él.',
    exportDiagramNone: () =>
      'el modelo no tiene diagrama (BPMN DI) que dibujar. Maquétalo con edit_process (layout: true, lila process edit) o dibújalo en un editor BPMN; put_process_bpmn y create_project maquetan un modelo que reciben sin él.',
    exportDiagramUnreadable: (detail) =>
      `el modelo no tiene diagrama (BPMN DI) que dibujar, y no se le puede maquetar uno: bpmn-moddle no puede leer el modelo entero (${detail}), así que maquetarlo perdería ese contenido. Añade el diagrama en un editor BPMN.`,
    exportDocxNoDiagram: () =>
      'El documento Word va sin diagrama: Word necesita un PNG y el motor no rasteriza. El documento HTML sí lo lleva.',
    exportDocumentNoRun: () => 'Sin corrida actual: el documento lleva el modelo y no los resultados.',
    exportDocxNoCharts: () =>
      'El documento Word va sin gráficas: Word necesita un PNG y el motor no rasteriza. El documento HTML sí las lleva.',
    exportNoHistogram: () => 'El histograma del tiempo de ciclo queda fuera: una corrida guardada no conserva los tiempos por caso.',
    exportPercentilesNotReproduced: () =>
      'Los percentiles de espera por elemento quedan fuera: las entradas guardadas de la corrida no reproducen sus resultados guardados (una corrida cancelada, u otra versión del motor u otra plataforma, que puede cambiar el último dígito).',
    exportPercentilesFailed: (reason) =>
      `Los percentiles de espera por elemento quedan fuera: volver a simular las entradas guardadas de la corrida falló: ${reason}`,
    exportTargetExists: (target) => `${target} ya existe; no se escribió nada. Pasa --force (\`overwrite\` en MCP) para reemplazarlo.`,
    exportNotDirectory: (path) => `no se puede escribir dentro de ${path}: es un archivo, no un directorio.`,
    exportUnknownKind: (kind) => `exportación desconocida "${kind}": se espera diagram, doc o results.`,
    exportPaths: () => 'diagram|doc|results y un <modelo.bpmn|proyecto.lila>',
    exportInvalidFormat: (value, accepted) =>
      value === '' ? `elige un formato con --format: ${accepted}.` : `--format solo acepta: ${accepted}; se recibió "${value}".`,
    exportOutRequired: (kind) => `lila export ${kind} necesita --out <ruta>.`,
    exportTargetIsSource: (target) =>
      `${target} es el archivo que se exporta; no se escribió nada. Elige otro destino.`,
    exportFileNeeded: (path) => `"${path}" termina en barra; nombra el archivo que se escribe.`,
    exportRunAndScenario: () =>
      'el id de una corrida ya dice qué escenario: pasa --run <id> o --scenario (`run` o `scenario` en MCP), no los dos.',
    exportOverlayNeedsLila: (file) =>
      `${file} no es un proyecto .lila: una capa colorea el diagrama con una corrida guardada, y las corridas se guardan en un .lila.`,
    exportOverlayNoRun: (overlay, detail) => `la capa "${overlay}" necesita una corrida guardada: ${detail}`,
    exportRunNeedsOverlay: () =>
      'una corrida (--run o --scenario, `run` o `scenario` en MCP) solo aplica al diagrama con una capa: pasa --overlay bottlenecks|heatmap.',
    exportInvalidOverlay: (value) => `--overlay solo acepta: bottlenecks, heatmap; se recibió "${value}".`,
    exportOverlayWait: (wait) => `Espera ${wait}`,
    exportOverlayBottleneck: () => 'CUELLO',
    saveRunNeedsLila: () => 'guardar la corrida (--save, `saveRun` en MCP) necesita un modelo .lila.',
    saveRunNeedsArchiveScenario: (scenario) =>
      `guardar la corrida necesita un escenario del .lila, y "${scenario}" no lo es: nombra un escenario del proceso.`,
    lilaRunStale: (file, scenario) =>
      `el modelo o el escenario ${scenario} de ${file} cambió mientras corría la simulación; la corrida no se guardó. Vuelve a correrla.`,
    runSaved: (id, file, slug) => `Corrida ${id} guardada en ${file} (proceso ${slug}).`,
    outlineInvalid: (detail) => `el esquema del proceso no es válido:\n${detail}`,
    outlineDuplicateId: (id) => `el id "${id}" se usa más de una vez (pasos, inicios y eventos adjuntos comparten un solo conjunto de ids).`,
    outlineBadId: (id) => `el id "${id}" no es un id BPMN válido (letras, dígitos, "_", "-" y ".", sin empezar por dígito).`,
    outlineReservedId: (id) => `el id de paso "${id}" choca con un id que Lila genera (inicio, fin, flujos, carriles, diagrama); renombra el paso.`,
    outlineDuplicateLane: (lane) => `el carril "${lane}" aparece más de una vez.`,
    outlineUnknownLane: (step, lane) => `paso "${step}": el carril "${lane}" no está en "lanes".`,
    outlineStartUnknownLane: (start, lane) => `inicio "${start}": el carril "${lane}" no está en "lanes".`,
    outlineFromWithoutStarts: (step) => `paso "${step}": "from" nombra eventos de inicio, así que necesita "starts".`,
    outlineUnknownStart: (step, start) => `paso "${step}": "${start}" no es el id de ningún inicio de "starts".`,
    outlineStartUnused: (start) => `el inicio "${start}" no lleva a ningún paso: nómbralo en el "from" del paso al que lleva.`,
    outlineStartManySteps: (start, steps) =>
      `el inicio "${start}" está en el "from" de varios pasos (${steps}); un inicio lleva a un solo paso. Pon una compuerta después de él, o añade otro inicio.`,
    outlineUnknownTarget: (step, target) => `paso "${step}": "${target}" no es el id de ningún paso.`,
    outlineBranchesNeedGateway: (step, type) => `paso "${step}": "branches" necesita una compuerta (xor, or, and, eventGateway), no ${type}.`,
    outlineBranchTarget: (step) => `paso "${step}": cada rama necesita "to" (el id de un paso) o "end": true.`,
    outlineBoundaryTarget: (boundary) => `el evento adjunto "${boundary}" necesita uno solo de "to" (el id de un paso) y "end".`,
    outlineManyDefaults: (step) => `compuerta "${step}": solo una rama puede ser la de por defecto ("default": true).`,
    outlineEventGatewayTarget: (step, target) =>
      `compuerta por eventos "${step}": cada salida va a un paso timer o message, y "${target}" no lo es (ni un fin, ni una tarea, ni una compuerta pueden seguirla).`,
    outlineEventTargetWaysIn: (target, gateway, waysIn) =>
      `el paso "${target}" sigue a la compuerta por eventos "${gateway}", así que esa debe ser su única entrada; tiene ${waysIn}. Revisa "next", "to", "from" y el paso anterior de la lista.`,
    outlineMessageNeedsEventGateway: (step) => `paso "${step}": un paso message solo va después de una compuerta por eventos, como una de sus ramas.`,
    outlineDuplicateData: (step, name, direction) => `paso "${step}": el dato "${name}" (${direction}) aparece más de una vez.`,
    outlineDuplicateNote: (step, text) => `paso "${step}": la nota "${text}" aparece más de una vez.`,
    outlineManyNextNeedGateway: (step) => `paso "${step}": varios pasos en "next" necesitan una compuerta (xor, or, and); añade una.`,
    outlineEndWithNext: (step) => `paso "${step}": "end" no se puede combinar con "next" ni con "branches".`,
    outlineFieldNotApplicable: (step, field, type) => `paso "${step}": "${field}" no aplica a un ${type}.`,
    outlineProbabilityOnAnd: (step) => `paso "${step}": una compuerta paralela (and) toma todas las ramas; "probability" no aplica.`,
    outlineProbabilitySum: (step, sum) => `paso "${step}": las probabilidades de las ramas suman ${sum}, más de 1.`,
    outlineBadDuration: (step, text) =>
      `paso "${step}": la duración "${text}" no es una distribución. Escribe un número de segundos, "20m", "normal(20m, 5m)", "triangular(1m, 2m, 5m)", "exponential(mean=4m)" o un objeto de distribución del escenario.`,
    outlineBpmnInvalid: (detail) => `el proceso construido a partir del esquema no valida:\n${detail}`,
    outlineNoProcess: () => 'el BPMN no tiene ningún proceso.',
    outlineUnsupported: (id, type) => `${id} (${type}) no tiene equivalente en el esquema y se omitió.`,
    outlineLostFlow: (id) => `${id}: se descartó un flujo que llega o sale de un elemento omitido en el esquema.`,
    outlineStartManyFlows: (start, flows) =>
      `el evento de inicio ${start} tiene varios flujos de salida; un inicio del esquema lleva a un solo paso, así que se omitieron: ${flows}.`,
    outlineDroppedTrigger: (id, definitions) => `${id}: el esquema no tiene ${definitions}; se lee como un evento simple.`,
    outlineUnknownKey: (key) => `campo desconocido "${key}".`,
    outlineNotObject: () => 'debe ser un objeto.',
    outlineNotText: () => 'debe ser un texto no vacío.',
    outlineNotTextList: () => 'debe ser una lista de textos no vacíos.',
    outlineNotList: () => 'debe ser una lista no vacía.',
    outlineNotBoolean: () => 'debe ser true o false.',
    outlineNotProbability: () => 'debe ser un número entre 0 y 1.',
    outlineNotQuantity: () => 'debe ser un número entero de al menos 1.',
    outlineNoSteps: () => 'debe ser una lista no vacía de pasos.',
    outlineBadType: (value, accepted) => `"${value}" no es un tipo de paso; usa uno de ${accepted}.`,
    outlineBadNext: () => 'debe ser el id de un paso o una lista de ids.',
    outlineBadFrom: () => 'debe ser el id de un inicio o una lista de ids de inicio.',
    outlineBadEnd: () => 'debe ser true, false o "terminate".',
    outlineBadChoice: (accepted) => `debe ser uno de ${accepted}.`,
    outlineBadResource: () => 'debe ser el nombre de un recurso o {"name", "quantity"}.',
    outlineBadSelection: () => 'debe ser "and" (todos los recursos) u "or" (cualquiera de ellos).',
    outlineNoWayOut: (step) => `desde el paso "${step}" ningún camino llega a un fin: un caso que llegue aquí daría vueltas para siempre. Dale una salida al ciclo.`,
    outlineLayoutFailed: (detail) => `el maquetado automático falló con este esquema (${detail}). Prueba a listar las ramas en el orden en que aparecen sus pasos.`,
    outlineXorAndJoin: (join, split) =>
      `la unión paralela "${join}" espera ramas de la compuerta exclusiva "${split}", que solo toma una: los casos esperarían ahí para siempre. Usa una unión xor (u or).`,
    outlineDroppedPools: (names) => `los otros pools no forman parte del esquema y se omitieron: ${names}.`,
    outlineDroppedMessageFlows: (count) => `${n(count, 'flujo de mensaje no forma', 'flujos de mensaje no forman')} parte del esquema y ${count === 1 ? 'se omitió' : 'se omitieron'}.`,
    outlineDroppedEventNames: (events) => `los eventos de fin son implícitos en un esquema; se omitieron sus nombres: ${events}.`,
    outlineDroppedArtifacts: (count) => `${n(count, 'anotación, grupo o asociación no forma', 'anotaciones, grupos o asociaciones no forman')} parte del esquema y ${count === 1 ? 'se omitió' : 'se omitieron'}.`,
    outlineDroppedDefaults: (ids) => `las marcas de flujo por defecto que no salen de un xor o un or, y las rotas, no forman parte del esquema y se omitieron: ${ids}.`,
    outlineDroppedFlowNames: (flows) => `los nombres de los flujos que salen de un evento de inicio no forman parte del esquema y se omitieron: ${flows}.`,
    outlineMergedNotes: (notes) => `las anotaciones de texto que repiten una nota del mismo paso se leyeron una sola vez: ${notes}.`,
    outlineDroppedTimerExpressions: (ids) =>
      `las expresiones de temporizador del BPMN no forman parte del esquema (las duraciones viven en el escenario) y se omitieron: ${ids}.`,
    outlineDroppedProbabilities: (flows) =>
      `se omitieron las probabilidades de rama que el esquema no admite (fuera de un xor o un or, o las de un xor que suman más de 1): ${flows}.`,
    outlineScenarioOutside: (kinds) =>
      `${kinds.split(',').map((k) => ({ arrivals: 'las llegadas', calendars: 'los calendarios', costs: 'los costos', capacities: 'las capacidades y tipos de recurso', conditions: 'el ruteo condicionado' } as Record<string, string>)[k] ?? k).join(', ')} del escenario no forman parte del esquema; siguen en el escenario, que esta lectura no cambia.`,
    processSlugNewFile: (slug, derived) =>
      `un .lila nuevo tiene un solo proceso, cuyo slug sale de su nombre ("${derived}"), así que no puede ser "${slug}". Omite el slug o pon un nombre que lo dé.`,
    outlineFileUnreadable: (file, detail) => `no se puede leer el esquema ${file}: ${detail}`,
    processNotLila: (file) => `${file} no es un archivo .lila.`,
    processBadSlug: (slug) => `"${slug}" no es un slug de proceso válido (minúsculas, dígitos y guiones).`,
    processExists: (slug, file) => `${file} ya tiene un proceso "${slug}"; no se escribió nada. Elige otro nombre u otro slug.`,
    processCreated: (name, slug, file, steps, lanes, newFile) =>
      `Proceso "${name}" (${slug}) creado en ${newFile ? 'el archivo nuevo ' : ''}${file}: ${n(steps, 'paso', 'pasos')}, ${n(lanes, 'carril', 'carriles')}, escenario base as-is.scenario.json.`,
    processDryRun: (name, slug, file, steps, lanes, newFile) =>
      `Simulacro: se crearía el proceso "${name}" (${slug}) en ${newFile ? 'el archivo nuevo ' : ''}${file}: ${n(steps, 'paso', 'pasos')}, ${n(lanes, 'carril', 'carriles')}. No se escribió nada.`,
    processUnknownSubcommand: (sub) => `subcomando desconocido "${sub}"; usa create, show, edit, annotate, raci, export-bpmn, import o attribute.`,
    processMissingOption: (option) => `falta ${option}.`,
    processShowHeader: (name, slug) => `Proceso "${name}" (${slug})`,
    processShowLanes: (lanes) => `Carriles: ${lanes}`,
    editInvalid: (detail) => `la edición se rechazó; no se cambió nada:\n${detail}`,
    editBpmnInvalid: (detail) => `el proceso editado no validaría; no se cambió nada:\n${detail}`,
    editContentLoss: (detail) => `el modelo tiene contenido que el lector BPMN no sabe reescribir, así que editarlo lo perdería: ${detail}`,
    editUnknownId: (id) => `"${id}" no es el id de un elemento del modelo.`,
    editNotAStep: (id, type) => `"${id}" es un ${type}, no un paso (tarea, gateway, evento o subproceso).`,
    editOtherProcess: (id, process) => `"${id}" no está en el proceso que se edita (${process}).`,
    editBadId: (id) => `"${id}" no es un id BPMN válido (letras, dígitos, "_", "-" y ".", sin empezar por dígito).`,
    editIdTaken: (id) => `el id "${id}" ya se usa en el modelo.`,
    editAfterAndBetween: () => 'usa "after" o "between", no los dos.',
    editAfterAndBefore: () => 'usa "after" o "before", no los dos.',
    editBeforeOrAfter: () => 'indica "before" o "after": el carril junto al que va.',
    editAfterEnd: (id) => `"${id}" es un evento de fin: nada puede seguirle. Usa "between" con el paso anterior.`,
    editAfterAmbiguous: (id, count) =>
      `"${id}" tiene ${count} flujos de salida, así que "after" es ambiguo; usa "between": ["${id}", "<id del paso siguiente>"].`,
    editNoFlowBetween: (from, to) => `no hay un flujo de "${from}" a "${to}".`,
    editOtherContainer: (from, to) => `"${from}" y "${to}" no están en el mismo proceso o subproceso.`,
    editFromEnd: (id) => `"${id}" es un evento de fin: no puede salir ningún flujo.`,
    editToStart: (id) => `"${id}" es un evento de inicio o de borde: no puede llegarle ningún flujo.`,
    editProbabilityNeedsChoice: (id) =>
      `"probability" solo aplica a un flujo que sale de un gateway exclusivo (xor) o inclusivo (or); "${id}" no lo es.`,
    editNeedsScenario: (field, scenario) =>
      `"${field}" va al escenario base ${scenario}, y este proceso no lo tiene; ponlo con patch_scenario.`,
    editRemoveAmbiguous: (id, incoming, outgoing) =>
      `no se puede quitar "${id}": con ${n(incoming, 'flujo', 'flujos')} de entrada y ${outgoing} de salida no está claro cómo reconectarlos. Quita o reconecta sus flujos primero.`,
    editRemoveBoundary: (id, boundaries) => `no se puede quitar "${id}": tiene eventos de borde (${boundaries}); quítalos primero.`,
    editCannotRemove: (id, type) =>
      `"${id}" es un ${type}; solo se pueden quitar pasos, flujos de secuencia, eventos de borde y artefactos (anotaciones de texto, objetos y almacenes de datos, grupos, asociaciones).`,
    editLaneHasSubLanes: (lane, children) => `el carril "${lane}" tiene subcarriles (${children}); quítalos primero.`,
    editLaneNotEmpty: (lane, nodes) => `el carril "${lane}" contiene ${nodes}; indica "moveStepsTo": el carril que los recibe.`,
    editLaneTargetNotLeaf: (lane, children) => `el carril "${lane}" tiene subcarriles (${children}); los nodos van a un carril sin subcarriles.`,
    editLaneSameTarget: (lane) => `"moveStepsTo" es el carril que se quita ("${lane}"); indica otro carril.`,
    editLaneNotSibling: (lane, other) => `los carriles "${lane}" y "${other}" no están en el mismo conjunto de carriles; un carril solo se mueve entre sus hermanos.`,
    editLaneSelf: (lane) => `el carril "${lane}" no puede ir junto a sí mismo.`,
    editNoNote: (step, text, notes) =>
      `"${step}" no tiene la anotación de texto "${text}"${notes === '' ? '' : `; sus anotaciones son: ${notes}`}.`,
    editNoDataObject: (name, names) =>
      `el proceso no tiene un objeto de datos llamado "${name}"${names === '' ? '' : `; sus objetos de datos son: ${names}`}.`,
    editDataNotConnected: (name, step) => `el objeto de datos "${name}" no está conectado a "${step}".`,
    editBoundaryNeedsActivity: (id, boundaries) =>
      `"${id}" tiene eventos de borde (${boundaries}); solo una tarea, actividad de llamada o subproceso puede llevarlos.`,
    editNotOneEnd: (id, ends) =>
      `"${id}" no es un evento de fin ni un paso que lleve a uno solo (${ends === '' ? 'no lleva a ninguno' : `lleva a ${ends}`}); indica el id del evento de fin.`,
    editLaneUnknown: (lane, lanes) =>
      lanes === '' ? `no hay un carril "${lane}": el proceso no tiene carriles; agrega uno con addLane.` : `no hay un carril "${lane}"; los carriles son: ${lanes}.`,
    editLaneAmbiguous: (lane, ids) => `varios carriles se llaman "${lane}" (${ids}); usa el id del carril.`,
    editLaneOutsideProcess: (id) => `"${id}" está dentro de un subproceso, que no tiene carriles.`,
    editProbabilityNote: (gateway, scenario, sum, flows) =>
      `gateway "${gateway}": las probabilidades de sus flujos de salida en ${scenario} ahora suman ${sum}; ajústalas con patch_scenario, un {"op": "replace", "path": "/elements/<flujo>/probability", "value": …} por cada flujo de ${flows}.`,
    editScenarioRemoved: (scenario, id, removed) =>
      `${scenario}: se quitó elements.${id} ${removed}, que ya no aplica al modelo; patch_scenario puede ponerlo en otro elemento.`,
    editScenarioBroken: (detail) => `la edición dejaría un escenario que no simula; no se cambió nada:\n${detail}`,
    editPositionAfter: (id) => `después de "${id}"`,
    editPositionBetween: (from, to) => `entre "${from}" y "${to}"`,
    editPositionAlone: () => 'sin conectar',
    editPositionLane: (lane) => `en el carril "${lane}"`,
    editAdded: (id, type, position) => `agregado ${type} "${id}" ${position}`,
    editConnected: (from, to, flow) => `conectado "${from}" → "${to}" (${flow})`,
    editBoundaryAdded: (id, host, interrupting, target) =>
      `adjuntado a "${host}" el temporizador de borde ${interrupting ? 'que interrumpe' : 'que no interrumpe'} "${id}" → ${target}`,
    editRemovedFlow: (id) => `quitado el flujo "${id}"`,
    editRemovedStep: (id, reconnected, also) =>
      `quitado "${id}"${reconnected === '' ? '' : `; reconectado ${reconnected}`}${also === '' ? '' : `; también se quitó ${also}`}`,
    editAlsoRemoved: (ids) => `; también se quitó ${ids}`,
    editRenamed: (id, before, after) => `renombrado "${id}": "${before}" → "${after}"`,
    editRetyped: (id, from, to) => `"${id}": ${from} → ${to}`,
    editMoved: (id, lane) => `movido "${id}" al carril "${lane}"`,
    editLaneAdded: (name, id) => `agregado el carril "${name}" (${id})`,
    editLaneRemoved: (lane, id, to, nodes) => `quitado el carril "${lane}" (${id})${nodes === '' ? '' : `; ${nodes} pasaron al carril "${to}"`}`,
    editLastLaneRemoved: (lane, id) => `quitado el carril "${lane}" (${id}), el último: el proceso ya no tiene carriles y sus nodos siguen en el pool`,
    editLaneMoved: (lane, where, other) => `movido el carril "${lane}" ${where === 'before' ? 'encima de' : 'debajo de'} "${other}"`,
    editNoteAdded: (step, text, id) => `anotado "${step}": "${text}" (${id})`,
    editNoteExists: (step, text) => `"${step}" ya tiene la anotación de texto "${text}"; no cambió nada`,
    editNoteNotStep: (id, type) =>
      `"${id}" es un ${type}; una anotación de texto va en un paso (tarea, gateway, temporizador, mensaje o subproceso), el único lugar donde el esquema la relee como \`notes\`.`,
    editNoteRemoved: (step, text, ids) => `quitada la anotación de texto "${text}" de "${step}" (${ids})`,
    editDataAdded: (name, step, direction, id, created) =>
      `"${step}" ${direction === 'in' ? 'lee' : 'escribe'} el objeto de datos "${name}" (${id}${created ? ', nuevo' : ''})`,
    editDataExists: (name, step, direction) =>
      `"${step}" ya ${direction === 'in' ? 'lee' : 'escribe'} el objeto de datos "${name}"; no cambió nada`,
    editDataRemoved: (name, step, ids) => `desconectado el objeto de datos "${name}"${step === undefined ? '' : ` de "${step}"`} (${ids})`,
    editRemovedElement: (id, type, also) => `quitado ${type} "${id}"${also === '' ? '' : `; también se quitó ${also}`}`,
    processEdited: (name, slug, file, operations, removed) =>
      `Editado el proceso "${name}" (${slug}) en ${file}: ${n(operations, 'operación', 'operaciones')}, ${n(removed, 'elemento quitado', 'elementos quitados')}.`,
    processEditDryRun: (name, slug, file, operations, removed) =>
      `Simulacro: se editaría el proceso "${name}" (${slug}) en ${file}: ${n(operations, 'operación', 'operaciones')}, ${n(removed, 'elemento quitado', 'elementos quitados')}. No se escribió nada.`,
    editOpsUnreadable: (file, detail) => `no se pueden leer las operaciones ${file}: ${detail}`,
    editNotList: () => 'debe ser una lista no vacía de operaciones.',
    editUnknownOp: (op, accepted) => `"${op}" no es una operación; usa una de ${accepted}.`,
    editBadBetween: () => 'deben ser dos ids de paso: [from, to].',
    editDuplicateLane: (lane) => `ya hay un carril llamado "${lane}"; elige otro nombre.`,
    editLayoutFailed: (detail) => `el maquetado automático falló en el proceso editado (${detail}); no se cambió nada. Prueba con layout: false (--no-layout).`,
    editNotACallActivity: (id, type) => `"${id}" es un ${type}, no una actividad de llamada (callActivity); solo una actividad de llamada llama a un proceso.`,
    editCallNeedsLila: () =>
      'setCalledProcess necesita un .lila: el proceso llamado se nombra por su slug entre los procesos del proyecto (edit_process, lila process edit).',
    editCallUnknownProcess: (slug, slugs) =>
      slugs === '' ? `el proyecto no tiene un proceso "${slug}", ni otro proceso al que llamar.` : `el proyecto no tiene un proceso "${slug}"; los procesos a los que una actividad de llamada puede llamar son: ${slugs}.`,
    editCallSelf: (slug, processId) =>
      `"${slug}" tiene el id de proceso BPMN ${processId}, el del proceso que se edita: una actividad de llamada no puede llamar a su propio proceso.`,
    editCallShared: (slug, processId, others, count) =>
      `"${slug}" tiene el id de proceso BPMN ${processId}, que ${others} ${count === 1 ? 'también declara' : 'también declaran'}: una actividad de llamada no puede distinguirlos; dale otro id a uno de ellos (put_process_bpmn con mode "replace").`,
    editCallUnresolved: (slug, declared) =>
      declared === ''
        ? `el modelo de "${slug}" no declara ningún proceso BPMN, así que una actividad de llamada no puede nombrarlo.`
        : `no se sabe a qué proceso BPMN de "${slug}" llamar: su modelo declara ${declared}, y ninguno es su id de modelo ni el proceso que simula.`,
    editBadCalledProcess: () => 'debe ser el slug de un proceso del proyecto, o null para quitar el proceso llamado.',
    editCalled: (id, name, slug) => `"${id}" ahora llama a ${name} (${slug})`,
    editCallCleared: (id) => `"${id}" ya no llama a ningún proceso`,

    extendsCycle: (chain) => `extends: ciclo en la cadena de herencia: ${chain}`,
    scenarioNotObject: (file) => `${file}: el escenario debe ser un objeto JSON.`,
    extendsNotPath: (file) => `${file}: extends debe ser una ruta a otro escenario.`,
    patchRoot: () => 'json patch: la raíz del documento no se puede parchear.',
    patchBadPointer: (pointer) => `json patch: puntero inválido: ${pointer}`,
    patchForbiddenSegment: (key, pointer) =>
      `json patch: segmento prohibido "${key}" en ${pointer}: escribiría en el prototipo del objeto.`,
    patchForbiddenKey: (key, path) =>
      `json patch: clave prohibida "${key}" en el value de ${path}: escribiría en el prototipo del objeto.`,
    patchMissingSegment: (segment) => `json patch: no existe la ruta hasta "${segment}".`,
    patchNotContainer: () => 'json patch: la ruta no llega a un objeto o array.',
    patchUnsupportedOp: (op) =>
      `json patch: operación no soportada: "${op}" (solo add/replace/remove/test; move/copy no están implementadas).`,
    patchNeedsValue: (op, path) => `json patch: la operación "${op}" requiere "value" (${path}).`,
    patchTestFailed: (path) => `json patch: test falló en ${path}.`,
    patchBadIndex: (path) => `json patch: índice inválido en ${path}.`,
    patchMissingPath: (path) => `json patch: no existe la ruta ${path}.`,
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
    projectOrPath: () => 'hay que pasar `project` o `path`.',
    bothProjectAndPath: () => 'pasa `project` o `path`, no los dos.',
    modelMismatch: (modelPath, scenarioModel) =>
      `el modelo (${modelPath}) no coincide con scenario.model (${scenarioModel}).`,
    modelInvalid: (detail) => `el modelo no pasa la validación: ${detail}`,
    scenarioInvalid: (detail) => `escenario inválido: ${detail}`,
    atLeastTwoScenarios: () => 'hacen falta al menos dos escenarios.',
    xlsxNeedsSaveTo: () => '`format: "xlsx"` necesita `saveTo`: el libro se escribe en un archivo, no se devuelve.',
    allWithSummary: () => '`all: true` pide todas las filas y `detail: "summary"` un resumen: pasa solo uno de los dos.',
    logToTaken: (target) => `\`logTo\` (${target}) es un archivo que esta llamada ya lee o escribe: elige otra ruta.`,
    patchNotAnObject: () => 'el patch no produjo un objeto de escenario.',
    invalidAfterPatchLabel: () => 'escenario inválido tras el patch:',
    patchedMissingModel: () => 'el escenario resultante no declara model.',
    patchedMissingRun: () => 'el escenario resultante no declara run.',
    patchedName: (name) => `${name} (parcheado)`,
    inlineScenario: () => 'escenario inline',
    projectNotLila: (file) => `\`project\` tiene que ser un archivo .lila; se recibió ${file}.`,
    patchNoChange: () =>
      'el patch no cambia nada, así que no se escribió nada: el escenario conserva su revisión y sus corridas siguen vigentes.',
    patchSameTarget: (target) =>
      `${target} ya tiene este escenario, así que no se escribió nada: conserva su revisión y sus corridas siguen vigentes.`,
  },
};
