import { readFileSync } from 'node:fs';
import { expectTypeOf, describe, expect, it } from 'vitest';
import { ATAJOS, acelerador, coincide, etiqueta, tooltip, type Atajo, type AtajoId, type AtajoLienzo, type AtajoPropio } from './atajos';
import { en } from './strings.en';
import { es } from './strings.es';

const tecla = (e: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, ...e });
const por = (id: string): Atajo => ATAJOS.find((a) => a.id === id)!;
const propias = ATAJOS.filter((a) => !('lienzo' in a));

describe('the shortcut map (#413)', () => {
  it('no two entries share a label, on macOS or elsewhere', () => {
    for (const mac of [true, false]) {
      const etiquetas = ATAJOS.map((a) => etiqueta(a, mac));
      expect(etiquetas.filter((x, i) => etiquetas.indexOf(x) !== i), `mac=${mac}`).toEqual([]);
    }
  });

  it('every own entry needs a handler (type) and every entry has a label in both catalogs', () => {
    // `App.tsx` builds `Record<AtajoPropio, () => void>`: this pins that the record's keys are
    // exactly the non-canvas entries, so a new one fails to compile there until it is handled.
    expectTypeOf<AtajoPropio | AtajoLienzo>().toEqualTypeOf<AtajoId>();
    expectTypeOf<Extract<AtajoPropio, AtajoLienzo>>().toBeNever();
    expectTypeOf<'renombrar' | 'modo:rutas' | 'irPanel'>().toExtend<AtajoPropio>();
    expect(propias.map((a) => a.id)).toContain('renombrar');
    for (const a of ATAJOS) {
      expect(en.atajos[a.id as keyof typeof en.atajos], a.id).toBeTypeOf('string');
      expect(es.atajos[a.id as keyof typeof es.atajos], a.id).toBeTypeOf('string');
      expect(en.atajos.grupos[a.grupo]).toBeTypeOf('string');
    }
  });

  it('matches digits by position (Spanish/French layouts) and never without the modifier', () => {
    const modelar = por('modo:modelar');
    expect(coincide(modelar, tecla({ key: '!', code: 'Digit1', metaKey: true }), true)).toBe(true);
    expect(coincide(modelar, tecla({ key: '1', code: 'Digit1', ctrlKey: true }), false)).toBe(true);
    expect(coincide(modelar, tecla({ key: '1', code: 'Digit1' }), true)).toBe(false);
    expect(coincide(modelar, tecla({ key: '1', code: 'Digit1', metaKey: true, altKey: true }), true)).toBe(false);
    expect(coincide(por('guardarComo'), tecla({ key: 'S', shiftKey: true, metaKey: true }), true)).toBe(true);
    expect(coincide(por('guardar'), tecla({ key: 'S', shiftKey: true, metaKey: true }), true)).toBe(false);
    // Zoom ignores Shift: `+` is Shift+= on a US keyboard.
    expect(coincide(por('zoomMas'), tecla({ key: '+', shiftKey: true, metaKey: true }), true)).toBe(true);
    expect(coincide(por('zoomMas'), tecla({ key: '=', metaKey: true }), true)).toBe(true);
    expect(coincide(por('renombrar'), tecla({ key: 'F2', metaKey: true }), true)).toBe(false);
  });

  it('F2, Esc and F6 do not match a held key', () => {
    for (const [id, key] of [['renombrar', 'F2'], ['cancelar', 'Escape'], ['irModos', 'F6']] as const) {
      expect(coincide(por(id), tecla({ key }), true), id).toBe(true);
      expect(coincide(por(id), tecla({ key, repeat: true }), true), id).toBe(false);
    }
    expect(coincide(por('irPanel'), tecla({ key: 'F6', shiftKey: true }), false)).toBe(true);
  });

  it('formats labels, tooltips and Electron accelerators per platform', () => {
    expect(etiqueta(por('guardarComo'), true)).toBe('⇧⌘S');
    expect(etiqueta(por('guardarComo'), false)).toBe('Ctrl+Shift+S');
    expect(etiqueta(por('ejecutar'), true)).toBe('⌘↩');
    expect(etiqueta(por('rehacer'), false)).toBe('Ctrl+Y');
    expect(tooltip(por('guardarComo'), true)).toBe(' (⇧⌘S)');
    expect(tooltip(por('ajustes'), false)).toBe(' (Ctrl+,)');
    expect(acelerador(por('guardarComo'))).toBe('CmdOrCtrl+Shift+S');
    expect(acelerador(por('modo:rutas'))).toBe('CmdOrCtrl+6');
  });

  it('docs/SHORTCUTS.md lists every key of the map, on both platforms', () => {
    const md = readFileSync(new URL('../../../docs/SHORTCUTS.md', import.meta.url), 'utf8');
    const faltan = ATAJOS.flatMap((a) => [etiqueta(a, true), etiqueta(a, false)]).filter((t) => !md.includes(`\`${t}\``));
    expect(faltan).toEqual([]);
  });
});
