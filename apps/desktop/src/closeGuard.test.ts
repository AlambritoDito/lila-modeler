import { describe, expect, it } from 'vitest';
import { decideClose } from './closeGuard.js';

describe('decideClose', () => {
  it('sin cambios, cierra sin importar la elección', () => {
    expect(decideClose(false, 'save', null)).toBe('close');
    expect(decideClose(false, 'discard', null)).toBe('close');
    expect(decideClose(false, 'cancel', null)).toBe('close');
    expect(decideClose(false, 'save', false)).toBe('close');
  });

  it('con cambios, "Cancelar" siempre se queda', () => {
    expect(decideClose(true, 'cancel', null)).toBe('stay');
  });

  it('con cambios, "Descartar" siempre cierra', () => {
    expect(decideClose(true, 'discard', null)).toBe('close');
  });

  it('con cambios, "Guardar" cierra solo si el guardado tuvo éxito', () => {
    expect(decideClose(true, 'save', true)).toBe('close');
  });

  it('con cambios, "Guardar" se queda si el guardado falló o no respondió a tiempo', () => {
    expect(decideClose(true, 'save', false)).toBe('stay');
    expect(decideClose(true, 'save', null)).toBe('stay');
  });
});
