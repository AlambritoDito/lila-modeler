# Formato de escenario v1

> Leer en: [English](../SCENARIO_FORMAT.md)

Fuente de verdad: `LILA_MODELER_ESTRUCTURA.md`, sección 6 ("Formato de escenario v1") y ADR-015. Este documento es la especificación normativa de `*.scenario.json`; cuando difiera del documento de estructura, manda el documento de estructura y este archivo se corrige.

Ticket: LILA-004 (E0 · M0). Se escribe **antes** del motor. Lo implementan `packages/engine/src/scenario.ts` (zod + JSON Schema) y `resolveScenario()`.

---

## 1. Qué es un escenario

Un escenario es un archivo JSON **separado del `.bpmn`** que contiene los parámetros de simulación de un modelo: cuándo y cuánto corre, qué calendarios y recursos existen, y qué parámetros lleva cada elemento del diagrama, **keyed por el `id` BPMN** (ADR-012: el `id` es la única clave; nunca el nombre).

Por qué separado y por qué JSON propio (ADR-015): N escenarios por diagrama; diffs de git sin ruido de coordenadas DI; parcheable por un agente como `elements["Task_1"].processingTime.mean = 400`; migra 1:1 a una columna `jsonb`. El vocabulario (nombres de campo y de distribución) sigue a BPSim 2.0 para que los adaptadores de los bordes sean triviales, pero BPSim y qbp **no** son el formato canónico.

Qué **no** es: no lleva geometría, ni nombres de elementos, ni documentación — eso vive en el `.bpmn` (ADR-013). No lleva resultados — eso es `RESULTS_FORMAT.md`.

Convención de nombre: `<nombre>.scenario.json`, junto al `.bpmn` del proyecto (`examples/pedido/as-is.scenario.json`).

---

## 2. Estructura

### 2.1 Raíz

| Campo | Tipo | Oblig. | Descripción |
|---|---|---|---|
| `$schema` | string (URL) | no | `https://lila-modeler.org/schema/scenario/1.json`. Solo para editores; el motor no lo descarga. |
| `version` | integer | **sí** | Versión del formato. En v1 vale exactamente `1`. Otro valor ⇒ error. |
| `name` | string | **sí** | Nombre del escenario. Aparece en resultados y en `lila compare`. |
| `description` | string | no | Texto libre. |
| `model` | string (ruta) | **sí**¹ | Ruta al `.bpmn`, **relativa al archivo de escenario**. |
| `extends` | string (ruta) | no | Escenario padre del que se hereda (§ 6). |
| `run` | objeto | **sí**¹ | Parámetros de corrida (§ 2.2). |
| `calendars` | objeto | no | Calendarios por clave (§ 2.3). Sin calendario ⇒ 24×7. |
| `resources` | objeto | no | Pools de recursos por clave (§ 2.4). Sin recursos ⇒ capacidad infinita. |
| `elements` | objeto | no | Parámetros por `id` BPMN (§ 2.5). |

¹ Obligatorio **en el escenario resuelto** (después de aplicar `extends`), no en cada archivo: un hijo que declara `extends` hereda `model` y `run` del padre.

No se aceptan claves desconocidas en la raíz (`strict`): un campo mal escrito es un error, no un silencio.

### 2.2 `run`

| Campo | Tipo | Oblig. | Default | Descripción |
|---|---|---|---|---|
| `start` | string ISO 8601 con offset | **sí** | — | Instante cero del reloj virtual. **Único campo que no está en segundos.** Su offset fija la zona horaria en que se leen los calendarios. |
| `duration` | number (segundos) | no² | — | Duración simulada. Corta la corrida. |
| `warmup` | number (segundos) | no | `0` | Los casos **iniciados** antes de `warmup` se excluyen de las estadísticas (siguen consumiendo recursos). |
| `replications` | integer ≥ 1 | no | `1` | Corridas independientes. Con `> 1` el resultado trae `mean`, `sd` e `ic95` por KPI. Bizagi recomienda 30. |
| `seed` | integer | no | `1` | Semilla del PRNG. Determinismo byte a byte por `(seed, replicación, elementId)` (ADR-017). El default lo aplica el motor, no el esquema: sin declararla sale el aviso `W-SIN-SEED` (R-DEG-4). |
| `baseTimeUnit` | `"s"` \| `"min"` \| `"h"` \| `"day"` | no | `"s"` | **Solo presentación**: en qué unidad se imprimen los tiempos. No cambia ni un número interno. |
| `currency` | string ISO 4217 | no | — | Moneda de los costos. Si falta, los importes se reportan sin símbolo. |

² Al menos uno de `run.duration` o un `triggerCount` en un `start` de `elements` (regla R6). Si están los dos, gana lo primero que ocurra.

### 2.3 `calendars`

Mapa `clave → { intervals: [...] }`. La clave es el identificador que citan `resources[*].calendar` y `elements[*].calendar`. La clave `default` es el calendario que toma **todo pool** que no declare el suyo (R-CAL-10); los elementos no la heredan.

| Campo | Tipo | Oblig. | Descripción |
|---|---|---|---|
| `intervals` | array (≥ 1) | **sí** | Ventanas abiertas del patrón semanal. |
| `intervals[].days` | array de `"MON"`\|`"TUE"`\|`"WED"`\|`"THU"`\|`"FRI"`\|`"SAT"`\|`"SUN"` | **sí** | Días a los que aplica la ventana. |
| `intervals[].from` | string `"HH:MM"` (24 h) | **sí** | Apertura, hora local del offset de `run.start`. |
| `intervals[].to` | string `"HH:MM"` (24 h) o `"24:00"` | **sí** | Cierre, **exclusivo**. Debe ser `> from`; una ventana nocturna se parte en dos intervalos. `"24:00"` es la medianoche del día siguiente y solo se admite aquí, nunca en `from`: sin ella el formato no sabe decir "hasta el final del día" y un 24×7 escrito a mano perdería 60 s cada noche. |

Semántica (ADR-016): patrón **semanal relativo a `run.start`**; una tarea solo arranca dentro de su calendario efectivo —la intersección de los de sus pools con el suyo propio, R-CAL-4— y su `processingTime` consume solo tiempo de calendario (se pausa al cerrar el turno, reanuda al abrir); el tiempo cerrado se reporta como `offHoursWait`, separado de `resourceWait`; la utilización se calcula sobre el tiempo **disponible** según calendario. Intervalos solapados dentro del mismo calendario se unen (unión, no suma). Sin DST, sin festivos, sin zona horaria propia en v1 (§ 4).

### 2.4 `resources`

Mapa `clave → pool`. La clave es la que citan `elements[*].resources[].ref`.

| Campo | Tipo | Oblig. | Default | Descripción |
|---|---|---|---|---|
| `name` | string | no | la clave | Nombre para reportes. |
| `type` | `"role"` \| `"equipment"` | no | `"role"` | Solo clasifica; no cambia la semántica. |
| `capacity` | integer ≥ 1, **o** array de `{ calendar, capacity }` (≥ 1 elemento) | **sí** | — | Unidades simultáneas del pool. En la forma por intervalos, `capacity_i` unidades mientras el calendario `calendar_i` esté abierto (R-CAL-11). Excluyente con `calendar` (R16). |
| `costPerHour` | number ≥ 0 | no | `0` | Costo por hora **ocupada** (no por hora disponible). |
| `fixedCost` | number ≥ 0 | no | `0` | Costo fijo por token atendido. |
| `calendar` | string (clave de `calendars`) | no | `default` si existe | Sin `calendar` el pool usa el calendario llamado `default`; si tampoco existe, está disponible 24×7 (R-CAL-10). |

Cola: FIFO por pool, ordenada por instante de habilitación, empate por `seq`.

**Capacidad por turno** (LILA-164). Un mismo rol puede tener distinta cantidad según el turno —el
caso del nivel 4 de Bizagi: 3 enfermeras de día y 1 de noche—. Eso es **un** pool con `capacity`
por intervalos, no un pool por turno:

```json
"resources": {
  "enfermera": {
    "name": "Nurse", "type": "role", "fixedCost": 5,
    "capacity": [
      { "calendar": "dia",   "capacity": 3 },
      { "calendar": "noche", "capacity": 1 }
    ]
  }
}
```

Semántica (R-CAL-11 de `SEMANTICS.md`, §12):

- el pool está **abierto** cuando lo está **cualquiera** de sus calendarios (unión); si los turnos
  cubren las 24 h, el pool es un 24×7 y ninguna tarea tiene `offHoursWait`;
- la **capacidad en `t`** es la **suma** de los `capacity_i` cuyos `calendar_i` están abiertos en
  `t`. Dos calendarios que se solapan **suman** (a diferencia de los intervalos de un mismo
  calendario, que se unen): `[{ "dia": 2 }, { "24x7": 1 }]` da 3 unidades de día y 1 de noche,
  porque son dos grupos distintos de unidades del mismo rol;
- al **cerrar** un tramo, las tareas en curso **no se interrumpen**: el pool puede quedar
  temporalmente por encima de su capacidad hasta que terminen (misma regla que R-REC-7);
- `quantity` de una tarea se valida contra el **máximo de la semana**, no contra la suma declarada:
  3 + 1 unidades en turnos disjuntos nunca son 4 simultáneas;
- la utilización se integra tramo a tramo: `busyTime / Σᵢ (capacityᵢ × openTimeᵢ)` sobre la ventana
  de medida (R-CAL-9).

La forma numérica es el caso de un solo tramo: `{ "capacity": 3, "calendar": "dia" }` y
`{ "capacity": [{ "calendar": "dia", "capacity": 3 }] }` producen exactamente el mismo resultado.

### 2.5 `elements`

Mapa `id BPMN → parámetros`. Las claves son ids del diagrama: nodos (`Task_…`, `StartEvent_…`, `Timer_…`) y sequence flows (`Flow_…`).

| Campo | Tipo | Aplica a | Default | Descripción |
|---|---|---|---|---|
| `processingTime` | distribución (§ 3) | tareas, timers | sin tiempo (0 s) | Duración del trabajo, en segundos. En un timer intermedio es el retardo, sin recurso. |
| `resources` | array de `{ ref, quantity }` | tareas | — | `ref` = clave de `resources`; `quantity` integer ≥ 1, default `1`. Sin `resources` ⇒ capacidad infinita. |
| `selection` | `"and"` \| `"or"` | tareas con `resources` | `"and"` | `and`: arranca cuando **todos** los pools tienen capacidad simultáneamente (se comprueba en cada liberación; no se retienen recursos parciales ⇒ sin deadlock). `or`: se encola en todos, arranca con el primero disponible y se retira de los demás; si hay varios libres a la vez gana el que aparece primero en `resources` (R-REC-6). |
| `fixedCost` | number ≥ 0 | cualquier nodo | `0` | Costo fijo por token **completado** en el elemento. |
| `interTriggerTimer` | distribución (§ 3) | starts (incluido el start con timer) | — | Tiempo entre llegadas, en segundos. |
| `triggerCount` | integer ≥ 1 | starts (incluido el start con timer) | — | Máximo de casos generados por ese elemento (el "Max arrival count" de Bizagi). |
| `calendar` | string (clave de `calendars`) | starts, timers y tareas | — | Calendario de llegadas: una llegada que cae en horario cerrado se desplaza al siguiente instante abierto. En una tarea también se admite, y se **intersecta** con el de sus pools (R-CAL-4); un `timer` corre 24×7 salvo que lo declare (R-EVT-3). |
| `probability` | number en `[0, 1]` | sequence flows | equitativo | Probabilidad de tomar el flujo. En XOR se reparte por probabilidad acumulada; en OR cada salida es independiente. El rango lo comprueba el lint (`E-PROB-RANGO`), no el esquema. |

Asignar un carril entero: el panel web puede rellenar `resources` en **todas las tareas de un carril** en una sola acción (sección de recursos, «Asignar carril»). Es una edición en bloque de este mismo campo por tarea —el carril es una etiqueta del diagrama (`docs/SEMANTICS.md` § 2) y no se guarda nunca en el escenario— y las tareas que ya tienen `resources` se listan y piden confirmación antes de reemplazarlas.

Nota sobre elementos ausentes: un elemento del diagrama que no aparece en `elements` es válido y toma sus defaults (tarea sin tiempo ni recursos, flujo con reparto equitativo). `elements` es un mapa de excepciones, no un espejo obligatorio del modelo.

---

## 3. Distribuciones

Objeto `{ "type": "...", <parámetros nombrados> }`. **Parámetros nombrados, nunca posicionales** (ADR-015: eso es lo que descarta el estilo scipy de Prosimos). Todos los valores en **segundos** cuando la distribución describe un tiempo. Son las 13 de BPSim 2.0 más la constante; `user` es la empírica.

| `type` | Parámetros | Restricciones | Notas |
|---|---|---|---|
| `constant` | `value` | `value ≥ 0` | Determinista. |
| `uniform` | `min`, `max` | `min ≤ max`, `min ≥ 0` | Continua. |
| `triangular` | `min`, `mode`, `max` | `min ≤ mode ≤ max`, `min ≥ 0` | |
| `exponential` | `mean` | `mean > 0` | `mean` es la media, no la tasa λ. |
| `normal` | `mean`, `sd` | `sd ≥ 0` | **Truncada a ≥ 0**; el lint avisa si `P(x < 0) > 1 %`. |
| `truncatedNormal` | `mean`, `sd`, `min`, `max` | `sd ≥ 0`, `min ≤ max` | Truncamiento explícito por rechazo. |
| `lognormal` | `mean`, `sd` | `mean > 0`, `sd ≥ 0` | `mean` y `sd` son **de la variable, no de su logaritmo** (como Bizagi y qbp; se convierten internamente a μ y σ del log). |
| `gamma` | `shape`, `scale` | `shape > 0`, `scale > 0` | Media = `shape × scale`. |
| `erlang` | `k`, `mean` | `k` integer ≥ 1, `mean > 0` | `mean` es la media **total**, no la de cada fase. |
| `weibull` | `shape`, `scale` | `shape > 0`, `scale > 0` | |
| `beta` | `alpha`, `beta`, `min`, `max` | `alpha > 0`, `beta > 0`, `min ≤ max` | Beta estándar reescalada a `[min, max]`. |
| `poisson` | `mean` | `mean > 0` | Discreta. |
| `binomial` | `n`, `p` | `n` integer ≥ 1, `0 ≤ p ≤ 1` | Discreta. |
| `user` | `points: [{ value, probability }]` | `probability ≥ 0`; ≥ 1 punto | Empírica discreta. Si las probabilidades no suman 1 se normalizan con warning. |

Cualquier `type` fuera de esta lista es error de validación con el texto de "no soportado" (ADR-021). Cualquier parámetro sobrante dentro de una distribución también es error (objeto estricto): `{"type":"normal","mean":60,"stddev":10}` falla citando `stddev`.

---

## 4. Campos reservados

Estos campos **están en el esquema** (se aceptan sintácticamente, se documentan, no rompen un archivo escrito hoy) pero el motor v1 los **rechaza con un error explícito** al resolver el escenario. Nunca se ignoran en silencio (ADR-021).

| Campo | Dónde | Qué hará cuando exista |
|---|---|---|
| `priority` | `elements[task]` | Prioridad en la cola del recurso, en lugar de FIFO puro. |
| `preempt` | `elements[task]` | Si una tarea de mayor prioridad puede desalojar a una en curso. |
| `batch` | `elements[task]` | Agrupación de tokens para procesarlos juntos. |
| `conditions` | `elements[flow]`, `elements[task]` | Ramificación por expresión sobre datos del caso, en vez de por probabilidad. |
| `holidays` | `calendars[*]` | Fechas concretas cerradas, además del patrón semanal (ADR-016). |
| `timezone` | `calendars[*]`, `run` | Zona horaria propia con DST, en vez del offset fijo de `run.start` (ADR-016). |

Texto del error: el mismo patrón que el resto de "no soportado", citando el campo y el `id` del elemento.

---

## 5. Reglas de validación

Las seis primeras son literalmente las del documento de estructura; las demás se derivan de la sección 6 y de los ADR citados.

| # | Regla |
|---|---|
| **R1** | Todos los tiempos van en **segundos**, salvo `run.start`. |
| **R2** | `baseTimeUnit` **solo afecta a la presentación**. |
| **R3** | Las claves de `elements` **deben existir en el IR**: si falta, **error** citando el `id`; si sobra en el IR (elemento del modelo sin parámetros), **warning**. |
| **R4** | `probability` solo en **sequence flows** (en un nodo es `E-PROB-EN-NODO`). |
| **R5** | `interTriggerTimer` / `triggerCount` solo en **starts**, incluido el `bpmn:startEvent` con `timerEventDefinition` (que `SEMANTICS.md` § 2 mapea a `start`). Un `bpmn:intermediateCatchEvent` con timer es retardo, nunca generador: los dos campos ahí son `E-CAMPO-NO-APLICA`. Un `triggerCount` sin `interTriggerTimer` significa `triggerCount` llegadas en `t = 0` (R-ARR-1), no un start mudo. |
| **R6** | Al menos uno de `run.duration` o un `triggerCount` **en un start** (el de un elemento que no genera no cuenta como parada). Con `triggerCount` a solas la corrida termina al vaciarse el heap. |
| R7 | `version` debe ser `1`; la raíz y todos los objetos son estrictos (clave desconocida ⇒ error). |
| R8 | `model` y `run` deben existir **en el escenario resuelto**; `run.start` debe ser ISO 8601 **con offset** y designar un instante que **existe**: fecha civil real (`2026-02-31`, `2026-13-01` y `2026-02-29` son error, `2024-02-29` no), hora `00:00:00`–`23:59:59` y offset `±00:00`–`±23:59`. `24:00` no se admite aquí (sí en `intervals[].to`, R13): como instante de arranque se escribe `00:00` del día siguiente. |
| R9 | Toda `ref` de `elements[*].resources[]` debe existir en `resources`; toda clave de `calendar` debe existir en `calendars`, **incluida la de cada tramo** de `resources[*].capacity` cuando es una lista (`E-REF-DESCONOCIDA` citando `resources.<pool>.capacity[i].calendar`). Error citando el `id` y la clave. |
| R10 | Las probabilidades de las salidas de un mismo gateway XOR: si faltan, reparto equitativo; si no suman 1, se **normalizan con warning**; el flujo `isDefault` recibe el residuo. En OR cada salida es independiente y no se normaliza. |
| R11 | Los parámetros de cada distribución deben cumplir sus restricciones (§ 3). `normal` con `P(x < 0) > 1 %` produce **warning**, no error. |
| R12 | Los campos reservados (§ 4) producen error explícito. |
| R13 | `intervals[].to > intervals[].from`; una ventana que cruza medianoche se declara como dos intervalos. `to` admite además `"24:00"` (medianoche del día siguiente); `from` no. |
| R14 | `selection` solo tiene sentido con `resources`; declararlo sin recursos es error. |
| R15 | `extends`: la ruta debe resolver a un archivo existente y la cadena no puede tener ciclos (§ 6). |
| R16 | `resources[*].capacity` por intervalos y `resources[*].calendar` son **excluyentes**: el calendario ya va en cada tramo y declarar los dos deja sin definir cuál manda. Error `E-CAPACIDAD-Y-CALENDARIO` citando el pool. Cada `capacity[i].capacity` es entero ≥ 1 y la lista no puede estar vacía (`E-REC-CAPACIDAD`). **El JSON Schema no puede expresar esta regla**: `docs/scenario.schema.json` se genera desde zod y el `anyOf` de `capacity` no ve al hermano `calendar`, así que un pool con los dos pasa el schema y solo lo rechaza `validateScenario` (o el guardia de `core/sim.ts`). Quien valide únicamente con el schema —un editor, un CI ajeno— tiene que correr además el lint. Fijado en test desde LILA-164 (`packages/engine/test/scenario.capacity-slices.qa.test.ts`, § 8). |

Errores vs. warnings: un **error** impide simular; un **warning** viaja en `warnings[]` del `RunResult` y se imprime en la CLI. Un campo aplicado a un tipo de elemento que no lo admite (R4, R5, R14) es error, no warning: es casi siempre un `id` equivocado.

Los defectos del **esquema** (los que caza zod antes de R3–R16: tipo equivocado, fuera de rango, clave desconocida, variante inexistente) salen en español y citan la ruta — `run.warmup: debe ser ≥ 0` —, con el mismo texto en la CLI, en el MCP y en el panel de escenario. El catálogo es `erroresEnEspanol` en `packages/engine/src/scenario.ts`, y `parseScenario` es la única puerta que lo aplica; lo que ese mapa no traduce cae en la locale `es` de zod. Única excepción: la clave desconocida sale en la CLI con el texto de § 17 (`E-CLAVE-DESCONOCIDA: clave no reconocida por el esquema: …`, que pone `schemaIssueLines`), porque el catálogo de § 17 manda sobre el mapa. Los mensajes propios de este documento (R8, R11, R13, `E-CAL-VACIO`…) los escribe el esquema y mandan sobre el mapa. Los errores y avisos **semánticos** son otra cosa: los define el catálogo § 17 de `docs/SEMANTICS.md`.

---

## 6. Semántica de `extends`

```json
{ "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }
```

- **Merge profundo**: el hijo se aplica sobre el padre objeto a objeto. Lo no mencionado se hereda intacto.
- **`null` borra la clave**: `{"resources": {"horno": null}}` elimina el pool `horno` del escenario resuelto.
- **Los arrays se reemplazan enteros**, no se fusionan elemento a elemento: `resources: [...]` de una tarea, `intervals: [...]` de un calendario y `points: [...]` de una `user` se sustituyen completos. Es la única semántica predecible para una lista sin claves.
- **Cadenas permitidas**: A `extends` B `extends` C. Se resuelve de la raíz hacia abajo (C, luego B, luego A).
- **Ciclos rechazados**: cualquier ciclo en la cadena es error, citando los archivos implicados.
- **Rutas relativas al archivo del hijo**, no al directorio de trabajo. `model` también se resuelve relativo al archivo donde está escrito.
- **`__proto__`, `constructor` y `prototype` se ignoran**: en JavaScript no son claves normales (escriben en el prototipo del objeto), así que la fusión las salta en cualquier objeto y a cualquier profundidad, sin avisar. Ningún campo del § 2 se llama así; dentro de un array las caza el esquema como `E-CLAVE-DESCONOCIDA` (LILA-204).
- La validación (§ 5) se aplica **al escenario resuelto**, no a cada archivo por separado: por eso un delta puede no traer `model` ni `run`.

---

## 7. Ejemplos

### 7.1 AS-IS (`examples/pedido/as-is.scenario.json`)

Copiado tal cual del documento de estructura, sección 6.

```json
{
  "$schema": "https://lila-modeler.org/schema/scenario/1.json",
  "version": 1,
  "name": "AS-IS",
  "description": "Operación actual, 2 cajeros y 3 cocineros",
  "model": "model.bpmn",
  "run": {
    "start": "2026-09-07T08:00:00-06:00",
    "duration": 2592000,
    "warmup": 3600,
    "replications": 30,
    "seed": 42,
    "baseTimeUnit": "min",
    "currency": "MXN"
  },
  "calendars": {
    "oficina": { "intervals": [ { "days": ["MON","TUE","WED","THU","FRI"], "from": "09:00", "to": "18:00" } ] }
  },
  "resources": {
    "cajero":   { "name": "Cajero",   "type": "role",      "capacity": 2, "costPerHour": 220, "fixedCost": 0, "calendar": "oficina" },
    "cocinero": { "name": "Cocinero", "type": "role",      "capacity": 3, "costPerHour": 180, "calendar": "oficina" },
    "horno":    { "name": "Horno",    "type": "equipment", "capacity": 1 }
  },
  "elements": {
    "StartEvent_Pedido": { "interTriggerTimer": { "type": "exponential", "mean": 240 }, "triggerCount": 10000, "calendar": "oficina" },
    "Task_TomarPedido":  { "processingTime": { "type": "triangular", "min": 60, "mode": 120, "max": 300 },
                           "resources": [ { "ref": "cajero", "quantity": 1 } ], "fixedCost": 2.5 },
    "Task_Preparar":     { "processingTime": { "type": "normal", "mean": 480, "sd": 90 },
                           "resources": [ { "ref": "cocinero" }, { "ref": "horno" } ], "selection": "and" },
    "Task_Revisar":      { "processingTime": { "type": "constant", "value": 90 },
                           "resources": [ { "ref": "cajero" }, { "ref": "cocinero" } ], "selection": "or" },
    "Timer_Reposo":      { "processingTime": { "type": "constant", "value": 600 } },
    "Flow_Aprobado":     { "probability": 0.78 },
    "Flow_Rechazado":    { "probability": 0.22 }
  }
}
```

### 7.2 TO-BE como delta

Copiado tal cual del documento de estructura, sección 6:

```json
{ "version": 1, "name": "TO-BE 3 cajeros", "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }
```

(merge profundo; `null` borra; cadenas permitidas; ciclos rechazados)

Resuelto, es idéntico al AS-IS salvo `resources.cajero.capacity = 3` — que es exactamente la prueba de aceptación de M0: `Scenario.parse(to-be)` resuelve `extends` a un objeto igual al AS-IS salvo `capacity = 3`.

### 7.3 Verificación de los ejemplos contra las reglas

El AS-IS pasa cada regla de la § 5 (`examples/pedido/model.bpmn` debe contener los siete ids citados):

| Regla | Cómo la cumple el AS-IS |
|---|---|
| R1 | Todos los números de tiempo son segundos (`duration` 2 592 000 = 30 días; `warmup` 3600 = 1 h; `mean` 240; `min/mode/max` 60/120/300; `mean/sd` 480/90; `value` 90 y 600). Solo `run.start` es una fecha. |
| R2 | `baseTimeUnit: "min"` no altera ningún valor: los tiempos siguen en segundos. |
| R3 | Las siete claves de `elements` son ids del diagrama de ejemplo. |
| R4 | `probability` aparece solo en `Flow_Aprobado` y `Flow_Rechazado`. |
| R5 | `interTriggerTimer` y `triggerCount` aparecen solo en `StartEvent_Pedido`. |
| R6 | Están `run.duration` (2 592 000 s) **y** `triggerCount` (10 000): para el motor termina lo primero que ocurra. |
| R7 | `version: 1`; no hay claves desconocidas. |
| R8 | `model` y `run` presentes; `start` con offset `-06:00`. |
| R9 | `cajero`, `cocinero` y `horno` existen en `resources`; el calendario `oficina` existe en `calendars` y lo citan `cajero`, `cocinero` y `StartEvent_Pedido`. |
| R10 | `0.78 + 0.22 = 1`: sin normalización ni warning. |
| R11 | `triangular` 60 ≤ 120 ≤ 300 ✓; `normal` mean 480, sd 90 ⇒ `P(x < 0) ≈ 6·10⁻⁸`, muy por debajo del 1 % ⇒ sin warning; `exponential` mean 240 > 0 ✓; `constant` 90 y 600 ≥ 0 ✓. |
| R12 | No hay campos reservados. |
| R13 | `09:00 < 18:00` ✓, sin cruce de medianoche. |
| R14 | `selection` solo en `Task_Preparar` y `Task_Revisar`, ambas con `resources`. `Task_TomarPedido` tiene un solo recurso y toma el default `and`. |
| R15 | El AS-IS no usa `extends`; el TO-BE apunta a un archivo hermano existente, sin ciclo. |

Defaults que ejercita el ejemplo: `cocinero` sin `fixedCost` ⇒ 0; `horno` sin `calendar` ⇒ 24×7; `Task_Preparar` y `Task_Revisar` con `resources` sin `quantity` ⇒ 1; `Timer_Reposo` sin `resources` ⇒ retardo puro; `Task_TomarPedido` sin `selection` ⇒ `and`.

---

## 8. Mapeo campo ↔ BPSim 2.0 ↔ qbp ↔ Bizagi

Para qué sirve: los adaptadores viven **en los bordes** y solo se escriben cuando aparece un consumidor (ADR-015) — import de qbp (fixtures de Prosimos/Simod), export/import de `.bpsim` para Sparx EA, y lectura de los ejemplos publicados de Bizagi. Esta tabla es el contrato de esos adaptadores. `—` = sin equivalente.

| Campo Lila | BPSim 2.0 | qbp | Bizagi (nombre en la UI) |
|---|---|---|---|
| `name` | `bpsim:Scenario/@name` | — | Scenario name |
| `description` | `bpsim:Scenario/@description` † | — | Description |
| `version`, `$schema` | — | — | — |
| `model` | — (BPSim va embebido en el `.bpmn`) | — (qbp va embebido en el `.bpmn`) | — |
| `extends` | `bpsim:Scenario/@inherits` † | — (un solo escenario por archivo) | — |
| `run.start` | `bpsim:ScenarioParameters/@start` | `qbp:processSimulationInfo/@startDateTime` | Start date |
| `run.duration` | `bpsim:ScenarioParameters/@duration` | — | Duration |
| `run.warmup` | `bpsim:ScenarioParameters/@warmup` † | — | — |
| `run.replications` | `bpsim:ScenarioParameters/@replication` | — | Replications (solo en what-if) |
| `run.seed` | `bpsim:ScenarioParameters/@seed` † | — | — |
| `run.baseTimeUnit` | `bpsim:ScenarioParameters/@baseTimeUnit` | — | Base time unit |
| `run.currency` | `bpsim:ScenarioParameters/@baseCurrencyUnit` | `qbp:processSimulationInfo/@currency` | Currency |
| `calendars[k]` | `bpsim:Calendar` (valor iCalendar) † | `qbp:timetables/qbp:timetable` | Calendars |
| `calendars[k].intervals[]` | reglas iCal dentro de `bpsim:Calendar` † | `qbp:rule/@fromWeekDay,@toWeekDay,@fromTime,@toTime` | Recurrencia + hora de inicio + duración |
| `resources[k]` | `bpmn:Resource` referenciado por `bpsim:ResourceParameters` | `qbp:resources/qbp:resource` | Resource |
| `resources[k].name` | `bpmn:Resource/@name` | `qbp:resource/@name` | Name |
| **`resources[k].capacity`** (entero) | **`bpsim:Quantity`** | **`qbp:resource/@totalAmount`** | **Availability** |
| `resources[k].capacity[]` (por intervalos) | varios `bpsim:Quantity`, uno por `bpsim:Calendar` † | — (un `timetableId` por recurso) | **Resources → Calendars → quantity** (la tabla «Resource \| Morning shift \| Day shift \| Night shift» del análisis de calendarios) |
| `resources[k].costPerHour` | `bpsim:CostParameters/bpsim:UnitCost` | `qbp:resource/@costPerHour` | Cost per hour |
| `resources[k].fixedCost` | `bpsim:CostParameters/bpsim:FixedCost` † | — | Fixed cost |
| `resources[k].type` | — | — | Type (rol / equipo) |
| `resources[k].calendar` | referencia a `bpsim:Calendar` † | `qbp:resource/@timetableId` | Calendario del recurso |
| **`elements[id].processingTime`** | **`bpsim:ProcessingTime`** | **`qbp:element/qbp:durationDistribution`** | **Processing time** |
| `elements[id].resources[].ref` | `bpsim:ResourceParameters/bpsim:Selection` (o `bpsim:Role`) | `qbp:element/qbp:resourceIds/qbp:resourceId` | Resources de la actividad |
| `elements[id].resources[].quantity` | `bpsim:Quantity` (en `ResourceParameters`) | — (un recurso por tarea) | Cantidad |
| `elements[id].selection` (`and`/`or`) | — | — | AND / OR |
| `elements[id].fixedCost` | `bpsim:CostParameters/bpsim:FixedCost` | — | Fixed cost (actividad) |
| `elements[start].interTriggerTimer` | `bpsim:InterTriggerTimer` | `qbp:arrivalRateDistribution` | Interval / time between arrivals |
| **`elements[start].triggerCount`** | **`bpsim:TriggerCount`** | `qbp:processSimulationInfo/@processInstances` | **Max arrival count** |
| `elements[start].calendar` | referencia a `bpsim:Calendar` † | `qbp:arrivalRateDistribution` + timetable de llegadas | Calendario de llegadas |
| **`elements[flow].probability`** | **`bpsim:Probability`** | **`qbp:sequenceFlow/@executionProbability`** | **%** por flujo |
| `priority` (reservado) | `bpsim:PriorityParameters/bpsim:Priority` † | — | — |
| `preempt` (reservado) | `bpsim:PriorityParameters/bpsim:Interruptible` † | — | — |
| `conditions` (reservado) | `bpsim:ControlParameters/bpsim:Condition` † | — | — |
| `batch`, `holidays`, `timezone` (reservados) | — | — | Festivos (calendario) |

En negrita, los cuatro mapeos ya fijados en el documento de estructura.

† Por verificar contra el XSD de BPSim 2.0 al escribir el adaptador `.bpsim`. La fila se documenta como intención, no como hecho comprobado.

Limitaciones conocidas de los formatos ajenos, que hacen que ninguno sirva como canónico (ADR-015):

- **BPSim 2.0** está congelado desde 2016, no tiene tooling open source y, embebido en el `.bpmn`, mezcla layout con parámetros.
- **qbp** admite **un solo escenario por archivo** y **un recurso por tarea**: `selection`, `quantity > 1` y varios escenarios no tienen destino. La importación es una degradación aceptable; la exportación pierde información y debe avisar.
- **Bizagi no exporta parámetros de simulación** (verificado en 5 archivos reales: en `bizagi:` solo viajan colores). La columna Bizagi sirve para nombrar las cosas igual que su UI, no para intercambiar archivos.
- **Prosimos** usa parámetros posicionales de scipy y no tiene licencia: solo se usa como oráculo numérico en desarrollo, nunca como formato.

---

## 9. Cambios de versión

`version` es un entero. v1 crece **de forma aditiva**: campos nuevos opcionales y campos reservados que pasan a implementarse no suben la versión. Se sube a `2` solo si cambia el significado de un campo existente o desaparece uno. El motor rechaza una `version` que no conoce; nunca adivina.

Cambios ya aplicados dentro de v1:

- **`resources[*].capacity` por intervalos** (LILA-164, § 2.4). `version` **sigue en 1**: es un
  ensanchamiento del tipo, no un cambio de significado. Todo escenario v1 anterior sigue siendo
  válido y da el mismo resultado byte a byte, porque el entero es el caso de un solo tramo. Un
  escenario que use la forma nueva **no** lo entiende un motor anterior: el esquema estricto lo
  rechaza con un error de tipo, que es la degradación correcta (no adivinar).
