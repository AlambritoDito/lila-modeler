# MCP (LILA-053/054/055/056)

> Leer en: [English](../MCP.md)

`packages/mcp` (`@lila-modeler/mcp`) es un servidor [MCP](https://modelcontextprotocol.io) por stdio sobre
`@lila-modeler/engine`, sin lógica propia: veinticinco tools, sobre el mismo pipeline de validación y
simulación que la CLI — ver [`docs/es/CLI.md`](CLI.md) para ese mismo pipeline manejado desde una
terminal en vez de un cliente MCP.

Para el flujo completo de un agente — entrevista, esquema, escenario, corrida, documento y ver el
resultado en la app — lee la [guía para agentes](GUIA-AGENTES.md).

Además de las tools, el servidor ofrece esa guía, los formatos del esquema y del escenario y el JSON
Schema del escenario como recursos, y el flujo de la guía como el prompt `interview-to-process`; ver
[Recursos y prompt](#recursos-y-prompt).

- **`validate_bpmn({ path | xml, process?, locale? })`** — parsea y valida un `.bpmn` y devuelve exactamente el mismo
  JSON que `lila validate --json` (el IR, `ignoredProcessIds`, `errors` y `warnings`). Se pasa
  `path` **o** `xml`, nunca los dos: pasar ambos es un error de la tool, no una precedencia
  silenciosa.
- **`describe_process({ path | xml, process?, scenario?, locale? })`** — parsea un `.bpmn` (por ruta o XML inline,
  uno de los dos, con la misma regla que `validate_bpmn`) y devuelve su IR (`ProcessIR`)
  junto con un resumen legible (la clave `resumen`, en el idioma que diga `locale`): conteo de
  nodos por tipo, gateways con sus salidas,
  lanes, subprocesos embebidos aplanados, los otros `bpmn:process` del archivo que no se simulan, y
  una línea de validación (`Validation: N errors, M warnings`, o su equivalente en español) que
  avisa cuando el modelo está fuera
  del perfil y no se puede simular. Con `scenario` (ruta a un escenario `.json`, resuelve
  `extends`) agrega los recursos referenciados por elemento; si el escenario no se puede leer, el
  resumen dice por qué y la tool no falla.
- **`run_simulation({ model?, process?, scenario, seed?, replications?, saveTo?, saveRun?, logTo?, detail?, locale? })`** (LILA-054) — valida
  modelo y escenario, simula y devuelve exactamente el mismo `RunResult` que
  `lila run --json` (elementos, flujos, recursos, proceso, bottlenecks y avisos). `scenario` acepta
  una ruta `.json` (resuelve `extends`, igual que la CLI) o el escenario ya resuelto como objeto
  inline; `model` es opcional y por defecto es `scenario.model`; se rechaza un modelo distinto.
  Ningún campo de nivel 2/3 se rechaza (LILA-184): `resources` y `calendars` los simula el motor desde LILA-033…036 y LILA-041.
  `saveTo` escribe el mismo JSON de forma atómica que `lila run --json <ruta>`. Trae
  `outputSchema` (`@lila-modeler/engine/result-schema`) y responde `structuredContent` además del texto.
  Por defecto la respuesta es un resumen; `detail: "full"` devuelve el `RunResult` completo (ver
  [Resumen o resultado completo](#resumen-o-resultado-completo)). Una corrida larga informa su
  progreso y se puede cancelar ([Progreso y cancelación](#progreso-y-cancelación)).
  Con un `model` `.lila` y un escenario suyo, `saveRun: true` guarda la corrida en el proyecto (ver
  [Guardar una corrida](#guardar-una-corrida)). `logTo` escribe el event log en un archivo CSV: los
  mismos bytes que el `log.csv` de `lila run --csv` con el mismo modelo, escenario, semilla y
  réplicas. Las filas se escriben en streaming a un temporal durante la corrida, así que la memoria
  no crece en corridas largas, y el archivo se publica solo si la llamada sale bien, después de
  `saveTo` y `saveRun`. Se rechaza un `logTo` que nombre el modelo, el `.lila`, el archivo del
  escenario o `saveTo`. Con `logTo` o `saveRun`, un
  segundo bloque de texto dice dónde quedaron: `{ log, savedRun }`, cada clave solo si se pidió;
  `log` es la ruta absoluta.
- **`compare_scenarios({ model?, process?, scenarios, seed?, replications?, saveTo?, format?, all?, detail?, locale? })`** (LILA-054) — valida
  y simula dos o más escenarios sobre el mismo modelo (el primero es la base) y devuelve
  exactamente el mismo `CompareResult` que `lila compare --json`, más `notes`: los avisos que la
  CLI imprime aparte de la tabla (semillas distintas, `baseTimeUnit` distinto, réplicas
  insuficientes para IC95). `scenarios` acepta rutas y objetos inline mezclados. Todo escenario se
  resuelve y valida contra el modelo antes de simular ninguno. Por defecto `comparison` conserva
  las filas del proceso y de los recursos y las significativas; `detail: "full"` devuelve todas, y
  `all: true` es lo mismo con el nombre de `lila compare --all` (con `detail: "summary"` es un
  error). `format: "xlsx"` hace que `saveTo` escriba el libro de `lila compare --xlsx`, los mismos
  bytes, en vez del JSON; necesita `saveTo`.
- **`patch_scenario({ scenario, project?, process?, patch, saveTo?, extendsFrom?, name?, description?, locale? })`**
  (LILA-055) — aplica un [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) a `scenario`, valida
  el resultado contra su modelo (mismas reglas que `validateScenario`, `docs/SCENARIO_FORMAT.md`
  § 5) y **solo si valida** lo escribe a disco de forma atómica; nunca dos veces. Devuelve
  `{ scenario, file, written, notes }`: el escenario resultante ya resuelto, la ruta absoluta escrita,
  si se escribió y los avisos de lint (`W-…`) como `notes`. Un patch que no cambia nada (solo `test`,
  o un `saveTo` cuyo destino ya tiene el resultado) no escribe nada: `written` es `false`, `notes`
  lo dice primero y el escenario conserva su revisión, así que sus corridas guardadas siguen
  vigentes (#627). Dos modos:
  - **Sin `saveTo`** (modo a) — parchea `scenario` en sitio: el patch se aplica sobre el escenario
    ya resuelto (con `extends` fusionado) y se sobrescribe el mismo archivo con el resultado
    completo, sin `extends` propio. Es un "aplanar y parchear": si `scenario` tenía su propio
    `extends`, el archivo escrito ya no lo tiene. `model` se escribe **relativo al propio
    escenario**, no como la ruta absoluta que tenía ya resuelta: un escenario con
    `/Users/quien-corrió-la-tool/…` dentro deja de resolver en cualquier otro checkout. Y un patch
    que borra `model` o `run` se rechaza: el esquema los deja opcionales porque un archivo con
    `extends` los hereda, pero un escenario aplanado sin ellos no se puede simular.
  - **Con `saveTo`** (modo b) — crea un archivo **nuevo** que declara `extends` hacia
    `extendsFrom` (por defecto, el propio `scenario`) y contiene **solo las claves que tocó el
    patch**, como `examples/pedido/to-be-3-cajeros.scenario.json`. La ruta de `extends` se escribe
    relativa al archivo nuevo (`docs/SCENARIO_FORMAT.md` § 6), sin importar en qué directorio esté
    `saveTo`. Un `remove` se escribe como `null`, que es como `extends` borra una clave heredada
    (§ 6). Si `saveTo` apunta al propio `scenario` (o a `extendsFrom`), el archivo heredaría de sí
    mismo: es un ciclo de `extends` y la tool falla sin escribir — para parchear en sitio, se omite
    `saveTo`. Un archivo de destino existente se sobrescribe: «nuevo» describe el escenario
    derivado, no una garantía de creación exclusiva.

  El patch soporta `add`/`replace`/`remove`/`test` (RFC 6902) con punteros RFC 6901
  (`/resources/cajero/capacity`); **no** soporta `move` ni `copy` — son las dos operaciones que
  leen de una ubicación distinta a la que escriben, y ningún caso de uso de esta tool las necesita
  (`packages/mcp/src/json-patch.ts`). Un patch que deja el escenario inválido — `probability` fuera
  de `[0, 1]`, `capacity < 1`, una `ref` que no existe en `resources`, un `id` que no existe en el
  modelo, … — es `isError: true` y **no escribe nada**, en ninguno de los dos modos.

Las tres tools de LILA-054/055 reutilizan `@lila-modeler/engine/cli-shared`, extraído de `cli.ts` en
LILA-054 sin cambiar su salida: `runCommand`/`compareCommand` y las tools corren exactamente el
mismo pipeline (`loadResolvedScenario`, `validateScenario`, `writeJsonAtomic`).

- **`export_diagram({ project | path, process?, saveTo?, overwrite?, locale? })`** — dibuja el
  diagrama de un proceso de un `.lila` (`project`) o de un `.bpmn` (`path`) como SVG, con el
  renderizador propio del motor. Devuelve `{ process, svg }` o, con `saveTo`, `{ process, file }`.
- **`export_document({ project, process?, run?, scenario?, format, saveTo, overwrite?, locale? })`** —
  escribe el documento del proceso (`format`: `docx` o `html`) con los resultados de una corrida
  guardada. Devuelve `{ file, format, project, process, run, notes }`.
- **`export_results({ project, process?, run?, scenario?, format, saveTo, overwrite?, locale? })`** —
  escribe los resultados de una corrida guardada (`format`: `xlsx`, o `csv` en el directorio
  `saveTo`). Devuelve `{ files, format, project, process, run }`.
- **`create_process({ outline, project, process?, name?, dryRun?, locale? })`** (#97) — convierte un
  esquema del proceso —carriles más una lista ordenada de pasos— en un proceso BPMN maquetado y
  validado, y lo escribe como un proceso nuevo del `.lila` `project` (o en un `.lila` nuevo). Nunca
  reemplaza un proceso. Devuelve `{ file, slug, name, newFile, dryRun, warnings, notes, outline,
  summary, slugs }`. Ver [Crear un proceso desde un esquema](#crear-un-proceso-desde-un-esquema).
- **`get_process_outline({ project, process?, locale? })`** (#97) — lee un proceso de un `.lila`
  como esquema: `{ file, slug, name, outline, warnings }`.
- **`edit_process({ project, process?, operations, dryRun?, layout?, locale? })`** (#98) — aplica una
  lista de operaciones (add, connect, remove, rename, setType, moveToLane, addLane, removeLane,
  moveLane, addBoundary, annotate, removeAnnotation, addDataObject, removeDataObject) a un proceso de
  un `.lila`, todas o ninguna. Devuelve `{ file, slug, name, dryRun, summary, changes, removed,
  scenarioRemovals, notes, warnings, outline }`. Ver [Editar un proceso](#editar-un-proceso).

- **`annotate_element({ project, process?, elementId, documentation?, responsibilities?, refs?, attributes?, dryRun?, locale? })`** —
  escribe la descripción, el RACI, las referencias al catálogo y los atributos extendidos de un
  elemento de un proceso de un `.lila`. Devuelve
  `{ file, process, elementId, documentationOn?, dryRun, changed, written, before, after }`.
- **`define_attribute({ project, process?, id?, name?, type?, appliesTo?, options?, default?, remove?, dryRun?, locale? })`**
  (#633) — define, cambia o quita un atributo extendido de un proceso de un `.lila`, el que luego
  rellena `annotate_element`. Devuelve
  `{ file, process, dryRun, changed, written, before, after, removedValues, definitions }`.
- **`get_raci_matrix({ project, process?, locale? })`** — devuelve la matriz RACI del proceso:
  `{ file, process, roles, rows }`.
- **`import_scenario_sheet({ project, process?, scenario, sheet, dryRun?, locale? })`** — aplica
  una hoja de escenario (`.xlsx`/`.csv`) a un escenario del `.lila`. Devuelve
  `{ file, process, scenario, sheet, dryRun, written, tables, changes, issues }`.
- **`export_scenario_template({ project, process?, scenario, saveTo, overwrite?, locale? })`** —
  escribe esa hoja como `.xlsx`, rellenada. Devuelve `{ file, project, process, scenario }`.
- **`create_project({ path, name, bpmn, scenarios?, overwrite?, allowUnsimulatable?, locale? })`** — crea un `.lila`
  nuevo a partir de un BPMN que ya existe (un agente que parte de pasos usa `create_process`) y
  escenarios. Devuelve `{ file, name, processId, laidOut, warnings, notes, scenarios }`.
- **`get_project({ project, locale? })`** (#628) — lista lo que tiene un `.lila` sin escribir nada:
  sus procesos, sus escenarios y sus corridas guardadas, vigentes u obsoletas. Devuelve
  `{ file, name, formatVersion, processes }`.
- **`get_scenario({ project, process?, scenario, resolved?, locale? })`** (#628) — lee un escenario
  como está guardado, o resuelto por `extends`, con las notas del validador, sin escribir nada.
  Devuelve `{ file, process, entry, revision, resolved, scenario, runnable, notes }`.
- **`get_process_bpmn({ project, process?, locale? })`** (#632) — lee el XML BPMN de un proceso
  como está guardado, sin escribir nada. Devuelve `{ file, process, processId, revision, xml }`.
- **`put_process_bpmn({ project, process?, bpmn, mode, name?, layout?, allowUnsimulatable?, dryRun?, locale? })`**
  (#632) — añade un BPMN como proceso nuevo de un `.lila` que ya existe (`mode: "add"`) o
  reemplaza el modelo de uno (`mode: "replace"`). Devuelve `{ file, mode, slug, name, processId,
  revision, dryRun, laidOut, summary, scenarioRemovals, notes, warnings, slugs }`.
- **`rename_process({ project, process, name, dryRun?, locale? })`** (#634) — renombra un proceso de
  un `.lila`; su slug no cambia. Devuelve `{ file, dryRun, written, process, before, after,
  summary, notes }`.
- **`delete_process({ project, process, dryRun?, locale? })`** (#634) — borra un proceso con sus
  escenarios y sus corridas guardadas. Devuelve `{ file, dryRun, written, process, name,
  removedScenarios, removedRuns, slugs, summary, notes }`.
- **`rename_scenario({ project, process?, scenario, name, dryRun?, locale? })`** (#634) — renombra un
  escenario; su archivo no cambia. Devuelve `{ file, dryRun, written, process, entry, before,
  after, revision, summary, notes }`.
- **`delete_scenario({ project, process?, scenario, dryRun?, locale? })`** (#634) — borra un
  escenario con sus corridas guardadas. Devuelve `{ file, dryRun, written, process, entry,
  removedRuns, summary, notes }`.

Las tres de exportación se explican en [Exportar sin la app](#exportar-sin-la-app); las seis
siguientes en [Herramientas de modelado para agentes](#herramientas-de-modelado-para-agentes);
`get_project` y `get_scenario` en [Leer un proyecto](#leer-un-proyecto); `get_process_bpmn` y
`put_process_bpmn` en [El BPMN de un proceso](#el-bpmn-de-un-proceso); las cuatro últimas en
[Renombrar y borrar](#renombrar-y-borrar).

Toda tool que recibe un modelo acepta también un proyecto `.lila`: ver
[Un `.lila` como entrada](#un-lila-como-entrada).

## Un `.lila` como entrada

Un `.lila` (`docs/PROJECT_FORMAT.md`) se acepta donde una tool recibe un modelo (#466): `path` de
`validate_bpmn`/`describe_process`, `model` de `run_simulation`/`compare_scenarios` y `project`
de `patch_scenario`. Las reglas son las de la CLI (`docs/CLI.md`, «Un `.lila` como entrada»):

- **`process`** es el slug del proceso cuando el proyecto tiene varios (un repositorio de
  versión 2). Con un solo proceso es implícito; con varios y sin `process`, la tool falla con un
  mensaje que lista los slugs. `process` con un `.bpmn` es un error, no se ignora.
- **Un escenario como texto** es una ruta `.json` si ese archivo existe y, si no, el nombre de un
  escenario del proceso: su nombre de entrada (`as-is.scenario.json`), ese nombre sin
  `.scenario.json` (`as-is`) o su `"name"` (`"AS-IS"`, único en el proceso). Un escenario del
  disco se simula contra el proceso del archivo; uno del archivo resuelve `model` y `extends`
  dentro de él.
- **Un escenario inline** queda anclado dentro del proceso: `extends: "as-is.scenario.json"`
  nombra un escenario del archivo, y si falta `model` es el `model.bpmn` del proceso.
- **`patch_scenario` con `project`** lee `scenario` (y `extendsFrom`) como nombres dentro del
  proceso —nunca como rutas del disco— y `saveTo` como el nombre de la entrada nueva (se añade
  `.scenario.json` si falta; sin carpetas). Valida contra el modelo del proceso y solo escribe un
  resultado válido, igual que en disco. La escritura pasa por el códec del motor (`encodeLila`) a
  un temporal que luego se renombra sobre el `.lila`, así que un fallo nunca deja un archivo a
  medias. La revisión del escenario sube en uno, para que la app vea como desactualizadas las
  corridas de la versión anterior; un patch que no cambia nada no se escribe y deja la revisión como estaba. Los demás procesos, escenarios y corridas pasan sin cambios y,
  en un archivo escrito por la app o el motor, byte a byte; las entradas que no son parte del
  formato se descartan, como en cualquier guardado de un `.lila`. Si el archivo cambió en disco
  mientras la tool trabajaba (otro programa, otro servidor MCP, la CLI o la app de escritorio), no se
  escribe nada y la tool falla: vuelve a llamarla. Quienes escriben el mismo `.lila` se turnan con un
  archivo de bloqueo junto a él (`<archivo>.lila.lock`, nunca dentro del archivo); si otro lo retiene más
  de 3 segundos, la tool falla con «otro programa está guardando» sin escribir nada. Un bloqueo sin
  tocar durante 10 segundos se toma como restos de un cierre inesperado y se borra. Un `project` que no es un `.lila` se rechaza.

```json
{ "name": "run_simulation", "arguments": { "model": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "seed": 42, "replications": 3 } }
```

```json
{ "name": "patch_scenario", "arguments": { "project": "proyecto.lila", "process": "pedido", "scenario": "as-is",
  "saveTo": "to-be-4", "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 4 }] } }
```

## Leer un proyecto

`get_project` y `get_scenario` (#628) son `lila project show` y `lila scenario show`
(`docs/es/CLI.md`) como tools. Solo leen: ni escritura ni cambio de revisión, el `.lila` queda byte
a byte como estaba. Llama primero a `get_project` sobre un archivo que ya existe, en vez de
descubrir sus procesos, escenarios y corridas por los errores de otras tools.

- **`get_project`** devuelve `{ file, name, formatVersion, processes }`. `formatVersion` es 2 para
  un repositorio de varios procesos y 1 si no. Cada proceso trae `slug` (lo que recibe `process`),
  `name`, `processId` (su `bpmn:process`), `modelRevision`, `elements` (nodos de flujo: tareas,
  eventos, compuertas; `null` si el modelo no se puede leer), `scenarios` (`entry`, `name`,
  `revision`, `extends`), `runs` (`id`, `scenario`, `start`, `replications`, `current`) y
  `attributes`, los atributos extendidos que define (`id`, `name`, `type`, `appliesTo`, `default?`,
  `options?`; `null` si el modelo no se puede releer entero). Una
  corrida tiene `current: false` (obsoleta) cuando el modelo o su escenario cambiaron después de
  ella: `export_results` y `export_document` solo la toman por id. Un `.lila` no guarda la fecha en
  que se tomó una corrida; `start` es el inicio simulado (`run.start`) del escenario que corrió.
- **`get_scenario`** devuelve `{ file, process, entry, revision, resolved, scenario, runnable, notes }`.
  `scenario` es la entrada como está guardada (con su `extends`), o con `resolved: true` fusionada
  por `extends` con los valores por defecto del motor: el objeto que parchea `patch_scenario`, con
  `model` relativo al escenario. `notes` son las del validador contra el modelo del proceso
  —primero los errores (`E-…`), luego los avisos (`W-…`), las comprobaciones que hace
  `run_simulation` antes de simular—, así que sirve de lint de escenarios; `runnable` es `false`
  cuando hay un error. Un escenario cuyo `extends` no se puede resolver vuelve con
  `scenario: null` (al resolverlo) y el motivo en `notes`.

Para leer un escenario usa `get_scenario`, no un `patch_scenario` con solo `test`: ese tampoco
escribe nada (#627), pero no es para leer.

```json
{ "name": "get_project", "arguments": { "project": "credito.lila" } }
```

```json
{ "name": "get_scenario", "arguments": { "project": "credito.lila", "scenario": "as-is", "resolved": true } }
```

## El BPMN de un proceso

`get_process_bpmn` y `put_process_bpmn` (#632) leen y escriben como XML el BPMN de un proceso de
un `.lila`, por el mismo códec y el mismo candado que las demás tools: es la forma de traer un
modelo dibujado en otro lado (una exportación de Bizagi, por ejemplo) como otro proceso de un
proyecto, o de pasarle un proceso a una herramienta BPMN y recibirlo de vuelta. `lila process
export-bpmn` y `lila process import` (`docs/es/CLI.md`) hacen lo mismo desde una terminal.

- **`get_process_bpmn`** devuelve el modelo tal como está guardado: `xml`, su `revision` y
  `processId`, el `bpmn:process` que simula el proyecto (como lo lista `get_project`). No escribe
  nada.
- **`put_process_bpmn`** recibe `bpmn` como XML (empieza por `<`) o como ruta a un `.bpmn`, y lo
  valida como `create_project`: un modelo con errores de validación se rechaza.
  - **`mode: "add"`** lo añade como proceso nuevo de un `.lila` que ya existe (para empezar un
    archivo nuevo, usa `create_project`); un proyecto versión 1 pasa a ser un repositorio. Su slug
    es `process`, o sale de `name`, si no del nombre de su pool, del de su proceso o del del
    archivo; un slug que ya está en el archivo se rechaza. Recibe un `as-is.scenario.json` como el
    que la app le da a un proceso nuevo: 20 llegadas con un minuto entre ellas en cada evento de
    inicio y un minuto de trabajo en cada tarea, listo para correr y para parchear.
  - **`mode: "replace"`** reemplaza el modelo del proceso `process` (implícito si el `.lila` tiene
    uno). Conserva su nombre (aquí `name` se rechaza) y sus escenarios; su revisión sube, así que
    sus corridas guardadas quedan obsoletas. Las anotaciones `lila:` (RACI, referencias, atributos
    extendidos) y la documentación son las del modelo nuevo: las viejas se van con el modelo
    viejo. Las entradas de escenario que ya no aplican — las de un elemento que el modelo nuevo no
    tiene y los campos que un elemento que cambió de tipo ya no admite — se quitan y se listan en
    `scenarioRemovals`, `{ scenario, id, removed, entry }`, igual que en `edit_process`, y `notes`
    lo dice con palabras. Si aun así un escenario tiene un error que con el modelo viejo no tenía,
    la llamada se rechaza.
  - **`allowUnsimulatable: true`** guarda un modelo que el simulador no puede correr — eventos de
    mensaje o señal, colaboraciones, ciclos, un diagrama dibujado para documentar — como lo guarda
    la app. Acepta cualquier error de validación, y en un reemplazo también un error de escenario;
    cada uno vuelve en `notes` (`no se simula: E-NOSOP: …`). Un archivo que no es XML, no es BPMN
    o no tiene `bpmn:process` se sigue rechazando. Nada marca el proceso: «no se simula» es lo que
    dice `get_scenario` (`runnable: false`, con los errores en sus `notes`) y `run_simulation` lo
    rechaza, hasta que se arregle el modelo.
  - **`layout`** (por defecto `true`) dibuja un modelo sin diagrama (sin formas `bpmndi`) con el
    maquetado automático de `create_project` (`laidOut: true`); `false` lo deja como llegó.
  - La escritura es la misma escritura atómica y con candado de `patch_scenario`: si el archivo
    cambió en disco desde que se leyó, la llamada se rechaza (`E-CAMBIO-EXTERNO`) y no se pierde
    nada. Los demás procesos quedan byte a byte. `dryRun` comprueba todo y no escribe nada.

```json
{ "name": "put_process_bpmn", "arguments": { "project": "credito.lila", "mode": "add",
  "bpmn": "examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn", "name": "MIWG A.1.0", "locale": "es" } }
```

```json
{ "name": "get_process_bpmn", "arguments": { "project": "credito.lila", "process": "miwg-a-1-0" } }
```

```json
{ "name": "put_process_bpmn", "arguments": { "project": "credito.lila", "process": "miwg-a-1-0", "mode": "replace",
  "bpmn": "miwg-editado.bpmn", "allowUnsimulatable": true, "dryRun": true } }
```

## Renombrar y borrar

`rename_process`, `delete_process`, `rename_scenario` y `delete_scenario` (#634) ordenan un `.lila`
Los renombres siguen a la app; los borrados rechazan lo que dejaría al proyecto con una referencia
colgante. Hay una tool por operación, así que los dos borrados se anuncian como
destructivos (`destructiveHint: true`) y los dos renombres no. Cada rechazo explica por qué, en el
idioma de la llamada, y no escribe nada. Cada escritura es la escritura atómica y con candado de
`patch_scenario` (`E-CAMBIO-EXTERNO` si el archivo cambió en disco desde que se leyó), los demás
procesos quedan como estaban y `dryRun` comprueba todo y no escribe nada. `written` dice si se
guardó el archivo; `summary` dice en una línea lo que pasó.

- **`rename_process`** cambia el `name` del proceso, el que muestra su pestaña del lienzo. El slug
  (su carpeta `processes/<slug>/`) nunca cambia. Un proyecto con un solo proceso se escribe como un
  archivo de versión 1, cuyo proceso se llama como el proyecto, así que renombrar ese proceso se
  rechaza. El mismo nombre no escribe nada.
- **`delete_process`** quita un proceso con sus escenarios y sus corridas guardadas, que se listan
  en `removedScenarios` y `removedRuns`. El último proceso no se puede borrar. Tampoco uno que una
  actividad de llamada de otro proceso nombra en su `calledElement` (con o sin prefijo, como
  `tns:Process_B`): el rechazo lista esas actividades como `slug/idElemento (nombre)`. Si queda un
  solo proceso, el proyecto se escribe como un archivo de versión 1, donde ese proceso toma el
  nombre y el slug del proyecto: `notes` lo dice y `slugs` lista lo que queda.
- **`rename_scenario`** cambia el `"name"` del escenario; su entrada (`<nombre>.scenario.json`) no
  cambia. Su revisión sube, y también las de los escenarios que heredan de él, como en la app, así
  que sus corridas guardadas quedan obsoletas. Un nombre por el que ya se encuentra otro escenario
  del proceso (su `"name"`, o su nombre de archivo con o sin `.scenario.json`) se rechaza:
  `scenario` dejaría de encontrar un solo escenario con él. El mismo nombre no escribe nada.
- **`delete_scenario`** quita un escenario con su revisión y sus corridas guardadas, que se listan
  en `removedRuns`; `get_project` deja de listarlas. El último escenario de un proceso no se puede
  borrar, y tampoco uno del que heredan otros escenarios: el rechazo los lista. Borrar
  `as-is.scenario.json` se permite, pero `edit_process` guarda ahí las duraciones, los recursos y
  las probabilidades de rama que recibe, así que `notes` avisa que ya no podrá.

```json
{ "name": "rename_process", "arguments": { "project": "credito.lila", "process": "miwg-a-1-0", "name": "Disputa de tarjeta", "locale": "es" } }
```

```json
{ "name": "delete_process", "arguments": { "project": "credito.lila", "process": "miwg-a-1-0", "dryRun": true } }
```

```json
{ "name": "rename_scenario", "arguments": { "project": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "name": "TO-BE", "dryRun": true } }
```

```json
{ "name": "delete_scenario", "arguments": { "project": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "dryRun": true } }
```

## MCP y CLI lado a lado

| Tool o campo MCP | CLI | Nota |
| --- | --- | --- |
| `rename_process` | `lila process rename <proyecto.lila> <slug> --name <nombre>` | |
| `delete_process` | `lila process delete <proyecto.lila> <slug>` | |
| `rename_scenario` | `lila scenario rename <proyecto.lila> <escenario> --name <nombre>` | `process` es `--process` |
| `delete_scenario` | `lila scenario delete <proyecto.lila> <escenario>` | `process` es `--process` |
| `dryRun` | `--dry-run` | Todas las de arriba |
| (la respuesta JSON) | `--json` | Sin él, la CLI imprime `summary` y `notes` |

## Exportar sin la app

`export_diagram`, `export_document` y `export_results` (#538) son `lila export diagram|doc|results`
(`docs/es/CLI.md`) como tools. No necesitan la app ni un navegador:

- **El diagrama** sale del renderizador SVG del motor: la geometría del DI de BPMN con los colores
  de Lila Light sobre blanco. El documento HTML lo incrusta. El Word va **sin diagrama** y ninguno
  de los dos lleva las gráficas de la corrida: Word necesita un PNG y el motor no rasteriza.
  `notes` dice qué quedó fuera.
- **Las corridas** son las que la app guardó en el `.lila`. `run: "latest"` (por defecto) es la
  corrida del modelo y escenario actuales. `scenario` la acota a un escenario, y hace falta cuando
  varios tienen una corrida actual. `run: "<id>"` elige una, y un id desconocido lista los ids; `run` y `scenario` juntos son un error. El
  documento solo admite una corrida actual; sin ella va sin resultados y el `run` de la respuesta
  es `null`. `export_results` sin corrida es `isError`, con un mensaje que lo dice. Los resultados
  de una corrida anterior se exportan contra el modelo con el que corrió.
- **No se sobrescribe nada.** Si ya existe un archivo en `saveTo` (o, en CSV, cualquiera de los
  cuatro del directorio), la tool devuelve `isError` y no escribe nada, salvo con
  `overwrite: true`. El proyecto (o `.bpmn`) que se exporta nunca es un destino, con `overwrite` o
  sin él. Las escrituras son atómicas: primero un temporal y luego se publica.

```json
{ "name": "export_diagram", "arguments": { "project": "examples/pedido.lila", "saveTo": "out/pedido.svg" } }
```

```json
{ "name": "export_document", "arguments": { "project": "proyecto.lila", "format": "html", "saveTo": "out/pedido.html" } }
```

```json
{ "name": "export_results", "arguments": { "project": "proyecto.lila", "scenario": "as-is", "format": "xlsx", "saveTo": "out/as-is.xlsx" } }
```

## Guardar una corrida

`run_simulation` con `saveRun: true` (y `lila run … --save`) guarda la corrida en el `.lila`
exactamente como la app: la misma forma, las revisiones de modelo y escenario con que corrió, el
XML del modelo y el escenario resuelto (con `model: "model.bpmn"`), construida por la misma función
del motor que usa la app (`storedRun`). La app la abre como la corrida actual de ese escenario, y
`export_document` / `export_results` la usan. Necesita un `model` `.lila` y un escenario **del
archivo** (por nombre); un `.bpmn`, un escenario en disco o uno inline son `isError` y no se escribe
nada. La corrida guardada es siempre el `RunResult` completo; la respuesta (su texto y su
`structuredContent`) es el resumen o el resultado completo según `detail`. Un segundo bloque de
texto dice `{ "savedRun": { "id", "file", "process", "scenario" } }`.

La escritura es atómica y bajo el candado del archivo. Si otro escritor guardó el `.lila` entre
tanto, se vuelve a leer y la corrida se añade a lo que hay ahora, así que las escrituras concurrentes
llegan todas. Si el modelo o ese escenario cambiaron entre tanto, la corrida ya es vieja y no se
guarda (`isError`). La app conserva todas las corridas (no hay límite) y esto también.

```json
{ "name": "run_simulation", "arguments": { "model": "proyecto.lila", "scenario": "as-is", "seed": 42, "replications": 5, "saveRun": true } }
```
## Crear un proceso desde un esquema

Un agente describe el proceso como datos en vez de escribir XML BPMN (#97). `create_process` arma
el BPMN semántico con `bpmn-moddle`, lo maqueta con `bpmn-auto-layout` (pool, carriles y flujos
incluidos), lo valida como `validate_bpmn` y lo escribe en el `.lila`. `lila process create`
(`docs/es/CLI.md`) hace lo mismo desde una terminal.

```json
{ "name": "Credit application",
  "lanes": ["Customer", "Analyst"],
  "steps": [
    { "id": "receive", "name": "Receive application", "lane": "Analyst" },
    { "id": "check", "name": "Check bureau", "lane": "Analyst", "duration": "normal(20m, 5m)" },
    { "id": "ok", "type": "xor", "name": "Approved?",
      "branches": [ { "label": "Yes", "to": "issue" }, { "label": "No", "to": "reject", "probability": 0.3 } ] },
    { "id": "issue", "name": "Issue card", "end": true },
    { "id": "reject", "name": "Notify rejection", "lane": "Customer", "end": true } ] }
```

- **El orden de la lista es el flujo**: cada paso sigue al anterior salvo que tenga `next` (un id,
  o varios después de una compuerta), `branches` (solo compuertas: `{ label?, to, probability?,
  default? }`, o `{ label?, end: true | "terminate", probability?, default? }` para una rama que
  termina el proceso) o `end` (`true`, o `"terminate"` para un evento de fin de terminación, que
  termina el caso entero, con todos sus caminos en paralelo). El último paso termina el proceso.
  Los eventos de fin se añaden solos, y también el de inicio salvo que venga `starts`.
- **`type`** es `task` por defecto; los demás son las variantes de tarea `userTask`, `serviceTask`,
  `sendTask`, `receiveTask`, `manualTask`, `scriptTask` y `businessRuleTask` (simulan como `task`),
  `callActivity`, las compuertas `xor`, `and`, `or` y `eventGateway`, las esperas `timer` (un evento
  intermedio de temporizador) y `message` (un evento intermedio de mensaje), y `subprocess` (un
  subproceso embebido colapsado, con un inicio y un fin de paso dentro).
- **Flujos por defecto.** `default: true` marca una rama de un `xor` o de un `or` como su flujo por
  defecto (uno por compuerta). En un `xor` no cambia el reparto: lo que falta para 1 sigue yendo a
  las ramas sin probabilidad (R-XOR-2). En un `or` es la salida de respaldo cuando no se toma
  ninguna otra rama (R-OR-3).
- **La compuerta por eventos** (R-EVG-1). Toda salida de un `eventGateway` —sus ramas, `next` o el
  paso siguiente— va a un paso `timer` o `message`, nunca a un fin, una tarea o una compuerta; así
  que un `eventGateway` no puede ser el último paso, llevar `end` ni tener una rama con `end`. Cada
  uno de esos pasos tiene a esa compuerta como única entrada: el paso anterior de la lista no debe
  caer en él, y ningún otro `next`, `to`, `from`, evento de borde ni segunda compuerta puede llevar
  a él. Un paso `message` solo vale ahí. Las ramas no llevan `probability` ni `default`: gana el
  primer evento que ocurre. Una rama sin `duration` nunca se dispara (R-EVG-5), y si ninguna la
  tiene, los casos se quedan en la compuerta (R-EVG-6).
- **Inicios.** `starts: [{ id, name?, type?, lane? }]` (`type` `none` o `timer`) reemplaza al inicio
  implícito; los ids de los inicios los pones tú. Cada inicio está en el `from` de exactamente un
  paso (un inicio tiene un solo flujo de salida: para bifurcar, pon una compuerta después), y
  `from` solo nombra inicios y solo existe con `starts`. El `lane` de un inicio sigue la regla del
  de un paso y por defecto es el carril de su paso. `type: "timer"` es notación: los casos llegan
  por las llegadas del escenario en ese inicio, igual que en uno simple (SEMANTICS §2), no por un
  calendario del temporizador.
- **Eventos de borde.** `boundary: [{ id, type: "timer", name?, label?, duration?, interrupting?, to | end }]`
  en una tarea (cualquier variante) o una actividad de llamada; no en un subproceso (#639). `to`
  nombra el paso al que lleva el evento; `end` (`true` o `"terminate"`) termina ese camino con el
  evento de fin `EndEvent_<id del borde>`. `interrupting: false` deja la tarea corriendo y abre un
  camino en paralelo; por defecto la corta. `label` nombra el flujo que sale de él. La `duration`
  cuenta desde que el caso llega a la tarea, incluida la espera por recursos; sin ella el borde
  nunca se dispara (R-BND-8). Un plazo más largo que la corrida (`run.duration` es 1 h por defecto)
  tampoco se dispara: alarga la corrida con `patch_scenario`.
- **Notas y datos.** `notes: [texto]` cuelga anotaciones de texto de un paso, en orden, cada texto
  una vez por paso (uno repetido es un error). `data: [{ name, direction }]` conecta objetos de
  datos a una actividad (una tarea, una actividad de llamada o un subproceso): `in`, la actividad lo
  lee; `out`, lo escribe. Los pasos que nombran el mismo objeto lo comparten; un nombre y una
  dirección aparecen una vez por paso.
- **Ids.** Inicios, pasos y eventos de borde comparten un solo conjunto de ids: únicos, ids BPMN
  válidos (NCName), y `next`/`to` solo nombran pasos (un `next` que nombra un inicio o un evento de
  borde «no es el id de un paso»), `from` solo inicios. Los ids de los pasos son los ids BPMN, así
  que los escenarios se refieren a ellos. Ningún id puede chocar con los que Lila genera
  (`StartEvent` sin `starts`, `EndEvent_<paso>`, `EndEvent_<borde>`, `Flow_…`, `Lane_<n>`,
  `Process_…`, `<id>_di`). Cuando dos ids generados chocarían (el segundo fin de `x` y el fin de un
  paso `x_2`), el posterior toma el primer sufijo `_<n>` libre.
- **`lane`** es por defecto el carril del paso anterior (el primero para el primer paso). Un carril
  que no está en `lanes` es un error si `lanes` viene, y se agrega en orden si no viene.
- **El escenario base.** El proceso recibe `as-is.scenario.json`: las llegadas por defecto de la app
  para un proceso nuevo (20 casos, uno por minuto) en cada inicio, así que dos inicios traen dos
  flujos de casos; cada `duration` como `processingTime` (de una tarea, y la demora de un `timer`,
  un `message` o un evento de borde), cada entrada de `resources` (un nombre, o `{ name, quantity }`; el
  recurso se crea con la capacidad de su mayor pedido; con varios, `selection: "or"` toma
  cualquiera de ellos en vez de todos) y cada `probability` de rama como la
  probabilidad de su flujo. Las ramas de un XOR sin probabilidad se reparten lo que falta para 1.
  Una `duration` es un número de segundos, un tiempo con unidad (`90s`, `20m`, `1.5h`, `1h30m`, `1d`; las
  unidades de las hojas de escenario, en español incluidas), una distribución del formato de
  escenario escrita corta —`normal(20m, 5m)`, `triangular(1m, 2m, 5m)`, `exponential(mean=4m)`,
  posicional en el orden de `docs/es/SCENARIO_FORMAT.md` o con nombre— o un objeto de distribución
  en segundos.
- **El slug** del nuevo `processes/<slug>/` es `process`, o uno derivado del nombre (`name`, si no
  `outline.name`). Un slug que ya está en el archivo es un error y no se escribe nada. Un `project`
  que no existe se crea como un `.lila` de un proceso cuyo slug sale del nombre (ahí un `process`
  distinto es un error: un archivo de un proceso no puede llevar su propio slug). Todos los demás
  procesos quedan byte a byte como estaban; la escritura es la misma, atómica y con candado, que
  la de `patch_scenario`.
- **Un esquema mal formado** falla con todos sus problemas a la vez, en el idioma de la llamada,
  cada uno con su ruta (`steps[2].branches[0].to: …`, `steps[0].duraton: campo desconocido
  "duraton".`), y no se escribe nada. `outline` se declara a propósito como un objeto suelto, para
  que el SDK de MCP nunca rechace la llamada antes de estas comprobaciones. Un paso desde el que
  ningún camino llega a un fin (un ciclo sin salida) también es un problema, uno por paso
  atascado, y lo mismo un esquema cuyo modelo no valida (los errores del validador vuelven con
  sus códigos, en el paso del que hablan).
- **`notes`** son los avisos propios de Lila sobre un esquema aceptado, como una unión paralela
  (`and`) que espera ramas de una sola bifurcación exclusiva (un `xor`, un `eventGateway`, o una
  tarea y su evento de borde que interrumpe), donde los casos esperarían para siempre.

```json
{ "name": "create_process", "arguments": { "project": "credit.lila", "outline": { "name": "Credit application", "lanes": ["Customer", "Analyst"], "steps": [ … ] } } }
```

`get_process_outline` devuelve el esquema en **forma normal**: cada paso dice su carril, y también
cada inicio; `type` se omite para `task`; `next` aparece solo cuando no es simplemente el paso
siguiente; todo paso que termina el proceso lleva `end: true` (`"terminate"` para un evento de fin
de terminación); las salidas de las compuertas son `branches` (un `eventGateway` siempre las
tiene, aunque sea una sola) con `default: true` en el flujo por defecto de un `xor` o un `or`; las
duraciones son objetos de distribución en segundos y las probabilidades del XOR vienen completas.
`starts` se omite en el caso trivial —un solo inicio simple `StartEvent` sin nombre en el carril de
su paso—, y entonces ese paso pasa a encabezar la lista (los demás conservan su orden) y ningún
paso lleva `from`; así, `starts: [{ "id": "StartEvent" }]` con `from` en el tercer paso se
normaliza al esquema sin `starts` cuyo primer paso es ese. Si no, se listan todos los inicios y
los pasos conservan el orden del documento. `from` lista los inicios de un paso en el orden de
`starts`, un id como texto y varios como lista (como `next`). `boundary` conserva su orden, con
`interrupting` solo cuando es `false`. `notes` conserva su orden (al leer, el orden de las
asociaciones en el documento). `data` lista primero las lecturas y luego las escrituras, cada grupo
en su orden. Es la forma que `create_process` devuelve como `outline`, así que un proceso va y
vuelve igual. Duraciones, recursos y probabilidades (y la `selection` de recursos) salen del
`as-is.scenario.json` del proceso cuando lo tiene.

Para un proceso que Lila no generó, la lectura nunca devuelve un esquema que `create_process`
rechazaría: lo que un esquema no puede decir se deja fuera, y `warnings` lo dice una vez por tipo.
Eso abarca otros pools, flujos de mensaje, los nombres de los eventos de fin y de los flujos que
salen de un inicio, eventos de inicio que no son simples ni de temporizador y eventos de fin que no
son simples ni de terminación (se leen como eventos simples), un inicio con varios flujos de
salida (solo se conserva el primero), compuertas por eventos que el simulador no corre (R-EVG-1:
una que instancia o una paralela, o una con una rama a algo que no sea un evento intermedio de
temporizador o de mensaje con una entrada y una salida, como una tarea de recepción) y eventos de
mensaje que no son rama de una (se dejan fuera con sus flujos), eventos de borde que no son de
temporizador, y temporizadores de borde en un subproceso (#639), con un flujo de entrada o con
varios de salida, las expresiones de tiempo del XML (`timeDuration`, `timeDate`, `timeCycle` de
inicios de temporizador, pasos `timer` y temporizadores de borde: las duraciones viven en el
escenario), marcas de flujo por defecto que no salen de un `xor` o un `or` (y las rotas),
probabilidades de rama que un esquema no puede llevar (a la salida de un `and` o un
`eventGateway`, o las de un `xor` que suman más de 1), grupos, anotaciones de texto que no cuelgan
de un paso o sin texto, una anotación que repite una nota del mismo paso (se lee una vez),
almacenes de datos, objetos de datos sin nombre, dos objetos de datos con el mismo nombre,
asociaciones de datos con algo que no es una actividad, carriles anidados y lo del escenario que un
esquema no lleva (llegadas, calendarios, costos, capacidades y tipos de recurso, ruteo
condicionado; el escenario no se toca). Un proceso sin nombre toma el del `.lila`, si no su id.

### Ejemplo: una escalación a las 48 horas

`examples/outline/claim-escalation.json` (el esquema está en la [guía para agentes](GUIA-AGENTES.md#ejemplo-escalar-a-las-48-horas))
modela «si el ajustador no ha decidido en 48 horas, interviene un supervisor» como un temporizador
de borde que no interrumpe la tarea, y «el cliente confirma o, a los cinco días, se cierra el
siniestro» como una compuerta por eventos entre un paso `message` y un paso `timer` que termina con
`"terminate"`:

```json
{ "id": "assess", "name": "Assess claim", "type": "userTask", "lane": "Adjuster",
  "duration": "triangular(4h, 24h, 72h)", "resources": ["Adjuster"],
  "boundary": [ { "id": "sla", "type": "timer", "name": "48 h", "duration": "48h", "interrupting": false,
                  "label": "No decision in 48 h", "to": "escalate" } ] }
```

El escenario base corre una hora (`run.duration` 3600 s), así que ningún caso llegaría nunca al
plazo de 48 horas ni a la espera de cinco días: alarga la corrida con `patch_scenario` antes de
`run_simulation`. Las cuatro llamadas, como las hace la prueba e2e `outline-constructs.e2e.test.ts`:

```json
{ "name": "create_process", "arguments": { "project": "claims.lila", "outline": { "name": "Claim handling", … } } }
{ "name": "patch_scenario", "arguments": { "project": "claims.lila", "scenario": "as-is",
  "patch": [ { "op": "replace", "path": "/run/duration", "value": 5184000 } ] } }
{ "name": "run_simulation", "arguments": { "model": "claims.lila", "scenario": "as-is", "saveRun": true } }
{ "name": "export_document", "arguments": { "project": "claims.lila", "format": "html", "saveTo": "claims.html" } }
```

El plazo es la entrada de escenario `elements.sla.processingTime`, nunca un `timeDuration` en el
XML. `elements.sla.completed` cuenta los plazos que se dispararon. `byEndEvent` cuenta cada caso en
el fin del camino que terminó al último, así que un siniestro escalado y luego pagado cuenta en
`EndEvent_pay`. Para poner el mismo plazo en un proceso que ya existe, usa `addBoundary`:

```json
{ "name": "edit_process", "arguments": { "project": "claims.lila", "operations": [
  { "op": "addBoundary", "on": "assess", "boundary": { "id": "sla", "type": "timer", "name": "48 h",
    "duration": "48h", "interrupting": false, "label": "No decision in 48 h", "to": "escalate" } } ] } }
```

## Herramientas de modelado para agentes

`annotate_element`, `define_attribute`, `get_raci_matrix`, `import_scenario_sheet`,
`export_scenario_template` y `create_project` (#99, #633, #403, #514) dejan que un agente construya
y documente un proyecto sin la app. La CLI tiene las cinco primeras como
`lila process annotate|attribute|raci` y `lila scenario import|template` (`docs/es/CLI.md`). Toda escritura pasa por el mismo guardado
atómico y con candado del `.lila` que `patch_scenario` (ver
[Un `.lila` como entrada](#un-lila-como-entrada)): solo cambia el proceso tocado, los demás pasan
byte a byte, y una entrada inválida es `isError` sin escribir nada. `dryRun: true` responde qué
cambiaría y no escribe nada.

- **`annotate_element`** busca el elemento por su id BPMN (una tarea, evento, compuerta, flujo,
  carril, pool, el proceso…; un id desconocido es un error). `documentation` reemplaza la
  descripción (`""` la quita). `responsibilities` es toda la lista RACI,
  `[{ "type": "R"|"A"|"C"|"I", "roleRef": "cajero" }]` (`[]` la vacía). `refs` asocia un tipo
  (`systemRef`, `documentRef`, `riskRef`, `controlRef`, `kpiRef`, `input`, `output`) con sus ids y
  reemplaza solo los tipos dados. `attributes` asocia un atributo extendido (su id, o su nombre si
  solo uno lo tiene) con un valor y se fusiona: `""` quita un valor, los atributos que no se dan se
  quedan. Cada valor se comprueba contra las definiciones de atributos del proyecto, como en el
  panel de propiedades de la app: un `number` es un decimal simple (`12`, `-3.5`), un `date` es
  `AAAA-MM-DD`, un valor de `list` es una de sus opciones, y el atributo debe aplicarse al tipo del
  elemento. La revisión del modelo sube en uno, como cuando la app guarda una edición. Una
  anotación que no cambia nada no escribe nada (`changed: false`). Escribe donde la app lee: la
  descripción de un pool es la del proceso al que apunta (se escribe ahí y se nombra en
  `documentationOn`), y un proceso dentro de un pool guarda su RACI y sus referencias en el pool,
  así que `responsibilities` o `refs` sobre ese proceso se rechazan con un mensaje que nombra el
  pool.
- **`define_attribute`** declara un atributo extendido (#633) para que `annotate_element` lo
  rellene: `get_project` lista los que define cada proceso. Se pasa siempre la definición entera:
  `name`, `type` (`text`, `number`, `list`, `date`), `appliesTo` (`task`, `gateway`, `event`,
  `subProcess`, `lane` para pools y carriles, `process`), y `options` y `default` si los tiene.
  Cambia la definición con ese `id`; sin `id`, la que tiene ese nombre (sin distinguir mayúsculas)
  y ese `appliesTo`; si no hay, crea una con un id determinista, `Attr_` y el nombre en ASCII
  minúsculo (`"SLA (h)"` → `Attr_sla_h`, luego `_2`… si ya existe), así que un simulacro y la
  escritura la nombran igual y repetir la llamada no cambia nada (`changed: false`). Las reglas son
  las del diálogo de atributos de la app: un nombre único por tipo de elemento (sin distinguir
  mayúsculas), una `list` con al menos una opción (recortadas y sin repetidas), `options` solo en
  una `list` y un `default` que encaje con el tipo. Las definiciones se escriben en la
  `bpmn:collaboration` (si no, en el proceso), y las copias que haya en otro sitio se mueven ahí
  (`docs/es/BPMN_EXTENSION.md`). Renombrar conserva todos los valores. `remove: true` (con `id`, o
  con `name` y `appliesTo`) quita la definición y sus valores; cambiar el tipo, el `appliesTo` o
  quitar opciones quita los valores que ya no encajan, como el «limpiar» de la app. En los dos
  casos `removedValues` los lista (`[{ elementId, value }]`), también en un `dryRun`;
  `definitions` es la lista entera del proceso después.
- **`get_raci_matrix`** lista lo que el documento del proceso (`export_document`) lista en
  «Responsabilidades (RACI)», en el mismo orden: una fila por elemento con responsabilidades, con
  su `id`, `name`, `lane` (si tiene), las `responsibilities` tal cual y `cells` (rol → `"R"`, o
  `"A, C"` si un rol tiene varios tipos). `roles` son los roles en orden de aparición.
- **`import_scenario_sheet`** es «Importar Excel/CSV…» de la app (`docs/es/SCENARIO_SHEETS.md`):
  la hoja se planifica contra el escenario resuelto y cada cambio se escribe en el archivo propio
  del escenario, su delta cuando hace `extends` de otro (el padre no se toca). `changes` trae el
  `before`, el `after` y un `text` legible de cada campo (`Cajero (cajero) · capacity: 2 → 3`, una
  distribución en la unidad de su fila); `issues` las filas no aplicadas (`error`, `unmatched`,
  `ambiguous`), las notas (`warning`) y los errores que tendría el resultado (`lint`). Un plan con
  algún `lint` se rechaza (un `dryRun` lo informa). Como en la app, las filas válidas se escriben
  aunque otras no se apliquen, así que revisa `issues`. La revisión del escenario sube en uno.
- **`export_scenario_template`** es «Descargar plantilla» de la app: dásela a una persona e importa
  lo que devuelva. Un `saveTo` que ya existe se rechaza salvo con `overwrite`.
- **`create_project`** recibe `bpmn` como XML (empieza por `<`) o como ruta a un `.bpmn`. Un modelo
  con errores de validación se rechaza, salvo con `allowUnsimulatable: true` (#632): entonces se
  guarda como diagrama que no se simula y sus errores vuelven en `notes` (ver
  [El BPMN de un proceso](#el-bpmn-de-un-proceso)). `scenarios` son `[{ "name", "scenario" }]`, guardados como
  `<name>.scenario.json`; un escenario sin `model` ni `extends` recibe `"model": "model.bpmn"`, y
  uno que nombra otro modelo se rechaza. Un escenario que todavía no puede correr es un borrador:
  se guarda y vuelve con `runnable: false` y sus `errors`. El archivo se escribe entero o nada, y
  uno existente se rechaza salvo con `overwrite`. Las apps web y de escritorio lo abren. Un modelo
  sin diagrama (sin formas `bpmndi`) recibe uno, dibujado con el mismo maquetado automático que
  `edit_process` con `layout: true`, para el proceso que simula, así que `export_diagram` funciona
  con él; `laidOut: true` lo indica (#630). Un modelo que el maquetador no puede colocar se guarda
  tal como llegó.

```json
{ "name": "create_project", "arguments": { "path": "proyecto.lila", "name": "Pedidos", "bpmn": "examples/pedido/model.bpmn",
  "scenarios": [{ "name": "as-is", "scenario": { "version": 1, "name": "AS-IS", "run": { "start": "2026-10-05T08:00:00-06:00", "duration": 28800, "seed": 1 },
    "elements": { "StartEvent_Pedido": { "interTriggerTimer": { "type": "exponential", "mean": 300 } } } } }] } }
```

```json
{ "name": "annotate_element", "arguments": { "project": "proyecto.lila", "elementId": "Task_TomarPedido",
  "documentation": "Toma el pedido en el mostrador.", "responsibilities": [{ "type": "R", "roleRef": "cajero" }, { "type": "A", "roleRef": "gerente" }],
  "refs": { "systemRef": ["POS"] }, "locale": "es" } }
```

```json
{ "name": "define_attribute", "arguments": { "project": "proyecto.lila", "name": "Nivel de riesgo", "type": "list",
  "appliesTo": "task", "options": ["Bajo", "Alto"], "default": "Bajo" } }
```

```json
{ "name": "annotate_element", "arguments": { "project": "proyecto.lila", "elementId": "Task_TomarPedido",
  "attributes": { "Nivel de riesgo": "Alto" } } }
```

```json
{ "name": "get_raci_matrix", "arguments": { "project": "proyecto.lila" } }
```

```json
{ "name": "export_scenario_template", "arguments": { "project": "proyecto.lila", "scenario": "as-is", "saveTo": "as-is.xlsx" } }
```

```json
{ "name": "import_scenario_sheet", "arguments": { "project": "proyecto.lila", "scenario": "as-is", "sheet": "as-is.xlsx", "dryRun": true } }
```

## Editar un proceso

`edit_process` (#98) cambia un proceso que ya existe, lo haya hecho quien sea: `create_process`, la
app o una importación de Bizagi. Recibe una lista de `operations`, las aplica en orden sobre el
modelo en memoria, valida el resultado y lo escribe solo si todas las operaciones salieron bien, el
modelo no tiene ningún error de validación que no tuviera antes y cada escenario del proceso sigue
simulando. Si no, no escribe nada y la llamada falla con todos los problemas a la vez —los de forma y
los de significado en una sola pasada, en el idioma de la llamada—, cada uno con el índice de su
operación y una ruta (`operations[2].after: …`, `operations[3].nombre: campo desconocido "nombre".`,
`operations[0].bpmn.Process_1: E-SIN-START: …`). Un `operations` que no es una lista también es un
error (`operations: debe ser una lista no vacía de operaciones.`). `lila process edit` (`docs/es/CLI.md`) hace lo
mismo desde una terminal.

```json
{ "name": "edit_process", "arguments": { "project": "credit.lila", "operations": [
  { "op": "add", "step": { "id": "verify", "name": "Verify identity", "duration": "5m", "resources": ["Analyst"] }, "after": "receive" },
  { "op": "connect", "from": "ok", "to": "verify", "label": "Retry", "probability": 0.1 },
  { "op": "rename", "id": "issue", "name": "Issue the card" },
  { "op": "setType", "id": "check", "type": "serviceTask" },
  { "op": "addLane", "name": "Back office" },
  { "op": "moveToLane", "id": "issue", "lane": "Back office" },
  { "op": "remove", "id": "reject" } ] } }
```

| Operación | Campos | Qué hace |
| --- | --- | --- |
| `add` | `step`, `after?` o `between?` | Agrega un paso. `step` es un paso de esquema sin sus conexiones, eventos de borde, notas ni datos: `{ id, name?, type?, lane?, duration?, resources? }`, de cualquier tipo del esquema. Con `after: id`, el paso nuevo toma el flujo de salida de ese paso (se rechaza si tiene varios: usa `between`). Con `between: [from, to]`, va sobre el flujo from → to. El flujo donde cae conserva su id, nombre y probabilidad; un flujo nuevo sigue hasta el sucesor de antes. Sin ninguno de los dos, se agrega sin conectar. `lane` es, por defecto, el carril del paso al que sigue. |
| `connect` | `from`, `to`, `label?`, `probability?`, `default?`, `id?` | Agrega un flujo de secuencia (id `Flow_<from>_<to>` por defecto). `probability` y `default: true` (el flujo por defecto de la compuerta) solo a la salida de un gateway `xor` u `or`; `default: true` se rechaza si la compuerta ya tiene flujo por defecto. Ninguna operación marca un flujo existente como el de por defecto ni le quita la marca: en una sola llamada, `connect` los mismos pasos otra vez (con `default: true` o sin él, y el `label` y la `probability` a conservar) y `remove` el flujo viejo, después de quitar el flujo por defecto actual de la compuerta si lo tiene; el flujo recibe un id nuevo. |
| `remove` | `id` | Quita un paso y reconecta: sus flujos de entrada van a su sucesor cuando tiene a lo sumo uno; un paso sin flujos de entrada pierde los de salida; un paso con varios de entrada y varios de salida (un split tras un join) se rechaza. Un paso con eventos de borde se rechaza. Los flujos de mensaje y asociaciones que cuelgan de él se van con él, y también sus anotaciones de texto, sus asociaciones de datos y los objetos de datos que ya no usa nada más (van en el cambio). Un evento de fin que se queda sin flujo de entrada también se va (va en `removed`). También se puede quitar un flujo de secuencia, un evento de borde, una anotación de texto, un objeto o almacén de datos, un grupo o una asociación. |
| `rename` | `id`, `name` | Renombra cualquier elemento: paso, flujo, carril, pool, proceso. Un carril también se puede nombrar por su nombre, cuando ningún elemento tiene ese id. `""` borra el nombre. |
| `setType` | `id`, `type` | Uno de los tipos del esquema, o `end`/`terminate` para convertir un evento de fin en uno de terminación y de vuelta. Para esos dos, `id` es el del evento de fin (`EndEvent_<paso>` en un proceso que hizo Lila; el esquema no lo muestra de otro modo), o un paso que lleva a exactamente un evento de fin: entonces cambia ese fin, no el paso. `end`/`terminate` sobre otra cosa (ni un evento de fin ni un paso con exactamente un fin después) se rechaza. Se quedan el nombre, la documentación, los elementos de extensión y los flujos; un subproceso convertido en otra cosa pierde su contenido (va en `removed`). Un `xor` u `or` convertido en `and` o `eventGateway` pierde las probabilidades de sus flujos de salida (van en `scenarioRemovals`). |
| `moveToLane` | `id`, `lane` | Carril por nombre o id. Los eventos de borde del paso, y los eventos de fin a los que llevan, se mueven con él. |
| `addLane` | `name`, `id?`, `after?` o `before?` | Agrega un carril (abajo, por defecto). El primer carril de un proceso sin carriles contiene todos sus pasos, y un proceso sin pool recibe uno. |
| `removeLane` | `lane`, `moveStepsTo?` | Quita un carril (por nombre o id). Un carril que tiene algún nodo —un paso, un inicio, un evento de fin, un evento de borde o su fin— necesita `moveStepsTo`, otro carril sin subcarriles que se los lleve. Un carril con subcarriles se rechaza. El único carril del proceso es la excepción: quitarlo quita el conjunto de carriles, sus nodos se quedan en el pool sin carriles y `moveStepsTo` no hace falta. |
| `moveLane` | `lane`, `before` o `after` | Mueve un carril encima (`before`) o debajo (`after`) de un carril hermano; exactamente uno de los dos. |
| `addBoundary` | `on`, `boundary` | Pega un temporizador de borde a una tarea (cualquier variante) o a una actividad de llamada, no a un subproceso. `boundary` es como en un esquema: `{ id, type: "timer", name?, label?, duration?, interrupting?, to \| end }`. Su `duration` va al escenario base. |
| `annotate` | `on`, `text` | Cuelga una anotación de texto BPMN de un paso (se lee de vuelta como las `notes` del paso). El mismo texto en el mismo paso otra vez no cambia nada, así que `removeAnnotation` nunca es ambiguo. No confundir con `annotate_element`, que escribe la documentación, el RACI y los atributos (anotaciones `lila:`). |
| `removeAnnotation` | `on`, `text` | Quita la anotación con ese texto que cuelga del paso, con su asociación (todas, en un modelo de fuera que la repite). |
| `addDataObject` | `name`, `on`, `direction` | Conecta un objeto de datos a una actividad (una tarea, una actividad de llamada o un subproceso): `in`, la actividad lo lee; `out`, lo escribe. Si el proceso tiene un objeto con ese nombre se reutiliza; si no, se crea. |
| `removeDataObject` | `name`, `on?` | Desconecta el objeto de datos de la actividad `on`, o de todas sin él. El objeto se va cuando ya nada lo usa. |

- **Los ids no cambian.** Un paso renombrado conserva sus entradas de escenario, y uno con otro tipo
  también, en lo que siga aplicando. El `duration`, los `resources` y el `selection` de un paso
  agregado y la `probability` de una conexión van al `as-is.scenario.json` del proceso, como en
  `create_process` (un recurso con el mismo nombre o clave se reutiliza). Un proceso sin ese
  escenario rechaza esos campos.
- **Después de editar, el proceso sigue simulando.** Las entradas de escenario que ya no aplican se
  quitan de todos los escenarios del proceso: la entrada completa de un elemento que la edición
  quitó, y los campos que un elemento con otro tipo ya no admite (recursos en un gateway, un
  subproceso o un temporizador; una duración en un subproceso…), y las probabilidades de los flujos
  que salen de una compuerta que pasó a `and` o `eventGateway`. Nada se va en silencio:
  `scenarioRemovals` lista cada una como `{ scenario, id, removed, entry }`, con los campos quitados
  y sus valores anteriores, para que un agente los ponga en otro lado con `patch_scenario`; `notes`
  dice lo mismo en palabras, y un `dryRun` devuelve el mismo reporte. Después se valida cada
  escenario contra el modelo editado, y un error que no tenía antes rechaza la edición. `removed`
  lista cada id que salió del modelo. `notes` avisa además de un XOR cuyas probabilidades de rama ya
  no suman 1, con los flujos a corregir.
- **Lo que no se toca se queda**: documentación, anotaciones `lila:` (RACI, referencias, atributos
  extendidos), extensiones de otros fabricantes, las anotaciones de texto, objetos de datos y grupos
  que ninguna operación nombra, otros pools y flujos de mensaje. Un modelo que el lector BPMN no puede leer completo se rechaza en vez de
  reescribirse con algo de menos.
- **Maquetado.** Por defecto (`layout: true`) el proceso editado se maqueta de nuevo con el mismo
  maquetador y el mismo arreglo de carriles que `create_process`: se pierden las posiciones puestas a
  mano en ese proceso; las anotaciones de texto y los objetos de datos siguen a su elemento, y los
  que aún no tienen figura (un modelo que llegó sin diagrama) reciben una junto a él, o en una fila
  bajo el dibujo si no cuelgan de nada (#630); los pools de abajo (o de al lado) se mueven en bloque lo que creció. Con `layout: false` cada figura
  conserva su lugar: un paso nuevo va a la derecha del paso al que sigue, en su carril (que crece una
  fila si está lleno), y solo se vuelven a trazar los flujos cuyos extremos cambiaron. Para hacer
  lugar a un paso insertado entre dos pasos muy juntos, lo que está a su derecha en ese pool se
  corre a la derecha en un solo tanto; pools y carriles solo se ensanchan o se alargan, salvo con
  `removeLane` y `moveLane`, que mueven bandas enteras: cada paso conserva su x y se vuelven a
  trazar los flujos que cruzan de una banda a otra. Una anotación o un objeto de datos nuevo va
  junto a su paso, sin tapar otra figura.
- **Qué proceso**: `process` cuando el `.lila` tiene varios. Dentro de su BPMN, el proceso que lee el
  simulador (el ejecutable y no vacío); no se pueden editar pasos de otros pools.
- La escritura es la misma escritura atómica y con candado que la de `patch_scenario`: si el archivo
  cambió en disco desde que se leyó (otro agente, la app), la llamada se rechaza y no se pierde nada.
  La revisión del modelo sube, así que la app ve sus corridas viejas como desactualizadas. Todos los
  demás procesos quedan byte a byte. Con `dryRun`, se comprueba y devuelve todo y no se escribe nada.

## MCP y CLI lado a lado

Cada tool corre el mismo código del motor que su comando de la CLI, así que un agente que solo
tiene una terminal obtiene las mismas respuestas. El `--json` de los comandos project, process y
scenario imprime lo que devuelve la tool; `lila run|compare --json <archivo>` escriben el resultado
completo en un archivo, como `saveTo` (las tools responden con un resumen salvo con `detail: "full"`).

| Tool o campo MCP | CLI | Nota |
| --- | --- | --- |
| `run_simulation` | `lila run --json` | `saveRun` es `--save`, `saveTo` es `--json <archivo>`, `logTo` es el `log.csv` de `--csv`. Los cuatro CSV de resultados de `--csv` salen de una corrida guardada con `export_results`. |
| `compare_scenarios` | `lila compare --json` | `saveTo` con `format: "xlsx"` es `--xlsx <archivo>`; `all: true` (o `detail: "full"`) es `--all`. |

## Resumen o resultado completo

Un `RunResult` completo lista cada elemento y cada flujo con todas sus estadísticas: unos 70 KB (unos
20 mil tokens) para un proceso de diez pasos, y una comparación completa más del doble. Por eso
`run_simulation` y `compare_scenarios` responden por defecto con un resumen (#629), y
`detail: "full"` devuelve el resultado completo de siempre. `saveTo` y `saveRun` guardan siempre el
resultado completo, diga lo que diga `detail`, así que un cliente con sistema de archivos puede
conservarlo todo y leer solo el resumen.

El resumen de `run_simulation` (`"detail": "summary"`):

- `process`: tiempo de ciclo, espera, throughput, costo por caso y `byEndEvent`, como en el resultado completo;
- `bottlenecks`, como en el resultado completo;
- `resources`: por recurso, `utilization`, `resourceWaitTotal` (la espera por recurso, en segundos,
  de los elementos que lo piden; un elemento que pide dos recursos cuenta para los dos) y `totalCost`;
- `topWaits`: los cinco elementos que más esperan (espera por recurso más espera fuera de horario),
  con su `name`, `completed`, `resourceWaitMean`, `resourceWaitTotal`, `offHoursWaitMean` y
  `queueLengthMean`;
- `replications`, el número de replicaciones (cuando hay varias), y `cancelled` /
  `completedReplications` como en el resultado completo;
- `warnings` como `{ message, count }`: un aviso que cada replicación repite con otros números
  (`… (2941 veces)`, `… 1457 casos …`) sale una vez, con el primer mensaje y cuántas veces apareció.

El resumen de `compare_scenarios` conserva `{ comparison, notes }`: `comparison` trae `count`, las
filas de alcance `process` y `resources`, toda otra fila marcada `significant` en algún escenario y
`omittedRows`, el número de filas que se dejaron fuera. Las filas son las del resultado completo, sin
cambios.

Para el proceso de tarjeta de crédito del flujo de la [guía para agentes](GUIA-AGENTES.md)
(`agent-flow.e2e.test.ts`) el resumen ocupa unos 4.4 KB frente a 68 KB completo; un test lo mantiene
por debajo de 8 KB.

```json
{ "name": "run_simulation", "arguments": { "scenario": "examples/pedido/as-is.scenario.json", "seed": 42, "detail": "full" } }
```

## Recursos y prompt

El servidor ofrece como recursos MCP los documentos que un agente necesita, en el idioma del
servidor (`lila mcp --lang`, `LILA_LANG`…; inglés por defecto), para que un cliente que solo tiene
MCP no tenga que adivinar los formatos a partir de las descripciones de las tools:

| URI | Contenido |
| --- | --- |
| `lila://guide` | La [guía para agentes](GUIA-AGENTES.md) (`docs/AGENT_GUIDE.md` en inglés). |
| `lila://outline-format` | El esquema: el ejemplo y la tabla de campos de la guía, y después [las reglas](#crear-un-proceso-desde-un-esquema). |
| `lila://scenario-format` | [`SCENARIO_FORMAT.md`](SCENARIO_FORMAT.md). |
| `lila://scenario-schema` | [`scenario.schema.json`](../scenario.schema.json), el JSON Schema de un escenario. |

El prompt `interview-to-process` (argumentos `transcript` y `project`, los dos opcionales) es el
flujo de la guía, pasos 1 a 8, seguido de la entrevista; sin `transcript` pide la transcripción
primero.

Son los propios documentos: desde un checkout el servidor lee `docs/`, y el paquete publicado lleva
copias de los mismos archivos en `dist/resources/` (`prepack` corre
`packages/mcp/scripts/bundle-resources.mjs`).

```json
{ "method": "resources/read", "params": { "uri": "lila://guide" } }
```

## Progreso y cancelación

`run_simulation` y `compare_scenarios` simulan en un worker thread, así que el servidor sigue
respondiendo (un `ping`, otras llamadas) mientras corre una simulación. Cuando la llamada trae
`_meta.progressToken`, el servidor manda `notifications/progress` una vez por replicación terminada,
con `progress` (replicaciones hechas) y `total` (`run.replications`, o la suma sobre los escenarios
de una comparación). Un `notifications/cancelled` del cliente detiene la corrida en el acto: el
worker se termina, no se guarda nada (también se borra el temporal de un `logTo`) y, como pide MCP,
no se responde a la petición cancelada.

```json
{ "method": "tools/call", "params": { "name": "run_simulation", "arguments": { "scenario": "examples/pedido/as-is.scenario.json", "replications": 30 }, "_meta": { "progressToken": 1 } } }
```

## Idioma

El `title`, la `description` y los `describe()` de cada tool están **fijos en inglés**: son la
superficie del protocolo, lo que el cliente MCP leyó una sola vez en `tools/list`, y ninguna
llamada suelta puede reescribirlos. Lo que sí cambia de idioma es el contenido de las respuestas:
el resumen de `describe_process`, los mensajes de `isError` y los problemas del motor (`E-…`/`W-…`
de `docs/SEMANTICS.md` § 17).

- El **idioma del servidor** sale de quien lo arrancó: `lila mcp --lang es` se lo pasa hecho, y el
  bin `lila-mcp` (que no tiene línea de comandos) lo resuelve del entorno con la misma regla que la
  CLI: `LILA_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`; inglés si no hay ninguna.
- El **idioma de una llamada** es `locale: "en" | "es"`, opcional en todas las tools. Solo afecta a
  esa respuesta; no cambia el idioma del servidor para las siguientes.

La clave `resumen` de `describe_process` **no** se renombra al traducir: es contrato desde
LILA-053 y hay agentes y tests que la leen por nombre. Cambia su contenido, no su etiqueta.

## Instalación

El servidor está publicado en npm como paquete propio, `@lila-modeler/mcp` (ADR-030), con Node 22 o
posterior. Un cliente MCP lo arranca con:

```bash
npx -y @lila-modeler/mcp
```

`-y` deja que npx lo instale sin preguntar. El paquete fija la versión exacta de
`@lila-modeler/engine` con la que se publicó, así que el servidor y la CLI `lila` de la misma
versión dan los mismos números.

`lila mcp`, el subcomando del motor (LILA-056), arranca **el mismo servidor** cuando están
instalados los dos paquetes (`npm install -g @lila-modeler/engine @lila-modeler/mcp`). Como
`@lila-modeler/mcp` depende de `@lila-modeler/engine`, importarlo estáticamente desde `cli.ts` sería
un ciclo entre paquetes: se carga con `import()` dinámico (`packages/engine/src/cli.ts`,
`dispatchMcp`) y, si el paquete no está, el comando lo dice por stderr y sale con 1 en vez de
romperse.

Para correr cambios aún sin publicar, arráncalo desde un clon del repo:

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
node packages/engine/bin/lila.js mcp    # o ./node_modules/.bin/lila-mcp, el mismo servidor
```

Todos los clientes de abajo arrancan el servidor como subproceso por stdio: `command` es `npx` y
`args` son `-y` y `@lila-modeler/mcp`. Cuando el cliente no hereda tu `PATH`, da `command` como ruta
absoluta (`which npx`), y agrega el directorio de `node` al `PATH` del servidor si aun así no lo
encuentra. Desde un clon, `command` es `node` y `args` son la ruta absoluta a
`packages/engine/bin/lila.js` y `mcp`. Define la variable `LILA_LANG=es` para los mensajes en
español (`lila mcp` acepta además `--lang es`).

`lila mcp` habla MCP por **stdout**: nada más puede escribir ahí. Todo diagnóstico (paquete
ausente, fallo de arranque) sale por stderr, que es lo único que ve quien registró el servidor.

## Registro en Claude Code

Por línea de comandos:

```bash
claude mcp add lila -- npx -y @lila-modeler/mcp
```

`-s user` lo deja disponible en todos los proyectos; sin `-s`, solo en el directorio actual.
Comprobación: `claude mcp list` debe mostrar `lila: ... - ✓ Connected`.

Para el propio repo no hace falta: la raíz trae un `.mcp.json` de proyecto que arranca el
servidor del clon, así que al abrir Claude Code aquí el servidor aparece solo (Claude Code pide aprobar los servidores de `.mcp.json`
la primera vez).

```json
{
  "mcpServers": {
    "lila": {
      "command": "node",
      "args": ["packages/engine/bin/lila.js", "mcp"]
    }
  }
}
```

Las rutas de `args` son relativas porque Claude Code lanza los servidores de proyecto con el cwd en
la raíz del proyecto — que es además el cwd contra el que las tools resuelven `path` y `scenario`
(ver § Rutas). En un `.mcp.json` de otro repo, usa rutas absolutas.

## Registro en Claude Desktop

Claude Desktop no tiene CLI: se edita a mano
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) o
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), y se reinicia la app. Claude Desktop no
hereda el `PATH` de tu shell, así que da `npx` con ruta absoluta (`which npx`):

```json
{
  "mcpServers": {
    "lila": {
      "command": "/ruta/absoluta/a/npx",
      "args": ["-y", "@lila-modeler/mcp"]
    }
  }
}
```

Pasa rutas absolutas de modelo y escenario en cada llamada, sin depender del directorio de
trabajo que elija el cliente.

## Registro en Codex

```bash
codex mcp add lila -- npx -y @lila-modeler/mcp
```

o, en `~/.codex/config.toml`:

```toml
[mcp_servers.lila]
command = "npx"
args = ["-y", "@lila-modeler/mcp"]
```

## Registro en Hermes Agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) lee los
servidores stdio de `mcp_servers` en `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  lila:
    command: "/ruta/absoluta/a/npx"
    args: ["-y", "@lila-modeler/mcp"]
    cwd: "/ruta/absoluta/a/tus/proyectos"
    env:
      LILA_LANG: "es"
    timeout: 300
```

- Hermes no le pasa al servidor todo tu entorno: le pasa una base segura (`PATH`, `HOME`, `LANG`,
  `TMPDIR`, `XDG_*` y similares) más las variables que aparecen en `env`. Pon en `env` `LILA_LANG`
  o lo que Lila deba ver, y da `command` como ruta absoluta a `npx` (`which npx`) cuando el `PATH`
  con que corre Hermes pueda no encontrarlo.
- `cwd` es donde caen las rutas relativas de las tools (`project: "tarjeta.lila"`, `saveTo`). Solo
  las versiones recientes de Hermes se lo pasan al servidor; las anteriores (la v0.17.0, por
  ejemplo) lo ignoran. Las rutas absolutas en las llamadas funcionan con cualquier versión, así que
  prefiérelas.
- `timeout` es por llamada, en segundos: un `run_simulation` o `compare_scenarios` largo bloquea el
  servidor hasta terminar, así que deja margen.
- Después de editar el archivo, corre `/reload-mcp` en una sesión de Hermes. Hermes nombra las tools
  `mcp_lila_<tool>` (`mcp_lila_create_process`); los argumentos son los de esta página.
- `tools: { include: [...] }` limita lo que ve el agente; por ejemplo, a las de solo lectura
  `get_project`, `get_scenario`, `validate_bpmn`, `describe_process`, `get_process_outline`,
  `get_raci_matrix` y `run_simulation` (que solo escribe con `saveTo` o `saveRun`).

El mismo bloque, con `command` y `args`, es la configuración stdio genérica para cualquier otro
cliente MCP.

## Ejemplos

Una llamada por cada tool que las secciones de arriba no muestran ya, escrita como la manda un
agente (`name` y `arguments`); las rutas son relativas al directorio de trabajo del servidor.

```json
{ "name": "validate_bpmn", "arguments": { "path": "examples/pedido/model.bpmn" } }
```

```json
{ "name": "describe_process", "arguments": { "path": "examples/pedido/model.bpmn", "scenario": "examples/pedido/as-is.scenario.json" } }
```

```jsonc
// run_simulation
{ "name": "run_simulation", "arguments": { "scenario": "examples/pedido/as-is.scenario.json", "seed": 42 } }
// -> { "elements": {...}, "flows": {...}, "resources": {...}, "process": {...},
//      "bottlenecks": [...], "replications": {...}, "warnings": [...] }
```

```jsonc
// compare_scenarios (el primero es la base)
{ "name": "compare_scenarios", "arguments": {
  "scenarios": ["examples/pedido/as-is.scenario.json", "examples/pedido/to-be-3-cajeros.scenario.json"], "seed": 42 } }
// -> { "comparison": { "count": 2, "rows": [...] }, "notes": [...] }
```

```jsonc
// patch_scenario, modo (b): crea un TO-BE con extends al AS-IS
{ "name": "patch_scenario", "arguments": {
  "scenario": "examples/pedido/as-is.scenario.json",
  "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 3 }],
  "saveTo": "examples/pedido/to-be-3-cajeros-copia.scenario.json",
  "name": "TO-BE 3 cajeros (copia)" } }
// -> escribe { "version": 1, "name": "TO-BE 3 cajeros (copia)",
//              "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }
//    y devuelve { "scenario": {...resuelto...}, "file": "/ruta/.../to-be-3-cajeros-copia.scenario.json",
//                 "notes": [...] }
```

`saveTo` es un archivo nuevo: nunca lo apuntes a un escenario que el repo versiona (como
`to-be-3-cajeros.scenario.json`), porque se sobrescribe.

```json
{ "name": "get_process_outline", "arguments": { "project": "credit.lila", "process": "credit-application" } }
```

## Los dos flujos de la aceptación de M4, como conversación

Son los dos que prueba `packages/mcp/test/e2e.test.ts` contra `lila mcp` por stdio, con los números
reales de `examples/pedido` con `seed: 42`.

### "Simula examples/pedido con as-is y dime el cuello de botella"

Una sola llamada:

1. `run_simulation({ "scenario": "examples/pedido/as-is.scenario.json", "seed": 42 })`.
   El agente lee `bottlenecks[0]` del JSON:
   `{ "elementId": "Task_Preparar", "resourceWaitTotal": 267417737.56, "utilization": 0.3435 }`,
   idéntico al de `lila run … --json`. Responde: el cuello de botella es `Task_Preparar` (Preparar),
   por espera de `cocinero`/`horno`; el segundo es `Task_TomarPedido`.

Si el modelo no fuera simulable, la llamada sería `isError: true` y el paso previo sería
`validate_bpmn` (§ *Qué significa `isError`*). Para "cuéntame qué hace este proceso" antes de
simular, `describe_process`.

### "Qué pasa si agrego un cajero"

Dos llamadas más, sin tocar el AS-IS:

2. `patch_scenario({ "scenario": "examples/pedido/as-is.scenario.json", "patch": [{ "op":
   "replace", "path": "/resources/cajero/capacity", "value": 3 }], "saveTo":
   "examples/pedido/to-be-3-cajeros-copia.scenario.json", "name": "TO-BE 3 cajeros (copia)" })` — escribe
   `{ "version": 1, "name": "TO-BE 3 cajeros (copia)", "extends": "as-is.scenario.json",
   "resources": { "cajero": { "capacity": 3 } } }`: solo el delta, con `extends` al AS-IS. Un patch
   que deja el escenario inválido se rechaza **sin escribir nada**.
3. `compare_scenarios({ "scenarios": ["examples/pedido/as-is.scenario.json",
   "examples/pedido/to-be-3-cajeros-copia.scenario.json"], "seed": 42 })` — 255 filas; la que importa es
   `elements.Task_TomarPedido.resourceWait.mean`: **14.97 → 2.18 minutos, −85.4 %**, con
   `significant: [false, true]` (los IC 95 % no se solapan). El agente responde: un cajero más
   quita casi toda la cola del mostrador, y el cuello de botella se queda en `Task_Preparar`.

Un escenario inline (sin archivo en disco) es un objeto JS con el mismo `ResolvedScenario` que
produciría `resolveExtends`: `{ "scenario": { "version": 1, "name": "...", "model": "...", "run":
{...}, "elements": {...} } }`. Si declara `model` relativo, se resuelve contra el cwd del proceso
servidor, igual que una ruta.

## Qué significa `isError`

`isError: true` marca que **falló la tool**: faltan argumentos o sobran (`path` y `xml` a la vez),
el archivo no existe o no se puede leer, el XML es impenetrable. Un modelo que la validación
rechaza **no** es un fallo de la tool: `validate_bpmn` responde `isError: false` con el reporte
completo y sus `errors[]` (mismo criterio que el catálogo de `docs/SEMANTICS.md` § 17), igual que
`describe_process`, que lo dice además en su resumen. Así un agente distingue "la herramienta se
rompió" (reintentar, corregir la llamada) de "el modelo tiene errores" (leer `errors[]` y arreglar
el `.bpmn`). Ojo: la CLI sí sale con código 1 en ese caso — el código de salida y `isError` no son
lo mismo.

`run_simulation` y `compare_scenarios` mantienen el mismo criterio, y por eso responden
`isError: true` cuando el modelo o el escenario no pasan la validación: a diferencia de
`validate_bpmn`, ahí **no hay resultado que devolver** —no se puede simular—, así que el fallo es
de la llamada, no un reporte válido. El mensaje lleva el nombre de la tool, el escenario culpable
(su ruta, o `scenarios[n]` si vino inline) y los errores en JSON. Para saber *por qué* un modelo no
se puede simular sin gastar una simulación, la tool es `validate_bpmn`, que devuelve el reporte
completo con `isError: false`.

`patch_scenario` sigue el mismo criterio que `run_simulation`/`compare_scenarios`: un patch que
deja el escenario inválido (estructuralmente, por `docs/SCENARIO_FORMAT.md` § 5, o porque la
propia operación de JSON Patch no se puede aplicar — un `path` inexistente en `replace`, una
operación desconocida) es `isError: true`, sin escribir nada. No hay ambigüedad "resultado
correcto pero el modelo tiene errores" aquí: si el escenario resultante no valida, no hay nada que
devolver. Los defectos del esquema salen por `parseScenario` (LILA-202): con los
códigos de `docs/SEMANTICS.md` § 17 (`E-CLAVE-DESCONOCIDA: …`), el mismo texto que la CLI y en el
idioma que pidió la llamada (§ Idioma).

## `saveTo`

`saveTo` escribe en el sistema de archivos del **proceso servidor**, con sus permisos, la ruta que
se le pase (relativa al cwd, como todo lo demás). Sobrescribe un archivo existente sin preguntar,
igual que `lila run --json <ruta>`, y publica con `rename` desde un temporal en el mismo
directorio: nadie llega a leer un JSON a medias. Un directorio con ese nombre es un error de la
tool, no un borrado. Las tools de exportación son la excepción: nunca reemplazan un archivo
salvo con `overwrite: true` (ver [Exportar sin la app](#exportar-sin-la-app)). `run_simulation` y `compare_scenarios` guardan el resultado
completo diga lo que diga `detail`. `compare_scenarios` guarda ahí solo `comparison`, sin `notes`: los mismos
bytes que `lila compare --json <ruta>`; con `format: "xlsx"`, el libro de la comparación. El `logTo`
de `run_simulation` sigue las mismas reglas. En `patch_scenario`, `saveTo` cambia el modo de la tool
(§ arriba): sin `saveTo` se sobrescribe `scenario`; con `saveTo` se crea un archivo nuevo con
`extends` y solo el delta del patch.

## Rutas

`path` y `scenario` se resuelven contra el **cwd del proceso servidor**, no contra el del cliente
ni la raíz del repo; dentro de un `.lila`, `model` y `extends` se resuelven respecto del lugar del
escenario en el archivo. En Claude Code eso es el directorio desde el que se lanzó el servidor; en la
duda, pasa rutas absolutas.

## Paquete del SDK

`@modelcontextprotocol/server` 2.0.0 (no `@modelcontextprotocol/sdk`, que es un paquete distinto
del mismo repo/mantenedores, más orientado a cliente+servidor combinados en 1.x). El BACKLOG pedía
"`@modelcontextprotocol/server` 2.x"; se verificó con `npm view` que existe exactamente en esa
versión, mantenido por el mismo equipo de Anthropic/MCP. Los tests usan además
`@modelcontextprotocol/client` 2.0.0 (mismo repo) como devDependency.

## Probarlo a mano

Desde la raíz del repo, tras `npm run build`.

Lo más rápido, sin instalar nada y sin navegador — un cliente stdio de diez líneas:

```bash
node --input-type=module -e "
const { Client } = await import('@modelcontextprotocol/client');
const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
const client = new Client({ name: 'manual', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['packages/engine/bin/lila.js', 'mcp'] }));
console.log((await client.listTools()).tools.map((t) => t.name));
const r = await client.callTool({ name: 'validate_bpmn', arguments: { path: 'examples/pedido/model.bpmn' } });
console.log(r.isError, r.content[0].text.slice(0, 200));
await client.close();
"
```

O a pelo, una línea de JSON-RPC por stdin:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' | node packages/engine/bin/lila.js mcp
```

Y con Claude Code de verdad, sin abrir una sesión interactiva (el `.mcp.json` del repo ya está):

```bash
claude -p "Simula examples/pedido con el escenario as-is y dime el cuello de botella." \
  --mcp-config .mcp.json --strict-mcp-config --allowedTools "mcp__lila__run_simulation"
```

Devuelve `Task_Preparar`, el mismo `bottlenecks[0].elementId` que `lila run`. El nombre de la tool
en `--allowedTools` es `mcp__<servidor>__<tool>`; sin él, `claude -p` no puede aprobar la llamada y
se queda sin usar el servidor.

El inspector oficial (`npx @modelcontextprotocol/inspector …`) también sirve, pero **abre una UI en
el navegador y se queda en primer plano**: no lo lances desde un agente ni en CI.

## Límites conocidos

- **Con `detail: "full"` el resultado viaja dos veces.** `run_simulation` manda el mismo objeto como
  texto y como `structuredContent`, que es lo que recomienda la especificación MCP por
  compatibilidad: para `examples/pedido` con 30 replicaciones el resultado completo son ~93 KB de
  mensaje. El resumen por defecto lo mantiene pequeño.
- **`compare_scenarios` no publica `outputSchema`** (no hay esquema zod de `CompareResult` en el
  repo), aunque sí manda `structuredContent`. Un cliente estricto puede rechazarlo.
- **Todo pasa por el disco del servidor.** `saveTo` escribe con los permisos del proceso servidor y
  sobrescribe sin preguntar; no hay sandbox de rutas.
- **`create_process` maqueta con `bpmn-auto-layout` 1.3, que no dibuja pool ni carriles**: Lila
  conserva sus columnas y filas, mueve cada nodo a su carril, vuelve a trazar los flujos en ángulo
  recto (rodeando las figuras que estorban) y pone la etiqueta de cada rama sobre su propia rama.
  Los carriles pueden salir más altos de lo necesario, el nombre de una compuerta puede quedar
  sobre un flujo que sale por abajo, y un subproceso se crea colapsado con un paso vacío dentro. Si el dibujo importa, se
  acomoda en la app.
- **`edit_process` con `layout: true` maqueta de nuevo todo el proceso editado** (se pierden las
  posiciones a mano en él); un subproceso expandido queda colapsado, y los pools verticales (como
  los dibuja Bizagi) quedan horizontales. Con `layout: false` la colocación es simple: a la derecha
  del predecesor, en su carril; no desenreda cruces. Solo se puede editar el proceso principal del
  BPMN, y los carriles anidados solo a través de sus carriles hoja. `edit_process` no agrega
  eventos de inicio ni les cambia el tipo: ponlos en el esquema (`starts`) o cámbialos en la app.
