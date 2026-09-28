/**
 * The canvas tabs (bottom left) as the processes of a repository (ADR-029, #498). With one process
 * the bar looks as it did before: the file name, a ✕ that closes the project, and a «+» — which
 * now adds a process to the same project instead of opening a new one. With two or more, each tab
 * is a process: clicking one switches the canvas, and the active one can be renamed or deleted
 * (never the last). The naming and the confirmation are in-app dialogs: Electron has no
 * `window.prompt`.
 */
import { useEffect, useRef, useState } from 'react';
import { useStrings } from './i18n';

export interface PestanaProceso {
  readonly slug: string;
  readonly name: string;
}

type Peticion = { tipo: 'nuevo' } | { tipo: 'renombrar'; indice: number } | { tipo: 'borrar'; indice: number };

export function PestanasProcesos(props: {
  /** Every process, in order; one entry for a one-process project. */
  procesos: readonly PestanaProceso[];
  activo: number;
  /** Label of the single tab of a one-process project: the model's file name, as before. */
  archivo: string;
  deshabilitado: boolean;
  /** Where a call activity came from (#461): shows a «Back to …» crumb. */
  origen: string | null;
  onVolver: () => void;
  onCambiar: (indice: number) => void;
  onNuevo: (nombre: string) => void;
  onRenombrar: (indice: number, nombre: string) => void;
  onBorrar: (indice: number) => void;
  onCerrarProyecto: () => void;
  idRegion: string;
}): React.JSX.Element {
  const S = useStrings();
  const [peticion, setPeticion] = useState<Peticion | null>(null);
  const [nombre, setNombre] = useState('');
  const dialogo = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (peticion !== null && !dialogo.current?.open) dialogo.current?.showModal();
  }, [peticion]);
  const varios = props.procesos.length > 1;
  const cerrar = (): void => { dialogo.current?.close(); setPeticion(null); };
  const pedir = (p: Peticion): void => {
    setNombre(p.tipo === 'nuevo' ? S.procesos.nombrePorDefecto(props.procesos.length + 1) : props.procesos[p.indice]?.name ?? '');
    setPeticion(p);
  };
  const aceptar = (): void => {
    if (peticion === null) return;
    const limpio = nombre.trim();
    if (peticion.tipo === 'borrar') props.onBorrar(peticion.indice);
    else if (limpio === '') return;
    else if (peticion.tipo === 'nuevo') props.onNuevo(limpio);
    else props.onRenombrar(peticion.indice, limpio);
    cerrar();
  };
  const activo = props.procesos[props.activo];

  return (
    <nav id={props.idRegion} className="diagramas">
      {props.origen !== null && (
        <button type="button" className="enlace volver-origen" disabled={props.deshabilitado} onClick={props.onVolver}>
          {S.procesos.volverA(props.origen)}
        </button>
      )}
      {varios ? props.procesos.map((p, i) => (
        <span key={p.slug} className={`pestana${i === props.activo ? ' activa' : ''}`}>
          <button type="button" className="pestana-proceso" aria-current={i === props.activo ? 'true' : undefined} disabled={props.deshabilitado} onClick={() => { if (i !== props.activo) props.onCambiar(i); }}>
            {p.name}
          </button>
          {i === props.activo && <>
            <button type="button" className="cerrar" aria-label={S.procesos.renombrarProceso(p.name)} title={S.procesos.renombrar} disabled={props.deshabilitado} onClick={() => pedir({ tipo: 'renombrar', indice: i })}>✎</button>
            <button type="button" className="cerrar" aria-label={S.procesos.borrarProceso(p.name)} title={S.procesos.borrar} disabled={props.deshabilitado} onClick={() => pedir({ tipo: 'borrar', indice: i })}>✕</button>
          </>}
        </span>
      )) : (
        // Un proceso: la pestaña de siempre (LILA-208), y su ✕ sigue cerrando el proyecto con la
        // guardia de cambios sin guardar de `projectAction('new')`.
        <span className="pestana activa">
          {props.archivo}
          <button type="button" className="cerrar" aria-label={S.app.cerrarArchivo(props.archivo)} title={S.app.cerrarDiagrama} disabled={props.deshabilitado} onClick={props.onCerrarProyecto}>✕</button>
        </span>
      )}
      <button type="button" className="boton icono" aria-label={S.procesos.nuevo} title={S.procesos.nuevo} disabled={props.deshabilitado} onClick={() => pedir({ tipo: 'nuevo' })}>+</button>

      {peticion !== null && (
        <dialog ref={dialogo} className="confirmar-reemplazo dialogo-proceso" aria-labelledby="proceso-titulo" onCancel={(e) => { e.preventDefault(); cerrar(); }}>
          <form method="dialog" onSubmit={(e) => { e.preventDefault(); aceptar(); }}>
            <h2 id="proceso-titulo">
              {peticion.tipo === 'nuevo' ? S.procesos.tituloNuevo : peticion.tipo === 'renombrar' ? S.procesos.tituloRenombrar : S.procesos.tituloBorrar}
            </h2>
            {peticion.tipo === 'borrar'
              ? <p>{S.procesos.confirmarBorrar(props.procesos[peticion.indice]?.name ?? activo?.name ?? '')}</p>
              : (
                <label className="campo-proceso">
                  {S.procesos.nombre}
                  <input type="text" value={nombre} autoFocus onChange={(e) => setNombre(e.target.value)} />
                </label>
              )}
            <div className="acciones">
              <button type="submit" className="boton primario" disabled={peticion.tipo !== 'borrar' && nombre.trim() === ''}>
                {peticion.tipo === 'nuevo' ? S.procesos.crear : peticion.tipo === 'renombrar' ? S.procesos.renombrar : S.procesos.borrar}
              </button>
              <button type="button" className="boton" onClick={cerrar}>{S.app.cancelar}</button>
            </div>
          </form>
        </dialog>
      )}
    </nav>
  );
}
