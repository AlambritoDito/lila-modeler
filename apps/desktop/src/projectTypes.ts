/**
 * The project document contract. It used to be a hand-maintained MIRROR of
 * `apps/web/src/store/ProjectStore.ts`, kept in sync by eye and with a header asking for exactly
 * this: since ADR-027 the shapes live in `@lila/engine/project`, the one package both apps can
 * depend on, and this module only re-exports them so nothing else in `apps/desktop` had to move.
 *
 * The old copy weakened `StoredRun.result` to `unknown` to avoid depending on `@lila/engine`; the
 * shared definition keeps the engine's own `RunResult`. Main still never interprets it — it
 * serializes and deserializes it as it comes — but the `.lila` container needs to validate it, so
 * the dependency exists anyway and there is no reason to keep the type blind.
 */
export type { ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from '@lila/engine/project';
