/**
 * What the scenario panel may show for each kind of diagram element, and the two conversions the
 * form needs to stop being a JSON editor with labels (#332).
 *
 * Everything here is pure: no React, no engine, no DOM. `ScenarioPanel.tsx` is the only consumer,
 * and it is a lot easier to pin a table of "which fields apply to a task" in a `.test.ts` than
 * through jsdom.
 *
 * Three things live in this file:
 *
 * 1. `fieldsForKind`: the "Applies to" column of `docs/SCENARIO_FORMAT.md` § 2.5, as code. The
 *    linter already rejects a `probability` on a task (`E-PROB-EN-NODO`) and an
 *    `interTriggerTimer` on a gateway (`E-CAMPO-NO-APLICA`); this is the same table one step
 *    earlier, so the control is never offered in the first place.
 * 2. The presentation unit (`run.baseTimeUnit`, § 2.2 and R1/R2): every time is **stored in
 *    seconds** and only shown in the chosen unit. `esTiempoEnSegundos` says which paths are times.
 * 3. `run.start` (R8): splitting and composing `YYYY-MM-DDTHH:MM:SS±HH:MM`, so the field can be a
 *    `datetime-local` plus an offset instead of a free-text ISO string.
 */

/** Node kinds of the IR (`packages/engine/src/core/ir.ts`) plus the sequence flow. */
export type ClaseElemento =
  | 'start'
  | 'end'
  | 'terminate'
  | 'task'
  | 'xor'
  | 'or'
  | 'and'
  | 'timer'
  | 'flow';

/**
 * The `elements[id]` fields that apply to `clase`, in the order § 2.5 lists them.
 *
 * `null` means "no idea": the diagram has not been parsed yet, or the id is not in the IR. Then
 * nothing is filtered — hiding every control because the IR is missing would leave the panel
 * unusable, and the linter is still there.
 *
 * A gateway gets `[]`: none of the element fields applies to it. Its outgoing flows' probability
 * is edited from the gateway view of the panel, which writes `elements[flowId].probability`.
 */
export function fieldsForKind(clase: ClaseElemento | null): readonly string[] | null {
  switch (clase) {
    case 'task':
      return ['processingTime', 'resources', 'selection', 'fixedCost', 'calendar'];
    case 'start':
      return ['interTriggerTimer', 'triggerCount', 'calendar', 'fixedCost'];
    case 'timer':
      return ['processingTime', 'calendar', 'fixedCost'];
    case 'end':
    case 'terminate':
      return ['fixedCost'];
    case 'flow':
      return ['probability'];
    case 'xor':
    case 'or':
    case 'and':
      return [];
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Presentation unit (§ 2.2 `baseTimeUnit`, R1 and R2)
 * ------------------------------------------------------------------ */

export type UnidadTiempo = 's' | 'min' | 'h' | 'day';

/** Seconds in one unit. `baseTimeUnit` is the only thing that scales a displayed time. */
export const SEGUNDOS_POR_UNIDAD: Record<UnidadTiempo, number> = {
  s: 1,
  min: 60,
  h: 3600,
  day: 86_400,
};

export function esUnidadTiempo(valor: unknown): valor is UnidadTiempo {
  return valor === 's' || valor === 'min' || valor === 'h' || valor === 'day';
}

/**
 * Distribution parameters that are a **time** when the distribution describes one (§ 3). The ones
 * left out are shapes and counts (`shape`, `scale`, `k`, `alpha`, `beta`, `n`, `p`) and the
 * `probability` of a `user` point: scaling those by the presentation unit would change the
 * distribution, not the way it is written.
 */
const PARAMETROS_DE_TIEMPO = new Set(['value', 'min', 'mode', 'max', 'mean', 'sd']);

/** `processingTime` and `interTriggerTimer` are the two distributions that measure time. */
const DISTRIBUCIONES_DE_TIEMPO = new Set(['processingTime', 'interTriggerTimer']);

/**
 * Whether the value at `ruta` is a duration in seconds, i.e. one to be shown in `baseTimeUnit`.
 *
 * `run.start` is not one of them (it is the only field that is not seconds, § 2.2) and neither
 * are the costs: `fixedCost` and `costPerHour` are money, and `costPerHour` is already per hour.
 */
export function esTiempoEnSegundos(ruta: readonly (string | number)[]): boolean {
  if (ruta.length === 2 && ruta[0] === 'run') {
    return ruta[1] === 'duration' || ruta[1] === 'warmup' || ruta[1] === 'serviceLevel';
  }
  if (ruta[0] !== 'elements' || ruta.length < 4) return false;
  if (typeof ruta[2] !== 'string' || !DISTRIBUCIONES_DE_TIEMPO.has(ruta[2])) return false;
  const ultimo = ruta[ruta.length - 1];
  return typeof ultimo === 'string' && PARAMETROS_DE_TIEMPO.has(ultimo);
}

/**
 * Seconds → the number shown in `unidad`. `28800` s in `min` is `480`, not `480.0000000001`.
 *
 * ponytail: the round trip is pinned to 1e-6 s (a microsecond), which is far below the resolution
 * of anything the engine reports. Typing `0.0000001` days and getting `0` back is the ceiling;
 * the upgrade path is storing the unit alongside the number in the format, which v1 does not do.
 */
export function aUnidad(segundos: number, unidad: UnidadTiempo): number {
  return redondear(segundos / SEGUNDOS_POR_UNIDAD[unidad]);
}

/** The number typed in `unidad` → the seconds the file stores. */
export function aSegundos(valor: number, unidad: UnidadTiempo): number {
  return redondear(valor * SEGUNDOS_POR_UNIDAD[unidad]);
}

function redondear(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
}

/* ------------------------------------------------------------------ *
 * `run.start` (R8): `YYYY-MM-DDTHH:MM:SS±HH:MM`
 * ------------------------------------------------------------------ */

/** Whole and half hours from −12:00 to +14:00: every offset in use today, and none invented. */
export const DESFASES: readonly string[] = (() => {
  const salida: string[] = [];
  for (let minutos = -12 * 60; minutos <= 14 * 60; minutos += 30) {
    const signo = minutos < 0 ? '-' : '+';
    const abs = Math.abs(minutos);
    salida.push(
      `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`,
    );
  }
  return salida;
})();

export interface PartesInstante {
  /** What a `datetime-local` holds: `YYYY-MM-DDTHH:MM:SS`, no offset. */
  fechaHora: string;
  /** `±HH:MM`. R8 requires it; without it the calendars have no timezone to be read in. */
  desfase: string;
}

const INSTANTE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)([+-]\d{2}:\d{2})$/;

/** Splits an ISO instant with offset, or `null` if it is not one (then the panel falls back). */
export function partesInstante(valor: unknown): PartesInstante | null {
  if (typeof valor !== 'string') return null;
  const m = INSTANTE.exec(valor.trim());
  if (m === null) return null;
  const fechaHora = m[1]!.length === 16 ? `${m[1]!}:00` : m[1]!;
  return { fechaHora, desfase: m[2]! };
}

/**
 * The two controls → the string the schema validates. Seconds are filled in when the browser
 * omits them (`datetime-local` drops them unless a step asks for them).
 */
export function componerInstante(fechaHora: string, desfase: string): string {
  const limpio = fechaHora.trim();
  if (limpio === '') return '';
  return `${limpio.length === 16 ? `${limpio}:00` : limpio}${desfase}`;
}
