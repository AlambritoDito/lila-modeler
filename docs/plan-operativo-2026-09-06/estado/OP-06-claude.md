# OP-06 — Claude F
Estado: en curso (incremento 1 listo: CI + diagnóstico #225).
Dueño: Claude F (coordinador, Fable 5.1). Rama: codex/claude-entrega-20260906. Worktree: /Users/brito/development/lila-wt-claude.
Base: 71e653e. HEAD: ver `git log` de la rama.

## Hecho
- `ci: OP-06 construir la app web con Vite en CI (#2)` — `.github/workflows/ci.yml` añade `npm run build -w @lila/web` tras typecheck. Decisión: un paso más en el job existente, sin job aparte / razón: el fallo debe bloquear igual que tests y tipos / prueba: el build pasa localmente sobre 71e653e.
- #225 reproducido en arranque limpio con `vite --port 5178` desde `apps/web`:
  - `GET /@fs/<raíz>/node_modules/bpmn-js/dist/assets/bpmn-font/font/bpmn.woff2` → **403** (log: «outside of Vite serving allow list»). Es la fuente de los iconos de la paleta.
  - Cambio mínimo verificado: añadir `../../node_modules` a `server.fs.allow`. Con el parche: woff2 → 200 `font/woff2`; `BACKLOG.md` sigue 403; carpeta `investigacion-2026-09-03/` sigue bloqueada para archivos (ver línea de prueba abajo).
  - `vite.config.ts` es de A: el parche está en `estado/OP-06-parche-225-vite.patch` (aplicar con `git apply`). No se ha aplicado en esta rama.
- Producción (`vite build`) no usa `server.fs.allow`; las fuentes van copiadas a `dist/assets`. La verificación de iconos en producción la da el smoke de OP-02 (`document.fonts.check('12px bpmn')`).

## Pendiente del ticket
- Arnés E2E sobre `App` montable: bloqueado hasta que A publique `App` importable (OP-01). Mientras, la aceptación del recorrido se hace sobre la app Electron con el runner de smoke de B (`LILA_SMOKE=1`), que se ampliará para OP-18.
- Tiempos de UI (#69): se miden en OP-18 con el fixture `examples/pedido`; no hay fixture grande disponible.

## Próximo comando
Integrar `codex/op-b-desktop` (OP-02 inc. 1) en esta rama y ejecutar el smoke sin Vite.
