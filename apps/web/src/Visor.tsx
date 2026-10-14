/**
 * The read-only viewer for phones and tablets (#653). Not the editor on a small screen: a bpmn-js
 * `NavigatedViewer` (as in `MapasComparados.tsx`) over a project opened from the device's files or
 * the examples gallery, with finger pan and pinch zoom, a sheet with the tapped element's
 * simulation parameters, and the heat map and KPIs of the last run saved in the project.
 *
 * `main.tsx` mounts it instead of `App` (`abrirVisor`). It never writes: nothing opened here is
 * kept, so a reload shows the editor's last saved project again.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import type Modeler from 'bpmn-js/lib/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type { Point } from 'diagram-js/lib/util/Types';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { resolveExtends, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { isCurrentRun, processesOf } from '@lila-modeler/engine/project';
import type { ProcessIR } from '@lila-modeler/engine';
import lila from '@lila-modeler/engine/bpmn/lila.moddle.json';
import { sincronizarOverlay } from './BottleneckOverlay';
import { colores } from './MapasComparados';
import { PanelResumen } from './PanelResumen';
import { nombreDeTipo } from './PropertiesPanel';
import { datosVistaRapida } from './vistaRapida';
import { EJEMPLOS, proyectoDeEjemplo, type EjemploId } from './ejemplos';
import { readLila, readProject } from './project';
import { finishStartup } from './startup';
import { PREFERENCIAS, setLocale, useStrings, type Preferencia } from './i18n';
import type { ProjectDocument } from './store/ProjectStore';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import './theme/tokens.css';
import './app.css';

/**
 * `?visor` always; otherwise on a phone — the screen's short side under 600 CSS px, whatever the
 * orientation — unless `?editor`. 600 is Material's compact width: every phone is under it, the
 * smallest tablets (7" Android, iPad mini at 744) are not, and they reach the viewer from «View».
 */
export function abrirVisor(search: string, ladoCorto: number): boolean {
  const q = new URLSearchParams(search);
  return q.has('visor') || (!q.has('editor') && ladoCorto < 600);
}

export interface Punto { x: number; y: number }

/**
 * One step of a one- or two-finger gesture: the same fingers before and after a move, in
 * container pixels. The centroid's shift pans; the change of the first two fingers' spread zooms
 * around the new centroid.
 */
export function pasoGesto(antes: readonly Punto[], despues: readonly Punto[]): { dx: number; dy: number; factor: number; centro: Punto } {
  const centro = (ps: readonly Punto[]): Punto => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const abertura = (ps: readonly Punto[]): number => (ps.length < 2 ? 0 : Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y));
  const a = centro(antes);
  const d = centro(despues);
  const sa = abertura(antes);
  return { dx: d.x - a.x, dy: d.y - a.y, factor: sa > 0 ? abertura(despues) / sa : 1, centro: d };
}

/**
 * diagram-js 15 has no touch module (MoveCanvas is mouse-only, ZoomScroll wheel-only): this is the
 * finger half. The mouse is left to diagram-js. Returns the unhook.
 */
function engancharGestos(contenedor: HTMLElement, canvas: Canvas): () => void {
  const dedos = new Map<number, Punto>();
  const punto = (e: PointerEvent): Punto => {
    const r = contenedor.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const abajo = (e: PointerEvent): void => { if (e.pointerType !== 'mouse') dedos.set(e.pointerId, punto(e)); };
  const mueve = (e: PointerEvent): void => {
    if (!dedos.has(e.pointerId)) return;
    const antes = [...dedos.values()];
    dedos.set(e.pointerId, punto(e));
    const { dx, dy, factor, centro } = pasoGesto(antes, [...dedos.values()]);
    canvas.scroll({ dx, dy });
    // ZoomScroll's own limits.
    if (factor !== 1) canvas.zoom(Math.min(4, Math.max(0.2, canvas.zoom() * factor)), centro);
  };
  const arriba = (e: PointerEvent): void => { dedos.delete(e.pointerId); };
  const eventos = [['pointerdown', abajo], ['pointermove', mueve], ['pointerup', arriba], ['pointercancel', arriba]] as const;
  for (const [nombre, f] of eventos) contenedor.addEventListener(nombre, f, true);
  // The sheet opening or a rotation resizes the canvas: keep what was in its centre in its centre.
  let previo = contenedor.getBoundingClientRect();
  const tamano = new ResizeObserver(() => {
    const r = contenedor.getBoundingClientRect();
    canvas.resized();
    canvas.scroll({ dx: (r.width - previo.width) / 2, dy: (r.height - previo.height) / 2 });
    previo = r;
  });
  tamano.observe(contenedor);
  return () => { tamano.disconnect(); for (const [nombre, f] of eventos) contenedor.removeEventListener(nombre, f, true); };
}

interface Elegido { id: string; nombre: string; tipo: string; documentacion: string }

export function Visor({ inicial }: { inicial: ProjectDocument | null }): React.JSX.Element {
  const S = useStrings();
  const caja = useRef<HTMLDivElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const [visor, setVisor] = useState<NavigatedViewer | null>(null);
  const [doc, setDoc] = useState<ProjectDocument>(() => inicial ?? proyectoDeEjemplo('pedido'));
  const [indice, setIndice] = useState(0);
  const [ir, setIr] = useState<ProcessIR | null>(null);
  const [elegido, setElegido] = useState<Elegido | null>(null);
  const [calor, setCalor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const procesos = useMemo(() => processesOf(doc), [doc]);
  const p = procesos[Math.min(indice, procesos.length - 1)]!;
  // The editor's rule (`corridaActual`): only a run of this revision; the newest of any scenario.
  const run = useMemo(() => [...p.runs].reverse().find((r) => isCurrentRun(r, p.model.revision, p.scenarioRevisions)), [p]);
  const escenario = useMemo((): Record<string, unknown> | null => {
    if (run !== undefined) return run.inputs.scenario as Record<string, unknown>;
    const primero = Object.keys(p.scenarios)[0];
    try { return primero === undefined ? null : resolveExtends(primero, (r) => p.scenarios[r] ?? {}); } catch { return null; }
  }, [p, run]);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem('lila.idioma');
      if (PREFERENCIAS.includes(guardado as Preferencia)) setLocale(guardado as Preferencia);
    } catch { /* Browser storage can be disabled. */ }
    const contenedor = caja.current!;
    const v = new NavigatedViewer({ container: contenedor, bpmnRenderer: colores(), moddleExtensions: { lila } });
    const soltar = engancharGestos(contenedor, v.get<Canvas>('canvas'));
    v.on('selection.changed', ({ newSelection }: { newSelection: { id: string; businessObject?: Record<string, unknown> }[] }) => {
      const e = newSelection[0];
      const bo = e?.businessObject;
      if (e === undefined || bo === undefined) { setElegido(null); return; }
      const docs = (bo['documentation'] as { text?: string }[] | undefined) ?? [];
      setElegido({ id: e.id, nombre: String(bo['name'] ?? ''), tipo: String(bo['$type']), documentacion: docs.map((d) => d.text ?? '').join('\n').trim() });
    });
    setVisor(v);
    finishStartup();
    return () => { soltar(); v.destroy(); };
  }, []);

  useEffect(() => {
    if (visor === null) return undefined;
    let vivo = true;
    setIr(null); setElegido(null); setError(null);
    void Promise.all([visor.importXML(p.model.xml), parseBpmn(p.model.xml, { scenarios: Object.values(p.scenarios) })])
      .then(([, parsed]) => { if (!vivo) return; // `'auto'` centres it; diagram-js accepts it, its typings only list a point.
        visor.get<Canvas>('canvas').zoom('fit-viewport', 'auto' as unknown as Point); setIr(parsed.ir); })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [visor, p]);

  useEffect(() => {
    if (visor === null || ir === null) return;
    const tareas = Object.keys(ir.nodes).filter((id) => ir.nodes[id]!.type === 'task');
    sincronizarOverlay(visor as unknown as Modeler, run === undefined ? null
      : { result: run.result, scenario: run.inputs.scenario as unknown as ResolvedScenario, originalIds: ir.source.originalIds, calor: { tareas } }, calor);
  }, [visor, ir, run, calor]);

  function abrir(nuevo: ProjectDocument): void { setDoc(nuevo); setIndice(0); setCalor(false); }

  async function leerArchivo(f: File): Promise<void> {
    try {
      const b = new Uint8Array(await f.arrayBuffer());
      // By its bytes, not its name: sharing on a phone often renames a .lila to .zip or drops the extension.
      abrir(b[0] === 0x50 && b[1] === 0x4b ? readLila(b) : readProject(JSON.parse(new TextDecoder().decode(b))));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const vista = elegido === null ? null : datosVistaRapida({ id: elegido.id, ir, escenario, resultado: run?.result ?? null, S });
  const seleccionar = (id: string): void => {
    const el = visor?.get<ElementRegistry>('elementRegistry').get(id);
    if (el) visor!.get<Selection>('selection').select(el);
  };

  return (
    <div className="visor">
      <div className="visor-barra">
        <button type="button" className="boton" onClick={() => archivo.current?.click()}>{S.bienvenida.abrirLila}</button>
        {/* No `accept`: iOS greys out an extension it does not know, and .lila is one. */}
        <input ref={archivo} type="file" hidden onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void leerArchivo(f);
        }} />
        <select className="visor-ejemplos" aria-label={S.bienvenida.ejemplosTitulo} value=""
          onChange={(e) => { if (e.currentTarget.value) abrir(proyectoDeEjemplo(e.currentTarget.value as EjemploId)); }}>
          <option value="">{S.bienvenida.ejemplosTitulo}</option>
          {EJEMPLOS.map((ej) => <option key={ej.id} value={ej.id}>{S.bienvenida.ejemplos[ej.id].titulo}</option>)}
        </select>
        {procesos.length > 1 && (
          <select className="visor-procesos" aria-label={S.procesos.nombre} value={Math.min(indice, procesos.length - 1)}
            onChange={(e) => setIndice(Number(e.currentTarget.value))}>
            {procesos.map((pr, i) => <option key={pr.slug} value={i}>{pr.name}</option>)}
          </select>
        )}
        <label className="visor-calor" title={run === undefined ? S.app.sinResultados : undefined}>
          <input type="checkbox" checked={calor} disabled={run === undefined} onChange={(e) => setCalor(e.currentTarget.checked)} />
          {S.c5.resultados.mapaCalor}
        </label>
        <a className="boton" href="?editor">{S.visor.editor}</a>
      </div>
      <div ref={caja} className="visor-lienzo" />
      {error !== null && <p className="visor-hoja error" role="alert">{error}</p>}
      {(elegido !== null || (calor && run !== undefined && ir !== null)) && (
        <section className="visor-hoja" aria-live="polite">
          {elegido !== null && (
            <>
              <button type="button" className="boton visor-cerrar" aria-label={S.app.cerrar}
                onClick={() => visor?.get<Selection>('selection').select(null)}>×</button>
              <h2>{elegido.nombre || S.propiedades.sinNombre}</h2>
              <p className="visor-tipo">{nombreDeTipo(elegido.tipo)}</p>
              {elegido.documentacion !== '' && <p className="visor-doc">{elegido.documentacion}</p>}
              {vista !== null && (
                <dl>
                  {vista.rutas !== undefined ? (
                    <><dt>{S.rutas.propiedadesTitulo}</dt><dd>{vista.rutas.resumen}</dd></>
                  ) : (
                    <>
                      <dt>{S.propiedades.vistaTiempo}</dt><dd>{vista.tiempo}</dd>
                      {vista.recurso !== null && <><dt>{S.propiedades.vistaRecurso}</dt><dd>{vista.recurso}</dd></>}
                      <dt>{S.propiedades.vistaEsperaMedia}</dt><dd>{vista.espera?.texto ?? S.propiedades.vistaSinCorrida}</dd>
                    </>
                  )}
                </dl>
              )}
            </>
          )}
          {calor && run !== undefined && ir !== null && (
            <PanelResumen ir={ir} result={run.result} scenario={run.inputs.scenario as unknown as ResolvedScenario}
              seleccion={elegido?.id ?? null} onSeleccionar={seleccionar} />
          )}
        </section>
      )}
    </div>
  );
}
