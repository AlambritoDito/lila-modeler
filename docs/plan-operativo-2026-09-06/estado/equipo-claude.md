# Disponibilidad Claude

Coordinador/F: Claude Code, modelo Fable 5.1 (`claude-fable-5-1`), el selector activo de la sesión. Opus no fue necesario como sustituto.
Cuota Claude: no disponible programáticamente desde esta sesión (no hay acceso a `/usage`); se trabaja con bloques cortos y commits frecuentes.
Base común consumida: 71e653e; checkpoint verificado de A consumido: 3fedfdb (merge 1cd9e4c en la rama de entrega Claude; `npm run build -w @lila/web` PASS).

Rama de entrega Claude: `codex/claude-entrega-20260906`, worktree `/Users/brito/development/lila-wt-claude`.
Trabajadores (Sonnet, contexto acotado):
- B: `codex/op-b-desktop`, worktree `/Users/brito/development/lila-wt-b-desktop`. OP-02 → OP-08 → OP-14.
- E: `codex/op-e-paneles`, worktree `/Users/brito/development/lila-wt-e-paneles`. OP-05 → OP-11 → OP-17.

Activo: B en OP-02 incremento 1 (Electron arrancable con protocolo local). E en OP-05 incremento 1 (CompareView con moneda/avisos sobre #209).
SHA listo para consumo: a256945 (solo docs/CI: paso de build web en ci.yml y parche #225 para A en `estado/OP-06-parche-225-vite.patch`). Código funcional: ninguno todavía.
Decisión F para B: carga de producción por protocolo propio `lila://app/` que sirve `apps/web/dist`, sin tocar `vite.config.ts` (archivo de A). Dev con `LILA_DEV_URL`.
Petición a A: ninguna bloqueante aún; B entregará el mecanismo de detección del adaptador nativo (`window.lila`) y la API del puente para que A elija `DesktopStore` en el bootstrap.
