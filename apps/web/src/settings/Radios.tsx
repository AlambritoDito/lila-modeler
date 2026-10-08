/**
 * A WAI-ARIA radio group of buttons (artboard 09, #441): the segmented controls of General
 * (language, density) and the theme cards of Appearance.
 *
 * One Tab stop for the whole group — the checked option, or the first one when none is — and the
 * arrows move AND choose, wrapping at both ends (←/↑ back, →/↓ forward, Home/End to the ends).
 * Space or Enter on the focused option chooses it too (a `<button>`'s own click). No library:
 * `role="radio"` plus `aria-checked` is what a screen reader announces, and the roving
 * `tabIndex` is what keeps the group to one stop.
 */
import type { KeyboardEvent, ReactNode } from 'react';

export interface OpcionRadio<T extends string> {
  readonly valor: T;
  readonly contenido: ReactNode;
}

export interface RadiosProps<T extends string> {
  /** Id of the visible label of the group (`aria-labelledby`). */
  readonly etiquetaId: string;
  readonly valor: T;
  readonly opciones: readonly OpcionRadio<T>[];
  readonly onCambiar: (valor: T) => void;
  readonly className: string;
}

const PASO: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function Radios<T extends string>({ etiquetaId, valor, opciones, onCambiar, className }: RadiosProps<T>): React.JSX.Element {
  const marcado = opciones.findIndex((o) => o.valor === valor);
  function elegir(i: number): void {
    // Like a `<select>`'s `change`: nothing to say when the option is already the chosen one.
    if (i !== marcado) onCambiar(opciones[i]!.valor);
  }
  function tecla(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const n = opciones.length;
    const desde = Math.max(0, opciones.findIndex((o) => o.valor === (e.target as HTMLElement).dataset['valor']));
    const destino = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : PASO[e.key] === undefined ? -1 : (desde + PASO[e.key]! + n) % n;
    if (destino < 0) return;
    e.preventDefault();
    elegir(destino);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[destino]?.focus();
  }
  return (
    <div role="radiogroup" aria-labelledby={etiquetaId} className={className} onKeyDown={tecla}>
      {opciones.map((o, i) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={i === marcado}
          tabIndex={i === Math.max(marcado, 0) ? 0 : -1}
          data-valor={o.valor}
          onClick={() => elegir(i)}
        >
          {o.contenido}
        </button>
      ))}
    </div>
  );
}
