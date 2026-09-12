/**
 * Controls of the replay (#331): the right panel of the «Animate» mode. It owns the clock — a
 * `requestAnimationFrame` loop over a `useRef`, not React state — and hands every frame to
 * `Modelador.replay(...)`, which is what paints the counters and the dots on the diagram.
 *
 * React only re-renders at ~10 Hz (`setTick`), which is enough for a clock and a pools table and
 * keeps the frame loop away from the reconciler. The numbers on the diagram are DOM writes done
 * by `ReplayOverlay.ts`, so they run at the full frame rate without a render.
 *
 * Nothing here re-runs the engine: `replay` is built from the event log of a run that already
 * happened, so scrubbing, pausing and jumping to the end cannot change a single result.
 */
import { useEffect, useRef, useState } from 'react';
import type { Modelador } from '../Modeler';
import { getLocale, useStrings } from '../i18n';
import { stateAt, type Replay as ReplayModel } from './replayModel';

/** Simulated seconds per second of real time. `instantanea` jumps straight to the end. */
const VELOCIDADES = ['1', '10', '60', '600', 'instantanea'] as const;
type Velocidad = (typeof VELOCIDADES)[number];

export interface ReplayProps {
  modelador: Modelador | null;
  /** `null` when the selected scenario has no run, or the run has no log in memory. */
  replay: ReplayModel | null;
  /** `ir.source.originalIds`, so the overlay finds the elements of a sanitised model. */
  originalIds: Readonly<Record<string, string>>;
  /** Why there is nothing to animate, already translated; ignored when `replay` is not `null`. */
  motivo: string;
}

/** `hh:mm:ss` of a duration in seconds, plus the 1-based day it falls on. */
function reloj(segundos: number): { dia: number; hora: string } {
  const entero = Math.max(0, Math.floor(segundos));
  const dia = Math.floor(entero / 86_400) + 1;
  const resto = entero % 86_400;
  const dos = (n: number): string => String(n).padStart(2, '0');
  return { dia, hora: `${dos(Math.floor(resto / 3_600))}:${dos(Math.floor((resto % 3_600) / 60))}:${dos(resto % 60)}` };
}

export function Replay({ modelador, replay, originalIds, motivo }: ReplayProps): React.JSX.Element {
  const S = useStrings();
  const [reproduciendo, setReproduciendo] = useState(false);
  const [velocidad, setVelocidad] = useState<Velocidad>('60');
  // Forces a render of the panel at ~10 Hz; the clock itself lives in `t`, not in React state.
  const [, setTick] = useState(0);
  const t = useRef(0);
  const velocidadRef = useRef<Velocidad>(velocidad);
  velocidadRef.current = velocidad;

  // Another model, another scenario or another run: the clock goes back to zero. Without this a
  // replay of a shorter run would open already finished.
  useEffect(() => {
    t.current = 0;
    setReproduciendo(false);
  }, [replay]);

  /**
   * One frame, painted from `t` as it is right now. It runs after EVERY render — which covers
   * reset, the «Instant» jump and entering the mode — and again on each animation frame while the
   * replay is playing. Without the first half the diagram would only catch up on the next frame,
   * and a browser that produces frames on damage alone (headless Chrome, which is what
   * `tools/e2e-replay.mjs` drives) would never produce it.
   */
  const pintar = (): void => {
    if (modelador === null) return;
    modelador.replay(replay === null
      ? null
      : { elementIds: replay.elementIds, originalIds, state: stateAt(replay, t.current) });
  };
  const pintarRef = useRef(pintar);
  pintarRef.current = pintar;
  useEffect(() => { pintarRef.current(); });

  useEffect(() => {
    if (modelador === null || replay === null || !reproduciendo) return;
    let raf = 0;
    let anterior = performance.now();
    let ultimoRender = 0;
    const paso = (ahora: number): void => {
      const dt = (ahora - anterior) / 1000;
      anterior = ahora;
      const factor = velocidadRef.current === 'instantanea' ? Infinity : Number(velocidadRef.current);
      t.current = Math.min(replay.horizon, t.current + dt * factor);
      pintarRef.current();
      if (ahora - ultimoRender >= 100) { ultimoRender = ahora; setTick((n) => n + 1); }
      if (t.current >= replay.horizon) { setReproduciendo(false); return; }
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => { cancelAnimationFrame(raf); };
  }, [modelador, replay, reproduciendo]);

  // Leaving the mode (or swapping the canvas) takes the overlay with it.
  useEffect(() => () => modelador?.replay(null), [modelador]);

  if (replay === null) {
    return (
      <div className="replay">
        <h3>{S.animacion.titulo}</h3>
        <p className="vacio">{motivo}</p>
        <div className="acciones">
          <button type="button" className="boton primario" disabled>{S.animacion.reproducir}</button>
        </div>
      </div>
    );
  }

  const ahora = t.current;
  const porcentaje = replay.horizon === 0 ? 100 : Math.round((ahora / replay.horizon) * 100);
  const { dia, hora } = reloj(ahora);
  const estado = stateAt(replay, ahora);
  const fecha = replay.startMs === null
    ? null
    : new Date(replay.startMs + ahora * 1000).toLocaleString(getLocale(), {
        day: '2-digit', hour: '2-digit', minute: '2-digit', month: '2-digit', year: 'numeric',
      });

  return (
    <div className="replay" data-replay-progress={porcentaje}>
      <h3>{S.animacion.titulo}</h3>
      <div className="acciones">
        <button
          type="button"
          className="boton primario"
          onClick={() => {
            // Replaying from the end starts over instead of doing nothing.
            if (!reproduciendo && t.current >= replay.horizon) t.current = 0;
            setReproduciendo(!reproduciendo);
          }}
        >
          {reproduciendo ? S.animacion.pausar : S.animacion.reproducir}
        </button>
        <button type="button" className="boton" onClick={() => { t.current = 0; setReproduciendo(false); setTick((n) => n + 1); }}>
          {S.animacion.reiniciar}
        </button>
      </div>
      <label className="campo">
        {S.animacion.velocidad}
        <select
          value={velocidad}
          onChange={(e) => {
            const elegida = e.target.value as Velocidad;
            setVelocidad(elegida);
            // «Instant» is not a speed anyone can watch: it is the end of the replication.
            if (elegida === 'instantanea') { t.current = replay.horizon; setReproduciendo(false); setTick((n) => n + 1); }
          }}
        >
          {VELOCIDADES.map((v) => <option key={v} value={v}>{S.animacion.velocidades[v]}</option>)}
        </select>
      </label>
      <p className="vacio">
        {fecha === null ? S.animacion.relojSinFecha(dia, hora) : S.animacion.reloj(fecha)}
      </p>
      <p className="vacio">{S.animacion.progreso(porcentaje)}</p>
      {ahora >= replay.horizon && <p className="vacio">{S.animacion.fin}</p>}
      {Object.keys(estado.pools).length > 0 && <>
        <h3>{S.animacion.recursos}</h3>
        <table className="replay-recursos">
          <thead>
            <tr>
              <th>{S.animacion.columnaRecurso}</th>
              <th>{S.animacion.columnaOcupados}</th>
              <th>{S.animacion.columnaCapacidad}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(estado.pools).map(([id, pool]) => (
              <tr key={id} data-pool={id}>
                <td>{id}</td>
                <td data-busy={pool.busy}>{pool.busy}</td>
                <td>{pool.capacity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}
      {replay.replications > 1 && <p className="vacio">{S.animacion.replicacion(replay.replications)}</p>}
      {replay.truncated && <p role="alert" className="aviso">{S.animacion.truncado(replay.activities.length)}</p>}
    </div>
  );
}
