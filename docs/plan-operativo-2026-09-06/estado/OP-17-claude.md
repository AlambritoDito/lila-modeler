# OP-17 — arranque (incremento 1, dueño E Claude Sonnet 5)

- Rama: `codex/op-e-paneles`. Worktree: `/Users/brito/development/lila-wt-e-paneles`.
- Merge `codex/claude-entrega-20260906` → fast-forward, sin conflicto.
- HEAD tras el merge: `287e3e2`.
- Incremento: 1 de OP-17 (guía de uso + licencias; la parte MCP #56/#48 no entra aquí).
- Issues de este incremento: #55, #75, #76, #77.

## Archivos previstos

- `docs/GUIA-BETA-MAC.md` (nuevo)
- `THIRD_PARTY_LICENSES.md` (nuevo, raíz)
- `README.md` — sección corta nueva «Beta de escritorio (macOS)», solo añadir
- `docs/plan-operativo-2026-09-06/estado/OP-17-claude.md` (este archivo)

## Verificado antes de escribir

- `apps/web/src/App.tsx`: textos reales de botones/modos confirmados (`Nuevo proyecto`,
  `Abrir proyecto`, `Guardar proyecto`, `Guardar como`, `Abrir .bpmn`, `Exportar .bpmn`,
  modos `Modelar`/`Simular`/`Resultados`/`Comparar`).
- `apps/web/src/main.tsx`: sigue eligiendo `BrowserStore` en duro (comentario propio: "Único
  punto de elección BrowserStore/DesktopStore (OP-01)") — confirma que la persistencia en
  carpeta real del bootstrap de A sigue pendiente en 287e3e2.
- `apps/desktop/release/`: DMG de OP-12 ya presente (`Lila Modeler-0.0.1-mac-arm64.dmg`,
  ~122 MiB, `ORIGEN.txt` con sha `f0ba8ed`). No se regenera en este incremento (no hay cambio
  de código); se reutiliza como artefacto de referencia de la guía.
- `npm run build -w @lila/engine`, `npm run build -w @lila/web`, `npm run build -w @lila/desktop`
  ejecutados en este worktree para confirmar la cadena de comandos de la guía: los tres OK.
- Dependencias runtime del bundle web confirmadas por lectura de `node_modules/*/package.json`
  (react, react-dom, bpmn-js y todo su árbol: diagram-js, bpmn-moddle, moddle, moddle-xml,
  min-dash, min-dom, didi, tiny-svg, path-intersection, object-refs, ids, inherits-browser,
  saxen, @bpmn-io/diagram-js-ui, clsx, htm, preact) y de `packages/engine` (zod, bpmn-moddle).
  `zod` confirmado dentro del bundle final con `grep -c zod apps/web/dist/assets/index-*.js` (5
  ocurrencias). Chromium/Node embebidos en Electron 44.2.0: confirmado vía DEPS de
  `electron/electron` en GitHub (Chromium 152.0.7977.76, Node v24.20.0).

## Próximo comando

Escribir `THIRD_PARTY_LICENSES.md`, luego `docs/GUIA-BETA-MAC.md`, luego la sección corta en
`README.md`. Commits separados por entregable, mensaje `docs: OP-17 …` con los issues
correspondientes.
