# OP-14 — estado (agente B / Claude)

Rama `codex/op-b-desktop`. Base: merge de `codex/claude-entrega-20260906` (`ae7523e`, trae OP-12
`electron-builder.yml`, el cambio de E en `runSmoke` y el checkpoint OP-13 de A) sobre
`f0d2095` (checkpoint final de OP-08). SHA de la base tras el merge: `8dcf125`.

## Incremento 1 (P0) — endurecer IPC y proteger el cierre

Origen: revisión de A sobre OP-02 (issues #74, #70, #71): "IPC solo usa `resolveWithin` léxico,
sigue symlinks fuera de la carpeta autorizada; falta validar `senderFrame`/navegación; `openProject`
no debe permitir guardar el proyecto anterior en la carpeta nueva".

### Decisiones y prueba

1. **Symlinks.**
   - Lectura (`projectIO.ts`, `readScenarios`/`readRuns`): un `*.scenario.json` que resulta ser un
     symlink se excluye y queda en `problems` (mismo tratamiento que un JSON roto), sin seguir el
     enlace. La carpeta `runs` como symlink se excluye entera (con su propio `problems`) antes de
     hacer `readdir` sobre ella — si no, `readdir` seguiría el enlace y listaría una carpeta ajena
     sin que ningún archivo "pareciera" un enlace. Detalle no obvio: `Dirent.isFile()` (de
     `readdir(..., {withFileTypes:true})`) es `false` para un symlink — sin sumar también
     `isSymbolicLink()` al filtro, el archivo enlazado desaparecía en silencio en vez de quedar en
     `problems`.
   - Escritura (`projectIO.ts`, `writeProjectFolder`): rechaza (`E-SYMLINK`) sin tocar disco si
     `runs/` o cualquier destino (modelo, manifiesto, escenario, corrida) ya existe como symlink —
     no se sigue el enlace ni se reemplaza. Comprobado con `lstat` (`isSymlink`, `safePaths.ts`),
     antes de la fase de escritura de temporales.
   - Prueba: `apps/desktop/src/safePaths.test.ts` (`isSymlink`, symlinks reales en `mkdtemp`);
     `apps/desktop/src/projectIO.test.ts` (`describe('symlinks — lectura'/'— escritura')`):
     `*.scenario.json` → symlink a archivo externo (lectura excluida con `problems`; escritura
     rechazada con el externo intacto) y `runs` → symlink a carpeta externa (mismo patrón).

2. **Origen de los mensajes** (issue #71). `isTrustedSender(frameUrl, devUrl)` (nuevo
   `apps/desktop/src/ipcGuards.ts`, puro): compara por **origen** (`new URL(...).origin`), no por
   prefijo de texto — un `startsWith` ingenuo dejaría pasar `http://localhost:51740.evil.com`
   contra `devUrl=http://localhost:5174` (mismo prefijo de caracteres, origen distinto); cubierto
   en el test. `main.ts` envuelve **todo** `ipcMain.handle`/`ipcMain.on` de este puente
   (`guardedHandle`/`guardedOn`) verificando que `event.senderFrame` sea el frame principal de la
   ventana (`isMainFrameOf`) y su URL de confianza; si no, `E-ORIGEN` (o se ignora, para los
   canales `.on` sin respuesta). Prueba: `apps/desktop/src/ipcGuards.test.ts` (7 casos, incluida la
   confusión de prefijo).

3. **Navegación.** `will-navigate` bloquea cualquier destino que no sea la propia app o
   `LILA_DEV_URL` (mismo `isTrustedSender`). `setWindowOpenHandler` ya denegaba (OP-02).
   `Content-Security-Policy` añadida a toda respuesta del protocolo `lila://`:
   ```
   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'
   ```
   **Ninguna directiva se relajó**: el smoke (`LILA_SMOKE=1 npx electron apps/desktop`) pasó con
   `ok:true` y `consoleErrors:[]` a la primera con la CSP completa de arriba (el bundle de
   producción es autocontenido — Vite empaqueta fuentes/CSS/JS, sin CDN ni red externa; el Worker
   de simulación es un módulo del mismo origen). `style-src` necesita `'unsafe-inline'` porque
   React/bpmn-js inyectan estilos inline; no se intentó nonce/hash (fuera de alcance de este
   ticket, el resto de la política ya está cerrada a `'self'`).

4. **Guardia de identidad** (issues #74/#70: "openProject no debe permitir guardar el proyecto
   anterior en la carpeta nueva").
   - Lado renderer (`DesktopStore.saveProject`): sin `saveAs`, si `document.id` difiere del
     `activeDocument.id` ya trackeado (tras el último `openProject`/`createProject`/`saveProject`
     con éxito), rechaza `E-PROYECTO-DISTINTO` **antes** de tocar el bridge (ni pregunta carpeta ni
     escribe). Sin proyecto activo (primer guardado), cualquier `id` es válido.
   - Lado main (`projectIO.writeProjectFolder`, solo cuando `options.saveAs === true`):
     `assertFolderNotOccupied` rechaza `E-CARPETA-OCUPADA` si la carpeta elegida ya tiene
     `lila-project.json` de otro `id`, o `model.bpmn` sin manifiesto (contenido ajeno). Vacía o del
     mismo proyecto: válida. **Deliberadamente no se aplica a guardados normales** (sin `saveAs`):
     así "abrir una carpeta con solo `model.bpmn` puesto a mano y guardar ahí" (flujo legítimo de
     `readProjectFolder`) no queda bloqueado por su propia ausencia de manifiesto.
   - `LilaBridge.writeProject` gana un tercer parámetro opcional `{ saveAs?, overwrite? }`
     (`overwrite` es de incremento 2); `DesktopStore.saveProject` lo pasa a través.
   - Prueba: `DesktopStore.test.ts` (`describe('guardia de identidad')`, con puente falso);
     `projectIO.test.ts` (`describe('"Guardar como" en carpeta ocupada')`).

5. **Cierre con cambios.** `decideClose(dirty, choice, saved)` (nuevo
   `apps/desktop/src/closeGuard.ts`, puro) es la tabla de decisión; `main.ts` la usa desde
   `confirmClose`. `setDirty`/`onCloseRequested` en `LilaBridge`; preload solo reenvía
   (`ipcRenderer.send('lila:setDirty', ...)`, `ipcRenderer.on('lila:close-requested', ...)` →
   `ipcRenderer.send('lila:close-response', {saved})`). `DesktopStore.setDirty` llama al bridge;
   `DesktopStore.onSaveRequested(save)` es ahora `bridge.onCloseRequested(save)` (ya no es no-op).
   `win.on('close')` y `app.on('before-quit')` (Cmd+Q) comparten `confirmClose`: diálogo nativo
   Guardar/Descartar/Cancelar (`defaultId` Guardar, `cancelId` Cancelar); "Guardar" espera la
   respuesta del renderer hasta 30 s (si no llega o falla, muestra error y no cierra). No se usa
   `beforeunload`. El diálogo real (`dialog.showMessageBox`) **no se automatizó** — se probó a
   mano observando el código, no hay test de integración de Electron para esto en el repo; lo que
   sí tiene test unitario es la tabla de decisión pura.
   - Prueba: `apps/desktop/src/closeGuard.test.ts` (5 casos, toda la tabla).

### Comandos y resultado

```
npx vitest run apps/desktop apps/web/src/store   # 7 archivos, 117 tests, todos verdes
npx tsc -p apps/desktop/tsconfig.json --noEmit   # limpio
npm run typecheck --workspace @lila/web          # limpio
npm run build -w @lila/web                       # ok
npm run build -w @lila/desktop                   # ok
LILA_SMOKE=1 npx electron apps/desktop           # {"...,"consoleErrors":[],"loadFailure":null,"ok":true}
```
También se corrió `npx vitest run apps/web` completo (21 archivos, 252 tests) para descartar
regresiones en consumidores de `DesktopStore` (`App.tsx`, `store-boundary.test.ts`): todo verde.

### Limitaciones de este incremento

- El diálogo nativo de cierre no tiene test de integración (solo la máquina de decisión pura).
- La CSP no usa nonce/hash para estilos inline (`'unsafe-inline'` en `style-src`): suficiente para
  cerrar `script-src`/`connect-src`/etc. a `'self'`, pero no es la política más estricta posible.
- `E-CARPETA-OCUPADA` compara solo `lila-project.json`/`model.bpmn`; no inspecciona escenarios ni
  corridas de la carpeta ajena (no hace falta: si no hay manifiesto ni modelo coincidentes ya se
  rechaza).

## Incremento 2 — recientes, ventana, cambios externos, apertura de .bpmn

SHA base: `ab2578f` (fin del incremento 1).

### Decisiones y prueba

6. **Estado de sesión.** Módulo puro `apps/desktop/src/sessionState.ts` (`readSessionState`/
   `writeSessionState` sobre una ruta dada, `addRecent`/`removeRecent`/`withWindowBounds`,
   `fitsAnyDisplay`), con escritura atómica (temporal + rename, igual criterio que `projectIO.ts`)
   y lectura tolerante (archivo ausente, JSON roto, o forma inválida → estado por defecto; una
   entrada de `recents` individual inválida se descarta sin tirar toda la lista). `main.ts` guarda
   el estado en `<userData>/estado.json`, lo relee al arrancar, y lo persiste entero cada vez que
   cambia: bounds de ventana al mover/redimensionar (debounce de 400 ms) y al cerrar (sin
   debounce), y recientes al terminar con éxito `lila:readProject`/`lila:writeProject`/
   `lila:openRecent`. La ventana se crea con los bounds guardados solo si `fitsAnyDisplay` (contra
   `screen.getAllDisplays()`) dice que caben en alguna pantalla conectada ahora mismo; si no, usa
   el tamaño por defecto (1280×800, el mismo de antes de OP-14). Puente: `listRecents()`/
   `openRecent(dir)`, expuestos en `DesktopStore` como métodos propios (no forman parte de
   `ProjectSessionStore`/el contrato de A) — **petición a A**: conectarlos en la UI (menú/panel
   "Abrir reciente").
   - Prueba: `apps/desktop/src/sessionState.test.ts` (16 casos: tolerancia de lectura, ida y
     vuelta, `addRecent`/`removeRecent`, `fitsAnyDisplay` con una y varias pantallas);
     `DesktopStore.test.ts` (`listRecents`/`openRecent` con puente falso, incluida la carpeta ya
     inexistente).

7. **Cambios externos (`E-CAMBIO-EXTERNO`).** `projectIO.ts` recuerda, por ruta absoluta, el
   `{mtimeMs, size}` de `model.bpmn`/`lila-project.json`/cada `*.scenario.json` que este proceso
   leyó o escribió con éxito (`lastSeen`, poblado por `readProjectFolder` y por
   `writeProjectFolder` tras su propio éxito). Antes de escribir, `assertNoExternalChanges`
   compara el estado actual en disco contra ese snapshot: si alguno de los archivos que el
   documento va a sobrescribir tiene un snapshot conocido que **ya no coincide**, rechaza
   `E-CAMBIO-EXTERNO: <archivos>` sin tocar disco (ni siquiera los archivos que no cambiaron).
   **Decisión deliberada**: si NO hay snapshot conocido (nunca se leyó ni escribió ese archivo en
   este proceso), no se bloquea — no hay una "última vez" con la que comparar, y bloquearlo
   rompería el flujo legítimo ya cubierto por incremento 1 ("abrir una carpeta con un `model.bpmn`
   puesto a mano y guardar sin `saveAs`" cuando ni siquiera se pasó por `readProjectFolder`
   primero). `options.overwrite === true` salta la comprobación entera. No cubre
   `runs/*.result.json` (tienen su propia guardia, `E-RUN-DUPLICADO`, con semántica de contenido,
   no de momento de modificación). `DesktopStore.saveProject` acepta `options.overwrite` como
   extensión propia sobre el contrato de A (que solo declara `saveAs?`) y lo reenvía al puente;
   A decide, ante ese error, si ofrece "Sobrescribir" (pasa `overwrite: true`) o "Guardar como" —
   **petición a A**.
   - Prueba: `projectIO.test.ts` (`describe('cambios externos')`, 4 casos: rechazo sin tocar
     nada, `overwrite` lo salta, releer restablece el snapshot conocido, sin snapshot previo no
     bloquea).

8. **Apertura de `.bpmn`** (aceptación de OP-12 "arranque frío y segunda apertura"). Módulo puro
   `apps/desktop/src/openPath.ts` (`isBpmnPath`, `findBpmnArg`) para detectar una ruta `.bpmn` en
   `argv` sin depender de Electron. `main.ts`: `app.on('open-file', ...)` registrado a nivel de
   módulo (antes de `whenReady`, porque en macOS puede llegar antes); `requestSingleInstanceLock`
   + `second-instance` para reusar la ventana existente en vez de abrir una segunda; al arrancar,
   escanea `process.argv` (Windows/Linux) por una ruta `.bpmn`. `acceptOpenPath` valida que la
   ruta termine en `.bpmn` y exista, autoriza su carpeta contenedora (`realpath`, igual criterio
   que `chooseFolder`) y, si la ventana ya está lista, envía `lila:open-path`; si no, la deja en
   `pendingOpen` para `pendingOpenPath()` (se consume una vez). Puente: `pendingOpenPath()`/
   `onOpenPath(cb)`, expuestos en `DesktopStore` como métodos propios — **petición a A**: conectar
   la apertura real en `App.tsx` (llamar `pendingOpenPath()` al montar y suscribirse con
   `onOpenPath`, tratando el resultado como un `openProject`/`getProcess` ya autorizado en vez de
   mostrar el selector de carpetas).
   - Prueba automática: `apps/desktop/src/openPath.test.ts` (7 casos de `findBpmnArg`/`isBpmnPath`
     puros). El resto (integración real con Electron) **no se automatizó**, solo prueba manual:
     ```
     LILA_DEBUG=1 LILA_SMOKE=1 npx electron apps/desktop "$(pwd)/examples/pedido/model.bpmn"
     ```
     Resultado observado:
     ```
     [lila] ruta .bpmn aceptada: {"dir":"/Users/.../examples/pedido","file":"model.bpmn"}
     {"lienzo":true,"tema":true,"fuente":true,"puente":true,"consoleErrors":[],"loadFailure":null,"ok":true}
     ```
     Confirma que la ruta se detectó, se autorizó su carpeta (`realpath`), y el resto del arranque
     (protocolo `lila://`, puente, smoke) siguió funcionando sin interferencia.

### Hardening adicional (no pedido explícitamente, cerrado de paso)

Al tocar `chooseFolder`/`requireAuthorizedDir` para `acceptOpenPath` (que ya necesitaba
`realpath`), se completó la parte de symlinks del incremento 1 que había quedado sin aplicar al
nivel de la carpeta autorizada en sí (item 1 del ticket: "la carpeta autorizada se guarda como
`fs.realpath`"): `chooseFolder` ahora guarda/devuelve `realpath(dir)` (no la ruta cruda del
diálogo), y `requireAuthorizedDir` vuelve a resolver `realpath` en cada uso y rechaza
(`E-NO-AUTORIZADO`) si difiere de sí misma — TOCTOU si la carpeta autorizada fue reemplazada por
un symlink después de autorizarla. Los chequeos por archivo (symlinks en escenarios/`runs`,
`E-SYMLINK` en escritura) del incremento 1 ya cubrían la superficie de ataque principal
independientemente de esto.

### Comandos y resultado

```
npx vitest run apps/desktop apps/web/src/store   # (y también apps/web completo) todos verdes
npx tsc -p apps/desktop/tsconfig.json --noEmit   # limpio
npm run typecheck --workspace @lila/web          # limpio
npm run build -w @lila/web && npm run build -w @lila/desktop   # ok
LILA_SMOKE=1 npx electron apps/desktop           # ok:true, consoleErrors:[]
LILA_DEBUG=1 LILA_SMOKE=1 npx electron apps/desktop "$(pwd)/examples/pedido/model.bpmn"  # ver arriba
```
`npx vitest run apps/desktop apps/web` completo: 27 archivos, 343 tests, todos verdes.

### Limitaciones de este incremento

- `estado.json` no se verificó "sobrevive reinicio" con una app empaquetada real (`electron-builder`
  está fuera de alcance de este ticket); sí con `readSessionState`/`writeSessionState` en disco real
  (`mkdtemp`) y con el smoke, que carga/crea el estado sin errores.
- El guardado de bounds al cerrar es best-effort: `writeSessionState` es async y se dispara desde
  el handler de `close`, sin esperar a que termine antes de que el proceso pueda salir si es la
  última ventana y nada más lo retiene. No se añadió un mecanismo de "esperar a que termine antes
  de salir" (fuera de alcance de "debounce simple").
- `E-CAMBIO-EXTERNO` no cubre `runs/*.result.json` (ver decisión arriba) ni detecta que un archivo
  rastreado se haya **borrado** externamente (solo modificado): un archivo ausente en el momento
  de guardar se trata como "no hay conflicto, se crea de nuevo".
- La integración real de recientes/apertura de `.bpmn` en la UI (menú, atajos, primer render)
  queda para A, según lo acordado en el reparto de propiedad del ticket.

## Peticiones a A (resumen)

- Conectar `DesktopStore.listRecents()`/`openRecent(dir)` en la UI (menú "Abrir reciente").
- Conectar `DesktopStore.pendingOpenPath()`/`onOpenPath(cb)` en `App.tsx` (arranque + segunda
  apertura de un `.bpmn`).
- Decidir la UX ante `E-CAMBIO-EXTERNO` de `saveProject`: ofrecer "Sobrescribir"
  (`saveProject(doc, { overwrite: true })`) o "Guardar como" (`{ saveAs: true }`).
