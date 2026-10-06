# Vienes de Bizagi Modeler

> Leer en: [English](../COMING-FROM-BIZAGI.md)

Esta guía es para quien ya ha simulado en Bizagi Modeler y abre Lila Modeler por primera vez. Dice
dónde está aquí cada cosa que ya conoces, con el vocabulario de Bizagi, para que no tengas que
reaprender el flujo antes de sacar tu primer número. Lila es un **simulador** de eventos discretos
para BPMN: un motor, una CLI, un servidor MCP y un editor alrededor. No es una suite de
documentación ni de publicación de procesos: Archivo → Exportar documento del proceso escribe un
Word (.docx) o un HTML de una página con el diagrama, la documentación de cada elemento y las
tablas del escenario y de resultados, pero no hay plantillas de documento. Un proyecto puede
contener varios procesos, pero no hay un repositorio compartido entre usuarios. Bizagi Modeler se
cita como la referencia y la
inspiración de la que este proyecto aprendió el flujo, y como origen de los ejemplos públicos
contra los que se valida el motor.

## Los cuatro niveles, como seis pasos

Bizagi enseña la simulación en cuatro niveles, cada uno con un tipo de parámetro más. La vista
**Simulate** de Lila tiene seis pasos, nombrados por lo que edita cada uno: **Llegadas**,
**Tiempos**, **Rutas**, **Recursos**, **Calendarios** y **Ejecución**. Cada nivel de Bizagi cae así:

| Nivel de Bizagi | Paso de Lila | Qué rellenas |
|---|---|---|
| Process validation | Ejecución (ventana de corrida), Rutas (porcentajes de las compuertas) y Llegadas (max arrival count) | Inicio, duración, réplicas y semilla de la corrida; porcentajes de las compuertas; max arrival count; validación del modelo |
| Time analysis | Tiempos (tiempo de proceso) y Llegadas (intervalo entre llegadas) | Tiempo de proceso por tarea y temporizador; intervalo entre llegadas por evento de inicio; constante o distribución |
| Resource analysis | Recursos | Pools de recursos, disponibilidad, costos y qué tarea usa qué pool |
| Calendar analysis | Calendarios (los calendarios y qué elemento sigue cuál) y Recursos (el calendario de un pool y su capacidad por turno, en el pool) | Calendarios con días predefinidos + franjas desde–hasta y una rejilla semanal, recurso × calendario, capacidad por turno |

Dos cosas funcionan distinto que en Bizagi, y las dos a tu favor:

- **No hay interruptor de nivel.** Nunca «activas» un nivel. El motor degrada solo: un elemento sin
  tiempo de proceso tarda cero, una tarea sin recurso tiene capacidad infinita y un pool sin
  calendario está disponible 24×7. Puedes llenar Recursos y dejar Calendarios vacío para siempre.
- **Los pasos son un orden de lectura, no un asistente.** Todo vive en un mismo escenario: puedes
  volver a Tiempos después de Calendarios sin rehacer nada, y la lista de validación del pie del
  panel está viva en todos los pasos.

Los seis pasos son una barra en la cabecera del panel de Simulate. Abre en **Tiempos**, el paso
en el que estás sobrevive a seleccionar elementos en el lienzo y a correr la simulación, y dos cosas
están en todos los pasos: la lista de validación y **Avanzado: JSON del escenario**, que es donde se
editan el `name` del escenario, su `description` y todo lo que el formulario no dibuja.

Llegadas, Tiempos, Rutas y Recursos listan además los elementos de los que hablan —cada evento de
inicio con cada cuánto y cuántos casos crea, cada tarea y temporizador con su tiempo, cada compuerta
con su reparto, cada tarea con el pool que toma—, así que «qué falta» es un vistazo y no un recorrido por el diagrama; pulsar una
fila selecciona ese elemento en el lienzo. Cada control vive en un solo paso: los pools de recursos
(con su calendario y su capacidad por turno) se editan en Recursos, y Calendarios lo dice.

Con una actividad seleccionada en **Modelar**, el panel de propiedades enseña un bloque **Vista
rápida · simulación**: su distribución de tiempo y su recurso en el escenario activo, y su espera en
la última corrida (o *sin corrida*). Es la espera por recurso, la misma medida que las etiquetas del
lienzo, la tabla de Resultados y sus columnas «esperando recurso». Es el **p95** de los casos medidos después del
calentamiento en la primera réplica, cuando la muestra del log de esa corrida está completa; una
corrida más larga (más de 10 000 filas de log en su primera réplica) enseña en su lugar la espera
por recurso **media** de todas las réplicas, y lo dice. Sus enlaces **Editar en Tiempos** / **Editar en
Recursos** abren ese paso en Simular.

## Pantalla por pantalla

La correspondencia campo a campo — Lila ↔ BPSim 2.0 ↔ qbp ↔ Bizagi Modeler — está en una sola tabla
en [`SCENARIO_FORMAT.md` § 8](SCENARIO_FORMAT.md#8-mapeo-campo--bpsim-20--qbp--bizagi); esta sección es su versión a nivel de pantalla.

### Propiedades del escenario

| Bizagi | Lila |
|---|---|
| Scenario name, Description | `name` / `description`, en **Avanzado: JSON del escenario** (el nombre es la cabecera del panel) |
| Start date | Ejecución, `run.start` (ISO 8601 **con offset**) |
| Duration | Ejecución, `run.duration`; se puede dejar vacío y la corrida termina cuando drena el último caso |
| Base time unit, Currency | Ejecución, `run.baseTimeUnit`, `run.currency` |
| Replications (solo en what-if) | Ejecución, `run.replications` — aquí está en cualquier corrida, no solo al comparar |
| — | `run.seed` y `run.warmup`, que Bizagi no expone |

### Llegadas

| Bizagi | Lila |
|---|---|
| Max arrival count | Llegadas, `triggerCount` en el evento de inicio |
| Interval / tiempo entre llegadas | Llegadas, `interTriggerTimer` en el evento de inicio |
| Calendario de llegadas | Calendarios, `calendar` en el evento de inicio |

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
| Resource, Name | Recursos, una clave de `resources` con su `name` |
| Type (role / equipment) | `type` |
| Availability | `capacity` (un entero: cuántas unidades existen) |
| Fixed cost | `fixedCost`, se cobra una vez por token que toma el recurso |
| Cost per hour | `costPerHour`, se cobra sobre el tiempo ocupado |

### Asignación a las tareas

| Bizagi | Lila |
|---|---|
| Activity resources *(el nombre en Bizagi puede variar según la versión)* | Recursos, `resources[]` del elemento seleccionado |
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
| Calendars | Calendarios, `calendars` por clave; la clave `default` la toma todo pool que no declare el suyo |
| Recurrence + start time + duration | «Lun–Vie / Todos / Fin de semana» o cualquier día + desde–hasta, una entrada de `intervals[]` por franja, y una rejilla semanal para pintar (24 h, `to` exclusivo, se admite `"24:00"`) |
| Calendario del recurso | `calendar` en el pool |
| Tabla «Resource \| Morning \| Day \| Night» | `capacity` como lista de `{ calendar, capacity }`: un solo pool con capacidad por turno |
| Recurrence: monthly, yearly | «Se repite»: el día N (o el último) del mes, del primer al quinto o el último día de la semana del mes, o una fecha cada año (`monthDays`, `monthWeekdays`, `dates`) |
| Holidays | «Festivos» bajo las franjas: una fecha una vez, o «Cada año» (`holidays`); cerrado el día entero |
| Recurrencia cada N semanas/meses, horario de verano, zona horaria por calendario | no está en v1: los calendarios conservan el offset de `run.start` durante toda la corrida |

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

Junto a las tablas, Results dibuja unas pocas gráficas: utilización por recurso, instancias
iniciadas por tarea, p50/p90/p95 del tiempo de ciclo y de espera, y un histograma del tiempo de
ciclo por caso de la primera réplica. Cada gráfica sale de los mismos números que su tabla y los
imprime en sus barras; la tabla sigue siendo la referencia.

| Bizagi | Lila |
|---|---|
| What-if analysis *(el nombre en Bizagi puede variar según la versión)* | modo **Compare**, o `lila compare`: escenarios lado a lado, diferencias marcadas e intervalos de confianza al 95 % cuando hay ≥ 2 réplicas, y gráficas de barras del tiempo de ciclo medio, el costo por caso y la utilización con el delta de cada escenario contra la base |
| Exportar resultados a Excel *(el nombre en Bizagi puede variar según la versión)* | un CSV por tabla y un `.xlsx` único (`--csv`, `--xlsx`, o los botones de exportar en Results) |
| Publicar en Word / Web | Archivo → Exportar documento del proceso (Word o HTML): portada, diagrama, descripción del proceso, una sección por elemento en orden de flujo agrupada por carril, y después las tablas del escenario y de resultados, con las gráficas de la corrida. Sin plantillas ni campo de tabla de contenido; el panel de navegación de Word lista los títulos |
| Ver moverse los tokens | **Tokens** sobre el mapa de Resultados (`Espacio` o ▶) reproducen la réplica 1 de la corrida guardada sobre el diagrama, con contadores por elemento que salen del registro de eventos del propio motor, no de un caminante de juguete. **Validar rutas**, una herramienta de Modelar, es la animación didáctica de bpmn-js y no lee ningún escenario |

## Tres diferencias que vas a notar

**1. Tu `.bpmn` de Bizagi trae el dibujo, no los números.** Bizagi Modeler no exporta los parámetros
de simulación: verificado sobre cinco archivos reales, en el namespace `bizagi:` solo viajan los
colores. Así que importar funciona, y luego los pasos de Simular se vuelven a capturar aquí una vez.
Cuenta unos minutos para eso y usa la acción de carril → pool para que Recursos casi no cueste.

**2. Los caminos compartidos se duplican, porque la ramificación es probabilística.** En v1 no hay
enrutamiento por datos del caso: `conditionExpression` se ignora (con aviso `W-COND`) y `conditions`
es un campo reservado. Cada flujo de salida de una compuerta lleva un porcentaje. La consecuencia
práctica está en la forma del diagrama: un «rechazar e informar al solicitante» al que pueden
llegar dos compuertas distintas aparece **una vez por compuerta**, con su propio par de tareas, en
lugar de ser un único nodo compartido al que enrutan los datos. Mira `packages/engine/test/fixtures/service-request`,
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

1. Archivo → **Importar BPMN…**, elige `examples/bizagi-levels/level-3/model.bpmn`.
2. Ve a **Simular**, abre **Avanzado: JSON del escenario** al final del panel, sustituye su texto
   por el contenido de `examples/bizagi-levels/level-3/scenario.json` y pulsa **Aplicar**.
3. Pon Réplicas en 30 en Ejecución y pulsa **Ejecutar simulación**.

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


---

Bizagi y Bizagi Modeler son marcas de Bizagi. Lila Modeler es un proyecto open source independiente,
no afiliado a Bizagi ni respaldado por Bizagi.
