import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { parseBpmn, validate } from '../src/bpmn/index.js';
import { simulate, type RunResult } from '../src/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario, type ResolvedScenario } from '../src/scenario.js';

// LILA-044 (M3, LILA_MODELER_ESTRUCTURA.md §3 y §7 aceptación M3(d)): corre los cuatro ejemplos de
// examples/bizagi-levels con el motor completo y compara cada número que expected.json cita de la
// página oficial, tolerancia ±5 %.
//
// Regla del ticket: reconciliar, no calibrar. Ni un parámetro de examples/bizagi-levels se ha
// tocado; lo que se investiga es la semántica. Este archivo tiene dos mitades:
//
//   A. `réplicas publicadas, tal cual` — simula lo que hay committeado. La mayoría de los números
//      NO cuadra, y cada fila lleva escrito si cuadra o no. La aserción es sobre ese booleano, no
//      sobre el valor: el día que una fila cambie de lado el test se pone rojo y hay que actualizar
//      la fila y `docs/BIZAGI_PARITY.md` a la vez.
//   B. `reconciliación` — la misma comparación sobre la topología del diagrama oficial de Bizagi
//      (fixtures/bizagi-emergency-oficial.bpmn) y con las llegadas que la corrida publicada
//      realmente usó. Es la prueba de la causa: casi todo cuadra dentro del 5 %, y lo que no
//      cuadra queda aislado en dos sitios concretos (nivel 3 con 2 enfermeras, y el nivel 4
//      entero, que necesita LILA-164). Las variantes viven aquí, nunca en examples/.
//
// Causas encontradas, en `docs/BIZAGI_PARITY.md` §Diferencias documentadas:
//   (1) el `model.bpmn` de los niveles 2-4 reconstruye el proceso como 7 tareas en secuencia; el
//       diagrama oficial es Recibir → Clasificar → XOR "Triage type" con Red 50 % (AND de Manage
//       patient entry ‖ Pick up patient, luego Authorize Entry), Yellow 30 % (Arrive QAV) y
//       Green 20 % (Arrive BA). Con la secuencia el ciclo son 51-54 min contra los 16/33/25 min
//       publicados, y la enfermera pide 16 min por caso en vez de 10,5, o sea 3,2 enfermeras de
//       carga contra 2,1: por eso satura con 3.
//   (2) las llegadas publicadas son **constantes** cada 5 min, no exponenciales de media 5 min:
//       la corrida oficial trae exactamente 2017 instancias (10080/5 + 1), imposible con Poisson.
//   (3) Bizagi drena la corrida (2017 iniciadas = 2017 completadas); el escenario publicado corta
//       a la semana y deja casos en vuelo, que por LILA-036 no entran en las medias.
//   (4) [resuelta por LILA-186] el nivel 1 declaraba `triggerCount` sin `interTriggerTimer` y no
//       generaba un solo token. R-ARR-1 ya dice que esa combinación son N llegadas en `t = 0`,
//       que es lo que hace Bizagi en el nivel 1; el aviso `W-START-SIN-LLEGADAS` queda para el
//       start que no declara ninguno de los dos campos.
//   (5) el nivel 4 modela la capacidad por turno como 3 pools con `selection: "or"`; el calendario
//       efectivo de la tarea pasa a ser el del turno concedido, así que el trabajo se pausa al
//       cerrar el turno. Bizagi no tiene tiempo cerrado ahí (los 3 turnos cubren las 24 h): es
//       plantilla por turno, no horario. Es exactamente lo que pide LILA-164.
//
// `expected.json` llama `waitTimeSeconds` a lo que la tabla de Bizagi titula "Min./Max./Avg. time"
// del proceso, que es tiempo de ciclo (procesamiento + espera), no espera: se compara contra
// `process.cycleTime`. Se deja también la fila contra `process.waitTime` para dejar el mapeo
// escrito y anclado.

const here = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(here, '../../../examples/bizagi-levels');
const OFICIAL_BPMN = resolve(here, 'fixtures/bizagi-emergency-oficial.bpmn');

const TOLERANCIA = 0.05; // ±5 %, LILA-044
const REPLICACIONES_RECONCILIACION = 30;

/** Probabilidades del gateway "Triage type", publicadas en prosa en level_1_example.htm. */
const TRIAGE = {
  Flow_Green: { probability: 0.2 },
  Flow_Yellow: { probability: 0.3 },
  Flow_Red: { probability: 0.5 },
} as const;

/**
 * Llegadas y parada de la corrida oficial: constante de 5 min y 2017 tokens, sin `duration`, así
 * que la corrida termina cuando el heap se vacía (R-ARR-3) igual que hace Bizagi.
 */
const LLEGADAS_OFICIALES = {
  StartEvent_Llegada: { interTriggerTimer: { type: 'constant', value: 300 }, triggerCount: 2017 },
} as const;

interface Fila {
  metrica: string;
  esperado: number;
  obtenido: number;
  /** Estado documentado hoy: true = dentro del ±5 %. */
  cuadra: boolean;
}

function relativo(obtenido: number, esperado: number): number {
  if (esperado === 0) return obtenido === 0 ? 0 : Infinity;
  return (obtenido - esperado) / Math.abs(esperado);
}

/** Comprueba fila a fila que cada número sigue del lado de la tolerancia donde está documentado. */
function comprobar(filas: Fila[]): void {
  for (const fila of filas) {
    const rel = relativo(fila.obtenido, fila.esperado);
    const dentro = Math.abs(rel) <= TOLERANCIA;
    const detalle = `${fila.metrica}: Bizagi=${fila.esperado} Lila=${fila.obtenido} dif=${(rel * 100).toFixed(2)}%`;
    expect(dentro, dentro ? `${detalle} — cuadra, pero está documentado como diferencia` : detalle).toBe(fila.cuadra);
  }
}

async function irDe(rutaBpmn: string) {
  const parsed = await parseBpmn(readFileSync(rutaBpmn, 'utf8'));
  const problemas = validate(parsed.ir, { unsupported: parsed.unsupported });
  if (problemas.errors.length > 0) throw new Error(`${rutaBpmn} inválido: ${JSON.stringify(problemas.errors)}`);
  return parsed.ir;
}

function escenarioDe(level: number): ResolvedScenario {
  const raw: unknown = JSON.parse(readFileSync(resolve(levelsDir, `level-${level}`, 'scenario.json'), 'utf8'));
  const parsed = ScenarioSchema.parse(raw);
  if (parsed.model === undefined || parsed.run === undefined) {
    throw new Error(`level-${level}/scenario.json no es un escenario resuelto`);
  }
  return { ...parsed, model: parsed.model, run: parsed.run };
}

/** Forma de los `expected.json` publicados, en lo que este test consume. */
interface Publicado {
  values: {
    correctedRun?: { instancesCompleted: { green: number; yellow: number; red: number; total: number } };
    waitTimeSeconds?: { min: number; max: number; avg: number };
    threeNurses?: { waitTimeSeconds: { min: number; max: number; avg: number }; resourceUtilization: { nurse: number } };
    twoNurses?: { waitTimeSeconds: { min: number; max: number; avg: number }; resourceUtilization: { nurse: number } };
    arriveAtPatientPlaceBA?: { maxWaitSeconds: number; avgWaitSeconds: number };
  };
}

function expectedDe(level: number): Publicado {
  return JSON.parse(readFileSync(resolve(levelsDir, `level-${level}`, 'expected.json'), 'utf8')) as Publicado;
}

function correr(ir: Awaited<ReturnType<typeof irDe>>, scenario: ResolvedScenario): RunResult {
  const problemas = scenarioErrors(validateScenario(scenario, ir));
  if (problemas.length > 0) throw new Error(`escenario inválido: ${JSON.stringify(problemas)}`);
  return simulate(ir, scenario, { log: false });
}

// ---------------------------------------------------------------------------------------------
// A. Las réplicas publicadas, tal cual están committeadas.
// ---------------------------------------------------------------------------------------------

describe('examples/bizagi-levels tal cual: qué cuadra hoy contra expected.json', () => {
  test('nivel 1 — validación de rutas: el escenario publicado emite sus 1000 tokens en t = 0', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-1/model.bpmn'));
    const r = correr(ir, escenarioDe(1));
    const esperado = expectedDe(1).values.correctedRun!.instancesCompleted;

    // Causa (4), resuelta por LILA-186: `triggerCount` sin `interTriggerTimer` significa N
    // llegadas en `t = 0` (R-ARR-1), que es la configuración del nivel 1 de Bizagi (solo "Max.
    // arrival count" y porcentajes de gateway). Ya no hay `W-START-SIN-LLEGADAS` ni corrida vacía.
    expect(r.process.started, 'el nivel 1 emite sus 1000 tokens').toBe(1000);
    expect(r.warnings.filter((w) => w.startsWith('W-START-SIN-LLEGADAS'))).toEqual([]);

    comprobar([
      { metrica: 'nivel 1 tokens creados', esperado: 1000, obtenido: r.process.started, cuadra: true },
      { metrica: 'nivel 1 total completado en end events', esperado: esperado.total, obtenido: r.process.completed, cuadra: true },
    ]);
  }, 60_000);

  test('nivel 2 — tiempos de proceso: la topología en secuencia da 51-54 min, no 16/33/25', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-2/model.bpmn'));
    const r = correr(ir, escenarioDe(2));
    const w = expectedDe(2).values.waitTimeSeconds!;

    comprobar([
      { metrica: 'nivel 2 cycleTime.min', esperado: w.min, obtenido: r.process.cycleTime.min, cuadra: false },
      { metrica: 'nivel 2 cycleTime.max', esperado: w.max, obtenido: r.process.cycleTime.max, cuadra: false },
      { metrica: 'nivel 2 cycleTime.mean', esperado: w.avg, obtenido: r.process.cycleTime.mean, cuadra: false },
      // Mapeo: `process.waitTime` es espera pura y con recursos infinitos vale 0 (R-DEG-1).
      { metrica: 'nivel 2 waitTime.mean (mapeo equivocado, queda anclado)', esperado: w.avg, obtenido: r.process.waitTime.mean, cuadra: false },
    ]);
  }, 60_000);

  test('nivel 3 — recursos: con 16 min de enfermera por caso el pool satura con 3', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-3/model.bpmn'));
    const publicado = escenarioDe(3);
    const tres = correr(ir, publicado);
    const dos = correr(ir, {
      ...publicado,
      resources: { ...publicado.resources, nurse: { ...publicado.resources!.nurse!, capacity: 2 } },
    });
    const v = expectedDe(3).values as Required<Publicado['values']>;

    comprobar([
      { metrica: 'nivel 3 (3 enf.) cycleTime.min', esperado: v.threeNurses.waitTimeSeconds.min, obtenido: tres.process.cycleTime.min, cuadra: false },
      { metrica: 'nivel 3 (3 enf.) cycleTime.max', esperado: v.threeNurses.waitTimeSeconds.max, obtenido: tres.process.cycleTime.max, cuadra: false },
      { metrica: 'nivel 3 (3 enf.) cycleTime.mean', esperado: v.threeNurses.waitTimeSeconds.avg, obtenido: tres.process.cycleTime.mean, cuadra: false },
      { metrica: 'nivel 3 (3 enf.) utilización nurse', esperado: v.threeNurses.resourceUtilization.nurse, obtenido: tres.resources.nurse!.utilization, cuadra: false },
      { metrica: 'nivel 3 (2 enf.) cycleTime.mean', esperado: v.twoNurses.waitTimeSeconds.avg, obtenido: dos.process.cycleTime.mean, cuadra: false },
      // La utilización con 2 enfermeras sí cuadra, pero por la razón equivocada: el pool satura
      // igual (99,9 %) con 16 min de trabajo por caso que con 10,5.
      { metrica: 'nivel 3 (2 enf.) utilización nurse', esperado: v.twoNurses.resourceUtilization.nurse, obtenido: dos.resources.nurse!.utilization, cuadra: true },
    ]);
  }, 60_000);

  test('nivel 4 — calendarios: los pools por turno añaden espera fuera de horario que Bizagi no tiene', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-4/model.bpmn'));
    const r = correr(ir, escenarioDe(4));
    const v = expectedDe(4).values as Required<Publicado['values']>;
    const ba = r.elements.Task_LlegarBA!;

    // Causa (5): los tres turnos cubren las 24 h, así que bajo la semántica de Bizagi ninguna
    // tarea puede tener espera fuera de horario. En Lila sí la tiene, y es la mayor parte del
    // desvío del ciclo.
    expect(ba.offHoursWait.mean, 'el workaround de turnos crea espera fuera de horario').toBeGreaterThan(0);

    comprobar([
      { metrica: 'nivel 4 cycleTime.mean', esperado: v.waitTimeSeconds.avg, obtenido: r.process.cycleTime.mean, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.max', esperado: v.arriveAtPatientPlaceBA.maxWaitSeconds, obtenido: ba.resourceWait.max, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.mean', esperado: v.arriveAtPatientPlaceBA.avgWaitSeconds, obtenido: ba.resourceWait.mean, cuadra: false },
    ]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// B. Reconciliación: la misma comparación sobre la topología del diagrama oficial.
// ---------------------------------------------------------------------------------------------

describe('reconciliación: topología del diagrama oficial + llegadas de la corrida publicada', () => {
  test('nivel 1 — el XOR reparte 50/30/20 y los 1000 tokens terminan en los tres end events', async () => {
    const ir = await irDe(OFICIAL_BPMN);
    const publicado = escenarioDe(1);
    // Única variante: dar al start un `interTriggerTimer` para que `triggerCount` emita (causa 4).
    // Bizagi nivel 1 no define tiempos, así que los 1000 tokens entran sin consumir reloj.
    const r = correr(ir, {
      ...publicado,
      run: { ...publicado.run, replications: REPLICACIONES_RECONCILIACION },
      elements: {
        ...publicado.elements,
        StartEvent_Llegada: { ...publicado.elements!.StartEvent_Llegada, interTriggerTimer: { type: 'constant', value: 0 } },
      },
    });
    const c = expectedDe(1).values.correctedRun!.instancesCompleted;

    expect(r.process.started).toBe(1000);
    expect(r.process.completed).toBe(1000);

    // expected.json etiqueta los tres conteos publicados como green/yellow/red al revés. La página
    // no da la asignación en prosa —solo la suma "(483+315+202)"— pero sí publica la tabla de
    // resultados fila por fila en https://help.bizagi.com/platform/en/processvalidation42.png:
    // "Red Triage end 483 · Yellow Triage end 315 · Green Triage end 202". Corregir expected.json
    // es LILA-187; aquí se compara contra el conteo correcto usando la etiqueta equivocada.
    comprobar([
      { metrica: 'nivel 1 rama 50 % (Red) vs 483 publicado', esperado: c.green, obtenido: r.elements.EndEvent_Red!.completed, cuadra: true },
      { metrica: 'nivel 1 rama 30 % (Yellow) vs 315 publicado', esperado: c.yellow, obtenido: r.elements.EndEvent_Yellow!.completed, cuadra: false },
      { metrica: 'nivel 1 rama 20 % (Green) vs 202 publicado', esperado: c.red, obtenido: r.elements.EndEvent_Green!.completed, cuadra: true },
      // Contra la probabilidad configurada, que es lo que de verdad valida el nivel 1, las tres
      // ramas cuadran: el 315 de Bizagi es ruido de su propia corrida única (+5 % sobre su 30 %).
      { metrica: 'nivel 1 rama 50 % vs 1000×p', esperado: 500, obtenido: r.flows.Flow_Red!.count, cuadra: true },
      { metrica: 'nivel 1 rama 30 % vs 1000×p', esperado: 300, obtenido: r.flows.Flow_Yellow!.count, cuadra: true },
      { metrica: 'nivel 1 rama 20 % vs 1000×p', esperado: 200, obtenido: r.flows.Flow_Green!.count, cuadra: true },
    ]);
  }, 60_000);

  test('nivel 2 — 16 / 33 / 25 min: los tres números publicados, dentro del 5 %', async () => {
    const ir = await irDe(OFICIAL_BPMN);
    const publicado = escenarioDe(2);
    const r = correr(ir, {
      ...publicado,
      run: { ...publicado.run, replications: REPLICACIONES_RECONCILIACION, duration: undefined },
      elements: { ...publicado.elements, ...TRIAGE, ...LLEGADAS_OFICIALES },
    });
    const w = expectedDe(2).values.waitTimeSeconds!;

    expect(r.process.started, 'la corrida oficial trae 2017 instancias').toBe(2017);
    expect(r.process.completed).toBe(2017);

    comprobar([
      { metrica: 'nivel 2 cycleTime.min', esperado: w.min, obtenido: r.process.cycleTime.min, cuadra: true },
      { metrica: 'nivel 2 cycleTime.max', esperado: w.max, obtenido: r.process.cycleTime.max, cuadra: true },
      { metrica: 'nivel 2 cycleTime.mean', esperado: w.avg, obtenido: r.process.cycleTime.mean, cuadra: true },
    ]);
  }, 60_000);

  test('nivel 3 — utilización de los seis recursos y ciclo con 3 y con 2 enfermeras', async () => {
    const ir = await irDe(OFICIAL_BPMN);
    const publicado = escenarioDe(3);
    const base: ResolvedScenario = {
      ...publicado,
      run: { ...publicado.run, replications: REPLICACIONES_RECONCILIACION, duration: undefined },
      elements: { ...publicado.elements, ...TRIAGE, ...LLEGADAS_OFICIALES },
    };
    const tres = correr(ir, base);
    const dos = correr(ir, { ...base, resources: { ...base.resources, nurse: { ...base.resources!.nurse!, capacity: 2 } } });
    const v = expectedDe(3).values as Required<Publicado['values']>;

    comprobar([
      { metrica: 'nivel 3 (3 enf.) cycleTime.min', esperado: v.threeNurses.waitTimeSeconds.min, obtenido: tres.process.cycleTime.min, cuadra: true },
      { metrica: 'nivel 3 (3 enf.) cycleTime.mean', esperado: v.threeNurses.waitTimeSeconds.avg, obtenido: tres.process.cycleTime.mean, cuadra: true },
      // El máximo publicado (35 min) es el camino Red de 33 min más 2 min de espera de enfermera
      // que en la corrida de Bizagi cayeron en el camino crítico; en la nuestra la espera máxima
      // de Classify Triage es de segundos y el máximo se queda en los 33 min del camino puro.
      { metrica: 'nivel 3 (3 enf.) cycleTime.max', esperado: v.threeNurses.waitTimeSeconds.max, obtenido: tres.process.cycleTime.max, cuadra: false },
      { metrica: 'nivel 3 (3 enf.) utilización nurse', esperado: v.threeNurses.resourceUtilization.nurse, obtenido: tres.resources.nurse!.utilization, cuadra: true },
      { metrica: 'nivel 3 (2 enf.) utilización nurse', esperado: v.twoNurses.resourceUtilization.nurse, obtenido: dos.resources.nurse!.utilization, cuadra: true },
      { metrica: 'nivel 3 (2 enf.) cycleTime.min', esperado: v.twoNurses.waitTimeSeconds.min, obtenido: dos.process.cycleTime.min, cuadra: true },
      { metrica: 'nivel 3 (2 enf.) cycleTime.max', esperado: v.twoNurses.waitTimeSeconds.max, obtenido: dos.process.cycleTime.max, cuadra: true },
      // Único residuo del nivel 3: con el pool saturado (rho = 1,05) la media depende de la forma
      // del transitorio. Bizagi acumula cola sublinealmente (media/máx = 0,40) y Lila linealmente
      // (0,49), así que el máximo cuadra al 1,3 % y la media se va al +24 %.
      { metrica: 'nivel 3 (2 enf.) cycleTime.mean', esperado: v.twoNurses.waitTimeSeconds.avg, obtenido: dos.process.cycleTime.mean, cuadra: false },
    ]);

    // Costos publicados de la corrida de 3 enfermeras, tabla de recursos
    // https://help.bizagi.com/platform/en/resourcesanalysis3.png y total de costo fijo por
    // actividad del proceso en resourcesanalysis2.png. No están en expected.json porque la página
    // solo los publica como imagen; se citan aquí con su URL.
    const costoActividades = Object.values(tres.elements).reduce((suma, e) => suma + e.fixedCostTotal, 0);
    comprobar([
      { metrica: 'nivel 3 costo fijo de actividades', esperado: 8063, obtenido: costoActividades, cuadra: true },
      { metrica: 'nivel 3 costo callCenterAgent', esperado: 6051, obtenido: tres.resources.callCenterAgent!.totalCost, cuadra: true },
      { metrica: 'nivel 3 costo nurse', esperado: 15115, obtenido: tres.resources.nurse!.totalCost, cuadra: true },
      { metrica: 'nivel 3 costo ambulance', esperado: 30314.13, obtenido: tres.resources.ambulance!.totalCost, cuadra: true },
      { metrica: 'nivel 3 costo receptionist', esperado: 3018, obtenido: tres.resources.receptionist!.totalCost, cuadra: true },
      // D8: la réplica reproduce verbatim la tabla de requerimientos de la página, que cruza los dos
      // vehículos. Para la utilización da igual (los dos pools tienen capacidad 2) pero para el costo
      // no: la tarea QAV cuesta 25/token en vez de 18 y la tarea BA 18 en vez de 25.
      { metrica: 'nivel 3 costo del pool que sirve la tarea QAV (Bizagi: Quick attention vehicle)', esperado: 11139.86, obtenido: tres.resources.basicAmbulance!.totalCost, cuadra: false },
      { metrica: 'nivel 3 costo del pool que sirve la tarea BA (Bizagi: Basic ambulance)', esperado: 9844.65, obtenido: tres.resources.quickAttentionVehicle!.totalCost, cuadra: false },
    ]);
  }, 60_000);

  test('nivel 4 — el desvío entero es la espera fuera de horario del workaround de turnos (LILA-164)', async () => {
    const ir = await irDe(OFICIAL_BPMN);
    const publicado = escenarioDe(4);
    const nivel3 = escenarioDe(3);
    const conTurnos = correr(ir, {
      ...publicado,
      run: { ...publicado.run, replications: REPLICACIONES_RECONCILIACION, duration: undefined },
      elements: { ...publicado.elements, ...TRIAGE, ...LLEGADAS_OFICIALES },
    });
    // Hipótesis LILA-164: un solo pool por rol (sin partirlo por turno) y sin calendario. No es el
    // modelo de Bizagi —le falta la capacidad por turno— pero aísla el efecto del workaround.
    const unPoolPorRol = correr(ir, {
      ...publicado,
      run: { ...publicado.run, replications: REPLICACIONES_RECONCILIACION, duration: undefined },
      calendars: undefined,
      resources: nivel3.resources,
      elements: { ...nivel3.elements, ...TRIAGE, ...LLEGADAS_OFICIALES },
    });
    const v = expectedDe(4).values as Required<Publicado['values']>;
    const ba = conTurnos.elements.Task_LlegarBA!;

    comprobar([
      { metrica: 'nivel 4 cycleTime.mean con pools por turno', esperado: v.waitTimeSeconds.avg, obtenido: conTurnos.process.cycleTime.mean, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.max con pools por turno', esperado: v.arriveAtPatientPlaceBA.maxWaitSeconds, obtenido: ba.resourceWait.max, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.mean con pools por turno', esperado: v.arriveAtPatientPlaceBA.avgWaitSeconds, obtenido: ba.resourceWait.mean, cuadra: false },
      // Quitando el workaround, el ciclo medio del nivel 4 cuadra: el +230 % era entero de los
      // turnos. La espera de Arrive BA sigue sin cuadrar porque con un pool de capacidad fija 2
      // nunca hay cola; hace falta capacidad por turno dentro del mismo pool, que es LILA-164.
      { metrica: 'nivel 4 cycleTime.mean con un pool por rol', esperado: v.waitTimeSeconds.avg, obtenido: unPoolPorRol.process.cycleTime.mean, cuadra: true },
      { metrica: 'nivel 4 Arrive BA resourceWait.mean con un pool por rol', esperado: v.arriveAtPatientPlaceBA.avgWaitSeconds, obtenido: unPoolPorRol.elements.Task_LlegarBA!.resourceWait.mean, cuadra: false },
    ]);

    // El desvío del ciclo es, dentro del ruido, la espera fuera de horario media por caso.
    const offHoursPorCaso = ['Task_Recibir', 'Task_LlegarQAV', 'Task_LlegarBA', 'Task_Autorizar'].reduce((suma, id) => {
      const e = conTurnos.elements[id]!;
      return suma + (e.offHoursWait.total / conTurnos.process.completed);
    }, 0);
    const desvio = conTurnos.process.cycleTime.mean - unPoolPorRol.process.cycleTime.mean;
    expect(Math.abs(desvio - offHoursPorCaso) / desvio, 'la espera fuera de horario explica el desvío del nivel 4').toBeLessThan(0.05);
  }, 60_000);
});
