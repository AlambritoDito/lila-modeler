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

Ver más abajo (se añade tras completar y verificar este incremento).
