# Formato de resultados (`RunResult`) y event log

Fuente de verdad: `LILA_MODELER_ESTRUCTURA.md`, sección 6 ("Diseño del motor" → "Métricas (`RunResult`)" y "Event log") y sección 3 (checklist de paridad con Bizagi). Este documento detalla lo que ahí se resume: la estructura completa de `RunResult`, la fórmula o definición operativa de cada métrica, las columnas del event log con tipo y unidad, y el mapeo de nombres de columna internos a los nombres que usa Bizagi (que la CLI reutiliza al imprimir tablas).

Unidades, salvo que se indique otra cosa:

- Todo tiempo se mide y almacena en **segundos** (float64). `run.baseTimeUnit` solo afecta a cómo se presentan en CLI/UI; nunca al valor almacenado.
- Todo dinero se mide en `run.currency` (la moneda del escenario, ver `SCENARIO_FORMAT.md`).
- Los timestamps del event log son segundos de reloj virtual desde `run.start`, salvo la variante ISO 8601 que se deriva de `run.start` solo al exportar.

`RunResult` es la salida de `simulate(ir, scenario, opts)` (`packages/engine/src/core/run.ts`, ver sección 6 del documento de estructura). Se agrega tras correr una o más replicaciones (`scenario.run.replications`) y, cuando hay más de una, cada métrica numérica lleva además su resumen entre replicaciones (`replications`/`ci95`, ver más abajo).

---

## 1. Estructura general

```ts
interface RunResult {
  elements: Record<string, ElementMetrics>;   // keyed por id BPMN del elemento
  flows: Record<string, FlowMetrics>;         // keyed por id BPMN del sequence flow
  resources: Record<string, ResourceMetrics>; // keyed por id del pool de recursos
  process: ProcessMetrics;                    // agregado único, todo el proceso
  bottlenecks: BottleneckEntry[];             // ranking, ver sección 6
  replications?: ReplicationSummary;          // solo si scenario.run.replications > 1
  cancelled?: true;                           // ausencia = corrida completa
  completedReplications?: number;             // solo si cancelled = true
  warnings: string[];                         // ver sección 8
  log?: EventLogRow[];                        // solo en modo retenido, ver sección 7
}
```

Todo elemento, flujo o recurso que exista en el IR aparece en el mapa correspondiente aunque su conteo sea cero (por ejemplo, una rama de XOR que nunca se tomó en una corrida corta). El `id` usado como clave es siempre el `id` BPMN — nunca el nombre visible (regla del repositorio, ver cabecera de `BACKLOG.md`).

Con más de una replicación, todos los campos numéricos top-level son la **media aritmética del
mismo campo calculado en cada replicación**. No representan la primera replicación ni un pool de
todos los casos. `replications.kpis[path].mean` coincide con el campo top-level correspondiente en
una corrida completa. Esta decisión se detalla en ADR-024. *(prueba: LILA-029)*

---

## 2. Métricas por elemento (`elements[id]`)

```ts
interface ElementMetrics {
  started: number;
  completed: number;
  processing: Stat;        // min, max, mean, total
  resourceWait: StatSd;    // min, max, mean, sd, total
  offHoursWait: StatSd;    // min, max, mean, sd, total
  queueLength: { mean: number; max: number };
  fixedCostTotal: number;
}

interface Stat    { min: number; max: number; mean: number; total: number }
interface StatSd  { min: number; max: number; mean: number; sd: number; total: number }
```

Definiciones operativas (todas se calculan sobre las instancias del elemento que **completaron** processing en la replicación, salvo que se indique otra cosa; los casos aún en curso al cortar la corrida no contribuyen a `processing`/`resourceWait`/`offHoursWait` pero sí incrementan `started`):

- **`started`** — número de tokens/instancias que llegaron a habilitar el elemento (evento `enabledAt` del event log, sección 7) en la replicación. Para un `task`, equivale a "Instances/Tokens started" de Bizagi.
- **`completed`** — número de tokens/instancias que terminaron de procesarse en el elemento (evento `endedAt`). Un caso en vuelo al momento de parar la corrida cuenta en `started` pero no en `completed` (mismo criterio que Bizagi, ver sección 6 del documento de estructura: "Casos en vuelo al parar cuentan como started, no completed").
- **`processing.{min,max,mean,total}`** — estadísticas del tiempo abierto efectivamente trabajado por el elemento, sin espera de recurso ni de calendario. Por R-CAL-8 se obtiene de cada fila como `endedAt − enabledAt − resourceWait − offHoursWait`; en ausencia de calendarios se reduce a `endedAt − startedAt`. `mean = total / completed`. Fórmula: para el conjunto `P` de duraciones de processing completadas, `min = min(P)`, `max = max(P)`, `total = Σ P`, `mean = total / |P|`. *(prueba: LILA-028)*
- **`resourceWait.{min,max,mean,sd,total}`** — estadísticas de `startedAt − enabledAt − offHoursWait[enabledAt, startedAt]`: tiempo abierto en que la instancia esperó exclusivamente a que un recurso quedara disponible (R-REC-8). `sd` es la desviación estándar muestral (`n−1` en el denominador) del mismo conjunto. Si el elemento no requiere recursos (`resources` vacío en el escenario), toda instancia tiene `resourceWait = 0` — degradación de capacidad infinita (ADR-016 y sección 6). *(prueba: LILA-028)*
- **`offHoursWait.{min,max,mean,sd,total}`** — estadísticas del tiempo cerrado dentro de todo el intervalo `[enabledAt, endedAt]`, incluido tanto el cierre antes de arrancar como las pausas durante el procesamiento (R-CAL-7). Se acumula por separado de `resourceWait`; si el elemento usa calendario 24×7 (default sin calendario asignado), siempre vale 0. *(prueba de agregación: LILA-028; semántica de calendario: LILA-041)*
- **`queueLength.{mean,max}`** — longitud de la cola de instancias esperando el elemento. Cada instancia de actividad (no cada fila: una AND con dos pools aporta **una** sola vez) contribuye el intervalo **semiabierto** `[enabledAt, startedAt)`, o `[enabledAt, observedUntil)` si seguía en cola al cortar. `mean` es la integral de la longitud instantánea sobre la ventana estadística dividida entre su duración (`statisticsDuration`, es decir la corrida menos el `warmup`, ver sección 8); `max` es el máximo instantáneo. Consecuencias de que el intervalo sea semiabierto: una espera de duración cero nunca forma cola (sin recursos, `queueLength = {mean: 0, max: 0}` para todo elemento, R-DEG-1), y la instancia que sale de la cola en el mismo instante en que otra entra no se cuentan juntas. *(prueba: LILA-036)*
- **`fixedCostTotal`** — `elements[id].fixedCost × completed` (costo fijo por token completado, definido en el escenario; ver `SCENARIO_FORMAT.md`). Se obtiene como `Σ row.elementCost`, nunca `Σ row.cost` (R-COST-4).

Bizagi no distingue `resourceWait` de `offHoursWait` (ver sección 3: "Espera fuera de horario separada de espera por recurso — Bizagi ✗ / Lila ✓"); es una métrica extra de Lila.

### Lifecycle parcial: qué entra en los agregados *(decisión de LILA-036)*

Las filas `terminated` e `inFlight` conservan en el log crudo la espera **observada** hasta
`observedUntil` (sección 7). En los agregados el criterio es uniforme y no depende del elemento:

- Las estadísticas **por instancia** — `processing`, `resourceWait`, `offHoursWait` de esta
  sección y `process.waitTime` de la sección 5 — agregan **solo** instancias con
  `status = "completed"`. Una espera cortada por `terminate` o por el fin de la corrida es una
  observación **censurada**: incluirla sesgaría la media a la baja y mezclaría dos poblaciones.
  Se sigue así la regla que LILA-033 ya aplicaba (filas raw completas, agregado solo de
  completadas).
- Las **integrales de estado y los costos** — `queueLength` de esta sección, `busyTime`,
  `utilization` y los costos de la sección 4, y `process.totalCost` de la sección 5 — **sí**
  incluyen el lifecycle parcial: miden ocupación realmente observada dentro de la ventana, y
  R-COST-4 exige que el costo ya incurrido por un caso en vuelo no desaparezca del total.

Consecuencia deliberada y probada: un elemento cuya espera es **enteramente** censurada tiene
`resourceWait.total = 0` y por tanto **no aparece** en `bottlenecks` (sección 6), aunque su
`queueLength` y la utilización de su pool sí lo delaten. *(prueba: LILA-036)*

---

## 3. Métricas por flujo (`flows[id]`)

```ts
interface FlowMetrics {
  count: number;
}
```

- **`count`** — número de tokens que atravesaron el sequence flow en la replicación. Es el "nivel 1" de Bizagi (Process Validation): sirve para verificar qué caminos se activaron y en qué proporción, comparable contra la probabilidad configurada en el escenario (`elements[flowId].probability`).

---

## 4. Métricas por recurso (`resources[id]`)

```ts
interface ResourceMetrics {
  utilization: number;   // fracción 0..1
  busyTime: number;      // segundos
  fixedCost: number;
  unitCost: number;
  totalCost: number;
}
```

- **`busyTime`** — segundos-unidad que el pool estuvo ocupado atendiendo instancias, sumados sobre las unidades ocupadas: si `capacity = 3` y las tres unidades trabajan simultáneamente 10 s, `busyTime` acumula 30 s. Se agrega **por fila** del event log (ADR-025): cada fila **de la cohorte medida** con `resourceId` y `startedAt` no nulos aporta `resourceQuantity × (min(endedAt ?? observedUntil, t_stop) − max(startedAt, warmup))`. Una fila sentinel, o una que nunca llegó a arrancar, aporta 0. Las filas de casos iniciados antes del `warmup` no aportan aunque su ocupación caiga dentro de la ventana: por R-ARR-7 esos casos existen y retrasan a los demás, pero no entran en ninguna integral (ver sección 8).
- **`utilization`** — `busyTime / (capacity × horas disponibles según calendario del recurso durante la corrida)`. Fórmula (ADR-016, única definición que hace comparables un recurso 24×7 y uno con calendario restringido): `utilization = busyTime / (capacity × availableTime)`, donde `availableTime` es el total de segundos que el calendario del recurso estuvo abierto entre `run.start` y el fin de la corrida (o `run.start + run.duration`, lo que aplique). Si el recurso no tiene calendario asignado, `availableTime` es la duración completa de la corrida (24×7). En nivel 3 (sin calendarios, M2) `availableTime = statisticsDuration`, es decir la ventana `[warmup, t_stop]`; los calendarios de M3 solo cambian ese denominador (R-CAL-9). Expresada como fracción `0..1`; la CLI la imprime como porcentaje (columna Bizagi `Utilization %`). Con `capacity × availableTime = 0` vale 0, no `NaN`.
- **`fixedCost`** — `resources[id].fixedCost × usos`, donde *usos* es `Σ resourceQuantity` sobre las filas que llegaron a ocupar el pool (una tarea que ocupa 2 unidades son 2 usos, R-COST-2).
- **`unitCost`** — `costPerHour del recurso × (busyTime / 3600)` (costo por las horas efectivamente ocupadas).
- **`totalCost`** — `fixedCost + unitCost`. Identidad verificable contra el log:
  `Σ resources[*].totalCost = Σ row.resourceCost` sobre todas las filas de la ventana, es decir
  `Σ fijo × usos + Σ porHora × horas ocupadas` (R-COST-4). *(prueba: LILA-036)*

Todo pool declarado en `scenario.resources` aparece en el mapa **aunque ningún elemento lo use**,
con `utilization = 0` y `busyTime`, `fixedCost`, `unitCost` y `totalCost` en cero — es lo mismo que
hace la tabla *Resources* de Bizagi, que lista todo recurso declarado aunque su utilización sea
0 % (sección 3), y es lo que permite que todas las replicaciones compartan el mismo conjunto de
claves de KPI (sección 8): si un pool ocioso desapareciera del mapa en unas replicaciones y no en
otras, `summarizeKpis` lo rechazaría con `E-KPI-INCONSISTENTE`.

Declarar un pool ocioso **no** es el caso de degradación: R-DEG-1 habla de un escenario **sin**
sección `resources`, y solo entonces el mapa queda `{}` y `bottlenecks` queda `[]`, exactamente
como en M1 — la degradación no cambia la forma del JSON (prueba LILA-039). Un escenario que
declara pools sin usarlos sí cambia `resources`, y nada más del resultado.
*(prueba: LILA-036, LILA-034)*

---

## 5. Métricas por proceso (`process`)

```ts
interface ProcessMetrics {
  started: number;
  completed: number;
  inFlight: number;
  cycleTime: Percentiles;   // min, max, mean, sd, p50, p90, p95
  waitTime: Percentiles;    // min, max, mean, sd, p50, p90, p95
  throughputPerHour: number;
  costPerCase: number;
  totalCost: number;
}

interface Percentiles {
  min: number; max: number; mean: number; sd: number;
  p50: number; p90: number; p95: number;
}
```

- **`started`** — número de casos que entraron por cualquier start event del proceso.
- **`completed`** — número de casos que llegaron a un end event (o fueron consumidos por un `terminate`).
- **`inFlight`** — `started − completed` al momento de cortar la corrida (casos que ni completaron ni fueron descartados).
- **`cycleTime.*`** — estadísticas del tiempo total de vida de un caso (`caseEndedAt − caseEnabledAt`, sumando todos los elementos por los que pasó); `p50`/`p90`/`p95` son los percentiles 50, 90 y 95 empíricos (interpolación lineal sobre la muestra ordenada) del mismo conjunto de duraciones. Solo se calculan sobre casos **completados**.
- **`waitTime.*`** — mismas estadísticas y percentiles, sobre la suma de `resourceWait + offHoursWait` de las actividades que completaron processing en el caso, y solo sobre casos **completados**. Una fila `terminated`/`inFlight` no entra en esta métrica aunque su lifecycle raw conserve la espera observada: es la regla de lifecycle parcial fijada por LILA-036 (sección 2). *(prueba: LILA-036)*
- **`throughputPerHour`** — `completed / (duración efectiva de la corrida en horas)`, donde la duración efectiva excluye el `warmup` (ver sección 8).
- **`costPerCase`** — media de `Σ row.cost` sobre los casos completados. Los costos de casos en vuelo sí forman parte de `totalCost`, pero no de esta media (R-COST-4). *(prueba: LILA-028)*
- **`totalCost`** — suma de `fixedCostTotal` de todos los elementos más `totalCost` de todos los recursos (costo total del escenario en la replicación).

`cycleTime.mean` "ponderado por las probabilidades de gateways" es justamente lo que produce agregar sobre el conjunto real de casos simulados (no hace falta ponderar aparte): cada camino aparece en la muestra en proporción a cuántas veces se tomó.

---

## 6. `bottlenecks`

```ts
interface BottleneckEntry {
  elementId: string;
  resourceWaitTotal: number;  // segundos, = elements[elementId].resourceWait.total
  utilization: number;        // del recurso principal asignado al elemento, 0..1
}
```

Ranking de elementos ordenado descendentemente por `elements[elementId].resourceWait.total` (el elemento donde más tiempo total se perdió esperando recurso). Desempate: mayor `utilization` primero (del recurso — o, si el elemento usa varios pools, el mayor `utilization` entre ellos); si también empata, `elementId` ascendente, para que el orden sea total y determinista. Elementos con `resourceWait.total = 0` no aparecen en el ranking. Es una métrica que Bizagi no ofrece (sección 3: "Ranking de cuellos de botella — Bizagi ✗ / Lila ✓").

Los pools de un elemento se leen del **event log** (`resourceId` de sus filas), no del escenario:
cada fila ya trae el pool efectivamente asignado, así que el ranking vale igual para un solo pool,
para `selection: "and"` y para la selección `"or"` de LILA-035 sin ningún caso especial.
*(prueba: LILA-036)*

---

## 7. Event log

Filas planas, una por **asignación de pool** por instancia de actividad. Las filas de una misma
ocurrencia se agrupan por `activityInstanceId`; una actividad sin recurso conserva una fila
sentinel. Se emiten por streaming
(`opts.onEvent`) para que la CLI escriba a CSV y la web pueda agregar/muestrear sin cargar todo en
memoria (ver sección 6 del documento de estructura: hasta 6 M filas en corridas grandes).
`opts.log` vale `true` por defecto; `log: false` suprime el callback incluso si se proporcionó
`onEvent`, pero no cambia ninguna métrica. *(prueba: LILA-029)*

### Quién se queda con las filas: los tres modos de `result.log`

`simulate` nunca entrega las mismas filas dos veces. Qué contiene `result.log` depende solo de las
opciones, y en ningún caso cambia una métrica ni el orden de las filas *(prueba: LILA-037)*:

| Opciones | `onEvent` | `result.log` |
|---|---|---|
| ninguna (`log` ausente) — **modo retenido** | no se llama | el log completo de la corrida, en orden de simulación y de replicación, incluidas las filas anteriores al `warmup` y las de la réplica parcial de una corrida cancelada |
| `onEvent` presente — **modo streaming** | una llamada por fila | **ausente**: el consumidor ya las recibió y retenerlas duplicaría hasta 6 M de objetos |
| `log: false` — **desactivado** | no se llama, aunque se haya pasado | **ausente** |

`lila run` usa siempre uno de los dos modos sin retención: con `--csv` pasa `onEvent` y escribe
cada fila a `log.csv` según llega; sin `--csv` pasa `log: false`, de modo que el `RunResult` de
`--json` nunca engorda con el event log. Solo el modo retenido acota su memoria por el tamaño del
log; los otros dos la acotan por el pico de **una** replicación.

| Columna | Tipo | Unidad | Definición |
|---|---|---|---|
| `replication` | integer | — | Índice de la replicación, `0..scenario.run.replications-1`. |
| `caseId` | string | — | Identificador del caso (instancia de proceso), único dentro de la replicación. |
| `activityInstanceId` | string | — | Identificador opaco y único de la ocurrencia de tarea/timer dentro de la replicación, derivado de un contador; agrupa sus asignaciones. |
| `elementId` | string | — | `id` BPMN del elemento (nunca el nombre). |
| `resourceId` | string \| null | — | `id` del pool efectivamente asignado; `null` en la sentinel de una actividad sin recurso o que seguía esperando. |
| `allocationIndex` | integer \| null | — | Posición de la asignación en el array `resources` del elemento; `null` para sentinel. |
| `resourceQuantity` | integer \| null | unidades | Cantidad ocupada del pool; `null` para el sentinel. |
| `status` | `"completed"` \| `"terminated"` \| `"inFlight"` | — | Razón de cierre observable: final normal, `terminate` BPMN, o parada/cancelación. `startedAt = null` distingue la espera no asignada. |
| `enabledAt` | number | segundos desde `run.start` | Instante en que el token llegó al elemento y quedó habilitado para empezar. |
| `startedAt` | number \| null | segundos desde `run.start` | Instante en que empezó a procesarse; `null` si la actividad se cerró todavía en cola. |
| `endedAt` | number \| null | segundos desde `run.start` | Instante en que terminó normalmente; solo existe con `status = "completed"`. |
| `observedUntil` | number | segundos desde `run.start` | `endedAt` al completar; instante de `terminate`, cancelación o parada para lifecycle parcial. |
| `resourceWait` | number | segundos | Porción de la espera atribuible a falta de recurso; si `startedAt = null`, se observa hasta `observedUntil`. No incluye tiempo de calendario cerrado. |
| `offHoursWait` | number | segundos | Tiempo cerrado en `[enabledAt, endedAt ?? observedUntil]`. Para completadas cumple `endedAt − enabledAt = resourceWait + offHoursWait + processing` (R-CAL-7/8). *(prueba de la identidad: LILA-028)* |
| `elementCost` | number | `run.currency` | Fijo del elemento, cargado una sola vez al completar: primera asignación según el escenario o sentinel; 0 en filas adicionales/parciales. |
| `resourceCost` | number | `run.currency` | Fijo y costo por tiempo ocupado de esta asignación; 0 si nunca arrancó. |
| `cost` | number | `run.currency` | Identidad exacta `elementCost + resourceCost`. |

Una tarea con dos pools AND ya iniciada produce dos filas con el mismo `activityInstanceId`; si
sigue esperando al corte produce una sentinel, no requisitos ficticios. No existe una fila con
`resources[]`. Esto conserva CSV plano y permite reconstruir ocupación/costos. `fixedCostTotal` se
obtiene de `Σ elementCost`: el fijo vive solo en la fila canónica de menor `allocationIndex`
efectivamente emitida. `process.totalCost = Σ cost`; sumar `cost` para el fijo del
elemento duplicaría recursos y está prohibido. *(decisión: ADR-025; prueba: LILA-033, LILA-034,
LILA-036, LILA-037)*

`started`, `completed`, `processing`, `resourceWait`, `offHoursWait`, `waitTime` y el intervalo de
cola que alimenta `queueLength` se agregan una vez por `(replication, activityInstanceId)`; costos
y ocupación de pool se agregan por fila.

### `log.csv`

`log.csv` lleva las **17 columnas** de la tabla anterior, en ese mismo orden y con los mismos
nombres internos (Bizagi no publica un event log, así que aquí no hay nombres de columna que
replicar; ver sección 10). Reducir el conjunto rompería a los consumidores v1 (ADR-025).

Al exportar (CSV de la CLI, `toCsv()`), `enabledAt`/`startedAt`/`endedAt` se derivan además a
timestamps ISO 8601 absolutos (`run.start + segundos`) en tres columnas **añadidas al final**,
`enabledAtIso`/`startedAtIso`/`endedAtIso`; el CSV en bruto para procesamiento programático
conserva los segundos relativos, que siguen siendo los valores autoritativos porque el ISO se
redondea al milisegundo más cercano. Una columna de tiempo nula (el `startedAt` de una fila que nunca arrancó)
deja también su celda ISO vacía, y un `run.start` ilegible vacía las tres en lugar de abortar el
archivo. Sin `run.start` el CSV se queda en las 17 columnas.

`lila run --csv` escribe `log.csv` **en streaming**, fila a fila desde `opts.onEvent`, con un búfer
de 1 MiB y publicación atómica por `rename`: el archivo completo nunca está en memoria y el
`RunResult` no retiene el log (modo streaming, arriba). *(prueba: LILA-037)*

El event log, con un mapeo trivial de columnas, es compatible con XES (IEEE 1849) y OCEL 2.0 (ver sección 6 del documento de estructura).

---

## 8. `replications` / `ci95` y `warmup`

Cuando `scenario.run.replications > 1`, cada KPI numérico de interés (los de `process`, y opcionalmente los de `elements`/`resources` que la CLI decida imprimir) se resume además entre replicaciones:

```ts
interface ReplicationSummary {
  count: number;                     // replicaciones completas resumidas; >= 2
  kpis: Record<string, {             // keyed por nombre de KPI, p. ej. "process.cycleTime.mean"
    mean: number;
    sd: number;
    ci95: [number, number];          // límite inferior y superior del intervalo de confianza al 95 %
  }>;
}
```

Los segmentos dinámicos de esos nombres (ids BPMN de elementos, flujos y recursos) escapan
`.` como `\.` antes de formar el path. Así, por ejemplo, el KPI `processing.mean` del elemento
`Task.A` se llama `elements.Task\.A.processing.mean`, sin colisionar con otros ids válidos.
Los ids sin punto conservan exactamente los nombres mostrados arriba. *(prueba: LILA-027)*

- **`mean`/`sd`** — media y desviación estándar muestral del KPI a través de las `N` replicaciones (una observación por replicación, no por caso).
- **`ci95`** — intervalo de confianza al 95 % para la media, `mean ± t(N-1, 0.975) × sd / √N` (t de Student con `N-1` grados de libertad; con `N` grande se aproxima a `1.96 × sd/√N`). Es la métrica que Bizagi solo ofrece desde What-If (sección 3: "Replicaciones — Bizagi ✓ solo en what-if / Lila ✓ siempre, con IC 95 %"); en Lila se calcula siempre que `replications > 1`.

Si `opts.signal.aborted` detiene la corrida, el resultado lleva `cancelled: true` y
`completedReplications`, que cuenta exclusivamente replicaciones terminadas; la ausencia de
`cancelled` significa corrida completa. El top-level conserva el trabajo procesado: promedia las
replicaciones completas y la parcial si existe. `replications`, cuando puede calcularse con al
menos dos replicaciones completas, excluye siempre la parcial; con menos de dos completas se omite
para no publicar una desviación o un IC inválidos. Una cancelación entre replicaciones no agrega
una réplica parcial ficticia. *(prueba: LILA-029)*

`opts.onProgress`, cuando existe, recibe primero `fraction = 0`, aun si la primera réplica no
tiene eventos. La fracción es estrictamente monótona y una corrida completa termina en 1; una
cancelada puede terminar antes. No se instala ningún hook por evento cuando el callback está
ausente. *(prueba: LILA-029)*

**`warmup`**: `scenario.run.warmup` (segundos desde `run.start`) excluye de **todas** las estadísticas los casos que se **iniciaron** antes de que terminara el warmup. Esos casos siguen ocupando pools, haciendo cola y alterando cuándo arrancan los casos medidos; sus filas igual se emiten, pero la cohorte queda fuera de `process`, `elements`, `resources`, costos y de las integrales de `queueLength`/utilización. Las integrales de cohortes medidas se recortan además a `[warmup, t_stop]`. `throughputPerHour` usa como denominador la duración efectiva de la corrida excluyendo el propio warmup. *(prueba: LILA-027, LILA-033, LILA-036)*

---

## 9. `warnings[]`

Lista de strings, una por condición no fatal detectada durante `resolveScenario`, `validate` o `simulate` que el usuario debe poder ver sin que la corrida se detenga. Ejemplos (no exhaustivo, ver `SEMANTICS.md` para la lista completa de reglas que generan warnings):

- Probabilidades de un XOR/OR que no suman 1 y se normalizaron.
- Una clave de `elements` en el escenario que no corresponde a ningún id del IR (sobra, no falta — una clave que falta es error, no warning).
- Una referencia `lila:*Ref` colgante hacia el catálogo (ver `BPMN_EXTENSION.md`).
- Uso de una distribución `normal`/`truncatedNormal` con probabilidad de muestrear un valor negativo mayor a 1 % (se trunca a 0, pero se avisa).

---

## 10. Mapeo de nombres de columna: interno → Bizagi

La CLI (`lila run`) imprime las tablas de `elements` y `resources` con los **nombres de columna de Bizagi**, verificados contra la ayuda oficial (`help.bizagi.com`, niveles 1–4 y `simulation_in_bizagi.htm`; ver `investigacion-2026-09-03/02-bizagi-simulacion.md`), para que un usuario que migra desde Bizagi pueda comparar números sin traducir columnas. Bizagi usa indistintamente "Tokens" e "Instances" según la página de ayuda; se documentan ambas variantes observadas.

### Tabla "Process elements" (niveles 1–4)

| Campo interno (`RunResult.elements[id]`) | Nombre de columna Bizagi |
|---|---|
| `started` | Instances started (también "Tokens started") |
| `completed` | Instances completed (también "Tokens completed") |
| `processing.min` | Minimum time |
| `processing.max` | Maximum time |
| `processing.mean` | Average time |
| `processing.total` | Total time |
| `resourceWait.min` | Minimum time (waiting for resource) |
| `resourceWait.max` | Maximum time (waiting for resource) |
| `resourceWait.mean` | Average time (waiting for resource) |
| `resourceWait.sd` | Standard deviation (waiting for resource) |
| `resourceWait.total` | Total time (waiting for resource) |
| `fixedCostTotal` | Total fixed cost |

`offHoursWait`, `queueLength`, `resources[id].busyTime`, los percentiles de `process.cycleTime`/`process.waitTime`, `throughputPerHour`, `costPerCase`, `process.totalCost` y `bottlenecks` **no tienen columna equivalente en Bizagi** — son las métricas extra listadas en la sección 3 del documento de estructura ("Extras que Bizagi no da"); la CLI las imprime en tablas adicionales sin intentar nombrarlas "a la Bizagi".

### Tabla "Resources" (niveles 3–4)

| Campo interno (`RunResult.resources[id]`) | Nombre de columna Bizagi |
|---|---|
| `utilization` | Utilization (%) |
| `busyTime` | — (sin columna en Bizagi; extra de Lila, en segundos-unidad) |
| `fixedCost` | Fixed cost |
| `unitCost` | Unit cost |
| `totalCost` | Total cost |

La tabla lista **una fila por pool declarado**, también los que quedaron con 0 % de utilización
(sección 4), igual que Bizagi.

### Tabla "Sequence flows" (nivel 1)

| Campo interno (`RunResult.flows[id]`) | Nombre de columna Bizagi |
|---|---|
| `count` | Instances/Tokens completed (para el sequence flow) |

Nota de confianza: los nombres exactos arriba están marcados `[verified]` en la investigación citada salvo el desglose de "waiting for resource" en columnas separadas Min/Max/Avg/Std.Dev/Total, que la ayuda de Bizagi describe como grupo pero sin dar el texto literal de cada subcolumna — se usa el patrón `Minimum/Maximum/Average/Standard deviation/Total time` por consistencia con el grupo de `processing`. Si al reproducir el ejemplo oficial de nivel 3/4 de Bizagi (prueba de aceptación de M1, sección 7 del documento de estructura) el texto real difiere, este documento se corrige entonces sin abrir un ticket aparte.

---

## 11. `compare(results[])` *(LILA-038)*

`compare` (`packages/engine/src/core/compare.ts`) pone varios `RunResult` lado a lado para leer un
what-if. Es una función pura de `core/`: no imprime nada — la tabla de consola es `lila compare`
(LILA-047) y la vista de la web LILA-064.

```ts
function compare(results: readonly RunResult[]): CompareResult;

interface CompareResult {
  count: number;        // resultados comparados; el índice 0 de cada array es la base
  rows: CompareRow[];
}

interface CompareRow {
  kpi: string;                    // path idéntico al de replications.kpis (sección 8)
  scope: 'elements' | 'flows' | 'resources' | 'process';
  id: string | null;              // id BPMN sin escapar; null cuando scope = "process"
  metric: string;                 // p. ej. "resourceWait.mean", "cycleTime.p95"
  base: number | null;
  values: (number | null)[];      // values[0] === base
  deltaAbs: (number | null)[];    // values[i] − base
  deltaRel: (number | null)[];    // (values[i] − base) / base
  significant: boolean[];         // significant[0] siempre false
}
```

- **Base**: `results[0]`. Todo delta se mide contra ella, nunca contra la columna anterior.
- **Filas**: una por KPI numérico escalar, los mismos que aplana `numericKpis` (secciones 2–5), con
  el mismo escape de `.` en los ids dinámicos (sección 8). `scope`/`id`/`metric` son ese path ya
  partido, para que la CLI agrupe por elemento, recurso o proceso sin volver a implementar el
  escape.
- **Orden**: los KPI del resultado base en su orden de aparición (elementos, flujos, recursos,
  proceso) y, detrás, los que solo existen en resultados posteriores —un pool nuevo en el TO-BE—,
  en orden de resultado. Dos llamadas con la misma entrada producen `JSON.stringify` idéntico.
- **Claves ausentes**: un KPI que no existe en algún resultado vale `null` ahí; no es un error, y su
  `deltaAbs`/`deltaRel` también son `null`.
- **`deltaRel` con base 0**: `null`, nunca `Infinity` ni `NaN`, para que el JSON siga siendo válido.
- **Significancia**: `significant[i]` es `true` cuando los intervalos `ci95` de la base y del
  resultado `i` (sección 8) **no se solapan**. Dos intervalos que solo se tocan en un extremo cuentan
  como solapados. Un resultado sin `replications` —una sola replicación, o una corrida cancelada con
  menos de dos completas— no tiene IC: `significant` vale `false`, y los deltas siguen siendo
  válidos, solo que sin respaldo estadístico.
- Los deltas se leen limpios porque R-DET-3 garantiza números aleatorios comunes: cambiar la
  capacidad de un pool no altera el stream de los elementos que no se tocaron.

Aceptación (`examples/pedido`, `seed: 42`, 30 replicaciones): pasar de 2 a 3 cajeros marca
`elements.Task_TomarPedido.resourceWait.mean` como significativa (14,94 s → 2,19 s, IC
[14,70; 15,19] y [2,12; 2,27], disjuntos) y **no** marca `elements.Task_Preparar.resourceWait.mean`,
cuyo cuello de botella es el pool `horno` con `capacity 1`, que el TO-BE no toca.
*(prueba: LILA-038)*
