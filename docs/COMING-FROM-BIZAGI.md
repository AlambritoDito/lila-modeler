# Coming from Bizagi Modeler

> Read this in: [Español](es/COMING-FROM-BIZAGI.md)

This guide is for someone who has already run simulations in Bizagi Modeler and is opening Lila
Modeler for the first time. It says where each thing you know lives here, in Bizagi's own
vocabulary, so you do not have to relearn the workflow to get your first number out. Lila is a
discrete-event **simulator** for BPMN: an engine, a CLI, an MCP server and an editor around them.
It is not a process documentation or publishing suite: File → Export process document writes a
Word (.docx) file or a single-page HTML with the diagram, each element's documentation and the
scenario and results tables, but there are no document templates. One project can hold several
processes, but there is no shared multi-user repository. Bizagi Modeler is cited here as the
reference and inspiration this project learned the workflow from, and as the source of the public
examples the engine is validated against.

## The four levels, as six steps

Bizagi teaches simulation as four levels, each adding one kind of parameter. Lila's **Simulate**
view has six steps, named after what each one edits: **Arrivals**, **Times**, **Routes**,
**Resources**, **Calendars** and **Run**. Every Bizagi level maps onto them like this:

| Bizagi level | Lila step | What you fill in |
|---|---|---|
| Process validation | Run (run window), Routes (gateway percentages) and Arrivals (max arrival count) | Run start, duration, replications, seed; gateway percentages; max arrival count; model validation |
| Time analysis | Times (processing time) and Arrivals (interval between arrivals) | Processing time per task and timer; interval between arrivals per start event; constant or distribution |
| Resource analysis | Resources | Resource pools, availability, costs, and which task uses which pool |
| Calendar analysis | Calendars (the calendars and which element follows which) and Resources (a pool's calendar and capacity per shift, on the pool) | Calendars as day presets + from–to ranges and a weekly grid, resource × calendar, capacity per shift |

Two things work differently from Bizagi, and both in your favour:

- **There is no level switch.** You never "enable" a level. The engine degrades gracefully: an
  element with no processing time takes zero time, a task with no resource has infinite capacity,
  a pool with no calendar is available 24×7. You can fill in Resources and leave Calendars empty
  forever.
- **Steps are a reading order, not a wizard.** Everything is one scenario document; you can go
  back to Times after Calendars without redoing anything, and the validation list at the
  bottom of the panel is live in every step.

The six steps are a bar across the window, right under the top bar, next to **Scenario ▾** (in the
detached panel window, a compact bar at its top). It opens on **Times**, the step
you are on survives picking elements on the canvas and running the simulation, and two things are
there in every step: the validation list and **Advanced: scenario JSON**, which is where the
scenario `name`, its `description` and anything the form does not draw are edited.

Arrivals, Times, Routes and Resources also list the elements they are about — every start event
with how often and how many cases it creates, every task and timer with its time, every gateway
with its split, every task with the pool it takes — so “what is still missing” is one look and not a tour of the diagram; clicking a
row selects that element on the canvas. Every control lives in exactly one step: the resource pools
(their calendar and capacity per shift included) are edited in Resources, and Calendars says so.

With an activity selected in **Model**, the properties panel shows a **Quick view · simulation**
block: its time distribution and resource in the active scenario, and its wait in the last run (or
*no run*). The wait is the wait for a resource — the same measure as the canvas labels, the Results
table and its «waiting for resource» columns. It is the **p95** of the cases measured after the warmup in the first replication,
when that run's event-log sample is complete; a longer run (more than 10,000 log rows in its first
replication) shows the **mean** resource wait over every replication instead, and says so. Its **Edit in
Times** / **Edit in Resources** links open that step in Simulate.

## Screen by screen

Field-level names — Lila ↔ BPSim 2.0 ↔ qbp ↔ Bizagi Modeler — are in one table in
[`SCENARIO_FORMAT.md` § 8](SCENARIO_FORMAT.md#8-field-mapping-lila--bpsim-20--qbp--bizagi-modeler);
this section is the screen-level version of it.

### Scenario properties

| Bizagi | Lila |
|---|---|
| Scenario name, Description | `name` / `description`, in **Advanced: scenario JSON** (the name is the panel's heading) |
| Start date | Run, `run.start` (ISO 8601 **with offset**) |
| Duration | Run, `run.duration`; may be left empty, then the run ends when the last case drains |
| Base time unit, Currency | Run, `run.baseTimeUnit`, `run.currency` |
| Replications (what-if only) | Run, `run.replications` — available in every run, not only in a comparison |
| — | `run.seed` and `run.warmup`, which Bizagi does not expose |

### Arrivals

| Bizagi | Lila |
|---|---|
| Max arrival count | Arrivals, `triggerCount` on the start event |
| Interval / time between arrivals | Arrivals, `interTriggerTimer` on the start event |
| Arrival calendar | Calendars, `calendar` on the start event |

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
| Resource, Name | Resources, a key in `resources` with its `name` |
| Type (role / equipment) | `type` |
| Availability | `capacity` (an integer: how many units exist) |
| Fixed cost | `fixedCost`, charged once per token that takes the resource |
| Cost per hour | `costPerHour`, charged over busy time |

### Task assignment

| Bizagi | Lila |
|---|---|
| Activity resources *(Bizagi's name may differ by version)* | Resources, `resources[]` on the selected element |
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
| Calendars | Calendars, `calendars`, keyed by name; the key `default` applies to every pool that declares none |
| Recurrence + start time + duration | «Mon–Fri / Every day / Weekend» or any days + from–to, one `intervals[]` entry per range, and a weekly grid to paint (24 h, `to` exclusive, `"24:00"` allowed) |
| Resource calendar | `calendar` on the pool |
| «Resource \| Morning \| Day \| Night» quantities | `capacity` as a list of `{ calendar, capacity }`: one pool, capacity per shift |
| Recurrence: monthly, yearly | «Repeats»: day N (or the last day) of the month, the first…fifth or last weekday of the month, or a date every year (`monthDays`, `monthWeekdays`, `dates`) |
| Holidays | «Holidays» under the ranges: a date once, or «Every year» (`holidays`); closed the whole day |
| Recurrence every N weeks/months, DST, per-calendar time zone | not in v1: calendars keep `run.start`'s offset for the whole run |

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

Next to the tables, Results draws a few charts: utilization per resource, instances started per
task, cycle and wait time p50/p90/p95, and a histogram of cycle time per case of the first
replication. Each chart is drawn from the same numbers as its table and prints them on its bars;
the table stays the reference.

| Bizagi | Lila |
|---|---|
| What-if analysis *(Bizagi's name may differ by version)* | **Compare with…** in Results, or `lila compare`: scenarios side by side, differences marked, 95 % confidence intervals when replications ≥ 2, and bar charts of average cycle time, cost per case and utilization with each scenario's delta against the base |
| Export results to Excel *(Bizagi's name may differ by version)* | CSV per table and a single `.xlsx` (`--csv`, `--xlsx`, or the export buttons in Results) |
| Publish to Word / Web | File → Export process document (Word or HTML): cover, diagram, process description, one section per element in flow order grouped by lane, then the scenario and the results tables, with the charts of the run. No templates or table of contents field; Word's navigation pane lists the headings |
| Watch the tokens move | **Tokens** on the Results map (`Space` or ▶) replay replication 1 of the stored run over the diagram, with per-element counters coming from the engine's own event log — not from a toy walker. **Validate paths**, a Model tool, is the didactic bpmn-js animation and reads no scenario at all |

## Three differences you will feel

**1. Your Bizagi `.bpmn` brings the drawing, not the numbers.** Bizagi Modeler does not export
simulation parameters: verified on five real files, only colours travel in the `bizagi:` namespace.
So importing works, and then the Simulate steps are re-entered here once. Budget a few minutes for
it, and use the lane-to-pool action to make Resources nearly free.

**2. Shared paths are duplicated, because branching is probabilistic.** There is no routing on case
data in v1 — `conditionExpression` is ignored, with a `W-COND` warning, and `conditions` is a
reserved field. Each outgoing flow of a gateway carries a percentage. The practical consequence is
in the shape of the diagram: a "deny and inform the applicant" step that two different gateways can
reach appears **once per gateway**, as its own pair of tasks, instead of being one shared node the
data routes into. See `packages/engine/test/fixtures/service-request`, which is modelled exactly that way.

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

1. File → **Import BPMN…**, pick `examples/bizagi-levels/level-3/model.bpmn`.
2. Go to **Simulate**, open **Advanced: scenario JSON** at the bottom of the panel, replace its text
   with the contents of `examples/bizagi-levels/level-3/scenario.json`, and press **Apply**.
3. Set Replications to 30 in Run and press **Run simulation**.

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


---

Bizagi and Bizagi Modeler are trademarks of Bizagi. Lila Modeler is an independent open-source
project, not affiliated with or endorsed by Bizagi.
