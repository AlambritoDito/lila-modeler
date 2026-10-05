# @lila-modeler/mcp

[MCP](https://modelcontextprotocol.io) server for [Lila Modeler](https://github.com/AlambritoDito/lila-modeler),
over stdio. It lets an AI agent model, validate, simulate and document BPMN processes with the same
engine as the app and the CLI ([`@lila-modeler/engine`](https://www.npmjs.com/package/@lila-modeler/engine)).

This is a beta. Node.js 22 or later.

## Run

```bash
npx -y @lila-modeler/mcp
```

The command starts the server and waits for an MCP client on stdin/stdout; it is meant to be
launched by the client, not used by hand. stdout carries only protocol messages; diagnostics go to
stderr.

## Client configuration

Claude Code:

```bash
claude mcp add lila -- npx -y @lila-modeler/mcp
```

Claude Desktop (`claude_desktop_config.json`), Cursor and most other clients:

```json
{
  "mcpServers": {
    "lila": {
      "command": "npx",
      "args": ["-y", "@lila-modeler/mcp"],
      "env": { "LILA_LANG": "en" }
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

Use an absolute path to `npx` when the client does not inherit your `PATH`. `LILA_LANG=es` (or
`LC_ALL`, `LC_MESSAGES`, `LANG`) picks Spanish messages; English is the default, and each tool also
accepts `locale: "en" | "es"`.

## Tools

Sixteen tools: `validate_bpmn`, `describe_process`, `run_simulation`, `compare_scenarios`,
`patch_scenario`, `create_process`, `get_process_outline`, `edit_process`, `export_diagram`,
`export_document`, `export_results`, `annotate_element`, `get_raci_matrix`,
`import_scenario_sheet`, `export_scenario_template`, `create_project`.

All file paths are read and written on the disk of the machine that runs the server; relative
paths resolve against the server's working directory, so prefer absolute paths. Simulation is
synchronous and there is no cancellation.

Tool contracts, examples and limits:
[docs/MCP.md](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/MCP.md). The
[agent guide](https://github.com/AlambritoDito/lila-modeler/blob/main/docs/AGENT_GUIDE.md) walks an
agent through the whole flow: interview, outline, scenario, run and document.

## License

Apache-2.0. "Lila Modeler" and its logos are not covered by the license grant; see
[NOTICE](https://github.com/AlambritoDito/lila-modeler/blob/main/NOTICE).
