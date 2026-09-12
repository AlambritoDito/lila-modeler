# Architecture Decision Log

> Read this in: [Español](es/DECISIONS.md)

Lila Modeler's architecture decision log. These are reversible while the project is in its early stage — each one states, where it applies, when to revisit it.

Sources:

- **ADR-001 through ADR-008**: the project's earlier corpus (then called *Open Process Platform*), `docs/DECISIONS-corpus-previo.md`. Copied here verbatim.
- **ADR-009 through ADR-023**: `LILA_MODELER_ESTRUCTURA.md`, section 4 ("Decisiones (ADR)"). Copied here verbatim; that document is the source of truth — for any discrepancy between this file and `LILA_MODELER_ESTRUCTURA.md`, the structure document wins and this file is corrected to match.
- **ADR-024 onward**: decisions that came up during implementation, with their test ticket.

Several ADRs from the earlier corpus end up closed or reinterpreted by later decisions; each one says so in a note at the end of its entry, naming the ADR that closes or reinterprets it.

---

## ADR-001 — BPMN as interchange standard

**Status:** Accepted

We will use standard `.bpmn` files for import and export.

BPMN XML will not necessarily be our only internal data store.

### Reason

- Interoperability.
- Avoid lock-in.
- Compatibility with existing tools.
- Let the file outlive the product.

---

## ADR-002 — Web-first platform

**Status:** Accepted

The main application will be web-based.

It must be able to run:

- Local.
- Self-hosted.
- Server.
- Cloud.

A desktop wrapper will be optional.

> **Note:** ADR-023 makes this concrete: the `apps/web` SPA is the only UI, packaged as a desktop app (Electron, `apps/desktop`) and served unchanged by the self-hosted server (`packages/server`, M6). This ADR's "optional desktop wrapper" is exactly what ADR-023 designs.

---

## ADR-003 — API-first and agent-first

**Status:** Accepted

Domain operations must be exposed through reusable services.

The UI and MCP will use those services.

> **Note:** ADR-019 makes this concrete: the API is the exported functions of `@lila/engine` (`parseBpmn`, `validate`, `resolveScenario`, `simulate`, `compare`) and the CLI; MCP arrives in M4 on top of the same functions, ahead of REST.

---

## ADR-004 — Simulation before full BPM suite

**Status:** Accepted

The first working product will be the simulation engine.

RACI, repository, interviews, and process mining come later.

> **Note:** Confirmed by the milestone order in `LILA_MODELER_ESTRUCTURA.md` section 7: M0-M3 are the engine and the CLI, matching Bizagi Modeler's published reference results; RACI (`packages/catalog`), `packages/interview`, and `mining/` are future modules explicitly deferred (section 5, "Future modules").

---

## ADR-005 — Evaluate before fork

**Status:** Accepted

Do not rewrite or fork by reflex.

Process:

```text
Discover
↓
Evaluate
↓
PoC
↓
Decide:
Use / Wrap / Fork / Replace
```

> **Note:** Closed by ADR-010: *Replace* result for existing DES engines (Prosimos, Scylla, BIMP/QBP, Apromore, bpmn-engine, Camunda 8, SpiffWorkflow — build our own engine) and *Use* for bpmn-js/bpmn-moddle (ADR-011). Prosimos and Scylla are kept as numeric oracles under development, not as the core.

---

## ADR-006 — Own the abstraction layer

**Status:** Accepted (reinterpreted, see note)

Even if we use an external engine, the platform will talk to its own interface.

This allows replacing components in the future.

> **Note — reinterpretation (`LILA_MODELER_ESTRUCTURA.md` section 4):** "Own the abstraction layer" does not mean a `SimulationScheduler` interface with adapters to SimPy/Rust (a speculative abstraction no proposal actually argued for): it means owning the **three JSON contracts** (IR, scenario, result + event log) and the `simulate()` signature. That is what lets the kernel be replaced without touching the CLI, UI, or MCP.

---

## ADR-007 — Scenario separated from diagram

**Status:** Accepted

Simulation parameters must be able to exist as scenarios independent of the BPMN.

This allows multiple scenarios over the same process.

> **Note:** Made concrete by ADR-013 (where each piece of data lives) and ADR-015 (scenario format v1): simulation parameters live in `*.scenario.json`, outside the `.bpmn`; the `.bpmn` carries only the diagram, standard documentation, and the `lila:` extension (see `docs/BPMN_EXTENSION.md`).

---

## ADR-008 — No final product name yet

**Status:** Closed (see note)

Use `Open Process Platform` as a working title until we define:

- Positioning.
- Brand.
- Domain.
- License.
- Target audience.

> **Note:** Closed by ADR-020 ("Closes ADR-008: the project is called Lila Modeler."), decided by Brito on 2026-09-03. The license was also settled in ADR-020 (Apache-2.0).

---

## ADR-009 — Engine language and kernel: TypeScript, our own event loop, zero dependencies in `core/`

**Status:** Accepted

Why: a single runtime covers the browser (Worker), CLI, tests, and MCP; a benchmark measured today (100k cases: JS 143 ms, SimPy 1,273 ms, SimPy/Pyodide 2,798 ms plus ~12 MB of runtime); no DES library in TS has real adoption (0-35 stars, one author each); Rust crates carry no resources/queues, and the wasm toolchain was just reorganized. Rules out: Python/SimPy (a second runtime, no BPMN parser with a maintained permissive license: SpiffWorkflow is LGPL), Rust/WASM (no demonstrated need), any DES library. Revisit: only if a spike shows TS cannot meet a real performance target; then `core/` gets reimplemented behind the same `simulate()`.

---

## ADR-010 — Existing engine: none. We write our own. Prosimos and Scylla only as numeric oracles under development

**Status:** Accepted

Why: Prosimos has no `LICENSE` file on any branch (all rights reserved), embeds proprietary QBP jars, requires Python < 3.12, and its `main` has been stalled since 2025-01-30; Scylla is MIT but Java + Swing + DESMO-J from 2017; BIMP/QBP is closed source; Apromore was archived on 2025-08-29; bpmn-engine, Camunda 8, and SpiffWorkflow are execution engines with the wrong semantics and licenses. Closes ADR-005 (evaluate before fork) with a *Replace* result for engines and *Use* for bpmn-js/bpmn-moddle. Revisit: if Prosimos publishes a permissive license, re-evaluate it as a CI oracle (not as the core).

---

## ADR-011 — Editor: bpmn-js as-is, with the bpmn.io watermark visible; our own properties panel in React

**Status:** Accepted

Why: bpmn-js 18.27.1 (published 2026-09-03, 27 releases in 2026) is the only actively maintained library in this space, with official types and examples for moddle extensions, properties providers, and renderers; "new task → editable name instead of `Task 1`" comes out of the box. The license is MIT plus one clause: the watermark cannot be removed, hidden, or covered, **not even in a fork** (Camunda Desktop Modeler, Fluxnova, and Miragon keep it); replacing it with diagram-js is ~28,000 lines. The official properties-panel packages ship no types and drag in Camunda dependencies. Rules out: forking, KIE bpmn-editor (a single release, React ≤ 18, jBPM semantics; revisit in 12 months), LogicFlow, Camunda Web Modeler (proprietary). Design consequence: reserve the canvas's bottom-right corner.

---

## ADR-012 — Element and process identity

**Status:** Accepted

Element = BPMN `id` attribute, NCName, generated with a type prefix and random suffix (`Task_7f3k2q1`), never regenerated on import/export/rename, new on copy; foreign non-NCName ids (Bizagi can emit them) are sanitized with a reversible map. Process = `bpmn:process@id` as the logical key (ASCII slug) + `lila:versionTag`; `exporter="Lila Modeler"` and `exporterVersion` in `definitions`. Why: it is the only key every tool shares (Signavio `sid-uuid`, bpmn-js `Activity_x`, jBPM `_uuid`) and the one BPSim, qbp, Prosimos, and Scylla hang off of; using names as the key is the decision that forces rewrites. Pattern from Flowable (definition key + version) / Bonita / Camunda (process id + versionTag).

> Full operational implementation in `docs/BPMN_EXTENSION.md`.

---

## ADR-013 — Where each piece of data lives

**Status:** Accepted

Diagram and per-element documentation **inside** the `.bpmn` (standard `bpmn:documentation` + `lila:` in `extensionElements`); simulation parameters **outside**, in `*.scenario.json`; catalog (roles, systems, documents, risks, controls, KPIs) in `catalog.json` with stable ids; results in JSON + CSV. Elements **reference** the catalog (`lila:roleRef`), never contain free text: that is what ADONIS, Signavio (dictionary), and ARIS (definition/occurrence) do, and it is the other decision that would force a rewrite if made wrong. Confirms ADR-001 and ADR-007.

---

## ADR-014 — A single extension namespace, defined once

**Status:** Accepted

`xmlns:lila="https://lila-modeler.org/schema/bpmn/1"` (the IRI does not need to resolve; it must be stable and decided before M4). moddle JSON descriptor in `packages/engine/src/bpmn/lila.moddle.json`, shared by the editor, CLI, and server. Elements (not attributes) to allow lists. Grows additively. bpmn-moddle preserves unknown namespaces on round-trip (verified today with real BPSim, qbp, and Bizagi files); preservation by Camunda/Signavio/ADONIS is tested in M4, and the fallback plan is an `annotations.json` sidecar keyed by id with the same descriptor.

> Full operational implementation in `docs/BPMN_EXTENSION.md`.

---

## ADR-015 — Scenario format v1: our own JSON, separate from the .bpmn, keyed by id, BPSim 2.0 vocabulary, named parameters, seconds, `extends`

**Status:** Accepted

Why: it satisfies all four criteria at once (N scenarios per diagram; git diffs without DI-coordinate noise; patchable by agents like `elements["Task_1"].processingTime.mean = 400`; migrates 1:1 to `jsonb`). BPSim has been frozen since 2016 with no open source tooling and, embedded, mixes layout with parameters; qbp allows only one scenario and one resource per task; Prosimos uses positional scipy parameters and has no license; Bizagi does not export parameters. Rules out: BPSim or qbp as the canonical format. Edge adapters when a consumer shows up: qbp import (~150 lines, 182 files on GitHub, Prosimos/Simod fixtures), BPSim 2.0 export/import as a `.bpsim` file when there is a Sparx EA user, Prosimos export for oracles only.

---

## ADR-016 — Calendar semantics (Bizagi does not document its own)

**Status:** Accepted

A weekly pattern relative to `run.start`; no DST or holidays in v1 (reserved fields). A task only starts within its resource's calendar, and its `processingTime` consumes only calendar time (it pauses when the shift closes and resumes when it opens). Closed time is reported as `offHoursWait`, separate from `resourceWait`. Utilization = busy time / `Σᵢ (capacityᵢ × openTimeᵢ)`, summing the pool's capacity segments over the measurement window `[warmup, t_stop]` — **not** the scenario's declared duration, which is what Bizagi uses at its level 4 (exact conversion in `docs/BIZAGI_PARITY.md` § D7). It is the only definition that makes levels 3 and 4 comparable. Documented in `docs/SEMANTICS.md`; adjustable if someone provides L-Sim/Bizagi's actual behaviour.

**LILA-164 (R-CAL-11):** a single pool can have different capacity per calendar — `capacity: [{ calendar, capacity }]`, Bizagi's «Resources → Calendars → quantity» — instead of splitting into one pool per shift. The pool is open by the **union** of its calendars (three shifts covering 24 h are a 24×7, with no `offHoursWait`), its capacity at `t` is the **sum** of the open segments (two overlapping calendars add up), closing a segment does **not** interrupt what is already in progress, and while the whole pool is closed the capacity of the next open instant applies, which is what preserves R-CAL-6 and keeps the numeric shape bit-for-bit identical to M3 (R-DEG-2). Without this, Bizagi's level 4 cannot be reproduced.

> Full operational formulas and definitions in `docs/RESULTS_FORMAT.md`.

---

## ADR-017 — Determinism

**Status:** Accepted

A heap ordered by `(t, seq)` with a monotonic `seq`; our own seeded PRNG (mulberry32/xoshiro) with one stream per element derived from `hash(seed, replication, elementId)`: five lines that give *common random numbers*, meaning adding a cashier does not change the numbers for untouched tasks, and what-ifs read clean. Never `Math.random` or `Date`. Guarantee: byte-identical within the same runtime (tested on Node 22 and 24); across browsers, only statistically identical (`Math.log`/`exp` can differ in the last bit).

---

## ADR-018 — Persistence for the installable mode: the user's own files; no server at all

**Status:** Accepted

A project is a folder (`model.bpmn` + `*.scenario.json`). In the desktop app: open and save with the system's native dialogs (`dialog.showOpenDialog` / `showSaveDialog` and `fs` in Electron's main process, exposed to the renderer via `preload` + IPC with a minimal API: `openFile`, `saveFile`, `readProject`, `recentFiles`); recents and window state in `app.getPath('userData')`. No SQLite, no IndexedDB, no accounts, no server. The online demo (GitHub Pages) uses `<input type=file>` and downloads: it is there to try without installing, not a mode of its own. Why: a student or analyst works with files; git gives AS-IS/TO-BE versioning and diff for free to whoever uses it; the bytes are the same ones the server mode will save. Revisit: never on its own; the server mode (ADR-023) is the answer to shared work, not an evolution of this one.

---

## ADR-019 — MCP before REST; both over the same functions

**Status:** Accepted

The MVP's API is the exported functions of `@lila/engine` (`parseBpmn`, `validate`, `resolveScenario`, `simulate`, `compare`) and the CLI. `packages/mcp` (stdio, `@modelcontextprotocol/server` 2.0.0, spec 2026-07-28) arrives in M4, right after the CLI matches Bizagi Modeler's reference results and before the UI, with 5 tools: it costs ~100 lines, does not depend on the UI, and Brito works with agents; from there an agent can validate, simulate, patch scenarios, and compare on its own machine. REST (hono/fastify, one screen) arrives with the server and the repository. No logic lives at the edge. This satisfies ADR-003 (the UI and agents do the same thing) without building a server that serves no one today.

---

## ADR-020 — Licenses

**Status:** Accepted

Core, CLI, MCP, and web under **Apache-2.0** (decided by Brito on 2026-09-03: an explicit patent clause and enterprise adoption; compatible with bpmn.io's license, bpmn-moddle's MIT, and Simod's Apache-2.0). AGPL/LGPL/Camunda License are forbidden in `packages/*` (pm4py has been AGPL-3.0 since 2.7.12; SpiffWorkflow is LGPL; Camunda 8 has its own license). Prosimos and the QBP jar never enter the repository or public CI. The bpmn.io watermark is accepted and disclosed in the README. Closes ADR-008: the project is called Lila Modeler.

---

## ADR-021 — BPMN scope and the "not supported" policy

**Status:** Accepted

Supported in v1: the list in section 3 of `LILA_MODELER_ESTRUCTURA.md` (see `docs/BIZAGI_PARITY.md`). Everything else produces an **explicit validation error** with the same text Bizagi Modeler uses ("not supported by the simulator"), never a silent failure. Each extra element gets added when a real user asks for it.

---

## ADR-022 — Repository structure: one package that gets published, one app, and nothing speculative

**Status:** Accepted

`packages/engine` (with `core/` as a pure subfolder), `apps/web`, `packages/mcp` in M4. npm workspaces (comes with Node; no pnpm/turbo/nx). No `shared`, `types`, or `utils` packages. Why: one package per thing that gets published; `core/`'s isolation is guaranteed by a test that checks the Worker bundle includes no `bpmn-moddle`, React, or `node:*`, not by a separate package. It splits into more packages once publishing separately actually matters.

---

## ADR-023 — Two deployment modes, one SPA, one engine

**Status:** Accepted

(1) **Desktop app**: the `apps/web` SPA packaged with **Electron** in `apps/desktop` (main process + `preload`), built with electron-builder for macOS (dmg), Windows (nsis), and Linux (AppImage and deb) from a CI matrix; `fileAssociations` to open `.bpmn` on double click; optional auto-update once releases are frequent. The engine runs in the renderer's Web Worker; persistence is ADR-018. Direct precedent: Camunda Desktop Modeler (MIT) is Electron + bpmn-js + electron-builder with a `.bpmn` file association; its `electron-builder.json` is the template.

(2) **Self-hosted server**: `packages/server` (M6) in Node serves **the same compiled SPA**, exposes REST and MCP over HTTP on top of `@lila/engine`'s functions, authenticates users, stores processes/versions/scenarios/runs in SQLite or PostgreSQL, and ships as a Docker image with `docker-compose.yml`. Interactive simulation keeps running in each user's browser Worker; the server only simulates when agents, the remote CLI, or scheduled runs ask for it.

**The seam between the two** is a `ProjectStore` interface in the SPA (list/read/write processes, scenarios, and runs) with `DesktopStore` (IPC → `fs`), `RemoteStore` (REST, M6), and a minimal `BrowserStore` (input/download) for the online demo. Defined in M5; the remote one arrives in M6 without touching views or the engine.

**Why Electron and not Tauri**: Tauri 2 produces ~10 MB installers versus ~150 MB and uses less memory, but it depends on the system's webview, and on Linux (WebKitGTK) there are documented performance and stability problems (reports of 40 fps versus 240 fps in Chromium for the same app; a "WebKit is totally unstable" thread in Tauri's discussions); bpmn-js is an SVG-heavy canvas where Chromium's consistency across all three OSes is worth more than installer size; and Tauri requires a Rust toolchain. Electron 43, electron-builder 26, and electron-forge (ESM, Node ≥ 22.12) are all active in 2026. Rules out: a PWA as the primary mode (no native dialogs in Safari/Firefox, no file association). Reversible: if installer size becomes a real problem, Tauri wraps the same SPA and only `DesktopStore` changes.

**Why TypeScript comes out stronger**: the same bundle runs in the desktop app's Worker and in the server's Node; a Python engine would have required bundling a Python runtime inside the installer or loading Pyodide (~12 MB).

---

## ADR-024 — Top-level aggregate across multiple replications

**Status:** Accepted

`simulate()` publishes, in the top-level numeric fields, the arithmetic mean of that same field
already aggregated within each replication. `replications.kpis` keeps, for those same paths, the
mean, sample deviation, and 95% CI. This leaves a result directly consumable by the CLI/UI without
forcing a walk through the KPI map, while keeping one statistical observation per replication.

Using the first replication is ruled out: it would be deterministic but not representative, and
could contradict the `mean` published right next to it. Pooling all cases from all replications
together is also ruled out: it would give more weight to runs with more observations and break the
statistical unit the CI is computed on. On cancellation, the top-level includes the partial
replication's work so it is not hidden; the CI uses only complete replications and is omitted with
fewer than two.

Revisit only if a consumer explicitly needs per-replication results; in that case a separate field
is added, without changing the top-level's meaning. *(test: LILA-029)*

---

## ADR-025 — Flat event log by allocation, grouped by activity instance

**Status:** Accepted

Each pool allocation produces one flat row, and all the rows of one occurrence share
`activityInstanceId` and their original position in `allocationIndex`. An activity with no
resource, or one that closes while still queued, produces a sentinel row (`resourceId = null`,
`resourceQuantity = null`, `allocationIndex = null`). The partial lifecycle distinguishes
`terminated` from `inFlight`, keeps nullable timestamps and `observedUntil`. Costs are broken down
into `elementCost` and `resourceCost`; the element's fixed cost appears exactly once, in the
emitted row with the lowest `allocationIndex`, and `cost` is its exact sum.

One row per activity with `resources[]` is ruled out: it duplicates structure inside the CSV,
hinders streaming/XES, and contradicts the committed flat format. Internal accumulators with no
reconstruction from the log are also ruled out: they violate R-COST-3 and prevent auditing
utilization/costs without re-running the simulation. The chosen alternative keeps the CSV flat,
represents `quantity` and AND/OR, avoids duplicating the fixed cost, and keeps queued or in-flight
tasks observable at cutoff.

Revisit only with a new version of the results format; v1 consumers depend on these columns.
*(test: LILA-033, LILA-036, LILA-037)*

---

## ADR-026 — AND scheduler by signature, and a heap of eligible heads

**Status:** Accepted

AND requests with the same sorted `(pool, quantity)` signature share one FIFO queue. Each pool
indexes only the signatures that use it; when its capacity changes, those heads get re-evaluated.
A separate heap, compared explicitly by the original `(enabledAt, seq)`, picks the first
satisfiable candidate and reserves all its pools in a single mutation. Single-pool requests share
one class per pool, even across different quantities, to keep strict FIFO.

Walking and reinserting the whole global queue on every arrival is ruled out: under saturation it
produces O(n² log n). Creating one single-pool class per quantity is also ruled out, because it
would let a small request cut ahead of the same pool's head. Versions/tombstones invalidate heads
without linear searches, and release/cancel gather all affected pools before scheduling.

LILA-035 uses this same structure without adding anything new: an OR selection is enqueued as
**one entry per alternative**, each in its pool's single-pool class and all sharing the same
`seq`, so they share FIFO position and compete on equal footing with single-pool requests.
Granting one alternative leaves the others as tombstones — the same mechanism that already
invalidates heads — and flags their classes for immediate re-evaluation, which is what stops the
next head of a withdrawn pool from waiting on an event that will never arrive. The tie-break among
alternatives freed at the same time is the index declared in the scenario (R-REC-6):
`(enabledAt, seq, altIndex)` is still a total order and does not change the AND/single order,
where `altIndex` is always 0. Picking the freest pool or the least-utilized one is ruled out: it
would require a global criterion and reordering queues, and no reference behaviour from Bizagi
Modeler calls for it. `ResourceManager` remains a non-public API. *(test: LILA-034, LILA-035)*

---

## ADR-027 — `.lila`: the project folder, zipped

**Status:** Accepted

A `.lila` file is the ADR-018 project **folder compressed as a ZIP**, with the same layout and the
same file names (`lila-project.json`, `model.bpmn`, `<name>.scenario.json`, `runs/<id>.result.json`).
`zip -r` of an existing project folder is a valid `.lila` and `unzip` of a `.lila` is a valid
project folder; nothing converts and there is no migration. The manifest gains one optional field,
`engine`, naming the engine version that wrote the runs. MIME `application/vnd.lila-modeler+zip`;
see `docs/PROJECT_FORMAT.md`.

Why a container at all: the folder is right for git and wrong for handing work to somebody — the
online demo could only download a `.lila.json` blob that no desktop install could open, and «send
me your model» meant a zip built by hand with no guarantee of what was in it. Why the folder
zipped, and not a new format: the folder is already the contract every mode writes, so the
container costs one reader and one writer instead of a second definition of what a project is,
and anyone can inspect or repair a `.lila` with the unzip tool their system already has.

`fflate` is the only new dependency (MIT, ~30 KB, no transitive dependencies, works unchanged in
Node and in the browser worker) — a hand-rolled DEFLATE is not a thing this project should own,
and the alternatives either assume Node (`node:zlib`, unusable in the SPA) or pull a tree of
packages. The shared document types moved to `@lila/engine/project`, ending the hand-maintained
copy `apps/desktop/src/projectTypes.ts` kept of `apps/web`'s.

Unknown entries inside a `.lila` (`notes.md`, `attachments/…`) are reported in `problems` and
dropped, not preserved: keeping them would put opaque bytes inside `ProjectDocument`, which
crosses `structuredClone` over IPC and `JSON.stringify` into the browser's `localStorage` mirror.
The folder form still leaves such files alone. Revisit if anyone actually wants attachments —
that is a format decision (a declared `attachments/` area with a manifest entry), not a
serialization trick. *(tests: `packages/engine/test/project/lila.test.ts`,
`apps/desktop/src/lilaFile.test.ts`)*

---

## ADR-028 — Routing conditioned on the case's previous outcome (`conditions`)

**Status:** Accepted

A sequence flow leaving a **diverging** XOR may declare
`conditions: [{ flowTaken, probability }]`. When a token reaches the gateway, each outgoing flow's
declared probability is the `probability` of the first entry whose `flowTaken` the case has
already traversed, and the plain `probability` otherwise; from there R-XOR-1…5 apply unchanged to
that per-case vector, and the gateway still draws **one** uniform from its own stream
(`SEMANTICS.md` § 6.1, R-COND-1…5). On any element that is not such a flow, `conditions` stays the
reserved field of § 15, with the same `E-RESERVADO` text as before.

Context: v1 routes on probability only, so a model that merges two branches cannot tell them apart
again downstream. The credit card example (`examples/tarjeta-credito`) duplicates the whole denial
path — deny and inform, twice — for no reason other than to keep the two rejection causes
countable. That duplication is what every Bizagi user hits first, and it is the cheapest gap in
epic #335 to close.

Why not case variables: an expression language over case data means a data model, an evaluator, a
type system and a debugger for it, and it would make the engine's state per case unbounded. The
flows a case took are state the engine already has, they are named by ids the scenario already
uses, and they cover the duplication that motivated the ticket. Bizagi itself only offers this at
its level 4 through "gateway conditions" over attributes; this is the 10 % of that which removes
90 % of the duplication.

Ceilings, all deliberate:

- **A set, not a history.** `flowsTaken` has set semantics: a loop does not reset it and the
  second pass through a flow is indistinguishable from the first (R-COND-3). Routing by *how many
  times* something happened is not expressible.
- **The lint cannot fully anticipate the run.** Substituting probabilities happens per case, so
  the static check of R10 cannot predict `W-XOR-NORMALIZADA` or `E-XOR-SUMA-CERO` for a
  substituted vector. The engine emits the normalization warning at run time, once per signature,
  and a substituted vector summing to 0 falls into R-XOR-7's discard path (the last flow with
  `p > 0`, or the last flow) rather than aborting.
- **`W-COND-INALCANZABLE` is reachability, not concurrency.** It walks the IR backwards from the
  gateway through `incoming`. A flow on a **parallel** branch of an AND fork is not backwards
  reachable and warns, even though a token could in fact have traversed it. It is a warning
  precisely because the analysis is the cheap one; the run behaves correctly either way.
- **`extends` replaces the whole array.** `deepMerge` replaces arrays, so a delta that declares
  `conditions` replaces the inherited list; there is no per-entry merge.
- **No UI for picking a flow id.** The scenario panel renders `flowTaken` as a text input, not a
  select of the model's flows: a wrong id shows up as `E-REF-DESCONOCIDA` under its own path.

*(tests: `packages/engine/test/conditions.test.ts`, fixture
`packages/engine/test/fixtures/tarjeta-shared-denial.bpmn`)*

---

## See also

- `LILA_MODELER_ESTRUCTURA.md` — the full structure document (source of truth for every ADR in this file).
- `docs/BIZAGI_PARITY.md` — reference-behaviour table cited by ADR-021.
- `docs/BPMN_EXTENSION.md` — operational implementation of ADR-012 and ADR-014.
- `docs/RESULTS_FORMAT.md` — operational implementation of the calendar/utilization part of ADR-016.
- `docs/PROJECT_FORMAT.md` — operational implementation of ADR-018 and ADR-027 (the project folder and the `.lila` container).
- `docs/DECISIONS-corpus-previo.md` — original text of ADR-001 through ADR-008 (earlier corpus, project then called *Open Process Platform*).
- `BACKLOG.md` — breakdown into epics and tickets per milestone.
