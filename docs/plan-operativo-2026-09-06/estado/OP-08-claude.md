# OP-08 — estado (dueño B, Claude Sonnet 5)

- Rama: `codex/op-b-desktop`.
- HEAD tras merge de `codex/claude-entrega-20260906` (97dabb0): fast-forward, sin conflictos.
- Incremento: implementar `readProjectFolder`/`writeProjectFolder` puros en
  `apps/desktop/src/projectIO.ts`, sustituir `listFiles/readFile/writeFile` del puente por
  `chooseFolder/readProject/writeProject`, y `DesktopStore` en `apps/web/src/store/DesktopStore.ts`
  sobre `ProjectSessionStore`.
- Archivos previstos:
  - `apps/desktop/src/projectIO.ts` (+ `projectIO.test.ts`)
  - `apps/desktop/src/bridge.ts` (nuevo contrato del puente)
  - `apps/desktop/src/preload.cts` (implementación de `chooseFolder/readProject/writeProject`)
  - `apps/desktop/src/main.ts` (handlers IPC nuevos; no se toca `runSmoke`/`SmokeChecks`)
  - `apps/desktop/src/safePaths.ts`/`safePaths.test.ts` (ajuste si hace falta validar nombres)
  - `apps/web/src/store/DesktopStore.ts` (+ `DesktopStore.test.ts`)
  - `apps/web/src/store/lila-bridge.d.ts` (solo si el typecheck de web no admite el import directo)
- Próximo comando: implementar `projectIO.ts` y su test con `mkdtemp`.

(Este archivo se actualiza al final con SHA final, decisiones, comandos/resultados, límites y
entrega a A.)
