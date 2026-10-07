# Guía para probar Lila Modeler en Windows

> Leer en: [English](../WINDOWS-TESTER-GUIDE.md)

Gracias por probar Lila Modeler en Windows. **Nadie del proyecto ha ejecutado todavía el instalador
de Windows en una máquina Windows real**, así que eres la primera persona: puede que algo no
funcione, y un reporte claro de qué funcionó y qué no es justo lo que necesitamos. No hace falta ser
desarrollador. Reserva unos 30 minutos.

Dos cosas que conviene saber antes de empezar:

- El instalador **no está firmado**, así que Windows te avisará antes de dejarte ejecutarlo (paso 3).
  El proyecto pidió una firma a SignPath Foundation y la rechazó hasta que haya usuarios; no existe
  un build firmado de Windows. El aviso es lo esperado, y los pasos de abajo explican cómo continuar.
- Lila Modeler corre por completo en tu computadora: no hay cuenta y no se sube nada. Tus archivos se
  quedan donde los guardes.

## Qué necesitas

- Windows 10 o Windows 11 de 64 bits (x64).
- Microsoft Excel u otro programa de hojas de cálculo (pasos 7 y 9), y Microsoft Word u otro programa
  que abra archivos `.docx` (paso 8).

## Pasos

Los nombres de menús y botones de abajo son los de la app en español. Si tu app está en inglés,
abre **File ▸ Preferences…** (`Ctrl+,`), ve a **General** y pon **Language** en **Español**, o lee la
[guía en inglés](../WINDOWS-TESTER-GUIDE.md), que usa los nombres en inglés.

1. **Descarga el instalador.** Abre la
   [versión `v1.0.0-beta.16`](https://github.com/AlambritoDito/lila-modeler/releases/tag/v1.0.0-beta.16)
   (es un prerelease, así que no aparece como «Latest») y descarga
   `Lila-Modeler-1.0.0-beta.16-win-x64.exe` de la lista **Assets**. Tu navegador puede pedirte que
   confirmes que quieres conservar el archivo; confírmalo.
2. **Opcional: verifica la descarga.** Abre en el Explorador de archivos la carpeta donde guardaste el
   archivo (normalmente **Descargas**), haz clic derecho en un espacio vacío y elige **Abrir en
   Terminal** (o escribe `powershell` en la barra de direcciones y pulsa Enter). Ejecuta
   `Get-FileHash .\Lila-Modeler-1.0.0-beta.16-win-x64.exe -Algorithm SHA256` y compara el resultado
   con la línea de ese archivo en el `SHA256SUMS` del release (descárgalo también). Da igual si son
   mayúsculas o minúsculas. Si no coinciden, no ejecutes el archivo y avísanos.
3. **Pasa el aviso de SmartScreen.** Haz doble clic en el `.exe`. Windows muestra **«Windows protegió
   su PC»**. Pulsa **Más información** y luego **Ejecutar de todas formas**. Si Windows pide permiso
   para hacer cambios, elige **Sí**. Si aparece algo distinto (otro mensaje, un bloqueo del antivirus,
   ningún botón), toma una captura: eso también es un resultado.
4. **Instala.** Se espera que el instalador funcione con un solo clic, sin preguntas, y abra Lila
   Modeler al terminar. Si muestra un asistente, síguelo y anótalo en tu reporte.
5. **Primer arranque.** Deberías ver la pantalla de **Bienvenida** con la versión
   (`v1.0.0-beta.16`), **Empezar**, una lista de **Ejemplos** y **Recientes**. Si el Firewall de
   Windows Defender pregunta por el acceso a la red, puedes elegir **Cancelar**; la app no lo necesita.
6. **Abre un ejemplo.** En **Ejemplos**, pulsa **Pedido de restaurante**. Se abre un diagrama con dos
   escenarios listos para correr.
7. **Corre una simulación.** Pulsa **Simular** en la barra superior y luego **Ejecutar simulación**.
   La app pasa a **Resultados**: el diagrama muestra las esperas y los cuellos de botella, y la tabla
   de resultados de abajo lista cada tarea. Expórtalas: pulsa **XLSX** en la cabecera de esa tabla,
   elige dónde guardar y abre el archivo en Excel. Comprueba que abre y tiene varias hojas con números.
8. **Exporta el documento del proceso.** Elige **Archivo ▸ Exportar documento del proceso (Word)…**,
   guarda el archivo y ábrelo en Word. Comprueba que tiene portada, el diagrama y una sección por
   elemento.
9. **Importa parámetros de escenario desde Excel.** Vuelve a **Simular**. Abre **Escenario ▾** sobre
   el lienzo, pulsa **Descargar plantilla** y guarda el `.xlsx`. Ábrelo en Excel, cambia un número
   (en la hoja **Elements**, fila **Take order**, columna **min**: ponlo más pequeño), guarda y cierra Excel. De vuelta en Lila Modeler pulsa
   **Importar Excel/CSV…** y elige ese archivo. Un informe lista los cambios por aplicar: comprueba
   que tu cambio está, y pulsa **Aplicar**. Después puedes pulsar **Deshacer importación**. Más en
   [Parámetros de escenario desde Excel o CSV](SCENARIO_SHEETS.md).
10. **Agrega un segundo proceso.** Debajo del diagrama, en la fila de pestañas de procesos, pulsa el
    botón **+** junto a la pestaña (tooltip **Nuevo proceso**; no el + de zoom del borde derecho del
    lienzo).
    Deja el nombre sugerido en **Nombre del proceso** y pulsa **Crear**. Aparece una segunda pestaña;
    alterna entre las dos para comprobar que cada una conserva su diagrama.
11. **Guarda como archivo `.lila`.** Elige **Archivo ▸ Guardar como…**, escoge una carpeta que
    recuerdes (por ejemplo Documentos) y un nombre, y guarda. El archivo termina en `.lila` y contiene
    los dos procesos.
12. **Ciérralo y ábrelo de nuevo.** Cierra la app (la **X** de la ventana, o `Alt+F4`). Si pregunta
    por cambios sin guardar, elige **Guardar**. Luego, en el Explorador de archivos, **haz doble clic
    en el archivo `.lila`**. Lila Modeler debería abrirse con los dos procesos. Si Windows pregunta
    con qué app abrirlo, elige **Lila Modeler**. Si el doble clic no hace nada, abre la app y usa
    **Archivo ▸ Abrir archivo de proyecto (.lila)…**, y di en tu reporte que el doble clic falló. Si
    tienes un `.bpmn` o `.xml` exportado de otra herramienta (Bizagi, Camunda, Signavio…), prueba
    también **Archivo ▸ Importar BPMN…** con él y di si apareció su diagrama.
13. **Desinstala.** Abre **Configuración ▸ Aplicaciones ▸ Aplicaciones instaladas** (Windows 10:
    **Aplicaciones y características**), busca **Lila Modeler** y elige **Desinstalar**. Comprueba que
    desaparece de la lista. Tu `.lila` y los archivos exportados se quedan donde los guardaste.

## Reporta qué pasó

Reporta aunque todo haya funcionado («los 13 pasos bien» sirve). Usa una de estas vías:

- Abre un issue en [github.com/AlambritoDito/lila-modeler/issues/new](https://github.com/AlambritoDito/lila-modeler/issues/new/choose)
  y pega la plantilla de abajo. No pongas nada privado; las capturas pueden recortarse a la ventana
  de la app.
- O manda el mismo texto, con las capturas, por mensaje a quien te dio esta guía.

Para saber tu versión de Windows, pulsa `Win+R`, escribe `winver` y pulsa Enter.

```text
Versión de Lila Modeler: 1.0.0-beta.16 (Archivo ▸ Acerca de Lila Modeler)
Versión y compilación de Windows (de winver):
Idioma de Windows e idioma de la app (español / inglés):
Equipo: (por ejemplo laptop, 8 GB de RAM; antivirus si lo sabes)

Paso por paso (bien / falló / omitido, y una nota):
1  Descarga:
2  Checksum (opcional):
3  Aviso de SmartScreen:
4  Instalación:
5  Primer arranque (pantalla de Bienvenida):
6  Abrir el ejemplo Pedido de restaurante:
7  Correr una simulación y exportar XLSX:
8  Exportar el documento del proceso (Word):
9  Importar parámetros desde Excel:
10 Segundo proceso con la pestaña +:
11 Guardar como .lila:
12 Cerrar y reabrir con doble clic:
13 Desinstalar:

En cada paso que falló: qué hiciste, qué esperabas, qué pasó.
Mensaje de error exacto (copia el texto o adjunta una captura):
Capturas adjuntas: sí / no
Algo más que se sintió lento, confuso o raro:
```
