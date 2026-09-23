# Changelog

All notable changes to Lila Modeler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

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
