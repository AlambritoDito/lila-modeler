import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { simulate } from '../../src/core/run.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';
import { RunSchema, ScenarioSchema, validateScenario } from '../../src/scenario.js';

/**
 * QA adversarial de LILA-186 (`triggerCount` sin `interTriggerTimer` = N llegadas en `t = 0`),
 * por un agente distinto al implementador.
 *
 * No repite la aceptación de `sim.test.ts`: ataca los cruces que el contrato nuevo abre y que
 * aquella da por buenos —calendario, `t_stop`, warmup, varios starts, replicaciones, la
 * equivalencia con el `constant 0` explícito y la coherencia de R5/R6 con el motor— para que
 * ninguno degrade en silencio.
 */

function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_ArrivalsT0Qa',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const SEED = 1;
const LINEAL = makeIr({ Start: 'start', A: 'task', End: 'end' }, { F1: ['Start', 'A'], F2: ['A', 'End'] });
const CON_TIMER = makeIr(
  { Start: 'start', T: 'timer', A: 'task', End: 'end' },
  { F1: ['Start', 'T'], F2: ['T', 'A'], F3: ['A', 'End'] },
);

/** `A` dura 60 s; `Start` solo declara `triggerCount`, que es el caso bajo ataque. */
const ELEMENTS = {
  Start: { triggerCount: 10 },
  A: { processingTime: { type: 'constant', value: 60 } },
} as const satisfies NonNullable<SimScenario['elements']>;

const HOUR = 3600;
/** Lunes 08:00 con la oficina abriendo a las 09:00: `t = 0` cae en tiempo cerrado. */
const MONDAY_0800 = '2026-09-07T08:00:00-06:00';
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
const OFICINA = { intervals: [{ days: WEEKDAYS, from: '09:00', to: '18:00' }] };

/* ------------------------------------------------------------------ *
 * (1) Calendario en el start: las N llegadas se desplazan, no se pierden (R-ARR-6)
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 1: `triggerCount` a solas con calendario y `t = 0` cerrado', () => {
  const run = runReplication(LINEAL, {
    run: { seed: SEED, start: MONDAY_0800 },
    calendars: { oficina: OFICINA },
    elements: { ...ELEMENTS, Start: { triggerCount: 10, calendar: 'oficina' } },
  });

  test('las 10 llegadas se desplazan enteras a `nextOpen`, ni una se pierde ni se duplica', () => {
    // R-ARR-6: el corte contra `t_stop` se aplica al valor ya desplazado, y la cadencia efectiva
    // `constant 0` no puede volver a cerrar la ventana: las 10 caen en el mismo instante de
    // apertura, no repartidas por la semana ni recortadas a una.
    expect(run.cases).toHaveLength(10);
    expect(run.cases.map((c) => c.startedAt)).toEqual(Array<number>(10).fill(HOUR));
    expect(run.elements.Start).toEqual({ started: 10, completed: 10 });
    expect(run.warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * (2) `t_stop` (R-ARR-2 b, R-ARR-3)
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 2: el corte contra `t_stop` de la llegada en `t = 0`', () => {
  test('`duration` positiva no recorta nada: manda el `triggerCount`', () => {
    const run = runReplication(LINEAL, { run: { seed: SEED, duration: HOUR }, elements: ELEMENTS });
    expect(run.cases).toHaveLength(10);
  });

  test('`duration = 0` no genera ningún caso: `0 >= t_stop` es R-ARR-2(b) al pie de la letra', () => {
    // El instante de la primera llegada (0) ya es `>= t_stop`, así que el generador no llega a
    // emitir. No es un caso alcanzable desde un escenario real —`run.duration` es `positive` en
    // el esquema— pero fija la lectura de la regla en el motor, que es donde se decide.
    const run = runReplication(LINEAL, { run: { seed: SEED, duration: 0 }, elements: ELEMENTS });
    expect(run.cases).toHaveLength(0);
    expect(run.stoppedAt).toBe(0);
  });

  test('el esquema rechaza `run.duration: 0`, así que el caso anterior no llega del escenario', () => {
    expect(RunSchema.safeParse({ start: '2026-01-05T08:00:00+00:00', duration: 0 }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * (3) Warmup que se come la cohorte entera (R-ARR-7)
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 3: `warmup > 0` excluye a los 10 casos nacidos en `t = 0`', () => {
  const r = simulate(LINEAL, { run: { seed: SEED, warmup: 100 }, elements: ELEMENTS }, { log: false });

  test('la cohorte medida queda vacía y el motor no divide por cero', () => {
    expect(r.process.started).toBe(0);
    expect(r.process.completed).toBe(0);
    expect(r.elements.A!.started).toBe(0);
    // Ni un `NaN` ni un `Infinity` en todo el resultado: es lo que delataría un `0/0` en las
    // medias, las desviaciones o los ratios (throughput, costo por caso, utilización).
    for (const [ruta, valor] of numeros(r)) {
      expect(Number.isFinite(valor), `${ruta} = ${valor}`).toBe(true);
    }
  });

  test('los casos existen igual: el warmup los excluye de estadísticas, no de la simulación', () => {
    // R-ARR-7: nacieron, ocuparon el modelo y lo atravesaron; solo no cuentan.
    const crudo = runReplication(LINEAL, { run: { seed: SEED, warmup: 100 }, elements: ELEMENTS });
    expect(crudo.rows.filter((row) => row.elementId === 'A')).toHaveLength(10);
    expect(crudo.cases).toHaveLength(0);
  });
});

/** Todos los números de un objeto, con su ruta, para cazar `NaN`/`Infinity` en bloque. */
function numeros(value: unknown, path = '$'): [string, number][] {
  if (typeof value === 'number') return [[path, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => numeros(v, `${path}.${k}`));
}

/* ------------------------------------------------------------------ *
 * (4) Dos starts, uno con timer y otro solo con `triggerCount` (R-PERF-5, R-DET-2)
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 4: dos starts en el mismo proceso', () => {
  const DOS = makeIr(
    { S1: 'start', S2: 'start', A: 'task', End: 'end' },
    { F1: ['S1', 'A'], F2: ['S2', 'A'], F3: ['A', 'End'] },
  );
  const conAmbos: SimScenario = {
    run: { seed: SEED, duration: 10_000 },
    elements: {
      S1: { interTriggerTimer: { type: 'exponential', mean: 137.5 }, triggerCount: 5 },
      S2: { triggerCount: 7 },
      A: { processingTime: { type: 'constant', value: 10 } },
    },
  };
  const ambos = runReplication(DOS, conAmbos);

  test('los dos generan y `started` suma', () => {
    expect(ambos.elements.S1).toEqual({ started: 5, completed: 5 });
    expect(ambos.elements.S2).toEqual({ started: 7, completed: 7 });
    expect(ambos.cases).toHaveLength(12);
    expect(ambos.warnings).toEqual([]);
  });

  test('los 7 de `S2` nacen todos en `t = 0` y los 5 de `S1` siguen su exponencial', () => {
    const porStart = (id: string): number[] => ambos.cases.filter((c) => c.startId === id).map((c) => c.startedAt);
    expect(porStart('S2')).toEqual(Array<number>(7).fill(0));
    expect(new Set(porStart('S1')).size).toBe(5);
  });

  test('R-DET-2: el start de `t = 0` no toca el stream del otro', () => {
    // Quitar `S2` no puede mover una sola llegada de `S1`: si el default `constant 0` estuviera
    // muestreando del stream equivocado, estos instantes cambiarían.
    const { S2: _omitido, ...sinElStartDeT0 } = conAmbos.elements!;
    const sinS2 = runReplication(DOS, { ...conAmbos, elements: sinElStartDeT0 });
    const s1De = (run: typeof ambos): number[] => run.cases.filter((c) => c.startId === 'S1').map((c) => c.startedAt);
    expect(s1De(sinS2)).toEqual(s1De(ambos));
  });
});

/* ------------------------------------------------------------------ *
 * (5) Replicaciones (R-ARR-8)
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 5: 30 réplicas de una cohorte determinista en `t = 0`', () => {
  const XOR = makeIr(
    { Start: 'start', G: 'xor', B: 'task', C: 'task', End: 'end' },
    { F1: ['Start', 'G'], F2: ['G', 'B'], F3: ['G', 'C'], F4: ['B', 'End'], F5: ['C', 'End'] },
  );
  const r = simulate(
    XOR,
    {
      run: { seed: SEED, replications: 30 },
      elements: {
        Start: { triggerCount: 10 },
        B: { processingTime: { type: 'constant', value: 120 } },
        C: { processingTime: { type: 'constant', value: 30 } },
        F2: { probability: 0.5 },
        F3: { probability: 0.5 },
      },
    },
    { log: false },
  );

  test('`started` no varía entre réplicas: solo el sorteo del gateway es aleatorio', () => {
    const kpi = r.replications!.kpis!['process.started']!;
    expect(kpi.mean).toBe(10);
    expect(kpi.sd).toBe(0);
    expect(kpi.ci95).toEqual([10, 10]);
  });

  test('lo que sí varía es el reparto del XOR', () => {
    expect(r.replications!.kpis!['flows.F2.count']!.sd).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * (6) La definición del default: `constant 0` explícito (R-ARR-1)
 * ------------------------------------------------------------------ */

test('QA LILA-186 · ataque 6: `interTriggerTimer` `constant 0` explícito da el mismo `RunResult` byte a byte', () => {
  // Es literalmente lo que dice R-ARR-1 ("equivale al default `constant 0`"): si algún día el
  // helper `arrivalTimer` dejara de ser esa equivalencia exacta —por ejemplo consumiendo un
  // uniforme de más en un camino y no en el otro— este `toBe` lo caza.
  const conLog = (elements: NonNullable<SimScenario['elements']>): string =>
    JSON.stringify(simulate(LINEAL, { run: { seed: SEED }, elements }, { log: true }));
  expect(
    conLog({ ...ELEMENTS, Start: { triggerCount: 10, interTriggerTimer: { type: 'constant', value: 0 } } }),
  ).toBe(conLog(ELEMENTS));
});

/* ------------------------------------------------------------------ *
 * (7) Coherencia de R5/R6 con el motor: el `timer` intermedio nunca genera
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 7: `triggerCount` en un timer intermedio', () => {
  /** Escenario resuelto mínimo sobre `CON_TIMER`, con los campos de llegada en el timer. */
  const enElTimer = ScenarioSchema.parse({
    version: 1,
    name: 'qa',
    model: 'm.bpmn',
    run: { start: '2026-01-05T08:00:00+00:00' },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 } },
      T: { triggerCount: 5, processingTime: { type: 'constant', value: 1 } },
      A: { processingTime: { type: 'constant', value: 60 } },
      End: { fixedCost: 0 },
    },
  });

  test('R5: un `bpmn:intermediateCatchEvent` con timer es retardo, no generador', () => {
    // SEMANTICS § 2: el `startEvent` con `timerEventDefinition` ya se mapea a `start`, así que el
    // "timer generador" de R5 nunca llega al IR como `timer`. Un `timer` en el IR es siempre el
    // retardo intermedio (§ 9), y el motor no le monta generador: aceptar ahí `triggerCount` es
    // un campo que no hace nada.
    const problemas = validateScenario(enElTimer, CON_TIMER);
    expect(problemas.filter((p) => p.path === 'elements.T.triggerCount')).toEqual([
      {
        code: 'E-CAMPO-NO-APLICA',
        path: 'elements.T.triggerCount',
        severity: 'error',
        message: 'elements.T.triggerCount: solo se admite en un evento de inicio.',
      },
    ]);
  });

  test('R6: ese `triggerCount` tampoco vale como condición de parada', () => {
    // Sin `run.duration` y con el único `triggerCount` en un elemento que no genera, la corrida
    // no tiene parada: el start emite para siempre. `E-SIN-PARADA` existe justo para eso.
    expect(validateScenario(enElTimer, CON_TIMER).map((p) => p.code)).toContain('E-SIN-PARADA');
  });

  test('sin ese error la corrida no pararía sola (por eso es error, no aviso)', () => {
    // Se corta a mano con la señal cooperativa (R-ARR-10) para no colgar la suite: `cancelled`
    // dice que paró la señal, no el modelo.
    let pasos = 0;
    const controller = { aborted: false };
    const run = runReplication(CON_TIMER, {
      run: { seed: SEED },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 10 } },
        T: { triggerCount: 5, processingTime: { type: 'constant', value: 1 } },
        A: { processingTime: { type: 'constant', value: 60 } },
      },
    }, 0, {
      signal: controller,
      onStep: () => {
        if (++pasos > 5000) controller.aborted = true;
      },
    });
    expect(run.cancelled).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * (8) El lint no molesta con el caso legítimo y sí con el start mudo (§ 17)
 * ------------------------------------------------------------------ */

describe('QA LILA-186 · ataque 8: avisos del lint y del motor', () => {
  const resuelto = (elements: Record<string, unknown>, run: Record<string, unknown> = {}) =>
    ScenarioSchema.parse({
      version: 1,
      name: 'qa',
      model: 'm.bpmn',
      run: { start: '2026-01-05T08:00:00+00:00', ...run },
      elements,
    });

  test('`triggerCount` a solas no produce ningún problema de escenario', () => {
    const problemas = validateScenario(
      // `seed` declarada a propósito: sin ella el lint avisa `W-SIN-SEED` (R-DEG-4, LILA-198) y
      // este ataque quiere la lista vacía, no ese aviso.
      resuelto(
        { Start: { triggerCount: 10 }, A: { processingTime: { type: 'constant', value: 60 } }, End: { fixedCost: 0 } },
        { seed: 1 },
      ),
      LINEAL,
    );
    expect(problemas).toEqual([]);
  });

  test('el motor tampoco avisa: `W-START-SIN-LLEGADAS` queda para el start mudo', () => {
    expect(runReplication(LINEAL, { run: { seed: SEED }, elements: ELEMENTS }).warnings).toEqual([]);
    const mudo = runReplication(LINEAL, {
      run: { seed: SEED, duration: HOUR },
      elements: { A: { processingTime: { type: 'constant', value: 60 } } },
    });
    expect(mudo.warnings).toEqual([
      'W-START-SIN-LLEGADAS: Start: el start no declara interTriggerTimer ni triggerCount y no genera casos.',
    ]);
  });
});
