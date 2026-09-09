// @vitest-environment jsdom
/**
 * Aceptación de LILA-114: editar `accent.primary` se ve al instante, exportar e importar reproduce
 * el tema exacto y un JSON inválido se rechaza con mensaje y sin tocar nada.
 *
 * `applyTheme` es el de verdad (no un mock): lo que se comprueba es la variable CSS del `:root`,
 * que es lo que pinta la app entera y por tanto la vista previa del ticket. El banco de pruebas
 * repite el cableado mínimo de `App.tsx` —aplicar el tema seleccionado y guardar la lista— porque
 * el componente no aplica ni persiste nada por sí solo, a propósito.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyTheme, type Theme } from '../theme/applyTheme';
import { esDelUsuario, temaDe, type TemaGuardado } from '../theme/temas';
import { Apariencia } from './Apariencia';

/**
 * Temas integrados de mentira. Un tema puede ser parcial (`docs/THEMES.md`), así que con cinco
 * tokens —uno de cada tipo de control— se prueba lo mismo que con los 40 y el JSON exportado cabe
 * en un `toEqual` legible.
 */
const EVA: Theme = {
  name: 'Eva-01',
  tokens: {
    'accent.primary': '#9EF01A',
    'bg.base': '#12101A',
    shadow: '#00000099',
    'font.ui': 'Archivo, Inter, system-ui, sans-serif',
    'font.size.base': '13px',
  },
};
const PAPEL: Theme = { name: 'Papel', tokens: { 'accent.primary': '#EC3013', 'bg.base': '#F3F2F2' } };
const INTEGRADOS: Record<string, Theme> = { 'eva-01': EVA, papel: PAPEL };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
/** Lo último que el componente mandó guardar: lo que en la app va a `estado.json`/`localStorage`. */
let guardado: readonly TemaGuardado[] = [];

/** El cableado de `App.tsx`, en pequeño: aplica lo seleccionado y guarda la lista. */
function Banco(): React.JSX.Element {
  const [temaId, setTemaId] = useState('eva-01');
  const [tema, setTema] = useState<Theme>(EVA);
  const [temas, setTemas] = useState<readonly TemaGuardado[]>([]);
  const [densidad, setDensidad] = useState('normal');
  function seleccionar(id: string, lista: readonly TemaGuardado[]): void {
    const t = esDelUsuario(id) ? temaDe(id, lista)?.tema : INTEGRADOS[id];
    if (t === undefined) return;
    applyTheme(t as Theme);
    setTema(t as Theme);
    setTemaId(id);
  }
  return (
    <Apariencia
      temaId={temaId}
      tema={tema}
      temas={temas}
      densidad={densidad}
      onDensidad={setDensidad}
      onTemas={(lista, seleccion = temaId) => { guardado = lista; setTemas(lista); seleccionar(seleccion, lista); }}
      onSeleccionar={(id) => seleccionar(id, temas)}
    />
  );
}

const variable = (nombre: string): string => document.documentElement.style.getPropertyValue(nombre);
const porEtiqueta = (etiqueta: string): HTMLInputElement =>
  container.querySelector<HTMLInputElement>(`[aria-label="${etiqueta}"]`)!;
const selectTema = (): HTMLSelectElement => container.querySelector<HTMLSelectElement>('select')!;
function boton(texto: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent === texto);
  expect(b, texto).toBeDefined();
  return b!;
}
/** El setter nativo + el evento `input` es lo que React traduce a `onChange`. */
function teclear(campo: HTMLInputElement, texto: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Empuja un archivo por el `<input type="file">`, que jsdom no deja rellenar de otra manera. */
async function importar(contenido: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([contenido], 'tema.json')] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}

beforeEach(async () => {
  guardado = [];
  document.documentElement.removeAttribute('style');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Banco />));
  applyTheme(EVA);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

it('editar el acento se aplica al instante y cae sobre una copia del tema integrado', () => {
  teclear(porEtiqueta('Hex de accent.primary'), '#123456');
  expect(variable('--accent-primary')).toBe('#123456');
  // El integrado no se toca: la edición nació como copia suya, que es la que queda seleccionada.
  expect(guardado).toHaveLength(1);
  expect(guardado[0]!.tema.name).toBe('Eva-01 (copia)');
  expect(guardado[0]!.origen['accent.primary']).toBe('#9EF01A');
  expect(selectTema().value).toBe(guardado[0]!.id);
  // Y sigue editándose la misma copia, no una nueva por tecla.
  teclear(porEtiqueta('Hex de accent.primary'), '#654321');
  expect(guardado).toHaveLength(1);
  expect(variable('--accent-primary')).toBe('#654321');
});

it('elegir otro tema integrado lo aplica sin crear nada', () => {
  act(() => {
    const select = selectTema();
    select.value = 'papel';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(variable('--accent-primary')).toBe(PAPEL.tokens['accent.primary']);
  expect(guardado).toEqual([]);
});

it('el selector de color respeta el alfa que el token ya tenía', () => {
  teclear(porEtiqueta('Color de shadow'), '#112233');
  expect(guardado[0]!.tema.tokens.shadow).toBe('#11223399');
});

it('exportar e importar reproduce el tema exacto', async () => {
  // jsdom no trae `createObjectURL` ni descarga nada: se sustituyen para quedarse con el Blob, que
  // es lo que el navegador guardaría en el archivo.
  const blobs: Blob[] = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:tema'; },
    revokeObjectURL: () => {},
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  await act(async () => boton('Exportar').click());
  const exportado = await blobs[0]!.text();
  expect(JSON.parse(exportado)).toEqual({ name: EVA.name, tokens: EVA.tokens });

  await importar(exportado);
  expect(guardado).toHaveLength(1);
  expect(selectTema().value).toBe(guardado[0]!.id);
  // El tema importado vuelve a salir idéntico: la ida y vuelta no pierde ni añade nada.
  await act(async () => boton('Exportar').click());
  expect(JSON.parse(await blobs[1]!.text())).toEqual(JSON.parse(exportado));
});

it('un JSON inválido se rechaza con mensaje y sin aplicar nada', async () => {
  const antes = variable('--accent-primary');
  await importar('{ "name": "Malo", "tokens": { "accent.primary": "azul" } }');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('"accent.primary"');
  expect(guardado).toEqual([]);
  expect(variable('--accent-primary')).toBe(antes);

  await importar('{ "name": "Malo", "tokens": { "acento": "#FFFFFF" } }');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('"acento"');
  await importar('no soy json');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('JSON válido');
  expect(guardado).toEqual([]);
  expect(variable('--accent-primary')).toBe(antes);
});

it('restablecer devuelve el tema del usuario a su origen', () => {
  teclear(porEtiqueta('Hex de accent.primary'), '#123456');
  expect(variable('--accent-primary')).toBe('#123456');
  act(() => boton('Restablecer').click());
  expect(variable('--accent-primary')).toBe('#9EF01A');
  expect(guardado[0]!.tema.tokens['accent.primary']).toBe('#9EF01A');
  // Sigue siendo el tema del usuario, con su nombre: restablecer no lo borra.
  expect(guardado[0]!.tema.name).toBe('Eva-01 (copia)');
});

it('eliminar el tema del usuario vuelve al integrado', () => {
  teclear(porEtiqueta('Hex de accent.primary'), '#123456');
  act(() => boton('Eliminar').click());
  expect(guardado).toEqual([]);
  expect(selectTema().value).toBe('eva-01');
  expect(variable('--accent-primary')).toBe('#9EF01A');
});
