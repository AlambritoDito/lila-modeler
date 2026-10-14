# Organizational modelling research

> Read this in: [Español](../es/research/README.md).

Research commissioned on 2026-09-26 to refine Lila's [organizational roadmap](../ROADMAP.md).
Vendor and project sources were read on that date; statements about Lila's own status were
rechecked against commit `3c3ae07` (v1.0.0-beta.25) on 2026-10-14.
The work covers ADONIS and open-source alternatives in three complementary areas. It does not
change the accepted roadmap, approve a dependency, or implement product features.

| Investigation | Questions |
| --- | --- |
| [ADONIS capabilities](ADONIS-CAPABILITIES.md) | What models, objects, relationships, views, analysis and governance features are documented? Which depend on edition, module or integration? |
| [Open-source repositories](OPEN-SOURCE-REPOSITORIES.md) | How do Archi, Essential and Modelio handle reusable objects, relationships and multiple views? What is actually open source? |
| [Open-source GRC and integrations](OPEN-SOURCE-GRC-INTEGRATIONS.md) | How are risks, controls, assessments and evidence represented? Which external execution engines are relevant to Lila? |

## First synthesis

The three reports are complete as documentary research. They do not establish a single
open-source replacement for ADONIS or prove complete coverage of every edition.

- **ADONIS:** use as a functional reference for interconnected modeling, analysis and governance.
  The report identifies textual work instructions, saved queries/analysis datasets, separate
  document release behavior and configurable dashboards as candidates to clarify in the roadmap.
- **Archi:** prioritize the documented distinction between reusable model objects and graphical
  occurrences, plus reverse usage. Treat Git collaboration separately from live coediting.
- **Essential:** study typed organizational relationships and derived views; verify commercial
  boundaries for editors/APIs and each distribution component's license before adoption.
- **Modelio:** use as a BPMN interoperability test peer and a reference for cross-model queries;
  do not assume paid collaboration or optional plug-ins are in the open-source distribution.
- **CISO Assistant:** study risk/control/evidence relationships and a possible external adapter.
  Community and commercial features differ. Also resolve SimpleRisk's API edition ambiguity;
  eramba's current application OSS license remains unverified in this investigation.
- **Flowable:** retain only as a candidate external execution target pending a versioned adapter
  and portability tests. This research does not select or add an execution engine.

These are synthesis judgments based on the linked reports above. Detailed evidence, version
qualifiers, sources and unresolved tests remain in those reports. Suggested roadmap refinements
are not automatically accepted implementation commitments.

## How to read the findings

- **Documented** means supported by the cited primary source, not tested inside a running product.
- **Source-inspected** means the cited repository or code establishes the stated implementation detail.
- **Practically verified** requires a recorded hands-on test; a screenshot or product description does not suffice.
- **Unverified** identifies evidence gaps, edition ambiguity, inaccessible material or interoperability not tested.
- **Recommendation** is an inference for Lila, not a claim about a vendor's implementation.

Check the version, component and edition beside each claim. A free hosted edition, a public
repository and a complete open-source product are different things. Do not transfer commercial
features into the open-source column without evidence. Dates describe the source or inspection,
not a guarantee that the newest advertised release is the newest available build.

## Applying research to Lila

Use these findings to prepare specific roadmap contracts and acceptance examples. Evaluate four
separate possibilities: learn from a design, support its file format, integrate an external
service, or adopt code. A useful reference does not automatically justify a fork or dependency.

The current project decisions remain in force: [ADR-020](../DECISIONS.md#adr-020--licenses)
sets dependency constraints, while [ADR-029](../DECISIONS.md#adr-029--the-repository-one-lila-can-hold-a-whole-organization)
sets the repository direction. Workflow execution stays external; the simulation engine remains
independent.
A future adoption decision needs component-level license and technical review.

Hands-on follow-up should use synthetic data: shared roles across two processes, a reused
application, one document, and a risk/control/evidence chain. Test identity preservation,
rename/delete behavior, table/diagram synchronization, export/import losses and edit permissions.
Record failures as evidence rather than inferring support from shared notation or file extensions.
