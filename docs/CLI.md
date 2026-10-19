# CLI (LILA-045/046/047/053, #450)

> Read this in: [Español](es/CLI.md)

`lila` is the command-line front end of `@lila-modeler/engine`: the same validation and simulation
pipeline used by the web app, the desktop app and the MCP server, driven from a terminal. This
page is the reference an agent or a script needs: every command with one real example, its exit
codes, what `--json`/`--csv`/`--xlsx` write, and how to read the result.

Every example below runs from the repository root, against the committed
[`examples/pedido`](../examples/pedido) benchmark. Requires Node.js **22 or later**.

## Install

The CLI ships in the engine package, [`@lila-modeler/engine`](https://www.npmjs.com/package/@lila-modeler/engine)
on npm, under the `beta` tag while the project is pre-1.0. Install it, or run it without installing:

```bash
npm install -g @lila-modeler/engine@beta      # puts `lila` on your PATH
npx -p @lila-modeler/engine@beta lila validate model.bpmn
npx @lila-modeler/engine@beta validate model.bpmn
```

The examples below use `npx lila …` from a checkout of the repository, which also has the
`examples/pedido` benchmark they run against:

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npx lila` then resolves the workspace's own binary (`packages/engine/bin/lila.js`), with no
registry lookup.

`npx lila` only finds this CLI inside the checkout (after `npm ci`). Anywhere else it would fetch
the unrelated `lila` package from npm, so from another directory use one of the
`@lila-modeler/engine` commands above, call the bin directly (`node
<checkout>/packages/engine/bin/lila.js …`) or use `npx --no lila …`, which refuses to install.

## `validate`

Parses a `.bpmn` file (or one process of a `.lila`, see [below](#a-lila-as-input-466)), prints its IR (nodes, flows, lanes) and the full validation
(`docs/SEMANTICS.md` §17 error/warning codes). Warnings alone still exit `0`; any error exits `1`.

```bash
npx lila validate examples/pedido/model.bpmn
```
Exit code: `0`.

A model outside the supported profile — here, a boundary event, which the engine does not
simulate (`docs/SEMANTICS.md` §2) — exits `1` and names every problem:

```bash
npx lila validate packages/engine/test/fixtures/boundary-event.bpmn
```
Exit code: `1`.

`--json` prints the same report (`{ ir, ignoredProcessIds, errors, warnings }`) as one JSON
document instead of the text above; the exit code rule is the same.

## `run`

Validates model and scenario, simulates with replications, and prints the Bizagi-style tables
(process elements, sequence flows, resources) plus Lila's extras: bottleneck ranking, process
summary, per-outcome breakdown. Exits `1` if the model or the scenario has a validation error, or
if the scenario's `model` does not match the file given on the command line; `0` otherwise.

```bash
npx lila run \
  examples/pedido/model.bpmn examples/pedido/as-is.scenario.json \
  --seed 42 --replications 3 \
  --json results/run.json --csv results/csv --xlsx results/as-is.xlsx
```
Exit code: `0`.

- `--json <file>` writes the deterministic `RunResult` (`docs/RESULTS_FORMAT.md`) as one JSON
  document. Its shape is `runResultSchema`, exported from `@lila-modeler/engine/result-schema` — validate
  against it before trusting a parsed file.
- `--csv <directory>` writes `elements.csv`, `flows.csv`, `resources.csv`, `process.csv` (RFC
  4180) and `log.csv` (the event log, streamed while the run executes, ISO timestamps from
  `run.start`). It is the only flag that writes the event log; `--json` and `--xlsx` do not
  carry it.
- `--xlsx <file>` writes one workbook with the Summary, Elements, Flows, Resources and Parameters
  sheets. No event log sheet — use `--csv` for that.
- All three create missing directories, write to a temporary path and rename atomically, and
  refuse to overwrite a path that is a directory.
- `--save` (with a `.lila` and a scenario of it) stores the run in the project, as the app does;
  see «Storing a run» under [`export`](#export-538).

## `compare`

Simulates two or more scenarios against the same model and prints them side by side: value plus
relative delta against the first (base) scenario, with a `*` marking a statistically significant
difference at the 95% confidence level.

```bash
npx lila compare \
  examples/pedido/model.bpmn \
  examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json \
  --seed 42 --replications 3 \
  --json results/compare.json
```
Exit code: `0`.

The default table is a curated KPI subset; `--all` prints every metric `compare()` produces for
every element, resource, flow and outcome. `--json <file>` writes the `CompareResult`; `--xlsx
<file>` writes one workbook with one tab per scenario plus a Comparison tab. `compare` has no
`--csv` — it compares finished runs, it does not replay one.

## `export` (#538)

Produces the deliverables without the app — no window, no browser — from the same engine code
the app uses:

- `lila export diagram <model.bpmn|project.lila>` draws the diagram with the engine's own SVG
  renderer (the BPMN DI geometry, Lila Light colours on white). Without `--out` it prints the SVG
  on stdout.
- `lila export doc <project.lila> --out file.docx|file.html` writes the process document, as the
  app's «Export document»: diagram, descriptions in flow order, the scenario and the results of
  a stored run. The HTML embeds the SVG diagram. The Word file has **no diagram**, and neither
  format has the run's charts: Word needs a PNG and the engine has no rasteriser. A note on stderr
  says what was left out.
- `lila export results <project.lila> --out book.xlsx|directory` writes the results of a stored
  run: one `.xlsx` (Summary, Elements, Flows, Resources, Parameters), or with `--format csv`
  `elements.csv`, `flows.csv`, `resources.csv` and `process.csv` in the directory, the same files
  `lila run` writes (a stored run keeps no event log, so there is no `log.csv`).

`--format` defaults to the extension of `--out` (`.docx`, `.html`, `.xlsx`). `--process` picks
the process of a repository, as elsewhere. **Runs** are the ones the app saved in the `.lila`:
`--run latest` (the default) is the run of the current model and scenario, `--scenario <name>`
narrows it to one scenario (needed when several scenarios have a current run), and `--run <id>`
picks one by id — an error lists the ids; `--run <id>` and `--scenario` together are an error. The document only takes a current run and, without one,
goes without results; `results` without a run is an error saying so. An older run's results are
exported against the model it ran on.

**Nothing is overwritten**: an existing output file is an error and nothing is written, unless
`--force`. The file being exported (the `.lila` or `.bpmn`) is never a destination, `--force` or
not, by any path that reaches it. Every file is written to a temporary file next to it and then
published at once, so an error never leaves half a file.

```bash
npx lila export diagram examples/pedido.lila --out results/pedido.svg
```
Exit code: `0`.

```bash
npx lila export doc examples/pedido.lila --out results/pedido.html
```
Exit code: `0`.

**Storing a run**: `lila run <project.lila> <scenario> --save` simulates a scenario of the archive
and stores the run in the `.lila` exactly as the app does (same shape, the model and scenario
revisions it ran on, built by the same engine function), so the app opens it as the current run
and `lila export` uses it. The write is atomic and under the file's lock; concurrent saves all
land, and a save after the model or that scenario changed is refused. A `.bpmn` or a scenario file
on disk cannot be saved. The app keeps every run, and so does `--save`:

```text
npx lila run project.lila as-is --seed 42 --replications 5 --save
npx lila export results project.lila --out results/as-is.xlsx
```

`examples/pedido.lila` stores no run, so its results cannot be exported until one is saved (the
message says how):

```bash
npx lila export results examples/pedido.lila --out results/pedido.xlsx
```
Exit code: `1`.

## `process annotate` and `process raci` (#99)

Document a process from the terminal, the way the app's properties panel does, and read back its
RACI matrix:

- `lila process annotate <project.lila> <elementId>` writes into the element with that BPMN id:
  `--documentation <text>` replaces its description (`""` removes it); `--responsibility TYPE:role`
  (repeatable, `TYPE` one of `R`, `A`, `C`, `I`) replaces its whole RACI list, and
  `--clear-responsibilities` empties it; `--ref kind=id` (repeatable; `systemRef`, `documentRef`,
  `riskRef`, `controlRef`, `kpiRef`, `input`, `output`) replaces the lists of the kinds given
  (`kind=` empties one); `--attribute id=value` (repeatable, by attribute id or name) sets an
  extended attribute, checked against the project's attribute definitions (`id=` removes the
  value; the attributes not given stay). It prints the element as it ends up; `--json` prints
  `{ file, process, elementId, dryRun, changed, written, before, after }`.
- `lila process raci <project.lila>` prints the RACI matrix: a row per element with
  responsibilities, in the order of the process document (`lila export doc`), a column per role.
  `--json` prints `{ file, process, roles, rows }`; `--csv` prints `id,name,lane,<roles>` as CSV.

`--dry-run` shows the result and writes nothing. A write saves the `.lila` atomically, under its
lock, with every other process unchanged (see [A `.lila` as input](#a-lila-as-input-466)); the
model's revision goes up by one, as when the app saves. An unknown element, a type that is not
RACI or an attribute value that does not fit its definition is an error, and nothing is written.

```bash
npx lila process annotate examples/pedido.lila Task_TomarPedido --responsibility R:cajero --responsibility A:gerente --ref systemRef=POS --dry-run
```
Exit code: `0`.

```bash
npx lila process raci examples/pedido.lila --json
```
Exit code: `0`.

## `process attribute` (#633)

Define the extended attributes an element can then have (`--attribute` above), as the app's
attribute dialog does, and list them:

- `lila process attribute define <project.lila> --name <name> --type text|number|list|date
  --applies-to task|gateway|event|subProcess|lane|process` defines one, with `--option <value>`
  (repeatable) for a list and `--default <value>`. Pass the whole definition every time. It
  changes the definition with `--id`; without it, the one with that name (any case) for that
  element type; else it creates one with a deterministic id, `Attr_` and the name in lowercase
  ASCII (`SLA (h)` → `Attr_sla_h`), so running it again changes nothing. The rules are the
  dialog's: a name unique per element type, a list with at least one option, options only on a
  list, a default that fits. `--remove` (with `--id`, or `--name` and `--applies-to`) removes the
  definition and its values; retyping it, changing `--applies-to` or dropping options removes the
  values that no longer fit. It prints the definition and each value removed; `--json` prints
  `{ file, process, dryRun, changed, written, before, after, removedValues, definitions }`.
- `lila process attribute list <project.lila>` prints the definitions of the process; `--json`
  prints `{ file, process, definitions }`.

`--dry-run` shows the result, values to remove included, and writes nothing. A write saves the
`.lila` as `process annotate` does.

```bash
npx lila process attribute define examples/pedido.lila --name SLA --type number --applies-to task --default 24 --dry-run
```
Exit code: `0`.

```bash
npx lila process attribute list examples/pedido.lila --json
```
Exit code: `0`.

## `scenario import` and `scenario template` (#514)

The app's «Download template» and «Import Excel/CSV…» (`docs/SCENARIO_SHEETS.md`) on a scenario
of a `.lila`:

- `lila scenario template <project.lila> <scenario> --out sheet.xlsx` writes the scenario sheet
  (Elements, Arrivals, Resources, Assignments, Calendars), filled in with the scenario's values,
  for a person to fill in. An existing file is refused unless `--force`.
- `lila scenario import <project.lila> <scenario> <sheet.xlsx|sheet.csv>` plans the sheet against
  the resolved scenario and prints each change (`Cashier (cajero) · capacity: 2 → 3`), the rows not
  applied and the notes, then writes the changes into the scenario's own file — its delta when it
  `extends` another, exactly as the app does. A plan that would leave the scenario with errors is
  refused and nothing is written. `--dry-run` prints the plan and writes nothing; `--json` prints
  `{ file, process, scenario, sheet, dryRun, written, tables, changes, issues }`.

```bash
npx lila scenario template examples/pedido.lila as-is --out results/as-is.xlsx
```
Exit code: `0`.

```text
npx lila scenario template project.lila as-is --out as-is.xlsx
# … a person fills in as-is.xlsx …
npx lila scenario import project.lila as-is as-is.xlsx --dry-run
npx lila scenario import project.lila as-is as-is.xlsx
```

## `project show` and `scenario show` (#628)

What a `.lila` holds, read without writing anything — no write, no revision change:

- `lila project show <project.lila>` prints the project's name and format version (2 for a
  repository of several processes, 1 otherwise) and, per process, its slug, name, `bpmn:process`
  id, model revision and number of flow nodes, its scenarios (entry, name, revision, `extends`)
  and its saved runs (id, scenario, replications, simulated start, and whether the run is
  **current** or **stale**: stale when the model or the scenario changed after it). A `.lila`
  keeps no date of when a run was taken; `start` is the `run.start` of the scenario it ran.
  `--json` prints `{ file, name, formatVersion, processes: [{ slug, name, processId,
  modelRevision, elements, scenarios: [{ entry, name, revision, extends }], runs: [{ id,
  scenario, start, replications, current }], attributes }] }`, where `attributes` are the
  extended attribute definitions of the process (see `process attribute`), `null` when the model
  cannot be read back whole.
- `lila scenario show <project.lila> <scenario>` prints the scenario as stored (with its
  `extends`), or with `--resolved` merged through `extends` with the engine's defaults — the
  object `patch_scenario` patches, `model` relative to the scenario. Then the validator's notes
  against the process model (errors `E-…` first, then warnings `W-…`), the checks `run` makes
  before it simulates, so it doubles as a scenario lint; it still exits `0` when there are errors.
  `--json` prints `{ file, process, entry, revision, resolved, scenario, runnable, notes }`.

```bash
npx lila project show examples/pedido.lila --json
```
Exit code: `0`.

```bash
npx lila scenario show examples/pedido.lila to-be-3-cajeros --resolved
```
Exit code: `0`.

## `scenario patch` and `project create` (#635)

The CLI side of the MCP tools `patch_scenario` (for a `.lila`) and `create_project`
([`docs/MCP.md`](MCP.md#mcp-and-cli-side-by-side)), over the same engine functions:

- `lila scenario patch <project.lila> <scenario> --patch <ops.json>` applies a
  [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) (`add`, `replace`, `remove` and `test`;
  no `move` or `copy`) to a scenario of the `.lila`, validates the result against the process
  model and writes it only when it validates. Without `--save-to` it patches the scenario in
  place: the patch applies to the resolved scenario, which is written whole, without `extends`.
  With `--save-to name` it creates (or replaces) the scenario `name`, which `extends` the scenario
  given (or `--extends-from name`) and holds only the keys the patch touched. `--name` and
  `--description` set those of the result. An invalid patch, or a result that does not validate,
  exits `1` and writes nothing. A patch that changes nothing writes nothing and says so: the
  scenario keeps its revision and its saved runs stay current. `--dry-run` validates everything
  and writes nothing; `--json` prints `{ scenario, file, process, entry, written, dryRun, notes }`.
  Patching a loose `.json` scenario is MCP only: from the CLI, edit the file.
- `lila project create <path.lila> --name name --bpmn <file.bpmn>` creates a new `.lila` with one
  process. A model with validation errors exits `1`, unless `--allow-unsimulatable`: then it is
  kept as a diagram that does not simulate, its errors printed as notes. `--scenario name=file.json`
  (repeatable) adds a scenario saved as `name.scenario.json`; a scenario that cannot run yet is
  kept as a draft and listed with what it lacks. A model without a diagram gets one. The file is
  written whole or not at all, and an existing file exits `1` unless `--force`. `--json` prints
  `{ file, name, processId, laidOut, warnings, notes, scenarios }`.

```bash
npx lila scenario patch examples/pedido.lila as-is --patch examples/outline/pedido-patch.json --save-to to-be-4-cocineros --dry-run
```
Exit code: `0`.

```text
Dry run: the result validates and would be written to to-be-4-cocineros.scenario.json; nothing was written.
warning W-ELEMENTO-SIN-PARAMETROS: the element exists in the model and has no parameters; it takes its default values (elements.Task_Empacar).
```

The file already exists, so `project create` refuses it without `--force`:

```bash
npx lila project create examples/pedido.lila --name Orders --bpmn examples/pedido/model.bpmn
```
Exit code: `1`.

```text
lila project create: /…/examples/pedido.lila already exists; nothing was written. Pass --force (`overwrite` in MCP) to replace it.
```

A full round trip, in a folder of your own: create a project, derive a scenario, compare the two.

```text
npx lila project create orders.lila --name Orders --bpmn examples/pedido/model.bpmn --scenario as-is=examples/pedido/as-is.scenario.json
npx lila scenario patch orders.lila as-is --patch examples/outline/pedido-patch.json --save-to to-be-4-cocineros
npx lila compare orders.lila as-is to-be-4-cocineros
```

## `process export-bpmn` and `process import` (#632)

The raw BPMN of one process of a `.lila`, out and in — the MCP tools `get_process_bpmn` and
`put_process_bpmn` ([`docs/MCP.md`](MCP.md#raw-bpmn-of-a-process)):

- `lila process export-bpmn -p <project.lila>` prints the model of the process as stored, or
  writes it to `--out file.bpmn` (an existing file is refused unless `--force`). It writes nothing
  into the `.lila`.
- `lila process import -p <project.lila> --bpmn <file.bpmn>` adds the BPMN (a Bizagi export, say)
  as a new process of the `.lila`, which must exist; a version 1 project becomes a repository.
  The slug is `--process`, or comes from `--name`, else from the pool's, the process's or the
  file's name; one already in the file exits `1`. The new process gets an `as-is.scenario.json`
  with the app's defaults (20 arrivals a minute apart, a minute per task). With `--replace` it
  replaces the model of the process `--process` instead: the revision goes up (saved runs go
  stale), the annotations are the new model's, scenario entries that no longer apply are removed
  and printed as notes, and a scenario error the old model did not have exits `1`.

A model with validation errors exits `1` and writes nothing, unless `--allow-unsimulatable`: then
it is kept as a diagram that does not simulate, its errors printed as notes. A file that is not
BPMN is always refused. A model without a diagram is laid out unless `--no-layout`. The write is
the `.lila`'s atomic, locked write (see [A `.lila` as input](#a-lila-as-input-466)), every other
process unchanged; `--dry-run` writes nothing; `--json` prints the result object of
`put_process_bpmn`: `{ file, mode, slug, name, processId, revision, dryRun, laidOut, summary,
scenarioRemovals, notes, warnings, slugs }`.

```bash
npx lila process export-bpmn -p examples/pedido.lila --out results/pedido.bpmn
```
Exit code: `0`.

```bash
npx lila process import -p examples/pedido.lila --bpmn examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn --dry-run
```
Exit code: `0`.

```text
Dry run: would add process "bizagi-miwg-A.1.0-roundtrip" (bizagi-miwg-a-1-0-roundtrip) to /…/examples/pedido.lila. Nothing was written.
```

A.3.0 has boundary events the simulator does not support, so it is refused unless
`--allow-unsimulatable`:

```bash
npx lila process import -p examples/pedido.lila --bpmn examples/bizagi-exports/bizagi-miwg-A.3.0-roundtrip.bpmn --dry-run
```
Exit code: `1`.

## `mcp`

Starts the MCP server (`@lila-modeler/mcp`) over stdio, for an MCP client to launch — not something you
run directly in a terminal and read from. Details, tool contracts and client registration are in
[`docs/MCP.md`](MCP.md); the underlying command is:

```text
node packages/engine/bin/lila.js mcp
```

`lila mcp` needs `@lila-modeler/mcp` installed next to the engine; the CLI alone stops with
`lila mcp: the package @lila-modeler/mcp is missing`. Outside a checkout, the usual way to start
the server is the package's own command, `npx -y @lila-modeler/mcp`.

## `process`

Creates a process from an **outline**, reads one back (#97) and edits one (#98). An outline is the process as data —
lanes plus an ordered list of steps with branches — and is the same JSON the MCP tool
`create_process` takes; its format and rules are in [`docs/MCP.md`](MCP.md#creating-a-process-from-an-outline).

```text
lila process create --outline <file.json> -p <file.lila> [--name name] [--process slug] [--dry-run] [--json]
lila process show -p <file.lila> [--process slug] [--json]
lila process edit -p <file.lila> --ops <ops.json> [--process slug] [--dry-run] [--no-layout] [--json]
```

`process create` builds the BPMN, lays it out (pool, lanes, flows), validates it and adds it to the
`.lila` as a new `processes/<slug>/` with a base scenario `as-is.scenario.json`; a `.lila` that does
not exist is created. `--name` overrides the outline's name, `--process` picks the slug (derived
from the name otherwise). It never replaces a process: a slug already in the file exits `1` and
writes nothing, and so does an outline with problems (all of them are listed, each with its path).
`--dry-run` builds and checks everything and writes nothing. It prints a one-line summary and the
validator warnings and Lila's notes; `--json` prints the result object of `create_process`
instead, and on a failure `{ "error", "issues" }` (each issue with its `path` and `message`) before
exiting `1`. With a new `.lila`, `--process` must be the slug the name gives.

```bash
npx lila process create --outline examples/outline/credit-application.json -p credit.lila --dry-run
```
Exit code: `0`.

```text
Dry run: would create process "Credit application" (credit-application) in the new file /…/credit.lila: 5 steps, 2 lanes. Nothing was written.
```

The slug `pedido` is taken in `examples/pedido.lila`, so this is refused:

```bash
npx lila process create --outline examples/outline/credit-application.json -p examples/pedido.lila --process pedido --dry-run
```
Exit code: `1`.

`examples/outline/claim-escalation.json` is the 48-hour escalation of the
[agent guide](AGENT_GUIDE.md#example-escalate-after-48-hours): a non-interrupting boundary timer
on «Assess claim» that sends the claim to a supervisor after 48 hours, a default flow, task
variants, and an event gateway where the customer's confirmation races a five-day timer that ends
the case with a terminate end event:

```bash
npx lila process create --outline examples/outline/claim-escalation.json -p claims.lila --dry-run
```
Exit code: `0`.

```text
Dry run: would create process "Claim handling" (claim-handling) in the new file /…/claims.lila: 10 steps, 3 lanes. Nothing was written.
```

Its base scenario runs for one hour, like every created process: lengthen `run.duration` (in the
app, or with the MCP tool `patch_scenario`) before running it, or no case reaches the 48-hour
deadline.

`process show` prints the outline of one process, one step per line with its type, name, lane,
duration, resources and where it goes (`end`, `terminate`, or the branches with their probability
and `default`); the starts come first when the outline lists them (`start` or `timer start`, and the
step each one leads to), and each boundary timer gets a line under its step (`boundary <id>  timer`
or `timer (non-interrupting)`, its name, its delay and where it leads), and so do its data objects
(`data in` or `data out` and the name) and its notes (`note` and the text). `--json` prints `{ slug, outline, warnings }`, the outline in
normal form (the form `create_process` returns). Durations, resources and branch probabilities
come from the process's `as-is.scenario.json`. What an outline cannot carry is reported on stderr.

```bash
npx lila process show -p examples/pedido.lila
```
Exit code: `0`.

```text
Process "Restaurant" (pedido)
  Task_TomarPedido  task  "Take order"  triangular(min=60, mode=120, max=300)  Cashier
  Gateway_ANDFork  and  "Prepare and pack" → Task_Preparar | Task_Empacar
  …
  Gateway_Aprobacion  xor  "Approved?" → Approved: Timer_Reposo (0.78) | Rejected: end (0.22)
  Timer_Reposo  timer  "Rest"  constant(value=600) → end
```

`process edit` applies a list of operations to one process, all or none: the JSON array the MCP
tool `edit_process` takes as `operations` (`add`, `connect`, `remove`, `rename`, `setType`,
`moveToLane`, `addLane`, `removeLane`, `moveLane`, `addBoundary`, `annotate`, `addDataObject`…; format and rules in
[`docs/MCP.md`](MCP.md#editing-a-process)). Every
operation is checked, the result is validated, and the `.lila` is written only if all of it is fine;
otherwise it exits `1`, writes nothing and lists every problem with the index of its operation. The
process is laid out again unless `--no-layout`, which keeps every position and only places the new
shapes. It prints a summary, one line per operation, notes (each scenario entry removed because it no
longer applies, with its previous values, so the process still simulates; branch probabilities that
no longer add up) and the validator warnings; `--json`
prints the result object of `edit_process`. `--dry-run` writes nothing.

`examples/outline/pedido-edit.json` adds a "Charge" step with a duration and the cashier, renames
and retypes two steps, adds two lanes and moves the cooking to the kitchen lane:

```bash
npx lila process edit -p examples/pedido.lila --ops examples/outline/pedido-edit.json --dry-run
```
Exit code: `0`.

```text
Dry run: would edit process "pedido" (pedido) in /…/examples/pedido.lila: 6 operations, 0 elements removed. Nothing was written.
  0: added task "Task_Cobrar" after "Task_TomarPedido"
  1: renamed "Task_Preparar": "Prepare food" → "Cook"
  2: "Task_Revisar": task → userTask
  3: added lane "Counter" (Lane_1)
  4: added lane "Kitchen" (Lane_2)
  5: moved "Task_Preparar" to lane "Kitchen"
warning W-MSGFLOW Process_Restaurante: Process_Restaurante: 2 message flows (bpmn:messageFlow) were ignored.
```

Removing the parallel split is ambiguous (one flow in, two out), so the whole edit is refused,
the rename included:

```bash
npx lila process edit -p examples/pedido.lila --ops examples/outline/pedido-edit-ambiguous.json --dry-run
```
Exit code: `1`.

```text
lila process: the edit was refused; nothing was changed:
  operations[1].id: cannot remove "Gateway_ANDFork": with 1 incoming and 2 outgoing flows it is not clear how to reconnect them. Remove or reconnect its flows first.
```

## General options

Apply to every subcommand, in any position on the command line:

- `--lang en|es` — language of the output (messages, not column names or BPMN IDs, which are a
  stable contract). Default: `LILA_LANG`, then `LANG`, English if neither is set.
- `-h`, `--help` — usage for `lila` or `lila <command> --help`.
- `-v`, `--version`, or the `version` subcommand — prints the installed `@lila-modeler/engine` version
  and exits `0`.

```bash
npx lila --version
```
Exit code: `0`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command ran; `validate` may still have printed warnings. |
| `1` | Usage error, unknown command, a model/scenario validation error, an outline with problems or a process that already exists (`process create`), an edit that is refused (`process edit`), a scenario whose `model` does not match the file given, a `.lila` that cannot be opened or whose process or scenario cannot be found, an export with no run or over an existing file, or an uncaught error from the command (message on stderr). |

## For agents

A model change is safe to hand back only after this loop, all against `--json` output so a script
can decide without parsing prose:

1. **Validate first.** `lila validate model.bpmn --json`; check the exit code, then `errors`
   (`code`, `id`, `message`). Stop here if it is not `0` — nothing downstream is trustworthy.
2. **Run with a fixed seed and enough replications** for a narrow confidence interval:
   `lila run model.bpmn scenario.json --seed 1 --replications 30 --json results/run.json`.
3. **Read `results/run.json`** with any JSON tool. Its shape matches `docs/RESULTS_FORMAT.md`
   and validates against `runResultSchema` (`@lila-modeler/engine/result-schema`); column names are the
   Bizagi-parity contract in `docs/BIZAGI_PARITY.md`, not renamed per language.
4. **To evaluate a change**, write a second scenario that `extends` the first with only the
   changed keys (`docs/SCENARIO_FORMAT.md`), then `lila compare model.bpmn base.json
   changed.json --seed 1 --replications 30 --json results/compare.json`. Read each row's
   `deltaRel` and `significant`; a metric can move without `significant` being true at low
   replication counts.

The text tables on stdout carry the same numbers; they exist for a human at a terminal, not for
parsing.

## A `.lila` as input (#466)

A `.lila` file is a **zip** of a Lila project folder (`docs/PROJECT_FORMAT.md`). `validate`, `run`
and `compare` take it wherever they take a `.bpmn`; nothing has to be unzipped first. The
committed [`examples/pedido.lila`](../examples/pedido.lila) is the `examples/pedido` folder in one
file:

```bash
npx lila validate examples/pedido.lila
```
Exit code: `0`.

With a `.lila` model, a **scenario argument** is resolved in this order:

1. **An existing file** at that path (relative to the current directory) is that file, as with a
   `.bpmn`. It is simulated against the process in the archive; its own `model` field is not
   compared with the archive, and `validateScenario` still rejects an element id that the
   process does not have.
2. **Otherwise it names a scenario of the process**, by its entry name
   (`to-be-3-cajeros.scenario.json`), the same name without `.scenario.json`
   (`to-be-3-cajeros`), or the scenario's `"name"` (`"TO-BE 3 cashiers"`, which must then be
   unique in the process). Its `model` and `extends` resolve inside the archive, exactly as in
   the project folder. A name that matches nothing lists the scenarios that exist.

```bash
npx lila run examples/pedido.lila as-is --seed 42 --replications 3 --json results/run.json
```
Exit code: `0`.

```bash
npx lila compare examples/pedido.lila as-is to-be-3-cajeros --seed 42 --replications 3
```
Exit code: `0`.

Both print, and write, exactly what the same commands print on `examples/pedido/model.bpmn` and
its scenario files. Output paths (`--json`, `--csv`, `--xlsx`) are unchanged: relative to the
current directory, never inside the archive — the CLI does not write to a `.lila`.

**Several processes.** A version 2 project (a *repository*, `docs/PROJECT_FORMAT.md`) holds more
than one process, each with its own model and scenarios. `--process <slug>` picks one; with a
single process it is implicit, and with several and no `--process` the command stops with an
error that lists the slugs. A slug that is not in the project is an error too, and so is
`--process` with a `.bpmn`:

```bash
npx lila validate examples/pedido.lila --process facturacion
```
Exit code: `1`.

```text
lila run project.lila as-is --process pedido --seed 1 --replications 30 --json results/run.json
```

The MCP tools accept a `.lila` the same way, and `patch_scenario` can write a scenario back into
one (`docs/MCP.md`).
