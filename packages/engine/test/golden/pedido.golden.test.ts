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
  }, 60_000); // ponytail: dos renders de 30 réplicas; con la máquina cargada superaban el hookTimeout de 10 s

  test('seed 42 coincide byte a byte con el JSON versionado', () => {
    const expected = readFileSync(PEDIDO_GOLDEN_PATH, 'utf8');

    expect(seed42).toBe(expected);
    expect(expected.endsWith('\n')).toBe(true);
    expect(expected).not.toContain('\r');
    expect(runResultSchema.safeParse(JSON.parse(expected)).success).toBe(true);
  });

  test('cambiar solo la semilla rompe el golden', () => {
    const expected = readFileSync(PEDIDO_GOLDEN_PATH, 'utf8');

    expect(seed43).not.toBe(expected);
  });

  /**
   * LILA-211: el idioma es una capa de presentación. Cambiar `locale` solo puede mover
   * `warnings[]`; cualquier número, clave u orden que se moviera sería una regresión del motor.
   */
  test('el idioma solo cambia `warnings`', async () => {
    const enJson: Record<string, unknown> = JSON.parse(readFileSync(PEDIDO_GOLDEN_PATH, 'utf8'));
    const esJson: Record<string, unknown> = JSON.parse(await renderPedidoGolden(42, { locale: 'es' }));

    expect((esJson['warnings'] as string[]).length).toBe((enJson['warnings'] as string[]).length);

    delete enJson['warnings'];
    delete esJson['warnings'];
    expect(esJson).toEqual(enJson);
    expect(Object.keys(esJson)).toEqual(Object.keys(enJson));
  }, 60_000);
});
