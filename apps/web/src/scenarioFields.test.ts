/**
 * #332. Las tres tablas puras del panel: qué campo aplica a qué elemento (§ 2.5), la unidad de
 * presentación (R1/R2) y el instante de `run.start` (R8). Sin DOM: lo que se comprueba aquí es
 * aritmética y una tabla, y un jsdom por delante solo la escondería.
 */
import { describe, expect, it } from 'vitest';

import { ElementSchema } from '@lila/engine/schema';

import {
  DESFASES,
  aSegundos,
  aUnidad,
  componerInstante,
  esTiempoEnSegundos,
  esUnidadTiempo,
  fieldsForKind,
  partesInstante,
} from './scenarioFields';

describe('fieldsForKind (§ 2.5, columna «Applies to»)', () => {
  it('una tarea ofrece su tiempo y sus recursos, y nunca los de un inicio ni la probabilidad', () => {
    const tarea = fieldsForKind('task')!;
    expect(tarea).toEqual(['processingTime', 'resources', 'selection', 'fixedCost', 'calendar']);
    expect(tarea).not.toContain('interTriggerTimer');
    expect(tarea).not.toContain('triggerCount');
    expect(tarea).not.toContain('probability');
  });

  it('un inicio ofrece las llegadas y un flujo solo la probabilidad', () => {
    expect(fieldsForKind('start')).toEqual([
      'interTriggerTimer',
      'triggerCount',
      'calendar',
      'fixedCost',
    ]);
    expect(fieldsForKind('flow')).toEqual(['probability']);
  });

  it('un temporizador tiene tiempo pero no recursos, y un fin solo su coste fijo', () => {
    expect(fieldsForKind('timer')).toEqual(['processingTime', 'calendar', 'fixedCost']);
    expect(fieldsForKind('timer')).not.toContain('resources');
    expect(fieldsForKind('end')).toEqual(['fixedCost']);
    expect(fieldsForKind('terminate')).toEqual(['fixedCost']);
  });

  it('una compuerta no tiene ningún campo de elemento; sus ramas se editan en su vista', () => {
    for (const compuerta of ['xor', 'or', 'and'] as const) {
      expect(fieldsForKind(compuerta)).toEqual([]);
    }
  });

  it('sin IR no se filtra nada: null es «no sé», no «ninguno»', () => {
    expect(fieldsForKind(null)).toBe(null);
  });

  it('todo lo que ofrece existe en el esquema, y ningún campo del esquema se queda huérfano', () => {
    const delEsquema = new Set(Object.keys(ElementSchema.shape));
    // Los reservados de § 4 no los ofrece nadie a propósito: el motor los rechaza con error.
    const reservados = new Set(['priority', 'preempt', 'batch', 'conditions']);
    const ofrecidos = new Set(
      (['task', 'start', 'timer', 'end', 'terminate', 'flow'] as const).flatMap(
        (c) => fieldsForKind(c)!,
      ),
    );
    for (const campo of ofrecidos) expect(delEsquema.has(campo)).toBe(true);
    for (const campo of delEsquema) {
      if (!reservados.has(campo)) expect(ofrecidos.has(campo)).toBe(true);
    }
  });
});

describe('unidad de presentación (R1, R2)', () => {
  it('el entero va y vuelve exacto en las cuatro unidades', () => {
    expect(aSegundos(5, 'min')).toBe(300);
    expect(aUnidad(300, 'min')).toBe(5);
    expect(aSegundos(480, 'min')).toBe(28_800);
    expect(aUnidad(28_800, 'min')).toBe(480);
    expect(aSegundos(8, 'h')).toBe(28_800);
    expect(aSegundos(1, 'day')).toBe(86_400);
    expect(aSegundos(42, 's')).toBe(42);
    expect(aUnidad(42, 's')).toBe(42);
  });

  it('el binario no deja cola: 0.1 min son 6 s, no 6.000000000000001', () => {
    expect(aSegundos(0.1, 'min')).toBe(6);
    expect(aUnidad(90, 'min')).toBe(1.5);
    expect(aUnidad(1, 'day')).toBe(0.000012);
  });

  it('esUnidadTiempo solo acepta las cuatro del formato', () => {
    expect(['s', 'min', 'h', 'day'].every(esUnidadTiempo)).toBe(true);
    expect(esUnidadTiempo('week')).toBe(false);
    expect(esUnidadTiempo(undefined)).toBe(false);
  });
});

describe('esTiempoEnSegundos', () => {
  it('las duraciones de la corrida sí; el instante y los enteros de control no', () => {
    expect(esTiempoEnSegundos(['run', 'duration'])).toBe(true);
    expect(esTiempoEnSegundos(['run', 'warmup'])).toBe(true);
    expect(esTiempoEnSegundos(['run', 'serviceLevel'])).toBe(true);
    expect(esTiempoEnSegundos(['run', 'start'])).toBe(false);
    expect(esTiempoEnSegundos(['run', 'replications'])).toBe(false);
    expect(esTiempoEnSegundos(['run', 'seed'])).toBe(false);
  });

  it('los parámetros de una distribución de tiempo sí; sus formas y sus contadores no', () => {
    const t = (...resto: (string | number)[]): boolean =>
      esTiempoEnSegundos(['elements', 'Task_1', 'processingTime', ...resto]);
    expect(t('value')).toBe(true);
    expect(t('min')).toBe(true);
    expect(t('mode')).toBe(true);
    expect(t('max')).toBe(true);
    expect(t('mean')).toBe(true);
    expect(t('sd')).toBe(true);
    expect(t('shape')).toBe(false);
    expect(t('scale')).toBe(false);
    expect(t('k')).toBe(false);
    expect(t('alpha')).toBe(false);
    expect(t('beta')).toBe(false);
    expect(t('n')).toBe(false);
    expect(t('p')).toBe(false);
    // La `user` empírica: el valor del punto es un tiempo, su probabilidad no.
    expect(t('points', 0, 'value')).toBe(true);
    expect(t('points', 0, 'probability')).toBe(false);
  });

  it('el dinero y lo que no es una distribución de tiempo se quedan fuera', () => {
    expect(esTiempoEnSegundos(['elements', 'Task_1', 'fixedCost'])).toBe(false);
    expect(esTiempoEnSegundos(['elements', 'Flow_1', 'probability'])).toBe(false);
    expect(esTiempoEnSegundos(['elements', 'Start_1', 'triggerCount'])).toBe(false);
    expect(esTiempoEnSegundos(['resources', 'cajero', 'costPerHour'])).toBe(false);
    expect(esTiempoEnSegundos(['resources', 'cajero', 'capacity'])).toBe(false);
    // `interTriggerTimer` sí, que es la otra distribución de tiempo.
    expect(esTiempoEnSegundos(['elements', 'Start_1', 'interTriggerTimer', 'mean'])).toBe(true);
  });
});

describe('run.start (R8)', () => {
  it('parte y recompone el instante del ejemplo sin cambiarlo', () => {
    const partes = partesInstante('2026-09-07T08:00:00-06:00');
    expect(partes).toEqual({ fechaHora: '2026-09-07T08:00:00', desfase: '-06:00' });
    expect(componerInstante(partes!.fechaHora, partes!.desfase)).toBe('2026-09-07T08:00:00-06:00');
  });

  it('rellena los segundos que el datetime-local se deja', () => {
    expect(componerInstante('2026-09-07T08:00', '-06:00')).toBe('2026-09-07T08:00:00-06:00');
    expect(partesInstante('2026-09-07T08:00-06:00')?.fechaHora).toBe('2026-09-07T08:00:00');
  });

  it('lo que no es un instante con desfase devuelve null: el panel cae a la entrada de texto', () => {
    expect(partesInstante('2026-09-07T08:00:00')).toBe(null);
    expect(partesInstante('ayer por la mañana')).toBe(null);
    expect(partesInstante(undefined)).toBe(null);
    expect(partesInstante(1757250000)).toBe(null);
  });

  it('los desfases van de −12:00 a +14:00 en medias horas y no repiten', () => {
    expect(DESFASES[0]).toBe('-12:00');
    expect(DESFASES.at(-1)).toBe('+14:00');
    expect(DESFASES).toContain('+05:30');
    expect(DESFASES).toContain('-06:00');
    expect(new Set(DESFASES).size).toBe(DESFASES.length);
  });
});
