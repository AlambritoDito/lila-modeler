/**
 * «Download template» and «Import Excel/CSV…» of the scenario panel (#449), split out of
 * `ScenarioPanel.tsx`.
 */
import { useEffect, useRef, useState } from 'react';

import type { ProcessIR } from '@lila-modeler/engine';
import {
  describeImportValue,
  planScenarioImport,
  readScenarioFile,
  scenarioTemplate,
  WorkbookReadError,
  type ImportPlan,
} from '@lila-modeler/engine/scenario-sheets';

import { conBorrados, escribir, leer } from './escenarioModelo.js';
import { downloadXlsx } from './ResultsView.js';
import { useLocale, useStrings } from './i18n';

/* ------------------------------------------------------------------ *
 * #449: parameters from Excel/CSV, reviewed before they are applied
 * ------------------------------------------------------------------ */

/** The bytes of a picked file. `FileReader` covers the environments without `Blob.arrayBuffer`. */
function leerArchivo(archivo: File): Promise<Uint8Array> {
  if (typeof archivo.arrayBuffer === 'function') return archivo.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(new Uint8Array(lector.result as ArrayBuffer));
    lector.onerror = () => rechazar(lector.error ?? new Error(archivo.name));
    lector.readAsArrayBuffer(archivo);
  });
}

/**
 * «Download template» and «Import Excel/CSV…» (#449). The engine plans the import against the
 * **resolved** scenario (`@lila-modeler/engine/scenario-sheets`); this component only shows the
 * plan and, on «Apply», writes its changes into the **delta** the way the form does (`conBorrados`
 * against the parent, § 6). Undo puts the delta back as it was, and is offered only while nothing
 * else has changed it since: undoing over later edits would silently drop them.
 */
export function ImportarExcel({
  archivo,
  resuelto,
  delta,
  padre,
  ir,
  onCambio,
}: {
  archivo: string;
  resuelto: Record<string, unknown>;
  delta: Record<string, unknown>;
  padre: Record<string, unknown> | null;
  ir: ProcessIR | null;
  onCambio: (archivo: string, escenario: Record<string, unknown>) => void;
}): React.JSX.Element {
  const S = useStrings();
  const locale = useLocale();
  const entrada = useRef<HTMLInputElement>(null);
  const botonImportar = useRef<HTMLButtonElement>(null);
  const seccion = useRef<HTMLElement>(null);
  /**
   * The plan and what it was made against: if the delta or the diagram changed since, its
   * «before» values are stale and applying it would revert those edits, so Apply waits for a
   * new import.
   */
  const [informe, setInforme] = useState<{
    nombre: string;
    plan: ImportPlan;
    delta: Record<string, unknown>;
    ir: ProcessIR;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ antes: Record<string, unknown>; despues: Record<string, unknown>; cambios: number } | null>(null);
  const nombre = typeof resuelto['name'] === 'string' && resuelto['name'].trim() !== '' ? resuelto['name'] : archivo.replace(/\.scenario\.json$/, '');

  async function importar(elegido: File): Promise<void> {
    if (ir === null) return;
    setError(null);
    setHecho(null);
    try {
      const hojas = readScenarioFile(elegido.name, await leerArchivo(elegido));
      setInforme({ nombre: elegido.name, plan: planScenarioImport(hojas, resuelto, ir, { locale }), delta, ir });
    } catch (e) {
      setInforme(null);
      const razon = e instanceof WorkbookReadError ? e.reason : 'not-a-workbook';
      setError(
        razon === 'too-large'
          ? S.escenario.importarDemasiadoGrande
          : razon === 'out-of-bounds'
            ? S.escenario.importarFueraDeLimites
            : S.escenario.importarIlegible,
      );
    }
  }

  /** Closing the report gives the focus back to the button that opened it. */
  function cerrar(): void {
    setInforme(null);
    botonImportar.current?.focus();
  }

  // The report takes the focus when it appears, so a screen reader reads it and Escape reaches it.
  const abierto = informe !== null;
  useEffect(() => {
    if (abierto) seccion.current?.focus();
  }, [abierto]);

  function aplicar(plan: ImportPlan): void {
    let siguiente = delta;
    for (const cambio of plan.changes) {
      siguiente = escribir(siguiente, cambio.path, conBorrados(cambio.after, leer(padre, cambio.path)));
    }
    onCambio(archivo, siguiente);
    setHecho({ antes: delta, despues: siguiente, cambios: plan.changes.length });
    cerrar();
  }

  const plan = informe?.plan;
  const lint = plan?.issues.filter((i) => i.kind === 'lint') ?? [];
  /** What made the plan stale, if anything: the scenario is said first when both changed. */
  const caducado =
    informe === null ? null : informe.delta !== delta ? 'escenario' : informe.ir !== ir ? 'diagrama' : null;
  const noEmparejadas = plan?.issues.filter((i) => i.kind === 'unmatched' || i.kind === 'ambiguous') ?? [];
  const errores = plan?.issues.filter((i) => i.kind === 'error') ?? [];
  const avisos = plan?.issues.filter((i) => i.kind === 'warning') ?? [];

  return (
    <div className="escenario-importar">
      <div className="acciones">
        <button
          type="button"
          className="boton"
          disabled={ir === null}
          title={ir === null ? S.escenario.importarSinModelo : S.escenario.importarAyuda}
          onClick={() => {
            if (ir !== null) downloadXlsx(`${nombre}.template.xlsx`, scenarioTemplate(resuelto, ir));
          }}
        >
          {S.escenario.plantilla}
        </button>
        <button
          type="button"
          className="boton"
          disabled={ir === null}
          title={ir === null ? S.escenario.importarSinModelo : S.escenario.importarAyuda}
          ref={botonImportar}
          onClick={() => entrada.current?.click()}
        >
          {S.escenario.importar}
        </button>
        <input
          ref={entrada}
          type="file"
          hidden
          aria-label={S.escenario.importar}
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(e) => {
            const elegido = e.target.files?.[0];
            e.target.value = '';
            if (elegido !== undefined) void importar(elegido);
          }}
        />
      </div>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {hecho !== null && delta === hecho.despues && (
        <p role="status" className="importado">
          {S.escenario.importarAplicado(hecho.cambios)}{' '}
          <button
            type="button"
            className="boton"
            onClick={() => {
              onCambio(archivo, hecho.antes);
              setHecho(null);
            }}
          >
            {S.escenario.importarDeshacer}
          </button>
        </p>
      )}

      {informe !== null && plan !== undefined && (
        <section
          ref={seccion}
          className="informe-importar"
          role="region"
          aria-labelledby="informe-importar-titulo"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              cerrar();
            }
          }}
        >
          <strong id="informe-importar-titulo">{S.escenario.importarTitulo(informe.nombre)}</strong>
          <p>{plan.changes.length === 0 ? S.escenario.importarSinCambios : S.escenario.importarCambios(plan.changes.length)}</p>
          {plan.changes.length > 0 && (
            <ul className="ids cambios">
              {plan.changes.map((cambio, i) => (
                <li key={i}>
                  <span className="objetivo">{cambio.target}</span>
                  {' · '}
                  <span className="mono">{cambio.field === '' ? S.escenario.importarNuevo : cambio.field}</span>
                  {': '}
                  {describeImportValue(cambio.before, { unit: cambio.unit, locale })} →{' '}
                  {describeImportValue(cambio.after, { unit: cambio.unit, locale })}{' '}
                  <span className="origen">({S.escenario.importarDesde(cambio.sheet, cambio.row)})</span>
                </li>
              ))}
            </ul>
          )}
          {[
            { titulo: S.escenario.importarLint(lint.length), lista: lint, clase: 'error' },
            { titulo: S.escenario.importarNoEmparejadas(noEmparejadas.length), lista: noEmparejadas, clase: 'aviso' },
            { titulo: S.escenario.importarErrores(errores.length), lista: errores, clase: 'error' },
            { titulo: S.escenario.importarAvisos(avisos.length), lista: avisos, clase: 'aviso' },
          ]
            .filter((grupo) => grupo.lista.length > 0)
            .map((grupo) => (
              <div key={grupo.titulo}>
                <p className="etiqueta">{grupo.titulo}</p>
                <ul className="ids">
                  {grupo.lista.map((problema, i) => (
                    <li key={i} className={grupo.clase}>
                      {problema.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {caducado !== null && (
            <p role="alert" className="error">
              {caducado === 'diagrama' ? S.escenario.importarCaducadoDiagrama : S.escenario.importarCaducado}
            </p>
          )}
          <div className="acciones">
            <button
              type="button"
              className="boton primario"
              disabled={plan.changes.length === 0 || lint.length > 0 || caducado !== null}
              onClick={() => aplicar(plan)}
            >
              {S.escenario.importarAplicar}
            </button>
            <button type="button" className="boton" onClick={cerrar}>
              {S.escenario.importarCancelar}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
