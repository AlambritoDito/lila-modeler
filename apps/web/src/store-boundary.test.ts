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

describe('límite de módulo: solo main.tsx conoce la implementación concreta del store', () => {
  const archivos = fuentesDeLaUi(SRC).filter(
    (ruta) => ruta !== ENTRADA && !ruta.endsWith(`store/${INTERFAZ}`),
  );

  it('hay algo que revisar (si esto falla, el glob de arriba está mal)', () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  it.each(archivos)('%s no importa una implementación concreta de ProjectStore', (ruta) => {
    const codigo = readFileSync(new URL(ruta, SRC), 'utf8');
    // Cualquier import cuyo especificador termine en "store/<Algo>" que no sea la interfaz.
    const importaImplementacion = /from\s+['"][^'"]*\/store\/(?!ProjectStore['"])[^'"]+['"]/.test(
      codigo,
    );
    expect(importaImplementacion).toBe(false);
  });
});
