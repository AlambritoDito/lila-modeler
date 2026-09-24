/**
 * Ajustes → Atajos (artboard 09, #407): a read-only table of the current keyboard map, grouped
 * the way the artboard groups it. The component owns no shortcut of its own — it only paints
 * whatever `grupos` hands it — so it has nothing to know about `atajos.ts` (#413) yet.
 *
 * ponytail: until #413's shortcut map lands, `Ajustes.tsx` feeds this the two rows that exist
 * today (rename, properties panel) built from the same strings `PropertiesPanel.tsx` already
 * shows. At integration, the caller swaps that static list for `ATAJOS`/`etiqueta()` and this
 * component does not change.
 */
import { useStrings } from '../i18n';

export interface FilaAtajo {
  readonly etiqueta: string;
  readonly tecla: string;
}

export interface GrupoAtajos {
  readonly titulo: string;
  readonly filas: readonly FilaAtajo[];
}

export interface AtajosProps {
  readonly grupos: readonly GrupoAtajos[];
}

export function Atajos({ grupos }: AtajosProps): React.JSX.Element {
  const S = useStrings();
  return (
    <>
      {grupos.map((grupo) => (
        <section key={grupo.titulo} className="ajustes-atajos-grupo">
          <h3>{grupo.titulo}</h3>
          <table>
            <thead>
              <tr>
                <th>{S.ajustes.accion}</th>
                <th>{S.ajustes.tecla}</th>
              </tr>
            </thead>
            <tbody>
              {grupo.filas.map((fila) => (
                <tr key={fila.etiqueta}>
                  <td>{fila.etiqueta}</td>
                  <td><kbd>{fila.tecla}</kbd></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
