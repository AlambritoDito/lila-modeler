# Lila Modeler — Semántica del motor v1

Estado: normativo para v1 (hitos M0–M3). Fecha: 2026-09-03.

Este documento define **qué hace exactamente el motor** antes de que exista una línea de `sim.ts`.
Es la fuente de verdad para `packages/engine/src/core/` y para los tests de `test/semantics.test.ts`.
Deriva de `LILA_MODELER_ESTRUCTURA.md` secciones 3 (paridad Bizagi), 4 (ADR-009…023) y 6 (diseño del
motor); si algo aquí contradijera ese documento, gana el documento y este archivo se corrige.

Cada regla tiene un identificador estable (`R-XXX-n`) y el ticket que la prueba. El resumen
`regla → ticket` está en la sección 18. Los códigos de error (`E-…`) y de aviso (`W-…`) están en la
sección 17.

Convenciones de lectura: **error** aborta (`validate` devuelve `errors`, la CLI sale con código 1,
`simulate` no corre); **aviso** no aborta y viaja en `RunResult.warnings[]`.

---

## 1. Reglas duras

Valen en todo el documento y en todo el código.

- **R-DURA-1 — Segundos.** Todo tiempo del escenario y del `RunResult` es un número de **segundos**
  (float64), salvo `run.start`, que es un instante ISO-8601 con offset. Las duraciones de
  distribuciones, `warmup`, `duration`, `processingTime`, `interTriggerTimer`, las esperas y los
  tiempos del event log son segundos. *(prueba: LILA-013)*
- **R-DURA-2 — `baseTimeUnit` es presentación.** `run.baseTimeUnit` (`sec|min|hour|day`) **no**
  cambia ningún cálculo: solo la forma en que la CLI y la UI imprimen números (`format.ts`). Dos
  escenarios idénticos salvo `baseTimeUnit` producen el mismo `RunResult` numérico.
  *(prueba: LILA-013)*
- **R-DURA-3 — Dinero.** Todos los costos están expresados en `run.currency`. El motor no convierte
  divisas ni conoce tipos de cambio; `currency` es una etiqueta que viaja al resultado y al CSV.
  *(prueba: LILA-036)*
- **R-DURA-4 — El `id` BPMN es la única clave.** Las claves de `scenario.elements` son atributos
  `id` de BPMN (nodos o sequence flows). El **nombre nunca es clave** y nunca desambigua: dos
  elementos pueden llamarse igual. Los ids se conservan en todo el pipeline; los ids ajenos que no
  son NCName se sanitizan con un mapa reversible (ADR-012) y el escenario se escribe contra el id
  **sanitizado**. *(prueba: LILA-013, LILA-017)*
- **R-DURA-5 — `elements` faltante es error, sobrante es aviso.** Una clave de `elements` que no
  existe en el IR produce error `E-ELEMENTO-DESCONOCIDO` citando el id. Un elemento del IR sin entrada
  en `elements` toma los defaults degradantes (sección 14) y produce aviso solo cuando la ausencia
  cambia la semántica (start sin `interTriggerTimer`). *(prueba: LILA-013, LILA-042)*
- **R-DURA-6 — Pureza.** `simulate(ir, scenario, opts)` es una función pura: mismos argumentos,
  mismo resultado. No lee reloj, ni disco, ni red, ni `Math.random`, ni variables globales.
  *(prueba: LILA-029, LILA-032)*

---

## 2. Perfil BPMN soportado en v1

Es la lista de la sección 3 del documento de estructura. Todo lo que aparece aquí tiene semántica
definida; todo lo demás cae en la sección 3 de este documento.

| Construcción BPMN | Tipo en el IR | Semántica |
|---|---|---|
| `bpmn:startEvent` sin disparador (*none*) | `start` | generador de casos (sección 10) |
| `bpmn:startEvent` con `timerEventDefinition` | `start` | generador de casos, idéntico al *none* |
| `bpmn:endEvent` sin disparador (*none*) | `end` | consume el token (§9) |
| `bpmn:endEvent` con `terminateEventDefinition` | `terminate` | mata todos los tokens del caso (§9) |
| `bpmn:intermediateCatchEvent` con `timerEventDefinition` | `timer` | retardo sin recurso (§9) |
| `bpmn:task` y todas sus variantes (`userTask`, `serviceTask`, `sendTask`, `receiveTask`, `manualTask`, `scriptTask`, `businessRuleTask`) | `task` | trabajo con duración y recursos (§11) |
| `bpmn:callActivity` | `task` | tarea con tiempo global (§4) |
| `bpmn:subProcess` embebido (`triggeredByEvent="false"`, sin marcadores) | — | aplanado (§4) |
| `bpmn:exclusiveGateway` | `xor` | divergente: §6; convergente: mezcla pass-through |
| `bpmn:inclusiveGateway` | `or` | §7 |
| `bpmn:parallelGateway` | `and` | §8 |
| `bpmn:sequenceFlow` (con `isDefault` cuando el gateway lo declara) | `flow` | arista; lleva `probability` |
| `bpmn:laneSet` / `bpmn:lane` | `lane` en el nodo | solo etiqueta; sin efecto en la simulación |
| `bpmn:participant` (pools) | — | varios pools se aplanan a un solo grafo de tokens |
| `bpmn:documentation`, `bpmn:textAnnotation`, `bpmn:association`, `bpmn:group`, `bpmn:dataObject*`, `bpmn:dataStore*`, `bpmn:*DI` | — | se leen y se preservan, **no** afectan a la simulación |

- **R-PERF-1 — Toda variante de tarea es `task`.** El tipo concreto de tarea no cambia nada del
  motor: solo su `processingTime`, sus `resources` y su `fixedCost`. *(prueba: LILA-018)*
- **R-PERF-2 — Un gateway convergente de tipo `xor` (una sola salida, varias entradas) es una
  mezcla sin espera**: cada token que llega sale inmediatamente por la única salida, sin sincronizar
  y sin consumir tiempo. *(prueba: LILA-026)*
- **R-PERF-3 — `bpmn:messageFlow` no transporta tokens.** Los flujos de mensaje entre pools se
  ignoran y producen aviso `W-MSGFLOW` una vez por archivo, citando cuántos se ignoraron. Los pools
  se simulan como un único grafo: un token no “salta” de pool. *(prueba: LILA-021, LILA-163)*
- **R-PERF-4 — `conditionExpression` se ignora.** Las condiciones de los sequence flows no se
  evalúan en v1 (`conditions` es campo reservado, §15): el ramaje es probabilístico. Un flujo con
  `conditionExpression` produce aviso `W-COND` citando el id del flujo. *(prueba: LILA-021,
  LILA-163)*
- **R-PERF-5 — Varios start events son válidos.** Cada `start` con `interTriggerTimer` o
  `triggerCount` genera su propio flujo de llegadas, con su propio `triggerCount` y su propio
  stream de números aleatorios. Un `start` sin ninguno de los dos no genera nada y produce aviso
  `W-START-SIN-LLEGADAS`. *(prueba: LILA-026, LILA-186)*

---

## 3. Elementos no soportados y texto exacto del error

ADR-021: todo lo que no está en la sección 2 produce **error de validación explícito**, nunca un
fallo silencioso. El texto sigue el estilo de Bizagi (“no soportado por el simulador”).

- **R-NOSOP-1 — Plantilla exacta del mensaje.** Sin nombre:

  ```
  {id} ({qname}): {construcción} no soportado por el simulador.
  ```

  Con nombre (`name` no vacío):

  ```
  {id} ({qname}, "{name}"): {construcción} no soportado por el simulador.
  ```

  `{qname}` es el nombre calificado BPMN (`bpmn:boundaryEvent`). `{construcción}` es exactamente el
  texto de la tabla siguiente. El código del error es `E-NOSOP`. *(prueba: LILA-021, LILA-163)*

- **R-NOSOP-2 — Catálogo cerrado de `{construcción}`.** Ningún otro texto es válido:

| Construcción detectada | `{construcción}` (texto exacto) |
|---|---|
| `bpmn:boundaryEvent` (cualquier disparador) | `evento adjunto a actividad (boundary event)` |
| `messageEventDefinition` en cualquier evento | `evento de mensaje` |
| `signalEventDefinition` | `evento de señal` |
| `linkEventDefinition` | `evento de enlace` |
| `errorEventDefinition` | `evento de error` |
| `escalationEventDefinition` | `evento de escalamiento` |
| `compensateEventDefinition` | `evento de compensación` |
| `conditionalEventDefinition` | `evento condicional` |
| `cancelEventDefinition` | `evento de cancelación` |
| `multipleEventDefinition` / `parallelMultipleEventDefinition` | `evento con disparadores múltiples` |
| `bpmn:intermediateThrowEvent` (sin disparador o con cualquiera) | `evento intermedio de lanzamiento` |
| `bpmn:eventBasedGateway` | `gateway basado en eventos` |
| `bpmn:complexGateway` | `gateway complejo` |
| `multiInstanceLoopCharacteristics` | `marcador de multi-instancia` |
| `standardLoopCharacteristics` | `marcador de bucle en la actividad` |
| `bpmn:transaction` | `subproceso transaccional` |
| `bpmn:adHocSubProcess` | `subproceso ad-hoc` |
| `bpmn:subProcess` con `triggeredByEvent="true"` | `subproceso de eventos` |
| `bpmn:choreographyTask`, `bpmn:choreography`, `bpmn:globalChoreographyTask` | `diagrama de coreografía` |
| `bpmn:conversation`, `bpmn:callConversation`, `bpmn:subConversation` | `diagrama de conversación` |
| `startQuantity` distinto de 1 | `atributo startQuantity distinto de 1` |
| `completionQuantity` distinto de 1 | `atributo completionQuantity distinto de 1` |
| `bpmn:endEvent` con un disparador que no sea *none* ni `terminate` | `evento de fin con ese disparador` |
| `bpmn:startEvent` con un disparador que no sea *none* ni `timer` | `evento de inicio con ese disparador` |

  El detalle que distingue cada fila del catálogo se conserva desde el parser; los fixtures que
  verifican el texto exacto de las 24 filas son parte de LILA-163.

  Ejemplo literal del mensaje que emite `validate(ir)`:

  ```
  Boundary_3a1f (bpmn:boundaryEvent, "Vence el plazo"): evento adjunto a actividad (boundary event) no soportado por el simulador.
  ```

- **R-NOSOP-3 — Un solo error por elemento, todos los elementos en una pasada.** `validate(ir)`
  no se detiene en el primero: devuelve la lista completa, ordenada por orden de aparición en el
  XML, para que el usuario arregle el archivo de una vez. *(prueba: LILA-021, LILA-163)*
- **R-NOSOP-4 — Nada de degradación silenciosa.** Un elemento no soportado nunca se convierte en
  `task` de duración 0 ni se “salta”. `simulate()` se niega a correr si `validate()` devolvió al
  menos un error. *(prueba: LILA-021, LILA-045)*
- **R-NOSOP-5 — Errores estructurales (mismo tratamiento, otros códigos):** flujo colgante
  (`E-FLUJO-COLGANTE`), id duplicado (`E-ID-DUPLICADO`), gateway sin salidas o sin entradas
  (`E-GATEWAY-SIN-ARISTAS`), nodo inalcanzable desde algún `start` (`E-INALCANZABLE`), proceso sin
  `start` (`E-SIN-START`), proceso sin `end` ni `terminate` (`E-SIN-END`). *(prueba: LILA-021)*
- **R-NOSOP-6 — Lo que el lector XML descarta también es error.** `bpmn-moddle` no lanza cuando
  no puede leer una parte del archivo: la reporta como *warning* de `fromXML` y sigue. `parseBpmn`
  conserva esos avisos tal cual en `ir.source.warnings` (texto de moddle en una línea, más el id
  afectado y la propiedad rota cuando moddle los da) y `validate(ir)` los clasifica en dos, sin
  descartar ninguno:

  - **Error `E-PARSE-INCOMPLETO`** cuando el aviso implica que se perdió un nodo o un flujo **del
    proceso simulado**: un elemento entero que moddle tiró por `id` ilegal o duplicado
    (`unparsable content … nested error: illegal ID <X>` / `duplicate ID <X>`) y que sería nodo o
    flujo según el perfil de la sección 2, o una referencia sin resolver sobre una propiedad de
    topología (`bpmn:sourceRef`, `bpmn:targetRef`, `bpmn:attachedToRef`, `bpmn:flowNodeRef`).
    Texto exacto:

    ```
    {id}: el lector XML descartó contenido del modelo, que quedó incompleto: {aviso}.
    ```

  - **Aviso `W-PARSE`** en todo lo demás: referencias sin resolver a construcciones que el perfil
    de la sección 2 ya ignora (`bpmn:messageRef`, `bpmn:dataStoreRef`, `bpmn:categoryValueRef`) y
    tipos que moddle no conoce (`unparsable content … unknown type <bpmn:LoopCounter>`, típico de
    los exports de Bizagi). También lo que se descarta de la capa de diagrama (`bpmndi:`, `di:`,
    `dc:`, `dd:`), lo que se descarta **fuera de todo `bpmn:process`** (`bpmn:message`,
    `bpmn:signal`, `bpmn:error`, `bpmn:category`, `bpmn:participant`, …) y los elementos que la
    sección 2 lee sin simular (`bpmn:dataObject*`, `bpmn:dataStore*`, `bpmn:textAnnotation`,
    `bpmn:association`, `bpmn:group`, `bpmn:documentation`, `bpmn:extensionElements`,
    `bpmn:laneSet`, `bpmn:lane`), aunque sea por id ilegal o duplicado: ninguno es nodo ni flujo
    del grafo de tokens, así que perderlos no quita ni un nodo ni un flujo (de `bpmn:lane` el IR
    solo se queda el nombre en `Node.lane`, que la CLI usa para mostrar). Texto exacto:

    ```
    {id}: aviso del lector XML, sin pérdida de nodos ni flujos: {aviso}.
    ```

  - **Aviso `W-PARSE`, referencia a un flujo ausente**: una referencia sin resolver sobre
    `bpmn:incoming` o `bpmn:outgoing` no descarta nada por sí misma — el elemento nombra un flujo
    que no está en el modelo cargado, y el IR deriva `incoming`/`outgoing` de los flujos que sí
    existen. Si ese flujo se perdió, el error lo emite el aviso que lo descartó, no este. Texto
    exacto:

    ```
    {id}: el lector XML no encontró un flujo que este elemento declara; el grafo se construye sin él: {aviso}.
    ```

  - **Aviso `W-PARSE`, aviso de otro proceso**: los avisos son del archivo entero y el IR es de
    **un** proceso (los demás viajan en `ParseResult.ignoredProcessIds`). Lo que se descartó en
    otro `bpmn:process` no deja incompleto el que se simula, así que nunca aborta y el aviso dice
    de qué proceso viene. Texto exacto:

    ```
    {id}: aviso del lector XML en {proceso}, otro proceso del archivo que Lila no simula: {aviso}.
    ```

  - **Aviso `W-XOR-DEFAULT-ROTO`**: un `bpmn:default` que apunta a un flujo inexistente no
    descarta nada del grafo; solo se pierde la marca `isDefault`, y la sección 6 (R-XOR-1/R-XOR-2)
    reparte igual sin ella. Texto exacto:

    ```
    {id}: el flujo por defecto declarado no existe; se ignora la marca isDefault y el reparto sigue las reglas del XOR sin default: {aviso}.
    ```

  `{aviso}` es el mensaje de bpmn-moddle literal, aplanado a una sola línea. `{id}` es el id del
  elemento que moddle señala (o el que aparece dentro del mensaje) y, si no hay ninguno, el id del
  proceso; `{proceso}` es el id del `bpmn:process` donde ocurrió el aviso, que se ubica por la
  posición absoluta que da el propio aviso (`detected line: N column: C`) dentro de los tramos
  `<bpmn:process …>…</bpmn:process>` del archivo, de modo que un export minificado o con los
  atributos partidos en varias líneas se clasifica igual que uno indentado. Si un aviso no dice
  dónde ocurrió, se atribuye al proceso simulado: falla cerrado. Un modelo que perdió
  nodos o flujos del proceso simulado nunca valida en verde: `E-PARSE-INCOMPLETO` aborta y
  `lila validate` sale con 1. Los ids no NCName **no** entran aquí: `sanitizeIds` (R-DURA-4,
  LILA-017/020) los reescribe antes de llegar a moddle. *(prueba: LILA-185, LILA-196)*

---

## 4. Aplanado: subproceso embebido y call activity

- **R-PLAN-1 — Subproceso embebido, aplanado.** Un `bpmn:subProcess` embebido desaparece como nodo.
  Sus flujos entrantes se reconectan al `start` interno y los flujos salientes del subproceso
  cuelgan del `end` interno. Los nodos internos conservan su `id` y reciben `subprocessId` = id del
  subproceso que los contiene (el más interno si hay anidamiento). El aplanado es recursivo.
  *(prueba: LILA-019)*
- **R-PLAN-2 — Start y end internos son pass-through.** El `start` y el `end` de un subproceso
  aplanado no consumen tiempo, no consumen recursos y no cuentan como casos: reenvían el token.
  Con varios `end` internos, todos apuntan a las salidas del subproceso. *(prueba: LILA-019)*
- **R-PLAN-3 — El subproceso no tiene tiempo propio.** `elements[subProcessId].processingTime` (o
  `resources`, o `fixedCost`) es error `E-SUBPROC-PARAMETRO` citando el id: el tiempo del subproceso
  es la suma de lo que ocurre dentro. Las métricas por subproceso se agregan desde `subprocessId`.
  El lint lo caza aunque el subproceso ya no sea un nodo del IR: sus nodos citan de quién vienen
  (`ProcessIR.nodes[x].subprocessId`). **Límite conocido**: ese campo guarda solo el subproceso
  *inmediato*, así que con subprocesos anidados el lint reconoce el más interno; declarar
  parámetros en uno exterior sale hoy como `E-ELEMENTO-DESCONOCIDO`. Cerrarlo pide llevar la
  cadena completa al IR (`bpmn/parse.ts`), que es otro ticket.
  *(prueba: LILA-019, LILA-198)*
- **R-PLAN-4 — Call activity = tarea con tiempo global.** Un `bpmn:callActivity` se traduce a
  `task` y **no** se expande el proceso llamado, aunque esté en el archivo. Su duración es su
  `processingTime` y puede tener recursos y `fixedCost` como cualquier tarea. Es la regla de Bizagi
  para subprocesos reusables. *(prueba: LILA-019)*
- **R-PLAN-5 — El aplanado no cambia los números.** Un proceso con subproceso embebido y el mismo
  proceso aplanado a mano producen el mismo `RunResult` salvo los ids de los nodos internos.
  *(prueba: LILA-019)*

---

## 5. Caso, tokens y reloj

- **R-TOK-1 — Reloj.** El tiempo de simulación es un `float64` en segundos desde `run.start`, que
  vale 0. Los instantes ISO del event log se derivan al exportar sumando segundos a `run.start`.
  *(prueba: LILA-037)*
- **R-TOK-2 — Un caso es un conjunto de tokens.** Un caso nace con un token en su `start`. Los
  gateways crean y destruyen tokens. El caso **termina** en el instante en que su número de tokens
  llega a 0 (o por `terminate`, §9). El `caseId` es un entero monótono por corrida, asignado en
  orden de llegada. *(prueba: LILA-026)*
- **R-TOK-3 — Orden de eventos.** El heap ordena por `(t, seq)` con `seq` monótono creciente
  asignado en el momento de insertar. A igual `t`, sale primero el evento insertado antes. No hay
  otro criterio de desempate en ninguna parte del motor. *(prueba: LILA-023, LILA-030)*
- **R-TOK-4 — Tránsito por flujos instantáneo.** Recorrer un `sequenceFlow` consume 0 segundos e
  incrementa `flows[id].count`. Los gateways consumen 0 segundos. *(prueba: LILA-028)*
- **R-TOK-5 — Instantes por token y tarea.** `enabled` = instante en que el token llega al nodo;
  `started` = instante en que empieza a consumirse la duración; `ended` = instante en que termina.
  Para nodos sin recurso ni calendario, `enabled = started`. *(prueba: LILA-033, LILA-036)*
- **R-TOK-6 — Identidad y lifecycle de actividad.** Cada entrada a una tarea o timer crea un
  `activityInstanceId` opaco y único dentro de la replicación, derivado de un contador. Todas las asignaciones de pools
  de esa ocurrencia comparten el id y los mismos instantes. Al cierre normal se emite
  `status = "completed"`; `terminate` emite `status = "terminated"`, y la parada o cancelación
  emite `status = "inFlight"`. En los dos últimos, `startedAt = null` distingue una instancia que
  seguía en cola de una ya iniciada y `endedAt = null`; `observedUntil` fija el corte.
  *(decisión: ADR-025; prueba: LILA-033, LILA-037)*

---

## 6. Gateway exclusivo (XOR) divergente

Sea un `xor` con salidas `f1…fn` en **orden de documento** (el orden de `bpmn:outgoing` en el XML,
conservado en `ir.nodes[g].outgoing`), y `p(fi)` el `probability` declarado en
`scenario.elements[fi]`.

- **R-XOR-1 — Sin probabilidades, reparto equitativo.** Si ningún `fi` declara `probability`, cada
  uno recibe `1/n` (el `isDefault` incluido). *(prueba: LILA-026)*
- **R-XOR-2 — El residuo va al flujo que falta.** Sea `S` la suma de las probabilidades declaradas
  y `U` el conjunto de flujos sin `probability`. Si `|U| = 1`, ese flujo recibe `max(0, 1 − S)`.
  Es el caso normal del `isDefault`: **el flujo `isDefault` recibe el residuo**. *(prueba: LILA-026)*
- **R-XOR-3 — Varios flujos sin probabilidad.** Si `|U| ≥ 2`, el residuo `max(0, 1 − S)` se reparte
  **por igual** entre ellos (el `isDefault` recibe la misma parte que los demás) y se emite aviso
  `W-XOR-RESIDUO-COMPARTIDO` citando el id del gateway y los ids de `U`. *(prueba: LILA-026,
  LILA-042)*
- **R-XOR-4 — Normalización con aviso.** Si tras R-XOR-1…3 la suma `T` de las probabilidades del
  gateway difiere de 1 en más de `1e-9`, todas se dividen entre `T` y se emite aviso
  `W-XOR-NORMALIZADA` con el id del gateway y el valor original de `T`. La simulación continúa con
  las probabilidades normalizadas. *(prueba: LILA-026, LILA-042)*
- **R-XOR-5 — Suma cero es error.** Si `T = 0` (todas declaradas en 0 y sin residuo), es error
  `E-XOR-SUMA-CERO` citando el gateway: no hay ruta posible. *(prueba: LILA-042)*
- **R-XOR-6 — Rango.** `probability` fuera de `[0, 1]` lo rechaza el lint de `validateScenario`
  (`E-PROB-RANGO`), no el motor. El esquema **no** acota el rango a propósito (LILA-198): si lo
  hiciera, el defecto saldría como un error genérico de zod, sin el código del catálogo.
  *(prueba: LILA-013, LILA-198)*
- **R-XOR-7 — Sorteo.** Se toma **un** uniforme `u ∈ [0,1)` del stream del **gateway** y se elige
  el primer `fi` tal que `u < Σ_{j≤i} p(fj)`, recorriendo en orden de documento. Por error de
  redondeo, si ningún `fi` cumple, se elige el último con `p > 0`. Un token, un sorteo, una salida.
  *(prueba: LILA-026, LILA-030)*
- **R-XOR-8 — `probability` solo en sequence flows.** `probability` en un nodo es error
  `E-PROB-EN-NODO`; en un flujo cuyo origen no es `xor` ni `or` es aviso `W-PROB-IGNORADA`.
  *(prueba: LILA-013, LILA-042, LILA-198)*

---

## 7. Gateway inclusivo (OR)

- **R-OR-1 — Fork: probabilidades independientes.** En un `or` divergente, cada salida `fi` se
  sortea **de forma independiente** con su propia `p(fi)`: un uniforme por salida, tomados del
  stream del gateway en orden de documento. No se normaliza: la suma puede ser cualquier valor en
  `[0, n]`. *(prueba: LILA-026)*
- **R-OR-2 — Salida sin `probability` en un OR vale 1.** Un `or` sin ninguna probabilidad declarada
  se comporta como un `and` fork (todas las ramas). Se emite aviso `W-OR-SIN-PROBABILIDAD` la
  primera vez. *(prueba: LILA-026)*
- **R-OR-3 — Al menos una salida.** Si los `n` sorteos fallan, se activa el flujo `isDefault`; si no
  hay `isDefault`, el de mayor `p`, con desempate por orden de documento. Se cuenta y se reporta
  aviso `W-OR-VACIO` con el id del gateway y el número de veces que ocurrió. *(prueba: LILA-026)*
- **R-OR-4 — Registro de activación.** Al activar `k` salidas, el fork registra
  `(caso, forkId, activationId, k)` con `activationId` monótono, y **marca cada token emitido** con
  ese `activationId`. Los tokens hijos heredan la marca al pasar por gateways posteriores; un token
  puede llevar varias marcas apiladas (forks OR anidados: se apilan y se desapilan en orden LIFO).
  *(prueba: LILA-026)*
- **R-OR-5 — Join: espera a los del fork emparejado.** Un `or` convergente cuenta los tokens que
  llegan por `(caso, activationId)` de la marca más reciente y dispara cuando ha recibido `k`
  tokens, emitiendo **un** token por su salida y desapilando la marca. Es la semántica práctica de
  Bizagi/Prosimos y se documenta como **simplificación**: el motor no evalúa alcanzabilidad
  estructural (la semántica OR-join completa del estándar BPMN) porque sin condiciones evaluables no
  aporta nada. *(prueba: LILA-026)*
- **R-OR-6 — Join sin fork emparejado = mezcla.** Si un token llega a un `or` convergente sin marca
  activa (por ejemplo, viene de un `xor`, o el fork está fuera del ciclo), el join se comporta como
  pass-through: cada token sale inmediatamente. Se emite aviso `W-OR-JOIN-SIN-FORK` con el id del
  join. *(prueba: LILA-026)*
- **R-OR-7 — Reinicio por loop.** El contador de un `or` join vive en `(caso, activationId)`: una
  nueva vuelta del ciclo genera un `activationId` nuevo, así que el contador de la vuelta anterior
  no interfiere. *(prueba: LILA-026)*
- **R-OR-8 — Tokens huérfanos al parar.** Los tokens que quedan esperando en un join cuando la
  corrida termina cuentan como caso `inFlight` y disparan aviso `W-JOIN-BLOQUEADO` con el id del
  join y el número de casos afectados. *(prueba: LILA-026, LILA-028)*

---

## 8. Gateway paralelo (AND)

- **R-AND-1 — Fork.** Un `and` divergente emite **un token por cada salida**, todos en el mismo
  instante, sin sorteo. `probability` en las salidas de un `and` es aviso `W-PROB-IGNORADA`.
  *(prueba: LILA-026)*
- **R-AND-2 — Join por contador `(caso, join)`.** Un `and` convergente mantiene un contador por
  pareja `(caso, joinId)`. Cada token que llega lo incrementa y se consume. Cuando el contador
  alcanza el número de **flujos entrantes** del join en el IR, se emite un token por la salida y el
  contador **se reinicia a 0**. *(prueba: LILA-026)*
- **R-AND-3 — Loops.** El reinicio de R-AND-2 es lo que hace correcto el comportamiento en ciclos:
  la segunda vuelta vuelve a contar desde 0 y no dispara con tokens de la vuelta anterior. No hay
  “memoria” entre vueltas ni por rama. *(prueba: LILA-026)*
- **R-AND-4 — El AND join no distingue por rama.** Dos tokens que llegan por la misma rama entrante
  (posible en modelos mal formados con ciclos) cuentan como dos. El motor no lo corrige; si al
  terminar la corrida quedan contadores parciales, aplica `W-JOIN-BLOQUEADO`. *(prueba: LILA-026)*
- **R-AND-5 — Duración de la sección paralela.** Con ramas de duración determinista, la sección
  `fork → ramas → join` dura exactamente el máximo de las ramas (no hay costo de sincronización).
  *(prueba: LILA-026)*
- **R-AND-6 — Join con una sola entrada.** Un `and` con una entrada y una salida es pass-through.
  *(prueba: LILA-026)*

---

## 9. Timer, end y terminate

- **R-EVT-1 — Timer = retardo sin recurso.** Un `timer` retiene el token durante
  `elements[id].processingTime` segundos y lo suelta por su única salida. **No consume recursos.**
  Declarar `resources` en un `timer` es error `E-TIMER-RECURSO` citando el id.
  *(prueba: LILA-026, LILA-198)*
- **R-EVT-2 — Timer sin tiempo.** Un `timer` sin `processingTime` retarda 0 segundos y produce aviso
  `W-TIMER-SIN-TIEMPO`. *(prueba: LILA-026)*
- **R-EVT-3 — El timer corre 24×7 salvo que declare calendario.** Por defecto el retardo del timer
  transcurre en tiempo de reloj (un plazo legal corre también de noche). Si el elemento declara
  `elements[id].calendar`, el retardo consume solo tiempo abierto y el tiempo cerrado se acumula en
  `offHoursWait`. *(prueba: LILA-041)*
- **R-EVT-4 — End consume el token.** Un `end` consume el token que llega y no hace nada más. El
  caso se marca `completed` cuando **su número de tokens llega a 0**, no cuando el primer token toca
  un `end`. Un modelo con AND fork y dos `end` termina el caso al llegar el segundo token.
  *(prueba: LILA-026, LILA-028)*
- **R-EVT-5 — Terminate mata el caso.** Un `terminate` destruye **todos** los tokens del caso, sus
  contadores de join y sus marcas de activación OR, cancela sus eventos futuros y **libera de
  inmediato los recursos que el caso tuviera ocupados**, cargando el costo por hora hasta ese
  instante. El caso cuenta como `completed` con `endedAt` = ese instante. `terminate` **no** afecta
  a otros casos ni detiene la corrida. *(prueba: LILA-026)*
- **R-EVT-6 — Tareas en curso al morir el caso.** La tarea interrumpida por `terminate` cuenta como
  `started` y no como `completed` en su elemento; no aporta a las estadísticas de `processing`.
  *(prueba: LILA-026, LILA-028)*

---

## 10. Llegadas, parada, warmup y replicaciones

- **R-ARR-1 — Un generador por start.** Cada `start` con `interTriggerTimer` genera casos. La
  primera llegada ocurre en `t = 0`; la siguiente en `t + muestra` con una muestra nueva de
  `interTriggerTimer` tomada del stream de ese `start`. Un `start` con `triggerCount` y **sin**
  `interTriggerTimer` equivale al default `interTriggerTimer: {"type":"constant","value":0}`, es
  decir `triggerCount` llegadas en `t = 0`: es lo que hace el nivel 1 de Bizagi, cuya configuración
  son solo «porcentajes de activación en cada flujo saliente de gateways exclusivos/inclusivos y
  "Max. arrival count" en el Start Event», sin ningún campo de tiempo con el que espaciarlas
  (`help.bizagi.com/platform/en/level_1_example.htm`). Solo el `start` sin ninguno de los dos campos
  no genera nada y avisa `W-START-SIN-LLEGADAS`. *(prueba: LILA-026, LILA-186)*
- **R-ARR-2 — Fin de la generación.** Un generador deja de emitir cuando ocurre lo primero de:
  (a) ha emitido `triggerCount` casos; (b) el instante de la siguiente llegada es `≥ t_stop`.
  *(prueba: LILA-026)*
- **R-ARR-3 — Parada de la corrida.** `t_stop = run.duration` si está definido; si no, la corrida
  termina cuando el heap se vacía. Con ambos definidos, manda lo primero que ocurra: el heap vacío
  también termina la corrida antes de `run.duration`. Es error `E-SIN-PARADA` que no haya ni
  `run.duration` ni ningún `triggerCount` **en un start** (solo el `start` monta generador, R-ARR-1:
  un `triggerCount` en un `timer` intermedio es `E-CAMPO-NO-APLICA` y no cuenta como parada). *(prueba: LILA-026, LILA-013)*
- **R-ARR-4 — Ejemplo normativo.** `duration = 3600`, `triggerCount = 10000`, llegadas constantes
  cada 10 s ⇒ llegadas en `t = 0, 10, …, 3590` ⇒ `started = 360`. *(prueba: LILA-026)*
- **R-ARR-5 — En vuelo al parar.** En `t_stop` se descartan los eventos pendientes. Los casos
  iniciados y no terminados cuentan en `started` y **no** en `completed`; `inFlight = started −
  completed`. Sus tareas a medias no aportan a `processing` ni a `resourceWait`. Es el criterio de
  Bizagi. *(prueba: LILA-026, LILA-028)*
- **R-ARR-6 — Llegadas con calendario.** Si el `start` declara `calendar`, una llegada que cae en
  tiempo cerrado se **desplaza** al siguiente instante abierto (`nextOpen`); no se pierde y no se
  acumulan varias en el instante de apertura salvo que el propio muestreo las genere. La cadencia
  sigue midiéndose en tiempo de reloj. *(prueba: LILA-041)*
- **R-ARR-7 — Warmup.** `run.warmup` (segundos desde `run.start`) excluye de **todas** las
  estadísticas los casos **iniciados** antes de `warmup`, pero esos casos existen: ocupan recursos,
  hacen cola y afectan a los demás. Un caso iniciado en `warmup − 1` no cuenta aunque termine
  después. Tampoco aporta directamente a costos ni integrales: `queueLength` y utilización
  integran solo el estado atribuible a la cohorte medida en `[warmup, t_stop]`; la ocupación
  pre-warmup sí puede retrasar indirectamente a esa cohorte. *(prueba: LILA-027, LILA-033)*
- **R-ARR-8 — Replicaciones.** `run.replications = R` corre R veces la misma configuración; la
  replicación `r` (0-indexada) usa streams derivados de `(seed, r, elementId)`. Por KPI se reportan
  `mean`, `sd` (muestral, `n − 1`) y `ci95 = mean ± t(0,975; R−1) · sd / √R`. Con `R = 1` no hay
  `ci95`. Los casos **no** se comparten entre replicaciones: cada una parte del estado vacío.
  *(prueba: LILA-027)*
- **R-ARR-9 — Agregado público multi-réplica.** En `simulate()`, cada campo numérico top-level es
  la media del mismo campo agregado por replicación; no es la primera replicación ni una muestra
  agrupada de todos los casos. En una corrida completa coincide con el `mean` del mismo path en
  `replications.kpis`. *(prueba: LILA-029; decisión: ADR-024)*
- **R-ARR-10 — Cancelación cooperativa.** `opts.signal` se comprueba entre eventos y entre
  replicaciones. El resultado parcial lleva `cancelled: true` y `completedReplications`; el
  top-level conserva la réplica parcial, pero `replications.kpis` solo usa replicaciones completas
  y se omite si hay menos de dos. Cada evento DES se cierra atómicamente: una señal activada desde
  `onEvent` surte efecto antes del siguiente evento, no entre completar una tarea y recorrer sus
  flujos salientes instantáneos. *(prueba: LILA-029)*

---

## 11. Recursos

`scenario.resources[pool] = { name, type: "role"|"equipment", capacity, costPerHour, fixedCost,
calendar }`. En la tarea: `resources: [{ ref, quantity }]` y `selection: "and" | "or"`.

- **R-REC-1 — Pool con capacidad entera.** `capacity` es obligatorio y es un entero `≥ 1`, **o** la
  lista de tramos `[{ calendar, capacity }]` de R-CAL-11, en la que cada `capacity_i` es a su vez un
  entero `≥ 1` y la capacidad del pool varía con el reloj. Un pool es un contador de unidades
  idénticas: no hay identidad individual de recurso en v1 (el event log registra el **pool**, no la
  unidad), y eso no cambia con la capacidad variable —lo que varía es cuántas unidades hay, no
  cuáles—. Fuera de R-CAL-11 el resto de esta sección lee `capacity` por un único camino y no
  distingue las dos formas. *(prueba: LILA-033, LILA-164)*
- **R-REC-2 — Defaults de la asignación.** `quantity` ausente vale 1. `selection` ausente vale
  `"and"`. Con un solo pool, `and` y `or` son equivalentes. `quantity > capacity` del pool es error
  `E-REC-CANTIDAD` citando tarea y pool (esperaría para siempre); con capacidad por intervalos el
  tope es el **máximo de la semana**, no la suma de los tramos (R-CAL-11). Una `ref` a un pool inexistente es
  error `E-REC-DESCONOCIDO`, un pool repetido en la misma tarea es `E-REC-DUPLICADO` y una
  `capacity` que no sea entero ≥ 1 es `E-REC-CAPACIDAD`. Los cuatro se comprueban en un preflight
  **antes de cualquier callback público**: una corrida no puede emitir filas ni progreso y fallar
  después. Desde LILA-034 múltiples pools con selección ausente o `"and"` son válidos y desde
  LILA-035 también lo es `"or"`. `quantity > capacity` es error también en una alternativa OR: la
  alternativa nunca podría arrancar y el escenario está mal declarado aunque otra sí quepa.
  *(prueba: LILA-013, LILA-033, LILA-034, LILA-035, LILA-042)*
- **R-REC-3 — Cola FIFO por instante de habilitación.** Cada pool tiene una cola ordenada por
  `(enabled, seq)` ascendente, donde `seq` es el contador monótono del evento que habilitó al token.
  Como `seq` es único, el orden es total y determinista: **no hay empates reales**.
  *(prueba: LILA-033, LILA-023)*
- **R-REC-4 — Selección AND: atómica, sin retención parcial.** La tarea entra en la cola de todos
  sus pools. Arranca cuando **todos** ellos tienen simultáneamente `quantity` unidades libres; en
  ese instante se descuentan todas de golpe. Nunca se retiene un recurso mientras se espera otro,
  así que **no puede haber deadlock**. Las filas y `assignments` conservan el orden declarado en
  el escenario aunque el índice interno use todos los pools. *(prueba: LILA-034)*
- **R-REC-5 — FIFO con salto en la asignación AND.** En cada liberación se recorre la cola en orden
  FIFO global `(enabled, seq)` y arranca el **primer candidato satisfacible**; un candidato que no
  puede arrancar no bloquea a los que van detrás. Es una desviación deliberada del FIFO estricto:
  sin ella, un candidato multi-pool bloqueado congelaría el pool entero. El salto es **entre
  firmas de requisitos distintas**: todas las solicitudes que piden un único pool comparten una sola
  cola FIFO por pool, así que una cabeza single-pool que no cabe sí bloquea a las que van detrás en
  ese mismo pool, aunque pidan menos unidades (ADR-026). *(prueba: LILA-034, LILA-033)*
- **R-REC-6 — Selección OR.** La tarea se encola en **todos** los pools alternativos y arranca con
  el primero que tenga `quantity` unidades libres; al arrancar se retira de las demás colas y solo
  ocupa unidades del pool elegido. Cada alternativa entra en la cola FIFO de su pool con el **mismo**
  `(enabled, seq)`, así que OR, AND y single-pool compiten en igualdad en cada pool (R-REC-5).
  **Desempate**: cuando en el mismo instante hay varias alternativas libres, gana la que aparece
  **primero en el array `resources`** de la tarea (orden de documento del escenario). Es la única
  regla: da igual por qué liberación llegó la disponibilidad, porque todas las liberaciones de un
  mismo instante se aplican antes de planificar. El pool efectivamente usado se registra en
  `resourceId` del event log y una OR produce **exactamente una** fila de asignación (R-REC-11);
  sus costos son los del pool usado. *(prueba: LILA-035)*
- **R-REC-7 — Ocupación y liberación.** Las unidades se ocupan en `started` y se liberan en `ended`
  (o al morir el caso, R-EVT-5). No hay apropiación (`preempt` es campo reservado, §15) ni
  prioridades: una tarea empezada nunca se interrumpe salvo por `terminate`. *(prueba: LILA-033)*
- **R-REC-8 — Espera por recurso.** `resourceWait = started − enabled − offHoursWait[enabled,
  started]`. Sin calendarios, `offHoursWait = 0` y queda la definición de la sección 6 del documento
  de estructura: `resourceWait = started − enabled`. *(prueba: LILA-036, LILA-041)*
- **R-REC-9 — Un mismo pool no se pide dos veces.** Dos entradas con la misma `ref` en una tarea es
  error `E-REC-DUPLICADO`: la cantidad se expresa con `quantity`. *(prueba: LILA-013)*
- **R-REC-10 — Elementos sin recursos.** `start`, `end`, `terminate`, gateways y `timer` nunca
  consumen recursos. Solo `task` (y por tanto `callActivity`) admite `resources`.
  *(prueba: LILA-021, LILA-026)*
- **R-REC-11 — Filas por asignación.** Cada asignación efectiva de pool produce una fila plana con
  `resourceId` y `resourceQuantity`; una actividad sin pool produce exactamente una fila sentinel
  con `resourceId`, `resourceQuantity` y `allocationIndex` en `null`. Una actividad AND/OR que se cierra mientras aún espera
  también emite una sola sentinel, porque todavía no existe asignación; una vez iniciada emite sus
  asignaciones efectivas. Las filas se agrupan por `activityInstanceId`, nunca mediante un array
  anidado. Métricas de actividad y caso deduplican por `(replication, activityInstanceId)`; costos y
  ocupación de recurso sí se suman por fila. *(decisión: ADR-025; prueba: LILA-033, LILA-034,
  LILA-037)*

---

## 12. Calendarios (ADR-016)

Bizagi no documenta su semántica de calendarios; esta es la de Lila, ajustable si alguien aporta el
comportamiento real de L-Sim/Bizagi.

`scenario.calendars[nombre] = { intervals: [{ days: ["MON"…"SUN"], from: "HH:MM", to: "HH:MM" }] }`.

- **R-CAL-1 — Patrón semanal relativo a `run.start`.** Los días y horas se interpretan en el mismo
  offset UTC que `run.start`. No hay DST, no hay festivos, no hay zonas horarias por recurso en v1
  (`timezone` y `holidays` son campos reservados, §15). El patrón se repite indefinidamente.
  *(prueba: LILA-040)*
- **R-CAL-2 — Intervalos.** `from` inclusivo, `to` exclusivo. **`to > from` es obligatorio** (R13 de
  `SCENARIO_FORMAT.md`): ningún intervalo cruza la medianoche, y una ventana nocturna se declara
  como dos intervalos (p. ej. `22:00–24:00` del lunes y `00:00–06:00` del martes). `to` admite
  `"24:00"`, la medianoche del día siguiente, y es el único sitio donde se admite: sin ella el
  formato no sabría decir "hasta el final del día" —el tope de `HH:MM` es `23:59` y `to` es
  exclusivo— y tanto un 24×7 escrito a mano como esa ventana nocturna perderían 60 s cada noche en
  silencio. Los intervalos de un mismo calendario se normalizan uniendo solapes **y adyacencias**,
  así que los dos de la ventana nocturna quedan como uno solo. Un calendario con `intervals: []` es
  error `E-CAL-VACIO` (nunca abriría). *(prueba: LILA-040, LILA-041, LILA-042)*
- **R-CAL-3 — Primitivas.** `isOpen(t)`, `nextOpen(t)` (el propio `t` si ya está abierto) y
  `addWorkingTime(t, d)` (instante en que se han consumido `d` segundos abiertos desde `t`; con
  `d ≤ 0` devuelve `t` tal cual, aunque esté cerrado, y si `d` termina justo al cerrar un intervalo
  devuelve ese cierre). Derivadas: `openTime(a, b)` (segundos abiertos contenidos en `[a, b)`, base
  de `offHoursWait` y de `availableTime`) e `intersect(cal1, cal2)` (calendario de intervalos
  comunes, R-CAL-4). Son las únicas operaciones de calendario del motor: **no hay eventos de
  apertura/cierre en el heap**, la disponibilidad se resuelve al planificar. *(prueba: LILA-040)*
- **R-CAL-4 — Una tarea solo arranca en horario abierto.** `started = nextOpen(instante en que hay
  recursos)`. El calendario aplicable a una tarea es la **intersección** de los calendarios de los
  pools que ocupa (selección AND) o el del pool asignado (selección OR); si además el elemento
  declara `elements[id].calendar`, se intersecta también. Sin recursos, el del elemento; sin
  ninguno, 24×7. Si la intersección queda **vacía** la tarea nunca podría arrancar: es error
  `E-CAL-VACIO` citando la tarea; en selección OR se comprueba **cada alternativa por separado**,
  porque cualquiera de ellas basta para arrancar. La intersección asume que los dos calendarios
  comparten `offset`, que en v1 es global porque sale de `run.start`; si algún día `timezone` por
  recurso deja de ser un campo reservado (§15), habrá que reconciliar los offsets antes de
  intersecar. *(prueba: LILA-041)*
- **R-CAL-5 — El processingTime se pausa y se reanuda.** La duración muestreada se consume **solo**
  en tiempo abierto: `ended = addWorkingTime(started, d)`. Al cerrar el turno la tarea se congela y
  reanuda en la siguiente apertura. Ejemplo normativo: tarea de 2 h que arranca a las 17:30 con
  calendario 9:00–18:00 ⇒ termina a las 10:30 del siguiente día hábil. *(prueba: LILA-040,
  LILA-041)*
- **R-CAL-6 — La unidad de recurso queda reservada desde la concesión y durante el cierre.** La
  unidad se descuenta del pool en el instante en que el planificador la **concede**, no en
  `started`: si la concesión cae en tiempo cerrado, la unidad queda reservada mientras la tarea
  espera a la apertura y **no** se reasigna a otro token. Tampoco se reasigna mientras la tarea
  está pausada fuera de horario. En ninguno de los dos tramos acumula `busyTime` ni costo por
  hora. *(prueba: LILA-041, LILA-036)*
- **R-CAL-7 — `offHoursWait` separado de `resourceWait`.** `offHoursWait` de una fila del log es el
  tiempo **cerrado** contenido en `[enabled, ended]`, sumando el cerrado antes de arrancar y el
  cerrado durante el procesamiento. Ejemplo normativo (el de R-CAL-5): `offHoursWait = 15 h`
  (18:00→09:00) y `resourceWait = 0`. *(prueba: LILA-041)*
- **R-CAL-8 — Identidad de tiempos.** Para toda fila del log:
  `ended − enabled = resourceWait + offHoursWait + processing`, donde `processing` es la duración
  muestreada (tiempo abierto efectivamente trabajado). *(prueba: LILA-036, LILA-041)*
- **R-CAL-9 — Utilización sobre horas disponibles.** Para un pool,
  `utilization = busyTime / Σᵢ (capacityᵢ × openTimeᵢ)`, donde el sumatorio recorre los tramos de
  capacidad del pool (R-CAL-11) y `openTimeᵢ` es el tiempo **abierto** del calendario del tramo `i`
  dentro de la ventana de medida `[warmup, t_stop]`. Con la forma numérica hay un solo tramo y la
  fórmula colapsa en `busyTime / (capacity × availableTime)`, con `availableTime` el tiempo abierto
  del calendario del pool dentro de esa misma ventana (o el tiempo total de la ventana si no tiene
  calendario). La ventana es siempre `[warmup, t_stop]`, **no** la duración declarada del escenario:
  con una corrida que para al agotarse las llegadas (R-ARR-3) las dos difieren y las utilizaciones
  no son las mismas. Bizagi usa la duración declarada en su nivel 4 —y `[warmup, t_stop]` en el
  nivel 3—; la conversión es exacta y está en `docs/BIZAGI_PARITY.md` § D7:
  `util_bizagi = util_lila × ventana_lila / duración_declarada`. Lila **no** cambia de denominador
  por eso. Es la única definición que hace comparables los niveles 3 y 4 de Bizagi.

  La métrica es **atribuible a la cohorte medida**, no un sensor del estado físico del pool:
  `busyTime` excluye por R-ARR-7 los casos nacidos antes del `warmup`, mientras el denominador
  conserva toda la capacidad disponible de `[warmup, t_stop]`. Por ello puede valer 0 aunque un
  caso de calentamiento mantenga ocupado el pool durante toda la ventana; descontar esa ocupación
  del denominador mezclaría cohortes y haría que ya no representase capacidad disponible.

  Tampoco está acotada artificialmente a 1. Con capacidad por turnos, una tarea iniciada antes de
  una bajada sigue ejecutándose por R-CAL-11: el `busyTime` observado puede superar
  `Σᵢ capacityᵢ × openTimeᵢ` y la utilización será `> 1`. Ese exceso es evidencia de trabajo no
  interrumpido sobre la plantilla posterior; el resultado conserva el valor y emite
  `W-UTILIZACION-MAYOR-UNO` por pool. Solo se tolera el ruido de coma flotante de unas pocas ULP
  alrededor de 1 al decidir si emitir el aviso.
  *(prueba: LILA-041, LILA-036, LILA-164, LILA-204)*
- **R-CAL-10 — Matriz recurso × calendario con calendario por defecto.** Cada pool puede declarar
  `calendar`; si no lo hace, usa el calendario llamado `default` si existe, y si no existe, 24×7.
  Una `calendar` que no existe en `calendars` es error citando el pool: `E-REF-DESCONOCIDA` si lo
  caza el lint estático de `validateScenario` (el camino normal, R9 de `SCENARIO_FORMAT.md`) y
  `E-CAL-DESCONOCIDO` si lo caza el guardia de `core/sim.ts`, que no puede importar el validador
  y se defiende solo. Unificar los dos códigos en uno toca `core/`.
  *(prueba: LILA-041, LILA-042)*
- **R-CAL-11 — Capacidad por turno dentro de un mismo pool.** `resources[pool].capacity` admite,
  además del entero, la lista de tramos `[{ calendar, capacity }]` (§ 2.4 y R16 de
  `SCENARIO_FORMAT.md`): 3 enfermeras de día y 1 de noche son **un** pool, no tres. Es el
  «Resources → Calendars → quantity» de Bizagi, el que hace falta para el nivel 4. El contrato
  completo:
  - **Apertura por unión.** El pool está **abierto** cuando lo está **cualquiera** de los
    calendarios de sus tramos. Si los turnos cubren las 24 h el pool es un 24×7 y ninguna tarea que
    lo use tiene `offHoursWait`. Ese calendario-unión es el que entra en la intersección de
    R-CAL-4.
  - **Capacidad en `t` por suma.** La capacidad en el instante `t` es la **suma** de los
    `capacity_i` cuyos `calendar_i` están abiertos en `t`. Dos calendarios que se **solapan suman**
    —a diferencia de los intervalos de un mismo calendario, que se unen (R-CAL-2)—, porque cada
    tramo declara un grupo distinto de unidades del mismo rol: `[{dia, 2}, {24x7, 1}]` son 3
    unidades de día y 1 de noche.
  - **Durante el cierre del pool entero vale la capacidad del primer instante abierto posterior.**
    En un `t` cerrado para todos los tramos la capacidad no es 0 sino la del siguiente
    `nextOpen(t)`. Es lo que conserva R-CAL-6 —la unidad concedida en tiempo cerrado sigue
    reservada, no desaparece bajo los pies del token que espera la apertura— y lo que deja el caso
    de un solo tramo bit a bit igual al de M3, es decir R-DEG-2 intacta.
  - **Cerrar un tramo no interrumpe nada.** Al bajar la capacidad, las tareas en curso **siguen**:
    no hay apropiación (R-REC-7), así que `used` puede quedar temporalmente **por encima** de la
    capacidad del instante hasta que terminen. Lo que la bajada sí impide es **conceder** nuevas
    unidades: hasta que `used` vuelva a caer por debajo de la capacidad del instante no arranca
    nadie más.
  - **Un solo evento de calendario en el heap.** La **subida** de capacidad de un pool variable es
    el único evento de calendario que existe (despierta la cola); una bajada no planifica nada,
    porque no habilita a nadie. El resto de la disponibilidad se sigue resolviendo al planificar
    (R-CAL-3).
  - **Validación.** `capacity` por intervalos y `calendar` del pool son **excluyentes**
    (`E-CAPACIDAD-Y-CALENDARIO`, R16): el calendario ya va en cada tramo. Cada `calendar_i` debe
    existir (R9, `E-REF-DESCONOCIDA` en el lint y `E-CAL-DESCONOCIDO` en el guardia de `core/`,
    igual que R-CAL-10). Cada `capacity_i` es entero `≥ 1` y la lista no puede estar vacía
    (`E-REC-CAPACIDAD`). `quantity` de una tarea se valida contra el **máximo de la semana**, no
    contra la suma declarada: 3 + 1 unidades en turnos disjuntos nunca son 4 simultáneas.
  - **Equivalencia con la forma numérica.** `{ capacity: 3, calendar: "dia" }` y
    `{ capacity: [{ calendar: "dia", capacity: 3 }] }` producen exactamente el mismo resultado; el
    entero es el caso de un solo tramo y no sube `version` (§ 9 de `SCENARIO_FORMAT.md`).
  - **Utilización y costo.** Se reportan **por rol**, no por turno, y el denominador es el de
    R-CAL-9: `busyTime / Σᵢ (capacityᵢ × openTimeᵢ)` sobre `[warmup, t_stop]`.
  *(prueba: LILA-164)*

---

## 13. Costos

- **R-COST-1 — Costo por elemento.** `element.fixedCostTotal = elements[id].fixedCost × completados`
  (solo los completados dentro de la ventana de estadísticas). Se carga en `ended`.
  *(prueba: LILA-036)*
- **R-COST-2 — Costo por recurso.**
  `resource.fixedCost = pool.fixedCost × usos`, donde *usos* es la suma de `quantity` sobre las
  filas del log que ocupan el pool (una tarea que ocupa 2 unidades son 2 usos);
  `resource.unitCost = pool.costPerHour × busyTime / 3600`;
  `resource.totalCost = fixedCost + unitCost`. `busyTime` es tiempo **abierto** ocupado, sumado
  sobre las unidades ocupadas (una tarea que ocupa `quantity = 2` durante 1 h aporta 2 h).
  *(prueba: LILA-036)*
- **R-COST-3 — Costo de una fila del log.**
  `row.cost = row.elementCost + row.resourceCost`. `elementCost` vale el fijo del elemento solo en
  la primera fila de la instancia (orden del array `resources`) y 0 en las demás; para el sentinel
  es el fijo del elemento. `resourceCost = pool.fixedCost × quantity + pool.costPerHour × quantity
  × busyTime_fila / 3600` si el pool llegó a ocuparse, y 0 mientras siguió en cola. Así el fijo del
  elemento no se duplica en AND y cada componente es reconstruible. *(decisión: ADR-025; prueba:
  LILA-037, LILA-036)*
- **R-COST-4 — Costo por caso y total.** `costo(caso) = Σ row.cost de sus filas`;
  `process.costPerCase` = media sobre los casos **completados** de la ventana;
  `process.totalCost = Σ row.cost` de todas las filas de la ventana, incluidas las parciales de
  casos en vuelo. `element.fixedCostTotal = Σ row.elementCost`, no `Σ row.cost`. De ahí sale la identidad verificable
  `totalCost = Σ fijo × usos + Σ porHora × horas ocupadas`. *(prueba: LILA-036)*
- **R-COST-5 — Costos ausentes.** `fixedCost` y `costPerHour` ausentes valen 0. Costos negativos los
  rechaza el esquema. *(prueba: LILA-013)*
- **R-COST-6 — Nada de costo por espera.** En v1 esperar no cuesta: un recurso ocioso o una cola no
  generan costo. *(prueba: LILA-036)*

---

## 14. Degradación

El motor no tiene “niveles”: el escenario que no dice algo obtiene el comportamiento neutro. Es lo
que hace que el mismo modelo sirva de nivel 1 a nivel 4 de Bizagi.

- **R-DEG-1 — Sin `resources` en el escenario ⇒ capacidad infinita.** Ninguna tarea espera; toda
  `resourceWait` es 0; no hay tablas de recurso ni costos por hora. El resultado debe ser
  **idéntico bit a bit** al del mismo escenario corrido por el motor de M1. *(prueba: LILA-039)*
- **R-DEG-2 — Sin `calendars` ⇒ 24×7.** `isOpen` siempre verdadero, `offHoursWait = 0`,
  `availableTime` = duración de la ventana. El resultado debe ser **idéntico bit a bit** al del
  mismo escenario corrido por el motor de M2. *(prueba: LILA-043)*
- **R-DEG-3 — Sin `processingTime` en una tarea ⇒ duración 0** más aviso `W-TAREA-SIN-TIEMPO`
  citando el id. La tarea sigue ocupando recursos durante 0 segundos. Si el escenario no declara
  **ningún** `processingTime` —validación de rutas, como el nivel 1 de Bizagi— el aviso es **uno
  solo** que lista los ids: un aviso por tarea ahí es ruido por diseño, no un olvido concreto.
  *(prueba: LILA-042, LILA-198)*
- **R-DEG-4 — Sin `probability` ⇒ §6 y §7.** Sin `warmup` ⇒ 0. Sin `replications` ⇒ 1. Sin `seed` ⇒
  `seed = 1` y aviso `W-SIN-SEED`: la corrida sigue siendo determinista y reproducible, pero el
  escenario no dice con qué semilla. Por eso `run.seed` **no** lleva default en el esquema: con
  default no se podría distinguir "no declarada" de "declarada en 1"; el 1 lo aplica el motor.
  *(prueba: LILA-013, LILA-030, LILA-198)*
- **R-DEG-5 — La degradación nunca inventa.** Ningún default introduce esperas, costos ni
  variabilidad: todos son el elemento neutro de su operación. *(prueba: LILA-039, LILA-043)*

---

## 15. Campos reservados

El esquema del escenario los **acepta** (para que un archivo escrito hoy siga validando mañana) pero
el motor los **rechaza** con error claro mientras no estén implementados (ADR-015, LILA-013).

- **R-RES-1 — Lista v1:** `priority`, `preempt`, `batch`, `conditions` (sección 6 del documento de
  estructura) más `holidays` y `timezone` en `calendars` (ADR-016, LILA-013).
  *(prueba: LILA-013)*
- **R-RES-2 — Texto exacto del error.**

  ```
  {ruta}: campo reservado, no soportado por el simulador en v1.
  ```

  `{ruta}` es la ruta JSON del campo desde la raíz del escenario **resuelto**, con el id del
  elemento o del pool. Ejemplos literales:

  ```
  elements.Task_TomarPedido.priority: campo reservado, no soportado por el simulador en v1.
  resources.cajero.preempt: campo reservado, no soportado por el simulador en v1.
  calendars.oficina.holidays: campo reservado, no soportado por el simulador en v1.
  ```

  Código `E-RESERVADO`. *(prueba: LILA-013)*
- **R-RES-3 — Se rechaza en `resolveScenario`, no en `simulate`.** El error aparece antes de correr
  y aborta; nunca se ignora en silencio. Un campo reservado presente pero con valor `null` (borrado
  por `extends`) **no** dispara el error. *(prueba: LILA-013, LILA-014)*
- **R-RES-4 — Campos desconocidos.** Una clave no reconocida por el esquema y que no está en la
  lista de reservados es error de esquema `E-CLAVE-DESCONOCIDA` (el esquema es cerrado): protege
  contra erratas silenciosas del tipo `capacty: 3`. *(prueba: LILA-013, LILA-198)*

---

## 16. Determinismo (ADR-017)

- **R-DET-1 — Dos fuentes de orden, ambas explícitas.** El orden de eventos es `(t, seq)` (R-TOK-3)
  y el orden de colas es `(enabled, seq)` (R-REC-3). No hay ninguna estructura iterada por orden de
  inserción de un `Map` ni por orden alfabético de ids en el camino de una decisión.
  *(prueba: LILA-030, LILA-023)*
- **R-DET-2 — Un stream por elemento.** El PRNG (mulberry32/xoshiro) se siembra con
  `hash(seed, replication, elementId)`. Cada elemento consume **solo** su stream: `interTriggerTimer`
  del `start`, `processingTime` de la tarea o el timer, los sorteos de ramaje del gateway.
  *(prueba: LILA-024)*
- **R-DET-3 — Common random numbers.** Consecuencia de R-DET-2: añadir un cajero (o cambiar una
  capacidad, un costo o un calendario) **no cambia** la secuencia de números de los elementos no
  tocados, así que un what-if se lee limpio. Es un requisito, no un efecto colateral.
  *(prueba: LILA-024, LILA-038)*
- **R-DET-4 — Consumo estable de uniformes.** Las distribuciones cerradas consumen un número fijo de
  uniformes por muestra; `normal` y `truncatedNormal` usan Box-Muller **sin cachear** el segundo
  valor (2 uniformes por muestra siempre). Las de rechazo (`gamma`, `beta`, `poisson`, `binomial`)
  consumen un número variable: eso solo desalinea el stream **de ese elemento**, nunca el de otro.
  *(prueba: LILA-025, LILA-024)*
- **R-DET-5 — Nunca `Math.random` ni `Date`.** Ni en `core/`, ni en la CLI, ni en el Worker. El
  `RunResult` no contiene marcas de tiempo de reloj real. *(prueba: LILA-032, LILA-030)*
- **R-DET-6 — Garantía de bytes.** Con la misma semilla y la misma entrada, `lila run --json`
  produce **bytes idénticos** dentro de una misma plataforma y arquitectura, en Node 22 y 24. La
  igualdad de bytes **no cruza arquitecturas**: `Math.log`, `Math.exp`, `Math.cos` y `Math.pow` no
  están correctamente redondeadas y difieren en el último bit entre, por ejemplo, `linux/x64` y
  `darwin/arm64` (solo `Math.sqrt` lo está, por el ISA). En nivel 1 y 2 esa deriva se cancela
  —`processing` es una diferencia de dos instantes desplazados por igual— y los goldens de M1
  coinciden byte a byte en las dos; en nivel 3 no, porque `resourceWait` resta el instante de un
  caso al de otro: un ULP en el reloj de llegadas sobrevive hasta `resourceWait.total`. Por eso el
  golden de nivel 3 (`test/golden/pedido-nivel3.seed-42.json`) lleva los bytes de la plataforma del
  CI, `linux/x64`, se compara byte a byte cuando `process.env.CI` está definido, y con tolerancia
  relativa `1e-9` fuera de él. Entre navegadores la igualdad también es solo estadística.
  *(prueba: LILA-030, LILA-043)*
- **R-DET-7 — Distribuciones.** Las 14 con parámetros nombrados y en segundos: `constant{value}`,
  `uniform{min,max}`, `triangular{min,mode,max}`, `exponential{mean}`, `normal{mean,sd}` (truncada a
  `≥ 0`; aviso `W-NORMAL-NEGATIVA` si `P(x<0) > 1 %`), `truncatedNormal{mean,sd,min,max}`,
  `lognormal{mean,sd}` (media y desviación **de la variable**, no de su logaritmo),
  `gamma{shape,scale}`, `erlang{k,mean}`, `weibull{shape,scale}`, `beta{alpha,beta,min,max}`,
  `poisson{mean}`, `binomial{n,p}`, `user{points:[{value,probability}]}` (empírica discreta,
  probabilidades normalizadas con aviso si no suman 1). Toda muestra de duración se trunca a `≥ 0`.
  *(prueba: LILA-025)*

---

## 17. Catálogo de errores y avisos

Errores (abortan; `validate` los devuelve en `errors[]`, la CLI sale con 1):

| Código | Cuándo |
|---|---|
| `E-NOSOP` | elemento fuera del perfil (§3, texto exacto en R-NOSOP-1/2) |
| `E-PARSE-INCOMPLETO` | el lector XML descartó parte del modelo (§3, R-NOSOP-6) |
| `E-FLUJO-COLGANTE` | sequence flow sin origen o sin destino |
| `E-ID-DUPLICADO` | dos elementos con el mismo `id` |
| `E-GATEWAY-SIN-ARISTAS` | gateway sin entradas o sin salidas |
| `E-INALCANZABLE` | nodo no alcanzable desde ningún `start` |
| `E-SIN-START` / `E-SIN-END` | proceso sin start, o sin `end` ni `terminate` |
| `E-ELEMENTO-DESCONOCIDO` | clave de `elements` que no existe en el IR |
| `E-CLAVE-DESCONOCIDA` | clave no reconocida por el esquema |
| `E-PROB-RANGO` | `probability` fuera de `[0,1]` |
| `E-PROB-EN-NODO` | `probability` declarada en un nodo |
| `E-XOR-SUMA-CERO` | XOR cuyas probabilidades suman 0 |
| `E-SUBPROC-PARAMETRO` | `processingTime`/`resources`/`fixedCost` en un subproceso embebido |
| `E-TIMER-RECURSO` | `resources` en un `timer` |
| `E-REC-DESCONOCIDO` | `ref` a un pool inexistente |
| `E-REC-DUPLICADO` | el mismo pool dos veces en una tarea |
| `E-REC-CANTIDAD` | `quantity` mayor que la `capacity` del pool (con capacidad por intervalos, mayor que el máximo de la semana, R-CAL-11) |
| `E-REC-CAPACIDAD` | `capacity` que no es entero ≥ 1, o lista de tramos vacía (R-REC-1, R-CAL-11) |
| `E-CAPACIDAD-Y-CALENDARIO` | `capacity` por intervalos y `calendar` del pool declarados a la vez (R-CAL-11, R16 de `SCENARIO_FORMAT.md`) |
| `E-REF-DESCONOCIDA` | `calendar` que no existe en `calendars` (lint de `validateScenario`), incluido el de cada tramo de `capacity` |
| `E-CAL-DESCONOCIDO` | lo mismo, cazado por el guardia de `core/sim.ts` (ver R-CAL-10 y R-CAL-11) |
| `E-CAMPO-NO-APLICA` | campo declarado en un elemento que no lo admite (R4, R5, R14) |
| `E-CAL-VACIO` | calendario sin intervalos, o intersección de calendarios vacía (cita la tarea) |
| `E-SIN-PARADA` | ni `run.duration` ni ningún `triggerCount` |
| `E-RESERVADO` | campo reservado (§15, texto exacto en R-RES-2) |

Textos exactos de los dos errores de R-CAL-11 (`packages/engine/src/scenario.ts` para el lint,
`packages/engine/src/core/sim.ts` para el guardia de `core/`, que no puede importar el validador):

```
resources.<pool>.capacity: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.
E-CAPACIDAD-Y-CALENDARIO: <pool>: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.
E-REC-CAPACIDAD: <pool>: capacity debe declarar al menos un tramo.
E-REC-CAPACIDAD: <pool>: capacity debe ser un entero mayor o igual que 1.
```

La primera línea es el `message` del problema que devuelve `validateScenario` (el `code` viaja
aparte, en su propio campo, como en el resto del lint); las tres siguientes son las excepciones de
`core/`, que sí llevan el código dentro del mensaje. El lint estático no emite `E-REC-CAPACIDAD`:
un `capacity` que no es entero ≥ 1 o una lista vacía los rechaza antes el esquema zod con su
mensaje genérico, y `E-REC-CAPACIDAD` es el guardia de `core/` para quien construye el escenario a
mano. Es el único desajuste que queda; ver el párrafo final de esta sección.

Todos los errores de la tabla salen del lint (`validateScenario`) o del validador del IR, salvo
`E-CLAVE-DESCONOCIDA`, que lo caza el esquema cerrado antes del lint: el código va delante del
mensaje en la línea que imprime la CLI, y lo formatea `schemaIssueLines` (LILA-198).

Esos dos son **todos** los textos de `E-REC-CAPACIDAD` que emite `packages/engine/src`. Los dos
guardias internos de `core/calendar.ts` —`compileCapacity` sin tramos y `nextCapacityRise` con un
horario constante— son invariantes de la API de `core/`, inalcanzables desde un escenario (los caza
antes `assertSupportedResourceScenario`, y el segundo solo se llama con horario no constante), así
que lanzan **sin** código de catálogo. Antes lanzaban con `E-REC-CAPACIDAD` y sin pool: dos textos
que esta sección no recogía. La exhaustividad la fija un test (LILA-204).

Avisos (no abortan; viajan en `RunResult.warnings[]`, siempre con el id del elemento implicado y,
cuando se repiten por caso, con un contador agregado en vez de una línea por ocurrencia):

`W-MSGFLOW`, `W-COND`, `W-START-SIN-LLEGADAS`, `W-XOR-RESIDUO-COMPARTIDO`, `W-XOR-NORMALIZADA`,
`W-PROB-IGNORADA`, `W-OR-SIN-PROBABILIDAD`, `W-OR-VACIO`, `W-OR-JOIN-SIN-FORK`, `W-JOIN-BLOQUEADO`,
`W-TIMER-SIN-TIEMPO`, `W-TAREA-SIN-TIEMPO`, `W-NORMAL-NEGATIVA`, `W-USER-NORMALIZADA`,
`W-SIN-SEED`, `W-ELEMENTO-SIN-PARAMETROS`, `W-UTILIZACION-MAYOR-UNO`, `W-PARSE`,
`W-XOR-DEFAULT-ROTO` (`bpmn:default` que apunta a un flujo inexistente: se ignora la marca
`isDefault`, texto exacto en §3 R-NOSOP-6, junto con los tres textos de `W-PARSE`).

`W-START-SIN-LLEGADAS` salta solo cuando el `start` no declara **ni** `interTriggerTimer` **ni**
`triggerCount`: con `triggerCount` a solas hay llegadas (todas en `t = 0`, R-ARR-1) y no hay aviso.

`W-TAREA-SIN-TIEMPO` es la excepción a la línea por elemento: cuando el escenario no declara
**ningún** `processingTime`, el aviso es uno solo y lista los ids de todas las tareas (R-DEG-3,
LILA-198).

Los códigos de este catálogo son los que emite el código de hoy, con dos salvedades declaradas:
`E-REC-CAPACIDAD`, que el lint estático no emite (párrafo de arriba, LILA-164), y el par
`E-REF-DESCONOCIDA` / `E-CAL-DESCONOCIDO`, dos códigos para lo mismo según lo cace el lint o el
guardia de `core/` (unificarlos toca `core/`; ver R-CAL-10).

---

## 18. Regla → ticket que la prueba

| Regla | Qué fija | Ticket que la prueba |
|---|---|---|
| R-DURA-1, R-DURA-2 | segundos; `baseTimeUnit` solo presentación | LILA-013 |
| R-DURA-3 | dinero en `run.currency` | LILA-036 |
| R-DURA-4 | el `id` BPMN es la única clave | LILA-013, LILA-017 |
| R-DURA-5 | `elements` faltante = error, sobrante = aviso | LILA-013, LILA-042 |
| R-DURA-6 | pureza de `simulate` | LILA-029, LILA-032 |
| R-PERF-1 | toda variante de tarea → `task` | LILA-018 |
| R-PERF-2 | XOR convergente = mezcla sin espera | LILA-026 |
| R-PERF-3 | message flow ignorado | LILA-021, LILA-163 |
| R-PERF-4 | `conditionExpression` ignorada | LILA-021, LILA-163 |
| R-PERF-5 | varios starts | LILA-026 |
| R-NOSOP-1 … R-NOSOP-3 | texto exacto y catálogo de no soportados | LILA-021, LILA-163 |
| R-NOSOP-4, R-NOSOP-5 | no degradar; errores estructurales | LILA-021 |
| R-NOSOP-6 | avisos de bpmn-moddle: `E-PARSE-INCOMPLETO` / `W-PARSE` / `W-XOR-DEFAULT-ROTO` | LILA-185, LILA-196 |
| R-PLAN-1, R-PLAN-2, R-PLAN-5 | subproceso embebido aplanado | LILA-019 |
| R-PLAN-3 | subproceso sin tiempo propio | LILA-019 (`E-SUBPROC-PARAMETRO`: LILA-198) |
| R-PLAN-4 | call activity = tarea con tiempo global | LILA-019 |
| R-TOK-1 | reloj en segundos desde `run.start` | LILA-037 |
| R-TOK-2 | caso = conjunto de tokens | LILA-026 |
| R-TOK-3 | heap `(t, seq)` | LILA-023, LILA-030 |
| R-TOK-4 | tránsito instantáneo y `flows.count` | LILA-028 |
| R-TOK-5, R-TOK-6 | `enabled`/`started`/`ended`; identidad y lifecycle parcial | LILA-033, LILA-037 |
| R-XOR-1 … R-XOR-5, R-XOR-7 | XOR: equitativo, residuo al default, normalización, sorteo | LILA-026 (normalización y avisos: LILA-042) |
| R-XOR-6, R-XOR-8 | rango y ubicación de `probability` | LILA-013, LILA-042, LILA-198 |
| R-OR-1 … R-OR-7 | OR fork/join, emparejamiento y loops | LILA-026 |
| R-OR-8 | tokens huérfanos al parar | LILA-026, LILA-028 |
| R-AND-1 … R-AND-6 | AND fork/join, contador `(caso, join)`, loops | LILA-026 |
| R-EVT-1 … R-EVT-2 | timer = retardo sin recurso | LILA-026 (`E-TIMER-RECURSO`: LILA-198) |
| R-EVT-3 | timer 24×7 salvo calendario propio | LILA-041 |
| R-EVT-4 | end consume token; caso termina con 0 tokens | LILA-026, LILA-028 |
| R-EVT-5, R-EVT-6 | terminate | LILA-026 |
| R-ARR-1 … R-ARR-5 | llegadas y parada (`duration` \| `triggerCount`, lo primero) | LILA-026 (`triggerCount` sin timer: LILA-186) |
| R-ARR-6 | llegadas con calendario | LILA-041 |
| R-ARR-7 | warmup | LILA-027 |
| R-ARR-8 | replicaciones e IC 95 % | LILA-027 |
| R-ARR-9, R-ARR-10 | agregado público y cancelación | LILA-029 |
| R-REC-1 … R-REC-3 | pools, defaults y FIFO `(enabled, seq)` | LILA-033 (defaults: LILA-013) |
| R-REC-4, R-REC-5 | AND atómico sin retención parcial; sin deadlock | LILA-034 |
| R-REC-6 | selección OR | LILA-035 |
| R-REC-7 | ocupación/liberación, sin apropiación | LILA-033 |
| R-REC-8 | `resourceWait = started − enabled − offHoursWait` | LILA-036, LILA-041 |
| R-REC-9, R-REC-10 | pool duplicado; qué elementos admiten recursos | LILA-013, LILA-021 |
| R-REC-11 | filas planas por asignación y sentinel sin recurso | LILA-033, LILA-037 |
| R-CAL-1, R-CAL-2, R-CAL-3 | patrón semanal, intervalos (`to > from`, `to` admite `24:00`), primitivas y derivadas | LILA-040 (`24:00`: LILA-041) |
| R-CAL-4 … R-CAL-8 | arranque en horario abierto, pausa/reanudación, `offHoursWait` | LILA-041 (caso 17:30: LILA-040) |
| R-CAL-9 | utilización atribuible a la cohorte sobre horas disponibles; puede superar 1 sin apropiación (`Σᵢ capacityᵢ × openTimeᵢ` en `[warmup, t_stop]`) | LILA-041, LILA-036, LILA-204 (denominador por tramos: LILA-164) |
| R-CAL-10 | matriz recurso × calendario y calendario por defecto | LILA-041, LILA-042 |
| R-CAL-11 | capacidad por turno dentro de un mismo pool (unión, suma, cierre y validación) | LILA-164 |
| R-COST-1 … R-COST-4 | costos por elemento, recurso, fila y caso | LILA-036 (fila del log: LILA-037) |
| R-COST-5, R-COST-6 | costos ausentes = 0; esperar no cuesta | LILA-013, LILA-036 |
| R-DEG-1 | sin recursos ⇒ capacidad infinita, bit a bit igual a M1 | LILA-039 |
| R-DEG-2 | sin calendarios ⇒ 24×7, igual a M2 (bytes en linux/x64; ver R-DET-6) | LILA-043 (motor: LILA-041) |
| R-DEG-3 … R-DEG-5 | defaults neutros | LILA-042, LILA-013 (aviso agregado y `W-SIN-SEED`: LILA-198) |
| R-RES-1 … R-RES-4 | campos reservados y su texto de error | LILA-013 (`null` de `extends`: LILA-014; `E-CLAVE-DESCONOCIDA`: LILA-198) |
| R-DET-1 | orden explícito en eventos y colas | LILA-030, LILA-023 |
| R-DET-2, R-DET-3 | stream por elemento; common random numbers | LILA-024 (what-if: LILA-038) |
| R-DET-4, R-DET-7 | consumo de uniformes y las 14 distribuciones | LILA-025 |
| R-DET-5, R-DET-6 | sin `Math.random`/`Date`; bytes idénticos por plataforma y arquitectura | LILA-032, LILA-030, LILA-043 |
| §2 a §14 en conjunto | paridad con los ejemplos oficiales de Bizagi (niveles 1–4, ±5 %) | LILA-044 |
| §11 + §12 | validación numérica contra M/M/1 y Erlang-C | LILA-050, LILA-011 |

---

## 19. Lo que este documento **no** decide

- Nombres de columna y unidades del `RunResult`, del event log y del CSV: `docs/RESULTS_FORMAT.md`
  (LILA-005) y `docs/BIZAGI_PARITY.md` (LILA-007).
- Forma exacta del JSON del escenario, defaults del esquema y mapeo a BPSim 2.0 / qbp / Bizagi:
  `docs/SCENARIO_FORMAT.md` (LILA-004).
- Namespace `lila:` y política de ids: `docs/BPMN_EXTENSION.md` (LILA-006).
