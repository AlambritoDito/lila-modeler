# MCP (LILA-053/054/055/056)

> Leer en: [English](../MCP.md)

`packages/mcp` (`@lila-modeler/mcp`) es un servidor [MCP](https://modelcontextprotocol.io) por stdio sobre
`@lila-modeler/engine`, sin lógica propia: quince tools, sobre el mismo pipeline de validación y
simulación que la CLI — ver [`docs/es/CLI.md`](CLI.md) para ese mismo pipeline manejado desde una
terminal en vez de un cliente MCP.

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
- **`run_simulation({ model?, process?, scenario, seed?, replications?, saveTo?, saveRun?, locale? })`** (LILA-054) — valida
  modelo y escenario, simula con `log: false` y devuelve exactamente el mismo `RunResult` que
  `lila run --json` (elementos, flujos, recursos, proceso, bottlenecks y avisos). `scenario` acepta
  una ruta `.json` (resuelve `extends`, igual que la CLI) o el escenario ya resuelto como objeto
  inline; `model` es opcional y por defecto es `scenario.model`; se rechaza un modelo distinto.
  Ningún campo de nivel 2/3 se rechaza (LILA-184): `resources` y `calendars` los simula el motor desde LILA-033…036 y LILA-041.
  `saveTo` escribe el mismo JSON de forma atómica que `lila run --json <ruta>`. Trae
  `outputSchema` (`@lila-modeler/engine/result-schema`) y responde `structuredContent` además del texto.
  Con un `model` `.lila` y un escenario suyo, `saveRun: true` guarda la corrida en el proyecto (ver
  [Guardar una corrida](#guardar-una-corrida)).
- **`compare_scenarios({ model?, process?, scenarios, seed?, replications?, saveTo?, locale? })`** (LILA-054) — valida
  y simula dos o más escenarios sobre el mismo modelo (el primero es la base) y devuelve
  exactamente el mismo `CompareResult` que `lila compare --json`, más `notes`: los avisos que la
  CLI imprime aparte de la tabla (semillas distintas, `baseTimeUnit` distinto, réplicas
  insuficientes para IC95). `scenarios` acepta rutas y objetos inline mezclados. Todo escenario se
  resuelve y valida contra el modelo antes de simular ninguno.
- **`patch_scenario({ scenario, project?, process?, patch, saveTo?, extendsFrom?, name?, description?, locale? })`**
  (LILA-055) — aplica un [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) a `scenario`, valida
  el resultado contra su modelo (mismas reglas que `validateScenario`, `docs/SCENARIO_FORMAT.md`
  § 5) y **solo si valida** lo escribe a disco de forma atómica; nunca dos veces. Devuelve
  `{ scenario, file, notes }`: el escenario resultante ya resuelto, la ruta absoluta escrita y los
  avisos de lint (`W-…`) como `notes`. Dos modos:
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

- **`annotate_element({ project, process?, elementId, documentation?, responsibilities?, refs?, attributes?, dryRun?, locale? })`** —
  escribe la descripción, el RACI, las referencias al catálogo y los atributos extendidos de un
  elemento de un proceso de un `.lila`. Devuelve
  `{ file, process, elementId, dryRun, changed, written, before, after }`.
- **`get_raci_matrix({ project, process?, locale? })`** — devuelve la matriz RACI del proceso:
  `{ file, process, roles, rows }`.
- **`import_scenario_sheet({ project, process?, scenario, sheet, dryRun?, locale? })`** — aplica
  una hoja de escenario (`.xlsx`/`.csv`) a un escenario del `.lila`. Devuelve
  `{ file, process, scenario, sheet, dryRun, written, tables, changes, issues }`.
- **`export_scenario_template({ project, process?, scenario, saveTo, overwrite?, locale? })`** —
  escribe esa hoja como `.xlsx`, rellenada. Devuelve `{ file, project, process, scenario }`.
- **`create_project({ path, name, bpmn, scenarios?, overwrite?, locale? })`** — crea un `.lila`
  nuevo a partir de un BPMN que ya existe (un agente que parte de pasos usa `create_process`) y
  escenarios. Devuelve `{ file, name, processId, warnings, scenarios }`.

Las tres de exportación se explican en [Exportar sin la app](#exportar-sin-la-app); las cinco
últimas en [Herramientas de modelado para agentes](#herramientas-de-modelado-para-agentes).

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
  corridas de la versión anterior. Los demás procesos, escenarios y corridas pasan sin cambios y,
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
nada. El `structuredContent` de la respuesta sigue siendo el `RunResult`; un segundo bloque de
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
  o varios después de una compuerta), `branches` (solo compuertas: `{ label?, to, probability? }`,
  o `{ label?, end: true, probability? }` para una rama que termina el proceso) o `end: true`. El
  último paso termina el proceso. Los eventos de inicio y fin se añaden solos.
- **`type`** es `task` por defecto; los demás son `userTask`, `serviceTask`, `callActivity`, `xor`,
  `and`, `or`, `timer` (un evento intermedio de temporizador) y `subprocess` (un subproceso
  embebido colapsado, con un inicio y un fin de paso dentro).
- **Los ids de los pasos son los ids BPMN**, así que los escenarios se refieren a ellos. Deben ser
  ids BPMN válidos y no chocar con los que Lila genera (`StartEvent`, `EndEvent_<paso>`, `Flow_…`,
  `Lane_<n>`, `Process_…`, `<id>_di`).
- **`lane`** es por defecto el carril del paso anterior (el primero para el primer paso). Un carril
  que no está en `lanes` es un error si `lanes` viene, y se agrega en orden si no viene.
- **El escenario base.** El proceso recibe `as-is.scenario.json`: las llegadas por defecto de la app
  para un proceso nuevo (20 casos, uno por minuto), cada `duration` como `processingTime` (tareas)
  o demora (temporizadores), cada entrada de `resources` (un nombre, o `{ name, quantity }`; el
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
  (`and`) que espera ramas de una sola compuerta exclusiva (`xor`), donde los casos esperarían
  para siempre.

```json
{ "name": "create_process", "arguments": { "project": "credit.lila", "outline": { "name": "Credit application", "lanes": ["Customer", "Analyst"], "steps": [ … ] } } }
```

`get_process_outline` devuelve el esquema en **forma normal**: cada paso dice su carril, `type` se
omite para `task`, `next` aparece solo cuando no es simplemente el paso siguiente, todo paso que
termina el proceso lleva `end: true`, las salidas de las compuertas son `branches`, las duraciones
son objetos de distribución en segundos y las probabilidades del XOR vienen completas. Es la forma
que `create_process` devuelve como `outline`, así que un proceso va y vuelve igual. Duraciones,
recursos y probabilidades (y la `selection` de recursos) salen del `as-is.scenario.json` del
proceso cuando lo tiene. Para un proceso que Lila no generó, `warnings` dice una vez por tipo lo
que el esquema deja fuera: otros pools, flujos de mensaje, los nombres de los eventos de inicio y
fin, anotaciones, marcas de flujo por defecto, otros tipos de evento, carriles anidados y lo del
escenario que un esquema no lleva (llegadas, calendarios, costos, capacidades y tipos de recurso,
ruteo condicionado; el escenario no se toca). Un proceso sin nombre toma el del `.lila`, si no su
id. Los pasos conservan el orden del documento.

## Herramientas de modelado para agentes

`annotate_element`, `get_raci_matrix`, `import_scenario_sheet`, `export_scenario_template` y
`create_project` (#99, #403, #514) dejan que un agente construya y documente un proyecto sin la
app. La CLI tiene las cuatro primeras como `lila process annotate|raci` y
`lila scenario import|template` (`docs/es/CLI.md`). Toda escritura pasa por el mismo guardado
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
  anotación que no cambia nada no escribe nada (`changed: false`).
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
  algún `lint` se rechaza (un `dryRun` lo informa). La revisión del escenario sube en uno.
- **`export_scenario_template`** es «Descargar plantilla» de la app: dásela a una persona e importa
  lo que devuelva. Un `saveTo` que ya existe se rechaza salvo con `overwrite`.
- **`create_project`** recibe `bpmn` como XML (empieza por `<`) o como ruta a un `.bpmn`. Un modelo
  con errores de validación se rechaza. `scenarios` son `[{ "name", "scenario" }]`, guardados como
  `<name>.scenario.json`; un escenario sin `model` ni `extends` recibe `"model": "model.bpmn"`, y
  uno que nombra otro modelo se rechaza. Un escenario que todavía no puede correr es un borrador:
  se guarda y vuelve con `runnable: false` y sus `errors`. El archivo se escribe entero o nada, y
  uno existente se rechaza salvo con `overwrite`. Las apps web y de escritorio lo abren.

```json
{ "name": "create_project", "arguments": { "path": "proyecto.lila", "name": "Pedidos", "bpmn": "examples/pedido/model.bpmn",
  "scenarios": [{ "name": "as-is", "scenario": { "version": 1, "name": "AS-IS", "run": { "start": "2026-10-05T08:00:00-06:00", "duration": 28800, "seed": 1 } } }] } }
```

```json
{ "name": "annotate_element", "arguments": { "project": "proyecto.lila", "elementId": "Task_TomarPedido",
  "documentation": "Toma el pedido en el mostrador.", "responsibilities": [{ "type": "R", "roleRef": "cajero" }, { "type": "A", "roleRef": "gerente" }],
  "refs": { "systemRef": ["POS"] }, "locale": "es" } }
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

Hoy, desde un checkout del repo:

```bash
npm ci
npm run build
```

Eso deja listos los dos puntos de entrada, que arrancan **el mismo servidor**:

- `node packages/engine/bin/lila.js mcp` — el subcomando `lila mcp` (LILA-056), el que se registra.
- `./node_modules/.bin/lila-mcp` — el bin del propio `@lila-modeler/mcp`, equivalente.

`lila mcp` vive en `@lila-modeler/engine` porque el ticket lo pide ahí y porque es el binario que la gente
ya tiene instalado. Como `@lila-modeler/mcp` depende de `@lila-modeler/engine`, importarlo estáticamente desde
`cli.ts` sería un ciclo entre paquetes: se carga con `import()` dinámico
(`packages/engine/src/cli.ts`, `dispatchMcp`) y, si el paquete no está, el comando lo dice por
stderr y sale con 1 en vez de romperse. Instalar el paquete del motor no instala el workspace
privado `@lila-modeler/mcp`. Usa el checkout hasta que exista una distribución MCP instalable por separado.

`lila mcp` habla MCP por **stdout**: nada más puede escribir ahí. Todo diagnóstico (paquete
ausente, fallo de arranque) sale por stderr, que es lo único que ve quien registró el servidor.

## Registro en Claude Code

Por línea de comandos, con ruta absoluta al checkout:

```bash
claude mcp add lila -- node /ruta/al/repo/packages/engine/bin/lila.js mcp
```

`-s user` lo deja disponible en todos los proyectos; sin `-s`, solo en el directorio actual.
Comprobación: `claude mcp list` debe mostrar `lila: ... - ✓ Connected`.

Para el propio repo no hace falta: la raíz trae un `.mcp.json` de proyecto, así que al abrir
Claude Code aquí el servidor aparece solo (Claude Code pide aprobar los servidores de `.mcp.json`
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
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), y se reinicia la app.

```json
{
  "mcpServers": {
    "lila": {
      "command": "/ruta/absoluta/a/node",
      "args": ["/ruta/al/repo/packages/engine/bin/lila.js", "mcp"]
    }
  }
}
```

Usa rutas absolutas para Node y el punto de entrada. Pasa también rutas absolutas de modelo y
escenario en cada llamada, sin depender del directorio de trabajo que elija el cliente.

### Ejemplos

```jsonc
// run_simulation
{
  "scenario": "examples/pedido/as-is.scenario.json",
  "seed": 42
}
// -> { "elements": {...}, "flows": {...}, "resources": {...}, "process": {...},
//      "bottlenecks": [...], "replications": {...}, "warnings": [...] }
```

```jsonc
// compare_scenarios
{
  "scenarios": [
    "examples/pedido/as-is.scenario.json",
    "examples/pedido/to-be-3-cajeros.scenario.json"
  ],
  "seed": 42
}
// -> { "comparison": { "count": 2, "rows": [...] }, "notes": [...] }
```

```jsonc
// patch_scenario, modo (b): crea un TO-BE con extends al AS-IS
{
  "scenario": "examples/pedido/as-is.scenario.json",
  "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 3 }],
  "saveTo": "examples/pedido/to-be-3-cajeros.scenario.json",
  "name": "TO-BE 3 cajeros"
}
// -> escribe { "version": 1, "name": "TO-BE 3 cajeros",
//              "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }
//    y devuelve { "scenario": {...resuelto...}, "file": "/ruta/.../to-be-3-cajeros.scenario.json",
//                 "notes": [...] }
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
   "examples/pedido/to-be-3-cajeros.scenario.json", "name": "TO-BE 3 cajeros" })` — escribe
   `{ "version": 1, "name": "TO-BE 3 cajeros", "extends": "as-is.scenario.json",
   "resources": { "cajero": { "capacity": 3 } } }`: solo el delta, con `extends` al AS-IS. Un patch
   que deja el escenario inválido se rechaza **sin escribir nada**.
3. `compare_scenarios({ "scenarios": ["examples/pedido/as-is.scenario.json",
   "examples/pedido/to-be-3-cajeros.scenario.json"], "seed": 42 })` — 255 filas; la que importa es
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
salvo con `overwrite: true` (ver [Exportar sin la app](#exportar-sin-la-app)). `compare_scenarios` guarda ahí solo `comparison`, sin `notes`: los mismos
bytes que `lila compare --json <ruta>`. En `patch_scenario`, `saveTo` cambia el modo de la tool
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

- **Sin cancelación ni progreso.** `simulate()` es síncrono y bloquea el event loop del proceso
  servidor mientras corre: durante esos segundos —o los minutos de un modelo grande con 30
  replicaciones— el servidor no responde a nada, ni a un `ping` ni a `notifications/cancelled`. Un
  agente que se arrepiente tiene que matar el proceso. La pieza que lo arreglaría ya existe (el
  worker con progreso y cancelación de LILA-195, hecho para la web); traerla aquí es un ticket
  propio.
- **El resultado viaja dos veces.** `run_simulation` manda el mismo objeto como texto y como
  `structuredContent`, que es lo que recomienda la especificación MCP por compatibilidad: para
  `examples/pedido` con 30 replicaciones son ~93 KB de mensaje (~55 KB de texto y ~32 KB de
  `structuredContent`), del orden de 25 mil tokens duplicados en una sola llamada. Si molesta, la
  salida barata es mandar en el texto solo `bottlenecks` y `process`, que es lo que el agente lee.
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
