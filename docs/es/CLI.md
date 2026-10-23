# CLI (LILA-045/046/047/053, #450)

> Leer en: [English](../CLI.md)

`lila` es la interfaz de línea de comandos de `@lila-modeler/engine`: el mismo motor de validación y
simulación que usan la app web, la app de escritorio y el servidor MCP, manejado desde una
terminal. Esta página es la referencia que necesita un agente o un script: cada comando con un
ejemplo real, sus códigos de salida, qué escriben `--json`/`--csv`/`--xlsx` y cómo leer el
resultado.

Cada ejemplo de abajo corre desde la raíz del repositorio, sobre el benchmark
[`examples/pedido`](../../examples/pedido) ya versionado. Requiere Node.js **22 o superior**.

## Instalación

La CLI viaja en el paquete del motor, [`@lila-modeler/engine`](https://www.npmjs.com/package/@lila-modeler/engine)
en npm, con la etiqueta `beta` mientras el proyecto es pre-1.0. Instálalo, o córrelo sin instalar:

```bash
npm install -g @lila-modeler/engine@beta      # pone `lila` en tu PATH
npx -p @lila-modeler/engine@beta lila validate model.bpmn
npx @lila-modeler/engine@beta validate model.bpmn
```

Los ejemplos de abajo usan `npx lila …` desde un clon del repositorio, que además trae el benchmark
`examples/pedido` sobre el que corren:

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npx lila` resuelve el binario del propio workspace (`packages/engine/bin/lila.js`), sin consultar
el registro.

`npx lila` solo encuentra esta CLI dentro del clon (después de `npm ci`). En cualquier otro lado
descarga el paquete `lila` ajeno de npm, así que desde otro directorio usa uno de los comandos de
`@lila-modeler/engine` de arriba, llama al binario directo (`node <clon>/packages/engine/bin/lila.js
…`) o usa `npx --no lila …`, que se niega a instalar.

## `validate`

Parsea un archivo `.bpmn` (o un proceso de un `.lila`, ver [abajo](#un-lila-como-entrada-466)), imprime su IR (nodos, flujos, lanes) y la validación completa
(códigos de error/aviso de `docs/SEMANTICS.md` §17). Solo avisos sigue saliendo con `0`; cualquier
error sale con `1`.

```bash
npx lila validate examples/pedido/model.bpmn
```
Código de salida: `0`.

Un modelo fuera del perfil soportado —aquí, un boundary event, que el motor no simula
(`docs/SEMANTICS.md` §2)— sale con `1` y nombra cada problema:

```bash
npx lila validate packages/engine/test/fixtures/boundary-event.bpmn
```
Código de salida: `1`.

`--json` imprime el mismo reporte (`{ ir, ignoredProcessIds, errors, warnings }`) como un único
documento JSON en vez del texto de arriba; la regla del código de salida es la misma.

## `run`

Valida modelo y escenario, simula con réplicas, e imprime las tablas estilo Bizagi (elementos del
proceso, flujos de secuencia, recursos) más las extras de Lila: ranking de cuellos de botella,
resumen del proceso, desglose por desenlace. Sale con `1` si el modelo o el escenario tienen un
error de validación, o si el `model` del escenario no coincide con el archivo dado en la línea de
comandos; `0` en el resto de los casos.

```bash
npx lila run \
  examples/pedido/model.bpmn examples/pedido/as-is.scenario.json \
  --seed 42 --replications 3 \
  --json results/run.json --csv results/csv --xlsx results/as-is.xlsx
```
Código de salida: `0`.

- `--json <archivo>` escribe el `RunResult` determinista (`docs/RESULTS_FORMAT.md`) como un único
  documento JSON. Su forma es `runResultSchema`, exportado desde `@lila-modeler/engine/result-schema`:
  validar contra él antes de confiar en un archivo parseado.
- `--csv <directorio>` escribe `elements.csv`, `flows.csv`, `resources.csv`, `process.csv` (RFC
  4180) y `log.csv` (el event log, escrito en streaming mientras corre la simulación, con
  timestamps ISO desde `run.start`). Es la única bandera que escribe el event log; `--json` y
  `--xlsx` no lo llevan. La tool MCP `run_simulation` escribe los mismos bytes de `log.csv` con
  `logTo` (`docs/es/MCP.md`).
- `--xlsx <archivo>` escribe un libro con las hojas Resumen, Elementos, Flujos, Recursos y
  Parámetros. Sin hoja de event log: para eso está `--csv`.
- Las tres crean los directorios que falten, escriben a una ruta temporal y renombran de forma
  atómica, y se niegan a sobrescribir una ruta que sea un directorio.
- `--save` (con un `.lila` y un escenario suyo) guarda la corrida en el proyecto, como la app; ver
  «Guardar una corrida» en [`export`](#export-538).

## `compare`

Simula dos o más escenarios sobre el mismo modelo y los imprime lado a lado: valor más delta
relativo contra el primer escenario (la base), con un `*` que marca una diferencia
estadísticamente significativa al 95 % de confianza.

```bash
npx lila compare \
  examples/pedido/model.bpmn \
  examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json \
  --seed 42 --replications 3 \
  --json results/compare.json
```
Código de salida: `0`.

La tabla por defecto es un subconjunto curado de KPI; `--all` imprime todas las métricas que
produce `compare()` para cada elemento, recurso, flujo y desenlace. `--json <archivo>` escribe el
`CompareResult`; `--xlsx <archivo>` escribe un libro con una pestaña por escenario más una pestaña
Comparación (la tool MCP `compare_scenarios` escribe los mismos bytes con `format: "xlsx"` y
`saveTo`). `compare` no tiene `--csv`: compara corridas ya terminadas, no reproduce una.

## `export` (#538)

Produce los entregables sin la app —sin ventana ni navegador— con el mismo código del motor que
usa la app:

- `lila export diagram <modelo.bpmn|proyecto.lila>` dibuja el diagrama con el renderizador SVG
  propio del motor (la geometría del DI de BPMN, colores de Lila Light sobre blanco). Sin `--out`
  imprime el SVG por stdout. Con `--overlay bottlenecks|heatmap` (#669) colorea el diagrama con una
  corrida guardada del `.lila`, con la escala de la app y los colores `sim.bottleneck` de Lila
  Light: `bottlenecks` tiñe el corte de cuellos del lienzo, cada uno con su espera media y su
  utilización; `heatmap` tiñe cada tarea medida como el mapa de calor de Resultados, con su espera,
  y marca el corte. La corrida se dibuja sobre el modelo con el que corrió. Una capa sobre un
  `.bpmn`, o sin corrida guardada, es un error; también `--run` o `--scenario` sin `--overlay`.
- `lila export doc <proyecto.lila> --out archivo.docx|archivo.html` escribe el documento del
  proceso, como «Exportar documento» de la app: diagrama, descripciones en orden de flujo (con las
  anotaciones de texto de cada elemento como líneas `Nota`; las de un flujo, un carril o de nada,
  bajo la descripción del proceso), el escenario y los resultados de una corrida guardada. El HTML incrusta el diagrama SVG y las
  gráficas de la corrida en SVG, las mismas de Resultados en la app, salvo el histograma del tiempo
  de ciclo (una corrida guardada no conserva los tiempos por caso). El Word va **sin diagrama y sin
  gráficas**: Word necesita un PNG y el motor no rasteriza. Una nota por stderr dice qué quedó
  fuera.
- `lila export results <proyecto.lila> --out libro.xlsx|directorio` escribe los resultados de una
  corrida guardada: un `.xlsx` (Resumen, Elementos, Flujos, Recursos, Parámetros) o, con
  `--format csv`, `elements.csv`, `flows.csv`, `resources.csv` y `process.csv` en el directorio,
  los mismos archivos que escribe `lila run` (una corrida guardada no conserva el log de eventos,
  así que no hay `log.csv`). Añade los p50/p90/p95 de la espera por recurso por elemento, una hoja
  `Percentiles` o `percentiles.csv`, volviendo a simular las entradas guardadas de la corrida;
  cuando esa nueva corrida no reproduce los KPI guardados (otra versión del motor u otra
  plataforma), quedan fuera y una nota por stderr dice por qué (`docs/es/RESULTS_FORMAT.md` § 12).

`--format` sale por defecto de la extensión de `--out` (`.docx`, `.html`, `.xlsx`). `--process`
elige el proceso de un repositorio, como en el resto. Las **corridas** son las que la app guardó en
el `.lila`: `--run latest` (por defecto) es la corrida del modelo y escenario actuales,
`--scenario <nombre>` la acota a un escenario (necesario si varios tienen una corrida actual) y
`--run <id>` elige una por id; un error lista los ids; `--run <id>` junto con `--scenario` es un error. El documento solo admite una corrida actual
y, sin ella, va sin resultados; `results` sin corrida es un error que lo dice. Los resultados de
una corrida anterior se exportan contra el modelo con el que corrió.

**No se sobrescribe nada**: un archivo de salida que ya existe es un error y no se escribe nada,
salvo con `--force`. El archivo que se exporta (el `.lila` o `.bpmn`) nunca es un destino, con
`--force` o sin él, por ninguna ruta que llegue a él. Cada archivo se escribe en un temporal a su
lado y se publica de una vez, así que un error nunca deja medio archivo.

```bash
npx lila export diagram examples/pedido.lila --out results/pedido.svg
```
Código de salida: `0`.

```bash
npx lila export doc examples/pedido.lila --out results/pedido.html
```
Código de salida: `0`.

**Guardar una corrida**: `lila run <proyecto.lila> <escenario> --save` simula un escenario del
archivo y guarda la corrida en el `.lila` exactamente como la app (misma forma, las revisiones de
modelo y escenario con que corrió, construida por la misma función del motor), así que la app la
abre como corrida actual y `lila export` la usa. La escritura es atómica y bajo el candado del
archivo; las escrituras concurrentes llegan todas, y se rechaza guardar si el modelo o ese escenario
cambiaron. Un `.bpmn` o un escenario en disco no se pueden guardar. La app conserva todas las
corridas, y `--save` también:

```text
npx lila run proyecto.lila as-is --seed 42 --replications 5 --save
npx lila export results proyecto.lila --out results/as-is.xlsx
```

`examples/pedido.lila` no guarda corridas, así que sus resultados no se pueden exportar hasta
guardar una (el mensaje dice cómo):

```bash
npx lila export results examples/pedido.lila --out results/pedido.xlsx
```
Código de salida: `1`.

## `process annotate` y `process raci` (#99)

Documenta un proceso desde la terminal, como lo hace el panel de propiedades de la app, y lee su
matriz RACI:

- `lila process annotate <proyecto.lila> <idElemento>` escribe en el elemento con ese id BPMN:
  `--documentation <texto>` reemplaza su descripción (`""` la quita); `--responsibility TIPO:rol`
  (repetible, `TIPO` uno de `R`, `A`, `C`, `I`) reemplaza toda su lista RACI, y
  `--clear-responsibilities` la vacía; `--ref tipo=id` (repetible; `systemRef`, `documentRef`,
  `riskRef`, `controlRef`, `kpiRef`, `input`, `output`) reemplaza las listas de los tipos dados
  (`tipo=` vacía uno); `--attribute id=valor` (repetible, por id o nombre del atributo) fija un
  atributo extendido, comprobado contra las definiciones de atributos del proyecto (`id=` quita el
  valor; los atributos que no se dan se quedan). Imprime el elemento como queda; `--json` imprime
  `{ file, process, elementId, dryRun, changed, written, before, after }`.
- `lila process raci <proyecto.lila>` imprime la matriz RACI: una fila por elemento con
  responsabilidades, en el orden del documento del proceso (`lila export doc`), una columna por
  rol. `--json` imprime `{ file, process, roles, rows }`; `--csv` imprime `id,name,lane,<roles>`
  como CSV.

`--dry-run` muestra el resultado y no escribe nada. Una escritura guarda el `.lila` de forma
atómica, bajo su candado, con los demás procesos intactos (ver
[Un `.lila` como entrada](#un-lila-como-entrada-466)); la revisión del modelo sube en uno, como
cuando guarda la app. Un elemento desconocido, un tipo que no es RACI o un valor de atributo que
no cabe en su definición es un error, y no se escribe nada.

```bash
npx lila process annotate examples/pedido.lila Task_TomarPedido --responsibility R:cajero --responsibility A:gerente --ref systemRef=POS --dry-run
```
Código de salida: `0`.

```bash
npx lila process raci examples/pedido.lila --json
```
Código de salida: `0`.

## `process attribute` (#633)

Define los atributos extendidos que luego puede tener un elemento (`--attribute` de arriba), como
el diálogo de atributos de la app, y los lista:

- `lila process attribute define <proyecto.lila> --name <nombre> --type text|number|list|date
  --applies-to task|gateway|event|subProcess|lane|process` define uno, con `--option <valor>`
  (repetible) para una lista y `--default <valor>`. Se pasa siempre la definición entera. Cambia la
  definición con `--id`; sin él, la que tiene ese nombre (sin distinguir mayúsculas) para ese tipo
  de elemento; si no hay, crea una con un id determinista, `Attr_` y el nombre en ASCII minúsculo
  (`SLA (h)` → `Attr_sla_h`), así que repetirlo no cambia nada. Las reglas son las del diálogo: un
  nombre único por tipo de elemento, una lista con al menos una opción, opciones solo en una lista
  y un valor por defecto que encaje. `--remove` (con `--id`, o con `--name` y `--applies-to`) quita
  la definición y sus valores; cambiarle el tipo, el `--applies-to` o quitarle opciones quita los
  valores que ya no encajan. Imprime la definición y cada valor quitado; `--json` imprime
  `{ file, process, dryRun, changed, written, before, after, removedValues, definitions }`.
- `lila process attribute list <proyecto.lila>` imprime las definiciones del proceso; `--json`
  imprime `{ file, process, definitions }`.

`--dry-run` muestra el resultado, con los valores que se quitarían, y no escribe nada. Una
escritura guarda el `.lila` como `process annotate`.

```bash
npx lila process attribute define examples/pedido.lila --name SLA --type number --applies-to task --default 24 --dry-run
```
Código de salida: `0`.

```bash
npx lila process attribute list examples/pedido.lila --json
```
Código de salida: `0`.

## `scenario import` y `scenario template` (#514)

«Descargar plantilla» e «Importar Excel/CSV…» de la app (`docs/es/SCENARIO_SHEETS.md`) sobre un
escenario de un `.lila`:

- `lila scenario template <proyecto.lila> <escenario> --out hoja.xlsx` escribe la hoja del
  escenario (Elements, Arrivals, Resources, Assignments, Calendars), rellenada con sus valores,
  para que una persona la complete. Un archivo existente se rechaza salvo con `--force`.
- `lila scenario import <proyecto.lila> <escenario> <hoja.xlsx|hoja.csv>` planifica la hoja contra
  el escenario resuelto e imprime cada cambio (`Cajero (cajero) · capacity: 2 → 3`), las filas no
  aplicadas y las notas, y escribe los cambios en el archivo propio del escenario — su delta cuando
  hace `extends` de otro, exactamente como la app. Un plan que dejaría el escenario con errores se
  rechaza y no se escribe nada. `--dry-run` imprime el plan y no escribe nada; `--json` imprime
  `{ file, process, scenario, sheet, dryRun, written, tables, changes, issues }`.

```bash
npx lila scenario template examples/pedido.lila as-is --out results/as-is.xlsx
```
Código de salida: `0`.

```text
npx lila scenario template proyecto.lila as-is --out as-is.xlsx
# … una persona rellena as-is.xlsx …
npx lila scenario import proyecto.lila as-is as-is.xlsx --dry-run
npx lila scenario import proyecto.lila as-is as-is.xlsx
```

## `project show` y `scenario show` (#628)

Lo que tiene un `.lila`, leído sin escribir nada — ni escritura ni cambio de revisión:

- `lila project show <proyecto.lila>` imprime el nombre del proyecto y su versión de formato (2
  para un repositorio de varios procesos, 1 si no) y, por proceso, su slug, nombre, id del
  `bpmn:process`, revisión del modelo y número de nodos de flujo, sus escenarios (entrada, nombre,
  revisión, `extends`) y sus corridas guardadas (id, escenario, réplicas, inicio simulado y si la
  corrida está **vigente** u **obsoleta**: obsoleta cuando el modelo o el escenario cambiaron
  después de ella). Un `.lila` no guarda la fecha en que se tomó una corrida; `start` es el
  `run.start` del escenario que corrió. `--json` imprime `{ file, name, formatVersion,
  processes: [{ slug, name, processId, modelRevision, elements, scenarios: [{ entry, name,
  revision, extends }], runs: [{ id, scenario, start, replications, current }], attributes }] }`,
  donde `attributes` son las definiciones de atributos extendidos del proceso (ver
  `process attribute`), `null` si el modelo no se puede releer entero.
- `lila scenario show <proyecto.lila> <escenario>` imprime el escenario como está guardado (con su
  `extends`), o con `--resolved` fusionado por `extends` con los valores por defecto del motor —el
  objeto que parchea `patch_scenario`, con `model` relativo al escenario—. Después, las notas del
  validador contra el modelo del proceso (primero los errores `E-…`, luego los avisos `W-…`), las
  comprobaciones que hace `run` antes de simular, así que sirve de lint de escenarios; aun con
  errores sale con `0`. `--json` imprime `{ file, process, entry, revision, resolved, scenario,
  runnable, notes }`.

```bash
npx lila project show examples/pedido.lila --json
```
Código de salida: `0`.

```bash
npx lila scenario show examples/pedido.lila to-be-3-cajeros --resolved
```
Código de salida: `0`.

## `scenario patch` y `project create` (#635)

El lado CLI de las tools MCP `patch_scenario` (para un `.lila`) y `create_project`
([`docs/es/MCP.md`](MCP.md#mcp-y-cli-lado-a-lado)), sobre las mismas funciones del motor:

- `lila scenario patch <proyecto.lila> <escenario> --patch <ops.json>` aplica un
  [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) (`add`, `replace`, `remove` y `test`; sin
  `move` ni `copy`) a un escenario del `.lila`, valida el resultado contra el modelo del proceso y
  solo lo escribe si valida. Sin `--save-to` parchea el escenario en sitio: el patch se aplica al
  escenario resuelto, que se escribe entero, sin `extends`. Con `--save-to nombre` crea (o
  reemplaza) el escenario `nombre`, que hereda (`extends`) del escenario dado (o de
  `--extends-from nombre`) y solo trae las claves que tocó el patch. `--name` y `--description`
  fijan los del resultado. Un patch inválido, o un resultado que no valida, sale con `1` y no
  escribe nada. Un patch que no cambia nada no escribe nada y lo dice: el escenario conserva su
  revisión y sus corridas guardadas siguen vigentes. `--dry-run` valida todo y no escribe nada;
  `--json` imprime `{ scenario, file, process, entry, written, dryRun, notes }`. Parchear un
  escenario `.json` suelto es solo de MCP: desde la CLI, se edita el archivo.
- `lila project create <ruta.lila> --name nombre --bpmn <archivo.bpmn>` crea un `.lila` nuevo con un
  proceso. Un modelo con errores de validación sale con `1`, salvo con `--allow-unsimulatable`:
  entonces se guarda como un diagrama que no simula y sus errores se imprimen como notas.
  `--scenario nombre=archivo.json` (repetible) añade un escenario que se guarda como
  `nombre.scenario.json`; uno que todavía no puede correr se guarda como borrador y se lista con lo
  que le falta. Un modelo sin diagrama recibe uno. El archivo se escribe entero o nada, y un
  archivo que ya existe sale con `1` salvo con `--force`. `--json` imprime
  `{ file, name, processId, laidOut, warnings, notes, scenarios }`.

```bash
npx lila scenario patch examples/pedido.lila as-is --patch examples/outline/pedido-patch.json --save-to to-be-4-cocineros --dry-run --lang es
```
Código de salida: `0`.

```text
Simulacro: el resultado valida y se escribiría en to-be-4-cocineros.scenario.json; no se escribió nada.
aviso W-ELEMENTO-SIN-PARAMETROS: el elemento existe en el modelo y no tiene parámetros; toma sus valores por defecto (elements.Task_Empacar).
```

El archivo ya existe, así que `project create` lo rechaza sin `--force`:

```bash
npx lila project create examples/pedido.lila --name Pedidos --bpmn examples/pedido/model.bpmn --lang es
```
Código de salida: `1`.

```text
lila project create: /…/examples/pedido.lila ya existe; no se escribió nada. Pasa --force (`overwrite` en MCP) para reemplazarlo.
```

Un recorrido completo, en una carpeta tuya: crear un proyecto, derivar un escenario y comparar los dos.

```text
npx lila project create pedidos.lila --name Pedidos --bpmn examples/pedido/model.bpmn --scenario as-is=examples/pedido/as-is.scenario.json
npx lila scenario patch pedidos.lila as-is --patch examples/outline/pedido-patch.json --save-to to-be-4-cocineros
npx lila compare pedidos.lila as-is to-be-4-cocineros
```

## `process export-bpmn` y `process import` (#632)

El BPMN de un proceso de un `.lila`, tal cual, hacia fuera y hacia dentro — las tools MCP
`get_process_bpmn` y `put_process_bpmn` ([`docs/es/MCP.md`](MCP.md#el-bpmn-de-un-proceso)):

- `lila process export-bpmn -p <proyecto.lila>` imprime el modelo del proceso como está guardado,
  o lo escribe en `--out archivo.bpmn` (un archivo que ya existe se rechaza salvo con `--force`).
  No escribe nada en el `.lila`.
- `lila process import -p <proyecto.lila> --bpmn <archivo.bpmn>` añade el BPMN (una exportación de
  Bizagi, por ejemplo) como proceso nuevo del `.lila`, que tiene que existir; un proyecto versión 1
  pasa a ser un repositorio. El slug es `--process`, o sale de `--name`, si no del nombre del pool,
  del proceso o del archivo; uno que ya está en el archivo sale con `1`. El proceso nuevo recibe un
  `as-is.scenario.json` con los valores por defecto de la app (20 llegadas con un minuto entre
  ellas, un minuto por tarea). Con `--replace` reemplaza en cambio el modelo del proceso
  `--process`: la revisión sube (las corridas guardadas quedan obsoletas), las anotaciones son las
  del modelo nuevo, las entradas de escenario que ya no aplican se quitan y se imprimen como notas,
  y un error de escenario que con el modelo viejo no había sale con `1`.

Un modelo con errores de validación sale con `1` y no escribe nada, salvo con
`--allow-unsimulatable`: entonces se guarda como diagrama que no se simula, con sus errores
impresos como notas. Un archivo que no es BPMN se rechaza siempre. Un modelo cuyo proceso
simulado no tiene diagrama se maqueta salvo con `--no-layout`; uno que no se puede maquetar
(bpmn-moddle no lo lee entero, solo está dibujado en parte o el maquetador falla) se guarda tal
como llegó, con una nota que dice por qué. La escritura es la escritura atómica y con candado del `.lila`
(ver [Un `.lila` como entrada](#un-lila-como-entrada-466)), con los demás procesos intactos;
`--dry-run` no escribe nada; `--json` imprime el objeto de resultado de `put_process_bpmn`:
`{ file, mode, slug, name, processId, revision, dryRun, laidOut, summary, scenarioRemovals, notes,
warnings, slugs }`.

Los dos toman el proyecto como `-p/--project <proyecto.lila>` o como posicional `<proyecto.lila>`,
y lo mismo `process raci` y `process attribute` (#645): sirve cualquiera de las dos convenciones;
dar las dos se rechaza.

```bash
npx lila process export-bpmn -p examples/pedido.lila --out results/pedido.bpmn
```
Código de salida: `0`.

```bash
npx lila process import -p examples/pedido.lila --bpmn examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn --dry-run
```
Código de salida: `0`.

A.3.0 tiene eventos de borde que el simulador no admite, así que se rechaza salvo con
`--allow-unsimulatable`:

```bash
npx lila process import -p examples/pedido.lila --bpmn examples/bizagi-exports/bizagi-miwg-A.3.0-roundtrip.bpmn --dry-run
```
Código de salida: `1`.

## `process rename|delete` y `scenario rename|delete` (#634)

Ordenar un `.lila` — las tools MCP `rename_process`, `delete_process`, `rename_scenario` y
`delete_scenario` ([`docs/es/MCP.md`](MCP.md#renombrar-y-borrar)), con las mismas reglas:

- `lila process rename <proyecto.lila> <slug> --name <nombre>` renombra un proceso; su slug no
  cambia. Un proyecto con un solo proceso (que se llama como el proyecto) sale con `1`.
- `lila process delete <proyecto.lila> <slug>` borra un proceso con sus escenarios y sus corridas
  guardadas. El último proceso, o uno que una actividad de llamada de otro proceso nombra en su
  `calledElement`, sale con `1` (el rechazo lista esas actividades). Si queda un solo proceso, el
  proyecto se escribe como un archivo de versión 1.
- `lila scenario rename <proyecto.lila> <escenario> --name <nombre>` renombra un escenario; su
  archivo no cambia, y sube su revisión y la de los escenarios que heredan de él. Un nombre por el
  que ya se encuentra otro escenario del proceso sale con `1`.
- `lila scenario delete <proyecto.lila> <escenario>` borra un escenario con sus corridas guardadas.
  El último escenario del proceso, o uno del que heredan otros, sale con `1`.

`<escenario>` es un escenario del proceso (su nombre de archivo, con o sin `.scenario.json`, o su
`"name"`); `--process slug` elige el proceso de un `.lila` con varios. Un rechazo no escribe nada.
La escritura es la escritura atómica y con candado del `.lila` (ver
[Un `.lila` como entrada](#un-lila-como-entrada-466)), con los demás procesos intactos; `--dry-run`
no escribe nada; `--json` imprime el objeto de resultado de la tool MCP, y sin él la CLI imprime su
`summary` y sus `notes`.

```bash
npx lila --lang es scenario rename examples/pedido.lila to-be-3-cajeros --name TO-BE --dry-run
```
Código de salida: `0`.

```text
Simulacro: se renombraría el escenario to-be-3-cajeros.scenario.json del proceso pedido a "TO-BE" en /…/examples/pedido.lila. No se escribió nada.
```

El AS-IS no se puede borrar mientras el TO-BE herede de él:

```bash
npx lila --lang es scenario delete examples/pedido.lila as-is --dry-run
```
Código de salida: `1`.

```bash
npx lila --lang es scenario delete examples/pedido.lila to-be-3-cajeros --dry-run --json
```
Código de salida: `0`.

pedido es un proyecto de un solo proceso, así que su proceso no se puede renombrar ni borrar:

```bash
npx lila --lang es process delete examples/pedido.lila pedido --dry-run
```
Código de salida: `1`.

## `catalog` (#673)

Los roles, unidades, sistemas y documentos del catálogo de un repositorio, desde la terminal — las
tools MCP de catálogo ([`docs/es/MCP.md`](MCP.md#el-catálogo)), sobre las mismas funciones del motor
y con las mismas reglas. Todos los subcomandos reciben el `.lila` como primer argumento posicional:

- `lila catalog list <proyecto.lila>` lista los objetos, por tipo y luego por id (`--type t` para un
  solo tipo), con la versión de formato del archivo. `--json` imprime lo de `list_catalog`,
  `{ file, formatVersion, objects }`.
- `lila catalog show <proyecto.lila> <id>` imprime un objeto entero, con su revisión (pásala como
  `--base-revision` a `update`). `--json` imprime lo de `get_catalog_object`, `{ file, object }`.
- `lila catalog create <proyecto.lila> --type role|unit|system|document --name <nombre>` crea un
  objeto con un id generado (`<tipo>-` y 12 caracteres) y revisión 1. `--description texto`,
  `--attribute nombre=valor` (repetible, en orden), `--unit-ref id` (un rol), `--parent-ref id` (una
  unidad), `--owner-ref id` y `--url url` (un sistema o un documento) fijan sus campos.
- `lila catalog update <proyecto.lila> <id> --base-revision n` lo renombra (`--name`) o cambia los
  campos que se den, con las opciones de `create`. Una opción que no se da deja su campo como está;
  `""` quita un campo opcional (el `null` del MCP; en `create`, `""` se guarda tal cual, como lo
  guarda el MCP); `--attribute` reemplaza la lista entera y `--clear-attributes` la quita. Una revisión distinta de la del objeto sale con `1` y
  `E-REVISION`: vuelve a leerlo.
- `lila catalog delete <proyecto.lila> <id>` borra un objeto que nada usa. Uno en uso sale con `1`,
  `E-OBJETO-EN-USO` y la lista de sus usos, salvo con `--replace-with <id>` (otro objeto del mismo
  tipo se queda con cada referencia) o `--remove-references`. `--base-revision n` se comprueba si se
  da.
- `lila catalog usages <proyecto.lila> [<id>]` es «dónde se usa» (`find_usages`): los usos de ese
  objeto, cada uno `slug elemento relación` u `objeto campo`, o, si ningún objeto tiene ese id, las
  referencias a él que no se resuelven. Sin `<id>`: los usos de cada objeto, cada referencia sin
  resolver y los ids de proceso BPMN que declara más de un proceso.
- `lila catalog adopt <proyecto.lila> <ref> --type t` convierte una referencia escrita a mano
  (`roleRef="cajero"`, `systemRef="POS"`) en un objeto (`adopt_reference`): un valor que es un id
  válido pasa a ser el id del objeto; cualquier otro recibe uno generado, y cada referencia a él se
  reescribe. `--name` vale por defecto el propio valor.

`--type` también elige el objeto cuando objetos de varios tipos comparten un id. Una escritura
guarda el `.lila` de forma atómica y con su candado (ver
[Un `.lila` como entrada](#un-lila-como-entrada-466)); un modelo reescrito recibe una revisión
nueva, así que sus corridas guardadas quedan obsoletas. `--dry-run` lo comprueba todo y no escribe
nada; una actualización que no cambia nada no escribe nada. Una escritura imprime lo que hizo, el
objeto (no en un borrado), los demás objetos cuyo `unitRef`/`parentRef`/`ownerRef` cambió y una
línea por cada modelo que reescribió; `--json` imprime el resultado de la tool,
`{ file, dryRun, changed, written, object, created, updated, deleted, processes, wouldUpgrade, note? }`.
`--locale en|es` es el `locale` de las tools, lo mismo que el `--lang` global.

**Versión 3.** El primer objeto que se crea o se adopta en un archivo de versión 1 o 2 lo guarda
como repositorio versión 3. La salida, también la de un simulacro, termina con un aviso: Lila
1.0.0-beta.15 a beta.28 y las versiones anteriores no pueden abrir el archivo actualizado. `--json`
dice `wouldUpgrade: true` y lleva esa `note`.

```bash
npx lila catalog list examples/pedido.lila --json
```
Código de salida: `0`.

```bash
npx lila --lang es catalog create examples/pedido.lila --type role --name Cajero --dry-run
```
Código de salida: `0`.

```text
Simulacro: se crearía role/role-1do2zmmcwzfi en /…/examples/pedido.lila. No se escribió nada.
role/role-1do2zmmcwzfi  "Cajero"  revisión 1
aviso Este cambio guarda el archivo como repositorio versión 3 (añade un catálogo). Lila 1.0.0-beta.15 a 1.0.0-beta.28 y las versiones anteriores no pueden abrirlo; la actualización no se puede deshacer.
```

```bash
npx lila catalog adopt examples/pedido.lila cajero --type role --dry-run --json
```
Código de salida: `0`.

```bash
npx lila --lang es catalog usages examples/pedido.lila
```
Código de salida: `0`.

pedido todavía no tiene catálogo, así que no hay nada que borrar:

```bash
npx lila --lang es catalog delete examples/pedido.lila cajero
```
Código de salida: `1`.

La recepcionista de [`docs/es/MCP.md`](MCP.md#el-catálogo), en un repositorio propio (`hotel.lila`,
tres procesos con una tarea `Task_1` cada uno): crear el rol, usarlo, renombrarlo y borrarlo en
favor de otro.

```text
npx lila catalog create hotel.lila --type role --name Recepcionista
npx lila process annotate hotel.lila Task_1 --process check-in --responsibility R:role-4k9w2m7q1z8c
npx lila catalog usages hotel.lila role-4k9w2m7q1z8c
npx lila catalog update hotel.lila role-4k9w2m7q1z8c --base-revision 1 --name "Agente de recepción"
npx lila catalog delete hotel.lila role-4k9w2m7q1z8c
npx lila catalog delete hotel.lila role-4k9w2m7q1z8c --replace-with role-p0x3n8d2r5ta
```

El primer borrado se rechaza mientras el rol está en uso:

```text
lila catalog delete: E-OBJETO-EN-USO: role/role-4k9w2m7q1z8c está en uso (1 uso: check-in Task_1 responsibility:R). No se escribió nada; bórralo con replaceWith (otro objeto del mismo tipo) o removeReferences.
Desde la CLI: --replace-with <id> (un objeto del mismo tipo) o --remove-references.
```

## `mcp`

Arranca el servidor MCP (`@lila-modeler/mcp`) por stdio, para que lo lance un cliente MCP, no algo que se
corre a mano en una terminal para leer su salida. Los detalles, el contrato de las tools y el
registro en clientes están en [`docs/es/MCP.md`](MCP.md); el comando de fondo es:

```text
node packages/engine/bin/lila.js mcp
```

`lila mcp` necesita `@lila-modeler/mcp` instalado junto al motor; la CLI sola se detiene con
`lila mcp: falta el paquete @lila-modeler/mcp`. Fuera de un clon, lo habitual es arrancar el
servidor con el comando del propio paquete, `npx -y @lila-modeler/mcp`.

## `process`

Crea un proceso a partir de un **esquema**, lee uno de vuelta (#97) y edita uno (#98). Un esquema es el proceso como
datos —carriles más una lista ordenada de pasos con ramas— y es el mismo JSON que recibe la tool
MCP `create_process`; su formato y sus reglas están en
[`docs/es/MCP.md`](MCP.md#crear-un-proceso-desde-un-esquema).

```text
lila process create --outline <archivo.json> -p <archivo.lila> [--name nombre] [--process slug] [--dry-run] [--json]
lila process show -p <archivo.lila> [--process slug] [--json]
lila process edit -p <archivo.lila> --ops <operaciones.json> [--process slug] [--dry-run] [--no-layout] [--json]
```

`process create` arma el BPMN, lo maqueta (pool, carriles, flujos), lo valida y lo agrega al `.lila`
como un `processes/<slug>/` nuevo con un escenario base `as-is.scenario.json`; si el `.lila` no
existe, lo crea. `--name` sustituye el nombre del esquema y `--process` elige el slug (si no, sale
del nombre). Nunca reemplaza un proceso: un slug que ya está en el archivo sale con `1` y no escribe
nada, igual que un esquema con problemas (se listan todos, cada uno con su ruta). `--dry-run` arma
y comprueba todo sin escribir. Imprime un resumen de una línea y los avisos del validador; `--json`
imprime en su lugar el objeto resultado de `create_process` y, si falla, `{ "error", "issues" }`
(cada problema con su `path` y su `message`) antes de salir con `1`. Con un `.lila` nuevo,
`--process` tiene que ser el slug que da el nombre.

```bash
npx lila process create --outline examples/outline/credit-application.json -p credit.lila --dry-run --lang es
```
Código de salida: `0`.

```text
Simulacro: se crearía el proceso "Credit application" (credit-application) en el archivo nuevo /…/credit.lila: 5 pasos, 2 carriles. No se escribió nada.
```

El slug `pedido` ya está en `examples/pedido.lila`, así que esto se rechaza:

```bash
npx lila process create --outline examples/outline/credit-application.json -p examples/pedido.lila --process pedido --dry-run
```
Código de salida: `1`.

`examples/outline/claim-escalation.json` es la escalación a las 48 horas de la
[guía para agentes](GUIA-AGENTES.md#ejemplo-escalar-a-las-48-horas): un temporizador de borde que
no interrumpe «Assess claim» y manda el siniestro a un supervisor a las 48 horas, un flujo por
defecto, variantes de tarea y una compuerta por eventos donde la confirmación del cliente compite
con un temporizador de cinco días que termina el caso con un evento de fin de terminación:

```bash
npx lila process create --outline examples/outline/claim-escalation.json -p claims.lila --dry-run --lang es
```
Código de salida: `0`.

```text
Simulacro: se crearía el proceso "Claim handling" (claim-handling) en el archivo nuevo /…/claims.lila: 10 pasos, 3 carriles. No se escribió nada.
```

Su escenario base corre una hora, como el de todo proceso creado: alarga `run.duration` (en la app
o con la tool MCP `patch_scenario`) antes de correrlo, o ningún caso llega al plazo de 48 horas.

`process show` imprime el esquema de un proceso, un paso por línea con su tipo, nombre, carril,
duración, recursos y a dónde va (`end`, `terminate`, o las ramas con su probabilidad y `default`);
los inicios van primero cuando el esquema los lista (`start` o `timer start`, y el paso al que
lleva cada uno), y cada temporizador de borde tiene una línea bajo su paso (`boundary <id>  timer`
o `timer (non-interrupting)`, su nombre, su demora y a dónde lleva), y también sus objetos de
datos (`data in` o `data out` y el nombre) y sus notas (`note` y el texto). `--json` imprime `{ slug, outline, warnings }`, con el esquema en
forma normal (la que devuelve `create_process`). Duraciones, recursos y probabilidades de rama
salen del `as-is.scenario.json` del proceso. Lo que un esquema no puede llevar se avisa por stderr.

```bash
npx lila process show -p examples/pedido.lila --lang es
```
Código de salida: `0`.

`process edit` aplica una lista de operaciones a un proceso, todas o ninguna: el arreglo JSON que la
tool MCP `edit_process` recibe como `operations` (`add`, `connect`, `remove`, `rename`, `setType`,
`moveToLane`, `addLane`, `removeLane`, `moveLane`, `addBoundary`, `annotate`, `addDataObject`, `setCalledProcess`…; formato y reglas en
[`docs/es/MCP.md`](MCP.md#editar-un-proceso)). Se
comprueba cada operación, se valida el resultado y el `.lila` se escribe solo si todo está bien; si
no, sale con `1`, no escribe nada y lista cada problema con el índice de su operación. El proceso se
maqueta de nuevo salvo con `--no-layout`, que conserva todas las posiciones y solo coloca las figuras
nuevas. Imprime un resumen, una línea por operación, notas (cada entrada de escenario que se quitó
porque ya no aplica, con sus valores anteriores, para que el proceso siga simulando; probabilidades de
rama que ya no suman 1) y los avisos del validador;
`--json` imprime el objeto resultado de `edit_process`. `--dry-run` no escribe nada.

`examples/outline/pedido-edit.json` agrega un paso "Charge" con duración y el cajero, renombra y
cambia el tipo de dos pasos, agrega dos carriles y pasa la cocina al carril de cocina:

```bash
npx lila process edit -p examples/pedido.lila --ops examples/outline/pedido-edit.json --dry-run --lang es
```
Código de salida: `0`.

```text
Simulacro: se editaría el proceso "pedido" (pedido) en /…/examples/pedido.lila: 6 operaciones, 0 elementos quitados. No se escribió nada.
  0: agregado task "Task_Cobrar" después de "Task_TomarPedido"
  1: renombrado "Task_Preparar": "Prepare food" → "Cook"
  …
```

Quitar el split paralelo es ambiguo (un flujo de entrada, dos de salida), así que se rechaza toda la
edición, el renombre incluido:

```bash
npx lila process edit -p examples/pedido.lila --ops examples/outline/pedido-edit-ambiguous.json --dry-run --lang es
```
Código de salida: `1`.

## Opciones generales

Aplican a cualquier subcomando, en cualquier posición de la línea de comandos:

- `--lang en|es` — idioma de la salida (los mensajes, no los nombres de columna ni los ids BPMN,
  que son un contrato estable). Por defecto: `LILA_LANG`, luego `LANG`, inglés si ninguna existe.
- `-h`, `--help` — uso de `lila` o de `lila <comando> --help`.
- `-v`, `--version`, o el subcomando `version` — imprime la versión instalada de `@lila-modeler/engine` y
  sale con `0`.

```bash
npx lila --version
```
Código de salida: `0`.

## Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | El comando corrió; `validate` puede haber impreso avisos igual. |
| `1` | Error de uso, comando desconocido, un error de validación del modelo o del escenario, un esquema con problemas o un proceso que ya existe (`process create`), una edición rechazada (`process edit`), un escenario cuyo `model` no coincide con el archivo dado, un `.lila` que no se puede abrir o cuyo proceso o escenario no se encuentra, una exportación sin corrida o sobre un archivo existente, un rechazo del catálogo (`E-OBJETO-EN-USO`, `E-REVISION`, un id desconocido o campos inválidos), o un error no capturado del comando (mensaje por stderr). |

## Para agentes

Un cambio de modelo solo es seguro de entregar después de este ciclo, todo sobre la salida
`--json` para que un script decida sin parsear prosa:

1. **Validar primero.** `lila validate model.bpmn --json`; revisar el código de salida y luego
   `errors` (`code`, `id`, `message`). Detenerse aquí si no es `0`: nada de lo que sigue es
   confiable.
2. **Correr con una semilla fija y réplicas suficientes** para un intervalo de confianza angosto:
   `lila run model.bpmn escenario.json --seed 1 --replications 30 --json results/run.json`.
3. **Leer `results/run.json`** con cualquier herramienta JSON. Su forma sigue
   `docs/RESULTS_FORMAT.md` y valida contra `runResultSchema` (`@lila-modeler/engine/result-schema`); los
   nombres de columna son el contrato de paridad de `docs/BIZAGI_PARITY.md`, no se traducen.
4. **Para evaluar un cambio**, escribir un segundo escenario que extienda (`extends`) al primero
   con solo las claves que cambian (`docs/SCENARIO_FORMAT.md`), y luego `lila compare
   model.bpmn base.json cambiado.json --seed 1 --replications 30 --json
   results/compare.json`. Leer `deltaRel` y `significant` de cada fila; una métrica puede moverse
   sin que `significant` sea verdadero con pocas réplicas.

Las tablas de texto en stdout llevan los mismos números; existen para una persona en una
terminal, no para parsearlas.

## Un `.lila` como entrada (#466)

Un archivo `.lila` es un **zip** de una carpeta de proyecto Lila (`docs/PROJECT_FORMAT.md`).
`validate`, `run` y `compare` lo aceptan donde aceptan un `.bpmn`; no hay que descomprimir nada
antes. El [`examples/pedido.lila`](../../examples/pedido.lila) del repositorio es la carpeta
`examples/pedido` en un solo archivo:

```bash
npx lila validate examples/pedido.lila
```
Código de salida: `0`.

Con un modelo `.lila`, un **argumento de escenario** se resuelve en este orden:

1. **Un archivo que existe** en esa ruta (relativa al directorio actual) es ese archivo, igual que
   con un `.bpmn`. Se simula contra el proceso del archivo `.lila`; su propio campo `model` no se
   compara con el archivo, y `validateScenario` sigue rechazando un id de elemento que el proceso
   no tenga.
2. **Si no, nombra un escenario del proceso**: por su nombre de entrada
   (`to-be-3-cajeros.scenario.json`), ese mismo nombre sin `.scenario.json` (`to-be-3-cajeros`) o
   el `"name"` del escenario (`"TO-BE 3 cashiers"`, que entonces tiene que ser único en el
   proceso). Su `model` y su `extends` se resuelven dentro del archivo, exactamente como en la
   carpeta del proyecto. Un nombre que no coincide con nada lista los escenarios que sí existen.

```bash
npx lila run examples/pedido.lila as-is --seed 42 --replications 3 --json results/run.json
```
Código de salida: `0`.

```bash
npx lila compare examples/pedido.lila as-is to-be-3-cajeros --seed 42 --replications 3
```
Código de salida: `0`.

Los dos imprimen, y escriben, exactamente lo mismo que esos comandos sobre
`examples/pedido/model.bpmn` y sus archivos de escenario. Las rutas de salida (`--json`, `--csv`,
`--xlsx`) no cambian: relativas al directorio actual, nunca dentro del archivo — la CLI no escribe
en un `.lila`.

**Varios procesos.** Un proyecto de versión 2 (un *repositorio*, `docs/PROJECT_FORMAT.md`) tiene
más de un proceso, cada uno con su modelo y sus escenarios. `--process <slug>` elige uno; con un
solo proceso es implícito, y con varios y sin `--process` el comando se detiene con un error que
lista los slugs. Un slug que no está en el proyecto también es un error, igual que `--process` con
un `.bpmn`:

```bash
npx lila validate examples/pedido.lila --process facturacion
```
Código de salida: `1`.

```text
lila run proyecto.lila as-is --process pedido --seed 1 --replications 30 --json results/run.json
```

Las tools MCP aceptan un `.lila` de la misma forma, y `patch_scenario` puede escribir un escenario
dentro de uno (`docs/MCP.md`).
