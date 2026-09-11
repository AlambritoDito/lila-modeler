# The Lila project format: the folder and the `.lila` file

A Lila project is a **folder** (ADR-018). A `.lila` file is that same folder **zipped**, with the
same layout and the same file names (ADR-027). The two are the same project in two containers:

```bash
cd pedido && zip -r ../pedido.lila .   # a valid .lila
unzip pedido.lila -d pedido            # a valid project folder
```

Nothing converts, migrates or rewrites in between. The folder is what you keep in git — it diffs
and merges, which is the whole reason it is the primary form. The `.lila` is what you hand to
somebody: one file to attach, download or double-click.

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
  "engine": "1.0.0-alpha.1"
}
```

`engine` is the only field the folder layout does not have: the version of `@lila/engine` that
wrote the runs in this archive. It is informational — readers record it and move on — and it is
deliberately not part of the in-memory document, so an open/save round-trip re-stamps it rather
than carrying somebody else's version forward.

## Versioning

`version` is `1`. Changes to this format may only **add optional fields**; anything that would
make a reader of version 1 misread a file takes a new `version`, and the reader of version 1
refuses it instead of guessing. There is no migration step and none is planned: the files are on
the user's disk, not in a database anybody controls.

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
validation, with stable error codes), `lila.ts` (`encodeLila`/`decodeLila` over `fflate`).
Published as `@lila/engine/project`. The folder reader/writer is
`apps/desktop/src/projectIO.ts`; the `.lila` half of the desktop is `apps/desktop/src/lilaFile.ts`.

The engine's codes are `LILA-ZIP`, `LILA-NO-MANIFEST`, `LILA-MANIFEST`, `LILA-NO-MODEL`,
`LILA-ENTRY-PATH` (the container) and `LILA-DOCUMENT`, `LILA-PROBLEMS`, `LILA-RUN`,
`LILA-RUN-INPUTS` (the document). Each front end words them itself: the desktop maps them to its
own `E-ZIP`, `E-NO-MANIFEST`, `E-MANIFEST`, `E-NO-MODEL`, `E-ENTRY-PATH`, `E-DOCUMENTO`,
`E-DIAGNOSTICO`, `E-CORRIDA`, `E-ENTRADAS-CORRIDA` at the IPC boundary (an explicit map in
`lilaFile.ts`, listed in the `bridge.ts` header); the web app localises them in
`apps/web/src/project.ts`. A `.lila` save runs the same `E-CARPETA-OCUPADA`/`E-CAMBIO-EXTERNO`
guards as a folder save.
