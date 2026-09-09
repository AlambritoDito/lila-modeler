# `lila:` BPMN extension and id policy

> Read this in: [Español](es/BPMN_EXTENSION.md)

Source of truth: `LILA_MODELER_ESTRUCTURA.md`, section 4 (ADR-012 "Element and process identity", ADR-013 "Where each piece of data lives", ADR-014 "A single extension namespace, defined once") and section 5 (the path to `lila.moddle.json` in the repository). This document is the operative reference for implementing the parser/serializer (`packages/engine/src/bpmn/parse.ts`) and the moddle descriptor (`packages/engine/src/bpmn/lila.moddle.json`); it does not repeat the ADRs' reasoning, it applies it.

This document adheres to ADR-012 and ADR-014; any discrepancy between this file and those ADRs is resolved by `LILA_MODELER_ESTRUCTURA.md`, and this file is corrected accordingly.

---

## 1. Namespace

```
xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
```

Decided in ADR-014. The IRI **does not need to resolve** (nothing is published at that URL) — it only needs to be stable and not change before M4. The `/1` suffix is the namespace's version, not the process's: it grows **additively** (new elements are added; an existing one is never removed or repurposed) as long as the namespace stays `/1`. An incompatible change would require `/2` — not anticipated before M4.

The namespace is declared **exactly once**, in `bpmn:definitions`, and is used the same way in:

- the editor (`apps/web`, via `BpmnModeler({ moddleExtensions: { lila } })`),
- the CLI and the engine (`packages/engine`),
- any future server (`packages/server`, M6).

All three read the same descriptor: `packages/engine/src/bpmn/lila.moddle.json` (section 5 of the structure document). There is no second copy of the descriptor anywhere else in the repository.

### Round-trip

bpmn-moddle preserves unknown namespaces when doing `saveXML` after `importXML` (verified with real BPSim, qbp, and Bizagi Modeler files — see `investigacion-2026-09-03/02-bizagi-simulacion.md` and `03-editor-bpmn.md`). This is what lets `lila:*` survive a tool that does not know it (a round trip through Camunda Modeler, Signavio, ADORIS, etc.) without that tool needing the descriptor. That behavior is tested in M4 against real tools; if one does not preserve foreign namespaces, plan B is an `annotations.json` sidecar keyed by element `id` with the same vocabulary (the same field names as the `lila:*` elements), outside the `.bpmn`.

---

## 2. v1 elements

Every extension element is a **child XML element**, never an attribute of the BPMN element it documents — the one exception is that each `lila:*` element can have its own attributes (e.g. `lila:responsibility` has the attributes `type` and `roleRef`). The reason for using elements rather than attributes at the insertion point is to allow **lists**: a `bpmn:task` can have several `lila:systemRef` (it uses more than one system), several `lila:input`/`lila:output`, and so on. An XML attribute cannot repeat on the same node.

All of them (except `versionTag`, see below) go inside `bpmn:extensionElements` of the BPMN element they document (task, event, gateway, lane, or `bpmn:process` itself):

```xml
<bpmn:task id="Task_7f3k2q1" name="Revisar solicitud">
  <bpmn:extensionElements>
    <lila:responsibility type="R" roleRef="rol-1"/>
    <lila:responsibility type="A" roleRef="rol-2"/>
    <lila:systemRef ref="sys-crm"/>
    <lila:documentRef ref="doc-solicitud"/>
    <lila:input ref="doc-solicitud"/>
    <lila:output ref="doc-solicitud-revisada"/>
  </bpmn:extensionElements>
  <bpmn:incoming>Flow_1</bpmn:incoming>
  <bpmn:outgoing>Flow_2</bpmn:outgoing>
</bpmn:task>
```

| Element | Attributes | What it documents | Points to |
|---|---|---|---|
| `lila:responsibility` | `type` (`R`\|`A`\|`C`\|`I`), `roleRef` | The element's RACI matrix: one row per responsible-party/role combination. An element can have several `lila:responsibility` (several roles, or the same role with a different `type`, which doesn't make sense but is not validated as an error — it's a warning). | `roleRef` → id in the role catalog (`catalog.json`, see ADR-013). |
| `lila:systemRef` | `ref` | System/application involved in the element. | id in the system catalog. |
| `lila:documentRef` | `ref` | Document associated with the element (input, output, or just a general reference). | id in the document catalog. |
| `lila:riskRef` | `ref` | Risk associated with the element. | id in the risk catalog. |
| `lila:controlRef` | `ref` | Control associated with the element (mitigates a risk). | id in the control catalog. |
| `lila:kpiRef` | `ref` | Indicator that measures the element. | id in the KPI catalog. |
| `lila:input` | `ref` | Document/data the element consumes. A semantic subset of `documentRef` with explicit direction; can coexist with `documentRef` for the same id. | id in the document catalog. |
| `lila:output` | `ref` | Document/data the element produces. | id in the document catalog. |
| `lila:versionTag` | `value` | See section 4 (process key). The only element that does **not** hang off a flow element — it hangs off `bpmn:process`. | — (free-form value, no catalog reference). |

All references (`roleRef`, and the `ref` of `systemRef`/`documentRef`/`riskRef`/`controlRef`/`kpiRef`/`input`/`output`) point to ids in the catalog (`catalog.json`, outside the `.bpmn` — ADR-013). A dangling reference (an id that does not exist in the catalog) is a **lint warning**, not a validation error — the catalog can be filled in after the diagram.

`versionTag` goes as a child of `bpmn:process`'s `bpmn:extensionElements` (not of `bpmn:definitions` nor of a task):

```xml
<bpmn:process id="credito-solicitud" isExecutable="false">
  <bpmn:extensionElements>
    <lila:versionTag value="1.3.0"/>
  </bpmn:extensionElements>
  ...
</bpmn:process>
```

A pattern copied from `zeebe:versionTag` (Camunda 8), cited as precedent in ADR-012.

### What is NOT v1

Simulation parameters (`processingTime`, `resources`, `interTriggerTimer`, etc.) are **not** part of this extension — they live in `*.scenario.json`, separate from the `.bpmn` (ADR-007, ADR-013; full format in `SCENARIO_FORMAT.md`). `lila:` documents the process (RACI, systems, documents, risks, controls, KPIs, version); it does not parameterize it for simulation.

---

## 3. Id policy (ADR-012)

### Element id

- The id of every BPMN element (`bpmn:task@id`, `bpmn:sequenceFlow@id`, etc.) is the **only key** for attaching business or simulation data. Never the visible name (`name`).
- Format: a valid **NCName** (an XML `Name` without `:`), generated by Lila as `<TypePrefix>_<random suffix>`, e.g. `Task_7f3k2q1`, `Gateway_a91nc0x`, `Flow_k2m8p1q`. The random suffix avoids collisions without needing a centralized counter.
- Prefix per type (not exhaustive, grows with the IR): `Start_`, `End_`, `Task_`, `Gateway_` (XOR/OR/AND share a prefix; the exact type lives in the IR, not in the id), `Timer_`, `Flow_`, `SubProcess_`.
- An existing id is **never regenerated** on import, export, or rename (renaming changes `name`, not `id`). Regenerating the id would break any external reference: `*.scenario.json` entries keyed by id, event log rows, catalog references.
- **A new id is generated** when copying/pasting an element — a copied element is a distinct entity and must not carry the original's data (`lila:*`, scenario) under the same id.
- **Reversible sanitization for foreign non-NCName ids**: some tools (Bizagi Modeler among them) can emit ids that are not valid NCNames. On import, Lila sanitizes those ids to NCName and stores the `sanitizedId → originalId` map in `ir.source.originalIds` (see `ProcessIR`'s shape in section 6 of the structure document), so a re-export can restore the original id if the destination tool needs it. Sanitization is deterministic (the same foreign id → the same sanitized id), so reimporting the same file does not generate different ids every time.

The editor applies the engine's same `sanitizeXmlIds` before handing the document to bpmn-js and
keeps the map per modeler instance. On export, it restores in a single pass both the declarations
and the references (`sourceRef`, `targetRef`, `default`, `bpmnElement`, and textual references),
including BPMNDI's. Opening is prepared on a candidate instance and only replaces the active canvas
once the import fully completes; a malformed XML or one with no renderable diagram does not replace
the previous XML, selection, services, or history. If the reader reported a semantic loss — for
example, a broken topological reference — export requires a visible decision with the warning's
detail, because the serialized tree can no longer reconstruct that content.

### Process id

- A process's logical key: **`bpmn:process@id` (ASCII slug) + `lila:versionTag`**. Example: `credito-solicitud` + `1.3.0`. This is the key that identifies "the same process, version X" across reimports and edits — it is not just `process@id`, because two versions of the same business process can (and generally should) coexist as distinct files or commits with the same `process@id`.
- `bpmn:process@id` is generated just like any other element id (NCName; see above), but a readable ASCII slug is recommended (`credito-solicitud`, not `Process_7f3k2q1`) because, besides being a technical key, it also works as a folder/file name in the project layout.
- `lila:versionTag` is a free-form string (semver is recommended, `1.3.0`, but not enforced by the schema — a user can version as `v2`, `2026-Q3`, etc.). Absent by default; its absence is not an error.

### `exporter` / `exporterVersion`

Every `.bpmn` that Lila writes declares, in `bpmn:definitions`:

```xml
<bpmn:definitions
    xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
    exporter="Lila Modeler"
    exporterVersion="0.1.0"
    ...>
```

`exporterVersion` is the `@lila/engine` package version that generated the file (always the engine's, even when it is the web app that saves it: a single helper writes both attributes, `marcarExportador` in `packages/engine/src/bpmn/ids.ts`) — it is used to diagnose behavior differences between engine versions, the same way bpmn-js and Camunda Modeler do with their own `exporter`/`exporterVersion`. Bizagi Modeler, by comparison, does **not** declare these attributes in its export (verified in 5 real files — see `investigacion-2026-09-03/02-bizagi-simulacion.md`), which makes it impossible to know which version of Bizagi Modeler generated a given file; Lila avoids that problem from day one.

---

## 4. Moddle descriptor (example)

Lives in `packages/engine/src/bpmn/lila.moddle.json` (the single definition — section 5 of the structure document). The shape it will have (v1 example, subject to the minor adjustments bpmn-moddle may require during implementation):

```json
{
  "name": "Lila",
  "uri": "https://lila-modeler.org/schema/bpmn/1",
  "prefix": "lila",
  "xml": {
    "tagAlias": "lowerCase"
  },
  "types": [
    {
      "name": "Responsibility",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "type", "isAttr": true, "type": "String" },
        { "name": "roleRef", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "SystemRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "DocumentRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "RiskRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "ControlRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "KpiRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "Input",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "Output",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "VersionTag",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "value", "isAttr": true, "type": "String" }
      ]
    }
  ]
}
```

Implementation notes (not normative, resolved in the ticket that creates the real file):

- `meta.allowedIn` documents the intent (everything except `VersionTag` goes in a flow element's `extensionElements`; `VersionTag` in `bpmn:process`'s); bpmn-moddle does not validate `allowedIn` at parse time — the real validation of "who can contain what" is done by `packages/engine/src/bpmn/validate.ts`.
- `associations` are not used because none of these types need to replace or extend an existing BPMN type; they are all new elements that hang off `bpmn:extensionElements`, which already accepts any `values[]` from a declared namespace.
- Every property is `isAttr: true` (attributes of the `lila:*` element, not its own children) — this keeps each element on a single line of XML and is enough for v1 because none of them needs free text or nesting.

---

## 5. Complete example fragment

`bpmn:extensionElements` of a task with RACI responsibility, catalog references, and process version:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
    xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
    id="Definitions_1"
    exporter="Lila Modeler"
    exporterVersion="0.1.0"
    targetNamespace="http://lila-modeler.org/schema/bpmn">

  <bpmn:process id="credito-solicitud" name="Solicitud de crédito" isExecutable="false">
    <bpmn:extensionElements>
      <lila:versionTag value="1.3.0"/>
    </bpmn:extensionElements>

    <bpmn:startEvent id="Start_9k2m1qa" name="Solicitud recibida">
      <bpmn:outgoing>Flow_a1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:task id="Task_7f3k2q1" name="Revisar solicitud">
      <bpmn:extensionElements>
        <lila:responsibility type="R" roleRef="rol-1"/>
        <lila:responsibility type="A" roleRef="rol-2"/>
        <lila:systemRef ref="sys-crm"/>
        <lila:documentRef ref="doc-solicitud"/>
        <lila:input ref="doc-solicitud"/>
        <lila:output ref="doc-solicitud-revisada"/>
        <lila:kpiRef ref="kpi-tiempo-revision"/>
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_a1</bpmn:incoming>
      <bpmn:outgoing>Flow_a2</bpmn:outgoing>
    </bpmn:task>

    <bpmn:endEvent id="End_k9x3m2z" name="Fin">
      <bpmn:incoming>Flow_a2</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:sequenceFlow id="Flow_a1" sourceRef="Start_9k2m1qa" targetRef="Task_7f3k2q1"/>
    <bpmn:sequenceFlow id="Flow_a2" sourceRef="Task_7f3k2q1" targetRef="End_k9x3m2z"/>
  </bpmn:process>
</bpmn:definitions>
```

Correspondence with the referenced catalog (`catalog.json`, outside this document — see `SCENARIO_FORMAT.md`/`LILA_MODELER_ESTRUCTURA.md` section 5 for its location): `rol-1`, `rol-2`, `sys-crm`, `doc-solicitud`, `doc-solicitud-revisada`, and `kpi-tiempo-revision` are ids that must exist there; if they don't, `validate(ir)` emits a dangling-reference warning for each one, not an error.

---

## 6. Consistency with the ADRs

- **ADR-012** (element and process identity): implemented in section 3 of this document — NCName with a type prefix, never regenerated, new on copy, reversible sanitization, process key = `process@id` + `versionTag`, `exporter`/`exporterVersion` in `definitions`.
- **ADR-014** (a single namespace, defined once): implemented in sections 1, 2, and 4 — a single IRI, a single descriptor shared by editor/CLI/server, elements (not attributes at the insertion point) to allow lists, additive growth, a round-trip verification plan in M4 with a fallback to `annotations.json`.

If in the future some decision in this document conflicts with a new or revised ADR, the ADR wins and this document is updated to reflect it (never the other way around).

---

## 7. Round-trip in the web app

The web app opens a `.bpmn` with bpmn-js and writes it back out with `saveXML`, i.e. with
bpmn-moddle serializing **the tree bpmn-moddle was able to read**. That fixes exactly what
survives an open-and-export round trip (LILA-192, `apps/web/src/modelerXml.ts`):

**Preserved**

- The file's original ids, including the ones that are not NCName. On import they are reversibly
  sanitized (section 3), and on export they are restored one by one, in attributes, in text, and
  in BPMNDI's references, with the original's quoting and entities.
- This document's `lila:` elements and foreign extensions (`bizagi:` and the like): the `lila`
  descriptor goes in `moddleExtensions`, and the rest travels as generic content.
- The diagram (`bpmndi`), the documentation, the names, and the topology.
- `exporter`/`exporterVersion` in `definitions`, which `marcarExportador` always rewrites.

**Not preserved**

- Id references that point to an element the file never declares — `messageRef`,
  `dataStoreRef`, `categoryValueRef`, `dataObjectRef` —: bpmn-moddle does not resolve them, they
  never reach the tree, and the exported file no longer carries them. The fixtures in
  `examples/bizagi-exports` are a real case.
- Whatever import discards with a warning about unparseable content or an unresolved topological
  reference: if it never entered the model, it cannot come back out in the XML.

**How it is reported** (never silently, which was LILA-192's complaint)

- The status bar shows the complete list as an **error** — not a warning —, with the ids:
  «N elementos o referencias se perderán al exportar: …» (N elements or references will be lost
  on export: …) (LILA-193).
- Everything that writes a `.bpmn` with loss first passes through the same dialog, with that same
  list and two ways out: «Exportar .bpmn» (Export .bpmn) offers «Exportar igualmente»/«Cancelar»
  (Export anyway / Cancel), and saving the project offers «Guardar igualmente»/«Cancelar»
  (Save anyway / Cancel). Cancel neither downloads nor writes anything to disk.
- `autorizarExportacion` cuts off with an error any lossy export that does not carry
  `aceptarPerdida`, i.e. that dialog's explicit yes: the XML that feeds the simulation — which
  the user never sees — never carries it, and the save snapshot only carries it after the yes.
- On Electron, canceling the dialog while saving returns «no se guardó» (not saved) to the
  window-close handler, so the close is cancelled and nothing is lost.

None of this rewrites the serializer: byte-for-byte fidelity with the source file is not a promise the app makes, and preserving broken attributes would require a serializer of its own.
