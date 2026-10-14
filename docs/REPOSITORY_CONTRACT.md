# The repository contract (RM-01): catalog objects, identity and per-object storage

> Read this in: [Español](es/REPOSITORY_CONTRACT.md).

**Status:** accepted on 2026-10-14 (ADR-032); the contract for lot A1 (catalog, per-object store,
selectors, explorer). Nothing
in this document is implemented yet unless it says "today". It extends
[the project format](PROJECT_FORMAT.md) (versions 1 and 2, which stay exactly as they are) and
settles what [ADR-029](DECISIONS.md) left open: the version 3 layout, object identity, references,
the storage interface, attachments, failure recovery and performance budgets. Section 10 records
the owner's decisions on the product questions. The delivery order is in the [roadmap](ROADMAP.md).

The words **must**, **must not** and **may** are normative. "The app" means the web app and the
desktop app alike; "the engine" means `@lila-modeler/engine` (and through it the CLI and the MCP
server).

## 1. Layout and manifest

### 1.1 The version 3 layout

A repository that has at least one catalog object or attachment is written as **version 3**. It is
the version 2 layout plus two directories:

```
lila-project.json                    manifest, "version": 3
processes/<slug>/model.bpmn          as in version 2, unchanged
processes/<slug>/<name>.scenario.json
processes/<slug>/runs/<id>.result.json
catalog/<type>/<id>.json             one file per catalog object (section 2)
attachments/<sha256>[.<ext>]         file bytes of document objects (section 6)
```

Reserved names, **not written by A1**: `maps/` (process maps, phase 3), `analysis/`,
`dashboards/`, `records/` (ADR-029) and `processes/<slug>/process.json` (owner and release status
of a process). Their schemas belong to later contracts. An A1 reader preserves them (§ 1.4).

`attachments/` is not in ADR-029's sketch. The name is the one `docs/PROJECT_FORMAT.md` already
uses as the example of a folder that is dropped today; it is kept apart from `catalog/` because its
entries are binary, immutable and content-addressed, while catalog entries are small, editable
JSON. Putting the bytes next to the document object (`catalog/document/<id>.bin`) would make a
rename of the bytes a catalog edit and prevent deduplication.

### 1.2 The version 3 manifest

```json
{
  "version": 3,
  "id": "6f1c2d4e-0b7a-4c55-9a51-3e2f8d7b9c10",
  "name": "Example Corp",
  "processes": [
    { "id": "process-4k9w2m7q1z8c", "slug": "orders", "name": "Orders",
      "model": { "id": "Process_Orders", "name": "model.bpmn", "revision": 3 },
      "scenarioRevisions": { "as-is.scenario.json": 2 } },
    { "id": "process-p0x3n8d2r5ta", "slug": "invoicing", "name": "Invoicing",
      "model": { "id": "Process_Invoicing", "name": "model.bpmn", "revision": 1 },
      "scenarioRevisions": {} }
  ],
  "engine": "1.0.0"
}
```

It is the version 2 manifest (`RepositoryManifest` in `packages/engine/src/project/lila.ts`) with
one addition: each process has an **`id`**, its stable identity (§ 3.2). Nothing else is listed:
catalog objects and attachments are discovered by listing their directories, and the id → file
index is derived on open, as ADR-029 requires. Putting the catalog in the manifest would make every
object edit touch the one file every other edit also touches, which is exactly the merge conflict
that one file per object is meant to avoid.

**Optional `limits`.** A repository may change the attachment limits of § 6 for itself:

```json
"limits": { "attachmentBytes": 52428800, "repositoryBytes": 524288000 }
```

- `attachmentBytes` is the largest attachment that may be added; `repositoryBytes` is the largest
  total of all attachment entries of the repository. Both are optional; a missing member, or a
  missing `limits`, means the default: 20 MB (20,971,520 bytes) and 200 MB (209,715,200 bytes).
- Each member must be a positive integer no larger than `Number.MAX_SAFE_INTEGER`. An invalid value
  is reported in `problems`, the default applies, and the value is written back as found until
  someone sets a valid one; the manifest is still read.
- The app changes it from the repository's settings. Larger limits are the repository's choice:
  they make saving a `.lila` slower and the browser heavier, and the budgets of § 9 are measured with
  the defaults.
- **Lowering a limit never removes anything.** Attachments already in the repository stay, open and
  save as before in both containers; only adding a new attachment that would exceed a limit is
  refused (`E-ADJUNTO`).

### 1.3 Which version is written

| The repository has | Written as |
| --- | --- |
| One process, nothing that needs version 3 | Version 1, byte for byte as today (plus unknown entries now preserved, § 1.4) |
| Two or more processes, nothing that needs version 3 | Version 2, as today (plus unknown entries now preserved, § 1.4) |
| Any catalog object, attachment or `limits` member, or any entry under a reserved name of § 1.1 (`maps/`, `analysis/`, `dashboards/`, `records/`, `processes/<slug>/process.json`), **or it was read as version 3** | Version 3 |

- **Version 3 is written only when needed, and then it stays.** Unlike the version 2 → version 1
  step of `docs/PROJECT_FORMAT.md` (#517), a repository read as version 3 is saved as version 3
  even if its last object is deleted. Going back would drop the process ids that other entries
  (future maps, records, or a newer build's preserved files) point at, and would let the slug of a
  lone process change again — the `--process` surprise `PROJECT_FORMAT.md` documents for version
  2. The only way back is an explicit export, which A1 does not need to offer.
- **Upgrading writes the process ids.** A version 1 or 2 repository has no process ids. When it is
  opened, each process gets a fresh one in memory (nothing persisted can point at it yet), and the
  first version 3 save writes it. A version 1 *folder* moves its root files into
  `processes/<slug>/` in the same all-or-nothing commit that version 2 uses today (#498).
- **Catalog and attachments are read whatever the manifest says.** A version 1 or 2 repository
  written by Lila never has them; if one does (added by hand or another tool), it is loaded, and
  the next save writes version 3.

### 1.4 Older readers and unknown entries

Older builds refuse version 3 cleanly, with one exception below; nothing has to change in them:

- Builds that read versions 1 and 2 (1.0.0-beta.15 up to today) refuse any `version` above 2:
  `decodeLila` peeks at the manifest before looking for a model and throws `LILA-MANIFEST`
  ("declares version 3; this reader understands versions 1 and 2"), and the folder reader
  (`readRepositoryManifestOf` in `packages/engine/src/project-fs/projectIO.ts`) throws
  `E-MANIFEST`. They never get to drop the catalog on a save.
- Builds that only read version 1 (up to 1.0.0-beta.14) refuse it as they refuse version 2: no root
  `model.bpmn` (`LILA-NO-MODEL`, shown as `E-NO-MODEL` on the desktop; `E-SIN-MODELO` for a folder).
- The exception: in builds 1.0.0-beta.15 to beta.26, `isRepositoryProcessFolder` (`projectIO.ts`)
  swallows the `E-MANIFEST` of a version 3 parent. Opening a version 3 repository's
  `processes/<slug>/` folder (or its `model.bpmn`) directly therefore reads it as a standalone
  version 1 project, and saving it may write a nested `processes/<slug>/lila-project.json`. The
  repository itself is not damaged; A1 reports such a nested `lila-project.json` as an unknown entry
  and keeps it as is.

**Unknown entries are preserved, no longer dropped.** Today an archive entry outside the layout is
reported and not written back (`decodeLila`, `decodeRepository`), because its bytes could not
travel through `structuredClone` and the `localStorage` mirror. Under this contract the bytes no
longer travel there (§ 5), so a build that implements it, for **every** version:

- keeps each safe entry it does not interpret byte for byte and writes it back unchanged, in the
  archive as in the folder (where the writer already leaves foreign files alone);
- reports it in `problems` as "not understood by this version; kept as is", **except** entries
  under the reserved names of § 1.1 and catalog files of unknown types (§ 2.4), which are expected
  and kept silently;
- drops operating-system litter without a report: `__MACOSX/`, `.DS_Store`, `Thumbs.db`, and the
  writer's own leftovers `*.tmp-*`, `*.prev-*`, `*.lock`;
- still refuses unsafe entry names (`LILA-ENTRY-PATH`), as today;
- removes the entries of a process deleted in the session; entries under a `processes/<slug>/`
  that the manifest does not list are an orphaned folder, kept and counted as an occupied slug, as
  in the folder form today (`occupiedSlugs`).

This is what lets later phases add `maps/` or `process.json` **without a new version**: a version 3
reader that does not understand them keeps them. A later addition takes a new `version` only if an
older reader editing around it would corrupt it — the rule of `PROJECT_FORMAT.md` § Versioning
("anything that would make a reader misread a file takes a new version") is unchanged.
Anything a later phase writes must force version 3, so no reader that drops it can open the file:
builds 1.0.0-beta.15 to beta.26 drop unknown entries when they save a `.lila` (`decodeLila`,
`decodeRepository`).

### 1.5 Canonical order

Entries are written manifest, processes (as today), catalog objects sorted by type then id,
attachments sorted by name, preserved entries sorted by name, with the fixed timestamp of
`encodeLila`. Attachments are stored without compression (level 0): they are usually compressed
already, and stored entries can be copied cheaply on every save. Two saves of the same repository
still produce identical bytes.

## 2. Catalog objects

### 2.1 Envelope

Every object is one JSON file `catalog/<type>/<id>.json`, written with two-space indentation and a
final newline, like scenarios:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | string | yes | The type token; must equal the `<type>` folder. |
| `id` | string | yes | The identity (§ 2.3); must equal the file name without `.json`. |
| `name` | string | yes | What the UI shows. Not empty after trimming. Not a key, not unique. |
| `description` | string | no | Plain text. |
| `revision` | integer ≥ 1 | yes | 1 at creation, +1 on each write that changes the content (§ 5.4). |
| `attributes` | array of `{ "name": string, "value": string }` | no | Free extended attributes, in order. |
| *type fields* | — | no | § 2.2. |

- **Writers preserve fields they do not know**, in their original order after the known ones, so a
  newer build's additions survive an older build's edit. Known fields come first, in the order of
  the tables.
- **No timestamps and no owner in the envelope.** `createdAt`, `updatedAt` and `createdBy` are
  reserved for server mode (phase 7), where an authenticated history exists; locally, git and the
  file system already say when a file changed, and a timestamp written on every edit would make
  identical edits produce different bytes. Ownership is a type field where it means something.
- **Typed extended attributes are later.** The BPMN's `lila:attributeDefinition`
  (`docs/BPMN_EXTENSION.md`, #509) defines attributes per element type inside one model; a
  repository-wide registry of types, attributes and relations is a phase 6 contract. Until then,
  `attributes` are text pairs the explorer shows and edits as they are.

### 2.2 Types for lot A1

| Type | Extra fields | Notes |
| --- | --- | --- |
| `role` | `unitRef?`: unit id | A responsibility in RACI (`lila:responsibility roleRef`). Never creates simulation capacity: linking a role to a simulation resource pool is a later, explicit relation. |
| `unit` | `parentRef?`: unit id | Organizational unit. The hierarchy is `parentRef`; a cycle is reported and displayed broken at the repeated unit. |
| `system` | `ownerRef?`: role id; `url?`: `http`/`https` URL | Application or IT system (`lila:systemRef`). The URL is shown as a link and never fetched. |
| `document` | `ownerRef?`: role id; `url?`; `attachment?`: § 6 | Document or data (`lila:documentRef`, `lila:input`, `lila:output`). |

Ownership points at a role, not at a person or a unit: a responsibility is held by a role, and the
role's unit gives the department. Persons and positions come later. Document control fields
(code, version, status) wait for phase 7 governance (§ 2.5, § 10).

Examples (synthetic data, [examples policy](EXAMPLES_POLICY.md)):

```json
{
  "type": "role",
  "id": "role-7k2m9q4x1pzd",
  "name": "Credit analyst",
  "description": "Reviews applications against the lending policy.",
  "revision": 2,
  "unitRef": "unit-b3r8w1c6k0qe"
}
```

```json
{
  "type": "document",
  "id": "document-x9d2k7m4q1wa",
  "name": "Credit application form",
  "revision": 1,
  "ownerRef": "role-7k2m9q4x1pzd",
  "attributes": [{ "name": "Retention", "value": "5 years" }],
  "attachment": {
    "file": "attachments/9b74c9897bac770ffc029102a200c5de1b8b2c3a4f5e6d7c8b9a0f1e2d3c4b5a.pdf",
    "name": "Application form.pdf",
    "mediaType": "application/pdf",
    "size": 48213,
    "sha256": "9b74c9897bac770ffc029102a200c5de1b8b2c3a4f5e6d7c8b9a0f1e2d3c4b5a"
  }
}
```

### 2.3 Identity of objects

- **Grammar:** `^[a-z0-9][a-z0-9-]{0,63}$` — the process-slug grammar of `isProcessSlug`
  (`packages/engine/src/project/repository.ts`). Lowercase only, because macOS and Windows file
  systems are case-insensitive by default and the id is a file name; a safe ZIP entry name by
  construction.
- **Generated ids:** `<type>-<12 characters of [0-9a-z]>`, from `crypto.getRandomValues` (available
  in the browser and in Node). 62 bits make an accidental collision between two repositories
  negligible, which is what keeps imports simple (§ 3.5). The prefix makes a bare id readable in
  BPMN XML and in diffs. Today's id generators are not reused: BPMN's `newId` is a deterministic
  counter (`Task_2`), right inside one model but colliding across repositories, and the
  `Attr_<7 random>` of `apps/web/src/AtributosExtendidos.tsx` is too short for a repository-wide
  namespace.
- **Adopted ids:** a reference typed by hand before the catalog existed (`rol-1`, `sys-crm` in
  `docs/BPMN_EXTENSION.md`) may become an object with that very id when it matches the grammar and
  is not a reserved Windows name (`con`, `nul`, `com1`…, which `processSlug` already avoids). Then
  no BPMN is rewritten. A value that does not match (`Credit Analyst`) gets a generated id, and every
  reference to it in every process is rewritten in the same undoable command.
- **Never derived from the name and never changed.** A rename changes `name` only. Two objects may
  share a name; the UI warns when a new name repeats one of the same type, nothing more.
- **Unique across the whole catalog**, not just within a type, so a reference never needs the type
  to be unambiguous. Writers never create a duplicate. A reader that finds the same id under two
  types (a hand edit, a merge) loads both, reports it, and resolves each typed reference against
  the type the reference expects.

### 2.4 Reading rules

- Only `catalog/<type>/<name>.json` one level deep is an object; `<type>` matches
  `^[a-z][a-z0-9-]{0,31}$`. Leftover `.tmp-*`/`.prev-*` files do not end in `.json` and are never
  read as objects.
- A file that is not JSON, lacks a required field, or whose `type`/`id` disagree with its path is
  **excluded and explained** in `problems` and **kept byte for byte** — never rewritten, never
  deleted by a save. Unlike a broken scenario in an archive today, a broken object is not dropped:
  other objects may refer to it, and fixing a file by hand must not cost it.
- **Objects of types this build does not know** (`risk`, `control`, `kpi`…) are loaded with the
  envelope only, read-only: they appear in the explorer and resolve references (`lila:riskRef`), and
  their files are preserved untouched.

### 2.5 Reserved types

Listed so A1 does not take their names; their fields belong to later contracts: `position`,
`person`, `risk`, `control`, `control-objective`, `requirement`, `kpi`, `product`, `partner`,
`resource`, `cost-centre`, `goal`, `initiative`. Reserved `document` fields, for phase 7
document control: `code`, `version`, `status`; A1 writers do not create them and preserve them like
any unknown field.

## 3. References

### 3.1 From BPMN to the catalog

The BPMN extension does not change. The attributes that exist today
(`packages/engine/src/bpmn/annotate.ts`, `REF_KINDS` and `Responsibility`) hold a **catalog id**:

| BPMN | Expected type |
| --- | --- |
| `lila:responsibility type="R\|A\|C\|I" roleRef` | `role` |
| `lila:systemRef ref` | `system` |
| `lila:documentRef ref`, `lila:input ref`, `lila:output ref` | `document` |
| `lila:riskRef ref`, `lila:controlRef ref`, `lila:kpiRef ref` | `risk`, `control`, `kpi` (reserved) |

The BPMN never stores a catalog object's name or any other copy of its fields. The process
document (Word/HTML) and every view resolve names when they render. Today the properties panel
(`apps/web/src/PropertiesPanel.tsx`) takes these ids as typed text; A1 replaces the text field
with a selector that writes the same attribute.

Catalog fields that point at other objects (`unitRef`, `parentRef`, `ownerRef`) hold a bare id of
the type the field expects, under the same rules.

### 3.2 Process identity

The stable identity of a process is the manifest's `processes[].id` (§ 1.2), generated as
`process-<12 characters of [0-9a-z]>`. It is neither of the two keys that exist today:

- **Not the slug.** The slug is a folder name, and paths are never keys (ADR-029). It already
  changes in one documented case (a lone version 2 process saved as version 1), and an imported
  process must take a new slug when its own is taken.
- **Not the BPMN process id** (`model.id`). Users can edit it (ids behind «Advanced», #447), and
  imported models collide on it (`Process_1`). New models get a random one (`newModelXml` in
  `apps/web/src/project.ts`), but nothing guarantees uniqueness across a repository.

This refines ADR-012 without replacing it. ADR-012's key, `bpmn:process@id` plus `lila:versionTag`
(`docs/BPMN_EXTENSION.md` § 3), is the **logical** identity of a business process across tools,
files and versions — and ADR-012 itself expects two versions of one process to share
`process@id`. That is exactly why it cannot address one stored model inside a repository, where
both versions may live side by side (phase 7). The process id is the **storage** identity of one
model in one repository; the logical key stays what interchange, imports and the future version
context (§ 3.3) use.

A call activity keeps naming its target by BPMN process id in `calledElement`, the standard
attribute. Today (#461) the first other process that declares that id wins (`findIndex` in
`apps/web/src/App.tsx`); A1 changes that: two processes declaring the same BPMN process id are
reported as an ambiguity, not resolved by guess.

### 3.3 References to an element of another model

Wherever a repository document points at an element of a process (a map node, a risk on an
activity, a record — all later phases), it writes:

```json
{ "process": "process-4k9w2m7q1z8c", "element": "Task_7f3k2q1" }
```

`process` is the process id; `element` is the BPMN element id, which BPMN already never regenerates
(`docs/BPMN_EXTENSION.md` § 3). A reference to the process itself omits `element`. Equal element
ids in two processes never merge, because the pair is the key. A `version` member is reserved for
release identity (phase 7); without it, the reference means the working version. Names and paths
are never written into a reference.

### 3.4 Unresolved references, rename, delete

- **Unresolved references are kept and shown, never invented.** A reference whose id matches no
  object stays in the file as it is. The UI shows it as unresolved, with the id, and offers to
  create an object for it (adopting the id per § 2.3) — only when the user asks. Lint reports it as
  a warning (as `docs/BPMN_EXTENSION.md` promises), and only in a repository that has a catalog: a
  version 1 or 2 project has none to check against, and its typed ids are shown without warnings.
- **Rename** writes one file, the object's. Nothing else changes, because nothing else holds the
  name.
- **Deleting an object in use is refused** with the list of its uses (§ 4), and two explicit
  alternatives are offered: *replace with* another object of the same type (every reference is
  rewritten, then the object is deleted) or *remove the references and delete*. Each is one
  undoable command across every affected process and object. The app never leaves unresolved
  references behind on purpose. Agents get the same rule (§ 8): the deletion fails with
  `E-OBJETO-EN-USO` unless the caller says `replaceWith` or `removeReferences`.
- Uses inside entries this build preserves but does not understand (a newer build's `maps/`) are
  not visible to it. Deleting such an object leaves those references unresolved, and the build that
  understands them shows them as such. That is accepted: the alternative is refusing every delete.

### 3.5 Importing

- **A BPMN file** imported as a process keeps its `lila:` references verbatim; they resolve against
  this repository's catalog or show as unresolved. Nothing is created automatically.
- **A process or repository from another repository**: each imported process gets a new process id
  (always, so a copy of a copy never collides) and a free slug (`processSlug`). Its BPMN element ids
  are not touched. Catalog objects it references come with it:
  - same id, same type, identical content: one object;
  - same id with different content: a conflict the user settles per object — *keep this
    repository's object* (incoming references point at it) or *import as a new object* (new id,
    incoming references rewritten);
  - objects are **never matched by name**. An import dialog may suggest name matches; only the user
    turns a suggestion into a replacement.

## 4. The usage index ("where used")

The index is **derived, never persisted** in the repository: a persisted copy would go stale with
every git merge or hand edit, and rebuilding is cheap enough (§ 9).

It maps each `(type, id)` to its uses, in process order and then document order:

- `{ "process": <process id>, "element": <BPMN id>, "relation": "responsibility:R" | "systemRef" |
  "documentRef" | "input" | "output" | "riskRef" | "controlRef" | "kpiRef" }`;
- `{ "object": <type>/<id>, "field": "unitRef" | "parentRef" | "ownerRef" }`.

It also lists every unresolved reference (same shape, plus the missing id) and the BPMN process ids
declared by more than one process.

It is built after open, in the background (a worker in the web app), from every process's model
and the catalog, by a pure engine function, so the app, the CLI and the MCP server answer "where
used" identically. Editing a process re-scans that process only; editing an object re-scans that
object only. Until the first build finishes, usage counts show as pending, never as zero. If the
budget of § 9 is not met, the fallback is a cache **outside** the repository (the app's data
folder, keyed by each model's content hash), never a file inside it.

## 5. Storage and revisions

### 5.1 What loads when

| Part | Loaded | Required in A1 |
| --- | --- | --- |
| Manifest, process list | On open | Yes |
| Catalog objects (all types, whole objects) | On open: small, and selectors and search need them all | Yes |
| Process model and scenarios | When its tab opens; models of all processes are also read in the background by the usage index | May stay eager until the budget of § 9 fails |
| Stored runs | Listed by summary (id, scenario, revisions) on process open; the `RunResult` when shown | Before performance acceptance |
| Attachment bytes | Only when opened, exported or copied to another container | Yes |
| Preserved unknown entries | Never parsed; their bytes stay where the container is held (§ 5.3) | Yes |

A1 may keep whole-document IPC and whole-repository autosave with attachment bytes excluded (staged
by hash); per-object IPC and change-set recovery are adopted only when the § 9 budgets fail, as this
table already allows for models. What A1 must not do is put attachment bytes or preserved entries
in the document that crosses IPC or reaches the browser's storage.

### 5.2 Interface sketch

This is a sketch for A1 to implement, not code that exists. It replaces the six-method `ProjectStore`
of `apps/web/src/store/ProjectStore.ts` and, in `ProjectSessionStore`, `openProject`/`saveProject`/
`createProject`/`openRecent`/`openHandle`/`reload` (which return a head instead of a
`ProjectDocument`) and the synchronous `restoreSession` (async, read from IndexedDB); `setDirty`,
`listRecents`, `onExternalChange`, `forget`, `importBpmn`, `occupiedSlugs`, `undoOpen` and
`onSaveRequested` stay.

```ts
type CatalogType = string; // 'role' | 'unit' | 'system' | 'document' | a type this build does not know

interface CatalogObject {
  readonly type: CatalogType;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly revision: number;
  readonly attributes?: readonly { readonly name: string; readonly value: string }[];
  readonly [field: string]: unknown; // type fields and fields this build does not know
}

interface ProcessHead {
  readonly id: string;     // process id (§ 3.2)
  readonly slug: string;
  readonly name: string;
  readonly modelId: string;
  readonly modelRevision: number;
}

interface RepositoryHead {
  readonly version: 1 | 2 | 3;              // as read
  readonly id: string;
  readonly name: string;
  readonly processes: readonly ProcessHead[];
  readonly objects: readonly CatalogObject[];
  readonly problems: readonly ProjectProblem[];
}

interface RunSummary {
  readonly id: string;
  readonly scenarioName: string;
  readonly modelRevision: number;
  readonly scenarioRevision: number;
}

interface LoadedProcess {
  readonly model: ProjectModel;                 // packages/engine/src/project/types.ts
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  readonly runs: readonly RunSummary[];
}

/** One save: only what changed. `null` deletes. */
interface ChangeSet {
  readonly name?: string;
  readonly processes?: readonly ProcessHead[];  // the new list and order, when it changed
  readonly models?: Readonly<Record<string, { readonly xml: string; readonly baseRevision: number }>>;
  readonly scenarios?: Readonly<Record<string, Readonly<Record<string, ScenarioDocument | null>>>>;
  readonly runs?: Readonly<Record<string, readonly StoredRun[]>>;          // new runs only
  readonly objects?: readonly {
    readonly type: CatalogType;
    readonly id: string;
    readonly object: CatalogObject | null;
    readonly baseRevision: number | null;     // null: the object is new
  }[];
  readonly attachments?: readonly string[];   // staged sha256s that this save makes permanent
}

interface RepositoryStore {
  open(options?: { readonly fileOnly?: boolean }): Promise<RepositoryHead | null>; // null: cancelled
  readProcess(processId: string): Promise<LoadedProcess>;
  readRun(processId: string, runId: string): Promise<StoredRun>;
  readAttachment(sha256: string): Promise<Uint8Array>;    // verified against its hash (§ 6)
  stageAttachment(source: AttachmentSource): Promise<AttachmentRef>; // § 6; bytes kept until commit or discard
  commit(changes: ChangeSet, options?: { readonly saveAs?: boolean; readonly asFolder?: boolean; readonly overwrite?: boolean }):
    Promise<RepositoryHead | null>;
}
```

`commit` is the explicit Save the app has today (the dirty flag, ⌘S, the close guard); it is not a
write-through on every keystroke. It writes only the entries the change set touches, and it decides
the version (§ 1.3). Revisions of models and scenarios work as today (`model.revision` and
`scenarioRevisions` in the manifest, which runs use to tell stale results); object revisions live in
the object file (§ 2.1).

### 5.3 How each adapter satisfies it

- **Folder** (desktop main process, `packages/engine/src/project-fs/projectIO.ts`). `open` reads the
  manifest and lists `catalog/`; everything else is read on demand. `commit` writes the touched files
  only, through the existing `commitWithRollback` (§ 7). Untouched files, including preserved and
  foreign ones, are never opened.
- **Archive** (`.lila`: desktop main process, CLI and MCP through `lilaFile.ts`/`input.ts`; the
  browser for its own copy). `open` reads the ZIP directory and inflates the manifest and the
  catalog; other entries are inflated on demand (`fflate`'s `unzipSync` takes a filter). The holder
  keeps the archive's bytes, so `commit` builds the new archive from the changed entries plus every
  untouched entry with its content kept byte for byte (attachments are stored, so they are not
  recompressed), under the existing
  `.lila.lock`. The engine codec gains this shape: the document it decodes no longer drops what it
  does not interpret; it keeps those entries' bytes beside the document, never inside it, and
  `encodeLila` writes them back. Today `writeLilaScenario` and every agent write re-encode the
  whole document; with this change they carry the catalog, attachments and preserved entries through
  unchanged without knowing about them.
- **Desktop IPC** (`apps/desktop/src/bridge.ts`, `main.ts`). The main process holds the open
  container (path, snapshots and, for an archive, its bytes). In the target design the renderer asks
  for the head, a process, a run or an attachment, and sends change sets, so the whole repository
  never crosses IPC; A1 may still send the whole document both ways, without attachment bytes or
  preserved entries (§ 5.1).
  Every handler keeps today's guards (`isTrustedSender` in `ipcGuards.ts`, the authorized path), and
  arguments are layout identities — process ids, `<type>/<id>`, sha256 — validated against their
  grammar, never free paths. An attachment added from disk is read by the main process from the
  path the native dialog returned (`stageAttachment`), so its bytes never cross IPC on the way in.
- **Browser** (`apps/web/src/store/BrowserStore.ts`). The `localStorage` mirror (`lila.project.v1`,
  about 5 MB, strings only) cannot hold a catalog with attachments. It is replaced by an IndexedDB
  database holding the working copy as entries keyed by layout path (IndexedDB stores
  `Uint8Array`/`Blob` natively, and a `FileSystemFileHandle` too, so Save can still write back to
  the opened file, #573). Each change set is one IndexedDB transaction, which is atomic. The old key
  is read once on the first launch of the new build, migrated, and removed. Save writes the `.lila`
  through `createWritable` (Chromium writes to a temporary file and swaps it on `close()`) or
  downloads it, as today.
- **Server** (`RemoteStore`, phase 7): the same entries as rows; not specified here.

### 5.4 Revisions and conflicts

- An object's `revision` goes up by one on each commit that changes its content. A commit whose
  object is identical to the stored one writes nothing and keeps the revision, like a no-op
  `patch_scenario` today (#627).
- **Store callers pass `baseRevision`**: the revision they read, or `null` for a new object. A commit
  whose base no longer matches is refused with `E-REVISION` and writes nothing. This is the check
  agents and the future server need; the app gets it for free.
- **On disk, conflict detection stays where it is today** and gets finer only where the container
  allows it:
  - Folder: per file. The existing snapshot of each file Lila read or wrote (`rememberSnapshot`,
    `assertPathsUnchanged`: mtime and size) is checked for the files the change set writes, so an
    agent's edit to one object does not block the app's save of another. A touched file that
    changed refuses the save with `E-CAMBIO-EXTERNO`, as today.
  - Archive: the whole file, as today (`writeLilaFile`: snapshot checked inside the lock). Merging
    disjoint external edits into one archive is possible with per-entry bases and is left for
    when it is needed.
- External changes keep their current path (#539): `projectWatcher.ts` notices a change Lila did
  not write (`isOwnSnapshot`) and the app offers to reload. In a folder the watcher must also count
  `catalog/` and `attachments/` as project files (`relevantProjectFile`).

## 6. Attachments

- **What:** the bytes of a `document` object. One document has at most one attachment; a document
  without one is metadata only (or a `url`). Other types do not carry files in A1.
- **Where:** `attachments/<sha256>` plus the lowercased extension of the original name when it
  matches `^[a-z0-9]{1,10}$`, e.g. `attachments/9b74…4b5a.pdf`. The extension is only there so a
  folder user can open the file; the hash is the identity.
- **Metadata** in the document's `attachment` field: `file` (the entry path), `name` (the original
  file name, shown and used when the file is opened or exported), `mediaType` (from the extension
  when added, never sniffed), `size` (bytes) and `sha256` (lowercase hex). `file` must equal the
  path derived from `sha256` and `name`; otherwise the document is reported and its attachment is
  treated as missing.
- **Immutable and shared.** An attachment file is never rewritten: changing the file of a document
  writes a new entry and points the document at it. Two documents with the same bytes share one
  entry. A save removes an entry that it made unreferenced in that session; an unreferenced entry
  found on open (a merge, a hand edit) is reported and kept.
- **Integrity:** the hash is computed when the file is added, and verified whenever the bytes are
  read (open, export, copy into another container). A mismatch is reported (`problems`), the entry
  is kept as is, and the app refuses to open it. A missing entry is shown as "not included in this
  copy", which is a normal state (see sharing below), not corruption.
- **Limits (owner's decision, § 10):** by default 20 MB per attachment and 200 MB of attachments per
  repository, in the folder and in the archive alike, configurable per repository in the manifest's
  `limits` (§ 1.2). An attachment over a limit is refused when added (`E-ADJUNTO`). A repository
  over its limits (a limit lowered afterwards, a merge, a hand edit) opens and saves normally in both
  containers: limits refuse new attachments and never delete or drop existing ones.
- **Types (owner's decision, § 10):** only this allowlist of document and image formats; any other
  extension, or none, is refused when added (`E-ADJUNTO`). The list belongs to the app version, not
  to the repository.

  | Extensions | `mediaType` |
  | --- | --- |
  | `pdf` | `application/pdf` |
  | `doc`, `docx` | `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
  | `xls`, `xlsx` | `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
  | `ppt`, `pptx` | `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
  | `odt`, `ods`, `odp` | `application/vnd.oasis.opendocument.text`, `…spreadsheet`, `…presentation` |
  | `txt`, `md`, `csv` | `text/plain`, `text/markdown`, `text/csv` |
  | `png`, `jpg`/`jpeg`, `gif`, `webp` | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |
  | `svg` | `image/svg+xml` |

  The app never executes an attachment: it opens it with the operating system only when its
  extension is on the list, previews only `png`, `jpg`/`jpeg`, `gif` and `webp`, and treats `svg` as
  an opaque file (an SVG can carry script). An attachment already in a repository whose extension is
  not on the list (a hand edit, a newer build) is kept and listed, and can be exported, but is not
  opened.
- **Before Save:** a staged attachment lives outside the repository — the desktop copies it into the
  app's data folder when it is added, the browser keeps it in IndexedDB — so a crash before Save
  does not lose it and the original file may be moved meanwhile. A successful commit or a discard
  removes the staged copy.
- **Round trip:** folder ↔ archive is the same path and the same bytes; `unzip` and `zip -r` keep
  working (§ 1.5). Copying between containers verifies each hash.
- **Sharing (owner's decision, § 10):** a shared copy includes attachments by default. Runs stay
  optional (ADR-029). The user may explicitly leave attachment bytes out; the documents then keep
  their metadata and show the file as not included. Attachments are never left out silently.

## 7. Failure recovery

- **Folder.** `commitWithRollback` (`projectIO.ts`) already writes temporary files, renames each
  destination aside to `.prev-*`, renames the new ones in, rolls back in reverse order on failure,
  and leaves `lila-recovery.json` with `E-RECUPERACION-PENDIENTE` when even the rollback fails. A
  version 3 commit uses it unchanged, in this order: new attachments first (new names, never
  overwrite anything, so a crash leaves at most an unreferenced attachment), then objects and
  process files, then the manifest, and the removals last — the order the version 2 save already uses
  (QA of #511), so a crash leaves the old manifest pointing at files that still exist. Readers ignore
  `*.tmp-*` and `*.prev-*`.
- **Archive.** `writeLilaFile` writes a temporary file next to the destination and renames it over
  the old one inside the `.lila.lock` (`withLilaLock`): the archive on disk is always the old one or
  the new one. Nothing changes.
- **Browser.** One IndexedDB transaction per change set; the `.lila` on disk through
  `createWritable`'s swap on close, or a download.
- **Autosave and recovery (desktop, #459).** Today the renderer encodes the whole project as a `.lila`
  and sends its bytes to `lila:writeRecovery`, which writes `userData/recovery.lila` atomically
  (`apps/desktop/src/recovery.ts`). **A1 keeps that**, with attachment bytes and preserved entries
  left out: the copy names attachments by hash, staged ones stay in the staging folder (§ 6), and on
  restore the main process takes attachment bytes and preserved entries from the staging folder and
  the source. If the source is gone, an attachment that only it held shows as not included. The
  one-file rule stays: the copy existing is the signal, and it is removed when the document stops
  being dirty. A leftover `recovery.lila` from an older build is a complete project and restores as
  today.
- **Fallback design, only if the § 9 autosave budget fails:** the copy becomes **the pending change
  set**. The renderer sends the same `ChangeSet` it would commit, and the main process writes
  `userData/recovery-changes.zip` with an `autosave.json` marker (`{ "version": 1, "source": <path
  or null>, "container": "folder" | "lila", "base": <the snapshot of the source when it was read>,
  "deleted": [<paths>] }`) and the changed entries at their layout paths. It reuses neither
  `lila-recovery.json`, which already means a failed rollback (`E-RECUPERACION-PENDIENTE`), nor
  `recovery.lila`; older builds never read it.
  - **Restore** reopens the source and applies the change set, and the repository opens dirty. If
    the source is gone or changed under a touched entry, the change set is applied to what is there
    now and the result opens as a new, unsaved repository that must be saved with Save As — the user's
    work is never thrown away and never silently merged into a file that moved on.
  - A never-saved repository has no source: its change set is the whole repository, so it restores
    by itself.
- **Browser recovery.** The IndexedDB working copy is the recovery: it is written on every change.

## 8. Compatibility

- **Versions 1 and 2 open unchanged**, folder and archive, and an open/save round trip without
  changes still gives back the same bytes (plus, now, the unknown entries that used to be dropped,
  § 1.4). They are rewritten as version 3 only when something listed in § 1.3 needs it.
- **The engine, the CLI and the MCP server keep working on a version 3 repository.** They read and
  write it through the same codec (`decodeLila`/`encodeLila`, `openLilaProcess`, `writeLilaProject`
  in `packages/engine/src/project-fs/input.ts`). Every tool that does not know about the catalog —
  `patch_scenario`, `run_simulation` with `saveRun`, `create_process`, `edit_process`,
  `annotate_element`, `import_scenario_sheet` — must leave catalog objects, attachments and preserved
  entries byte for byte. `annotate_element` keeps writing ids exactly as given: it does not check them
  against the catalog, and an id that matches no object is an unresolved reference like any other.
  `get_project` reports `formatVersion: 3`. Acceptance for A1 includes a round trip of a version 3
  fixture through each writing MCP tool and CLI command, including the process rename and delete
  that Lote R adds (#634, MCP and CLI), comparing every non-touched entry.
- **`--process` / `process`** keep taking the slug. Because version 3 never falls back to version 1,
  the slug of a lone process no longer changes under an agent. Tools that take a process may also
  accept the process id later; not needed for A1.
- **Engines older than this contract** refuse a version 3 `.lila` with their `LILA-MANIFEST` message
  (§ 1.4); an agent sees a clear error, never a lossy write. `@lila-modeler/mcp` pins the engine
  version (ADR-030), so both upgrade together.
- **Catalog tools for agents** (list, read, create, update with `baseRevision`, delete with
  `replaceWith`/`removeReferences`, where used) follow this contract when they are added; their
  names and shapes belong to the A1 tickets, not here.
- **New error codes** that A1 introduces: `E-OBJETO-EN-USO` (delete of an object in use, § 3.4),
  `E-REVISION` (stale `baseRevision`, § 5.4) and `E-ADJUNTO` (attachment refused by size or type,
  § 6), with their engine counterparts in the explicit map of `lilaFile.ts`. The existing codes keep
  their meaning.
- `docs/BPMN_EXTENSION.md` already points references at the per-object catalog and says they are
  not checked yet. The "reported and dropped" rule of `docs/PROJECT_FORMAT.md` is updated by A1
  together with the code, so that it never describes something that is not built.

## 9. Performance budgets

These are **targets to measure**, not results. Nothing below has been measured.

### 9.1 The synthetic large repository

A seeded generator, written in A1 and kept with the tests (only the generator is committed, not its
output), produces the same repository as a folder and as a `.lila`. All names are synthetic
("Process 017", "Role 0412"), per the [examples policy](EXAMPLES_POLICY.md).

| Fixture | Processes | Flow nodes | Catalog objects | References | Attachments | Runs |
| --- | --- | --- | --- | --- | --- | --- |
| `synthetic-org-s` | 10 | 700 | 200 | 2,500 | 10 × 100 KB | none |
| `synthetic-org-l` | 200, 4 lanes and 2 scenarios each | 14,000 (50 tasks, 10 gateways, 10 events per process) | 5,000: 1,500 roles, 300 units, 700 systems, 2,500 documents | 50,000 (per task: 2 RACI, 1 system, 1 input, 1 output), 1 % unresolved | 300, 50 KB – 2 MB, about 150 MB | none |
| `synthetic-org-l+runs` | as `l` | as `l` | as `l` | as `l` | as `l` | 1 per process, about 300 KB each |

### 9.2 Reference hardware

- **A:** Apple silicon Mac (M1 class), 8 GB RAM, the current macOS, the desktop app as released and
  Chrome stable.
- **B:** Windows 11 x64 laptop, 4 cores, 8 GB RAM, Chrome stable, the installed PWA (ADR-031).

Each measurement records the machine model, OS, app build, browser or Electron version, fixture and
seed, and reports the median and p95 of five runs; "open" is measured with a cold app and a warm file
cache.

### 9.3 Budgets (`synthetic-org-l`)

| Operation | A, folder | A, `.lila` | B, `.lila` |
| --- | --- | --- | --- |
| Open to an interactive canvas with the explorer (manifest, catalog, first process) | 1.5 s | 2.5 s | 4 s |
| Usage index complete, in the background | 3 s | 3 s | 6 s |
| Search as you type (object names, process names, element names) | 100 ms | 100 ms | 150 ms |
| Object table: first paint of 5,000 rows (virtualized) | 300 ms | 300 ms | 450 ms |
| Object table: commit of one cell edit, diagram and index updated | 100 ms | 100 ms | 150 ms |
| Save after changing one object | 300 ms | 3 s | 5 s |
| Autosave of a change set; longest block of the input thread | 200 ms; 50 ms | 200 ms; 50 ms | — |
| Renderer memory with the repository open (no attachment opened) | 400 MB | 400 MB | 400 MB |

With `synthetic-org-l+runs`, open and search keep the same budgets (runs are not loaded), and no
single IPC message except an explicit attachment read exceeds 8 MB. A budget that fails is a
finding for the A1 tickets, not a reason to change this contract silently; the measured values,
hardware and fixture are recorded in the ticket that closes the performance acceptance.

## 10. Owner decisions (2026-10-14)

Everything else in this document is a technical, reversible decision taken with its reason. These
four product questions were decided by the owner:

1. **Attachment types:** only the allowlist of document and image formats in § 6.
2. **Attachment size:** 20 MB per attachment and 200 MB per repository are the defaults, configurable
   per repository in the manifest's `limits` (§ 1.2). Lowering a limit refuses new attachments and
   never deletes existing ones.
3. **Document control:** code, version and status (ISO-style document control) wait for phase 7
   governance; they are reserved (§ 2.5) and not part of A1.
4. **Sharing:** a shared copy includes attachments by default (§ 6); runs stay optional.

## Where the code will be

Not built yet. The format half belongs in `packages/engine/src/project/` (manifest version 3,
catalog object reading and writing, the usage index), next to `lila.ts` and `repository.ts`, so it
stays browser-safe; the disk half in `packages/engine/src/project-fs/`; the stores in
`apps/web/src/store/`; the IPC in `apps/desktop/src/bridge.ts` and `main.ts`. Engine `core/` stays
free of catalog code.
