/**
 * Run warnings grouped by code (#394). The engine emits one warning per replication for the same
 * cause (`W-TAREA-SIN-TIEMPO …(3021 times)`, `…(2975 times)`, …), so thirty replications turn one
 * problem into thirty lines. The Simulate dock and the Results view show one line per code and
 * subject (the segment before the second `:`, so two tasks stay two lines) with the
 * number of occurrences; every original message stays one click away (`<details>`).
 */
import type { ReactNode } from 'react';
import { useStrings } from './i18n';

export interface GrupoAvisos {
  /** `W-…: subject`, the `W-…`/`E-…` code alone, or the whole message when it has none. */
  codigo: string;
  severidad: 'error' | 'warning';
  /** Every message of the group, in their original order; never empty. */
  mensajes: string[];
}

/** Code and subject (`W-TAREA-SIN-TIEMPO: Task_A`): two tasks with the same warning are two causes. */
const CODIGO_Y_SUJETO = /^([EW]-[A-Z0-9-]+: [^:]+):/;
const CODIGO = /^([EW]-[A-Z0-9-]+):/;

/** Groups by code and subject (or code alone), keeping the order in which each group first appears. */
export function agruparAvisos(avisos: readonly { mensaje: string; severidad: 'error' | 'warning' }[]): GrupoAvisos[] {
  const grupos = new Map<string, GrupoAvisos>();
  for (const { mensaje, severidad } of avisos) {
    const codigo = CODIGO_Y_SUJETO.exec(mensaje)?.[1] ?? CODIGO.exec(mensaje)?.[1] ?? mensaje;
    const grupo = grupos.get(codigo);
    if (grupo === undefined) grupos.set(codigo, { codigo, severidad, mensajes: [mensaje] });
    else {
      grupo.mensajes.push(mensaje);
      if (severidad === 'error') grupo.severidad = 'error';
    }
  }
  return [...grupos.values()];
}

/** One group as a list item: its first message, `×N` and the others behind a disclosure. */
export function AvisoAgrupado({ grupo }: { grupo: GrupoAvisos }): ReactNode {
  const S = useStrings();
  const [primero, ...resto] = grupo.mensajes;
  return (
    <li className={grupo.severidad === 'error' ? 'error' : 'aviso'}>
      {primero}
      {resto.length > 0 && (
        <details className="avisos-resto">
          <summary>{S.dock.ocurrencias(grupo.mensajes.length)}</summary>
          <ul>{resto.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </details>
      )}
    </li>
  );
}
