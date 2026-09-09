import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import type { EventLogRow } from '../../src/core/result.js';
import {
  capacityAt,
  compileCalendar,
  compileCapacity,
  nextCapacityRise,
  openTime,
  weekOffsetSeconds,
} from '../../src/core/calendar.js';
import { runReplication, type ReplicationRun, type SimScenario } from '../../src/core/sim.js';

/**
 * Aceptación de LILA-041 (calendarios en llegadas y recursos), §12 de `docs/SEMANTICS.md`.
 *
 * Los IR se construyen a mano, como en `sim.test.ts`: la semántica de calendario no necesita
 * pasar por XML ni por zod, y así el test mide exactamente lo que dicen R-ARR-6, R-CAL-4 …
 * R-CAL-10 y R-EVT-3.
 *
 * Todos los escenarios usan `run.start` normativo de LILA-040 salvo donde se dice: el lunes
 * 2026-09-07, con lo que `t = 0` cae en un punto conocido de la semana.
 */

/** Construye un `ProcessIR` desde nodos y aristas; `incoming`/`outgoing` en orden de documento. */
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
    id: 'Process_Calendar',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;

/** Lunes 08:00; `t = 0` cae una hora antes de que abra la oficina. */
const MONDAY_0800 = '2026-09-07T08:00:00-06:00';
/** Lunes 09:00; `t = 0` cae justo en la apertura. */
const MONDAY_0900 = '2026-09-07T09:00:00-06:00';
/** Sábado 00:00; `t = 0` cae en fin de semana cerrado. */
const SATURDAY_0000 = '2026-09-05T00:00:00-06:00';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
/** L–V 09:00–18:00: 45 h abiertas por semana. */
const OFICINA = { intervals: [{ days: WEEKDAYS, from: '09:00', to: '18:00' }] };
const OPEN_PER_WEEK = 45 * HOUR;

/** Filas de un elemento, deduplicadas por instancia (una AND emite una fila por pool). */
function instances(run: ReplicationRun, elementId: string): EventLogRow[] {
  const seen = new Set<string>();
  return run.rows.filter((row) => {
    if (row.elementId !== elementId || seen.has(row.activityInstanceId)) return false;
    seen.add(row.activityInstanceId);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * (a) El caso normativo del ticket: 2 h que arrancan a las 17:30
 * ------------------------------------------------------------------ */

describe('(a) tarea de 2 h que arranca el lunes a las 17:30 (R-CAL-5, R-CAL-7)', () => {
  // Start → Timer(9,5 h, 24×7) → Task(2 h, pool con calendario) → End. El timer sitúa la
  // habilitación en las 17:30 exactas sin depender de cómo se generan las llegadas.
  const ir = makeIr(
    { Start: 'start', Espera: 'timer', Tarea: 'task', End: 'end' },
    { F1: ['Start', 'Espera'], F2: ['Espera', 'Tarea'], F3: ['Tarea', 'End'] },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, seed: 1 },
    calendars: { oficina: OFICINA },
    resources: { cajero: { capacity: 1, calendar: 'oficina' } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
      // 08:00 + 9,5 h = 17:30.
      Espera: { processingTime: { type: 'constant', value: 34200 } },
      Tarea: { processingTime: { type: 'constant', value: 2 * HOUR }, resources: [{ ref: 'cajero' }] },
    },
  };
  const run = runReplication(ir, scenario);
  const row = instances(run, 'Tarea')[0]!;

  test('arranca a las 17:30 sin esperar recurso: resourceWait = 0 (R-REC-8)', () => {
    expect(row.enabledAt).toBe(34200);
    expect(row.startedAt).toBe(34200);
    expect(row.resourceWait).toBe(0);
  });

  test('offHoursWait = 54000 s (las 15 h de 18:00 a 09:00) y termina el martes a las 10:30', () => {
    expect(row.offHoursWait).toBe(54000);
    // 26,5 h desde el lunes a las 08:00 = martes 10:30.
    expect(row.endedAt).toBe(95400);
    expect(row.status).toBe('completed');
  });

  test('identidad R-CAL-8: ended − enabled = resourceWait + offHoursWait + processing', () => {
    expect(row.endedAt! - row.enabledAt).toBe(row.resourceWait + row.offHoursWait + 2 * HOUR);
  });
});

/* ------------------------------------------------------------------ *
 * (b) Llegadas (R-ARR-6)
 * ------------------------------------------------------------------ */

describe('(b) llegadas con calendario (R-ARR-6)', () => {
  const ir = makeIr({ Start: 'start', End: 'end' }, { F1: ['Start', 'End'] });

  test('la primera llegada de un sábado se desplaza al lunes a las 09:00', () => {
    const run = runReplication(ir, {
      run: { start: SATURDAY_0000, seed: 1 },
      calendars: { oficina: OFICINA },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: WEEK }, triggerCount: 1, calendar: 'oficina' },
      },
    });

    // 2 días hasta el lunes 00:00 más 9 h hasta la apertura.
    expect(run.cases.map((record) => record.startedAt)).toEqual([2 * DAY + 9 * HOUR]);
  });

  test('la llegada cerrada se desplaza a la apertura y desde ahí sigue la cadencia (R-ARR-6)', () => {
    const run = runReplication(ir, {
      run: { start: MONDAY_0800, duration: 2 * DAY, seed: 1 },
      calendars: { oficina: OFICINA },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: HOUR }, calendar: 'oficina' },
      },
    });

    const arrivals = run.cases.map((record) => record.startedAt);
    // R-ARR-6 al pie de la letra: la llegada desplazada **no** se acumula con las que el reloj
    // habría producido durante el cierre; la siguiente muestra se toma desde el instante ya
    // desplazado. Con cadencia horaria salen nueve llegadas por día abierto, de 09:00 a 17:00.
    const lunes = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((hour) => hour * HOUR);
    expect(arrivals).toEqual([...lunes, ...lunes.map((t) => t + DAY)]);
    // La primera cae en la apertura del lunes, no en t = 0.
    expect(arrivals[0]).toBe(HOUR);
  });

  test('sin calendario en el start las llegadas son las de M2, empezando en t = 0', () => {
    const run = runReplication(ir, {
      run: { start: MONDAY_0800, duration: 5 * HOUR, seed: 1 },
      calendars: { oficina: OFICINA },
      elements: { Start: { interTriggerTimer: { type: 'constant', value: HOUR } } },
    });

    expect(run.cases.map((record) => record.startedAt)).toEqual([0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR]);
  });
});

/* ------------------------------------------------------------------ *
 * (c) Cola y utilización con llegadas 24×7 y recursos L–V 9–18
 * ------------------------------------------------------------------ */

describe('(c) llegadas 24×7 con recursos L–V 09:00–18:00', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: 2 * WEEK, seed: 1 },
    calendars: { oficina: OFICINA },
    resources: { cajero: { capacity: 1, calendar: 'oficina' } },
    elements: {
      // Una llegada por hora de reloj, sin calendario propio: la cola la crea el recurso.
      Start: { interTriggerTimer: { type: 'constant', value: HOUR } },
      Tarea: { processingTime: { type: 'constant', value: 60 }, resources: [{ ref: 'cajero' }] },
    },
  };
  const run = runReplication(ir, scenario);
  const rows = instances(run, 'Tarea');

  /** Instancias esperando en `t`: intervalo semiabierto `[enabledAt, startedAt)`. */
  const queueAt = (t: number): number =>
    rows.filter((row) => row.enabledAt <= t && t < (row.startedAt ?? Infinity)).length;

  test('la cola máxima se alcanza justo antes de la apertura del segundo lunes', () => {
    // El fin de semana acumula 63 h de llegadas (viernes 18:00 → lunes 09:00), más que las 15 h
    // de cualquier noche entre semana, así que el pico está en el lunes siguiente a las 09:00⁻.
    const secondMondayOpen = 7 * DAY + HOUR;
    const peak = queueAt(secondMondayOpen - 1);
    const everywhere = Math.max(...rows.map((row) => queueAt(row.enabledAt)));

    expect(peak).toBe(everywhere);
    expect(peak).toBe(63);
    // Y una hora después de abrir ya se ha desahogado: 60 s por caso vacían la cola deprisa.
    expect(queueAt(secondMondayOpen + HOUR)).toBeLessThan(10);
  });

  test('ninguna tarea arranca en horario cerrado y la espera cerrada no cuenta como recurso', () => {
    for (const row of rows) {
      // Las filas cortadas por el fin de la corrida se recortan a `observedUntil` y ese instante
      // no tiene por qué ser abierto: aquí interesan las que de verdad trabajaron.
      if (row.startedAt === null || row.status !== 'completed') continue;
      const weekSecond = (row.startedAt + 8 * HOUR) % WEEK;
      const dayOfWeek = Math.floor(weekSecond / DAY);
      const secondOfDay = weekSecond % DAY;
      expect(dayOfWeek).toBeLessThan(5);
      expect(secondOfDay).toBeGreaterThanOrEqual(9 * HOUR);
      expect(secondOfDay).toBeLessThan(18 * HOUR);
    }
    // R-REC-8: `resourceWait` solo mide tiempo abierto, así que nunca llega a las 15 h de cierre.
    expect(Math.max(...rows.map((row) => row.resourceWait))).toBeLessThan(9 * HOUR);
    expect(Math.max(...rows.map((row) => row.offHoursWait))).toBeGreaterThan(15 * HOUR);
  });

  test('la utilización usa las horas abiertas de la ventana como denominador (R-CAL-9)', () => {
    const result = aggregateReplication(ir, run, scenario);
    const cajero = result.resources.cajero!;

    // Dos semanas exactas de ventana ⇒ 90 h abiertas.
    expect(cajero.utilization).toBeCloseTo(cajero.busyTime / (2 * OPEN_PER_WEEK), 12);
    // Y es estrictamente mayor que la que daría el reloj de pared.
    expect(cajero.utilization).toBeGreaterThan(cajero.busyTime / (2 * WEEK));
  });
});

/* ------------------------------------------------------------------ *
 * (d) Utilización 8×5 = 24×7 escalada
 * ------------------------------------------------------------------ */

describe('(d) la utilización con calendario 8×5 es la de 24×7 escalada', () => {
  // Todo el trabajo cabe en el lunes por la mañana, así que el calendario no cambia una sola
  // asignación: solo el denominador. El timer de una semana obliga a la corrida a parar en
  // `t_stop` exacto (R-ARR-3) para que la ventana sea una semana redonda en los dos casos.
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end', Reloj: 'start', Largo: 'timer', FinReloj: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'], F3: ['Reloj', 'Largo'], F4: ['Largo', 'FinReloj'] },
  );
  const base: SimScenario = {
    run: { start: MONDAY_0900, duration: WEEK, seed: 1 },
    resources: { cajero: { capacity: 1 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 600 }, triggerCount: 48 },
      Tarea: { processingTime: { type: 'constant', value: 60 }, resources: [{ ref: 'cajero' }] },
      Reloj: { interTriggerTimer: { type: 'constant', value: WEEK }, triggerCount: 1 },
      Largo: { processingTime: { type: 'constant', value: WEEK } },
    },
  };
  const conCalendario: SimScenario = {
    ...base,
    calendars: { oficina: OFICINA },
    resources: { cajero: { capacity: 1, calendar: 'oficina' } },
  };

  const sinCal = aggregateReplication(ir, runReplication(ir, base), base);
  const conCal = aggregateReplication(ir, runReplication(ir, conCalendario), conCalendario);

  test('el trabajo es idéntico: mismo busyTime', () => {
    expect(conCal.resources.cajero!.busyTime).toBe(48 * 60);
    expect(conCal.resources.cajero!.busyTime).toBe(sinCal.resources.cajero!.busyTime);
  });

  test('la utilización se escala exactamente por 168 h / 45 h', () => {
    expect(sinCal.resources.cajero!.utilization).toBeCloseTo((48 * 60) / WEEK, 12);
    expect(conCal.resources.cajero!.utilization).toBeCloseTo((48 * 60) / OPEN_PER_WEEK, 12);
    expect(conCal.resources.cajero!.utilization / sinCal.resources.cajero!.utilization).toBeCloseTo(
      WEEK / OPEN_PER_WEEK,
      10,
    );
  });
});

/* ------------------------------------------------------------------ *
 * (e) Intersección AND y reserva desde la concesión
 * ------------------------------------------------------------------ */

describe('(e) AND con dos pools de calendario distinto (R-CAL-4, R-CAL-6)', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: DAY, seed: 1 },
    calendars: {
      manana: { intervals: [{ days: WEEKDAYS, from: '09:00', to: '18:00' }] },
      tarde: { intervals: [{ days: WEEKDAYS, from: '12:00', to: '20:00' }] },
    },
    resources: {
      cajero: { capacity: 1, calendar: 'manana' },
      horno: { capacity: 1, calendar: 'tarde' },
    },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 2 },
      Tarea: {
        processingTime: { type: 'constant', value: HOUR },
        resources: [{ ref: 'cajero' }, { ref: 'horno' }],
        selection: 'and',
      },
    },
  };
  const rows = instances(runReplication(ir, scenario), 'Tarea');

  test('la tarea usa la intersección 12:00–18:00, no el calendario de un pool suelto', () => {
    // t = 0 son las 08:00; 12:00 es t = 14400 y 13:00 es t = 18000.
    expect(rows[0]!.enabledAt).toBe(0);
    expect(rows[0]!.startedAt).toBe(4 * HOUR);
    expect(rows[0]!.endedAt).toBe(5 * HOUR);
  });

  test('la unidad queda reservada desde la concesión, no desde `started` (R-CAL-6)', () => {
    // El segundo caso se habilita en t = 100, cuando el primero ya tiene concedidas las dos
    // unidades aunque no empiece a trabajar hasta las 12:00. Si la reserva ocurriera en
    // `started`, los dos arrancarían a la vez a las 12:00.
    expect(rows[1]!.enabledAt).toBe(100);
    expect(rows[1]!.startedAt).toBe(5 * HOUR);
    // Solo cuentan como espera de recurso los segundos **abiertos** (R-REC-8): 12:00 → 13:00.
    expect(rows[1]!.resourceWait).toBe(HOUR);
    expect(rows[1]!.offHoursWait).toBe(5 * HOUR - 100 - HOUR);
  });
});

/* ------------------------------------------------------------------ *
 * (f) OR, timer y calendario `default`
 * ------------------------------------------------------------------ */

describe('(f) OR, timer y calendario `default` (R-CAL-10, R-EVT-3)', () => {
  test('una OR asignada al pool sin calendario corre 24×7', () => {
    const ir = makeIr(
      { Start: 'start', Tarea: 'task', End: 'end' },
      { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] },
    );
    const run = runReplication(ir, {
      run: { start: MONDAY_0800, duration: DAY, seed: 1 },
      calendars: { oficina: OFICINA },
      resources: { bot: { capacity: 1 }, cajero: { capacity: 1, calendar: 'oficina' } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Tarea: {
          processingTime: { type: 'constant', value: HOUR },
          // R-REC-6: con las dos alternativas libres gana la primera declarada.
          resources: [{ ref: 'bot' }, { ref: 'cajero' }],
          selection: 'or',
        },
      },
    });
    const row = instances(run, 'Tarea')[0]!;

    expect(row.resourceId).toBe('bot');
    expect(row.startedAt).toBe(0);
    expect(row.endedAt).toBe(HOUR);
    expect(row.offHoursWait).toBe(0);
  });

  test('un timer con calendario propio pausa y reanuda (R-EVT-3)', () => {
    const ir = makeIr(
      { Start: 'start', Espera: 'timer', Plazo: 'timer', End: 'end' },
      { F1: ['Start', 'Espera'], F2: ['Espera', 'Plazo'], F3: ['Plazo', 'End'] },
    );
    const run = runReplication(ir, {
      run: { start: MONDAY_0800, seed: 1 },
      calendars: { oficina: OFICINA },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Espera: { processingTime: { type: 'constant', value: 34200 } },
        Plazo: { processingTime: { type: 'constant', value: 2 * HOUR }, calendar: 'oficina' },
      },
    });

    // Mismo caso normativo que (a), pero sin recurso ninguno: el calendario es el del elemento.
    const plazo = instances(run, 'Plazo')[0]!;
    expect(plazo.startedAt).toBe(34200);
    expect(plazo.endedAt).toBe(95400);
    expect(plazo.offHoursWait).toBe(54000);
    // El timer anterior no declara calendario: corre en tiempo de reloj (R-EVT-3).
    const espera = instances(run, 'Espera')[0]!;
    expect(espera.endedAt).toBe(34200);
    expect(espera.offHoursWait).toBe(0);
  });

  test('un pool sin `calendar` toma el llamado `default`; un elemento no lo hereda', () => {
    const ir = makeIr(
      { Start: 'start', Tarea: 'task', Libre: 'timer', End: 'end' },
      { F1: ['Start', 'Tarea'], F2: ['Tarea', 'Libre'], F3: ['Libre', 'End'] },
    );
    const run = runReplication(ir, {
      run: { start: MONDAY_0800, duration: DAY, seed: 1 },
      calendars: { default: OFICINA },
      resources: { cajero: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Tarea: { processingTime: { type: 'constant', value: HOUR }, resources: [{ ref: 'cajero' }] },
        Libre: { processingTime: { type: 'constant', value: HOUR } },
      },
    });

    // El pool hereda `default`: la tarea espera a las 09:00 (t = 3600).
    const tarea = instances(run, 'Tarea')[0]!;
    expect(tarea.startedAt).toBe(HOUR);
    expect(tarea.endedAt).toBe(2 * HOUR);
    // El timer no declara calendario y no hereda `default`: corre 24×7 (R-EVT-3).
    const libre = instances(run, 'Libre')[0]!;
    expect(libre.endedAt).toBe(3 * HOUR);
    expect(libre.offHoursWait).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * (g) Preflight: nada observable antes del error
 * ------------------------------------------------------------------ */

describe('(g) preflight de calendarios antes de cualquier callback', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] },
  );
  const base = {
    Start: { interTriggerTimer: { type: 'constant' as const, value: 1 }, triggerCount: 5 },
  };

  /** Corre contando filas y pasos: un preflight correcto deja los dos en cero. */
  function observed(scenario: SimScenario): { rows: number; steps: number; error: string } {
    let rows = 0;
    let steps = 0;
    try {
      runReplication(ir, scenario, 0, { onEvent: () => void rows++, onStep: () => void steps++ });
    } catch (error) {
      return { rows, steps, error: error instanceof Error ? error.message : String(error) };
    }
    throw new Error('se esperaba un error de preflight');
  }

  test('E-CAL-DESCONOCIDO citando el pool', () => {
    const result = observed({
      run: { start: MONDAY_0800, duration: DAY },
      calendars: { oficina: OFICINA },
      resources: { cajero: { capacity: 1, calendar: 'nocturno' } },
      elements: { ...base, Tarea: { resources: [{ ref: 'cajero' }] } },
    });

    expect(result.error).toContain('E-CAL-DESCONOCIDO');
    expect(result.error).toContain('cajero');
    expect(result.error).toContain('nocturno');
    expect(result).toMatchObject({ rows: 0, steps: 0 });
  });

  test('E-CAL-DESCONOCIDO citando el elemento', () => {
    const result = observed({
      run: { start: MONDAY_0800, duration: DAY },
      calendars: { oficina: OFICINA },
      elements: { ...base, Tarea: { calendar: 'nocturno' } },
    });

    expect(result.error).toContain('E-CAL-DESCONOCIDO');
    expect(result.error).toContain('Tarea');
    expect(result).toMatchObject({ rows: 0, steps: 0 });
  });

  test('E-CAL-VACIO cuando la intersección de una AND es vacía, citando la tarea', () => {
    const result = observed({
      run: { start: MONDAY_0800, duration: DAY },
      calendars: {
        manana: { intervals: [{ days: WEEKDAYS, from: '09:00', to: '12:00' }] },
        noche: { intervals: [{ days: WEEKDAYS, from: '20:00', to: '24:00' }] },
      },
      resources: { cajero: { capacity: 1, calendar: 'manana' }, vigilante: { capacity: 1, calendar: 'noche' } },
      elements: {
        ...base,
        Tarea: { resources: [{ ref: 'cajero' }, { ref: 'vigilante' }], selection: 'and' },
      },
    });

    expect(result.error).toContain('E-CAL-VACIO');
    expect(result.error).toContain('Tarea');
    expect(result).toMatchObject({ rows: 0, steps: 0 });
  });

  test('la misma pareja en OR es válida: cada alternativa se comprueba por separado', () => {
    const scenario: SimScenario = {
      run: { start: MONDAY_0800, duration: DAY, seed: 1 },
      calendars: {
        manana: { intervals: [{ days: WEEKDAYS, from: '09:00', to: '12:00' }] },
        noche: { intervals: [{ days: WEEKDAYS, from: '20:00', to: '24:00' }] },
      },
      resources: { cajero: { capacity: 1, calendar: 'manana' }, vigilante: { capacity: 1, calendar: 'noche' } },
      elements: {
        ...base,
        Tarea: {
          processingTime: { type: 'constant', value: 60 },
          resources: [{ ref: 'cajero' }, { ref: 'vigilante' }],
          selection: 'or',
        },
      },
    };

    expect(() => runReplication(ir, scenario)).not.toThrow();
  });

  test('un calendario sin intervalos es E-CAL-VACIO citando el calendario', () => {
    const result = observed({
      run: { start: MONDAY_0800, duration: DAY },
      calendars: { vacio: { intervals: [] } },
      elements: base,
    });

    expect(result.error).toContain('E-CAL-VACIO');
    expect(result.error).toContain('vacio');
    expect(result).toMatchObject({ rows: 0, steps: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * (h) Invariantes transversales
 * ------------------------------------------------------------------ */

describe('(h) invariantes con calendarios', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', Plazo: 'timer', End: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'Plazo'], F3: ['Plazo', 'End'] },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: WEEK, seed: 7 },
    calendars: { oficina: OFICINA, ampliado: { intervals: [{ days: WEEKDAYS, from: '08:00', to: '20:00' }] } },
    resources: { cajero: { capacity: 2, calendar: 'oficina' } },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 1800 }, calendar: 'ampliado' },
      Tarea: { processingTime: { type: 'triangular', min: 60, mode: 300, max: 900 }, resources: [{ ref: 'cajero' }] },
      Plazo: { processingTime: { type: 'constant', value: 1200 }, calendar: 'oficina' },
    },
  };
  const run = runReplication(ir, scenario);

  test('R-CAL-8 se cumple en todas las filas completadas', () => {
    const completed = run.rows.filter((row) => row.status === 'completed');
    expect(completed.length).toBeGreaterThan(50);
    for (const row of completed) {
      const processing = row.endedAt! - row.enabledAt - row.resourceWait - row.offHoursWait;
      expect(processing).toBeGreaterThanOrEqual(-1e-9);
      expect(row.resourceWait).toBeGreaterThanOrEqual(0);
      expect(row.offHoursWait).toBeGreaterThanOrEqual(0);
      expect(row.endedAt! - row.enabledAt).toBeCloseTo(row.resourceWait + row.offHoursWait + processing, 9);
    }
  });

  test('R-DET-3: cambiar un calendario no toca el stream de los demás elementos', () => {
    const otro: SimScenario = {
      ...scenario,
      calendars: {
        ...scenario.calendars,
        oficina: { intervals: [{ days: WEEKDAYS, from: '07:00', to: '19:00' }] },
      },
    };
    const cambiado = runReplication(ir, otro);

    // Las llegadas dependen solo del stream de `Start` y de su propio calendario, que no ha
    // cambiado: los mismos casos, en los mismos instantes.
    expect(cambiado.cases.map((record) => record.startedAt)).toEqual(run.cases.map((record) => record.startedAt));
    // Y las duraciones muestreadas de `Tarea` son las mismas, aunque los instantes se muevan.
    // Las filas salen en orden de cierre, que sí se mueve; y `activityInstanceId` es un
    // contador global compartido con el timer, cuyo entrelazado también cambia. La identidad
    // estable del token en `Tarea` es su caso: cada uno pasa por la tarea exactamente una vez.
    const durations = (source: ReplicationRun): Record<string, number> =>
      Object.fromEntries(
        instances(source, 'Tarea')
          .filter((row) => row.status === 'completed')
          .map((row) => [
            row.caseId,
            Number((row.endedAt! - row.enabledAt - row.resourceWait - row.offHoursWait).toFixed(6)),
          ]),
      );
    const antes = durations(run);
    const despues = durations(cambiado);
    const comunes = Object.keys(antes).filter((id) => id in despues);
    expect(comunes.length).toBeGreaterThan(50);
    for (const id of comunes) expect(despues[id]).toBe(antes[id]);
  });
});

/* ------------------------------------------------------------------ *
 * R-CAL-11 — capacidad por intervalos dentro de un mismo pool (LILA-164)
 * ------------------------------------------------------------------ */

const TODOS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
/** 08:00–20:00 todos los días. */
const DIA = { intervals: [{ days: TODOS, from: '08:00', to: '20:00' }] };
/** 20:00–08:00 todos los días, partido en dos por R13; junto con `DIA` cubre las 24 h. */
const NOCHE = {
  intervals: [
    { days: TODOS, from: '20:00', to: '24:00' },
    { days: TODOS, from: '00:00', to: '08:00' },
  ],
};
/** Lunes 00:00: `t = 0` cae al principio del turno de noche. */
const LUNES_0000 = '2026-09-07T00:00:00-06:00';

describe('capacidad por intervalos (LILA-164, R-CAL-11)', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] },
  );

  /** 3 enfermeras de día y 1 de noche: un solo pool, dos tramos. */
  const scenario: SimScenario = {
    run: { start: LUNES_0000, seed: 7 },
    calendars: { dia: DIA, noche: NOCHE },
    elements: {
      // Llegada cada 700 s y servicio de 1700 s: 2,4 servidores de carga, así que de día (3) el
      // pool va lleno y de noche (1) se acumula cola. Los 1700 s son a propósito **no** divisor
      // de las 12 h del turno de día: con el pool saturado los arranques se alinean al servicio y
      // un divisor exacto haría que el cierre coincidiera siempre con tres finales de tarea.
      Start: { interTriggerTimer: { type: 'constant', value: 700 }, triggerCount: 200 },
      Tarea: { processingTime: { type: 'constant', value: 1700 }, resources: [{ ref: 'enfermera' }] },
    },
    resources: {
      enfermera: {
        capacity: [
          { calendar: 'dia', capacity: 3 },
          { calendar: 'noche', capacity: 1 },
        ],
      },
    },
  };

  const run = runReplication(ir, scenario);
  const filas = instances(run, 'Tarea').filter((row) => row.startedAt !== null);
  const offset = weekOffsetSeconds(LUNES_0000);
  const horario = compileCapacity(
    [
      { calendar: compileCalendar(DIA, offset), capacity: 3 },
      { calendar: compileCalendar(NOCHE, offset), capacity: 1 },
    ],
    offset,
  );

  test('la unión de los dos turnos es un 24×7: ninguna tarea espera fuera de horario', () => {
    expect(filas.length).toBeGreaterThan(100);
    for (const row of filas) expect(row.offHoursWait).toBe(0);
  });

  test('ninguna tarea arranca con el pool lleno: la capacidad se lee en el instante de la concesión', () => {
    for (const row of filas) {
      const t = row.startedAt!;
      const simultaneas = filas.filter((otra) => otra.startedAt! <= t && (otra.endedAt ?? Infinity) > t).length;
      expect(simultaneas, `${simultaneas} simultáneas en t=${t}`).toBeLessThanOrEqual(capacityAt(horario, t));
    }
  });

  test('al cerrar el turno de día las tareas en curso NO se interrumpen: el pool queda sobreocupado', () => {
    // A las 20:00 la capacidad baja de 3 a 1 con dos tareas en marcha (llegada cada 15 min,
    // servicio de 30 min ⇒ dos en servicio en régimen); ninguna se corta y el pool queda con
    // `used = 2 > 1` hasta que terminan.
    const cierre = 20 * HOUR + 1; // justo después de la bajada de 3 a 1
    const enCurso = filas.filter((row) => row.startedAt! < cierre && (row.endedAt ?? Infinity) > cierre);
    expect(capacityAt(horario, cierre)).toBe(1);
    expect(enCurso.length, 'el pool queda sobreocupado tras la bajada').toBeGreaterThan(1);
    for (const row of enCurso) expect(row.endedAt! - row.startedAt!).toBe(1700);
  });

  test('al subir la capacidad a las 08:00 arranca la cola acumulada de noche', () => {
    const apertura = DAY + 8 * HOUR; // martes 08:00
    expect(nextCapacityRise(horario, DAY)).toBe(apertura);
    const arrancan = filas.filter((row) => row.startedAt === apertura);
    expect(arrancan.length, 'la subida de capacidad despierta la cola').toBeGreaterThan(0);
    for (const row of arrancan) expect(row.enabledAt).toBeLessThan(apertura);
  });

  test('R-CAL-9: el denominador de la utilización es Σ capacity_i × openTime_i', () => {
    const metrics = aggregateReplication(ir, run, scenario);
    const disponible =
      3 * openTime(compileCalendar(DIA, offset), 0, run.stoppedAt)
      + 1 * openTime(compileCalendar(NOCHE, offset), 0, run.stoppedAt);
    expect(metrics.resources.enfermera!.utilization).toBeCloseTo(
      metrics.resources.enfermera!.busyTime / disponible,
      12,
    );
    // Y no es lo mismo que medir contra el máximo del pool: el turno de noche pesa menos.
    expect(disponible).toBeLessThan(3 * run.stoppedAt);
  });

  test('un solo tramo es byte a byte el pool con `capacity` numérica y `calendar`', () => {
    const porTramo: SimScenario = {
      ...scenario,
      resources: { enfermera: { capacity: [{ calendar: 'dia', capacity: 3 }] } },
    };
    const numerico: SimScenario = {
      ...scenario,
      resources: { enfermera: { capacity: 3, calendar: 'dia' } },
    };
    expect(runReplication(ir, porTramo)).toEqual(runReplication(ir, numerico));
  });

  test('dos calendarios que se solapan SUMAN su capacidad', () => {
    const siempre = compileCalendar({ intervals: [{ days: TODOS, from: '00:00', to: '24:00' }] }, 0);
    const solapado = compileCapacity(
      [
        { calendar: compileCalendar(DIA, 0), capacity: 2 },
        { calendar: siempre, capacity: 1 },
      ],
      0,
    );
    expect(capacityAt(solapado, 9 * HOUR)).toBe(3); // 2 del turno de día + 1 del 24×7
    expect(capacityAt(solapado, 22 * HOUR)).toBe(1);
    expect(solapado.max).toBe(3);
  });

  test('durante el cierre del pool entero vale la capacidad de la siguiente apertura (R-CAL-6)', () => {
    const soloDia = compileCapacity([{ calendar: compileCalendar(DIA, 0), capacity: 3 }], 0);
    // Cerrado a las 22:00 y aun así 3: la concesión ocurre y el trabajo espera a la apertura, que
    // es exactamente lo que hacía el pool con `capacity` numérica y `calendar` desde M3.
    expect(capacityAt(soloDia, 22 * HOUR)).toBe(3);
    expect(soloDia.constant).toBe(3);
  });

  test('`capacity` por intervalos y `calendar` del pool son excluyentes', () => {
    expect(() =>
      runReplication(ir, {
        ...scenario,
        resources: { enfermera: { capacity: [{ calendar: 'dia', capacity: 3 }], calendar: 'noche' } },
      }),
    ).toThrow(/E-CAPACIDAD-Y-CALENDARIO/);
  });

  test('el calendario de cada tramo tiene que existir y `quantity` se valida contra el máximo de la semana', () => {
    expect(() =>
      runReplication(ir, {
        ...scenario,
        resources: { enfermera: { capacity: [{ calendar: 'inexistente', capacity: 3 }] } },
      }),
    ).toThrow(/E-CAL-DESCONOCIDO/);

    // 3 cabe (es el máximo, en el turno de día); 4 no cabe en ningún turno.
    const conCantidad = (quantity: number): SimScenario => ({
      ...scenario,
      elements: { ...scenario.elements, Tarea: { ...scenario.elements!.Tarea, resources: [{ ref: 'enfermera', quantity }] } },
    });
    expect(() => runReplication(ir, conCantidad(3))).not.toThrow();
    expect(() => runReplication(ir, conCantidad(4))).toThrow(/E-REC-CANTIDAD.*exceeds capacity 3/);
  });
});
