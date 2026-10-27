/**
 * The band over the beta build on Pages (#704): this is the preview built from `main`, and the
 * stable app is one link away. Only `main.tsx` mounts it, over the editor or the phone viewer, and
 * only when the build's base is the beta's (`channel.ts`) and the app is not the desktop one.
 * Closing it lasts for the tab (`sessionStorage`): a new visit says it again, so nobody forgets
 * which build they are in.
 */
import { useState } from 'react';
import { stableAppPath, storageKey } from './channel';
import { useStrings } from './i18n';

const CERRADO = storageKey('avisoBeta');

function cerradoAntes(): boolean {
  try { return sessionStorage.getItem(CERRADO) !== null; } catch { return false; }
}

export function AvisoBeta({ base = import.meta.env.BASE_URL }: { base?: string }): React.JSX.Element | null {
  const S = useStrings();
  const [visible, setVisible] = useState(() => !cerradoAntes());
  if (!visible) return null;
  return (
    <div className="aviso-beta" role="note">
      <span>{S.canal.betaTexto}</span>
      <a href={stableAppPath(base)}>{S.canal.irEstable}</a>
      <button type="button" className="cerrar" aria-label={S.canal.cerrar} title={S.canal.cerrar} onClick={() => {
        try { sessionStorage.setItem(CERRADO, '1'); } catch { /* shown again on reload */ }
        setVisible(false);
      }}>×</button>
    </div>
  );
}
