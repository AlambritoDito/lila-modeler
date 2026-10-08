# Changelog

All notable changes to Lila Modeler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [1.0.0-beta.22] - 2026-10-07

Windows through the browser (epic #577): the web app installs from Chrome or Edge and opens and
saves `.lila` files like a desktop app. Plus fixes for folder projects, loose diagrams, repositories
and quitting the desktop app.

### Added

- **Install the web app from Chrome or Edge (#570–#576)**: the editor on Pages is an installable
  PWA with Lila's icons and its own window. Installed, it opens `.lila` files with a double-click
  (through the unsaved-changes prompt), Save writes back to the file Open chose (File System Access
  API; the download stays where the browser lacks it) and it starts offline from a cache tied to
  the version. ADR-031 makes it the primary Windows channel; the unsigned `.exe` stays as a
  secondary one. Tester guide: `docs/WINDOWS-PWA-TESTER-GUIDE.md`.

### Fixed

- **Quitting the desktop app keeps the window's place and leaves no `estado.json.tmp-*` (#565)**:
  quit waits (up to 3 s) for the session-state write, and leftovers from earlier versions are
  removed at startup.
- **A folder project without `lila-project.json` runs its own scenarios (#556)**: `examples/pedido`
  opened as a folder refused Run with «the scenario points at model.bpmn, but the active model is
  pedido». Manifests that earlier builds saved that way run too.
- **A loose diagram with any file name runs (#610)**: a `.bpmn` not called `model.bpmn` (Import
  BPMN…, a double-click on `ventas.bpmn`) always failed the model check. Its default scenarios run,
  before and after Save As, and so does a scenario that names the loose file itself.
- **A repository that drops to one process keeps its slug (#517)**: deleting down to one process
  and adding another no longer moves the first to a new folder; a version 2 manifest that lists a
  single process keeps that process's slug and name, the CLI and the MCP server report its real
  paths, and two concurrent `lila run --save` on it both land.

## [1.0.0-beta.21] - 2026-10-05

Two more gaps from the same feedback round (epic #582): files from other tools and activity size.

### Added

- **Import BPMN… (#591)**: File (native menu and in-window menu) and the command palette open a
  `.bpmn` or `.xml` exported by another tool (Bizagi, Camunda, Signavio…). On the desktop a `.bpmn`
  opens like a double-click and Save writes back to it; an `.xml` opens as a new project and the
  first Save asks where. On the web the entry replaces "Open .bpmn" and no longer downloads a
  `.lila` or keeps the file in the browser. Files over 64 MB are refused.
- **Resize activities (#563)**: tasks of every type and call activities have left/right handles and
  a Width field in Properties (plain numbers from 50 to 2000). The height is kept, a drag undoes in
  one step and the width is saved in the BPMN. In a vertical pool, widening a task until its centre
  crosses into the next lane moves it there, as moving it does.

### Fixed

- **A file that fails to open leaves the open project as it was (#591)**: Open, Open recent, a
  double-click and Import BPMN… used to switch to the broken file before parsing it, so Save then
  failed with `E-PROYECTO-DISTINTO` and outside changes to the project were no longer noticed.

## [1.0.0-beta.20] - 2026-10-05

Feedback from a process-management professor and a beta tester (epic #582, Lote L1): what already
existed was hard to find or noisy to read.

### Changed

- **Results read cleanly (#578)**: Results, Compare, the charts, the Simulate dock and the canvas
  bottleneck labels show at most two decimals, and a duration of an hour or more in seconds or
  minutes reads as hours with minutes, e.g. `3.25 h (195 min)`. A non-zero value below 0.01 keeps
  two significant digits instead of reading `0`. The exact value, with its unit, is the cell's
  tooltip. The engine, the CLI, CSV/XLSX exports and the goldens keep exact values.
- **Create calendars and resources from the top (#579)**: the Calendars and Resources steps open
  with a labelled "New calendar" / "New resource" box (Enter also creates) that scrolls to and
  focuses the new entry. Before, the only way was an unlabelled box at the very bottom, below every
  calendar's full editor, and a beta tester could not find it.

### Added

- **Move lanes (#580)**: "Move lane up" / "Move lane down" in a lane's context pad move the lane with
  its tasks, boundary events and annotations, update the lane order in the saved BPMN and undo in one
  step. The Lane tool no longer needs the pool selected first: with one pool it adds the lane there,
  with several the next click on a pool picks it (Escape cancels).

## [1.0.0-beta.19] - 2026-10-05

The MCP server is published as its own npm package, `@lila-modeler/mcp` (#569, ADR-030). Until now
`npx -y @lila-modeler/engine mcp` did not work: the published engine has the `lila mcp` subcommand
but not the server, which lived in a private workspace. An MCP client now starts the server from any
directory with `npx -y @lila-modeler/mcp`.

### Added

- **`@lila-modeler/mcp` on npm (#569)**: the MCP server with its 16 tools and the `lila-mcp` bin, as a
  public package that pins the engine of the same version. The engine stays free of the MCP SDK.
  The package README carries the client configuration for Claude Code, Claude Desktop and Codex.
- **Release (#569)**: `release.yml` pack-checks the MCP package and publishes it right after the
  engine, with the same dist-tag, `--provenance` and `publish_npm` guard. `npm run test:package`
  installs both packed packages in a clean directory and lists the server's 16 tools through the
  official MCP client.

### Changed

- **Docs (#569)**: `docs/MCP.md`, the agent guide, the CLI reference and the READMEs (English and
  Spanish) use `npx -y @lila-modeler/mcp` instead of the checkout-only setup; `docs/RELEASING.md`
  covers the first manual publish of the new package and its trusted publisher.
- **`lila mcp` without the server package (#569)** now suggests `npx -y @lila-modeler/mcp`.

## [1.0.0-beta.18] - 2026-10-01

Lote K (epic #527): agents can do through MCP and the CLI what a person does in the app, on the same
`.lila` files. An agent can create a process from an outline, edit it, annotate it, simulate it,
import a scenario sheet and export the diagram, the document and the results, with no app and no
browser; the open desktop app notices the change and reloads.

### Added

- **16 MCP tools and new CLI commands (#550, #553, #557, #559)**: the MCP server now has 16 tools,
  among them `create_process`, `get_process_outline`, `edit_process`, `annotate_element`,
  `get_raci_matrix`, `export_scenario_template`, `import_scenario_sheet`, `export_diagram`,
  `export_document` and `export_results`. The CLI gains `lila process create|show|edit|annotate|raci`,
  `lila scenario template|import` and `lila export diagram|doc|results`, all with English and Spanish
  messages and `--json` output.
- **`.lila` as input everywhere (#550, #466)**: the CLI and MCP open a project archive directly, pick a
  process by slug and a scenario by name, and write back atomically. Project disk IO moved from the
  desktop to the engine as `@lila-modeler/engine/project-fs`.
- **Create a process from data (#553, #97)**: an outline (lanes plus an ordered list of steps with
  branches) becomes a laid-out, validated BPMN process inside a `.lila`, with every problem reported
  at once with its path. Uses `bpmn-auto-layout`.
- **Atomic process edits (#557, #98)**: `edit_process` and `lila process edit` apply a list of
  operations all or none, with a dry run, and report every failing operation by index.
- **Annotate, RACI, scenario sheets and project creation (#559, #99, #403)**: write descriptions, RACI
  lists, catalog refs and extended attributes by BPMN id; read the RACI matrix; export and import a
  scenario sheet (Excel or CSV) with a dry run; create a new `.lila` from a model and scenarios.
- **App-free exports (#548, #552, #538)**: a DOM-free SVG renderer for BPMN diagrams
  (`renderSvg`), and the process document (.docx, HTML) and results (.xlsx, CSV) exported without the
  app. Runs can be stored in the project from the CLI (`--save`) and MCP (`saveRun`).
- **Docs for agents (#540, #561, #562)**: an agent guide, setup for Hermes Agent and Codex, and an
  end-to-end test that runs the whole flow over stdio with no UI.

### Changed

- **Cross-process lock (#550, #559)**: every write to a `.lila` takes a lock shared by the CLI, MCP
  and the desktop app. A busy file is refused with E-ARCHIVO-OCUPADO; a file changed on disk since it
  was read is refused with E-CAMBIO-EXTERNO. Nothing partial is left on disk.
- **Desktop reloads on external changes (#539, #551, #558)**: the open project reloads when its `.lila`
  or folder changes on disk, keeping the mode, the active process and the scenarios. With unsaved
  changes a notice offers Reload or Keep mine. The app's own writes are ignored, and the canvas keeps
  its focus across automatic reloads.

### Fixed

- **Properties panel after an automatic reload (#539, #567)**: when an agent changed the open
  project, the panel kept the element from before the reload, and an edit made through it was lost
  on save while the app said Saved. The reload now selects the same element in the fresh model;
  `E-CAMBIO-EXTERNO` after «Keep mine» is translated, and the status bar shows the seed of the
  current run.
- **Simulated process depended on pool order (#546, #560)**: the simulation runs the process that
  holds most of the scenario's element ids, wherever its pool is, in the CLI, MCP and the app.

### Known limits

- The Word document exported without the app has no diagram and no charts (there is no rasteriser,
  #548); the HTML embeds the SVG. Each export says so.
- `npx -y @lila-modeler/engine mcp` does not work while `@lila-modeler/mcp` is unpublished; run the
  MCP server from a repository checkout (see `docs/MCP.md`).

## [1.0.0-beta.17] - 2026-09-30

Lote J: Simulate phase 2 (epic #526). Finishing a run no longer throws you to the Results view: a dock
under the canvas shows the quick results, the Simulate steps are renamed to what they hold, Results can
live in its own window, and undoing the delete of a pool no longer breaks the simulation.

### Added

- **Simulate dock (#394, #544)**: a dock under the canvas in Simulate with the scenario KPIs, a
  Quick results table per task (cases, wait p50/p95, utilization, fixed cost, total row), the charts,
  Bottlenecks, Run log and Warnings tabs, **Open in Results** and **Export CSV**. A finished run stays
  in Simulate instead of jumping to Results. The dock is resizable (height persisted), can be hidden
  per mode, and toggles with Cmd+J / Ctrl+J.
- **Results in its own window (#395, #542)**: the Results view detaches to a non-modal window like the
  scenario window, with a stand-in (Show, Dock) in the main window, persisted geometry on the web and
  the desktop, and charts that resize in the child window.
- **Arrivals by start event (#543)**: a list of each start event's arrival interval and case count in
  the new Arrivals step.

### Changed

- **Simulate steps renamed (#543)**: Parameters, Resources, Calendars and Arrivals (Parametros,
  Recursos, Calendarios, Llegadas), with no number prefix; every control appears in exactly one step.
  Times by element in Parameters now covers tasks and timers only.
- **Warnings grouped by message (#544)**: repeated warnings from replications are one line with the
  count, numbers normalised.
- **Top bar and guides (#537, #541, #547)**: with several processes the top bar shows the active
  process name; the macOS and Windows guides (en/es) describe the dock, the Results window, the renamed
  steps and the current menus.

### Fixed

- **Plain T toggled the token animation (#506, #541)**: typing T on the canvas no longer turns the
  token simulation on or off; it is controlled from Validate paths only.
- **Stale notices and resource messages (#537, #541)**: the "still running" export and save notices
  clear when the work finishes, and E-REC-CANTIDAD names the resource by its name.
- **Undoing a pool delete broke the simulation (#534, #545)**: undo restores the pool, its process
  and its elements in their original order, so the simulated process and the seeded results are the
  same as before; undoing a paste no longer throws, and pasting after undo and redo gets a fresh id.

## [1.0.0-beta.16] - 2026-09-28

Lote I: a public beta other people can install. This release attaches the macOS installer and, for
the first time, the Windows installer, says plainly which platforms are tested, adds a guide for the
first Windows tester, and fixes the bugs the Lote H reviews left open.

### Added

- **Windows installer on the release (#525, #529)**: the draft release a `v*` tag creates now
  carries `Lila-Modeler-<version>-win-x64.exe` next to the macOS DMG, and `SHA256SUMS` covers both.
  The Windows installer is unsigned and has not yet been run on a real Windows machine; SmartScreen
  warns before it runs. A manual run of the desktop workflow on a branch rehearses the collection
  step without touching any release.
- **Windows tester guide (#524, #530)**: `docs/WINDOWS-TESTER-GUIDE.md` (and the Spanish
  `docs/es/GUIA-PROBADOR-WINDOWS.md`) walks a first tester who is not a developer through
  installing, opening an example, simulating, exporting, importing a scenario from Excel, saving a
  project with two processes and reporting what happened.

### Changed

- **Platform status in the docs (#523, #530)**: README, landing page, the macOS guide and the
  Bizagi parity row now say where Lila stands: macOS tested (ad-hoc signed, Gatekeeper asks once);
  Windows built by CI but untested and unsigned; Linux built by CI and not attached; the web app
  tested in Chrome with Safari pending (#379). The docs no longer say the engine is missing from
  npm.
- **Validation messages in one language (#519, #532)**: Spanish engine messages no longer mix in
  English field names, and scenario messages carry the JSON location at the end in parentheses
  instead of opening with it. Error and warning codes are unchanged.
- **Process document lanes (#516, #528)**: lanes are grouped by id, so two lanes with the same name
  get two sections; child lanes nest under their parent, which keeps its own attributes; and the
  pool's attributes get their own heading instead of mixing with the process's.

### Fixed

- **Process document from the wrong process (#522, #533)**: exporting the Word or HTML document
  takes one snapshot of the active process and holds the project lock until it finishes, so a tab
  switch or a second export can no longer mix two processes in one document.
- **Pasted pool sharing the original process (#515, #533)**: after deleting a pool and undoing, the
  first paste of that pool no longer reuses the original process id.
- **Project folders that are not this project's (#517, #531)**: Save As onto a folder whose
  `processes/` already holds another project's files is refused, a process folder created by hand
  after opening is never overwritten, and the refusal (E-CARPETA-OCUPADA) is translated and names
  what is in the way.
- **Shortcut hints on Windows and Linux (#530)**: the welcome screen shows Ctrl+O and Ctrl+N
  outside macOS instead of ⌘O and ⌘N.

## [1.0.0-beta.15] - 2026-09-28

Lote H: several processes in one project, attributes you define once per element type, charts next
to the results tables, calendars that finish what #82 started, and a scenario import from Excel.

### Added

- **Several processes in one project, with call activity navigation (#511)**: a project can now
  hold more than one process, each a tab on the canvas, added with the `+` button and renamed or
  deleted from its own tab. Double-click a call activity whose target matches another process's id
  opens that process with a «Back to …» crumb; double-click a collapsed sub-process drills down in
  place. The file format grows a `processes` list (repository v2) only once a project has a second
  process; a one-process project still saves in the version 1 layout the installed beta.14 app
  already reads, so nothing on disk needs migrating. Beta.14 cannot open a project with several
  processes: it reports that the model is missing (LILA-NO-MODEL) rather than a version error.
- **Extended attributes per element type (#509, #513)**: define a text, number, list or date
  attribute once for a task, gateway, event, sub-process, lane, pool or the process itself, from
  Properties → «Define attributes…», then fill it in per element. Filled-in values (or the
  definition's default) show in Properties and appear under each element in the process document.
  Renaming, retyping or deleting a definition that elements already use asks first.
- **Charts in Results, Compare and the process document (#460, #512)**: bar charts sit under the
  tables for process elements, resources and the process itself in Results, and under Compare's
  scenario tables; the process document rasterises the same charts. Every bar repeats its table
  cell's own text, and missing data gets a note instead of an all-zero chart.
- **Monthly and annual calendar recurrence, and holidays (#82, #510)**: besides the weekly grid, a
  calendar interval can now repeat on a day of the month (including the last day), a weekday of the
  month (e.g. the last Friday) or a fixed yearly date, and a calendar can list one-off or yearly
  holidays that close the whole civil day. A calendar's own timezone with DST stays out of scope
  and reserved (R-CAL-15).
- **Import scenario parameters from Excel/CSV (#449, #514)**: the scenario panel can download a
  filled-in template and import a matching Excel or CSV file; a report lists every change plus any
  unmatched, ambiguous or invalid row before anything is applied, and the import can be undone
  while nothing else has changed the scenario.

## [1.0.0-beta.14] - 2026-09-26

Lote G: the classroom deliverable and the safety net. The process document exports to Word and
HTML the way Bizagi's «Publish to Word» lays it out; the desktop app keeps a recovery copy and
offers it back after a crash; the welcome screen lists every public example; and seven small bugs
from the QA of Lote F are fixed. No installer is attached to this version.

### Added

- **Process document as Word (.docx) and printable HTML** (#454): File → Export process document.
  Cover, the diagram on white paper, the process description, one section per element in flow
  order grouped by lane (type, id, lane, sub-process, `bpmn:documentation`, RACI and `lila:`
  references), the scenario parameters and, after a run, the same result tables as the XLSX.
  Word's built-in heading styles drive the navigation pane; the HTML is one self-contained page
  that prints to A4 with every column. Also in ⌘K and the native File menu.
- **Autosave with recovery on the desktop app** (#459): a recovery copy is written five seconds
  after the first unsaved change and at most once every five seconds after that. When the previous
  session did not close cleanly, the next launch offers to restore it (Esc keeps it); the restored
  project opens as unsaved and Save goes through Save as, so the original file is never
  overwritten. The copy is deleted on save, on discard and on a clean close.
- **Examples gallery on the welcome screen** (#458): the restaurant order, Bizagi's four
  simulation levels and the M/M/1 and M/M/3 oracles, each with a one-line description, open as a
  clean project ready to simulate.
- **Warm-up notice** (#431): when every arrival falls inside the warm-up, Results says so instead of
  showing an all-zero table.

### Fixed

- **Run right after drawing** (#431): Run waits for the reparse and the seeding of defaults, so a
  task appended a moment before no longer lands on an empty Results view.
- **Desktop top bar in Spanish** (#434): below 1230 px the bar tightens and the unsaved state
  collapses to a dot, so the project name and «Sin guardar» no longer clip between 1024 and
  ~1230 px.
- **Coloured flows and pool contents in dark themes** (#489): coloured flows take a lighter stroke
  and theme-coloured flows and labels inside a coloured pool take the pool's stroke, at render
  time only; the XML keeps the palette colour and paper exports keep the palette stroke.
- **Properties of a floating label** (#485): selecting a label shows the type and id of the element
  it labels.
- **T with modifiers** (#492): Ctrl/⌘/Alt + T no longer toggles the token simulation outside
  «Validate paths».
- **Bottleneck heat in exports** (#454): the bottleneck colour no longer exports as black in
  PNG/SVG/PDF.
- **Flaky App test** (#494): the test waits for the startup reparse instead of racing it.
- **Distribute** (#488): documented that diagram-js leaves approximately equal gaps.

## [1.0.0-beta.13] - 2026-09-26

Standard macOS keys in the desktop app. No installer is attached to this version.

### Fixed

- **⌘W / ⌘Q in the About and detached scenario windows**: they are handled by the main process
  from `before-input-event` instead of trusting the menu to see them. In the installed beta.11,
  with the About window in front, neither closed it nor quit. ⌥⌘W (Close All) and ⌥⌘Q still
  belong to the menu; outside macOS only Ctrl+W.
- **DevTools (⌥⌘I) are no longer in View in a packaged build**: only when running unpackaged.

### Added

- **Help menu**: the macOS Help menu (with the system's menu search, ⇧⌘/) and Documentation,
  which opens the same page as the welcome screen.

## [1.0.0-beta.12] - 2026-09-26

The minimap keeps the view in sight: its box no longer leaves the map when you zoom out or pan
away, so there is always something to click to come back.

### Fixed

- **Minimap viewport box**: the minimap now frames the diagram together with the part of it on
  screen, so the box stays inside the map at any zoom or distance instead of spilling over the
  header or vanishing. The frame holds still while the button is down, so a click centres where
  you clicked instead of jumping elsewhere, and every press re-measures the map.

## [1.0.0-beta.11] - 2026-09-26

Lote F: fixes for what students hit in class, and two Bizagi-style diagram tools. Deleting a
configured task no longer strands Run; a partial OR declaration warns while modelling; painting the
calendar grid keeps the ranges as written; the English UI no longer leaks internal state ids; and
elements can be coloured, aligned and distributed. No installer is attached to this version.

### Added

- **Colours per element (#452)**: eight colours plus «None» in Properties (also with several
  elements selected) and in the context pad, one undo step. Written as `bioc:fill/stroke` and
  `color:background-color/border-color` (what bpmn-js, Camunda and Bizagi exchange) plus the
  internal label colour; Bizagi `bgColor`/`borderColor` are read on import. Colours survive theme
  changes, «Validate paths» and PNG/PDF export; the engine ignores them.
- **Align and distribute (#453)**: a group at the top right of the canvas in Model, the ⌘K palette
  and ⌥⇧L/C/R/T/M/B (align) and ⌥⇧H/V (distribute), through bpmn-js's own editor actions (lanes are
  left alone, the canvas lock is respected). Buttons enable only when bpmn-js would move something.
- **`W-OR-PROB-PARCIAL` (#398)**: the scenario lint warns on each outgoing flow of an inclusive (OR)
  gateway that has no `probability` while a sibling declares one (R-OR-2: it counts as 1, so it is
  always taken). Live in Model and Simulate; never blocks Run; results unchanged.

### Fixed

- **Orphan scenario entries (#430)**: the scenario panel lists entries whose element is no longer
  in the model, with «Remove orphan entries» (base and children); the same button appears in the
  status bar when Run fails only with `E-ELEMENTO-DESCONOCIDO`, and the error counter marks a failed
  Run. Nothing is removed automatically, so ⌘Z after deleting a shape keeps its configuration.
- **Calendar grid keeps picker ranges (#469)**: painting a cell keeps the ranges that are still
  fully open as written and in order; only the rest is re-derived.
- **Reserved-field status translated (#477)**: «own» / «inherited» instead of the internal id.
- **Properties header follows «Advanced» (#471)**: with it off, the header shows the readable type
  and the Id row is hidden.

## [1.0.0-beta.10] - 2026-09-26

The desktop app now tells you when a newer version of Lila Modeler is on GitHub and opens its
release page for you.

### Added

- **Update notice (#487)**: on launch, the packaged desktop app checks GitHub's releases and, when a
  newer version is out, offers to open its release page. Silent offline; nothing is installed in
  place yet, that waits on a Developer ID signature (#486).

## [1.0.0-beta.9] - 2026-09-26

First npm publication. The engine and CLI now ship as @lila-modeler/engine (the @lila scope
belongs to another npm account), under the `beta` dist-tag. No installer is attached to this version.

### Changed

- **npm scope (#48)**: workspace packages renamed from `@lila/*` to `@lila-modeler/*`; install the CLI
  with `npm install -g @lila-modeler/engine`. Historical notes keep the old names.

### Fixed

- **`lila` bin kept on publish**: the `bin` path no longer starts with `./`, which npm 11 rejected
  and silently dropped from the published manifest.

## [1.0.0-beta.8] - 2026-09-25

Lote E: what a class hands in and how it is drawn. The diagram exports as SVG, PNG and PDF and
prints from the File menu (⌘P); BPMN ids are hidden behind an «Advanced» setting; calendars get
Bizagi-style day presets and from–to ranges; unsupported constructs warn while modelling and only
block Run; the palette carries the full BPMN set and bpmn-js speaks Spanish; the theme follows the
system's light/dark scheme with two slots; the app's chrome is no longer text-selectable; the About
karaoke plays at half speed; and the CLI has a reference written for agents. No installer is
attached to this version.

### Added

- **Export the diagram as SVG, PNG and PDF, and print it (#451)**: File → Export as SVG… / PNG… /
  PDF… and Print… (⌘P / Ctrl+P) on desktop; SVG and PNG downloads plus «Print / Save as PDF…» in
  the browser. The image carries no selection outline and no editor chrome. SVG keeps the theme's
  colours on the theme's canvas background; PNG (2×), PDF and print go on white paper with black
  strokes and labels, keeping any per-element colours.
- **Calendar ranges like Bizagi (#448)**: above the weekly grid, day presets (Mon–Fri / Every day /
  Weekend), per-day checkboxes, from–to as `HH:MM` (`24:00` allowed in «to») and «Add range», which
  appends exactly one `intervals[]` entry as typed — no rounding, no merging. A list of the current
  ranges with remove; the grid still paints the same array.
- **Model without simulating (#455, #456)**: constructs the engine does not simulate (`E-NOSOP`)
  now show while modelling as warnings in Model mode (marker, chips, validation list) and as errors
  in the other modes; Run keeps failing with the engine's own `E-NOSOP`. The palette carries every
  start/intermediate/end event type, task subtype, collapsed and event sub-processes, transactions,
  boundary events (attached to the selected activity) and lanes. bpmn-js's context pad, replace
  menu and popups follow the app language (Spanish translation of 131 templates).
- **Theme follows the system (#472)**: Settings → Appearance gains «Follow the system theme» (on by
  default) with a light slot and a dark slot (Lila Light / Lila Dark by default) that rotate with
  the OS scheme while the app runs. The first automatic switch asks once whether to keep it
  automatic. Someone who had chosen another theme keeps it in both slots until they pick a second.
- **CLI reference for agents (#450)**: `docs/CLI.md` / `docs/es/CLI.md` with a runnable example per
  command, exit codes, output flags and a «For agents» loop; `lila --version` (#48).

### Changed

- **BPMN ids hidden by default (#447)**: the scenario panel, the step lists, gateway flow labels,
  the bottleneck line and ⌘K show the element's name (the id only when it has no name). Settings →
  General → «Advanced» shows the id beside the name. Clicking a row still selects the element.
- **Chrome is not text-selectable (#463)**: the top bar and its menus, the palette, the scenario
  rail, mode, panel and diagram tabs, panel headings, the status bar, the Settings tablist, buttons
  and chips no longer select as text; inputs, the scenario JSON, results and compare tables,
  validation messages, About and the shortcuts table still do.
- **About karaoke at half speed (#446)**: the words can be read; the link opens when the last line
  has landed.

## [1.0.0-beta.7] - 2026-09-25

Close window and quit from the keyboard in the desktop app on macOS: File gains the native «Close
Window» entry (⌘W) and ⌘Q keeps quitting from the application menu. No installer is attached to
this version.

### Added

- **Close Window (⌘W) on macOS**: the File menu ends with Electron's `close` role, which closes
  the focused window (About or the detached scenario on their own; the main window asks first
  when there are unsaved changes and, like its red button, quits the app). Windows and Linux
  already had Close (Ctrl+W) in their Window menu, so nothing is duplicated there. ⌘Q / Ctrl+Q
  keep their `quit` role, now covered by a test. Documented in `docs/SHORTCUTS.md`.

## [1.0.0-beta.6] - 2026-09-24

Lote C: keyboard, search and Settings. One shortcut map now drives the keys, the tooltips, the
native menu and a new Shortcuts section, the search box in the top bar is a real command palette
on Cmd+K, and Settings is laid out like the design: sections on the left, content on the right. No
installer is attached to this version.

### Added

- **Command palette** (#410): ⌘K / Ctrl+K or the search box open a palette that finds the
  diagram's elements by name, id or type (Enter selects and centres the element on the canvas),
  switches scenarios and modes, and runs the app's actions with their keys shown; ↑/↓, Enter and
  Esc, with the focus returned where it was. In the desktop app it also opens from the detached
  scenario window.
- **One shortcut map** (#413): `apps/web/src/atajos.ts` feeds the keyboard, the tooltips, the
  Electron menu and the docs. New keys: ⌘↩ run, Esc cancel, ⌘+ / ⌘− / ⌘0 zoom and fit, F2 rename,
  ⌘⇧L / ⌘⇧P / ⌘⇧D / ⌘⇧B show or hide the left column, the right panel, the diagram tabs and the
  status bar, ⌘1…⌘6 modes (desktop app). Keys without ⌘ never fire inside a field. The desktop
  app gets its own View and Simulation menus. Documented in `docs/SHORTCUTS.md`.
- **Settings → Shortcuts** (#407, #413): a read-only table of the whole map with this platform's
  keys.

### Changed

- **Settings** (#407): General (language, density), Appearance and Shortcuts as sections on the
  left with the content on the right, labels on the left of the controls, only the content scrolls
  and Close is always visible; radius 0 and 1 px rules throughout.
- **Tab on the canvas moves the focus again** (#413): the Tab / Shift+Tab panel toggles of #412
  are replaced by ⌘⇧P / ⌘⇧L; F6 and ⇧F6 still leave the canvas.
- The Electron View menu no longer reloads the page or zooms the whole window: those keys belong
  to the canvas now.

## [1.0.0-beta.5] - 2026-09-23

Lote B: first use and the frame of the UI. Running an empty or incomplete process now says what is
missing wherever you are, shapes drawn on a new process get usable defaults, the palette, rail,
panel, tab strip and status bar can be hidden and resized per mode, About lives in its own window,
and the desktop app shows the File menu in the top bar. No installer is attached to this version.

### Added

- **Hideable panels, Ableton-style** (#412): toggles at the right end of the top bar (a «View» menu
  below 1480 px) hide the left column, the right panel, the diagram tab strip and the status bar,
  remembered per mode; Tab / Shift+Tab toggle the right panel / left column while the canvas has
  focus, F6 / Shift+F6 leave the canvas, and a double-click (or Enter) on a divider collapses that
  side. The status bar reappears while an error is showing; the detached scenario window counts as
  «right panel hidden».
- **Resizable left column** (#406): the palette (180–360 px, snapping to its 48 px compact mode)
  and the scenario rail (160–320 px) have a divider with drag and arrow keys; widths are saved
  separately.
- **Defaults for drawn shapes** (#420): the first start event drawn on a process gets 20 arrivals
  one minute apart and every new task one minute of work, only in the base scenario and never over
  an existing entry; an untouched seed leaves with its shape (undo, delete).
- **File menu on desktop** (#411): the same New / Open / Open recent / Save / Save as entries as
  the native menu, in the top bar, closing on Esc and on a click outside.

### Changed

- **About in its own window** (#408): the approved Lila tile with rounded corners (the one
  exception to the radius-0 system) and a grow/shrink pulse on click; the six-click Easter egg,
  the version and the fixed Spanish lines are unchanged.
- **Welcome «What's new»** (#425): the paragraph is this version's introduction from the changelog,
  read at build time (English in both languages); the theme/density line no longer ends with a
  stray «·».
- **Startup and window background follow the system scheme** (#421): cream on a light system, plum
  on a dark one, instead of always dark.
- **Deleting the active user theme** (#422) falls back to the system-based Lila default, not to
  Eva-01.

### Fixed

- **Run errors were silent outside the Simulation tab** (#419): the validation errors of Run
  (`E-SIN-START`, `E-SIN-END`…) show in the status bar whenever the Simulation tab is not visible,
  and the process id or element path is no longer printed twice.
- **The inert search field collapsed to an empty box** (#423): it is now at least 120 px wide or
  hidden, whatever the language and project name; the mode tabs give up their padding below
  1400 px instead of 1365.

## [1.0.0-beta.4] - 2026-09-23

### Added

- **Documentation on the website**: every public guide and reference under `docs/`, `docs/es/`
  and `docs/releases/` is rendered to HTML at `docs/` on the GitHub Pages site, with an index in
  English and Spanish. New Markdown files appear automatically; links between docs stay on the site
  and links to source files go to GitHub. The landing's Docs section and «Coming from Bizagi?» now
  open those pages instead of GitHub.

## [1.0.0-beta.3] - 2026-09-23

Lote A: identity and first launch. No installer is attached to this version; the browser app and
locally built desktop bundles report it so builds can be told apart.

### Added

- **Lila Light and Lila Dark themes** (#404): two built-in themes drawn from the approved Lila
  illustration palette (purple, cream, pink, plum, lavender). Both pass the contrast checks and drive
  the light/dark scheme of native controls and of the detached scenario window.
- **Default theme by system scheme** (#404): while no theme is saved, the app follows
  `prefers-color-scheme` (Lila Dark or Lila Light) on every launch without saving that choice; once a
  theme is picked in Settings it always wins. A saved id that no longer exists falls back the same way.

### Changed

- **New process starts empty** (#409): «New» (⌘N, File menu, toolbar, welcome screen) creates a
  process with no shapes and two scenarios with no element entries, as the welcome hint promised;
  the old start → task → end template only survives as a test fixture.
- **Detach toggle is an icon** (#405): the «Scenario docked ↗» control in the top bar is a 30 px icon
  button at every width, with the full text as its accessible label and tooltip.

### Fixed

- **File line no longer clipped in Spanish** (#399): «model.bpmn · Guardado» stays whole while the
  search field is visible; the project name is what ellipsizes when the bar is short of room.
- **Duplicating a scenario twice** (#397) no longer overwrites the first copy: copies are numbered
  (« (copy)», « (copy 2)», …) and each one still extends the original.
- **Desktop Recent list scoped to the active profile** (#389): the one-off migration that copied the
  pre-productName `estado.json` from the shared app-data folder into any fresh profile is gone, so an
  isolated `--user-data-dir` no longer shows another profile's projects.

## [1.0.0-beta.2] - 2026-09-23

Interim beta: the Simulate view follows the "Turno 2" design review. No installer is attached to this
version yet; the browser app and locally built desktop bundles report it so builds can be told apart.

### Added

- **Detachable scenario window** (#391, #393): the scenario editor can leave the right panel for its own
  non-modal OS window ("Scenario docked ↗" in the top bar, "Dock" in the window). It shares the live
  model, selection, dirty state and ⌘S with the main window; theme, density, language and light/dark
  scheme follow it live; its size and position are remembered. In the desktop app only that window may
  be opened, with hardened window options.
- **Scenario rail** in Simulate (#390, #393): the shape palette gives way to the list of scenarios
  (BASE badge, last run or "not run", validation chips); the scenario `<select>` is gone.
- **Resizable right panel** (#390): 300–520 px with a keyboard-accessible divider; from 440 px the
  scenario form lays out in two columns.
- **Properties panel** (#392): an empty state with process counts and shortcuts, and a header with the
  element icon, name and `bpmn:Type · id` when one element is selected.

### Changed

- **Brand lockup** without a box (#392, #370): the approved Lila illustration with a transparent
  background at 26 px, product name, a 1 px rule and the project/file line.
- **Native controls** (#392): selects, checkboxes and date-time fields are drawn with the theme tokens
  (radius 0, themed chevron and tick, `color-scheme` per theme).
- **Default-parameter warnings** (#377, closes #360): `W-ELEMENTO-SIN-PARAMETROS` is emitted only for
  actionable elements (tasks, timers, starts and diverging XOR/OR gateways without probabilities or
  conditions); end events, AND/event gateways and merge gateways no longer warn. The sample order now
  shows one warning instead of six. Its code and text are unchanged.
- English design screenshots refreshed from this UI (#401).

## [1.0.0-beta.1] - 2026-09-22

First public beta: the browser app at <https://alambritodito.github.io/lila-modeler/app/> and an
unsigned macOS Apple Silicon (arm64) desktop build. Windows and Linux are built by CI but not tested and not offered; there is no Intel Mac build.

### Changed — statistical behaviour (#356)

- Cross-replication duration statistics are now **conditional on observation**. A replication in
  which a task or timer completed no instance no longer contributes a zero to that element's
  `processing`/`resourceWait`/`offHoursWait` `min`/`max`/`mean`; the same applies to
  `process.cycleTime`/`waitTime`/`costPerCase`/`withinServiceLevel` and to every `byEndEvent`
  outcome when no case completed. Within-replication standard deviations need at least two
  observations. Counts and totals (`started`, `completed`, `*.total`, flows, resources, queue
  lengths, costs) are unchanged.
- Every `replications.kpis[...]` entry carries `n`, the number of contributing replications
  (distinct from the observation count). `sd`/`ci95` are published only when `n ≥ 2`; `n = 1`
  publishes the single value; `n = 0` keeps `mean: 0` as the identity value, not an estimate.
- New warning `W-REPLICACIONES-SIN-OBSERVACIONES` discloses when some replications had no
  observation for an element, the process or an outcome.
- **Interpreting older results**: runs saved before this version carry no `n` and were computed
  with the previous definition (empty replications counted as zero). They are not recomputed or
  relabeled; the results view marks them, and comparing them against new runs mixes two
  definitions. See `docs/RESULTS_FORMAT.md` §8 and ADR-024.

### Fixed

- Saving a `.lila` project opened through a launch argument, Finder double-click, `open-file` or
  the recent list no longer fails with `E-ARGUMENTO … .bpmn` on macOS (#378).

### Added

- "About Lila Modeler" dialog (Settings, the web File menu and the native macOS app menu) with the
  app icon, name, version and the brand line, always in Spanish.
- Public site: five themes described, Beta 1 download, and a getting-started guide for
  colleagues in English and Spanish (browser-local storage vs the portable `.lila`, how to share a
  project, known limits, where to report problems).
- Release notes (this file) and the Beta 1 verification report under `docs/releases/`.

### CI and delivery

- A `v*` tag no longer publishes to npm; publication requires an explicit manual run.
- The desktop workflow promotes only the validated macOS arm64 DMG (with checksum) to a draft
  prerelease; Pages can be published manually from a release tag.

### Known limitations

- The macOS build is unsigned and not notarized: on macOS 15 and newer the first launch is blocked
  and System Settings ▸ Privacy & Security ▸ Open Anyway is needed (Control-click ▸ Open only helps on
  older macOS). Do not disable Gatekeeper.
- Web app tested on macOS 27.0 (arm64) with Chrome 154 only; Safari and other browsers,
  operating systems and architectures are untested.
- Mobile editing is untested; Beta 1 acceptance ran on desktop browsers at 1440×900, narrower
  editor viewports are untested.
