import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { runReplication, type ReplicationRun, type SimScenario } from '../../src/core/sim.js';

/**
 * Pruebas de aceptación de LILA-026 (bucle DES v1). Los IR se construyen a mano: el motor no
 * necesita pasar por XML y así el test aísla la semántica de `docs/SEMANTICS.md`.
 */

/** Construye un `ProcessIR` desde nodos y aristas; `incoming`/`outgoing` en orden de documento. */
function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string, isDefault?: boolean]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) {
    irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  }
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to, isDefault]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: isDefault ?? false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_Test',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

// Semilla fija (la del default del esquema, R-DEG-4).
const SEED = 1;

/** Ciclos de los casos completados, en segundos. */
function cycles(run: ReplicationRun): number[] {
  return run.cases.filter((c) => c.endedAt !== null).map((c) => c.endedAt! - c.startedAt);
}

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/* ------------------------------------------------------------------ *
 * (a) XOR 50/50
 * ------------------------------------------------------------------ */

describe('(a) Start → A(60) → XOR 50/50 → B(120) | C(30) → End', () => {
  const ir = makeIr(
    { Start: 'start', A: 'task', G: 'xor', B: 'task', C: 'task', End: 'end' },
    {
      Flow_SA: ['Start', 'A'],
      Flow_AG: ['A', 'G'],
      Flow_GB: ['G', 'B'],
      Flow_GC: ['G', 'C'],
      Flow_BE: ['B', 'End'],
      Flow_CE: ['C', 'End'],
    },
  );
  const scenario: SimScenario = {
    run: { seed: SEED },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 1000 },
      A: { processingTime: { type: 'constant', value: 60 } },
      B: { processingTime: { type: 'constant', value: 120 } },
      C: { processingTime: { type: 'constant', value: 30 } },
      Flow_GB: { probability: 0.5 },
      Flow_GC: { probability: 0.5 },
    },
  };
  const run = runReplication(ir, scenario);

  test('se generan y se completan los 1000 casos', () => {
    expect(run.cases).toHaveLength(1000);
    expect(cycles(run)).toHaveLength(1000);
  });

  test('ciclo medio = 60 + 0,5·120 + 0,5·30 ± 1 s', () => {
    expect(Math.abs(mean(cycles(run)) - (60 + 0.5 * 120 + 0.5 * 30))).toBeLessThanOrEqual(1);
  });

  test('tokens por flujo 500 ± 40 en cada rama (R-XOR-7)', () => {
    expect(run.flows.Flow_GB).toBeGreaterThanOrEqual(460);
    expect(run.flows.Flow_GB).toBeLessThanOrEqual(540);
    expect(run.flows.Flow_GC).toBeGreaterThanOrEqual(460);
    expect(run.flows.Flow_GC).toBeLessThanOrEqual(540);
    expect(run.flows.Flow_GB! + run.flows.Flow_GC!).toBe(1000);
  });

  test('es determinista: dos corridas con la misma entrada dan lo mismo (R-DURA-6, R-DET-6)', () => {
    expect(JSON.stringify(runReplication(ir, scenario))).toBe(JSON.stringify(run));
  });
});

/* ------------------------------------------------------------------ *
 * (b) AND fork/join con ramas constantes
 * ------------------------------------------------------------------ */

describe('(b) AND con ramas constantes de 300 y 500 s', () => {
  const ir = makeIr(
    { Start: 'start', Fork: 'and', X: 'task', Y: 'task', Join: 'and', End: 'end' },
    {
      Flow_SF: ['Start', 'Fork'],
      Flow_FX: ['Fork', 'X'],
      Flow_FY: ['Fork', 'Y'],
      Flow_XJ: ['X', 'Join'],
      Flow_YJ: ['Y', 'Join'],
      Flow_JE: ['Join', 'End'],
    },
  );
  const run = runReplication(ir, {
    run: { seed: SEED },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 3600 }, triggerCount: 5 },
      X: { processingTime: { type: 'constant', value: 300 } },
      Y: { processingTime: { type: 'constant', value: 500 } },
    },
  });

  test('la sección paralela dura exactamente 500 s (R-AND-5)', () => {
    expect(cycles(run)).toEqual([500, 500, 500, 500, 500]);
  });

  test('el join dispara una vez por caso tras recibir sus dos entradas (R-AND-2)', () => {
    expect(run.elements.Join).toEqual({ started: 10, completed: 5 });
    expect(run.elements.End).toEqual({ started: 5, completed: 5 });
    expect(run.warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * (c) Parada por duración
 * ------------------------------------------------------------------ */

describe('(c) duración 1 h, triggerCount 10000, llegadas cada 10 s', () => {
  const ir = makeIr({ Start: 'start', A: 'task', End: 'end' }, { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] });
  const run = runReplication(ir, {
    run: { seed: SEED, duration: 3600 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 10000 },
      A: { processingTime: { type: 'constant', value: 60 } },
    },
  });

  test('started = 360: llegadas en t = 0, 10, …, 3590 (R-ARR-2, R-ARR-4)', () => {
    expect(run.cases).toHaveLength(360);
    expect(run.cases[0]?.startedAt).toBe(0);
    expect(run.cases[359]?.startedAt).toBe(3590);
    expect(run.stoppedAt).toBe(3600);
  });

  test('los casos en vuelo al parar no cuentan como completados (R-ARR-5)', () => {
    const completed = run.cases.filter((c) => c.endedAt !== null);
    // Llega en 3590, tarea de 60 s ⇒ terminaría en 3650 > 3600: los últimos 6 quedan en vuelo.
    expect(completed).toHaveLength(354);
    expect(run.elements.A).toEqual({ started: 360, completed: 354 });
  });
});

/* ------------------------------------------------------------------ *
 * (d) OR fork/join
 * ------------------------------------------------------------------ */

describe('(d) OR con probabilidades 1.0 y 0.5', () => {
  const ir = makeIr(
    { Start: 'start', Fork: 'or', P: 'task', Q: 'task', Join: 'or', End: 'end' },
    {
      Flow_SF: ['Start', 'Fork'],
      Flow_FP: ['Fork', 'P'],
      Flow_FQ: ['Fork', 'Q'],
      Flow_PJ: ['P', 'Join'],
      Flow_QJ: ['Q', 'Join'],
      Flow_JE: ['Join', 'End'],
    },
  );
  const run = runReplication(ir, {
    run: { seed: SEED },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1000 }, triggerCount: 400 },
      P: { processingTime: { type: 'constant', value: 10 } },
      Q: { processingTime: { type: 'constant', value: 20 } },
      Flow_FP: { probability: 1 },
      Flow_FQ: { probability: 0.5 },
    },
  });

  const bothBranches = run.flows.Flow_FQ!;

  test('la rama de probabilidad 1.0 se activa siempre y la de 0.5 la mitad de las veces (R-OR-1)', () => {
    expect(run.flows.Flow_FP).toBe(400);
    expect(bothBranches).toBeGreaterThan(160);
    expect(bothBranches).toBeLessThan(240);
  });

  test('el join espera 1 o 2 tokens según lo que activó el fork (R-OR-5)', () => {
    // Un token por rama activada entra al join; sale uno por caso.
    expect(run.elements.Join).toEqual({ started: 400 + bothBranches, completed: 400 });
    // Con dos ramas el caso dura lo que la más larga (20 s); con una sola, 10 s.
    expect(cycles(run).filter((c) => c === 20)).toHaveLength(bothBranches);
    expect(cycles(run).filter((c) => c === 10)).toHaveLength(400 - bothBranches);
  });

  test('ningún caso queda bloqueado en el join (R-OR-8)', () => {
    expect(run.cases.filter((c) => c.endedAt === null)).toHaveLength(0);
    expect(run.warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Joins dentro de bucles y terminate
 * ------------------------------------------------------------------ */

describe('AND join dentro de un bucle', () => {
  const ir = makeIr(
    // El retorno del bucle entra por una mezcla XOR (R-PERF-2): un `and` con varias entradas
    // es siempre un join (R-AND-2), así que el fork del bucle no puede recibir la arista de vuelta.
    { Start: 'start', M: 'xor', Fork: 'and', B1: 'task', B2: 'task', Join: 'and', G: 'xor', End: 'end' },
    {
      Flow_SM: ['Start', 'M'],
      Flow_MF: ['M', 'Fork'],
      Flow_FB1: ['Fork', 'B1'],
      Flow_FB2: ['Fork', 'B2'],
      Flow_B1J: ['B1', 'Join'],
      Flow_B2J: ['B2', 'Join'],
      Flow_JG: ['Join', 'G'],
      Flow_GM: ['G', 'M'],
      Flow_GE: ['G', 'End'],
    },
  );
  const run = runReplication(ir, {
    run: { seed: SEED },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10_000 }, triggerCount: 200 },
      B1: { processingTime: { type: 'constant', value: 10 } },
      B2: { processingTime: { type: 'constant', value: 20 } },
      Flow_GM: { probability: 0.5 },
      Flow_GE: { probability: 0.5 },
    },
  });

  test('el contador del join se reinicia en cada vuelta y todos los casos terminan (R-AND-3)', () => {
    const iterations = run.flows.Flow_MF!;
    expect(run.elements.Fork).toEqual({ started: iterations, completed: iterations });
    expect(run.elements.Join).toEqual({ started: 2 * iterations, completed: iterations });
    expect(run.cases.filter((c) => c.endedAt === null)).toHaveLength(0);
    expect(run.warnings).toEqual([]);
  });

  test('el ciclo es 20 s por vuelta: la rama más larga manda (R-AND-5)', () => {
    for (const cycle of cycles(run)) expect(cycle % 20).toBe(0);
    expect(Math.max(...cycles(run))).toBeGreaterThan(20);
  });
});

describe('terminate mata todos los tokens del caso', () => {
  const ir = makeIr(
    { Start: 'start', Fork: 'and', Fast: 'task', Slow: 'task', Kill: 'terminate', End: 'end' },
    {
      Flow_SF: ['Start', 'Fork'],
      Flow_FFast: ['Fork', 'Fast'],
      Flow_FSlow: ['Fork', 'Slow'],
      Flow_FastK: ['Fast', 'Kill'],
      Flow_SlowE: ['Slow', 'End'],
    },
  );
  const run = runReplication(ir, {
    run: { seed: SEED },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1000 }, triggerCount: 3 },
      Fast: { processingTime: { type: 'constant', value: 10 } },
      Slow: { processingTime: { type: 'constant', value: 500 } },
    },
  });

  test('el caso termina en el terminate y la tarea en curso no completa (R-EVT-5, R-EVT-6)', () => {
    expect(cycles(run)).toEqual([10, 10, 10]);
    expect(run.elements.Slow).toEqual({ started: 3, completed: 0 });
    expect(run.elements.End).toEqual({ started: 0, completed: 0 });
    expect(run.rows.filter((r) => r.elementId === 'Slow')).toMatchObject([
      { status: 'terminated', startedAt: 0, endedAt: null, observedUntil: 10 },
      { status: 'terminated', startedAt: 1000, endedAt: null, observedUntil: 1010 },
      { status: 'terminated', startedAt: 2000, endedAt: null, observedUntil: 2010 },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * triggerCount sin interTriggerTimer (LILA-186)
 * ------------------------------------------------------------------ */

describe('triggerCount sin interTriggerTimer = N llegadas en t = 0 (R-ARR-1)', () => {
  const ir = makeIr({ Start: 'start', A: 'task', End: 'end' }, { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] });
  const elements = {
    Start: { triggerCount: 10 },
    A: { processingTime: { type: 'constant', value: 60 } },
  } as const;

  test('sin run.duration: 10 casos iniciados en t = 0 y los 10 completados', () => {
    const run = runReplication(ir, { run: { seed: SEED }, elements });
    expect(run.cases).toHaveLength(10);
    expect(run.cases.map((c) => c.startedAt)).toEqual(Array<number>(10).fill(0));
    expect(run.elements.A).toEqual({ started: 10, completed: 10 });
    expect(cycles(run)).toEqual(Array<number>(10).fill(60));
    expect(run.warnings).toEqual([]);
  });

  test('con run.duration también: manda el triggerCount y no cambia nada', () => {
    const run = runReplication(ir, { run: { seed: SEED, duration: 3600 }, elements });
    expect(run.cases).toHaveLength(10);
    expect(run.cases.map((c) => c.startedAt)).toEqual(Array<number>(10).fill(0));
    expect(run.elements.End).toEqual({ started: 10, completed: 10 });
    expect(run.warnings).toEqual([]);
  });

  test('un start sin ninguno de los dos campos sigue sin generar y avisa', () => {
    const run = runReplication(ir, {
      run: { seed: SEED, duration: 3600 },
      elements: { A: { processingTime: { type: 'constant', value: 60 } } },
    });
    expect(run.cases).toHaveLength(0);
    expect(run.warnings).toContain(
      'W-START-SIN-LLEGADAS: Start: el start no declara interTriggerTimer ni triggerCount y no genera casos.',
    );
  });
});
