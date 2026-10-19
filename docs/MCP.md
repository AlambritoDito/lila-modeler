# MCP (LILA-053/054/055/056)

> Read this in: [Español](es/MCP.md)

`packages/mcp` (`@lila-modeler/mcp`) provides a stdio [MCP](https://modelcontextprotocol.io) server
backed by `@lila-modeler/engine`. Its twenty-five tools reuse the CLI validation and simulation pipeline — see
[`docs/CLI.md`](CLI.md) for the same pipeline driven from a terminal instead of an MCP client.

For the whole flow an agent follows — interview, outline, scenario, run, document, and seeing the
result in the app — read the [agent guide](AGENT_GUIDE.md).

Besides the tools, the server offers that guide, the outline and scenario formats and the scenario
JSON Schema as resources, and the guide's flow as the prompt `interview-to-process`; see
[Resources and prompt](#resources-and-prompt).

## Tools

- **`validate_bpmn({ path | xml, process?, locale? })`** parses and validates BPMN and returns the same JSON
  as `lila validate --json`: IR, `ignoredProcessIds`, `errors` and `warnings`. Supply exactly
  one of `path` and inline `xml`; supplying both is an error.
- **`describe_process({ path | xml, process?, scenario?, locale? })`** returns the IR and a readable
  `resumen`: node counts, gateway outputs, lanes, flattened subprocesses, ignored processes
  and validation status. An optional scenario path resolves `extends` and adds referenced
  resources. An unreadable scenario is reported in the summary without failing the tool.
- **`run_simulation({ model?, process?, scenario, seed?, replications?, saveTo?, saveRun?, logTo?, detail?, locale? })`** validates
  the model and scenario, simulates and, by default, answers with a summary of the run;
  `detail: "full"` returns the whole `RunResult`, the same as `lila run --json` (see
  [Summary or full results](#summary-or-full-results)). It supports resources and calendars.
  `scenario` may be a JSON file path or an inline resolved scenario. `model` defaults to
  `scenario.model`; a supplied different model is rejected. The response includes text,
  `structuredContent` and an `outputSchema`. Long runs report progress and can be
  cancelled ([Progress and cancellation](#progress-and-cancellation)).
  With a `.lila` `model` and a scenario of it, `saveRun: true` stores the run in the project (see
  [Saving a run](#saving-a-run)). `logTo` writes the event log to a CSV file: the same bytes as the
  `log.csv` of `lila run --csv` for the same model, scenario, seed and replications. Rows are
  streamed to a temporary file during the run, so memory stays bounded on long runs, and the file
  is published only when the call succeeds, after `saveTo` and `saveRun`. A `logTo` that names the
  model, the `.lila`, the scenario file or `saveTo` is refused. When `logTo` or `saveRun` is given, a second text block says where
  they went: `{ log, savedRun }`, each key only when asked for; `log` is the absolute path.
- **`compare_scenarios({ model?, process?, scenarios, seed?, replications?, saveTo?, format?, all?, detail?, locale? })`** validates
  all scenarios before running any. Two or more scenarios must use the same model; the first
  is the baseline. Paths and inline objects may be mixed. Returns `{ comparison, notes }`,
  with the same `CompareResult` as `lila compare --json`. Notes cover seeds, units, insufficient
  replications for confidence intervals, and engine warnings. By default `comparison` keeps the
  process and resource rows and the significant ones; `detail: "full"` returns every row, and
  `all: true` is the same request under the name of `lila compare --all` (with `detail: "summary"`
  it is an error). `format: "xlsx"` makes `saveTo` write the workbook of `lila compare --xlsx`, the
  same bytes, instead of the JSON; it needs `saveTo`.
- **`patch_scenario({ scenario, project?, process?, patch, saveTo?, extendsFrom?, name?, description?, dryRun?, locale? })`**
  applies [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902), validates the result and writes
  only when valid. It returns `{ scenario, file, written, dryRun, notes }` (plus `process` and `entry` inside a
  `.lila`). A patch that changes nothing (only `test`, or a `saveTo` whose target already holds the
  result) writes nothing: `written` is `false`, `notes` says so first, and the scenario keeps its
  revision, so its saved runs stay current (#627). `dryRun: true` validates the same way and
  writes nothing (`written: false`, with a note). For a `.lila` it is `lila scenario patch`.

- **`export_diagram({ project | path, process?, overlay?, run?, scenario?, saveTo?, overwrite?, locale? })`**
  draws the diagram of a `.lila` process (`project`) or a `.bpmn` (`path`) as SVG with the engine's
  own renderer. Returns `{ process, svg }`, or with `saveTo` `{ process, file }`. With `overlay`
  (`"bottlenecks"` | `"heatmap"`, #669) it colours the diagram with a stored run, as `lila export
  diagram --overlay` does (`docs/CLI.md`), and the answer adds the `run` it used.
- **`export_document({ project, process?, run?, scenario?, format, saveTo, overwrite?, locale? })`**
  writes the process document (`format`: `docx` or `html`) with the results of a stored run.
  Returns `{ file, format, project, process, run, notes }`.
- **`export_results({ project, process?, run?, scenario?, format, saveTo, overwrite?, locale? })`**
  writes the results of a stored run (`format`: `xlsx`, or `csv` into the directory `saveTo`).
  Returns `{ files, format, project, process, run, percentiles }`; `percentiles` is
  `{ included, note? }`, see [App-free exports](#app-free-exports).
- **`create_process({ outline, project, process?, name?, dryRun?, locale? })`** turns an outline —
  lanes plus an ordered list of steps — into a laid-out, validated BPMN process and writes it as a
  new process of the `.lila` `project` (or a new `.lila`). It never replaces a process. Returns
  `{ file, slug, name, newFile, dryRun, warnings, notes, outline, summary, slugs }`. See
  [Creating a process from an outline](#creating-a-process-from-an-outline).
- **`get_process_outline({ project, process?, locale? })`** reads one process of a `.lila` back as an
  outline: `{ file, slug, name, outline, warnings }`.
- **`edit_process({ project, process?, operations, dryRun?, layout?, locale? })`** applies a list of
  operations (add, connect, remove, rename, setType, moveToLane, addLane, removeLane, moveLane,
  addBoundary, annotate, removeAnnotation, addDataObject, removeDataObject, setCalledProcess) to one
  process of a `.lila`, all or none. Returns `{ file, slug, name, dryRun, summary, changes, removed,
  scenarioRemovals, notes, warnings, outline }`. See [Editing a process](#editing-a-process).

- **`annotate_element({ project, process?, elementId, documentation?, responsibilities?, refs?, attributes?, dryRun?, locale? })`**
  writes the description, RACI, catalog references and extended attributes of one element of a
  `.lila` process. Returns `{ file, process, elementId, documentationOn?, dryRun, changed, written, before, after }`.
- **`define_attribute({ project, process?, id?, name?, type?, appliesTo?, options?, default?, remove?, dryRun?, locale? })`**
  defines, changes or removes an extended attribute of a `.lila` process, the one `annotate_element`
  fills in. Returns `{ file, process, dryRun, changed, written, before, after, removedValues, definitions }`.
- **`get_raci_matrix({ project, process?, locale? })`** returns the process's RACI matrix:
  `{ file, process, roles, rows }`.
- **`import_scenario_sheet({ project, process?, scenario, sheet, dryRun?, locale? })`** applies a
  scenario sheet (`.xlsx`/`.csv`) to a scenario of the `.lila`. Returns
  `{ file, process, scenario, sheet, dryRun, written, tables, changes, issues }`.
- **`export_scenario_template({ project, process?, scenario, saveTo, overwrite?, locale? })`**
  writes that sheet as `.xlsx`, filled in. Returns `{ file, project, process, scenario }`.
- **`create_project({ path, name, bpmn, scenarios?, overwrite?, allowUnsimulatable?, locale? })`** creates a new `.lila`
  from a BPMN you already have (an agent that starts from steps uses `create_process`) and
  scenarios. Returns `{ file, name, processId, laidOut, warnings, notes, scenarios }`.
- **`get_project({ project, locale? })`** lists what a `.lila` holds, writing nothing: its
  processes, their scenarios and their saved runs, current or stale. `project` must be a `.lila`
  file, as in `patch_scenario`. Returns
  `{ file, name, formatVersion, processes }`.
- **`get_scenario({ project, process?, scenario, resolved?, locale? })`** reads one scenario as
  stored, or resolved through `extends`, with the validator's notes, writing nothing. Returns
  `{ file, process, entry, revision, resolved, scenario, runnable, notes }`.
- **`get_process_bpmn({ project, process?, locale? })`** reads the BPMN XML of one process as
  stored, writing nothing. Returns `{ file, process, processId, revision, xml }`.
- **`put_process_bpmn({ project, process?, bpmn, mode, name?, layout?, allowUnsimulatable?, dryRun?, locale? })`**
  adds a BPMN as a new process of an existing `.lila` (`mode: "add"`) or replaces the model of
  one (`mode: "replace"`). Returns `{ file, mode, slug, name, processId, revision, dryRun,
  laidOut, summary, scenarioRemovals, notes, warnings, slugs }`.
- **`rename_process({ project, process, name, dryRun?, locale? })`** renames a process of a
  `.lila`; its slug stays. Returns `{ file, dryRun, written, process, before, after, summary, notes }`.
- **`delete_process({ project, process, dryRun?, locale? })`** deletes a process with its scenarios
  and saved runs. Returns `{ file, dryRun, written, process, name, removedScenarios, removedRuns,
  slugs, summary, notes }`.
- **`rename_scenario({ project, process?, scenario, name, dryRun?, locale? })`** renames a scenario;
  its file stays. Returns `{ file, dryRun, written, process, entry, before, after, revision,
  summary, notes }`.
- **`delete_scenario({ project, process?, scenario, dryRun?, locale? })`** deletes a scenario with
  its saved runs. Returns `{ file, dryRun, written, process, entry, removedRuns, summary, notes }`.

The three export tools are described in [App-free exports](#app-free-exports); the six after
them in [Modelling tools for agents](#modelling-tools-for-agents); `get_project` and
`get_scenario` in [Reading a project](#reading-a-project); `get_process_bpmn` and
`put_process_bpmn` in [Raw BPMN of a process](#raw-bpmn-of-a-process); the last four in
[Renaming and deleting](#renaming-and-deleting).

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
  the old version as stale; a patch that changes nothing is not written and leaves the revision as it was. Every other process, scenario and run is carried through unchanged
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

## Reading a project

`get_project` and `get_scenario` (#628) are `lila project show` and `lila scenario show`
(`docs/CLI.md`) as tools. They only read: no write, no revision change, the `.lila` stays byte for
byte as it was. Call `get_project` first on a file that already exists, instead of finding its
processes, scenarios and runs through the errors of other tools.

- **`get_project`** returns `{ file, name, formatVersion, processes }`. `formatVersion` is 2 for a
  repository of several processes and 1 otherwise. Each process has `slug` (what `process` takes),
  `name`, `processId` (its `bpmn:process`), `modelRevision`, `elements` (flow nodes: tasks, events,
  gateways; `null` when the model cannot be read), `scenarios` (`entry`, `name`, `revision`,
  `extends`), `runs` (`id`, `scenario`, `start`, `replications`, `current`) and `attributes`, the
  extended attributes it defines (`id`, `name`, `type`, `appliesTo`, `default?`, `options?`;
  `null` when the model cannot be read back whole). A run is
  `current: false` (stale) when the model or its scenario changed after it: `export_results` and
  `export_document` take it only by id. Only the scenario the run ran counts: a change in its
  `extends` parent alone leaves the run `current`, although the resolved scenario is no longer
  the one that ran. A `.lila` keeps no date of when a run was taken; `start` is
  the simulated start (`run.start`) of the scenario it ran.
- **`get_scenario`** returns `{ file, process, entry, revision, resolved, scenario, runnable, notes }`.
  `scenario` is the entry as stored (with its `extends`), or with `resolved: true` merged through
  `extends` with the engine's defaults: the object `patch_scenario` patches, with `model` relative
  to the scenario. `notes` are the validator's against the process model — errors (`E-…`) first,
  then warnings (`W-…`), the checks `run_simulation` makes before it simulates — so it works as a
  scenario lint; `runnable` is `false` when there is an error. A scenario whose `extends` cannot be
  resolved comes back with `scenario: null` (when resolved) and the reason in `notes`. So does a
  process whose `model.bpmn` does not parse: `runnable: false`, with the parser's error in
  `notes`.

Both take only a `.lila` file in `project`: a folder or an empty path is refused with the same
message as `patch_scenario`. Like `get_process_bpmn`, `get_process_outline`, `get_raci_matrix`,
`validate_bpmn` and `describe_process`, they declare `readOnlyHint: true`.

To read a scenario, use `get_scenario`, not a `patch_scenario` with only `test`: that one writes
nothing either (#627), but it is not meant for reading.

```json
{ "name": "get_project", "arguments": { "project": "credit.lila" } }
```

```json
{ "name": "get_scenario", "arguments": { "project": "credit.lila", "scenario": "as-is", "resolved": true } }
```

## Raw BPMN of a process

`get_process_bpmn` and `put_process_bpmn` (#632) read and write the BPMN of one process of a
`.lila` as XML, through the same codec and lock as every other tool: the way to bring in a model
drawn elsewhere (a Bizagi export, say) as another process of a project, or to hand a process to a
BPMN tool and take it back. `lila process export-bpmn` and `lila process import` (`docs/CLI.md`) do
the same from a terminal.

- **`get_process_bpmn`** returns the model exactly as stored: `xml`, its `revision`, and
  `processId`, the `bpmn:process` the project simulates (as `get_project` lists it). It writes
  nothing.
- **`put_process_bpmn`** takes `bpmn` as inline XML (it starts with `<`) or a path to a `.bpmn`,
  and validates it as `create_project` does: a model with validation errors is refused.
  - **`mode: "add"`** adds it as a new process of a `.lila` that exists (to start a new file, use
    `create_project`); a version 1 project becomes a repository. Its slug is `process`, or comes
    from `name`, else from its pool's name, its process's name or the file's name; a slug already
    in the file is refused. It gets an `as-is.scenario.json` as the app gives a new process: 20
    arrivals one minute apart on each start event and a minute of work on each task, ready to
    run and to patch.
  - **`mode: "replace"`** replaces the model of the process `process` (implicit when the `.lila`
    holds one). It keeps its name (`name` is refused here) and its scenarios; its revision goes up,
    so its saved runs are stale. The `lila:` annotations (RACI, references, extended attributes)
    and documentation are those of the new model: the old ones go with the old model. Scenario
    entries that no longer apply — those of an element the new model does not have, and the fields
    an element that changed type can no longer take — are removed and listed in
    `scenarioRemovals`, `{ scenario, id, removed, entry }`, exactly as `edit_process` lists them,
    and `notes` says the same in words. If a scenario still gets an error it did not have with the
    old model, the call is refused.
  - **`allowUnsimulatable: true`** keeps a model the simulator cannot run — message or signal
    events, collaborations, loops, a diagram drawn for documentation — the way the app saves one.
    Any validation error is accepted, and so is a scenario error on replace; each comes back in
    `notes` (`does not simulate: E-NOSOP: …`). A file that is not XML, not BPMN or has no
    `bpmn:process` is still refused. Nothing marks the process: «does not simulate» is what
    `get_scenario` says (`runnable: false`, the errors in its `notes`) and `run_simulation`
    refuses it, until the model is fixed.
  - **`layout`** (default `true`) draws a model without a diagram (no `bpmndi` shapes) with the
    auto-layout of `create_project` (`laidOut: true`); `false` keeps it as given.
  - The write is the atomic, locked write of `patch_scenario`: if the file changed on disk since
    it was read, the call is refused (`E-CAMBIO-EXTERNO`) and nothing is lost. Every other
    process stays byte for byte. `dryRun` checks everything and writes nothing.

```json
{ "name": "put_process_bpmn", "arguments": { "project": "credit.lila", "mode": "add",
  "bpmn": "examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn", "name": "MIWG A.1.0" } }
```

```json
{ "name": "get_process_bpmn", "arguments": { "project": "credit.lila", "process": "miwg-a-1-0" } }
```

```json
{ "name": "put_process_bpmn", "arguments": { "project": "credit.lila", "process": "miwg-a-1-0", "mode": "replace",
  "bpmn": "miwg-edited.bpmn", "allowUnsimulatable": true, "dryRun": true } }
```

## Renaming and deleting

`rename_process`, `delete_process`, `rename_scenario` and `delete_scenario` (#634) tidy up a
`.lila`. The renames follow the app; the deletes refuse what would leave the project with a
dangling reference. One tool per operation, so the two deletes are announced as
destructive (`destructiveHint: true`) and the two renames are not. Every refusal explains why, in
the call's language, and writes nothing. Every write is the atomic, locked write of
`patch_scenario` (`E-CAMBIO-EXTERNO` when the file changed on disk since it was read), every other
process stays as it was, and `dryRun` checks everything and writes nothing. `written` says whether
the file was saved; `summary` says what happened in one line.

- **`rename_process`** sets the process's `name`, the one its canvas tab shows. The slug (its
  `processes/<slug>/` folder) never changes. A project with a single process is written as a
  version 1 archive, whose process is named after the project, so renaming its process is refused.
  The same name writes nothing.
- **`delete_process`** removes a process with its scenarios and saved runs, listed in
  `removedScenarios` and `removedRuns`. The last process cannot be deleted. Neither can one that a
  call activity of another process names in its `calledElement` (with or without a prefix, as
  `tns:Process_B`): the refusal lists those call activities as `slug/elementId (name)`; point them
  elsewhere, or clear them, with `edit_process`'s `setCalledProcess`. Down to one
  process, the project is written as a version 1 archive, where that process takes the project's
  name and slug: `notes` says so and `slugs` lists what is left.
- **`rename_scenario`** sets the scenario's `"name"`; its entry (`<name>.scenario.json`) stays. Its
  revision goes up, and so do those of the scenarios that extend it, as in the app, so their saved
  runs go stale. A name that another scenario of the process already answers to (its `"name"`, or
  its file name with or without `.scenario.json`) is refused: `scenario` would no longer find one
  scenario by it. The same name writes nothing.
- **`delete_scenario`** removes a scenario with its revision and its saved runs, listed in
  `removedRuns`; `get_project` no longer lists them. The last scenario of a process cannot be
  deleted, and neither can one that other scenarios extend: the refusal lists them. Deleting
  `as-is.scenario.json` is allowed, but `edit_process` stores the durations, resources and branch
  probabilities it is given there, so `notes` warns that it no longer can.

```json
{ "name": "rename_process", "arguments": { "project": "credit.lila", "process": "miwg-a-1-0", "name": "Card dispute" } }
```

```json
{ "name": "delete_process", "arguments": { "project": "credit.lila", "process": "miwg-a-1-0", "dryRun": true } }
```

```json
{ "name": "rename_scenario", "arguments": { "project": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "name": "TO-BE", "dryRun": true } }
```

```json
{ "name": "delete_scenario", "arguments": { "project": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "dryRun": true } }
```

## App-free exports

`export_diagram`, `export_document` and `export_results` (#538) are `lila export diagram|doc|results`
(`docs/CLI.md`) as tools. They need no app and no browser:

- **The diagram** is the engine's SVG renderer: the BPMN DI geometry in the Lila Light colours
  on white. The HTML document embeds it, and the run's charts as SVG, the same as the app's
  Results charts. The cycle time histogram is left out, as a stored run keeps no per-case times.
  The Word document has **no diagram and no charts**: Word needs a PNG and the engine has no
  rasteriser. `notes` says what was left out.
- **Runs** are the ones the app saved in the `.lila`. `run: "latest"` (the default) is the run
  of the current model and scenario. `scenario` narrows it to one scenario, which is needed when
  several have a current run. `run: "<id>"` picks one, and an unknown id lists the ids; `run` and
  `scenario` together are an error. The
  document only takes a current run; without one it goes without results, and the `run` of the
  answer is `null`. `export_results` without a run is `isError`, with a message that says so. An
  older run's results are exported against the model it ran on.
- **Wait percentiles** (#666): `export_results` adds the resource-wait p50/p90/p95 per element
  (a `Percentiles` sheet, or `percentiles.csv`), computed as the app's Simulate dock does but over
  every replication, from simulating the run's stored inputs again. When that re-run does not give
  back the stored results exactly (another engine version, or arm64 against x64), they are
  left out and `percentiles` is `{ included: false, note }`. See `docs/RESULTS_FORMAT.md` § 12.
- **Nothing is overwritten.** An existing file at `saveTo` (or, for CSV, any of its files in
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
nothing was written. The stored run is always the full `RunResult`; the answer (its text and
`structuredContent`) is the summary or the full result as `detail` asks. A second text block says
`{ "savedRun": { "id", "file", "process", "scenario" } }`.

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
  several after a gateway), `branches` (gateways only: `{ label?, to, probability?, default? }`, or
  `{ label?, end: true | "terminate", probability?, default? }` for a branch that ends the process)
  or `end` (`true`, or `"terminate"` for a terminate end event, which ends the whole case, every
  parallel path included). The last step ends the process. End events are added, and so is the
  start unless `starts` is given.
- **`type`** defaults to `task`; the others are the task variants `userTask`, `serviceTask`,
  `sendTask`, `receiveTask`, `manualTask`, `scriptTask` and `businessRuleTask` (they simulate as
  `task`), `callActivity`, the gateways `xor`, `and`, `or` and `eventGateway`, the waits `timer` (an
  intermediate timer event) and `message` (an intermediate message event), and `subprocess` (a
  collapsed embedded sub-process with a pass-through start and end inside).
- **Default flows.** `default: true` marks one branch of an `xor` or an `or` as its default flow
  (one per gateway). In an `xor` it does not change the split: what is left of 1 still goes to the
  branches without a probability (R-XOR-2). In an `or` it is the fallback taken when no other
  branch is (R-OR-3).
- **The event gateway** (R-EVG-1). Every way out of an `eventGateway` — its branches, `next`, or the
  following step — goes to a `timer` or `message` step, never to an end, a task or a gateway; so an
  `eventGateway` cannot be the last step, have `end`, or have a branch with `end`. Each of those
  steps has that gateway as its only way in: the step before it in the list must not fall into it,
  and no other `next`, `to`, `from`, boundary event or second gateway may lead to it. A `message`
  step is only valid there. The branches take no `probability` and no `default`: the first event to
  happen wins. A branch without a `duration` never fires (R-EVG-5), and when none has one, cases
  stay at the gateway (R-EVG-6).
- **Starts.** `starts: [{ id, name?, type?, lane? }]` (`type` `none` or `timer`) replaces the
  implicit start; the start ids are yours. Each start is in the `from` of exactly one step (a start
  has one outgoing flow: to fork, put a gateway after it), and `from` only names starts and only
  exists with `starts`. A start's `lane` follows the rule of a step's and defaults to the lane of
  its step. `type: "timer"` is notation: the cases arrive by the scenario's arrivals on that start,
  as on a plain one (SEMANTICS §2), not by a calendar of the timer.
- **Boundary events.** `boundary: [{ id, type: "timer", name?, label?, duration?, interrupting?, to | end }]`
  on a task (any variant) or a call activity; not on a sub-process (#639). `to` names the step the
  boundary leads to; `end` (`true` or `"terminate"`) ends that path with the end event
  `EndEvent_<boundary id>`. `interrupting: false` leaves the task running and starts a parallel
  path; the default cuts it short. `label` names the flow out of it. The `duration` counts from the
  moment a case reaches the task, waiting for resources included; without one the boundary never
  fires (R-BND-8). A deadline longer than the run (`run.duration` is 1 h by default) never fires
  either: lengthen the run with `patch_scenario`.
- **Notes and data.** `notes: [text]` attaches text annotations to a step, in order, each text
  once per step (a repeated one is an error). `data: [{ name,
  direction }]` connects data objects to an activity (a task, a call activity or a sub-process):
  `in`, it reads the object; `out`, it writes it. Steps naming the same object share it; a name and
  direction appear once per step.
- **Ids.** Starts, steps and boundary events share one set of ids: unique, valid BPMN ids (NCName),
  and `next`/`to` name only steps (a `next` naming a start or a boundary event is "not the id of a
  step"), `from` only starts. Step ids become the BPMN ids, so scenarios key on them. No id may
  clash with the ids Lila generates (`StartEvent` without `starts`, `EndEvent_<step>`,
  `EndEvent_<boundary>`, `Flow_…`, `Lane_<n>`, `Process_…`, `<id>_di`). When two generated ids
  would clash (the second end of `x` and the end of a step `x_2`), the later one takes the first
  free `_<n>` suffix.
- **`lane`** defaults to the previous step's lane (the first lane for the first step). Lanes not
  listed in `lanes` are an error when `lanes` is given and are collected in order when it is not.
- **The base scenario.** The process gets `as-is.scenario.json`: the app's default arrivals for a
  new process (20 cases, one a minute) on each start, so two starts bring two streams of cases;
  every `duration` as `processingTime` (of a task, and the delay of a `timer`, a `message` or a
  boundary event), every `resources` entry (a name, or `{ name, quantity }`; a resource is created with
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
  join that waits for branches of one exclusive split (an `xor`, an `eventGateway`, or a task and
  its interrupting boundary event), where cases would wait forever.

```json
{ "name": "create_process", "arguments": { "project": "credit.lila", "outline": { "name": "Credit application", "lanes": ["Customer", "Analyst"], "steps": [ … ] } } }
```

```json
{ "file": "/work/credit.lila", "slug": "credit-application", "name": "Credit application", "newFile": true,
  "dryRun": false, "warnings": [], "notes": [], "slugs": ["credit-application"], "outline": { … },
  "summary": "Created process \"Credit application\" (credit-application) in the new file /work/credit.lila: 5 steps, 2 lanes, base scenario as-is.scenario.json." }
```

`get_process_outline` returns the outline in **normal form**: every step names its lane, and so
does every start; `type` is left out for `task`; `next` appears only when it is not simply the
following step; every step that finishes the process has `end: true` (`"terminate"` for a
terminate end event); gateway successors are `branches` (an `eventGateway` always has them, even
a single one) with `default: true` on the default flow of an `xor` or `or`; durations are
distribution objects in seconds and the XOR probabilities are filled in. `starts` is left out in
the trivial case — a single plain start `StartEvent` with no name in the lane of its step — and
then that step is moved to the head of the list (the others keep their order) and no step has
`from`; so `starts: [{ "id": "StartEvent" }]` with `from` on the third step normalizes to the
outline without `starts` whose first step is that one. Otherwise every start is listed and the
steps keep the document order. `from` lists a step's starts in the order of `starts`, one id as a
string and several as a list (like `next`). `boundary` keeps its order, with `interrupting` only
when it is `false`. `notes` keeps its order (when read, the document order of the associations).
`data` lists the reads first and then the writes, each in its order. That is the form `create_process` returns as `outline`, so a process round-trips.
Durations, resources and probabilities (and resource `selection`) come from the process's
`as-is.scenario.json` when it has one.

For a process Lila did not generate, the reading never returns an outline that `create_process`
would refuse: what an outline cannot say is left out, and `warnings` says so once per kind. That
covers other pools, message flows, the names of end events and of the flows out of a start,
start events other than plain or timer and end events other than plain or terminate (read as
plain events), a start with several outgoing flows (only the first is kept), event-based gateways
the simulator does not run (R-EVG-1: an instantiating or parallel one, or one with a branch to
anything but a timer or message catch event with one way in and one way out, such as a receive
task) and message catch events that are not a branch of one (left out with their flows),
boundary events other than timers, and boundary timers on a sub-process (#639), with an incoming
flow or with several outgoing flows, the timer expressions of the XML (`timeDuration`,
`timeDate`, `timeCycle` of timer starts, timer steps and boundary timers: durations live in the
scenario), default-flow marks out of anything but an `xor` or an `or` (and broken ones), branch
probabilities an outline cannot carry (out of an `and` or an `eventGateway`, or an `xor`'s adding
up to more than 1), groups, text annotations not attached to a step or with no text, a text
annotation that repeats a note of the same step (read once), data stores, data objects with no
name, two data objects with the same name, data associations with something that is not an
activity, nested lanes, and the parts of the scenario an outline does not carry (arrivals, calendars, costs,
resource capacities and types, conditional routing; the scenario itself is not changed). A
process with no name takes the one in the `.lila`, else its id.

### Example: a 48-hour escalation

`examples/outline/claim-escalation.json` (the outline is in the [agent guide](AGENT_GUIDE.md#example-escalate-after-48-hours))
models «if the adjuster has not decided in 48 hours, a supervisor steps in» as a non-interrupting
boundary timer on the task, and «the customer confirms or, after five days, the claim is closed» as
an event gateway between a `message` step and a `timer` step that ends with `"terminate"`:

```json
{ "id": "assess", "name": "Assess claim", "type": "userTask", "lane": "Adjuster",
  "duration": "triangular(4h, 24h, 72h)", "resources": ["Adjuster"],
  "boundary": [ { "id": "sla", "type": "timer", "name": "48 h", "duration": "48h", "interrupting": false,
                  "label": "No decision in 48 h", "to": "escalate" } ] }
```

The base scenario runs for one hour (`run.duration` 3600 s), so no case would ever reach the
48-hour deadline or the five-day wait: lengthen the run with `patch_scenario` before
`run_simulation`. The four calls, as the e2e test `outline-constructs.e2e.test.ts` makes them:

```json
{ "name": "create_process", "arguments": { "project": "claims.lila", "outline": { "name": "Claim handling", … } } }
{ "name": "patch_scenario", "arguments": { "project": "claims.lila", "scenario": "as-is",
  "patch": [ { "op": "replace", "path": "/run/duration", "value": 5184000 } ] } }
{ "name": "run_simulation", "arguments": { "model": "claims.lila", "scenario": "as-is", "saveRun": true } }
{ "name": "export_document", "arguments": { "project": "claims.lila", "format": "html", "saveTo": "claims.html" } }
```

The deadline is the scenario entry `elements.sla.processingTime`, never a `timeDuration` in the
XML. `elements.sla.completed` counts the deadlines that fired. `byEndEvent` counts each case at the
end of the path that finished last, so an escalated claim that was then paid counts under
`EndEvent_pay`. To put the same deadline on a process that already exists, use `addBoundary`:

```json
{ "name": "edit_process", "arguments": { "project": "claims.lila", "operations": [
  { "op": "addBoundary", "on": "assess", "boundary": { "id": "sla", "type": "timer", "name": "48 h",
    "duration": "48h", "interrupting": false, "label": "No decision in 48 h", "to": "escalate" } } ] } }
```

## Modelling tools for agents

`annotate_element`, `define_attribute`, `get_raci_matrix`, `import_scenario_sheet`,
`export_scenario_template` and `create_project` (#99, #633, #403, #514) let an agent build and
document a project with no app. The CLI has them as `lila process
annotate|attribute|raci`, `lila scenario import|template` and `lila project create` (`docs/CLI.md`). Every write goes through the same atomic, locked `.lila` save as
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
  (`changed: false`). It writes where the app reads: a pool's description is the description of
  the process it references (written there, and named in `documentationOn`), and a process
  inside a pool keeps its RACI and references on the pool, so `responsibilities` or `refs` on
  such a process are refused with a message that names the pool.
- **`define_attribute`** declares an extended attribute (#633), so `annotate_element` can fill it
  in: `get_project` lists what a process defines. Pass the whole definition every time: `name`,
  `type` (`text`, `number`, `list`, `date`), `appliesTo` (`task`, `gateway`, `event`,
  `subProcess`, `lane` for pools and lanes, `process`), and `options` and `default` when it has
  them. It changes the definition with that `id`; without `id`, the one with that name (any case)
  and `appliesTo`; else it creates one with a deterministic id, `Attr_` and the name in lowercase
  ASCII (`"SLA (h)"` → `Attr_sla_h`, then `_2`… when taken), so a dry run and the write name it
  alike and calling it again changes nothing (`changed: false`). The rules are the app's attribute
  dialog's: a name unique per element type (ignoring case), a `list` with at least one option
  (trimmed, repeats dropped), `options` only on a `list`, and a `default` that fits the type.
  Definitions are written on the `bpmn:collaboration` (else the process), and copies elsewhere are
  moved there (`docs/BPMN_EXTENSION.md`). A rename keeps every value. `remove: true` (with `id`, or
  `name` and `appliesTo`) removes the definition and its values; retyping, changing `appliesTo` or
  taking options away removes the values that no longer fit, as the app's «clear» does. Either
  way `removedValues` lists them (`[{ elementId, value }]`), in a `dryRun` too; `definitions` is
  the process's whole list afterwards.
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
  `lint` issue is refused (it is reported by a `dryRun`). As in the app, the valid rows are written
  even when other rows are not applied, so read `issues`. The scenario's revision goes up by one.
- **`export_scenario_template`** is the app's «Download template»: hand it to a person, then
  import what comes back. An existing `saveTo` is refused unless `overwrite`.
- **`create_project`** takes `bpmn` as inline XML (it starts with `<`) or a path to a `.bpmn`.
  A model with validation errors is refused, unless `allowUnsimulatable: true` (#632): then it is
  kept as a diagram that does not simulate, and its errors come back in `notes` (see
  [Raw BPMN of a process](#raw-bpmn-of-a-process)). `scenarios` are `[{ "name", "scenario" }]`, saved
  as `<name>.scenario.json`; a scenario with neither `model` nor `extends` gets
  `"model": "model.bpmn"`, and one that names another model is refused. A scenario that cannot
  run yet is a draft: it is saved, and comes back with `runnable: false` and its `errors`. The
  file is written whole or not at all, and an existing one is refused unless `overwrite`. The web
  and desktop apps open it. A model without a diagram (no `bpmndi` shapes) gets one, drawn by the
  same auto-layout as `edit_process` with `layout: true`, for the process it simulates, so
  `export_diagram` works on it; `laidOut: true` says so (#630). A model the layouter cannot place
  is saved as given.

```json
{ "name": "create_project", "arguments": { "path": "project.lila", "name": "Orders", "bpmn": "examples/pedido/model.bpmn",
  "scenarios": [{ "name": "as-is", "scenario": { "version": 1, "name": "AS-IS", "run": { "start": "2026-10-05T08:00:00-06:00", "duration": 28800, "seed": 1 },
    "elements": { "StartEvent_Pedido": { "interTriggerTimer": { "type": "exponential", "mean": 300 } } } } }] } }
```

```json
{ "name": "annotate_element", "arguments": { "project": "project.lila", "elementId": "Task_TomarPedido",
  "documentation": "Takes the order at the counter.", "responsibilities": [{ "type": "R", "roleRef": "cashier" }, { "type": "A", "roleRef": "manager" }],
  "refs": { "systemRef": ["POS"] } } }
```

```json
{ "name": "define_attribute", "arguments": { "project": "project.lila", "name": "Risk level", "type": "list",
  "appliesTo": "task", "options": ["Low", "High"], "default": "Low" } }
```

```json
{ "name": "annotate_element", "arguments": { "project": "project.lila", "elementId": "Task_TomarPedido",
  "attributes": { "Risk level": "High" } } }
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

## Editing a process

`edit_process` (#98) changes a process that already exists, whoever made it: `create_process`, the
app, or a Bizagi import. It takes a list of `operations`, applies them in order on the model in
memory, validates the result and writes it only when every operation was fine, the model has no
validation error it did not have before, and every scenario of the process still simulates.
Otherwise nothing is written and the call fails with every problem at once — malformed fields and
semantic ones in one pass, in the call's language — each with the index of its operation and a path
(`operations[2].after: …`, `operations[3].nombre: unknown field "nombre".`, `operations[0].bpmn.Process_1:
E-SIN-START: …`). `operations` that is not a list is an error too (`operations: must be a non-empty
list of operations.`). `lila process edit` (`docs/CLI.md`) does the same from a
terminal.

```json
{ "name": "edit_process", "arguments": { "project": "credit.lila", "operations": [
  { "op": "add", "step": { "id": "verify", "name": "Verify identity", "duration": "5m", "resources": ["Analyst"] }, "after": "receive" },
  { "op": "connect", "from": "ok", "to": "verify", "label": "Retry", "probability": 0.1 },
  { "op": "rename", "id": "issue", "name": "Issue the card" },
  { "op": "setType", "id": "check", "type": "serviceTask" },
  { "op": "addLane", "name": "Back office" },
  { "op": "moveToLane", "id": "issue", "lane": "Back office" },
  { "op": "remove", "id": "reject" } ] } }
```

| Operation | Fields | What it does |
| --- | --- | --- |
| `add` | `step`, `after?` or `between?` | Adds a step. `step` is an outline step without its connections, boundary events, notes or data: `{ id, name?, type?, lane?, duration?, resources? }`, any outline type. With `after: id`, the new step takes over that step's outgoing flow (refused when it has several: use `between`). With `between: [from, to]`, it goes on the flow from → to. The flow it lands on keeps its id, name and probability; a new flow continues to the old successor. Without either, it is added unconnected. `lane` defaults to the lane of the step it follows. |
| `connect` | `from`, `to`, `label?`, `probability?`, `default?`, `id?` | Adds a sequence flow (id `Flow_<from>_<to>` by default). `probability` and `default: true` (the gateway's default flow) only out of an `xor` or `or` gateway; `default: true` is refused when the gateway already has a default flow. No operation marks an existing flow as the default or clears the mark: in one call, `connect` the same steps again (with `default: true` or without it, and the `label` and `probability` to keep) and `remove` the old flow, after removing the gateway's current default flow if it has one; the flow gets a new id. |
| `remove` | `id` | Removes a step and reconnects: its incoming flows go to its successor when it has at most one; a step with no incoming flow loses its outgoing ones; a step with several incoming and several outgoing flows (a split after a join) is refused. A step with boundary events is refused. Message flows and associations attached to it go with it, and so do its text annotations, its data associations and the data objects nothing else uses (listed in the change). An end event left with no incoming flow goes too (listed in `removed`). A sequence flow, a boundary event, a text annotation, a data object or data store, a group or an association can be removed too. |
| `rename` | `id`, `name` | Renames any element: step, flow, lane, pool, process. A lane can also be named by its name, when no element has that id. `""` clears the name. |
| `setType` | `id`, `type` | One of the outline types, or `end`/`terminate` to turn an end event into a terminate end and back. For those two, `id` is the end event's (`EndEvent_<step>` in a process Lila made; the outline does not show it otherwise), or a step that leads to exactly one end event: then that end is retyped, not the step. `end`/`terminate` on anything else (neither an end event nor a step with exactly one end event after it) is refused. Name, documentation, extension elements and flows stay; a sub-process turned into something else loses its content (listed in `removed`). An `xor` or `or` turned into an `and` or an `eventGateway` loses the probabilities of its outgoing flows (listed in `scenarioRemovals`). |
| `moveToLane` | `id`, `lane` | Lane by name or id. The step's boundary events, and the end events they lead to, move with it. |
| `addLane` | `name`, `id?`, `after?` or `before?` | Adds a lane (at the bottom by default). The first lane of a process without lanes holds all its steps, and a process without a pool gets one. |
| `removeLane` | `lane`, `moveStepsTo?` | Removes a lane (by name or id). A lane that holds any node — a step, a start, an end event, a boundary event or its end — needs `moveStepsTo`, another lane with no sub-lanes that takes them. A lane with sub-lanes is refused. The only lane of the process is the exception: removing it removes the lane set, its nodes stay in the pool without lanes, and `moveStepsTo` is not needed. |
| `moveLane` | `lane`, `before` or `after` | Moves a lane above (`before`) or below (`after`) a sibling lane; exactly one of the two. |
| `addBoundary` | `on`, `boundary` | Attaches a boundary timer to a task (any variant) or a call activity, not a sub-process. `boundary` is as in an outline: `{ id, type: "timer", name?, label?, duration?, interrupting?, to \| end }`. Its `duration` goes into the base scenario. |
| `annotate` | `on`, `text` | Attaches a BPMN text annotation to a step (it reads back as the step's `notes`). The same text on the same step again changes nothing, so `removeAnnotation` is never ambiguous. Not to be confused with `annotate_element`, which writes the documentation, RACI and attributes (`lila:` annotations). |
| `removeAnnotation` | `on`, `text` | Removes the annotation with that text attached to the step, with its association (every one, in a model from elsewhere that repeats it). |
| `addDataObject` | `name`, `on`, `direction` | Connects a data object to an activity (a task, a call activity or a sub-process): `in`, the activity reads it; `out`, the activity writes it. An object with that name in the process is reused, otherwise one is created. |
| `removeDataObject` | `name`, `on?` | Disconnects the data object from the activity `on`, or from every activity without it. The object goes when nothing uses it any more. |
| `setCalledProcess` | `id`, `process` | Sets the process the call activity `id` calls: `process` is the slug of another process of the same `.lila`, and the call activity's `calledElement` becomes a BPMN process id that process's model declares (its `model.id` when it is one; else its only process, else the process it simulates), the one the app opens on a double-click. `process: null` removes the `calledElement`. An unknown slug is refused with the slugs a call activity can call, and so are the process being edited (a call activity does not call its own process), a process whose BPMN process id another process of the `.lila` declares too (the call could not tell them apart: give one of them another id with `put_process_bpmn` `mode: "replace"`), a process none of whose ids can be told to be the one, and an `id` that is not a call activity. Only in a `.lila`: a bare model has no other process to name. A process some call activity names cannot be deleted with `delete_process` until it is pointed elsewhere or cleared. |

- **Ids never change.** A renamed step keeps its scenario entries, and so does a retyped one, as
  far as they still apply. `duration`, `resources` and `selection` of an added step and the
  `probability` of a connection go into the process's `as-is.scenario.json`, as with
  `create_process` (a resource with the same name or key is reused). A process without that
  scenario refuses those fields.
- **After an edit the process still simulates.** Scenario entries that no longer apply are removed
  from every scenario of the process: the whole entry of an element the edit removed, and the
  fields a retyped element cannot take (resources on a gateway, a sub-process or a timer; a
  duration on a sub-process…), and the probabilities of the flows out of a gateway retyped to
  `and` or `eventGateway`. Nothing goes silently: `scenarioRemovals` lists each one as
  `{ scenario, id, removed, entry }`, with the removed fields and their previous values, so an agent
  can put them back elsewhere with `patch_scenario`; `notes` says the same in words, and a dry run
  returns the same report. Then every scenario is validated against the edited model, and an error
  it did not have before refuses the edit. `removed` lists every id that left the model. `notes`
  also flags an XOR whose branch probabilities no longer add up to 1, naming the flows to patch.
- **What is not touched stays**: documentation, `lila:` annotations (RACI, references, extended
  attributes), other vendors' extensions, the text annotations, data objects and groups no
  operation names, other pools and message flows. A model the BPMN reader cannot read completely is refused rather than written back with
  something missing.
- **Layout.** By default (`layout: true`) the edited process is laid out again with the same
  layouter and lane fix as `create_process`: positions set by hand in that process are lost; text
  annotations and data objects follow their element, and those with no shape yet (a model that
  arrived without a diagram) get one beside it, or in a row below the drawing when they hang on
  nothing (#630); pools below (or beside) it move as one piece
  by as much as it grew. With `layout: false` every shape keeps its place: a new step goes right of
  the step it follows, in its lane (which grows a row when it is full), and only flows whose ends
  changed are drawn again. To make room for a step inserted between two close steps, what lies to
  its right in that pool shifts right by one amount; pools and lanes only get wider or taller,
  except with `removeLane` and `moveLane`, which move whole bands: every step keeps its x, and the
  flows that cross from one band to another are drawn again. A new annotation or data object goes
  beside its step, over no other shape.
- **Which process**: `process` when the `.lila` holds several. Inside its BPMN, the process the
  simulator reads (the executable, non-empty one); steps of other pools cannot be edited.
- The write is the same atomic, locked write as `patch_scenario`: if the file changed on disk since
  it was read (another agent, the app), the call is refused and nothing is lost. The model's
  revision goes up, so the app sees its old runs as stale. Every other process stays byte for byte.
  With `dryRun`, everything is checked and returned and nothing is written.

```json
{ "file": "/work/credit.lila", "slug": "credit-application", "name": "Credit application", "dryRun": false,
  "summary": "Edited process \"Credit application\" (credit-application) in /work/credit.lila: 7 operations, 2 elements removed.",
  "changes": [ { "op": 0, "message": "added task \"verify\" after \"receive\" in lane \"Analyst\"" }, … ],
  "removed": [ "Flow_reject_EndEvent_reject", "reject" ],
  "scenarioRemovals": [], "notes": [ "gateway \"ok\": the probabilities of its outgoing flows in as-is.scenario.json now add up to 1.1; adjust them with patch_scenario, one {\"op\": \"replace\", \"path\": \"/elements/<flow>/probability\", \"value\": …} per flow of Flow_ok_issue, Flow_ok_reject, Flow_ok_verify." ],
  "warnings": [], "outline": { … } }
```

## MCP and CLI side by side

Every tool runs the same engine code as its CLI command, so an agent that only has a shell gets
the same answers. The `--json` of the project, process and scenario commands prints what the tool
returns; `lila run|compare --json <file>` write the full result to a file, like `saveTo` (the tools
answer with a summary unless `detail: "full"`).

| MCP tool or field | CLI | Note |
| --- | --- | --- |
| `validate_bpmn` | `lila validate --json` | |
| `describe_process` | `lila validate` | The CLI prints the IR and the problems; the readable `resumen` is written for an agent and is MCP only. |
| `run_simulation` | `lila run --json` | `saveRun` is `--save`, `saveTo` is `--json <file>`, `logTo` is the `log.csv` of `--csv <directory>`. The four result CSVs of `--csv` come from a stored run with `export_results`. |
| `compare_scenarios` | `lila compare --json` | `saveTo` is `--json <file>`, or `--xlsx <file>` with `format: "xlsx"`; `all: true` (or `detail: "full"`) is `--all`. |
| `patch_scenario` with `project` | `lila scenario patch` | `dryRun` is `--dry-run`. |
| `patch_scenario` without `project` | none | Patching a loose `.json` scenario is MCP only; from the CLI, edit the file. |
| `export_diagram` | `lila export diagram` | |
| `export_document` | `lila export doc` | |
| `export_results` | `lila export results` | Same `Percentiles` sheet and `percentiles.csv`; the CLI prints the `percentiles.note` on stderr. |
| `create_process` | `lila process create` | |
| `get_process_outline` | `lila process show` | |
| `edit_process` | `lila process edit` | |
| `annotate_element` | `lila process annotate` | |
| `define_attribute` | `lila process attribute define` | `lila process attribute list` lists them; `get_project` does for MCP. |
| `get_raci_matrix` | `lila process raci` | `--csv` is CLI only: an agent builds the CSV from `rows`. |
| `import_scenario_sheet` | `lila scenario import` | |
| `export_scenario_template` | `lila scenario template` | |
| `create_project` | `lila project create` | `overwrite` is `--force`; `scenarios` are `--scenario name=file.json`. |
| `get_project` | `lila project show` | |
| `get_scenario` | `lila scenario show` | |
| `get_process_bpmn` | `lila process export-bpmn` | |
| `put_process_bpmn` | `lila process import` | `mode: "replace"` is `--replace`. |
| `rename_process` | `lila process rename` | `dryRun` is `--dry-run`. |
| `delete_process` | `lila process delete` | `dryRun` is `--dry-run`. |
| `rename_scenario` | `lila scenario rename` | `dryRun` is `--dry-run`. |
| `delete_scenario` | `lila scenario delete` | `dryRun` is `--dry-run`. |
| Resources and the prompt | none | Part of the protocol; the CLI has `--help` and `docs/`. |

## Summary or full results

A full `RunResult` lists every element and flow with every statistic: about 70 KB (some 20k tokens)
for a ten-step process, and a full comparison more than twice that. `run_simulation` and
`compare_scenarios` therefore answer with a summary by default (#629), and `detail: "full"` returns
today's whole result. `saveTo` and `saveRun` always store the full result, whatever `detail` says,
so a client with a filesystem can keep everything and read only the summary.

The summary of `run_simulation` (`"detail": "summary"`):

- `process`: cycle time, wait time, throughput, cost per case and `byEndEvent`, as in the full result;
- `bottlenecks`, as in the full result;
- `resources`: for each resource, `utilization`, `resourceWaitTotal` (the resource wait, in seconds,
  of every element that lists it; with `selection: "or"`, of every alternative) and `totalCost`.
  An element that lists two resources counts its whole wait for each of them, so the same wait
  shows in both totals: in `examples/pedido` the wait of `Task_Preparar`, which needs Cook and
  Oven, is in both. The totals of several resources do not add up to the process wait;
- `topWaits`: the five elements that wait most (resource wait plus off-hours wait), with their
  `name`, `completed`, `resourceWaitMean`, `resourceWaitTotal`, `offHoursWaitMean` and
  `queueLengthMean`;
- `replications`, the number of replications (when there are several), and `cancelled` /
  `completedReplications` as in the full result;
- `warnings` as `{ message, count }`: a warning that each replication repeats with other numbers
  (`… (2941 times)`, `… 1457 cases …`) comes once, with the first message and how many times it came up.
  A coded warning comes once per code and element (`W-JOIN-BLOQUEADO` of `Join_1`, whether one case
  or several were left); the full result keeps every message.

The summary of `compare_scenarios` keeps `{ comparison, notes }`: `comparison` has `count`, the rows
of scope `process` and `resources`, every other row marked `significant` for some scenario, and
`omittedRows`, the number of rows left out. The rows are the full result's rows, unchanged.

For the credit card process of the [agent guide](AGENT_GUIDE.md) flow (`agent-flow.e2e.test.ts`) the summary is
about 4.4 KB against 68 KB in full; a test keeps it under 8 KB.

```json
{ "name": "run_simulation", "arguments": { "scenario": "examples/pedido/as-is.scenario.json", "seed": 42, "detail": "full" } }
```

## Resources and prompt

The server serves the docs an agent needs as MCP resources, in the server's language (`lila mcp
--lang`, `LILA_LANG`…; English by default), so a client that only has MCP does not have to guess the
formats from the tool descriptions:

| URI | Content |
| --- | --- |
| `lila://guide` | The [agent guide](AGENT_GUIDE.md) (`docs/es/GUIA-AGENTES.md` in Spanish). |
| `lila://outline-format` | The outline: the guide's example and field table, then [the rules](#creating-a-process-from-an-outline). |
| `lila://scenario-format` | [`SCENARIO_FORMAT.md`](SCENARIO_FORMAT.md). |
| `lila://scenario-schema` | [`scenario.schema.json`](scenario.schema.json), the JSON Schema of a scenario. |

The prompt `interview-to-process` (arguments `transcript` and `project`, both optional) is the
guide's flow, steps 1 to 8, followed by the interview; without `transcript` it asks for it first.

They are the docs themselves: from a checkout the server reads `docs/`, and the published package
carries copies of the same files in `dist/resources/` (`prepack` runs
`packages/mcp/scripts/bundle-resources.mjs`). A client that only has MCP cannot follow a relative
link, so the server makes them absolute links to the docs on GitHub (`main`).

```json
{ "method": "resources/read", "params": { "uri": "lila://guide" } }
```

## Progress and cancellation

`run_simulation` and `compare_scenarios` simulate in a worker thread, so the server keeps answering
(a `ping`, other calls) while a run works. When the call carries `_meta.progressToken`, the server
sends `notifications/progress` once per completed replication, with `progress` (replications done)
and `total` (`run.replications`, or the sum over the scenarios of a comparison). A client's
`notifications/cancelled` that arrives while a run simulates stops it at once: the worker is
terminated, nothing is saved (the temporary file of a `logTo` is removed too), and, as MCP
requires, no answer is sent for the cancelled request. Once the simulation is over (for
`compare_scenarios`, the last scenario's), the writes are not interrupted: a cancellation that
arrives while `saveTo`, `saveRun` or `logTo` is being written still leaves those files written;
only the answer is not sent.

```json
{ "method": "tools/call", "params": { "name": "run_simulation", "arguments": { "scenario": "examples/pedido/as-is.scenario.json", "replications": 30 }, "_meta": { "progressToken": 1 } } }
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

The server is published on npm as its own package, `@lila-modeler/mcp` (ADR-030), with Node 22 or
later. An MCP client starts it with:

```bash
npx -y @lila-modeler/mcp
```

`-y` lets npx install it without asking. The package pins the exact `@lila-modeler/engine` version
it was released with, so the server and the `lila` CLI of the same version give the same numbers.
`lila mcp`, the engine's subcommand, loads this package (a dynamic `import()`, to avoid a package
cycle) and starts the same server when both are installed
(`npm install -g @lila-modeler/engine @lila-modeler/mcp`).

To run unreleased changes, start it from a repository checkout instead:

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
node packages/engine/bin/lila.js mcp    # or ./node_modules/.bin/lila-mcp, the same server
```

Every client below starts the server as a subprocess over stdio: `command` is `npx` and `args` are
`-y` and `@lila-modeler/mcp`. When the client does not inherit your `PATH`, give `command` as an
absolute path (`which npx`), and add the directory of `node` to the server's `PATH` if it still
cannot find it. From a checkout, `command` is `node` and `args` are the absolute path to
`packages/engine/bin/lila.js` and `mcp`. Missing packages and startup diagnostics go to stderr;
stdout carries only MCP protocol messages. Set the environment variable `LILA_LANG=es` for Spanish
messages (`lila mcp` also takes `--lang es`).

## Register with Claude Code

```bash
claude mcp add lila -- npx -y @lila-modeler/mcp
```

`-s user` registers across projects; otherwise the registration is local. Check with
`claude mcp list`. Inside this repository there is nothing to register: it includes a project
`.mcp.json` that starts the checkout's own server:

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

Claude Desktop does not inherit your shell's `PATH`, so give `npx` as an absolute path
(`which npx`):

```json
{
  "mcpServers": {
    "lila": {
      "command": "/absolute/path/to/npx",
      "args": ["-y", "@lila-modeler/mcp"]
    }
  }
}
```

The usual configuration locations are
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and
`%APPDATA%\Claude\claude_desktop_config.json` on Windows. Restart the client after editing.
Use absolute model and scenario paths rather than relying on a client-specific working directory.

## Register with Codex

```bash
codex mcp add lila -- npx -y @lila-modeler/mcp
```

or, in `~/.codex/config.toml`:

```toml
[mcp_servers.lila]
command = "npx"
args = ["-y", "@lila-modeler/mcp"]
```

## Register with Hermes Agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) reads stdio
servers from `mcp_servers` in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  lila:
    command: "/absolute/path/to/npx"
    args: ["-y", "@lila-modeler/mcp"]
    cwd: "/absolute/path/to/your/projects"
    env:
      LILA_LANG: "es"
    timeout: 300
```

- Hermes does not hand the server your whole environment: it passes a safe baseline (`PATH`,
  `HOME`, `LANG`, `TMPDIR`, `XDG_*` and similar) plus the variables listed in `env`. Put `LILA_LANG`
  or anything else Lila should see in `env`, and give `command` as an absolute path to `npx`
  (`which npx`) when the `PATH` Hermes runs with may not find it.
- `cwd` is where relative tool paths (`project: "card.lila"`, `saveTo`) land. Only recent Hermes
  versions pass it to the server; older ones (v0.17.0, for one) ignore it. Absolute paths in the
  calls work with every version, so prefer them.
- `timeout` is per tool call, in seconds: a long `run_simulation` or `compare_scenarios` blocks the
  server until it finishes, so leave room for it.
- Run `/reload-mcp` in a Hermes session after editing the file. Hermes names the tools
  `mcp_lila_<tool>` (`mcp_lila_create_process`); the arguments are the ones on this page.
- `tools: { include: [...] }` limits what the agent sees, for example to the read-only
  `get_project`, `get_scenario`, `validate_bpmn`, `describe_process`, `get_process_outline`,
  `get_raci_matrix` and `run_simulation` (which writes only with `saveTo`, `saveRun` or `logTo`).

The same block, with `command` and `args`, is the generic stdio configuration for any other MCP
client.

## Examples

One call per tool that the sections above do not already show. The tool calls are written as an
agent sends them (`name` and `arguments`); paths are relative to the server's working directory.

Validate a model, or one process of a `.lila`:

```json
{ "name": "validate_bpmn", "arguments": { "path": "examples/pedido/model.bpmn" } }
```

Describe it, with the resources of a scenario:

```json
{ "name": "describe_process", "arguments": { "path": "examples/pedido/model.bpmn", "scenario": "examples/pedido/as-is.scenario.json" } }
```

Run a scenario:

```json
{ "name": "run_simulation", "arguments": { "scenario": "examples/pedido/as-is.scenario.json", "seed": 42 } }
```

Compare scenarios (the first is the baseline):

```json
{ "name": "compare_scenarios", "arguments": {
  "scenarios": ["examples/pedido/as-is.scenario.json", "examples/pedido/to-be-3-cajeros.scenario.json"], "seed": 42 } }
```

Create a derived scenario without changing AS-IS:

```json
{ "name": "patch_scenario", "arguments": {
  "scenario": "examples/pedido/as-is.scenario.json",
  "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 3 }],
  "saveTo": "examples/pedido/to-be-3-cajeros-copy.scenario.json",
  "name": "TO-BE 3 cashiers (copy)" } }
```

`saveTo` is a new file: never point it at a scenario the repository tracks (such as
`to-be-3-cajeros.scenario.json`), since it is overwritten. This writes `version`, `name`,
`extends: "as-is.scenario.json"` and
`resources: { "cajero": { "capacity": 3 } }`. Inline scenarios use the same resolved format;
relative model paths are resolved against the server's working directory.

Read a process back as an outline:

```json
{ "name": "get_process_outline", "arguments": { "project": "credit.lila", "process": "credit-application" } }
```

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
replace a file unless `overwrite: true` (see [App-free exports](#app-free-exports)). `run_simulation` and `compare_scenarios` save the
full result whatever `detail` asks. `compare_scenarios` saves only `comparison`,
without `notes`, matching CLI JSON output, or with `format: "xlsx"` the comparison workbook.
The `logTo` of `run_simulation` follows the same rules. For `patch_scenario`, omitting `saveTo` selects
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

- With `detail: "full"`, simulation results are returned as both text and `structuredContent`,
  doubling a large payload; the default summary keeps it small.
- `compare_scenarios` returns structured content but does not publish an `outputSchema`.
- There is no limit on concurrent simulations: each `run_simulation` and `compare_scenarios` call
  runs in its own worker thread, so a client that sends several at once runs them all in parallel,
  with the CPU and memory of each.
- The packages declare Node 22 or later, but running the tests from `src/` (`npm test`) needs
  Node 22.18 or later: the server then starts its simulation worker from `src/simulate-worker.ts`,
  which relies on Node's TypeScript type stripping (on by default from 22.18). The built server
  (`dist/`) runs on any Node 22.
- File writes use server permissions and can overwrite files without an interactive confirmation.
- `create_process` lays out with `bpmn-auto-layout` 1.3, which draws no pool or lanes: Lila keeps
  its columns and rows, moves each node into its lane, routes the flows again orthogonally (around
  the shapes in their way) and places every branch label on its own branch. Lanes can come out
  taller than needed, a gateway's name can sit on a flow that leaves it from below, and a
  sub-process is created collapsed with an empty pass-through inside. Move things in the app
  when the picture matters.
- `edit_process` with `layout: true` lays out the whole edited process again (manual positions in
  it are lost); an expanded sub-process becomes a collapsed one, and vertical pools (as Bizagi
  draws them) become horizontal. With `layout: false`, placement is simple: right of the
  predecessor, in its lane; it does not untangle crossings. Only the main process of the BPMN can
  be edited, and nested lanes only through their leaf lanes. Start events are neither added nor
  retyped by `edit_process`: give them in the outline (`starts`) or change them in the app.
