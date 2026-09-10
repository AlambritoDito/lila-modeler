/** Exercise the actual npm artifact from a consumer outside the workspace. Never publishes. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = mkdtempSync(join(tmpdir(), 'lila-package-consumer-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run test:package');
function run(command, args, cwd = consumer) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
console.log(`Checking package in ${consumer}`);
run(process.execPath, [npmCli, 'pack', '--workspace', '@lila/engine', '--pack-destination', consumer], root);
const archives = readdirSync(consumer).filter((name) => name.endsWith('.tgz'));
assert.equal(archives.length, 1);
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const typescript = json(join(root, 'node_modules/typescript/package.json')).version;
const nodeTypes = json(join(root, 'node_modules/@types/node/package.json')).version;
run(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', join(consumer, archives[0]), `typescript@${typescript}`, `@types/node@${nodeTypes}`]);
const installed = join(consumer, 'node_modules/@lila/engine');
const manifest = json(join(installed, 'package.json'));
assert.equal(manifest.version, json(join(root, 'packages/engine/package.json')).version);
for (const file of ['LICENSE', 'NOTICE', 'README.md']) assert.ok(existsSync(join(installed, file)), file);
for (const file of ['src', 'test']) assert.ok(!existsSync(join(installed, file)), file);
const imports = [], runtime = [];
for (const [index, subpath] of Object.keys(manifest.exports).entries()) {
  const specifier = `@lila/engine${subpath.slice(1)}`;
  if (specifier.endsWith('.json')) {
    runtime.push(`assert.ok((await import('${specifier}', { with: { type: 'json' } })).default);`);
  } else {
    imports.push(`import * as entry${index} from '${specifier}'; void entry${index};`);
    runtime.push(`assert.ok(Object.keys(await import('${specifier}')).length, '${specifier}');`);
  }
}
writeFileSync(join(consumer, 'smoke.mts'), imports.join('\n'));
writeFileSync(join(consumer, 'runtime.mjs'), `import assert from 'node:assert/strict';\n${runtime.join('\n')}`);
run(process.execPath, ['runtime.mjs']);
for (const [resolution, module] of [['Node16', 'Node16'], ['Bundler', 'ESNext']]) {
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--moduleResolution', resolution, '--module', module, 'smoke.mts']);
}
const cli = join(installed, manifest.bin.lila);
const model = join(root, 'examples/pedido/model.bpmn');
const scenario = join(root, 'examples/pedido/as-is.scenario.json');
for (const [language, heading] of [['en', 'Usage:'], ['es', 'Uso:']]) {
  assert.ok(run(process.execPath, [cli, '--help', '--lang', language]).includes(heading));
  run(process.execPath, [cli, 'validate', model, '--lang', language]);
  for (const [label, executable] of [['installed', cli], ['checkout', join(root, 'packages/engine/bin/lila.js')]]) {
    const output = run(process.execPath, [executable, 'run', model, scenario, '--seed', '42', '--replications', '3', '--json', join(consumer, `${label}-${language}.json`), '--lang', language]);
    writeFileSync(join(consumer, `${label}-${language}.log`), output);
  }
  assert.deepEqual(readFileSync(join(consumer, `installed-${language}.json`)), readFileSync(join(consumer, `checkout-${language}.json`)));
}
console.log('Package consumer OK: runtime exports, JSON descriptor, Node16/Bundler types, English/Spanish CLI, identical simulation bytes.');
