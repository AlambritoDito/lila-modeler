# Vienes de Bizagi Modeler

> Leer en: [English](../COMING-FROM-BIZAGI.md)

Esta guía es para quien ya ha simulado en Bizagi Modeler y abre Lila Modeler por primera vez. Dice
dónde está aquí cada cosa que ya conoces, con el vocabulario de Bizagi, para que no tengas que
reaprender el flujo antes de sacar tu primer número. Lila es un **simulador** de eventos discretos
para BPMN: un motor, una CLI, un servidor MCP y un editor alrededor. No es una suite de
documentación ni de publicación de procesos — no hay publicación a Word o a web, ni plantillas de
documento, ni repositorio compartido de procesos. Bizagi Modeler se cita como la referencia y la
inspiración de la que este proyecto aprendió el flujo, y como origen de los ejemplos públicos
contra los que se valida el motor.

## Los cuatro niveles, como cuatro pasos

Bizagi enseña la simulación en cuatro niveles, cada uno con un tipo de parámetro más. Lila conserva
ese vocabulario y ese orden en la vista **Simulate**, como cuatro pasos:

| Nivel de Bizagi | Lila | Qué rellenas |
|---|---|---|
| Process validation | Simulate → paso 1 | Inicio, duración, réplicas y semilla de la corrida; max arrival count; porcentajes de las compuertas; validación del modelo |
| Time analysis | Simulate → paso 2 | Intervalo entre llegadas y tiempo de proceso por elemento, constante o distribución |
| Resource analysis | Simulate → paso 3 | Pools de recursos, disponibilidad, costos y qué tarea usa qué pool |
| Calendar analysis | Simulate → paso 4 | Calendarios como rejilla semanal, recurso × calendario, capacidad por turno |

Dos cosas funcionan distinto que en Bizagi, y las dos a tu favor:

- **No hay interruptor de nivel.** Nunca «activas» un nivel. El motor degrada solo: un elemento sin
  tiempo de proceso tarda cero, una tarea sin recurso tiene capacidad infinita y un pool sin
  calendario está disponible 24×7. Puedes llenar el paso 3 y dejar el paso 4 vacío para siempre.
- **Los pasos son un orden de lectura, no un asistente.** Todo vive en un mismo escenario: puedes
  volver al paso 1 después del paso 4 sin rehacer nada, y la lista de validación del pie del panel
  está viva en todos los pasos.

Los cuatro pasos son una barra en la cabecera del panel de Simulate, rotulados **1 · Validación
del proceso**, **2 · Análisis de tiempos**, **3 · Análisis de recursos** y **4 · Análisis de
calendarios**. Abre en el paso 1, el paso en el que estás sobrevive a seleccionar elementos en el
lienzo y a correr la simulación, y dos cosas están en todos los pasos: la lista de validación y
**Avanzado: JSON del escenario**, que es donde se editan el `name` del escenario, su `description`
y todo lo que el formulario no dibuja.

Los pasos 2 y 3 listan además los elementos de los que hablan —cada tarea, temporizador e inicio
con el tiempo que tiene; cada tarea con el pool que toma—, así que «qué falta» es un vistazo y no un
recorrido por el diagrama; pulsar una fila selecciona ese elemento en el lienzo. Los pools de
recursos salen en el paso 3 **y** en el paso 4, porque el calendario de un pool y su capacidad por
turno se editan dentro del pool y son nivel 4, no nivel 3.

## Pantalla por pantalla

La correspondencia campo a campo — Lila ↔ BPSim 2.0 ↔ qbp ↔ Bizagi Modeler — está en una sola tabla
en [`SCENARIO_FORMAT.md` § 8](SCENARIO_FORMAT.md#8-mapeo-campo--bpsim-20--qbp--bizagi); esta sección es su versión a nivel de pantalla.

### Propiedades del escenario

| Bizagi | Lila |
|---|---|
| Scenario name, Description | `name` / `description`, en **Avanzado: JSON del escenario** (el nombre es la cabecera del panel) |
| Start date | paso 1, `run.start` (ISO 8601 **con offset**) |
| Duration | paso 1, `run.duration`; se puede dejar vacío y la corrida termina cuando drena el último caso |
| Base time unit, Currency | paso 1, `run.baseTimeUnit`, `run.currency` |
| Replications (solo en what-if) | paso 1, `run.replications` — aquí está en cualquier corrida, no solo al comparar |
| — | `run.seed` y `run.warmup`, que Bizagi no expone |

### Llegadas

| Bizagi | Lila |
|---|---|
| Max arrival count | paso 1, `triggerCount` en el evento de inicio |
| Interval / tiempo entre llegadas | paso 2, `interTriggerTimer` en el evento de inicio |
| Calendario de llegadas | paso 4, `calendar` en el evento de inicio |

Un `triggerCount` sin intervalo significa que los N casos llegan en `t = 0`, que es lo que hace el
nivel 1 de Bizagi.

### Tiempos y distribuciones

En Lila todos los tiempos van en **segundos**; no hay selector de unidad por campo. La distribución
es un objeto con parámetros **con nombre**, así que nada depende del orden de los argumentos:

| Bizagi | Lila | Ojo con |
|---|---|---|
| Constant | `constant` (`value`) | |
| Uniform, Triangular | `uniform`, `triangular` | |
| Exponential | `exponential` (`mean`) | es la media, nunca la tasa λ |
| Normal, Truncated normal | `normal`, `truncatedNormal` | `normal` se trunca en 0 |
| Log normal *(el nombre en Bizagi puede variar según la versión)* | `lognormal` (`mean`, `sd`) | de la **variable**, no de su logaritmo — la misma convención que Bizagi |
| Gamma, Erlang, Weibull, Beta | `gamma`, `erlang`, `weibull`, `beta` | en `erlang` la `mean` es la total, no la de cada fase |
| Poisson, Binomial | `poisson`, `binomial` | |
| — | `user` | puntos empíricos, sin equivalente en Bizagi |

### Recursos

| Bizagi | Lila |
|---|---|
| Resource, Name | paso 3, una clave de `resources` con su `name` |
| Type (role / equipment) | `type` |
| Availability | `capacity` (un entero: cuántas unidades existen) |
| Fixed cost | `fixedCost`, se cobra una vez por token que toma el recurso |
| Cost per hour | `costPerHour`, se cobra sobre el tiempo ocupado |

### Asignación a las tareas

| Bizagi | Lila |
|---|---|
| Activity resources *(el nombre en Bizagi puede variar según la versión)* | paso 3, `resources[]` del elemento seleccionado |
| Quantity | `quantity` dentro de esa entrada |
| AND / OR | `selection: "and"` / `"or"` |
| Fixed cost (de la actividad) | `fixedCost` del elemento |
| — | **Asignar un carril a un pool** en una sola acción: todas las tareas del carril reciben el pool con cantidad 1 |

La acción de carril es la entrada más rápida: modela los carriles como roles y una acción por
carril sustituye una docena de asignaciones a mano. Para el motor los carriles siguen siendo
etiquetas; la acción solo escribe por ti la asignación tarea por tarea.

### Calendarios

| Bizagi | Lila |
|---|---|
| Calendars | paso 4, `calendars` por clave; la clave `default` la toma todo pool que no declare el suyo |
| Recurrence + start time + duration | una rejilla semanal: `intervals[]` de días × `from`–`to` (24 h, `to` exclusivo) |
| Calendario del recurso | `calendar` en el pool |
| Tabla «Resource \| Morning \| Day \| Night» | `capacity` como lista de `{ calendar, capacity }`: un solo pool con capacidad por turno |
| Holidays | reservado, no está en v1; tampoco las recurrencias mensual/anual, el horario de verano ni la zona horaria por calendario |

Sin ningún calendario, todo es 24×7. El tiempo de proceso de una tarea se pausa cuando cierra su
turno y sigue cuando abre; ese tiempo cerrado se reporta aparte como `offHoursWait`.

### Resultados

Las columnas de resultados conservan a propósito los nombres de tabla y de columna de Bizagi, para
que puedas comparar números sin traducir encabezados (el mapa completo está en
[`RESULTS_FORMAT.md` § 10](RESULTS_FORMAT.md)):

| Tabla de Bizagi | Lila |
|---|---|
| Process elements | mismo nombre; Instances started/completed, tiempo mínimo/máximo/medio/total, las mismas cinco columnas «waiting for resource» y el costo fijo total |
| Resources | mismo nombre; Utilization (%), Fixed cost, Unit cost, Total cost — una fila por pool, incluidos los que quedan al 0 % |
| Sequence flows | mismo nombre; instancias completadas por flujo |
| Process (resumen) | tabla propia de Lila (Bizagi no publica una) |

Extras sin columna en Bizagi: p50/p90/p95 del tiempo de ciclo y de la espera, largo medio y máximo
de cola por actividad, throughput por hora, costo por caso, ranking de cuellos de botella, registro
de eventos por caso y la espera fuera de horario separada de la espera por recurso.

| Bizagi | Lila |
|---|---|
| What-if analysis *(el nombre en Bizagi puede variar según la versión)* | modo **Compare**, o `lila compare`: escenarios lado a lado, diferencias marcadas e intervalos de confianza al 95 % cuando hay ≥ 2 réplicas |
| Exportar resultados a Excel *(el nombre en Bizagi puede variar según la versión)* | un CSV por tabla y un `.xlsx` único (`--csv`, `--xlsx`, o los botones de exportar en Results) |
| Ver moverse los tokens | **Animate**: Play desde Results reproduce la réplica 1 de la corrida guardada sobre el diagrama, con contadores por elemento que salen del registro de eventos del propio motor, no de un caminante de juguete. El modo **Validate paths**, aparte, es la animación didáctica de bpmn-js y no lee ningún escenario |

## Tres diferencias que vas a notar

**1. Tu `.bpmn` de Bizagi trae el dibujo, no los números.** Bizagi Modeler no exporta los parámetros
de simulación: verificado sobre cinco archivos reales, en el namespace `bizagi:` solo viajan los
colores. Así que importar funciona, y luego los pasos 1 a 4 se vuelven a capturar aquí una vez.
Cuenta unos minutos para eso y usa la acción de carril → pool para que el paso 3 casi no cueste.

**2. Los caminos compartidos se duplican, porque la ramificación es probabilística.** En v1 no hay
enrutamiento por datos del caso: `conditionExpression` se ignora (con aviso `W-COND`) y `conditions`
es un campo reservado. Cada flujo de salida de una compuerta lleva un porcentaje. La consecuencia
práctica está en la forma del diagrama: un «rechazar e informar al solicitante» al que pueden
llegar dos compuertas distintas aparece **una vez por compuerta**, con su propio par de tareas, en
lugar de ser un único nodo compartido al que enrutan los datos. Mira `examples/tarjeta-credito`,
modelado exactamente así.

**3. Los recursos no tienen identidad persistente.** Un pool es un conteo de unidades
intercambiables, no una lista de personas con nombre: «Nurse, capacidad 3» son tres enfermeras
anónimas, y un caso que vuelve más tarde no recibe la misma. La utilización, el tiempo ocupado y el
costo se reportan **por pool**. Si necesitas individuos con nombre, modélalos como un pool de
capacidad 1 cada uno.

Cuatro cosas menores que conviene saber antes de comparar números contra una corrida de Bizagi:

- **Las semillas son deterministas.** Mismo escenario y misma semilla, mismo resultado byte a byte:
  una diferencia entre dos corridas es una diferencia que hiciste tú.
- **La utilización se mide sobre la ventana que Lila simuló de verdad** (`[warmup, t_stop]`), no
  sobre una duración declarada. A nivel de calendarios eso difiere del denominador de Bizagi por un
  factor constante; la conversión exacta es la diferencia D7 del checklist.
- **Un sistema saturado (ρ ≈ 1) no tiene estado estacionario**, así que su tiempo de ciclo *medio*
  depende del transitorio y dos simuladores correctos pueden discrepar bastante; el mínimo, el
  máximo y la utilización siguen cuadrando. Es la diferencia D6.
- **Una sola corrida tiene ruido.** Bizagi publica corridas únicas; las diferencias D2 y D5 son
  justo eso. Usa 30 réplicas y lee el intervalo de confianza.

Las cuatro están documentadas, con cifras, en
[el checklist de comportamiento de referencia](BIZAGI_PARITY.md#diferencias-documentadas-lila-044-corregidas-en-lila-187).

## Pruébalo: el ejemplo de nivel 3 publicado por Bizagi

`examples/bizagi-levels/level-3` es el «Emergency attendance process» del propio tutorial de nivel 3
de Bizagi, reconstruido archivo por archivo, con las cifras publicadas anotadas en `expected.json`.

En la app web ([build de Pages](https://alambritodito.github.io/lila-modeler/app/)) o en la app de
escritorio el ejemplo se abre como diagrama más un escenario pegado, porque un proyecto `.lila`
necesita además un manifiesto que el repositorio no trae para este ejemplo:

1. Archivo → **Abrir .bpmn**, elige `examples/bizagi-levels/level-3/model.bpmn`.
2. Ve a **Simular**, abre **Avanzado: JSON del escenario** al final del paso 1, sustituye su texto
   por el contenido de `examples/bizagi-levels/level-3/scenario.json` y pulsa **Aplicar**.
3. Pon Réplicas en 30 en el paso 1 y pulsa **Ejecutar simulación**.

La misma corrida desde la CLI, desde la raíz del repositorio:

```bash
npx lila run \
  examples/bizagi-levels/level-3/model.bpmn examples/bizagi-levels/level-3/scenario.json \
  --replications 30 --seed 42
```

En la tabla **Resources**, la fila `Nurse` marca una utilización de alrededor del **69,7 %**, contra
el **69,75 %** que publica Bizagi para esa misma configuración — y los otros cinco pools, los seis
costos y el tiempo de ciclo medio quedan igual de cerca. Qué esperar de cada número, nivel por
nivel, y los cuatro puntos donde los dos motores no coinciden, está en
[`BIZAGI_PARITY.md`](BIZAGI_PARITY.md).

Para un caso completo hecho desde cero en vez de reconstruido — un pool, tres carriles, trece
tareas, dos ramas de rechazo y un AS-IS contra un TO-BE — mira
[`examples/tarjeta-credito`](../../examples/tarjeta-credito/README.md).

---

Bizagi y Bizagi Modeler son marcas de Bizagi. Lila Modeler es un proyecto open source independiente,
no afiliado a Bizagi ni respaldado por Bizagi.
