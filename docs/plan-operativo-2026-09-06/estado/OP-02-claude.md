OP e incremento: OP-02, incremento 1
Equipo y responsable: B, Claude Sonnet 5
Modelo trabajador: Claude Sonnet 5
Host/arquitectura: macOS (Darwin 25.6.0), worktree dedicado
Worktree absoluto: /Users/brito/development/lila-wt-b-desktop
Rama: codex/op-b-desktop
SHA base: 71e653edfdaa19943048a352c4ba7df3072eddbd
SHA del código recuperable: bf5493814b558c42f7d184be569cf12d53b89fe5
Estado: listo-verificado
Archivos a mi cargo: apps/desktop/** (nuevo), package-lock.json (solo delta de instalar electron), docs/plan-operativo-2026-09-06/estado/OP-02-claude.md
Objetivo pequeño de este incremento: Electron arrancable sin Vite — main con protocolo `lila://`, preload con contextBridge, puente `window.lila` (openFolder/listFiles/readFile/writeFile), copia de `apps/web/dist` a `apps/desktop/dist/web`, y smoke headless con `LILA_SMOKE=1` que verifica lienzo+tema+fuente+puente.

Decisión / razón:
- Protocolo `lila://` (no `file://`): registrado con `protocol.registerSchemesAsPrivileged` antes de `whenReady`; `protocol.handle('lila', …)` sirve `apps/desktop/dist/web` con `resolveWithin`+`mimeFor` (`src/safePaths.ts`). Verificado: `fetch('/eva-01.json')`, `/assets/*`, la fuente `bpmn` y el Worker módulo funcionan sin tocar `vite.config.ts` (smoke con las 4 comprobaciones en `true`).
- **Preload en `.cts`, no `.ts` ni `.mts` (hallazgo no anticipado por el ticket)**: con `sandbox: true` (obligatorio, decisión de seguridad ya tomada) un preload **no admite ESM en absoluto**, ni siquiera nombrando el archivo `.mjs`. Con `dist/preload.js` (ESM por `"type":"module"`) Electron intenta `require()` y revienta con `SyntaxError: Cannot use import statement outside a module`; renombrar a `dist/preload.mjs` (vía `src/preload.mts`, NodeNext) reproduce el mismo error idéntico — el cargador de preload sandboxeado de Electron 44 simplemente no soporta `import`/`export` top-level, sea cual sea la extensión. Solución: `src/preload.cts` (NodeNext lo compila a CommonJS real, `dist/preload.cjs`), con `import electron = require('electron')` (sintaxis exigida por `verbatimModuleSyntax` en un archivo CJS) y `contextBridge`/`ipcRenderer` desestructurados de ahí. Confirmado con el smoke: `puente: true`, sin errores de consola.
- El preload sandboxeado tampoco puede `require()` archivos propios (solo un puñado de módulos integrados: `electron`, `events`, `timers`, `url`) — por eso `bridge.ts` se importa en `preload.cts` solo como tipo (`import type`, se borra al compilar) y el valor `platform: 'desktop'` se repite como literal con `satisfies LilaBridge`, para que un futuro cambio de `LILA_PLATFORM` en `bridge.ts` haga fallar el typecheck si no se actualiza también aquí.
- `resolveWithin(root, rel)` (`src/safePaths.ts`, puro, sin electron): decodifica `%xx` antes de resolver (atrapa `%2e%2e`), rechaza `isAbsolute(rel)` de entrada, y compara con `root + separador` como prefijo (no solo `root`) para que `/root2` no cuele como "dentro de" `/root`. La usan tanto el protocolo (`rel` = pathname de la URL sin la barra inicial) como los tres canales IPC que tocan disco.
- `dir` de `readFile`/`writeFile`/`listFiles` debe estar en el `Set` de carpetas autorizadas por `openFolder` (rechazo `E-NO-AUTORIZADO` si no); `rel` que resuelva fuera de `dir` rechaza con `E-RUTA-FUERA`; argumentos con tipo incorrecto rechazan con `E-ARGUMENTO`. Todo esto vive en `main.ts`, no es puro (usa `ipcMain`/`dialog`), así que no tiene test unitario propio — se apoya enteramente en `resolveWithin`, que sí lo tiene (24 casos).
- Ventana: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, sin `remote`. `setWindowOpenHandler` deniega siempre la creación de una `BrowserWindow` nueva; si la URL es `http(s)` se abre con `shell.openExternal` en el navegador del sistema.
- `apps/desktop/tsconfig.json` extiende `tsconfig.base.json` con `composite:false`, `declaration:false` y **`declarationMap:false`** (no estaba en la instrucción original, pero tsc exige apagarlo junto con `declaration` — si no, error TS5069).

Qué quedó implementado:
- `apps/desktop/package.json` (`@lila/desktop`, scripts `build`/`start`/`dev`/`typecheck`/`smoke`), `tsconfig.json`, `.gitignore` (`dist/`, `smoke/`).
- `src/safePaths.ts` + `src/safePaths.test.ts` (24 casos vitest: dentro de la carpeta, tildes/espacios, `..` simple y doble, absoluta (posix/win según `path.sep`), `%2e%2e` solo y mezclado con segmentos válidos, prefijo engañoso, `rel` vacío→root, mapa MIME completo + fallback).
- `src/bridge.ts`: `LilaBridge` + `LILA_PLATFORM = 'desktop'`, declara `Window.lila?: LilaBridge`.
- `src/preload.cts`: expone `window.lila` con las 4 operaciones, todo por `ipcRenderer.invoke`.
- `src/main.ts`: esquema privilegiado, `protocol.handle('lila', …)`, ventana endurecida, 4 handlers IPC validados (`openFolder`, `listFiles`, `readFile`, `writeFile`), y el modo `LILA_SMOKE=1` completo (espera `did-finish-load` + 3 s, `executeJavaScript` con las 4 comprobaciones, captura de consola/`did-fail-load`, `capturePage()` a `smoke/captura.png`, JSON por stdout, `app.exit(0|1)`).
- `scripts/copy-web.mjs`: `fs.cpSync` (no `cp -R`) de `apps/web/dist` a `apps/desktop/dist/web`.

Pruebas ejecutadas y resultado:
- `npx vitest run apps/desktop` → 1 archivo, 24/24 tests OK.
- `npm run typecheck -w @lila/desktop` → sin salida, sin errores (falló una vez por `verbatimModuleSyntax` con `import {...} from 'electron'` en `.cts`; corregido con `import electron = require('electron')`).
- `npm run build -w @lila/web` → `apps/web/dist` generado (783 KB de bundle, aviso de tamaño de chunk preexistente de Vite, no de este ticket); Vite no quedó corriendo.
- `npm run build -w @lila/desktop` → `tsc --build` + copia; `dist/{main.js,preload.cjs,bridge.js,safePaths.js,web/}` generados.
- `LILA_SMOKE=1 npx electron apps/desktop` (equivalente a `npm run smoke -w @lila/desktop`) → primer intento con preload `.js`/`.mjs`: `puente:false`, `SyntaxError: Cannot use import statement outside a module` (2 intentos, ver Decisión). Tercer intento con `.cts`: `{"lienzo":true,"tema":true,"fuente":true,"puente":true,"consoleErrors":[],"loadFailure":null,"ok":true}`, código de salida 0. Captura verificada visualmente: bpmn-js muestra el diagrama `pedido` completo con el tema Eva-01 (fondo oscuro, textos claros), la paleta a la izquierda y el panel de propiedades a la derecha — no está en blanco ni con estilos por defecto.

Qué NO está verificado:
- Los diálogos nativos (`showOpenDialog`) no se probaron interactivamente: no hay entorno para simular clic de usuario en un `dialog` real desde este agente. La ruta de cancelación (`null`, no error) está escrita según el contrato pero solo se revisó por lectura de código, no ejecutada.
- `npm run dev` (con `LILA_DEV_URL` apuntando a un Vite real corriendo) no se probó de punta a punta en esta sesión: se view-only-validó que el `if (devUrl) loadURL(devUrl) else …` es correcto, pero no se levantó `vite dev` en paralelo para confirmarlo. Riesgo bajo: es la misma API (`loadURL`) que ya usa la rama de protocolo, que sí se probó.
- Empaquetado real (electron-builder/forge) no es parte de OP-02 incremento 1; `app.getAppPath()` se razonó como correcto tanto en dev (`= apps/desktop`) como empaquetado, pero no hay un paquete `.app`/`.exe` para confirmarlo en esta ronda.
- No se cubrió con test unitario `requireAuthorizedDir`/`requireRelativeWithin` de `main.ts` directamente (no son puros, importan `electron`, que fuera de un proceso Electron no expone la API real) — están cubiertos indirectamente vía los 24 casos de `resolveWithin`, que es lo que realmente deciden.
- Windows: `sep === '\\'` se contempló en `safePaths.test.ts` (rama alterna de casos) pero no se ejecutó en una máquina Windows real.

Cambios todavía sin commit: ninguno; los 5 commits de este incremento (checkpoint inicial + 4 de código) están en `codex/op-b-desktop`, HEAD = bf5493814b558c42f7d184be569cf12d53b89fe5.

Próximo comando o acción concreta: ninguna pendiente para este incremento; el siguiente paso natural es que A conecte `DesktopStore` (LILA-071) contra `window.lila` y que F reciba `dist/main.js` como entrada de producción cuando llegue el empaquetado.

Dependencia que espero: contrato preliminar OP-01 no llegó durante esta sesión; se avanzó igual con las decisiones ya fijadas por el coordinador (no se reabrieron). Si OP-01 cambia algo del contrato de `LilaBridge`, revisar `bridge.ts`/`preload.cts` juntos (están acoplados a propósito).

Artefacto y SHA de origen, si existe: captura `apps/desktop/smoke/captura.png` (no versionada, `.gitignore`), generada en el commit bf54938 de este worktree.

Sesión trabajadora: activa
Cesión a otro equipo: no

## Peticiones a A

1. **Detección del adaptador nativo**: `apps/web` puede detectar Electron con `typeof window.lila !== 'undefined'` (o `window.lila?.platform === 'desktop'`). No se tocó `apps/web/**` en este incremento — es petición, no cambio hecho.
2. **Tipos del puente**: `DesktopStore` (LILA-071) debería importar el tipo `LilaBridge` de `apps/desktop/src/bridge.ts` (o de donde A decida reexportarlo/copiarlo si `apps/web` no puede depender de `apps/desktop` como paquete) en vez de redeclarar la forma de `window.lila` por su cuenta. La interfaz expone exactamente `platform`, `version`, `openFolder()`, `listFiles(dir)`, `readFile(dir, rel)`, `writeFile(dir, rel, content)` — sin más superficie.
3. Si `apps/web` necesita compilar contra `@lila/desktop` como dependencia de tipos, avisar: por ahora `apps/desktop` no está en el grafo de dependencias de `apps/web` (a propósito, para no acoplar build de la web al de desktop) — habría que decidir si se referencia por `tsconfig` `paths`/`references` o si se copia el tipo.

## Delta de `package-lock.json`

Un solo delta: registro del workspace `apps/desktop` (`@lila/desktop@0.0.1`) y `electron@44.2.0` (exacta) + sus 10 dependencias transitivas de Electron (`@electron/*`, `undici-types`, etc. — el árbol estándar del paquete `electron` npm, que solo descarga el binario en `postinstall`). No se añadió ninguna otra dependencia de producción ni de desarrollo fuera de `electron`.
