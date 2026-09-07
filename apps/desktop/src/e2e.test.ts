/** Tests de `e2eOverrides` — función pura, sin Electron ni sistema de archivos. */
import { describe, expect, it } from 'vitest';
import { e2eOverrides } from './e2e.js';

describe('e2eOverrides', () => {
  it('sin ninguna variable: {}, comportamiento idéntico al actual', () => {
    expect(e2eOverrides({})).toEqual({});
  });

  it('LILA_E2E_FOLDER con una ruta: se toma tal cual', () => {
    expect(e2eOverrides({ LILA_E2E_FOLDER: '/tmp/lila-e2e' })).toEqual({ folder: '/tmp/lila-e2e' });
  });

  it('LILA_E2E_FOLDER=cancel: folder es null (simula cancelar el diálogo)', () => {
    expect(e2eOverrides({ LILA_E2E_FOLDER: 'cancel' })).toEqual({ folder: null });
  });

  it('LILA_E2E_FOLDER vacío: se ignora', () => {
    expect(e2eOverrides({ LILA_E2E_FOLDER: '' })).toEqual({});
  });

  it.each(['save', 'discard', 'cancel'] as const)('LILA_E2E_CLOSE=%s: se toma tal cual', (choice) => {
    expect(e2eOverrides({ LILA_E2E_CLOSE: choice })).toEqual({ close: choice });
  });

  it('LILA_E2E_CLOSE con un valor inválido: se ignora', () => {
    expect(e2eOverrides({ LILA_E2E_CLOSE: 'quizas' })).toEqual({});
  });

  it('LILA_E2E_CLOSE vacío: se ignora', () => {
    expect(e2eOverrides({ LILA_E2E_CLOSE: '' })).toEqual({});
  });

  it('LILA_E2E_LOG con una ruta: se toma tal cual', () => {
    expect(e2eOverrides({ LILA_E2E_LOG: '/tmp/lila-e2e.log' })).toEqual({ logPath: '/tmp/lila-e2e.log' });
  });

  it('LILA_E2E_LOG vacío: se ignora', () => {
    expect(e2eOverrides({ LILA_E2E_LOG: '' })).toEqual({});
  });

  it('las tres variables juntas', () => {
    expect(
      e2eOverrides({
        LILA_E2E_FOLDER: '/tmp/lila-e2e',
        LILA_E2E_CLOSE: 'discard',
        LILA_E2E_LOG: '/tmp/lila-e2e.log',
      }),
    ).toEqual({ folder: '/tmp/lila-e2e', close: 'discard', logPath: '/tmp/lila-e2e.log' });
  });

  it('variables ausentes del entorno real (undefined explícito) se ignoran igual que si faltaran', () => {
    expect(e2eOverrides({ LILA_E2E_FOLDER: undefined, LILA_E2E_CLOSE: undefined, LILA_E2E_LOG: undefined })).toEqual(
      {},
    );
  });
});
