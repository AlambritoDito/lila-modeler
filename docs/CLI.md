# CLI (LILA-045/046/047/053, #450)

> Read this in: [Español](es/CLI.md)

`lila` is the command-line front end of `@lila/engine`: the same validation and simulation
pipeline used by the web app, the desktop app and the MCP server, driven from a terminal. This
page is the reference an agent or a script needs: every command with one real example, its exit
codes, what `--json`/`--csv`/`--xlsx` write, and how to read the result.

Every example below runs from the repository root, against the committed
[`examples/pedido`](../examples/pedido) benchmark. Requires Node.js **22 or later**.

## Install

Not published on npm yet (#48): until then, run from a checkout.

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npx lila` then resolves the workspace's own binary (`packages/engine/bin/lila.js`), with no
registry lookup.

`npx lila` only finds this CLI inside the checkout (after `npm ci`). Anywhere else it would fetch
the unrelated `lila` package from npm, so from another directory call the bin directly (`node
<checkout>/packages/engine/bin/lila.js …`) or use `npx --no lila …`, which refuses to install.
Once published, use `npx @lila/engine@beta …`:

```bash
npx @lila/engine@beta validate model.bpmn
```

## `validate`

Parses a `.bpmn` file, prints its IR (nodes, flows, lanes) and the full validation
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
  document. Its shape is `runResultSchema`, exported from `@lila/engine/result-schema` — validate
  against it before trusting a parsed file.
- `--csv <directory>` writes `elements.csv`, `flows.csv`, `resources.csv`, `process.csv` (RFC
  4180) and `log.csv` (the event log, streamed while the run executes, ISO timestamps from
  `run.start`). It is the only flag that writes the event log; `--json` and `--xlsx` do not
  carry it.
- `--xlsx <file>` writes one workbook with the Summary, Elements, Flows, Resources and Parameters
  sheets. No event log sheet — use `--csv` for that.
- All three create missing directories, write to a temporary path and rename atomically, and
  refuse to overwrite a path that is a directory.

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

## `mcp`

Starts the MCP server (`@lila/mcp`) over stdio, for an MCP client to launch — not something you
run directly in a terminal and read from. Details, tool contracts and client registration are in
[`docs/MCP.md`](MCP.md); the underlying command is:

```text
node packages/engine/bin/lila.js mcp
```

## General options

Apply to every subcommand, in any position on the command line:

- `--lang en|es` — language of the output (messages, not column names or BPMN IDs, which are a
  stable contract). Default: `LILA_LANG`, then `LANG`, English if neither is set.
- `-h`, `--help` — usage for `lila` or `lila <command> --help`.
- `-v`, `--version`, or the `version` subcommand — prints the installed `@lila/engine` version
  and exits `0`.

```bash
npx lila --version
```
Exit code: `0`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command ran; `validate` may still have printed warnings. |
| `1` | Usage error, unknown command, a model/scenario validation error, a scenario whose `model` does not match the file given, or an uncaught error from the command (message on stderr). |

## For agents

A model change is safe to hand back only after this loop, all against `--json` output so a script
can decide without parsing prose:

1. **Validate first.** `lila validate model.bpmn --json`; check the exit code, then `errors`
   (`code`, `id`, `message`). Stop here if it is not `0` — nothing downstream is trustworthy.
2. **Run with a fixed seed and enough replications** for a narrow confidence interval:
   `lila run model.bpmn scenario.json --seed 1 --replications 30 --json results/run.json`.
3. **Read `results/run.json`** with any JSON tool. Its shape matches `docs/RESULTS_FORMAT.md`
   and validates against `runResultSchema` (`@lila/engine/result-schema`); column names are the
   Bizagi-parity contract in `docs/BIZAGI_PARITY.md`, not renamed per language.
4. **To evaluate a change**, write a second scenario that `extends` the first with only the
   changed keys (`docs/SCENARIO_FORMAT.md`), then `lila compare model.bpmn base.json
   changed.json --seed 1 --replications 30 --json results/compare.json`. Read each row's
   `deltaRel` and `significant`; a metric can move without `significant` being true at low
   replication counts.

The text tables on stdout carry the same numbers; they exist for a human at a terminal, not for
parsing.

## `.lila` is not a CLI input

Honestly: a `.lila` file is a **zip** of a Lila project folder (`docs/PROJECT_FORMAT.md`) —
`lila-project.json`, `model.bpmn`, one `<name>.scenario.json` per scenario, `runs/*.result.json`.
The CLI in this release takes `.bpmn` and `.json` paths directly; it does not open a `.lila`.
Until that lands, unzip it first:

```bash
unzip project.lila -d project
node <checkout>/packages/engine/bin/lila.js validate project/model.bpmn
node <checkout>/packages/engine/bin/lila.js run project/model.bpmn project/as-is.scenario.json
```

Tracked in [#466](https://github.com/AlambritoDito/lila-modeler/issues/466) («`.lila` as CLI
input»).
