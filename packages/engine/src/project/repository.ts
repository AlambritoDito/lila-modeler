/**
 * The repository view of a project (ADR-029, #498): a list of processes, each with the version 1
 * layout under `processes/<slug>/`. `ProjectDocument` keeps its first process in its top-level
 * fields so the one-process world did not have to change; these two functions are the only place
 * that knows how the list folds into that shape and back.
 */
import type { ProcessDocument, ProjectDocument } from './types.js';

/**
 * A slug is a folder name inside `processes/`: lowercase ASCII letters, digits and hyphens,
 * starting with a letter or digit. Strict on purpose — it has to be the same folder on macOS,
 * Windows and Linux and a safe ZIP entry name.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Names Windows refuses as a folder, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/;

export function isProcessSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value);
}

/**
 * A slug for `name` that is not in `taken`: accents dropped, anything else outside `[a-z0-9]`
 * turned into a hyphen, `process` when nothing is left, and `-2`, `-3`… on a collision.
 */
export function processSlug(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (base === '') base = 'process';
  if (RESERVED.test(base)) base = `${base}-process`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Every process of `document`, first one included. A one-process project (version 1) gets a
 * slug and a name derived from the project's name: that is what its folder will be called the
 * day a second process turns it into a repository.
 */
export function processesOf(document: ProjectDocument): ProcessDocument[] {
  const rest = document.processes ?? [];
  const first: ProcessDocument = {
    slug: document.process?.slug ?? processSlug(document.name, rest.map((p) => p.slug)),
    name: document.process?.name ?? document.name,
    model: document.model,
    scenarios: document.scenarios,
    scenarioRevisions: document.scenarioRevisions,
    runs: document.runs,
  };
  return [first, ...rest];
}

/**
 * `base` with its processes replaced by `list` (at least one). With a single process the result
 * is a plain version 1 document — no `process`, no `processes` — which is what keeps a project
 * that never grew a second process writing the exact version 1 layout.
 */
export function withProcesses(base: ProjectDocument, list: readonly ProcessDocument[]): ProjectDocument {
  const [first, ...rest] = list;
  if (first === undefined) throw new RangeError('a project has at least one process.');
  const { process: _process, processes: _processes, ...keep } = base;
  const top: ProjectDocument = {
    ...keep,
    model: first.model,
    scenarios: first.scenarios,
    scenarioRevisions: first.scenarioRevisions,
    runs: first.runs,
  };
  return rest.length === 0 ? top : { ...top, process: { slug: first.slug, name: first.name }, processes: rest };
}
