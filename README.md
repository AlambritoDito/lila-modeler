# Lila Modeler

Read this in: [Español](README.es.md)

An open source (Apache-2.0) discrete-event simulation (DES) engine for BPMN processes, inspired by
the simulation workflow of tools such as Bizagi Modeler; results are validated against publicly
documented examples. The project is an npm monorepo:

- **Engine + CLI** (`packages/engine`, package `@lila/engine`) — parses `.bpmn`, validates the model
  and simulates a scenario. Its core (`packages/engine/src/core/`) has no dependencies: it runs the
  same in Node, in a browser Web Worker, or behind an MCP server.
- **MCP server** (`packages/mcp`, and the CLI's own `lila mcp` subcommand) — exposes the engine to
  agents via [MCP](https://modelcontextprotocol.io).
- **Web app** (`apps/web`, React + [bpmn-js](https://github.com/bpmn-io/bpmn-js)) — model, simulate,
  view results and compare scenarios from the browser.
- **Desktop beta** (`apps/desktop`, Electron, macOS arm64 only) — the same web app packaged, with
  saving into a project folder.

The contracts — the process IR, the scenario format and the results format — are documented in
`docs/` before the code, and they are the part of the project that stays stable.

## Requirements

- Node.js **22 or later** (`engines.node` in `package.json`).

## Install from the repo

```bash
git clone git@github.com:AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npm run build` compiles `packages/engine` and `packages/mcp` (`tsc --build`); that is what the CLI
and the MCP server need. The web app is built separately (see below).

## Download a 1.0.0-alpha build

`1.0.0-alpha.1` is the first alpha, published so the workflow can be validated end to end; treat
its results and file formats as provisional. The installers attached to a `v1.0.0-alpha*` GitHub
Release are built by CI and are **neither signed nor notarized**, so both desktop systems refuse
the first launch:

- **macOS**: do not double-click. Right-click the app → **Open**, then confirm **Open** in the
  dialog. [`docs/BETA-MAC-GUIDE.md`](docs/BETA-MAC-GUIDE.md) walks through the whole flow.
- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info** → **Run anyway**.

Nothing is published to the npm registry yet; the CLI comes from a repository checkout as above.

**Coming from Bizagi Modeler?** [`docs/COMING-FROM-BIZAGI.md`](docs/COMING-FROM-BIZAGI.md) maps
each Bizagi screen and field to where it lives here, keeps the four levels as the four steps of the
Simulate view, and walks through reproducing Bizagi's published level-3 example.

## Simulate the benchmark in 3 commands

`examples/pedido` is the repo's reference benchmark: a restaurant process with a parallel branch
(prepare/pack), an approval and a timer, with two scenarios already written
(`as-is.scenario.json` and `to-be-3-cajeros.scenario.json`, the latter with one more cashier).

The commands use `npx lila`: after `npm ci`, `npx` resolves the workspace's own binary
(`node_modules/.bin/lila`, see the `package.json` of `@lila/engine`) with no network and no global
install — there is no `lila` package published to the npm registry (see "Known limitations").
Equivalent, without relying on `npx`: `node packages/engine/bin/lila.js <command>`.

The sample outputs below are copied verbatim from the CLI. English is the default; `--lang es`
(or `LILA_LANG=es`, or a Spanish `LANG`) prints the same run in Spanish.

**1. Validate the model:**

```bash
npx lila validate examples/pedido/model.bpmn
```

```
Process Process_Restaurante (Restaurant)
Exported by Lila Modeler examples (hand-written) 0.0.0

Nodes (11): and 2, end 2, start 1, task 4, timer 1, xor 1
  start     StartEvent_Pedido  Order received
  ...
warning  W-MSGFLOW  Process_Restaurante: 2 message flows (bpmn:messageFlow) were ignored.
0 errors, 1 warnings.
```

**2. Simulate the AS-IS scenario** (Bizagi-style result tables + JSON + CSV):

```bash
npx lila run \
  examples/pedido/model.bpmn examples/pedido/as-is.scenario.json \
  --seed 42 --replications 3 \
  --json out/result.json --csv out/csv --xlsx out/as-is.xlsx
```

```
Scenario AS-IS
Process Process_Restaurante (Restaurant)
Seed 42 · Replications 3 · Time unit min · Currency MXN

Process elements
Id                  Name                Type   Instances started  Instances completed  ...
StartEvent_Pedido   Order received     start  2975               2975                 ...
...

Bottlenecks
Id                Name               Total time (waiting for resource) (min)  Utilization (%)
Task_Preparar     Prepare food  4514389.476272                           34.297909
Task_TomarPedido  Take order       698.32272                                41.234838

Warnings:
  W-MSGFLOW: Process_Restaurante: 2 message flows (bpmn:messageFlow) were ignored.
  ...
JSON: /path/to/repo/out/result.json
CSV: /path/to/repo/out/csv
```

**3. Compare AS-IS against TO-BE** (one more cashier) side by side:

```bash
npx lila compare \
  examples/pedido/model.bpmn \
  examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json \
  --seed 42 --replications 3
```

```
Process Process_Restaurante (Restaurant)
Time unit min (base scenario) · Utilization in %

Compared scenarios
#  Name             File                                           Seed  Replications
-  ---------------  ---------------------------------------------  ----  ------------
0  AS-IS (base)     examples/pedido/as-is.scenario.json            42    3
1  TO-BE 3 cashiers  examples/pedido/to-be-3-cajeros.scenario.json  42    3

Process elements
Id                Name              Metric                               AS-IS (base)  TO-BE 3 cashiers
...
Task_TomarPedido  Take order      Average time (waiting for resource)  0.234564      0.0344 (-85.334633%)*
...
```

`--json` and `--xlsx` work the same in `run` and in `compare`; `--csv` only in `run`. `--xlsx`
writes one spreadsheet (Summary, Elements, Flows, Resources, Parameters; a Comparison sheet in
`compare`) — see `docs/RESULTS_FORMAT.md` § 12. `--help` on any subcommand
lists every option, and `--lang en|es` (any position) picks the language of the output.
Without it, `LILA_LANG`, then `LC_ALL`/`LC_MESSAGES`/`LANG`, then English. The scenario format is in `docs/SCENARIO_FORMAT.md`, the results format in
`docs/RESULTS_FORMAT.md`, and the mapping of column names against Bizagi in
`docs/BIZAGI_PARITY.md`.

## Web app

**Try it in your browser**: [Lila Modeler](https://alambritodito.github.io/lila-modeler/).
The public demo opens the restaurant example in English. [Open the editor directly](https://alambritodito.github.io/lila-modeler/app/).
**Save project** downloads a `.lila` project file — the project folder zipped, the same one the
desktop app opens ([project format](docs/PROJECT_FORMAT.md)) — and retains a browser copy to
restore on reload. Projects saved earlier as `.lila.json` still open.
Unsaved edits are not automatically persisted; nothing is uploaded. If browser storage is
unavailable or full, use the downloaded file to reopen your work.

Build the complete preview with `npm run build:pages`. See [Pages setup](docs/PAGES.md) for
local preview and the separately controlled first deployment.

To run it locally instead:

```bash
npm run dev -w @lila/web    # builds the engine if needed + starts Vite on http://localhost:5173
```

It starts with `examples/pedido/model.bpmn` loaded. The top bar has five modes. English is the base language; select Spanish or automatic system
language in Settings:

- **Model** — bpmn-js editor: create, edit and export the `.bpmn`.
- **Simulate** — scenario panel (resource pools, calendars, per-element parameters) and a
  Simulate button with progress and cancel.
- **Results** — the Bizagi-style tables plus Lila's extras (bottlenecks, cost per
  case), with per-table CSV export.
- **Compare** — two or more already-simulated scenarios side by side, with a
  significance marker (95% CI).
- **Validate routes** (validate paths) — token animation from `bpmn-js-token-simulation` over the
  diagram; it is not the engine's DES simulation, it does not read the scenario and it produces no
  results.

Details of each mode, the literal interface strings and current limitations are in
[`docs/BETA-MAC-GUIDE.md`](docs/BETA-MAC-GUIDE.md) (written for the desktop beta, but it describes the
same web app).

## Desktop beta (macOS)

There is a beta of `apps/desktop` (Electron, **macOS arm64 only, neither signed nor notarized**)
that packages the web app as a `.dmg` with saving into a project folder. It is not distributed
inside the repository: you have to build it with `npm run dist:mac -w @lila/desktop`, which leaves
the installer in `apps/desktop/release/` (a folder in `.gitignore`). Because it is unsigned, macOS
blocks the first attempt to open it by double-clicking; you have to open it with right-click → Open.
The app registers itself as a `.bpmn` and `.lila` editor: double-clicking a file (or a cold start
with one) opens it in the editor; if the `.bpmn` is not inside a Lila project folder, only that file
is saved until «Guardar como» (Save as) is used. A `.lila` is the whole project in one file
([project format](docs/PROJECT_FORMAT.md)) and saves back over itself; to open one from the menu,
File → «Open project file (.lila)…», and «Save as…» creates a new one (the project folder of
ADR-018 is still one entry away, File → «Save as folder…»). Pushing a `v*` tag
(`git tag v1.0.0-alpha.1 && git push origin v1.0.0-alpha.1`) triggers the `Desktop` workflow, which builds the three
installers (`.dmg`, `.exe`, `.AppImage`) and leaves them in a GitHub Release **as a draft**, to be
published by hand.

The full guide — requirements, a usage walkthrough, how to rebuild the `.dmg`, known limitations —
is in [`docs/BETA-MAC-GUIDE.md`](docs/BETA-MAC-GUIDE.md).

## MCP in 3 lines

`packages/engine` ships the `lila mcp` subcommand, which starts an MCP server over stdio with five
tools on top of the same engine (`validate_bpmn`, `describe_process`, `run_simulation`,
`compare_scenarios`, `patch_scenario`). To register it in Claude Code:

```bash
claude mcp add lila -- node /ruta/al/repo/packages/engine/bin/lila.js mcp
```

The repo also ships a project-level `.mcp.json`, so opening Claude Code right here makes the server
show up on its own. Details of each tool, how to test it by hand and known limits (no cancellation,
all I/O goes against the disk of the server process) are in [`docs/MCP.md`](docs/MCP.md).

## Known limitations

- **Supported BPMN profile**: start/end (none and terminate), timer, tasks (all variants), call
  activity, embedded subprocess, XOR/OR/AND, lanes and pools. Anything outside it produces an
  explicit validation error, not a silent failure (`docs/SEMANTICS.md` §§1–3).
- **Not published to npm yet**: there is no `npx @lila/engine` and no package installable outside
  the repo; you use it by cloning and building as above.
- **Only the macOS arm64 beta (`dmg`) is tested**. Windows (`nsis`) and Linux (`AppImage`) are
  configured in `apps/desktop/electron-builder.yml`, and the `Desktop` workflow
  (`.github/workflows/desktop.yml`, manual, on PRs that touch `apps/desktop` or on `v*` tags) builds
  all three as CI artifacts, but they have not been tested and are not distributed.

## Repo layout

- `packages/engine` — simulation engine (`src/core/`, no external dependencies) + BPMN parser + CLI
  (`src/cli.ts`, `lila` binary).
- `packages/mcp` — MCP server (`@lila/mcp`, `lila-mcp` binary), a thin layer over `@lila/engine`.
- `apps/web` — editor and viewer in React + bpmn-js.
- `apps/desktop` — Electron packaging of `apps/web`.
- `docs/` — contracts and guides (see below); `examples/` — example models and scenarios.

## Documentation

Public contracts and guides are in English, with linked Spanish versions under `docs/es/`.

- [`docs/SEMANTICS.md`](docs/SEMANTICS.md) — supported BPMN profile and the engine's exact semantics.
- [`docs/SCENARIO_FORMAT.md`](docs/SCENARIO_FORMAT.md) — the JSON scenario format.
- [`docs/RESULTS_FORMAT.md`](docs/RESULTS_FORMAT.md) — the result format and the CSVs.
- [`docs/COMING-FROM-BIZAGI.md`](docs/COMING-FROM-BIZAGI.md) — guide for users arriving from Bizagi
  Modeler: the four levels as four steps and a screen-by-screen map.
- [`docs/BIZAGI_PARITY.md`](docs/BIZAGI_PARITY.md) — reference behaviour checklist against Bizagi
  Modeler's public documentation (validation against public examples), by level.
- [`docs/BPMN_EXTENSION.md`](docs/BPMN_EXTENSION.md) — the `lila:` namespace and the id policy.
- [`docs/MCP.md`](docs/MCP.md) — the MCP server, its five tools and how to register it.
- [`docs/BETA-MAC-GUIDE.md`](docs/BETA-MAC-GUIDE.md) — the desktop beta.
- [`docs/THEMES.md`](docs/THEMES.md) — the web app's theme format.
- `LILA_MODELER_ESTRUCTURA.md` — decisions (ADRs), engine design, milestones.
- `BACKLOG.md` — work breakdown; the tickets live in GitHub Issues (`LILA-nnn` = `#nnn`).

## Languages

English is the project's base language and Spanish is the first translation. The user-facing text of
the app, the CLI and the MCP server uses English as the base and Spanish as a translation
(epic #283). Contributions of new languages will be one file per language.

## License

Apache-2.0. See [`LICENSE`](LICENSE). `examples/bizagi-exports/` is CC BY 3.0 from the BPMN MIWG
(see its README); the rest of the repo is Apache-2.0. Copyright holder: Perfer Process (`NOTICE`).

The web app's editor uses [bpmn-js](https://github.com/bpmn-io/bpmn-js) (MIT + watermark clause):
its license requires the **"Powered by bpmn.io"** mark to stay visible on the canvas, and Lila
Modeler honours it without hiding it. The "Validar rutas" mode uses
[bpmn-js-token-simulation](https://github.com/bpmn-io/bpmn-js-token-simulation) (MIT). The web app
is React (MIT) and the desktop beta packages Electron. The full inventory of runtime dependencies,
with the version and license of each one, is in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

Bizagi and Bizagi Modeler are trademarks of Bizagi. Lila Modeler is an independent open-source
project, not affiliated with or endorsed by Bizagi.

## How to contribute

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full guide (setup, checks, PR process) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for the project's code of conduct.

Before touching the engine, read `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md` and
`docs/RESULTS_FORMAT.md`. Repo rules (header of `BACKLOG.md`):

1. `packages/engine/src/core/` imports nothing from outside `core/` (not `bpmn-moddle`, not
   `node:*`, not React).
2. No ticket/PR closes without its acceptance test green.
3. Result column names follow Bizagi Modeler's public result tables so results can be compared
   with published examples (`docs/BIZAGI_PARITY.md`).
4. All times in seconds, money in `run.currency`.
5. The BPMN `id` is the only key; the name never disambiguates.

Before opening a PR:

```bash
npm run typecheck
npm test
```
