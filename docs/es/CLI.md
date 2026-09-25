# CLI (LILA-045/046/047/053, #450)

> Leer en: [English](../CLI.md)

`lila` es la interfaz de línea de comandos de `@lila/engine`: el mismo motor de validación y
simulación que usan la app web, la app de escritorio y el servidor MCP, manejado desde una
terminal. Esta página es la referencia que necesita un agente o un script: cada comando con un
ejemplo real, sus códigos de salida, qué escriben `--json`/`--csv`/`--xlsx` y cómo leer el
resultado.

Cada ejemplo de abajo corre desde la raíz del repositorio, sobre el benchmark
[`examples/pedido`](../../examples/pedido) ya versionado. Requiere Node.js **22 o superior**.

## Instalación

Todavía no se publica en npm (#48): hasta entonces, la CLI sale de un clon.

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npx lila` resuelve el binario del propio workspace (`packages/engine/bin/lila.js`), sin consultar
el registro.

`npx lila` solo encuentra esta CLI dentro del clon (después de `npm ci`). En cualquier otro lado
descarga el paquete `lila` ajeno de npm, así que desde otro directorio hay que llamar al binario
directo (`node <clon>/packages/engine/bin/lila.js …`) o usar `npx --no lila …`, que se niega a
instalar. Cuando se publique, usar `npx @lila/engine@beta …`:

```bash
npx @lila/engine@beta validate model.bpmn
```

## `validate`

Parsea un archivo `.bpmn`, imprime su IR (nodos, flujos, lanes) y la validación completa
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
  documento JSON. Su forma es `runResultSchema`, exportado desde `@lila/engine/result-schema`:
  validar contra él antes de confiar en un archivo parseado.
- `--csv <directorio>` escribe `elements.csv`, `flows.csv`, `resources.csv`, `process.csv` (RFC
  4180) y `log.csv` (el event log, escrito en streaming mientras corre la simulación, con
  timestamps ISO desde `run.start`). Es la única bandera que escribe el event log; `--json` y
  `--xlsx` no lo llevan.
- `--xlsx <archivo>` escribe un libro con las hojas Resumen, Elementos, Flujos, Recursos y
  Parámetros. Sin hoja de event log: para eso está `--csv`.
- Las tres crean los directorios que falten, escriben a una ruta temporal y renombran de forma
  atómica, y se niegan a sobrescribir una ruta que sea un directorio.

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

## `mcp`

Arranca el servidor MCP (`@lila/mcp`) por stdio, para que lo lance un cliente MCP, no algo que se
corre a mano en una terminal para leer su salida. Los detalles, el contrato de las tools y el
registro en clientes están en [`docs/es/MCP.md`](MCP.md); el comando de fondo es:

```text
node packages/engine/bin/lila.js mcp
```

## Opciones generales

Aplican a cualquier subcomando, en cualquier posición de la línea de comandos:

- `--lang en|es` — idioma de la salida (los mensajes, no los nombres de columna ni los ids BPMN,
  que son un contrato estable). Por defecto: `LILA_LANG`, luego `LANG`, inglés si ninguna existe.
- `-h`, `--help` — uso de `lila` o de `lila <comando> --help`.
- `-v`, `--version`, o el subcomando `version` — imprime la versión instalada de `@lila/engine` y
  sale con `0`.

```bash
npx lila --version
```
Código de salida: `0`.

## Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | El comando corrió; `validate` puede haber impreso avisos igual. |
| `1` | Error de uso, comando desconocido, un error de validación del modelo o del escenario, un escenario cuyo `model` no coincide con el archivo dado, o un error no capturado del comando (mensaje por stderr). |

## Para agentes

Un cambio de modelo solo es seguro de entregar después de este ciclo, todo sobre la salida
`--json` para que un script decida sin parsear prosa:

1. **Validar primero.** `lila validate model.bpmn --json`; revisar el código de salida y luego
   `errors` (`code`, `id`, `message`). Detenerse aquí si no es `0`: nada de lo que sigue es
   confiable.
2. **Correr con una semilla fija y réplicas suficientes** para un intervalo de confianza angosto:
   `lila run model.bpmn escenario.json --seed 1 --replications 30 --json results/run.json`.
3. **Leer `results/run.json`** con cualquier herramienta JSON. Su forma sigue
   `docs/RESULTS_FORMAT.md` y valida contra `runResultSchema` (`@lila/engine/result-schema`); los
   nombres de columna son el contrato de paridad de `docs/BIZAGI_PARITY.md`, no se traducen.
4. **Para evaluar un cambio**, escribir un segundo escenario que extienda (`extends`) al primero
   con solo las claves que cambian (`docs/SCENARIO_FORMAT.md`), y luego `lila compare
   model.bpmn base.json cambiado.json --seed 1 --replications 30 --json
   results/compare.json`. Leer `deltaRel` y `significant` de cada fila; una métrica puede moverse
   sin que `significant` sea verdadero con pocas réplicas.

Las tablas de texto en stdout llevan los mismos números; existen para una persona en una
terminal, no para parsearlas.

## `.lila` no es una entrada de la CLI

Con honestidad: un archivo `.lila` es un **zip** de una carpeta de proyecto Lila
(`docs/PROJECT_FORMAT.md`) — `lila-project.json`, `model.bpmn`, un `<nombre>.scenario.json` por
escenario, `runs/*.result.json`. La CLI de esta versión toma rutas `.bpmn` y `.json` directas; no
abre un `.lila`. Hasta que eso exista, hay que descomprimirlo primero:

```bash
unzip proyecto.lila -d proyecto
node <clon>/packages/engine/bin/lila.js validate proyecto/model.bpmn
node <clon>/packages/engine/bin/lila.js run proyecto/model.bpmn proyecto/as-is.scenario.json
```

Seguimiento en [#466](https://github.com/AlambritoDito/lila-modeler/issues/466) («`.lila` como
entrada de la CLI»).
