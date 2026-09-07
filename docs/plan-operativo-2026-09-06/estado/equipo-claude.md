# Disponibilidad Claude

Coordinador/F: Claude Code, modelo Fable 5.1 (`claude-fable-5-1`), selector activo de la sesión. Opus no fue necesario como sustituto.
Cuota Claude: no disponible programáticamente desde esta sesión (sin acceso a `/usage`); bloques cortos y commits frecuentes.
Base consumida de A: 71e653e (plan) y 3fedfdb (OP-01 + OP-03, merge 1cd9e4c).

Rama de entrega Claude: `codex/claude-entrega-20260906`, worktree `/Users/brito/development/lila-wt-claude`.

## SHA listo para consumo por A: 97dabb0
Contiene, verificado en la combinación con 3fedfdb:
- OP-02 inc. 1 (B, `codex/op-b-desktop` 9eb5385): `apps/desktop` con Electron 44.2.0 exacto, protocolo `lila://app/` que sirve `apps/web/dist`, `contextIsolation`/`sandbox`/`nodeIntegration:false`, puente `window.lila` validado en main, smoke `LILA_SMOKE=1 npx electron apps/desktop` → `{"lienzo":true,"tema":true,"fuente":true,"puente":true,"ok":true}` sin Vite. Delta de dependencias: `electron@44.2.0` (devDependency de `@lila/desktop`) en `package-lock.json`.
- OP-05 inc. 1 (E, `codex/op-e-paneles` 739bd27): `CompareView` con `runs?: CompareRunMeta[]`, panel de avisos, costos no comparables entre monedas, significancia bloqueada sin ≥ 2 réplicas; helper `apps/web/src/compareWarnings.ts` con `runMetaFrom(name, scenario, result)` para OP-13. 51 tests verdes. E fusionó `lila-63-compare-view` (7b6acec) por merge, mismos commits que A.
- OP-06 inc. 1 (F): `ci.yml` construye la web con Vite; parche verificado para #225 en `estado/OP-06-parche-225-vite.patch` (archivo de A, no aplicado aquí).
- Corrección de combinación: 3fedfdb rompe `npm run typecheck -w @lila/web` (OP-03 añade `IrSource.warnings`; los fixtures de `CompareView*.test.tsx` de #209 no lo traían). Arreglado en 97dabb0 (2 líneas en archivos de E).
Comandos verdes sobre 97dabb0: `npx vitest run apps/web/src/CompareView apps/web/src/compareWarnings apps/desktop` (75), `npm run typecheck -w @lila/web`, `npm run typecheck -w @lila/desktop`, `npm run build -w @lila/web`, `npm run build -w @lila/desktop`, smoke.

## SHA integrado f80a6c9 (OP-12 + checkpoint 3eda772 de A)
- OP-12 (E por transferencia de F, `codex/op-e-empaquetado` 93a16f6): electron-builder 26.15.3, `apps/desktop/electron-builder.yml` (dmg/dir arm64 sin firma, nsis, AppImage/deb, asociación `.bpmn`), scripts `pack:mac`/`dist:mac`, `release/ORIGEN.txt` con SHA/arch, `.github/workflows/desktop.yml` (no ejecutado). Artefacto probado: `apps/desktop/release/Lila Modeler-0.0.1-mac-arm64.dmg` en el worktree de E (128 MB, origen f0ba8ed); smoke desde la `.app` empaquetada con Vite apagado → ok, también desde `$TMPDIR/Prueba canción/`. Sin icono propio (#76). Windows/Linux solo configurados.
- Verificación de f80a6c9 en este worktree: typecheck web y desktop PASS; build web + desktop + smoke PASS; `npx vitest run apps/web apps/desktop` → 254 pasan, **1 falla**: `ScenarioPanel.test.tsx › editar capacity y guardar…` («no hay input con id campo-resources.cajero.capacity») porque el motor de 3eda772 admite `capacity` por turno y el panel generado ya no pinta el campo. Viene del checkpoint de A, no de ramas Claude; E lo corrige en OP-11 (capacidad Fija/Por turno). A: no marcar 3eda772 como suite completa verde.

## Activo
- B (Sonnet): OP-08 en `codex/op-b-desktop` sobre 97dabb0: `DesktopStore` que implementa `ProjectSessionStore`, `projectIO` con escritura atómica, carpeta `model.bpmn` + `*.scenario.json` + `lila-project.json` + `runs/`.
- E (Sonnet): OP-11 en `codex/op-e-paneles` sobre f80a6c9: capacidad Fija/Por turno (arregla el test que falla), `priority: null` para heredados.
- F: revisión e integración; después OP-14 y OP-18.

## Peticiones a A
1. Bootstrap en `main.tsx`: elegir `DesktopStore` cuando `typeof window.lila !== 'undefined'` (B entrega el snippet exacto en `estado/OP-08-claude.md`).
2. `ProjectDocument.problems?: readonly { file: string; message: string }[]` opcional, para que abrir una carpeta con un escenario JSON roto no descarte el proyecto ni el archivo.
3. Aplicar `estado/OP-06-parche-225-vite.patch` en `vite.config.ts`.
4. Tomar la corrección de fixtures de 97dabb0 (o su equivalente) para que el typecheck de web pase sobre la rama canónica.
