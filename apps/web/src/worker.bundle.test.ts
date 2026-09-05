/**
 * Criterio (c) de LILA-059: el bundle de `worker.ts` pesa menos de 100 KB minificado y no arrastra
 * bpmn-js, React, bpmn-moddle ni zod. Misma técnica que
 * packages/engine/test/worker-bundle.test.ts (esbuild, `platform: 'browser'`): aquí se apunta
 * `@lila/engine` directo al código fuente de `packages/engine/src/index.ts` — que ya es solo
 * `core/` (ver ese test) — para no depender de que `dist/` esté construido al correr esta prueba.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const ENGINE_SOURCE_ENTRY = resolve(REPOSITORY_ROOT, 'packages/engine/src/index.ts');
const WORKER_ENTRY = resolve(HERE, 'worker.ts');

const MAX_BYTES = 100 * 1024;
const FORBIDDEN = ['bpmn-js', 'bpmn-moddle', 'react', 'zod'];

describe('bundle del worker (LILA-059, criterio c)', () => {
  it('pesa menos de 100 KB minificado y no importa bpmn-js/React/bpmn-moddle/zod', async () => {
    const result = await build({
      alias: { '@lila/engine': ENGINE_SOURCE_ENTRY },
      bundle: true,
      entryPoints: [WORKER_ENTRY],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      minify: true,
      platform: 'browser',
      target: 'es2022',
      write: false,
    });

    const output = result.outputFiles[0];
    if (output === undefined) throw new Error('esbuild no produjo salida para worker.ts');

    expect(output.contents.byteLength).toBeLessThan(MAX_BYTES);

    const lowerCaseText = output.text.toLowerCase();
    for (const needle of FORBIDDEN) {
      expect(lowerCaseText.includes(needle), `el bundle no debería mencionar "${needle}"`).toBe(false);
    }

    const externalImports = Object.values(result.metafile.outputs).flatMap((entry) =>
      entry.imports.filter((dep) => dep.external).map((dep) => dep.path),
    );
    expect(externalImports).toEqual([]);
  });
});
