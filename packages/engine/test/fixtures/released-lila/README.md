# Frozen `.lila` archives from released versions (#699)

These archives stand for files that released versions of Lila Modeler already wrote and that are
in people's hands. `docs/PROJECT_FORMAT.md` («Compatibility») promises that every such file keeps
opening and running. `test/project/released-archives.test.ts` (engine) and
`apps/web/src/project.released.test.ts` (web read path, jsdom) hold the promise:

1. open each archive;
2. run every scenario with seed 42 and two replications;
3. save, reopen and compare.

**Never regenerate, rewrite or "fix" these files.** The test pins their sha256. If a format
change makes one of them fail, the change needs a migration, not a new fixture. When the format
changes, add an archive written by the last release before the change. Do not replace the
existing ones.

## Provenance

All content is synthetic and invented for these fixtures (`docs/EXAMPLES_POLICY.md`): a service
desk process and a billing process, with made-up times, roles and costs. No coursework, case
statement or user file was used. The owner's report on #613 describes the shape of the legacy
archive; none of its content is reproduced here.

The bytes were produced on 2026-10-27 with the `.lila` writer (`encodeLila`) of 1.0.0-beta.29.
That writer has not changed since 1.0.0-beta.16: `git diff 08edde5 ab0a553 --
packages/engine/src/project/lila.ts` touches only the reader. The manifest's `engine` stamp names
the release each archive stands for.

| File | Stands for | Shape |
| --- | --- | --- |
| `legacy-loose-model-v1.lila` | 1.0.0-beta.16, «Save As» of the loose diagram `service-request.bpmn` before the #613 fix (up to 1.0.0-beta.23) | Version 1. The manifest's `model.name` and `as-is.scenario.json`'s `model` are `service-request.bpmn`, which is not an entry. The only model entry is `model.bpmn`. `to-be.scenario.json` has no `model` and `extends` AS IS. |
| `v1.lila` | 1.0.0-beta.29, a regular one-process project | Version 1: `model.bpmn`, AS IS and a TO BE that `extends` it. |
| `v2-two-processes.lila` | 1.0.0-beta.29, a repository with two processes | Version 2: `processes/service-request/` (AS IS and TO BE) and `processes/billing/` (AS IS). |

The archives hold no stored runs. A run whose result no longer matches the current schema is
excluded and explained in `problems`, without aborting the opening (`docs/PROJECT_FORMAT.md`).
