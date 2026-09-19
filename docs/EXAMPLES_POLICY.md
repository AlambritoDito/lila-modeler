# Examples and regression fixtures

Lila is a BPMN modelling and simulation tool. Examples demonstrate how to build a model, set
assumptions, compare scenarios and interpret results. This policy applies to existing and future
cases, including documentation, screenshots, issue/PR text and attachments.

## Publication criteria

- Use synthetic workflows and invented input data, or reference material whose publication is
  permitted and whose source and attribution are documented. Public availability alone is not
  a licence to copy a source document.
- Keep private case statements, coursework, assessment questions, submitted answers and personal
  or confidential information outside the public repository. A change of title or names alone
  does not remove these concerns: review the narrative, input data, labels, IDs, outputs and images.
- For regression tests, reduce the behaviour to a neutral fixture with the smallest useful scope.
  Place it under the relevant package's `test/fixtures/` directory. Numerical expectations and
  analytical oracles are appropriate when they validate explicit engine rules or invariants.
- Keep user-facing examples under `examples/`. Their README must state the source or synthetic
  origin, purpose, assumptions, reproduction steps and known limitations. Preserve third-party
  attribution and licensing; do not relabel an attributed reference as an original synthetic case.
- Validate BPMN references, scenario resolution and the claimed behaviour. Keep comparisons
  reproducible, and document any change to element IDs that affects seeded random streams.

## Current case inventory

| Location | Purpose and provenance |
|---|---|
| `examples/pedido/` | Project restaurant-order demo and regression benchmark; see its README for assumptions and commands. |
| `examples/mm1/` | Synthetic queueing models with analytical Erlang C expectations and reproduction scripts. |
| `examples/bizagi-levels/` | Attributed reconstructions of public reference examples, with source URLs, expected values and documented differences. |
| `examples/bizagi-exports/` | Unmodified BPMN MIWG interoperability fixtures, with upstream commit and CC BY 3.0 attribution. |
| `packages/engine/test/fixtures/service-request/` | Neutral regression inputs for resource, outcome, UI and replay checks. |
| `packages/engine/test/fixtures/service-shared-denial.bpmn` | Neutral shared-path fixture for conditional-routing invariants. |
| `packages/engine/test/fixtures/zero-time-driver.ts` | Synthetic zero-time loop and finite-control regression models for #368; executed in timeout-protected child processes. |

This inventory describes the maintained purpose of the cases; provenance and permissions must
be reviewed again when source material is added or replaced. Update the inventory when adding a
new case family. Other focused test fixtures follow the same publication criteria.

## Private work and review

Keep private working files outside the repository, or in the ignored root `local/`, `private/`
or `exports/` directories. `.gitignore` does not remove tracked content or protect GitHub text,
attachments, commit history or existing clones. Review the staged diff and PR content together.

Before merging, confirm provenance, publication scope and the relevant acceptance checks in the
PR checklist. If provenance is unclear, prepare a new synthetic fixture before publishing.
