# FINAL — equipo Claude (B/E/F), 2026-09-07

Rama de entrega: `codex/claude-entrega-20260906` (worktree `/Users/brito/development/lila-wt-claude`). **SHA del artefacto: 89f82bd** (los commits posteriores de la rama son documentación). Codex A mantiene la rama canónica `codex/operativo-20260906`; este informe no anuncia merge a `main`.

## Artefacto macOS arm64
- DMG: `/Users/brito/development/lila-wt-claude/apps/desktop/release/Lila Modeler-0.0.1-mac-arm64.dmg` (128 MB), `ORIGEN.txt` sha=89f82bd, arch=arm64. También `release/mac-arm64/Lila Modeler.app`.
- Sin firma ni notarización: abrir con clic derecho → Abrir, o `xattr -d com.apple.quarantine "Lila Modeler.app"`. Guía: `docs/GUIA-BETA-MAC.md`. Licencias: `THIRD_PARTY_LICENSES.md`.
- Reconstruir: `npm ci && npm run build -w @lila/engine && npm run build -w @lila/web && npm run dist:mac -w @lila/desktop`.

## Comprobado sobre el DMG (Vite detenido) — detalle en `estado/OP-18-claude.md`
Arranque sin servidor; lienzo, tema Eva-01, fuente bpmn y Worker; Nuevo proyecto en carpeta con espacio y tilde; guardar (`model.bpmn`, `*.scenario.json`, `lila-project.json`); cerrar con cambios → Guardar/Descartar/Cancelar (los tres comportamientos); reabrir con cambios conservados; escenario JSON roto no bloquea y se muestra; ids ajenos → validación y «No se pudo simular»; carpeta sin permisos → error, sigue «Sin guardar», archivo previo intacto; dos escenarios simulados, Comparar con moneda/avisos/significancia, Exportar CSV; cancelación de corrida.
Suite completa 1265 tests / 1 omitido; typecheck web y desktop; build web.

## No comprobado / limitaciones
- Edición del BPMN dentro de la app empaquetada: no automatizada (verificada por A en navegador, QA 65560c7). Pendiente prueba manual.
- Doble clic sobre `.bpmn` (asociación): no probado; B verificó la ruta por argv.
- Windows x64 y Linux x64: solo configurados (`electron-builder.yml`, `.github/workflows/desktop.yml`); no compilados ni instalados.
- Sin icono propio (#76); sin menú de recientes en la UI; sin botón «Sobrescribir» ante `E-CAMBIO-EXTERNO` (salida: Guardar como); mensajes de error crudos (zod, «Error invoking remote method»); editor visual de calendarios pospuesto; `Exportar CSV` solo en Resultados; MCP (#56/#48) fuera de esta noche.

## Defectos abiertos por prioridad
- P1: mostrar errores de validación legibles (A/D); menú de recientes y apertura de ruta pendiente (A); UX de cambios externos (A).
- P2: icono (#76); prueba manual de edición BPMN y doble clic; Windows/Linux en runners.

## Tickets del equipo Claude
OP-02, OP-08, OP-14 (B, Sonnet): listos y verificados, integrados. OP-05, OP-11, OP-12, OP-17 (E, Sonnet): listos y verificados, integrados. OP-06 (F): CI construye la web; parche #225 entregado a A (`estado/OP-06-parche-225-vite.patch`); arnés E2E = seam + `scratchpad/op18.mjs` (CDP), no versionado como test de CI. OP-18 (F): aceptación Mac ejecutada.
Modelos: coordinador Fable 5.1; trabajadores Sonnet; Opus no fue necesario. Cuota Claude: no disponible programáticamente.
