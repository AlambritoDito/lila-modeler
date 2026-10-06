import { describe, expect, it } from 'vitest';
import type { ProcessIR } from '@lila-modeler/engine';

import {
  aFraccion,
  aPorcentaje,
  compuertasRepartibles,
  escribirPorcentaje,
  leerPorcentaje,
  pasoPorcentaje,
  repartoDe,
  repartoIgual,
  resumenReparto,
} from './repartoRutas';

/** XOR «Approved?» with Yes/No, an OR with three exits (one default on the XOR variant), a join. */
function ir(conDefecto = false): ProcessIR {
  return {
    id: 'P',
    name: 'P',
    nodes: {
      G: { type: 'xor', name: 'Approved?', incoming: ['f0'], outgoing: ['fSi', 'fNo'] },
      T1: { type: 'task', name: 'Prepare', incoming: ['fSi'], outgoing: [] },
      E1: { type: 'end', name: 'Rejected', incoming: ['fNo'], outgoing: [] },
      O: { type: 'or', name: '', incoming: [], outgoing: ['o1', 'o2', 'o3'] },
      J: { type: 'xor', name: 'Join', incoming: ['a', 'b'], outgoing: ['c'] },
    },
    flows: {
      fSi: { from: 'G', to: 'T1', name: 'Yes', isDefault: false },
      fNo: { from: 'G', to: 'E1', name: '', isDefault: conDefecto },
      o1: { from: 'O', to: 'T1', name: 'A', isDefault: false },
      o2: { from: 'O', to: 'T1', name: 'B', isDefault: false },
      o3: { from: 'O', to: 'T1', name: 'C', isDefault: false },
      c: { from: 'J', to: 'T1', name: '', isDefault: false },
    },
    source: { exporter: '', exporterVersion: '', originalIds: {}, warnings: [] },
  } as unknown as ProcessIR;
}

const escenario = (p: Record<string, number>): Record<string, unknown> => ({
  elements: Object.fromEntries(Object.entries(p).map(([f, v]) => [f, { probability: v }])),
});

describe('percent ↔ fraction', () => {
  it('round-trips two decimals exactly', () => {
    expect(aFraccion(70)).toBe(0.7);
    expect(aFraccion(30)).toBe(0.3);
    expect(aFraccion(33.33)).toBe(0.3333);
    expect(aPorcentaje(0.3)).toBe(30);
    expect(aPorcentaje(0.78)).toBe(78);
    for (let p = 0; p <= 100; p += 0.25) expect(aPorcentaje(aFraccion(p))).toBe(p);
  });

  it('reads what a person types', () => {
    expect(leerPorcentaje('70')).toBe(70);
    expect(leerPorcentaje(' 70 % ')).toBe(70);
    expect(leerPorcentaje('12,5')).toBe(12.5);
    expect(leerPorcentaje('100')).toBe(100);
    expect(leerPorcentaje('0')).toBe(0);
    // Out of range or not a plain number: invalid, never clamped.
    expect(leerPorcentaje('150')).toBeNull();
    expect(leerPorcentaje('-3')).toBeNull();
    expect(leerPorcentaje('0x46')).toBeNull();
    expect(leerPorcentaje('1e2')).toBeNull();
    expect(leerPorcentaje('4045')).toBeNull();
    expect(leerPorcentaje('')).toBe('vacio');
    expect(leerPorcentaje('abc')).toBeNull();
  });

  it('↑ four times on 50 leaves 70; ↓ stops at 0', () => {
    let v = 50;
    for (let i = 0; i < 4; i++) v = pasoPorcentaje(v, true);
    expect(v).toBe(70);
    expect(pasoPorcentaje(3, false)).toBe(0);
    expect(pasoPorcentaje(98, true)).toBe(100);
  });
});

describe('repartoDe', () => {
  it('lists only diverging XOR/OR gateways', () => {
    expect(compuertasRepartibles(ir())).toEqual(['G', 'O']);
  });

  it('a split that adds up', () => {
    const r = repartoDe(ir(), 'G', escenario({ fSi: 0.7, fNo: 0.3 }))!;
    expect(r.flujos.map((f) => [f.etiqueta, f.destino, f.porcentaje])).toEqual([
      ['Yes', 'Prepare', 70],
      ['Rejected', 'Rejected', 30],
    ]);
    expect(r).toMatchObject({ suma: 100, cuadra: true, diferencia: 0, arreglo: null });
    expect(resumenReparto(r)).toBe('Yes 70 % · Rejected 30 %');
  });

  it('70 typed over 78/22: the fix sets the other flow to 30', () => {
    const r = repartoDe(ir(), 'G', escenario({ fSi: 0.7, fNo: 0.22 }), 'fSi')!;
    expect(r).toMatchObject({ suma: 92, cuadra: false, diferencia: 8 });
    expect(r.arreglo).toEqual({ flujo: 'fNo', etiqueta: 'Rejected', porcentaje: 30 });
  });

  it('never proposes undoing the flow just typed into', () => {
    const r = repartoDe(ir(), 'G', escenario({ fSi: 0.78, fNo: 0.3 }), 'fNo')!;
    expect(r.arreglo).toEqual({ flujo: 'fSi', etiqueta: 'Yes', porcentaje: 70 });
  });

  it('an undeclared flow takes the remainder like the engine', () => {
    const r = repartoDe(ir(), 'G', escenario({ fSi: 0.7 }))!;
    expect(r.flujos[1]).toMatchObject({ porcentaje: null, efectivo: 30 });
    expect(r.cuadra).toBe(true);
    const nada = repartoDe(ir(), 'G', {})!;
    expect(nada.flujos.map((f) => f.efectivo)).toEqual([50, 50]);
  });

  it('a default flow is not the one the fix moves, and keeps no number when splitting evenly', () => {
    const r = repartoDe(ir(true), 'G', escenario({ fSi: 0.7, fNo: 0.5 }))!;
    expect(r.arreglo).toEqual({ flujo: 'fSi', etiqueta: 'Yes', porcentaje: 50 });
    expect(repartoIgual(r)).toEqual([{ flujo: 'fSi', porcentaje: 50 }]);
  });

  it('splits three exits evenly with the last one rounding', () => {
    const g3 = ir();
    g3.nodes['G']!.outgoing = ['o1', 'o2', 'o3'];
    expect(repartoIgual(repartoDe(g3, 'G', {})!)).toEqual([
      { flujo: 'o1', porcentaje: 33.33 },
      { flujo: 'o2', porcentaje: 33.33 },
      { flujo: 'o3', porcentaje: 33.34 },
    ]);
  });

  it('an inclusive gateway does not need to add up', () => {
    const r = repartoDe(ir(), 'O', escenario({ o1: 0.5 }))!;
    expect(r.flujos.map((f) => f.efectivo)).toEqual([50, 100, 100]);
    expect(r).toMatchObject({ cuadra: true, diferencia: 0, arreglo: null, nombre: 'O' });
  });
});

describe('escribirPorcentaje', () => {
  it('writes the exact fractions a hand-written file would have', () => {
    let delta: Record<string, unknown> = escenario({ fSi: 0.78, fNo: 0.22 });
    delta = escribirPorcentaje(delta, null, 'fSi', 70);
    delta = escribirPorcentaje(delta, null, 'fNo', 30);
    expect(delta).toEqual(escenario({ fSi: 0.7, fNo: 0.3 }));
    expect(JSON.stringify(delta)).toBe('{"elements":{"fSi":{"probability":0.7},"fNo":{"probability":0.3}}}');
  });

  it('removing a value only the child had drops the entry; one the parent defines writes null', () => {
    const delta = escenario({ fSi: 0.7 });
    expect(escribirPorcentaje(delta, null, 'fSi', null)).toEqual({ elements: {} });
    expect(escribirPorcentaje({}, escenario({ fSi: 0.7 }), 'fSi', null)).toEqual({ elements: { fSi: { probability: null } } });
  });
});
