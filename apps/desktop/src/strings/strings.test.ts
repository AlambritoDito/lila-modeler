import { describe, expect, it } from 'vitest';
import { desktopStrings } from './index.js';
import { en } from './en.js';
import { es } from './es.js';

/**
 * Key-parity guard of the desktop catalogs (LILA-213), the same one the web app runs over its own
 * (`apps/web/src/strings.test.ts`), in miniature.
 *
 * `tsc` already refuses a translation that forgets a key or invents one — `es.ts` is annotated
 * with `Strings`, which is derived from `en.ts`. Walking both objects at runtime is what catches
 * what the type cannot see: an entry whose keys are free by construction, and a function whose
 * arity drifted because the translation dropped a parameter it did not need.
 */
function describir(valor: unknown, camino: string, salida: Map<string, string>): Map<string, string> {
  if (typeof valor === 'function') {
    // The parameters are part of the contract: a text with two arguments takes two in every
    // language, and a translation that ignores one still has to accept it.
    salida.set(camino, `function/${(valor as (...args: unknown[]) => unknown).length}`);
  } else if (Array.isArray(valor)) {
    salida.set(camino, `list/${valor.length}`);
    valor.forEach((item, i) => describir(item, `${camino}[${i}]`, salida));
  } else if (valor !== null && typeof valor === 'object') {
    salida.set(camino, 'object');
    for (const [clave, dentro] of Object.entries(valor)) {
      describir(dentro, camino === '' ? clave : `${camino}.${clave}`, salida);
    }
  } else {
    salida.set(camino, typeof valor);
  }
  return salida;
}

describe('LILA-213 · the two desktop catalogs are the same catalog in two languages', () => {
  it('every key exists in both, with the same kind of value and the same arity', () => {
    const base = describir(en, '', new Map());
    const traduccion = describir(es, '', new Map());
    // Two directions, and each failure names the paths: the ones the translation is missing, and
    // the ones it invented or gave a different kind of value.
    expect([...traduccion.keys()].filter((k) => !base.has(k))).toEqual([]);
    expect([...base.keys()].filter((k) => !traduccion.has(k))).toEqual([]);
    expect(
      [...base].filter(([k, v]) => traduccion.get(k) !== v).map(([k, v]) => `${k}: ${v} ≠ ${traduccion.get(k)}`),
    ).toEqual([]);
  });

  it('no entry is left empty, nor untranslated by copy-paste', () => {
    const vacias = [
      ...Object.entries(en.menu),
      ...Object.entries(en.cierre),
      ...Object.entries(es.menu),
      ...Object.entries(es.cierre),
    ].filter(([, texto]) => texto.trim() === '');
    expect(vacias).toEqual([]);
    // The desktop catalog is small enough that no entry happens to be the same word in both
    // languages, so a text that is identical in the two is a copy-paste and this catches it.
    const iguales = [
      ...Object.entries(en.menu).filter(([k, v]) => es.menu[k as keyof typeof en.menu] === v),
      ...Object.entries(en.cierre).filter(([k, v]) => es.cierre[k as keyof typeof en.cierre] === v),
    ];
    expect(iguales).toEqual([]);
  });

  it('desktopStrings hands out the catalog of the locale it is asked for', () => {
    expect(desktopStrings('en')).toBe(en);
    expect(desktopStrings('es')).toBe(es);
    expect(desktopStrings('en').menu.archivo).toBe('File');
    expect(desktopStrings('es').menu.archivo).toBe('Archivo');
  });

  it('the Spanish texts are the ones the app has always shipped, to the letter', () => {
    // The acceptance criterion of LILA-213: a Spanish user must not notice this ticket happened.
    expect(es.menu).toEqual({
      preferencias: 'Preferencias…',
      ninguno: 'Ninguno',
      archivo: 'Archivo',
      nuevoProyecto: 'Nuevo proyecto',
      abrirProyecto: 'Abrir proyecto…',
      abrirReciente: 'Abrir reciente',
      guardarProyecto: 'Guardar proyecto',
      guardarComo: 'Guardar como…',
    });
    expect(es.cierre).toEqual({
      guardar: 'Guardar',
      descartar: 'Descartar',
      cancelar: 'Cancelar',
      mensaje: 'Hay cambios sin guardar.',
      detalle: '¿Quieres guardar los cambios antes de cerrar?',
      parcialMensaje: 'El diagrama se guardó.',
      parcialDetalle: 'Los escenarios y las corridas siguen sin guardarse. Usa «Guardar como…» para guardar el proyecto completo. La ventana permanecerá abierta.',
      errorMensaje: 'No se pudo guardar.',
      errorDetalle: 'El cierre se canceló para no perder cambios. Vuelve a intentar guardar manualmente.',
    });
  });
});
