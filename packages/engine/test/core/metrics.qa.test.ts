import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/index.js';
import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication, saturationWarning, type PoolLoad } from '../../src/core/metrics.js';
import type { EventLogRow } from '../../src/core/result.js';
import type { ReplicationRun, SimScenario } from '../../src/core/sim.js';
import { simulate } from '../../src/index.js';

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
    id: 'Process_QA',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'qa', exporterVersion: '0', originalIds: {} },
  };
}

const IR = makeIr(
  { Start: 'start', Gate: 'xor', Task: 'task', Timer: 'timer', End: 'end', Never: 'task' },
  {
    Flow_SG: ['Start', 'Gate'],
    Flow_GT: ['Gate', 'Task'],
    Flow_TT: ['Task', 'Timer'],
    Flow_TE: ['Timer', 'End'],
    Flow_Never: ['Gate', 'Never'],
  },
);

function row(caseId: number, elementId: string, processing: number, resourceWait = 0, offHoursWait = 0, cost = 0): EventLogRow {
  const enabledAt = 0;
  return {
    replication: 0,
    caseId: String(caseId),
    activityInstanceId: `${caseId}-${elementId}`,
    elementId,
    resourceId: null,
    allocationIndex: null,
    resourceQuantity: null,
    status: 'completed',
    enabledAt,
    startedAt: enabledAt + resourceWait,
    endedAt: enabledAt + resourceWait + offHoursWait + processing,
    observedUntil: enabledAt + resourceWait + offHoursWait + processing,
    resourceWait,
    offHoursWait,
    elementCost: cost,
    resourceCost: 0,
    cost,
  };
}

function allNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(allNumbers);
}

describe('QA adversarial LILA-028', () => {
  test('conserva todos los ids, deja ceros finitos y no inventa processing para gateways', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 20,
      statisticsDuration: 20,
      cases: [{ caseId: 1, startId: 'Start', startedAt: 0, endedAt: 20 }],
      rows: [row(1, 'Task', 5), row(1, 'Timer', 15)],
      flows: { Flow_SG: 1, Flow_GT: 1, Flow_TT: 1, Flow_TE: 1, Flow_Never: 0 },
      elements: {
        Start: { started: 1, completed: 1 },
        Gate: { started: 1, completed: 1 },
        Task: { started: 1, completed: 1 },
        Timer: { started: 1, completed: 1 },
        End: { started: 1, completed: 1 },
        Never: { started: 0, completed: 0 },
      },
      warnings: [],
    };

    const result = aggregateReplication(IR, run);
    expect(Object.keys(result.elements)).toEqual(Object.keys(IR.nodes));
    expect(Object.keys(result.flows)).toEqual(Object.keys(IR.flows));
    expect(result.elements.Task?.processing.total).toBe(5);
    expect(result.elements.Timer?.processing.total).toBe(15);
    expect(result.elements.Gate?.processing.total).toBe(0);
    expect(result.elements.Never?.processing).toEqual({ min: 0, max: 0, mean: 0, total: 0 });
    expect(allNumbers(result).every(Number.isFinite)).toBe(true);
  });

  test('sd es muestral para N y cero para una observación', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 30,
      statisticsDuration: 30,
      cases: [
        { caseId: 1, startId: 'Start', startedAt: 0, endedAt: 11 },
        { caseId: 2, startId: 'Start', startedAt: 0, endedAt: 12 },
        { caseId: 3, startId: 'Start', startedAt: 0, endedAt: 13 },
      ],
      rows: [row(1, 'Task', 10, 1), row(2, 'Task', 10, 2), row(3, 'Task', 10, 3), row(1, 'Timer', 1, 7)],
      flows: {},
      elements: {
        Task: { started: 3, completed: 3 },
        Timer: { started: 1, completed: 1 },
      },
      warnings: [],
    };

    const result = aggregateReplication(makeIr({ Task: 'task', Timer: 'timer' }, {}), run);
    expect(result.elements.Task?.resourceWait).toEqual({ min: 1, max: 3, mean: 2, sd: 1, total: 6 });
    expect(result.elements.Timer?.resourceWait.sd).toBe(0);
  });

  test('interpola percentiles en ambos bordes de una muestra par', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 30,
      statisticsDuration: 30,
      cases: [0, 10, 20, 30].map((endedAt, index) => ({
        caseId: index + 1,
        startId: 'Start',
        startedAt: 0,
        endedAt,
      })),
      rows: [],
      flows: {},
      elements: {},
      warnings: [],
    };

    const cycle = aggregateReplication(makeIr({ Start: 'start' }, {}), run).process.cycleTime;
    expect(cycle).toMatchObject({ min: 0, max: 30, p50: 15, p90: 27 });
    expect(cycle.p95).toBeCloseTo(28.5, 12);
  });

  test('throughput usa solo [warmup, stoppedAt] y evita dividir entre una ventana vacía', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 100,
      statisticsDuration: 50,
      cases: [{ caseId: 6, startId: 'Start', startedAt: 50, endedAt: 60 }],
      rows: [],
      flows: {},
      elements: {},
      warnings: [],
    };

    expect(
      aggregateReplication(makeIr({ Start: 'start' }, {}), run).process.throughputPerHour,
    ).toBe(72);
    run.statisticsDuration = 0;
    expect(
      aggregateReplication(makeIr({ Start: 'start' }, {}), run).process.throughputPerHour,
    ).toBe(0);
  });

  test('costPerCase excluye costos de casos en vuelo, pero totalCost los conserva (R-COST-4)', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 20,
      statisticsDuration: 20,
      cases: [
        { caseId: 1, startId: 'Start', startedAt: 0, endedAt: 10 },
        { caseId: 2, startId: 'Start', startedAt: 0, endedAt: null },
      ],
      rows: [row(1, 'Task', 10, 0, 0, 2), row(2, 'Task', 10, 0, 0, 100)],
      flows: {},
      elements: { Task: { started: 2, completed: 2 } },
      warnings: [],
    };

    const process = aggregateReplication(makeIr({ Task: 'task' }, {}), run).process;
    expect(process).toMatchObject({ started: 2, completed: 1, inFlight: 1, totalCost: 102, costPerCase: 2 });
  });
});

/* ------------------------------------------------------------------ *
 * LILA-191 · W-RECURSO-SATURADO
 * ------------------------------------------------------------------ */

/** Fila con pool: la instancia servida lleva `resourceId`; la que sigue en cola es el sentinel. */
function poolRow(caseId: number, enabledAt: number, startedAt: number | null, service: number, stoppedAt: number): EventLogRow {
  const served = startedAt !== null;
  return {
    replication: 0,
    caseId: String(caseId),
    activityInstanceId: `${caseId}-Task`,
    elementId: 'Task',
    // R-REC-11: quien nunca llegó a asignar nada solo tiene una fila sentinel, sin pool.
    resourceId: served ? 'horno' : null,
    allocationIndex: served ? 0 : null,
    resourceQuantity: served ? 1 : null,
    status: served ? 'completed' : 'inFlight',
    enabledAt,
    startedAt,
    endedAt: served ? startedAt + service : null,
    observedUntil: served ? startedAt + service : stoppedAt,
    resourceWait: served ? startedAt - enabledAt : stoppedAt - enabledAt,
    offHoursWait: 0,
    elementCost: 0,
    resourceCost: 0,
    cost: 0,
  };
}

/**
 * Una cola FIFO con capacidad 1 servida en serie: llega una instancia cada `interArrival`
 * segundos y cada servicio dura `service`. Con `service > interArrival` el pool no da abasto y
 * las instancias que no alcanzan a arrancar quedan en cola hasta `stoppedAt`.
 */
function serialQueueRun(interArrival: number, service: number, stoppedAt: number): ReplicationRun {
  const rows: EventLogRow[] = [];
  const cases: ReplicationRun['cases'] = [];
  let free = 0;
  for (let index = 0; index * interArrival < stoppedAt; index++) {
    const enabledAt = index * interArrival;
    const startedAt = Math.max(free, enabledAt);
    const served = startedAt + service <= stoppedAt;
    if (served) free = startedAt + service;
    rows.push(poolRow(index, enabledAt, served ? startedAt : null, service, stoppedAt));
    cases.push({ caseId: index, startId: 'Start', startedAt: enabledAt, endedAt: served ? startedAt + service : null });
  }
  return {
    replication: 0,
    stoppedAt,
    statisticsDuration: stoppedAt,
    cases,
    rows,
    flows: {},
    elements: { Task: { started: rows.length, completed: rows.filter((entry) => entry.endedAt !== null).length } },
    warnings: [],
  };
}

const SATURATION_IR = makeIr({ Task: 'task' }, {});
const SATURATION_SCENARIO: SimScenario = {
  run: {},
  resources: { horno: { capacity: 1 } },
  elements: { Task: { resources: [{ ref: 'horno', quantity: 1 }] } },
};

describe('W-RECURSO-SATURADO (LILA-191)', () => {
  test('avisa con ρ ≈ 4 cuando el servicio dura cuatro veces el intervalo entre llegadas', () => {
    const run = serialQueueRun(50, 200, 10_000);
    const result = aggregateReplication(SATURATION_IR, run, SATURATION_SCENARIO);

    expect(result.warnings).toEqual([
      'W-RECURSO-SATURADO: horno: la cola crece sin estabilizarse (λ/μ·c ≈ 4.0)',
    ]);
    // Es un aviso, no una corrección: las métricas del pool son las mismas con y sin él.
    expect(result.resources.horno?.busyTime).toBe(10_000);
    expect(result.resources.horno?.utilization).toBe(1);
  });

  test('no avisa cuando el pool despacha todo lo que le llega', () => {
    const run = serialQueueRun(200, 100, 10_000);
    const result = aggregateReplication(SATURATION_IR, run, SATURATION_SCENARIO);

    expect(result.warnings).toEqual([]);
    expect(result.elements.Task?.queueLength.max).toBe(0);
  });

  test('cuenta la cola de las instancias que nunca asignaron pool (fila sentinel, R-REC-11)', () => {
    const run = serialQueueRun(50, 200, 10_000);
    // Sin mirar la declaración del elemento, las instancias que se quedaron esperando serían
    // invisibles: su única fila no nombra a `horno`.
    expect(run.rows.filter((entry) => entry.resourceId === null)).not.toHaveLength(0);
    expect(aggregateReplication(SATURATION_IR, run, { run: {}, resources: { horno: { capacity: 1 } } }).warnings)
      .toEqual([]);
  });

  test('sin `resources` en el escenario el resultado no cambia (R-DEG-1)', () => {
    const run = serialQueueRun(50, 200, 10_000);

    expect(aggregateReplication(SATURATION_IR, run).warnings).toEqual([]);
  });
});

describe('el criterio de W-RECURSO-SATURADO es una función de las cantidades promediadas', () => {
  /** Un pool cuya cola atribuida se duplica entre mitades y deja pendiente el 60 % de lo servido. */
  const SATURADA: PoolLoad = { demand: 200, served: 100, pending: 60, capacity: 1, firstHalf: 10, secondHalf: 40 };
  /** M/M/1 con ρ = 0,8: cola larga (Lq = 3,2) pero estacionaria y sin pendientes al corte. */
  const ESTABLE: PoolLoad = { demand: 80, served: 100, pending: 1, capacity: 1, firstHalf: 4, secondHalf: 4 };

  function meanLoad(loads: readonly PoolLoad[]): PoolLoad {
    const total: PoolLoad = { demand: 0, served: 0, pending: 0, capacity: 0, firstHalf: 0, secondHalf: 0 };
    for (const load of loads) {
      total.demand += load.demand / loads.length;
      total.served += load.served / loads.length;
      total.pending += load.pending / loads.length;
      total.capacity += load.capacity / loads.length;
      total.firstHalf += load.firstHalf / loads.length;
      total.secondHalf += load.secondHalf / loads.length;
    }
    return total;
  }

  test('la cola estacionaria larga no avisa y la que crece sí', () => {
    expect(saturationWarning('p', SATURADA)).toBe(
      'W-RECURSO-SATURADO: p: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)',
    );
    expect(saturationWarning('p', ESTABLE)).toBeUndefined();
  });

  test('una réplica saturada de treinta no satura la corrida', () => {
    expect(saturationWarning('p', meanLoad([SATURADA, ...Array<PoolLoad>(29).fill(ESTABLE)]))).toBeUndefined();
    expect(saturationWarning('p', meanLoad(Array<PoolLoad>(30).fill(SATURADA)))).toBeDefined();
  });

  test('ρ por debajo de 1,1 no avisa aunque la cola crezca', () => {
    expect(saturationWarning('p', { ...SATURADA, demand: 100 })).toBeUndefined();
  });

  test('el pendiente al corte basta sin crecimiento entre mitades', () => {
    expect(saturationWarning('p', { ...SATURADA, firstHalf: 40, secondHalf: 40 })).toBeDefined();
    expect(saturationWarning('p', { ...SATURADA, firstHalf: 40, secondHalf: 40, pending: 1 })).toBeUndefined();
  });

  test('el pendiente al corte no basta si la cola está bajando', () => {
    // R-ARR-1: un lote de llegadas simultáneas deja mucho pendiente al corte mientras la cola
    // **baja**. Eso es trabajo despachándose, no un pool sin estado estacionario.
    expect(saturationWarning('p', { ...SATURADA, firstHalf: 40, secondHalf: 30 })).toBeUndefined();
  });

  test('la capacidad efectiva son unidades del pool, no unidades diluidas por el calendario', () => {
    // Con `capacity` 50 la cola de 40 cabe en el pool y no es evidencia de nada; medir la
    // capacidad como `disponible / duración de la ventana` daría 50/3,6 y volvería a avisar.
    expect(saturationWarning('p', { ...SATURADA, capacity: 50, pending: 1 })).toBeUndefined();
    expect(saturationWarning('p', { ...SATURADA, capacity: 50 / 3.6, pending: 1 })).toBeDefined();
  });
});

describe('W-RECURSO-SATURADO sobre los ejemplos reales (LILA-191)', () => {
  const EXAMPLES = new URL('../../../../examples/', import.meta.url);

  /** Corre un ejemplo tal cual (o con `patch` aplicado) y devuelve solo los avisos de LILA-191. */
  async function saturationOf(
    path: string,
    patch: (scenario: SimScenario & { model: string }) => void = () => {},
  ): Promise<string[]> {
    const url = new URL(path, EXAMPLES);
    const scenario = JSON.parse(readFileSync(url, 'utf8')) as SimScenario & { model: string };
    patch(scenario);
    const parsed = await parseBpmn(readFileSync(new URL(scenario.model, url), 'utf8'));
    return simulate(parsed.ir, scenario, { log: false }).warnings.filter((warning) =>
      warning.startsWith('W-RECURSO-SATURADO'),
    );
  }

  // ponytail: los ejemplos corren 30 réplicas de 30 días (~0,6 s cada uno en frío); el margen del
  // timeout es para una máquina cargada, no una expectativa de duración.
  const SLOW = 120_000;

  test('examples/pedido AS-IS avisa por `horno` y por nadie más, una vez para las 30 réplicas', async () => {
    // `cocinero` comparte por AND (R-REC-4) la cola exacta de `horno` y `cajero` la de sus propias
    // tareas, pero ninguno de los dos estuvo lleno mientras esa cola esperaba: no se les atribuye.
    expect(await saturationOf('pedido/as-is.scenario.json')).toEqual([
      'W-RECURSO-SATURADO: horno: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)',
    ]);
  }, SLOW);

  test('M/M/1 con ρ = 0,8 no avisa pese a tener Lq = 3,2 en cola', async () => {
    expect(await saturationOf('mm1/mm1-rho08/scenario.json')).toEqual([]);
  }, SLOW);

  test('M/M/3 con ρ = 0,8 tampoco avisa', async () => {
    expect(await saturationOf('mm1/mm3/scenario.json')).toEqual([]);
  }, SLOW);

  test('una alternativa OR que nunca se llena no avisa (R-REC-6)', async () => {
    // Dos servidores en OR a ρ = 0,8 cada uno: la instancia se encola en los dos, así que contar
    // su demanda entera en cada alternativa daba ρ ≈ 2 y avisaba por ambos.
    const warnings = await saturationOf('mm1/mm1-rho08/scenario.json', (scenario) => {
      scenario.resources = { ...scenario.resources, suplente: { capacity: 1 } };
      scenario.elements = {
        ...scenario.elements,
        Task_Servicio: {
          processingTime: { type: 'exponential', mean: 600 },
          resources: [{ ref: 'servidor', quantity: 1 }, { ref: 'suplente', quantity: 1 }],
          selection: 'or',
        },
      };
    });

    expect(warnings).toEqual([]);
  }, SLOW);

  test('un pool ocioso atado por AND a uno saturado no avisa (R-REC-4)', async () => {
    // `ocioso` tiene 49 de sus 50 unidades libres toda la corrida y hereda, sin embargo, la cola
    // entera de `servidor`: la utilización publicada (0,02) y el aviso se contradecían.
    const warnings = await saturationOf('mm1/mm1-rho08/scenario.json', (scenario) => {
      scenario.resources = { ...scenario.resources, ocioso: { capacity: 50 } };
      scenario.elements = {
        ...scenario.elements,
        Task_Servicio: {
          processingTime: { type: 'exponential', mean: 637.5 },
          resources: [{ ref: 'servidor', quantity: 1 }, { ref: 'ocioso', quantity: 1 }],
          selection: 'and',
        },
      };
    });

    expect(warnings).toEqual([
      'W-RECURSO-SATURADO: servidor: la cola crece sin estabilizarse (λ/μ·c ≈ 1.7)',
    ]);
  }, SLOW);

  test('dos pools en AND genuinamente saturados avisan los dos', async () => {
    // El discriminante no puede ser «uno por tarea»: aquí los dos pools están de verdad llenos
    // toda la corrida (ρ ≈ 2 cada uno) y los dos frenan la cola.
    const warnings = await saturationOf('mm1/mm1-rho08/scenario.json', (scenario) => {
      scenario.run.replications = 3;
      scenario.resources = { ...scenario.resources, servidorB: { capacity: 1 } };
      scenario.elements = {
        ...scenario.elements,
        Task_Servicio: {
          processingTime: { type: 'exponential', mean: 750 },
          resources: [{ ref: 'servidor', quantity: 1 }, { ref: 'servidorB', quantity: 1 }],
          selection: 'and',
        },
      };
    });

    expect(warnings).toEqual([
      'W-RECURSO-SATURADO: servidor: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)',
      'W-RECURSO-SATURADO: servidorB: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)',
    ]);
  }, SLOW);

  test('un pool compartido por dos tareas avisa una vez, no una por tarea', async () => {
    // `cajero` (capacity 1) lo satura `Task_TomarPedido`; `Task_Revisar` también lo pide y espera
    // por su culpa. El aviso pertenece al pool: una sola línea, y ninguna para `cocinero`, que es
    // la otra alternativa OR de `Task_Revisar` y está ociosa (utilización 0,32).
    const warnings = await saturationOf('pedido/as-is.scenario.json', (scenario) => {
      scenario.run.replications = 2;
      scenario.resources!['cajero']!.capacity = 1;
      scenario.elements!['Task_TomarPedido']!.processingTime = { type: 'constant', value: 600 };
    });

    expect(warnings).toEqual([
      'W-RECURSO-SATURADO: cajero: la cola crece sin estabilizarse (λ/μ·c ≈ 2.5)',
    ]);
  }, SLOW);

  test('un pool pedido de dos en dos se llena aunque `capacity` no sea múltiplo de `quantity`', async () => {
    // El kernel nunca concede por encima del último múltiplo de `quantity`: con `capacity` 3 y
    // `quantity` 2 la tercera unidad no la puede tomar nadie y `used >= capacity` no se cumplía
    // jamás, así que el pool llegaba al criterio con demanda cero pese a tener ρ real 2.
    const warnings = await saturationOf('mm1/mm1-rho08/scenario.json', (scenario) => {
      scenario.run.replications = 3;
      scenario.resources!['servidor']!.capacity = 3;
      scenario.elements!['Task_Servicio'] = {
        processingTime: { type: 'exponential', mean: 750 },
        resources: [{ ref: 'servidor', quantity: 2 }],
      };
    });

    expect(warnings).toEqual([
      'W-RECURSO-SATURADO: servidor: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)',
    ]);
  }, SLOW);

  test.each([
    [1500, ['W-RECURSO-SATURADO: servidor: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)']],
    [375, []],
  ])('con `capacity` múltiplo de `quantity` el umbral es el de siempre (servicio %i s)', async (mean, expected) => {
    // `capacity` 4 pedida de dos en dos son dos servidores: `used > capacity − 2` es exactamente
    // `used >= 4`, así que el caso divisible —el que enmascaraba el fallo— no cambia.
    const warnings = await saturationOf('mm1/mm1-rho08/scenario.json', (scenario) => {
      scenario.run.replications = 3;
      scenario.resources!['servidor']!.capacity = 4;
      scenario.elements!['Task_Servicio'] = {
        processingTime: { type: 'exponential', mean },
        resources: [{ ref: 'servidor', quantity: 2 }],
      };
    });

    expect(warnings).toEqual(expected);
  }, SLOW);

  test('un lote de llegadas simultáneas que drena no avisa (R-ARR-1)', async () => {
    // 2000 instancias en `t = 0` y ninguna llegada más: al cortar queda cola pendiente de sobra
    // para el 25 % de lo servido, pero la cola de la segunda mitad es **menor** que la de la
    // primera. No hay λ que comparar con μ·c: es un lote despachándose.
    const warnings = await saturationOf('mm1/mm1-rho08/scenario.json', (scenario) => {
      scenario.run.replications = 1;
      scenario.run.warmup = 0;
      scenario.run.duration = 300_000;
      scenario.elements!['StartEvent_Llegadas'] = { triggerCount: 2000 };
    });

    expect(warnings).toEqual([]);
  }, SLOW);

  test('un pool con muchos tramos llenos cortos se atribuye igual que uno con un solo tramo', async () => {
    // `cajero` acumula miles de tramos llenos cortos y las esperas de `Task_Preparar` los cruzan
    // enteros: recorrerlos uno a uno hacía el cálculo cuadrático en la duración de la corrida.
    // Con las sumas de prefijos el solape es `F(b) − F(a)` y el resultado es el mismo.
    const warnings = await saturationOf('pedido/as-is.scenario.json', (scenario) => {
      scenario.run.replications = 1;
      scenario.elements!['StartEvent_Pedido']!.triggerCount = 1_000_000;
      scenario.elements!['Task_TomarPedido']!.processingTime = { type: 'constant', value: 200 };
      scenario.elements!['Task_Preparar']!.resources = [{ ref: 'cocinero' }, { ref: 'horno' }, { ref: 'cajero' }];
    });

    expect(warnings).toEqual([
      'W-RECURSO-SATURADO: cajero: la cola crece sin estabilizarse (λ/μ·c ≈ 1.2)',
      'W-RECURSO-SATURADO: horno: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)',
    ]);
  }, SLOW);

  test.each(['level-1', 'level-2', 'level-3', 'level-4'])(
    'ningún pool de examples/bizagi-levels/%s avisa',
    async (level) => {
      expect(await saturationOf(`bizagi-levels/${level}/scenario.json`)).toEqual([]);
    },
    SLOW,
  );
});
