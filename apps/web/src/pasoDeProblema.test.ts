import { describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';

import { agruparPorPaso, elementoDeProblema, pasoDeProblema, tareasSinDuracion } from './pasoDeProblema';

/** Just the parts of the IR this module reads: node types and the flow ids. */
const ir = {
  nodes: {
    Start_1: { type: 'start', name: 'Order in', outgoing: ['F1'] },
    Task_1: { type: 'task', name: 'Check', outgoing: ['F2'] },
    'Task.2': { type: 'task', name: '', outgoing: [] },
    Timer_1: { type: 'timer', name: 'Wait', outgoing: [] },
    Gw_1: { type: 'xor', name: 'OK?', outgoing: ['F3', 'F4'] },
    End_1: { type: 'end', name: '', outgoing: [] },
  },
  flows: { F1: {}, F2: {}, F3: {}, F4: {} },
} as unknown as ProcessIR;

describe('pasoDeProblema', () => {
  it('the sections of the scenario go to their own step', () => {
    expect(pasoDeProblema('run.duration', ir)).toBe('run');
    expect(pasoDeProblema('run', ir)).toBe('run');
    expect(pasoDeProblema('calendars.office.intervals[0].from', ir)).toBe('calendars');
    expect(pasoDeProblema('resources.clerk.capacity', ir)).toBe('resources');
    expect(pasoDeProblema('resources.clerk.capacity[1].calendar', ir)).toBe('resources');
  });

  it('an element field goes to the step that owns the field', () => {
    expect(pasoDeProblema('elements.Task_1.processingTime', ir)).toBe('times');
    expect(pasoDeProblema('elements.Task_1.processingTime.mean', ir)).toBe('times');
    expect(pasoDeProblema('elements.Task_1.fixedCost', ir)).toBe('times');
    expect(pasoDeProblema('elements.Task_1.resources[0].ref', ir)).toBe('resources');
    expect(pasoDeProblema('elements.Task_1.selection', ir)).toBe('resources');
    expect(pasoDeProblema('elements.Task_1.calendar', ir)).toBe('calendars');
    expect(pasoDeProblema('elements.Start_1.interTriggerTimer', ir)).toBe('arrivals');
    expect(pasoDeProblema('elements.F3.probability', ir)).toBe('routes');
    expect(pasoDeProblema('elements.F3.conditions[0].probability', ir)).toBe('routes');
  });

  it('a bare element entry goes to the step of its kind', () => {
    expect(pasoDeProblema('elements.Gw_1', ir)).toBe('routes');
    expect(pasoDeProblema('elements.Task_1', ir)).toBe('times');
    expect(pasoDeProblema('elements.Timer_1', ir)).toBe('times');
    expect(pasoDeProblema('elements.Start_1', ir)).toBe('arrivals');
    expect(pasoDeProblema('elements.F1', ir)).toBe('routes');
  });

  it('what no step owns answers null', () => {
    expect(pasoDeProblema('extends', ir)).toBeNull();
    expect(pasoDeProblema('model', ir)).toBeNull();
    expect(pasoDeProblema('', ir)).toBeNull();
    expect(pasoDeProblema('elements.End_1', ir)).toBeNull();
    expect(pasoDeProblema('elements.Ghost', ir)).toBeNull();
    // Without an IR the kind is unknown, but a field still names its step.
    expect(pasoDeProblema('elements.Task_1', null)).toBeNull();
    expect(pasoDeProblema('elements.Task_1.processingTime', null)).toBe('times');
  });

  it('an id with a dot is read whole when the IR has it', () => {
    expect(pasoDeProblema('elements.Task.2.processingTime', ir)).toBe('times');
    expect(elementoDeProblema('elements.Task.2.processingTime', ir)).toBe('Task.2');
  });
});

describe('elementoDeProblema', () => {
  it('names the element to select, and nothing outside elements or the model', () => {
    expect(elementoDeProblema('elements.Task_1.resources[0].ref', ir)).toBe('Task_1');
    expect(elementoDeProblema('elements.Gw_1', ir)).toBe('Gw_1');
    expect(elementoDeProblema('run.duration', ir)).toBeNull();
    expect(elementoDeProblema('elements.Ghost.processingTime', ir)).toBeNull();
    expect(elementoDeProblema('elements.Ghost', null)).toBe('Ghost');
  });
});

describe('tareasSinDuracion', () => {
  it('lists the tasks without a processingTime, entry or not, and never the other kinds', () => {
    const resuelto = { elements: { Task_1: { processingTime: { type: 'constant', value: 60 } }, Timer_1: {} } };
    expect(tareasSinDuracion(resuelto, ir)).toEqual(['Task.2']);
    expect(tareasSinDuracion({ elements: { Task_1: { resources: [] } } }, ir)).toEqual(['Task_1', 'Task.2']);
    expect(tareasSinDuracion({}, ir)).toEqual(['Task_1', 'Task.2']);
    expect(tareasSinDuracion({}, null)).toEqual([]);
  });
});

describe('agruparPorPaso', () => {
  it('splits by step and keeps the ones no step owns apart, in order', () => {
    const a = { ruta: 'run.duration' };
    const b = { ruta: 'elements.Task_1.processingTime' };
    const c = { ruta: 'extends' };
    const d = { ruta: 'elements.Task.2.processingTime' };
    const { porPaso, sinPaso } = agruparPorPaso([a, b, c, d], ir);
    expect(porPaso.run).toEqual([a]);
    expect(porPaso.times).toEqual([b, d]);
    expect(porPaso.arrivals).toEqual([]);
    expect(sinPaso).toEqual([c]);
  });
});
