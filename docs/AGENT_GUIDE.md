# Agent guide

> Read this in: [Español](es/GUIA-AGENTES.md)

This guide is for an agent (Claude Code, Claude Desktop, Codex, Hermes Agent or any MCP client)
that turns what people say about a process into a model, a simulation and a document, with no one
clicking in the app. Every step is an MCP tool of `lila mcp` ([`MCP.md`](MCP.md), where each tool
has its full contract) or the matching `lila` command ([`CLI.md`](CLI.md)). Steps 2 to 7 below,
one tool call at a time, run in CI with no UI: `packages/mcp/test/agent-flow.e2e.test.ts`, starting
from the synthetic interview `packages/mcp/test/fixtures/entrevista-tarjeta.txt`. Step 8 needs the
desktop app, so it is checked by hand with `tools/agent-live-check.mjs`.

Setting up the server for each client is in [`MCP.md`](MCP.md#installation).

## The flow

| Step | Tool | CLI |
| --- | --- | --- |
| 1. Read the interview, write an outline | (the agent) | |
| 2. Create the process | `create_process` | `lila process create` |
| 3. Fix it | `edit_process`, `get_process_outline` | `lila process edit`, `lila process show` |
| 4. Document it (optional) | `annotate_element`, `get_raci_matrix` | `lila process annotate`, `lila process raci` |
| 5. Fill the scenario | `patch_scenario`, or `export_scenario_template` + `import_scenario_sheet` | `lila scenario template`, `lila scenario import` |
| 6. Simulate and keep the run | `run_simulation` with `saveRun: true` | `lila run … --save` |
| 7. Hand over | `export_document`, `export_results`, `export_diagram` | `lila export doc|results|diagram` |
| 8. Show it | open the `.lila` in the app; it reloads on every later write | `open -a "Lila Modeler" file.lila` (macOS) |

Two rules shape the flow:

- **The outline is the map, the scenario the numbers.** Put the lanes, the steps, the order and the
  branches in the outline. Times, staff, arrivals and costs are scenario data: you can put
  `duration`, `resources` and branch `probability` in the outline (they go into the base scenario
  `as-is.scenario.json`), but anything else goes through `patch_scenario` or a sheet.
- **Everything is the `.lila`.** There is no server state. Every tool reads the file, does its
  work and, if it writes, writes the whole file atomically. The desktop app that has it open
  reloads it by itself.

### 1. From the interview to an outline

Read the transcript and write down: the roles that do the work (lanes), each thing someone does
(a step, named verb + object: «Validate documents»), the decisions (`xor` gateways, with the
odds people give: «one in seven» is `0.15`), the waits (`timer`) and how each path ends. Keep the
interviewee's words for names; the person who reads the document will look for them.

Ask before you guess. A process the person cannot recognise is worse than a question.

### 2. `create_process`

```json
{ "name": "create_process", "arguments": { "project": "card.lila", "outline": { … } } }
```

`project` that does not exist becomes a new one-process `.lila`; one that exists gets a new process
(it never replaces one: pick another `process` slug). The answer carries the outline in normal
form, the `slug`, `warnings` and `notes`. Read `notes`: they flag models that would hang cases,
such as a parallel join waiting for branches of one exclusive split.

`dryRun: true` checks and returns everything without writing.

### 3. `edit_process` and `get_process_outline`

To change a process, do not create it again: `edit_process` applies a list of operations (`add`,
`connect`, `remove`, `rename`, `setType`, `moveToLane`, `addLane`) all or none, keeps every id and
everything the operations do not touch (documentation, RACI, attributes, other processes). Send it
with `dryRun: true` first and show the `changes` to the person when the edit is not trivial.

```json
{ "name": "edit_process", "arguments": { "project": "card.lila", "dryRun": true, "operations": [
  { "op": "add", "step": { "id": "verify", "name": "Verify identity", "duration": "5m" }, "after": "receive" },
  { "op": "rename", "id": "issue", "name": "Issue the card" } ] } }
```

**After any edit the process still simulates.** Scenario entries that no longer apply are removed
from every scenario of the process (the whole entry of a removed element, or the fields a retyped
element cannot take, such as resources on a gateway), and each removal is reported in
`scenarioRemovals` as `{ scenario, id, removed, entry }` with the previous values, so you can put
them back elsewhere with `patch_scenario`. A dry run returns the same report. Then every scenario is
validated against the edited model; an error it did not have before refuses the edit. `notes` also
names the flows to patch when an XOR's probabilities no longer add up to 1.

`get_process_outline` reads any process back as an outline, including one drawn in the app or
imported from Bizagi; `warnings` says what an outline cannot carry.

### 4. Annotations and RACI

`annotate_element` writes the description, the RACI list, the catalog references and the extended
attributes of one element by its BPMN id. `get_raci_matrix` returns the matrix the document will
print. Both are optional; the document is better with them.

### 5. The scenario

The base scenario `as-is.scenario.json` starts with the app's defaults (20 cases, one a minute, a
one-hour run) plus what the outline carried. Fill in the rest from the interview with one
`patch_scenario` (JSON Patch, validated before anything is written):

```json
{ "name": "patch_scenario", "arguments": { "project": "card.lila", "scenario": "as-is", "patch": [
  { "op": "replace", "path": "/run/duration", "value": 28800 },
  { "op": "remove", "path": "/elements/StartEvent/triggerCount" },
  { "op": "replace", "path": "/elements/StartEvent/interTriggerTimer", "value": { "type": "exponential", "mean": 900 } },
  { "op": "replace", "path": "/resources/branch-officer/capacity", "value": 3 },
  { "op": "replace", "path": "/resources/credit-analyst/capacity", "value": 2 },
  { "op": "add", "path": "/elements/issue/processingTime", "value": { "type": "constant", "value": 600 } } ] } }
```

Scenario times are seconds; the format is [`SCENARIO_FORMAT.md`](SCENARIO_FORMAT.md). Resource keys
are the slugs of their names (`Branch officer` → `branch-officer`). A JSON Patch `add` needs its
parent: when the outline had no `resources`, the scenario has no `/resources` yet, so add it whole
(`{ "op": "add", "path": "/resources", "value": { "branch-officer": { "name": "Branch officer", "capacity": 3 } } }`). For a TO-BE, pass `saveTo: "to-be-4-officers"`: the new scenario
inherits from the original and holds only the changed keys.

When the numbers come from people rather than from a transcript, hand them a sheet:
`export_scenario_template` writes the scenario as an `.xlsx` ([`SCENARIO_SHEETS.md`](SCENARIO_SHEETS.md)),
they fill it in, and `import_scenario_sheet` applies it (`dryRun: true` first: `changes` lists
each field before → after, `issues` the rows it could not apply).

### 6. `run_simulation` with `saveRun`

```json
{ "name": "run_simulation", "arguments": { "model": "card.lila", "scenario": "as-is", "seed": 42, "replications": 10, "saveRun": true } }
```

The answer is the `RunResult` (`structuredContent`, [`RESULTS_FORMAT.md`](RESULTS_FORMAT.md)) plus a
second text block `{ "savedRun": { "id", … } }`. The run is stored in the `.lila` exactly as the app
stores it, so the app shows it as the current run and the exports use it. Use a fixed `seed` so
the person can reproduce the numbers; use `compare_scenarios` to compare AS-IS and TO-BE.

### 7. Exports

- `export_document` writes the process document as `docx` or `html`: process, lanes, steps with
  their descriptions and RACI, gateways with their probabilities and the results of the current
  run. The HTML embeds the diagram as SVG.
- `export_results` writes the run's tables as `.xlsx` (or four CSV files).
- `export_diagram` returns or writes the diagram as SVG.

None of them overwrites a file unless `overwrite: true`, and none ever writes over the project.

### 8. Open it in the app

Open the `.lila` in Lila Modeler (double click, «Open», or `open -a "Lila Modeler" card.lila` on
macOS). From then on, every write by an agent (`create_process`, `edit_process`, `patch_scenario`,
a saved run…) shows up in the open window without a click: the app notices the change on disk and
reloads, keeping the mode, the active process and the scenarios. A new process appears as a new
tab. If the person has unsaved changes, the app does not throw them away: it shows «The file
changed outside Lila» with **Reload** and **Keep mine**. `tools/agent-live-check.mjs` checks this
against the real desktop app.

## The outline format

```json
{
  "name": "Credit card application",
  "lanes": ["Branch officer", "Credit analyst", "Control desk"],
  "steps": [
    { "id": "receive", "name": "Receive application", "lane": "Branch officer",
      "duration": "triangular(5m, 10m, 20m)", "resources": ["Branch officer"] },
    { "id": "validate", "name": "Validate documents", "duration": "normal(8m, 2m)", "resources": ["Branch officer"] },
    { "id": "complete", "type": "xor", "name": "Documents complete?",
      "branches": [ { "label": "Yes", "to": "bureau" }, { "label": "No", "to": "missing", "probability": 0.15 } ] },
    { "id": "missing", "name": "Request missing documents", "duration": "5m", "next": "validate" },
    { "id": "bureau", "type": "serviceTask", "name": "Query credit bureau", "lane": "Credit analyst",
      "duration": "exponential(mean=3m)" },
    { "id": "assess", "name": "Assess ability to pay", "duration": "normal(25m, 8m)", "resources": ["Credit analyst"] },
    { "id": "approved", "type": "xor", "name": "Approved?",
      "branches": [ { "label": "Yes", "to": "issue" }, { "label": "No", "to": "reject", "probability": 0.35 } ] },
    { "id": "issue", "name": "Issue card", "lane": "Control desk", "resources": ["Control desk"], "end": true },
    { "id": "reject", "name": "Notify rejection", "lane": "Branch officer", "end": true }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `name` | The process name (also the default slug). |
| `lanes` | Lane names in order. Optional: without it, lanes are collected from the steps. |
| `steps[].id` | The BPMN id. Scenarios key on it, so pick short stable ids. |
| `steps[].name` | The label. |
| `steps[].type` | `task` (default), `userTask`, `serviceTask`, `callActivity`, `xor`, `and`, `or`, `timer`, `subprocess`. |
| `steps[].lane` | Defaults to the previous step's lane. |
| `steps[].next` | The step(s) after this one when it is not simply the next in the list (a loop back, a join). |
| `steps[].branches` | Gateways only: `{ label?, to, probability? }` or `{ label?, end: true, probability? }`. XOR branches without a probability share what is left of 1. |
| `steps[].end` | This step ends the process (an end event is added after it). |
| `steps[].duration` | Seconds, `20m`, `1h30m`, `normal(20m, 5m)`, `triangular(1m, 2m, 5m)`, `exponential(mean=4m)`, or a distribution object in seconds. |
| `steps[].resources` | Names, or `{ name, quantity }`. With several, `selection: "or"` takes any one of them. |

The order of the list is the flow. Start and end events are added; ids such as `StartEvent`,
`EndEvent_<step>` and `Flow_<from>_<to>` are Lila's. `get_process_outline` returns the same
format in normal form (every lane named, durations as objects, probabilities filled in), so an
outline round-trips. The full rules are in [`MCP.md`](MCP.md#creating-a-process-from-an-outline).

## When a call fails

- **Every problem at once, with its path, in one pass.** A bad call answers `isError: true` with all
  its problems together — malformed fields and semantic ones alike, in the call's language — each
  with where it is. An outline: `steps[2].branches[0].to: …`, `steps[0].duraton: unknown field
  "duraton".` An edit names its operation: `operations[2].after: …`, `operations[3].nombre: unknown
  field "nombre".`, and a model the edit would break answers with the validator's code:
  `operations[0].bpmn.Process_1: E-SIN-START: …`. Fix all of those entries and call again once;
  nothing was written.
- **`dryRun` before writing** whenever a human should see the change first: `create_process`,
  `edit_process`, `annotate_element` and `import_scenario_sheet` take it, check everything and
  write nothing.
- **Validation is not an error of the tool.** `validate_bpmn` answers `isError: false` with a
  report whose `errors[]` may be full; read them.
- **Language.** Messages follow `lila mcp --lang es` (or `LILA_LANG`), or `locale` per call. Codes
  (`E-…`), ids and JSON keys never change.

## More than one writer

Agents, the CLI and the desktop app can work on the same `.lila`:

- **Atomic writes.** Each write goes to a temporary file that replaces the `.lila` with a rename.
  A reader never sees half a file.
- **A lock.** Writers take turns through `<file>.lila.lock` next to the file. When another writer
  holds it for more than 3 seconds, the call fails with `E-ARCHIVO-OCUPADO` («another program is
  saving … right now; nothing was written. Try again in a moment.»). A lock untouched for 10
  seconds is treated as left by a crash and removed.
- **Changed on disk.** If the file changed between the tool's read and its write, nothing is written
  and the call fails («… changed on disk while this call was working on it; nothing was written.
  Try again.»). Call it again: it reads the new file. A saved run is the exception: it is appended
  to what is there, unless the model or the scenario it ran on changed (then it is already stale
  and is not saved).
- **The app.** It reloads after your writes. If the person has unsaved edits, it asks first:
  Reload or Keep mine. After Keep mine, saving is refused with `E-CAMBIO-EXTERNO` («… changed
  outside Lila since it was opened, so nothing was saved…»), so your work is not overwritten; they
  reload, or use Save As to keep their version in another file.

Do one write at a time per file and wait for its answer; there is no benefit in parallel writes to
the same `.lila`.

## Known limits

- **The Word document has no diagram** and neither document has the run's charts: Word needs a
  PNG and the engine has no rasteriser. The HTML document has the diagram (SVG). `notes` in the
  answer says what was left out. To give someone a picture, send the HTML or `export_diagram`.
- **Layout.** `create_process` and `edit_process` (by default) lay the process out with
  `bpmn-auto-layout` 1.3 plus Lila's lane fix. It is readable, not beautiful: lanes can be taller
  than needed, a gateway's name can sit on a flow leaving from below, crossings are not untangled,
  and a sub-process is created collapsed. `edit_process` with `layout: true` replaces positions
  set by hand in that process; `layout: false` keeps them and places new steps simply. Move things
  in the app when the picture matters.
- **Edits** reach only the main process of a BPMN (the one the simulator reads), and lanes cannot
  be removed.
- **Scenario fields from the outline** are only `duration`, `resources` and branch `probability`.
  Arrivals, calendars, costs and capacities go through `patch_scenario` or a sheet.
- **Simulation is synchronous** in the server: a long run blocks the server until it finishes. Keep
  replications reasonable while iterating.
- **Installation.** `npx -y @lila-modeler/engine mcp` does not work yet: the published engine does
  not include the MCP server, which lives in the unpublished `@lila-modeler/mcp`. Run the server
  from a checkout ([`MCP.md`](MCP.md#installation)).
