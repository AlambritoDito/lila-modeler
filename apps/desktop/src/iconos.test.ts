// Aceptación de LILA-207 (#267): el empaquetado tiene icono propio en las tres
// plataformas y los tres binarios salen del mismo SVG de `docs/design`. No abre
// Electron ni construye instaladores: comprueba la configuración y las cabeceras
// de los ficheros, que es lo que lee electron-builder.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const escritorio = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const yml = readFileSync(escritorio('electron-builder.yml'), 'utf8');

describe('icono propio de la app de escritorio (LILA-207)', () => {
  it('electron-builder.yml declara icono en mac, Windows, Linux y en la asociación .bpmn', () => {
    // `icon:` aparece una vez por plataforma más la de fileAssociations.
    const declarados = [...yml.matchAll(/^\s*icon:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(declarados).toEqual([
      'resources/icons/icon.icns', // mac
      'resources/icons/icon.icns', // fileAssociations[0] (electron-builder lo pasa a .ico en Windows)
      'resources/icons/icon.ico', // win
      'resources/icons/icon.png', // linux
    ]);
    // Y el comentario de la cabecera ya no dice que no hay icono (aceptación: `electron-builder.yml:9`).
    expect(yml).not.toMatch(/Sin icono propio/);
    for (const ruta of new Set(declarados)) expect(readFileSync(escritorio(ruta)).length).toBeGreaterThan(0);
  });

  it('icon.png es el maestro de 1024×1024 con alfa (Linux y origen de los otros dos)', () => {
    const png = readFileSync(escritorio('resources/icons/icon.png'));
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png.readUInt8(25)).toBe(6); // color type 6 = RGBA; sin alfa las esquinas saldrían negras
  });

  it('icon.ico es un ICONDIR válido de 4 PNG con una entrada de 256 px', () => {
    // electron-builder valida la cabecera y rechaza el .ico si su mayor lado < 256
    // (app-builder-lib/out/util/iconConverter.js → ERR_ICON_TOO_SMALL).
    const ico = readFileSync(escritorio('resources/icons/icon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // reservado
    expect(ico.readUInt16LE(2)).toBe(1); // tipo: icono
    const n = ico.readUInt16LE(4);
    expect(n).toBe(4);
    let esperado = 6 + 16 * n;
    const lados: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = 6 + 16 * i;
      lados.push(ico.readUInt8(e) || 256); // 0 == 256 px, por spec ICO
      expect(ico.readUInt16LE(e + 6)).toBe(32); // bits por píxel
      const tam = ico.readUInt32LE(e + 8);
      expect(ico.readUInt32LE(e + 12)).toBe(esperado); // offset = 6 + 16·n + acumulado
      expect(ico.subarray(esperado, esperado + 4).toString('latin1')).toBe('\x89PNG');
      esperado += tam;
    }
    expect(lados).toEqual([16, 32, 48, 256]);
    expect(esperado).toBe(ico.length); // sin bytes sueltos al final
  });

  it('icon.icns es un contenedor icns coherente con su cabecera', () => {
    const icns = readFileSync(escritorio('resources/icons/icon.icns'));
    expect(icns.subarray(0, 4).toString('latin1')).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });

  it('el SVG de origen usa los colores de marca del sistema de temas', () => {
    const svg = readFileSync(raiz('docs/design/icono.svg'), 'utf8');
    // `bg.base` de Eva-01 (tokens.css) y `accent.primary` de Papel (themes/papel.json).
    expect(readFileSync(raiz('apps/web/src/theme/tokens.css'), 'utf8')).toContain('#12101A');
    expect(readFileSync(raiz('apps/web/src/theme/themes/papel.json'), 'utf8')).toContain('#EC3013');
    expect(svg).toContain('#12101A');
    expect(svg).toContain('#EC3013');
    expect(svg).toContain('viewBox="0 0 1024 1024"');
  });
});
