/**
 * Scenario rail of Simulate (design 2a): in Simulate the shape palette has nothing to do, so its
 * column becomes the list of the project's scenarios. One row per scenario, the active one marked,
 * `+` duplicates the active one (the house what-if, § 6 of `docs/SCENARIO_FORMAT.md`) and the
 * footer repeats the validation chips of the canvas.
 */
import type { StoredRun } from './store/ProjectStore';
import { useStrings } from './i18n';

interface Props {
  readonly escenarios: Readonly<Record<string, Record<string, unknown>>>;
  readonly activo: string;
  /** Latest valid run of each scenario (App's `latest`): it builds the subtitle. */
  readonly corridas: readonly StoredRun[];
  readonly validacion: { readonly errores: number; readonly avisos: number; readonly primero: string | null };
  readonly onElegir: (id: string) => void;
  readonly onNuevo: () => void;
  /** Jump to the first element with problems, like the chips over the canvas. */
  readonly onProblema: (id: string) => void;
  /** Scenario open in the detached window (design 2c), or `null` while it is docked. */
  readonly enVentana?: string | null;
}

/** BASE = a scenario with no `extends` parent. The rail and the panel header both ask this. */
export const esEscenarioBase = (escenario: Record<string, unknown> | undefined): boolean =>
  typeof escenario?.['extends'] !== 'string';

const nombre = (id: string, escenarios: Props['escenarios']): string => {
  const n = escenarios[id]?.['name'];
  return typeof n === 'string' ? n : id;
};

export function RailEscenarios({ escenarios, activo, corridas, validacion, onElegir, onNuevo, onProblema, enVentana = null }: Props): React.JSX.Element {
  const S = useStrings();
  function subtitulo(id: string): string {
    if (id === enVentana) return S.rail.enVentana;
    const run = corridas.find((r) => r.scenarioName === id)?.inputs.scenario['run'] as { seed?: unknown; replications?: unknown } | undefined;
    if (run !== undefined) return S.rail.corrida(String(run.seed ?? S.app.sinValor), String(run.replications ?? S.app.sinValor));
    const padre = escenarios[id]?.['extends'];
    return typeof padre === 'string' ? `${S.rail.hereda(nombre(padre, escenarios))} · ${S.rail.sinCorrer}` : S.rail.sinCorrer;
  }
  const ir = (): void => { if (validacion.primero !== null) onProblema(validacion.primero); };
  return (
    <nav className="rail-escenarios" aria-label={S.rail.titulo}>
      <div className="rail-cabecera">
        <span>{S.rail.titulo}</span>
        <button type="button" className="rail-nuevo" aria-label={S.rail.nuevo} title={S.rail.nuevo} onClick={onNuevo}>+</button>
      </div>
      <div className="rail-lista">
        {Object.keys(escenarios).map((id) => (
          <button key={id} type="button" className="rail-fila" aria-current={id === activo ? 'true' : undefined} onClick={() => onElegir(id)}>
            <span className="rail-nombre">
              {nombre(id, escenarios)}
              {esEscenarioBase(escenarios[id]) && <span className="insignia-base">{S.rail.base}</span>}
            </span>
            <span className="rail-sub">{subtitulo(id)}</span>
          </button>
        ))}
      </div>
      <div className="rail-pie">
        <span className="rail-rotulo">{S.rail.validacion}</span>
        <div className="chips-validacion en-rail">
          <button type="button" className="chip error" title={S.app.irAlPrimerProblema} disabled={validacion.errores === 0 || validacion.primero === null} onClick={ir}>
            {validacion.errores > 0 && <span className="punto" />}{S.app.errores(validacion.errores)}
          </button>
          <button type="button" className="chip" title={S.app.irAlPrimerProblema} disabled={validacion.avisos === 0 || validacion.primero === null} onClick={ir}>
            {validacion.avisos > 0 && <span className="punto" />}{S.app.avisos(validacion.avisos)}
          </button>
        </div>
      </div>
    </nav>
  );
}
