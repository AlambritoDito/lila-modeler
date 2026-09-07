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
//   D7 — nivel 4, denominador de la utilización (más el residuo de las esperas de Arrive BA):
//        Bizagi divide por la duración declarada del escenario (43 200 min) y Lila por la ventana
//        de medida `[warmup, t_stop]` (~10 900 min, R-CAL-9 sobre R-ARR-7). No se cambia el motor
//        por eso: el test aplica la conversión exacta, documentada aquí y en
//        docs/BIZAGI_PARITY.md. LILA-164 cerró la otra mitad de D7: los 3 pools por turno con
//        selection:'or' —que introducían un `offHoursWait` que Bizagi no tiene, porque los 3
//        turnos cubren las 24 h— son ya un solo pool por rol con `capacity` por intervalos.
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

interface Turnos {
  morning: number;
  day: number;
  night: number;
}

interface Publicado {
  values: {
    correctedRun?: { instancesCompleted: { red: number; yellow: number; green: number; total: number } };
    cycleTimeSeconds?: { min: number; max: number; avg: number };
    threeNurses?: CorridaNivel3;
    twoNurses?: CorridaNivel3;
    arriveAtPatientPlaceBA?: { maxWaitSeconds: number; avgWaitSeconds: number };
    shifts?: Record<string, Turnos>;
    resourceTable?: { rows: Record<string, FilaRecurso> };
  };
}

/** Duración declarada del escenario del nivel 4 en Bizagi: 43 200 min (30 días). Es su denominador. */
const DURACION_DECLARADA_NIVEL_4 = 43200 * 60;

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

  test('nivel 4 — un pool por rol con capacidad por turno: ciclo, utilización y costo de los seis recursos', async () => {
    const ir = await irDe(resolve(levelsDir, 'level-4/model.bpmn'));
    const publicado = escenarioDe(4);
    const r = correr(ir, { ...publicado, run: { ...publicado.run, replications: REPLICACIONES } });
    const v = expectedDe(4).values as Required<Publicado['values']>;

    expect(r.process.started, 'la corrida oficial trae 2017 instancias').toBe(2017);
    expect(r.process.completed).toBe(2017);

    // LILA-164: los tres turnos cubren las 24 h, así que la unión de los calendarios del pool es
    // un 24×7 y **ninguna** tarea tiene espera fuera de horario. Era el desvío entero del
    // workaround de pools por turno (la mitad de D7 que este ticket cierra).
    for (const id of ['Task_Recibir', 'Task_LlegarQAV', 'Task_LlegarBA', 'Task_Autorizar']) {
      expect(r.elements[id]!.offHoursWait.total, `${id} no puede tener espera fuera de horario`).toBe(0);
    }
    // La utilización y el costo se reportan por ROL, no por turno: seis filas, las de Bizagi.
    expect(Object.keys(r.resources).sort()).toEqual(Object.values(RECURSOS_NIVEL_3).slice().sort());

    // D7 (viva) — el denominador. Bizagi divide por la duración **declarada** del escenario
    // (43 200 min) y Lila por la ventana de medida `[warmup, t_stop]` (R-CAL-9 sobre R-ARR-7), que
    // aquí es ~10 900 min porque la corrida para al agotarse las 2017 llegadas. La conversión es
    // exacta sobre `busyTime`:
    //
    //     utilización_Bizagi = busyTime / Σ_i (capacity_i × openTime_i sobre la duración declarada)
    //                        = utilización_Lila × (t_stop − warmup) / duración declarada
    //
    // y con los tres turnos de 8 h ese sumatorio vale (Σ_i capacity_i / 3) × 43 200 min, que es
    // literalmente la cuenta publicada para Call center agent: 8068 / ((2+2+1)/3 × 43 200) = 11,21 %.
    // No se cambia el motor por esto: la ventana de medida sigue siendo `[warmup, t_stop]`.
    const ventana = (r.process.completed / r.process.throughputPerHour) * 3600;
    const disponibleBizagi = (ref: string): number => {
      const turnos = v.shifts[ref]!;
      return ((turnos.morning + turnos.day + turnos.night) / 3) * DURACION_DECLARADA_NIVEL_4;
    };

    comprobar(
      Object.entries(RECURSOS_NIVEL_3).flatMap(([fila, ref]) => {
        const esperado = v.resourceTable.rows[fila]!;
        const obtenido = r.resources[ref]!;
        return [
          {
            metrica: `nivel 4 utilización ${ref} (denominador Bizagi)`,
            esperado: esperado.utilization,
            obtenido: obtenido.busyTime / disponibleBizagi(ref),
            cuadra: true,
          },
          { metrica: `nivel 4 costo ${ref}`, esperado: esperado.totalCost, obtenido: obtenido.totalCost, cuadra: true },
        ];
      }),
    );

    // La conversión, ejecutada. La forma exacta es la de arriba —`busyTime` sobre el denominador
    // de Bizagi—; la regla de tres `utilización_Lila × ventana / duración declarada` es su versión
    // de bolsillo y solo coincide del todo cuando la ventana cubre un número entero de periodos
    // del patrón de turnos. Aquí no lo cubre (la corrida se agota a los 10 862 min, 7,54 días), y
    // el sesgo del corte a media franja llega al 1,8 % en `quickAttentionVehicle`, el rol cuyo
    // turno de tarde vale el doble que los otros dos. De ahí el 3 %: es el error de la regla de
    // tres, no del motor.
    for (const ref of Object.values(RECURSOS_NIVEL_3)) {
      const bizagi = r.resources[ref]!.busyTime / disponibleBizagi(ref);
      const reescalada = (r.resources[ref]!.utilization * ventana) / DURACION_DECLARADA_NIVEL_4;
      expect(Math.abs(reescalada - bizagi) / bizagi, `la conversión de denominador de ${ref}`).toBeLessThan(0.03);
    }

    const ba = r.elements.Task_LlegarBA!;
    comprobar([
      { metrica: 'nivel 4 cycleTime.mean', esperado: v.cycleTimeSeconds!.avg, obtenido: r.process.cycleTime.mean, cuadra: true },
      // D7 (residuo): las dos esperas de Arrive at patient place BA son de una corrida única de
      // Bizagi sobre un pool al 5,6 % de utilización, donde solo hay cola cuando dos casos
      // coinciden en el turno de tarde (1 sola ambulancia básica). El reparto por rama de esa
      // corrida tampoco es el nuestro (Bizagi 403 instancias BA, Lila 409): el residuo es ruido
      // de la corrida de referencia, igual que D2.
      { metrica: 'nivel 4 Arrive BA resourceWait.max', esperado: v.arriveAtPatientPlaceBA.maxWaitSeconds, obtenido: ba.resourceWait.max, cuadra: false },
      { metrica: 'nivel 4 Arrive BA resourceWait.mean', esperado: v.arriveAtPatientPlaceBA.avgWaitSeconds, obtenido: ba.resourceWait.mean, cuadra: false },
    ]);

    // Esa cola existe **porque** la capacidad baja a 1 en el turno de tarde: con la capacidad fija
    // del nivel 3 la espera de Arrive BA es exactamente 0 (era la fila «con un pool por rol» de la
    // tabla de BIZAGI_PARITY). Es lo que la capacidad por intervalos hace y la fija no puede.
    expect(ba.resourceWait.max, 'la capacidad por turno sí produce cola en Arrive BA').toBeGreaterThan(0);
  }, 60_000);
});
