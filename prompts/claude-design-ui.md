# Prompt — Claude Design · Interfaz de Lila Modeler

> Pegar en Claude Design. Pide un canvas con varios artboards. Si el resultado es bueno, los tokens de la sección "Sistema de temas" se convierten directamente en las variables CSS de `apps/web`.

---

Diseña la interfaz de **Lila Modeler**, una aplicación de escritorio (Electron, también servida en navegador) para modelar procesos BPMN y simularlos con paridad con Bizagi Modeler. Es open source; la usan estudiantes, analistas de procesos y, más adelante, equipos de procesos de empresas. La UI está en **español**. Diseña para escritorio: artboard principal de 1440×900 y una variante de 1920×1080.

## Qué es y qué no es

- El lienzo del diagrama lo dibuja **bpmn-js**: las figuras BPMN son las del estándar y no hay que rediseñarlas. Sí diseñas todo lo que rodea al lienzo (chrome), el propio fondo del lienzo (color, rejilla, minimapa, controles de zoom), los estados de selección y hover de las figuras, y los overlays de simulación sobre ellas.
- En la esquina inferior derecha del lienzo vive obligatoriamente una **marca de agua "Powered by bpmn.io"** de unos 15 px de margen que no puede taparse ni moverse a un sitio donde no se vea. Reserva ese espacio; no pongas nada encima.
- Un proceso es un archivo `.bpmn`; los parámetros de simulación viven en "escenarios" (AS-IS, TO-BE…) separados. El usuario cambia de escenario y compara.

## Estructura de pantalla, inspirada en Bizagi

Inspirada quiere decir la disposición, no el estilo visual: figuras a la izquierda, lienzo al centro, propiedades a la derecha, pestañas de diagramas abajo. Modernízalo.

- **Barra superior**: nombre del proyecto y del proceso; modos como pestañas grandes: *Modelar · Simular · Resultados · Comparar*; a la derecha buscar, deshacer/rehacer, ejecutar simulación (botón primario), ajustes.
- **Paleta izquierda**: figuras BPMN agrupadas y colapsables (Eventos, Actividades, Compuertas, Datos, Artefactos, Pools y carriles), con búsqueda y modo compacto solo iconos. Arrastrar al lienzo.
- **Lienzo central**: rejilla sutil, minimapa opcional abajo a la izquierda, zoom y "ajustar a pantalla", validación en vivo (marcadores de error/advertencia sobre el elemento). Al crear una tarea, el nombre queda **en edición inmediata**, sin texto "Task 1".
- **Panel derecho** con pestañas: *Propiedades* (nombre, tipo, id), *Documentación* (descripción, responsable, sistema, documentos, riesgos, controles, KPIs, entradas/salidas), *Simulación* (los parámetros del elemento seleccionado en el escenario activo: tiempo de proceso con distribución y sus parámetros, recursos requeridos, costo fijo; en un flujo saliente de compuerta, la probabilidad). Redimensionable y colapsable.
- **Pestañas inferiores**: un tab por diagrama/proceso abierto, como Bizagi.
- **Barra de estado**: validación (n errores, n avisos), escenario activo, semilla, zoom.

## Modo Simular

- **Panel de escenario** (sustituye o acompaña al panel derecho): selector de escenario con "duplicar" y "hereda de"; corrida (inicio, duración, máximo de casos, warm-up, replicaciones, semilla, unidad de tiempo, moneda); **recursos** (tabla: nombre, tipo rol/equipo, capacidad, costo por hora, costo fijo, calendario); **calendarios** (editor semanal por franjas, tipo agenda); **llegadas** del evento de inicio (distribución).
- **Ejecutar**: botón primario con progreso (casos simulados, replicación n de N) y cancelar. Corre en segundo plano; la UI no se bloquea.
- **Overlay en el lienzo** tras simular: las tareas se tiñen según su espera por recurso (escala de tres pasos) y muestran una etiqueta pequeña con espera media y utilización del recurso; el cuello de botella principal queda destacado.
- **Validar rutas**: una pestaña secundaria que anima tokens paso a paso (didáctica, no cuantitativa), con controles reproducir/pausa/paso.

## Resultados y Comparar

- **Resultados**: tres tablas con los mismos nombres de columna que Bizagi, para que un usuario que viene de ahí compare cifras: *Elementos del proceso* (Nombre, Tipo, Instancias iniciadas, Instancias completadas, Tiempo mín/máx/prom/total, Espera por recurso mín/máx/prom/desv/total, Costo fijo), *Recursos* (Utilización %, Costo fijo, Costo unitario, Costo total), *Proceso* (lo mismo agregado más p50/p90/p95 de ciclo, throughput por hora, costo por caso). Además *Flujos* (tokens por flujo) y una tarjeta de **cuellos de botella** ordenada. Exportar CSV. Tablas densas, ordenables, con filas fijas de encabezado.
- **Comparar**: dos o más escenarios lado a lado; las celdas que cambian se resaltan y una marca indica si la diferencia es estadísticamente significativa. Selector de escenarios arriba.

## Otras pantallas

- **Bienvenida** (escritorio): abrir carpeta de proyecto, recientes, "nuevo proceso", "abrir ejemplo".
- **Ajustes → Apariencia**: ver siguiente sección.

## Sistema de temas, al estilo Visual Studio Code

El usuario debe poder elegir un tema, **editar cada color manualmente**, cambiar tipografías y tamaños, y exportar/importar el tema como JSON, exactamente como VS Code hace con `workbench.colorCustomizations`. Diseña la pantalla *Apariencia* con: lista de temas (integrados y del usuario), editor de tokens agrupados con selector de color y valor hex editable, vista previa en vivo (un mini lienzo con dos tareas, una compuerta y el panel), tipografía (fuente de interfaz, fuente monoespaciada, fuente de etiquetas del diagrama, tamaño base, densidad compacta/normal/cómoda), "restablecer", "exportar JSON", "importar JSON".

Usa **estos nombres de token** en todo el diseño y entrégalos en una tabla al final (nombre · valor en Eva-01 · dónde se usa):

- Base: `bg.base`, `bg.surface`, `bg.elevated`, `bg.hover`, `border`, `border.strong`, `shadow`
- Texto: `fg.primary`, `fg.muted`, `fg.disabled`, `fg.onAccent`
- Acentos: `accent.primary` (acción principal, selección, foco), `accent.secondary` (destacados y llamadas de atención), `accent.tertiary` (enlaces, pestaña activa)
- Estados: `status.success`, `status.warning`, `status.error`, `status.info`
- Lienzo y diagrama: `canvas.bg`, `canvas.grid`, `diagram.stroke`, `diagram.fill`, `diagram.label`, `diagram.selected`, `diagram.hover`, `diagram.connection`, `diagram.marker.error`, `diagram.marker.warning`
- Simulación: `sim.bottleneck.low`, `sim.bottleneck.mid`, `sim.bottleneck.high`, `sim.utilization.low`, `sim.utilization.mid`, `sim.utilization.high`, `sim.token`
- Tipografía: `font.ui`, `font.mono`, `font.diagram`, `font.size.base`, `density`

## Tema por defecto: "Eva-01"

Paleta inspirada en el Evangelion Unidad 01: morado profundo como base, verde neón como acento de acción, naranja como destacado, negro azulado y grises lavanda. Oscuro por defecto. Punto de partida (puedes afinar, pero mantén la identidad y el contraste AA en texto):

- `bg.base` #12101A · `bg.surface` #1C1730 · `bg.elevated` #26203F · `bg.hover` #2F2850 · `border` #3A2F5C · `border.strong` #4E3F7A
- `fg.primary` #ECE9F5 · `fg.muted` #A79FC4 · `fg.disabled` #6F6690 · `fg.onAccent` #0E1205
- `accent.primary` #9EF01A (verde neón Eva) · `accent.secondary` #FF8A00 (naranja Eva) · `accent.tertiary` #7B4DFF (morado brillante)
- `status.success` #7CE038 · `status.warning` #FFB020 · `status.error` #FF4D4D · `status.info` #4FC3F7
- `canvas.bg` #17132A · `canvas.grid` #241E3C · `diagram.stroke` #D9D2F0 · `diagram.fill` #1F1A36 · `diagram.label` #ECE9F5 · `diagram.selected` #9EF01A · `diagram.hover` #7B4DFF · `diagram.connection` #B9B0DA
- `sim.bottleneck.low` #FFB020 · `sim.bottleneck.mid` #FF8A00 · `sim.bottleneck.high` #FF4D4D · `sim.token` #9EF01A
- `font.ui` Inter (fallback system-ui) · `font.mono` JetBrains Mono · `font.diagram` = `font.ui` · `font.size.base` 13 px · `density` normal

Incluye también un segundo tema **claro y neutro** ("Papel") con los mismos tokens, para demostrar que el sistema funciona en ambos extremos, y muestra en un artboard el editor de temas con Eva-01 cargado.

## Principios de UX que deben notarse

Moderno en lo pequeño: sin diálogos modales para editar propiedades; atajos visibles en tooltips; validación en tiempo real; deshacer/rehacer consistente; acciones masivas sobre selección múltiple; navegación rápida entre actividades (buscador tipo paleta de comandos); todo accesible con teclado; densidad configurable. Nada de decoración que compita con el diagrama: el diagrama es el protagonista.

## Entregables

Artboards: (1) Modelar 1440×900, (2) Modelar 1920×1080, (3) Simular con panel de escenario, (4) Lienzo con overlay de cuellos de botella tras simular, (5) Resultados, (6) Comparar, (7) Validar rutas, (8) Bienvenida, (9) Ajustes → Apariencia con Eva-01, (10) el mismo Modelar con el tema "Papel". Al final: tabla de tokens con valores de ambos temas, inventario de componentes (botones, inputs, tablas, pestañas, paneles, tooltips, marcadores) y notas de implementación para React.
