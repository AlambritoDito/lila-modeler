import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { parseBpmn, validate } from '../src/bpmn/index.js';
import { simulate, type RunResult } from '../src/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario, type ResolvedScenario } from '../src/scenario.js';

// LILA-187 (M3): corre los cuatro ejemplos de examples/bizagi-levels TAL CUAL están committeados
// —ya con la topología, las probabilidades y las llegadas oficiales, corregidas por este mismo
// ticket— y compara cada número que expected.json cita de la página oficial, tolerancia ±5 %.
//
// Hasta LILA-187 este archivo tenía dos mitades: "A" simulaba las réplicas publicadas (con la
// topología equivocada de LILA-010, secuencia de 7 tareas) y "B" repetía la comparación sobre un
// fixture aparte (fixtures/bizagi-emergency-oficial.bpmn) con la topología del diagrama oficial.
// LILA-187 llevó esa topología —y las probabilidades del gateway y las llegadas constantes— a los
// propios `examples/bizagi-levels/level-*/model.bpmn` y `scenario.json`: el fixture quedó
// redundante y se borró. Cada fila sigue llevando su booleano documentado: el día que una fila
// cambie de lado el test se pone rojo y hay que actualizar la fila y `docs/BIZAGI_PARITY.md` a la
// vez. La aserción es sobre ese booleano, no sobre el valor.
//
// Diferencias que siguen sin cuadrar, con causa (docs/BIZAGI_PARITY.md § Diferencias documentadas):
//   D2 — nivel 1, rama Yellow (30 %): comparada contra el conteo de una única corrida de Bizagi
//        (315), que ya se desvía un +5 % de su propia probabilidad nominal. Contra 1000×p las tres
//        ramas cuadran. NO se relaja la tolerancia (LILA-187 lo investigó de nuevo: con las
//        llegadas/duración exactas de la página el número no cambia, porque el desajuste está en
//        el ruido de la corrida de referencia, no en la nuestra).
//   D5 — nivel 3 (3 enf.), cycleTime.max: el máximo publicado (35 min) es el camino Red (33 min)
//        más 2 min de espera de enfermera que en la corrida de Bizagi cayeron en el camino
//        crítico; en la nuestra el máximo se queda en los 33 min del camino puro.
//   D6 — nivel 3 (2 enf.), cycleTime.mean: con el pool saturado (rho = 1,05) la media depende de
//        la forma del transitorio; la cola de Bizagi crece sublinealmente (media/máx = 0,40) y la
//        de Lila linealmente (0,49). Residuo sin cerrar sin la traza original de Bizagi.
//   D7 — nivel 4 entero: los 3 pools por turno introducen `offHoursWait` que Bizagi no tiene
//        (los 3 turnos cubren las 24 h, no hay tiempo cerrado). Pendiente de LILA-164.
//
// Mapeo de nombres (D-mapeo): `expected.json` ya no llama `waitTimeSeconds` a lo que la tabla de
// Bizagi titula "Min./Max./Avg. time" del proceso (tiempo de ciclo, procesamiento + espera): el
// campo se renombró a `cycleTimeSeconds` y se compara contra `process.cycleTime`, no
// `process.waitTime`.
//
// D8 — nivel 3 y 4, costos/utilización de los dos vehículos: la tabla de requerimientos en prosa
// de la página dice "Arrive at patient place QAV -> Basic ambulance" (cruzada respecto al nombre),
// pero la tabla de costos (resourcesanalysis3.png) solo cuadra con la lectura natural: Quick
// Attention Vehicle 11.124 = 618 (QAV) × 18, Basic Ambulance 9.825 = 393 (BA) × 25. `scenario.json`
// de los niveles 3 y 4 usa esa asignación.

const here = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(here, '../../../examples/bizagi-levels');

const TOLERANCIA = 0.05; // ±5 %, LILA-044
// Solo para las filas que comparan una MEDIA contra la corrida (estocástica) de Bizagi: no cambia
// ningún parámetro de examples/bizagi-levels (que sigue en replications=1 por defecto), es una
// técnica de medición del test para no comparar una sola semilla de Lila contra la única corrida
// que Bizagi publicó.
const REPLICACIONES = 30;

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
interface FilaRecurso {
  utilization: number;
  totalFixedCost: number;
  totalUnitCost: number;
  totalCost: number;
}

interface CorridaNivel3 {
  cycleTimeSeconds: { min: number; max: number; avg: number };
  resourceUtilization: { nurse: number };
  resourceTable: { rows: Record<string, FilaRecurso> };
}

interface Publicado {
  values: {
    correctedRun?: { instancesCompleted: { red: number; yellow: number; green: number; total: number } };
    cycleTimeSeconds?: { min: number; max: number; avg: number };
    threeNurses?: CorridaNivel3;
    twoNurses?: CorridaNivel3;
    arriveAtPatientPlaceBA?: { maxWaitSeconds: number; avgWaitSeconds: number };
  };
}

/**
 * Nombre de la tabla de recursos de Bizagi → clave del pool en `level-3/scenario.json`. Las seis
 * filas publicadas se comparan, no solo la de la enfermera: la tabla las trae todas y una
 * utilización que se mueva sin que nadie mire es exactamente lo que este test tiene que cazar
 * (LILA-186/187 QA).
 */
const RECURSOS_NIVEL_3 = {
  'Call center agent': 'callCenterAgent',
  Nurse: 'nurse',
  Ambulance: 'ambulance',
  'Quick Attention Vehicle': 'quickAttentionVehicle',
  'Basic Ambulance': 'basicAmbulance',
  Receptionist: 'receptionist',
} as const;

function expectedDe(level: number): Publicado {
  return JSON.parse(readFileSync(resolve(levelsDir, `level-${level}`, 'expected.json'), 'utf8')) as Publicado;
}

function correr(ir: Awaited<ReturnType<typeof irDe>>, scenario: ResolvedScenario): RunResult {
  const problemas = scenarioErrors(validateScenario(scenario, ir));
  if (problemas.length > 0) throw new Error(`escenario inválido: ${JSON.stringify(problemas)}`);
  return simulate(ir, scenario, { log: false });
}

describe('examples/bizagi-levels: paridad contra expected.json (LILA-187)', () => {
  test('nivel 1 — 1000 tokens instantáneos, XOR 50/30/20 y tres end events', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-1/model.bpmn'));
    const publicado = escenarioDe(1);
    const r = correr(ir, { ...publicado, run: { ...publicado.run, replications: REPLICACIONES } });
    const c = expectedDe(1).values.correctedRun!.instancesCompleted;

    // D1, cerrada por LILA-186: el escenario declara `triggerCount` a solas, que por R-ARR-1 son
    // 1000 llegadas en `t = 0`. Es la configuración literal del nivel 1 de Bizagi, que no habilita
    // ningún campo de tiempo con el que espaciarlas.
    expect(r.process.started).toBe(1000);
    expect(r.process.completed).toBe(1000);

    comprobar([
      { metrica: 'nivel 1 rama Red (50 %) vs 483 publicado', esperado: c.red, obtenido: r.elements.EndEvent_Red!.completed, cuadra: true },
      { metrica: 'nivel 1 rama Yellow (30 %) vs 315 publicado', esperado: c.yellow, obtenido: r.elements.EndEvent_Yellow!.completed, cuadra: false },
      { metrica: 'nivel 1 rama Green (20 %) vs 202 publicado', esperado: c.green, obtenido: r.elements.EndEvent_Green!.completed, cuadra: true },
      // Contra la probabilidad configurada, que es lo que de verdad valida el nivel 1, las tres
      // ramas cuadran: el 315 de Bizagi es ruido de su propia corrida única (D2).
      { metrica: 'nivel 1 rama Red vs 1000×p', esperado: 500, obtenido: r.flows.Flow_Red!.count, cuadra: true },
      { metrica: 'nivel 1 rama Yellow vs 1000×p', esperado: 300, obtenido: r.flows.Flow_Yellow!.count, cuadra: true },
      { metrica: 'nivel 1 rama Green vs 1000×p', esperado: 200, obtenido: r.flows.Flow_Green!.count, cuadra: true },
    ]);
  }, 60_000);

  test('nivel 2 — 16 / 33 / 25 min: los tres números publicados, dentro del 5 %', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-2/model.bpmn'));
    const publicado = escenarioDe(2);
    const r = correr(ir, { ...publicado, run: { ...publicado.run, replications: REPLICACIONES } });
    const w = expectedDe(2).values.cycleTimeSeconds!;

    expect(r.process.started, 'la corrida oficial trae 2017 instancias').toBe(2017);
    expect(r.process.completed).toBe(2017);

    comprobar([
      { metrica: 'nivel 2 cycleTime.min', esperado: w.min, obtenido: r.process.cycleTime.min, cuadra: true },
      { metrica: 'nivel 2 cycleTime.max', esperado: w.max, obtenido: r.process.cycleTime.max, cuadra: true },
      { metrica: 'nivel 2 cycleTime.mean', esperado: w.avg, obtenido: r.process.cycleTime.mean, cuadra: true },
    ]);
  }, 60_000);

  test('nivel 3 — utilización de los seis recursos, costos y ciclo con 3 y con 2 enfermeras', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-3/model.bpmn'));
    const publicado = escenarioDe(3);
    const base: ResolvedScenario = { ...publicado, run: { ...publicado.run, replications: REPLICACIONES } };
    const tres = correr(ir, base);
    const dos = correr(ir, { ...base, resources: { ...base.resources, nurse: { ...base.resources!.nurse!, capacity: 2 } } });
    const v = expectedDe(3).values as Required<Publicado['values']>;

    comprobar([
      { metrica: 'nivel 3 (3 enf.) cycleTime.min', esperado: v.threeNurses.cycleTimeSeconds.min, obtenido: tres.process.cycleTime.min, cuadra: true },
      { metrica: 'nivel 3 (3 enf.) cycleTime.mean', esperado: v.threeNurses.cycleTimeSeconds.avg, obtenido: tres.process.cycleTime.mean, cuadra: true },
      // D5: el máximo publicado (35 min) es el camino Red de 33 min más 2 min de espera de
      // enfermera que en la corrida de Bizagi cayeron en el camino crítico.
      { metrica: 'nivel 3 (3 enf.) cycleTime.max', esperado: v.threeNurses.cycleTimeSeconds.max, obtenido: tres.process.cycleTime.max, cuadra: false },
      { metrica: 'nivel 3 (2 enf.) cycleTime.min', esperado: v.twoNurses.cycleTimeSeconds.min, obtenido: dos.process.cycleTime.min, cuadra: true },
      { metrica: 'nivel 3 (2 enf.) cycleTime.max', esperado: v.twoNurses.cycleTimeSeconds.max, obtenido: dos.process.cycleTime.max, cuadra: true },
      // D6: único residuo del nivel 3, ver cabecera del archivo.
      { metrica: 'nivel 3 (2 enf.) cycleTime.mean', esperado: v.twoNurses.cycleTimeSeconds.avg, obtenido: dos.process.cycleTime.mean, cuadra: false },
    ]);

    // Las SEIS filas de la tabla de recursos publicada, en las dos corridas, leídas de
    // `expected.json` (transcripción de resourcesanalysis3.png y resourcesanalysis1.png) en vez
    // de repetidas a mano aquí: utilización y costo total de cada pool. Antes solo se comparaba
    // la enfermera y cuatro de los seis costos (LILA-186/187 QA).
    //
    // D8: `scenario.json` ya usa la asignación que cuadra con los costos publicados (QAV con
    // quickAttentionVehicle, BA con basicAmbulance), no la lectura literal (y cruzada) de la
    // tabla de requerimientos en prosa; con ella los seis costos entran en el ±5 %.
    for (const [corrida, publicado, resultado] of [
      ['3 enf.', v.threeNurses, tres],
      ['2 enf.', v.twoNurses, dos],
    ] as const) {
      comprobar(
        Object.entries(RECURSOS_NIVEL_3).flatMap(([fila, ref]) => {
          const esperado = publicado.resourceTable.rows[fila]!;
          const obtenido = resultado.resources[ref]!;
          return [
            { metrica: `nivel 3 (${corrida}) utilización ${ref}`, esperado: esperado.utilization, obtenido: obtenido.utilization, cuadra: true },
            { metrica: `nivel 3 (${corrida}) costo ${ref}`, esperado: esperado.totalCost, obtenido: obtenido.totalCost, cuadra: true },
          ];
        }),
      );
      // La utilización que la página cita en prosa es la misma que la fila `Nurse` de la tabla.
      expect(publicado.resourceUtilization.nurse).toBe(publicado.resourceTable.rows.Nurse!.utilization);
    }

    // Costo fijo por actividad. **No** es un número publicado: la tabla de recursos solo trae los
    // costos de los pools (su `Total` 75 313 son justo esos seis), así que 8063 se DERIVA de datos
    // que sí lo están —los `fixedCost` por tarea del enunciado (2/1/1/1) y los conteos de
    // instancias de resourcesanalysis4.png (2017, 2017, 1006, 1006)—: 2·2017 + 1·2017 + 1·1006 +
    // 1·1006 = 8063. Se compara como derivado, no como cita.
    const costoActividades = Object.values(tres.elements).reduce((suma, e) => suma + e.fixedCostTotal, 0);
    const derivado8063 = 2 * 2017 + 1 * 2017 + 1 * 1006 + 1 * 1006;
    expect(derivado8063, 'la derivación del costo fijo de actividades').toBe(8063);
    comprobar([{ metrica: 'nivel 3 costo fijo de actividades (derivado)', esperado: derivado8063, obtenido: costoActividades, cuadra: true }]);
  }, 60_000);

  test('nivel 4 — sin el workaround de turnos el ciclo cuadra; con turnos, pendiente de LILA-164', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-4/model.bpmn'));
    const publicado = escenarioDe(4);
    const nivel3 = escenarioDe(3);
    const conTurnos = correr(ir, { ...publicado, run: { ...publicado.run, replications: REPLICACIONES } });
    // Hipótesis LILA-164: un solo pool por rol (sin partirlo por turno) y sin calendario. No es el
    // modelo de Bizagi —le falta la capacidad por turno— pero aísla el efecto del workaround.
    // Reutiliza directamente los recursos y elementos del nivel 3 (mismas llegadas, probabilidades
    // y tiempos que el nivel 4, solo sin dividir los 4 recursos por turno).
    const unPoolPorRol = correr(ir, {
      ...publicado,
      run: { ...publicado.run, replications: REPLICACIONES },
      calendars: undefined,
      resources: nivel3.resources,
      elements: nivel3.elements,
    });
    const v = expectedDe(4).values as Required<Publicado['values']>;
    const ba = conTurnos.elements.Task_LlegarBA!;

    // D7: los tres turnos cubren las 24 h, así que bajo la semántica de Bizagi ninguna tarea puede
    // tener espera fuera de horario. En Lila sí la tiene, y es la mayor parte del desvío del ciclo.
    expect(ba.offHoursWait.mean, 'el workaround de turnos crea espera fuera de horario').toBeGreaterThan(0);

    comprobar([
      { metrica: 'nivel 4 cycleTime.mean con pools por turno', esperado: v.cycleTimeSeconds!.avg, obtenido: conTurnos.process.cycleTime.mean, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.max con pools por turno', esperado: v.arriveAtPatientPlaceBA.maxWaitSeconds, obtenido: ba.resourceWait.max, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.mean con pools por turno', esperado: v.arriveAtPatientPlaceBA.avgWaitSeconds, obtenido: ba.resourceWait.mean, cuadra: false },
      // Quitando el workaround, el ciclo medio del nivel 4 cuadra: el desvío era entero de los
      // turnos. La espera de Arrive BA sigue sin cuadrar porque con un pool de capacidad fija
      // nunca hay cola; hace falta capacidad por turno dentro del mismo pool (LILA-164).
      { metrica: 'nivel 4 cycleTime.mean con un pool por rol', esperado: v.cycleTimeSeconds!.avg, obtenido: unPoolPorRol.process.cycleTime.mean, cuadra: true },
      { metrica: 'nivel 4 Arrive BA resourceWait.mean con un pool por rol', esperado: v.arriveAtPatientPlaceBA.avgWaitSeconds, obtenido: unPoolPorRol.elements.Task_LlegarBA!.resourceWait.mean, cuadra: false },
    ]);

    // El desvío del ciclo es, dentro del ruido, la espera fuera de horario media por caso.
    const offHoursPorCaso = ['Task_Recibir', 'Task_LlegarQAV', 'Task_LlegarBA', 'Task_Autorizar'].reduce((suma, id) => {
      const e = conTurnos.elements[id]!;
      return suma + e.offHoursWait.total / conTurnos.process.completed;
    }, 0);
    const desvio = conTurnos.process.cycleTime.mean - unPoolPorRol.process.cycleTime.mean;
    expect(Math.abs(desvio - offHoursPorCaso) / desvio, 'la espera fuera de horario explica el desvío del nivel 4').toBeLessThan(0.05);
  }, 60_000);
});
