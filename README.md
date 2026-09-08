# Lila Modeler

Simulador de eventos discretos (DES) para procesos BPMN, open source (Apache-2.0), con paridad de
funciones con Bizagi Modeler y su simulador de niveles 1–4. El proyecto es un monorepo npm:

- **Motor + CLI** (`packages/engine`, paquete `@lila/engine`) — parsea `.bpmn`, valida el modelo y
  simula un escenario. Sin dependencias en su núcleo (`packages/engine/src/core/`): corre igual en
  Node, en un Web Worker del navegador o detrás de un servidor MCP.
- **Servidor MCP** (`packages/mcp`, y el subcomando `lila mcp` del propio CLI) — expone el motor a
  agentes vía [MCP](https://modelcontextprotocol.io).
- **App web** (`apps/web`, React + [bpmn-js](https://github.com/bpmn-io/bpmn-js)) — modelar,
  simular, ver resultados y comparar escenarios desde el navegador.
- **Beta de escritorio** (`apps/desktop`, Electron, solo macOS arm64) — la misma app web
  empaquetada, con guardado en carpeta de proyecto.

Los contratos —el IR del proceso, el formato de escenario y el de resultados— están documentados
en `docs/` antes que el código, y son la parte del proyecto que se mantiene estable.

## Requisitos

- Node.js **22 o superior** (`engines.node` en `package.json`).

## Instalar desde el repo

```bash
git clone git@github.com:AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npm run build` compila `packages/engine` y `packages/mcp` (`tsc --build`); es lo que necesitan la
CLI y el servidor MCP. La app web se compila aparte (ver más abajo).

## Simular el benchmark en 3 comandos

`examples/pedido` es el benchmark de referencia del repo: un proceso de restaurante con paralelo
(preparar/empacar), una aprobación y un timer, con dos escenarios ya escritos
(`as-is.scenario.json` y `to-be-3-cajeros.scenario.json`, este último con un cajero más).

Los comandos usan `npx lila`: tras `npm ci`, `npx` resuelve el binario del propio workspace
(`node_modules/.bin/lila`, ver `package.json` de `@lila/engine`) sin red ni instalación global —
no hay paquete `lila` publicado en el registro de npm (ver «Límites conocidos»). Equivalente y
sin depender de `npx`: `node packages/engine/bin/lila.js <comando>`.

**1. Validar el modelo:**

```bash
npx lila validate examples/pedido/model.bpmn
```

```
Proceso Process_Restaurante (Restaurante)
Nodos (11): and 2, end 2, start 1, task 4, timer 1, xor 1
  start     StartEvent_Pedido  Pedido recibido
  ...
aviso  W-MSGFLOW  Process_Restaurante: se ignoraron 2 flujos de mensaje (bpmn:messageFlow).
0 errores, 1 avisos.
```

**2. Simular el escenario AS-IS** (tablas de resultados estilo Bizagi + JSON + CSV):

```bash
npx lila run \
  examples/pedido/model.bpmn examples/pedido/as-is.scenario.json \
  --seed 42 --replications 3 \
  --json out/result.json --csv out/csv
```

```
Escenario AS-IS
Proceso Process_Restaurante (Restaurante)
Semilla 42 · Replicaciones 3 · Unidad de tiempo min · Moneda MXN

Process elements
Id                  Name                Type   Instances started  Instances completed  ...
StartEvent_Pedido   Pedido recibido     start  2975               2975                 ...
...

Cuellos de botella
Id                Name               Total time (waiting for resource) (min)  Utilization (%)
Task_Preparar     Preparar alimento  4514389.476272                           34.297909
Task_TomarPedido  Tomar pedido       698.32272                                41.234838

Avisos:
  W-MSGFLOW: Process_Restaurante: se ignoraron 2 flujos de mensaje (bpmn:messageFlow).
  ...
JSON: out/result.json
CSV: out/csv
```

**3. Comparar AS-IS contra TO-BE** (un cajero más) lado a lado:

```bash
npx lila compare \
  examples/pedido/model.bpmn \
  examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json \
  --seed 42 --replications 3
```

```
Escenarios comparados
#  Nombre           Archivo                                        Semilla  Replicaciones
-  ---------------  ---------------------------------------------  -------  -------------
0  AS-IS (base)     examples/pedido/as-is.scenario.json            42       3
1  TO-BE 3 cajeros  examples/pedido/to-be-3-cajeros.scenario.json  42       3

Process elements
Id                Name              Metric                               AS-IS (base)  TO-BE 3 cajeros
Task_TomarPedido  Tomar pedido      Average time (waiting for resource)  0.234564      0.0344 (-85.334633%)*
...
```

`--json`/`--csv` funcionan igual en `run` y en `compare`; `--help` en cualquier subcomando lista
todas las opciones. El formato de escenario está en `docs/SCENARIO_FORMAT.md`, el de resultados en
`docs/RESULTS_FORMAT.md`, y el mapeo de nombres de columna contra Bizagi en
`docs/BIZAGI_PARITY.md`.

## App web

```bash
npm run dev -w @lila/web    # compila el motor si hace falta + arranca Vite en http://localhost:5173
```

Arranca con `examples/pedido/model.bpmn` cargado. La barra superior tiene cinco modos:

- **Modelar** — editor bpmn-js: crear, editar y exportar el `.bpmn`.
- **Simular** — panel de escenario (recursos, calendarios, parámetros por elemento) y botón
  Simular con progreso y cancelar.
- **Resultados** — las tablas estilo Bizagi más las extras de Lila (cuellos de botella, costo por
  caso), con exportación CSV por tabla.
- **Comparar** — dos o más escenarios ya simulados lado a lado, con marca de significancia (IC95).
- **Validar rutas** — animación de tokens de `bpmn-js-token-simulation` sobre el diagrama; no es
  la simulación DES del motor, no lee el escenario ni produce resultados.

Detalle de cada modo, textos literales de la interfaz y limitaciones actuales en
[`docs/GUIA-BETA-MAC.md`](docs/GUIA-BETA-MAC.md) (escrito para la beta de escritorio, pero describe
la misma app web).

## Beta de escritorio (macOS)

Hay una beta de `apps/desktop` (Electron, **solo macOS arm64, sin firmar ni notarizar**) que
empaqueta la app web como `.dmg` con guardado en carpeta de proyecto. No se distribuye dentro del
repositorio: hay que compilarla con `npm run dist:mac -w @lila/desktop`, lo que deja el instalador
en `apps/desktop/release/` (carpeta en `.gitignore`). Al no estar firmada, macOS bloquea el primer
intento de abrirla con doble clic; hay que abrirla con clic derecho → Abrir. Todavía no hay
Releases de GitHub con el `.dmg` listo para descargar, ni icono propio de la app (issue #76).

Guía completa —requisitos, recorrido de uso, cómo reconstruir el `.dmg`, limitaciones conocidas—
en [`docs/GUIA-BETA-MAC.md`](docs/GUIA-BETA-MAC.md).

## MCP en 3 líneas

`packages/engine` trae el subcomando `lila mcp`, que arranca un servidor MCP por stdio con cinco
tools sobre el mismo motor (`validate_bpmn`, `describe_process`, `run_simulation`,
`compare_scenarios`, `patch_scenario`). Para registrarlo en Claude Code:

```bash
claude mcp add lila -- node /ruta/al/repo/packages/engine/bin/lila.js mcp
```

El repo trae además un `.mcp.json` de proyecto, así que al abrir Claude Code aquí mismo el
servidor aparece solo. Detalle de cada tool, cómo probarlo a mano y límites conocidos (sin
cancelación, todo I/O es contra el disco del proceso servidor) en [`docs/MCP.md`](docs/MCP.md).

## Límites conocidos

- **Perfil BPMN soportado**: start/end (none y terminate), timer, tareas (todas las variantes),
  call activity, subproceso embebido, XOR/OR/AND, lanes y pools. Lo que queda fuera produce un
  error de validación explícito, no un fallo silencioso (`docs/SEMANTICS.md` §§1–3).
- **Sin publicación en npm todavía**: no hay `npx @lila/engine` ni paquete instalable fuera del
  repo; se usa clonando y compilando como arriba.
- **Sin demo online todavía**: la app web solo corre local (`npm run dev -w @lila/web`) o desde el
  `.dmg` de la beta de escritorio.
- La beta de escritorio solo compila para macOS arm64 (ver arriba); Windows y Linux están
  configurados en `electron-builder.yml` pero no se han compilado ni probado.

## Estructura del repo

- `packages/engine` — motor de simulación (`src/core/`, sin dependencias externas) + parser BPMN +
  CLI (`src/cli.ts`, binario `lila`).
- `packages/mcp` — servidor MCP (`@lila/mcp`, binario `lila-mcp`), capa fina sobre `@lila/engine`.
- `apps/web` — editor y viewer en React + bpmn-js.
- `apps/desktop` — empaquetado Electron de `apps/web`.
- `docs/` — contratos y guías (ver abajo); `examples/` — modelos y escenarios de ejemplo.

## Documentación

- [`docs/SEMANTICS.md`](docs/SEMANTICS.md) — perfil BPMN soportado y semántica exacta del motor.
- [`docs/SCENARIO_FORMAT.md`](docs/SCENARIO_FORMAT.md) — formato del escenario JSON.
- [`docs/RESULTS_FORMAT.md`](docs/RESULTS_FORMAT.md) — formato del resultado y de los CSV.
- [`docs/BIZAGI_PARITY.md`](docs/BIZAGI_PARITY.md) — checklist de paridad con Bizagi por nivel.
- [`docs/BPMN_EXTENSION.md`](docs/BPMN_EXTENSION.md) — namespace `lila:` y política de ids.
- [`docs/MCP.md`](docs/MCP.md) — servidor MCP, sus cinco tools y cómo registrarlo.
- [`docs/GUIA-BETA-MAC.md`](docs/GUIA-BETA-MAC.md) — beta de escritorio.
- [`docs/THEMES.md`](docs/THEMES.md) — formato de tema de la app web.
- `LILA_MODELER_ESTRUCTURA.md` — decisiones (ADR), diseño del motor, hitos.
- `BACKLOG.md` — desglose del trabajo; los tickets viven en GitHub Issues (`LILA-nnn` = `#nnn`).

## Licencia

Apache-2.0. Ver [`LICENSE`](LICENSE).

El editor de la app web usa [bpmn-js](https://github.com/bpmn-io/bpmn-js) (MIT + cláusula de marca
de agua): su licencia exige que la marca **"Powered by bpmn.io"** quede visible en el lienzo, y
Lila Modeler la respeta sin ocultarla. El modo "Validar rutas" usa
[bpmn-js-token-simulation](https://github.com/bpmn-io/bpmn-js-token-simulation) (MIT). La app web
es React (MIT) y la beta de escritorio empaqueta Electron. El inventario completo de dependencias
de tiempo de ejecución, con versión y licencia de cada una, está en
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Cómo contribuir

Antes de tocar el motor, lee `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md` y
`docs/RESULTS_FORMAT.md`. Reglas del repo (cabecera de `BACKLOG.md`):

1. `packages/engine/src/core/` no importa nada fuera de `core/` (ni `bpmn-moddle`, ni `node:*`, ni
   React).
2. Ningún ticket/PR cierra sin su prueba de aceptación en verde.
3. Los nombres de columna de resultados son los de Bizagi (`docs/BIZAGI_PARITY.md`).
4. Todo tiempo en segundos, dinero en `run.currency`.
5. El `id` BPMN es la única clave; el nombre nunca desambigua.

Antes de abrir un PR:

```bash
npm run typecheck
npm test
```
