/**
 * Saving a run into a `.lila` (#538), so an agent's simulation is in the project the way the
 * app's is: `lila run --save` and `run_simulation` with `saveRun`. The run is built by the
 * engine's `storedRun` (the app builds its runs with the same function), so the app opens it as
 * the current run of its scenario.
 *
 * The write is `writeLilaProject`: atomic, under the cross-process lock, and refused if the file
 * changed since it was read. A refusal is not the end here — a run only appends — so the archive
 * is read again and the run appended to what is there now, as long as the model and the scenario
 * it ran are still the ones in the file. Two concurrent saves therefore both land, one after the
 * other; a save after somebody edited the model or that scenario is refused, as the run would
 * already be stale.
 */
import { scenarioSource } from '../cli-shared.js';
import type { RunResult } from '../core/result.js';
import { messages, type Locale } from '../messages/index.js';
import { isCurrentRun, storedRun, withStoredRun, type StoredRun } from '../project/index.js';
import type { ResolvedScenario } from '../scenario.js';
import { openLilaProcess, writeLilaProject, type LilaProcess } from './input.js';

/** How many times a save re-reads the file after another writer got there first, or held it. */
const ATTEMPTS = 8;

/**
 * Appends `run` to the runs of `input`'s process and writes the `.lila`. `run` must have been
 * taken on `input` (its revisions and XML); returns the process as it was written.
 */
export async function saveLilaRun(input: LilaProcess, run: StoredRun, locale: Locale = 'en'): Promise<LilaProcess> {
  const C = messages(locale).cli;
  let current = input;
  for (let attempt = 1; ; attempt++) {
    const process = current.process;
    if (!isCurrentRun(run, process.model.revision, process.scenarioRevisions) || process.model.xml !== run.inputs.xml) {
      throw new Error(C.lilaRunStale(input.file, run.scenarioName));
    }
    const document = withStoredRun(current.document, process.slug, run);
    try {
      await writeLilaProject(current, document, locale);
      return { ...current, document, process: { ...process, runs: [...process.runs, run] } };
    } catch (error) {
      // Another writer saved first (`E-CAMBIO-EXTERNO`) or still holds the lock (`E-ARCHIVO-OCUPADO`):
      // read the file again and append to what is there now.
      const code = (error as { code?: unknown }).code;
      if ((code !== 'E-CAMBIO-EXTERNO' && code !== 'E-ARCHIVO-OCUPADO') || attempt >= ATTEMPTS) throw error;
      current = await openLilaProcess(input.file, { process: process.slug, locale });
    }
  }
}

/** What `saveSimulationRun` stored. */
export interface SavedRun {
  readonly id: string;
  readonly file: string;
  readonly process: string;
  /** The scenario's entry name. */
  readonly scenario: string;
}

/**
 * Stores the result of simulating `scenarioArgument` (a scenario **of the archive**, by the names
 * `lila run` accepts) on `lila`'s process: the shared step of `lila run --save` and
 * `run_simulation` `saveRun`. `scenario` is the resolved scenario that ran (overrides included)
 * and is stored with `model: "model.bpmn"`, the path the app stores. A scenario read from a file
 * on disk has no entry in the project to belong to and is refused.
 */
export async function saveSimulationRun(
  lila: LilaProcess,
  scenarioArgument: string,
  scenario: ResolvedScenario,
  result: RunResult,
  locale: Locale = 'en',
): Promise<SavedRun> {
  const source = scenarioSource(scenarioArgument, lila, locale);
  if (!source.inArchive) throw new Error(messages(locale).cli.saveRunNeedsArchiveScenario(scenarioArgument));
  const run = storedRun({
    id: crypto.randomUUID(),
    scenarioName: source.label,
    result,
    xml: lila.process.model.xml,
    scenario: JSON.parse(JSON.stringify({ ...scenario, model: 'model.bpmn' })) as Record<string, unknown>,
    modelRevision: lila.process.model.revision,
    scenarioRevision: lila.process.scenarioRevisions[source.label] ?? 0,
  });
  await saveLilaRun(lila, run, locale);
  return { id: run.id, file: lila.file, process: lila.process.slug, scenario: source.label };
}
