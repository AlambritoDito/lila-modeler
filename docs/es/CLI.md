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
  `--xlsx` no lo llevan.
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
Comparación. `compare` no tiene `--csv`: compara corridas ya terminadas, no reproduce una.

## `export` (#538)

Produce los entregables sin la app —sin ventana ni navegador— con el mismo código del motor que
usa la app:

- `lila export diagram <modelo.bpmn|proyecto.lila>` dibuja el diagrama con el renderizador SVG
  propio del motor (la geometría del DI de BPMN, colores de Lila Light sobre blanco). Sin `--out`
  imprime el SVG por stdout.
- `lila export doc <proyecto.lila> --out archivo.docx|archivo.html` escribe el documento del
  proceso, como «Exportar documento» de la app: diagrama, descripciones en orden de flujo, el
  escenario y los resultados de una corrida guardada. El HTML incrusta el diagrama SVG. El Word va
  **sin diagrama** y ninguno de los dos lleva las gráficas de la corrida: Word necesita un PNG y el
  motor no rasteriza. Una nota por stderr dice qué quedó fuera.
- `lila export results <proyecto.lila> --out libro.xlsx|directorio` escribe los resultados de una
  corrida guardada: un `.xlsx` (Resumen, Elementos, Flujos, Recursos, Parámetros) o, con
  `--format csv`, `elements.csv`, `flows.csv`, `resources.csv` y `process.csv` en el directorio,
  los mismos archivos que escribe `lila run` (una corrida guardada no conserva el log de eventos,
  así que no hay `log.csv`).

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

## `mcp`

Arranca el servidor MCP (`@lila-modeler/mcp`) por stdio, para que lo lance un cliente MCP, no algo que se
corre a mano en una terminal para leer su salida. Los detalles, el contrato de las tools y el
registro en clientes están en [`docs/es/MCP.md`](MCP.md); el comando de fondo es:

```text
node packages/engine/bin/lila.js mcp
```

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

`process show` imprime el esquema de un proceso, un paso por línea con su tipo, nombre, carril,
duración, recursos y a dónde va; `--json` imprime `{ slug, outline, warnings }`, con el esquema en
forma normal (la que devuelve `create_process`). Duraciones, recursos y probabilidades de rama
salen del `as-is.scenario.json` del proceso. Lo que un esquema no puede llevar se avisa por stderr.

```bash
npx lila process show -p examples/pedido.lila --lang es
```
Código de salida: `0`.

`process edit` aplica una lista de operaciones a un proceso, todas o ninguna: el arreglo JSON que la
tool MCP `edit_process` recibe como `operations` (`add`, `connect`, `remove`, `rename`, `setType`,
`moveToLane`, `addLane`; formato y reglas en [`docs/es/MCP.md`](MCP.md#editar-un-proceso)). Se
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
| `1` | Error de uso, comando desconocido, un error de validación del modelo o del escenario, un esquema con problemas o un proceso que ya existe (`process create`), una edición rechazada (`process edit`), un escenario cuyo `model` no coincide con el archivo dado, un `.lila` que no se puede abrir o cuyo proceso o escenario no se encuentra, una exportación sin corrida o sobre un archivo existente, o un error no capturado del comando (mensaje por stderr). |

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
