# Atajos de teclado

Lila Modeler tiene un solo mapa de atajos (`apps/web/src/atajos.ts`): el teclado, los tooltips,
el menú nativo de la app de escritorio y esta página salen de él, y un test falla si la versión en
inglés de esta página ([SHORTCUTS.md](../SHORTCUTS.md)) no trae alguna de sus teclas. En Windows y
Linux, `Ctrl` ocupa el lugar de `⌘`.

Los atajos sin `⌘`/`Ctrl` (F2, F6, Esc) no hacen nada mientras escribes en un campo o editas una
etiqueta, y, salvo el menú Archivo de la app de escritorio, ningún atajo llega a la app mientras
hay un diálogo abierto (Ajustes, una confirmación).

## Archivo

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Nuevo proyecto ¹ | `⌘N` | `Ctrl+N` |
| Abrir proyecto | `⌘O` | `Ctrl+O` |
| Guardar proyecto | `⌘S` | `Ctrl+S` |
| Guardar como | `⇧⌘S` | `Ctrl+Shift+S` |
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
| Comparar ¹ | `⌘4` | `Ctrl+4` |
| Animar ¹ | `⌘5` | `Ctrl+5` |
| Validar rutas ¹ | `⌘6` | `Ctrl+6` |

Las teclas numéricas se leen por posición, así que funcionan con cualquier distribución de teclado.
Cambiar de modo con el teclado es cosa de la app de escritorio: en un navegador estas teclas cambian
de pestaña del navegador, así que la app web no las toca; haz clic en la pestaña del modo o usa la
paleta de comandos (`⌘K`).

## Simulación

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Ejecutar la simulación | `⌘↩` | `Ctrl+Enter` |
| Cancelar la corrida (solo mientras corre) | `Esc` | `Esc` |

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

Acercar, alejar y ajustar funcionan desde cualquier parte de la ventana, no solo desde el lienzo.
La paleta de figuras de la izquierda filtra al teclear e inserta la figura resaltada con `Enter`.

## Paneles

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Mostrar u ocultar la columna izquierda | `⇧⌘L` | `Ctrl+Shift+L` |
| Mostrar u ocultar el panel derecho | `⇧⌘P` | `Ctrl+Shift+P` |
| Mostrar u ocultar las pestañas de diagramas | `⇧⌘D` | `Ctrl+Shift+D` |
| Mostrar u ocultar la barra de estado | `⇧⌘B` | `Ctrl+Shift+B` |
| Llevar el foco a los modos | `F6` | `F6` |
| Llevar el foco al panel derecho | `⇧F6` | `Shift+F6` |

`Tab` siempre mueve el foco, también desde el lienzo.

## Teclas que se queda el navegador

¹ Solo en la app de escritorio. En un navegador, `⌘N`/`Ctrl+N` (ventana nueva) y `⌘,` (ajustes del
navegador) se los queda el navegador antes de que la página los vea, y la app web no escucha
`⌘1`…`⌘6`/`Ctrl+1`…`Ctrl+6` para que sigan cambiando de pestaña del navegador: usa los botones de
la barra, las pestañas de modo o `⌘K`. En la app de escritorio,
los menús Archivo, Vista y Simulación enseñan estos atajos junto a cada entrada.

La ventana desacoplada del escenario reenvía `⌘S` y `⇧⌘S` a la ventana principal; `⌘K` también, pero solo en la app de escritorio, que trae la ventana principal al frente (un navegador no puede levantar otra ventana, así que ahí la tecla no hace nada en la desacoplada).

[English version](../SHORTCUTS.md)
