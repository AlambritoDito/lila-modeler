# Results format (`RunResult`) and event log

> Read this in: [Español](es/RESULTS_FORMAT.md)

Source of truth: `LILA_MODELER_ESTRUCTURA.md`, section 6 ("Engine design" → "Metrics (`RunResult`)" and "Event log") and section 3 (the Bizagi Modeler reference-behaviour checklist). This document details what is summarized there: the complete structure of `RunResult`, the formula or operative definition of each metric, the event log columns with type and unit, and the mapping of internal column names to the ones Bizagi Modeler uses (which the CLI reuses when printing tables).

Units, unless stated otherwise:

- All time is measured and stored in **seconds** (float64). `run.baseTimeUnit` only affects how they are presented in the CLI/UI; never the stored value.
- All money is measured in `run.currency` (the scenario's currency, see `SCENARIO_FORMAT.md`).
- Event log timestamps are virtual-clock seconds since `run.start`, except for the ISO 8601 variant, which is derived from `run.start` only when exporting.

`RunResult` is the output of `simulate(ir, scenario, opts)` (`packages/engine/src/core/run.ts`, see section 6 of the structure document). It is aggregated after running one or more replications (`scenario.run.replications`) and, when there is more than one, every numeric metric also carries its cross-replication summary (`replications`/`ci95`, see below).

---

## 1. Overall structure

```ts
interface RunResult {
  elements: Record<string, ElementMetrics>;   // keyed by the element's BPMN id
  flows: Record<string, FlowMetrics>;         // keyed by the sequence flow's BPMN id
  resources: Record<string, ResourceMetrics>; // keyed by the resource pool's id
  process: ProcessMetrics;                    // single aggregate, whole process
  bottlenecks: BottleneckEntry[];             // ranking, see section 6
  replications?: ReplicationSummary;          // only if scenario.run.replications > 1
  cancelled?: true;                           // absence = complete run
  completedReplications?: number;             // only if cancelled = true
  warnings: string[];                         // see section 8
  log?: EventLogRow[];                        // only in retained mode, see section 7
}
```

Every element, flow, or resource that exists in the IR appears in the corresponding map even if its count is zero (for example, an XOR branch that was never taken in a short run). The `id` used as the key is always the BPMN `id` — never the visible name (a repository-wide rule, see the header of `BACKLOG.md`).

With more than one replication, every top-level numeric field is the **arithmetic mean of that
same field computed in each replication**. They do not represent the first replication, nor a
pool of every case. `replications.kpis[path].mean` matches the corresponding top-level field in a
complete run. This decision is detailed in ADR-024. *(test: LILA-029)*

---

## 2. Per-element metrics (`elements[id]`)

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

Operative definitions (all computed over the element's instances that **completed** processing in the replication, unless stated otherwise; cases still in flight when the run is cut off do not contribute to `processing`/`resourceWait`/`offHoursWait` but do increment `started`):

- **`started`** — number of tokens/instances that reached and enabled the element (the event log's `enabledAt` event, section 7) in the replication. For a `task`, it corresponds to Bizagi Modeler's "Instances/Tokens started".
- **`completed`** — number of tokens/instances that finished processing at the element (the `endedAt` event). A case in flight when the run stops counts toward `started` but not `completed` (the same criterion as Bizagi Modeler, see section 6 of the structure document: "Cases in flight when stopping count as started, not completed").
- **`processing.{min,max,mean,total}`** — statistics of the open time actually worked by the element, excluding resource wait and calendar wait. By R-CAL-8 it is obtained from each row as `endedAt − enabledAt − resourceWait − offHoursWait`; in the absence of calendars it reduces to `endedAt − startedAt`. `mean = total / completed`. Formula: for the set `P` of completed processing durations, `min = min(P)`, `max = max(P)`, `total = Σ P`, `mean = total / |P|`. *(test: LILA-028)*
- **`resourceWait.{min,max,mean,sd,total}`** — statistics of `startedAt − enabledAt − offHoursWait[enabledAt, startedAt]`: open time during which the instance waited exclusively for a resource to become available (R-REC-8). `sd` is the sample standard deviation (`n−1` in the denominator) of the same set. If the element requires no resources (empty `resources` in the scenario), every instance has `resourceWait = 0` — the infinite-capacity degradation (ADR-016 and section 6). *(test: LILA-028)*
- **`offHoursWait.{min,max,mean,sd,total}`** — statistics of closed time within the whole `[enabledAt, endedAt]` interval, including both the closure before starting and pauses during processing (R-CAL-7). It accumulates separately from `resourceWait`; if the element uses a 24×7 calendar (the default with no calendar assigned), it is always 0. *(aggregation test: LILA-028; calendar semantics: LILA-041)*
- **`queueLength.{mean,max}`** — length of the queue of instances waiting for the element. Each activity instance (not each row: an AND with two pools contributes **only once**) contributes the **half-open** interval `[enabledAt, startedAt)`, or `[enabledAt, observedUntil)` if it was still queued when the run was cut off. `mean` is the integral of the instantaneous length over the statistics window divided by its duration (`statisticsDuration`, i.e. the run minus `warmup`, see section 8); `max` is the instantaneous maximum. Consequences of the interval being half-open: a wait of zero duration never forms a queue (with no resources, `queueLength = {mean: 0, max: 0}` for every element, R-DEG-1), and the instance that leaves the queue at the same instant another enters are not counted together. *(test: LILA-036)*
- **`fixedCostTotal`** — `elements[id].fixedCost × completed` (fixed cost per completed token, defined in the scenario; see `SCENARIO_FORMAT.md`). It is obtained as `Σ row.elementCost`, never `Σ row.cost` (R-COST-4).

Bizagi Modeler does not distinguish `resourceWait` from `offHoursWait` (see section 3: "Off-hours wait kept separate from resource wait — Bizagi Modeler ✗ / Lila ✓"); it is an extra Lila metric.

### Partial lifecycle: what goes into the aggregates *(decision from LILA-036)*

`terminated`, `interrupted` and `inFlight` rows keep, in the raw log, the wait **observed** up to
`observedUntil` (section 7). In the aggregates the criterion is uniform and does not depend on
the element:

- The **per-instance** statistics — this section's `processing`, `resourceWait`, `offHoursWait`,
  and section 5's `process.waitTime` — aggregate **only** instances with `status = "completed"`.
  A wait cut short by `terminate` or by the end of the run is a **censored** observation:
  including it would bias the mean downward and mix two populations. This follows the rule
  LILA-033 already applied (complete raw rows, aggregate only the completed ones).
- The **state integrals and costs** — this section's `queueLength`, section 4's `busyTime`,
  `utilization`, and costs, and section 5's `process.totalCost` — **do** include the partial
  lifecycle: they measure occupancy actually observed within the window, and R-COST-4 requires
  that cost already incurred by an in-flight case not vanish from the total.

Deliberate and tested consequence: an element whose wait is **entirely** censored has
`resourceWait.total = 0` and therefore **does not appear** in `bottlenecks` (section 6), even
though its `queueLength` and its pool's utilization do give it away. *(test: LILA-036)*

---

## 3. Per-flow metrics (`flows[id]`)

```ts
interface FlowMetrics {
  count: number;
}
```

- **`count`** — number of tokens that traversed the sequence flow in the replication. It is Bizagi Modeler's "level 1" (Process Validation): it lets you check which paths were activated and in what proportion, comparable against the probability configured in the scenario (`elements[flowId].probability`).

---

## 4. Per-resource metrics (`resources[id]`)

```ts
interface ResourceMetrics {
  utilization: number;   // fraction >= 0; can exceed 1, see R-CAL-9
  busyTime: number;      // seconds
  fixedCost: number;
  unitCost: number;
  totalCost: number;
}
```

- **`busyTime`** — unit-seconds the pool spent busy serving instances, summed over the units occupied: if `capacity = 3` and all three units work simultaneously for 10 s, `busyTime` accumulates 30 s. It is aggregated **per row** of the event log (ADR-025): each row **in the measured cohort** with non-null `resourceId` and `startedAt` contributes `resourceQuantity ×` the **open** time of `[max(startedAt, warmup), min(endedAt ?? observedUntil, t_stop)]` according to that activity's effective calendar — the same one used to compute its `resourceCost`, which is why R-COST-4's identity still holds — with no calendars that open time is the whole interval. A unit reserved while the task is paused off-hours does not accumulate `busyTime` (R-CAL-6). A sentinel row, or one that never got to start, contributes 0. Rows for cases started before `warmup` contribute nothing even if their occupancy falls within the window: by R-ARR-7 those cases exist and delay the others, but they enter no integral (see section 8).
- **`utilization`** — `busyTime / (capacity × hours available according to the resource's calendar during the run)`. Formula (ADR-016, the only definition that makes a 24×7 resource comparable to one with a restricted calendar): `utilization = busyTime / (capacity × availableTime)`, where `availableTime` is the total seconds the resource's calendar was open between `run.start` and the end of the run (or `run.start + run.duration`, whichever applies). If the resource has no calendar assigned, `availableTime` is the run's full duration (24×7). At level 3 (no calendars, M2) `availableTime = statisticsDuration`, i.e. the window `[warmup, t_stop]`; M3's calendars only change that denominator (R-CAL-9). It is a fraction `≥ 0`, which the CLI prints as a percentage (Bizagi Modeler column `Utilization %`): it can exceed 1 when work started with higher capacity continues after a drop with no preemption. No clamp is applied; `W-UTILIZACION-MAYOR-UNO` makes the case visible. With `capacity × availableTime = 0` it is 0, not `NaN`. The metric is attributable to the cohort after `warmup`: earlier work contributes no `busyTime`, even though it still physically occupies the pool, and the denominator keeps the window's full capacity. **Known limitation** (QA from LILA-041, open for LILA-044): the denominator only looks at the **pool's** calendar, so a pool with no calendar that only participates in tasks whose effective calendar does have one appears diluted against wall-clock time. In `examples/pedido` the `horno` pool is busy 99.9% of the hours its task can run, and the table prints 27.5%.
- **`fixedCost`** — `resources[id].fixedCost × uses`, where *uses* is `Σ resourceQuantity` over the rows that came to occupy the pool (a task occupying 2 units counts as 2 uses, R-COST-2).
- **`unitCost`** — `resource's costPerHour × (busyTime / 3600)` (cost for the hours actually occupied).
- **`totalCost`** — `fixedCost + unitCost`. An identity verifiable against the log:
  `Σ resources[*].totalCost = Σ row.resourceCost` over every row in the window, i.e.
  `Σ fixed × uses + Σ perHour × busy hours` (R-COST-4). *(test: LILA-036)*

Every pool declared in `scenario.resources` appears in the map **even if no element uses it**,
with `utilization = 0` and `busyTime`, `fixedCost`, `unitCost`, and `totalCost` at zero — this is
the same thing Bizagi Modeler's *Resources* table does, listing every declared resource even at
0% utilization (section 3), and it is what lets every replication share the same set of KPI keys
(section 8): if an idle pool disappeared from the map in some replications and not others,
`summarizeKpis` would reject it with `E-KPI-INCONSISTENTE`.

Declaring an idle pool is **not** the degradation case: R-DEG-1 refers to a scenario **without** a
`resources` section, and only then does the map end up `{}` and `bottlenecks` end up `[]`, exactly
as in M1 — the degradation does not change the JSON's shape (test LILA-039). A scenario that
declares pools without using them does change `resources`, and nothing else in the result.
*(test: LILA-036, LILA-034)*

---

## 5. Per-process metrics (`process`)

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
  byEndEvent: Record<string, OutcomeMetrics>;  // keyed by the BPMN id of the end/terminate node
  withinServiceLevel?: number;                 // only with run.serviceLevel
}

interface OutcomeMetrics {
  completed: number;
  cycleTime: Percentiles;
  waitTime: Percentiles;
  withinServiceLevel?: number;                 // only with run.serviceLevel
}

interface Percentiles {
  min: number; max: number; mean: number; sd: number;
  p50: number; p90: number; p95: number;
}
```

- **`started`** — number of cases that entered through any start event of the process.
- **`completed`** — number of cases that reached an end event (or were consumed by a `terminate`).
- **`inFlight`** — `started − completed` at the moment the run was cut off (cases that neither completed nor were discarded).
- **`cycleTime.*`** — statistics of a case's total lifetime (`caseEndedAt − caseEnabledAt`, summing every element it passed through); `p50`/`p90`/`p95` are the empirical 50th, 90th, and 95th percentiles (linear interpolation over the sorted sample) of the same set of durations. Computed only over **completed** cases.
- **`waitTime.*`** — the same statistics and percentiles, over the sum of `resourceWait + offHoursWait` of the activities that completed processing in the case, and only over **completed** cases. A `terminated`/`interrupted`/`inFlight` row does not enter this metric even though its raw lifecycle keeps the observed wait: this is the partial-lifecycle rule set by LILA-036 (section 2). *(test: LILA-036)*
- **`throughputPerHour`** — `completed / (effective run duration in hours)`, where the effective duration excludes `warmup` (see section 8).
- **`costPerCase`** — average of `Σ row.cost` over completed cases. In-flight cases' costs are part of `totalCost`, but not of this average (R-COST-4). *(test: LILA-028)*
- **`totalCost`** — sum of `fixedCostTotal` across every element plus `totalCost` across every resource (the scenario's total cost in the replication).

- **`byEndEvent`** *(#316)* — the same cycle and wait statistics, split by the **outcome** each case reached: the key is the BPMN id of the `end` (or `terminate`) event that closed it. `process.cycleTime` mixes every outcome; a process whose rejections are fast and whose approvals are slow needs both numbers apart. Every `end`/`terminate` node of the model has an entry, even one no case reached (`completed: 0` and zeroed statistics), so the key set is identical across replications and across scenarios. In-flight cases are not counted in any entry, so `Σ byEndEvent[*].completed === completed`. Over several replications, each entry is the mean of that entry across replications, exactly like the rest of `process`.
- **`withinServiceLevel`** *(#316)* — only present when the scenario declares `run.serviceLevel` (seconds, docs/SCENARIO_FORMAT.md § 2.2): fraction in `0..1` of **completed** cases whose `cycleTime` is at most that target. It is reported both for the whole process and inside each `byEndEvent` entry. Without a declared target the field is absent, rather than a `0` that would read as "0 % met".

`cycleTime.mean` "weighted by gateway probabilities" is exactly what aggregating over the real set of simulated cases already produces (no separate weighting is needed): each path appears in the sample in proportion to how many times it was taken.

---

## 6. `bottlenecks`

```ts
interface BottleneckEntry {
  elementId: string;
  resourceWaitTotal: number;  // seconds, = elements[elementId].resourceWait.total
  utilization: number;        // of the main resource assigned to the element, >= 0
}
```

Ranking of elements sorted in descending order by `elements[elementId].resourceWait.total` (the element where the most total time was lost waiting for a resource). Tiebreak: higher `utilization` first (of the resource — or, if the element uses several pools, the highest `utilization` among them); if still tied, `elementId` ascending, so the order is total and deterministic. Elements with `resourceWait.total = 0` do not appear in the ranking. This is a metric Bizagi Modeler does not offer (section 3: "Bottleneck ranking — Bizagi Modeler ✗ / Lila ✓").

With multiple replications, `resourceWaitTotal` is the unconditional mean: a replication where the
element does not wait contributes 0, the same as in `elements[id].resourceWait.total`.
`utilization` is the conditional mean over the replications where the element does appear in
`bottlenecks`; its absence is not an observation of zero utilization and does not artificially
lower the published value. Averaging this way does not reorder the ranking, which is decided by
`resourceWaitTotal`: `utilization` only breaks ties.
*(test: LILA-201, on `examples/pedido`)*

An element's pools are read from the **event log** (the `resourceId` of its rows), not from the
scenario: each row already carries the pool actually assigned, so the ranking holds equally for a
single pool, for `selection: "and"`, and for LILA-035's `"or"` selection, with no special case.
*(test: LILA-036)*

---

## 7. Event log

Flat rows, one per **pool assignment** per activity instance. Rows from the same occurrence are
grouped by `activityInstanceId`; an activity with no resource keeps a sentinel row. They are
emitted via streaming
(`opts.onEvent`) so the CLI can write to CSV and the web app can aggregate/sample without loading
everything into memory (see section 6 of the structure document: up to 6M rows in large runs).
`opts.log` is `true` by default; `log: false` suppresses the callback even if `onEvent` was
provided, but does not change any metric. *(test: LILA-029)*

### Who ends up with the rows: `result.log`'s three modes

`simulate` never delivers the same rows twice. What `result.log` contains depends only on the
options, and in no case does it change a metric or the row order *(test: LILA-037)*:

| Options | `onEvent` | `result.log` |
|---|---|---|
| none (`log` absent) — **retained mode** | not called | the run's complete log, in simulation and replication order, including rows before `warmup` and those of the partial replication of a cancelled run |
| `onEvent` present — **streaming mode** | one call per row | **absent**: the consumer already received them, and retaining them would duplicate up to 6M objects |
| `log: false` — **disabled** | not called, even if it was passed | **absent** |

`lila run` always uses one of the two non-retaining modes: with `--csv` it passes `onEvent` and
writes each row to `log.csv` as it arrives; without `--csv` it passes `log: false`, so `--json`'s
`RunResult` never bloats with the event log. Only the retained mode bounds its memory by the log's
size; the other two bound it by the peak of **one** replication.

| Column | Type | Unit | Definition |
|---|---|---|---|
| `replication` | integer | — | Index of the replication, `0..scenario.run.replications-1`. |
| `caseId` | string | — | Identifier of the case (process instance), unique within the replication. |
| `activityInstanceId` | string | — | Opaque, unique identifier of the task/timer occurrence within the replication, derived from a counter; groups its assignments. |
| `elementId` | string | — | BPMN `id` of the element (never the name). |
| `resourceId` | string \| null | — | `id` of the pool actually assigned; `null` in the sentinel of an activity with no resource, or one that was still waiting. |
| `allocationIndex` | integer \| null | — | Position of the assignment in the element's `resources` array; `null` for the sentinel. |
| `resourceQuantity` | integer \| null | units | Quantity occupied of the pool; `null` for the sentinel. |
| `status` | `"completed"` \| `"terminated"` \| `"interrupted"` \| `"inFlight"` | — | Observable closing reason: normal end, BPMN `terminate`, an interrupting boundary timer (`SEMANTICS.md` R-BND-5), or stop/cancellation. `startedAt = null` distinguishes an unassigned wait. |
| `enabledAt` | number | seconds since `run.start` | Instant the token reached the element and became enabled to start. |
| `startedAt` | number \| null | seconds since `run.start` | Instant processing began; `null` if the activity was closed out while still queued. Never later than `observedUntil`: a grant that falls in closed time points to the next opening, and if that opening lies beyond the run's cutoff, the row reports the cutoff, not a future instant. |
| `endedAt` | number \| null | seconds since `run.start` | Instant it ended normally; only exists with `status = "completed"`. |
| `observedUntil` | number | seconds since `run.start` | `endedAt` when completed; the instant of `terminate`, cancellation, or stop for a partial lifecycle. |
| `resourceWait` | number | seconds | Portion of the wait attributable to lack of a resource; if `startedAt = null`, it is observed up to `observedUntil`. Does not include closed-calendar time. |
| `offHoursWait` | number | seconds | Closed time in `[enabledAt, endedAt ?? observedUntil]`. For completed rows it satisfies `endedAt − enabledAt = resourceWait + offHoursWait + processing` (R-CAL-7/8). *(identity test: LILA-028)* |
| `elementCost` | number | `run.currency` | Element's fixed cost, charged once on completion: first assignment according to the scenario, or the sentinel; 0 on additional/partial rows. |
| `resourceCost` | number | `run.currency` | Fixed cost and busy-time cost of this assignment; 0 if it never started. |
| `cost` | number | `run.currency` | Exact identity `elementCost + resourceCost`. |

A task with two AND pools, already started, produces two rows with the same
`activityInstanceId`; if it is still waiting at cutoff it produces a sentinel, not fictitious
requirements. There is no row with `resources[]`. This keeps the CSV flat and lets
occupancy/costs be reconstructed. `fixedCostTotal` is obtained from `Σ elementCost`: the fixed
amount lives only in the canonical row with the lowest `allocationIndex` actually emitted.
`process.totalCost = Σ cost`; summing `cost` for the element's fixed cost would double resources
and is forbidden. *(decision: ADR-025; test: LILA-033, LILA-034,
LILA-036, LILA-037)*

`started`, `completed`, `processing`, `resourceWait`, `offHoursWait`, `waitTime`, and the queue
interval that feeds `queueLength` are aggregated once per `(replication, activityInstanceId)`;
costs and pool occupancy are aggregated per row.

### `log.csv`

`log.csv` carries the **17 columns** of the previous table, in that same order and with the same
internal names (Bizagi Modeler does not publish an event log, so there are no column names to
replicate here; see section 10). Trimming the set would break v1 consumers (ADR-025).

When exporting (the CLI's CSV, `toCsv()`), `enabledAt`/`startedAt`/`endedAt` are additionally
derived into absolute ISO 8601 timestamps (`run.start + seconds`) in three columns **appended at
the end**, `enabledAtIso`/`startedAtIso`/`endedAtIso`; the raw CSV for programmatic processing
keeps the relative seconds, which remain the authoritative values because the ISO form is rounded
to the nearest millisecond. A null time column (the `startedAt` of a row that never started) also
leaves its ISO cell empty, and an unreadable `run.start` empties all three instead of aborting the
file. Without `run.start` the CSV stays at the 17 columns.

`lila run --csv` writes `log.csv` **in streaming**, row by row from `opts.onEvent`, with a 1 MiB
buffer and atomic publication via `rename`: the complete file is never in memory, and `RunResult`
does not retain the log (streaming mode, above). *(test: LILA-037)*

The event log, with a trivial column mapping, is compatible with XES (IEEE 1849) and OCEL 2.0 (see section 6 of the structure document).

---

## 8. `replications` / `ci95` and `warmup`

When `scenario.run.replications > 1`, every numeric KPI of interest (those of `process`, and optionally those of `elements`/`resources` that the CLI decides to print) is additionally summarized across replications:

```ts
interface ReplicationSummary {
  count: number;                     // complete replications summarized; >= 2
  kpis: Record<string, {             // keyed by KPI name, e.g. "process.cycleTime.mean"
    mean: number;
    sd: number;
    ci95: [number, number];          // lower and upper bound of the 95% confidence interval
  }>;
}
```

The dynamic segments of those names (BPMN ids of elements, flows, and resources) escape `.` as
`\.` before forming the path. So, for example, the KPI `processing.mean` of element `Task.A` is
named `elements.Task\.A.processing.mean`, without colliding with other valid ids. Ids with no dot
keep exactly the names shown above. *(test: LILA-027)*

- **`mean`/`sd`** — sample mean and standard deviation of the KPI across the `N` replications (one observation per replication, not per case).
- **`ci95`** — 95% confidence interval for the mean, `mean ± t(N-1, 0.975) × sd / √N` (Student's t with `N-1` degrees of freedom; for large `N` it approximates `1.96 × sd/√N`). This is a metric Bizagi Modeler only offers from What-If onward (section 3: "Replications — Bizagi Modeler ✓ what-if only / Lila ✓ always, with a 95% CI"); in Lila it is computed whenever `replications > 1`.

If `opts.signal.aborted` stops the run, the result carries `cancelled: true` and
`completedReplications`, which counts exclusively finished replications; the absence of
`cancelled` means a complete run. The top level keeps the processed work: it averages the complete
replications and the partial one if it exists. `replications`, when it can be computed with at
least two complete replications, always excludes the partial one; with fewer than two complete
ones it is omitted so as not to publish an invalid deviation or CI. A cancellation between
replications does not add a fictitious partial replication. *(test: LILA-029)*

`opts.onProgress`, when present, first receives `fraction = 0`, even if the first replication has
no events. The fraction is strictly monotonic, and a complete run ends at 1; a cancelled one may
end earlier. No per-event hook is installed when the callback is absent. *(test: LILA-029)*

**`warmup`**: `scenario.run.warmup` (seconds since `run.start`) excludes from **every** statistic the cases that **started** before the warmup ended. Those cases still occupy pools, form queues, and change when the measured cases start; their rows are still emitted, but the cohort stays out of `process`, `elements`, `resources`, costs, and the `queueLength`/utilization integrals. Measured cohorts' integrals are also clipped to `[warmup, t_stop]`. `throughputPerHour` uses the run's effective duration, excluding warmup itself, as the denominator. *(test: LILA-027, LILA-033, LILA-036)*

---

## 9. `warnings[]`

A list of strings, one per non-fatal condition detected during `resolveScenario`, `validate`, or `simulate`, that the user should be able to see without the run stopping. Examples (not exhaustive, see `SEMANTICS.md` for the complete list of rules that generate warnings):

- Probabilities of an XOR/OR that did not add up to 1 and were normalized.
- A key in the scenario's `elements` that does not correspond to any IR id (extra, not missing — a missing key is an error, not a warning).
- A dangling `lila:*Ref` reference into the catalog (see `BPMN_EXTENSION.md`).
- Use of a `normal`/`truncatedNormal` distribution with more than 1% probability of sampling a negative value (it is truncated to 0, but a warning is issued).
- Utilization greater than 1 from work that continues after a capacity drop with no preemption (`W-UTILIZACION-MAYOR-UNO`); the value is not truncated.
- A pool whose queue grows without stabilizing: more work arrives than it can dispatch, and there
  is no steady state (`W-RECURSO-SATURADO: <poolId>: la cola crece sin estabilizarse (λ/μ·c ≈ X)`,
  one per pool per run). The warning changes no metric; it warns that the `resourceWait.total` of
  that pool's tasks and its place in `bottlenecks` (section 6) grow with the run's duration and
  are not comparable to those of a stable pool. `X` is the ρ estimated from the log itself: the
  demand attributed to the pool — only the waits during which **it** was full, not the ones shared
  through AND or OR — over the units it granted, averaged across replications. A self-gated pool
  throttles its own attributed demand, so a mean `resources[poolId].utilization ≥ 0.9` is the
  second door into the same warning; it then prints
  `W-RECURSO-SATURADO: <poolId>: la cola crece sin estabilizarse (ocupación ≈ Y %)` instead, with
  the utilization as a whole percentage. The full criterion is in `SEMANTICS.md` § 17.
  *(LILA-191, #320)*

---

## 10. Column name mapping: internal → Bizagi Modeler

The CLI (`lila run`) prints the `elements` and `resources` tables with **Bizagi Modeler's column names**, verified against its official help (`help.bizagi.com`, levels 1–4 and `simulation_in_bizagi.htm`; see `investigacion-2026-09-03/02-bizagi-simulacion.md`), so that a user migrating from Bizagi Modeler can compare numbers without translating columns. Bizagi Modeler uses "Tokens" and "Instances" interchangeably depending on the help page; both observed variants are documented.

**A single name map** *(LILA-201)*. The tables below live in the code exactly once, in
`COLUMN_LABELS` (`packages/engine/src/format.ts`), keyed by `${scope}:${metric path}` — the same
`scope`/`metric` split that `compare()` produces (section 11). It is consumed by all four
surfaces that show results, and none of them redefines a name on its own:

| Surface | Column name | Duration unit |
|---|---|---|
| `lila run` (console tables) | `columnHeader(scope, metric, unit)` | `baseTimeUnit`, with suffix ` (min)` / ` (h)` … |
| `lila compare` (the *Metric* column) | `columnLabel(scope, metric)` | the row carries the unit; the label does not |
| `csv.ts`'s CSV (`elements.csv`, `flows.csv`, `resources.csv`, `process.csv`) | `columnLabel(scope, metric)` | **seconds** (section 1), which is why the label is bare: `Busy time`, not `Busy time (min)` |
| the web app's `ResultsView` | `columnLabel(...)` + ` (unit)` on durations | `baseTimeUnit`, same as the CLI |

In other words: the name is unique, and the unit suffix is added only by whoever converts to
`baseTimeUnit`. A metric with no name in the map (`queueLength.mean`, `offHoursWait.*`) keeps its
internal path instead of getting a made-up name. *(test: LILA-201)*

### "Process elements" table (levels 1–4)

| Internal field (`RunResult.elements[id]`) | Bizagi Modeler column name |
|---|---|
| `started` | Instances started (also "Tokens started") |
| `completed` | Instances completed (also "Tokens completed") |
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

`lila run`'s console, `elements.csv`, and the web app's "Process elements" tab print this table
**in full**, in this order and with the `Id`, `Name`, and `Type` columns in front *(LILA-201: until
then the console stopped at `Total time` and lost the "waiting for resource" group and the fixed
cost, which the CSV and the web app did carry)*. `lila compare` and the comparison view are not
results tables but KPI tables, and show their curated subset (section 11) with these same names.

`offHoursWait`, `queueLength`, `resources[id].busyTime`, the percentiles of `process.cycleTime`/`process.waitTime`, `throughputPerHour`, `costPerCase`, `process.totalCost`, and `bottlenecks` **have no equivalent column in Bizagi Modeler** — they are the extra metrics listed in section 3 of the structure document ("Extras Bizagi Modeler does not give"); the CLI prints them in additional tables without trying to name them "the Bizagi way", but their names live in the same map so console, CSV, and web app never write them differently.

### "Resources" table (levels 3–4)

| Internal field (`RunResult.resources[id]`) | Bizagi Modeler column name |
|---|---|
| `utilization` | Utilization (%) |
| `busyTime` | — (no column in Bizagi Modeler; a Lila extra, in unit-seconds) |
| `fixedCost` | Fixed cost |
| `unitCost` | Unit cost |
| `totalCost` | Total cost |

The table lists **one row per declared pool**, including those left at 0% utilization (section 4), just like Bizagi Modeler.

### "Sequence flows" table (level 1)

| Internal field (`RunResult.flows[id]`) | Bizagi Modeler column name |
|---|---|
| `count` | Instances/Tokens completed (for the sequence flow) |

### "Process summary" / "Process" table (Lila extras)

Bizagi Modeler does not publish this table; the names are Lila's own and come from the same map.

| Internal field (`RunResult.process`) | Column name |
|---|---|
| `started` | Instances started |
| `completed` | Instances completed |
| `inFlight` | In flight |
| `cycleTime.min` / `.max` / `.mean` / `.sd` | Cycle time minimum / maximum / average / standard deviation |
| `cycleTime.p50` / `.p90` / `.p95` | Cycle time p50 / p90 / p95 |
| `waitTime.min` / `.max` / `.mean` / `.sd` | Wait time minimum / maximum / average / standard deviation |
| `waitTime.p50` / `.p90` / `.p95` | Wait time p50 / p90 / p95 |
| `throughputPerHour` | Throughput per hour |
| `costPerCase` | Cost per case |
| `totalCost` | Total cost |
| `withinServiceLevel` | Within service level *(#316; empty without `run.serviceLevel`)* |
| — (row identity) | Outcome *(#316; the BPMN id of the `end`/`terminate` of a per-outcome row)* |

`process.csv` and the web app's "Process" tab carry all **22** columns. `lila run`'s console
prints a subset — `started`, `completed`, `inFlight`, the mean and the p50/p90/p95 percentiles of
`cycleTime` and `waitTime`, `throughputPerHour`, `costPerCase`, and `totalCost` — because all 22
do not fit legibly on one terminal row; the minimums, maximums, and standard deviations remain
intact in `--json` and in the CSV. *(LILA-201: previously the console called `Average cycle`,
`p50`, and `Throughput/hour` what the CSV and the web app already called `Cycle time average`,
`Cycle time p50`, and `Throughput per hour`, and printed neither `totalCost` nor the wait time.)*

### "Outcomes" table *(#316)*

`process.csv` keeps its first row as the run total and adds, after it, **one row per outcome**
(`process.byEndEvent`, section 5): the `Outcome` column carries the BPMN id of the `end` /
`terminate`, `Instances completed` its case count, and the `Cycle time` / `Wait time` columns its
own statistics. The columns that only mean something for the whole run — `Instances started`,
`In flight`, `Throughput per hour`, `Cost per case`, `Total cost` — are left empty in those rows.
The two new columns are appended at the end, so no v1 consumer loses a column or sees one move.

`lila run` prints the same breakdown as an `Outcomes` / `Desenlaces` table after the process
summary, with `Id`, `Name`, `Instances completed`, `Cycle time average / p50 / p95`,
`Wait time average` and — only with `run.serviceLevel` — `Within service level`. The web app's
"Process" tab shows the same table under the process one.

### "Bottlenecks" table

The ranking from section 6, with no equivalent in Bizagi Modeler. Columns: `Id`, `Name`,
`Total time (waiting for resource)` (= `elements:resourceWait.total`), and `Utilization (%)`
(= `resources:utilization`).

It is printed **always**, even when the scenario declares not a single pool: with no resources the
ranking is empty by construction (R-DEG-1). The English CLI says "No wait for a resource detected."
and the web app says "No resource wait detected."; both Spanish surfaces say "Sin espera por
recurso detectada." The section remains visible, so the console and the web app's `ResultsView`
card communicate the same result for the same `RunResult`. *(decision: LILA-201; test: `cli-run.test.ts`,
`ResultsView.test.tsx`)*

Confidence note: the exact names above are marked `[verified]` in the cited research, except for the breakdown of "waiting for resource" into separate Min/Max/Avg/Std.Dev/Total columns, which Bizagi Modeler's help describes as a group but without giving the literal text of each subcolumn — the pattern `Minimum/Maximum/Average/Standard deviation/Total time` is used for consistency with the `processing` group. If reproducing Bizagi Modeler's official level 3/4 example (M1's acceptance test, section 7 of the structure document) shows the real text differs, this document is then corrected without opening a separate ticket.

---

## 11. `compare(results[])` *(LILA-038)*

`compare` (`packages/engine/src/core/compare.ts`) places several `RunResult`s side by side to read
a what-if. It is a pure function in `core/`: it prints nothing — the console table is
`lila compare` (LILA-047), and the web view is LILA-064.

```ts
function compare(results: readonly RunResult[]): CompareResult;

interface CompareResult {
  count: number;        // results compared; index 0 of each array is the base
  rows: CompareRow[];
}

interface CompareRow {
  kpi: string;                    // path identical to replications.kpis (section 8)
  scope: 'elements' | 'flows' | 'resources' | 'process';
  id: string | null;              // unescaped BPMN id; null when scope = "process"
  metric: string;                 // e.g. "resourceWait.mean", "cycleTime.p95"
  base: number | null;
  values: (number | null)[];      // values[0] === base
  deltaAbs: (number | null)[];    // values[i] − base
  deltaRel: (number | null)[];    // (values[i] − base) / base
  significant: boolean[];         // significant[0] is always false
}
```

- **Base**: `results[0]`. Every delta is measured against it, never against the previous column.
- **Rows**: one per scalar numeric KPI, the same ones `numericKpis` flattens (sections 2–5), with
  the same `.` escaping on dynamic ids (section 8). `scope`/`id`/`metric` are that path already
  split, so the CLI can group by element, resource, or process without reimplementing the
  escaping.
- **Order**: the base result's KPIs in their order of appearance (elements, flows, resources,
  process) and, after that, the ones that only exist in later results — a pool new to the TO-BE —
  in result order. Two calls with the same input produce an identical `JSON.stringify`.
- **Outcomes** *(#316)*: the per-outcome KPIs are ordinary `process` rows whose `metric` is
  `byEndEvent.<endId>.<metric>` (with `id` still `null`, because the scope is `process`). They are
  compared across scenarios like any other KPI, with the same CI95 significance rule. `lila compare`
  and the web comparison show `byEndEvent.<endId>.cycleTime.mean` — and `withinServiceLevel` when the
  scenarios declare `run.serviceLevel` — in the default table; `--all` shows every percentile.
- **Missing keys**: a KPI that does not exist in some result is `null` there; it is not an error,
  and its `deltaAbs`/`deltaRel` are also `null`.
- **`deltaRel` with base 0**: `null`, never `Infinity` or `NaN`, so the JSON stays valid.
- **Empty list**: `compare([])` throws a `RangeError` with `E-COMPARE-VACIO`. A single result is
  valid: it gives deltas of 0 and no significance.
- **Significance**: `significant[i]` is `true` when the base's `ci95` interval and result `i`'s
  (section 8) **do not overlap**. Two intervals that only touch at one endpoint count as
  overlapping. A result with no `replications` — a single replication, or a cancelled run with
  fewer than two complete ones — has no CI: `significant` is `false`, and the deltas remain valid,
  just without statistical backing.
- The deltas read clean because R-DET-3 guarantees common random numbers: changing a pool's
  capacity does not alter the stream of elements that were not touched.

Acceptance (`examples/pedido`, `seed: 42`, 30 replications): going from 2 to 3 cashiers marks
`elements.Task_TomarPedido.resourceWait.mean` as significant (14.94 s → 2.19 s, CI [14.70, 15.19]
and [2.12, 2.27], disjoint) and does **not** mark `elements.Task_Preparar.resourceWait.mean`,
whose bottleneck is the `horno` pool with `capacity 1`, which the TO-BE does not touch.
*(test: LILA-038)*

> The four numbers above are from the example **without** calendars, which is how the engine ran
> through M2. Since LILA-041 `examples/pedido` simulates its `oficina` calendar, and the same
> acceptance test gives 14.97 s → 2.18 s, CI [14.57, 15.37] and [2.09, 2.27]: it remains
> significant and `Task_Preparar` remains not significant. The conclusion does not change; the
> decimals do.
> *(test: LILA-041, QA)*

---

## 12. XLSX export *(issue #80)*

`lila run --xlsx book.xlsx`, `lila compare --xlsx book.xlsx` and the "Export XLSX" buttons of the
web app write a spreadsheet with the same numbers as the CSV. It is a hand-written OOXML file over
`fflate` (`packages/engine/src/xlsx.ts`): inline strings, numeric cells, no shared string table and
no styles beyond the default one, which is the subset Excel, LibreOffice, Numbers, pandas and
openpyxl all read. The bytes are deterministic — the zip entries carry a fixed timestamp, so two
exports of the same run are identical.

The tables come from the **same row builders** as the CSV (`elementsRows`, `flowsRows`,
`resourcesRows`, `processRows` in `packages/engine/src/csv.ts`), so the two exports cannot diverge;
column names are the map of section 10, untranslated. Only the sheet names and the labels of the
sheets the workbook adds come from the message catalog (`Summary`/`Resumen`, …).

### `run --xlsx`: five sheets

| Sheet | Columns | Content |
|---|---|---|
| `Summary` | Section, Id, Name, Metric, Value | the `process` metrics of section 5, one per row (a metric with no value, such as `Within service level` without `run.serviceLevel`, has no row); the completed cases per end event when `process.byEndEvent` exists; and, per declared pool, `Capacity`, `Working hours` and `Payroll cost`, plus the total |
| `Elements` | those of `elements.csv` | identical rows to `elements.csv` |
| `Flows` | those of `flows.csv` | identical rows to `flows.csv` |
| `Resources` | those of `resources.csv` | identical rows to `resources.csv` |
| `Parameters` | Section, Id, Name, Parameter, Value | the **resolved** scenario that ran: run (start, duration, warmup, replications, seed, base time unit, currency), calendars, resources, arrivals, task times and gateway probabilities |

`Payroll cost` is `capacity × costPerHour × the open hours of the run` for the pool's calendar —
what the staffing costs whether it is busy or not. It is **not** `resources[id].unitCost`
(section 4), which only charges the hours actually occupied; both readings are in the workbook.
Without `run.duration` the hours are unknown and those cells stay empty.

The event log is **not** a sheet: a run of a few million rows exceeds the 1 048 576 rows a
worksheet holds. `--csv` keeps writing it in streaming (section 7).

### `compare --xlsx`: one sheet per scenario plus `Comparison`

Each scenario gets its own `Summary` sheet, named after the scenario (sanitized, clipped to 31
characters and made unique). The `Comparison` sheet has one row per KPI of `compare()`
(section 11) with `Kpi`, `Scope`, `Id`, `Name`, `Metric` and, per scenario, its value and the two
ends of its 95 % CI; every non-base scenario adds the absolute delta, the relative delta and
whether its interval **overlaps** the base's — `false` there is what the CLI prints as `*`. Without
replications there is no interval and the cell is empty, never `false`.
