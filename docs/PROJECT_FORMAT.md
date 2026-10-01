# The Lila project format: the folder and the `.lila` file

> Read this in: [Español](es/PROJECT_FORMAT.md)

A Lila project is a **folder** (ADR-018). A `.lila` file is that same folder **zipped**, with the
same layout and the same file names (ADR-027). The two are the same project in two containers:

```bash
cd pedido && zip -r ../pedido.lila .   # a valid .lila
unzip pedido.lila -d pedido            # a valid project folder
```

Nothing converts, migrates or rewrites in between. The folder is what you keep in git — it diffs
and merges, which is the whole reason it is the primary form. The `.lila` is what you hand to
somebody: one file to attach, download or double-click.

A project can hold **several processes** (ADR-029, #498). With one, it is the version 1 layout
below, unchanged; with two or more, it is a version 2 *repository* where each process keeps that
same layout under `processes/<slug>/` (see [Version 2](#version-2-the-repository)).

## Layout

| Entry | What it is |
| --- | --- |
| `lila-project.json` | The manifest (below). Required in a `.lila`; optional in a folder, where it is reconstructed if missing. |
| `model.bpmn` | The BPMN XML, byte for byte. Required. |
| `<name>.scenario.json` | One raw scenario document per scenario, `extends` untouched — never resolved on the way in or out. The file name is the scenario's identity: that is what `extends` points at. |
| `runs/<id>.result.json` | One stored run: the engine's `RunResult` plus the inputs that produced it (`docs/RESULTS_FORMAT.md`). |

Entries are written in a canonical order — manifest, model, scenarios sorted by name, runs sorted
by id — with a fixed timestamp, so saving the same project twice produces identical bytes.

## The manifest

```json
{
  "version": 1,
  "id": "e2a1…",
  "name": "pedido",
  "model": { "id": "Process_Pedido", "name": "model.bpmn", "revision": 3 },
  "scenarioRevisions": { "as-is.scenario.json": 2, "to-be-3-cajeros.scenario.json": 1 },
  "engine": "1.0.0-beta.1"
}
```

`engine` is the only field the folder layout does not have: the version of `@lila-modeler/engine` that
wrote the runs in this archive. It is informational — readers record it and move on — and it is
deliberately not part of the in-memory document, so an open/save round-trip re-stamps it rather
than carrying somebody else's version forward.

## Version 2: the repository

A project with more than one process is written as version 2 (ADR-029). The manifest keeps its
name, `lila-project.json`, and lists the processes; each process is exactly the version 1 layout,
without a manifest of its own, in its folder:

```
lila-project.json              manifest, "version": 2
processes/<slug>/model.bpmn
processes/<slug>/<name>.scenario.json
processes/<slug>/runs/<id>.result.json
```

```json
{
  "version": 2,
  "id": "e2a1…",
  "name": "pedido",
  "processes": [
    { "slug": "pedido", "name": "Pedido",
      "model": { "id": "Process_Pedido", "name": "model.bpmn", "revision": 3 },
      "scenarioRevisions": { "as-is.scenario.json": 2 } },
    { "slug": "facturacion", "name": "Facturación",
      "model": { "id": "Process_Facturacion", "name": "model.bpmn", "revision": 1 },
      "scenarioRevisions": {} }
  ],
  "engine": "1.0.0"
}
```

- **The slug is the folder**: lowercase `a-z`, digits and hyphens, unique in the project, derived
  from the name when the process is created and never changed by a rename. `name` is what the
  canvas tab shows. The order of `processes` is the order of the tabs.
- **Version 2 is written only when it is needed.** While a project has one process it is saved as
  version 1, byte for byte, so the builds that only read version 1 keep opening it. Adding a second
  process writes version 2; deleting back to one writes version 1 again.
- **A version 1 project reads as a one-process repository**, folder and `.lila` alike. Nothing
  migrates: opening and saving it without changes gives back the same bytes.
- **The folder moves, it does not copy.** The first version 2 save of a version 1 *folder* moves
  the first process's `model.bpmn`, scenarios and runs from the root into `processes/<slug>/`, in
  the same all-or-nothing commit as the rest of the save. Going back to one process writes the root
  files again and leaves `processes/` on disk for you to remove. A deleted process's folder stays
  too, orphaned, and it never comes back: a new process never takes a slug that is listed on disk,
  that has a folder under `processes/`, or that was deleted in the session — «Cobro» becomes
  `cobro-2` — and the writer refuses (`E-CARPETA-OCUPADA`, deleting nothing) a new process whose
  folder already holds another one's scenarios or runs. The
  manifest is written after the process files, so a crash in the middle of that first save leaves
  the version 1 project intact.
- **Scenarios and runs are per process.** The simulation runs one process at a time — the one on
  the canvas — and a call activity is still a task with a time of its own; double-clicking one opens
  the process whose BPMN process id is its `calledElement`.
- **In the `.lila`**, anything outside the listed `processes/<slug>/` folders is reported and
  dropped, exactly like a stray file in a version 1 archive; a listed process without its
  `model.bpmn` is fatal (`LILA-NO-MODEL`).

## Versioning

`version` is `1` or `2`. Changes to this format may only **add optional fields**; anything that
would make a reader misread a file takes a new `version`, and the reader refuses it instead of
guessing — the current reader refuses a version 3 with `LILA-MANIFEST` (in the folder, `E-MANIFEST`).
There is no migration step and none is planned: the files are on the user's disk, not in a database
anybody controls.

A build that only reads version 1 (up to 1.0.0-beta.14) refuses a version 2 repository cleanly: it
looks for the root `model.bpmn` before it reads the manifest's version, so the refusal it gives is
«no model.bpmn» (`E-NO-MODEL` for a `.lila`, `E-SIN-MODELO` for a folder) — never a half-read project.

## What is tolerated, and what is not

Opening is tolerant where the format is loose and strict where it is not:

- A `*.scenario.json` may hold a **draft that does not validate yet** — that is the point of
  editing one. It only has to be a JSON object.
- An unreadable scenario or an invalid run is **excluded and explained** in the project's
  `problems`; it never aborts the opening. Losing a broken run should not cost you the project.
- A missing `lila-project.json` or a missing `model.bpmn` is **fatal**: there is no project.
- Entries with `..` segments, absolute paths, drive letters or backslashes are **refused
  outright** — a zip that carries one is not a project that lost a file.

**Anything not in the layout above is reported and dropped.** A `notes.md` or an `attachments/`
folder inside a `.lila` shows up in `problems` when you open it and is not written back when you
save. Preserving it would mean carrying opaque bytes through `structuredClone` (the desktop IPC
boundary) and `JSON.stringify` (the browser's `localStorage` mirror), neither of which survives a
`Uint8Array` honestly. In the **folder** form those files are simply left alone, because the
writer only touches the files it owns — so the place to keep notes and attachments today is the
folder, not the archive.

## MIME type and extension

The MIME type is `application/vnd.lila-modeler+zip`. It is not registered with IANA; it follows
the `+zip` structured-suffix convention (RFC 8081), so a client that knows nothing about Lila can
still tell it is a ZIP.

The `.lila` extension is not registered either. The only other use found is **LARSIM "LiLa"**, a
hydrological modelling format from the German water agencies, which has no registered MIME type
and no desktop file association — the collision is nominal and no tooling of ours or theirs can
mistake one for the other, since a Lila project starts with the ZIP magic `PK`.

## Where the code is

`packages/engine/src/project/` — `types.ts` (the document contract), `document.ts` (structural
validation, with stable error codes), `lila.ts` (`encodeLila`/`decodeLila` over `fflate`, and the
version 2 manifest), `repository.ts` (`processesOf`/`withProcesses`, which fold the list of processes
into the document: its top-level fields are the first process, and `process`/`processes` carry the
rest).
Published as `@lila-modeler/engine/project`, which stays browser-safe. The disk half is
`packages/engine/src/project-fs/`, published as `@lila-modeler/engine/project-fs` (Node only, #466):
the folder reader/writer `projectIO.ts`, the `.lila` file `lilaFile.ts`, and `input.ts`, which opens
one process of a `.lila` for the CLI and the MCP server and writes a scenario back. The desktop, the
CLI and the MCP server all use it.

The engine's codes are `LILA-ZIP`, `LILA-NO-MANIFEST`, `LILA-MANIFEST`, `LILA-NO-MODEL`,
`LILA-ENTRY-PATH` (the container) and `LILA-DOCUMENT`, `LILA-PROBLEMS`, `LILA-RUN`,
`LILA-RUN-INPUTS` (the document). Each front end words them itself: the desktop maps them to its
own `E-ZIP`, `E-NO-MANIFEST`, `E-MANIFEST`, `E-NO-MODEL`, `E-ENTRY-PATH`, `E-DOCUMENTO`,
`E-DIAGNOSTICO`, `E-CORRIDA`, `E-ENTRADAS-CORRIDA` at the IPC boundary (an explicit map in
`lilaFile.ts`, listed in the `bridge.ts` header); the web app localises them in
`apps/web/src/project.ts`. A `.lila` save runs the same `E-CARPETA-OCUPADA`/`E-CAMBIO-EXTERNO`
guards as a folder save, holding a `<file>.lila.lock` next to the archive while it checks and
writes, so writers in different processes (the desktop, the CLI, MCP servers) take turns; a writer
that cannot get the lock within 3 seconds refuses with `E-ARCHIVO-OCUPADO` (nothing is written). The
holder touches the lock every 2 seconds, so a lock untouched for 10 seconds is removed as left by a
crash; a writer only removes a lock whose token (a random id written into it) it has checked.
