# Demo vs artboards de Claude Design — 2026-09-07

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../) and [`README.md`](../../README.md).

Comparación de la app contra los diez artboards del artefacto (`Lila Modeler.dc.html`, capturas
`01…10-*.png`). El artefacto se leyó completo desde el proyecto de Claude Design; las capturas
se renderizaron con Chrome headless a partir del HTML de cada artboard, sin retocar.

**Actualizado en la sesión 8 (2026-09-07 tarde)** con #237–#241 mezclados en `codex/ui-artefacto`
(4dda203): la app de esa rama está capturada en `app-01-modelar-1440.png` (Eva-01) y
`app-10-modelar-papel.png` (Papel), al lado de los artboards 01 y 10. Las capturas `app-01b/c/d-*`
y `app-05/12-*` son las de aceptación de cada ticket. La primera comparación (mañana, rama
`codex/op-g-ajustes`) partía de `app-2026-09-07-modelar-eva01.png`.

Leyenda: **✓** ya está · **≈** existe pero distinto · **✗** falta.

## Lo que el artefacto fija y el repo no tenía

| Cosa | Artefacto | Repo antes | Ahora |
|---|---|---|---|
| Tokens de Papel | 40 valores (tabla al pie del lienzo) | derivados por la implementación | **reconciliados**: 30 valores cambiados en `papel.json` |
| `sim.utilization.*` Eva-01 | info / warning / error (`#4FC3F7 / #FFB020 / #FF4D4D`) | info / success / secondary (inventado) | **reconciliado** en `eva-01.json` y `tokens.css` |
| `sim.utilization.*` Papel | `#1668A8 / #A66A00 / #C42121` (variables del artboard 10) | inventado | **reconciliado** |
| `fg.onAccent` Papel | `#FFFFFF` | `#0B0603` | **se mantiene `#0B0603`**: blanco sobre `#EC3013` da 4,2:1 y el test exige AA 4,5:1. El artefacto pone versalitas de 11 px en negrita, donde 3:1 bastaría; la app usa 13 px regular. |
| `shadow` | sombra completa (`0 6px 18px rgba(32,30,29,.14)`) | color con alfa | color con alfa `#201E1D24`; la sombra se compone en CSS (decisión ya documentada) |
| Tipografía | Archivo 400–800, JetBrains Mono para cifras/ids/atajos | Archivo sin cargar; mono declarada | ✓ Archivo y JetBrains Mono cargadas con `@fontsource` (#238); la mono va en cifras de tablas, ids y barra de estado |
| Radio | 0 en todo (Modernist: sin esquinas) | `border-radius: 4px` en botones y 8 px en diálogos | ✓ sin radios (#238): ninguno en `app.css`, en los estilos en línea de Resultados/Comparar ni en la etiqueta de cuello de botella que inyecta `BottleneckOverlay.ts`. Los del context pad y el popup menu de bpmn-js se quedan: son suyos |

## Pantalla por pantalla

### 01 · Modelar 1440×900 (y 02 · 1920×1080)

| Zona | Artefacto | App | Estado |
|---|---|---|---|
| Barra superior | logo pentágono, nombre de proyecto + archivo en mono, modos con subrayado 3 px `accent.tertiary`, buscador «Buscar actividad… ⌘K», deshacer/rehacer como iconos, **EJECUTAR SIMULACIÓN** primario, botón de tema | igual (#237, `app-01-modelar-1440.png`): logo pentágono, proyecto + `model.bpmn · Guardado` en mono, subrayado de 3 px, campo de búsqueda, deshacer/rehacer en iconos, **EJECUTAR SIMULACIÓN** como única acción primaria y ⚙ de Ajustes | ✓ (el campo de búsqueda es inerte: buscar y la paleta de comandos son #66. Nuevo/Abrir/Guardar/Guardar como/.bpmn pasaron al desplegable «Archivo» en la web y siguen en el menú nativo en Electron) |
| Paleta izquierda | 236 px, lista con nombre por figura, grupos colapsables (Eventos, Actividades, Compuertas, Datos, Artefactos, Pools), buscador «Filtrar figuras», modo compacto de 48 px, pie «Arrastra al lienzo o pulsa Enter» | igual (#239, `app-01b-paleta.png`): raíl propio de 236 px con las 19 figuras agrupadas y con nombre, `<details>` plegables, filtro que también entiende el nombre del grupo, modo compacto de 48 px recordado en `localStorage` y el pie del artboard; la paleta de bpmn-js queda oculta | ✓ (los carriles se siguen añadiendo desde el context pad del pool, que es donde bpmn-js sabe colocarlos; el raíl aún no se puede redimensionar ni arrastrar para reordenar) |
| Lienzo | rejilla 24 px, chips «1 error · 2 avisos» arriba a la izquierda, marcador ⚠ sobre la figura con tooltip de validación (F2 renombrar, ⇥ propiedades), minimapa abajo a la izquierda, zoom +/−/ajustar abajo a la derecha, marca bpmn.io | rejilla, marca bpmn.io, minimapa «MINIMAPA ▾» abajo a la izquierda (`diagram-js-minimap` con tokens), zoom +/−/ajustar abajo a la derecha sin tapar la marca (#240, `app-01c-minimapa.png`), chips «n errores · n avisos» arriba a la izquierda y disco de 16 px sobre cada figura con problema, con el mensaje y «F2 renombrar · ⇥ propiedades» en el `title` (#241, `app-01d-marcadores.png`) | ✓ (el tooltip es el nativo del navegador, no la caja del artboard) |
| Panel derecho | cabecera con icono + nombre + `bpmn:UserTask · id`, campos con etiqueta versalita (NOMBRE, TIPO, CARRIL, ID), banda de aviso «Sin responsable asignado · CORREGIR», «Vista rápida · Simulación» con tiempo y recurso | pestañas iguales; el panel de propiedades existe (LILA-060) pero sin cabecera de tipo/id ni vista rápida | ≈ |
| Pestañas de diagrama | abajo, con ✕ por pestaña y «+» | pestaña «model.bpmn ✕» y «+» (un diagrama por proyecto: los dos pasan por la guardia de cambios) (#240) | ✓ (Deshacer/Rehacer suben a la barra en #237) |
| Barra de estado | «1 error · 2 avisos · Escenario AS-IS · Semilla 42 … Densidad normal · Zoom 100 %», todo en mono | igual (#237): conteos con su cuadradito de color, escenario activo, semilla resuelta por `extends`, densidad y zoom | ✓ (los conteos son los mismos que los chips del lienzo, #241) |
| 1920 | misma disposición; paleta de comandos abierta (Ir a actividad / Comandos con atajos); pestaña Documentación con Descripción, Responsable, Sistema, Entradas/Salidas, Riesgos y controles, KPIs | sin paleta de comandos (#66); Documentación es placeholder | ✗ |

### 03 · Simular con panel de escenario

Artefacto: columna izquierda con la lista de escenarios (AS-IS base, TO-BE…) y «+ Nuevo escenario», sub-pestañas «Parámetros · Validar rutas», panel derecho de 436 px con Escenario activo (Duplicar, Hereda de), Corrida (inicio, duración, máx. casos, warm-up, replicaciones, semilla con dado, unidad, moneda), tabla de Recursos, **calendario semanal por franjas**, Llegadas; barra superior con progreso «Replicación 3 de 10 · 31 %» y CANCELAR.

App: el panel de escenario existe (LILA-061) generado desde el JSON Schema, con selector, duplicar, corrida, recursos, calendarios como lista de intervalos y llegadas; progreso y cancelar ya están en la barra superior (#237: «Replicación 8 de 30 · 27 %» con barra de avance y CANCELAR). **≈**: funcionalmente cubierto, visualmente es un formulario genérico; faltan la lista de escenarios como columna y el editor semanal (#233).

### 04 · Overlay de cuellos de botella

Artefacto: leyenda «Espera por recurso < 8 m / 8–20 m / > 20 m» arriba a la izquierda, tareas teñidas con barra izquierda de 5 px y etiqueta bajo la figura «espera 34 m · util. 92 %», rótulo CUELLO DE BOTELLA sobre el principal, contadores de tokens en los flujos, panel derecho con ranking 1-2-3 y barras, «Siguiente paso» con acciones (duplicar escenario, comparar).

App: overlay LILA-064 tiñe las tareas y hay interruptor «Cuellos de botella». **≈**: faltan leyenda, etiquetas bajo la figura (#226), ranking con barras y «siguiente paso».

### 05 · Resultados

Artefacto: sub-pestañas Elementos / Recursos / Proceso / Flujos, tabla densa con cifras en mono alineadas a la derecha, fila de totales fija, celdas semáforo, columna derecha con KPIs (ciclo p50/p90/p95, throughput, costo por caso) y ranking de cuellos; barra superior con selector de escenario y EXPORTAR CSV.

App: LILA-062 tiene las cuatro tablas con nombres de Bizagi, ordenación y CSV. Las cifras ya van en
JetBrains Mono alineadas a la derecha, con el encabezado de columna numérica también a la derecha
(#238, `app-05-resultados.png`). **≈**: siguen fuera la fila de totales, los KPIs en tarjetas y el
semáforo de celdas —ninguno tiene ticket todavía—, y el selector de escenario y el CSV no están en la barra superior.

### 06 · Comparar

Artefacto: chips de escenarios arriba (base + añadir), interruptor «Solo diferencias», celdas con ▲ mejor / ▼ peor, delta % y sello `p<0,05`, tinte verde/rojo por celda, resumen al pie en prosa.

App: LILA-063 compara y resalta celdas con significancia. **≈**: faltan chips, «solo diferencias», deltas con flecha y el resumen en prosa; #210 (warnings y moneda) sigue abierto.

### 07 · Validar rutas

Artefacto: sub-pestaña de Simular con tokens animados, traza de ejecución numerada, tokens activos, controles ◀ ▶ ▶▶, velocidad 0,5×/1×/2×, Reiniciar. **✗** (#65).

### 08 · Bienvenida (escritorio)

Artefacto: dos columnas; izquierda con logo, versión, EMPEZAR (Abrir carpeta ⌘O, Nuevo proceso ⌘N, Abrir ejemplo) y enlaces; derecha con RECIENTES (nombre, ruta, diagramas, fecha), tarjeta de Novedades y pie «Tema Eva-01 · densidad normal · cambiar en Ajustes → Apariencia».

App: arranca directo con el ejemplo cargado; los recientes ya están en el menú Archivo. **✗** pantalla (#74).

### 09 · Ajustes → Apariencia

Artefacto: navegación de Ajustes (General, Apariencia, Editor y atajos, Simulación, Idioma y formato), lista de temas (integrados + «Eva-01 · mío editado»), editor de tokens por grupo con muestra + hex, tipografía (font.ui, font.mono, font.diagram, tamaño base con deslizador, densidad segmentada), vista previa en vivo con mini lienzo, panel de contraste con insignias AA/AAA, `theme.json` con los cambios, RESTABLECER / IMPORTAR / EXPORTAR.

App (hoy): diálogo con tema y densidad. **≈**: es el hueco donde entra #144; la base (tokens, `applyTheme`, persistencia, densidad) ya existe.

### 10 · Modelar con Papel

Artefacto: mismo layout, fondo `#F3F2F2`, superficie blanca, rojo `#EC3013` en primario/selección/pestaña activa, texto `#201E1D`. App: Papel ya se aplica en caliente y, con los tokens reconciliados, coincide en color. **✓** (`app-10-modelar-papel.png`, sesión 8: misma barra, paleta, minimapa, marcadores y pie que el artboard 01 en Papel; el rojo `#EC3013` manda en primario, pestaña activa y viewport del minimapa).

## Inventario de componentes del artefacto (reconcilia el de `README.md`)

- **Botones**: primario (relleno `accent.primary`, alto 32, etiqueta 11 px versalita alineada a la izquierda), secundario (borde `border.strong`), fantasma, destructivo (borde `status.error`), icono 30×30, grupos segmentados. **Sin radio.**
- **Campos**: alto 30 (29 en denso), fondo `bg.base`, borde `border`; foco = borde `accent.primary`; inválido = `status.error`. Edición en línea, nunca modal.
- **Tablas**: encabezado fijo sobre `bg.elevated` con regla inferior de 2 px, filas alternas, cifras en `font.mono` a la derecha, fila de totales fija, semáforo en espera/utilización.
- **Pestañas**: tres niveles (modos 3 px `accent.tertiary`; panel derecho y resultados 2 px; diagramas abajo con borde superior 3 px `accent.primary` y cierre).
- **Paneles**: paleta 236 px (compacta 48), panel derecho redimensionable 300–520 px y colapsable, panel de escenario 436 px, minimapa; divisor 1 px `border.strong` con zona de arrastre de 6 px.
- **Tooltips y marcadores**: tooltip sobre `bg.elevated` con sombra y atajos en mono; marcador de validación disco 16 px; etiqueta de simulación caja de 17 px bajo la figura. Nunca sobre la marca de agua.

## Notas de React del artefacto que contradicen o completan lo hecho

- «Cambiar un color no vuelve a montar nada» y «los tokens del diagrama se aplican con CSS sobre `.djs-visual` y con un `BpmnRenderer` propio». Hoy cambiar de tema remonta el lienzo (`key={temaId}`) porque los colores van por opciones del constructor; el camino del artefacto (renderer propio o CSS sobre `.djs-visual`) quitaría el remontaje y conservaría deshacer. Es la mejora natural cuando #144 exija cambios de color continuos.
- Persistencia «análoga a `workbench.colorCustomizations`: `{ name, type, colors, typography }`, solo claves modificadas sobre el tema padre, en `~/.lila/theme.json`». El repo fijó un objeto plano `{ name, tokens }` (`docs/THEMES.md`); mantenerlo, pero #144 debería guardar solo las claves modificadas sobre el tema padre.
- «Comparar usa t de Welch con α configurable» — coincide con el motor.
- «Deshacer/rehacer se extiende con comandos propios para los cambios de escenario» — no existe; hoy el panel de escenario no entra en la pila.

## Propuesta de orden (tickets)

Los cinco primeros están **hechos** (sesión 8, PR #242–#246 en `codex/ui-artefacto`); quedan los del punto 6.

1. **#237 LILA-205 · Barra superior y barra de estado como en el artefacto** (S): logo, proyecto+archivo, modos 3 px, acciones a iconos, «Ejecutar simulación» primario en la barra, tema por icono; estado con errores/avisos, escenario, semilla, densidad, zoom. Es lo que más acerca la sensación al diseño con poco código, y deja «Simular» donde el brief lo pide.
2. **#238 LILA-206 · Radio 0, JetBrains Mono y escala de densidad** (S): `border-radius: 0` en tokens/CSS, `font.mono` en tablas, ids y barra de estado; cargar JetBrains Mono con `@fontsource/jetbrains-mono`.
3. **#239 LILA-207 · Paleta izquierda propia** (M, tras #237): lista con nombres, grupos, filtro y modo compacto sobre `create`/`palette` de bpmn-js.
4. **#240 LILA-208 · Minimapa, zoom y pestañas de diagrama con cierre** (S): `diagram-js-minimap` + tres botones.
5. **#241 LILA-209 · Marcadores de validación y chips** (S): disco 16 px + tooltip con `overlays.add`.
6. #144 Apariencia completa (L) · #66 paleta de comandos (M) · #74 bienvenida (M) · #65 validar rutas (L) · #226 etiquetas del overlay (S) · #233 editor semanal (M).
