# Guía de la beta de escritorio (macOS)

> Leer en: [English](../BETA-MAC-GUIDE.md)

¿Usas Windows? Mira la [guía para probar en Windows](GUIA-PROBADOR-WINDOWS.md). El estado por
plataforma está en el [README](../../README.es.md#beta-de-escritorio).

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

El instalador es un `.dmg` generado con `electron-builder` (`npm run dist:mac -w @lila-modeler/desktop`),
llamado `Lila-Modeler-1.0.0-beta.16-mac-arm64.dmg` para la versión actual (guiones, sin espacios,
igual que la entrada del archivo `SHA256SUMS`). Descárgalo junto con `SHA256SUMS` desde
[la versión `v1.0.0-beta.16`](https://github.com/AlambritoDito/lila-modeler/releases/tag/v1.0.0-beta.16)
— no `/releases/latest`, porque GitHub excluye los prereleases de ese enlace. El release también
adjunta el instalador de Windows (`Lila-Modeler-1.0.0-beta.16-win-x64.exe`), que está sin firmar y
sin probar en una máquina Windows real: ver la [guía para probar en
Windows](GUIA-PROBADOR-WINDOWS.md). No hay instalador de Linux en el release (CI construye un
AppImage, sin probar — ver «Limitaciones» más abajo). El `.dmg` no se distribuye dentro del repositorio (la carpeta `apps/desktop/release/` está
en `.gitignore`): también puedes compilarlo tú mismo (ver más abajo).

**Verifica la descarga** antes de abrirla, con ambos archivos en la misma carpeta:

```bash
shasum -a 256 -c --ignore-missing SHA256SUMS
```

`SHA256SUMS` también lista el instalador de Windows; `--ignore-missing` lo omite si no lo descargaste.

La app lleva un **sello ad hoc pero no está notarizada**: no tiene firma de Developer ID
(`identity: null` en `electron-builder.yml`; `scripts/adhoc-sign.cjs` sella el paquete tras
empaquetar).

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

El arranque en el navegador y en escritorio muestra el logo horizontal detallado de Lila y la
versión del manifiesto hasta que el lienzo inicial está listo. El arranque ofrece recarga con
recuperación localizada ante un fallo y respeta el movimiento reducido. Ver la [decisión de
marca](../design/branding/DECISION.md) y el [registro de instalación local del
2026-09-14](../design/branding/INSTALLATION-2026-09-14.md).

Cuando no se hizo doble clic sobre nada, la app de escritorio muestra entonces una superposición
de **bienvenida** (artboard 08 del diseño): abrir un archivo de proyecto `.lila`, abrir una
carpeta de proyecto, crear un proceso nuevo, o elegir uno de los ejemplos públicos de la galería
**Ejemplos** (`pedido`, los cuatro niveles del tutorial de Bizagi, y las dos colas M/M/c —
`docs/EXAMPLES_POLICY.md`); la columna derecha lista los proyectos recientes (la misma lista de
Archivo → Abrir reciente), las novedades de esta versión, y el tema y la densidad actuales. Abrir
cualquier proyecto, o un ejemplo, la cierra. Hacer doble clic en un `.lila` o `.bpmn` la salta.

La app arranca siempre con el mismo diagrama de ejemplo incluido en el propio bundle: el proceso
`pedido` de `examples/pedido/model.bpmn` (import directo en `apps/web/src/main.tsx`, no un archivo
externo). Hasta que elijas un tema se ve con **Lila oscuro** si el sistema está en modo oscuro y
con **Lila claro** en caso contrario (paleta de bpmn-js a la izquierda, panel de propiedades a la
derecha), cargados al vuelo desde `lila-dark.json` / `lila-light.json`; `tokens.css` sigue trayendo
Eva-01 como pintura previa a cualquier tema.

## Recorrido de uso

La barra superior tiene tres modos: **Modelar**, **Simular** y **Resultados** (desde 1.0.0-beta.23).
Comparar escenarios («Comparar con…») y la reproducción de tokens viven en Resultados; **Validar
rutas** es una herramienta de Modelar (el botón sobre el lienzo, o `⌘K`). Los textos de abajo son literales de la interfaz (desde LILA-066 todos viven en
`apps/web/src/strings.es.ts`), no paráfrasis.

### Modelar

- En escritorio se trabaja con **Nuevo proyecto** y **Abrir proyecto** por carpeta. También puedes
  abrir un `.bpmn` suelto con doble clic (ver Limitaciones). Usa **Guardar
  como** para conservar sus escenarios y
  corridas en una carpeta de proyecto, como se describe más abajo.
- El lienzo central es el editor de bpmn-js: se edita arrastrando figuras de la paleta, igual que
  cualquier editor de bpmn.io.
- **Deshacer** / **Rehacer**: botones arriba de la ventana, en la barra superior.
- El XML editado se guarda como `model.bpmn` dentro de la carpeta del proyecto.

### Simular (pestaña "Simulación" del panel derecho)

- **Escenario ▾** (sobre el lienzo, en Simular y en Resultados) lista los escenarios cargados (el
  proyecto trae `as-is` y `to-be-3-cajeros` de ejemplo), cada uno con su insignia BASE, «Simulado» o
  «Sin simular» y el escenario del que hereda; elige uno para activarlo. Al lado, **Duplicar** copia el
  escenario activo con un clic (la copia hereda de él con `extends`) y deja el nombre de la copia
  listo para editar: escribe TO-BE y Enter. El desplegable trae además **Renombrar**, **Guardar
  proyecto**, **Descargar plantilla** / **Importar Excel/CSV…** y el escenario en JSON. Los chips de
  validación de al lado saltan al primer problema.
- El panel de escenario tiene seis pasos, en este orden: **Llegadas** (cada cuánto dispara cada
  evento de inicio y cuántos casos crea; la lista **Llegadas por evento de inicio** las resume),
  **Tiempos** (el tiempo de cada tarea y temporizador), **Rutas** (cómo ramifican las compuertas),
  **Recursos** (pools, unidades, el calendario y la capacidad por turno de un pool, y qué tarea
  toma cuál), **Calendarios** (calendarios y festivos, y qué calendario sigue cada elemento) y
  **Ejecución** (la ventana de corrida y las réplicas). Cada control vive en un solo paso. El panel permite editar `run`, `calendars`, `resources` y las propiedades por
  elemento del proceso. Los campos con forma de unión —hoy solo `resources.<id>.capacity`— tienen
  un selector explícito **Fija** (un número) / **Por turno** (una lista de tramos
  `{ calendar, capacity }`, con `calendar` como desplegable de los calendarios ya declarados).
- Un campo reservado heredado de un `extends` muestra un botón **Quitar heredado** (o **Quitar**
  si es propio del archivo, no heredado): al pulsarlo se escribe `null` en el delta, que es la
  forma de "borrar" un valor heredado (§ 6 del formato de escenario). Si ya está borrado, el botón
  cambia a **Restaurar heredado**, que quita ese `null` y vuelve a heredar del padre.
- **Duplicar** está también en la cabecera del panel de escenario. **Guardar proyecto** está en el
  menú Archivo, en «Escenario ▾» o con `⌘S`.
- **Ejecutar simulación**: corre la simulación sobre lo que hay en el lienzo ahora mismo. Mientras corre,
  aparece **Cancelar** y un progreso (`% · replicación N`); con problemas que impiden simular, el botón
  lleva su número y te lleva al primero en vez de correr. Al terminar, la app pasa sola a
  **Resultados**.

- **Vista rápida · simulación**: selecciona un elemento en el lienzo y el panel Propiedades muestra
  bajo la cabecera sus datos de simulación: **Tiempo**, **Recurso** (solo tareas) y la espera por
  recurso (p95 si la muestra del log de la corrida está en memoria, la media si no; **sin
  corrida** antes de la primera). **Editar en Tiempos** y **Editar en Recursos** saltan al paso
  correspondiente.
- El panel de escenario se puede separar en su propia ventana con el interruptor de la barra
  superior (**Escenario acoplado ↗** / **En ventana aparte**); **Acoplar** en el sustituto, o
  cerrar la ventana, lo devuelve. Mientras está separado el panel derecho se oculta, así que el
  sustituto solo aparece al reabrir el panel con `⇧⌘P`; el interruptor de la barra también lo acopla.

### Resultados

Una corrida terminada llega aquí, sobre el mismo diagrama:

- **Mapa de calor**: cada tarea se tiñe según su espera media por recurso frente a su propio tiempo de
  proceso y lleva una insignia «Espera …»; los cuellos de botella del motor llevan la marca
  **CUELLO**. El botón «Mapa de calor» de la barra lo apaga y lo enciende sin volver a simular.
- **Tokens**: el log de eventos de la corrida se reproduce sobre el mismo mapa, con una barra de tiempo
  abajo (reproducir / pausar, reiniciar, velocidad, un deslizador, el reloj simulado y las unidades
  ocupadas de cada pool). `Espacio` reproduce y pausa (no mientras escribes ni con un botón
  enfocado). El botón «Tokens» oculta la barra.
- **Resumen** (panel derecho): los seis KPI —tiempo de ciclo, espera por caso, casos completados,
  costo por caso, utilización máxima y casos en curso al cierre— con el valor exacto y el intervalo de
  confianza del 95 % en su ayuda, el ranking de cuellos del motor (un clic lo selecciona) y el detalle
  de la tarea que elijas en el mapa o en la tabla.
- **Tabla de resultados** bajo el mapa (se pliega con ▾, `⌘J`, el menú Vista o un doble clic en su
  borde; arrastra el borde para cambiar su alto): **Tareas** (tarea, recurso, casos, proceso medio,
  espera media, utilización, costo total), **Resultados completos** (las tablas de elementos,
  recursos, proceso y flujos con sus gráficas, cada una con **Exportar CSV** —byte a byte lo que
  escribe `npx lila run --csv`— y **Exportar XLSX**), **Registro de la corrida** y **Avisos**
  (agrupados por código). CSV y XLSX están también en la cabecera de la tabla.
- Los resultados se pueden separar en su propia ventana con el interruptor de la barra superior
  (**Resultados acoplados ↗** / **Resultados en ventana aparte**). Mientras está separada, el resumen
  muestra **Mostrar** y **Acoplar**; la ventana siempre muestra la corrida actual, cerrarla acopla
  Resultados de nuevo y se recuerdan su tamaño y posición.

### Comparar (en Resultados)

- **Comparar con…** en la barra de Resultados lista los demás escenarios; uno que aún no tiene
  resultados se simula al elegirlo (con su propia semilla y réplicas; **Cancelar** en su tarjeta lo
  detiene y **Reintentar** lo vuelve a correr). La primera corrida de un duplicado se abre comparada
  con el escenario del que salió.
- La comparación muestra los seis KPI del otro escenario con su cambio frente a la referencia (verde =
  mejora, rojo = empeora, ▲▼ sube o baja), los avisos de la comparación y dos mapas lado a lado: el
  mapa de calor de la referencia y el del otro, con el cambio de espera media de cada tarea. ⇄
  intercambia los lados, **Elegir escenario** cambia el otro y **Cerrar comparación ✕** vuelve al mapa.
- **Tablas y gráficas de la comparación** (bajo los mapas): todos los escenarios con corrida vigente,
  la referencia primero. **Mostrar todos los KPI** muestra la tabla de flujos. La sección **Avisos**
  solo aparece cuando hay algo que decir, y agrupa hasta cinco tipos, en este orden:
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
  (IC95 sin solapamiento) contra la referencia"; las celdas resaltadas son las que cambiaron respecto
  a ella. Si el aviso 3 de arriba aplica, esta sección lo repite y no se pinta ningún asterisco.

### Validar rutas

- Es una herramienta de Modelar: el botón «Validar rutas» sobre el lienzo, o `⌘K`. La animación se entra solo desde ahí: pulsar `T` a secas sobre el lienzo no la activa (antes
  encendía y apagaba la simulación de tokens en cualquier modo).
- **No es la simulación DES del motor**: anima los tokens de `bpmn-js-token-simulation` sobre el
  diagrama abierto. No lee el escenario activo ni produce resultados, y la propia pestaña lo dice:
  «Animación de tokens de bpmn-js: no es simulación de eventos discretos; no usa el escenario ni
  produce resultados.» Sirve para ver a ojo por dónde pasan las rutas, no para medir.
- Mientras está encendido no se pintan los marcadores de validación y el diagrama no se puede
  editar; al apagarlo (o salir de Modelar) todo vuelve a su sitio.
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
- La barra superior muestra el nombre del archivo seguido de `· Sin guardar` o `· Guardado` según
  haya cambios pendientes (`apps/web/src/App.tsx`). Con varios procesos en el proyecto muestra el
  nombre del proceso activo en lugar del nombre del archivo.
- **Cerrar con cambios sin guardar**: la ventana (botón rojo, Cmd+Q, o cerrarla desde el Dock)
  muestra el diálogo nativo del sistema con **Guardar / Descartar / Cancelar**. "Guardar" espera
  hasta 30 s la respuesta de la app antes de cerrar; si falla o no llega, se avisa y la ventana no
  se cierra. Al cerrar la última ventana termina la aplicación también en Mac; al reabrir, usa **Abrir proyecto** para recuperar la carpeta guardada.
- **Autoguardado y recuperación** (#459): cinco segundos después de cada cambio se escribe una
  copia del proyecto sin guardar en `recovery.lila`, dentro de la carpeta de datos de la app
  (`~/Library/Application Support/Lila Modeler/`). Guardar, o descartar los cambios al cerrar, la
  borra. Si la app terminó sin ninguna de las dos cosas (un cuelgue, un cierre forzado), el
  siguiente arranque ofrece **Restaurar / Descartar**: el proyecto restaurado abre sin guardar y
  sin archivo detrás, así que el primer guardado pregunta dónde con **Guardar como…** — tu archivo
  original nunca se sobrescribe sin que lo elijas.
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
- **El proyecto abierto se vigila** (#539): cuando un agente o un script reescribe el `.lila`
  abierto (o el modelo, el manifiesto o los escenarios de una carpeta de proyecto) por la CLI o el
  MCP, la app lo nota en una fracción de segundo. Sin cambios sin guardar, recarga sola y conserva
  el modo, la pestaña del proceso y el escenario en pantalla si siguen existiendo. Con cambios sin
  guardar, la barra de estado dice «El archivo cambió fuera de Lila» con **Recargar** (tomar el
  archivo y descartar tus cambios) y **Conservar los míos** (seguir editando; el siguiente guardado
  se sigue rechazando con `E-CAMBIO-EXTERNO`, como arriba). Los guardados de la propia Lila nunca
  lo disparan.

### Recientes y ventana

- El tamaño/posición de la ventana y la lista de proyectos recientes se guardan en
  `~/Library/Application Support/Lila Modeler/estado.json`, y se restauran al volver a abrir la
  app (si la ventana guardada ya no cabe en ninguna pantalla conectada, se usa el tamaño por
  defecto).
- **Archivo → Abrir reciente** lista esos proyectos (más nuevo primero) y los reabre sin
  diálogo; si la carpeta ya no existe, desaparece de la lista y la app lo dice en la barra de
  estado. El menú nativo trae además Nuevo (`⌘N`), Abrir (`⌘O`), **Importar BPMN…** (un
  `.bpmn` o `.xml` de otra herramienta), Guardar (`⌘S`), Guardar como
  (`⇧⌘S`) y **Preferencias… (`⌘,`)** en el menú de la app; **Vista** trae la paleta de comandos
  (`⌘K`) y los tres modos (`⌘1`…`⌘3`), y **Simulación** ejecuta la simulación (`⌘↩`). Todos los
  atajos están en [Atajos de teclado](ATAJOS.md).

### Ajustes

- `⌘,` (o el botón ⚙ de la barra) abre **Ajustes** en la pestaña **General** (idioma, densidad —
  compacta, normal, cómoda— e interruptor **Avanzado**); **Apariencia** y **Atajos** son las otras
  dos pestañas. **Apariencia** tiene **Seguir el tema del sistema** y uno de siete temas (Lila claro,
  Lila oscuro, Eva-01 oscuro, Papel claro, Tieso claro, Akira oscuro, Montana morado). El cambio
  de tema es inmediato, repinta también el diagrama y se recuerda entre arranques (localStorage de
  la app, bajo `lila://`). Cambiar de tema vuelve a montar el lienzo, así que vacía la pila de
  deshacer; el diagrama y los cambios sin guardar se conservan.
- El editor de colores por token e importar/exportar temas es LILA-114 (#144), pendiente.

## Limitaciones de esta beta

*(a fecha 1.0.0-beta.23, tag `v1.0.0-beta.23`; las notas de verificación de macOS de abajo se
registraron para la Beta 1. Revisar si alguna de estas ya se resolvió antes de creer esta lista a
ciegas en una fecha posterior)*

- **Sin firma de Developer ID ni notarización**: una copia recibida requiere la autorización de
  apertura de macOS (ver «Primer arranque sin firma» arriba). Esto es esperado; no desactives
  Gatekeeper para evitarlo.
- **Solo macOS arm64 está probado**: el instalador de Windows (NSIS) lo compila la matriz de CI
  (`.github/workflows/desktop.yml`) y se adjunta al release, pero está sin firmar y nadie del
  proyecto lo ha ejecutado todavía en una máquina Windows real (ver la [guía para probar en
  Windows](GUIA-PROBADOR-WINDOWS.md)); el AppImage de Linux se compila igual, sin probar y no
  adjunto.
- **Doble clic en Finder**: La Beta 1 verificó la ruta open-file de macOS para `.lila` en macOS 27.0 (arm64) con `open -a`, el mismo evento que Finder envía al hacer doble clic, con la app cerrada y ya abierta, incluido un nombre con acentos y raya. El doble clic físico en Finder, y abrir así un `.bpmn`, no se ejercieron.
- **Guardar un `.lila` abierto por doble clic o argumento de lanzamiento está arreglado en la
  Beta 1 (#378)**. Verificado en la Beta 1 con la regresión en Electron real de `tools/e2e-desktop-open-path.mjs` (argumento de arranque, evento open-file, recientes, diálogo; ASCII, espacios, acentos en NFC y NFD)
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
npm run build -w @lila-modeler/engine       # compila el motor de simulación (TypeScript)
npm run build -w @lila-modeler/web          # compila engine (si hiciera falta) + build de Vite
npm run dist:mac -w @lila-modeler/desktop   # tsc + copia dist/web + electron-builder --mac --arm64
```

El último comando encadena: `tsc --build` de `apps/desktop`, copia de `apps/web/dist` a
`apps/desktop/dist/web`, y `electron-builder --mac --arm64`. El resultado queda en
`apps/desktop/release/` (la versión en `apps/desktop/package.json`: `1.0.0-beta.23` para la Beta 23):

- `apps/desktop/release/Lila-Modeler-1.0.0-beta.23-mac-arm64.dmg` — el instalador.
- `apps/desktop/release/Lila-Modeler-1.0.0-beta.23-mac-arm64.dmg.blockmap`.
- `apps/desktop/release/mac-arm64/Lila Modeler.app` — la app sin empaquetar en DMG, útil para
  probar rápido.
- `apps/desktop/release/ORIGEN.txt` — `sha`, `fecha` (ISO) y `arch` (`uname -m`) del build,
  escrito por `apps/desktop/scripts/origen.mjs` al final de `dist:mac`.

Si Vite ya está corriendo en la máquina (por ejemplo `npm run dev -w @lila-modeler/web` de otra sesión),
apágalo antes de compilar `dist:mac`: el build de producción no lo necesita y dos procesos
compitiendo por el mismo puerto solo añade ruido a los logs, aunque no rompe el build en sí (el
binario final carga por el protocolo `lila://`, no por `http://localhost`).

Para probar el `.app` sin generar el DMG (más rápido, útil en desarrollo):

```bash
npm run pack:mac -w @lila-modeler/desktop   # mismo build, pero --dir en vez de --mac
```

Verificación mínima de que el paquete arranca, sin abrir ventana:

```bash
LILA_SMOKE=1 "apps/desktop/release/mac-arm64/Lila Modeler.app/Contents/MacOS/Lila Modeler"
```

Imprime un JSON (`lienzo`, `tema`, `fuente`, `puente`, `consoleErrors`, `loadFailure`, `ok`) y
sale con código 0 si todo carga bien; la captura queda en una carpeta temporal del sistema
(`$TMPDIR/lila-smoke/captura.png` fuera de `app.asar`, que es de solo lectura en el paquete).

## Para agentes/QA: seam E2E

`apps/desktop/src/main.ts` acepta estas variables de entorno pensadas **únicamente para pruebas
automatizadas** (por ejemplo, para que un agente sin manos accione diálogos nativos que de otra
forma no puede tocar). No son una API pública ni deben usarse en un uso normal de la app:

- `LILA_E2E_FOLDER=<ruta absoluta>`: hace que `chooseFolder` devuelva esa ruta directamente, sin
  abrir el selector nativo (la crea si falta, y la autoriza igual que lo haría el diálogo real).
  El valor literal `"cancel"` simula que el usuario cerró el selector sin elegir nada.
- `LILA_E2E_CLOSE=save|discard|cancel`: hace que el diálogo nativo de "cerrar con cambios sin
  guardar" (Guardar/Descartar/Cancelar) resuelva automáticamente con ese valor, en vez de esperar
  un clic.
- `LILA_E2E_SAVE_FILE=<ruta absoluta a un .lila>`: lo mismo que `LILA_E2E_FOLDER`, para el diálogo
  nativo de «Guardar como…».
- `LILA_E2E_RECOVERY=restore|discard`: hace que la oferta de recuperación del arranque
  (Restaurar / Descartar) se resuelva automáticamente con ese valor.
- `LILA_E2E_LOG=<ruta de archivo>`: si está presente, añade una línea JSON por cada evento
  relevante (`chooseFolder`, `writeProject`, `closeRequested`, `openPath`, `recovery`) a ese archivo.

Sin ninguna de ellas, el comportamiento de la app es exactamente el mismo que si no existieran.
**Advertencia**: son un atajo para pruebas, no algo que un usuario final deba fijar nunca — dejan
la app respondiendo diálogos por sí sola sin intervención humana.

## Branding e instalación registrada

El arranque del editor web y de escritorio muestra el logo detallado de Lila y la
versión del manifiesto hasta que el lienzo esté listo, con recuperación ante errores.
La decisión visual y la instalación de validación del 14 de septiembre de 2026 están
registradas en [BRANDING.md](BRANDING.md).
