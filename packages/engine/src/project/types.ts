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
import type { CatalogObject } from './catalog.js';

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
  /**
   * The process id (RM-01 § 3.2), `process-<12 of [0-9a-z]>`: the storage identity of the process,
   * written only in a version 3 manifest. A version 1 or 2 document has none until it becomes
   * version 3 (`asVersion3`), which gives each process a fresh one: nothing persisted can point at
   * it before. A version 3 encode gives one to a process that still lacks it.
   */
  readonly id?: string;
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
  readonly process?: { readonly id?: string; readonly slug: string; readonly name: string };
  /** The repository's other processes, in order (ADR-029). Absent: a one-process project. */
  readonly processes?: readonly ProcessDocument[];
  /**
   * `3` once the document is a version 3 repository (RM-01 § 1.3): read as one, or given its first
   * catalog object (`asVersion3`). It never goes back, even when the last object is removed.
   * Absent: version 1 or 2, decided by the number of processes as before.
   */
  readonly formatVersion?: 3;
  /**
   * The catalog objects (RM-01 § 2), objects of types this build does not know included. Part of the
   * document, so it travels with every save, autosave and recovery copy. A version 3 document read
   * from a file always has it, empty or not.
   */
  readonly catalog?: readonly CatalogObject[];
  /** The version 3 manifest's `limits` (RM-01 § 1.2), as found; written back unchanged. */
  readonly limits?: unknown;
  /** Invalid files preserved by the adapter; visible when opening. */
  readonly problems?: readonly ProjectProblem[];
  /**
   * `true` when this is a loose diagram: a `.bpmn` opened in a folder that is not a project
   * (LILA-072, `DesktopStore` only). Saving writes only that `.bpmn`; the footer warns about it.
   */
  readonly loose?: boolean;
}
