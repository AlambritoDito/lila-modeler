import { describe, expect, test } from 'vitest';

import {
  capacityAt,
  compileCalendar,
  compileCapacity,
  nextCapacityRise,
  openTime,
  weekOffsetSeconds,
} from '../../src/core/calendar.js';
import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import type { EventLogRow } from '../../src/core/result.js';
import { runReplication, type ReplicationRun, type SimScenario } from '../../src/core/sim.js';

/**
 * QA adversarial de LILA-164 (`capacity` por tramos de calendario, R-CAL-11).
 *
 * Todos los escenarios son diminutos y con duraciones constantes: los `startedAt` se calculan a
 * mano en el comentario de cada test y se comparan con igualdad exacta, no con tolerancias.
 */

function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) {
    irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  }
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_Capacity',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const HOUR = 3600;
const DAY = 86400;

const TODOS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const cal = (from: string, to: string) => ({ intervals: [{ days: TODOS, from, to }] });

/** 24×7 escrito a mano. */
const SIEMPRE = cal('00:00', '24:00');
/** 08:00–20:00 todos los días. */
const DIA = cal('08:00', '20:00');
/** 20:00–08:00, partido en dos por R13. */
const NOCHE = {
  intervals: [
    { days: TODOS, from: '20:00', to: '24:00' },
    { days: TODOS, from: '00:00', to: '08:00' },
  ],
};
/** 09:00–10:00: la hora punta que sube la capacidad. */
const PICO = cal('09:00', '10:00');

/** Lunes 09:00: `t = 0` cae justo al empezar la hora punta. */
const LUNES_0900 = '2026-09-07T09:00:00-06:00';
/** Lunes 00:00: `t = 0` cae en mitad de la noche. */
const LUNES_0000 = '2026-09-07T00:00:00-06:00';

const IR_SIMPLE = makeIr(
  { Start: 'start', Tarea: 'task', End: 'end' },
  { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] },
);

/** Instancias de un elemento, deduplicadas (una AND emite una fila por pool). */
function instances(run: ReplicationRun, elementId: string): EventLogRow[] {
  const seen = new Set<string>();
  return run.rows.filter((row) => {
    if (row.elementId !== elementId || seen.has(row.activityInstanceId)) return false;
    seen.add(row.activityInstanceId);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * (1) Equivalencia exacta entre la forma numérica y el tramo único
 * ------------------------------------------------------------------ */

describe('(1) equivalencia byte a byte del tramo único con `capacity` numérica', () => {
  const base = (resources: SimScenario['resources']): SimScenario => ({
    run: { start: LUNES_0900, seed: 11, duration: 7 * DAY },
    calendars: { dia: DIA },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 400 } },
      Tarea: {
        processingTime: { type: 'exponential', mean: 1100 },
        resources: [{ ref: 'enfermera', quantity: 2 }],
      },
    },
    resources,
  });

  test('30 réplicas con cola: el `RunResult` completo (log incluido) es idéntico', () => {
    const numerico = base({ enfermera: { capacity: 3, calendar: 'dia' } });
    const porTramo = base({ enfermera: { capacity: [{ calendar: 'dia', capacity: 3 }] } });
    for (let replication = 0; replication < 30; replication++) {
      const a = runReplication(IR_SIMPLE, numerico, replication);
      const b = runReplication(IR_SIMPLE, porTramo, replication);
      expect(JSON.stringify(b), `réplica ${replication}`).toBe(JSON.stringify(a));
      expect(a.rows.length).toBeGreaterThan(100);
      // Hay cola de verdad: si no, el test no probaría nada del planificador.
      expect(a.rows.some((row) => row.startedAt !== null && row.startedAt > row.enabledAt)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * (2) La subida drena la cola en el instante exacto del evento
 * ------------------------------------------------------------------ */

describe('(2) subida de capacidad a mitad de cola', () => {
  /** `siempre` = 1 unidad las 24 h; `pico` = 2 más entre 09:00 y 10:00 ⇒ 1 → 3 a las 09:00. */
  const scenario: SimScenario = {
    run: { start: '2026-09-07T08:00:00-06:00', seed: 1, duration: 3 * DAY },
    calendars: { siempre: SIEMPRE, pico: PICO },
    elements: {
      // 5 llegadas separadas 1 s, todas antes de las 09:00 (t = 3600).
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 5 },
      Tarea: { processingTime: { type: 'constant', value: 1000 }, resources: [{ ref: 'agente' }] },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'siempre', capacity: 1 },
          { calendar: 'pico', capacity: 2 },
        ],
      },
    },
  };

  test('los cinco arranques son los calculados a mano y el quinto cae en la subida', () => {
    const run = runReplication(IR_SIMPLE, scenario);
    const arranques = instances(run, 'Tarea').map((row) => row.startedAt);
    // t = 0 es las 08:00; llegadas en 0,1,2,3,4; capacidad 1 hasta t = 3600 (09:00) y 3 después.
    // T1 arranca en 0 (fin 1000), T2 en 1000, T3 en 2000, T4 en 3000 (fin 4000) y T5 **no**
    // espera a las 4000: a las 3600 la capacidad sube a 3 y la cola se drena en ese instante.
    expect(arranques).toEqual([0, 1000, 2000, 3000, 3600]);
  });
});

/* ------------------------------------------------------------------ *
 * (3) Bajada con tareas en curso: nadie se interrumpe y hay que vaciar
 * ------------------------------------------------------------------ */

describe('(3) bajada de capacidad con tareas en curso', () => {
  const ir = makeIr(
    {
      Start: 'start',
      Tarea: 'task',
      End: 'end',
      Start2: 'start',
      Espera: 'timer',
      Tarde: 'task',
      End2: 'end',
    },
    {
      F1: ['Start', 'Tarea'],
      F2: ['Tarea', 'End'],
      G1: ['Start2', 'Espera'],
      G2: ['Espera', 'Tarde'],
      G3: ['Tarde', 'End2'],
    },
  );

  const scenario: SimScenario = {
    run: { start: LUNES_0900, seed: 1, duration: 3 * DAY },
    calendars: { siempre: SIEMPRE, pico: PICO },
    elements: {
      // 09:00–10:00 la capacidad es 3; el resto del día, 1.
      Start: { interTriggerTimer: { type: 'constant', value: 60 }, triggerCount: 3 },
      Tarea: { processingTime: { type: 'constant', value: 2 * HOUR }, resources: [{ ref: 'agente' }] },
      Start2: { triggerCount: 1 },
      Espera: { processingTime: { type: 'constant', value: 5400 } }, // llega a las 10:30
      Tarde: { processingTime: { type: 'constant', value: 600 }, resources: [{ ref: 'agente' }] },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'siempre', capacity: 1 },
          { calendar: 'pico', capacity: 2 },
        ],
      },
    },
  };

  const run = runReplication(ir, scenario);

  test('las tres tareas de 2 h arrancan dentro de la punta y ninguna se corta a las 10:00', () => {
    const filas = instances(run, 'Tarea');
    expect(filas.map((row) => row.startedAt)).toEqual([0, 60, 120]);
    expect(filas.map((row) => row.endedAt)).toEqual([7200, 7260, 7320]);
    // A las 10:30 (t = 5400) la capacidad ya es 1 y sigue habiendo 3 unidades ocupadas.
    const offset = weekOffsetSeconds(LUNES_0900);
    const horario = compileCapacity(
      [
        { calendar: compileCalendar(SIEMPRE, offset), capacity: 1 },
        { calendar: compileCalendar(PICO, offset), capacity: 2 },
      ],
      offset,
    );
    expect(capacityAt(horario, 5400)).toBe(1);
    const enCurso = filas.filter((row) => row.startedAt! <= 5400 && row.endedAt! > 5400);
    expect(enCurso.length, '`used` supera la capacidad hasta que terminen').toBe(3);
  });

  test('la cuarta espera a que terminen TODAS las sobrantes, no solo la primera', () => {
    const tarde = instances(run, 'Tarde');
    expect(tarde).toHaveLength(1);
    // Liberaciones en 7200, 7260 y 7320. Con capacidad 1 hace falta `used = 0`: arranca en 7320.
    expect(tarde[0]!.startedAt).toBe(7320);
  });
});

/* ------------------------------------------------------------------ *
 * (4) Calendarios solapados que suman
 * ------------------------------------------------------------------ */

describe('(4) solape que suma: 2 de día + 1 de 24×7', () => {
  const scenario: SimScenario = {
    run: { start: LUNES_0000, seed: 1, duration: 2 * DAY },
    calendars: { dia: DIA, siempre: SIEMPRE },
    elements: {
      Start: { triggerCount: 1 },
      Tarea: { processingTime: { type: 'constant', value: 600 }, resources: [{ ref: 'agente' }] },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'dia', capacity: 2 },
          { calendar: 'siempre', capacity: 1 },
        ],
      },
    },
  };

  test('una tarea nocturna arranca con la unidad 24×7 y sin `offHoursWait`', () => {
    const run = runReplication(IR_SIMPLE, scenario);
    const [fila] = instances(run, 'Tarea');
    // t = 0 es lunes 00:00: `dia` está cerrado, pero la unión es 24×7 y hay 1 unidad.
    expect(fila!.startedAt).toBe(0);
    expect(fila!.offHoursWait).toBe(0);
    expect(fila!.resourceWait).toBe(0);
  });

  test('la capacidad de día es 3 y la de noche 1', () => {
    const offset = weekOffsetSeconds(LUNES_0000);
    const horario = compileCapacity(
      [
        { calendar: compileCalendar(DIA, offset), capacity: 2 },
        { calendar: compileCalendar(SIEMPRE, offset), capacity: 1 },
      ],
      offset,
    );
    expect(capacityAt(horario, 9 * HOUR)).toBe(3);
    expect(capacityAt(horario, 2 * HOUR)).toBe(1);
    expect(horario.max).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * (5) Cierre del pool entero: hueco sin ningún calendario abierto
 * ------------------------------------------------------------------ */

describe('(5) hueco 12:00–13:00 sin ningún tramo abierto', () => {
  /** `manana` 08:00–12:00 con 3 unidades; `tarde` 13:00–17:00 con 1. Entre medias, nada. */
  const MANANA = cal('08:00', '12:00');
  const TARDE = cal('13:00', '17:00');
  /** Lunes 12:30: `t = 0` cae dentro del hueco. */
  const LUNES_1230 = '2026-09-07T12:30:00-06:00';

  const base = (quantity: number): SimScenario => ({
    run: { start: LUNES_1230, seed: 1, duration: 3 * DAY },
    calendars: { manana: MANANA, tarde: TARDE },
    elements: {
      Start: { triggerCount: 1 },
      Tarea: {
        processingTime: { type: 'constant', value: 1800 },
        resources: [{ ref: 'agente', quantity }],
      },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'manana', capacity: 3 },
          { calendar: 'tarde', capacity: 1 },
        ],
      },
    },
  });

  test('R-CAL-6: la concesión ocurre en el hueco y el trabajo empieza en `nextOpen`', () => {
    const [fila] = instances(runReplication(IR_SIMPLE, base(1)), 'Tarea');
    // t = 0 son las 12:30; abre a las 13:00 ⇒ 1800 s cerrados.
    expect(fila!.startedAt).toBe(1800);
    expect(fila!.endedAt).toBe(3600); // 1800 s de trabajo dentro de `tarde`
    expect(fila!.offHoursWait).toBe(1800);
    expect(fila!.resourceWait).toBe(0); // no faltó recurso, faltó horario
  });

  test('durante el cierre manda la capacidad del tramo que abre, no la del anterior', () => {
    // `quantity: 3` es válido (el máximo de la semana es 3, el de `manana`), pero a las 12:30 la
    // capacidad efectiva es la de las 13:00, que es 1: la tarea no puede arrancar hasta mañana.
    const [fila] = instances(runReplication(IR_SIMPLE, base(3)), 'Tarea');
    // 12:30 → 08:00 del martes: 19,5 h = 70200 s.
    expect(fila!.startedAt).toBe(19 * HOUR + 1800);
  });
});

/* ------------------------------------------------------------------ *
 * (6) Utilización: denominador Σ capacity_i × openTime_i
 * ------------------------------------------------------------------ */

describe('(6) utilización con capacidad por tramos', () => {
  /** Un pool siempre lleno: 1 unidad de día y 1 de noche ⇒ capacidad 1 constante, unión 24×7. */
  const ocupadoSiempre = (warmup: number): SimScenario => ({
    run: { start: LUNES_0000, seed: 1, duration: 3 * DAY, warmup },
    calendars: { dia: DIA, noche: NOCHE },
    elements: {
      Start: { triggerCount: 1 },
      Tarea: { processingTime: { type: 'constant', value: 30 * DAY }, resources: [{ ref: 'agente' }] },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'dia', capacity: 1 },
          { calendar: 'noche', capacity: 1 },
        ],
      },
    },
  });

  test('un pool ocupado al 100 % da utilización 1.0 exacta, no 1/24 de la semana', () => {
    const scenario = ocupadoSiempre(0);
    const run = runReplication(IR_SIMPLE, scenario);
    const metrics = aggregateReplication(IR_SIMPLE, run, scenario);
    expect(metrics.resources.agente!.utilization).toBe(1);
  });

  test('R-ARR-7: un caso nacido antes del `warmup` no cuenta en el numerador aunque ocupe el pool', () => {
    // Hallazgo documentado, no defecto de LILA-164: la ventana `[warmup, t_stop]` del denominador
    // es de reloj (R-CAL-9) mientras que el numerador solo suma casos medidos (R-ARR-7). Un pool
    // ocupado al 100 % por un caso anterior al warmup reporta utilización 0. Pasa igual con
    // `capacity` numérica y `calendar`, así que es de M3 y se deja fijado aquí, no corregido.
    const scenario = ocupadoSiempre(4 * HOUR); // 04:00 del lunes, dentro del turno de noche
    const metrics = aggregateReplication(IR_SIMPLE, runReplication(IR_SIMPLE, scenario), scenario);
    expect(metrics.resources.agente!.busyTime).toBe(0);
    expect(metrics.resources.agente!.utilization).toBe(0);

    const numerico: SimScenario = {
      ...scenario,
      calendars: { siempre: SIEMPRE },
      resources: { agente: { capacity: 1, calendar: 'siempre' } },
    };
    const mismoConEntero = aggregateReplication(IR_SIMPLE, runReplication(IR_SIMPLE, numerico), numerico);
    expect(mismoConEntero.resources.agente!.utilization).toBe(0);
  });

  test('3 de día y 1 de noche: el denominador es 3 × openTime(dia) + 1 × openTime(noche)', () => {
    const warmup = 10 * HOUR;
    const scenario: SimScenario = {
      run: { start: LUNES_0000, seed: 5, duration: 3 * DAY, warmup },
      calendars: { dia: DIA, noche: NOCHE },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 900 } },
        Tarea: { processingTime: { type: 'constant', value: 2400 }, resources: [{ ref: 'agente' }] },
      },
      resources: {
        agente: {
          capacity: [
            { calendar: 'dia', capacity: 3 },
            { calendar: 'noche', capacity: 1 },
          ],
        },
      },
    };
    const run = runReplication(IR_SIMPLE, scenario);
    const metrics = aggregateReplication(IR_SIMPLE, run, scenario);
    const offset = weekOffsetSeconds(LUNES_0000);
    const disponible =
      3 * openTime(compileCalendar(DIA, offset), warmup, run.stoppedAt)
      + 1 * openTime(compileCalendar(NOCHE, offset), warmup, run.stoppedAt);
    expect(metrics.resources.agente!.busyTime).toBeGreaterThan(0);
    expect(metrics.resources.agente!.utilization).toBeCloseTo(
      metrics.resources.agente!.busyTime / disponible,
      12,
    );
    // El `warmup` corta a las 10:00, dentro de la franja de día (08:00–20:00): el denominador
    // pierde exactamente las dos primeras horas de esa franja, no la franja entera ni nada.
    const sinWarmup =
      3 * openTime(compileCalendar(DIA, offset), 0, run.stoppedAt)
      + 1 * openTime(compileCalendar(NOCHE, offset), 0, run.stoppedAt);
    expect(sinWarmup - disponible).toBe(3 * 2 * HOUR + 1 * 8 * HOUR);
  });
});

/* ------------------------------------------------------------------ *
 * (7) `quantity` contra el máximo de la semana
 * ------------------------------------------------------------------ */

describe('(7) `quantity` y el máximo de la semana', () => {
  const base = (quantity: number): SimScenario => ({
    run: { start: LUNES_0000, seed: 1, duration: 3 * DAY },
    calendars: { dia: DIA, noche: NOCHE },
    elements: {
      Start: { triggerCount: 1 },
      Tarea: {
        processingTime: { type: 'constant', value: 600 },
        resources: [{ ref: 'agente', quantity }],
      },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'dia', capacity: 3 },
          { calendar: 'noche', capacity: 1 },
        ],
      },
    },
  });

  test('`quantity` 4 no cabe en ningún instante: `E-REC-CANTIDAD`', () => {
    expect(() => runReplication(IR_SIMPLE, base(4))).toThrow(/E-REC-CANTIDAD/);
  });

  test('`quantity` 3 es válido y espera a la subida de las 08:00', () => {
    const [fila] = instances(runReplication(IR_SIMPLE, base(3)), 'Tarea');
    // t = 0 es lunes 00:00 (noche, capacidad 1). La subida a 3 es a las 08:00.
    expect(fila!.startedAt).toBe(8 * HOUR);
    expect(fila!.offHoursWait).toBe(0); // la unión es 24×7: fue espera por recurso
    expect(fila!.resourceWait).toBe(8 * HOUR);
  });
});

/* ------------------------------------------------------------------ *
 * (9) Determinismo y common random numbers
 * ------------------------------------------------------------------ */

describe('(9) determinismo (R-DET-1, R-DET-3)', () => {
  const ir = makeIr(
    {
      Start: 'start',
      Tarea: 'task',
      End: 'end',
      Start2: 'start',
      Aparte: 'task',
      End2: 'end',
    },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'], G1: ['Start2', 'Aparte'], G2: ['Aparte', 'End2'] },
  );

  const base = (capacityPico: number): SimScenario => ({
    run: { start: LUNES_0900, seed: 3, duration: 2 * DAY },
    calendars: { siempre: SIEMPRE, pico: PICO },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 500 } },
      Tarea: { processingTime: { type: 'exponential', mean: 900 }, resources: [{ ref: 'agente' }] },
      Start2: { interTriggerTimer: { type: 'exponential', mean: 700 } },
      Aparte: { processingTime: { type: 'exponential', mean: 300 } },
    },
    resources: {
      agente: {
        capacity: [
          { calendar: 'siempre', capacity: 1 },
          { calendar: 'pico', capacity: capacityPico },
        ],
      },
    },
  });

  test('dos corridas idénticas dan bytes idénticos', () => {
    expect(JSON.stringify(runReplication(ir, base(2), 4))).toBe(JSON.stringify(runReplication(ir, base(2), 4)));
  });

  test('cambiar la capacidad de un tramo no mueve las muestras de los elementos no tocados', () => {
    const antes = instances(runReplication(ir, base(2), 4), 'Aparte');
    const despues = instances(runReplication(ir, base(5), 4), 'Aparte');
    expect(JSON.stringify(despues)).toBe(JSON.stringify(antes));
    expect(antes.length).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------ *
 * (10) El evento de calendario no alarga la corrida ni infla el heap
 * ------------------------------------------------------------------ */

describe('(10) coste del evento de subida de capacidad', () => {
  test('R-ARR-3: la corrida sin `duration` para cuando acaba el trabajo, no en la siguiente subida', () => {
    const scenario: SimScenario = {
      run: { start: LUNES_0900, seed: 1 },
      calendars: { siempre: SIEMPRE, pico: PICO },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 60 }, triggerCount: 4 },
        Tarea: { processingTime: { type: 'constant', value: 1000 }, resources: [{ ref: 'agente' }] },
      },
      resources: {
        agente: {
          capacity: [
            { calendar: 'siempre', capacity: 1 },
            { calendar: 'pico', capacity: 2 },
          ],
        },
      },
    };
    // Llegadas en 0, 60, 120 y 180 con capacidad 3 hasta las 10:00 (t = 3600): las tres primeras
    // arrancan al llegar y la cuarta al liberarse la primera (t = 1000). Todo acaba en t = 2000.
    const run = runReplication(IR_SIMPLE, scenario);
    expect(instances(run, 'Tarea').map((row) => row.endedAt)).toEqual([1000, 1060, 1120, 2000]);
    expect(run.stoppedAt).toBe(2000);
  });

  test('30 × 10 000 casos con tres turnos diarios en 30 días bajan de 10 s', () => {
    const scenario: SimScenario = {
      run: { start: LUNES_0000, seed: 9, duration: 30 * DAY },
      calendars: {
        manana: cal('06:00', '14:00'),
        tarde: cal('14:00', '22:00'),
        noche: { intervals: [{ days: TODOS, from: '22:00', to: '24:00' }, { days: TODOS, from: '00:00', to: '06:00' }] },
      },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 259 }, triggerCount: 10000 },
        Tarea: { processingTime: { type: 'exponential', mean: 500 }, resources: [{ ref: 'agente' }] },
      },
      resources: {
        agente: {
          capacity: [
            { calendar: 'manana', capacity: 3 },
            { calendar: 'tarde', capacity: 2 },
            { calendar: 'noche', capacity: 1 },
          ],
        },
      },
    };
    const t0 = Date.now();
    let casos = 0;
    for (let replication = 0; replication < 30; replication++) {
      casos += runReplication(IR_SIMPLE, scenario, replication, { log: false }).cases.length;
    }
    const elapsed = Date.now() - t0;
    expect(casos).toBeGreaterThan(200000);
    expect(elapsed, `${elapsed} ms`).toBeLessThan(10000);
  });
});
