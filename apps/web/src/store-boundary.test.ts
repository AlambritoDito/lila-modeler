/**
 * Aceptación de LILA-058, literal: «la UI no importa ninguna implementación concreta fuera
 * del punto de arranque». Se comprueba por grep del código fuente en vez de a mano porque es
 * justo el tipo de regla que un cambio futuro (un nuevo panel, un refactor) puede romper sin
 * que ningún otro test lo note: nada impide que `Modeler.tsx` importe `BrowserStore` y siga
 * compilando y pasando sus propios tests.
 *
 * "Punto de arranque" = `main.tsx`. "Implementación concreta" = cualquier archivo de
 * `store/` que no sea `ProjectStore.ts` (la interfaz): hoy solo `BrowserStore.ts`; cuando
 * lleguen `DesktopStore` (LILA-071) y `RemoteStore` (LILA-086) esta regla los cubre igual,
 * sin tocar el test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('./', import.meta.url);
const ENTRADA = 'main.tsx';
const INTERFAZ = 'ProjectStore.ts';

/** Todo `.ts`/`.tsx` de `src/`, recursivo, salvo tests (que sí pueden importar el concreto). */
function fuentesDeLaUi(dir: URL, prefijo = ''): string[] {
  const resultado: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = `${prefijo}${entrada.name}`;
    if (entrada.isDirectory()) {
      resultado.push(...fuentesDeLaUi(new URL(`${entrada.name}/`, dir), `${ruta}/`));
    } else if (/\.tsx?$/.test(entrada.name) && !entrada.name.includes('.test.')) {
      resultado.push(ruta);
    }
  }
  return resultado;
}

/**
 * Quita los comentarios antes de buscar imports: un import comentado no importa nada, y hacer
 * fallar el test por una línea muerta es ruido. Solo se quitan los comentarios de bloque y los
 * de línea que ocupan la línea entera; uno al final de una línea con código se queda, para no
 * cortar por el `//` de una URL (`'https://…'`), que es el caso frecuente de verdad.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * `true` si `codigo` trae una implementación concreta del store. Cubre las tres formas de
 * traerla: `import … from`, `export … from` y `import()` dinámico —esta última se colaba, y es
 * justo la que usaría alguien para «cargar el store bajo demanda» sin darse cuenta de que
 * rompe la costura de ADR-023—.
 */
export function importaImplementacion(codigo: string): boolean {
  return /(?:\bfrom|\bimport\s*\()\s*['"][^'"]*\/store\/(?!ProjectStore['"])[^'"]+['"]/.test(
    sinComentarios(codigo),
  );
}

describe('qué cuenta como importar la implementación concreta', () => {
  it.each([
    ["import { BrowserStore } from './store/BrowserStore';", true],
    ["export { BrowserStore } from '../store/BrowserStore';", true],
    ["const s = await import('./store/BrowserStore');", true],
    ["import('../store/DesktopStore').then((m) => m);", true],
    ["import type { ProjectStore } from './store/ProjectStore';", false],
    ["// import { BrowserStore } from './store/BrowserStore';", false],
    ["/* import { BrowserStore } from './store/BrowserStore'; */", false],
    ["const ns = 'https://lila-modeler.org/store/BrowserStore';", false],
  ])('%s', (codigo, esperado) => {
    expect(importaImplementacion(codigo)).toBe(esperado);
  });
});

describe('límite de módulo: solo main.tsx conoce la implementación concreta del store', () => {
  const archivos = fuentesDeLaUi(SRC).filter(
    (ruta) => ruta !== ENTRADA && !ruta.endsWith(`store/${INTERFAZ}`),
  );

  it('hay algo que revisar (si esto falla, el glob de arriba está mal)', () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  it.each(archivos)('%s no importa una implementación concreta de ProjectStore', (ruta) => {
    expect(importaImplementacion(readFileSync(new URL(ruta, SRC), 'utf8'))).toBe(false);
  });
});
