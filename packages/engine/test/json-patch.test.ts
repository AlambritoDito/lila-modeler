/**
 * The errors of `applyJsonPatch` (#645) come from the message catalog, in the caller's language:
 * English by default, Spanish with `es`, as `patch_scenario` and `lila scenario patch` pass it.
 */
import { describe, expect, test } from 'vitest';

import { applyJsonPatch } from '../src/json-patch.js';

const scenario = { version: 1, resources: { cajero: { capacity: 2 } } };

describe('applyJsonPatch', () => {
  test('an unsupported operation names it, in English by default and in Spanish with es', () => {
    const patch = [{ op: 'move', from: '/a', path: '/b' }];
    expect(() => applyJsonPatch(scenario, patch)).toThrow(
      'json patch: unsupported operation: "move" (only add/replace/remove/test; move/copy are not implemented).',
    );
    expect(() => applyJsonPatch(scenario, patch, 'es')).toThrow(
      'json patch: operación no soportada: "move" (solo add/replace/remove/test; move/copy no están implementadas).',
    );
  });

  test('a failed test names its path, in both languages', () => {
    const patch = [{ op: 'test', path: '/resources/cajero/capacity', value: 9 }];
    expect(() => applyJsonPatch(scenario, patch, 'en')).toThrow('json patch: test failed at /resources/cajero/capacity.');
    expect(() => applyJsonPatch(scenario, patch, 'es')).toThrow('json patch: test falló en /resources/cajero/capacity.');
  });

  test('a passing patch is applied to a copy', () => {
    const patched = applyJsonPatch(scenario, [
      { op: 'test', path: '/resources/cajero/capacity', value: 2 },
      { op: 'replace', path: '/resources/cajero/capacity', value: 3 },
    ]);
    expect(patched).toEqual({ version: 1, resources: { cajero: { capacity: 3 } } });
    expect(scenario.resources.cajero.capacity).toBe(2);
  });
});
