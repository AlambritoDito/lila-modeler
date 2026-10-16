# ADONIS public capability research for the Lila Modeler roadmap

> Read this in: [Español](../es/research/ADONIS-CAPABILITIES.md).

Reviewed 2026-09-26; citations refreshed on 2026-10-15 against the **ADONIS 19.1 BPMS Application Library** user manual. This is a documentary survey of BOC Group's public material. It is not a licensed installation audit, a compatibility test, or a complete export of the vendor metamodel, and **nothing in it was observed hands-on** in a running ADONIS. Links point to 19.1 pages where the 2026-10-15 check read that page; the others still point to the 17.1 (or 17.0) pages first reviewed, because their 19.1 equivalent was not checked (see *Edition of each citation* below). The [19.0 update page](https://www.boc-group.com/en/adonis/whats-new/) lists further release-specific material; features from different versions must not be combined into a claim about one deployed edition. The current [Lila roadmap](../ROADMAP.md) already covers most broad families below. This note supplies more precise vendor evidence and candidate acceptance questions, without changing roadmap commitments.

## Evidence and entitlement rules

- **Documented user behavior** means a user-manual page (19.1, or 17.1 where the link says so) describes the function in the BPMS Application Library. The installed application library, configuration, system role, license and edition can still change availability. [Method and metamodel](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/amm-000000/), [model types](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/).
- **Administrator/configurable** means the administrator manual describes a setting or customization; it does not establish that every tenant can use it. The [Properties administration page](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/attrmm-000000/) explicitly says availability depends on the license. [Rights administration](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/rightswc-000000/) separates content rights from system-role module, metamodel, release and validation rights.
- **Enterprise/license-limited** is used only where the manual says so. The 19.1 [release workflow manual](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/) explicitly limits model and document workflows to Enterprise and license entitlement. The current [product page](https://www.boc-group.com/en/adonis/) markets Community, Starter, Grow and Individual, whereas the [comparison-of-editions page](https://www.boc-group.com/en/adonis/comparison-of-editions/) uses Community, Starter and Enterprise. Their naming/packaging must be reconciled with a quote or tenant. Critically, extracted HTML from the comparison table loses some visual checkmarks and column alignment. A row's presence is **not** proof of inclusion in a given edition. The comparison page does state the Community (free) limits in words: 256 models, 2,000 objects, 1 MB PDF documents, BPMN syntax validation, one language, a single user and standard PDF reports; Starter and Enterprise are unlimited. Release workflows and Control & Release are Enterprise only ([release workflow](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/), [governance scenario](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-300000/)). Other per-edition assignments could not be determined.
- **Edition of each citation.** Checked in 19.1 on 2026-10-15: model types, graphical modelling, Explorer, usage analysis, properties, document management, tabular editor, textual view, Insights, charts, search, Dependency Modeller and release workflow, plus the pages first cited in the capability map below. Some details in those paragraphs come from the 17.1 reading and were not re-confirmed one by one in 19.1 (for example the tabular editor's best-effort paste and grey cells, Insights hiding empty sections, the list of chart templates, Unit Insights); treat them as 17.1 observations. Still 17.1, not checked in 19.1: method and metamodel, the administration pages (properties, rights, concept of use), object import/export, BPMN DI, model comparison, validation, simulation and the 17.1 news. Still 17.0: the Design & Document scenario.
- **Add-on/integration** means the vendor identifies a separate module or connected product. The [features page](https://www.boc-group.com/en/adonis/features/) puts simulation, mining, automation and advanced reporting under extensions; [Process Mining Essentials](https://www.boc-group.com/en/marketplace/bpm/adonis-process-mining-essentials/) explicitly calls itself a product extension requiring ADONIS 17.0+. [Marketplace](https://knowledge.boc-group.com/en/marketplace/adonis/) entries are offers, not installed capability.

## 1. Model and object vocabulary

The [19.1 model-type guide](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/) explicitly lists Product Model; Process Landscape; Business Process, Conversation and Choreography Diagrams; Working Environment Model; IT System Model, Use Case Diagram, Document Model and Data Model; Control, Risk and Control Objective Pools; and Cross-Domain Model. Product, Working Environment, IT and Document Models may have subordinate models. Landscapes navigate process hierarchies. Cross-Domain Models admit all object types and relations and can store dependency analysis. **Scope:** documented for the BPMS Application Library, not proof each tenant/edition exposes each type. **Lila:** retain an incremental registry and separate model contracts, as roadmap phases 3–6 propose; do not present every model family as a BPMN element.

The same source names specific objects in context: products/components, processes, organization structure, systems/applications/infrastructure, documents, entities/properties, risks, controls and control objectives. [Search topics](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) additionally expose performers, users, units, roles, services, interfaces, operations, attributes, entities, initiatives and performance indicators. These are examples, **not a complete canonical type/attribute/edge list**. An object-type list extracted from a search page may vary by library and release. **Lila:** use the list as candidate discovery fixtures, then approve exact Lila types and permitted relations in individual contracts. Avoid copying vendor-internal names or inventing a full ADONIS schema.

The [19.1 graphical modeling guide](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/objgra-00000/) distinguishes model-local modeling objects from reusable repository objects. It describes connector endpoint restrictions and relation creation from the Explorer or by nesting; behavior depends on the application library. **Lila:** represent definitions and occurrences separately, define allowed endpoints and cardinality, and ensure references survive model moves. **Unverified:** complete endpoint matrix and serialization identifiers.

## 2. Repository, reuse and relationships

The [Explorer manual](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mamoo-00000/) documents separate Model and Object Catalogues, hierarchical groups, recent/favorite items, search/filter by type, reusable objects in multiple models, and relation creation between objects or objects and models. It also documents replacement/merge behavior and warns on deleting used or referenced objects; its override can still remove them. [Usage Analysis](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/usa-000000/) shows incoming/outgoing, valid/broken references and the models using a repository object. **Lila:** roadmap phase 1's reverse index should support rename, usage, dangling-reference inspection, and deliberate delete/replace policy. Make deletion consequences explicit; do not assume the ADONIS override behavior is desirable. **Unverified:** exact identity/version semantics and conflict behavior require a tenant and export fixtures.

The [19.1 properties manual](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/) describes model/object attributes and relations as editable properties. [Administration Properties](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/attrmm-000000/) arranges them in chapters and groups and shows language-independent names, types, mandatory, read-only and default-value controls; relation labels can be localized. **Scope:** administrator editing is license-dependent and some relations may be locked by product customizers. **Lila:** typed forms and relation pickers can derive from Lila's own registry; a draft schema should preserve stable IDs, locale labels and validation metadata. **Unverified:** a complete public export of the default library was not found in the 17.1 review and was not looked for in 19.1.

The [document-management manual](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/condms-00000/) says uploaded files become Document objects with a referenced-document property, can be used in models, and are included in repository backups/migrations. File types and maximum size are configurable (the manual states up to 50 MB), and language-specific file variants are possible. [Search](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) describes full-text document search. **Lila:** phase 2 attachment contract should specify bytes, MIME/type policy, size, integrity and round trips; multilingual assets can be a later explicit choice. **Unverified:** storage API, deduplication and exact backup format.

The [object import/export manual](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/impexpobj-00000/) documents configurable Excel import/update using XML configuration and sample configurations in the BPMS library, plus connected-object synchronization with ADOIT. The [BPMN DI import/export guide](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/bmpndi-00000/) describes BPMN/XML or ZIP import, and optional export of referenced embedded subprocesses and call activities. **Lila:** treat catalog import and BPMN interchange as separate contracts with loss reports. **Unverified:** semantic round trips for customized relations, Lila extensions and vendor extensions; test real files before any parity claim.

## 3. Editing and reading surfaces

The [19.1 tabular editor](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tab-000000/) renders objects as rows and attributes/relations as columns, for a model or selected catalog objects. It supports cell edit, multi-cell selection, copy/paste within and across tables or Excel, column selection, sorting, adding existing or new objects, and XLSX exports. Inapplicable cells are grey. The manual says multi-cell paste applies **best effort**, ignoring incompatible cells. **Lila:** the roadmap's atomic bulk-edit and undo acceptance is a deliberate Lila quality choice, not observed ADONIS parity; surface errors per cell. **Unverified:** transaction, undo and concurrent-edit behavior in ADONIS.

The [19.1 textual view](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tex-000000/) orders process steps, descriptions, responsibilities and resources, links to subsequent or referenced objects, allows columns/details controls and XLSX export. The standard BPMS library enables it for Business Process Diagrams; other types depend on configuration. **Lila:** consider a readable work-instruction view beyond editable table and diagram, with navigation and provenance. This is not yet an explicit roadmap row. **Unverified:** whether the text view includes every BPMN path or unsupported notation element.

The [19.1 Insights manual](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) separates read/analysis dashboards from editable properties. The BPMS library enables them for Business Process Diagrams and repository object types, with object relationship networks, usage, risks/controls, control objectives, timelines and type-specific widgets. Process widgets include hierarchy, SIPOC, RACI, documents, applications/resources, maturity, risks, indicators and initiatives. Empty sections are hidden by default; widgets can be filtered/exported and source artifacts navigated. **Lila:** implement source-linked, typed queries, and distinguish missing from zero. **Scope:** widgets are library/version-dependent; mining-specific variants and directly-follows graph widgets require Process Mining Essentials plus a linked project. **Unverified:** exact calculations of vendor maturity and risk scores, permissions on every drill-down, and widgets in other releases.

The [19.1 chart manual](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/) documents reusable analysis datasets with bar, nested-box, bubble, Gantt and matrix charts. A matrix can show direct relations or intermediate objects; special BPMS templates include RACI, OMRA, value at risk, initiative progress and control-objective maturity, subject to configuration. Charts can be saved/shared and exported. **Lila:** phase 5 could make saved analysis datasets and relation paths a product concept; an RACI matrix is one preset on top of that. **Unverified:** whether chart templates/editing are available in each current edition.

The [19.1 search/analysis guide](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) describes search across models, objects and document content, filters by topic/type/property, combined AND/OR criteria and analysis without a text term. [Usage Analysis](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/usa-000000/) and [Dependency Modeller](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/dep-000000/) are complementary graph navigation. The latter creates a swimlane dependency view from incoming/outgoing object relations, with administrator-defined templates. **Lila:** consider saved queries, explicit relation paths and missing-reference filters alongside Explorer search. **Unverified:** indexing latency/performance and tenant access filtering.

## 4. Responsibilities, risk, indicators and governance

The [19.1 process Insights page](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) confirms a process RACI role table and a matrix shortcut. Role Insights trace Task → RACI relation → Role and show process and model responsibilities; organizational-unit Insights aggregate assigned roles and processes. The [admin concept-of-use page](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/conwc-000000/) distinguishes **business Role objects** from **system roles** that grant permissions. **Lila:** preserve that distinction; RACI must never imply login access or simulation capacity. **Unverified:** full cardinality and validation rules for RACI.

The [19.1 model-type guide](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/) documents Risk, Control and Control Objective Pools. [Insights](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) links relevant risks to mitigating controls, shows likelihood, impact, detection, value at risk, owner and required controls, and reports as-is/to-be maturity on control-objective relations. [Charts](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/) allow risk evaluation in bubble/matrix views. **Lila:** phase 4 needs catalog identities, scoring scale/provenance, control coverage and assessment history. A linked control is not evidence of effectiveness. **Unverified:** exact ADONIS scoring formulas, inherited/residual-risk semantics, and whether advanced GRC requires a module or ADOGRC integration in a particular edition. The [editions page](https://www.boc-group.com/en/adonis/comparison-of-editions/) names GRC modules but its extracted checkmarks do not support per-edition assignment.

The [19.1 Insights process widgets](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) show Performance Indicator state, current/target values, unit and periodicity, plus initiative state/progress/owner and process maturity attributes. The [17.0 Design & Document scenario](https://docs.boc-group.com/adonis/en/docs/17.0/user_manual/sta-100000/) describes target comparisons and KPI filters by owner/process. **Lila:** roadmap phase 5 should add observed date, measurement type and source, explicitly absent from these summarized widgets. **Unverified:** full indicator measurement schema, historical timeseries, automatic data ingestion and edition entitlement.

The [19.1 release workflow](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/) documents model drafts, methodical/business review, release, predecessor archiving, version history, change comments and optional validity/prolongation. Default model workflow covers Business Process Diagrams, Process Landscapes and Process objects; documents have a separate workflow. It is explicitly Enterprise/license-dependent and customizable. [Model comparison](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/compa-000000/) highlights model/object/connector/property changes and can compare a version to predecessor. [Validation](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/val-000000/) checks modeling guidance. **Lila:** phase 7 needs independent contracts for version identity, immutable releases, approval authorization, validity and semantic diff. The vendor's documented archive/reference behavior is a test case, not an automatic Lila design choice. **Unverified:** exact audit immutability and tenant-specific workflows.

The [rights administration page](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/rightswc-000000/) describes user/group permissions for content and system-role rights for functionality and metamodel elements. **Lila:** a future server must enforce write authorization server-side and audit transitions; local owner metadata alone is insufficient. **Unverified:** exact vendor permission inheritance and API authorization cases.

## 5. Modules, integration and newer-version signals

The [17.1 simulation manual](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/sim-000000/) documents cycle-time, cost and resource analysis; the current [vendor features page](https://www.boc-group.com/en/adonis/features/) presents simulation as an extension, and the [optimization offer](https://www.boc-group.com/en/adonis/solution/process-optimization/) calls it an add-on module. Do not equate a manual chapter with base entitlement. **Lila:** preserve existing simulation contracts and compare using explicit inputs/outputs, not marketing labels. **Unverified:** numerical parity or same simulation assumptions.

The [Process Mining Essentials offer](https://www.boc-group.com/en/marketplace/bpm/adonis-process-mining-essentials/) and [19.1 Insights documentation](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) place discovered paths, variants, conformance and directly-follows graphs behind a separate add-on and linked mining project. [Integration instructions](https://docs.boc-group.com/adonis/en/processmining/adonis-integration/) distinguish linking by project ID in 17.0/17.1 from direct project selection in 17.2+. **Lila:** roadmap phase 8 should retain observed-event provenance and adapter boundaries. **Unverified:** event schema, source connectors, mining algorithms and licensed packaging.

The [marketplace](https://knowledge.boc-group.com/en/marketplace/adonis/) distinguishes modules, integrations, mobile apps and training. Its listings include Process Portal, Strategy & Performance Management, Word Report Creator, Process Mining Essentials and Process Automation. The [features page](https://www.boc-group.com/en/adonis/features/) also positions Teams/SharePoint/Confluence, ADOIT and ADOGRC as integrations. **Lila:** keep these as separate ecosystem opportunities; do not fold their capabilities into an assumed core baseline. **Unverified:** current pricing, installation prerequisites and data-contract behavior per connector.

The [BOC Developer Portal API overview](https://developer.boc-group.com/adoxx/en/API-introduction/) lists metamodel, repository read/write/search, favorites and user APIs and OpenAPI specification. [Version index](https://developer.boc-group.com/adoxx/en/versions/) groups API documentation by product release. The [official examples repository](https://github.com/BOC-Group/developer-examples) illustrates authenticated calls; the [ADONIS REST API offer](https://knowledge.boc-group.com/en/module/adonis-rest-api/) says activation is needed. **Lila:** phase 8 catalog/model API and MCP should expose explicit authorization, identity and revision rules. **Unverified:** a complete live endpoint/field mapping and availability under any specific subscription.

The [17.1 news](https://docs.boc-group.com/adonis/en/docs/17.1/news/) adds multiple object-type coloring and licensed Properties enhancements. The [18.0 configurable dashboard manual](https://docs.boc-group.com/adonis/en/docs/18.0/user_manual/confda-00000/) and [19.0 product update](https://www.boc-group.com/en/adonis/whats-new/) describe configurable role dashboards and newer AI functions. These are **release-specific signals** for roadmap review, not baseline claims; the 2026-10-15 pass did not check them in 19.1. **Lila:** consider configurable dashboard definitions after initial fixed Insights. **Unverified:** actual availability by edition and migration behavior.

## Capability map (19.1, consulted 2026-10-15)

How to read this map:

- **Source and edition.** Every behavior below comes from the ADONIS 19.1 user manual
  (`https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/<page>/`) and the BOC
  [terminology page](https://developer.boc-group.com/adoxx/en/terminology/) (labelled ADONIS 19–20),
  consulted on 2026-10-15 through a summarizing reader and paraphrased here. **Nothing was observed
  hands-on.** *Documented* means a 19.1 page states it; *inferred* means our reading of a documented
  behavior that the page does not state. Edition: none of the capabilities mapped to S1–S7 is marked
  Enterprise-only in the pages read, but their per-edition availability was not established (see
  *Evidence and entitlement rules*); the Community edition's 256-model and 2,000-object limits and
  single user apply to any comparison.
- **Lila today.** Paths verified on `origin/main` at `02c8d83` (v1.0.0-beta.28) on 2026-10-16 with
  `git show`/`git grep`. RM-01 is the [repository contract](../REPOSITORY_CONTRACT.md): a
  specification, not code.
- **Scope keys.** S1–S7 are the "Org repository v1" scope agreed with the owner on 2026-10-16
  ([roadmap](../ROADMAP.md#org-repository-v1)); S8 is the next phase; OUT is excluded from v1.

### M1. One role, one identity (S1)

- **User problem:** the same role is typed differently in each process; renaming it means editing
  every task, and documents disagree.
- **Scenario (documented, Quick Start):** create the role "Receptionist" in a Roles group of the
  Object Catalogue, drag it into a task's properties and choose the relation "Responsible for
  execution" ([modqs-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modqs-00000/)).
- **Entities, relations, rules:** repository objects live in the Object Catalogue and are reused
  across models with the same attributes everywhere; modelling objects exist only in their model
  ([terminology](https://developer.boc-group.com/adoxx/en/terminology/),
  [objgra-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/objgra-00000/)). An
  interref is a relation shown in the properties like an attribute and may point to other models.
  Name and description are global; some attributes, such as colour, are model-specific
  ([adinf-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/)). Renaming
  to an existing name of the same type offers "Replace object", a merge in which incoming relations
  move and outgoing ones do not; copy and paste in the catalogue creates a new object
  ([mamoo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mamoo-00000/)).
- **Documented vs inferred:** the above is documented. Inferred: a rename shows in every model that
  uses the object (it follows from the global name; no page says it). Not stated: whether pasting in
  the graphical editor creates a reference or a copy.
- **Lila today:** `lila:responsibility` carries free strings `type` and `roleRef`
  ([`lila.moddle.json`](../../packages/engine/src/bpmn/lila.moddle.json)); `readAnnotations` in
  [`annotate.ts`](../../packages/engine/src/bpmn/annotate.ts) returns them as `{ type, roleRef }`;
  the [properties panel](../../apps/web/src/PropertiesPanel.tsx) edits `roleRef` as a text input.
  There is no catalog, so a role has no name of its own.
- **Gap:** role object, picker, rename in one place, adoption of the ids already typed.
- **Proposal (S1):** catalog `role` objects (RM-01 § 2.2) referenced by id from `roleRef`; a picker
  replaces the text field and writes the same attribute (§ 3.1); a rename writes only the object's
  file (§ 3.4); a typed id with no object can be adopted as that object's id (§ 2.3, § 3.4). Objects
  are never matched by name (§ 3.5), a deliberate difference from "Replace object": replacing is an
  explicit S2 command.
- **Verify:** the S1 acceptance — "Receptionist" in the catalog, referenced from tasks in three
  processes through the picker, renamed once, and all three show the new name; save the `.lila`,
  reopen, same id; v1 and v2 projects open unchanged; hand-typed `roleRef` ids can be adopted.

### M2. Where used, broken references and deletion (S2)

- **User problem:** before changing or deleting a role, system or document, nobody can see who uses
  it, and a deletion leaves dangling ids behind silently.
- **Scenario (documented):** right-click an object → *Show usage*: a references tree (valid and
  broken), usage in models and a usage overview, with filter, navigation and XLSX export
  ([usa-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/usa-000000/)).
- **Entities, relations, rules:** `Del` removes an occurrence from the model only; `Shift+Del`
  removes it from the model and the catalogue
  ([edimo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/edimo-00000/)).
  Deleting an object in use from the catalogue shows a notification and `Shift+Del` forces it;
  incoming references raise a warning to continue or cancel; a forced delete leaves broken
  references ([mamoo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mamoo-00000/)).
- **Documented vs inferred:** documented.
- **Lila today:** nothing. [`BPMN_EXTENSION.md`](../BPMN_EXTENSION.md) on `main` promises a lint
  warning for references missing from a catalog, but no code checks them (this PR corrects that
  claim).
- **Gap:** usage index, lint, deletion policy.
- **Proposal (S2):** the derived usage index of RM-01 § 4, answered identically by the app, the CLI
  and the MCP server; a lint warning for references not in the catalog, only in a repository that
  has one (§ 3.4); deleting an object in use is refused unless the user picks *replace with* or
  *remove the references*, each one undoable command (§ 3.4, `E-OBJETO-EN-USO`). This is stricter
  than ADONIS on purpose: Lila never leaves broken references behind.
- **Verify:** a role used by two processes and by one object field lists three uses; its deletion is
  refused; *replace with* rewrites every reference and undo restores them; an id missing from the
  catalog gives one warning in a version 3 repository and none in a v1 or v2 project.

### M3. RACI views (S3)

- **User problem:** answer "who does what" for one process and across processes, by name, and
  export it.
- **Scenario (documented):** the process Insights section "Involved Roles (RACI)" with a RACI Matrix
  quick action; the role dashboard "Assigned Tasks and Processes"; a Matrix chart of tasks × roles;
  "My BPM → RACI" in Read & Explore
  ([igh-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/),
  [modwv-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/)).
- **Entities, relations, rules:** task → role relations "Responsible for execution" (R),
  "Accountable for approving results" (A), "Cooperation/Participation" (C) and "To inform" (I)
  ([sta-200000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-200000/); letters in
  igh-000000).
- **Documented vs inferred:** documented. Inferred: how far the Matrix chart spans several processes
  depends on the dataset the user selects.
- **Lila today:** `raciMatrix` in
  [`process-document.ts`](../../packages/engine/src/process-document.ts) builds one process's matrix:
  elements with responsibilities as rows, raw `roleRef` ids as columns in order of first appearance.
  The CLI (`lila process raci`) and the MCP tool `get_raci_matrix` expose it, with CSV through
  `raciCsv` ([`agent-tools.ts`](../../packages/engine/src/project-fs/agent-tools.ts)). There is no
  RACI view in the app, no matrix across processes and no role names.
- **Gap:** app view, cross-process matrix, catalog names, XLSX.
- **Proposal (S3):** an app view of tasks × roles per process and across processes, with catalog
  names, exported as CSV/XLSX; per process its cells equal the engine's `raciMatrix`.
- **Verify:** for every process of a synthetic fixture the view's cells equal `raciMatrix`; the
  cross-process view is their union; the exports carry both names and ids.

### M4. Organizational units (S4)

- **User problem:** a role belongs to a department, and RACI is read department by department.
- **Scenario (documented):** the Working Environment Model is the organization chart and can be
  nested ([mty-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/)); an
  Organizational Unit has a type, a manager and a number of performers, and a Role "Belongs to" an
  Organizational Unit ([igh-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/)).
- **Documented vs inferred:** documented. A Position object was not found in the pages read.
- **Lila today:** nothing organizational. Simulation resource pools in the scenario
  ([`scenario.ts`](../../packages/engine/src/scenario.ts)) are capacity, not a directory.
- **Gap:** units, their hierarchy, a role's unit.
- **Proposal (S4):** catalog `unit` with `parentRef` and `role.unitRef` (RM-01 § 2.2), a unit tree,
  and a RACI filter by unit. A drawn organization chart and positions/persons are OUT.
- **Verify:** a three-level tree displays; a cycle shows broken at the repeated unit (§ 2.2); the
  filter keeps exactly the roles of the chosen unit (whether child units count is settled in the
  lot's issue).

### M5. From lane to task responsibilities (S5)

- **User problem:** the lanes already say who does each task; retyping RACI task by task is waste.
- **Scenario (documented):** a lane has a Resource reference; its context command "Assign
  responsibilities to tasks" copies it into the "Responsible for execution" relation of the tasks it
  contains ([edimo-00000, § edimo-09000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/edimo-00000/)).
- **Documented vs inferred:** documented. Inferred: lane membership alone assigns nothing; the
  command is explicit.
- **Lila today:** [`laneToPool.ts`](../../apps/web/src/laneToPool.ts) (LILA-334) bulk-assigns a
  lane's tasks to a **simulation** resource pool (`elements[task].resources` in the scenario), not
  to a RACI role.
- **Gap:** the same gesture for responsibilities.
- **Proposal (S5):** a lane command that writes `lila:responsibility type="R"` with a catalog role
  picked once on every task of the lane, as one undoable command, reporting the tasks that already
  have an R. Never automatic, and it never touches the scenario.
- **Verify:** a lane of four tasks, one already R for another role: three new entries, the report
  lists the fourth, undo restores, the scenario file is byte-identical.

### M6. Process hierarchy (S6)

- **User problem:** navigate from a top process down to the processes it calls, and see where a
  process is used.
- **Scenario (documented):** the Process Landscape is the navigation entry point; a Process object
  points to its "Referenced business process/process landscape"; a subprocess points to a subordinate
  diagram ([mty-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/),
  [igh-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/),
  [motoo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/motoo-00000/)). The
  *Hierarchy* button shows the shortest path to the top-level model, clickable, plus "Also referenced
  in", back/forward and opened views (motoo-00000). An optional one-way synchronization copies a
  diagram's owner, manager, reviewer, analyst, systems, risks and controls to its Process object
  ([adinf-00000, § adinf-09000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/),
  [procmap-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/procmap-000000/)).
- **Documented vs inferred:** documented. "Value chain" and "process group" were not found in 19.1.
- **Lila today:** in [`App.tsx`](../../apps/web/src/App.tsx) (#461) a double-click on a call activity
  opens the project's process whose BPMN process id is its `calledElement`, and warns when it is
  unresolved or the same process. There is no tree and no reverse "used in".
- **Gap:** derived tree, reverse paths.
- **Proposal (S6):** a process tree derived from call activities, with the "used in" paths of each
  process, every node clickable. A drawn landscape or value-chain diagram type is OUT.
- **Verify:** A calls B and C, D calls B: the tree shows A → B, A → C and D → B; B's "used in" lists A
  and D with their paths; a cycle is shown broken; an unresolved `calledElement` is listed.

### M7. Documents with names and a per-role report (S7)

- **User problem:** the Word/HTML document shows role ids such as `rol-1`, and nobody can print what
  one role does.
- **Scenario (documented):** PDF/RTF reports (standard, open questions, project summary, QM) and an
  offline HTML publication
  ([pubwc-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/pubwc-000000/),
  [red-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/red-000000/)); the role
  dashboard "Assigned Tasks and Processes" (igh-000000).
- **Documented vs inferred:** documented; the content of each report template was not checked.
- **Lila today:** [`process-document.ts`](../../packages/engine/src/process-document.ts) writes each
  responsibility as `R: <roleRef>`, the raw id.
- **Gap:** names, a report per role.
- **Proposal (S7):** resolve names when rendering (RM-01 § 3.1), unresolved ids shown as such; a
  per-role report of tasks and processes by RACI letter.
- **Verify:** rename a role and regenerate: the new name appears; an unresolved id appears marked;
  the per-role report equals that role's column in S3.

### M8. Risks and controls (S8, next phase)

- **Documented:** Risk, Control and Control Objective Pools; the "Assigned risks" relation; a Risk and
  Control Overview widget (igh-000000). Inferred: a risk–control matrix inside ADONIS itself (only
  documented in ADOGRC marketing).
- **Lila today:** `lila:riskRef` and `lila:controlRef` hold free ids; RM-01 § 2.5 reserves the types.
- **Proposal:** S8 in lot A4 with its own contract. Not in v1.

### Out of v1

| Capability | 19.1 source | Edition / note | Why not in v1 |
| --- | --- | --- | --- |
| Release workflow: draft → methodical review → business review → released → archived | [rwf-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/) | Enterprise only | OUT: release workflows (phase 7) |
| Governance roles: process owner, manager, methodical reviewer, analyst/designer | [sta-300000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-300000/) | Control & Release is Enterprise only | Phase 7; owner metadata does not prove approval |
| Object ownership "Responsible Person" (not RACI) | [adinf-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/) | — | OUT: positions/persons; RM-01 keeps `ownerRef` to a role |
| Organisation Portal | [sta-400000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-400000/) | Not offered to new customers since 15.0 | OUT: portal |
| Search & Analysis with saved queries | [searc-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) | — | OUT: saved queries |
| Bar, box-in-box, bubble and Gantt charts; configurable dashboards | [modwv-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/) | — | OUT: configurable dashboards/Insights (S3 is the one fixed matrix) |
| Dependency Modeller | [dep-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/dep-000000/) | — | OUT |
| Model comparison | [compa-000000 (17.1)](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/compa-000000/) | Not re-checked in 19.1 | OUT |
| Tabular editor with Excel paste; textual view | [tab-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tab-000000/), [tex-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tex-000000/) | — | OUT: tabular editor; the textual view has no S item |
| Document objects holding uploaded files (≤ 50 MB, configurable types) | [condms-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/condms-00000/) | Community: 1 MB PDF documents | OUT: attachments (RM-01 § 6 stays the contract) |
| Drawn organization chart, process landscape, IT System Model | [mty-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/) | — | OUT: drawn org-chart/landscape diagram types |
| Multi-user, comments, rights, SSO, REST API, ADOIT/ADOGRC sync, AI, mining, metamodel customization, KPI/Ishikawa/SIPOC, ISO document control | Sections 4–5 above (17.1 and vendor pages) | Mostly modules or integrations; not checked in 19.1 | OUT |

How we verify, overall: vendor behavior is a reference, not an oracle. Each S item is accepted
against synthetic Lila fixtures (the S1 scenario above, plus the checks in each block) and the
engine's own functions (`raciMatrix`, the RM-01 usage index), never against an ADONIS run, which
this research did not have.

## Roadmap review notes

The current roadmap includes the major repository, view, risk, KPI, governance and integration families. The public evidence suggests four items deserve an explicit acceptance decision when their phases are specified: (1) a readable textual process/work-instruction view distinct from table editing; (2) saved cross-object searches and analysis datasets; (3) document release/version behavior distinct from model release; and (4) configurable dashboards as a later option beyond fixed Insights. These are **candidate additions**, not vendor-parity requirements. Preserve Lila-specific decisions such as atomic bulk edits, source/date/kind for metrics and safe cross-model identities even where the ADONIS manual does not promise them.

## Practical verification still needed

1. Obtain a lawful test tenant and record exact ADONIS version, edition/plan, license, application library and enabled modules; inspect actual model/object menus and feature rights. Do not infer checks from the web edition table.
2. Build synthetic fixtures with two processes sharing a role, application, document, risk and control. Test creation, rename, replacement, deletion, usage and broken-reference behavior. Specifically test whether a shared versioned Process object and its references move to a new version when one or both containing models are released; then inspect export/import round trips.
3. Compare graphical, textual, tabular, RACI and Insights views on the same process. Test invalid multi-cell paste, permissions, undo, and how unsupported BPMN constructs appear.
4. Exercise draft/review/release, predecessor comparison, references, validity and document versioning with different user roles, if the license permits.
5. Confirm add-on boundaries for simulation, mining, AI, reporting, portal and integrations with vendor documentation or a quote; test API scopes and authentication only against authorized instances.

All vendor descriptions above are paraphrased. No private schema, proprietary screenshot or unlicensed behavior is represented as observed fact.
