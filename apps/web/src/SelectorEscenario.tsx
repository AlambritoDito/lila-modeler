/**
 * «Scenario ▾» (Lote M, owner's decision 2): the dropdown that replaced the Simulate rail. It
 * lists the process's scenarios (BASE badge, «Simulated» / «Not simulated», the parent it
 * extends), picks one, duplicates the active one with its name ready to edit (#581: the copy is
 * renamed to TO-BE without leaving the dropdown), renames it, saves the project and holds the
 * Excel import. The validation chips of the rail sit next to the button and jump to the first
 * problem, like the ones over the canvas.
 *
 * It is a disclosure (button + `aria-expanded`), not a `<details>`: Duplicate has to keep it open
 * and move the focus to the new name, which needs the open state in React. Esc closes it and
 * gives the focus back to the button; a click outside closes it.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProcessIR } from '@lila-modeler/engine';
import { resolveExtends, resolveScenarioPath } from '@lila-modeler/engine/schema';
import type { StoredRun } from './store/ProjectStore';
import { ImportarExcel } from './ImportarExcel';
import { esEscenarioBase } from './RailEscenarios';
import { useStrings } from './i18n';

type Escenarios = Readonly<Record<string, Record<string, unknown>>>;

export interface SelectorEscenarioProps {
  escenarios: Escenarios;
  activo: string;
  /** Latest current run of each scenario (App's `latest`): «Simulated» or «Not simulated». */
  corridas: readonly StoredRun[];
  validacion: { readonly errores: number; readonly avisos: number; readonly primero: string | null };
  ir: ProcessIR | null;
  onElegir: (id: string) => void;
  /** Duplicates the active scenario and makes the copy active; returns the copy's file and name. */
  onDuplicar: () => { archivo: string; nombre: string };
  /** Writes a scenario (the rename, the Excel import). */
  onCambio: (archivo: string, escenario: Record<string, unknown>) => void;
  onGuardar: () => void;
  onProblema: (id: string) => void;
  /** Scenario shown in the detached window, or `null`. */
  enVentana?: string | null;
  /** Without the menu (a compact place): only the button and the chips. */
  compacto?: boolean;
}

export const nombreEscenario = (id: string, escenarios: Escenarios): string => {
  const n = escenarios[id]?.['name'];
  return typeof n === 'string' ? n : id;
};

/**
 * #581: the order a person sees after reopening a project. The engine writes the scenarios sorted
 * by file name (a stable archive), so «as-is (copy)» came back before «as-is» and opened selected.
 * Each base scenario goes first, followed by the ones that extend it (depth first), in the order
 * they arrive; a broken or cyclic chain keeps its place at the end. Pure, and no schema change.
 */
export function ordenarEscenarios<T extends Record<string, unknown>>(escenarios: Readonly<Record<string, T>>): Record<string, T> {
  const ids = Object.keys(escenarios);
  const padreDe = (id: string): string | null => {
    const p = escenarios[id]?.['extends'];
    if (typeof p !== 'string') return null;
    const vecino = resolveScenarioPath(id, p);
    return vecino in escenarios ? vecino : p in escenarios ? p : null;
  };
  const salida: string[] = [];
  const visitar = (id: string): void => {
    if (salida.includes(id)) return;
    salida.push(id);
    for (const hijo of ids) if (padreDe(hijo) === id) visitar(hijo);
  };
  for (const id of ids) if (padreDe(id) === null) visitar(id);
  for (const id of ids) if (!salida.includes(id)) salida.push(id);
  return Object.fromEntries(salida.map((id) => [id, escenarios[id]!]));
}

export function SelectorEscenario(props: SelectorEscenarioProps): React.JSX.Element {
  const S = useStrings();
  const { escenarios, activo, corridas, validacion, enVentana = null } = props;
  const [abierto, setAbierto] = useState(false);
  /** The scenario whose name is being edited (right after Duplicate, or from «Rename»). */
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idMenu = useId();

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e: PointerEvent): void => { if (!raiz.current?.contains(e.target as Node)) cerrar(false); };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  });
  useEffect(() => { if (editando !== null) { campo.current?.focus(); campo.current?.select(); } }, [editando]);

  function cerrar(enfocar = true): void {
    if (editando !== null) confirmarNombre();
    setAbierto(false);
    if (enfocar) boton.current?.focus();
  }
  function duplicar(): void {
    const copia = props.onDuplicar();
    setBorrador(copia.nombre);
    setEditando(copia.archivo);
    setAbierto(true);
  }
  function empezarNombre(id: string): void {
    setBorrador(nombreEscenario(id, escenarios));
    setEditando(id);
  }
  function confirmarNombre(): void {
    const id = editando;
    setEditando(null);
    if (id === null) return;
    const nombre = borrador.trim();
    const escenario = escenarios[id];
    if (escenario === undefined || nombre === '' || nombre === nombreEscenario(id, escenarios)) return;
    props.onCambio(id, { ...escenario, name: nombre });
  }

  const simulados = new Set(corridas.map((r) => r.scenarioName));
  const delta = escenarios[activo] ?? {};
  const padreId = typeof delta['extends'] === 'string' ? delta['extends'] : null;
  // The Excel import plans against the resolved scenario and writes the delta (as in the panel).
  const { resuelto, padre } = useMemo(() => {
    const lector = (ruta: string): Record<string, unknown> => {
      const e = escenarios[ruta];
      if (e === undefined) throw new Error(ruta);
      return e;
    };
    let resuelto: Record<string, unknown> = delta;
    let padre: Record<string, unknown> | null = null;
    try { resuelto = resolveExtends(activo, lector); } catch { /* the panel says why */ }
    if (padreId !== null) { try { padre = resolveExtends(resolveScenarioPath(activo, padreId), lector); } catch { padre = null; } }
    return { resuelto, padre };
  }, [escenarios, activo, delta, padreId]);

  const ir = (): void => { if (validacion.primero !== null) props.onProblema(validacion.primero); };

  return (
    <div className="c5-escenario" ref={raiz} onKeyDown={(e) => {
      if (e.key !== 'Escape' || !abierto) return;
      e.preventDefault();
      e.stopPropagation();
      if (editando !== null) { setEditando(null); return; }
      cerrar();
    }}>
      <button ref={boton} type="button" className="c5-escenario-boton" aria-haspopup="true" aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined} title={S.c5.escenario.titulo}
        onClick={() => { if (abierto) cerrar(); else setAbierto(true); }}>
        <span className="c5-rotulo">{S.c5.escenario.rotulo}</span>
        <span className="c5-escenario-nombre">{nombreEscenario(activo, escenarios)}</span>
        {esEscenarioBase(delta) && <span className="insignia-base">{S.rail.base}</span>}
        <span aria-hidden="true" className="c5-flecha">▾</span>
      </button>
      {/* Duplicate is one click (step 7 of the baseline): visible next to the dropdown, which
          opens with the copy's name ready to edit. */}
      {!props.compacto && (
        <button type="button" className="boton c5-duplicar" title={S.c5.escenario.duplicarTitulo} onClick={duplicar}>
          <span aria-hidden="true">⧉ </span>{S.c5.escenario.duplicar}
        </button>
      )}
      {(validacion.errores > 0 || validacion.avisos > 0) && (
        <span className="chips-validacion c5-chips" role="group" aria-label={S.c5.escenario.problemas}>
          {validacion.errores > 0 && (
            <button type="button" className="chip error" title={S.app.irAlPrimerProblema} disabled={validacion.primero === null} onClick={ir}>
              <span className="punto" />{S.app.errores(validacion.errores)}
            </button>
          )}
          {validacion.avisos > 0 && (
            <button type="button" className="chip" title={S.app.irAlPrimerProblema} disabled={validacion.primero === null} onClick={ir}>
              <span className="punto" />{S.app.avisos(validacion.avisos)}
            </button>
          )}
        </span>
      )}
      {abierto && (
        <div id={idMenu} className="c5-escenario-menu" role="group" aria-label={S.c5.escenario.lista}>
          <ul className="c5-escenario-lista">
            {Object.keys(escenarios).map((id) => (
              <li key={id}>
                {editando === id ? (
                  <input ref={campo} className="c5-escenario-campo" aria-label={S.c5.escenario.nombre} title={S.c5.escenario.nombreAyuda}
                    value={borrador} onChange={(e) => setBorrador(e.target.value)} onBlur={confirmarNombre}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarNombre(); boton.current?.focus(); setAbierto(false); } }} />
                ) : (
                  <button type="button" className="c5-escenario-fila" aria-current={id === activo ? 'true' : undefined}
                    onClick={() => { props.onElegir(id); cerrar(); }}>
                    <span className="c5-escenario-nombre">
                      {nombreEscenario(id, escenarios)}
                      {esEscenarioBase(escenarios[id]) && <span className="insignia-base">{S.rail.base}</span>}
                    </span>
                    <span className="c5-escenario-sub">
                      {id === enVentana ? S.c5.escenario.enVentana : simulados.has(id) ? S.c5.escenario.simulado : S.c5.escenario.sinSimular}
                      {typeof escenarios[id]?.['extends'] === 'string' && ` · ${S.c5.escenario.hereda(nombreEscenario(escenarios[id]!['extends'] as string, escenarios))}`}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!props.compacto && <>
            <div className="c5-escenario-acciones">
              <button type="button" className="boton" title={S.c5.escenario.duplicarTitulo}
                onClick={duplicar}>
                {S.c5.escenario.duplicar}
              </button>
              <button type="button" className="boton" onClick={() => empezarNombre(activo)}>{S.c5.escenario.renombrar}</button>
              <button type="button" className="boton" onClick={() => { props.onGuardar(); cerrar(); }}>{S.c5.escenario.guardar}</button>
            </div>
            <div className="c5-escenario-importar">
              <ImportarExcel key={activo} archivo={activo} resuelto={resuelto} delta={delta} padre={padre} ir={props.ir} onCambio={props.onCambio} />
            </div>
          </>}
        </div>
      )}
    </div>
  );
}
