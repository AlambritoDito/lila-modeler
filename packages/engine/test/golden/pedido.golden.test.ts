import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';

import { runResultSchema } from '../../src/result.schema.js';
import { PEDIDO_GOLDEN_PATH, renderPedidoGolden } from './pedido.js';

describe('golden determinista de examples/pedido (LILA-030)', () => {
  let seed42 = '';
  let seed43 = '';

  beforeAll(async () => {
    seed42 = await renderPedidoGolden(42);
    seed43 = await renderPedidoGolden(43);
  });

  test('seed 42 coincide byte a byte con el JSON versionado', () => {
    const expected = readFileSync(PEDIDO_GOLDEN_PATH, 'utf8');

    expect(seed42).toBe(expected);
    expect(expected.endsWith('\n')).toBe(true);
    expect(runResultSchema.safeParse(JSON.parse(expected)).success).toBe(true);
  });

  test('cambiar solo la semilla rompe el golden', () => {
    expect(seed43).not.toBe(seed42);
  });
});
