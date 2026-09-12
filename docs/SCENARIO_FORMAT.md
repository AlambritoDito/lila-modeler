# Scenario format v1

> Read this in: [Español](es/SCENARIO_FORMAT.md)

Source of truth: `LILA_MODELER_ESTRUCTURA.md`, section 6 ("Scenario format v1") and ADR-015. This document is the normative specification for `*.scenario.json`; when it differs from the structure document, the structure document prevails and this file is corrected.

Ticket: LILA-004 (E0 · M0). It is written **before** the engine. Implemented by `packages/engine/src/scenario.ts` (zod + JSON Schema) and `resolveScenario()`.

---

## 1. What is a scenario

A scenario is a JSON file **separate from the `.bpmn`** that holds a model's simulation parameters: when and how long it runs, which calendars and resources exist, and which parameters each diagram element carries, **keyed by the BPMN `id`** (ADR-012: the `id` is the only key; never the name).

Why separate, and why a custom JSON format (ADR-015): N scenarios per diagram; git diffs without DI-coordinate noise; patchable by an agent as `elements["Task_1"].processingTime.mean = 400`; migrates 1:1 to a `jsonb` column. The vocabulary (field and distribution names) follows BPSim 2.0 so that edge adapters stay trivial, but BPSim and qbp are **not** the canonical format.

What it is **not**: it carries no geometry, element names, or documentation — that lives in the `.bpmn` (ADR-013). It carries no results — that is `RESULTS_FORMAT.md`.

Naming convention: `<name>.scenario.json`, alongside the project's `.bpmn` (`examples/pedido/as-is.scenario.json`).

---

## 2. Structure

### 2.1 Root

| Field | Type | Required | Description |
|---|---|---|---|
| `$schema` | string (URL) | no | `https://lila-modeler.org/schema/scenario/1.json`. For editors only; the engine does not fetch it. |
| `version` | integer | **yes** | Format version. In v1 it is exactly `1`. Any other value ⇒ error. |
| `name` | string | **yes** | Scenario name. Appears in results and in `lila compare`. |
| `description` | string | no | Free text. |
| `model` | string (path) | **yes**¹ | Path to the `.bpmn`, **relative to the scenario file**. |
| `extends` | string (path) | no | Parent scenario it inherits from (§ 6). |
| `run` | object | **yes**¹ | Run parameters (§ 2.2). |
| `calendars` | object | no | Calendars keyed by name (§ 2.3). No calendar ⇒ 24×7. |
| `resources` | object | no | Resource pools keyed by name (§ 2.4). No resources ⇒ infinite capacity. |
| `elements` | object | no | Parameters keyed by BPMN `id` (§ 2.5). |

¹ Required **in the resolved scenario** (after applying `extends`), not in every file: a child that declares `extends` inherits `model` and `run` from the parent.

Unknown keys are not accepted at the root (`strict`): a misspelled field is an error, not a silent pass.

### 2.2 `run`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `start` | ISO 8601 string with offset | **yes** | — | Zero instant of the virtual clock. **The only field not expressed in seconds.** Its offset fixes the timezone in which calendars are read. |
| `duration` | number (seconds) | no² | — | Simulated duration. Cuts the run short. |
| `warmup` | number (seconds) | no | `0` | Cases **started** before `warmup` are excluded from the statistics (they still consume resources). |
| `replications` | integer ≥ 1 | no | `1` | Independent runs. With `> 1` the result carries `mean`, `sd`, and `ic95` per KPI. Bizagi Modeler recommends 30. |
| `seed` | integer | no | `1` | PRNG seed. Byte-for-byte determinism per `(seed, replication, elementId)` (ADR-017). The default is applied by the engine, not the schema: without declaring it, the `W-SIN-SEED` warning is emitted (R-DEG-4). |
| `baseTimeUnit` | `"s"` \| `"min"` \| `"h"` \| `"day"` | no | `"s"` | **Presentation only**: the unit times are printed in. It does not change a single internal number. |
| `currency` | ISO 4217 string | no | — | Cost currency. If absent, amounts are reported without a symbol. |
| `serviceLevel` | number > 0 (seconds) | no | — | Target cycle time. **Reporting only**: it does not change the simulation. With it, the result adds `process.withinServiceLevel` and `process.byEndEvent[*].withinServiceLevel`, the fraction of completed cases whose cycle time is at most this value (docs/RESULTS_FORMAT.md § 5). |

² At least one of `run.duration` or a `triggerCount` on a `start` in `elements` (rule R6). If both are present, whichever occurs first wins.

### 2.3 `calendars`

Map `key → { intervals: [...] }`. The key is the identifier cited by `resources[*].calendar` and `elements[*].calendar`. The key `default` is the calendar taken by **every pool** that does not declare its own (R-CAL-10); elements do not inherit it.

| Field | Type | Required | Description |
|---|---|---|---|
| `intervals` | array (≥ 1) | **yes** | Open windows of the weekly pattern. |
| `intervals[].days` | array of `"MON"`\|`"TUE"`\|`"WED"`\|`"THU"`\|`"FRI"`\|`"SAT"`\|`"SUN"` | **yes** | Days the window applies to. |
| `intervals[].from` | string `"HH:MM"` (24 h) | **yes** | Opening time, local to `run.start`'s offset. |
| `intervals[].to` | string `"HH:MM"` (24 h) or `"24:00"` | **yes** | Closing time, **exclusive**. Must be `> from`; an overnight window is split into two intervals. `"24:00"` is midnight of the next day and is only allowed here, never in `from`: without it the format has no way to say "until the end of the day", and a hand-written 24×7 calendar would lose 60 s every night. |

Semantics (ADR-016): a **weekly pattern relative to `run.start`**; a task only starts within its effective calendar — the intersection of its pools' calendars with its own, R-CAL-4 — and its `processingTime` consumes only calendar time (it pauses when the shift closes, resumes when it opens); closed time is reported as `offHoursWait`, separate from `resourceWait`; utilization is computed over the time **available** according to the calendar. Overlapping intervals within the same calendar are merged (union, not sum). No DST, no holidays, no own timezone in v1 (§ 4).

### 2.4 `resources`

Map `key → pool`. The key is the one cited by `elements[*].resources[].ref`.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | no | the key | Name used in reports. |
| `type` | `"role"` \| `"equipment"` | no | `"role"` | Classification only; does not change semantics. |
| `capacity` | integer ≥ 1, **or** array of `{ calendar, capacity }` (≥ 1 element) | **yes** | — | Simultaneous units in the pool. In the per-interval form, `capacity_i` units while calendar `calendar_i` is open (R-CAL-11). Mutually exclusive with `calendar` (R16). |
| `costPerHour` | number ≥ 0 | no | `0` | Cost per **busy** hour (not per available hour). |
| `fixedCost` | number ≥ 0 | no | `0` | Fixed cost per token served. |
| `calendar` | string (key in `calendars`) | no | `default` if it exists | Without `calendar` the pool uses the calendar named `default`; if that does not exist either, it is available 24×7 (R-CAL-10). |

Queue: FIFO per pool, ordered by enablement instant, ties broken by `seq`.

**Shift-based capacity** (LILA-164). The same role can have a different headcount per shift — Bizagi
Modeler's level-4 example: 3 day nurses and 1 night nurse. That is **one** pool with per-interval
`capacity`, not one pool per shift:

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

Semantics (R-CAL-11 in `SEMANTICS.md`, §12):

- the pool is **open** whenever **any** of its calendars is (union); if the shifts cover 24 h, the
  pool is a 24×7 and no task has `offHoursWait`;
- **capacity at `t`** is the **sum** of the `capacity_i` whose `calendar_i` are open at `t`. Two
  overlapping calendars **add up** (unlike intervals within the same calendar, which are merged):
  `[{ "dia": 2 }, { "24x7": 1 }]` gives 3 units during the day and 1 at night, because they are two
  distinct groups of units of the same role;
- when a slot **closes**, tasks in progress **are not interrupted**: the pool can temporarily run
  above its capacity until they finish (same rule as R-REC-7);
- a task's `quantity` is validated against the **weekly maximum**, not the declared sum: 3 + 1
  units in disjoint shifts are never 4 simultaneous units;
- utilization is integrated slot by slot: `busyTime / Σᵢ (capacityᵢ × openTimeᵢ)` over the
  measurement window (R-CAL-9).

The numeric form is the single-slot case: `{ "capacity": 3, "calendar": "dia" }` and
`{ "capacity": [{ "calendar": "dia", "capacity": 3 }] }` produce exactly the same result.

### 2.5 `elements`

Map `BPMN id → parameters`. The keys are diagram ids: nodes (`Task_…`, `StartEvent_…`, `Timer_…`) and sequence flows (`Flow_…`).

| Field | Type | Applies to | Default | Description |
|---|---|---|---|---|
| `processingTime` | distribution (§ 3) | tasks, timers (intermediate **and** boundary) | no time (0 s) | Duration of the work, in seconds. On an intermediate timer it is the delay, with no resource. On a boundary timer it is the deadline that interrupts its task; without it the boundary never fires (`SEMANTICS.md` R-BND-8). |
| `resources` | array of `{ ref, quantity }` | tasks | — | `ref` = key in `resources`; `quantity` integer ≥ 1, default `1`. Without `resources` ⇒ infinite capacity. |
| `selection` | `"and"` \| `"or"` | tasks with `resources` | `"and"` | `and`: starts when **all** pools have capacity simultaneously (checked on every release; no partial resources are held ⇒ no deadlock). `or`: queues on all of them, starts with whichever becomes available first, and withdraws from the others; if several are free at once, the one listed first in `resources` wins (R-REC-6). |
| `fixedCost` | number ≥ 0 | any node | `0` | Fixed cost per token **completed** at the element. |
| `interTriggerTimer` | distribution (§ 3) | starts (including the timer start) | — | Time between arrivals, in seconds. |
| `triggerCount` | integer ≥ 1 | starts (including the timer start) | — | Maximum number of cases generated by that element (Bizagi Modeler's "Max arrival count"). |
| `calendar` | string (key in `calendars`) | starts, timers, and tasks | — | Arrival calendar: an arrival that falls in closed hours is shifted to the next open instant. It is also allowed on a task, where it is **intersected** with its pools' calendars (R-CAL-4); a `timer` runs 24×7 unless it declares one (R-EVT-3), boundary timers included (R-BND-3). |
| `probability` | number in `[0, 1]` | sequence flows | even split | Probability of taking the flow. On XOR it is distributed by cumulative probability; on OR each outgoing path is independent. The range is checked by the linter (`E-PROB-RANGO`), not the schema. |
| `conditions` | array of `{ flowTaken, probability }` | sequence flow leaving a **diverging XOR** | — | Probability of taking the flow **given what the case already did** (ADR-028, R-COND-1…5). The first entry whose `flowTaken` the case has already traversed replaces this flow's declared probability; if none matches, the plain `probability` applies. `flowTaken` is the id of a sequence flow of the model (`E-REF-DESCONOCIDA` otherwise, `W-COND-INALCANZABLE` if it cannot precede the gateway). On any other element the field is still reserved (§ 4). |

Assigning a whole lane: the web panel can fill `resources` for **every task of a lane** in one action (resources section, "Assign lane"). It is a bulk edit of this same per-task field — the lane is a label of the diagram (`docs/SEMANTICS.md` § 2) and is never stored in the scenario — and tasks that already have `resources` are listed and require confirmation before being replaced.

Note on absent elements: a diagram element that does not appear in `elements` is valid and takes its defaults (a task with no time or resources, a flow with an even split). `elements` is a map of exceptions, not a mandatory mirror of the model.

---

## 3. Distributions

Object `{ "type": "...", <named parameters> }`. **Named parameters, never positional** (ADR-015: this is what rules out Prosimos's scipy-style API). All values in **seconds** when the distribution describes a time. These are the 13 from BPSim 2.0 plus the constant; `user` is the empirical one.

| `type` | Parameters | Constraints | Notes |
|---|---|---|---|
| `constant` | `value` | `value ≥ 0` | Deterministic. |
| `uniform` | `min`, `max` | `min ≤ max`, `min ≥ 0` | Continuous. |
| `triangular` | `min`, `mode`, `max` | `min ≤ mode ≤ max`, `min ≥ 0` | |
| `exponential` | `mean` | `mean > 0` | `mean` is the mean, not the rate λ. |
| `normal` | `mean`, `sd` | `sd ≥ 0` | **Truncated to ≥ 0**; the linter warns if `P(x < 0) > 1%`. |
| `truncatedNormal` | `mean`, `sd`, `min`, `max` | `sd ≥ 0`, `min ≤ max` | Explicit truncation by rejection. |
| `lognormal` | `mean`, `sd` | `mean > 0`, `sd ≥ 0` | `mean` and `sd` are **of the variable, not of its logarithm** (as in Bizagi Modeler and qbp; they are converted internally to the log's μ and σ). |
| `gamma` | `shape`, `scale` | `shape > 0`, `scale > 0` | Mean = `shape × scale`. |
| `erlang` | `k`, `mean` | `k` integer ≥ 1, `mean > 0` | `mean` is the **total** mean, not that of each phase. |
| `weibull` | `shape`, `scale` | `shape > 0`, `scale > 0` | |
| `beta` | `alpha`, `beta`, `min`, `max` | `alpha > 0`, `beta > 0`, `min ≤ max` | Standard beta rescaled to `[min, max]`. |
| `poisson` | `mean` | `mean > 0` | Discrete. |
| `binomial` | `n`, `p` | `n` integer ≥ 1, `0 ≤ p ≤ 1` | Discrete. |
| `user` | `points: [{ value, probability }]` | `probability ≥ 0`; ≥ 1 point | Discrete empirical. If the probabilities do not add up to 1 they are normalized with a warning. |

Any `type` outside this list is a validation error with "not supported" text (ADR-021). Any extra parameter inside a distribution is also an error (strict object): `{"type":"normal","mean":60,"stddev":10}` fails citing `stddev`.

---

## 4. Reserved fields

These fields **are in the schema** (they are syntactically accepted, documented, and do not break a file written today), but the v1 engine **rejects them with an explicit error** when resolving the scenario. They are never ignored silently (ADR-021).

| Field | Where | What it will do once it exists |
|---|---|---|
| `priority` | `elements[task]` | Priority in the resource queue, instead of plain FIFO. |
| `preempt` | `elements[task]` | Whether a higher-priority task can preempt one in progress. |
| `batch` | `elements[task]` | Grouping tokens to process together. |
| `conditions` | `elements[task]` and any element that is not a flow leaving a diverging XOR | Branching by an expression over case data. On a flow leaving a diverging XOR it is **implemented** since ADR-028 (§ 2.5): it routes by the flows the case already took, not by its data. |
| `holidays` | `calendars[*]` | Specific closed dates, in addition to the weekly pattern (ADR-016). |
| `timezone` | `calendars[*]`, `run` | Its own timezone with DST, instead of the fixed offset of `run.start` (ADR-016). |

Error text: the same pattern as the rest of the "not supported" errors, citing the field and the element's `id`.

---

## 5. Validation rules

The first six are taken verbatim from the structure document; the rest are derived from section 6 and the cited ADRs.

| # | Rule |
|---|---|
| **R1** | All times are in **seconds**, except `run.start`. |
| **R2** | `baseTimeUnit` **only affects presentation**. |
| **R3** | The keys of `elements` **must exist in the IR**: if one is missing, **error** citing the `id`; if the IR has an element without parameters, **warning**. |
| **R4** | `probability` only on **sequence flows** (on a node it is `E-PROB-EN-NODO`). |
| **R5** | `interTriggerTimer` / `triggerCount` only on **starts**, including the `bpmn:startEvent` with `timerEventDefinition` (which `SEMANTICS.md` § 2 maps to `start`). A `bpmn:intermediateCatchEvent` with a timer is a delay, never a generator: both fields there are `E-CAMPO-NO-APLICA`. A `triggerCount` without `interTriggerTimer` means `triggerCount` arrivals at `t = 0` (R-ARR-1), not a mute start. |
| **R6** | At least one of `run.duration` or a `triggerCount` **on a start** (one on a non-generating element does not count as a stop condition). With `triggerCount` alone, the run ends when the heap empties. |
| R7 | `version` must be `1`; the root and every object are strict (unknown key ⇒ error). |
| R8 | `model` and `run` must exist **in the resolved scenario**; `run.start` must be ISO 8601 **with offset** and designate an instant that **exists**: a real calendar date (`2026-02-31`, `2026-13-01`, and `2026-02-29` are errors, `2024-02-29` is not), time `00:00:00`–`23:59:59`, and offset `±00:00`–`±23:59`. `24:00` is not allowed here (it is in `intervals[].to`, R13): as a starting instant it is written as `00:00` of the next day. |
| R9 | Every `ref` in `elements[*].resources[]` must exist in `resources`; every `calendar` key must exist in `calendars`, **including that of each slot** of `resources[*].capacity` when it is a list (`E-REF-DESCONOCIDA` citing `resources.<pool>.capacity[i].calendar`). Error citing the `id` and the key. |
| R10 | The probabilities of the outgoing flows of an XOR gateway: if missing, an even split; if they do not add up to 1, they are **normalized with a warning**; the `isDefault` flow gets the remainder. On OR each outgoing path is independent and is not normalized. |
| R11 | Each distribution's parameters must satisfy its constraints (§ 3). `normal` with `P(x < 0) > 1%` produces a **warning**, not an error. |
| R12 | Reserved fields (§ 4) produce an explicit error. |
| R17 | `conditions` only on a **sequence flow leaving a diverging XOR** (elsewhere `E-RESERVADO` on a node, `E-CAMPO-NO-APLICA` on a flow). Each `flowTaken` must be a sequence flow of the model (`E-REF-DESCONOCIDA`) that can precede the gateway (`W-COND-INALCANZABLE` if not), and each `probability` must be in `[0, 1]` (`E-PROB-RANGO`). See `SEMANTICS.md` § 6.1 and ADR-028. |
| R13 | `intervals[].to > intervals[].from`; a window that crosses midnight is declared as two intervals. `to` also allows `"24:00"` (midnight of the next day); `from` does not. |
| R14 | `selection` only makes sense with `resources`; declaring it without resources is an error. |
| R15 | `extends`: the path must resolve to an existing file, and the chain must not contain cycles (§ 6). |
| R16 | `resources[*].capacity` by interval and `resources[*].calendar` are **mutually exclusive**: the calendar is already given per slot, and declaring both leaves it undefined which one wins. Error `E-CAPACIDAD-Y-CALENDARIO` citing the pool. Each `capacity[i].capacity` is an integer ≥ 1 and the list cannot be empty (`E-REC-CAPACIDAD`). **The JSON Schema cannot express this rule**: `docs/scenario.schema.json` is generated from zod, and `capacity`'s `anyOf` cannot see its sibling `calendar`, so a pool declaring both passes the schema and is rejected only by `validateScenario` (or the guard in `core/sim.ts`). Anyone validating with the schema alone — an editor, an external CI — must also run the linter. Pinned in a test since LILA-164 (`packages/engine/test/scenario.capacity-slices.qa.test.ts`, § 8). |

Errors vs. warnings: an **error** prevents simulation; a **warning** travels in the `RunResult`'s `warnings[]` and is printed in the CLI. A field applied to an element type that does not accept it (R4, R5, R14) is an error, not a warning: it is almost always a wrong `id`.

**Schema** defects (the ones zod catches before R3–R17: wrong type, out of range, unknown key, nonexistent variant) come out in Spanish and cite the path — `run.warmup: debe ser ≥ 0` —, with the same text in the CLI, in the MCP, and in the scenario panel. The catalog is `erroresEnEspanol` in `packages/engine/src/scenario.ts`, and `parseScenario` is the only gate that applies it; whatever that map does not translate falls through to zod's `es` locale. One exception: the unknown-key error appears in the CLI with the § 17 text (`E-CLAVE-DESCONOCIDA: clave no reconocida por el esquema: …`, produced by `schemaIssueLines`), because the § 17 catalog overrides the map. This document's own messages (R8, R11, R13, `E-CAL-VACIO`…) are written by the schema and override the map. **Semantic** errors and warnings are a different matter: they are defined by the § 17 catalog in `docs/SEMANTICS.md`.

---

## 6. `extends` semantics

```json
{ "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }
```

- **Deep merge**: the child is applied onto the parent object by object. Anything not mentioned is inherited intact.
- **`null` deletes the key**: `{"resources": {"horno": null}}` removes the `horno` pool from the resolved scenario.
- **Arrays are replaced whole**, not merged element by element: a task's `resources: [...]`, a calendar's `intervals: [...]`, and a `user` distribution's `points: [...]` are substituted in full. It is the only predictable semantics for a list without keys.
- **Chains allowed**: A `extends` B `extends` C. It is resolved from the root down (C, then B, then A).
- **Cycles rejected**: any cycle in the chain is an error, citing the files involved.
- **Paths relative to the child's file**, not to the working directory. `model` is also resolved relative to the file where it is written.
- **`__proto__`, `constructor`, and `prototype` are ignored**: in JavaScript these are not ordinary keys (they write onto the object's prototype), so the merge skips them in any object at any depth, without warning. No field in § 2 is named this way; inside an array they are caught by the schema as `E-CLAVE-DESCONOCIDA` (LILA-204).
- Validation (§ 5) applies **to the resolved scenario**, not to each file separately: that is why a delta may omit `model` and `run`.

---

## 7. Examples

### 7.1 AS-IS (`examples/pedido/as-is.scenario.json`)

Copied verbatim from the structure document, section 6.

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

### 7.2 TO-BE as a delta

Copied verbatim from the structure document, section 6:

```json
{ "version": 1, "name": "TO-BE 3 cajeros", "extends": "as-is.scenario.json", "resources": { "cajero": { "capacity": 3 } } }
```

(deep merge; `null` deletes; chains allowed; cycles rejected)

Resolved, it is identical to the AS-IS except for `resources.cajero.capacity = 3` — which is exactly M0's acceptance test: `Scenario.parse(to-be)` resolves `extends` to an object equal to the AS-IS except for `capacity = 3`.

### 7.3 Checking the examples against the rules

The AS-IS satisfies every rule in § 5 (`examples/pedido/model.bpmn` must contain the seven cited ids):

| Rule | How the AS-IS satisfies it |
|---|---|
| R1 | All time numbers are in seconds (`duration` 2,592,000 = 30 days; `warmup` 3600 = 1 h; `mean` 240; `min/mode/max` 60/120/300; `mean/sd` 480/90; `value` 90 and 600). Only `run.start` is a date. |
| R2 | `baseTimeUnit: "min"` does not alter any value: times remain in seconds. |
| R3 | The seven keys of `elements` are ids from the example diagram. |
| R4 | `probability` appears only on `Flow_Aprobado` and `Flow_Rechazado`. |
| R5 | `interTriggerTimer` and `triggerCount` appear only on `StartEvent_Pedido`. |
| R6 | Both `run.duration` (2,592,000 s) **and** `triggerCount` (10,000) are present: for the engine, whichever occurs first ends the run. |
| R7 | `version: 1`; there are no unknown keys. |
| R8 | `model` and `run` are present; `start` has offset `-06:00`. |
| R9 | `cajero`, `cocinero`, and `horno` exist in `resources`; the `oficina` calendar exists in `calendars` and is cited by `cajero`, `cocinero`, and `StartEvent_Pedido`. |
| R10 | `0.78 + 0.22 = 1`: no normalization or warning. |
| R11 | `triangular` 60 ≤ 120 ≤ 300 ✓; `normal` mean 480, sd 90 ⇒ `P(x < 0) ≈ 6·10⁻⁸`, well below 1% ⇒ no warning; `exponential` mean 240 > 0 ✓; `constant` 90 and 600 ≥ 0 ✓. |
| R12 | There are no reserved fields. |
| R13 | `09:00 < 18:00` ✓, no midnight crossing. |
| R14 | `selection` only on `Task_Preparar` and `Task_Revisar`, both with `resources`. `Task_TomarPedido` has a single resource and takes the default `and`. |
| R15 | The AS-IS does not use `extends`; the TO-BE points to an existing sibling file, with no cycle. |

Defaults exercised by the example: `cocinero` with no `fixedCost` ⇒ 0; `horno` with no `calendar` ⇒ 24×7; `Task_Preparar` and `Task_Revisar` with `resources` and no `quantity` ⇒ 1; `Timer_Reposo` with no `resources` ⇒ pure delay; `Task_TomarPedido` with no `selection` ⇒ `and`.

---

## 8. Field mapping: Lila ↔ BPSim 2.0 ↔ qbp ↔ Bizagi Modeler

What this is for: adapters live **at the edges** and are only written when a consumer appears (ADR-015) — qbp import (Prosimos/Simod fixtures), `.bpsim` export/import for Sparx EA, and reading Bizagi Modeler's published examples. This table is the contract for those adapters. `—` = no equivalent.

| Lila field | BPSim 2.0 | qbp | Bizagi Modeler (UI name) |
|---|---|---|---|
| `name` | `bpsim:Scenario/@name` | — | Scenario name |
| `description` | `bpsim:Scenario/@description` † | — | Description |
| `version`, `$schema` | — | — | — |
| `model` | — (BPSim is embedded in the `.bpmn`) | — (qbp is embedded in the `.bpmn`) | — |
| `extends` | `bpsim:Scenario/@inherits` † | — (a single scenario per file) | — |
| `run.start` | `bpsim:ScenarioParameters/@start` | `qbp:processSimulationInfo/@startDateTime` | Start date |
| `run.duration` | `bpsim:ScenarioParameters/@duration` | — | Duration |
| `run.warmup` | `bpsim:ScenarioParameters/@warmup` † | — | — |
| `run.replications` | `bpsim:ScenarioParameters/@replication` | — | Replications (what-if only) |
| `run.seed` | `bpsim:ScenarioParameters/@seed` † | — | — |
| `run.baseTimeUnit` | `bpsim:ScenarioParameters/@baseTimeUnit` | — | Base time unit |
| `run.currency` | `bpsim:ScenarioParameters/@baseCurrencyUnit` | `qbp:processSimulationInfo/@currency` | Currency |
| `calendars[k]` | `bpsim:Calendar` (iCalendar value) † | `qbp:timetables/qbp:timetable` | Calendars |
| `calendars[k].intervals[]` | iCal rules inside `bpsim:Calendar` † | `qbp:rule/@fromWeekDay,@toWeekDay,@fromTime,@toTime` | Recurrence + start time + duration |
| `resources[k]` | `bpmn:Resource` referenced by `bpsim:ResourceParameters` | `qbp:resources/qbp:resource` | Resource |
| `resources[k].name` | `bpmn:Resource/@name` | `qbp:resource/@name` | Name |
| **`resources[k].capacity`** (integer) | **`bpsim:Quantity`** | **`qbp:resource/@totalAmount`** | **Availability** |
| `resources[k].capacity[]` (by interval) | several `bpsim:Quantity`, one per `bpsim:Calendar` † | — (one `timetableId` per resource) | **Resources → Calendars → quantity** (the «Resource \| Morning shift \| Day shift \| Night shift» table from the calendar analysis) |
| `resources[k].costPerHour` | `bpsim:CostParameters/bpsim:UnitCost` | `qbp:resource/@costPerHour` | Cost per hour |
| `resources[k].fixedCost` | `bpsim:CostParameters/bpsim:FixedCost` † | — | Fixed cost |
| `resources[k].type` | — | — | Type (role / equipment) |
| `resources[k].calendar` | reference to `bpsim:Calendar` † | `qbp:resource/@timetableId` | Resource calendar |
| **`elements[id].processingTime`** | **`bpsim:ProcessingTime`** | **`qbp:element/qbp:durationDistribution`** | **Processing time** |
| `elements[id].resources[].ref` | `bpsim:ResourceParameters/bpsim:Selection` (or `bpsim:Role`) | `qbp:element/qbp:resourceIds/qbp:resourceId` | Activity resources |
| `elements[id].resources[].quantity` | `bpsim:Quantity` (in `ResourceParameters`) | — (one resource per task) | Quantity |
| `elements[id].selection` (`and`/`or`) | — | — | AND / OR |
| `elements[id].fixedCost` | `bpsim:CostParameters/bpsim:FixedCost` | — | Fixed cost (activity) |
| `elements[start].interTriggerTimer` | `bpsim:InterTriggerTimer` | `qbp:arrivalRateDistribution` | Interval / time between arrivals |
| **`elements[start].triggerCount`** | **`bpsim:TriggerCount`** | `qbp:processSimulationInfo/@processInstances` | **Max arrival count** |
| `elements[start].calendar` | reference to `bpsim:Calendar` † | `qbp:arrivalRateDistribution` + arrival timetable | Arrival calendar |
| **`elements[flow].probability`** | **`bpsim:Probability`** | **`qbp:sequenceFlow/@executionProbability`** | **%** per flow |
| `priority` (reserved) | `bpsim:PriorityParameters/bpsim:Priority` † | — | — |
| `preempt` (reserved) | `bpsim:PriorityParameters/bpsim:Interruptible` † | — | — |
| `elements[flow].conditions` | `bpsim:ControlParameters/bpsim:Condition` † | — | — (no Bizagi equivalent; ADR-028) |
| `batch`, `holidays`, `timezone` (reserved) | — | — | Holidays (calendar) |

In bold, the four mappings already fixed in the structure document.

† To be verified against the BPSim 2.0 XSD when writing the `.bpsim` adapter. The row is documented as intent, not as a verified fact.

Known limitations of the external formats, which is why none of them serves as canonical (ADR-015):

- **BPSim 2.0** has been frozen since 2016, has no open-source tooling, and, embedded in the `.bpmn`, mixes layout with parameters.
- **qbp** supports **a single scenario per file** and **one resource per task**: `selection`, `quantity > 1`, and multiple scenarios have nowhere to go. Import is an acceptable degradation; export loses information and must warn.
- **Bizagi Modeler does not export simulation parameters** (verified against 5 real files: only colors travel in `bizagi:`). The Bizagi Modeler column is there to name things the same way its UI does, not to exchange files.
- **Prosimos** uses positional scipy-style parameters and carries no license: it is only used as a numeric oracle during development, never as a format.

---

## 9. Version changes

`version` is an integer. v1 grows **additively**: new optional fields and reserved fields that become implemented do not bump the version. It moves to `2` only if the meaning of an existing field changes or one disappears. The engine rejects a `version` it does not recognize; it never guesses.

Changes already applied within v1:

- **Per-interval `resources[*].capacity`** (LILA-164, § 2.4). `version` **stays at 1**: it is a
  widening of the type, not a change of meaning. Every earlier v1 scenario remains valid and
  produces the same result byte for byte, because the integer form is the single-slot case. A
  scenario using the new form is **not** understood by an older engine: the strict schema rejects
  it with a type error, which is the correct degradation (never guess).
