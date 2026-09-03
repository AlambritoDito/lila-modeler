import { expect, test } from 'vitest';
import { version } from '../src/index.js';

test('el paquete engine se importa', () => {
  expect(version).toBe('0.0.0');
});
