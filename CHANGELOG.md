# Changelog

All notable changes to Lila Modeler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

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
