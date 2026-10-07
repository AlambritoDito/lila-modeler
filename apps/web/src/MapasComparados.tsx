/**
 * The two read-only maps of Compare (Lote M, design 06): the reference run's heat map on the left,
 * the other run's on the right with the change in mean wait of each task. Two bpmn-js
 * `NavigatedViewer`s (pan and zoom, no editing) over the diagram on the canvas — both runs are of
 * the same revision — painted with the same overlay module as the Results map
 * (`BottleneckOverlay.ts`), so the tint rule and the bottleneck marks are the ones the user already
 * read there.
 *
 * A viewer that cannot draw (no XML yet, an import error) says so and leaves the tables below as
 * the place to read the numbers.
 */
import { useEffect, useRef, useState } from 'react';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import type Modeler from 'bpmn-js/lib/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type { BaseTimeUnit } from '@lila-modeler/engine/format';
import lila from '@lila-modeler/engine/bpmn/lila.moddle.json';
import { aplicarDeltas, applyOverlay, deltasDeEspera, type Corrida } from './BottleneckOverlay';
import { useStrings } from './i18n';

export interface MapasComparadosProps {
  /** The diagram both runs simulated, or `null` while it is being exported. */
  xml: string | null;
  referencia: Omit<Corrida, 'calor'>;
  otro: Omit<Corrida, 'calor'>;
  nombreRef: string;
  nombreOtro: string;
  /** Task ids of the IR: the heat map and the deltas are per task. */
  tareas: readonly string[];
  /** Changes when the theme does, so the shapes are redrawn with its colours. */
  tema: string;
}

/** The default shape colours of the theme on screen, the ones the main canvas uses. */
function colores(): { defaultFillColor: string; defaultStrokeColor: string; defaultLabelColor: string } {
  const token = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return { defaultFillColor: token('--diagram-fill'), defaultStrokeColor: token('--diagram-stroke'), defaultLabelColor: token('--diagram-label') };
}

function Mapa({ xml, corrida, tareas, titulo, sub, deltasDe, tema }: {
  xml: string | null; corrida: Corrida; tareas: readonly string[]; titulo: string; sub: string;
  deltasDe: Omit<Corrida, 'calor'> | null; tema: string;
}): React.JSX.Element {
  const S = useStrings();
  const caja = useRef<HTMLDivElement>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    const contenedor = caja.current;
    if (contenedor === null || xml === null) return undefined;
    let vivo = true;
    let visor: NavigatedViewer | null = null;
    setFallo(false);
    try {
      visor = new NavigatedViewer({ container: contenedor, bpmnRenderer: colores(), moddleExtensions: { lila } });
    } catch { setFallo(true); return undefined; }
    void visor.importXML(xml).then(() => {
      if (!vivo || visor === null) return;
      visor.get<Canvas>('canvas').zoom('fit-viewport');
      const comoModeler = visor as unknown as Modeler;
      applyOverlay(comoModeler, corrida);
      if (deltasDe !== null) {
        const unit = corrida.scenario.run.baseTimeUnit as BaseTimeUnit;
        aplicarDeltas(comoModeler, deltasDeEspera(deltasDe.result, corrida.result, tareas, unit), corrida.originalIds);
      }
    }).catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; visor?.destroy(); };
  }, [xml, corrida, deltasDe, tareas, tema]);
  return (
    <figure className="c5-mapa">
      <figcaption className="c5-mapa-titulo"><strong>{titulo}</strong><span>{sub}</span></figcaption>
      <div ref={caja} className="c5-mapa-lienzo" role="img" aria-label={`${titulo} · ${sub}`} />
      {(fallo || xml === null) && <p className="vacio c5-mapa-fallo">{S.c5.comparar.sinMapa}</p>}
    </figure>
  );
}

export function MapasComparados({ xml, referencia, otro, nombreRef, nombreOtro, tareas, tema }: MapasComparadosProps): React.JSX.Element {
  const S = useStrings();
  // Stable objects per run, so a re-render of the shell does not rebuild both viewers.
  const corridaRef = useEstable({ ...referencia, calor: { tareas } });
  const corridaOtro = useEstable({ ...otro, calor: { tareas } });
  return (
    <div className="c5-mapas">
      <Mapa xml={xml} corrida={corridaRef} tareas={tareas} tema={tema} deltasDe={null}
        titulo={`${S.c5.comparar.referencia} · ${nombreRef}`} sub={S.c5.comparar.mapaSub} />
      <Mapa xml={xml} corrida={corridaOtro} tareas={tareas} tema={tema} deltasDe={corridaRef}
        titulo={nombreOtro} sub={S.c5.comparar.mapaDeltaSub} />
    </div>
  );
}

/** The same object while its run (and task list) are the same ones. */
function useEstable(corrida: Corrida): Corrida {
  const previo = useRef(corrida);
  const p = previo.current;
  if (p.result !== corrida.result || p.scenario !== corrida.scenario || p.calor?.tareas !== corrida.calor?.tareas) previo.current = corrida;
  return previo.current;
}
