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
same layout under `processes/<slug>/` (see [Version 2](#version-2-the-repository)). A repository
with catalog objects — roles, units, systems and documents — is version 3 (see
[Version 3](#version-3-the-catalog)), as [the repository contract](REPOSITORY_CONTRACT.md) defines
it. The rest of ADR-029 — maps, attachments, a per-object store — is not part of the format yet; the
[organizational roadmap](ROADMAP.md) says in what order it is planned.

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
  A version 2 manifest that lists a single process (written by another tool, or edited by hand) is
  still read as a repository: that process keeps its slug and name, and a process added later goes
  next to it instead of moving it to a new folder — until it is saved as a one-process project
  (version 1). From then on its slug and name come from the project's name again, so the slug can
  change. Adding a process keeps it version 2; any other save counts, the engine's included: once
  the CLI or the MCP server writes into such a `.lila` (a scenario, a saved run, an edited process)
  it is version 1, and an agent that still passes the old slug as `--process` (`process` in the MCP
  tools) gets «has no process». With a single process, leave `--process` out.
- **A version 1 project reads as a one-process repository**, folder and `.lila` alike. Nothing
  migrates: opening and saving it without changes gives back the same bytes.
- **The folder moves, it does not copy.** The first version 2 save of a version 1 *folder* moves
  the first process's `model.bpmn`, scenarios and runs from the root into `processes/<slug>/`, in
  the same all-or-nothing commit as the rest of the save. Going back to one process writes the root
  files again and leaves `processes/` on disk for you to remove. A deleted process's folder stays
  too, orphaned, and it never comes back: a new process never takes a slug that is listed on disk,
  that has a folder under `processes/`, or that was deleted in the session — «Cobro» becomes
  `cobro-2` — and the writer refuses (`E-CARPETA-OCUPADA`, deleting nothing) a new process whose
  folder already holds another one's scenarios or runs. A manifest edited by hand since the app
  read it (one that drops an open process, say) is refused as `E-CAMBIO-EXTERNO` first. The
  manifest is written after the process files, so a crash in the middle of that first save leaves
  the version 1 project intact.
- **Scenarios and runs are per process.** The simulation runs one process at a time — the one on
  the canvas — and a call activity is still a task with a time of its own; double-clicking one opens
  the process whose BPMN process id is its `calledElement`.
- **In the `.lila`**, anything outside the listed `processes/<slug>/` folders is reported and kept,
  exactly like a stray file in a version 1 archive (see [What is tolerated](#what-is-tolerated-and-what-is-not));
  a listed process without its `model.bpmn` is fatal (`LILA-NO-MODEL`).

## Version 3: the catalog

A repository with catalog objects is written as version 3 ([the repository
contract](REPOSITORY_CONTRACT.md) § 1–2, ADR-032). It is the version 2 layout plus one JSON file per
object, and an id for each process in the manifest:

```
lila-project.json              manifest, "version": 3
processes/<slug>/…             as in version 2
catalog/<type>/<id>.json       one file per catalog object
```

```json
{
  "version": 3,
  "id": "e2a1…",
  "name": "Hotel",
  "processes": [
    { "id": "process-4k9w2m7q1z8c", "slug": "front-desk", "name": "Front desk",
      "model": { "id": "Process_FrontDesk", "name": "model.bpmn", "revision": 2 },
      "scenarioRevisions": { "as-is.scenario.json": 1 } }
  ],
  "engine": "1.0.0"
}
```

```json
{
  "type": "role",
  "id": "role-7k2m9q4x1pzd",
  "name": "Receptionist",
  "description": "Welcomes guests.",
  "revision": 2,
  "unitRef": "unit-b3r8w1c6k0qe"
}
```

- **Objects.** Every object has `type`, `id`, `name` (not empty), `revision` (an integer, at least 1)
  and optionally `description` and `attributes` (a list of `{ "name", "value" }` text pairs). The
  types of this version are `role` (`unitRef`), `unit` (`parentRef`), `system` (`ownerRef`, `url`)
  and `document` (`ownerRef`, `url`); a `url` is an `http`/`https` address that is shown as a link
  and never fetched. Attachments are not part of this version. Fields this version does not know
  are kept, in their order. Objects of a type it does not know (`risk`, `control`, `kpi`…) are read
  with their envelope checked and every field kept, as read-only objects. A file is written with
  two-space indentation and a final newline; an object nobody changed keeps the bytes it was read
  with wherever those bytes travel (every save of the engine, the CLI, the MCP server and the
  desktop, and the web app until a reload), and is otherwise rewritten with the same fields.
- **Ids.** A new object's id is `<type>-<12 characters of [0-9a-z]>`, random; every id matches
  `^[a-z0-9][a-z0-9-]{0,63}$`, never changes and never comes from the name. A reference typed by
  hand before the catalog existed (`rol-1`) can become an object with that very id when it matches
  the grammar and is not a name Windows refuses (`con`, `nul`…). Ids are unique across the whole
  catalog; the same id under two types (a hand edit, a merge) loads both and is reported.
- **Process ids.** Each process of a version 3 manifest has an `id`, `process-<12 characters of
  [0-9a-z]>`: its storage identity in the repository. A version 1 or 2 project gets fresh ones when
  it becomes version 3; they are written only in a version 3 manifest. `--process` (`process` in the
  MCP tools) still takes the slug.
- **Version 3 is written when it is needed, and then it stays.** The first catalog object makes the
  project version 3; removing the last one keeps it version 3, with its process ids. A version 3
  project with a single process stays in `processes/<slug>/` instead of going back to version 1, so
  its slug never changes under an agent. A catalog object or a reserved name (below) found in a
  version 1 or 2 archive — added by hand or by another tool — is read, and the next save writes
  version 3.
- **A broken object** — not JSON, a required field missing, or a `type`/`id` that disagrees with
  its path — is excluded and explained in `problems`, and kept byte for byte: other objects may
  point at it, and fixing it by hand must not cost it.
- **`limits`**, the manifest's optional attachment limits, are written back as found; an invalid
  member is reported in `problems`.
- **Older builds refuse it cleanly**: 1.0.0-beta.15 up to beta.28 with `LILA-MANIFEST` («declares
  version 3»), and the builds that only read version 1 with «no model.bpmn».
- **Only as a `.lila` for now.** The folder form of version 3 is not written yet (#671): the folder
  reader refuses a version 3 manifest (`E-MANIFEST`) and the desktop refuses to save a version 3
  project as a folder (`E-DOCUMENTO`) instead of dropping its catalog.

Entries are written manifest, processes (as in version 2), catalog objects sorted by type and then
id, and last the entries kept as they were (below) sorted by name, with the same fixed timestamp:
two saves of the same repository are still the same bytes.

## Versioning

`version` is `1`, `2` or `3`. Changes to this format may only **add optional fields**; anything that
would make a reader misread a file takes a new `version`, and the reader refuses it instead of
guessing — the current reader refuses a version 4 with `LILA-MANIFEST`, and the folder reader still
refuses version 3 with `E-MANIFEST` until it learns it (#671).
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

**Anything not in the layout above is kept, not dropped**, in every version ([the repository
contract](REPOSITORY_CONTRACT.md) § 1.4):

- A `notes.md` inside a `.lila` shows up in `problems` as «not understood by this version; kept as
  is», and every save writes it back byte for byte — the app's, the CLI's and the MCP server's.
- The names reserved for later phases — `maps/`, `analysis/`, `dashboards/`, `records/`,
  `attachments/` and `processes/<slug>/process.json` — are kept without a report, and make the
  repository version 3.
- Operating-system litter (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) and the writers' own leftovers
  (`*.tmp-*`, `*.prev-*`, `*.lock`) are dropped without a report.
- The kept entries of a process deleted in the session leave with it, except when the project goes
  back to version 1, which keeps them as the folder keeps an old `processes/` folder. Entries under
  a `processes/<slug>/` the manifest does not list are an orphaned folder, and are kept; a save that
  would give its slug to a process while it holds a `model.bpmn`, a scenario or a run is refused
  (`LILA-ENTRY-PATH`) rather than reading them back as that process's.

They are kept **beside** the document, never inside it: the document is what crosses the desktop
IPC boundary (`structuredClone`) and goes into the browser's `localStorage` mirror
(`JSON.stringify`), and neither carries bytes honestly. So:

- **The engine, the CLI and the MCP server** write back the entries of the `.lila` they overwrite,
  read inside its `.lila.lock` (`writeLilaFile`), so every agent write carries them.
- **The desktop** does the same when it saves over the file it opened; «Save as» starts a new copy
  without them. Its autosave copy (`recovery.lila`) does not hold them for a file the desktop opened:
  they stay in that file.
- **The web app** keeps them in memory for the file it opened and writes them on every save to a
  file. The `localStorage` copy that brings the session back after a reload cannot hold them, so
  opening such a file shows a warning that automatic recovery will not include them.
- **The catalog** is part of the document, so it always travels: saves, autosave, recovery and every
  agent write.

In the **folder** form those files are simply left alone, as before, because the writer only touches
the files it owns.

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
validation, with stable error codes), `lila.ts` (`encodeLila`/`decodeLila` over `fflate`, the
version 2 and 3 manifests, and `decodeLilaArchive`, which also returns the entries kept beside the
document), `repository.ts` (`processesOf`/`withProcesses`, which fold the list of processes
into the document: its top-level fields are the first process, and `process`/`processes` carry the
rest), `catalog.ts` (catalog objects and ids: `newCatalogId`, `newProcessId`, `isCatalogId`,
`isAdoptableId`) and `upgrade.ts` (`formatVersionOf`, `upgradesToVersion3`, `asVersion3`,
`withCatalog`: which version a document is written as, and the one-way step to version 3).
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
