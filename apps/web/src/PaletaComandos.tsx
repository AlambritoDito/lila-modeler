/**
 * Command palette, ⌘K / Ctrl+K (#410).
 *
 * A modal `<dialog>` with an ARIA combobox: the focus stays in the field (Tab included, #442), ↑/↓
 * move the active row (`aria-activedescendant`), Enter or a click picks it, Esc closes it and gives
 * the focus back to whatever had it — a text field with its caret where it was (#442). No library: the rows are plain data (`Comando`) that `App.tsx` builds when the
 * palette opens, and `filtrarComandos` is the whole search.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { normalizar } from './Paleta';
import { teclaDeArchivo } from './atajos';
import { useStrings } from './i18n';

const DESKTOP = typeof window !== 'undefined' && typeof window.lila !== 'undefined';

/**
 * Puts the caret back where it was in the text field that had the focus (#442). Chrome's dialog
 * `close()` hands the focus back to it with the caret at the start (measured by CDP: 3 → 0 in
 * «Filter shapes»), and the palette's own `focus()` after it is then a no-op. A label being edited
 * on the canvas needs nothing: bpmn-js ends the edit as soon as the palette takes the focus.
 */
function recordarCursor(el: Element | null): () => void {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.selectionStart === null) return () => {};
  const { selectionStart: desde, selectionEnd: hasta, selectionDirection: sentido } = el;
  return () => el.setSelectionRange(desde, hasta ?? desde, sentido ?? undefined);
}

export const GRUPOS_COMANDO = ['elementos', 'escenarios', 'modos', 'acciones'] as const;
export type GrupoComando = (typeof GRUPOS_COMANDO)[number];

/** One row of the palette. */
export interface Comando {
  readonly grupo: GrupoComando;
  /** What the row reads, and what the search ranks first. */
  readonly nombre: string;
  /** BPMN id of an element (mono, searchable). */
  readonly id?: string;
  /** Translated type of an element (searchable). */
  readonly tipo?: string;
  /** Shortcut shown on the right. */
  readonly tecla?: string | undefined;
  readonly elegir: () => void;
}

const MAX_ELEMENTOS = 8;
const MAX_FILAS = 30;

/**
 * The rows for `consulta`, in group order. Within a group: name starts with the query, then name
 * contains it, then id or type contains it (accents and case ignored). An empty query lists
 * everything but the elements, which only show up when searched for.
 */
export function filtrarComandos(consulta: string, fuentes: readonly Comando[]): Comando[] {
  const aguja = normalizar(consulta.trim());
  const rango = (c: Comando): number => {
    if (aguja === '') return c.grupo === 'elementos' ? -1 : 0;
    const nombre = normalizar(c.nombre);
    if (nombre.startsWith(aguja)) return 0;
    if (nombre.includes(aguja)) return 1;
    return normalizar(`${c.id ?? ''} ${c.tipo ?? ''}`).includes(aguja) ? 2 : -1;
  };
  return GRUPOS_COMANDO.flatMap((grupo) => {
    const filas = fuentes
      .filter((c) => c.grupo === grupo)
      .map((c) => ({ c, r: rango(c) }))
      .filter(({ r }) => r >= 0)
      .sort((a, b) => a.r - b.r)
      .map(({ c }) => c);
    return grupo === 'elementos' ? filas.slice(0, MAX_ELEMENTOS) : filas;
  }).slice(0, MAX_FILAS);
}

interface Props {
  comandos: readonly Comando[];
  /** Settings → «Advanced» (#447). Hidden or not, the search still matches ids. */
  mostrarIds?: boolean;
  onCerrar: () => void;
}

export function PaletaComandos({ comandos, mostrarIds = false, onCerrar }: Props): React.JSX.Element {
  const S = useStrings();
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  // Captured on the first render, before `showModal` moves the focus into the dialog.
  const previo = useRef(document.activeElement as HTMLElement | null);
  const [cursor] = useState(() => recordarCursor(previo.current));
  const base = useId();
  const [consulta, setConsulta] = useState('');
  const [activo, setActivo] = useState(0);
  const filas = filtrarComandos(consulta, comandos);
  const idFila = (i: number): string => `${base}-${i}`;

  useEffect(() => {
    if (!dialogo.current?.open) dialogo.current?.showModal();
    campo.current?.focus();
  }, []);
  useEffect(() => {
    // #442: behind an open dialog the app's dispatcher stays quiet, so ⌘O/⌘S/⇧⌘S/⌘P reached the
    // browser («Open file», «Save page as», «Print»). On `window`, not the dialog: a click on a
    // non-focusable part of the palette leaves the focus on `<body>`. The desktop app leaves them
    // to its native menu, as the dispatcher does.
    if (DESKTOP) return undefined;
    const retener = (e: KeyboardEvent): void => { if (teclaDeArchivo(e)) e.preventDefault(); };
    window.addEventListener('keydown', retener, true);
    return () => window.removeEventListener('keydown', retener, true);
  }, []);
  useEffect(() => {
    // jsdom has no `scrollIntoView`; browsers do.
    document.getElementById(idFila(activo))?.scrollIntoView?.({ block: 'nearest' });
  });

  /** Closes and puts the focus back before `elegir` runs, so a choice may move it again. */
  function cerrar(): void {
    dialogo.current?.close();
    previo.current?.focus?.();
    cursor();
    onCerrar();
  }
  function elegir(comando: Comando | undefined): void {
    if (comando === undefined) return;
    cerrar();
    comando.elegir();
  }
  function tecla(e: React.KeyboardEvent): void {
    const n = filas.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n > 0) setActivo((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      // An IME confirming a composition sends Enter too: that one is not a pick.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      elegir(filas[activo]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
    }
  }

  let i = 0;
  return (
    <dialog
      ref={dialogo}
      className="paleta-comandos"
      aria-label={S.paleta.comandos.titulo}
      // The browser's own Esc (focus somewhere other than the field) and a click on the backdrop,
      // which lands on the dialog itself.
      onCancel={(e) => { e.preventDefault(); cerrar(); }}
      onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}
      // A modal keeps the focus (#442): the field is its only control, so Tab and ⇧Tab stay on it
      // instead of reaching the scrollable list or leaving the page for the browser's own UI.
      onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); campo.current?.focus(); } }}
    >
      <input
        ref={campo}
        type="search"
        role="combobox"
        aria-expanded={filas.length > 0}
        aria-controls={`${base}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={filas.length > 0 ? idFila(activo) : undefined}
        aria-label={S.paleta.comandos.titulo}
        placeholder={S.paleta.comandos.pista}
        value={consulta}
        onChange={(e) => { setConsulta(e.target.value); setActivo(0); }}
        onKeyDown={tecla}
      />
      <ul role="listbox" id={`${base}-lista`} aria-label={S.paleta.comandos.titulo}>
        {GRUPOS_COMANDO.map((grupo) => {
          const delGrupo = filas.filter((c) => c.grupo === grupo);
          if (delGrupo.length === 0) return null;
          return (
            <li key={grupo} role="group" aria-labelledby={`${base}-${grupo}`}>
              <span id={`${base}-${grupo}`} className="grupo">{S.paleta.comandos.grupos[grupo]}</span>
              <ul role="none">
                {delGrupo.map((c) => {
                  const indice = i++;
                  return (
                    <li
                      key={indice}
                      id={idFila(indice)}
                      role="option"
                      aria-selected={indice === activo}
                      // Keep the focus in the field: the row itself is not focusable.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => { if (indice !== activo) setActivo(indice); }}
                      onClick={() => elegir(c)}
                    >
                      <span className="nombre">{c.nombre}</span>
                      {c.tipo !== undefined && <span className="tipo">{c.tipo}</span>}
                      {mostrarIds && c.id !== undefined && c.id !== c.nombre && <span className="id mono">{c.id}</span>}
                      {c.tecla !== undefined && <kbd>{c.tecla}</kbd>}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      {filas.length === 0 && <p className="vacio">{S.paleta.comandos.sinResultados(consulta)}</p>}
    </dialog>
  );
}
