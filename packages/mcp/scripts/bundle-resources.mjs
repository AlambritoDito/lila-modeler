/**
 * `prepack` (#637): copies the docs the MCP resources and prompt read (`BUNDLED_DOCS` in
 * `src/resources.ts`) into `dist/resources/`, keeping their paths under `docs/`, so the published
 * package serves the same files a checkout reads from the repository. Runs after the build.
 */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { BUNDLED_DOCS } = await import('../dist/resources.js');
const docs = fileURLToPath(new URL('../../../docs/', import.meta.url));
const target = fileURLToPath(new URL('../dist/resources/', import.meta.url));
rmSync(target, { recursive: true, force: true });
for (const file of BUNDLED_DOCS) {
  mkdirSync(dirname(`${target}${file}`), { recursive: true });
  copyFileSync(`${docs}${file}`, `${target}${file}`);
}
console.log(`bundled ${BUNDLED_DOCS.length} docs into dist/resources/`);
