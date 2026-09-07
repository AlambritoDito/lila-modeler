import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { menuTemplate } from './menu.js';

function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}
const recents = [{ dir: '/p/uno', name: 'Uno', openedAt: '2026-09-07T00:00:00Z' }];

describe('menuTemplate', () => {
  it('en macOS Preferencias… vive en el menú de la app con CmdOrCtrl+, y manda "ajustes"', () => {
    const send = vi.fn();
    const items = flat(menuTemplate([], 'darwin', send));
    const pref = items.find((i) => i.label === 'Preferencias…');
    expect(pref?.accelerator).toBe('CmdOrCtrl+,');
    expect(items[0]?.role).toBe('appMenu');
    (pref!.click as () => void)();
    expect(send).toHaveBeenCalledWith('ajustes');
  });

  it('fuera de macOS Preferencias… y Salir van en Archivo', () => {
    const items = menuTemplate([], 'win32', vi.fn());
    expect(items[0]?.label).toBe('Archivo');
    const labels = (items[0]!.submenu as MenuItemConstructorOptions[]).map((i) => i.label ?? i.role);
    expect(labels).toContain('Preferencias…');
    expect(labels).toContain('quit');
  });

  it('Abrir reciente lista los recientes y manda su carpeta; vacío queda deshabilitado', () => {
    const send = vi.fn();
    const con = flat(menuTemplate(recents, 'darwin', send)).find((i) => i.label === 'Uno');
    (con!.click as () => void)();
    expect(send).toHaveBeenCalledWith({ openRecent: '/p/uno' });
    const sin = flat(menuTemplate([], 'darwin', send)).find((i) => i.label === 'Ninguno');
    expect(sin?.enabled).toBe(false);
  });

  it('los aceleradores de Archivo cubren nuevo, abrir, guardar y guardar como', () => {
    const acc = flat(menuTemplate([], 'darwin', vi.fn())).map((i) => i.accelerator).filter(Boolean);
    expect(acc).toEqual(expect.arrayContaining(['CmdOrCtrl+N', 'CmdOrCtrl+O', 'CmdOrCtrl+S', 'CmdOrCtrl+Shift+S']));
  });
});
