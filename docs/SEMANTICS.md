# Lila Modeler — Engine semantics v1

> Read this in: [Español](es/SEMANTICS.md)

Status: normative for v1 (milestones M0–M3). Date: 2026-09-03.

This document defines **exactly what the engine does** before a single line of `sim.ts` exists.
It is the source of truth for `packages/engine/src/core/` and for the tests in `test/semantics.test.ts`.
It derives from `LILA_MODELER_ESTRUCTURA.md` sections 3 (Bizagi reference), 4 (ADR-009…023) and 6
(engine design); if anything here contradicted that document, the document wins and this file gets
corrected.

Each rule has a stable identifier (`R-XXX-n`) and the ticket that tests it. The `rule → ticket`
summary is in section 18. Error codes (`E-…`) and warning codes (`W-…`) are in section 17.

Reading conventions: **error** aborts (`validate` returns `errors`, the CLI exits with code 1,
`simulate` does not run); **warning** does not abort and travels in `RunResult.warnings[]`.

---

## 1. Hard rules

Hold throughout the document and throughout the code.

- **R-DURA-1 — Seconds.** Every time value in the scenario and in the `RunResult` is a **seconds**
  number (float64), except `run.start`, which is an ISO-8601 instant with an offset. Distribution
  durations, `warmup`, `duration`, `processingTime`, `interTriggerTimer`, the waits and the event
  log's timestamps are all seconds. *(test: LILA-013)*
- **R-DURA-2 — `baseTimeUnit` is presentation.** `run.baseTimeUnit` (`sec|min|hour|day`) does
  **not** change any calculation: it only changes how the CLI and the UI print numbers
  (`format.ts`). Two scenarios identical except for `baseTimeUnit` produce the same numeric
  `RunResult`. *(test: LILA-013)*
- **R-DURA-3 — Money.** All costs are expressed in `run.currency`. The engine does not convert
  currencies or know exchange rates; `currency` is a label that travels to the result and to the
  CSV. *(test: LILA-036)*
- **R-DURA-4 — The BPMN `id` is the only key.** The keys of `scenario.elements` are BPMN `id`
  attributes (nodes or sequence flows). The **name is never a key** and never disambiguates: two
  elements can share the same name. Ids are preserved throughout the pipeline; foreign ids that
  are not an NCName are sanitized with a reversible map (ADR-012), and the scenario is written
  against the **sanitized** id. *(test: LILA-013, LILA-017)*
- **R-DURA-5 — A missing `elements` entry is an error, an extra one is a warning.** An `elements`
  key that does not exist in the IR produces error `E-ELEMENTO-DESCONOCIDO`, citing the id. An IR
  element with no entry in `elements` takes the degrading defaults (section 14) and produces a
  warning only when the absence changes the semantics (a start with no `interTriggerTimer`).
  *(test: LILA-013, LILA-042)*
- **R-DURA-6 — Purity.** `simulate(ir, scenario, opts)` is a pure function: same arguments, same
  result. It reads no clock, no disk, no network, no `Math.random`, no global variables.
  *(test: LILA-029, LILA-032)*

---

## 2. BPMN profile supported in v1

This is the list from section 3 of the structure document. Everything that appears here has
defined semantics; everything else falls into section 3 of this document.

| BPMN construct | IR type | Semantics |
|---|---|---|
| `bpmn:startEvent` with no trigger (*none*) | `start` | case generator (section 10) |
| `bpmn:startEvent` with `timerEventDefinition` | `start` | case generator, identical to *none* |
| `bpmn:endEvent` with no trigger (*none*) | `end` | consumes the token (§9) |
| `bpmn:endEvent` with `terminateEventDefinition` | `terminate` | kills every token of the case (§9) |
| `bpmn:intermediateCatchEvent` with `timerEventDefinition` | `timer` | delay with no resource (§9) |
| `bpmn:boundaryEvent` interrupting, with a single `timerEventDefinition`, attached to a task and with an outgoing flow | `timer` with `attachedTo` | deadline that cuts the task short (§9) |
| `bpmn:task` and all its variants (`userTask`, `serviceTask`, `sendTask`, `receiveTask`, `manualTask`, `scriptTask`, `businessRuleTask`) | `task` | work with duration and resources (§11) |
| `bpmn:callActivity` | `task` | task with its own duration (§4) |
| `bpmn:subProcess` embedded (`triggeredByEvent="false"`, no markers) | — | flattened (§4) |
| `bpmn:exclusiveGateway` | `xor` | diverging: §6; converging: pass-through merge |
| `bpmn:inclusiveGateway` | `or` | §7 |
| `bpmn:parallelGateway` | `and` | §8 |
| `bpmn:sequenceFlow` (with `isDefault` when the gateway declares it) | `flow` | edge; carries `probability` |
| `bpmn:laneSet` / `bpmn:lane` | `lane` on the node | label only; no effect on the simulation |
| `bpmn:participant` (pools) | — | several pools are flattened into a single token graph |
| `bpmn:documentation`, `bpmn:textAnnotation`, `bpmn:association`, `bpmn:group`, `bpmn:dataObject*`, `bpmn:dataStore*`, `bpmn:*DI` | — | read and preserved, they **do not** affect the simulation |

- **R-PERF-1 — Every task variant is `task`.** The concrete task type changes nothing in the
  engine: only its `processingTime`, its `resources` and its `fixedCost`. *(test: LILA-018)*
- **R-PERF-2 — A converging `xor` gateway (one outgoing flow, several incoming) is a merge with no
  wait**: every token that arrives leaves immediately through the single outgoing flow, with no
  synchronizing and no time consumed. *(test: LILA-026)*
- **R-PERF-3 — `bpmn:messageFlow` does not carry tokens.** Message flows between pools are
  ignored and produce warning `W-MSGFLOW` once per file, citing how many were ignored. Pools are
  simulated as a single graph: a token never "jumps" between pools. *(test: LILA-021, LILA-163)*
- **R-PERF-4 — `conditionExpression` is ignored.** Sequence flow conditions are not evaluated in
  v1: branching is probabilistic, and the scenario's `conditions` (§6.1) route on the flows the
  case already took, not on its data. A flow with a
  `conditionExpression` produces warning `W-COND` citing the flow's id. *(test: LILA-021,
  LILA-163)*
- **R-PERF-5 — Several start events are valid.** Each `start` with `interTriggerTimer` or
  `triggerCount` generates its own arrival stream, with its own `triggerCount` and its own random
  number stream. A `start` with neither of the two generates nothing and produces warning
  `W-START-SIN-LLEGADAS`. *(test: LILA-026, LILA-186)*

---

## 3. Unsupported elements and the exact error text

ADR-021: everything not in section 2 produces an **explicit validation error**, never a silent
failure. The text follows Bizagi's style ("not supported by the simulator").

- **R-NOSOP-1 — Exact message template.** Since LILA-211 the engine speaks two languages: English
  is the default language and Spanish a translation. Both texts are normative, each for its own
  language. Without a name, in `en` and in `es`:

  ```
  {id} ({qname}): {construction} not supported by the simulator.
  ```

  ```
  {id} ({qname}): {construcción} no soportado por el simulador.
  ```

  With a name (`name` non-empty), in `en` and in `es`:

  ```
  {id} ({qname}, "{name}"): {construction} not supported by the simulator.
  ```

  ```
  {id} ({qname}, "{name}"): {construcción} no soportado por el simulador.
  ```

  `{qname}` is the qualified BPMN name (`bpmn:boundaryEvent`). `{construcción}` is exactly the
  text in the table below, in the column for that language. The error code is `E-NOSOP`.
  *(test: LILA-021, LILA-163, LILA-211)*

- **R-NOSOP-2 — Closed catalog of `{construcción}`.** No other text is valid. The `id` is the one
  that travels as data in `ParseResult.unsupported[].construction` (LILA-211); the displayed text
  comes from that language's catalog:

| Detected construct | `id` | `{construction}` (`en`) | `{construcción}` (`es`) |
|---|---|---|---|
| `bpmn:boundaryEvent` other than an interrupting timer with one outgoing flow attached to a task: non-interrupting, message/error/…, on a sub-process, or with no outgoing flow | `boundaryEvent` | `event attached to an activity (boundary event)` | `evento adjunto a actividad (boundary event)` |
| `messageEventDefinition` in any event | `messageEvent` | `message event` | `evento de mensaje` |
| `signalEventDefinition` | `signalEvent` | `signal event` | `evento de señal` |
| `linkEventDefinition` | `linkEvent` | `link event` | `evento de enlace` |
| `errorEventDefinition` | `errorEvent` | `error event` | `evento de error` |
| `escalationEventDefinition` | `escalationEvent` | `escalation event` | `evento de escalamiento` |
| `compensateEventDefinition` | `compensationEvent` | `compensation event` | `evento de compensación` |
| `conditionalEventDefinition` | `conditionalEvent` | `conditional event` | `evento condicional` |
| `cancelEventDefinition` | `cancelEvent` | `cancel event` | `evento de cancelación` |
| `multipleEventDefinition` / `parallelMultipleEventDefinition` | `multipleTriggerEvent` | `event with multiple triggers` | `evento con disparadores múltiples` |
| `bpmn:intermediateThrowEvent` (no trigger or with any) | `intermediateThrowEvent` | `intermediate throw event` | `evento intermedio de lanzamiento` |
| `bpmn:eventBasedGateway` | `eventBasedGateway` | `event-based gateway` | `gateway basado en eventos` |
| `bpmn:complexGateway` | `complexGateway` | `complex gateway` | `gateway complejo` |
| `multiInstanceLoopCharacteristics` | `multiInstanceMarker` | `multi-instance marker` | `marcador de multi-instancia` |
| `standardLoopCharacteristics` | `loopMarker` | `loop marker on the activity` | `marcador de bucle en la actividad` |
| `bpmn:transaction` | `transactionSubProcess` | `transaction subprocess` | `subproceso transaccional` |
| `bpmn:adHocSubProcess` | `adHocSubProcess` | `ad-hoc subprocess` | `subproceso ad-hoc` |
| `bpmn:subProcess` with `triggeredByEvent="true"` | `eventSubProcess` | `event subprocess` | `subproceso de eventos` |
| `bpmn:choreographyTask`, `bpmn:choreography`, `bpmn:globalChoreographyTask` | `choreographyDiagram` | `choreography diagram` | `diagrama de coreografía` |
| `bpmn:conversation`, `bpmn:callConversation`, `bpmn:subConversation` | `conversationDiagram` | `conversation diagram` | `diagrama de conversación` |
| `startQuantity` other than 1 | `startQuantity` | `startQuantity attribute other than 1` | `atributo startQuantity distinto de 1` |
| `completionQuantity` other than 1 | `completionQuantity` | `completionQuantity attribute other than 1` | `atributo completionQuantity distinto de 1` |
| `bpmn:endEvent` with a trigger other than *none* or `terminate` | `endEventTrigger` | `end event with that trigger` | `evento de fin con ese disparador` |
| `bpmn:startEvent` with a trigger other than *none* or `timer` | `startEventTrigger` | `start event with that trigger` | `evento de inicio con ese disparador` |

  The detail that distinguishes each row of the catalog is preserved from the parser; the fixtures
  that verify the exact text of the 24 rows are part of LILA-163. Row 25 of the catalog,
  `outOfProfile` (`element outside the v1 profile` / `elemento fuera del perfil v1`), is not
  produced by the parser: it is the fallback for hand-built `unsupported` lists.

  Literal example of the message that `validate(ir)` emits, in `en` and in `es`:

  ```
  Boundary_3a1f (bpmn:boundaryEvent, "Vence el plazo"): event attached to an activity (boundary event) not supported by the simulator.
  ```

  ```
  Boundary_3a1f (bpmn:boundaryEvent, "Vence el plazo"): evento adjunto a actividad (boundary event) no soportado por el simulador.
  ```

- **R-NOSOP-3 — One error per element, all elements in a single pass.** `validate(ir)` does not
  stop at the first one: it returns the complete list, ordered by order of appearance in the XML,
  so the user can fix the file in one go. *(test: LILA-021, LILA-163)*
- **R-NOSOP-4 — No silent degradation.** An unsupported element never turns into a `task` with
  duration 0, and it is never "skipped". `simulate()` refuses to run if `validate()` returned at
  least one error. *(test: LILA-021, LILA-045)*
- **R-NOSOP-5 — Structural errors (same treatment, other codes):** a dangling flow
  (`E-FLUJO-COLGANTE`), a duplicate id (`E-ID-DUPLICADO`), a gateway with no outgoing or no
  incoming flows (`E-GATEWAY-SIN-ARISTAS`), a node unreachable from any `start`
  (`E-INALCANZABLE`), a process with no `start` (`E-SIN-START`), a process with neither `end` nor
  `terminate` (`E-SIN-END`). *(test: LILA-021)*
- **R-NOSOP-6 — What the XML reader discards is also an error.** `bpmn-moddle` does not throw when
  it cannot read part of the file: it reports it as a `fromXML` *warning* and moves on. `parseBpmn`
  keeps those warnings as-is in `ir.source.warnings` (moddle's text on a single line, plus the
  affected id and the broken property when moddle gives them), and `validate(ir)` classifies them
  into two, without dropping any:

  - **Error `E-PARSE-INCOMPLETO`** when the warning implies that a node or a flow **of the
    simulated process** was lost: an entire element that moddle discarded for an illegal or
    duplicate `id` (`unparsable content … nested error: illegal ID <X>` / `duplicate ID <X>`) that
    would be a node or a flow under the profile from section 2, or an unresolved reference on a
    topology property (`bpmn:sourceRef`, `bpmn:targetRef`, `bpmn:attachedToRef`,
    `bpmn:flowNodeRef`). Exact text, in `en` and in `es`:

    ```
    {id}: the XML reader discarded model content, which was left incomplete: {aviso}.
    ```

    ```
    {id}: el lector XML descartó contenido del modelo, que quedó incompleto: {aviso}.
    ```

  - **Warning `W-PARSE`** for everything else: unresolved references to constructs the profile
    from section 2 already ignores (`bpmn:messageRef`, `bpmn:dataStoreRef`,
    `bpmn:categoryValueRef`) and types moddle does not know
    (`unparsable content … unknown type <bpmn:LoopCounter>`, typical of Bizagi exports). Also
    whatever gets discarded from the diagram layer (`bpmndi:`, `di:`, `dc:`, `dd:`), whatever gets
    discarded **outside any `bpmn:process`** (`bpmn:message`, `bpmn:signal`, `bpmn:error`,
    `bpmn:category`, `bpmn:participant`, …) and the elements that section 2 reads without
    simulating (`bpmn:dataObject*`, `bpmn:dataStore*`, `bpmn:textAnnotation`, `bpmn:association`,
    `bpmn:group`, `bpmn:documentation`, `bpmn:extensionElements`, `bpmn:laneSet`, `bpmn:lane`),
    even if for an illegal or duplicate id: none of them is a node or a flow of the token graph, so
    losing them removes neither a node nor a flow (from `bpmn:lane` the IR keeps only the name in
    `Node.lane`, which the CLI uses for display). Exact text, in `en` and in `es`:

    ```
    {id}: XML reader notice, with no loss of nodes or flows: {aviso}.
    ```

    ```
    {id}: aviso del lector XML, sin pérdida de nodos ni flujos: {aviso}.
    ```

  - **Warning `W-PARSE`, reference to a missing flow**: an unresolved reference on
    `bpmn:incoming` or `bpmn:outgoing` does not by itself discard anything — the element names a
    flow that is not in the loaded model, and the IR derives `incoming`/`outgoing` from the flows
    that do exist. If that flow was lost, the error comes from whichever warning discarded it, not
    from this one. Exact text, in `en` and in `es`:

    ```
    {id}: the XML reader did not find a flow this element declares; the graph is built without it: {aviso}.
    ```

    ```
    {id}: el lector XML no encontró un flujo que este elemento declara; el grafo se construye sin él: {aviso}.
    ```

  - **Warning `W-PARSE`, warning from another process**: the warnings are for the whole file, and
    the IR is of **one** process (the others travel in `ParseResult.ignoredProcessIds`). Whatever
    was discarded in another `bpmn:process` does not leave the simulated one incomplete, so it
    never aborts, and the warning names which process it comes from. Exact text, in `en` and in
    `es`:

    ```
    {id}: XML reader notice in {proceso}, another process of the file that Lila does not simulate: {aviso}.
    ```

    ```
    {id}: aviso del lector XML en {proceso}, otro proceso del archivo que Lila no simula: {aviso}.
    ```

  - **Warning `W-XOR-DEFAULT-ROTO`**: a `bpmn:default` that points to a flow that does not exist
    discards nothing from the graph; only the `isDefault` mark is lost, and section 6
    (R-XOR-1/R-XOR-2) splits the same way without it. Exact text, in `en` and in `es`:

    ```
    {id}: the declared default flow does not exist; the isDefault mark is ignored and the split follows the rules of a XOR without a default: {aviso}.
    ```

    ```
    {id}: el flujo por defecto declarado no existe; se ignora la marca isDefault y el reparto sigue las reglas del XOR sin default: {aviso}.
    ```

  `{aviso}` is bpmn-moddle's literal message, flattened to a single line. `{id}` is the id of the
  element moddle points to (or the one that appears inside the message) and, if there is none, the
  id of the process; `{proceso}` is the id of the `bpmn:process` where the warning occurred, which
  is located by the absolute position the warning itself gives (`detected line: N column: C`)
  within the `<bpmn:process …>…</bpmn:process>` stretches of the file, so a minified export or one
  with attributes split across several lines is classified the same as an indented one. If a
  warning does not say where it happened, it is attributed to the simulated process: it fails
  closed. A model that lost nodes or flows of the simulated process never validates clean:
  `E-PARSE-INCOMPLETO` aborts and `lila validate` exits with 1. Non-NCName ids do **not** enter
  here: `sanitizeIds` (R-DURA-4, LILA-017/020) rewrites them before they reach moddle. *(test:
  LILA-185, LILA-196)*

---

## 4. Flattening: embedded sub-process and call activity

- **R-PLAN-1 — Embedded sub-process, flattened.** A `bpmn:subProcess` embedded disappears as a
  node. Its incoming flows are reconnected to the internal `start` and the sub-process's outgoing
  flows hang off the internal `end`. Internal nodes keep their `id` and receive `subprocessId` =
  the id of the sub-process that contains them (the innermost one if nested). Flattening is
  recursive. *(test: LILA-019)*
- **R-PLAN-2 — Internal start and end are pass-through.** The `start` and `end` of a flattened
  sub-process consume no time, consume no resources and do not count as cases: they forward the
  token. With several internal `end`s, all of them point to the sub-process's outputs.
  *(test: LILA-019)*
- **R-PLAN-3 — The sub-process has no time of its own.**
  `elements[subProcessId].processingTime` (or `resources`, or `fixedCost`) is error
  `E-SUBPROC-PARAMETRO` citing the id: the sub-process's time is the sum of what happens inside
  it. Per-sub-process metrics are aggregated from `subprocessId`. The lint catches this even
  though the sub-process is no longer a node of the IR: its nodes cite where they come from
  (`ProcessIR.nodes[x].subprocessId`). **Known limitation**: that field only keeps the *immediate*
  sub-process, so with nested sub-processes the lint recognizes only the innermost one; declaring
  parameters on an outer one today comes out as `E-ELEMENTO-DESCONOCIDO`. Closing that gap
  requires carrying the full chain into the IR (`bpmn/parse.ts`), which is a separate ticket.
  *(test: LILA-019, LILA-198)*
- **R-PLAN-4 — Call activity = task with its own duration.** A `bpmn:callActivity` is translated
  to `task` and the called process is **not** expanded, even if it is present in the file. Its
  duration is its `processingTime`, and it can have resources and `fixedCost` like any task. It
  is Bizagi's rule for reusable sub-processes. *(test: LILA-019)*
- **R-PLAN-5 — Flattening does not change the numbers.** A process with an embedded sub-process
  and the same process flattened by hand produce the same `RunResult`, except for the ids of the
  internal nodes. *(test: LILA-019)*

---

## 5. Case, tokens and clock

- **R-TOK-1 — Clock.** Simulation time is a `float64` in seconds since `run.start`, which is 0.
  The event log's ISO instants are derived on export by adding seconds to `run.start`.
  *(test: LILA-037)*
- **R-TOK-2 — A case is a set of tokens.** A case is born with one token at its `start`. Gateways
  create and destroy tokens. The case **ends** at the instant its number of tokens reaches 0 (or
  through `terminate`, §9). `caseId` is a monotonic integer per run, assigned in arrival order.
  *(test: LILA-026)*
- **R-TOK-3 — Event order.** The heap orders by `(t, seq)`, with `seq` a monotonically increasing
  counter assigned at insertion time. At equal `t`, the event inserted first comes out first.
  There is no other tie-break criterion anywhere in the engine. *(test: LILA-023, LILA-030)*
- **R-TOK-4 — Transit through flows is instantaneous.** Traversing a `sequenceFlow` takes 0
  seconds and increments `flows[id].count`. Gateways take 0 seconds. *(test: LILA-028)*
- **R-TOK-5 — Instants per token and task.** `enabled` = the instant the token reaches the node;
  `started` = the instant the duration starts being consumed; `ended` = the instant it finishes.
  For nodes with neither resource nor calendar, `enabled = started`. *(test: LILA-033, LILA-036)*
- **R-TOK-6 — Activity identity and lifecycle.** Every entry into a task or timer creates an
  opaque `activityInstanceId`, unique within the replication and derived from a counter. All the
  pool assignments of that occurrence share the id and the same instants. On normal closure,
  `status = "completed"` is emitted; `terminate` emits `status = "terminated"`, an interrupting
  boundary timer emits `status = "interrupted"` (§9, R-BND-5), and a stop or cancellation emits
  `status = "inFlight"`. In the last two, `startedAt = null` distinguishes an
  instance that was still queued from one already started, and `endedAt = null`; `observedUntil`
  fixes the cutoff. *(decision: ADR-025; test: LILA-033, LILA-037)*

---

## 6. Exclusive gateway (XOR), diverging

Let an `xor` have outgoing flows `f1…fn` in **document order** (the order of `bpmn:outgoing` in
the XML, preserved in `ir.nodes[g].outgoing`), and let `p(fi)` be the `probability` declared in
`scenario.elements[fi]`.

- **R-XOR-1 — With no probabilities, an even split.** If no `fi` declares `probability`, each one
  receives `1/n` (`isDefault` included). *(test: LILA-026)*
- **R-XOR-2 — The remainder goes to the missing flow.** Let `S` be the sum of the declared
  probabilities and `U` the set of flows with no `probability`. If `|U| = 1`, that flow receives
  `max(0, 1 − S)`. This is the normal case for `isDefault`: **the `isDefault` flow receives the
  remainder**. *(test: LILA-026)*
- **R-XOR-3 — Several flows with no probability.** If `|U| ≥ 2`, the remainder `max(0, 1 − S)` is
  split **evenly** among them (`isDefault` receives the same share as the others), and warning
  `W-XOR-RESIDUO-COMPARTIDO` is emitted, citing the gateway's id and the ids in `U`.
  *(test: LILA-026, LILA-042)*
- **R-XOR-4 — Normalization with a warning.** If after R-XOR-1…3 the sum `T` of the gateway's
  probabilities differs from 1 by more than `1e-9`, all of them are divided by `T` and warning
  `W-XOR-NORMALIZADA` is emitted with the gateway's id and the original value of `T`. The
  simulation continues with the normalized probabilities. *(test: LILA-026, LILA-042)*
- **R-XOR-5 — A sum of zero is an error.** If `T = 0` (all declared as 0 and no remainder), it is
  error `E-XOR-SUMA-CERO` citing the gateway: there is no possible route. *(test: LILA-042)*
- **R-XOR-6 — Range.** A `probability` outside `[0, 1]` is rejected by `validateScenario`'s lint
  (`E-PROB-RANGO`), not by the engine. The schema deliberately does **not** bound the range
  (LILA-198): if it did, the flaw would come out as a generic zod error, without the catalog's
  code. *(test: LILA-013, LILA-198)*
- **R-XOR-7 — Draw.** A single uniform `u ∈ [0,1)` is drawn from the **gateway's** stream, and the
  first `fi` such that `u < Σ_{j≤i} p(fj)` is chosen, walking in document order. Due to rounding
  error, if no `fi` satisfies it, the last one with `p > 0` is chosen. One token, one draw, one
  outgoing flow. *(test: LILA-026, LILA-030)*
- **R-XOR-8 — `probability` only on sequence flows.** `probability` on a node is error
  `E-PROB-EN-NODO`; on a flow whose source is neither `xor` nor `or` it is warning
  `W-PROB-IGNORADA`. *(test: LILA-013, LILA-042, LILA-198)*

### 6.1 Routing conditioned on the case's previous outcome (ADR-028)

A flow leaving a **diverging** XOR may declare `conditions: [{ flowTaken, probability }]` instead
of, or on top of, its plain `probability`. It is the minimum needed to merge two branches that
were duplicated only to be told apart again further downstream (the credit card example's denial
pair), without introducing case variables or an expression language.

- **R-COND-1 — Effective declared probability.** When a token reaches a diverging XOR, the
  declared probability of each outgoing flow `fi` is the `probability` of the **first** entry of
  `conditions[fi]` whose `flowTaken` the case has already traversed. If no entry matches — or the
  flow declares no `conditions` — it is the flow's plain `probability`, which may be undefined.
  *(test: E22)*
- **R-COND-2 — The rest is R-XOR-1…5, unchanged.** That effective vector, computed **per case**,
  then goes through the even split, the remainder to the single undeclared flow, the shared
  remainder with `W-XOR-RESIDUO-COMPARTIDO`, the normalization with `W-XOR-NORMALIZADA` and the
  sum-of-zero path exactly as declared probabilities do. There is no separate rule for a
  conditioned gateway. *(test: E22)*
- **R-COND-3 — "Traversed" is a set.** A flow is traversed as soon as **any** token of the case
  was emitted along it (R-TOK-4), warm-up cases included. It is a set, not a count and not a
  stack: a loop does not clear it, and traversing a flow twice is the same as once. *(test: E22)*
- **R-COND-4 — Where it is accepted.** Only on a sequence flow leaving a diverging XOR: on a node
  it is the reserved field of §15 (`E-RESERVADO`, same text as always), and on any other flow it
  is `E-CAMPO-NO-APLICA`. A `flowTaken` that is not a flow of the model is `E-REF-DESCONOCIDA`; a
  `flowTaken` that cannot precede the gateway — it is not reachable walking the IR backwards from
  it — is warning `W-COND-INALCANZABLE`: on any sequential path the condition never applies, but a
  parallel (AND) branch can still traverse the flow, so the warning is a heuristic. A `probability`
  outside `[0, 1]` is `E-PROB-RANGO`, like any other (R-XOR-6). *(test: E22)*
- **R-COND-5 — One draw, same stream.** The gateway still draws a **single** uniform from its own
  stream (R-XOR-7); `conditions` change the weights, never how many random numbers are consumed.
  A scenario that declares no `conditions` therefore produces bit-identical results to one run
  before ADR-028. *(test: E22, golden)*

---

## 7. Inclusive gateway (OR)

- **R-OR-1 — Fork: independent probabilities.** In a diverging `or`, each outgoing flow `fi` is
  drawn **independently** with its own `p(fi)`: one uniform per outgoing flow, drawn from the
  gateway's stream in document order. There is no normalization: the sum can be any value in
  `[0, n]`. *(test: LILA-026)*
- **R-OR-2 — An outgoing flow with no `probability` in an OR is worth 1.** An `or` with no
  probability declared at all behaves like an `and` fork (every branch). Warning
  `W-OR-SIN-PROBABILIDAD` is emitted the first time. *(test: LILA-026)*
- **R-OR-3 — At least one outgoing flow.** If all `n` draws fail, the `isDefault` flow is
  activated; if there is no `isDefault`, the one with the highest `p`, tie-broken by document
  order. It is counted and reported as warning `W-OR-VACIO` with the gateway's id and the number
  of times it happened. *(test: LILA-026)*
- **R-OR-4 — Activation record.** When activating `k` outgoing flows, the fork records
  `(case, forkId, activationId, k)` with a monotonic `activationId`, and **marks every emitted
  token** with that `activationId`. Child tokens inherit the mark as they pass through later
  gateways; a token can carry several stacked marks (nested OR forks: they are pushed and popped
  in LIFO order). *(test: LILA-026)*
- **R-OR-5 — Join: waits for those of the matching fork.** A converging `or` counts the tokens
  arriving under `(case, activationId)` of the most recent mark and fires once it has received
  `k` tokens, emitting **one** token through its outgoing flow and popping the mark. It is
  Bizagi/Prosimos's practical semantics, and it is documented as a **simplification**: the engine
  does not evaluate structural reachability (the full OR-join semantics of the BPMN standard)
  because with no evaluable conditions it contributes nothing. *(test: LILA-026)*
- **R-OR-6 — Join with no matching fork = merge.** If a token arrives at a converging `or` with
  no active mark (for example, it comes from an `xor`, or the fork is outside the loop), the join
  behaves as pass-through: every token leaves immediately. Warning `W-OR-JOIN-SIN-FORK` is
  emitted with the join's id. *(test: LILA-026)*
- **R-OR-7 — Reset on a loop.** An `or` join's counter lives in `(case, activationId)`: a new
  turn of the loop generates a new `activationId`, so the previous turn's counter does not
  interfere. *(test: LILA-026)*
- **R-OR-8 — Orphan tokens on stop.** Tokens left waiting at a join when the run ends count as an
  `inFlight` case and trigger warning `W-JOIN-BLOQUEADO` with the join's id and the number of
  affected cases. *(test: LILA-026, LILA-028)*

---

## 8. Parallel gateway (AND)

- **R-AND-1 — Fork.** A diverging `and` emits **one token per outgoing flow**, all at the same
  instant, with no draw. `probability` on the outgoing flows of an `and` is warning
  `W-PROB-IGNORADA`. *(test: LILA-026)*
- **R-AND-2 — Join by counter `(case, join)`.** A converging `and` keeps a counter per
  `(case, joinId)` pair. Every token that arrives increments it and is consumed. When the counter
  reaches the number of **incoming flows** of the join in the IR, one token is emitted through the
  outgoing flow and the counter **resets to 0**. *(test: LILA-026)*
- **R-AND-3 — Loops.** The reset in R-AND-2 is what makes the behavior in cycles correct: the
  second turn counts again from 0 and does not fire with tokens from the previous turn. There is
  no "memory" between turns nor per branch. *(test: LILA-026)*
- **R-AND-4 — The AND join does not distinguish by branch.** Two tokens arriving through the same
  incoming branch (possible in malformed models with cycles) count as two. The engine does not
  correct this; if partial counters remain when the run ends, `W-JOIN-BLOQUEADO` applies.
  *(test: LILA-026)*
- **R-AND-5 — Duration of the parallel section.** With deterministic-duration branches, the
  section `fork → branches → join` lasts exactly the maximum of the branches (there is no
  synchronization cost). *(test: LILA-026)*
- **R-AND-6 — Join with a single incoming flow.** An `and` with one incoming and one outgoing flow
  is pass-through. *(test: LILA-026)*

---

## 9. Timer, end and terminate

- **R-EVT-1 — Timer = delay with no resource.** A `timer` holds the token for
  `elements[id].processingTime` seconds and releases it through its single outgoing flow. **It
  consumes no resources.** Declaring `resources` on a `timer` is error `E-TIMER-RECURSO` citing
  the id. *(test: LILA-026, LILA-198)*
- **R-EVT-2 — Timer with no time.** A `timer` with no `processingTime` delays 0 seconds and
  produces warning `W-TIMER-SIN-TIEMPO`. *(test: LILA-026)*
- **R-EVT-3 — The timer runs 24×7 unless it declares a calendar.** By default the timer's delay
  elapses in clock time (a legal deadline also runs at night). If the element declares
  `elements[id].calendar`, the delay consumes only open time and closed time accumulates in
  `offHoursWait`. *(test: LILA-041)*
- **R-EVT-4 — End consumes the token.** An `end` consumes the token that arrives and does nothing
  else. The case is marked `completed` when **its number of tokens reaches 0**, not when the
  first token touches an `end`. A model with an AND fork and two `end`s ends the case when the
  second token arrives. *(test: LILA-026, LILA-028)*
- **R-EVT-5 — Terminate kills the case.** A `terminate` destroys **every** token of the case, its
  join counters and its OR activation marks, cancels its future events and **immediately releases
  the resources the case had occupied**, charging the hourly cost up to that instant. The case
  counts as `completed` with `endedAt` = that instant. `terminate` does **not** affect other cases
  and does not stop the run. The pending `done` events of the activities it killed are consumed
  without advancing the clock, as in R-BND-9. *(test: LILA-026, #345)*
- **R-EVT-6 — Tasks in progress when a case dies.** The task interrupted by `terminate` counts as
  `started` and not as `completed` on its element; it does not contribute to `processing`
  statistics. *(test: LILA-026, LILA-028)*
- **R-BND-1 — Interrupting boundary timer.** A `bpmn:boundaryEvent` with exactly one
  `timerEventDefinition`, interrupting (`cancelActivity` absent or `true`), attached to a
  supported task — never to an embedded sub-process, which is flattened away (§4) — and with at
  least one outgoing flow, enters the profile as a `timer` node with `attachedTo` = the host's
  id and **no** `incoming`: its token is created by the host, not by a flow. It is reachable
  exactly when its host is, so it is never `E-INALCANZABLE` on its own. Any other boundary event
  stays `E-NOSOP` with construction `boundaryEvent` (§3). *(test: #81)*
- **R-BND-2 — The deadline starts when the host is enabled.** It is measured from the host
  activity's `enabledAt`, not from the instant it acquires its resources: a token queuing for a
  busy pool is already burning its deadline. *(test: #81)*
- **R-BND-3 — Clock time, and its own random stream.** The delay elapses 24×7 unless the boundary
  declares `elements[id].calendar`, exactly like any other timer (R-EVT-3). It is drawn from the
  stream of the **boundary's own** id, so adding a boundary shifts no other element's draws
  (§16). *(test: #81)*
- **R-BND-4 — It only fires while the host activity is open.** If the host already completed, was
  killed by a `terminate` or was cut off by the run's stop, the firing event is discarded when it
  leaves the heap. *(test: #81)*
- **R-BND-5 — What the firing does to the host.** The host activity closes with
  `status = "interrupted"`, `endedAt = null` and `observedUntil` = the firing instant; its
  resource request is released if it had been granted and dropped if it was still queued,
  charging hourly cost up to that instant; the element's `fixedCost` is **not** charged, because
  only a completed activity charges it (§13). The host counts `started` and never `completed`, as
  with `terminate` (R-EVT-6). *(test: #81)*
- **R-BND-6 — The token continues along the boundary.** The boundary counts one `started` and one
  `completed` in the same instant (it consumes no time, like a gateway) and the token leaves
  through its first outgoing flow carrying the OR activation marks the host's token had, so an OR
  join downstream still closes. The boundary emits **no** event-log row of its own. *(test: #81)*
- **R-BND-7 — Tie: the interruption wins.** The firing event is queued **before** the host's
  `done`, so with equal instants `(t, seq)` (R-TOK-3) takes the boundary out first: a deadline
  exactly as long as the task's duration interrupts it. *(test: #81)*
- **R-BND-8 — A boundary with no time never fires.** A boundary with no `processingTime` schedules
  nothing and produces warning `W-BORDE-SIN-TIEMPO`, citing the boundary and its host. *(test:
  #81)*
- **R-BND-9 — A dead firing does not move the clock.** A firing event whose activity is already
  closed is consumed without advancing the clock, so a run without `run.duration` does not
  stretch `stoppedAt` up to a deadline that was never going to fire (R-ARR-3). The host's own
  `done`, left pending after the interruption, is consumed the same way. *(test: #81, #345)*

---

## 10. Arrivals, stop, warm-up and replications

- **R-ARR-1 — One generator per start.** Each `start` with `interTriggerTimer` generates cases.
  The first arrival happens at `t = 0`; the next at `t + sample`, with a new sample of
  `interTriggerTimer` drawn from that `start`'s stream. A `start` with `triggerCount` and
  **without** `interTriggerTimer` is equivalent to the default
  `interTriggerTimer: {"type":"constant","value":0}`, that is, `triggerCount` arrivals at
  `t = 0`: it is what Bizagi's level 1 does, whose configuration is only "activation percentages
  on each outgoing flow of exclusive/inclusive gateways" and "Max. arrival count on the Start
  Event", with no time field to space them out
  (`help.bizagi.com/platform/en/level_1_example.htm`). Only a `start` with neither of the two
  fields generates nothing and warns `W-START-SIN-LLEGADAS`. *(test: LILA-026, LILA-186)*
- **R-ARR-2 — End of generation.** A generator stops emitting when the first of these occurs:
  (a) it has emitted `triggerCount` cases; (b) the instant of the next arrival is `≥ t_stop`.
  *(test: LILA-026)*
- **R-ARR-3 — Stopping the run.** `t_stop = run.duration` if it is defined; otherwise, the run
  ends when the heap empties out. With both defined, whichever happens first wins: an empty heap
  also ends the run before `run.duration`. It is error `E-SIN-PARADA` for there to be neither
  `run.duration` nor any `triggerCount` **on a start** (only a `start` sets up a generator,
  R-ARR-1: a `triggerCount` on an intermediate `timer` is `E-CAMPO-NO-APLICA` and does not count
  as a stop). *(test: LILA-026, LILA-013)*
- **R-ARR-4 — Normative example.** `duration = 3600`, `triggerCount = 10000`, constant arrivals
  every 10 s ⇒ arrivals at `t = 0, 10, …, 3590` ⇒ `started = 360`. *(test: LILA-026)*
- **R-ARR-5 — In flight at stop.** At `t_stop`, pending events are discarded. Cases started but
  not ended count in `started` and **not** in `completed`; `inFlight = started − completed`.
  Their half-finished tasks do not contribute to `processing` or `resourceWait`. It is Bizagi's
  criterion. *(test: LILA-026, LILA-028)*
- **R-ARR-6 — Arrivals with a calendar.** If the `start` declares `calendar`, an arrival that
  falls in closed time is **shifted** to the next open instant (`nextOpen`); it is not lost, and
  several do not pile up at the opening instant unless sampling itself generates them. The
  cadence keeps being measured in clock time. *(test: LILA-041)*
- **R-ARR-7 — Warm-up.** `run.warmup` (seconds since `run.start`) excludes from **all**
  statistics the cases **started** before `warmup`, but those cases exist: they occupy resources,
  they queue and they affect the others. A case started at `warmup − 1` does not count even if it
  finishes afterward. It also does not contribute directly to costs or integrals: `queueLength`
  and utilization integrate only the state attributable to the measured cohort within
  `[warmup, t_stop]`; pre-warmup occupancy can still indirectly delay that cohort.
  *(test: LILA-027, LILA-033)*
- **R-ARR-8 — Replications.** `run.replications = R` runs the same configuration R times; the
  replication `r` (0-indexed) uses streams derived from `(seed, r, elementId)`. Per KPI, `mean`,
  `sd` (sample, `n − 1`) and `ci95 = mean ± t(0.975; R−1) · sd / √R` are reported. With `R = 1`
  there is no `ci95`. Cases are **not** shared between replications: each one starts from empty
  state. *(test: LILA-027)*
- **R-ARR-9 — Public multi-replication aggregate.** In `simulate()`, each top-level numeric field
  is the mean of that same field aggregated per replication; it is not the first replication nor
  a pooled sample of every case. In a full run it matches the `mean` of the same path in
  `replications.kpis`. *(test: LILA-029; decision: ADR-024)*
- **R-ARR-10 — Cooperative cancellation.** `opts.signal` is checked between events and between
  replications. The partial result carries `cancelled: true` and `completedReplications`; the
  top-level result keeps the partial replication, but `replications.kpis` uses only complete
  replications and is omitted if fewer than two are available. Every DES event closes
  atomically: a signal raised from `onEvent` takes effect before the next event, not between
  completing a task and walking its instantaneous outgoing flows. *(test: LILA-029)*

---

## 11. Resources

`scenario.resources[pool] = { name, type: "role"|"equipment", capacity, costPerHour, fixedCost,
calendar }`. On the task: `resources: [{ ref, quantity }]` and `selection: "and" | "or"`.

- **R-REC-1 — Pool with integer capacity.** `capacity` is required and is either an integer
  `≥ 1`, **or** the list of slices `[{ calendar, capacity }]` from R-CAL-11, in which each
  `capacity_i` is itself an integer `≥ 1` and the pool's capacity varies with the clock. A pool is
  a counter of identical units: there is no individual resource identity in v1 (the event log
  records the **pool**, not the unit), and that does not change with variable capacity — what
  varies is how many units there are, not which ones. Outside R-CAL-11, the rest of this section
  reads `capacity` through a single path and does not distinguish the two forms.
  *(test: LILA-033, LILA-164)*
- **R-REC-2 — Assignment defaults.** An absent `quantity` is worth 1. An absent `selection` is
  worth `"and"`. With a single pool, `and` and `or` are equivalent. `quantity > capacity` of the
  pool is error `E-REC-CANTIDAD` citing the task and pool (it would wait forever); with capacity
  by intervals the ceiling is the **week's maximum**, not the sum of the slices (R-CAL-11). A
  `ref` to a nonexistent pool is error `E-REC-DESCONOCIDO`, a pool repeated on the same task is `E-REC-DUPLICADO`, and a `capacity` that is not an integer ≥ 1 is `E-REC-CAPACIDAD`. All four
  are checked in a preflight **before any public callback**: a run cannot emit rows or progress
  and then fail afterward. Since LILA-034, several pools with `selection` absent or `"and"` are
  valid, and since LILA-035 so is `"or"`. `quantity > capacity` is also an error in an OR
  alternative: that alternative could never start, and the scenario is misdeclared even if
  another one does fit. *(test: LILA-013, LILA-033, LILA-034, LILA-035, LILA-042)*
- **R-REC-3 — FIFO queue by enablement instant.** Each pool has a queue ordered by
  `(enabled, seq)` ascending, where `seq` is the monotonic counter of the event that enabled the
  token. Since `seq` is unique, the order is total and deterministic: **there are no real ties**.
  *(test: LILA-033, LILA-023)*
- **R-REC-4 — AND selection: atomic, no partial holding.** The task enters the queue of all its
  pools. It starts when **all** of them simultaneously have `quantity` free units; at that
  instant, all of them are discounted at once. A resource is never held while waiting for
  another, so **deadlock is impossible**. Rows and `assignments` preserve the order declared in
  the scenario even though the internal index uses all pools. *(test: LILA-034)*
- **R-REC-5 — FIFO with skip-ahead in AND assignment.** On every release, the queue is walked in
  global FIFO order `(enabled, seq)` and the **first satisfiable candidate** starts; a candidate
  that cannot start does not block the ones behind it. It is a deliberate deviation from strict
  FIFO: without it, a blocked multi-pool candidate would freeze the entire pool. The skip is
  **between distinct requirement signatures**: every request asking for a single pool shares one
  FIFO queue per pool, so a single-pool head that does not fit does block the ones behind it in
  that same pool, even if they ask for fewer units (ADR-026). *(test: LILA-034, LILA-033)*
- **R-REC-6 — OR selection.** The task queues in **all** the alternative pools and starts with the
  first one that has `quantity` free units; on starting, it withdraws from the other queues and
  occupies units of the chosen pool only. Each alternative enters its pool's FIFO queue with the
  **same** `(enabled, seq)`, so OR, AND and single-pool compete on equal footing in each pool
  (R-REC-5). **Tie-break**: when several alternatives are free at the same instant, the one that
  appears **first in the task's `resources` array** wins (the scenario's document order). It is
  the only rule: it does not matter which release made the availability arrive, because all the
  releases of a given instant are applied before scheduling. The pool actually used is recorded
  in the event log's `resourceId`, and an OR produces **exactly one** assignment row (R-REC-11);
  its costs are those of the pool used. *(test: LILA-035)*
- **R-REC-7 — Occupation and release.** Units are occupied at `started` and released at `ended`
  (or when the case dies, R-EVT-5). There is no preemption (`preempt` is a reserved field, §15)
  and no priorities: a task that has started is never interrupted except by `terminate`.
  *(test: LILA-033)*
- **R-REC-8 — Wait for resource.** `resourceWait = started − enabled − offHoursWait[enabled,
  started]`. With no calendars, `offHoursWait = 0` and the definition matches section 6 of the
  structure document: `resourceWait = started − enabled`. *(test: LILA-036, LILA-041)*
- **R-REC-9 — The same pool is never requested twice.** Two entries with the same `ref` on a task
  is error `E-REC-DUPLICADO`: the amount is expressed with `quantity`. *(test: LILA-013)*
- **R-REC-10 — Elements with no resources.** `start`, `end`, `terminate`, gateways and `timer`
  never consume resources. Only `task` (and therefore `callActivity`) admits `resources`.
  *(test: LILA-021, LILA-026)*
- **R-REC-11 — Rows per assignment.** Every effective pool assignment produces a flat row with
  `resourceId` and `resourceQuantity`; an activity with no pool produces exactly one sentinel row
  with `resourceId`, `resourceQuantity` and `allocationIndex` set to `null`. An AND/OR activity
  that closes while still waiting also emits a single sentinel, because there is no assignment
  yet; once started, it emits its effective assignments. Rows are grouped by
  `activityInstanceId`, never through a nested array. Activity and case metrics deduplicate by
  `(replication, activityInstanceId)`; resource costs and occupancy are indeed summed per row.
  *(decision: ADR-025; test: LILA-033, LILA-034, LILA-037)*

---

## 12. Calendars (ADR-016)

Bizagi does not document its calendar semantics; this one is Lila's, adjustable if someone
contributes L-Sim/Bizagi's real behavior.

`scenario.calendars[name] = { intervals: [{ days: ["MON"…"SUN"], from: "HH:MM", to: "HH:MM" }] }`.

- **R-CAL-1 — Weekly pattern relative to `run.start`.** Days and hours are interpreted in the
  same UTC offset as `run.start`. There is no DST, no holidays, no per-resource time zones in v1
  (`timezone` and `holidays` are reserved fields, §15). The pattern repeats indefinitely.
  *(test: LILA-040)*
- **R-CAL-2 — Intervals.** `from` is inclusive, `to` is exclusive. **`to > from` is required** (R13
  of `SCENARIO_FORMAT.md`): no interval crosses midnight, and a night window is declared as two
  intervals (e.g. `22:00–24:00` on Monday and `00:00–06:00` on Tuesday). `to` accepts `"24:00"`,
  midnight of the following day, and it is the only place it is accepted: without it, the format
  would have no way to say "until the end of the day" — the ceiling of `HH:MM` is `23:59` and
  `to` is exclusive — and both a hand-written 24×7 and that night window would silently lose 60 s
  every night. Intervals within the same calendar are normalized by merging overlaps **and
  adjacencies**, so the two intervals of the night window end up as one. A calendar with
  `intervals: []` is error `E-CAL-VACIO` (it would never open). *(test: LILA-040, LILA-041,
  LILA-042)*
- **R-CAL-3 — Primitives.** `isOpen(t)`, `nextOpen(t)` (`t` itself if already open) and
  `addWorkingTime(t, d)` (the instant at which `d` open seconds since `t` have been consumed;
  with `d ≤ 0` it returns `t` as-is, even if closed, and if `d` finishes exactly when an interval
  closes it returns that closing instant). Derived: `openTime(a, b)` (open seconds contained in
  `[a, b)`, the basis of `offHoursWait` and of `availableTime`) and `intersect(cal1, cal2)`
  (calendar of shared intervals, R-CAL-4). These are the engine's only calendar operations:
  **there are no opening/closing events in the heap**; availability is resolved when scheduling.
  *(test: LILA-040)*
- **R-CAL-4 — A task only starts during open hours.** `started = nextOpen(instant at which
  resources are available)`. The calendar that applies to a task is the **intersection** of the
  calendars of the pools it occupies (AND selection) or that of the assigned pool (OR selection);
  if the element also declares `elements[id].calendar`, that is intersected too. With no
  resources, the element's; with none at all, 24×7. If the intersection is **empty**, the task
  could never start: it is error `E-CAL-VACIO` citing the task; under OR selection, **each
  alternative is checked separately**, because any one of them is enough to start.
  The intersection assumes the two calendars share `offset`, which in v1 is global because it
  comes from `run.start`; if some day a per-resource `timezone` stops being a reserved field
  (§15), the offsets will need to be reconciled before intersecting. *(test: LILA-041)*
- **R-CAL-5 — `processingTime` pauses and resumes.** The sampled duration is consumed **only** in
  open time: `ended = addWorkingTime(started, d)`. When the shift closes, the task freezes and
  resumes at the next opening. Normative example: a 2 h task that starts at 17:30 with a
  9:00–18:00 calendar ⇒ ends at 10:30 the next business day. *(test: LILA-040, LILA-041)*
- **R-CAL-6 — The resource unit stays reserved from the grant and through the closure.** The unit
  is discounted from the pool at the instant the scheduler **grants** it, not at `started`: if
  the grant falls in closed time, the unit stays reserved while the task waits for the opening
  and is **not** reassigned to another token. It is also not reassigned while the task is paused
  outside hours. In neither stretch does it accrue `busyTime` or hourly cost. *(test: LILA-041,
  LILA-036)*
- **R-CAL-7 — `offHoursWait` separate from `resourceWait`.** A log row's `offHoursWait` is the
  **closed** time contained in `[enabled, ended]`, adding the closed time before starting and the
  closed time during processing. Normative example (the one from R-CAL-5): `offHoursWait = 15 h`
  (18:00→09:00) and `resourceWait = 0`. *(test: LILA-041)*
- **R-CAL-8 — Time identity.** For every log row:
  `ended − enabled = resourceWait + offHoursWait + processing`, where `processing` is the sampled
  duration (open time effectively worked). *(test: LILA-036, LILA-041)*
- **R-CAL-9 — Utilization over available hours.** For a pool,
  `utilization = busyTime / Σᵢ (capacityᵢ × openTimeᵢ)`, where the sum runs over the pool's
  capacity slices (R-CAL-11) and `openTimeᵢ` is the **open** time of slice `i`'s calendar within
  the measurement window `[warmup, t_stop]`. With the numeric form there is a single slice and the
  formula collapses to `busyTime / (capacity × availableTime)`, with `availableTime` the open time
  of the pool's calendar within that same window (or the window's total time if it has no
  calendar). The window is always `[warmup, t_stop]`, **not** the scenario's declared duration:
  with a run that stops when arrivals run out (R-ARR-3) the two differ, and utilizations are not
  the same. Bizagi uses the declared duration in its level 4 — and `[warmup, t_stop]` in level
  3 —; the conversion is exact and is in `docs/BIZAGI_PARITY.md` § D7:
  `util_bizagi = util_lila × ventana_lila / duración_declarada`. Lila does **not** change its
  denominator because of that. It is the only definition that makes levels 3 and 4 of Bizagi
  comparable.

  The metric is **attributable to the measured cohort**, not a sensor of the pool's physical
  state: `busyTime` excludes, by R-ARR-7, the cases born before `warmup`, while the denominator
  keeps all the capacity available in `[warmup, t_stop]`. Because of that it can be 0 even if a
  warm-up case keeps the pool busy through the whole window; subtracting that occupancy from the
  denominator would mix cohorts and would make it no longer represent available capacity.

  Nor is it artificially capped at 1. With shift-based capacity, a task started before a
  downshift keeps running under R-CAL-11: the observed `busyTime` can exceed
  `Σᵢ capacityᵢ × openTimeᵢ`, and utilization will be `> 1`. That excess is evidence of
  uninterrupted work carrying over onto the later template; the result keeps the value and emits
  `W-UTILIZACION-MAYOR-UNO` per pool. Only floating-point noise of a few ULPs around 1 is
  tolerated when deciding whether to emit the warning.
  *(test: LILA-041, LILA-036, LILA-164, LILA-204)*
- **R-CAL-10 — Resource × calendar matrix with a default calendar.** Every pool can declare
  `calendar`; if it does not, it uses the calendar named `default` if it exists, and if not,
  24×7. A `calendar` that does not exist in `calendars` is an error citing the pool:
  `E-REF-DESCONOCIDA` if caught by `validateScenario`'s static lint (the normal path, R9 of
  `SCENARIO_FORMAT.md`), and `E-CAL-DESCONOCIDO` if caught by `core/sim.ts`'s guard, which cannot
  import the validator and defends itself alone. Unifying the two codes into one requires
  touching `core/`. *(test: LILA-041, LILA-042)*
- **R-CAL-11 — Shift capacity within a single pool.** `resources[pool].capacity` admits, besides
  the integer, the list of slices `[{ calendar, capacity }]` (§ 2.4 and R16 of
  `SCENARIO_FORMAT.md`): 3 day nurses and 1 night nurse are **one** pool, not three. It is
  Bizagi's "Resources → Calendars → quantity", the piece needed for level 4. The full contract:
  - **Union opening.** The pool is **open** when **any** of its slices' calendars is open. If the
    shifts cover the full 24 h the pool is a 24×7, and no task that uses it has `offHoursWait`.
    That union calendar is the one that enters R-CAL-4's intersection.
  - **Capacity at `t` by sum.** The capacity at instant `t` is the **sum** of the `capacity_i`
    whose `calendar_i` are open at `t`. Two calendars that overlap **add up** — unlike the
    intervals of a single calendar, which merge (R-CAL-2) — because each slice declares a
    distinct group of units of the same role: `[{dia, 2}, {24x7, 1}]` are 3 daytime units and 1
    nighttime unit.
  - **While the whole pool is closed, capacity equals that of the next open instant.** At a `t`
    closed for every slice, capacity is not 0 but that of the following `nextOpen(t)`. This is
    what preserves R-CAL-6 — the unit granted in closed time stays reserved, it does not
    disappear from under the token waiting for the opening — and what leaves the single-slice
    case bit-for-bit identical to M3, i.e. R-DEG-2 intact.
  - **Closing a slice interrupts nothing.** When capacity goes down, tasks in progress
    **continue**: there is no preemption (R-REC-7), so `used` can temporarily sit **above** the
    instant's capacity until they finish. What the downshift does prevent is **granting** new
    units: until `used` falls back below the instant's capacity, no one else starts.
  - **A single calendar event on the heap.** A variable pool's capacity **rise** is the only
    calendar event that exists (it wakes the queue); a drop schedules nothing, because it enables
    no one. The rest of availability is still resolved when scheduling (R-CAL-3).
  - **Validation.** `capacity` by intervals and the pool's `calendar` are **mutually exclusive**
    (`E-CAPACIDAD-Y-CALENDARIO`, R16): the calendar already lives in each slice. Every
    `calendar_i` must exist (R9, `E-REF-DESCONOCIDA` in the lint and `E-CAL-DESCONOCIDO` in the
    `core/` guard, same as R-CAL-10). Every `capacity_i` is an integer `≥ 1`, and the list cannot
    be empty (`E-REC-CAPACIDAD`). A task's `quantity` is validated against the **week's
    maximum**, not against the declared sum: 3 + 1 units in disjoint shifts are never 4
    simultaneous units.
  - **Equivalence with the numeric form.** `{ capacity: 3, calendar: "dia" }` and
    `{ capacity: [{ calendar: "dia", capacity: 3 }] }` produce exactly the same result; the
    integer is the single-slice case and does not bump `version` (§ 9 of `SCENARIO_FORMAT.md`).
  - **Utilization and cost.** These are reported **per role**, not per shift, and the
    denominator is R-CAL-9's: `busyTime / Σᵢ (capacityᵢ × openTimeᵢ)` over `[warmup, t_stop]`.
  *(test: LILA-164)*

---

## 13. Costs

- **R-COST-1 — Cost per element.** `element.fixedCostTotal = elements[id].fixedCost × completed`
  (only those completed within the statistics window). It is charged at `ended`.
  *(test: LILA-036)*
- **R-COST-2 — Cost per resource.**
  `resource.fixedCost = pool.fixedCost × uses`, where *uses* is the sum of `quantity` over the log
  rows that occupy the pool (a task occupying 2 units is 2 uses);
  `resource.unitCost = pool.costPerHour × busyTime / 3600`;
  `resource.totalCost = fixedCost + unitCost`. `busyTime` is **open** time occupied, summed over
  the occupied units (a task occupying `quantity = 2` for 1 h contributes 2 h).
  *(test: LILA-036)*
- **R-COST-3 — Cost of a log row.**
  `row.cost = row.elementCost + row.resourceCost`. `elementCost` is worth the element's fixed
  cost only on the instance's first row (order of the `resources` array) and 0 on the others; for
  the sentinel it is the element's fixed cost. `resourceCost = pool.fixedCost × quantity +
  pool.costPerHour × quantity × busyTime_row / 3600` if the pool was actually occupied, and 0
  while it was still queued. This way the element's fixed cost is not duplicated in AND, and
  every component is reconstructible. *(decision: ADR-025; test: LILA-037, LILA-036)*
- **R-COST-4 — Cost per case and total.** `cost(case) = Σ row.cost of its rows`;
  `process.costPerCase` = mean over the **completed** cases of the window;
  `process.totalCost = Σ row.cost` of all the rows of the window, including partial rows of
  in-flight cases. `element.fixedCostTotal = Σ row.elementCost`, not `Σ row.cost`. From this comes
  the checkable identity `totalCost = Σ fixed × uses + Σ perHour × occupied hours`.
  *(test: LILA-036)*
- **R-COST-5 — Absent costs.** Absent `fixedCost` and `costPerHour` are worth 0. Negative costs
  are rejected by the schema. *(test: LILA-013)*
- **R-COST-6 — No cost for waiting.** In v1, waiting costs nothing: an idle resource or a queue
  generate no cost. *(test: LILA-036)*

---

## 14. Degradation

The engine has no "levels": a scenario that does not say something gets the neutral behavior. It
is what makes the same model serve as Bizagi level 1 through level 4.

- **R-DEG-1 — No `resources` in the scenario ⇒ infinite capacity.** No task waits; every
  `resourceWait` is 0; there are no resource tables or hourly costs. The result must be
  **bit-for-bit identical** to the same scenario run through the M1 engine. *(test: LILA-039)*
- **R-DEG-2 — No `calendars` ⇒ 24×7.** `isOpen` is always true, `offHoursWait = 0`,
  `availableTime` = the window's duration. The result must be **bit-for-bit identical** to the
  same scenario run through the M2 engine. *(test: LILA-043)*
- **R-DEG-3 — No `processingTime` on a task ⇒ duration 0**, plus warning
  `W-TAREA-SIN-TIEMPO` citing the id. The task still occupies resources for 0 seconds. If the
  scenario declares **no** `processingTime` at all — path validation, like Bizagi's level 1 —
  the warning is a **single one** that lists the ids: one warning per task there is noise by
  design, not a specific oversight. *(test: LILA-042, LILA-198)*
- **R-DEG-4 — No `probability` ⇒ §6 and §7.** No `warmup` ⇒ 0. No `replications` ⇒ 1. No `seed` ⇒
  `seed = 1` and warning `W-SIN-SEED`: the run stays deterministic and reproducible, but the
  scenario does not say which seed. That is why `run.seed` carries **no** default in the schema:
  with a default it would be impossible to tell "not declared" from "declared as 1"; the engine
  applies the 1. *(test: LILA-013, LILA-030, LILA-198)*
- **R-DEG-5 — Degradation never invents anything.** No default introduces waits, costs or
  variability: all of them are the neutral element of their operation. *(test: LILA-039,
  LILA-043)*

---

## 15. Reserved fields

The scenario schema **accepts** them (so that a file written today keeps validating tomorrow) but
the engine **rejects** them with a clear error while they are not implemented (ADR-015, LILA-013).

- **R-RES-1 — v1 list:** `priority`, `preempt`, `batch` (section 6 of the structure document)
  plus `holidays` and `timezone` in `calendars` (ADR-016, LILA-013). `conditions` is reserved
  only on elements that are **not** a flow leaving a diverging XOR: there it is implemented
  (§6.1, ADR-028), everywhere else it still raises `E-RESERVADO`. *(test: LILA-013, E22)*
- **R-RES-2 — Exact error text.**

  ```
  {path}: reserved field, not supported by the simulator in v1.
  ```

  `{path}` is the JSON path of the field from the root of the **resolved** scenario, with the id
  of the element or the pool. Literal examples:

  ```
  elements.Task_TomarPedido.priority: reserved field, not supported by the simulator in v1.
  resources.cajero.preempt: reserved field, not supported by the simulator in v1.
  calendars.oficina.holidays: reserved field, not supported by the simulator in v1.
  ```

  Code `E-RESERVADO`. *(test: LILA-013)*
- **R-RES-3 — It is rejected in `resolveScenario`, not in `simulate`.** The error appears before
  running and aborts; it is never silently ignored. A reserved field present but with value
  `null` (cleared out by `extends`) does **not** trigger the error. *(test: LILA-013, LILA-014)*
- **R-RES-4 — Unknown fields.** A key not recognized by the schema, and not on the reserved list,
  is schema error `E-CLAVE-DESCONOCIDA` (the schema is closed): it guards against silent typos
  like `capacty: 3`. The single exception is `__proto__`, `constructor` and `prototype`, which
  the `extends` merge discards before the schema and therefore silently
  (`SCENARIO_FORMAT.md` § 6). *(test: LILA-013, LILA-198; exception: LILA-204)*

---

## 16. Determinism (ADR-017)

- **R-DET-1 — Two sources of order, both explicit.** Event order is `(t, seq)` (R-TOK-3) and
  queue order is `(enabled, seq)` (R-REC-3). There is no structure anywhere in a decision's path
  that is iterated by a `Map`'s insertion order or by alphabetical order of ids.
  *(test: LILA-030, LILA-023)*
- **R-DET-2 — One stream per element.** The PRNG (mulberry32/xoshiro) is seeded with
  `hash(seed, replication, elementId)`. Each element consumes **only** its own stream: the
  `start`'s `interTriggerTimer`, the task's or timer's `processingTime`, the gateway's branching
  draws. *(test: LILA-024)*
- **R-DET-3 — Common random numbers.** A consequence of R-DET-2: adding a cashier (or changing a
  capacity, a cost or a calendar) does **not change** the number sequence of the untouched
  elements, so a what-if reads clean. It is a requirement, not a side effect.
  *(test: LILA-024, LILA-038)*
- **R-DET-4 — Stable uniform consumption.** Closed-form distributions consume a fixed number of
  uniforms per sample; `normal` and `truncatedNormal` use Box-Muller **without caching** the
  second value (2 uniforms per sample, always). The rejection-based ones (`gamma`, `beta`,
  `poisson`, `binomial`) consume a variable number: that only desynchronizes **that element's**
  stream, never another's. *(test: LILA-025, LILA-024)*
- **R-DET-5 — Never `Math.random` nor `Date`.** Not in `core/`, not in the CLI, not in the
  Worker. `RunResult` contains no real-clock timestamps. *(test: LILA-032, LILA-030)*
- **R-DET-6 — Byte guarantee.** With the same seed and the same input, `lila run --json`
  produces **byte-identical** output within a given platform and architecture, on Node 22 and 24.
  Byte equality does **not** cross architectures: `Math.log`, `Math.exp`, `Math.cos` and
  `Math.pow` are not correctly rounded and differ in the last bit between, for example,
  `linux/x64` and `darwin/arm64` (only `Math.sqrt` is, because of the ISA). At levels 1 and 2
  that drift cancels out — `processing` is a difference of two instants shifted equally — and the
  M1 goldens match byte-for-byte on both; at level 3 they do not, because `resourceWait` subtracts
  one case's instant from another's: one ULP in the arrival clock survives all the way to
  `resourceWait.total`. That is why the level 3 golden
  (`test/golden/pedido-nivel3.seed-42.json`) carries the bytes of the CI platform, `linux/x64`,
  is compared byte-for-byte when `process.env.CI` is set, and with relative tolerance `1e-9`
  outside of it. Between browsers, equality is likewise only statistical.
  *(test: LILA-030, LILA-043)*
- **R-DET-7 — Distributions.** The 14, with named parameters and in seconds: `constant{value}`,
  `uniform{min,max}`, `triangular{min,mode,max}`, `exponential{mean}`, `normal{mean,sd}`
  (truncated to `≥ 0`; warning `W-NORMAL-NEGATIVA` if `P(x<0) > 1 %`),
  `truncatedNormal{mean,sd,min,max}`, `lognormal{mean,sd}` (mean and standard deviation **of the
  variable**, not of its logarithm), `gamma{shape,scale}`, `erlang{k,mean}`,
  `weibull{shape,scale}`, `beta{alpha,beta,min,max}`, `poisson{mean}`, `binomial{n,p}`,
  `user{points:[{value,probability}]}` (discrete empirical, probabilities normalized with a
  warning if they do not add up to 1). Every duration sample is truncated to `≥ 0`.
  *(test: LILA-025)*

---

## 17. Error and warning catalog

Since LILA-211 the texts of all these codes live in a catalog per language
(`packages/engine/src/messages/`, with the subset that `core/` needs in
`packages/engine/src/core/messages/`). **English** is the default language and **Spanish** a
translation; both are normative, each for its own language, and this section gives both texts
wherever it fixes them literally. The code (`E-…`, `W-…`) and the rule id (`R-…`) are **never**
translated. A test (`packages/engine/test/messages.test.ts`) keeps this section, the catalog and
the code in sync: the catalog's 59 codes are exactly the ones `packages/engine/src` emits, `en`
and `es` declare the same entries, and no `"CODE: …"` literal lives outside the catalog.

Errors (they abort; `validate` returns them in `errors[]`, the CLI exits with 1):

| Code | When |
|---|---|
| `E-NOSOP` | element outside the profile (§3, exact text in R-NOSOP-1/2) |
| `E-PARSE-INCOMPLETO` | the XML reader discarded part of the model (§3, R-NOSOP-6) |
| `E-FLUJO-COLGANTE` | sequence flow with no source or no target |
| `E-ID-DUPLICADO` | two elements with the same `id` |
| `E-GATEWAY-SIN-ARISTAS` | gateway with no incoming or no outgoing flows |
| `E-INALCANZABLE` | node unreachable from any `start` |
| `E-SIN-START` / `E-SIN-END` | process with no start, or with neither `end` nor `terminate` |
| `E-ELEMENTO-DESCONOCIDO` | `elements` key that does not exist in the IR |
| `E-CLAVE-DESCONOCIDA` | key not recognized by the schema |
| `E-PROB-RANGO` | `probability` outside `[0,1]` |
| `E-PROB-EN-NODO` | `probability` declared on a node |
| `E-XOR-SUMA-CERO` | XOR whose probabilities add up to 0 |
| `E-SUBPROC-PARAMETRO` | `processingTime`/`resources`/`fixedCost` on an embedded sub-process |
| `E-TIMER-RECURSO` | `resources` on a `timer` |
| `E-REC-DESCONOCIDO` | `ref` to a nonexistent pool |
| `E-REC-DUPLICADO` | the same pool twice on a task |
| `E-REC-CANTIDAD` | `quantity` greater than the pool's `capacity` (with capacity by intervals, greater than the week's maximum, R-CAL-11) |
| `E-REC-CAPACIDAD` | `capacity` that is not an integer ≥ 1, or an empty slice list (R-REC-1, R-CAL-11) |
| `E-CAPACIDAD-Y-CALENDARIO` | `capacity` by intervals and the pool's `calendar` declared at the same time (R-CAL-11, R16 of `SCENARIO_FORMAT.md`) |
| `E-REF-DESCONOCIDA` | `calendar` that does not exist in `calendars` (`validateScenario`'s lint), including that of each `capacity` slice |
| `E-CAL-DESCONOCIDO` | the same, caught by `core/sim.ts`'s guard (see R-CAL-10 and R-CAL-11) |
| `E-CAMPO-NO-APLICA` | field declared on an element that does not admit it (R4, R5, R14) |
| `E-CAL-VACIO` | calendar with no intervals, or empty intersection of calendars (cites the task) |
| `E-SIN-PARADA` | neither `run.duration` nor any `triggerCount` |
| `E-RESERVADO` | reserved field (§15, exact text in R-RES-2) |

Exact texts of R-CAL-11's two errors (`packages/engine/src/scenario.ts` for the lint,
`packages/engine/src/core/sim.ts` for `core/`'s guard, which cannot import the validator), in
`en` and in `es`:

```
resources.<pool>.capacity: capacity by intervals and calendar are mutually exclusive; the calendar belongs in each slice.
E-CAPACIDAD-Y-CALENDARIO: <pool>: capacity by intervals and calendar are mutually exclusive; the calendar belongs in each slice.
E-REC-CAPACIDAD: <pool>: capacity must declare at least one slice.
E-REC-CAPACIDAD: <pool>: capacity must be an integer greater than or equal to 1.
```

```
resources.<pool>.capacity: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.
E-CAPACIDAD-Y-CALENDARIO: <pool>: capacity por intervalos y calendar son excluyentes; el calendario va en cada tramo.
E-REC-CAPACIDAD: <pool>: capacity debe declarar al menos un tramo.
E-REC-CAPACIDAD: <pool>: capacity debe ser un entero mayor o igual que 1.
```

The first line is the `message` of the problem returned by `validateScenario` (the `code` travels
separately, in its own field, like the rest of the lint); the next three are `core/`'s
exceptions, which do carry the code inside the message. The static lint does not emit
`E-REC-CAPACIDAD`: a `capacity` that is not an integer ≥ 1, or an empty list, is rejected earlier
by the zod schema with its generic message, and `E-REC-CAPACIDAD` is `core/`'s guard for whoever
builds the scenario by hand. It is the only mismatch that remains; see this section's final
paragraph.

Every error in the table comes from the lint (`validateScenario`) or from the IR validator,
except `E-CLAVE-DESCONOCIDA`, which is caught by the closed schema before the lint: the code goes
ahead of the message on the line the CLI prints, formatted by `schemaIssueLines` (LILA-198).

Those two are **all** the `E-REC-CAPACIDAD` texts that `packages/engine/src` emits. The two
internal guards in `core/calendar.ts` — `compileCapacity` with no slices and
`nextCapacityRise` with a constant schedule — are invariants of `core/`'s API, unreachable from a
scenario (they are caught earlier by `assertSupportedResourceScenario`, and the second is only
called with a non-constant schedule), so they throw **without** a catalog code. They used to
throw with `E-REC-CAPACIDAD` and no pool: two texts this section did not cover. Exhaustiveness is
fixed by a test (LILA-204).

Warnings (they do not abort; they travel in `RunResult.warnings[]`, always with the id of the
element involved and, when they repeat per case, with an aggregated counter instead of one line
per occurrence):

`W-MSGFLOW`, `W-COND`, `W-START-SIN-LLEGADAS`, `W-XOR-RESIDUO-COMPARTIDO`, `W-XOR-NORMALIZADA`,
`W-PROB-IGNORADA`, `W-OR-SIN-PROBABILIDAD`, `W-OR-VACIO`, `W-OR-JOIN-SIN-FORK`, `W-JOIN-BLOQUEADO`,
`W-TIMER-SIN-TIEMPO`, `W-BORDE-SIN-TIEMPO` (boundary timer with no `processingTime`: it never
interrupts its host, R-BND-8), `W-TAREA-SIN-TIEMPO`, `W-NORMAL-NEGATIVA`, `W-USER-NORMALIZADA`,
`W-SIN-SEED`, `W-ELEMENTO-SIN-PARAMETROS`, `W-COND-INALCANZABLE` (a `flowTaken` that cannot
precede its gateway, R-COND-4), `W-UTILIZACION-MAYOR-UNO`, `W-PARSE`,
`W-XOR-DEFAULT-ROTO` (a `bpmn:default` pointing to a nonexistent flow: the `isDefault` mark is
ignored, exact text in §3 R-NOSOP-6, along with the three `W-PARSE` texts), `W-RECURSO-SATURADO`.

`W-RECURSO-SATURADO` warns that a pool never reaches a steady state: more work arrives than it
can dispatch, and its queue grows with the run's duration. Exact text, once per pool and per run:

```
W-RECURSO-SATURADO: <poolId>: the queue grows without settling (λ/μ·c ≈ X)
```

```
W-RECURSO-SATURADO: <poolId>: la cola crece sin estabilizarse (λ/μ·c ≈ X)
```

When the warning fires because of the pool's utilization and not because of ρ (see below), the
same code prints the variant that states the occupancy, so the number shown never contradicts the
sentence:

```
W-RECURSO-SATURADO: <poolId>: the queue grows without settling (utilization ≈ Y %)
```

```
W-RECURSO-SATURADO: <poolId>: la cola crece sin estabilizarse (ocupación ≈ Y %)
```

The signal is **the pool being full**: no free units enough to grant, i.e. fewer available than
the smallest `quantity` any task requests it with — a pool of `capacity` 3 requested two at a
time is full with two units occupied, because no one can take the third. The threshold belongs
to the pool: if another task requests that same pool one at a time, that `quantity` governs, and
then the task requesting two at a time can be blocked without the pool counting as full — the
warning stops firing, it never over-fires. A queued instance is attributed only to the pools that
were full — **clock** time: whoever keeps the unit through the calendar's closure (R-CAL-8) does
not have it free either — for at least half of its wait while the pool was open (its
`resourceWait`, already without the closed calendar time, R-REC-8); with a calendar the threshold
is therefore laxer than in a 24×7 run. That is why an idle pool tied by AND, which inherits the
instance's whole queue (R-REC-4), and a free OR alternative, in whose queue the instance is also
present (R-REC-6), meet the criterion with zero demand: the warning cannot contradict
`resources[poolId].utilization`. An OR also splits its demand among the alternatives that were
indeed full, because it consumes exactly one.

On that attributed demand, `ρ = attributed demand / granted units ≥ 1.1` **or**
`resources[poolId].utilization ≥ 0.9` is required, plus one of
these two: that the attributed queue averaged over the second half of `[warmup, t_stop]` exceeds
the pool's effective capacity (its `Σᵢ capacityᵢ × openTimeᵢ` from R-CAL-9 divided by its own
open hours, i.e. units, not units diluted by the calendar) and is at least 1.5 times that of the
first half; **or** that the attributed instances still queued at the cutoff are at least 25 % of
the granted units **and** the second half's queue is not smaller than the first's — a batch of
simultaneous arrivals (R-ARR-1) leaves a lot pending at the cutoff with the queue **falling**, and
that is work being dispatched, not a lack of steady state. Queues are averaged over the time the
pool was full, which is the only time a pool's queue means anything, and it leaves `offHoursWait`
out without having to subtract it separately. A long stationary queue does not warn: an M/M/1
with ρ = 0.8 has `Lq = 3.2`, and its two halves measure the same.

Utilization is the second door because a **self-gated** pool throttles its own attributed demand:
when most of its tasks sit downstream of another task the same pool serves, the queue upstream is
what keeps the work from arriving, so ρ stalls just under the threshold while the pool is full
95 % of the time and the queue grows run after run. Utilization does not distinguish "right at the
limit" from "twice what it can dispatch", which is why it never decides alone: the growth or
backlog condition above still has to hold. *(test: #320)*

With several replications, the decision is made **once, over the mean** of those quantities, not
replication by replication: saturation is a property of the pool and of the run, and
deduplicating warnings would let a single replication that crosses a threshold by chance decide
for all thirty. `X` is the ρ of that mean, with one decimal; `Y` is the mean utilization as a whole percentage.

It is a warning, not an error: it changes no metric. What it flags is that `resourceWait` and
`bottlenecks` for that pool are numbers that grow with the run's duration and are not comparable
to those of a stable pool. *(test: LILA-191)*

`W-START-SIN-LLEGADAS` fires only when the `start` declares **neither** `interTriggerTimer`
**nor** `triggerCount`: with `triggerCount` alone there are arrivals (all at `t = 0`, R-ARR-1) and
no warning.

`W-TAREA-SIN-TIEMPO` is the exception to the one-line-per-element rule: when the scenario
declares **no** `processingTime` at all, the warning is a single one that lists the ids of every
task (R-DEG-3, LILA-198).

### Internal guards

Eleven codes in the catalog are **not** in the tables above because they are not flaws a model or
a scenario can produce: they are guards of `core/`'s internal API, which only fire when whoever
calls it builds the input by hand and breaks an invariant. They signal a programming error in the
consumer, not something the user can fix in their model, and that is why they are neither in the
user error table nor in the warning list. They are:

| Code | Guard |
|---|---|
| `E-REF-INEXISTENTE` | a node declares an incoming or outgoing flow that is not in the IR (`core/ir.ts`) |
| `E-REC-LIBERACION` | a request with no active assignment is released (`core/resources.ts`) |
| `E-REC-SOLICITUD-DUPLICADA` | the same request id is registered twice (`core/resources.ts`) |
| `E-REC-SIN-ASIGNACION` | a granted request ended up with no pool (`core/resources.ts`) |
| `E-REC-ESTADO` | negative usage on a pool (`core/resources.ts`) |
| `E-REPLICACIONES-INSUFICIENTES` | fewer than 2 values or replications for the 95% CI (`core/replications.ts`) |
| `E-REPLICACIONES-VACIAS` | there are no results to aggregate (`core/run.ts`, `meanRunResults`) |
| `E-KPI-INCONSISTENTE` | two replications with a different set of KPIs (`core/replications.ts`) |
| `E-KPI-NO-FINITO` | a replication's KPI is not finite (`core/replications.ts`) |
| `E-AGREGADO-NO-NUMERICO` | the metrics structure is not averageable (`core/run.ts`, `meanShape`) |
| `E-COMPARE-VACIO` | `compare()` with no result at all (`core/compare.ts`) |

The list also lives in the code, in `INTERNAL_CODES` (`packages/engine/src/messages/index.ts`),
and a test checks that those eleven are exactly the codes in the catalog that this section does
not document as public (LILA-211).

The codes in this catalog are the ones today's code emits, with two declared exceptions:
`E-REC-CAPACIDAD`, which the static lint does not emit (paragraph above, LILA-164), and the pair
`E-REF-DESCONOCIDA` / `E-CAL-DESCONOCIDO`, two codes for the same thing depending on whether the
lint or the `core/` guard catches it (unifying them requires touching `core/`; see R-CAL-10).

---

## 18. Rule → ticket that tests it

| Rule | What it fixes | Ticket that tests it |
|---|---|---|
| R-DURA-1, R-DURA-2 | seconds; `baseTimeUnit` is presentation only | LILA-013 |
| R-DURA-3 | money in `run.currency` | LILA-036 |
| R-DURA-4 | the BPMN `id` is the only key | LILA-013, LILA-017 |
| R-DURA-5 | missing `elements` = error, extra = warning | LILA-013, LILA-042 |
| R-DURA-6 | purity of `simulate` | LILA-029, LILA-032 |
| R-PERF-1 | every task variant → `task` | LILA-018 |
| R-PERF-2 | converging XOR = merge with no wait | LILA-026 |
| R-PERF-3 | message flow ignored | LILA-021, LILA-163 |
| R-PERF-4 | `conditionExpression` ignored | LILA-021, LILA-163 |
| R-PERF-5 | several starts | LILA-026 |
| R-NOSOP-1 … R-NOSOP-3 | exact text and catalog of unsupported constructs | LILA-021, LILA-163 |
| R-NOSOP-4, R-NOSOP-5 | no degrading; structural errors | LILA-021 |
| R-NOSOP-6 | bpmn-moddle warnings: `E-PARSE-INCOMPLETO` / `W-PARSE` / `W-XOR-DEFAULT-ROTO` | LILA-185, LILA-196 |
| R-PLAN-1, R-PLAN-2, R-PLAN-5 | embedded sub-process flattened | LILA-019 |
| R-PLAN-3 | sub-process has no time of its own | LILA-019 (`E-SUBPROC-PARAMETRO`: LILA-198) |
| R-PLAN-4 | call activity = task with its own duration | LILA-019 |
| R-TOK-1 | clock in seconds since `run.start` | LILA-037 |
| R-TOK-2 | case = set of tokens | LILA-026 |
| R-TOK-3 | heap `(t, seq)` | LILA-023, LILA-030 |
| R-TOK-4 | instantaneous transit and `flows.count` | LILA-028 |
| R-TOK-5, R-TOK-6 | `enabled`/`started`/`ended`; identity and partial lifecycle | LILA-033, LILA-037 |
| R-XOR-1 … R-XOR-5, R-XOR-7 | XOR: even split, remainder to the default, normalization, draw | LILA-026 (normalization and warnings: LILA-042) |
| R-XOR-6, R-XOR-8 | range and placement of `probability` | LILA-013, LILA-042, LILA-198 |
| R-COND-1 … R-COND-5 | routing conditioned on the case's previous outcome (ADR-028) | E22 (`packages/engine/test/conditions.test.ts`) |
| R-OR-1 … R-OR-7 | OR fork/join, matching and loops | LILA-026 |
| R-OR-8 | orphan tokens on stop | LILA-026, LILA-028 |
| R-AND-1 … R-AND-6 | AND fork/join, `(case, join)` counter, loops | LILA-026 |
| R-EVT-1 … R-EVT-2 | timer = delay with no resource | LILA-026 (`E-TIMER-RECURSO`: LILA-198) |
| R-EVT-3 | timer runs 24×7 unless it has its own calendar | LILA-041 |
| R-EVT-4 | end consumes the token; case ends at 0 tokens | LILA-026, LILA-028 |
| R-EVT-5, R-EVT-6 | terminate | LILA-026 |
| R-BND-1 … R-BND-9 | interrupting boundary timer | #81 |
| R-ARR-1 … R-ARR-5 | arrivals and stop (`duration` \| `triggerCount`, whichever first) | LILA-026 (`triggerCount` with no timer: LILA-186) |
| R-ARR-6 | arrivals with a calendar | LILA-041 |
| R-ARR-7 | warm-up | LILA-027 |
| R-ARR-8 | replications and 95% CI | LILA-027 |
| R-ARR-9, R-ARR-10 | public aggregate and cancellation | LILA-029 |
| R-REC-1 … R-REC-3 | pools, defaults and FIFO `(enabled, seq)` | LILA-033 (defaults: LILA-013) |
| R-REC-4, R-REC-5 | atomic AND with no partial holding; no deadlock | LILA-034 |
| R-REC-6 | OR selection | LILA-035 |
| R-REC-7 | occupation/release, no preemption | LILA-033 |
| R-REC-8 | `resourceWait = started − enabled − offHoursWait` | LILA-036, LILA-041 |
| R-REC-9, R-REC-10 | duplicate pool; which elements admit resources | LILA-013, LILA-021 |
| R-REC-11 | flat rows per assignment and sentinel with no resource | LILA-033, LILA-037 |
| `W-RECURSO-SATURADO` | pool with no steady state: queue attributed only to the pools that were full, decided over the mean of the replications | LILA-191 |
| R-CAL-1, R-CAL-2, R-CAL-3 | weekly pattern, intervals (`to > from`, `to` accepts `24:00`), primitives and derived operations | LILA-040 (`24:00`: LILA-041) |
| R-CAL-4 … R-CAL-8 | starting during open hours, pause/resume, `offHoursWait` | LILA-041 (17:30 case: LILA-040) |
| R-CAL-9 | utilization attributable to the cohort over available hours; can exceed 1 with no preemption (`Σᵢ capacityᵢ × openTimeᵢ` over `[warmup, t_stop]`) | LILA-041, LILA-036, LILA-204 (per-slice denominator: LILA-164) |
| R-CAL-10 | resource × calendar matrix and default calendar | LILA-041, LILA-042 |
| R-CAL-11 | shift capacity within a single pool (union, sum, closure and validation) | LILA-164 |
| R-COST-1 … R-COST-4 | costs per element, resource, row and case | LILA-036 (log row: LILA-037) |
| R-COST-5, R-COST-6 | absent costs = 0; waiting is free | LILA-013, LILA-036 |
| R-DEG-1 | no resources ⇒ infinite capacity, bit-for-bit equal to M1 | LILA-039 |
| R-DEG-2 | no calendars ⇒ 24×7, equal to M2 (bytes on linux/x64; see R-DET-6) | LILA-043 (engine: LILA-041) |
| R-DEG-3 … R-DEG-5 | neutral defaults | LILA-042, LILA-013 (aggregated warning and `W-SIN-SEED`: LILA-198) |
| R-RES-1 … R-RES-4 | reserved fields and their error text | LILA-013 (`null` from `extends`: LILA-014; `E-CLAVE-DESCONOCIDA`: LILA-198) |
| R-DET-1 | explicit order in events and queues | LILA-030, LILA-023 |
| R-DET-2, R-DET-3 | stream per element; common random numbers | LILA-024 (what-if: LILA-038) |
| R-DET-4, R-DET-7 | uniform consumption and the 14 distributions | LILA-025 |
| R-DET-5, R-DET-6 | no `Math.random`/`Date`; byte-identical per platform and architecture | LILA-032, LILA-030, LILA-043 |
| §2 to §14 as a whole | agreement with Bizagi's official examples (levels 1–4, ±5 %) | LILA-044 |
| §11 + §12 | numerical validation against M/M/1 and Erlang-C | LILA-050, LILA-011 |

---

## 19. What this document does **not** decide

- Column names and units of the `RunResult`, of the event log and of the CSV:
  `docs/RESULTS_FORMAT.md` (LILA-005) and `docs/BIZAGI_PARITY.md` (LILA-007).
- Exact shape of the scenario JSON, schema defaults and mapping to BPSim 2.0 / qbp / Bizagi:
  `docs/SCENARIO_FORMAT.md` (LILA-004).
- The `lila:` namespace and id policy: `docs/BPMN_EXTENSION.md` (LILA-006).
