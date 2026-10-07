# Atajos de teclado

Lila Modeler tiene un solo mapa de atajos (`apps/web/src/atajos.ts`): el teclado, los tooltips,
el menú nativo de la app de escritorio y esta página salen de él, y un test falla si la versión en
inglés de esta página ([SHORTCUTS.md](../SHORTCUTS.md)) no trae alguna de sus teclas. En Windows y
Linux, `Ctrl` ocupa el lugar de `⌘`.

Los atajos sin `⌘`/`Ctrl` (F2, F6, Esc, los de alinear) no hacen nada mientras escribes en un campo o editas una
etiqueta, y, salvo el menú Archivo de la app de escritorio, ningún atajo llega a la app mientras
hay un diálogo abierto (Ajustes, una confirmación).

## Archivo

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Nuevo proyecto ¹ | `⌘N` | `Ctrl+N` |
| Abrir proyecto | `⌘O` | `Ctrl+O` |
| Guardar proyecto | `⌘S` | `Ctrl+S` |
| Guardar como | `⇧⌘S` | `Ctrl+Shift+S` |
| Imprimir el diagrama ² | `⌘P` | `Ctrl+P` |
| Ajustes ¹ | `⌘,` | `Ctrl+,` |

## Buscar

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Paleta de comandos | `⌘K` | `Ctrl+K` |

## Modos

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Modelar ¹ | `⌘1` | `Ctrl+1` |
| Simular ¹ | `⌘2` | `Ctrl+2` |
| Resultados ¹ | `⌘3` | `Ctrl+3` |

Las teclas numéricas se leen por posición, así que funcionan con cualquier distribución de teclado.
Cambiar de modo con el teclado es cosa de la app de escritorio: en un navegador estas teclas cambian
de pestaña del navegador, así que la app web no las toca; haz clic en la pestaña del modo o usa la
paleta de comandos (`⌘K`).

Hay tres modos. Comparar escenarios y reproducir los tokens viven en Resultados: «Comparar con…» en
su barra, y los tokens se mueven sobre el mismo mapa que el mapa de calor. Validar rutas (el
recorrido de tokens que comprueba las rutas, no la simulación) es una herramienta de Modelar: el
botón sobre el lienzo, o «Validar rutas» en `⌘K`.

## Simulación

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Ejecutar la simulación | `⌘↩` | `Ctrl+Enter` |
| Cancelar la corrida (solo mientras corre) | `Esc` | `Esc` |
| Panel de Simular: abrir el paso 1–6 (Llegadas, Tiempos, Rutas, Recursos, Calendarios, Ejecución) | `⌥1` `⌥2` `⌥3` `⌥4` `⌥5` `⌥6` | `Alt+1` `Alt+2` `Alt+3` `Alt+4` `Alt+5` `Alt+6` |
| Panel de Simular: quitar la selección (sin corrida en curso) | `Esc` | `Esc` |
| Reproducir o pausar los tokens (solo en Resultados) | `Space` | `Space` |

En Simular, `←`/`→` recorren las pestañas de los pasos de la barra bajo la barra superior cuando una de ellas tiene el
foco (`Inicio`/`Fin` saltan a la primera y a la última), y `Alt+1…6` funcionan también en la ventana desacoplada, y desde Modelar o Resultados —o desde la ventana principal con el panel desacoplado— pasan a Simular en ese paso; ni ellos ni `Esc` actúan mientras escribes en un campo. «▶ Simular» (el del panel, el de la barra superior y `⌘↩`) te lleva al
primer error en vez de correr mientras el escenario tenga alguno —el botón de la barra dice cuántos—; los avisos («! n» en un paso) no lo detienen.

`Space` (la barra espaciadora) no hace nada mientras escribes en un campo ni cuando un botón tiene
el foco (ahí pulsa el botón).

## Lienzo

Con el lienzo enfocado (haz clic en él primero):

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Acercar | `⌘+` | `Ctrl++` |
| Alejar | `⌘−` | `Ctrl+-` |
| Ajustar el diagrama | `⌘0` | `Ctrl+0` |
| Renombrar el elemento seleccionado | `F2` | `F2` |
| Deshacer | `⌘Z` | `Ctrl+Z` |
| Rehacer | `⇧⌘Z` | `Ctrl+Y` |
| Borrar la selección | `⌫` | `Del` |
| Seleccionar todo | `⌘A` | `Ctrl+A` |
| Copiar | `⌘C` | `Ctrl+C` |
| Pegar | `⌘V` | `Ctrl+V` |
| Herramienta lazo | `L` | `L` |
| Herramienta mano | `H` | `H` |
| Herramienta conectar | `C` | `C` |
| Editar la etiqueta | `E` | `E` |
| Reemplazar el elemento | `R` | `R` |
| Alinear a la izquierda | `⌥⇧L` | `Alt+Shift+L` |
| Centrar en horizontal | `⌥⇧C` | `Alt+Shift+C` |
| Alinear a la derecha | `⌥⇧R` | `Alt+Shift+R` |
| Alinear arriba | `⌥⇧T` | `Alt+Shift+T` |
| Centrar en vertical | `⌥⇧M` | `Alt+Shift+M` |
| Alinear abajo | `⌥⇧B` | `Alt+Shift+B` |
| Distribuir en horizontal | `⌥⇧H` | `Alt+Shift+H` |
| Distribuir en vertical | `⌥⇧V` | `Alt+Shift+V` |

Acercar, alejar y ajustar funcionan desde cualquier parte de la ventana, no solo desde el lienzo.
Los atajos de alinear solo funcionan en Modelar y actúan sobre las figuras seleccionadas (dos o
más; tres o más para distribuir), igual que los botones de alinear de la esquina superior derecha
del lienzo y la paleta de comandos. Los carriles no se alinean. Distribuir deja la primera y la
última figura donde están y reparte el resto de forma aproximadamente uniforme: diagram-js deja el
primer hueco unos pocos píxeles (unos 5 px) más corto que los demás. Las figuras que se solapan en
ese eje se mueven juntas, como una sola columna o fila.
La paleta de figuras de la izquierda filtra al teclear e inserta la figura resaltada con `Enter`.

## Paneles

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Mostrar u ocultar la columna izquierda | `⇧⌘L` | `Ctrl+Shift+L` |
| Mostrar u ocultar el panel derecho | `⇧⌘P` | `Ctrl+Shift+P` |
| Mostrar u ocultar las pestañas de diagramas | `⇧⌘D` | `Ctrl+Shift+D` |
| Mostrar u ocultar la barra de estado | `⇧⌘B` | `Ctrl+Shift+B` |
| Mostrar u ocultar la tabla de resultados (Resultados) | `⌘J` | `Ctrl+J` |
| Llevar el foco a los modos | `F6` | `F6` |
| Llevar el foco al panel derecho | `⇧F6` | `Shift+F6` |

`Tab` siempre mueve el foco, también desde el lienzo.

## Teclas que se queda el navegador

¹ Solo en la app de escritorio. En un navegador, `⌘N`/`Ctrl+N` (ventana nueva) y `⌘,` (ajustes del
navegador) se los queda el navegador antes de que la página los vea, y la app web no escucha
`⌘1`…`⌘3`/`Ctrl+1`…`Ctrl+3` para que sigan cambiando de pestaña del navegador: usa los botones de
la barra, las pestañas de modo o `⌘K`. En la app de escritorio,
los menús Archivo, Vista y Simulación enseñan estos atajos junto a cada entrada.

² Imprime solo el diagrama, en negro sobre blanco, en una hoja. En el navegador ese diálogo de
imprimir es también la forma de sacar un PDF (elige «Guardar como PDF»); la app de escritorio tiene
además «Archivo → Exportar diagrama como PDF…». Las exportaciones SVG y PNG, y el documento del
proceso (Word o HTML), están en el menú Archivo y en la paleta de comandos, sin tecla propia.

En la app de escritorio `⌘W`/`Ctrl+W` cierra la ventana enfocada (Acerca de o la ventana
desacoplada del escenario, solas; la principal pregunta antes si hay cambios sin guardar y, como su
botón rojo, cierra la app) y `⌘Q`/`Ctrl+Q` sale (en Windows, el botón de cerrar de la ventana o
`Alt+F4`). Las dos vienen de los roles del menú nativo, así que no están en el mapa de arriba y un
navegador se las queda.

La ventana desacoplada del escenario reenvía `⌘S`, `⇧⌘S` y `⌘P` a la ventana principal; `⌘K` también, pero solo en la app de escritorio, que trae la ventana principal al frente (un navegador no puede levantar otra ventana, así que ahí la tecla no hace nada en la desacoplada).

[English version](../SHORTCUTS.md)
