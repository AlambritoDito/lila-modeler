/**
 * Types of the message catalog subset that `core/` needs (LILA-211).
 *
 * This file is `core/`: it imports nothing (no zod, no bpmn-moddle, no `node:*`, no React).
 * The catalog outside `core/` (`src/messages/`) extends these types with the bpmn, scenario and
 * zod namespaces; the split exists only so the simulation kernel keeps its isolation (ADR-009).
 *
 * Rules for every entry:
 *
 * - the value is a function returning the message **body**, never the `CODE: ` prefix (that is
 *   `coded()`);
 * - the first parameter is the subject (an id or a JSON path) whenever the text has one;
 * - parameters are only interpolated, never formatted: rounding, joining and `toFixed` happen at
 *   the call site so that both locales stay byte-identical in the numbers they show;
 * - the key is the code when the code has a single text, and `` `${CODE}/${variant}` `` when the
 *   same code is emitted with several distinct texts.
 */

/** Languages the engine ships. English is the default; Spanish is the translation. */
export type Locale = 'en' | 'es';

/** Message bodies of the codes emitted from `core/`. */
export interface CoreCodeMessages {
  /* --- core/ir.ts --------------------------------------------------- */
  'E-ID-DUPLICADO': (id: string) => string;
  'E-REF-INEXISTENTE/entrante': (id: string, flowId: string) => string;
  'E-REF-INEXISTENTE/saliente': (id: string, flowId: string) => string;
  'E-FLUJO-COLGANTE/origen': (id: string, from: string) => string;
  'E-FLUJO-COLGANTE/destino': (id: string, to: string) => string;

  /* --- core/sim.ts, core/resources.ts (resource preflight) ---------- */
  'E-CAPACIDAD-Y-CALENDARIO': (subject: string) => string;
  'E-REC-CAPACIDAD/sin-tramos': (poolId: string) => string;
  'E-REC-CAPACIDAD/entero': (poolId: string) => string;
  'E-REC-DESCONOCIDO/en-elemento': (subject: string, poolId: string) => string;
  'E-REC-DESCONOCIDO/pool': (poolId: string) => string;
  'E-REC-DUPLICADO/pool': (subject: string, poolId: string) => string;
  'E-REC-CANTIDAD/entero': (subject: string, poolId: string) => string;
  'E-REC-CANTIDAD/excede': (
    subject: string,
    quantity: number,
    capacity: number,
    poolId: string,
  ) => string;

  /* --- core/sim.ts, core/calendar.ts (calendars) -------------------- */
  'E-CAL-VACIO/sin-intervalos': (name: string) => string;
  /** Same defect without a calendar to blame: the guard inside `core/calendar.ts`. */
  'E-CAL-VACIO/anonimo': () => string;
  'E-CAL-VACIO/interseccion': (elementId: string) => string;
  'E-CAL-VACIO/pool-sin-tramos': () => string;
  'E-CAL-DESCONOCIDO': (subject: string, calendar: string) => string;

  /* --- core/resources.ts (internal guards) -------------------------- */
  'E-REC-LIBERACION': (requestId: string) => string;
  'E-REC-SOLICITUD-DUPLICADA': (requestId: string) => string;
  'E-REC-SIN-ASIGNACION': (requestId: string) => string;
  'E-REC-ESTADO': (poolId: string) => string;

  /* --- core/replications.ts, core/run.ts, core/compare.ts ----------- */
  'E-REPLICACIONES-INSUFICIENTES/valores': () => string;
  'E-REPLICACIONES-INSUFICIENTES/replicaciones': () => string;
  'E-KPI-INCONSISTENTE': (replication: number) => string;
  'E-KPI-NO-FINITO': (replication: number, kpi: string) => string;
  'E-AGREGADO-NO-NUMERICO': () => string;
  'E-REPLICACIONES-VACIAS': () => string;
  'E-COMPARE-VACIO': () => string;

  /* --- core/sim.ts (warnings) --------------------------------------- */
  /** R-DEG-3: one warning listing every task when the scenario declares no `processingTime`. */
  'W-TAREA-SIN-TIEMPO/ninguno': (ids: string) => string;
  'W-TAREA-SIN-TIEMPO/elemento': (nodeId: string) => string;
  'W-XOR-RESIDUO-COMPARTIDO': (gatewayId: string, flowIds: string) => string;
  'W-XOR-NORMALIZADA': (gatewayId: string, total: number) => string;
  'W-OR-SIN-PROBABILIDAD': (gatewayId: string) => string;
  'W-OR-VACIO': (gatewayId: string) => string;
  'W-START-SIN-LLEGADAS': (nodeId: string) => string;
  'W-PROB-IGNORADA': (flowId: string, gatewayId: string) => string;
  'W-TIMER-SIN-TIEMPO': (nodeId: string) => string;
  'W-OR-JOIN-SIN-FORK': (nodeId: string) => string;
  'W-JOIN-BLOQUEADO': (nodeId: string, cases: number) => string;

  /* --- core/metrics.ts ---------------------------------------------- */
  /** `rho` arrives already rounded to one decimal so both locales print the same number. */
  'W-RECURSO-SATURADO': (poolId: string, rho: string) => string;
  /**
   * #320: variant for the self-gated pool, where ρ stays under the threshold and utilization is
   * what fires the warning. `percent` arrives already rounded to a whole number.
   */
  'W-RECURSO-SATURADO/utilizacion': (poolId: string, percent: string) => string;
  'W-UTILIZACION-MAYOR-UNO': (poolId: string) => string;

  /* --- core/distributions.ts ---------------------------------------- */
  /** `percent` arrives already rounded; the caller prefixes the element path. */
  'W-NORMAL-NEGATIVA': (mean: number, sd: number, percent: string) => string;
  'W-USER-NORMALIZADA': (total: number) => string;
}

/** Wrapping text that is not a message of its own. */
export interface CoreChrome {
  /** Suffix for a warning aggregated by occurrence count (§ 17). */
  repeated: (message: string, count: number) => string;
}

export interface CoreCatalog {
  codes: CoreCodeMessages;
  chrome: CoreChrome;
}
