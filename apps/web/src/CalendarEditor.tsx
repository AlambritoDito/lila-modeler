/**
 * Editor semanal de calendarios (LILA-203, resto de LILA-061): la rejilla 7 días × 24 horas del
 * artboard 3, que el inventario de `docs/design` pide y que el panel genérico —generado desde el
 * JSON Schema— no puede dar, porque el esquema solo sabe que `intervals` es una lista de objetos.
 *
 * Dos decisiones que explican el resto:
 *
 * 1. **La celda es una hora entera**, no un minuto. `docs/SCENARIO_FORMAT.md` § 2.3 admite
 *    cualquier `"HH:MM"`, así que la rejilla es una vista **parcial** del formato: un calendario
 *    con franjas a media hora no cabe en ella y se edita como lista, con aviso. Nunca se redondea:
 *    redondear sería cambiar el escenario por dibujarlo.
 * 2. **El modelo interno es un conjunto de celdas** (`dia × 24 + hora`) y las dos conversiones son
 *    puras. Pintar es un `add`/`delete` en un `Set`; los `intervals` se recalculan enteros en cada
 *    gesto, que es además lo que § 6 exige del delta (los arrays se reemplazan enteros).
 */
import { Fragment, useRef } from 'react';
import { useStrings } from './i18n';

/** Orden canónico del formato; es también el orden en el que sale `days`. */
export const DIAS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Dia = (typeof DIAS)[number];

export interface Intervalo {
  days: Dia[];
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
  const porFranja = new Map<string, Intervalo>();
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

const HORAS = [...Array.from({ length: 24 }).keys()];

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
}: {
  intervals: readonly Intervalo[];
  onCambio: (intervals: Intervalo[]) => void;
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

  function aplicar(id: number, abrir: boolean): void {
    const base = trazo.current ?? celdas;
    if (base.has(id) === abrir) return;
    // Con trazo en curso se muta el mismo conjunto: es el estado que verá el siguiente `enter`.
    const nuevas = trazo.current ?? new Set(celdas);
    if (abrir) nuevas.add(id);
    else nuevas.delete(id);
    onCambio(aIntervals(nuevas));
  }

  return (
    <div
      className="calendario"
      role="group"
      aria-label={S.calendario.rejilla}
      onPointerUp={() => {
        sentido.current = null;
        trazo.current = null;
      }}
      onPointerLeave={() => {
        sentido.current = null;
        trazo.current = null;
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
          <span className="rotulo dia">{nombre}</span>
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
  );
}
