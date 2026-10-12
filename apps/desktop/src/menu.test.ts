import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { menuTemplate, teclaDeVentanaHija } from './menu.js';
import { desktopStrings } from './strings/index.js';
import type { DesktopLocale } from './locale.js';
// The one shortcut map (#413). `menu.ts` cannot import it (`rootDir: src`); vitest can, so the
// parity between the two is pinned here.
import { ATAJOS, acelerador } from '../../web/src/atajos.js';

function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}
const recents = [{ dir: '/p/uno', name: 'Uno', openedAt: '2026-09-07T00:00:00Z' }];

/**
 * Every test runs in both languages (LILA-213): the labels come from the catalog the template is
 * handed, and everything that is NOT a label — the accelerators, the roles, the actions each item
 * sends, where Preferences sits per platform — has to be identical in all of them.
 */
const IDIOMAS: readonly DesktopLocale[] = ['en', 'es'];

describe.each(IDIOMAS)('menuTemplate (%s)', (locale) => {
  const S = desktopStrings(locale).menu;

  it('en macOS Preferencias… vive en el menú de la app con CmdOrCtrl+, y manda "ajustes"', () => {
    const send = vi.fn();
    const items = flat(menuTemplate([], 'darwin', send, desktopStrings(locale)));
    const pref = items.find((i) => i.label === S.preferencias);
    expect(pref?.accelerator).toBe('CmdOrCtrl+,');
    expect(items[0]?.role).toBe('appMenu');
    (pref!.click as () => void)();
    expect(send).toHaveBeenCalledWith('ajustes');
  });

  it('en macOS «Acerca de» sustituye al role genérico `about` y manda "acerca" (LILA-381)', () => {
    const send = vi.fn();
    const items = menuTemplate([], 'darwin', send, desktopStrings(locale));
    const appMenu = items[0]!.submenu as MenuItemConstructorOptions[];
    expect(appMenu.some((i) => i.role === 'about')).toBe(false);
    const acerca = appMenu.find((i) => i.label === S.acercaDe);
    expect(acerca).toBeDefined();
    (acerca!.click as () => void)();
    expect(send).toHaveBeenCalledWith('acerca');
  });

  it('fuera de macOS «Acerca de» va al final de Archivo, antes de Salir (LILA-381)', () => {
    const send = vi.fn();
    const archivo = menuTemplate([], 'win32', send, desktopStrings(locale))[0]!.submenu as MenuItemConstructorOptions[];
    const labels = archivo.map((i) => i.label ?? i.role);
    expect(labels.indexOf(S.acercaDe)).toBeGreaterThan(-1);
    expect(labels.indexOf(S.acercaDe)).toBeLessThan(archivo.findIndex((i) => i.role === 'quit'));
    const acerca = archivo.find((i) => i.label === S.acercaDe);
    (acerca!.click as () => void)();
    expect(send).toHaveBeenCalledWith('acerca');
  });

  it('fuera de macOS Preferencias… y Salir van en Archivo', () => {
    const items = menuTemplate([], 'win32', vi.fn(), desktopStrings(locale));
    expect(items[0]?.label).toBe(S.archivo);
    const archivo = items[0]!.submenu as MenuItemConstructorOptions[];
    expect(archivo.map((i) => i.label)).toContain(S.preferencias);
    expect(archivo.find((i) => i.role === 'quit')?.label).toBe(S.salir);
  });

  it('Abrir reciente lista los recientes y manda su carpeta; vacío queda deshabilitado', () => {
    const send = vi.fn();
    const con = flat(menuTemplate(recents, 'darwin', send, desktopStrings(locale))).find((i) => i.label === 'Uno');
    (con!.click as () => void)();
    expect(send).toHaveBeenCalledWith({ openRecent: '/p/uno' });
    const sin = flat(menuTemplate([], 'darwin', send, desktopStrings(locale))).find((i) => i.label === S.ninguno);
    expect(sin?.enabled).toBe(false);
  });

  it('los aceleradores de Archivo cubren nuevo, abrir, guardar y guardar como', () => {
    const acc = flat(menuTemplate([], 'darwin', vi.fn(), desktopStrings(locale)))
      .map((i) => i.accelerator)
      .filter(Boolean);
    expect(acc).toEqual(expect.arrayContaining(['CmdOrCtrl+N', 'CmdOrCtrl+O', 'CmdOrCtrl+S', 'CmdOrCtrl+Shift+S']));
  });

  it('the File submenu carries the catalog labels, in order', () => {
    const archivo = menuTemplate([], 'darwin', vi.fn(), desktopStrings(locale))[1];
    const labels = (archivo!.submenu as MenuItemConstructorOptions[]).map((i) => i.label).filter(Boolean);
    expect(labels).toEqual([
      S.nuevoProyecto,
      S.abrirProyecto,
      // El segundo abridor: el `.lila` de ADR-027, que fuera de macOS no cabe en el mismo diálogo
      // nativo que la carpeta de proyecto.
      S.abrirProyectoArchivo,
      S.importarBpmn,
      S.abrirReciente,
      S.guardarProyecto,
      S.guardarComo,
      S.guardarComoCarpeta,
      S.exportarSvg,
      S.exportarPng,
      S.exportarPdf,
      S.exportarDocx,
      S.exportarHtml,
      S.imprimir,
    ]);
  });

  it('Import BPMN… sends "importarBpmn" (#591), with no accelerator', () => {
    const send = vi.fn();
    const item = flat(menuTemplate([], 'darwin', send, desktopStrings(locale))).find((i) => i.label === S.importarBpmn);
    (item!.click as () => void)();
    expect(send).toHaveBeenCalledWith('importarBpmn');
    expect(item!.accelerator).toBeUndefined();
  });

  it('File exports the diagram as SVG, PNG and PDF and prints it with CmdOrCtrl+P (#451)', () => {
    const send = vi.fn();
    const archivo = menuTemplate([], 'win32', send, desktopStrings(locale))[0]!.submenu as MenuItemConstructorOptions[];
    const enviado = (label: string): unknown => { (archivo.find((i) => i.label === label)!.click as () => void)(); return send.mock.calls.at(-1)?.[0]; };
    expect([S.exportarSvg, S.exportarPng, S.exportarPdf, S.exportarDocx, S.exportarHtml, S.imprimir].map(enviado))
      .toEqual(['exportarSvg', 'exportarPng', 'exportarPdf', 'exportarDocx', 'exportarHtml', { atajo: 'imprimir' }]);
    expect(archivo.find((i) => i.label === S.imprimir)!.accelerator).toBe('CmdOrCtrl+P');
    // After the save entries, behind their own separator.
    const i = archivo.findIndex((x) => x.label === S.exportarSvg);
    expect(archivo[i - 1]!.type).toBe('separator');
    expect(i).toBeGreaterThan(archivo.findIndex((x) => x.label === S.guardarComoCarpeta));
  });
});

describe('menuTemplate · the language only changes the labels', () => {
  it('the English menu reads in English and the Spanish one in Spanish', () => {
    const labels = (locale: DesktopLocale): (string | undefined)[] =>
      flat(menuTemplate(recents, 'darwin', vi.fn(), desktopStrings(locale))).map((i) => i.label);
    expect(labels('en')).toEqual(expect.arrayContaining(['Preferences…', 'File', 'New project', 'Save as…']));
    expect(labels('es')).toEqual(expect.arrayContaining(['Preferencias…', 'Archivo', 'Nuevo proyecto', 'Guardar como…']));
  });

  it('the shape, the roles, the accelerators and the actions are identical in both', () => {
    // What a template is made of besides its labels: `recents` names are data, not text, so they
    // stay put too. If this fails, translating the menu moved something it should not have.
    const esqueleto = (locale: DesktopLocale): unknown => {
      const send = vi.fn();
      return flat(menuTemplate(recents, 'darwin', send, desktopStrings(locale))).map((i) => [
        i.role ?? null,
        i.type ?? null,
        i.accelerator ?? null,
        i.enabled ?? null,
        i.click === undefined ? null : ((i.click as () => void)(), send.mock.calls.at(-1)?.[0] ?? null),
      ]);
    };
    expect(esqueleto('en')).toEqual(esqueleto('es'));
  });

  // Electron's role submenus (`appMenu`, `editMenu`, `windowMenu`) are localised by the OS, so
  // the template must keep naming them by role and never label them itself. View is this app's
  // own since #413: the `viewMenu` role brought reload and page zoom, which fought the canvas.
  it('the OS-localised role menus are left as roles, without a label', () => {
    for (const locale of IDIOMAS) {
      const items = menuTemplate([], 'darwin', vi.fn(), desktopStrings(locale));
      const roles = items.filter((i) => i.role !== undefined && i.role !== 'quit' && i.role !== 'help');
      expect(roles.map((i) => i.role)).toEqual(['appMenu', 'editMenu', 'windowMenu']);
      expect(roles.filter((i) => i.label !== undefined)).toEqual([]);
    }
  });
});

/**
 * #566: outside macOS nothing localises a bare role, so Electron labelled them in English — the
 * Spanish menu bar read «Archivo · Edit · Vista · Simulación · Window · Ayuda» and File ended in
 * «Exit». There every item has to carry a label from the catalog, and the roles it carries must be
 * the ones Electron's `editMenu`/`windowMenu` bring there (less `zoom`, which is macOS-only).
 */
describe.each(['win32', 'linux'] as const)('menuTemplate · no English role label outside macOS (%s)', (platform) => {
  // `process.platform` is what Electron itself looks at; the template reads the argument, and both
  // are set so a stray `process.platform` check in the template could not hide behind macOS.
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  beforeAll(() => Object.defineProperty(process, 'platform', { ...original, value: platform }));
  afterAll(() => Object.defineProperty(process, 'platform', original));

  it.each(IDIOMAS)('every item but the separators has a label from the catalog (%s)', (locale) => {
    const strings = desktopStrings(locale);
    const catalogo = new Set<string>(Object.values(strings.menu));
    const items = flat(menuTemplate(recents, process.platform, vi.fn(), strings, { dev: true }))
      .filter((i) => i.type !== 'separator' && i.label !== 'Uno');
    expect(items.filter((i) => i.label === undefined).map((i) => i.role)).toEqual([]);
    expect(items.map((i) => i.label).filter((l) => !catalogo.has(l!))).toEqual([]);
  });

  it('the Spanish menu bar and its role items read in Spanish', () => {
    const items = menuTemplate([], process.platform, vi.fn(), desktopStrings('es'), { dev: true });
    expect(items.map((i) => i.label)).toEqual(['Archivo', 'Edición', 'Vista', 'Simulación', 'Ventana', 'Ayuda']);
    const sub = (label: string) => (items.find((m) => m.label === label)!.submenu as MenuItemConstructorOptions[])
      .filter((i) => i.role !== undefined).map((i) => [i.role, i.label]);
    expect(sub('Edición')).toEqual([
      ['undo', 'Deshacer'], ['redo', 'Rehacer'], ['cut', 'Cortar'], ['copy', 'Copiar'], ['paste', 'Pegar'],
      ['delete', 'Eliminar'], ['selectAll', 'Seleccionar todo'],
    ]);
    expect(sub('Ventana')).toEqual([['minimize', 'Minimizar'], ['close', 'Cerrar']]);
    expect(sub('Vista')).toEqual([['togglefullscreen', 'Pantalla completa'], ['toggleDevTools', 'Herramientas de desarrollo']]);
    expect(sub('Archivo')).toEqual([['quit', 'Salir']]);
  });

  it('the role items keep their role: no hand-set accelerator, so Electron still brings its own', () => {
    const roles = flat(menuTemplate([], process.platform, vi.fn(), desktopStrings('en'), { dev: true }))
      .filter((i) => i.role !== undefined && i.role !== 'help');
    expect(roles.filter((i) => i.accelerator !== undefined || i.click !== undefined)).toEqual([]);
    expect(roles.some((i) => i.role === 'editMenu' || i.role === 'windowMenu' || i.role === 'zoom')).toBe(false);
  });
});

describe('menuTemplate · macOS keeps the bare roles (#566)', () => {
  it('no role item carries a label of ours, in either language', () => {
    for (const locale of IDIOMAS) {
      const items = flat(menuTemplate(recents, 'darwin', vi.fn(), desktopStrings(locale), { dev: true }));
      expect(items.filter((i) => i.role !== undefined && i.role !== 'help' && i.label !== undefined)).toEqual([]);
      expect(items.map((i) => i.role).filter(Boolean)).toEqual([
        'appMenu', 'services', 'hide', 'hideOthers', 'unhide', 'quit', 'close',
        'editMenu', 'togglefullscreen', 'toggleDevTools', 'windowMenu', 'help',
      ]);
    }
  });
});

describe('menuTemplate · close and quit (owner request 2026-09-25)', () => {
  it('on macOS File ends with the `close` role after the save entries, once, with no hand-set accelerator', () => {
    const S = desktopStrings('en').menu;
    const menus = menuTemplate([], 'darwin', vi.fn(), desktopStrings('en'));
    const archivo = menus.find((m) => m.label === S.archivo)!.submenu as MenuItemConstructorOptions[];
    const labels = archivo.map((i) => i.label ?? i.role);
    expect(labels.indexOf('close')).toBeGreaterThan(labels.indexOf(S.guardarComoCarpeta));
    expect(labels.at(-1)).toBe('close');
    // The role carries its own key (⌘W); the template never sets one, so the parity test cannot see it.
    expect(archivo.find((i) => i.role === 'close')!.accelerator).toBeUndefined();
    expect(flat(menus).filter((i) => i.role === 'close')).toHaveLength(1);
    expect(flat(menus).filter((i) => i.role === 'quit')).toHaveLength(1);
  });

  it('on Windows/Linux File has no `close`: the Window menu already lists Close (Ctrl+W)', () => {
    const S = desktopStrings('en').menu;
    const menus = menuTemplate([], 'win32', vi.fn(), desktopStrings('en'));
    const archivo = menus.find((m) => m.label === S.archivo)!.submenu as MenuItemConstructorOptions[];
    expect(archivo.filter((i) => i.role === 'close')).toHaveLength(0);
    const ventana = menus.find((m) => m.label === S.ventana)!.submenu as MenuItemConstructorOptions[];
    expect(ventana.filter((i) => i.role === 'close')).toHaveLength(1);
    expect(flat(menus).filter((i) => i.role === 'quit')).toHaveLength(1);
  });
});

describe('menuTemplate · parity with the shortcut map (#413)', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    it(`every accelerator is the map's, every menu entry of the map has its item, none twice (${platform})`, () => {
      const send = vi.fn();
      const items = flat(menuTemplate([], platform, send, desktopStrings('en'))).filter((i) => i.accelerator !== undefined);
      const porId = new Map<string, string>();
      for (const item of items) {
        (item.click as () => void)();
        const accion = send.mock.calls.at(-1)?.[0] as string | { atajo?: string };
        const id = typeof accion === 'string' ? accion : accion.atajo!;
        const atajo = ATAJOS.find((a) => a.id === id);
        expect(atajo, id).toBeDefined();
        expect(item.accelerator, id).toBe(acelerador(atajo!));
        porId.set(id, item.accelerator as string);
      }
      expect([...porId.keys()].sort()).toEqual(ATAJOS.filter((a) => 'menu' in a).map((a) => a.id).sort());
      const aceleradores = items.map((i) => i.accelerator);
      expect(aceleradores.filter((a, i) => aceleradores.indexOf(a) !== i)).toEqual([]);
    });
  }

  it.each(IDIOMAS)('View has the palette and the six modes; Simulation has Run (%s)', (locale) => {
    const S = desktopStrings(locale).menu;
    const send = vi.fn();
    const menus = menuTemplate([], 'darwin', send, desktopStrings(locale));
    const sub = (label: string) => menus.find((m) => m.label === label)!.submenu as MenuItemConstructorOptions[];
    const enviado = (i: MenuItemConstructorOptions) => { (i.click as () => void)(); return send.mock.calls.at(-1)?.[0]; };
    const vista = sub(S.vista).filter((i) => i.click !== undefined);
    expect(vista.map((i) => i.label)).toEqual([S.paleta, S.modoModelar, S.modoSimular, S.modoResultados]);
    expect(vista.map(enviado)).toEqual(['paleta', 'modo:modelar', 'modo:simular', 'modo:resultados'].map((atajo) => ({ atajo })));
    expect(sub(S.vista).map((i) => i.role).filter(Boolean)).toEqual(['togglefullscreen']);
    const simulacion = sub(S.simulacion);
    expect(simulacion.map((i) => i.label)).toEqual([S.ejecutar]);
    expect(enviado(simulacion[0]!)).toEqual({ atajo: 'ejecutar' });
    // Reload (⌘R) and page zoom (⌘+/⌘−/⌘0) are gone with the role.
    expect(flat(menus).some((i) => i.role === 'reload' || i.role === 'zoomIn' || i.role === 'resetZoom')).toBe(false);
  });
});

describe('menuTemplate · DevTools and Help', () => {
  it('DevTools (⌥⌘I) are in View only when the app is not packaged', () => {
    const roles = (dev: boolean) => flat(menuTemplate([], 'darwin', vi.fn(), desktopStrings('en'), { dev })).map((i) => i.role);
    expect(roles(false)).not.toContain('toggleDevTools');
    expect(roles(true)).toContain('toggleDevTools');
  });

  it.each(IDIOMAS)('the last menu is Help, with Documentation opening the docs (%s)', (locale) => {
    const S = desktopStrings(locale).menu;
    const abrirDocs = vi.fn();
    const ayuda = menuTemplate([], 'darwin', vi.fn(), desktopStrings(locale), { abrirDocs }).at(-1)!;
    expect([ayuda.role, ayuda.label]).toEqual(['help', S.ayuda]);
    const docs = (ayuda.submenu as MenuItemConstructorOptions[]).find((i) => i.label === S.documentacion)!;
    (docs.click as () => void)();
    expect(abrirDocs).toHaveBeenCalledOnce();
  });
});

describe('teclaDeVentanaHija · ⌘W / ⌘Q in the About and detached windows', () => {
  const tecla = (key: string, mods: Partial<Record<'meta' | 'control' | 'alt' | 'shift', boolean>>, type = 'keyDown') =>
    ({ type, key, meta: false, control: false, alt: false, shift: false, ...mods });

  it('on macOS ⌘W closes the child and ⌘Q quits', () => {
    expect(teclaDeVentanaHija(tecla('w', { meta: true }), 'darwin')).toBe('cerrar');
    expect(teclaDeVentanaHija(tecla('W', { meta: true }), 'darwin')).toBe('cerrar');
    expect(teclaDeVentanaHija(tecla('q', { meta: true }), 'darwin')).toBe('salir');
  });

  it('leaves everything else to the page and the menu', () => {
    for (const [key, mods, type] of [
      ['w', { meta: true }, 'keyUp'],
      ['w', { meta: true, alt: true }], // Close All
      ['q', { meta: true, alt: true }], // Quit and Keep Windows
      ['w', { meta: true, shift: true }],
      ['w', { control: true }], // ⌃W on a Mac is not Close
      ['w', {}],
      ['s', { meta: true }],
    ] as const) expect(teclaDeVentanaHija(tecla(key, mods, type), 'darwin'), `${key} ${JSON.stringify(mods)}`).toBeNull();
  });

  it('outside macOS only Ctrl+W, and no quit key', () => {
    expect(teclaDeVentanaHija(tecla('w', { control: true }), 'win32')).toBe('cerrar');
    expect(teclaDeVentanaHija(tecla('q', { control: true }), 'linux')).toBeNull();
    expect(teclaDeVentanaHija(tecla('w', { meta: true }), 'win32')).toBeNull();
  });
});
