# MCP (LILA-053/054/055/056)

`packages/mcp` (`@lila/mcp`) es un servidor [MCP](https://modelcontextprotocol.io) por stdio sobre
`@lila/engine`, sin lógica propia: cinco tools por ahora.

- **`validate_bpmn({ path | xml })`** — parsea y valida un `.bpmn` y devuelve exactamente el mismo
  JSON que `lila validate --json` (el IR, `ignoredProcessIds`, `errors` y `warnings`). Se pasa
  `path` **o** `xml`, nunca los dos: pasar ambos es un error de la tool, no una precedencia
  silenciosa.
- **`describe_process({ path | xml, scenario? })`** — parsea un `.bpmn` (por ruta o XML inline,
  uno de los dos, con la misma regla que `validate_bpmn`) y devuelve su IR (`ProcessIR`)
  junto con un resumen legible en español: conteo de nodos por tipo, gateways con sus salidas,
  lanes, subprocesos embebidos aplanados, los otros `bpmn:process` del archivo que no se simulan, y
  una línea de validación (`Validación: N errores, M avisos`) que avisa cuando el modelo está fuera
  del perfil y no se puede simular. Con `scenario` (ruta a un escenario `.json`, resuelve
  `extends`) agrega los recursos referenciados por elemento; si el escenario no se puede leer, el
  resumen dice por qué y la tool no falla.
- **`run_simulation({ model?, scenario, seed?, replications?, saveTo? })`** (LILA-054) — valida
  modelo y escenario, simula con `log: false` y devuelve exactamente el mismo `RunResult` que
  `lila run --json` (elementos, flujos, recursos, proceso, bottlenecks y avisos). `scenario` acepta
  una ruta `.json` (resuelve `extends`, igual que la CLI) o el escenario ya resuelto como objeto
  inline; `model` es opcional y por defecto es `scenario.model`. Ningún campo de nivel 2/3 se
  rechaza (LILA-184): `resources` y `calendars` los simula el motor desde LILA-033…036 y LILA-041.
  `saveTo` escribe el mismo JSON de forma atómica que `lila run --json <ruta>`. Trae
  `outputSchema` (`@lila/engine/result-schema`) y responde `structuredContent` además del texto.
- **`compare_scenarios({ model?, scenarios, seed?, replications?, saveTo? })`** (LILA-054) — valida
  y simula dos o más escenarios sobre el mismo modelo (el primero es la base) y devuelve
  exactamente el mismo `CompareResult` que `lila compare --json`, más `notes`: los avisos que la
  CLI imprime aparte de la tabla (semillas distintas, `baseTimeUnit` distinto, réplicas
  insuficientes para IC95). `scenarios` acepta rutas y objetos inline mezclados. Todo escenario se
  resuelve y valida contra el modelo antes de simular ninguno.
- **`patch_scenario({ scenario, patch, saveTo?, extendsFrom?, name?, description? })`**
  (LILA-055) — aplica un [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) a `scenario`, valida
  el resultado contra su modelo (mismas reglas que `validateScenario`, `docs/SCENARIO_FORMAT.md`
  § 5) y **solo si valida** lo escribe a disco de forma atómica; nunca dos veces. Devuelve
  `{ scenario, file, notes }`: el escenario resultante ya resuelto, la ruta absoluta escrita y los
  avisos de lint (`W-…`) como `notes`. Dos modos:
  - **Sin `saveTo`** (modo a) — parchea `scenario` en sitio: el patch se aplica sobre el escenario
    ya resuelto (con `extends` fusionado) y se sobrescribe el mismo archivo con el resultado
    completo, sin `extends` propio. Es un "aplanar y parchear": si `scenario` tenía su propio
    `extends`, el archivo escrito ya no lo tiene.
  - **Con `saveTo`** (modo b) — crea un archivo **nuevo** que declara `extends` hacia
    `extendsFrom` (por defecto, el propio `scenario`) y contiene **solo las claves que tocó el
    patch**, como `examples/pedido/to-be-3-cajeros.scenario.json`. La ruta de `extends` se escribe
    relativa al archivo nuevo (`docs/SCENARIO_FORMAT.md` § 6), sin importar en qué directorio esté
    `saveTo`. Un `remove` se escribe como `null`, que es como `extends` borra una clave heredada
    (§ 6). Si `saveTo` apunta al propio `scenario` (o a `extendsFrom`), el archivo heredaría de sí
    mismo: es un ciclo de `extends` y la tool falla sin escribir — para parchear en sitio, se omite
    `saveTo`.

  El patch soporta `add`/`replace`/`remove`/`test` (RFC 6902) con punteros RFC 6901
  (`/resources/cajero/capacity`); **no** soporta `move` ni `copy` — son las dos operaciones que
  leen de una ubicación distinta a la que escriben, y ningún caso de uso de esta tool las necesita
  (`packages/mcp/src/json-patch.ts`). Un patch que deja el escenario inválido — `probability` fuera
  de `[0, 1]`, `capacity < 1`, una `ref` que no existe en `resources`, un `id` que no existe en el
  modelo, … — es `isError: true` y **no escribe nada**, en ninguno de los dos modos.

Las tres tools de LILA-054/055 reutilizan `@lila/engine/cli-shared`, extraído de `cli.ts` en
LILA-054 sin cambiar su salida: `runCommand`/`compareCommand` y las tools corren exactamente el
mismo pipeline (`loadResolvedScenario`, `validateScenario`, `writeJsonAtomic`).

## Instalación

Hoy, desde un checkout del repo:

```bash
npm ci
npm run build
```

Eso deja listos los dos puntos de entrada, que arrancan **el mismo servidor**:

- `node packages/engine/bin/lila.js mcp` — el subcomando `lila mcp` (LILA-056), el que se registra.
- `./node_modules/.bin/lila-mcp` — el bin del propio `@lila/mcp`, equivalente.

`lila mcp` vive en `@lila/engine` porque el ticket lo pide ahí y porque es el binario que la gente
ya tiene instalado. Como `@lila/mcp` depende de `@lila/engine`, importarlo estáticamente desde
`cli.ts` sería un ciclo entre paquetes: se carga con `import()` dinámico
(`packages/engine/src/cli.ts`, `dispatchMcp`) y, si el paquete no está, el comando lo dice por
stderr y sale con 1 en vez de romperse. Cuando LILA-048 publique los paquetes, el registro pasará a
ser `npx @lila/engine mcp` sin nada más.

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
      "command": "node",
      "args": ["/ruta/al/repo/packages/engine/bin/lila.js", "mcp"],
      "cwd": "/ruta/al/repo"
    }
  }
}
```

Aquí las rutas **tienen que ser absolutas** (Desktop lanza el proceso desde `/`, y `node` puede no
estar en su PATH: si no arranca, pon la ruta completa del binario de Node en `command`). `cwd` es
lo que decide contra qué directorio se resuelven las rutas relativas de las tools; sin él, pasa
rutas absolutas en cada llamada.

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
devolver.

## `saveTo`

`saveTo` escribe en el sistema de archivos del **proceso servidor**, con sus permisos, la ruta que
se le pase (relativa al cwd, como todo lo demás). Sobrescribe un archivo existente sin preguntar,
igual que `lila run --json <ruta>`, y publica con `rename` desde un temporal en el mismo
directorio: nadie llega a leer un JSON a medias. Un directorio con ese nombre es un error de la
tool, no un borrado. `compare_scenarios` guarda ahí solo `comparison`, sin `notes`: los mismos
bytes que `lila compare --json <ruta>`. En `patch_scenario`, `saveTo` cambia el modo de la tool
(§ arriba): sin `saveTo` se sobrescribe `scenario`; con `saveTo` se crea un archivo nuevo con
`extends` y solo el delta del patch.

## Rutas

`path` y `scenario` se resuelven contra el **cwd del proceso servidor**, no contra el del cliente
ni la raíz del repo. En Claude Code eso es el directorio desde el que se lanzó el servidor; en la
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
