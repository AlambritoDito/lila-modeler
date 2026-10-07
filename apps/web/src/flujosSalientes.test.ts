import { describe, expect, it, vi } from 'vitest';
import type { ProcessIR } from '@lila-modeler/engine';
import { flujosSalientes, MARCA_SALIENTE, marcarSalientes } from './flujosSalientes';

const ir = {
  nodes: {
    G: { type: 'xor', outgoing: ['F1', 'F2'] },
    T: { type: 'task', outgoing: ['F3'] },
  },
  flows: { F1: { from: 'G', to: 'T' }, F2: { from: 'G', to: 'T' }, F3: { from: 'T', to: 'G' } },
  source: { originalIds: { F2: '2Flow' } },
} as unknown as ProcessIR;

describe('the outgoing flows of the gateway being split (Lote M, C6)', () => {
  it('are the gateway\'s exits in canvas ids, also when one of them is the selection', () => {
    expect(flujosSalientes(ir, 'G')).toEqual(['F1', '2Flow']);
    expect(flujosSalientes(ir, 'F1')).toEqual(['F1', '2Flow']);
    expect(flujosSalientes(ir, '2Flow')).toEqual(['F1', '2Flow']);
    expect(flujosSalientes(ir, 'T')).toEqual([]);
    expect(flujosSalientes(ir, null)).toEqual([]);
    expect(flujosSalientes(null, 'G')).toEqual([]);
  });

  it('marks them and unmarks the previous ones, skipping what the canvas does not have', () => {
    const canvas = {
      addMarker: vi.fn((id: string) => { if (id === 'nada') throw new Error('no element'); }),
      removeMarker: vi.fn(),
    };
    marcarSalientes(canvas, ['F1', 'nada']);
    expect(canvas.addMarker).toHaveBeenCalledWith('F1', MARCA_SALIENTE);
    marcarSalientes(canvas, []);
    expect(canvas.removeMarker.mock.calls).toEqual([['F1', MARCA_SALIENTE]]);
  });
});
