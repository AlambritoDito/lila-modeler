# Changelog

All notable changes to Lila Modeler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

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
