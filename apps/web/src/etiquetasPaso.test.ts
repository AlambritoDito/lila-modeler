import { describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';

import { calendarioEfectivo, mediaDistribucion, modeloEtiquetas } from './etiquetasPaso';
import { setLocale } from './i18n';

setLocale('en');

describe('mediaDistribucion', () => {
  it('gives the mean of each distribution of § 3', () => {
    expect(mediaDistribucion({ type: 'constant', value: 60 })).toBe(60);
    expect(mediaDistribucion({ type: 'uniform', min: 10, max: 30 })).toBe(20);
    expect(mediaDistribucion({ type: 'triangular', min: 0, mode: 30, max: 60 })).toBe(30);
    expect(mediaDistribucion({ type: 'exponential', mean: 720 })).toBe(720);
    expect(mediaDistribucion({ type: 'normal', mean: 5, sd: 1 })).toBe(5);
    expect(mediaDistribucion({ type: 'erlang', k: 2, mean: 9 })).toBe(9);
    expect(mediaDistribucion({ type: 'gamma', shape: 2, scale: 3 })).toBe(6);
    expect(mediaDistribucion({ type: 'weibull', shape: 1, scale: 4 })).toBeCloseTo(4, 6);
    expect(mediaDistribucion({ type: 'beta', alpha: 1, beta: 1, min: 0, max: 10 })).toBe(5);
    expect(mediaDistribucion({ type: 'binomial', n: 10, p: 0.5 })).toBe(5);
    expect(mediaDistribucion({ type: 'user', points: [{ value: 10, probability: 1 }, { value: 30, probability: 3 }] })).toBe(25);
    // Symmetric truncation keeps the mean; a cut on one side moves it.
    expect(mediaDistribucion({ type: 'truncatedNormal', mean: 10, sd: 2, min: 6, max: 14 })).toBeCloseTo(10, 6);
    expect(mediaDistribucion({ type: 'truncatedNormal', mean: 0, sd: 1, min: 0, max: 100 })).toBeCloseTo(0.7979, 3);
  });

  it('answers null for what is not a distribution or misses a parameter', () => {
    expect(mediaDistribucion(undefined)).toBeNull();
    expect(mediaDistribucion({ type: 'uniform', min: 1 })).toBeNull();
    expect(mediaDistribucion({ type: 'nope' })).toBeNull();
    expect(mediaDistribucion({ type: 'user', points: [] })).toBeNull();
  });
});

const ir = {
  nodes: {
    Start: { type: 'start', name: 'In', outgoing: [] },
    T1: { type: 'task', name: 'Check', outgoing: [] },
    T2: { type: 'task', name: 'Bake', outgoing: [] },
    W: { type: 'timer', name: 'Wait', outgoing: [] },
    G: { type: 'xor', name: '?', outgoing: [] },
  },
  flows: {},
} as unknown as ProcessIR;

const resuelto = {
  run: { baseTimeUnit: 'min' },
  calendars: { office: { intervals: [] } },
  resources: { clerk: { name: 'Clerk', capacity: 1, calendar: 'office' }, oven: { capacity: 2 } },
  elements: {
    Start: { interTriggerTimer: { type: 'exponential', mean: 720 } },
    T1: { processingTime: { type: 'constant', value: 4500 }, resources: [{ ref: 'clerk', quantity: 1 }] },
    T2: { resources: [{ ref: 'oven', quantity: 2 }], calendar: 'night' },
    W: { processingTime: { type: 'constant', value: 60 } },
  },
};

describe('modeloEtiquetas', () => {
  it('Times: «≈ mean» under tasks and timers, «No duration» under a task without one', () => {
    const m = modeloEtiquetas({ paso: 'times', resuelto, ir, unidad: 'min' });
    expect(m['T1']).toEqual({ texto: '≈ 1.25 h (75 min)', falta: false });
    expect(m['T2']).toEqual({ texto: 'No duration', falta: true });
    expect(m['W']).toEqual({ texto: '≈ 1 min', falta: false });
    expect(m['Start']).toBeUndefined();
    expect(m['G']).toBeUndefined();
  });

  it('Resources: the pool names with their quantity, or «No resource»', () => {
    const m = modeloEtiquetas({ paso: 'resources', resuelto, ir, unidad: 'min' });
    expect(m['T1']).toEqual({ texto: 'Clerk', falta: false });
    expect(m['T2']).toEqual({ texto: 'oven ×2', falta: false });
    expect(modeloEtiquetas({ paso: 'resources', resuelto: {}, ir, unidad: 'min' })['T1']).toEqual({ texto: 'No resource', falta: true });
  });

  it('Calendars: the element\'s calendar, else its pool\'s, else 24 h', () => {
    const m = modeloEtiquetas({ paso: 'calendars', resuelto, ir, unidad: 'min' });
    expect(m['T1']?.texto).toBe('office');
    expect(m['T2']?.texto).toBe('night');
    expect(modeloEtiquetas({ paso: 'calendars', resuelto: {}, ir, unidad: 'min' })['T1']?.texto).toBe('24 h');
    expect(calendarioEfectivo(resuelto, 'W')).toBeNull();
  });

  it('Arrivals: «every …» under the start event; Routes and Run draw nothing', () => {
    expect(modeloEtiquetas({ paso: 'arrivals', resuelto, ir, unidad: 'min' })['Start']?.texto).toBe('every 12 min');
    expect(modeloEtiquetas({ paso: 'routes', resuelto, ir, unidad: 'min' })).toEqual({});
    expect(modeloEtiquetas({ paso: 'run', resuelto, ir, unidad: 'min' })).toEqual({});
  });
});
