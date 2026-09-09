import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { version } from '../src/index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

test('el paquete engine se importa', () => {
  expect(version).toBe(manifest.version);
});
