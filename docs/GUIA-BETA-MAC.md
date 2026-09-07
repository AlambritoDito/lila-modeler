# Guía de la beta de escritorio (macOS)

Esta guía describe únicamente lo que existe y se ha verificado en el commit `287e3e2` de
`codex/op-e-paneles` (2026-09-06). No incluye nada prometido o planificado: donde algo todavía no
está conectado, se dice explícitamente en «Limitaciones de esta beta».

## Requisitos

- Mac con **Apple Silicon (arm64)**. El artefacto de esta beta solo se compila para `arm64`
  (`apps/desktop/electron-builder.yml`); no hay build de Intel (`x64`).
- **macOS 13 (Ventura) o más reciente** (`LSMinimumSystemVersion` del `.app` empaquetado).
- Sin requisitos de instalación adicionales: la app trae Electron con su propio Chromium y Node,
  no depende de tener Node instalado en la máquina.

## Dónde está el instalador y cómo abrirlo sin firma

El instalador es un `.dmg` generado con `electron-builder` (`npm run dist:mac -w @lila/desktop`),
por ejemplo `Lila Modeler-0.0.1-mac-arm64.dmg`. No se distribuye dentro del repositorio (la carpeta
`apps/desktop/release/` está en `.gitignore`): hay que compilarlo (ver más abajo) o recibirlo por
el canal que use el equipo.

La app **no está firmada ni notarizada** (`identity: null` en `electron-builder.yml`, beta local).
macOS Gatekeeper bloquea un `.app` sin firma la primera vez que se abre. Dos formas de pasar ese
aviso:

1. **Clic derecho sobre `Lila Modeler.app` → Abrir** (no doble clic normal). Aparece un aviso de
   "desarrollador no identificado" con un botón "Abrir" que un doble clic no ofrece.
2. O, desde Terminal, quitar el atributo de cuarentena que macOS pone a lo descargado:
   ```bash
   xattr -d com.apple.quarantine "/ruta/a/Lila Modeler.app"
   ```

Sin icono propio todavía (issue #76): la app usa el icono por defecto de Electron en el Dock y en
el Finder.

## Qué muestra la ventana al abrir

La app arranca siempre con el mismo diagrama de ejemplo incluido en el propio bundle: el proceso
`pedido` de `examples/pedido/model.bpmn` (import directo en `apps/web/src/main.tsx`, no un archivo
externo). Se ve con el tema **Eva-01** (fondo oscuro, texto claro, paleta de bpmn-js a la
izquierda, panel de propiedades a la derecha) — es el tema por defecto que trae `tokens.css` y el
que carga `eva-01.json` al vuelo.

## Recorrido de uso

La barra superior tiene cuatro modos: **Modelar**, **Simular**, **Resultados**, **Comparar**. Los
textos de abajo son literales de la interfaz (`apps/web/src/App.tsx`), no paráfrasis.

### Modelar

- **Abrir .bpmn**: abre un selector de archivo nativo para importar cualquier `.bpmn`/`.xml`.
- El lienzo central es el editor de bpmn-js: se edita arrastrando figuras de la paleta, igual que
  cualquier editor de bpmn.io.
- **Deshacer** / **Rehacer**: barra inferior, junto al nombre del archivo activo.
- **Exportar .bpmn**: exporta el XML actual (lo que produce lo puede volver a validar
  `npx lila validate`, mismo contrato que usa la CLI).

### Simular (pestaña "Simulación" del panel derecho)

- Selector **Escenario**: elige entre los escenarios cargados (el proyecto trae `as-is` y
  `to-be-3-cajeros` de ejemplo).
- El panel de escenario permite editar `run`, `calendars`, `resources` y las propiedades por
  elemento del proceso. Los campos con forma de unión —hoy solo `resources.<id>.capacity`— tienen
  un selector explícito **Fija** (un número) / **Por turno** (una lista de tramos
  `{ calendar, capacity }`, con `calendar` como desplegable de los calendarios ya declarados).
- Un campo reservado heredado de un `extends` muestra un botón **Quitar heredado** (o **Quitar**
  si es propio del archivo, no heredado): al pulsarlo se escribe `null` en el delta, que es la
  forma de "borrar" un valor heredado (§ 6 del formato de escenario). Si ya está borrado, el botón
  cambia a **Restaurar heredado**, que quita ese `null` y vuelve a heredar del padre.
- **Guardar** (dentro del panel de escenario) y **Duplicar** (crea una copia con `extends` sobre el
  archivo actual — el "qué pasaría si" de la casa) son botones aparte de "Guardar proyecto" de la
  barra superior; no se deshabilitan nunca.
- **Simular**: corre la simulación sobre lo que hay en el lienzo ahora mismo. Mientras corre,
  aparece **Cancelar** y un progreso (`% · replicación N`). El interruptor **Cuellos de botella**
  pinta o apaga el overlay sobre el diagrama sin volver a simular.

### Resultados

Al terminar una simulación, la app cambia sola a este modo. Cada tabla (elementos, flujos,
recursos, proceso) tiene su propio botón **Exportar CSV**, que descarga exactamente el mismo
contenido, byte a byte, que `npx lila run --csv` escribe en disco (`elements.csv`, `flows.csv`,
`resources.csv`, `process.csv`).

### Comparar

- Selector **Escenario base**: cualquier escenario ya simulado puede ser la base de la
  comparación.
- Casilla **Mostrar todos los KPI**: por defecto la tabla de flujos queda oculta; esta casilla la
  muestra.
- Sección **Avisos**: solo aparece cuando hay algo que decir, y agrupa hasta cinco tipos, en este
  orden:
  1. *Costos en monedas distintas*: si las corridas comparadas no usan la misma moneda
     (`run.currency`), ningún delta de costo se marca como comparable — el aviso lo dice
     explícitamente y las celdas de costo no llevan el asterisco de significancia.
  2. *Unidades de tiempo distintas*: cada corrida se muestra con la unidad con la que se generó
     (`run.baseTimeUnit`), sin normalizar.
  3. *Sin intervalos de confianza*: si alguna corrida tiene menos de 2 réplicas, no hay IC95 y por
     lo tanto ninguna diferencia se marca como significativa en ninguna tabla.
  4. *Semillas distintas*: aviso informativo, no bloquea nada.
  5. *Número de réplicas distinto*: igual, informativo.
- Sección **Significancia**: el asterisco (`*`) en una celda significa "diferencia significativa
  (IC95 sin solapamiento) contra la base"; las celdas resaltadas son las que cambiaron respecto a
  la base. Si el aviso 3 de arriba aplica, esta sección lo repite y no se pinta ningún asterisco.

### Guardar y recuperar

- **Nuevo proyecto**, **Abrir proyecto**, **Guardar proyecto**, **Guardar como**: botones de la
  barra superior. La barra de título también dice "Sin guardar"/"Guardado" según haya cambios
  pendientes.
- **Importante — qué hace esto hoy en esta beta, no lo que hará después**: en `287e3e2`,
  `apps/web/src/main.tsx` todavía elige `BrowserStore` de forma fija (línea marcada en el propio
  código: *"Único punto de elección BrowserStore/DesktopStore"*), incluso dentro de la app
  empaquetada de escritorio. Eso significa que:
  - **Guardar proyecto** / **Guardar como** descargan **un único archivo** `<nombre>.lila.json`
    con todo el proyecto embebido (modelo, escenarios y corridas), por el mecanismo de descarga
    del navegador — no escriben ninguna carpeta.
  - **Abrir proyecto** abre un selector de archivo nativo para elegir ese `.lila.json` (o `.json`
    equivalente), no una carpeta.
  - **No se verificó interactivamente** en esta ronda a qué carpeta del disco cae esa descarga
    dentro de la app empaquetada (no hay entorno para simular el clic de un diálogo nativo desde
    este agente, igual que ya quedó anotado en OP-02): revisar las Preferencias de descargas del
    sistema si el archivo no aparece donde se espera.
- Ya existe, en `apps/desktop/src/projectIO.ts`, el código que sabe leer y escribir un **proyecto
  como carpeta** — `model.bpmn`, un archivo `*.scenario.json` por escenario, `lila-project.json`
  (metadatos: id, nombre, revisiones) y una subcarpeta `runs/` con una corrida por archivo — y el
  puente de Electron (`chooseFolder`/`readProject`/`writeProject`) para hablar con esa carpeta.
  **Pero todavía no está enchufado a la interfaz** (`DesktopStore` no se instancia en `main.tsx`):
  hasta que eso pase, "carpeta de proyecto" es una descripción de lo que existe en el código, no
  de lo que se puede usar hoy desde los botones de arriba.

## Limitaciones de esta beta

*(a fecha 2026-09-06, commit `287e3e2`; revisar si alguna de estas ya se resolvió antes de creer
esta lista a ciegas en una fecha posterior)*

- **Sin firma ni notarización**: hace falta clic derecho → Abrir o `xattr -d
  com.apple.quarantine` la primera vez (ver arriba).
- **Sin icono propio** (issue #76): usa el icono por defecto de Electron.
- **Solo macOS arm64 probado**: Windows (NSIS) y Linux (AppImage/deb) están configurados en
  `electron-builder.yml` y en la matriz de CI (`.github/workflows/desktop.yml`), pero no se han
  compilado ni probado en ningún runner real todavía.
- **Persistencia en carpeta pendiente del bootstrap**: `DesktopStore` existe y tiene sus propias
  pruebas, pero `main.tsx` no lo usa; "Guardar proyecto" en la app empaquetada de hoy descarga un
  archivo suelto, no escribe una carpeta de proyecto (ver sección anterior).
- **Editor visual de calendarios pospuesto**: `calendars` se edita con los mismos campos de
  formulario genérico que el resto del escenario (números, texto, listas de intervalos); no hay
  todavía una vista de calendario/horario dibujada.
- **Diálogos nativos no probados de forma interactiva**: la ruta de "cancelar" un selector de
  archivo o de carpeta está escrita según el contrato pero no se ha ejercitado con un clic real de
  usuario en esta ronda (mismo límite que documentó OP-02).
- **Sin conversión de moneda ni normalización de unidades entre corridas**: si se comparan
  escenarios con `currency` o `baseTimeUnit` distintos, la app avisa (ver "Comparar" arriba) en vez
  de inventar una conversión.
- **La guía MCP (stdio, `run_simulation`/`compare_scenarios`) no forma parte de este incremento**:
  ver `docs/MCP.md`, que es propiedad de otro paquete de trabajo (OP-17 incremento 2, issues
  #56/#48).

## Cómo reconstruir desde el código

Desde la raíz del repositorio, en orden:

```bash
npm ci                              # solo la primera vez, o si package-lock.json cambió
npm run build -w @lila/engine       # compila el motor de simulación (TypeScript)
npm run build -w @lila/web          # compila engine (si hiciera falta) + build de Vite
npm run dist:mac -w @lila/desktop   # tsc + copia dist/web + electron-builder --mac --arm64
```

El último comando encadena: `tsc --build` de `apps/desktop`, copia de `apps/web/dist` a
`apps/desktop/dist/web`, y `electron-builder --mac --arm64`. El resultado queda en
`apps/desktop/release/`:

- `Lila Modeler-<versión>-mac-arm64.dmg` — el instalador.
- `Lila Modeler-<versión>-mac-arm64.dmg.blockmap`.
- `mac-arm64/Lila Modeler.app` — la app sin empaquetar en DMG, útil para probar rápido.
- `ORIGEN.txt` — `sha`, `fecha` (ISO) y `arch` (`uname -m`) del build, escrito por
  `apps/desktop/scripts/origen.mjs` al final de `dist:mac`.

Si Vite ya está corriendo en la máquina (por ejemplo `npm run dev -w @lila/web` de otra sesión),
apágalo antes de compilar `dist:mac`: el build de producción no lo necesita y dos procesos
compitiendo por el mismo puerto solo añade ruido a los logs, aunque no rompe el build en sí (el
binario final carga por el protocolo `lila://`, no por `http://localhost`).

Para probar el `.app` sin generar el DMG (más rápido, útil en desarrollo):

```bash
npm run pack:mac -w @lila/desktop   # mismo build, pero --dir en vez de --mac
```

Verificación mínima de que el paquete arranca, sin abrir ventana:

```bash
LILA_SMOKE=1 "apps/desktop/release/mac-arm64/Lila Modeler.app/Contents/MacOS/Lila Modeler"
```

Imprime un JSON (`lienzo`, `tema`, `fuente`, `puente`, `consoleErrors`, `loadFailure`, `ok`) y
sale con código 0 si todo carga bien; la captura queda en una carpeta temporal del sistema
(`$TMPDIR/lila-smoke/captura.png` fuera de `app.asar`, que es de solo lectura en el paquete).
