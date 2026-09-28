# Parámetros del escenario desde Excel o CSV

> Leer en: [English](../SCENARIO_SHEETS.md)

El panel de escenario puede rellenar un escenario desde una hoja de cálculo: tiempos de
procesamiento, llegadas, grupos de recursos, qué grupo usa cada tarea y los calendarios semanales.
Está pensado para los parámetros que ya tienes en Excel, así no hay que copiarlos campo a campo.

1. En el panel de escenario, pulsa **Descargar plantilla**. Obtienes un `.xlsx` con una hoja por
   tabla, ya rellena con el escenario que editas y con una fila por elemento del diagrama.
2. Edítala en Excel, LibreOffice, Numbers o Google Sheets. Cambia lo que necesites y deja el resto.
3. Pulsa **Importar Excel/CSV…** y elige el archivo. Todavía no cambia nada: el panel enseña lo que
   cambiaría, las filas que no coinciden con nada y los valores inválidos, cada uno con su hoja,
   fila y columna.
4. **Aplicar** escribe los cambios en el escenario que editas, y **Deshacer importación** los
   revierte mientras no hayas editado nada más. **Cancelar** deja el escenario como estaba.

El resultado es una edición normal del escenario, así que la lista de validación del panel lo
revisa como siempre. Si el escenario hereda de otro (`extends`), los cambios van al archivo de este
escenario, igual que cuando editas un campo a mano ([SCENARIO_FORMAT.md](SCENARIO_FORMAT.md) § 6).

## Reglas

- **Una celda vacía no cambia nada.** La importación rellena el escenario, no lo reemplaza. Una
  hoja con solo la columna `mean` cambia las medias y nada más. Una hoja o una fila que el archivo
  no trae deja esos valores como están.
- **Las filas se emparejan por id BPMN y, si no hay id, por nombre BPMN.** El nombre se compara
  sin distinguir mayúsculas y sin espacios de más. Si dos elementos comparten nombre, la fila se
  informa como ambigua y no se aplica: escribe el id para elegir uno.
- **Una fila se aplica entera o no se aplica.** Si una fila tiene un valor inválido, no se aplica
  nada de esa fila. Las asignaciones de una tarea y los intervalos de un calendario ocupan varias
  filas: una fila inválida deja esa tarea o ese calendario sin cambios.
- **Los valores se comprueban con las mismas reglas que el escenario**
  ([SCENARIO_FORMAT.md](SCENARIO_FORMAT.md) § 3 y § 5), así que los motivos son los que dan el
  panel y la CLI.
- Los nombres de columnas y de hojas van en inglés, como en la plantilla. Las mayúsculas, los
  espacios y una unidad entre paréntesis no importan: `Fixed cost (MXN)` es `fixedCost`. Las hojas
  también pueden llamarse `Elementos`, `Llegadas`, `Recursos`, `Asignaciones` y `Calendarios`. Las
  columnas desconocidas se ignoran con una nota.
- Los números pueden llevar coma decimal (`7,5`), separador de miles (`1.234,5` o `1,234.5`) y
  porcentaje (`78%` es `0.78`).

## Hojas

### Elements

Una fila por tarea, temporizador, evento de fin y flujo de salida de una compuerta.

| Columna | Significado |
|---|---|
| `id`, `name` | Id y nombre BPMN del elemento. Basta con uno de los dos. |
| `kind` | `task`, `timer`, `end`, `flow`… Solo informativa: la importación la ignora. |
| `distribution` | Distribución del tiempo de procesamiento (`processingTime`): `constant`, `uniform`, `triangular`, `exponential`, `normal`, `truncatedNormal`, `lognormal`, `gamma`, `erlang`, `weibull`, `beta`, `poisson`, `binomial` o `user`. También valen en español: `constante`, `uniforme`, `exponencial`, `normal truncada`, `usuario`. |
| `unit` | Unidad de los tiempos de la fila: `s`, `min`, `h` o `day`. Vacía es `run.baseTimeUnit`, la unidad que muestra el panel. |
| `value` … `p` | Una columna por parámetro de distribución: `value`, `min`, `mode`, `max`, `mean`, `sd`, `shape`, `scale`, `k`, `alpha`, `beta`, `n`, `p`. Rellena los de la distribución elegida y deja vacíos los demás. `value`, `min`, `mode`, `max`, `mean` y `sd` son tiempos en `unit`. |
| `points` | Solo para `user`: pares `valor:probabilidad` separados por `;`, por ejemplo `5:0,2; 10:0,8`. Los valores van en `unit`. |
| `fixedCost` | Costo fijo por ejecución. |
| `calendar` | Clave del calendario; tiene que existir en el escenario o en la hoja `Calendars`. |
| `probability` | Para un flujo que sale de una compuerta: entre 0 y 1, o un porcentaje. |
| `selection` | `and` u `or`, cuando la tarea usa varios grupos. |

Una distribución siempre necesita su tipo: parámetros sin `distribution` son un error, y también
un parámetro que la distribución no tiene.

### Arrivals

Una fila por evento de inicio: `id`, `name`, las mismas columnas de distribución
(`interTriggerTimer`, el tiempo entre llegadas), `triggerCount` (cuántos casos llegan, entero ≥ 1),
`fixedCost` y `calendar`.

### Resources

Una fila por grupo de recursos: `id`, `name`, `type` (`role` o `equipment`), `capacity`,
`costPerHour`, `fixedCost` y `calendar`.

- `capacity` es un número entero, o la capacidad por turno como pares `calendario:unidades`
  separados por `;` (`dia:3; noche:1`).
- Una fila con un `id` que el escenario no tiene crea ese grupo. Sin `id`, la fila se empareja por
  `name`, y un nombre que no coincide con ningún grupo se informa.
- `name` renombra un grupo solo cuando la fila también trae su `id`.

### Assignments

Qué grupos usa cada tarea: `elementId`, `elementName`, `resourceId`, `resourceName` y `quantity`
(vacía es 1). Una fila por tarea y grupo. Las filas de una tarea reemplazan su lista entera, así
que una tarea que no está en la hoja conserva sus grupos. Una fila con la tarea y sin grupo deja la
tarea sin grupos.

### Calendars

Una fila por intervalo semanal: `id`, `days`, `from` y `to`. Las filas de un calendario reemplazan
sus intervalos, y un `id` que el escenario no tiene crea el calendario.

- `days`: `MON,TUE,WED`, un rango como `MON-FRI`, o las abreviaturas en español `LUN`, `MAR`,
  `MIE`, `JUE`, `VIE`, `SAB`, `DOM`.
- `from` y `to`: `HH:MM`, con `24:00` permitido como fin del día. También vale una hora que Excel
  guarda como hora del día.
- Un calendario con fechas mensuales o anuales no se puede escribir en esta hoja. La plantilla lo
  omite y la importación lo deja sin cambios, con una nota. Los festivos tampoco están en esta
  hoja: la importación los conserva como están.

## CSV

Un archivo CSV contiene una tabla. La hoja se deduce del nombre del archivo (`recursos.csv`,
`Assignments.csv`…) o, si el nombre no lo dice, de sus columnas. El separador se detecta: `,`, `;`
(lo que escribe un Excel en español, con la coma decimal) o tabulador, y se entiende la primera
línea `sep=;` de Excel. El archivo puede estar en UTF-8 o en la codificación de Windows que usa
Excel para «CSV (delimitado por comas)».

## Límites

- La importación no cambia `run` (duración, réplicas, semilla), las condiciones de compuerta
  (`conditions`) ni los campos reservados. Esos se editan en el panel.
- Salvo los grupos de una tarea, no puede quitar un valor, solo ponerlo: una celda vacía nunca
  borra. Los valores se quitan en el panel.
- La importación está en la web; la CLI `lila` todavía no tiene un comando para importar. Sus
  funciones son públicas en `@lila-modeler/engine/scenario-sheets` (`scenarioTemplate`,
  `readScenarioFile`, `planScenarioImport`, `applyImportChanges`).
