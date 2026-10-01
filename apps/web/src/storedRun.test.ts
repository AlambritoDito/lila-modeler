/**
 * A run an agent saved in a `.lila` (#538, `lila run --save`) opens in the app as the current run
 * of its scenario: the app reads the archive with `readLila` and keeps the run `isCurrentRun`
 * accepts, the same engine function `App.tsx` uses for `corridaActual`.
 */
// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCurrentRun } from '@lila-modeler/engine/project';
import { expect, it } from 'vitest';

import { readLila } from './project';

it('a run saved by `lila run --save` is the current run when the app opens the .lila', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'lila-web-run-'));
  try {
    const file = join(dir, 'pedido.lila');
    copyFileSync(join(repo, 'examples/pedido.lila'), file);
    execFileSync(process.execPath, [join(repo, 'packages/engine/bin/lila.js'), 'run', file, 'as-is', '--seed', '42', '--replications', '1', '--save']);
    const doc = readLila(new Uint8Array(readFileSync(file)));
    const current = [...doc.runs].reverse().find((r) => r.scenarioName === 'as-is.scenario.json' && isCurrentRun(r, doc.model.revision, doc.scenarioRevisions));
    expect(current).toBeDefined();
    expect(current!.inputs.xml).toBe(doc.model.xml);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
