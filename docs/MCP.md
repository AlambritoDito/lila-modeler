# MCP (LILA-053/054/055/056)

> Read this in: [Español](es/MCP.md)

`packages/mcp` (`@lila-modeler/mcp`) provides a stdio [MCP](https://modelcontextprotocol.io) server
backed by `@lila-modeler/engine`. Its fifteen tools reuse the CLI validation and simulation pipeline — see
[`docs/CLI.md`](CLI.md) for the same pipeline driven from a terminal instead of an MCP client.

## Tools

- **`validate_bpmn({ path | xml, process?, locale? })`** parses and validates BPMN and returns the same JSON
  as `lila validate --json`: IR, `ignoredProcessIds`, `errors` and `warnings`. Supply exactly
  one of `path` and inline `xml`; supplying both is an error.
- **`describe_process({ path | xml, process?, scenario?, locale? })`** returns the IR and a readable
  `resumen`: node counts, gateway outputs, lanes, flattened subprocesses, ignored processes
  and validation status. An optional scenario path resolves `extends` and adds referenced
  resources. An unreadable scenario is reported in the summary without failing the tool.
- **`run_simulation({ model?, process?, scenario, seed?, replications?, saveTo?, saveRun?, locale? })`** validates
  the model and scenario, simulates with `log: false` and returns the same `RunResult` as
  `lila run --json`. It supports resources and calendars. `scenario` may be a JSON file path
  or an inline resolved scenario. `model` defaults to `scenario.model`; a supplied different
  model is rejected. The response includes text, `structuredContent` and an `outputSchema`.
  With a `.lila` `model` and a scenario of it, `saveRun: true` stores the run in the project (see
  [Saving a run](#saving-a-run)).
- **`compare_scenarios({ model?, process?, scenarios, seed?, replications?, saveTo?, locale? })`** validates
  all scenarios before running any. Two or more scenarios must use the same model; the first
  is the baseline. Paths and inline objects may be mixed. Returns `{ comparison, notes }`,
  with the same `CompareResult` as `lila compare --json`. Notes cover seeds, units, insufficient
  replications for confidence intervals, and engine warnings.
- **`patch_scenario({ scenario, project?, process?, patch, saveTo?, extendsFrom?, name?, description?, locale? })`**
  applies [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902), validates the result and writes
  only when valid. It returns `{ scenario, file, notes }` (plus `process` and `entry` inside a
  `.lila`).

- **`export_diagram({ project | path, process?, saveTo?, overwrite?, locale? })`** draws the
  diagram of a `.lila` process (`project`) or a `.bpmn` (`path`) as SVG with the engine's own
  renderer. Returns `{ process, svg }`, or with `saveTo` `{ process, file }`.
- **`export_document({ project, process?, run?, scenario?, format, saveTo, overwrite?, locale? })`**
  writes the process document (`format`: `docx` or `html`) with the results of a stored run.
  Returns `{ file, format, project, process, run, notes }`.
- **`export_results({ project, process?, run?, scenario?, format, saveTo, overwrite?, locale? })`**
  writes the results of a stored run (`format`: `xlsx`, or `csv` into the directory `saveTo`).
  Returns `{ files, format, project, process, run }`.
- **`create_process({ outline, project, process?, name?, dryRun?, locale? })`** turns an outline —
  lanes plus an ordered list of steps — into a laid-out, validated BPMN process and writes it as a
  new process of the `.lila` `project` (or a new `.lila`). It never replaces a process. Returns
  `{ file, slug, name, newFile, dryRun, warnings, notes, outline, summary, slugs }`. See
  [Creating a process from an outline](#creating-a-process-from-an-outline).
- **`get_process_outline({ project, process?, locale? })`** reads one process of a `.lila` back as an
  outline: `{ file, slug, name, outline, warnings }`.

- **`annotate_element({ project, process?, elementId, documentation?, responsibilities?, refs?, attributes?, dryRun?, locale? })`**
  writes the description, RACI, catalog references and extended attributes of one element of a
  `.lila` process. Returns `{ file, process, elementId, dryRun, changed, written, before, after }`.
- **`get_raci_matrix({ project, process?, locale? })`** returns the process's RACI matrix:
  `{ file, process, roles, rows }`.
- **`import_scenario_sheet({ project, process?, scenario, sheet, dryRun?, locale? })`** applies a
  scenario sheet (`.xlsx`/`.csv`) to a scenario of the `.lila`. Returns
  `{ file, process, scenario, sheet, dryRun, written, tables, changes, issues }`.
- **`export_scenario_template({ project, process?, scenario, saveTo, overwrite?, locale? })`**
  writes that sheet as `.xlsx`, filled in. Returns `{ file, project, process, scenario }`.
- **`create_project({ path, name, bpmn, scenarios?, overwrite?, locale? })`** creates a new `.lila`
  from a BPMN you already have (an agent that starts from steps uses `create_process`) and
  scenarios. Returns `{ file, name, processId, warnings, scenarios }`.

The three export tools are described in [App-free exports](#app-free-exports); the last five in
[Modelling tools for agents](#modelling-tools-for-agents).

Every tool that takes a model also takes a `.lila` project; see [A `.lila` as input](#a-lila-as-input).

### Patch modes

Without `saveTo`, `patch_scenario` overwrites the original scenario with the complete resolved
scenario, without `extends`. Its model path is written relative to that file so the result is
portable. Removing `model` or `run` is rejected: although an inheriting file can omit them,
a resolved scenario cannot.

With `saveTo`, the tool writes a file that inherits from `extendsFrom` (default: the original
scenario) and contains only the changed keys. `extends` is relative to the new file;
`remove` becomes `null`, the inheritance deletion marker. A destination equal to the source
or parent is rejected because it would create an inheritance cycle. Existing destination files
are overwritten; “new file” describes the derived scenario, not an exclusive-create guarantee.

Supported operations are `add`, `replace`, `remove` and `test`, with RFC 6901 pointers such as
`/resources/cajero/capacity`. `move` and `copy` are unsupported. Invalid operations, out-of-range
probabilities, nonpositive capacity, unknown resources and unknown BPMN IDs return
`isError: true` without writing anything. Both modes validate the final candidate before writing.

## A `.lila` as input

A `.lila` (`docs/PROJECT_FORMAT.md`) is accepted wherever a tool takes a model (#466): `path` of
`validate_bpmn`/`describe_process`, `model` of `run_simulation`/`compare_scenarios`, and
`project` of `patch_scenario`. The rules are the CLI's (`docs/CLI.md`, «A `.lila` as input»):

- **`process`** is the slug of the process when the project holds several (a version 2
  repository). With one process it is implicit; with several and no `process`, the tool fails
  with a message that lists the slugs. `process` with a `.bpmn` is an error, not ignored.
- **A scenario string** is a `.json` path when that file exists, and otherwise the name of a
  scenario of the process: its entry name (`as-is.scenario.json`), the same without
  `.scenario.json` (`as-is`) or its `"name"` (`"AS-IS"`, unique in the process). A scenario from
  disk is simulated against the archive's process; one from the archive resolves `model` and
  `extends` inside it.
- **An inline scenario** is anchored inside the process: `extends: "as-is.scenario.json"` names a
  scenario of the archive, and a missing `model` means the process's `model.bpmn`.
- **`patch_scenario` with `project`** reads `scenario` (and `extendsFrom`) as names inside the
  process — never as disk paths — and `saveTo` as the name of the new scenario entry
  (`.scenario.json` is added when missing; no folders). It validates against the process's model
  and writes only a valid result, as on disk. The write goes through the engine's codec
  (`encodeLila`) to a temporary file that is then renamed over the `.lila`, so a failure never
  leaves a partial archive. The scenario's revision goes up by one, so the app sees the runs of
  the old version as stale. Every other process, scenario and run is carried through unchanged
  and, in an archive written by the app or the engine, byte for byte; entries outside the
  project layout are dropped, as in any `.lila` save. If the file changed on disk while the tool
  worked (another program, another MCP server, the CLI or the desktop app), nothing is written and
  the tool fails: call it again. Writers of the same `.lila` take turns through a lock file next to
  it (`<file>.lila.lock`, never inside the archive); when another writer holds it for more than 3
  seconds the tool fails with «another program is saving», writing nothing. A lock left untouched
  for 10 seconds is treated as left by a crash and removed. A `project` that is not a `.lila` is refused.

```json
{ "name": "run_simulation", "arguments": { "model": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "seed": 42, "replications": 3 } }
```

```json
{ "name": "patch_scenario", "arguments": { "project": "project.lila", "process": "pedido", "scenario": "as-is",
  "saveTo": "to-be-4", "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 4 }] } }
```

## App-free exports

`export_diagram`, `export_document` and `export_results` (#538) are `lila export diagram|doc|results`
(`docs/CLI.md`) as tools. They need no app and no browser:

- **The diagram** is the engine's SVG renderer: the BPMN DI geometry in the Lila Light colours
  on white. The HTML document embeds it. The Word document has **no diagram**, and neither
  document has the run's charts: Word needs a PNG and the engine has no rasteriser. `notes`
  says what was left out.
- **Runs** are the ones the app saved in the `.lila`. `run: "latest"` (the default) is the run
  of the current model and scenario. `scenario` narrows it to one scenario, which is needed when
  several have a current run. `run: "<id>"` picks one, and an unknown id lists the ids; `run` and
  `scenario` together are an error. The
  document only takes a current run; without one it goes without results, and the `run` of the
  answer is `null`. `export_results` without a run is `isError`, with a message that says so. An
  older run's results are exported against the model it ran on.
- **Nothing is overwritten.** An existing file at `saveTo` (or, for CSV, any of the four files in
  the directory) is `isError` and nothing is written, unless `overwrite: true`. The project (or
  `.bpmn`) being exported is never a destination, with `overwrite` or not. Writes are atomic
  (a temporary file, then published).

```json
{ "name": "export_diagram", "arguments": { "project": "examples/pedido.lila", "saveTo": "out/pedido.svg" } }
```

```json
{ "name": "export_document", "arguments": { "project": "project.lila", "format": "html", "saveTo": "out/pedido.html" } }
```

```json
{ "name": "export_results", "arguments": { "project": "project.lila", "scenario": "as-is", "format": "xlsx", "saveTo": "out/as-is.xlsx" } }
```

## Saving a run

`run_simulation` with `saveRun: true` (and `lila run … --save`) stores the run in the `.lila`
exactly as the app does: the same stored shape, the model and scenario revisions it ran on, the
model XML and the resolved scenario (with `model: "model.bpmn"`), built by the same engine function
the app uses (`storedRun`). The app then opens it as the current run of that scenario, and
`export_document` / `export_results` use it. It needs a `.lila` `model` and a scenario **of the
archive** (by name); a `.bpmn`, a scenario file on disk or an inline scenario is `isError`, after
nothing was written. The answer's `structuredContent` is still the `RunResult`; a second text block
says `{ "savedRun": { "id", "file", "process", "scenario" } }`.

The write is atomic, under the file's lock. If another writer saved the `.lila` meanwhile, the
archive is read again and the run appended to what is there now, so concurrent saves all land. If
the model or that scenario changed meanwhile, the run is already stale and is not saved
(`isError`). The app keeps every run (there is no retention limit), and so does this.

```json
{ "name": "run_simulation", "arguments": { "model": "project.lila", "scenario": "as-is", "seed": 42, "replications": 5, "saveRun": true } }
```
## Creating a process from an outline

An agent describes a process as data instead of BPMN XML (#97). `create_process` builds the
semantic BPMN with `bpmn-moddle`, lays it out with `bpmn-auto-layout` (pool, lanes and flows
included), validates it like `validate_bpmn`, and writes it into the `.lila`. `lila process create`
(`docs/CLI.md`) does the same from a terminal.

```json
{ "name": "Credit application",
  "lanes": ["Customer", "Analyst"],
  "steps": [
    { "id": "receive", "name": "Receive application", "lane": "Analyst" },
    { "id": "check", "name": "Check bureau", "lane": "Analyst", "duration": "normal(20m, 5m)" },
    { "id": "ok", "type": "xor", "name": "Approved?",
      "branches": [ { "label": "Yes", "to": "issue" }, { "label": "No", "to": "reject", "probability": 0.3 } ] },
    { "id": "issue", "name": "Issue card", "end": true },
    { "id": "reject", "name": "Notify rejection", "lane": "Customer", "end": true } ] }
```

- **List order is the flow**: each step follows the previous one unless it has `next` (one id, or
  several after a gateway), `branches` (gateways only: `{ label?, to, probability? }`, or
  `{ label?, end: true, probability? }` for a branch that ends the process) or `end: true`. The
  last step ends the process. Start and end events are added.
- **`type`** defaults to `task`; the others are `userTask`, `serviceTask`, `callActivity`, `xor`,
  `and`, `or`, `timer` (an intermediate timer event) and `subprocess` (a collapsed embedded
  sub-process with a pass-through start and end inside).
- **Step ids become the BPMN ids**, so scenarios key on them. They must be valid BPMN ids and must
  not clash with the ids Lila generates (`StartEvent`, `EndEvent_<step>`, `Flow_…`, `Lane_<n>`,
  `Process_…`, `<id>_di`).
- **`lane`** defaults to the previous step's lane (the first lane for the first step). Lanes not
  listed in `lanes` are an error when `lanes` is given and are collected in order when it is not.
- **The base scenario.** The process gets `as-is.scenario.json`: the app's default arrivals for a
  new process (20 cases, one a minute), every `duration` as `processingTime` (tasks) or delay
  (timers), every `resources` entry (a name, or `{ name, quantity }`; a resource is created with
  the capacity of its largest request; with several, `selection: "or"` takes any one of them
  instead of all), and every branch `probability` as the probability of its
  flow. The XOR branches left without one share what is left of 1. A `duration` is a number of
  seconds, a time with a unit (`90s`, `20m`, `1.5h`, `1h30m`, `1d`; the units of the scenario sheets,
  Spanish included), a distribution of the scenario format written short — `normal(20m, 5m)`,
  `triangular(1m, 2m, 5m)`, `exponential(mean=4m)`, positional in the order of
  `docs/SCENARIO_FORMAT.md` or named — or a distribution object in seconds.
- **The slug** of the new `processes/<slug>/` is `process`, or one derived from the name (`name`,
  else `outline.name`). A slug already in the file is an error and nothing is written. A `project`
  that does not exist is created as a one-process `.lila` whose slug comes from the name (a
  different `process` is an error there, since a one-process file cannot carry its own slug). Every
  other process stays byte for byte as it was; the write is the same atomic, locked write as
  `patch_scenario`'s.
- **A malformed outline** fails with every problem at once, in the call's language, each with its
  path (`steps[2].branches[0].to: …`, `steps[0].duraton: unknown field "duraton".`), and nothing
  is written. `outline` is declared as a plain object on purpose, so the MCP SDK never rejects a
  call before these checks run. A step from which no path reaches an end (a loop with no exit)
  is a problem too, one per stuck step, and so is an outline whose model does not validate (the
  validator's errors come back with their codes, at the step they are about).
- **`notes`** are Lila's own warnings on an outline that is accepted, such as a parallel (`and`)
  join that waits for branches of one exclusive (`xor`) split, where cases would wait forever.

```json
{ "name": "create_process", "arguments": { "project": "credit.lila", "outline": { "name": "Credit application", "lanes": ["Customer", "Analyst"], "steps": [ … ] } } }
```

```json
{ "file": "/work/credit.lila", "slug": "credit-application", "name": "Credit application", "newFile": true,
  "dryRun": false, "warnings": [], "notes": [], "slugs": ["credit-application"], "outline": { … },
  "summary": "Created process \"Credit application\" (credit-application) in the new file /work/credit.lila: 5 steps, 2 lanes, base scenario as-is.scenario.json." }
```

`get_process_outline` returns the outline in **normal form**: every step names its lane, `type` is
left out for `task`, `next` appears only when it is not simply the following step, every step
that finishes the process has `end: true`, gateway successors are `branches`, durations are
distribution objects in seconds and the XOR probabilities are filled in. That is the form
`create_process` returns as `outline`, so a process round-trips. Durations, resources and
probabilities (and resource `selection`) come from the process's `as-is.scenario.json` when it has
one. For a process Lila did not generate, `warnings` says once per kind what the outline leaves
out: other pools, message flows, the names of start and end events, annotations, default-flow
marks, other event types, nested lanes, and the parts of the scenario an outline does not carry
(arrivals, calendars, costs, resource capacities and types, conditional routing; the scenario
itself is not changed). A process with no name takes the one in the `.lila`, else its id. The
steps keep the document order.

## Modelling tools for agents

`annotate_element`, `get_raci_matrix`, `import_scenario_sheet`, `export_scenario_template` and
`create_project` (#99, #403, #514) let an agent build and document a project with no app. The CLI
has the first four as `lila process annotate|raci` and `lila scenario import|template`
(`docs/CLI.md`). Every write goes through the same atomic, locked `.lila` save as
`patch_scenario` (see [A `.lila` as input](#a-lila-as-input)): only the process touched changes,
the others are carried through byte for byte, and an invalid input is `isError` with nothing
written. `dryRun: true` answers what would change and writes nothing.

- **`annotate_element`** finds the element by its BPMN id (a task, event, gateway, flow, lane,
  pool, the process…; an unknown id is an error). `documentation` replaces the description (`""`
  removes it). `responsibilities` is the whole RACI list, `[{ "type": "R"|"A"|"C"|"I", "roleRef":
  "cashier" }]` (`[]` clears it). `refs` maps a kind (`systemRef`, `documentRef`, `riskRef`,
  `controlRef`, `kpiRef`, `input`, `output`) to its ids and replaces only the kinds given.
  `attributes` maps an extended attribute (its id, or its name when only one has it) to a value
  and is merged: `""` removes a value, the attributes left out stay. Each value is checked
  against the project's attribute definitions, as in the app's properties panel: a `number` is
  a plain decimal (`12`, `-3.5`), a `date` is `YYYY-MM-DD`, a `list` value is one of its
  options, and the attribute must apply to the element's type. The model's revision goes up by
  one, as when the app saves an edit. An annotation that changes nothing writes nothing
  (`changed: false`).
- **`get_raci_matrix`** lists what the process document (`export_document`) lists under
  «Responsibilities (RACI)», in the same order: one row per element with responsibilities, with
  its `id`, `name`, `lane` (when it has one), the raw `responsibilities`, and `cells` (role →
  `"R"`, or `"A, C"` when a role has several types). `roles` are the roles in order of appearance.
- **`import_scenario_sheet`** is the app's «Import Excel/CSV…» (`docs/SCENARIO_SHEETS.md`): the
  sheet is planned against the resolved scenario, and each change is written into the scenario's
  own file, its delta when it `extends` another (the parent is never touched). `changes` carries
  each field's `before`, `after` and a readable `text` (`Cashier (cajero) · capacity: 2 → 3`, a
  distribution in the unit of its row); `issues` the rows not applied (`error`, `unmatched`,
  `ambiguous`), notes (`warning`) and the errors the result would have (`lint`). A plan with a
  `lint` issue is refused (it is reported by a `dryRun`). The scenario's revision goes up by one.
- **`export_scenario_template`** is the app's «Download template»: hand it to a person, then
  import what comes back. An existing `saveTo` is refused unless `overwrite`.
- **`create_project`** takes `bpmn` as inline XML (it starts with `<`) or a path to a `.bpmn`.
  A model with validation errors is refused. `scenarios` are `[{ "name", "scenario" }]`, saved
  as `<name>.scenario.json`; a scenario with neither `model` nor `extends` gets
  `"model": "model.bpmn"`, and one that names another model is refused. A scenario that cannot
  run yet is a draft: it is saved, and comes back with `runnable: false` and its `errors`. The
  file is written whole or not at all, and an existing one is refused unless `overwrite`. The web
  and desktop apps open it.

```json
{ "name": "create_project", "arguments": { "path": "project.lila", "name": "Orders", "bpmn": "examples/pedido/model.bpmn",
  "scenarios": [{ "name": "as-is", "scenario": { "version": 1, "name": "AS-IS", "run": { "start": "2026-10-05T08:00:00-06:00", "duration": 28800, "seed": 1 } } }] } }
```

```json
{ "name": "annotate_element", "arguments": { "project": "project.lila", "elementId": "Task_TomarPedido",
  "documentation": "Takes the order at the counter.", "responsibilities": [{ "type": "R", "roleRef": "cashier" }, { "type": "A", "roleRef": "manager" }],
  "refs": { "systemRef": ["POS"] } } }
```

```json
{ "name": "get_raci_matrix", "arguments": { "project": "project.lila" } }
```

```json
{ "name": "export_scenario_template", "arguments": { "project": "project.lila", "scenario": "as-is", "saveTo": "as-is.xlsx" } }
```

```json
{ "name": "import_scenario_sheet", "arguments": { "project": "project.lila", "scenario": "as-is", "sheet": "as-is.xlsx", "dryRun": true } }
```

## Language

Tool titles, descriptions and schema descriptions are English protocol metadata. Response
summaries, catalogued engine diagnostics and tool messages use the selected language.

- `lila mcp --lang es` sets the server language explicitly. Otherwise the CLI or `lila-mcp`
  resolves `LILA_LANG`, `LC_ALL`, `LC_MESSAGES`, then `LANG`, falling back to English.
- Each tool accepts optional `locale: "en" | "es"`, overriding only that call.
- The response key `resumen` remains unchanged; only its content is translated.
- BPMN IDs, diagnostic codes, JSON field names and result column names do not change.

## Installation

From a repository checkout with Node 22 or later:

```bash
npm ci
npm run build
```

Both commands below start the same server:

```bash
node packages/engine/bin/lila.js mcp
./node_modules/.bin/lila-mcp
```

`lila mcp` dynamically loads `@lila-modeler/mcp` to avoid a static package cycle. Installing the engine
package alone does not install the private MCP workspace. Use the checkout until a separately
installable MCP distribution exists. Missing packages and startup diagnostics go to stderr;
stdout carries only MCP protocol messages.

## Register with Claude Code

Use an absolute checkout path when registering outside this repository:

```bash
claude mcp add lila -- node /path/to/repo/packages/engine/bin/lila.js mcp
```

`-s user` registers across projects; otherwise the registration is local. Check with
`claude mcp list`. The repository already includes a project `.mcp.json`:

```json
{
  "mcpServers": {
    "lila": {
      "command": "node",
      "args": ["packages/engine/bin/lila.js", "mcp"]
    }
  }
}
```

Relative paths depend on the server working directory. Use absolute tool arguments when the
client does not launch the server from the repository root.

## Register with Claude Desktop

Configure the client with the Node executable and the absolute path to
`packages/engine/bin/lila.js`, followed by `mcp`. For example:

```json
{
  "mcpServers": {
    "lila": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/repo/packages/engine/bin/lila.js", "mcp"]
    }
  }
}
```

The usual configuration locations are
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and
`%APPDATA%\Claude\claude_desktop_config.json` on Windows. Restart the client after editing.
Use absolute model and scenario paths rather than relying on a client-specific working directory.

## Examples

Run a scenario:

```json
{ "scenario": "examples/pedido/as-is.scenario.json", "seed": 42 }
```

Compare scenarios:

```json
{
  "scenarios": [
    "examples/pedido/as-is.scenario.json",
    "examples/pedido/to-be-3-cajeros.scenario.json"
  ],
  "seed": 42
}
```

Create a derived scenario without changing AS-IS:

```json
{
  "scenario": "examples/pedido/as-is.scenario.json",
  "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 3 }],
  "saveTo": "examples/pedido/to-be-3-cajeros.scenario.json",
  "name": "TO-BE 3 cashiers"
}
```

This writes `version`, `name`, `extends: "as-is.scenario.json"` and
`resources: { "cajero": { "capacity": 3 } }`. Inline scenarios use the same resolved format;
relative model paths are resolved against the server's working directory.

## M4 acceptance workflows

`packages/mcp/test/e2e.test.ts` exercises both workflows over stdio with seed 42:

1. Ask for the AS-IS bottleneck. `run_simulation` returns `Task_Preparar` first, with the
   documented resource wait total 267417737.56 and utilization about 0.3435. `Task_TomarPedido`
   is second. These are the same results as CLI JSON output.
2. Ask what happens with one more cashier. `patch_scenario` creates the derived scenario and
   `compare_scenarios` compares it with AS-IS. The documented mean wait at `Task_TomarPedido`
   changes from 14.97 to 2.18 minutes (−85.4%), with nonoverlapping 95% intervals. The main
   bottleneck remains `Task_Preparar`.

For an invalid model, call `validate_bpmn` to inspect the full report before attempting simulation.

## What `isError` means

`validate_bpmn` and `describe_process` return `isError: false` for a successfully generated
validation report, even when `errors[]` is nonempty. Missing arguments, unreadable files or
unparseable XML fail the tool. The CLI exit code is different: model validation errors produce
exit code 1.

`run_simulation`, `compare_scenarios` and `patch_scenario` return `isError: true` when validation
prevents producing a result. Messages identify the tool and offending scenario (a path or
`scenarios[n]` for inline input). Invalid patches write nothing. Schema problems use
`parseScenario` and the same diagnostic codes as the CLI.

## `saveTo`

Writes use the server process's filesystem permissions. Files are staged in the destination
directory and published with `rename`, preventing partial JSON reads. An existing file is
replaced; an existing directory is rejected. The export tools are the exception: they never
replace a file unless `overwrite: true` (see [App-free exports](#app-free-exports)). `compare_scenarios` saves only `comparison`,
without `notes`, matching CLI JSON output. For `patch_scenario`, omitting `saveTo` selects
in-place editing; supplying it selects the derived-scenario mode described above.

## Paths

All relative paths are resolved from the server process's working directory, not the client's
working directory. Inheritance and model references are resolved relative to the scenario that
declares them; inside a `.lila`, relative to that scenario's place in the archive. There is no filesystem sandbox around these tools.

## SDK packages

The server uses `@modelcontextprotocol/server` 2.0.0. Tests use
`@modelcontextprotocol/client` 2.0.0. The exact installed versions are recorded in the lockfile.

## Manual smoke test

After building, run from the repository root:

```bash
node --input-type=module -e "
const { Client } = await import('@modelcontextprotocol/client');
const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
const client = new Client({ name: 'manual', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['packages/engine/bin/lila.js', 'mcp'] }));
console.log((await client.listTools()).tools.map((t) => t.name));
const r = await client.callTool({ name: 'validate_bpmn', arguments: { path: 'examples/pedido/model.bpmn' } });
console.log(r.isError, r.content[0].text.slice(0, 200));
await client.close();
"
```

The MCP Inspector is another option for interactive inspection; it opens a browser UI and
stays in the foreground, so it is not a CI smoke test.

## Known limitations

- Simulation is synchronous in the server process. It blocks requests, including ping and
  cancellation notifications; progress and cancellation would require a worker integration.
- Simulation results are returned as both text and `structuredContent`, increasing payload size.
- `compare_scenarios` returns structured content but does not publish an `outputSchema`.
- File writes use server permissions and can overwrite files without an interactive confirmation.
- `create_process` lays out with `bpmn-auto-layout` 1.3, which draws no pool or lanes: Lila keeps
  its columns and rows, moves each node into its lane, routes the flows again orthogonally (around
  the shapes in their way) and places every branch label on its own branch. Lanes can come out
  taller than needed, a gateway's name can sit on a flow that leaves it from below, and a
  sub-process is created collapsed with an empty pass-through inside. Move things in the app
  when the picture matters.
