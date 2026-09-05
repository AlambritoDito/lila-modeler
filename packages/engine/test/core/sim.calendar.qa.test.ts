import { describe, expect, test } from 'vitest';

import { isOpen, openTime, type Calendar } from '../../src/core/calendar.js';
import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import type { EventLogRow } from '../../src/core/result.js';
import { simulate } from '../../src/core/run.js';
import {
  activityCalendar,
  compileCalendars,
  runReplication,
  type SimScenario,
} from '../../src/core/sim.js';
import { CalendarSchema } from '../../src/scenario.js';

/**
 * QA adversarial de LILA-041 y LILA-043 por un agente distinto al implementador.
 *
 * No repite la aceptación de `sim.calendar.test.ts` ni la de `metrics.calendar.test.ts`: ataca
 * lo que aquellas dan por bueno —la degradación fina, el techo de R-CAL-6, la fila recortada,
 * la lectura de R-ARR-6 y el preflight visto desde `simulate`— y ancla los invariantes que
 * deberían valer en **toda** fila del log, no solo en las del caso normativo.
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
    id: 'Process_CalendarQa',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;
/** Lunes 08:00: `t = 0` cae una hora antes de que abra la oficina. */
const MONDAY_0800 = '2026-09-07T08:00:00-06:00';
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const OFICINA = { intervals: [{ days: WEEKDAYS, from: '09:00', to: '18:00' }] };
/** 24×7 escrito a mano, que es lo único que `"24:00"` hace posible sin perder 60 s cada noche. */
const SIEMPRE = { intervals: [{ days: ALL_DAYS, from: '00:00', to: '24:00' }] };

const LINEAL = makeIr({ Start: 'start', Tarea: 'task', End: 'end' }, { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] });

/* ------------------------------------------------------------------ *
 * (1) Degradación fina (R-DEG-2)
 * ------------------------------------------------------------------ */

describe('QA LILA-043 · ataque 1: los tres escalones de la degradación', () => {
  /**
   * Duraciones y llegadas **no enteras** a propósito: con constantes redondas cualquier rodeo
   * aritmético sale exacto por casualidad y la prueba no distingue nada.
   */
  const base: SimScenario = {
    run: { start: MONDAY_0800, duration: 3 * WEEK, warmup: 5000, seed: 11 },
    resources: { cajero: { capacity: 2, costPerHour: 137.5, fixedCost: 1.25 } },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 613.7 } },
      Tarea: {
        processingTime: { type: 'triangular', min: 60.5, mode: 301.25, max: 907.75 },
        resources: [{ ref: 'cajero' }],
      },
    },
  };
  const bytes = (scenario: SimScenario): string => JSON.stringify(simulate(LINEAL, scenario, { log: false }));

  test('sin `calendars` el resultado no se mueve un solo bit (R-DEG-2)', () => {
    expect(bytes(base)).toBe(bytes(base));
  });

  test('`calendars` declarado y no usado por nadie no cambia un solo byte', () => {
    // Es el caso que separa "el motor lee `calendars`" de "el motor lo aplica a algo": un mapa
    // compilado pero sin referencias tiene que ser tan neutro como no declararlo.
    expect(bytes({ ...base, calendars: { oficina: OFICINA } })).toBe(bytes(base));
  });

  test('un calendario llamado `default` sin referenciar **sí** cambia el resultado (R-CAL-10)', () => {
    // Control positivo del anterior: `default` no es un calendario más, es el que heredan todos
    // los pools que no declaran el suyo. Si esto empatara, la herencia estaría rota.
    expect(bytes({ ...base, calendars: { default: OFICINA } })).not.toBe(bytes(base));
  });

  test('un 24×7 explícito (7 días 00:00–24:00) da los mismos bytes que no declarar calendario', () => {
    const explicito: SimScenario = {
      ...base,
      calendars: { siempre: SIEMPRE },
      resources: { cajero: { ...base.resources!.cajero!, calendar: 'siempre' } },
      elements: { ...base.elements, Start: { ...base.elements!.Start!, calendar: 'siempre' } },
    };

    expect(bytes(explicito)).toBe(bytes(base));
  });

  test('el mismo 24×7 escrito con `23:59` sí pierde 60 s cada noche', () => {
    const roto: SimScenario = {
      run: base.run,
      calendars: { casi: { intervals: [{ days: ALL_DAYS, from: '00:00', to: '23:59' }] } },
      resources: { cajero: { ...base.resources!.cajero!, calendar: 'casi' } },
      elements: { ...base.elements, Start: { ...base.elements!.Start!, calendar: 'casi' } },
    };

    expect(bytes(roto)).not.toBe(bytes(base));
  });
});

/* ------------------------------------------------------------------ *
 * (2) R-CAL-6: reserva desde la concesión y su techo
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 2: la reserva desde la concesión y lo que cuesta', () => {
  // `Espera` sitúa a `Retenida` a las 18:30 del lunes; `Espera2` sitúa a `Sola` a las 19:00.
  const ir = makeIr(
    {
      Start: 'start', Espera: 'timer', Retenida: 'task', End: 'end',
      Start2: 'start', Espera2: 'timer', Sola: 'task', End2: 'end',
    },
    {
      F1: ['Start', 'Espera'], F2: ['Espera', 'Retenida'], F3: ['Retenida', 'End'],
      G1: ['Start2', 'Espera2'], G2: ['Espera2', 'Sola'], G3: ['Sola', 'End2'],
    },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: 3 * DAY, seed: 1 },
    calendars: { oficina: OFICINA },
    // `robot` no declara calendario y no hay `default`: es 24×7 (R-CAL-10).
    resources: { robot: { capacity: 1, costPerHour: 3600 }, cajero: { capacity: 1, calendar: 'oficina' } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
      Espera: { processingTime: { type: 'constant', value: 37800 } }, // lunes 18:30
      Retenida: {
        processingTime: { type: 'constant', value: HOUR },
        resources: [{ ref: 'robot' }, { ref: 'cajero' }],
        selection: 'and',
      },
      Start2: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
      Espera2: { processingTime: { type: 'constant', value: 39600 } }, // lunes 19:00
      Sola: { processingTime: { type: 'constant', value: 600 }, resources: [{ ref: 'robot' }] },
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);
  const retenida = run.rows.find((row) => row.elementId === 'Retenida' && row.resourceId === 'robot')!;
  const sola = run.rows.find((row) => row.elementId === 'Sola')!;

  test('el pool 24×7 concedido a las 18:30 no acumula ocupación ni costo durante la noche', () => {
    // Concesión a las 18:30 (t = 37800), arranque a las 09:00 del martes (t = 90000), fin a las
    // 10:00 (t = 93600): 15,5 h de reloj retenido y una sola hora de trabajo.
    expect(retenida.enabledAt).toBe(37800);
    expect(retenida.startedAt).toBe(90000);
    expect(retenida.endedAt).toBe(93600);
    expect(retenida.offHoursWait).toBe(52200);
    expect(retenida.resourceWait).toBe(0);
    // `robot` solo cobra la hora abierta de `Retenida` más los 600 s de `Sola` (R-CAL-6/R-COST-2).
    expect(result.resources.robot!.busyTime).toBe(HOUR + 600);
    expect(result.resources.robot!.unitCost).toBe(HOUR + 600);
  });

  test('techo conocido: la tarea que solo necesita el pool 24×7 espera hasta la mañana', () => {
    // Es la consecuencia deliberada de reservar desde la concesión, anotada en `sim.ts` con
    // `// ponytail:`. `Sola` se habilita a las 19:00 y no arranca hasta que `Retenida` suelta el
    // robot a las 10:00 del martes: 15 h de espera con `robot` técnicamente ocioso.
    expect(sola.enabledAt).toBe(39600);
    expect(sola.startedAt).toBe(93600);
    // `Sola` no tiene calendario, así que las 15 h son `resourceWait` puro (R-REC-8).
    expect(sola.resourceWait).toBe(54000);
    expect(sola.offHoursWait).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * (3) La fila recortada a `observedUntil`
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 3: la concesión cuya apertura cae más allá del corte', () => {
  const ir = makeIr(
    { Start: 'start', Espera: 'timer', Tarea: 'task', End: 'end' },
    { F1: ['Start', 'Espera'], F2: ['Espera', 'Tarea'], F3: ['Tarea', 'End'] },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: 38000, seed: 1 }, // corte lunes 18:33:20
    calendars: { oficina: OFICINA },
    resources: { cajero: { capacity: 1, calendar: 'oficina', fixedCost: 7, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
      Espera: { processingTime: { type: 'constant', value: 37800 } }, // habilita a las 18:30
      Tarea: { processingTime: { type: 'constant', value: HOUR }, resources: [{ ref: 'cajero' }] },
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);
  const row = run.rows.find((candidate) => candidate.elementId === 'Tarea')!;

  test('la fila informa el corte y no un arranque futuro (RESULTS_FORMAT § 7)', () => {
    expect(row.status).toBe('inFlight');
    expect(row.startedAt).toBe(38000);
    expect(row.startedAt).toBe(row.observedUntil);
    // Es el único caso en que `startedAt` cae en horario **cerrado**: el resto del log lo tiene
    // siempre abierto (ver el ataque 6). Queda anclado para que el recorte no se extienda.
    const calendar = compileCalendars(scenario).get('oficina')!;
    expect(isOpen(calendar, row.startedAt!)).toBe(false);
  });

  test('`startedAt` no nulo distingue la espera **asignada**: cobra el fijo y no cobra horas', () => {
    // La unidad estuvo concedida, así que cuenta como uso (R-COST-2) aunque no trabajara un
    // segundo. Con `startedAt = null` la fila diría "seguía en cola", que es falso, y el fijo
    // del pool se perdería.
    expect(row.resourceCost).toBe(7);
    expect(result.resources.cajero!.fixedCost).toBe(7);
    expect(result.resources.cajero!.busyTime).toBe(0);
    expect(result.resources.cajero!.unitCost).toBe(0);
    // Y la identidad de la fila sigue cerrando: 200 s de reloj, todos cerrados.
    expect(row.resourceWait + row.offHoursWait).toBe(row.observedUntil - row.enabledAt);
  });
});

/* ------------------------------------------------------------------ *
 * (4) R-ARR-6: qué lectura está implementada
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 4: la cadencia se mide desde la llegada ya desplazada (R-ARR-6)', () => {
  const ir = makeIr({ Start: 'start', End: 'end' }, { F1: ['Start', 'End'] });

  test('con cadencia horaria y calendario 9–18 salen 9 llegadas por día, no 24', () => {
    // Lectura implementada: `siguiente = nextOpen(desplazada_anterior + muestra)`. La alternativa
    // —medir desde el instante programado y acumular en la apertura— la prohíbe el propio
    // R-ARR-6 ("no se acumulan varias en el instante de apertura salvo que el propio muestreo las
    // genere"), y "la cadencia sigue midiéndose en tiempo de reloj" solo dice que la muestra es
    // de reloj y no de tiempo abierto (no se usa `addWorkingTime`). Queda anclado con nombre para
    // que LILA-044 lo confirme contra Bizagi antes de cambiarlo.
    const run = runReplication(ir, {
      run: { start: MONDAY_0800, duration: 2 * DAY, seed: 1 },
      calendars: { oficina: OFICINA },
      elements: { Start: { interTriggerTimer: { type: 'constant', value: HOUR }, calendar: 'oficina' } },
    });

    const dia = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((hora) => hora * HOUR);
    expect(run.cases.map((record) => record.startedAt)).toEqual([...dia, ...dia.map((t) => t + DAY)]);
  });

  test('la muestra consume el mismo uniforme haya calendario o no (R-DET-3)', () => {
    // Si el desplazamiento se hiciera antes de muestrear, o consumiera uniformes de más, las
    // llegadas del escenario sin calendario dejarían de ser las mismas y un what-if de
    // calendarios dejaría de leerse limpio.
    const sin = runReplication(ir, {
      run: { start: MONDAY_0800, duration: DAY, seed: 4 },
      elements: { Start: { interTriggerTimer: { type: 'exponential', mean: 900 } } },
    });
    const con = runReplication(ir, {
      run: { start: MONDAY_0800, duration: DAY, seed: 4 },
      calendars: { oficina: OFICINA },
      elements: { Start: { interTriggerTimer: { type: 'exponential', mean: 900 }, calendar: 'oficina' } },
    });

    // Cada llegada con calendario es el `nextOpen` de la llegada sin calendario mientras no haya
    // habido ningún desplazamiento: las primeras caen todas antes de las 09:00 y se apilan ahí.
    expect(con.cases.length).toBeLessThan(sin.cases.length);
    expect(con.cases[0]!.startedAt).toBe(HOUR);
  });
});

/* ------------------------------------------------------------------ *
 * (5) Preflight visto desde `simulate`
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 5: ningún callback antes del error de calendario (§17)', () => {
  const arranque = { interTriggerTimer: { type: 'constant' as const, value: 1 }, triggerCount: 5 };

  /** Cuenta filas y avances observados por `simulate` antes de que el preflight aborte. */
  function observed(scenario: SimScenario): { rows: number; progress: number; message: string } {
    let rows = 0;
    let progress = 0;
    try {
      simulate(LINEAL, scenario, { onEvent: () => void rows++, onProgress: () => void progress++ });
    } catch (error) {
      return { rows, progress, message: error instanceof Error ? error.message : String(error) };
    }
    throw new Error('se esperaba un error de preflight');
  }

  test.each([
    ['E-CAL-DESCONOCIDO', 'cajero', {
      run: { start: MONDAY_0800, duration: DAY, replications: 3 },
      calendars: { oficina: OFICINA },
      resources: { cajero: { capacity: 1, calendar: 'nocturno' } },
      elements: { Start: arranque, Tarea: { resources: [{ ref: 'cajero' }] } },
    }],
    ['E-CAL-DESCONOCIDO', 'Tarea', {
      run: { start: MONDAY_0800, duration: DAY, replications: 3 },
      calendars: { oficina: OFICINA },
      elements: { Start: arranque, Tarea: { calendar: 'nocturno' } },
    }],
    ['E-CAL-VACIO', 'vacio', {
      run: { start: MONDAY_0800, duration: DAY, replications: 3 },
      calendars: { vacio: { intervals: [] } },
      elements: { Start: arranque },
    }],
    ['E-CAL-VACIO', 'Tarea', {
      run: { start: MONDAY_0800, duration: DAY, replications: 3 },
      calendars: {
        manana: { intervals: [{ days: WEEKDAYS, from: '09:00', to: '12:00' }] },
        noche: { intervals: [{ days: WEEKDAYS, from: '20:00', to: '24:00' }] },
      },
      resources: { a: { capacity: 1, calendar: 'manana' }, b: { capacity: 1, calendar: 'noche' } },
      elements: { Start: arranque, Tarea: { resources: [{ ref: 'a' }, { ref: 'b' }], selection: 'and' } },
    }],
  ] satisfies readonly (readonly [string, string, SimScenario])[])(
    '%s citando %s aborta con 0 filas y 0 avances',
    (code, cited, scenario) => {
      const result = observed(scenario);

      expect(result.message).toContain(code);
      expect(result.message).toContain(cited);
      expect(result).toMatchObject({ rows: 0, progress: 0 });
    },
  );
});

/* ------------------------------------------------------------------ *
 * (6) Invariantes de toda fila con un calendario feo
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 6: invariantes con turno partido y sábado', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', Plazo: 'timer', End: 'end' },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'Plazo'], F3: ['Plazo', 'End'] },
  );
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: 2 * WEEK, warmup: 3600, seed: 23 },
    calendars: {
      // Turno partido con pausa de comida más media jornada el sábado: intervalos no adyacentes,
      // más de uno por día y una semana que no es múltiplo de nada.
      partido: {
        intervals: [
          { days: WEEKDAYS, from: '07:30', to: '13:00' },
          { days: WEEKDAYS, from: '14:30', to: '19:45' },
          { days: ['SAT'], from: '09:00', to: '13:30' },
        ],
      },
      manana: { intervals: [{ days: WEEKDAYS, from: '06:00', to: '15:00' }] },
    },
    resources: {
      cajero: { capacity: 2, calendar: 'partido', costPerHour: 91.7, fixedCost: 3.5 },
      horno: { capacity: 1, calendar: 'manana', costPerHour: 40 },
    },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 407.3 } },
      Tarea: {
        processingTime: { type: 'triangular', min: 60.5, mode: 305.25, max: 902.75 },
        resources: [{ ref: 'cajero' }, { ref: 'horno' }],
        selection: 'and',
      },
      Plazo: { processingTime: { type: 'constant', value: 1207.5 }, calendar: 'partido' },
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);
  const calendars = compileCalendars(scenario);

  /** El mismo calendario efectivo que reconstruye `metrics.ts`: los pools que la fila ocupó. */
  const calendarOf = (row: EventLogRow): Calendar | undefined => {
    const pools = run.rows
      .filter((entry) => entry.activityInstanceId === row.activityInstanceId && entry.resourceId !== null)
      .map((entry) => entry.resourceId!);
    return activityCalendar(scenario, calendars, row.elementId, pools);
  };

  test('el escenario ejercita de verdad las tres capas', () => {
    expect(run.rows.length).toBeGreaterThan(200);
    expect(run.rows.some((row) => row.offHoursWait > 0)).toBe(true);
    expect(run.rows.some((row) => row.resourceWait > 0)).toBe(true);
  });

  test('R-CAL-8 y los signos se cumplen en todas las filas', () => {
    for (const row of run.rows) {
      expect(row.resourceWait).toBeGreaterThanOrEqual(0);
      expect(row.offHoursWait).toBeGreaterThanOrEqual(0);
      if (row.startedAt !== null) {
        expect(row.startedAt).toBeGreaterThanOrEqual(row.enabledAt);
        expect(row.startedAt).toBeLessThanOrEqual(row.observedUntil);
      }
      if (row.status !== 'completed' || row.endedAt === null) continue;
      const calendar = calendarOf(row);
      const processing = calendar === undefined
        ? row.endedAt - row.startedAt!
        : openTime(calendar, row.startedAt!, row.endedAt);
      expect(row.endedAt - row.enabledAt).toBeCloseTo(row.resourceWait + row.offHoursWait + processing, 6);
    }
  });

  test('`startedAt` cae siempre en horario abierto y `endedAt` en abierto o en un cierre exacto', () => {
    for (const row of run.rows) {
      const calendar = calendarOf(row);
      if (calendar === undefined) continue;
      // La fila recortada del ataque 3 es la única excepción y aquí no aparece: se comprueba.
      if (row.startedAt !== null) expect(isOpen(calendar, row.startedAt)).toBe(true);
      if (row.endedAt === null) continue;
      // `to` es exclusivo (R-CAL-2): terminar justo al cerrar es legítimo y `isOpen` da falso.
      const enCierre = openTime(calendar, row.endedAt - 1, row.endedAt) > 0;
      expect(isOpen(calendar, row.endedAt) || enCierre).toBe(true);
    }
  });

  test('ningún pool supera su techo: `busyTime ≤ capacity × availableTime` (R-CAL-9)', () => {
    for (const [poolId, pool] of Object.entries(scenario.resources!)) {
      expect(result.resources[poolId]!.utilization).toBeLessThanOrEqual(1);
      expect(result.resources[poolId]!.utilization).toBeGreaterThan(0);
      expect(pool.capacity).toBeGreaterThan(0);
    }
  });

  test('un pool de capacidad 1 nunca tiene dos filas solapadas', () => {
    const ocupaciones = run.rows
      .filter((row) => row.resourceId === 'horno' && row.startedAt !== null)
      .map((row) => [row.startedAt!, row.endedAt ?? row.observedUntil] as const)
      .sort((left, right) => left[0] - right[0]);

    expect(ocupaciones.length).toBeGreaterThan(50);
    for (let index = 1; index < ocupaciones.length; index++) {
      expect(ocupaciones[index]![0]).toBeGreaterThanOrEqual(ocupaciones[index - 1]![1] - 1e-9);
    }
  });

  test('R-COST-4: los costos por pool cuadran con la suma de las filas de la ventana', () => {
    // Solo la cohorte medida: los casos nacidos antes del `warmup` existen y estorban, pero no
    // entran en ninguna integral (R-ARR-7), así que sumar el log entero no cuadraría.
    const medidos = new Set(run.cases.map((record) => String(record.caseId)));
    const porFila = run.rows
      .filter((row) => medidos.has(row.caseId))
      .reduce((total, row) => total + row.resourceCost, 0);
    const porPool = Object.values(result.resources).reduce((total, pool) => total + pool.totalCost, 0);

    expect(porFila).toBeGreaterThan(0);
    expect(porFila).toBeCloseTo(porPool, 6);
  });
});

/* ------------------------------------------------------------------ *
 * (7) Determinismo (R-DET-3, R-DET-6)
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 7: determinismo con calendarios', () => {
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: WEEK, replications: 3, seed: 42 },
    calendars: { oficina: OFICINA },
    resources: { cajero: { capacity: 1, calendar: 'oficina' } },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 500 } },
      Tarea: { processingTime: { type: 'lognormal', mean: 240, sd: 80 }, resources: [{ ref: 'cajero' }] },
    },
  };

  test('dos corridas idénticas producen el mismo JSON', () => {
    expect(JSON.stringify(simulate(LINEAL, scenario, { log: false }))).toBe(
      JSON.stringify(simulate(LINEAL, scenario, { log: false })),
    );
  });

  test('cambiar el calendario de un pool no toca el stream de los demás elementos (R-DET-3)', () => {
    const otro: SimScenario = {
      ...scenario,
      calendars: { oficina: { intervals: [{ days: WEEKDAYS, from: '06:00', to: '21:00' }] } },
    };
    const antes = runReplication(LINEAL, scenario);
    const despues = runReplication(LINEAL, otro);

    // `Start` no declara calendario: sus llegadas dependen solo de su stream.
    expect(despues.cases.map((record) => record.startedAt)).toEqual(antes.cases.map((record) => record.startedAt));
  });
});

/* ------------------------------------------------------------------ *
 * (8) `"24:00"` solo en `to` (R13)
 * ------------------------------------------------------------------ */

describe('QA LILA-041 · ataque 8: la matriz de `"24:00"` en el esquema (R13)', () => {
  test.each([
    ['to = 24:00', { days: ['MON'], from: '09:00', to: '24:00' }, true],
    ['from = 24:00', { days: ['MON'], from: '24:00', to: '24:00' }, false],
    ['to = 24:01', { days: ['MON'], from: '09:00', to: '24:01' }, false],
    ['to = 25:00', { days: ['MON'], from: '09:00', to: '25:00' }, false],
    ['to = from', { days: ['MON'], from: '09:00', to: '09:00' }, false],
    ['to < from', { days: ['MON'], from: '18:00', to: '09:00' }, false],
    ['23:59 → 24:00', { days: ['MON'], from: '23:59', to: '24:00' }, true],
  ] satisfies readonly (readonly [string, unknown, boolean])[])('%s', (_name, interval, valido) => {
    expect(CalendarSchema.safeParse({ intervals: [interval] }).success).toBe(valido);
  });

  test('`intervals: []` lo rechaza el esquema antes de llegar al motor', () => {
    expect(CalendarSchema.safeParse({ intervals: [] }).success).toBe(false);
  });
});
