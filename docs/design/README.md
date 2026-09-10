# Diseño de la interfaz

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../) and [`README.md`](../../README.md).

Fuente visual: el proyecto de **Claude Design** de Lila Modeler, archivo
`Lila Modeler.dc.html` (diez artboards en un mismo lienzo, tabla de tokens con
los dos temas, inventario de componentes y notas de React al final).

El brief que lo originó es `prompts/claude-design-ui.md`. Los artboards son
**referencia, no código a copiar**: la app se construye con los tokens del brief
(`apps/web/src/theme/`), no con el design system del artefacto.

## Captura de la app real

`shell-modelar.png` **no** es un artboard: es una captura de 1440×900 de la app que corre en
`apps/web`, con `examples/pedido/model.bpmn` cargado (LILA-057). Sirve para comparar lo
construido contra los artboards de abajo cuando estos existan.

## Capturas de los artboards

Descargadas el 2026-09-07 desde el proyecto de Claude Design. El artefacto entero está en
`Lila Modeler.dc.html` (solo el documento; el runtime `support.js` y el bundle del design system
no se copian: los artboards son HTML con estilos en línea y se renderizan solos). Las capturas se
generaron con Chrome headless a partir de cada artboard. La comparación contra la app, con la
reconciliación de tokens y la propuesta de tickets, está en `COMPARACION-2026-09-07.md`.

| # | Artboard | Archivo |
|---|---|---|
| 1 | Modelar 1440×900 | `01-modelar-1440.png` |
| 2 | Modelar 1920×1080 (paleta de comandos, Documentación) | `02-modelar-1920.png` |
| 3 | Simular con panel de escenario | `03-simular-escenario.png` |
| 4 | Lienzo con overlay de cuellos de botella | `04-overlay-cuellos.png` |
| 5 | Resultados | `05-resultados.png` |
| 6 | Comparar | `06-comparar.png` |
| 7 | Validar rutas | `07-validar-rutas.png` |
| 8 | Bienvenida | `08-bienvenida.png` |
| 9 | Ajustes → Apariencia (Eva-01) | `09-apariencia.png` |
| 10 | Modelar con el tema Papel | `10-modelar-papel.png` |
| — | Tabla de tokens (ambos temas) | `11-tabla-tokens.png` |
| — | Inventario de componentes | `12-inventario-componentes.png` |
| — | Notas de implementación (React) | `13-notas-react.png` |

## Capturas de la app real

Chrome headless 1440×900 contra el dev server, tema Eva-01 y `examples/pedido` cargado.

| Captura | Qué muestra | Ticket |
|---|---|---|
| `app-2026-09-07-modelar-eva01.png` | Modelar, build de escritorio (smoke del mismo día) | #143 |
| `app-12-modernist.png` | Modelar sin ningún radio y con la barra de estado en JetBrains Mono | #238 |
| `app-05-resultados.png` | Resultados con una corrida de `examples/pedido`: cifras en mono alineadas a la derecha | #238 |
| `app-01c-minimapa.png` | Modelar con el minimapa abierto abajo a la izquierda, zoom +/−/ajustar abajo a la derecha y pestaña con ✕ y «+» | #240 |
| `app-01d-marcadores.png` | Modelar con el chip «6 avisos» y el disco de validación sobre cada figura sin parámetros en el escenario AS-IS | #241 |
| `app-01b-paleta.png` | Modelar con la paleta propia a la izquierda: filtro «Filtrar figuras», botón de modo compacto, los seis grupos con nombre por figura y el pie «Arrastra al lienzo o pulsa Enter para insertar» | #239 |
| `app-01-modelar-1440.png` | Modelar con los cinco tickets de la sesión 8 (#237–#241) en Eva-01: barra del artboard 01, paleta propia, chips y marcadores, minimapa y zoom, pestaña con ✕, pie en mono | sesión 8 |
| `app-10-modelar-papel.png` | La misma pantalla con el tema Papel, al lado del artboard 10 | sesión 8 |
| `app-03-calendario.png` | Simular con el editor semanal de calendarios: rejilla 7 días × 24 horas del calendario `oficina` de `examples/pedido` (MON–FRI 09:00–18:00 pintadas) y el interruptor «Editar como lista» | #233 |
| `app-04-overlay-cuellos.png` | Simular con el overlay de cuellos de botella sobre `Task_Preparar`: etiqueta corta «2.1 d · 34%» y halo del cuello principal | #226 |

### Cuántos cuellos pinta el overlay

Decisión de #226, frente al artboard 4, que sugiere una etiqueta por tarea: el overlay pinta
**siempre el cuello principal** (el rango 0, sea cual sea su nivel) y **los cuellos de nivel
`high`** —los que esperan más de lo que trabajan, que son los que se vino a buscar— y, **si no
hay ninguno alto, las tres primeras del ranking**, para que el lienzo no se quede mudo justo
después de simular; **nunca más de cinco**, porque cada entrada es una etiqueta
flotante encima del diagrama. El principal va aparte porque el ranking ordena por
`resourceWait.total` mientras el nivel sale del ratio espera/proceso: son dos ordenaciones
distintas, así que sin esa excepción un principal de nivel `mid` se quedaba sin pintar y sin halo
mientras el panel derecho seguía nombrándolo. El ranking no se recalcula: el corte respeta el orden de
`result.bottlenecks` (`docs/RESULTS_FORMAT.md` §6), así que el overlay, la tabla de Resultados y
`lila run` siguen coincidiendo. Las tareas que quedan fuera del lienzo siguen en la tabla de
Resultados con sus cifras completas. La etiqueta se redondea para caber sobre la tarea (65 px
contra los 100 px de la tarea; el texto largo medía 287 px) y el texto completo, con la unidad
del escenario y todos los decimales, está en su `title`.

## Inventario de componentes React

Derivado del brief. La columna de ticket dice quién lo construye; LILA-112 solo
deja los tokens y los temas, no construye ninguno.

| Componente | Para qué | Ticket |
|---|---|---|
| Botón (primario, secundario, fantasma, icono) | ejecutar simulación, acciones de barra | LILA-057 |
| Campos de formulario (texto, número, select, checkbox, color+hex) | propiedades, escenario, editor de tokens | LILA-060 / LILA-114 |
| Pestañas (modos superiores, panel derecho, diagramas abajo) | Modelar/Simular/Resultados/Comparar y sub-paneles | LILA-057 |
| Paneles redimensionables y colapsables | paleta izquierda y panel derecho | LILA-057 |
| Paleta de figuras BPMN agrupable y con búsqueda | arrastrar al lienzo | LILA-057 |
| Tooltip con atajo de teclado | descubribilidad de acciones | LILA-057 |
| Barra de estado (validación, escenario, semilla, zoom) | pie de ventana | LILA-057 |
| Marcadores de validación sobre el elemento | errores y avisos en vivo | LILA-057 |
| Tabla densa ordenable con encabezado fijo y export CSV | Resultados y Comparar | LILA-062 |
| Resalte de celda con marca de significancia | Comparar | LILA-063 |
| Selector de escenario (duplicar, hereda de) | modo Simular | LILA-061 |
| Editor semanal de calendarios por franjas | recursos y calendarios | LILA-061 / LILA-203 |
| Tabla de recursos | modo Simular | LILA-061 |
| Barra de progreso de corrida con cancelar | ejecutar simulación | LILA-059 |
| Overlay de simulación sobre el lienzo (tinte + etiqueta) | cuellos de botella | LILA-064 |
| Controles reproducir/pausa/paso | validar rutas | LILA-065 |
| Paleta de comandos (buscador tipo Cmd+K) | navegación rápida | LILA-066 |
| Pantalla de bienvenida (recientes, abrir, ejemplo) | arranque de escritorio | LILA-070 |
| Lista de temas + editor de tokens + vista previa | Ajustes → Apariencia | LILA-114 |

## Decisiones de diseño

**El panel de escenario se genera desde el JSON Schema.** Los campos de `run`,
`calendars`, `resources` y `elements[id]` no están escritos a mano en
`apps/web/src/ScenarioPanel.tsx` (LILA-061): se recorren desde `toJsonSchema()`
de `@lila/engine/schema`, y las uniones (`oneOf`/`anyOf`) se dibujan con un
selector de variante más el cuerpo de la elegida. Consecuencia para el diseño: un
campo nuevo del formato aparece en la UI sin que nadie dibuje nada, pero el panel
tiene el aspecto que da el esquema, no el del artboard 3. La excepción es
`calendars[clave].intervals`, que desde LILA-203 (#233) se edita con el **editor
semanal por franjas** del artboard —una rejilla de 7 días × 24 horas
(`apps/web/src/CalendarEditor.tsx`)— con un interruptor a la lista genérica. La
rejilla es una vista **parcial** del formato: su celda es una hora entera y § 2.3
admite cualquier `"HH:MM"`, así que un calendario con franjas de minutos se edita
solo como lista, con aviso y sin redondear.

**Tipografía: Archivo.** `font.ui` es `Archivo, Inter, system-ui, sans-serif`
(el brief decía Inter; la sesión de Claude Design eligió Archivo y esa elección
manda). `font.diagram` usa la misma pila; `font.mono` sigue siendo JetBrains
Mono con `ui-monospace` de reserva. La webfont se carga desde `@fontsource/archivo`
(pesos 400–700, importados en `apps/web/src/main.tsx`): Vite empaqueta los `.woff2`,
así que funciona sin red y dentro del CSP `'self'` de Electron. Decidido por Brito el
2026-09-07 tras ver la demo con el fallback `system-ui`.

**Papel usa rojo tinta como acento.** `accent.primary` del tema claro es
`#EC3013`, no un neutro apagado, para demostrar que el sistema aguanta un acento
de familia distinta a la del tema oscuro. Consecuencia medida: sobre ese rojo el
blanco solo alcanza 4,2:1, por debajo de AA, así que `fg.onAccent` de Papel es
un casi-negro cálido (`#0B0603`, 4,8:1) en vez de blanco. Se ajustó Papel, no el
umbral del test.

**`fg.onAccent` solo se garantiza sobre `accent.primary`.** Es un único token
para tres acentos y no da AA sobre los tres: medido, `fg.onAccent` sobre
`accent.tertiary` es 3,9:1 en Eva-01 y 3,0:1 en Papel, y sobre
`accent.secondary` es 4,0:1 en Papel. Los valores de Eva-01 vienen del brief, así
que no se tocan. Consecuencia para LILA-113/114: el texto sobre
`accent.secondary` o `accent.tertiary` **no** usa `fg.onAccent`; usa el color que
sí contrasta (en Papel, blanco: 5,0:1 sobre el ámbar y 6,7:1 sobre el azul). Si
más adelante hace falta texto sobre esos dos acentos en cualquier tema, el
arreglo limpio es partir el token en `fg.onAccent.primary` /
`.secondary` / `.tertiary`, y eso es un cambio del brief, no de este ticket.

**Valores de Papel reconciliados con el artefacto (2026-09-07).** Los 40 tokens de
Papel son ahora los de la tabla del artefacto (30 valores cambiaron respecto a los
derivados), con una excepción deliberada: `fg.onAccent` sigue en `#0B0603` porque el
blanco del artefacto da 4,2:1 sobre `#EC3013` y el test exige AA. Detalle en
`COMPARACION-2026-09-07.md`.

**`sim.utilization.*` reconciliado.** El brief no daba valores; el artefacto sí (en
las variables de sus artboards): en Eva-01 `status.info` → `status.warning` →
`status.error` (`#4FC3F7 / #FFB020 / #FF4D4D`) y en Papel `#1668A8 / #A66A00 /
#C42121`. Se tomaron los del artefacto.

**`shadow` es un color, no una sombra completa.** El token guarda un hex con
alfa (`#00000099` en Eva-01) y la sombra se compone en CSS
(`box-shadow: 0 6px 20px var(--shadow)`). Así el editor de tokens de LILA-114
puede ofrecer un selector de color para él como para cualquier otro.
