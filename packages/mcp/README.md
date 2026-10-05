# @lila-modeler/mcp

[MCP](https://modelcontextprotocol.io) server over stdio for
[Lila Modeler](https://github.com/AlambritoDito/lila-modeler), the open-source discrete-event
simulator for BPMN processes. It lets an AI agent create a process from a list of steps, edit and
annotate it, validate it, describe it, simulate it, compare scenarios, patch a scenario and export
diagrams, documents and results — all on [`@lila-modeler/engine`](https://www.npmjs.com/package/@lila-modeler/engine).

## Preliminary release

This is a pre-1.0 public beta. Requires Node.js 22 or later. Its version always matches the
engine it depends on.

## Start the server

```bash
npx -y @lila-modeler/mcp
```

It is meant to be launched by an MCP client, not read in a terminal: stdout carries only MCP
protocol messages, and diagnostics go to stderr. The installed command is `lila-mcp`.

## Register it

Claude Code:

```bash
claude mcp add lila -- npx -y @lila-modeler/mcp
```

Claude Desktop, Cursor and other clients that read an `mcpServers` block:

```json
{
  "mcpServers": {
    "lila": {
      "command": "npx",
      "args": ["-y", "@lila-modeler/mcp"]
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.lila]
command = "npx"
args = ["-y", "@lila-modeler/mcp"]
```

The server reads and writes files on the disk of the machine it runs on. Pass absolute paths to
models, scenarios and `.lila` projects when the client does not start the server in your project
folder.

## Language

Messages are in English by default. Set `LILA_LANG=es` in the server environment for Spanish (the
server also reads `LC_ALL`, `LC_MESSAGES` and `LANG`), or pass `locale: "es"` on a single call.
Tool names, diagnostic codes, BPMN ids and JSON fields never change with the language.

## Tools

Sixteen tools: `validate_bpmn`, `describe_process`, `run_simulation`, `compare_scenarios`,
`patch_scenario`, `create_process`, `get_process_outline`, `edit_process`, `export_diagram`,
`export_document`, `export_results`, `annotate_element`, `get_raci_matrix`,
`import_scenario_sheet`, `export_scenario_template` and `create_project`.

Contracts, examples and known limits:
[docs/MCP.md](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/MCP.md). A walkthrough
for agents (interview, outline, scenario, run, document):
[docs/AGENT_GUIDE.md](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/AGENT_GUIDE.md).

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
