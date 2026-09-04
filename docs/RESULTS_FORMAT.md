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
  warnings: string[];                         // ver sección 8
}
```

Todo elemento, flujo o recurso que exista en el IR aparece en el mapa correspondiente aunque su conteo sea cero (por ejemplo, una rama de XOR que nunca se tomó en una corrida corta). El `id` usado como clave es siempre el `id` BPMN — nunca el nombre visible (regla del repositorio, ver cabecera de `BACKLOG.md`).

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
- **`queueLength.{mean,max}`** — longitud de la cola de instancias esperando el elemento (`enabledAt ≤ t < startedAt`), muestreada en cada evento del elemento. `mean` es el promedio ponderado por tiempo (integral de la longitud de cola sobre el tiempo de la replicación, dividida entre la duración de la corrida); `max` es el máximo instantáneo observado.
- **`fixedCostTotal`** — `elements[id].fixedCost × completed` (costo fijo por token completado, definido en el escenario; ver `SCENARIO_FORMAT.md`).

Bizagi no distingue `resourceWait` de `offHoursWait` (ver sección 3: "Espera fuera de horario separada de espera por recurso — Bizagi ✗ / Lila ✓"); es una métrica extra de Lila.

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

- **`busyTime`** — suma de segundos que el pool tuvo al menos una unidad ocupada atendiendo instancias (tiempo real trabajado, sumado sobre todas las unidades de capacidad: si `capacity = 3` y las tres unidades trabajan simultáneamente 10 s, `busyTime` acumula 30 s).
- **`utilization`** — `busyTime / (capacity × horas disponibles según calendario del recurso durante la corrida)`. Fórmula (ADR-016, única definición que hace comparables un recurso 24×7 y uno con calendario restringido): `utilization = busyTime / (capacity × availableTime)`, donde `availableTime` es el total de segundos que el calendario del recurso estuvo abierto entre `run.start` y el fin de la corrida (o `run.start + run.duration`, lo que aplique). Si el recurso no tiene calendario asignado, `availableTime` es la duración completa de la corrida (24×7). Expresada como fracción `0..1`; la CLI la imprime como porcentaje (columna Bizagi `Utilization %`).
- **`fixedCost`** — `Σ fixedCost del recurso × instancias atendidas por ese recurso` (costo fijo por token procesado, definido en `resources[id].fixedCost` del escenario).
- **`unitCost`** — `costPerHour del recurso × (busyTime / 3600)` (costo por las horas efectivamente ocupadas).
- **`totalCost`** — `fixedCost + unitCost`.

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
- **`waitTime.*`** — mismas estadísticas y percentiles, pero sobre la suma de `resourceWait + offHoursWait` de todos los elementos que atravesó el caso (tiempo total de espera del caso, sin importar la causa).
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

Ranking de elementos ordenado descendentemente por `elements[elementId].resourceWait.total` (el elemento donde más tiempo total se perdió esperando recurso). Desempate: mayor `utilization` primero (del recurso — o, si el elemento usa varios pools con `selection: "and"`, el mayor `utilization` entre ellos). Elementos con `resourceWait.total = 0` no aparecen en el ranking. Es una métrica que Bizagi no ofrece (sección 3: "Ranking de cuellos de botella — Bizagi ✗ / Lila ✓").

---

## 7. Event log

Filas planas, una por instancia de elemento por caso por replicación. Se emiten por streaming (`opts.onEvent`) para que la CLI escriba a CSV y la web pueda agregar/muestrear sin cargar todo en memoria (ver sección 6 del documento de estructura: hasta 6 M filas en corridas grandes).

| Columna | Tipo | Unidad | Definición |
|---|---|---|---|
| `replication` | integer | — | Índice de la replicación, `0..scenario.run.replications-1`. |
| `caseId` | string | — | Identificador del caso (instancia de proceso), único dentro de la replicación. |
| `elementId` | string | — | `id` BPMN del elemento (nunca el nombre). |
| `resourceId` | string \| null | — | `id` del pool de recursos que atendió la instancia; `null`/ausente si el elemento no requiere recurso. |
| `enabledAt` | number | segundos desde `run.start` | Instante en que el token llegó al elemento y quedó habilitado para empezar. |
| `startedAt` | number | segundos desde `run.start` | Instante en que empezó a procesarse (tras esperar recurso y calendario). |
| `endedAt` | number | segundos desde `run.start` | Instante en que terminó el processing. |
| `resourceWait` | number | segundos | Porción de la espera antes de empezar atribuible exclusivamente a falta de recurso; no incluye tiempo de calendario cerrado. |
| `offHoursWait` | number | segundos | Tiempo cerrado contenido en todo el intervalo `[enabledAt, endedAt]`: incluye tanto el cierre antes de arrancar como las pausas durante el procesamiento. Junto con `resourceWait` cumple `endedAt − enabledAt = resourceWait + offHoursWait + processing` (R-CAL-7/8). *(prueba de la identidad: LILA-028)* |
| `cost` | number | `run.currency` | Costo atribuido a esta fila: `fixedCost` del elemento (si esta fila lo completa) más, si tiene `resourceId`, el costo del recurso por su tiempo abierto efectivamente ocupado; las pausas de calendario no generan costo (R-CAL-6, R-COST-3). |

Al exportar (CSV de la CLI, `toCsv()`), `enabledAt`/`startedAt`/`endedAt` se pueden derivar además a timestamps ISO 8601 absolutos (`run.start + segundos`); el CSV en bruto para procesamiento programático conserva los segundos relativos. El event log, con un mapeo trivial de columnas, es compatible con XES (IEEE 1849) y OCEL 2.0 (ver sección 6 del documento de estructura).

---

## 8. `replications` / `ci95` y `warmup`

Cuando `scenario.run.replications > 1`, cada KPI numérico de interés (los de `process`, y opcionalmente los de `elements`/`resources` que la CLI decida imprimir) se resume además entre replicaciones:

```ts
interface ReplicationSummary {
  count: number;                     // = scenario.run.replications
  kpis: Record<string, {             // keyed por nombre de KPI, p. ej. "process.cycleTime.mean"
    mean: number;
    sd: number;
    ci95: [number, number];          // límite inferior y superior del intervalo de confianza al 95 %
  }>;
}
```

- **`mean`/`sd`** — media y desviación estándar muestral del KPI a través de las `N` replicaciones (una observación por replicación, no por caso).
- **`ci95`** — intervalo de confianza al 95 % para la media, `mean ± t(N-1, 0.975) × sd / √N` (t de Student con `N-1` grados de libertad; con `N` grande se aproxima a `1.96 × sd/√N`). Es la métrica que Bizagi solo ofrece desde What-If (sección 3: "Replicaciones — Bizagi ✓ solo en what-if / Lila ✓ siempre, con IC 95 %"); en Lila se calcula siempre que `replications > 1`.

**`warmup`**: `scenario.run.warmup` (segundos desde `run.start`) excluye de **todas** las estadísticas de `process` (y, por consistencia, de `elements`) los casos que se **iniciaron** antes de que terminara el warmup — sus eventos igual se emiten en el event log (no se descartan datos), pero no participan en `started`/`completed`/`cycleTime`/`waitTime`/`throughputPerHour`/costos. `throughputPerHour` usa como denominador la duración efectiva de la corrida excluyendo el propio warmup.

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

`offHoursWait`, `queueLength`, los percentiles de `process.cycleTime`/`process.waitTime`, `throughputPerHour`, `costPerCase` y `bottlenecks` **no tienen columna equivalente en Bizagi** — son las métricas extra listadas en la sección 3 del documento de estructura ("Extras que Bizagi no da"); la CLI las imprime en tablas adicionales sin intentar nombrarlas "a la Bizagi".

### Tabla "Resources" (niveles 3–4)

| Campo interno (`RunResult.resources[id]`) | Nombre de columna Bizagi |
|---|---|
| `utilization` | Utilization (%) |
| `fixedCost` | Fixed cost |
| `unitCost` | Unit cost |
| `totalCost` | Total cost |

### Tabla "Sequence flows" (nivel 1)

| Campo interno (`RunResult.flows[id]`) | Nombre de columna Bizagi |
|---|---|
| `count` | Instances/Tokens completed (para el sequence flow) |

Nota de confianza: los nombres exactos arriba están marcados `[verified]` en la investigación citada salvo el desglose de "waiting for resource" en columnas separadas Min/Max/Avg/Std.Dev/Total, que la ayuda de Bizagi describe como grupo pero sin dar el texto literal de cada subcolumna — se usa el patrón `Minimum/Maximum/Average/Standard deviation/Total time` por consistencia con el grupo de `processing`. Si al reproducir el ejemplo oficial de nivel 3/4 de Bizagi (prueba de aceptación de M1, sección 7 del documento de estructura) el texto real difiere, este documento se corrige entonces sin abrir un ticket aparte.
