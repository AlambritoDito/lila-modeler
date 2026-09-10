import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', '@lila/web'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, LILA_WEB_BASE: '/lila-modeler/app/' },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const output = path.join(root, '_site');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(path.join(root, 'site'), output, { recursive: true });
cpSync(path.join(root, 'apps/web/dist'), path.join(output, 'app'), { recursive: true });
cpSync(path.join(root, 'docs/design/en'), path.join(output, 'img'), { recursive: true });
