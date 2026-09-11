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

export interface ProjectDocument {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly model: {
    readonly id: string;
    readonly name: string;
    readonly xml: string;
    readonly revision: number;
  };
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  readonly runs: readonly StoredRun[];
  /** Invalid files preserved by the adapter; visible when opening. */
  readonly problems?: readonly ProjectProblem[];
  /**
   * `true` when this is a loose diagram: a `.bpmn` opened in a folder that is not a project
   * (LILA-072, `DesktopStore` only). Saving writes only that `.bpmn`; the footer warns about it.
   */
  readonly loose?: boolean;
}
