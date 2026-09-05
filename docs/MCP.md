# MCP (LILA-053)

`packages/mcp` (`@lila/mcp`) es un servidor [MCP](https://modelcontextprotocol.io) por stdio sobre
`@lila/engine`, sin lógica propia: dos tools por ahora.

- **`validate_bpmn({ path | xml })`** — parsea y valida un `.bpmn` y devuelve exactamente el mismo
  JSON que `lila validate --json` (el IR, `ignoredProcessIds`, `errors` y `warnings`). Se pasa
  `path` **o** `xml`, nunca los dos: pasar ambos es un error de la tool, no una precedencia
  silenciosa.
- **`describe_process({ path, scenario? })`** — parsea un `.bpmn` y devuelve su IR (`ProcessIR`)
  junto con un resumen legible en español: conteo de nodos por tipo, gateways con sus salidas,
  lanes, subprocesos embebidos aplanados, los otros `bpmn:process` del archivo que no se simulan, y
  una línea de validación (`Validación: N errores, M avisos`) que avisa cuando el modelo está fuera
  del perfil y no se puede simular. Con `scenario` (ruta a un escenario `.json`, resuelve
  `extends`) agrega los recursos referenciados por elemento; si el escenario no se puede leer, el
  resumen dice por qué y la tool no falla.

`run_simulation`, `compare_scenarios` y `patch_scenario` llegan en LILA-054/055. El subcomando
`lila mcp` llega en LILA-056 — mientras tanto se usa el bin `lila-mcp` de este paquete.

## Qué significa `isError`

`isError: true` marca que **falló la tool**: faltan argumentos o sobran (`path` y `xml` a la vez),
el archivo no existe o no se puede leer, el XML es impenetrable. Un modelo que la validación
rechaza **no** es un fallo de la tool: `validate_bpmn` responde `isError: false` con el reporte
completo y sus `errors[]` (mismo criterio que el catálogo de `docs/SEMANTICS.md` § 17), igual que
`describe_process`, que lo dice además en su resumen. Así un agente distingue "la herramienta se
rompió" (reintentar, corregir la llamada) de "el modelo tiene errores" (leer `errors[]` y arreglar
el `.bpmn`). Ojo: la CLI sí sale con código 1 en ese caso — el código de salida y `isError` no son
lo mismo.

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
await client.connect(new StdioClientTransport({ command: 'node', args: ['packages/mcp/dist/bin.js'] }));
console.log((await client.listTools()).tools.map((t) => t.name));
const r = await client.callTool({ name: 'validate_bpmn', arguments: { path: 'examples/pedido/model.bpmn' } });
console.log(r.isError, r.content[0].text.slice(0, 200));
await client.close();
"
```

O a pelo, una línea de JSON-RPC por stdin:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' | ./node_modules/.bin/lila-mcp
```

Para registrarlo en Claude Code:

```bash
claude mcp add lila -- node /ruta/al/repo/packages/mcp/dist/bin.js
```

El inspector oficial (`npx @modelcontextprotocol/inspector node packages/mcp/dist/bin.js`) también
sirve, pero **abre una UI en el navegador y se queda en primer plano**: no lo lances desde un
agente ni en CI.
