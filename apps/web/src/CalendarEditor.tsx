/**
 * Editor semanal de calendarios (LILA-203, resto de LILA-061): la rejilla 7 días × 24 horas del
 * artboard 3, que el inventario de `docs/design` pide y que el panel genérico —generado desde el
 * JSON Schema— no puede dar, porque el esquema solo sabe que `intervals` es una lista de objetos.
 *
 * Dos decisiones que explican el resto:
 *
 * 1. **A cell is a whole hour**, not a minute. `docs/SCENARIO_FORMAT.md` § 2.3 accepts any
 *    `"HH:MM"`, so the grid is a **partial** view of the format: a calendar with half-hour slots
 *    does not fit in it, so the grid is hidden (with a warning) and the range picker and its list
 *    above and below it keep editing it (#448). Nothing is ever rounded: rounding would change
 *    the scenario just to draw it.
 * 2. **El modelo interno es un conjunto de celdas** (`dia × 24 + hora`) y las dos conversiones son
 *    puras. Painting is an `add`/`delete` on a `Set`; the whole `intervals` array is written on every
 *    gesture (§ 6 replaces arrays whole), but entries that stay fully open are kept as written
 *    and only the rest is re-derived (`pintar`, #469).
 */
import { Fragment, useRef, useState } from 'react';
import { useStrings } from './i18n';

/** Orden canónico del formato; es también el orden en el que sale `days`. */
export const DIAS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Dia = (typeof DIAS)[number];

/**
 * One entry of `intervals` (§ 2.3). Exactly one day selector: weekly `days`, or since #82 the
 * monthly `monthDays` / `monthWeekdays` and the yearly `dates` (R-CAL-12, R-CAL-13). The grid only
 * draws `days`; the other selectors live in the range picker and the list.
 */
export interface Intervalo {
  days?: Dia[];
  monthDays?: number[];
  monthWeekdays?: { nth: number; day: Dia }[];
  dates?: string[];
  from: string;
  to: string;
}

/** Celda = día × hora en un solo número; `dia` es el índice en `DIAS` y `hora` va de 0 a 23. */
export function celda(dia: number, hora: number): number {
  return dia * 24 + hora;
}

/** `24` → `"24:00"`: R13 la admite en `to` y solo ahí, y sin ella un 24×7 pierde 60 s cada noche. */
function hhmm(hora: number): string {
  return `${String(hora).padStart(2, '0')}:00`;
}

/** Minutos desde medianoche de un `"HH:MM"`, o `null` si el texto no tiene esa forma. */
export function enMinutos(texto: unknown): number | null {
  if (typeof texto !== 'string') return null;
  const partes = /^(\d{1,2}):([0-5]\d)$/.exec(texto);
  if (partes === null) return null;
  return Number(partes[1]) * 60 + Number(partes[2]);
}

/**
 * `true` si algún borde no cae en hora en punto (o no se entiende): la rejilla no puede
 * representarlo sin mentir, así que el panel enseña la lista.
 */
export function tieneMinutos(intervals: readonly Intervalo[]): boolean {
  return intervals.some((intervalo) => {
    const desde = enMinutos(intervalo?.from);
    const hasta = enMinutos(intervalo?.to);
    return desde === null || hasta === null || desde % 60 !== 0 || hasta % 60 !== 0;
  });
}

/**
 * Conjunto de celdas → `intervals` del formato.
 *
 * Fusiona las horas contiguas de cada día en una franja y agrupa en un solo intervalo los días que
 * comparten exactamente la misma franja (§ 2.3: `days` es una lista precisamente para eso). El
 * resultado es el mínimo razonable: una semana laboral 9–18 son cinco días en un intervalo, no
 * cinco intervalos.
 */
export function aIntervals(celdas: ReadonlySet<number>): Intervalo[] {
  const porFranja = new Map<string, Intervalo & { days: Dia[] }>();
  for (const [dia, nombre] of DIAS.entries()) {
    let hora = 0;
    while (hora < 24) {
      if (!celdas.has(celda(dia, hora))) {
        hora += 1;
        continue;
      }
      const inicio = hora;
      while (hora < 24 && celdas.has(celda(dia, hora))) hora += 1;
      const from = hhmm(inicio);
      const to = hhmm(hora);
      const ya = porFranja.get(`${from}${to}`);
      if (ya === undefined) porFranja.set(`${from}${to}`, { days: [nombre], from, to });
      else ya.days.push(nombre);
    }
  }
  return [...porFranja.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/**
 * `intervals` → conjunto de celdas, con `to` **exclusivo** (§ 2.3). Solapes y duplicados se unen,
 * que es lo que dice la semántica del formato («unión, no suma»). Lo que no se entiende se ignora:
 * el validador ya lo está marcando en su campo y la rejilla no es quien lo denuncia.
 */
export function aCeldas(intervals: readonly Intervalo[]): Set<number> {
  const salida = new Set<number>();
  for (const intervalo of intervals) {
    const desde = enMinutos(intervalo?.from);
    const hasta = enMinutos(intervalo?.to);
    if (desde === null || hasta === null) continue;
    for (const nombre of intervalo.days ?? []) {
      const dia = DIAS.indexOf(nombre);
      if (dia < 0) continue;
      for (let hora = Math.floor(desde / 60); hora < Math.min(Math.ceil(hasta / 60), 24); hora += 1) {
        salida.add(celda(dia, hora));
      }
    }
  }
  return salida;
}

/**
 * The grid's new cell set → `intervals`, keeping the file as the person wrote it (#469): every
 * entry whose hours are all still open stays as it is and where it is; the open cells no kept
 * entry covers, plus those of the dropped entries, are re-derived with `aIntervals` and appended.
 * Re-deriving everything would merge, split and re-sort the ranges added with the picker on every
 * click.
 */
export function pintar(intervals: readonly Intervalo[], celdas: ReadonlySet<number>): Intervalo[] {
  const conservadas = intervals.filter((intervalo) => [...aCeldas([intervalo])].every((c) => celdas.has(c)));
  const cubiertas = aCeldas(conservadas);
  // Hours of a dropped entry are re-derived even when a kept one also covers them, so the dropped
  // range comes back with its own start (Mon–Fri 09–18 stays 09–18 next to «every day 06–10»).
  const soltadas = aCeldas(intervals.filter((intervalo) => !conservadas.includes(intervalo)));
  const resto = [...celdas].filter((c) => !cubiertas.has(c) || soltadas.has(c));
  return [...conservadas, ...aIntervals(new Set(resto))];
}

const HORAS = [...Array.from({ length: 24 }).keys()];

/** The engine's own patterns (`scenario.ts`, R13): `"24:00"` closes a day and never opens one. */
const HHMM_FROM = '([01]\\d|2[0-3]):[0-5]\\d';
const HHMM_TO = `${HHMM_FROM}|24:00`;

/** Day presets of the range picker (#448), the Bizagi «recurrence» in one click. */
const PRESETS = {
  laborables: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  todos: [...DIAS],
  finDeSemana: ['SAT', 'SUN'],
} as const satisfies Record<string, readonly Dia[]>;

/**
 * The range to add, or `null` while the form does not describe a valid interval (#448). The text
 * is written exactly as typed: `"09:30"` stays `"09:30"` (§ 2.3, no rounding) and `"9:00"`, which
 * the validator would reject, keeps the button disabled instead of being fixed behind the user's
 * back. `to > from` compares as text, which is what the engine does too.
 */
export function franjaNueva(
  dias: ReadonlySet<Dia>,
  from: string,
  to: string,
  intervals: readonly Intervalo[] = [],
): Intervalo | null {
  return franjaRepetida({ tipo: 'semanal', dias }, from, to, intervals);
}

/** How the new range repeats (#82): the four day selectors of § 2.3. */
export type Repeticion =
  | { tipo: 'semanal'; dias: ReadonlySet<Dia> }
  /** `1…31`, or `-1` for the last day of the month (R-CAL-12). */
  | { tipo: 'diaDelMes'; dia: number }
  /** `nth` is `1…5` or `-1` (the last one of the month). */
  | { tipo: 'diaSemanaDelMes'; nth: number; dia: Dia }
  | { tipo: 'anual'; mes: number; dia: number };

export const TIPOS_REPETICION = ['semanal', 'diaDelMes', 'diaSemanaDelMes', 'anual'] as const;

/** Days of each month in a leap year: the yearly date `02-29` exists, `02-30` does not (§ 2.3). */
const DIAS_POR_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const dos = (n: number): string => String(n).padStart(2, '0');

/** The day selector of the file for a repetition, or `null` if it does not describe a real day. */
function selector(rep: Repeticion): Omit<Intervalo, 'from' | 'to'> | null {
  switch (rep.tipo) {
    case 'semanal':
      return rep.dias.size > 0 ? { days: DIAS.filter((d) => rep.dias.has(d)) } : null;
    case 'diaDelMes':
      return { monthDays: [rep.dia] };
    case 'diaSemanaDelMes':
      return { monthWeekdays: [{ nth: rep.nth, day: rep.dia }] };
    case 'anual':
      return rep.dia >= 1 && rep.dia <= (DIAS_POR_MES[rep.mes - 1] ?? 0) ? { dates: [`${dos(rep.mes)}-${dos(rep.dia)}`] } : null;
  }
}

/** Same selector and same hours: weekly days compare as a set, the rest as written. */
function misma(a: Intervalo, b: Intervalo): boolean {
  if (a.from !== b.from || a.to !== b.to) return false;
  if (Array.isArray(a.days) || Array.isArray(b.days)) {
    return (
      Array.isArray(a.days) &&
      Array.isArray(b.days) &&
      a.days.length === b.days.length &&
      a.days.every((d) => b.days!.includes(d))
    );
  }
  const resto = (iv: Intervalo): string => JSON.stringify([iv.monthDays, iv.monthWeekdays, iv.dates]);
  return resto(a) === resto(b);
}

/**
 * The range to add for any repetition (#82), or `null` while the form does not describe a valid
 * interval or it would duplicate one already in the file. Same rules as `franjaNueva`.
 */
export function franjaRepetida(
  rep: Repeticion,
  from: string,
  to: string,
  intervals: readonly Intervalo[] = [],
): Intervalo | null {
  const dias = selector(rep);
  const valida =
    dias !== null &&
    new RegExp(`^(${HHMM_FROM})$`).test(from) &&
    new RegExp(`^(${HHMM_TO})$`).test(to) &&
    to > from;
  if (!valida) return null;
  const nueva: Intervalo = { ...dias, from, to };
  // An identical entry already in the file would only be a duplicate row (union, § 2.3).
  return intervals.some((iv) => misma(iv, nueva)) ? null : nueva;
}

type CatalogoCalendario = ReturnType<typeof useStrings>['calendario'];

/** `-1` → «last», `-3` → «3 from the end», `15` → «15». */
function diaDelMesTexto(n: number, S: CatalogoCalendario): string {
  if (n === -1) return S.ultimo;
  return n < 0 ? S.desdeElFinal(-n) : String(n);
}

/**
 * The days part of a list row, for any selector (#82): `Mon–Fri`, «Day 1, last of each month»,
 * «Last Fri of each month», «Every year on Dec 24». Anything malformed is shown as written.
 */
export function resumenSelector(intervalo: Intervalo, S: CatalogoCalendario): string {
  if (Array.isArray(intervalo.monthDays)) {
    return S.cadaMesDias(intervalo.monthDays.map((n) => diaDelMesTexto(n, S)).join(', '));
  }
  if (Array.isArray(intervalo.monthWeekdays)) {
    return intervalo.monthWeekdays
      .map(({ nth, day }) =>
        S.cadaMesSemana(S.ordinales[String(nth)] ?? S.desdeElFinal(-nth), S.dias[day] ?? String(day)),
      )
      .join(', ');
  }
  if (Array.isArray(intervalo.dates)) {
    return S.cadaAno(
      intervalo.dates
        .map((fecha) => {
          const mes = S.meses[Number(fecha.slice(0, 2)) - 1];
          return mes === undefined ? fecha : S.fecha(Number(fecha.slice(3, 5)), mes);
        })
        .join(', '),
    );
  }
  return resumenDias(Array.isArray(intervalo.days) ? intervalo.days : [], S.dias);
}

/**
 * `days` for the list, with runs of three or more consecutive days as a span: `Mon–Fri`,
 * `Mon, Wed`, `Mon–Wed, Sat`. Anything that is not a format day is shown as written (the
 * validator already flags it).
 */
export function resumenDias(days: readonly string[], nombres: Readonly<Record<Dia, string>>): string {
  const indices = [...new Set(days.map((d) => DIAS.indexOf(d as Dia)))].sort((a, b) => a - b);
  if (indices.includes(-1)) return days.join(', ');
  const tramos: number[][] = [];
  for (const i of indices) {
    const ultimo = tramos.at(-1);
    if (ultimo !== undefined && ultimo.at(-1) === i - 1) ultimo.push(i);
    else tramos.push([i]);
  }
  return tramos
    .flatMap((t) =>
      t.length >= 3 ? [`${nombres[DIAS[t[0]!]!]}–${nombres[DIAS[t.at(-1)!]!]}`] : t.map((i) => nombres[DIAS[i]!]),
    )
    .join(', ');
}

/**
 * Day chips, per-day checkboxes, from/to and «Add range» above the grid (#448). Adding appends
 * one entry and never merges it with the others: the list below is the file as written, and the
 * grid keeps showing the union (§ 2.3).
 */
function Franjas({
  intervals,
  onCambio,
}: {
  intervals: readonly Intervalo[];
  onCambio: (intervals: Intervalo[]) => void;
}): React.JSX.Element {
  const S = useStrings();
  const [tipo, setTipo] = useState<(typeof TIPOS_REPETICION)[number]>('semanal');
  const [dias, setDias] = useState<ReadonlySet<Dia>>(new Set(PRESETS.laborables));
  const [diaDelMes, setDiaDelMes] = useState(1);
  const [nth, setNth] = useState(1);
  const [diaSemana, setDiaSemana] = useState<Dia>('MON');
  const [mes, setMes] = useState(1);
  const [diaAnual, setDiaAnual] = useState(1);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('18:00');
  const repeticion: Repeticion =
    tipo === 'semanal'
      ? { tipo, dias }
      : tipo === 'diaDelMes'
        ? { tipo, dia: diaDelMes }
        : tipo === 'diaSemanaDelMes'
          ? { tipo, nth, dia: diaSemana }
          : { tipo, mes, dia: diaAnual };
  const nueva = franjaRepetida(repeticion, from, to, intervals);
  const iguales = (preset: readonly Dia[]): boolean =>
    preset.length === dias.size && preset.every((d) => dias.has(d));
  /** A `<select>` of numbers with its label; the value is always one of `opciones`. */
  const numeros = (
    etiqueta: string,
    valor: number,
    opciones: readonly (readonly [number, string])[],
    cambiar: (n: number) => void,
  ): React.JSX.Element => (
    <label>
      {etiqueta}
      <select
        value={valor}
        onChange={(e) => {
          cambiar(Number(e.target.value));
        }}
      >
        {opciones.map(([n, texto]) => (
          <option key={n} value={n}>
            {texto}
          </option>
        ))}
      </select>
    </label>
  );
  const unoA = (n: number): [number, string][] => Array.from({ length: n }, (_, i) => [i + 1, String(i + 1)]);

  return (
    <div className="franjas" role="group" aria-label={S.calendario.nuevaFranja}>
      <div className="franjas-repeticion">
        <label>
          {S.calendario.repeticion}
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as (typeof TIPOS_REPETICION)[number]);
            }}
          >
            {TIPOS_REPETICION.map((t) => (
              <option key={t} value={t}>
                {S.calendario.repeticiones[t]}
              </option>
            ))}
          </select>
        </label>
        {tipo === 'diaDelMes' &&
          numeros(S.calendario.diaDelMes, diaDelMes, [...unoA(31), [-1, S.calendario.ultimoDia]], setDiaDelMes)}
        {tipo === 'diaSemanaDelMes' && (
          <>
            {numeros(
              S.calendario.semanaDelMes,
              nth,
              [1, 2, 3, 4, 5, -1].map((n) => [n, S.calendario.ordinales[String(n)] ?? String(n)] as const),
              setNth,
            )}
            <label>
              {S.calendario.diaSemana}
              <select
                value={diaSemana}
                onChange={(e) => {
                  setDiaSemana(e.target.value as Dia);
                }}
              >
                {DIAS.map((d) => (
                  <option key={d} value={d}>
                    {S.calendario.dias[d]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {tipo === 'anual' && (
          <>
            {numeros(
              S.calendario.mes,
              mes,
              S.calendario.meses.map((nombre, i) => [i + 1, nombre] as const),
              setMes,
            )}
            {numeros(S.calendario.dia, diaAnual, unoA(31), setDiaAnual)}
          </>
        )}
      </div>
      {tipo === 'semanal' && (
        <>
          <div className="franjas-presets">
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((clave) => (
              <button
                key={clave}
                type="button"
                className="chip"
                aria-pressed={iguales(PRESETS[clave])}
                onClick={() => {
                  setDias(new Set(PRESETS[clave]));
                }}
              >
                {S.calendario.presets[clave]}
              </button>
            ))}
          </div>
          <div className="franjas-dias">
            {DIAS.map((dia) => (
              <label key={dia}>
                <input
                  type="checkbox"
                  checked={dias.has(dia)}
                  onChange={() => {
                    const otros = new Set(dias);
                    if (otros.has(dia)) otros.delete(dia);
                    else otros.add(dia);
                    setDias(otros);
                  }}
                />
                {S.calendario.dias[dia]}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="franjas-horas">
        {/* Text, not `type="time"`: a time input cannot hold `"24:00"`. */}
        <label>
          {S.calendario.desde}
          <input
            type="text"
            inputMode="numeric"
            pattern={HHMM_FROM}
            placeholder={S.calendario.formatoHora}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
        </label>
        <label>
          {S.calendario.hasta}
          <input
            type="text"
            inputMode="numeric"
            pattern={HHMM_TO}
            placeholder={S.calendario.formatoHora}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="boton"
          disabled={nueva === null}
          onClick={() => {
            if (nueva !== null) onCambio([...intervals, nueva]);
          }}
        >
          {S.calendario.anadir}
        </button>
      </div>
    </div>
  );
}

/**
 * The current intervals as written, with remove. It goes **below** the grid: painting adds or
 * drops rows here, and above the grid that would push the cells down under the pointer mid-drag.
 */
function ListaFranjas({
  intervals,
  onCambio,
}: {
  intervals: readonly Intervalo[];
  onCambio: (intervals: Intervalo[]) => void;
}): React.JSX.Element | null {
  const S = useStrings();
  if (intervals.length === 0) return null;
  const rotulo = (intervalo: Intervalo): string =>
    S.calendario.franja(resumenSelector(intervalo, S.calendario), String(intervalo.from), String(intervalo.to));
  return (
    <ul className="franjas-lista" aria-label={S.calendario.lista}>
      {intervals.map((intervalo, k) => (
        // ponytail: index keys. The list is re-derived from the file on every change and has no
        // per-row state; stable ids would need a field the format does not have.
        <li key={k}>
          <span className="mono">{rotulo(intervalo)}</span>
          <button
            type="button"
            className="enlace"
            aria-label={S.calendario.quitarFranja(rotulo(intervalo))}
            onClick={() => {
              onCambio(intervals.filter((_, i) => i !== k));
            }}
          >
            {S.calendario.quitar}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * La rejilla. Se pinta con eventos de puntero nativos —`pointerdown` marca el sentido (abrir si la
 * celda estaba cerrada, cerrar si estaba abierta) y `pointerenter` con el botón pulsado lo repite—,
 * sin librería de arrastre: son doce líneas y el gesto es exactamente el del artboard.
 *
 * ponytail: sin `setPointerCapture`. Capturar el puntero manda todos los eventos a la celda del
 * `pointerdown` y `pointerenter` dejaría de llegar a las demás, que es justo lo que hace falta.
 */
export function CalendarEditor({
  intervals,
  onCambio,
  rejilla = true,
}: {
  intervals: readonly Intervalo[];
  onCambio: (intervals: Intervalo[]) => void;
  /** `false` hides the grid (the panel's «Edit as list»); minute slots hide it regardless. */
  rejilla?: boolean;
}): React.JSX.Element {
  const S = useStrings();
  const celdas = aCeldas(intervals);
  /** Sentido del trazo en curso: `true` abre, `false` cierra, `null` no hay trazo. */
  const sentido = useRef<boolean | null>(null);
  /**
   * El conjunto que acumula el trazo en curso (LILA-203, QA). `onCambio` no vuelve como `intervals`
   * hasta que React repinta, y `pointerenter` es un evento **continuo**: React no fuerza el
   * repintado síncrono que sí hace con `pointerdown`. Sin este ref, dos `pointerenter` seguidos
   * leerían el mismo estado viejo y el arrastre solo pintaría la última celda.
   */
  const trazo = useRef<Set<number> | null>(null);
  /** `intervals` when the stroke began (#469): what `pintar` keeps as written. */
  const origen = useRef<readonly Intervalo[] | null>(null);

  function aplicar(id: number, abrir: boolean): void {
    const base = trazo.current ?? celdas;
    if (base.has(id) === abrir) return;
    // Con trazo en curso se muta el mismo conjunto: es el estado que verá el siguiente `enter`.
    const nuevas = trazo.current ?? new Set(celdas);
    if (abrir) nuevas.add(id);
    else nuevas.delete(id);
    // Against the entries from before the stroke: the ones the stroke itself appended would
    // otherwise be kept as written and a drag would leave one entry per cell.
    onCambio(pintar(origen.current ?? intervals, nuevas));
  }

  return (
    <div className="editor-calendario">
      <Franjas intervals={intervals} onCambio={onCambio} />
      {rejilla && !tieneMinutos(intervals) && (
        <div
          className="calendario"
          role="group"
          aria-label={S.calendario.rejilla}
          onPointerUp={() => {
            sentido.current = null;
            trazo.current = null;
            origen.current = null;
          }}
          onPointerLeave={() => {
            sentido.current = null;
            trazo.current = null;
            origen.current = null;
          }}
        >
          <span />
          {HORAS.filter((hora) => hora % 3 === 0).map((hora) => (
            // Un rótulo cada tres horas, ocupando las tres columnas: con 24 columnas de 8 px una cifra
            // de dos dígitos no cabe en la suya y se pisaría con la siguiente.
            <span key={hora} className="rotulo tramo">
              {hora}
            </span>
          ))}
          {DIAS.map((nombre, dia) => (
            <Fragment key={nombre}>
              <span className="rotulo dia">{S.calendario.dias[nombre]}</span>
              {HORAS.map((hora) => {
                const id = celda(dia, hora);
                const abierta = celdas.has(id);
                return (
                  <button
                    key={hora}
                    type="button"
                    className={abierta ? 'hora abierta' : 'hora'}
                    aria-pressed={abierta}
                    aria-label={S.calendario.celda(nombre, hhmm(hora))}
                    onPointerDown={() => {
                      sentido.current = !abierta;
                      trazo.current = new Set(celdas);
                      origen.current = intervals;
                      aplicar(id, !abierta);
                    }}
                    onPointerEnter={(e) => {
                      if (e.buttons === 1 && sentido.current !== null) aplicar(id, sentido.current);
                    }}
                    onKeyDown={(e) => {
                      // El teclado no dispara `pointerdown`; sin esto la rejilla solo sería usable
                      // con ratón. `click` no vale: ya lo emite el `pointerdown` de arriba.
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        aplicar(id, !abierta);
                      }
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
      <ListaFranjas intervals={intervals} onCambio={onCambio} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * `calendars[clave].holidays` (#82, R-CAL-14)
 * ------------------------------------------------------------------ */

/**
 * Holidays: whole days the calendar is closed whatever its ranges say. A date picker plus «Every
 * year», which writes `"MM-DD"` instead of `"YYYY-MM-DD"`. The list is the file as written, with
 * remove; nothing is sorted or merged behind the user's back.
 */
export function Festivos({
  holidays,
  onCambio,
}: {
  holidays: readonly string[];
  onCambio: (holidays: string[]) => void;
}): React.JSX.Element {
  const S = useStrings();
  const [fecha, setFecha] = useState('');
  const [cadaAno, setCadaAno] = useState(false);
  const valor = cadaAno ? fecha.slice(5) : fecha;
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !holidays.includes(valor);
  const rotulo = (festivo: string): string =>
    /^\d{2}-\d{2}$/.test(festivo) ? S.calendario.festivoAnual(festivo) : festivo;
  return (
    <div className="festivos" role="group" aria-label={S.calendario.festivos}>
      <div className="franjas-horas">
        <label>
          {S.calendario.nuevoFestivo}
          <input
            type="date"
            value={fecha}
            onChange={(e) => {
              setFecha(e.target.value);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={cadaAno}
            onChange={() => {
              setCadaAno(!cadaAno);
            }}
          />
          {S.calendario.festivoCadaAno}
        </label>
        <button
          type="button"
          className="boton"
          disabled={!valida}
          onClick={() => {
            onCambio([...holidays, valor]);
          }}
        >
          {S.calendario.anadirFestivo}
        </button>
      </div>
      <p className="ayuda">{S.calendario.ayudaFestivos}</p>
      {holidays.length > 0 && (
        <ul className="franjas-lista" aria-label={S.calendario.listaFestivos}>
          {holidays.map((festivo, k) => (
            // ponytail: index keys, as in `ListaFranjas`: the list is re-derived from the file.
            <li key={k}>
              <span className="mono">{rotulo(festivo)}</span>
              <button
                type="button"
                className="enlace"
                aria-label={S.calendario.quitarFestivo(rotulo(festivo))}
                onClick={() => {
                  onCambio(holidays.filter((_, i) => i !== k));
                }}
              >
                {S.calendario.quitar}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
