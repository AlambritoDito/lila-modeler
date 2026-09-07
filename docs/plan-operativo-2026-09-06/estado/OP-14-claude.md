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

## Incremento 3 — guardado transaccional (P0) y seam E2E para OP-18

SHA base: `49c9d1b` (merge fast-forward de `codex/claude-entrega-20260906` sobre `633ffa7`, fin
del incremento 2 — trae, entre otras cosas, el checkpoint de OP-17/OP-18 de A y el hallazgo de la
revisión de abajo). SHA final: ver commits al pie.

### 1. P0 — `writeProjectFolder` no era transaccional (issues #71/#74)

Origen: revisión de A, commit `43a29cf` (cítase textual: "writeProjectFolder hace renames con
Promise.all; con destino `bad.scenario.json` que es un directorio falla EISDIR pero `model.bpmn`
YA cambió de MODELO_ANTERIOR a MODELO_NUEVO"). Reproducción aislada de A en
`/tmp/lila-atomic-review-uRTH8j`, importando la función de este agente sin editar su worktree.

**Decisión 1 — preflight antes de escribir nada.** `assertValidDestination(dest, runsDir)` (nueva,
`projectIO.ts`) se corre para TODOS los destinos (modelo, manifiesto, cada escenario, cada corrida)
antes de escribir un solo `.tmp-*`: rechaza `E-SYMLINK` si `dest` ya es un symlink (comportamiento
ya existente, sin cambios de código para los tests que lo cubrían), o `E-DESTINO-INVALIDO: <ruta>`
si `dest` existe pero no es un archivo regular (el caso exacto de A: un directorio), o si la
carpeta padre de `dest` no existe o no admite escritura (`access(parent, W_OK)`) — salvo que el
padre sea `runs/` y todavía no exista, porque `writeProjectFolder` la crea sola
(`mkdir(runsDir, {recursive:true})`, después del preflight, antes de la fase 1). `assertRunsDirUsable`
hace el mismo tipo de chequeo para la propia carpeta `runs/` (symlink → `E-SYMLINK`; existe pero no
es carpeta → `E-DESTINO-INVALIDO`). Razón de mantener `E-SYMLINK` como código separado de
`E-DESTINO-INVALIDO` en vez de fusionarlos: los tests de symlinks del incremento 1 ya distinguían
ese código específico; separar "es un enlace" de "es un directorio/no admite escritura" también es
más útil para quien consuma el error. Con esto, la reproducción exacta de A (destino de escenario
que es un directorio) se rechaza en el preflight, **antes** de que `model.bpmn` se toque siquiera.

**Decisión 2 — commit secuencial con rollback (para fallos que el preflight no puede prever:
disco lleno, permisos que cambian a mitad de camino, etc.).** `commitWithRollback` (nueva)
reemplaza el `Promise.all(writes.map(...rename...))` de antes por un bucle secuencial con un
journal en memoria (`CommitStep[]`, sin librerías — un array y un `try/catch` bastan, ver ponytail
del ticket): por archivo, si el destino ya existía se renombra primero a `<destino>.prev-<token>`
(se anota `movedToPrev`), luego el temporal se renombra al destino (se anota `tmpMoved`); el paso
se añade al journal ANTES de intentar los renames, así un fallo a mitad de ese mismo paso ya queda
representado con el estado correcto (`movedToPrev`/`tmpMoved` en `false` si su rename no llegó a
correr). Si cualquier rename de la fase de commit falla, `rollbackCommit` deshace TODO lo ya hecho
en orden inverso (LIFO): por cada paso, si `tmpMoved` borra el contenido nuevo movido a `dest`, y si
`movedToPrev` restaura el `.prev-*` a `dest`; se rechaza con el error original. Si el propio
deshacer falla para algún paso (no pudo restaurar su `.prev-*`), en vez de perder ese archivo en
silencio se escribe `lila-recovery.json` en la carpeta del proyecto (`{version, createdAt,
pending: [...]}`) y se rechaza `E-RECUPERACION-PENDIENTE` mencionando esa ruta. Al terminar con
éxito, se borran los `.prev-*` (ya no hacen falta) — best-effort, un fallo ahí no revierte el
guardado (ya se completó).

**Decisión 3 — seam de prueba `fsImpl` para inyectar un fallo determinista a mitad de los
renames**, en vez de depender de `chmod` (frágil entre plataformas y sin efecto como root, como ya
advertía un comentario existente de este mismo archivo de tests). `writeProjectFolder` gana un
cuarto parámetro opcional `fsImpl: WriteProjectFsImpl = {}` (`{ rename?: (old, new) => Promise<void>
}`); sin él, usa el `rename` real de `node:fs/promises`, así que ningún llamador de producción
(`main.ts`) necesita tocarse. Es un parámetro extra al final, no parte de `WriteProjectOptions`
(que sí viaja por IPC) — no es una API pública, solo para tests.

Prueba (`projectIO.test.ts`, `describe('writeProjectFolder — transaccional')`, 3 casos):
(a) reproducción exacta de A: destino de escenario que ya es una carpeta → `E-DESTINO-INVALIDO`,
`model.bpmn` byte a byte igual al anterior, sin `.tmp-*`/`.prev-*`/`lila-recovery.json`; (b) fallo
inyectado vía `fsImpl.rename` justo en el `rename(tmp, dest)` del manifiesto — con el modelo ya
comprometido en el journal (el orden de `trackedWrites` es modelo → manifiesto → escenarios) —
verifica que modelo, manifiesto y escenario terminan con su contenido PREVIO exacto, sin residuos;
(c) éxito: dos escrituras seguidas, sin `.tmp-*`/`.prev-*`/`lila-recovery.json` al final.
27 → 27 tests de este archivo antes del cambio siguieron pasando sin modificarlos (solo se
reemplazó `assertNotSymlinkDestination` por `assertValidDestination`/`assertRunsDirUsable`, que
cubren el mismo caso además de los nuevos).

### 2. Seam de prueba E2E por variables de entorno (para OP-18, issue #74)

F no puede accionar diálogos nativos (selector de carpeta, Guardar/Descartar/Cancelar del cierre)
desde su sesión. Nuevo módulo puro `apps/desktop/src/e2e.ts` (`e2eOverrides(env)`, sin Electron ni
`fs` — solo parsea `Record<string,string|undefined>`), consumido por `main.ts` una única vez al
cargar el módulo (`const e2e = e2eOverrides(process.env)`, comentado ahí mismo como "SOLO PARA
PRUEBAS, no es una API pública"):

- `LILA_E2E_FOLDER=<ruta absoluta>`: `lila:chooseFolder` devuelve esa ruta sin abrir el diálogo
  (la crea con `mkdir(..., {recursive:true})` si falta, y la autoriza por `realpath`, igual
  criterio que el diálogo real). Literal `"cancel"` → `chooseFolder()` resuelve `null` (simula
  cerrar el diálogo sin elegir nada).
- `LILA_E2E_CLOSE=save|discard|cancel`: `confirmClose` usa ese valor como `choice` en vez de
  `dialog.showMessageBox`; un valor que no sea exactamente uno de los tres se ignora (se sigue
  mostrando el diálogo real). El diálogo de error posterior ("No se pudo guardar") también se
  omite bajo la misma condición — decisión no pedida explícitamente pero necesaria: una sesión sin
  interacción se quedaría colgada esperando un clic en ese diálogo también.
- `LILA_E2E_LOG=<ruta de archivo>`: `e2eLog(event, data)` (nueva, `main.ts`) añade una línea JSON
  (`{ts, event, ...data}`) por evento: `chooseFolder` (`{result}`), `writeProject` (`{dir, ok,
  code}`, `code: null` si el error no fue un `ProjectIOError`), `closeRequested` (`{choice, saved,
  decision}`), `openPath` (`{dir, file}`, en `acceptOpenPath`). No-op si la variable no está.

Sin ninguna de las tres variables, `e2eOverrides` devuelve `{}` y el comportamiento de `main.ts` es
exactamente el de antes (mismas ramas de código para diálogo real/sin override).

Prueba: `apps/desktop/src/e2e.test.ts` (13 casos: cada variable ausente/con valor válido/con valor
inválido/vacía, y las tres juntas) — función pura, sin mocks de Electron. `main.ts` no tiene test
de integración propio (no cambia eso: ya era así en incrementos 1-2, `dialog.showMessageBox` nunca
se automatizó); la cobertura de este seam es la función pura más la verificación manual de abajo.

### Comandos y resultado

```
npx vitest run apps/desktop apps/web/src/store   # 10 archivos, 164 tests, todos verdes
npx tsc -p apps/desktop/tsconfig.json --noEmit   # limpio
npm run typecheck -w @lila/web                   # limpio
npm run build -w @lila/web && npm run build -w @lila/desktop   # ok
LILA_SMOKE=1 npx electron apps/desktop           # ok:true, consoleErrors:[]
```
Verificación manual del seam (pedida en el ticket):
```
LILA_E2E_FOLDER="$TMPDIR/lila-e2e-b" LILA_E2E_LOG="$TMPDIR/lila-e2e-b.log" LILA_SMOKE=1 npx electron apps/desktop
# → {"lienzo":true,"tema":true,"fuente":true,"puente":true,"consoleErrors":[],"loadFailure":null,"ok":true}
cat "$TMPDIR/lila-e2e-b.log"
# → el archivo NI SIQUIERA SE CREA: el recorrido de `runSmoke` (arranque + captura de pantalla)
#   nunca llama a `lila:chooseFolder` ni a ningún otro canal que loguee, así que `e2eLog` nunca se
#   ejecuta. Documentado tal cual porque el ticket contemplaba justo este caso ("puede estar vacío
#   si el smoke no llama a chooseFolder") — aquí ni siquiera llega a existir, que es el mismo hecho
#   ("nada que loguear") en su forma más estricta. La carpeta `$TMPDIR/lila-e2e-b` tampoco se creó,
#   por la misma razón (chooseFolder nunca se invocó).
```

### Limitaciones de este incremento

- El seam E2E no se ejerció punta a punta contra un `chooseFolder`/cierre reales dentro de una
  ventana de Electron interactiva (esta sesión no tiene UI accionable) — la verificación es: (a)
  revisión de código de los tres puntos de integración en `main.ts`, (b) `e2eOverrides` cubierto al
  100% por tests puros, (c) el smoke confirma que con las variables puestas la app arranca igual de
  bien (no rompe nada), aunque su recorrido no toca `chooseFolder`. F, al accionar el recorrido real
  de OP-18, es quien primero ejercita `LILA_E2E_FOLDER`/`LILA_E2E_CLOSE` de punta a punta.
- `E-DESTINO-INVALIDO` no distingue "el padre no existe" de "el padre existe pero no admite
  escritura" en el código (ambos casos, mismo mensaje) — no hacía falta más granularidad para lo
  que pide el ticket (rechazar antes de escribir), y mantenerlo así evita otro código más.
- El rollback restaura contenido byte a byte (renombra el `.prev-*` de vuelta), pero no restaura
  metadatos de archivo más allá de eso (p. ej. `mtime` original) — no hacía falta: `lastSeen`
  (detección de cambios externos) se actualiza recién al final de un guardado con éxito, nunca tras
  un rollback.
- `E-RECUPERACION-PENDIENTE` no se pudo ejercitar con un test automático realista (forzar que el
  PROPIO rollback falle requiere que un `unlink`/`rename` de restauración falle justo después de
  que el de commit ya falló — dos inyecciones encadenadas sobre el mismo `fsImpl.rename`); se
  revisó el código a mano en vez de añadir una prueba frágil. `rollbackCommit`/`undoCommitStep`
  están escritos para ser triviales de leer (un `try/catch` que devuelve `boolean`, sin estado
  oculto) precisamente para que esa revisión manual sea suficientemente confiable.

## Incremento 4 — tres P0 reproducidos por A (revisión 997a72f, issues #71/#74)

Base: `1e136e3` (fast-forward de `codex/claude-entrega-20260906`, ya incluía los incrementos 1-3
de arriba). Los tres P0 los reprodujo A sobre este código; ninguno requirió reabrir diseño.

### P0-1 — "nuevo proyecto sobre carpeta ocupada aún sobrescribe"

**Decisión**: cualquier escritura hacia una carpeta que no es la activa del mismo `id` del
documento (`createProject`, el primer `saveProject` sin `activeDir` todavía, "Guardar como") pasa
`{ saveAs: true }` a `bridge.writeProject`, para que main corra `assertFolderNotOccupied`
(`projectIO.ts`, ya existía y ya se llamaba correctamente desde `main.ts`/`writeProjectFolder` —
el bug estaba enteramente en `DesktopStore`, que no siempre marcaba el destino como nuevo).

**Razón**: `createProject` llamaba `this.bridge.writeProject(dir, document)` sin opciones — nunca
disparaba la comprobación de ocupación pasara lo que pasara. `saveProject`, en el primer guardado
(`this.activeDir === null`), elegía carpeta nueva pero reenviaba el `saveAs` explícito del llamador
(`false` por defecto) tal cual — mismo problema para "primer guardado". Fix: `createProject` ahora
pasa `{ saveAs: true }` siempre; `saveProject` calcula `isNewDestination = dir === null ||
explicitSaveAs` ANTES de pedir carpeta, y usa ese valor (no el `saveAs` explícito del llamador)
como `options.saveAs` de la escritura. La guardia de identidad (`E-PROYECTO-DISTINTO`) sigue
usando el `saveAs` explícito del llamador, sin cambios — no se mezclan los dos conceptos.

**Prueba**: `DesktopStore.test.ts` — nueva prueba "sin carpeta activa (primer guardado): pasa
`{ saveAs: true }`..." (el caso que antes fallaba en silencio) y "carpeta ocupada (writeProject
rechaza E-CARPETA-OCUPADA): rechaza y no deja el proyecto como activo" (con un bridge falso que
simula el rechazo real de `assertFolderNotOccupied`); se actualizaron las aserciones de
`bridge.writes` de los tests existentes de `createProject` para reflejar el `{ saveAs: true }` que
ahora siempre viaja. La cobertura de `assertFolderNotOccupied` en sí (con fs real, carpeta ajena
intacta byte a byte) ya existía en `projectIO.test.ts` (incremento 1) y sigue verde sin tocarla.

### P0-2 — "lectura de model.bpmn (y manifiesto) sigue symlinks"

**Decisión**: `lstat` (vía `isSymlink`, `safePaths.ts`, ya existente) antes de leer tanto
`model.bpmn` como `lila-project.json` en `readProjectFolder`/`readManifest`. Symlink en
`model.bpmn` → fatal (`E-SYMLINK`), mismo criterio que "ausente" (`E-SIN-MODELO`): sin poder
confiar en su origen, no hay nada que abrir. Symlink en `lila-project.json` → se excluye y queda
en `problems`, reconstruido como si faltara (mismo criterio que un manifiesto roto/no-JSON).
`requireAuthorizedDir` (`main.ts`) YA comprobaba `realpath(dir)` en cada llamada desde el
incremento 1 — no hizo falta tocarlo, se verificó que sigue ahí (líneas 89-106).

**Razón**: la protección de symlinks del incremento 1 solo cubría escenarios (`*.scenario.json`) y
la carpeta `runs` — A reprodujo el caso con `model.bpmn` mismo (y el manifiesto) sin cubrir:
`readFile(modelPath)`/`readFile(manifestPath)` se llamaban directo, sin `isSymlink` antes, así que
un `model.bpmn` symlinkeado a un archivo externo devolvía su contenido como si fuera el modelo del
proyecto.

**Prueba**: dos casos nuevos en `projectIO.test.ts`, describe `symlinks — lectura`: "model.bpmn
symlink a un archivo externo: E-SYMLINK, no se lee el contenido ajeno" y "lila-project.json
symlink a un archivo externo: se excluye, queda en problems, y el manifiesto se reconstruye"
(verifica que el `id`/revisión del documento NO son los del archivo ajeno enlazado). Ambos con
symlinks reales (`node:fs/promises.symlink`) en carpetas temporales (`mkdtemp`), como el resto del
describe.

### P0-3 — "problems sigue eliminado en toProjectDocument"

**Decisión**: `toProjectDocument` (`DesktopStore.ts`) ahora incluye `problems` DENTRO del
`ProjectDocument` que devuelve, en vez de extraerlo a un canal aparte — A ya declara `problems?`
opcional en `ProjectDocument` (`apps/web/src/store/ProjectStore.ts:75`), así que no hizo falta
tocar `LilaProjectDocument` (`bridge.ts`) ni inventar ningún campo extra: `problems` viaja en el
`ProjectDocument` de A.

**Razón**: `App.tsx#activate` (línea 196-197) lee `doc.problems` directamente del documento que
devuelven `createProject`/`openProject`/`saveProject`/`openRecent` para mostrar el aviso al abrir
— pero `toProjectDocument` destructuraba `problems` fuera del documento (`const { problems, ...rest
} = raw`) y solo lo exponía por separado (`this.problems`/`lastProblems`, pensado para cuando A
todavía no admitía el campo). Con `ProjectDocument.problems?` ya declarado por A, el documento
devuelto llegaba SIN el campo y `doc.problems` en `App.tsx` era siempre `undefined`: el diagnóstico
de "este escenario no se pudo leer" nunca se veía en la modalidad de escritorio. `lastProblems` se
conserva (no se rompe nada que ya dependiera de él).

**Prueba**: `DesktopStore.test.ts`, test de `openProject` renombrado a "ida y vuelta: propaga
'problems' en el documento devuelto (y en lastProblems)...", con una aserción nueva
`expect(document?.problems).toEqual(...)` además de la ya existente sobre `lastProblems`.

### Comandos y resultado

```
npx vitest run apps/desktop apps/web/src/store          # 10 archivos, 168 tests, todos verdes
npx tsc -p apps/desktop/tsconfig.json --noEmit           # limpio
npm run typecheck -w @lila/web                           # limpio
npm run build -w @lila/web && npm run build -w @lila/desktop   # ok
LILA_SMOKE=1 npx electron apps/desktop                   # {"ok":true,"consoleErrors":[],"loadFailure":null}
```

### Archivos tocados

- `apps/desktop/src/projectIO.ts` (P0-2)
- `apps/desktop/src/projectIO.test.ts` (P0-2, tests nuevos)
- `apps/web/src/store/DesktopStore.ts` (P0-1, P0-3)
- `apps/web/src/store/DesktopStore.test.ts` (P0-1, P0-3, tests nuevos/actualizados)
- Este archivo.

Nada de `main.ts`/`bridge.ts`/`safePaths.ts` cambió: `assertFolderNotOccupied`,
`requireAuthorizedDir` e `isSymlink` ya existían y ya funcionaban — los tres bugs estaban en cómo
(o si) el resto del código los invocaba, no en su lógica.
