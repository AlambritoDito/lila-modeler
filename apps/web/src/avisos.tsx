/**
 * Run warnings grouped by code (#394). The engine emits one warning per replication for the same
 * cause (`W-TAREA-SIN-TIEMPO …(3021 times)`, `…(2975 times)`, …), so thirty replications turn one
 * problem into thirty lines. The Simulate dock and the Results view show one line per message
 * (numbers aside, so two tasks stay two lines) with the
 * number of occurrences; every original message stays one click away (`<details>`).
 */
import type { ReactNode } from 'react';
import { useStrings } from './i18n';

export interface GrupoAvisos {
  /** The `W-…`/`E-…` code, or the whole message when it has none. */
  codigo: string;
  /** The message with its numbers as `#`: what the group shares (and its React key). */
  clave: string;
  severidad: 'error' | 'warning';
  /** Every message of the group, in their original order; never empty. */
  mensajes: string[];
}

/**
 * The group key: the message with its numbers replaced by `#`. The per-replication repeats differ
 * only in their counts (`(3021 times)`, `(2975 times)`), while two subjects differ in an id that
 * may sit anywhere (`W-TAREA-SIN-TIEMPO: Task_A: …`, `W-ELEMENTO-SIN-PARAMETROS: … (elements.X).`),
 * so they stay apart. `\b` leaves digits inside ids (`Task_1`) alone.
 */
const clave = (mensaje: string): string => mensaje.replace(/\b\d+(?:[.,]\d+)?\b/g, '#');
const CODIGO = /^([EW]-[A-Z0-9-]+):/;

/** Groups the repeats of one message (same text but its numbers), in first-seen order. */
export function agruparAvisos(avisos: readonly { mensaje: string; severidad: 'error' | 'warning' }[]): GrupoAvisos[] {
  const grupos = new Map<string, GrupoAvisos>();
  for (const { mensaje, severidad } of avisos) {
    const id = clave(mensaje);
    const grupo = grupos.get(id);
    if (grupo === undefined) grupos.set(id, { codigo: CODIGO.exec(mensaje)?.[1] ?? mensaje, clave: id, severidad, mensajes: [mensaje] });
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
