// Copia `apps/web/dist` a `apps/desktop/dist/web` tras `tsc --build` (ver `package.json`,
// script `build`). `fs.cpSync` en vez de `cp -R`: el mismo script sirve en Windows.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', '..', 'web', 'dist');
const target = path.resolve(here, '..', 'dist', 'web');

if (!existsSync(webDist)) {
  console.error(
    `No se encontró ${webDist}. Corre "npm run build -w @lila/web" antes de "npm run build -w @lila/desktop".`,
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(webDist, target, { recursive: true });
console.log(`Copiado ${webDist} -> ${target}`);
