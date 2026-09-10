import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { menuTemplate } from './menu.js';
import { desktopStrings } from './strings/index.js';
import type { DesktopLocale } from './locale.js';

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

  it('fuera de macOS Preferencias… y Salir van en Archivo', () => {
    const items = menuTemplate([], 'win32', vi.fn(), desktopStrings(locale));
    expect(items[0]?.label).toBe(S.archivo);
    const labels = (items[0]!.submenu as MenuItemConstructorOptions[]).map((i) => i.label ?? i.role);
    expect(labels).toContain(S.preferencias);
    expect(labels).toContain('quit');
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
      S.abrirReciente,
      S.guardarProyecto,
      S.guardarComo,
    ]);
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

  // Electron's role submenus (`appMenu`, `editMenu`, `viewMenu`, `windowMenu`) are localised by
  // the OS, so the template must keep naming them by role and never label them itself.
  it('the OS-localised role menus are left as roles, without a label', () => {
    for (const locale of IDIOMAS) {
      const items = menuTemplate([], 'darwin', vi.fn(), desktopStrings(locale));
      const roles = items.filter((i) => i.role !== undefined && i.role !== 'quit');
      expect(roles.map((i) => i.role)).toEqual(['appMenu', 'editMenu', 'viewMenu', 'windowMenu']);
      expect(roles.filter((i) => i.label !== undefined)).toEqual([]);
    }
  });
});
