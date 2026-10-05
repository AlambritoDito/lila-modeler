# Guía para probar la app web en Windows

> Leer en: [English](../WINDOWS-PWA-TESTER-GUIDE.md)

Gracias por probar Lila Modeler en Windows. En Windows la forma recomendada de usarlo es la app web
**instalada desde Chrome o Microsoft Edge**: tiene su propia ventana y entrada en el menú Inicio,
abre archivos `.lila` con doble clic y guarda de vuelta en el mismo archivo, sin instalador y sin
avisos de seguridad. **Nadie del proyecto lo ha probado todavía en una máquina Windows real**, así
que eres la primera persona: puede que algo no funcione, y un reporte claro de qué funcionó y qué no
es justo lo que necesitamos. No hace falta ser desarrollador. Reserva unos 20 minutos.

Lila Modeler corre por completo en tu computadora: no hay cuenta y tus modelos no se suben a ningún
sitio. Tus archivos se quedan donde los guardes. Sí necesita conexión a internet para arrancar.

## Qué necesitas

- Windows 10 o Windows 11.
- **Google Chrome** o **Microsoft Edge** (Edge viene con Windows), actualizado. Si tienes los dos,
  hacer la guía una vez en cada uno vale el doble, pero con uno basta.
- Firefox no instala apps web, así que no entra en esta guía.

## Pasos

Los nombres de menús y botones de abajo son los de la app en español. Si la app aparece en inglés,
abre **Settings** (`Ctrl+,`), ve a **General** y pon **Language** en **Español**, o lee la
[guía en inglés](../WINDOWS-PWA-TESTER-GUIDE.md), que usa los nombres en inglés. Los menús de los
navegadores cambian entre versiones; si un nombre de abajo no coincide exactamente, busca el más
parecido y dilo en tu reporte.

1. **Abre la app.** En Chrome o Edge, ve a <https://alambritodito.github.io/lila-modeler/app/>.
   Aparece una pantalla de carga breve con el logo de Lila Modeler y luego el editor con un
   diagrama.
2. **Instálala.**
   - **Chrome:** pulsa el icono de instalar al final de la barra de direcciones (una pantallita con
     una flecha hacia abajo) y luego **Instalar**. Si no hay icono, abre el menú **⋮** ▸ **Enviar,
     guardar y compartir** ▸ **Instalar página como aplicación…** y pulsa **Instalar**.
   - **Edge:** pulsa el icono **Aplicación disponible** de la barra de direcciones y luego
     **Instalar**, o abre el menú **…** ▸ **Aplicaciones** ▸ **Instalar este sitio como una
     aplicación** y pulsa **Instalar**.

   La app se abre en su propia ventana, sin barra de direcciones. Edge puede preguntar si la anclas
   a la barra de tareas o al menú Inicio; cualquier respuesta vale. Comprueba que **Lila Modeler**
   aparece ahora en el menú Inicio con el icono morado de Lila.
3. **Abre el ejemplo.** En la ventana de la app, el ejemplo **Pedido de restaurante** debería estar
   en el lienzo (un diagrama con tareas como **Take order**; el ejemplo está en inglés). Si el lienzo está vacío, dilo en el reporte.
4. **Ejecuta una simulación.** Pulsa **Simular** en la barra superior y luego **Ejecutar
   simulación**. El panel bajo el lienzo muestra los resultados rápidos. Pulsa **Abrir en
   Resultados** para ver las tablas completas.
5. **Guarda como archivo `.lila`.** Abre **Archivo ▸ Guardar**. La primera vez, una ventana
   **Guardar como** de Windows pregunta dónde: elige una carpeta que conozcas (por ejemplo
   **Documentos**), deja o cambia el nombre y pulsa **Guardar**. El archivo termina en `.lila`.
6. **Guarda otra vez en el mismo archivo.** Vuelve a **Modelar**, mueve un poco una figura y abre
   otra vez **Archivo ▸ Guardar**. Esta vez **no debería aparecer ninguna ventana ni descargarse
   nada**: se reescribe el mismo archivo. Mira tu carpeta **Descargas**: no debería haber ningún
   `.lila` nuevo. Si el navegador pregunta si el sitio puede guardar cambios en el archivo, pulsa
   **Guardar cambios** (o **Permitir**).
7. **Cierra la app.** Cierra su ventana con la **X**. Si avisa de cambios sin guardar, sal de todos
   modos solo si acabas de guardar.
8. **Abre el archivo con doble clic.** En el Explorador de archivos, ve a la carpeta del paso 5 y
   **haz doble clic en el archivo `.lila`**. La primera vez, Windows puede preguntar **¿Cómo quieres
   abrir este archivo?**: elige **Lila Modeler** (marca «Usar siempre esta aplicación» si aparece).
   Después el navegador puede pedir permiso para abrir el archivo (por ejemplo «¿Abrir archivo?» o
   «¿Permitir que Lila Modeler abra archivos `.lila`?»): permítelo. Lila Modeler debería abrirse en
   su propia ventana con tu proyecto guardado, incluidos los resultados de la simulación en
   **Resultados**. Si el doble clic no hace nada o abre otra cosa, abre la app desde el menú Inicio,
   usa **Archivo ▸ Abrir** y di en tu reporte que el doble clic falló.
9. **Guarda después del doble clic.** Mueve otra vez una figura y elige **Archivo ▸ Guardar**. Como
   en el paso 6, se debería reescribir el mismo archivo sin descargar nada (el navegador puede pedir
   una vez permiso para guardar cambios).
10. **Desinstala.**
    - **Chrome:** en la ventana de la app, abre el menú **⋮** de su barra de título ▸ **Desinstalar
      Lila Modeler…** ▸ **Quitar**. (También: ve a `chrome://apps` en Chrome, clic derecho sobre
      Lila Modeler ▸ **Quitar de Chrome…**.)
    - **Edge:** en la ventana de la app, abre el menú **…** ▸ **Configuración de la aplicación** (o
      ve a `edge://apps`) y elige **Desinstalar** para Lila Modeler.
    - **Cualquiera de los dos:** **Configuración ▸ Aplicaciones ▸ Aplicaciones instaladas** de
      Windows (Windows 10: **Aplicaciones y características**) también muestra **Lila Modeler**;
      **Desinstalar** ahí también la quita.

    Comprueba que desaparece del menú Inicio. Tus archivos `.lila` se quedan donde los guardaste.

## Reporta qué pasó

Reporta aunque todo haya funcionado («los 10 pasos bien en Edge» es útil). Usa una de estas vías:

- Abre un issue en [github.com/AlambritoDito/lila-modeler/issues/new](https://github.com/AlambritoDito/lila-modeler/issues/new/choose)
  y pega la plantilla de abajo. No pongas nada privado; las capturas se pueden recortar a la
  ventana de la app.
- O manda el mismo texto, con las capturas, por mensaje a la persona que te pasó esta guía.

Para saber tu versión de Windows, pulsa `Win+R`, escribe `winver` y pulsa Enter. La versión del
navegador está en **⋮ ▸ Ayuda ▸ Información de Google Chrome** o en **… ▸ Ayuda y comentarios ▸
Acerca de Microsoft Edge**.

```text
Versión de Lila Modeler: (Archivo ▸ Acerca de Lila Modeler)
Versión y compilación de Windows (de winver):
Navegador y versión (Chrome / Edge):
Idioma de Windows e idioma de la app (español / inglés):

Paso a paso (OK / falló / omitido, y una nota):
1  Abrir la app:
2  Instalarla:
3  Ejemplo Pedido de restaurante en el lienzo:
4  Ejecutar una simulación:
5  El primer guardado pregunta dónde:
6  Segundo guardado, mismo archivo, sin descarga:
7  Cerrar la app:
8  Abrir con doble clic:
9  Guardar después del doble clic:
10 Desinstalar (cómo):

Para cada paso que falló: qué hiciste, qué esperabas, qué pasó.
Mensaje de error exacto (copia el texto o adjunta una captura):
Capturas adjuntas: sí / no
Cualquier otra cosa lenta, confusa o rara:
```
