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

## SHA listo para consumo por A: 8dcf125 (con reserva P0 abajo)
Contiene OP-08 (B, f0d2095: `DesktopStore` implementa `ProjectSessionStore` sobre el puente `chooseFolder/readProject/writeProject`; `projectIO` tolerante con `problems`; escritura tmp+rename), OP-11 (E, 740fc76: capacidad Fija/Por turno, `priority: null`, etiquetas humanas; arregla el test de ScenarioPanel roto en 3eda772), OP-12 y checkpoint 3eda772 de A. Verificación en este worktree: `npx vitest run apps/web apps/desktop` → 281/281; typecheck web y desktop PASS; build web+desktop y smoke PASS.
**Reserva P0 (revisión 43a29cf de A, aceptada):** `writeProjectFolder` renombra con `Promise.all`; un fallo intermedio (EISDIR en un destino) deja `model.bpmn` ya sustituido. No se entrega OP-08 como snapshot atómico hasta que B añada preflight de destinos + rollback con test de fallo intermedio. B está en OP-14 (endurecimiento IPC y cierre); la corrección entra en su siguiente incremento sobre `projectIO.ts` y se publicará con SHA nuevo. Hasta entonces A puede integrar 8dcf125 para el bootstrap de `DesktopStore`, sabiendo que el guardado aún no es transaccional.

## Checkpoint fc6f9a2 de A consumido → d536b75 en la rama Claude
Incluye el bootstrap de `DesktopStore` en `main.tsx` (f5def78), OP-08/OP-11 integrados por A y sus fixes de OP-14 en App. Verificado aquí: `npx vitest run apps/web apps/desktop` 295/295, typecheck web PASS, build web+desktop y smoke PASS. Se empaqueta la `.app` de d536b75 para un recorrido preliminar de OP-18 mientras B termina OP-14. OP-17 inc. 1 (E, aa60dd1: `docs/GUIA-BETA-MAC.md`, `THIRD_PARTY_LICENSES.md`, sección README) también integrado.

## SHA listo para consumo por A: 49c9d1b (OP-14 integrado)
OP-14 (B, 633ffa7): symlinks por `realpath`/`lstat`, `isTrustedSender` por origen en todo IPC, `will-navigate` bloqueado, CSP estricta (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'`), `E-PROYECTO-DISTINTO`/`E-CARPETA-OCUPADA`, cierre Guardar/Descartar/Cancelar con `setDirty`/`onSaveRequested` reales, `estado.json` (ventana + recientes), `E-CAMBIO-EXTERNO` (+`overwrite`), apertura de `.bpmn` por `open-file`/argv/segunda instancia. Verificado aquí sobre 49c9d1b: `npx vitest run apps/web apps/desktop` 357/357; typecheck web y desktop PASS; build + smoke PASS.
Pendiente en B (en curso, SHA nuevo al terminar): rollback transaccional del P0 43a29cf (preflight + journal/undo) y seam E2E por variables de entorno para que F pruebe carpeta/guardar/cerrar/reabrir sin diálogos.
Peticiones a A de OP-14: conectar `listRecents`/`openRecent` y `pendingOpenPath`/`onOpenPath` en la UI; UX ante `E-CAMBIO-EXTERNO` (Sobrescribir vs Guardar como). Ninguna bloquea la beta Mac.

## SHA candidato final Claude: 89f82bd
Incluye el incremento 3 de B (guardado transaccional con preflight + rollback, P0 43a29cf; seam E2E `LILA_E2E_FOLDER/CLOSE/LOG`) y el incremento 4 (P0 997a72f: `E-CARPETA-OCUPADA` en createProject/primer guardado, `E-SYMLINK` en `model.bpmn`/manifiesto, `problems` dentro de `ProjectDocument`). Verificado aquí: `npx vitest run apps/web apps/desktop` 377/377; typecheck web y desktop PASS. Sobre af3678b (un merge antes) la suite completa `npm test` dio 1261 pasan / 1 omitido; se repite sobre 89f82bd junto con `dist:mac` (DMG del mismo SHA) y el recorrido OP-18 sobre ese DMG; resultado en `estado/OP-18-claude.md` y `FINAL-claude.md`.
Recorrido OP-18 ya ejecutado sobre la `.app` de 1e136e3 con el seam (ver OP-18-claude.md): crear carpeta, guardar, cerrar/reabrir, dos escenarios, comparar, CSV, Guardar/Descartar/Cancelar al cerrar, JSON roto, sin permisos, ids ajenos → PASS; edición BPMN y doble clic `.bpmn` no automatizados.
Para A: integrar 89f82bd (o el SHA que anuncie FINAL-claude.md) como checkpoint combinado; pendientes de UI en A: mostrar `doc.problems`, menú de recientes (`listRecents/openRecent`), `pendingOpenPath/onOpenPath`, UX de `E-CAMBIO-EXTERNO`, mensajes de error legibles (zod crudo, «Error invoking remote method»).

## ENTREGA FINAL (2026-09-07 00:30)
Artefacto: DMG arm64 de **89f82bd** (`apps/desktop/release/Lila Modeler-0.0.1-mac-arm64.dmg`, ORIGEN.txt sha=89f82bd). Suite completa sobre 89f82bd: 1265 pasan / 1 omitido. Aceptación OP-18 sobre la app extraída del DMG: PASS (ver `estado/OP-18-claude.md`). Informe: `FINAL-claude.md`. Guía actualizada: `docs/GUIA-BETA-MAC.md` (E, 87537ce). Los commits posteriores a 89f82bd en esta rama son solo documentación.
A puede integrar la punta de `codex/claude-entrega-20260906` como checkpoint combinado; si Codex no responde, esta rama es el candidato (`codex/claude-candidato-20260906` no fue necesario: la base ya es el último checkpoint de A, fc6f9a2).
Trabajadores B y E: libres, sin tareas activas. Worktrees conservados.

## Activo
- B: libre (incrementos 3 y 4 entregados).
- E: libre (OP-17 inc. 2 entregado).
- F: revisión e integración; después OP-14 y OP-18.

## Peticiones a A
1. Bootstrap en `main.tsx`: elegir `DesktopStore` cuando `typeof window.lila !== 'undefined'` (B entrega el snippet exacto en `estado/OP-08-claude.md`).
2. `ProjectDocument.problems?: readonly { file: string; message: string }[]` opcional, para que abrir una carpeta con un escenario JSON roto no descarte el proyecto ni el archivo.
3. Aplicar `estado/OP-06-parche-225-vite.patch` en `vite.config.ts`.
4. Tomar la corrección de fixtures de 97dabb0 (o su equivalente) para que el typecheck de web pase sobre la rama canónica.

## OP-G (2026-09-07, rama `codex/op-g-ajustes` sobre `codex/operativo-20260906`)
Origen: Brito probó el DMG y no encontró configuración (`⌘,` no hacía nada: `main.ts` no construía `Menu`, así que Electron dejaba el menú por defecto sin Preferencias). Entregado:
- Menú nativo (`apps/desktop/src/menu.ts`, puro y con test): Preferencias… `CmdOrCtrl+,` en el menú de la app (macOS) o en Archivo (resto); Archivo con Nuevo/Abrir/Guardar/Guardar como y **Abrir reciente** alimentado por `estado.json` (cierra la petición a A de OP-14 sobre `listRecents/openRecent`). Canal nuevo `lila:menu` (main → renderer) y `onMenu` en el puente.
- Ajustes → Apariencia en `App.tsx` (`<dialog>` nativo, botón ⚙ y «Tema:» de la barra de estado): tema Eva-01/Papel en caliente (remonta el lienzo con el XML actual) y densidad; persistido en localStorage (`lila.tema`, `lila.densidad`). Atajos web `⌘S/⇧⌘S/⌘O` (Chrome se queda `⌘N` y `⌘,`; en Electron van por el menú). Es la versión mínima de #143; el editor de tokens sigue en #144.
- Fuente Archivo cargada por `@fontsource/archivo` (decisión de Brito; el fallback `system-ui` era buena parte de la distancia con el diseño).
Verificado: typecheck web+desktop, `npm test` 1273/1 omitido, build + smoke `{ok:true}`, demo web en navegador (cambio a Papel repinta lienzo y persiste tras recargar). No verificado: pulsación real de `⌘,` en la app empaquetada (computer-use denegado; el menú se construye en el smoke sin error y el despacho está cubierto por `menu.test.ts` y `App.test.tsx`).
