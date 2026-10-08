# Guía para probar la app web en Windows

> Leer en: [English](../WINDOWS-PWA-TESTER-GUIDE.md)

Gracias por probar Lila Modeler en Windows. En Windows, Lila Modeler está pensada para usarse como
**app web instalada desde Microsoft Edge o Google Chrome** ([ADR-031](DECISIONS.md)): tiene su
propia ventana y su entrada en el menú Inicio, abre archivos `.lila` con doble clic y guarda sobre el
mismo archivo. **Nadie del proyecto lo ha hecho todavía en una máquina Windows real**, así que eres
la primera persona: puede que algo no funcione, y un reporte claro de qué funcionó y qué no es justo
lo que necesitamos. No hace falta ser desarrollador. Reserva unos 20 minutos.

Dos cosas que conviene saber antes de empezar:

- No hay nada que descargar ni instalador: ni aviso de SmartScreen ni permisos de administrador. El
  navegador instala la app desde el sitio del proyecto.
- Lila Modeler corre por completo en tu navegador: no hay cuenta y no se sube nada. Tus archivos se
  quedan donde los guardes.

(El instalador `.exe` sin firmar es otra opción, secundaria, con su propia
[guía](GUIA-PROBADOR-WINDOWS.md). Para esta no lo necesitas.)

## Qué necesitas

- Windows 10 o Windows 11.
- Microsoft Edge (viene con Windows). Si además tienes Google Chrome, el paso 12 repite ahí los
  pasos principales.
- Conexión a internet para la primera visita; el paso 10 comprueba que luego funciona sin ella.

## Pasos

Los nombres de menús y botones de abajo son los de la app en español. Si la app aparece en inglés,
pulsa **Settings** (el engrane arriba a la derecha) y pon **Language** en **Español**, o lee la
[guía en inglés](../WINDOWS-PWA-TESTER-GUIDE.md), que usa los nombres en inglés. Los menús del
navegador cambian un poco entre versiones: si un nombre no coincide exactamente, elige el más
parecido y anótalo en tu reporte.

1. **Abre la app en Edge.** Ve a <https://alambritodito.github.io/lila-modeler/app/>. Durante un
   momento aparece una pantalla blanca con el logo de Lila Modeler y un número de versión (por
   ejemplo `v1.0.0-beta.22`), y luego el editor con un diagrama de ejemplo (un pedido de
   restaurante). Anota la versión que viste.
2. **Instálala.** En la barra de direcciones, pulsa el icono **Aplicación disponible** (un cuadrito
   con un signo más o una flecha hacia abajo), o abre el menú **⋯** ▸ **Aplicaciones** ▸ **Instalar
   este sitio como una aplicación**. El diálogo debe decir **Lila Modeler** con el icono del perrito
   morado; pulsa **Instalar**. Edge puede ofrecer anclarla a la barra de tareas o a Inicio; acepta lo
   que prefieras. La app se vuelve a abrir en su propia ventana, sin barra de direcciones.
3. **Ábrela desde Inicio.** Cierra esa ventana. Abre el menú **Inicio**, escribe `Lila` y abre
   **Lila Modeler**. Debe abrirse en su propia ventana, con el icono del perrito morado en la barra
   de tareas.
4. **Corre una simulación.** Pulsa **Simular** en la barra superior y luego **Ejecutar simulación**.
   Al terminar, el panel bajo el lienzo muestra los resultados rápidos.
5. **Guarda como archivo `.lila`.** Pulsa **Archivo ▸ Guardar como**. Se abre el diálogo
   **Guardar como** de Windows de siempre (no una descarga). Elige una carpeta que conozcas (por
   ejemplo **Documentos**), deja o cambia el nombre y pulsa **Guardar**. En el Explorador de
   archivos, comprueba que la carpeta tiene ahora un archivo terminado en `.lila` y que en
   **Descargas** no apareció nada nuevo.
6. **Vuelve a guardar en el mismo archivo.** De vuelta en la app, pulsa una tarea del diagrama,
   cambia su nombre (doble clic sobre ella y escribe) y pulsa `Ctrl+S` (o **Archivo ▸ Guardar**).
   Esta vez **no debe aparecer ningún diálogo**. Si el navegador pregunta si Lila Modeler puede
   guardar cambios en el archivo, elige **Permitir** (o **Guardar cambios**). En el Explorador,
   comprueba que la **Fecha de modificación** del mismo `.lila` cambió y que no hay una segunda copia.
7. **Ábrelo con doble clic.** Cierra la ventana de la app. En el Explorador, **haz doble clic en el
   archivo `.lila`**. Lila Modeler debe abrirse en su propia ventana con la tarea renombrada. La
   primera vez, Windows puede preguntar con qué app abrirlo (elige **Lila Modeler**) y el navegador
   puede preguntar si Lila Modeler puede abrir archivos `.lila` (elige **Permitir**; puedes marcar
   **Recordar mi elección**). Si el doble clic abre otra cosa o nada, abre la app desde Inicio y usa
   **Archivo ▸ Abrir**, y di en tu reporte que el doble clic falló.
8. **Doble clic con cambios sin guardar.** Con el proyecto abierto, vuelve a cambiar algo (por
   ejemplo renombra otra tarea) y **no** guardes. Haz doble clic otra vez en el mismo `.lila` en el
   Explorador. La app debe preguntar por **Cambios sin guardar** con **Guardar y continuar**,
   **Descartar** y **Cancelar**. Pulsa **Descartar**: el archivo se vuelve a abrir tal como está en
   disco, sin tu último cambio.
9. **Abre desde dentro de la app.** Pulsa **Archivo ▸ Abrir**. Aparece el diálogo **Abrir** de
   Windows; elige tu `.lila` y pulsa **Abrir**. Luego cambia algo y pulsa `Ctrl+S`: debe guardar en
   ese archivo sin preguntar dónde.
10. **Úsala sin conexión.** Cierra la app. Activa el modo avión (o desconecta el cable de red).
    Abre **Lila Modeler** desde Inicio: debe abrirse con el editor, y el paso 4 debe seguir
    funcionando. Vuelve a conectarte.
11. **Desinstala.** En la ventana de la app, abre el menú **⋯** arriba a la derecha ▸
    **Desinstalar Lila Modeler** (o **Configuración de la aplicación** ▸ **Desinstalar**; o
    **Configuración ▸ Aplicaciones ▸ Aplicaciones instaladas** en Windows). Confirma. Comprueba que
    **Lila Modeler** desaparece de Inicio. Tu archivo `.lila` se queda donde lo guardaste.
12. **Opcional: repite con Chrome.** Si tienes Google Chrome, abre ahí la misma dirección e
    instálala con el icono de instalar de la barra de direcciones (un monitor con una flecha hacia
    abajo) o **⋮ ▸ Enviar, guardar y compartir ▸ Instalar página como aplicación…**. Luego repite
    los pasos 3 a 7 y 11 y anota cualquier diferencia.

## Reporta qué pasó

Reporta aunque todo haya funcionado («los 12 pasos bien» es útil). Usa una de estas vías:

- Abre un issue en [github.com/AlambritoDito/lila-modeler/issues/new](https://github.com/AlambritoDito/lila-modeler/issues/new/choose)
  y pega la plantilla de abajo. Por favor no pongas nada privado; las capturas se pueden recortar a
  la ventana de la app.
- O manda el mismo texto, con las capturas, por mensaje a la persona que te dio esta guía.

Para saber tu versión de Windows, pulsa `Win+R`, escribe `winver` y pulsa Enter. Para saber la
versión del navegador, abre `edge://version` (o `chrome://version`) en una pestaña normal.

```text
Versión de Lila Modeler (paso 1):
Versión y compilación de Windows (de winver):
Navegador y versión (Edge / Chrome, de edge://version o chrome://version):
Idioma de Windows e idioma de la app (español / inglés):
Equipo: (por ejemplo laptop, 8 GB de RAM; administrado por una empresa o escuela: sí / no)

Paso a paso (bien / falló / omitido, y una nota):
1  Abrir la app en Edge:
2  Instalarla:
3  Abrirla desde Inicio:
4  Correr una simulación:
5  Guardar como .lila (diálogo Guardar como de Windows, sin descarga):
6  Volver a guardar en el mismo archivo (sin diálogo, mismo archivo actualizado):
7  Abrir con doble clic:
8  Doble clic con cambios sin guardar (diálogo Cambios sin guardar):
9  Archivo ▸ Abrir y guardar en el mismo archivo:
10 Sin conexión:
11 Desinstalar:
12 Chrome (opcional):

Por cada paso que falló: qué hiciste, qué esperabas, qué pasó.
Mensaje exacto de cualquier aviso del navegador o de Windows (copia el texto o adjunta una captura):
Capturas adjuntas: sí / no
Cualquier otra cosa que se sintiera lenta, confusa o rara:
```
