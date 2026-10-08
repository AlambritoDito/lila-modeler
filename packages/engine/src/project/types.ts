/**
 * The shape of a Lila project, shared by every mode (ADR-018, ADR-023, ADR-027).
 *
 * It used to live twice: once in `apps/web/src/store/ProjectStore.ts` (the contract the SPA
 * speaks) and once, hand-mirrored, in `apps/desktop/src/projectTypes.ts` (whose header asked for
 * exactly this move). Both now re-export from here, so the folder reader, the `.lila` container
 * and the browser store cannot drift apart.
 *
 * `StoredRun.result` is the engine's own `RunResult`: the type lives in this package, so there is
 * no reason for the copies to weaken it to `unknown` any more. The desktop main process still
 * never interprets it — it serializes it as it comes.
 */
import type { RunResult } from '../core/result.js';

/** An editable scenario; its content may still be an invalid draft. */
export type ScenarioDocument = Record<string, unknown>;

export interface StoredRun {
  readonly id: string;
  readonly scenarioName: string;
  readonly result: RunResult;
  readonly inputs: {
    readonly modelRevision: number;
    readonly scenarioRevision: number;
    readonly xml: string;
    readonly scenario: ScenarioDocument;
  };
}

/** A `*.scenario.json` or `runs/*.result.json` that could not be read; visible when opening. */
export interface ProjectProblem {
  readonly file: string;
  readonly message: string;
}

/** The BPMN model of one process: its XML plus what the manifest says about it. */
export interface ProjectModel {
  readonly id: string;
  readonly name: string;
  readonly xml: string;
  readonly revision: number;
}

/**
 * One process of a repository (ADR-029, #498): exactly what a version 1 project holds — a model,
 * its scenarios and its runs — plus the `slug` of its `processes/<slug>/` folder and the name the
 * canvas tab shows. The slug is the folder's identity and never changes on rename.
 */
export interface ProcessDocument {
  readonly slug: string;
  readonly name: string;
  readonly model: ProjectModel;
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  readonly runs: readonly StoredRun[];
}

/**
 * A Lila project. The top-level `model`/`scenarios`/`scenarioRevisions`/`runs` are its FIRST
 * process, so everything written against the one-process shape keeps working unchanged.
 *
 * A repository with more than one process (ADR-029, #498) adds `process` — the slug and name of
 * that first process — and `processes`, the others in order. Use `processesOf` and
 * `withProcesses` (`repository.ts`) instead of assembling these by hand. Without `processes` the
 * document is a version 1 project and is written as one, byte for byte.
 */
export interface ProjectDocument {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly model: ProjectModel;
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  readonly runs: readonly StoredRun[];
  /**
   * Slug and name of the first process: with `processes`, and also when read from a version 2
   * manifest that lists a single process (#517).
   */
  readonly process?: { readonly slug: string; readonly name: string };
  /** The repository's other processes, in order (ADR-029). Absent: a one-process project. */
  readonly processes?: readonly ProcessDocument[];
  /** Invalid files preserved by the adapter; visible when opening. */
  readonly problems?: readonly ProjectProblem[];
  /**
   * `true` when this is a loose diagram: a `.bpmn` opened in a folder that is not a project
   * (LILA-072, `DesktopStore` only). Saving writes only that `.bpmn`; the footer warns about it.
   */
  readonly loose?: boolean;
}
