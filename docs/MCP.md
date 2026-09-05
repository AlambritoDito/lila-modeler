# MCP (LILA-053)

`packages/mcp` (`@lila/mcp`) es un servidor [MCP](https://modelcontextprotocol.io) por stdio sobre
`@lila/engine`, sin lógica propia: dos tools por ahora.

- **`validate_bpmn({ path?, xml? })`** — parsea y valida un `.bpmn` (por ruta relativa al cwd del
  proceso, o XML inline) y devuelve exactamente el mismo JSON que `lila validate --json` (el IR,
  `ignoredProcessIds`, `errors` y `warnings`). Nunca lanza por un modelo inválido: `isError` es
  `true` cuando `errors` no está vacío, con el JSON de errores igual en el contenido.
- **`describe_process({ path, scenario? })`** — parsea un `.bpmn` y devuelve su IR (`ProcessIR`)
  junto con un resumen legible en español: conteo de nodos por tipo, gateways con sus salidas,
  lanes y subprocesos embebidos aplanados. Con `scenario` (ruta a un escenario `.json`, resuelve
  `extends`) agrega los recursos referenciados por elemento; si el escenario no se puede leer, el
  resumen lo dice pero la tool no falla.

`run_simulation`, `compare_scenarios` y `patch_scenario` llegan en LILA-054/055. El subcomando
`lila mcp` llega en LILA-056 — mientras tanto se usa el bin `lila-mcp` de este paquete.

## Paquete del SDK

`@modelcontextprotocol/server` 2.0.0 (no `@modelcontextprotocol/sdk`, que es un paquete distinto
del mismo repo/mantenedores, más orientado a cliente+servidor combinados en 1.x). El BACKLOG pedía
"`@modelcontextprotocol/server` 2.x"; se verificó con `npm view` que existe exactamente en esa
versión, mantenido por el mismo equipo de Anthropic/MCP. Los tests usan además
`@modelcontextprotocol/client` 2.0.0 (mismo repo) como devDependency.

## Probarlo a mano

Desde la raíz del repo, tras `npm run build`:

```bash
# Inspector oficial (abre una UI web)
npx @modelcontextprotocol/inspector node packages/mcp/dist/bin.js

# o registrarlo en Claude Code
claude mcp add lila -- node /ruta/al/repo/packages/mcp/dist/bin.js
```

Las rutas de `path`/`scenario` que le pases a las tools son relativas al cwd desde el que arrancó
el proceso del servidor, no al repo.
