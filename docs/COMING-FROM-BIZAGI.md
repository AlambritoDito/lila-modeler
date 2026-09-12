# Coming from Bizagi Modeler

> Read this in: [Español](es/COMING-FROM-BIZAGI.md)

This guide is for someone who has already run simulations in Bizagi Modeler and is opening Lila
Modeler for the first time. It says where each thing you know lives here, in Bizagi's own
vocabulary, so you do not have to relearn the workflow to get your first number out. Lila is a
discrete-event **simulator** for BPMN: an engine, a CLI, an MCP server and an editor around them.
It is not a process documentation or publishing suite — there is no Word/Web publishing, no
document templates, no shared repository of processes. Bizagi Modeler is cited here as the
reference and inspiration this project learned the workflow from, and as the source of the public
examples the engine is validated against.

## The four levels, as four steps

Bizagi teaches simulation as four levels, each adding one kind of parameter. Lila keeps the same
vocabulary and the same order in the **Simulate** view, as four steps:

| Bizagi level | Lila | What you fill in |
|---|---|---|
| Process validation | Simulate → step 1 | Run start, duration, replications, seed; max arrival count; gateway percentages; model validation |
| Time analysis | Simulate → step 2 | Interval between arrivals and processing time per element, constant or distribution |
| Resource analysis | Simulate → step 3 | Resource pools, availability, costs, and which task uses which pool |
| Calendar analysis | Simulate → step 4 | Calendars as a weekly grid, resource × calendar, capacity per shift |

Two things work differently from Bizagi, and both in your favour:

- **There is no level switch.** You never "enable" a level. The engine degrades gracefully: an
  element with no processing time takes zero time, a task with no resource has infinite capacity,
  a pool with no calendar is available 24×7. You can fill in step 3 and leave step 4 empty
  forever.
- **Steps are a reading order, not a wizard.** Everything is one scenario document; you can go
  back to step 1 after step 4 without redoing anything, and the validation list at the bottom of
  the panel is live in every step.

The four steps are a bar at the top of the Simulate panel, labelled **1 · Process validation**,
**2 · Time analysis**, **3 · Resource analysis** and **4 · Calendar analysis**. It opens on
step 1, the step you are on survives picking elements on the canvas and running the simulation,
and two things are there in every step: the validation list and **Advanced: scenario JSON**, which
is where the scenario `name`, its `description` and anything the form does not draw are edited.

Steps 2 and 3 also list the elements they are about — every task, timer and start event with the
time it has, every task with the pool it takes — so “what is still missing” is one look and not a
tour of the diagram; clicking a row selects that element on the canvas. The resource pools appear
in step 3 **and** in step 4, because a pool's calendar and its capacity per shift are edited inside
the pool and they are level 4, not level 3.

## Screen by screen

Field-level names — Lila ↔ BPSim 2.0 ↔ qbp ↔ Bizagi Modeler — are in one table in
[`SCENARIO_FORMAT.md` § 8](SCENARIO_FORMAT.md#8-field-mapping-lila--bpsim-20--qbp--bizagi-modeler);
this section is the screen-level version of it.

### Scenario properties

| Bizagi | Lila |
|---|---|
| Scenario name, Description | `name` / `description`, in **Advanced: scenario JSON** (the name is the panel's heading) |
| Start date | step 1, `run.start` (ISO 8601 **with offset**) |
| Duration | step 1, `run.duration`; may be left empty, then the run ends when the last case drains |
| Base time unit, Currency | step 1, `run.baseTimeUnit`, `run.currency` |
| Replications (what-if only) | step 1, `run.replications` — available in every run, not only in a comparison |
| — | `run.seed` and `run.warmup`, which Bizagi does not expose |

### Arrivals

| Bizagi | Lila |
|---|---|
| Max arrival count | step 1, `triggerCount` on the start event |
| Interval / time between arrivals | step 2, `interTriggerTimer` on the start event |
| Arrival calendar | step 4, `calendar` on the start event |

`triggerCount` with no interval means all N cases arrive at `t = 0`, which is what Bizagi's level 1
does.

### Times and distributions

Every duration in Lila is in **seconds**; there is no per-field unit picker. The distribution is an
object with **named** parameters, so nothing depends on argument order:

| Bizagi | Lila | Watch out |
|---|---|---|
| Constant | `constant` (`value`) | |
| Uniform, Triangular | `uniform`, `triangular` | |
| Exponential | `exponential` (`mean`) | `mean`, never the rate λ |
| Normal, Truncated normal | `normal`, `truncatedNormal` | `normal` is truncated at 0 |
| Log normal *(Bizagi's name may differ by version)* | `lognormal` (`mean`, `sd`) | of the **variable**, not of its logarithm — same convention as Bizagi |
| Gamma, Erlang, Weibull, Beta | `gamma`, `erlang`, `weibull`, `beta` | `erlang`'s `mean` is the total, not per phase |
| Poisson, Binomial | `poisson`, `binomial` | |
| — | `user` | empirical points, no Bizagi equivalent |

### Resources

| Bizagi | Lila |
|---|---|
| Resource, Name | step 3, a key in `resources` with its `name` |
| Type (role / equipment) | `type` |
| Availability | `capacity` (an integer: how many units exist) |
| Fixed cost | `fixedCost`, charged once per token that takes the resource |
| Cost per hour | `costPerHour`, charged over busy time |

### Task assignment

| Bizagi | Lila |
|---|---|
| Activity resources *(Bizagi's name may differ by version)* | step 3, `resources[]` on the selected element |
| Quantity | `quantity` inside that entry |
| AND / OR | `selection: "and"` / `"or"` |
| Fixed cost (activity) | `fixedCost` on the element |
| — | **Assign a lane to a pool** in one action: every task in the lane gets the pool with quantity 1 |

The lane action is the fastest way in: model your lanes as roles, then one action per lane
replaces a dozen hand assignments. Lanes stay labels for the engine; the action only writes the
per-task assignment for you.

### Calendars

| Bizagi | Lila |
|---|---|
| Calendars | step 4, `calendars`, keyed by name; the key `default` applies to every pool that declares none |
| Recurrence + start time + duration | one weekly grid: `intervals[]` of days × `from`–`to` (24 h, `to` exclusive) |
| Resource calendar | `calendar` on the pool |
| «Resource \| Morning \| Day \| Night» quantities | `capacity` as a list of `{ calendar, capacity }`: one pool, capacity per shift |
| Holidays | reserved, not in v1; so are monthly/annual recurrences, DST and per-calendar time zones |

No calendar anywhere means 24×7. A task's processing time pauses when its shift closes and resumes
when it opens; that closed time is reported separately as `offHoursWait`.

### Results

Result columns keep Bizagi's table and column names on purpose, so you can compare numbers without
translating headers (the full map is in [`RESULTS_FORMAT.md` § 10](RESULTS_FORMAT.md)):

| Bizagi table | Lila |
|---|---|
| Process elements | same name; Instances started/completed, Minimum/Maximum/Average/Total time, the same five "waiting for resource" columns, Total fixed cost |
| Resources | same name; Utilization (%), Fixed cost, Unit cost, Total cost — one row per pool, including pools at 0 % |
| Sequence flows | same name; instances completed per flow |
| Process (summary) | Lila's own table (Bizagi does not publish one) |

Extras with no Bizagi column: p50/p90/p95 of cycle time and wait, mean and maximum queue length per
activity, throughput per hour, cost per case, a bottleneck ranking, a per-case event log, and
off-hours wait split out from resource wait.

| Bizagi | Lila |
|---|---|
| What-if analysis *(Bizagi's name may differ by version)* | **Compare** mode, or `lila compare`: scenarios side by side, differences marked, 95 % confidence intervals when replications ≥ 2 |
| Export results to Excel *(Bizagi's name may differ by version)* | CSV per table and a single `.xlsx` (`--csv`, `--xlsx`, or the export buttons in Results) |
| Watch the tokens move | **Animate**: Play from Results replays replication 1 of the stored run over the diagram, with per-element counters coming from the engine's own event log — not from a toy walker. The separate **Validate paths** mode is the didactic bpmn-js animation and reads no scenario at all |

## Three differences you will feel

**1. Your Bizagi `.bpmn` brings the drawing, not the numbers.** Bizagi Modeler does not export
simulation parameters: verified on five real files, only colours travel in the `bizagi:` namespace.
So importing works, and then step 1 to step 4 are re-entered here once. Budget a few minutes for
it, and use the lane-to-pool action to make step 3 nearly free.

**2. Shared paths are duplicated, because branching is probabilistic.** There is no routing on case
data in v1 — `conditionExpression` is ignored, with a `W-COND` warning, and `conditions` is a
reserved field. Each outgoing flow of a gateway carries a percentage. The practical consequence is
in the shape of the diagram: a "deny and inform the applicant" step that two different gateways can
reach appears **once per gateway**, as its own pair of tasks, instead of being one shared node the
data routes into. See `examples/tarjeta-credito`, which is modelled exactly that way.

**3. Resources have no persistent identity.** A pool is a count of interchangeable units, not a
list of named people: "Nurse, capacity 3" is three anonymous nurses, and a case that comes back
later is not given the same one. Utilization, busy time and cost are reported **per pool**. If you
need named individuals, model them as one pool of capacity 1 each.

Four smaller things worth knowing before you compare numbers against a Bizagi run:

- **Seeds are deterministic.** Same scenario, same seed, byte-for-byte same result — so a
  difference between two runs is a difference you made.
- **Utilization is measured over the window Lila actually simulated** (`[warmup, t_stop]`), not
  over a declared duration. At calendar level that differs from Bizagi's denominator by a constant
  factor; the exact conversion is difference D7 in the checklist.
- **A saturated system (ρ ≈ 1) has no steady state**, so its *mean* cycle time depends on the
  transient and two correct simulators can disagree by a lot; minimum, maximum and utilization
  still match. That is difference D6.
- **A single run is noisy.** Bizagi publishes single runs; differences D2 and D5 are exactly that.
  Use 30 replications and read the confidence interval.

All four are documented, with figures, in
[the reference behaviour checklist](BIZAGI_PARITY.md#documented-differences-lila-044-fixed-in-lila-187).

## Try it: Bizagi's published level-3 example

`examples/bizagi-levels/level-3` is the "Emergency attendance process" from Bizagi's own level-3
tutorial, reconstructed file by file, with the published figures recorded in `expected.json`.

In the web app ([Pages build](https://alambritodito.github.io/lila-modeler/app/) or the desktop
app) the example is opened as a diagram plus a pasted scenario, because a `.lila` project also
needs a manifest that the repository does not ship for this example:

1. File → **Open .bpmn**, pick `examples/bizagi-levels/level-3/model.bpmn`.
2. Go to **Simulate**, open **Advanced: scenario JSON** at the bottom of step 1, replace its text
   with the contents of `examples/bizagi-levels/level-3/scenario.json`, and press **Apply**.
3. Set Replications to 30 in step 1 and press **Run simulation**.

The same run from the CLI, from the repository root:

```bash
npx lila run \
  examples/bizagi-levels/level-3/model.bpmn examples/bizagi-levels/level-3/scenario.json \
  --replications 30 --seed 42
```

In the **Resources** table, the `Nurse` row reads a utilization of about **69.7 %**, against the
**69.75 %** Bizagi publishes for the same configuration — and the other five pools, the six costs
and the mean cycle time land just as close. What you should expect for each number, level by level,
and the four places where the two engines do not agree, is in
[`BIZAGI_PARITY.md`](BIZAGI_PARITY.md).

For a complete case built from scratch rather than reconstructed — one pool, three lanes, thirteen
tasks, two rejection branches, an AS-IS and a TO-BE to compare — see
[`examples/tarjeta-credito`](../examples/tarjeta-credito/README.md).

---

Bizagi and Bizagi Modeler are trademarks of Bizagi. Lila Modeler is an independent open-source
project, not affiliated with or endorsed by Bizagi.
