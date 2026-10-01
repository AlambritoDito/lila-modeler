/**
 * Watches the open project on disk (#539): agents write the `.lila` (or the project folder)
 * through the CLI and MCP, and the open app picks the change up. Pure Node, no Electron, so the
 * debounce and the own-write filter are tested with fake timers and real temporary folders.
 *
 * - A `.lila` is replaced whole by an atomic write (temporary file + `rename`), which gives the
 *   path a new inode: watching the file itself would go deaf after the first save. The containing
 *   folder is watched instead and events are filtered by the file's name.
 * - A project folder is watched recursively, and only the files a project is made of count
 *   (`relevantProjectFile`).
 * - Lila's own writes are told apart by `isOwn` (main passes `isOwnSnapshot` from
 *   `@lila-modeler/engine/project-fs`): what is on disk is exactly what this process last read or
 *   wrote. It is asked after the debounce, when the save that caused the event has recorded its
 *   snapshot.
 */
import { watch as fsWatch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import path from 'node:path';

/** How long the watcher waits for a burst of events (a save writes and renames) to settle. */
export const RELOAD_DEBOUNCE_MS = 300;

export interface ProjectWatcherOptions {
  /** The open project: a `.lila` file or a project folder, as main authorized it (`realpath`). */
  readonly target: string;
  readonly isLila: boolean;
  /** `true` when `file` on disk is what Lila itself last read or wrote. */
  readonly isOwn: (file: string) => Promise<boolean>;
  /** Something other than Lila changed the project. */
  readonly onChange: () => void;
  readonly debounceMs?: number;
  /** Test seam: `fs.watch`. */
  readonly watch?: typeof fsWatch;
}

export interface ProjectWatcher {
  readonly target: string;
  close(): void;
}

/**
 * The files of a project folder that make up the project (ADR-018, ADR-029). Left out: temporary
 * files of an atomic write (`*.tmp-…`), hidden files (`.DS_Store`), exports the user drops next to
 * the project, and `runs/*.result.json`, which the snapshot bookkeeping does not track and which
 * Lila itself writes on every save.
 * ponytail: a run written by an agent alone does not reload; the next scenario or model change does.
 */
export function relevantProjectFile(relative: string): boolean {
  const name = path.basename(relative);
  if (name.startsWith('.')) return false;
  return name === 'lila-project.json' || name.endsWith('.bpmn') || name.endsWith('.scenario.json');
}

export function watchProject(options: ProjectWatcherOptions): ProjectWatcher {
  const { target, isLila, isOwn, onChange } = options;
  const debounceMs = options.debounceMs ?? RELOAD_DEBOUNCE_MS;
  const watch = options.watch ?? fsWatch;
  const dir = isLila ? path.dirname(target) : target;
  const name = path.basename(target);
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const settle = async (): Promise<void> => {
    timer = null;
    const files = [...changed];
    changed.clear();
    for (const file of files) {
      // A folder that went away mid-check, a permission error: not a reason to reload.
      const own = await isOwn(file).catch(() => true);
      if (closed) return;
      if (!own) {
        onChange();
        return;
      }
    }
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(dir, { recursive: !isLila, persistent: false }, (_event, filename) => {
      if (closed || filename === null) return;
      const relative = filename.toString();
      if (isLila ? relative !== name : !relevantProjectFile(relative)) return;
      changed.add(isLila ? target : path.join(dir, relative));
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void settle(), debounceMs);
    });
    // A watched folder that is deleted or unmounted: stop quietly, the next save says what happened.
    watcher.on('error', () => close());
  } catch {
    // The folder cannot be watched (gone, no permission, unsupported): the app works as before.
    return { target, close: () => {} };
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    watcher.close();
  }

  return { target, close };
}
