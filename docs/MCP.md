# MCP (LILA-053/054/055/056)

> Read this in: [Español](es/MCP.md)

`packages/mcp` (`@lila-modeler/mcp`) provides a stdio [MCP](https://modelcontextprotocol.io) server
backed by `@lila-modeler/engine`. Its five tools reuse the CLI validation and simulation pipeline — see
[`docs/CLI.md`](CLI.md) for the same pipeline driven from a terminal instead of an MCP client.

## Tools

- **`validate_bpmn({ path | xml, process?, locale? })`** parses and validates BPMN and returns the same JSON
  as `lila validate --json`: IR, `ignoredProcessIds`, `errors` and `warnings`. Supply exactly
  one of `path` and inline `xml`; supplying both is an error.
- **`describe_process({ path | xml, process?, scenario?, locale? })`** returns the IR and a readable
  `resumen`: node counts, gateway outputs, lanes, flattened subprocesses, ignored processes
  and validation status. An optional scenario path resolves `extends` and adds referenced
  resources. An unreadable scenario is reported in the summary without failing the tool.
- **`run_simulation({ model?, process?, scenario, seed?, replications?, saveTo?, locale? })`** validates
  the model and scenario, simulates with `log: false` and returns the same `RunResult` as
  `lila run --json`. It supports resources and calendars. `scenario` may be a JSON file path
  or an inline resolved scenario. `model` defaults to `scenario.model`; a supplied different
  model is rejected. The response includes text, `structuredContent` and an `outputSchema`.
- **`compare_scenarios({ model?, process?, scenarios, seed?, replications?, saveTo?, locale? })`** validates
  all scenarios before running any. Two or more scenarios must use the same model; the first
  is the baseline. Paths and inline objects may be mixed. Returns `{ comparison, notes }`,
  with the same `CompareResult` as `lila compare --json`. Notes cover seeds, units, insufficient
  replications for confidence intervals, and engine warnings.
- **`patch_scenario({ scenario, project?, process?, patch, saveTo?, extendsFrom?, name?, description?, locale? })`**
  applies [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902), validates the result and writes
  only when valid. It returns `{ scenario, file, notes }` (plus `process` and `entry` inside a
  `.lila`).

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
  worked, nothing is written and the tool fails: call it again.

```json
{ "name": "run_simulation", "arguments": { "model": "examples/pedido.lila", "scenario": "to-be-3-cajeros", "seed": 42, "replications": 3 } }
```

```json
{ "name": "patch_scenario", "arguments": { "project": "project.lila", "process": "pedido", "scenario": "as-is",
  "saveTo": "to-be-4", "patch": [{ "op": "replace", "path": "/resources/cajero/capacity", "value": 4 }] } }
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
replaced; an existing directory is rejected. `compare_scenarios` saves only `comparison`,
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
