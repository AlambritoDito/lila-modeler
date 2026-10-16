# Roadmap: from process simulation to an organizational repository

> Read this in: [Español](es/ROADMAP.md).

**Approved direction, 2026-09-26; evidence refreshed on 2026-10-14. Implementation pending except
for the foundations explicitly identified below.** Tracked on GitHub as epic #497. This roadmap expands [ADR-029](DECISIONS.md#adr-029--the-repository-one-lila-can-hold-a-whole-organization).
It is a delivery sequence, not a release schedule or a claim of complete Bizagi/ADONIS parity.

Lila will combine its BPMN modelling and simulation foundations with reusable organizational
knowledge: processes, people, applications, documents, risks, controls and their relationships.
Browser and desktop use come first. A shared server follows later. Workflow execution remains
in external engines, connected through explicit adapters and API/MCP; exporting BPMN alone does
not guarantee that any particular engine can execute it.

## 1. Evidence and capability gaps

Baseline: source inspected at commit `7dd61e2` (v1.0.0-beta.26) on 2026-10-14, plus the state of
the referenced GitHub issues on that date. This is a static code and contract review, not a new
installed-app smoke test or a fresh run of the simulation suite. The existing backlog records
intent and must not be used alone as proof of implementation.

Evidence keys:

- **B1:** [project document](../packages/engine/src/project/types.ts), [archive codec](../packages/engine/src/project/lila.ts), [process list](../packages/engine/src/project/repository.ts), [canvas tabs](../apps/web/src/PestanasProcesos.tsx) and [project format](PROJECT_FORMAT.md): a version 2 repository holds several processes under `processes/<slug>/` (#498, #521, #614); a one-process project is still written as version 1; anything outside the listed process folders is reported and dropped, so there is no catalog, map or attachment entry yet.
- **B2:** [properties editor](../apps/web/src/PropertiesPanel.tsx), [annotation reader/writer](../packages/engine/src/bpmn/annotate.ts), [extended attributes](../packages/engine/src/bpmn/attributes.ts) and [BPMN extensions](BPMN_EXTENSION.md): documentation, RACI entries, typed references and per-element-type attributes exist; references are entered as IDs, without a repository catalog.
- **B3:** [view identifiers](../apps/web/src/ids.ts), [results view](../apps/web/src/ResultsView.tsx) and [process document](../packages/engine/src/process-document.ts): simulation results with charts, a Word/HTML process document (#454) and a per-process RACI matrix (#99) exist; model-table and organizational Insights views do not.
- **B4:** [scenario schema](../packages/engine/src/scenario.ts) and [resource simulation tests](../packages/engine/test/core/resources-sim.test.ts): capacity, costs and calendars belong to simulation, not an organizational directory.
- **B5:** [store interfaces](../apps/web/src/store/ProjectStore.ts) and [browser store](../apps/web/src/store/BrowserStore.ts): local adapters that open and save the whole project document; per-object lazy loading and the remote store are planned.
- **B6:** [Bizagi comparison](BIZAGI_PARITY.md), [MCP contract](MCP.md) and [CLI](CLI.md): simulation foundations and eighteen MCP tools that create, edit, annotate, simulate and export one process of a `.lila` (epic #527, still open), with documented limits.
- **B7:** [ADR-029](DECISIONS.md#adr-029--the-repository-one-lila-can-hold-a-whole-organization) and [backlog](../BACKLOG.md): accepted direction, not implementation evidence.

Status vocabulary: **Implemented** means the stated foundation exists in source; **Partial**
means only part of the capability exists; **Planned** means approved work absent from the
inspected implementation; **Unverified** means the comparison or interoperability needs evidence.
Phase numbers below are roadmap phases, not the historical M0–M6 milestones.

| Reference capability | Lila status / evidence | Missing capability | Phase / dependency | Acceptance |
| --- | --- | --- | --- | --- |
| BPMN modelling and simulation | Implemented foundation, B6 | Preserve existing contracts and documented limits | All / existing engine | Same inputs and seed retain regression results |
| Organizational repository | Partial: several processes per `.lila`, canvas tabs and call-activity navigation, B1 | Per-object store, explorer, search, owners/metadata | 1 / RM-01 contract | Browse and search processes and objects of one repository |
| Reusable objects and usage lookup | Partial: reference syntax, B2 | Catalog, relationships and reverse index | 1–2 / repository | A rename reaches every occurrence without changing IDs |
| Property notebooks and documentation | Partial: properties panel and extended attributes, B2 | Typed object forms and catalog selectors | 2 / catalog | Assign a role and resolve its object from a task |
| Model/object table editor | Planned, B3 | Filters, columns, bulk editing, export | 2 / shared editing commands | Table edit and undo update the diagram |
| RACI and inputs/outputs | Partial: annotations and a per-process matrix in the engine, CLI, MCP and process document, B2/B3/B6 | Repository-wide matrix over catalog roles, app view and document relations | 2 / catalog | Trace a matrix row to its task and role |
| Process/object Insights | Partial: simulation metrics and charts only, B3 | Responsibilities, documents, systems, usage and gaps | 2 / derived queries | Every widget navigates to its source |
| Process landscapes and value chains | Planned, B7 | Hierarchical maps linked to BPMN | 3 / repository objects | Navigate macroprocess → process → activity |
| Organization and resources | Partial: simulation pools, B4 | Units, roles, positions, people, partners, resources, cost centres | 3 / catalog | Show ownership and explicitly link a role to a simulation pool |
| Risk and control management | Partial: references only, B2 | Risk/control catalogs and groups, maps, assessments, heatmaps, treatments | 4 / catalog and maps | Trace a risk to controls, owner and evidence |
| Control objectives and requirements | Planned, B7 | Coverage and compliance relationships | 4 / risk/control objects | List requirements without supporting controls |
| Documents and attachments | Partial: references and an exported process document; archive drops unknown entries, B1/B2/B3 | File storage, metadata and portable attachments | 2 / version 3 storage | Attachment bytes survive archive and folder round trips |
| KPIs, maturity and improvement | Partial: KPI references and simulation, B2/B6 | Targets, observations, initiatives, goals, SIPOC and Ishikawa | 5 / Insights and relationships | A result identifies source, date and measurement kind |
| Impact and dependency analysis | Planned, B7 | Cross-model traversal and saved analysis views | 5 / reverse index | An application change lists affected tasks and processes |
| Document, IT and product maps | Planned, B7 | Products/components; applications/services/interfaces/operations/nodes | 6 / model type registry | One application is reused in process and IT maps |
| Data, use cases and decisions | Planned, B7 | Entities/attributes, actors/use cases, decisions, input data, knowledge sources/models | 6 / explicit model contracts | Links survive save/open; DMN contract approved before coding |
| Collaboration, conversation and cross-domain models | Partial: BPMN editor foundation, B6 | Complete reference coverage and domain views | 6 / model contracts | Document supported notation and preserve foreign content |
| Version history and semantic comparison | Partial: version tag only, B2 | Snapshots, history and semantic diff | 7 / repository identities | Compare published and draft versions without confusing scenarios |
| Approval, release and process portal | Planned, B7 | Review, validity, publication and reader navigation | 7 / history and server | Reader sees released content; editor changes a draft |
| Team collaboration | Planned, B5/B7 | Server, accounts, permissions, comments, audit, notifications, conflict handling | 7 / object storage | Unauthorized writes fail; concurrent edits cannot silently overwrite |
| Operational quality records | Planned, B7 | Audits, findings, nonconformities and CAPA | 7 / server governance | Record has owner, due date, history and design-object links |
| Repository API/MCP and AI assistance | Partial: per-process modelling, annotation, simulation and export tools with dry-run, B6 | Catalog and repository tools, interviews, reviewed proposals | 8 / repository services | A proposed change is inspectable before application |
| Mining, measured KPIs and workflow integrations | Planned; connector compatibility unverified, B7 | Observed-data import and external adapters | 8 / provenance and API | Compare observed and simulated data with declared units and mappings |
| Full vendor parity and proprietary import | Unverified | Edition-specific audit and real round-trip fixtures | Separate assessment / access to source tools | Publish tested coverage and losses, never infer support from screenshots |

## 2. Delivery sequence

| Phase | Deliverable | Gate / backlog |
| --- | --- | --- |
| **1 — Repository foundation** | Per-object storage, catalog entries, explorer, identity and relationship index (the multi-process v2 container and tabs already exist) | ORG-1; keep v1/v2 output byte-identical (plus unknown entries now preserved, REPOSITORY_CONTRACT.md § 1.4) and each process's scenarios/runs isolated |
| **2 — Documentation workspace** | Initial roles/units/systems/documents catalog; attachments; selectors; editable tables; RACI; initial Insights | E15, ORG-2, ORG-3, ORG-6; first usable milestone below |
| **3 — Process and organization architecture** | Process landscapes, value chains, organization charts and organizational resources | ORG-4 and LILA-096; map navigation and explicit simulation linkage |
| **4 — Risks and controls** | Catalogs/groups, maps, inherent/residual assessment, heatmap, objectives, requirements, evidence and treatment | ORG-5; coverage can be inspected from both process and risk |
| **5 — Analysis and improvement** | Portfolio Insights, KPIs, maturity, dependencies, goals, initiatives, SIPOC and Ishikawa | ORG-3; traceable sources and drill-down |
| **6 — Complementary models** | Document/IT/product/data/use-case/decision and communication views, reusable cross-domain objects | ORG-7; one registry of types/properties/relations, incremental model contracts |
| **7 — Governance and teams** | Versions, approvals, validity, portal, self-hosted server, permissions, collaboration and quality records | E13/E14/ORG-8; lossless folder/server export and verified authorization/conflicts |
| **8 — Ecosystem and intelligence** | Repository API/MCP, imports, observations/mining, interviews, reviewable AI and external workflow adapters | E16–E18/ORG-9; explicit interoperability and provenance tests |

Phases 1–2 form the first usable milestone. Risk assessment is a later delivery, not an implicit
part of the first catalog. Phase 7 server work consumes the local repository contract; the
historical M6 server milestone is not a prerequisite for phases 1–6. Existing M0–M5 work and
release stabilization remain valid. Do not reuse the original backlog's small estimates for
these expanded epics: size implementation slices after their contracts and fixtures are ready.
`ORG-*` epics are local backlog groupings under #497; the GitHub epics E21–E26 already exist with
other scopes.

### Sequencing

ADONIS code starts once Lote R (#634, #635, #636) completes the agent epic #527 and the remaining
items #645 and #517 are done (Lote P shipped in beta.25 and Lote Q in beta.28). From then on, the
cloud issue loop is to execute approved issues as draft PRs against batch branches. The RM-01 contract, documentation only, is
[`REPOSITORY_CONTRACT.md`](REPOSITORY_CONTRACT.md), recorded as ADR-032 (accepted on 2026-10-14
with the owner's decisions) in [DECISIONS.md](DECISIONS.md). Proposed delivery lots:

| Lot | Scope | Phase |
| --- | --- | --- |
| **A0** | Repository contract (RM-01, ADR-032) | 1 |
| **A1** | Per-object store, catalog (roles, units, systems, documents), selectors, repository explorer | 1–2 |
| **A2** | Table editor, aggregate RACI matrix, Insights | 2 |
| **A3** | Process landscapes and value chains (macroprocess → process → activity), org chart, explicit role ↔ simulation pool link | 3 |
| **A4** | Risks and controls | 4 |
| **A5** | KPIs, Ishikawa, SIPOC, impact analysis | 5 |
| Later | Complementary models, governance and server, ecosystem | 6–8 |

#639 (simulator multi-instance, loops and error events) is simulation depth, not a step on the
path to ADONIS, and does not gate these lots.

### Org repository v1

Scope agreed with the owner on 2026-10-16: the first ADONIS-facing delivery, a slice of lots A1–A3.
The ADONIS 19.1 behavior, the current Lila code and the gap behind each item are in the
[capability map](research/ADONIS-CAPABILITIES.md#capability-map-191-consulted-2026-10-15).

| Item | Scope | Acceptance | Lot |
| --- | --- | --- | --- |
| **S1 Identity** | Catalog roles referenced by id from tasks through a picker; one rename; adoption of typed ids | Role "Receptionist" in the catalog, referenced from tasks in three processes through the picker, renamed once → all three show the new name; save the `.lila`, reopen, same id; v1/v2 projects open unchanged; hand-typed `roleRef` ids can be adopted | A1 |
| **S2 Where used and integrity** | Uses of each object; lint for references missing from the catalog; deleting an object in use refused unless replaced or its references removed (REPOSITORY_CONTRACT.md § 3.4) | The usage list matches every reference; the refusal names the uses; each alternative is one undoable command | A1 |
| **S3 RACI view** | Tasks × roles per process and across processes in the app, with catalog names, CSV/XLSX export | For each process, equal to the engine's `raciMatrix` | A2 |
| **S4 Units** | Unit hierarchy, a role belongs to a unit, unit tree, RACI filter by unit | Tree and filter agree with `parentRef`/`unitRef`; a cycle is shown broken | A1 (units, tree), A2 (filter) |
| **S5 Lane → role** | Command that assigns a lane's role to its tasks, like ADONIS "Assign responsibilities to tasks" | One undoable command, never automatic; the simulation scenario is untouched | A2 |
| **S6 Process tree** | Tree derived from call activities, with the "used in" path of each process | Every call resolves to its node or is listed as unresolved; cycles are shown broken | A3 |
| **S7 Documents** | Word/HTML show catalog names; a report per role | A rename shows in the regenerated document; the per-role report equals that role's S3 column | A2 |

**Next phase:** S8, risks and controls (lot A4).

**Out of v1:** release workflows, multi-user, comments, rights, portal, SSO, REST API, ADOIT/ADOGRC
synchronization, configurable dashboards/Insights, metamodel customization, AI, mining, Dependency
Modeller, model comparison, drawn org-chart and landscape diagram types, the tabular editor,
attachments, KPI/Ishikawa/SIPOC, saved queries, ISO document control, positions and persons.

Mapping to the lots: v1 is S1–S7. The rest of A1–A3 (A2's table editor and Insights, A3's drawn
landscapes, value chains and org chart, and its explicit role ↔ simulation pool link) stays in
those lots but is not part of v1. The acceptance scenarios use roles and units; whether systems and
documents ship in v1 with the same picker and usage rules is settled when A1's issues are written.

## 3. Architecture and product rules

- **Definition and occurrence:** catalog objects have stable identities; diagrams reference
  them. Model placement is not a second copy of the object. References support reverse lookup.
- **Identity:** cross-model element references include model identity, version context and BPMN
  element ID. Names and paths are not keys. Importing two models with equal element IDs must not
  merge them. References are `{ process, element }` with a reserved `version` member
  (REPOSITORY_CONTRACT.md § 3.3).
- **Compatibility:** already true for processes: v1 opens as a one-process repository without
  rewriting its files, and a one-process project is still saved as v1, byte for byte (plus unknown
  entries now preserved, REPOSITORY_CONTRACT.md § 1.4). Keep that when adding objects: content that
  needs repository features (a catalog, attachments) requires a version 3 save
  (REPOSITORY_CONTRACT.md § 1.3). Builds 1.0.0-beta.15 and later refuse version 3
  (`LILA-MANIFEST`/`E-MANIFEST`); builds up to beta.14 refuse versions 2 and 3. Never claim that a
  v1 reader preserves catalogs or attachments.
- **Canonical data:** BPMN retains diagram and element annotations; catalog objects live in
  `catalog/<type>/<id>.json` (superseding the proposed monolithic `catalog.json`). Maps, analyses
  and dashboard definitions use versioned documents. Indexes and displayed aggregates are derived.
- **Storage interface:** evolve `ProjectStore` to list/read/write objects with lazy loading and
  explicit revisions. Browser persistence must support objects and attachment bytes beyond a
  whole-project `localStorage` mirror. Desktop IPC transfers requested objects, not the repository.
- **Shared editing:** table and diagram edits use the same semantic command path and undo/redo;
  multi-cell edits are atomic. Invalid/inapplicable fields are explained, not silently coerced.
- **Complete documentation:** derive documentation views from the full BPMN document, not only
  the simulation IR, which omits unsupported simulation constructs. Catalog and UI services stay
  outside the dependency-free engine `core/`.
- **Resource linkage:** RACI roles and simulation pools remain different concepts with an explicit
  link. A responsibility never creates capacity, cost or availability automatically.
- **Attachments:** define supported entries, limits, integrity and recovery before adding files
  to version 3. Preserve bytes across archive/folder adapters; do not reuse v1's unknown-entry dropping
  for supported attachments. Runs remain optional when sharing.
- **Insights:** process/object dashboards are reading and analysis views. Every metric records
  whether it is manually assessed, simulated or observed, with source/date and applicable units.
  Missing is not zero; stale simulation runs are distinguishable from current model results.
- **Risk:** use explicit assessment scales and distinguish inherent and residual values. The
  presence of a control does not prove effectiveness or automatically lower residual exposure.
- **Models:** introduce a shared registry of types, attributes, relations and views incrementally.
  DMN needs an explicit standard-format ADR before implementation; it extends the current
  BPMN-only interchange decision. This roadmap does not assert DMN execution support.
- **Governance:** local owner/status metadata does not prove approval. Server releases require
  authenticated authorization, version history and audit. Quality records belong primarily to
  server mode; any local opt-in retains ADR-029's copied-file concurrency limitations.
- **Design:** preserve approved branding and themes; use original Lila UI, not copied vendor
  assets. Keep English/Spanish UI catalogs aligned. Public examples are synthetic.

Before the first milestone, RM-01 defines repository version 3 (process ids, catalog, attachments)
on top of the shipped v2 layout and settles reference identity, the storage/revision interface,
attachment rules and failure recovery. Later phases get separate contracts for map
types, risk scoring, KPI observations, DMN, release workflow, collaboration and connectors. These
are explicitly deferred specifications, not choices silently delegated to a first-milestone PR.
No runtime API, scenario schema or public error code changes in this documentation delivery.

## 4. Acceptance and validation

First usable milestone, using a synthetic organization:

1. Create one repository with two processes sharing roles, one application and documents.
2. Assign responsibilities and input/output references through catalog selectors.
3. Edit names, documentation and references in the table; verify diagram synchronization and
   undo/redo, including atomic bulk edits.
4. Open RACI and process/object Insights; navigate from each row to its source activity or object.
5. Rename a shared object and observe both processes update without changing identity.
6. Save, close and reopen in browser and desktop; preserve references, attachments, scenarios
   and stored runs. A v1 input remains readable without destructive conversion.

Cross-cutting gates: duplicate IDs across models; dangling references and deletion of used objects;
foreign BPMN extensions and loss diagnostics; non-simulable BPMN documentation; failed saves,
external file changes and recovery; version rejection; keyboard operation and EN/ES parity;
seeded simulation/CLI/MCP regressions. Use a synthetic large repository to measure lazy loading,
search and table responsiveness; record hardware, dataset size and budgets in RM-01 before
performance acceptance. Do not infer performance from single-model results.

Later gates: risk/control coverage with missing assessments; source/date/kind of every KPI;
reuse across model types; immutable released versions; permissions and concurrent edits;
lossless server export; unit/mapping checks for measured data and external connectors.
Run the existing checks required by CONTRIBUTING for code deliveries; documentation-only changes
require link validation, documentation rendering and review of translated coverage.

## 5. Reference scope and maintenance

The following official references inform feature families, not a licensed-edition parity claim.
The screenshots supplied for planning are functional references and are not committed fixtures.

| Source | Reference scope | Availability classification |
| --- | --- | --- |
| [ADONIS model types, 16.0](https://docs.boc-group.com/adonis/en/docs/16.0/user_manual/mty-000000/) | Process landscapes and domain models | Documented BPMS application library; edition entitlement unverified |
| [Tabular editor, 17.1](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/tab-000000/) | Model/object properties and relations in editable rows/columns | Documented user feature; edition entitlement unverified |
| [Insights, 14.0](https://docs.boc-group.com/adonis/en/docs/14.0/user_manual/igh-000000/) | Process/object summaries and navigation | Depends on application library; not proof of identical widgets in every release |
| [ADONIS features](https://www.boc-group.com/en/adonis/features/) | Governance, publication and ecosystem overview | Mining, advanced reporting and automation presented as extensions; integrations need separate verification |

Vendor sources reviewed on 2026-09-26; the research [capability map](research/ADONIS-CAPABILITIES.md#capability-map-191-consulted-2026-10-15) was refreshed against ADONIS 19.1 on 2026-10-15. Sources cover different versions and do not establish a single exhaustive
ADONIS edition baseline. Distinguish Lila-specific quality-analysis additions from vendor parity.

[BACKLOG.md](../BACKLOG.md) owns implementation work and acceptance dependencies. New `ORG-*`
and `RM-*` identifiers are local planning keys, not GitHub issue numbers. Preserve existing LILA IDs; reconcile
actual issue status before publishing or closing any issue. No GitHub issue synchronization is
implied by this document. Update this matrix when a phase ships, citing code and acceptance
results; planned contracts must never be described as current features.

Follow-up: [ADONIS and open-source research](research/README.md) records documentary findings,
edition boundaries and candidate refinements without changing the approved delivery sequence.
