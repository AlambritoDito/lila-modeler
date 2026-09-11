# Desktop beta guide (macOS)

> Read this in: [Español](es/GUIA-BETA-MAC.md)

This guide describes the desktop beta, including the language settings added on
2026-09-09: `DesktopStore` is already wired up in `main.tsx`
(`apps/web/src/main.tsx`, "Único punto de elección BrowserStore/DesktopStore" — single choice point
for BrowserStore/DesktopStore), with transactional saving, safe closing via a native dialog,
recents, and the E2E test seam described below. It includes nothing promised or planned: wherever
something is not yet wired up, this is stated explicitly under "Limitations of this beta" below.

## Requirements

- A Mac with **Apple Silicon (arm64)**. This beta's artifact is only built for `arm64`
  (`apps/desktop/electron-builder.yml`); there is no Intel (`x64`) build.
- **macOS 13 (Ventura) or newer** (`LSMinimumSystemVersion` of the packaged `.app`).
- No extra installation requirements: the app bundles Electron with its own Chromium and Node, and
  does not depend on Node being installed on the machine.

## Where the installer is and how to open it unsigned

The installer is a `.dmg` generated with `electron-builder` (`npm run dist:mac -w @lila/desktop`),
for example `Lila Modeler-1.0.0-alpha.1-mac-arm64.dmg`. It is not distributed inside the repository (the
`apps/desktop/release/` folder is in `.gitignore`): you have to build it (see below) or receive it
through whatever channel the team uses.

The app is **not signed or notarized** (`identity: null` in `electron-builder.yml`, local beta). If
macOS blocks a copy received from another machine, check where it came from and use whatever
opening options the system offers. This local build was tested without changing any global
protections or removing quarantine attributes.

The app uses the Lila icon in the Dock and in Finder.

## What the window shows on launch

The app always starts with the same example diagram bundled with it: the `pedido` process from
`examples/pedido/model.bpmn` (imported directly in `apps/web/src/main.tsx`, not an external file).
It shows with the **Eva-01** theme (dark background, light text, the bpmn-js palette on the left,
the properties panel on the right) — the default theme `tokens.css` ships with, loaded on the fly
from `eva-01.json`.

## Usage walkthrough

The top bar has five modes: **Model**, **Simulate**, **Results**, **Compare**, and **Validate routes**.
English is the base language and Spanish is available as a translation. The app follows the system
language unless you select English or Spanish in Settings. The native File menu and close dialogs
follow that same setting. This walkthrough uses the English labels.

### Model («Modelar»)

- On desktop you work with **New project** and **Open project**
  by folder. You can also open a loose `.bpmn` by double click. Use **Save as** to retain
  its scenarios and runs in a project folder, as described below.
- The central canvas is the bpmn-js editor: you edit it by dragging shapes from the palette, just
  like any bpmn.io editor.
- **Undo** / **Redo**: in the bottom bar, next to the active file's name.
- The edited XML is saved as `model.bpmn` inside the project folder.

### Simulate (the "Simulación" tab in the right-hand panel)

- **Scenario** selector: choose among the loaded scenarios (the project ships with
  `as-is` and `to-be-3-cajeros` as examples).
- The scenario panel lets you edit `run`, `calendars`, `resources`, and the process's per-element
  properties. Union-shaped fields — today only `resources.<id>.capacity` — have an explicit
  **Fija** (Fixed, a number) / **Por turno** (Per shift, a list of `{ calendar, capacity }`
  segments, with `calendar` as a dropdown of already-declared calendars) selector.
- A field inherited from an `extends` shows a **Quitar heredado** (Remove inherited) button (or
  **Quitar** — Remove — if the field belongs to the file itself, not inherited): clicking it writes
  `null` into the delta, which is how you "delete" an inherited value (§ 6 of the scenario format).
  If it is already deleted, the button switches to **Restaurar heredado** (Restore inherited),
  which removes that `null` and goes back to inheriting from the parent.
- **Guardar** (Save, inside the scenario panel) and **Duplicar** (Duplicate — creates a copy with
  `extends` on top of the current file, the app's own "what-if") are separate from the top bar's
  "Guardar proyecto" (Save project); they are never disabled.
- **Simulate**: runs the simulation on whatever is on the canvas right now. While it
  runs, a **Cancel** button and a progress indicator (`% · replication N`) appear. The
  **Bottlenecks** toggle turns the diagram overlay on or off without
  re-simulating.

### Results («Resultados»)

When a simulation finishes, the app switches to this mode on its own. Each table (elements, flows,
resources, process) has its own **Export CSV** button, which downloads exactly the
same content, byte for byte, that `npx lila run --csv` writes to disk (`elements.csv`, `flows.csv`,
`resources.csv`, `process.csv`).

### Compare («Comparar»)

- **Base scenario** selector: any scenario that has already been simulated can be
  the comparison's baseline.
- **Show all KPIs** checkbox: by default the flows table is hidden; this
  checkbox reveals it.
- **Warnings** section: it only appears when there is something to say, and groups up to
  five kinds, in this order:
  1. *Costs in different currencies*: if the compared runs do not use the same currency
     (`run.currency`), no cost delta is marked as comparable — the warning says so explicitly, and
     cost cells carry no significance asterisk.
  2. *Different time units*: each run is shown with the unit it was generated with
     (`run.baseTimeUnit`), with no normalization.
  3. *No confidence intervals*: if any run has fewer than 2 replications, there is no 95% CI, so no
     difference is marked significant in any table.
  4. *Different seeds*: an informational warning; it blocks nothing.
  5. *Different replication count*: same, informational.
- **Significance** section: an asterisk (`*`) in a cell means "significant
  difference (non-overlapping 95% CIs) against the baseline"; highlighted cells are the ones that
  changed relative to the baseline. If warning 3 above applies, this section repeats it and no
  asterisk is drawn at all.

### Validate routes («Validar rutas»)

- **This is not the engine's DES simulation**: it animates `bpmn-js-token-simulation` tokens on top
  of the open diagram. It does not read the active scenario or produce results, and the tab itself
  says so: «Animación de tokens de bpmn-js: no es simulación de eventos discretos; no usa el
  escenario ni produce resultados.» (bpmn-js token animation: this is not discrete-event simulation;
  it does not use the scenario or produce results.) It is there to eyeball which routes get taken,
  not to measure anything.
- While this mode is active, neither the bottleneck overlay nor the validation markers are drawn,
  and the diagram cannot be edited; going back to **Modelar** (Model) restores everything.
- The controls are the bpmn.io module's own, and since LILA-205 (#264) **they appear in Spanish**:
  the canvas's left-hand palette («Reproducir o pausar la simulación» — Play or pause the
  simulation, «Reiniciar simulación» — Restart simulation, «Registro de la simulación» — Simulation
  log), the buttons that appear over shapes («Disparar evento» — Trigger event, to start from a
  start event; «Añadir punto de pausa» — Add breakpoint, to stop at an activity and step through
  it; «Elegir el flujo de salida» — Choose outgoing flow, for a gateway's output), and the log's
  messages. The module does not use bpmn-js's `translate` service — its text is written straight
  into the HTML — so the translation is done by substituting it on the canvas
  (`traducirSimulacion` in `apps/web/src/TokenSim.tsx`, with the inventory in `strings.es.ts`): if
  the module is ever updated and a label changes, that label will simply show up in English again,
  never broken.
- The diagram **keeps the theme's colors** during the animation (#264). Out of the box, the module
  repaints it in black and white for the whole mode, built for a white canvas; Lila overrides two of
  its services (`moduloColoresDelTema` in `apps/web/src/TokenSim.tsx`) so it paints with the theme's
  tokens instead. A gateway's chosen output is marked with the theme's selection color (lime in
  Eva-01, red in Papel) and the discarded one with a normal connection's color; the animation's own
  markers — the scopes' green, the token counter — are left as they come.

### Save and restore («Guardar y recuperar»)

This is real, working functionality: `DesktopStore` is wired up in `main.tsx` and reads/writes a
**project folder** on disk, not a loose file downloaded by the browser.

- **New project**: asks you to choose a folder. It can be empty, or already
  contain a project with the same id (to save back into it); a folder holding content from
  **another** project (a `lila-project.json` with a different id, or a `model.bpmn` with no
  matching manifest) is rejected with `E-CARPETA-OCUPADA`, without touching anything that was
  already there.
- **Open project**: a native folder picker; loads whatever project is there.
- **Save project**: saves into the active folder (the one from the last
  successful "New"/"Open"/"Save as").
- **Save as…**: asks where to create a new **`.lila`** — the whole project in one file
  (ADR-027), which is the form to hand to somebody else. **Save as folder…** is the same thing
  towards a project folder, which is the form to keep in git. Both apply the same
  `E-CARPETA-OCUPADA` rules as "New project": a destination that already holds a *different*
  project is refused without touching it.
- The top bar shows `<project name> · Sin guardar` (Unsaved) or `· Guardado` (Saved) depending on
  whether there are pending changes (`apps/web/src/App.tsx`).
- **Closing with unsaved changes**: the window (red button, Cmd+Q, or closing it from the Dock)
  shows the system's native dialog with **Save / Discard / Cancel**. **Save** waits up to 30 s for the app's response before closing; a cancelled save keeps the window open without an error. If saving fails or the response
  never arrives, an error is shown and the window does not close. A loose diagram saved with
  pending scenarios or runs shows an informational message explaining that **Save as…** is
  required to save the complete project. Closing the last window also
  quits the app on Mac; on reopening, use **Open project** to get the saved folder
  back.
- **What files a project folder holds**: `model.bpmn` (the diagram), one `<name>.scenario.json`
  per scenario (for example `as-is.scenario.json`, `to-be.scenario.json`), `lila-project.json`
  (metadata: id, name, revisions), and a `runs/` subfolder with one saved run per file.
- **A `.bpmn` with a different name inside the folder is saved as a loose diagram**: the manifest
  (`lila-project.json`) describes **only** `model.bpmn` — its name and its revision. If you open
  `ventas.bpmn` (double click) in a folder that is already a Lila project, `⌘S` writes that
  `ventas.bpmn` and nothing else: `model.bpmn`, the scenarios, and the manifest stay byte for byte
  as they were, and runs are not saved. The bottom bar warns about it while that diagram is open —
  «Diagrama suelto: los escenarios y las corridas no se guardan hasta «Guardar como»» (Loose
  diagram: scenarios and runs are not saved until "Save as") —, the same as with a loose `.bpmn` in
  `~/Descargas`: it is the same save mode. Reopening the folder from recents shows the `model.bpmn`
  project again, not the other diagram. To turn `ventas.bpmn` into its own project, use **Guardar
  como** (Save as) into a new folder: there the XML becomes that new project's `model.bpmn`
  (**Guardar como** always writes `model.bpmn`; asking it for a different file name is rejected with
  `E-DESTINO-INVALIDO`, because it would leave a folder with no manifest that could never be
  reopened). Choosing the SAME project folder is rejected with a warning («esta carpeta ya tiene su
  `model.bpmn`» — this folder already has its `model.bpmn`): there, "Guardar como" would overwrite
  the project's model with the loose diagram. A loose `.bpmn` that is **not** inside a project — the
  one in `~/Descargas` — can indeed become a project in its own folder: there is no `model.bpmn` or
  manifest to overwrite, and the project is created alongside it, leaving the original `.bpmn`
  untouched.
- **`Model.bpmn` (capitalized) is not opened INSIDE a project folder**: if there is a
  `lila-project.json` next to it, it is rejected with `E-ARGUMENTO` and the message asks you to
  rename it. On Mac the disk is case-insensitive, so there that file **is** the project's
  `model.bpmn`, but the app would treat it as "another diagram" and save only half of it (the model,
  yes; the manifest and scenarios, no). Outside a project — a `Model.bpmn` in `~/Descargas`, say —
  it opens and saves normally, like any loose diagram.
- **A scenario with broken JSON does not block opening the project**: that file is excluded and
  noted in `problems`; the rest of the project (the model and the other scenarios) opens normally.
  This does show up in the interface: `App.tsx` reads `doc.problems` when it activates the project
  and renders it as a warning (`<span role="alert">`) with the file and the reason.
- **Saving into a folder with no write permission** shows an error (`E-DESTINO-INVALIDO`) and loses
  nothing: the previous file stays intact and the bar keeps showing "Sin guardar" (Unsaved). What
  you see today is Electron's raw text ("Error invoking remote method…"), not a friendly
  translation (see "Limitations" below).
- **External changes on disk** (someone else — or another process — modified `model.bpmn`, the
  manifest, or a scenario after this window last read or saved it): when you try to save, the app
  refuses with `E-CAMBIO-EXTERNO: <files>` without touching disk. **There is no "Overwrite" button
  today**: the only way out from the interface is "Guardar como" (Save as, into another folder).

### Recents and window («Recientes y ventana»)

- The window's size/position and the list of recent projects are saved in
  `~/Library/Application Support/Lila Modeler/estado.json`, and restored the next time the app
  opens (if the saved window no longer fits any connected screen, the default size is used).
- **File → Open recent** lists those projects (newest first) and reopens
  them with no dialog; if the folder no longer exists, it drops off the list and the app says so in
  the status bar. The native menu also carries **New project** (`⌘N`), **Open project…** (`⌘O`), **Save project**
  (`⌘S`), **Save as…** (`⇧⌘S`), and **Preferences…** (`⌘,`) in the app
  menu.

### Settings («Ajustes»)

- `⌘,` (or the ⚙ button in the bar, or «Tema: …» — Theme: … — in the status bar) opens **Ajustes →
  Apariencia** (Settings → Appearance): theme (Eva-01 dark, Papel light) and density
  (compacta/normal/cómoda — compact/normal/comfortable). The theme change is immediate, it repaints
  the diagram too, and it is remembered across launches (the app's localStorage, under `lila://`).
  Switching themes remounts the canvas, so it clears the undo stack; the diagram and any unsaved
  changes are kept.
- The per-token color editor and theme import/export is LILA-114 (#144), still pending.

## Limitations of this beta

*(as of 2026-09-07, SHA `358353d`; check whether any of these has already been resolved before
trusting this list blindly at a later date)*

- **No signing or notarization**: a received copy may require macOS's opening authorization (see
  above).
- **No custom icon** (issue #76): uses Electron's default icon.
- **Only macOS arm64 is built**: Windows (NSIS) and Linux (AppImage/deb) are configured in
  `electron-builder.yml` and in the CI matrix (`.github/workflows/desktop.yml`), but have not been
  built or tested on any real runner yet.
- **`.bpmn` double-click association untested** this round: `open-file`/`argv` handling is covered
  by unit tests and was verified by passing the path on the command line
  (`... npx electron apps/desktop "$(pwd)/examples/pedido/model.bpmn"`), but it was not exercised by
  actually double-clicking a `.bpmn` in Finder.
- **Raw error messages**: some errors reach the interface untranslated — `zod`'s raw validation
  JSON (for example, a scenario that references a nonexistent task id) and Electron's generic
  "Error invoking remote method…" text (for example, when saving into a folder with no
  permissions).
- **Visual calendar editor postponed**: `calendars` is edited with the same generic form fields as
  the rest of the scenario (numbers, text, lists of intervals); there is no drawn calendar/schedule
  view yet.
- **`Exportar CSV` (Export CSV) is only available in Results mode**, not in Compare.
- **No currency conversion or unit normalization across runs**: if scenarios with different
  `currency` or `baseTimeUnit` are compared, the app warns about it (see "Compare" above) instead of
  making up a conversion.
- **The MCP guide (stdio, `run_simulation`/`compare_scenarios`) is not part of this increment**: see
  `docs/MCP.md`, which belongs to a different work package (OP-17 increment 2, issues #56/#48).

## Rebuilding from source

From the repository root, in order:

```bash
npm ci                              # solo la primera vez, o si package-lock.json cambió
npm run build -w @lila/engine       # compila el motor de simulación (TypeScript)
npm run build -w @lila/web          # compila engine (si hiciera falta) + build de Vite
npm run dist:mac -w @lila/desktop   # tsc + copia dist/web + electron-builder --mac --arm64
```

The last command chains together: `apps/desktop`'s `tsc --build`, copying `apps/web/dist` to
`apps/desktop/dist/web`, and `electron-builder --mac --arm64`. The result lands in
`apps/desktop/release/` (current version in `apps/desktop/package.json`: `1.0.0-alpha.1`):

- `apps/desktop/release/Lila Modeler-1.0.0-alpha.1-mac-arm64.dmg` — the installer.
- `apps/desktop/release/Lila Modeler-1.0.0-alpha.1-mac-arm64.dmg.blockmap`.
- `apps/desktop/release/mac-arm64/Lila Modeler.app` — the app unpackaged from the DMG, useful for
  quick testing.
- `apps/desktop/release/ORIGEN.txt` — the build's `sha`, `fecha` (date, ISO), and `arch`
  (`uname -m`), written by `apps/desktop/scripts/origen.mjs` at the end of `dist:mac`.

If Vite is already running on the machine (for example `npm run dev -w @lila/web` from another
session), stop it before building `dist:mac`: the production build does not need it, and two
processes fighting over the same port only adds noise to the logs, though it does not break the
build itself (the final binary loads via the `lila://` protocol, not `http://localhost`).

To try the `.app` without generating the DMG (faster, useful in development):

```bash
npm run pack:mac -w @lila/desktop   # mismo build, pero --dir en vez de --mac
```

A minimal check that the package launches, without opening a window:

```bash
LILA_SMOKE=1 "apps/desktop/release/mac-arm64/Lila Modeler.app/Contents/MacOS/Lila Modeler"
```

Prints a JSON object (`lienzo`, `tema`, `fuente`, `puente`, `consoleErrors`, `loadFailure`, `ok` —
canvas, theme, font, and bridge, respectively) and exits with code 0 if everything loads fine; the
screenshot lands in a system temp folder (`$TMPDIR/lila-smoke/captura.png`, outside `app.asar`,
which is read-only inside the package).

## For agents/QA: the E2E seam

`apps/desktop/src/main.ts` accepts three environment variables meant **only for automated
testing** (for example, so a hands-off agent can drive native dialogs it could not otherwise
touch). They are not a public API and must never be used in normal use of the app:

- `LILA_E2E_FOLDER=<absolute path>`: makes `chooseFolder` return that path directly, without
  opening the native picker (it creates the folder if missing, and authorizes it just like the real
  dialog would). The literal value `"cancel"` simulates the user closing the picker without
  choosing anything.
- `LILA_E2E_CLOSE=save|discard|cancel`: makes the native "close with unsaved changes" dialog
  (Guardar/Descartar/Cancelar — Save/Discard/Cancel) resolve automatically with that value, instead
  of waiting for a click.
- `LILA_E2E_LOG=<file path>`: if present, appends one JSON line per relevant event
  (`chooseFolder`, `writeProject`, `closeRequested`, `openPath`) to that file.

With none of the three set, the app behaves exactly as if they did not exist. **Warning**: these
are a shortcut for testing, not something an end user should ever set — they leave the app
answering its own dialogs with no human involved.
