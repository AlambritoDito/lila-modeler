<p align="center"><img src="docs/design/branding/web/logo-horizontal.png" width="420" alt="Lila Modeler"></p>

<p align="center">Open-source discrete-event simulation for BPMN processes — in the browser, on the desktop, from the CLI or through MCP.</p>

<p align="center">
  <a href="https://alambritodito.github.io/lila-modeler/app/"><img src="https://img.shields.io/badge/Try_it-web_app-6f42c1" alt="Try it"></a>
  <a href="https://github.com/AlambritoDito/lila-modeler/releases/tag/v1.0.0-beta.1"><img src="https://img.shields.io/badge/Download-Beta_1_(macOS)-0969da" alt="Download Beta 1"></a>
  <a href="docs/"><img src="https://img.shields.io/badge/Docs-docs%2F-6e7781" alt="Docs"></a>
  <a href="docs/COMING-FROM-BIZAGI.md"><img src="https://img.shields.io/badge/Coming_from-Bizagi_Modeler-bf8700" alt="Coming from Bizagi"></a>
  <a href="https://github.com/AlambritoDito/lila-modeler/actions/workflows/ci.yml"><img src="https://github.com/AlambritoDito/lila-modeler/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-1a7f37" alt="License: Apache-2.0"></a>
</p>

Read this in: [Español](README.es.md)

## What is Lila Modeler

Lila Modeler is a discrete-event simulation (DES) engine for BPMN processes. You draw the process,
describe a scenario (arrivals, processing times, resources, calendars, costs), run it with
replications, read Bizagi-style result tables and compare scenarios side by side. It is inspired by
the simulation workflow of Bizagi Modeler and validated against its publicly documented examples;
it is not a drop-in replacement (see [How it compares](#how-it-compares-to-bizagi-modeler)).

The engine core has no dependencies and runs the same in Node, in a browser Web Worker and behind
an MCP server. The contracts — the process IR, the scenario format and the results format — are
documented in [`docs/`](docs/) before the code, and they are the part of the project that stays
stable.

![Model mode: bpmn-js editor with grouped palette, minimap and validation markers](docs/design/en/model.png)

## Features

- **Six modes in one window** — Model, Simulate, Results, Compare, Animate and Validate paths.
- **Simulate in four steps** — process validation, time analysis, resource analysis, calendar
  analysis: Bizagi's four levels, in the same order and with the same vocabulary.
- **Distributions** — the 13 from BPSim 2.0 (including the empirical one) plus constant.
- **Replications with a 95% confidence interval**, always; seeded runs are deterministic byte for
  byte.
- **Resources and calendars** — pools with capacity, fixed and hourly costs; weekly calendars with
  per-shift capacity; "Assign lane" fills the resources of every task of a lane in one action.
- **Routing on the case's previous outcome** — `conditions: [{ flowTaken, probability }]` on the
  flows of an exclusive gateway.
- **Interrupting boundary timers** on tasks (first slice).
- **Results** — Bizagi's column names plus Lila's extras: p50/p90/p95, queue lengths, throughput,
  cost per case, bottleneck ranking, off-hours wait separated from resource wait. Export to CSV
  and XLSX.
- **Compare** — two or more scenarios with per-metric deltas and a significance marker (95% CI
  without overlap).
- **Animate** — replays the run's event log over the diagram with per-element counters and dots
  on the flows; no re-run.
- **Validate paths** — the didactic token animation of `bpmn-js-token-simulation`; it reads no
  scenario and produces no results.
- **`.lila` project file** — the project folder zipped. Save/open from the web app (download),
  double-click on the desktop.
- **Themes** — `eva-01` (dark, default), `papel` (light), `tieso` (light, ITESO blues), `akira` (dark, Neo-Tokyo) and `montana` (purple, bubblegum pink and gold, inspired by Hannah Montana Linux), plain JSON files.
- **English and Spanish** in the app, the CLI and the MCP server.
- **Desktop welcome screen** with recent projects (Electron only).
- **MCP server** with five tools, so an agent can validate, describe, run, compare and patch.

## Quick start

### Web

Open [alambritodito.github.io/lila-modeler/app/](https://alambritodito.github.io/lila-modeler/app/).
It starts with the restaurant example (`examples/pedido`) loaded. **File ▸ Save** (tooltip: Save
project) downloads a `.lila` file and keeps a browser copy to restore on reload; nothing is
uploaded anywhere.

### Share a project with a colleague

Sharing means passing around a portable `.lila` file, not simultaneous editing — there is no
account, backend or real-time sync. Use **File ▸ Save** (web, tooltip: Save project) or **Save
as…** (desktop) to get a `.lila`, send it however you'd send any file, and your colleague opens it
with **File ▸ Open** (tooltip: Open project) in the web demo, **File ▸ Open project…** in the desktop app, or by
double-clicking it in Finder (verified for Beta 1: `verified for Beta 1 on macOS 27.0 (arm64) through the LaunchServices open-file route (`open -a`, the same event Finder sends on double-click) with the app closed and already running, including a `.lila` name with accents and an em dash; a physical double-click in Finder was not exercised on the test Mac because an older installed build owned the association there`). Found a reproducible
problem along the way?
[Open an issue](https://github.com/AlambritoDito/lila-modeler/issues/new/choose) — the bug template
asks for a minimal `.bpmn` file or scenario that shows it.

### Desktop beta

Beta 1 attaches a single installer to the release: `Lila-Modeler-1.0.0-beta.1-mac-arm64.dmg` for
macOS on Apple Silicon, plus a `SHA256SUMS` file to check it —
[Beta 1 on GitHub Releases](https://github.com/AlambritoDito/lila-modeler/releases/tag/v1.0.0-beta.1)
(not `/releases/latest` — GitHub excludes prereleases from that link). It is **neither signed nor
notarized**, so the first launch is blocked. After the first blocked attempt (double-clicking the
app), go to **System Settings ▸ Privacy & Security** and click **Open Anyway** next to the message
naming the app, then confirm **Open**. On older macOS, Control-click the app ▸ **Open** ▸ **Open**
works directly. Do not disable Gatekeeper to work around this. `verified for Beta 1 on macOS 27.0: the quarantined download is blocked on first launch and System Settings ▸ Privacy & Security offers **Open Anyway** (the app is ad-hoc sealed, so macOS does not report it as damaged)`
[`docs/BETA-MAC-GUIDE.md`](docs/BETA-MAC-GUIDE.md) walks through the whole flow, including
checksum verification.

CI also builds Windows (`.exe`) and Linux (`.AppImage`) installers, but they are untested CI
artifacts, not offered as part of the Beta 1 release. The desktop app registers itself as the
editor for `.bpmn` and `.lila` files.

### CLI

Requires Node.js **22 or later**. Nothing is published to npm yet: the CLI comes from a checkout.

```bash
git clone https://github.com/AlambritoDito/lila-modeler.git
cd lila-modeler
npm ci
npm run build
```

`npx lila` resolves the workspace's own binary (`packages/engine/bin/lila.js`), with no registry
lookup. Three commands on the reference benchmark:

1. Validate the model:

```bash
npx lila validate examples/pedido/model.bpmn
```

2. Simulate the AS-IS scenario: tables on stdout + JSON + CSV + XLSX:

```bash
npx lila run \
  examples/pedido/model.bpmn examples/pedido/as-is.scenario.json \
  --seed 42 --replications 3 \
  --json out/result.json --csv out/csv --xlsx out/as-is.xlsx
```

3. Compare AS-IS against TO-BE (one more cashier) side by side:

```bash
npx lila compare \
  examples/pedido/model.bpmn \
  examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json \
  --seed 42 --replications 3
```

```
Compared scenarios
#  Name              File                                           Seed  Replications
-  ----------------  ---------------------------------------------  ----  ------------
0  AS-IS (base)      examples/pedido/as-is.scenario.json            42    3
1  TO-BE 3 cashiers  examples/pedido/to-be-3-cajeros.scenario.json  42    3

Process elements
Id                Name        Metric                               AS-IS (base)  TO-BE 3 cashiers
...
Task_TomarPedido  Take order  Average time (waiting for resource)  0.234564      0.0344 (-85.334633%)*
```

`--json` and `--xlsx` work in `run` and `compare`; `--csv` only in `run`; `--all` shows every
metric in `compare`. `--lang en|es` (any position) picks the output language; `--help` on any
subcommand lists the options. Formats: [`docs/SCENARIO_FORMAT.md`](docs/SCENARIO_FORMAT.md),
[`docs/RESULTS_FORMAT.md`](docs/RESULTS_FORMAT.md).

### MCP

`lila mcp` starts an MCP server over stdio with five tools on the same engine: `validate_bpmn`,
`describe_process`, `run_simulation`, `compare_scenarios`, `patch_scenario`.

```bash
claude mcp add lila -- node /path/to/lila-modeler/packages/engine/bin/lila.js mcp
```

The repo ships a project-level `.mcp.json`, so opening Claude Code at the repo root registers the
server on its own. Tool contracts and known limits (no cancellation; all I/O against the server's
disk) are in [`docs/MCP.md`](docs/MCP.md).

## How it compares to Bizagi Modeler

Lila reproduces Bizagi's simulation workflow and checks its numbers against the four examples
Bizagi publishes (levels 1–4) with a ±5% tolerance
([test](packages/engine/test/bizagi-parity.test.ts)). That is an internal validation criterion,
not a claim of parity: the full checklist, with every documented difference and its cause, is in
[`docs/BIZAGI_PARITY.md`](docs/BIZAGI_PARITY.md); the screen-by-screen map for users is
[`docs/COMING-FROM-BIZAGI.md`](docs/COMING-FROM-BIZAGI.md).

| Capability | Bizagi Modeler | Lila Modeler |
|---|---|---|
| Four levels: validation, time, resources, calendars | ✓ | ✓ as the four steps of Simulate; no resources ⇒ infinite capacity, no calendar ⇒ 24×7 |
| Distributions | undocumented subset | the 13 from BPSim 2.0 (incl. empirical) + constant |
| Replications and determinism | replications only in what-if; partial seeding | always, with 95% CI; byte-for-byte deterministic |
| What-if comparison | ✓ | ✓ Compare mode and `lila compare`, with deltas and significance marker |
| Results export | Excel | CSV and XLSX |
| Percentiles, queue lengths, throughput, cost per case, bottleneck ranking, off-hours wait | ✗ | ✓ |
| Live-counter animation | ✓ | ✓ Animate replays the event log |
| Platforms | Windows only | web app, macOS, Windows, Linux |
| Importing a Bizagi `.bpmn` | — | diagram only: Bizagi does not export its simulation parameters |
| Document publishing (Word/PDF/web) | ✓ | ✗ not a documentation suite |
| Event-based gateway (timer and message branches) | ✓ | ✓ the first branch to elapse takes the token |
| Standalone message/signal/link events | partial | ✗ explicit validation error |
| Multi-instance, complex gateway, choreography | ✗ | ✗ out of scope |

### Known limitations

- **Supported BPMN profile**: start/end (none and terminate), intermediate timer, boundary timer
  (interrupting and not), event-based gateway with timer or message branches, tasks (all
  variants), call activity, embedded subprocess, XOR/OR/AND gateways, lanes and pools. Anything else is an explicit validation error, never a silent failure
  ([`docs/SEMANTICS.md`](docs/SEMANTICS.md) §§ 2–3).
- **Not on npm yet**: no `npm install @lila/engine`; clone and build as above.
- **Calendars are weekly**; monthly/annual recurrence and holidays are reserved fields.

## Project layout

- `packages/engine` — `@lila/engine`: the engine core (`src/core/`, no dependencies), the BPMN
  parser, schemas, CSV/XLSX writers and the `lila` CLI.
- `packages/mcp` — `@lila/mcp` (private): the MCP server, a thin layer over the engine.
- `apps/web` — React 19 + Vite + bpmn-js editor and viewer.
- `apps/desktop` — Electron packaging of `apps/web`; `.github/workflows/desktop.yml` builds the
  three installers on `v*` tags and leaves a draft Release.
- `examples/` — `pedido` (reference benchmark), `bizagi-levels` (Bizagi's published examples),
  `mm1`, `bizagi-exports` (real Bizagi exports from the BPMN MIWG).
- `docs/` — contracts and guides; `tools/` — build and check scripts; `site/` — the Pages landing.

## Documentation

English is the base language; Spanish versions live under `docs/es/`.

- [`SEMANTICS.md`](docs/SEMANTICS.md) — supported BPMN profile and the engine's exact semantics.
- [`SCENARIO_FORMAT.md`](docs/SCENARIO_FORMAT.md) — the JSON scenario.
- [`RESULTS_FORMAT.md`](docs/RESULTS_FORMAT.md) — results, CSV and XLSX.
- [`PROJECT_FORMAT.md`](docs/PROJECT_FORMAT.md) — the project folder and the `.lila` file.
- [`BPMN_EXTENSION.md`](docs/BPMN_EXTENSION.md) — the `lila:` namespace and the id policy.
- [`MCP.md`](docs/MCP.md) — the MCP server and its five tools.
- [`THEMES.md`](docs/THEMES.md) — the theme format.
- [`DECISIONS.md`](docs/DECISIONS.md) — architecture decision records (ADR-001 … ADR-028).
- [`BIZAGI_PARITY.md`](docs/BIZAGI_PARITY.md) — reference behaviour checklist and documented
  differences.
- [`COMING-FROM-BIZAGI.md`](docs/COMING-FROM-BIZAGI.md) — screen-by-screen guide for Bizagi users.
- [`BETA-MAC-GUIDE.md`](docs/BETA-MAC-GUIDE.md) — the desktop beta.
- [`EXAMPLES_POLICY.md`](docs/EXAMPLES_POLICY.md), [`ORACLES.md`](docs/ORACLES.md),
  [`PAGES.md`](docs/PAGES.md) — examples policy, test oracles, Pages deployment.
- `LILA_MODELER_ESTRUCTURA.md` — project structure and milestones; `BACKLOG.md` — work breakdown
  (tickets live in GitHub Issues).

## Roadmap

Open epics, in [GitHub Issues](https://github.com/AlambritoDito/lila-modeler/issues?q=is%3Aopen+label%3Aepic):

- **#335** — semantics still pending for numeric parity with Bizagi: message, boundary and
  event-based events, saturation, utilization denominator.
- **#336** — trust and adoption: getting-started guide, signing and notarization (#109), publishing
  `@lila/engine` on npm (#48), usability validation.
- **#125** — self-hosted server. **#130** — process mining (parameters from event logs).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) (setup, checks, PR process) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Before touching the engine, read `docs/SEMANTICS.md`,
`docs/SCENARIO_FORMAT.md` and `docs/RESULTS_FORMAT.md`. Repo rules (header of `BACKLOG.md`):

1. `packages/engine/src/core/` imports nothing from outside `core/`.
2. No ticket/PR closes without its acceptance test green.
3. Result column names follow Bizagi Modeler's public result tables.
4. All times in seconds, money in `run.currency`.
5. The BPMN `id` is the only key; the name never disambiguates.

Before opening a PR: `npm run typecheck && npm test && npm run check:links`.

## License and NOTICE

Apache-2.0, see [`LICENSE`](LICENSE). Copyright 2026 Perfer Process; the Lila name and logos are
subject to [`NOTICE`](NOTICE). `examples/bizagi-exports/` is CC BY 3.0 from the BPMN MIWG (see
[its README](examples/bizagi-exports/README.md)). Runtime dependencies and their licenses are
listed in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md); the editor is
[bpmn-js](https://github.com/bpmn-io/bpmn-js), whose license requires the "Powered by bpmn.io"
mark to stay visible on the canvas.

Bizagi and Bizagi Modeler are trademarks of Bizagi. Lila Modeler is an independent open-source
project, not affiliated with or endorsed by Bizagi.
