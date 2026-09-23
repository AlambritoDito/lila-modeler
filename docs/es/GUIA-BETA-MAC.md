# Guía de la beta de escritorio (macOS)

> Leer en: [English](../BETA-MAC-GUIDE.md)

Esta guía parte de la beta verificada sobre el SHA `358353d` (2026-09-07),
con el branding y la instalación actualizados el 2026-09-14: `DesktopStore` ya está conectado en `main.tsx`
(`apps/web/src/main.tsx`, "Único punto de elección BrowserStore/DesktopStore"), con guardado
transaccional, cierre seguro con diálogo nativo, recientes y el seam de pruebas E2E descritos
abajo. No incluye nada prometido o planificado: donde algo todavía no está conectado, se dice
explícitamente en «Limitaciones de esta beta».

## Requisitos

- Mac con **Apple Silicon (arm64)**. El artefacto de esta beta solo se compila para `arm64`
  (`apps/desktop/electron-builder.yml`); no hay build de Intel (`x64`).
- **macOS 13 (Ventura) o más reciente** (`LSMinimumSystemVersion` del `.app` empaquetado).
- Sin requisitos de instalación adicionales: la app trae Electron con su propio Chromium y Node,
  no depende de tener Node instalado en la máquina.

## Dónde está el instalador y cómo abrirlo sin firma

El instalador es un `.dmg` generado con `electron-builder` (`npm run dist:mac -w @lila/desktop`),
llamado `Lila-Modeler-1.0.0-beta.1-mac-arm64.dmg` para esta versión (guiones, sin espacios,
igual que la entrada del archivo `SHA256SUMS`). Descarga ambos desde
[la versión `v1.0.0-beta.1`](https://github.com/AlambritoDito/lila-modeler/releases/tag/v1.0.0-beta.1)
— no `/releases/latest`, porque GitHub excluye los prereleases de ese enlace. Solo el `.dmg` de
macOS arm64 y `SHA256SUMS` están adjuntos a la Beta 1; no hay instalador de Windows ni Linux en
este release (CI los sigue compilando, pero como artefactos sin probar — ver «Limitaciones» más
abajo). El `.dmg` no se distribuye dentro del repositorio (la carpeta `apps/desktop/release/` está
en `.gitignore`): también puedes compilarlo tú mismo (ver más abajo).

**Verifica la descarga** antes de abrirla, con ambos archivos en la misma carpeta:

```bash
shasum -a 256 -c SHA256SUMS
```

La app **no está firmada ni notarizada** (`identity: null` en `electron-builder.yml`).

### Primer arranque sin firma (macOS 15 y más reciente)

En macOS reciente (Sequoia 15, y la línea 26/27), el primer doble clic sobre la app descargada
queda bloqueado directamente, sin una opción de «abrir de todos modos» en el diálogo de bloqueo:

1. Ve a **Ajustes del Sistema ▸ Privacidad y seguridad**, busca el mensaje de seguridad que nombra
   «Lila Modeler» y pulsa **Abrir de todos modos**. Luego arranca la app de nuevo (doble clic, o
   Control-clic ▸ **Abrir**) y confirma **Abrir** en el diálogo que sigue.
2. En macOS más antiguo, Control-clic (clic derecho) sobre la app en Finder ▸ **Abrir** ▸ **Abrir**
   funciona directamente, sin pasar por Ajustes del Sistema.

En cualquiera de los dos casos, esta autorización es un paso único por copia de la app — es la
forma en que macOS trata el software fuera de la App Store que no está notarizado. No desactives
Gatekeeper para evitar esto. La Beta 1 verificó en macOS 27.0 que la descarga en cuarentena se bloquea en el primer arranque y que Ajustes del Sistema ▸ Privacidad y seguridad ofrece Abrir de todos modos (la app lleva un sello ad hoc, así que macOS no la reporta como dañada).

La app utiliza el icono ilustrado detallado de Lila en el Dock y en el Finder.

## Archivos de proyecto: `.lila` frente a `.bpmn`

Dos tipos de archivo se registran en Finder y abren esta app con doble clic (verificación de la Beta 1: ver Limitaciones):

- **`.lila`** es el contenedor completo del proyecto: el modelo, sus escenarios, revisiones y
  corridas guardadas, comprimidos en un solo archivo (ver [`PROJECT_FORMAT.md`](../PROJECT_FORMAT.md)).
  Es la forma de entregárselo a alguien más — todo lo que necesita, autocontenido.
- **`.bpmn`** suelto es solo el diagrama, sin escenarios ni corridas asociadas. Abrir un `.bpmn`
  suelto y guardar (`⌘S`) reescribe ese mismo `.bpmn` en su sitio; no crea una carpeta de proyecto
  ni un `.lila` a menos que uses explícitamente **Guardar como…** (ver «Guardar y recuperar» más
  abajo).

**Respaldo**: guarda una copia del `.lila` (o de la carpeta de proyecto) antes de ediciones
grandes — la app no versiona tu trabajo más allá del flujo de «Guardar como…». El almacenamiento
local del navegador en la demo web no es un respaldo: vive solo en el almacenamiento de ese
navegador en esa máquina, y se pierde si borras los datos del sitio o cambias de navegador o
perfil. Trata un `.lila` descargado como la copia durable.

## Qué muestra la ventana al abrir

La app arranca siempre con el mismo diagrama de ejemplo incluido en el propio bundle: el proceso
`pedido` de `examples/pedido/model.bpmn` (import directo en `apps/web/src/main.tsx`, no un archivo
externo). Se ve con el tema **Eva-01** (fondo oscuro, texto claro, paleta de bpmn-js a la
izquierda, panel de propiedades a la derecha) — es el tema por defecto que trae `tokens.css` y el
que carga `eva-01.json` al vuelo.

## Recorrido de uso

La barra superior tiene seis modos: **Modelar**, **Simular**, **Resultados**, **Comparar**,
**Animar** y **Validar rutas**. Los textos de abajo son literales de la interfaz (desde LILA-066 todos viven en
`apps/web/src/strings.es.ts`), no paráfrasis.

### Modelar

- En escritorio se trabaja con **Nuevo proyecto** y **Abrir proyecto** por carpeta. También puedes
  abrir un `.bpmn` suelto con doble clic (ver Limitaciones). Usa **Guardar
  como** para conservar sus escenarios y
  corridas en una carpeta de proyecto, como se describe más abajo.
- El lienzo central es el editor de bpmn-js: se edita arrastrando figuras de la paleta, igual que
  cualquier editor de bpmn.io.
- **Deshacer** / **Rehacer**: barra inferior, junto al nombre del archivo activo.
- El XML editado se guarda como `model.bpmn` dentro de la carpeta del proyecto.

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

### Validar rutas

- **No es la simulación DES del motor**: anima los tokens de `bpmn-js-token-simulation` sobre el
  diagrama abierto. No lee el escenario activo ni produce resultados, y la propia pestaña lo dice:
  «Animación de tokens de bpmn-js: no es simulación de eventos discretos; no usa el escenario ni
  produce resultados.» Sirve para ver a ojo por dónde pasan las rutas, no para medir.
- Mientras el modo está activo no se pintan el overlay de cuellos de botella ni los marcadores de
  validación, y el diagrama no se puede editar; al volver a **Modelar** todo vuelve a su sitio.
- Los controles son los del propio módulo de bpmn.io, y desde LILA-205 (#264) **salen en español**:
  la paleta de la izquierda del lienzo («Reproducir o pausar la simulación», «Reiniciar
  simulación», «Registro de la simulación»), los botones que aparecen sobre las figuras («Disparar
  evento» para arrancar desde un evento de inicio, «Añadir punto de pausa» para parar en una
  actividad y avanzar paso a paso, «Elegir el flujo de salida» para la salida de una compuerta) y
  los avisos del registro. El módulo no usa el servicio `translate` de bpmn-js —lleva sus textos
  escritos dentro del HTML—, así que la traducción se hace sustituyéndolos en el lienzo
  (`traducirSimulacion` en `apps/web/src/TokenSim.tsx`, con el inventario en `strings.es.ts`): si
  algún día se actualiza el módulo y cambia un rótulo, ese rótulo volverá a verse en inglés, nunca
  roto.
- El diagrama **conserva los colores del tema** durante la animación (#264). De fábrica el módulo
  lo repinta en blanco y negro mientras dura el modo, pensado para un lienzo blanco; Lila
  sustituye dos de sus servicios (`moduloColoresDelTema` en `apps/web/src/TokenSim.tsx`) para que
  pinte con los tokens del tema. La salida elegida de una compuerta se marca con el color de
  selección del tema (lima en Eva-01, rojo en Papel) y la descartada con el de una conexión
  normal; los marcadores propios de la animación —el verde de los ámbitos, el contador de
  tokens— se quedan como vienen.

### Guardar y recuperar

Esto ya es funcionalidad real: `DesktopStore` está conectado en `main.tsx` y escribe/lee una
**carpeta de proyecto** en disco, no un archivo suelto descargado por el navegador.

- **Nuevo proyecto**: pide elegir una carpeta. Puede estar vacía, o contener ya un proyecto del
  mismo id (para volver a guardar ahí); una carpeta con contenido de **otro** proyecto
  (`lila-project.json` de otro id, o un `model.bpmn` sin manifiesto que coincida) se rechaza con
  `E-CARPETA-OCUPADA` sin tocar nada de lo que ya había.
- **Abrir proyecto**: selector de carpeta nativo; carga el proyecto que haya ahí.
- **Guardar proyecto**: guarda en la carpeta activa (la del último "Nuevo"/"Abrir"/"Guardar como"
  con éxito).
- **Guardar como…**: pide dónde crear un **`.lila`** nuevo —el proyecto entero en un archivo
  (ADR-027), la forma de mandárselo a alguien—. **Guardar como carpeta…** hace lo mismo hacia una
  carpeta de proyecto, que es la forma que conviene para versionar con git. Las dos aplican las
  mismas reglas de `E-CARPETA-OCUPADA` que "Nuevo proyecto": un destino que ya contiene *otro*
  proyecto se rechaza sin tocarlo.
- La barra superior muestra `<nombre del proyecto> · Sin guardar` o `· Guardado` según haya
  cambios pendientes (`apps/web/src/App.tsx`).
- **Cerrar con cambios sin guardar**: la ventana (botón rojo, Cmd+Q, o cerrarla desde el Dock)
  muestra el diálogo nativo del sistema con **Guardar / Descartar / Cancelar**. "Guardar" espera
  hasta 30 s la respuesta de la app antes de cerrar; si falla o no llega, se avisa y la ventana no
  se cierra. Al cerrar la última ventana termina la aplicación también en Mac; al reabrir, usa **Abrir proyecto** para recuperar la carpeta guardada.
- **Qué archivos hay en la carpeta de un proyecto**: `model.bpmn` (el diagrama), un
  `<nombre>.scenario.json` por cada escenario (por ejemplo `as-is.scenario.json`,
  `to-be.scenario.json`), `lila-project.json` (metadatos: id, nombre, revisiones) y una subcarpeta
  `runs/` con una corrida guardada por archivo.
- **Un `.bpmn` con otro nombre dentro de la carpeta se guarda como diagrama suelto**: el
  manifiesto (`lila-project.json`) describe **solo** `model.bpmn` — su nombre y su revisión. Si
  abres `ventas.bpmn` (doble clic) en una carpeta que ya es un proyecto Lila, `⌘S` escribe ese
  `ventas.bpmn` y nada más: `model.bpmn`, los escenarios y el manifiesto se quedan byte a byte como
  estaban, y las corridas no se guardan. La barra inferior lo avisa mientras ese diagrama está
  abierto — «Diagrama suelto: los escenarios y las corridas no se guardan hasta «Guardar como»» —,
  igual que con un `.bpmn` suelto en `~/Descargas`: es el mismo modo de guardado. Al reabrir la
  carpeta desde recientes vuelve a verse el proyecto de `model.bpmn`, no el otro diagrama. Para convertir
  `ventas.bpmn` en un proyecto propio, usa **Guardar como** hacia una carpeta nueva: ahí el XML pasa
  a ser el `model.bpmn` de ese proyecto nuevo (**Guardar como** siempre escribe `model.bpmn`; pedirle
  otro nombre de archivo se rechaza con `E-DESTINO-INVALIDO`, porque dejaría una carpeta sin
  manifiesto que ya no se podría reabrir). Elegir la MISMA carpeta del proyecto se rechaza con un
  aviso («esta carpeta ya tiene su `model.bpmn`»): ahí «Guardar como» pisaría el modelo del proyecto
  con el diagrama suelto. Un `.bpmn` suelto que **no** está dentro de un proyecto —el de
  `~/Descargas`— sí puede convertirse en proyecto en su propia carpeta: no hay `model.bpmn` ni
  manifiesto que pisar y el proyecto se crea al lado, dejando el `.bpmn` original como estaba.
- **`Model.bpmn` (con mayúsculas) no se abre DENTRO de una carpeta de proyecto**: si al lado hay un
  `lila-project.json`, se rechaza con `E-ARGUMENTO` y el mensaje pide renombrarlo. En Mac el disco no
  distingue mayúsculas, así que ahí ese archivo **es** el `model.bpmn` del proyecto, pero la app lo
  tomaría por «otro diagrama» y guardaría a medias (el modelo sí, el manifiesto y los escenarios no).
  Fuera de un proyecto —un `Model.bpmn` en `~/Descargas`, por ejemplo— se abre y se guarda con
  normalidad, como cualquier diagrama suelto.
- **Un escenario con JSON roto no impide abrir el proyecto**: ese archivo se excluye y queda
  anotado en `problems`; el resto del proyecto (modelo y los demás escenarios) se abre con
  normalidad. Esto sí se muestra en la interfaz: `App.tsx` lee `doc.problems` al activar el
  proyecto y lo pinta como aviso (`<span role="alert">`) con el archivo y el motivo.
- **Guardar en una carpeta sin permisos de escritura** muestra un error (`E-DESTINO-INVALIDO`) y
  no pierde nada: el archivo anterior queda intacto y la barra sigue marcando "Sin guardar". El
  mensaje que se ve hoy es el texto crudo de Electron ("Error invoking remote method…"), no una
  traducción amigable (ver «Limitaciones»).
- **Cambios externos en disco** (alguien más — u otro proceso — modificó `model.bpmn`, el
  manifiesto o un escenario después de que esta ventana lo leyó o guardó por última vez):
  al intentar guardar, la app rechaza con `E-CAMBIO-EXTERNO: <archivos>` sin tocar disco. **Hoy no
  hay un botón "Sobrescribir"**: la única salida disponible desde la interfaz es "Guardar como"
  (hacia otra carpeta).

### Recientes y ventana

- El tamaño/posición de la ventana y la lista de proyectos recientes se guardan en
  `~/Library/Application Support/Lila Modeler/estado.json`, y se restauran al volver a abrir la
  app (si la ventana guardada ya no cabe en ninguna pantalla conectada, se usa el tamaño por
  defecto).
- **Archivo → Abrir reciente** lista esos proyectos (más nuevo primero) y los reabre sin
  diálogo; si la carpeta ya no existe, desaparece de la lista y la app lo dice en la barra de
  estado. El menú nativo trae además Nuevo (`⌘N`), Abrir (`⌘O`), Guardar (`⌘S`), Guardar como
  (`⇧⌘S`) y **Preferencias… (`⌘,`)** en el menú de la app.

### Ajustes

- `⌘,` (o el botón ⚙ de la barra, o «Tema: …» en la barra de estado) abre **Ajustes →
  Apariencia**: uno de cinco temas (Eva-01 oscuro, Papel claro, Tieso claro, Akira oscuro, Montana
  morado) y densidad (compacta, normal, cómoda). El cambio
  de tema es inmediato, repinta también el diagrama y se recuerda entre arranques (localStorage de
  la app, bajo `lila://`). Cambiar de tema vuelve a montar el lienzo, así que vacía la pila de
  deshacer; el diagrama y los cambios sin guardar se conservan.
- El editor de colores por token e importar/exportar temas es LILA-114 (#144), pendiente.

## Limitaciones de esta beta

*(a fecha 1.0.0-beta.1, tag `v1.0.0-beta.1`; revisar si alguna de estas ya se resolvió antes de creer
esta lista a ciegas en una fecha posterior)*

- **Sin firma ni notarización**: una copia recibida requiere la autorización de apertura de macOS
  (ver «Primer arranque sin firma» arriba). Esto es esperado; no desactives Gatekeeper para
  evitarlo.
- **Solo macOS arm64 se ofrece y está probado**: los instaladores de Windows (NSIS) y Linux
  (AppImage) los compila la matriz de CI (`.github/workflows/desktop.yml`) como artefactos sin
  probar; no están adjuntos al release de la Beta 1 y nadie del proyecto los ha probado.
- **Doble clic en Finder**: La Beta 1 verificó la ruta open-file de macOS para `.lila` en macOS 27.0 (arm64) con `open -a`, el mismo evento que Finder envía al hacer doble clic, con la app cerrada y ya abierta, incluido un nombre con acentos y raya. El doble clic físico en Finder, y abrir así un `.bpmn`, no se ejercieron.
- **Guardar un `.lila` abierto por doble clic o argumento de lanzamiento está arreglado en la
  Beta 1 (#378)**. verificado en la Beta 1 con la regresión en Electron real de `tools/e2e-desktop-open-path.mjs` (argumento de arranque, evento open-file, recientes, diálogo; ASCII, espacios, acentos en NFC y NFD)
- **Mensajes de error crudos**: algunos errores llegan sin traducir a la interfaz — el JSON crudo
  de validación de `zod` (por ejemplo, un escenario que referencia un id de tarea inexistente) y
  el texto genérico de Electron "Error invoking remote method…" (por ejemplo, al guardar en una
  carpeta sin permisos).
- **Editor visual de calendarios pospuesto**: `calendars` se edita con los mismos campos de
  formulario genérico que el resto del escenario (números, texto, listas de intervalos); no hay
  todavía una vista de calendario/horario dibujada.
- **`Exportar CSV` solo está disponible en el modo Resultados**, no en Comparar.
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
`apps/desktop/release/` (la versión en `apps/desktop/package.json`: `1.0.0-beta.1` para la Beta 1):

- `apps/desktop/release/Lila-Modeler-1.0.0-beta.1-mac-arm64.dmg` — el instalador.
- `apps/desktop/release/Lila-Modeler-1.0.0-beta.1-mac-arm64.dmg.blockmap`.
- `apps/desktop/release/mac-arm64/Lila Modeler.app` — la app sin empaquetar en DMG, útil para
  probar rápido.
- `apps/desktop/release/ORIGEN.txt` — `sha`, `fecha` (ISO) y `arch` (`uname -m`) del build,
  escrito por `apps/desktop/scripts/origen.mjs` al final de `dist:mac`.

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

## Para agentes/QA: seam E2E

`apps/desktop/src/main.ts` acepta tres variables de entorno pensadas **únicamente para pruebas
automatizadas** (por ejemplo, para que un agente sin manos accione diálogos nativos que de otra
forma no puede tocar). No son una API pública ni deben usarse en un uso normal de la app:

- `LILA_E2E_FOLDER=<ruta absoluta>`: hace que `chooseFolder` devuelva esa ruta directamente, sin
  abrir el selector nativo (la crea si falta, y la autoriza igual que lo haría el diálogo real).
  El valor literal `"cancel"` simula que el usuario cerró el selector sin elegir nada.
- `LILA_E2E_CLOSE=save|discard|cancel`: hace que el diálogo nativo de "cerrar con cambios sin
  guardar" (Guardar/Descartar/Cancelar) resuelva automáticamente con ese valor, en vez de esperar
  un clic.
- `LILA_E2E_LOG=<ruta de archivo>`: si está presente, añade una línea JSON por cada evento
  relevante (`chooseFolder`, `writeProject`, `closeRequested`, `openPath`) a ese archivo.

Sin ninguna de las tres, el comportamiento de la app es exactamente el mismo que si no existieran.
**Advertencia**: son un atajo para pruebas, no algo que un usuario final deba fijar nunca — dejan
la app respondiendo diálogos por sí sola sin intervención humana.

## Branding e instalación registrada

El arranque del editor web y de escritorio muestra el logo detallado de Lila y la
versión del manifiesto hasta que el lienzo esté listo, con recuperación ante errores.
La decisión visual y la instalación de validación del 14 de septiembre de 2026 están
registradas en [BRANDING.md](BRANDING.md).
