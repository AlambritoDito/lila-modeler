/**
 * Aceptación de LILA-206 (#238): el design system del artefacto es Modernist —ninguna esquina
 * redondeada—, usa JetBrains Mono para las cifras y define `density` como un único multiplicador
 * de espaciado.
 *
 * Las dos primeras comprobaciones leen los archivos como texto: jsdom no carga tipografías
 * (`document.fonts` está siempre vacío) ni aplica hojas de estilo importadas, así que la fuente
 * de verdad que sí se puede verificar es lo que se manda al navegador.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable } from './ResultsView.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (nombre: string): string => readFileSync(resolve(AQUI, nombre), 'utf8');

describe('Modernist (LILA-206)', () => {
  it('carga JetBrains Mono con los tres pesos que usa la UI', () => {
    const main = leer('main.tsx');
    for (const peso of [400, 500, 700]) {
      expect(main).toContain(`import '@fontsource/jetbrains-mono/${peso}.css';`);
    }
  });

  it('no deja ningún radio distinto de 0 en el CSS ni en los estilos en línea', () => {
    for (const nombre of ['app.css', 'theme/tokens.css', 'BottleneckOverlay.ts']) {
      const radios = [...leer(nombre).matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
      expect(radios.filter((valor) => !/^0\w*$/.test(valor)), nombre).toEqual([]);
    }
    for (const nombre of ['ResultsView.tsx', 'CompareView.tsx']) {
      const radios = [...leer(nombre).matchAll(/borderRadius:\s*([^,\n]+)/g)].map((m) => m[1]!.trim());
      expect(radios.filter((valor) => valor !== '0'), nombre).toEqual([]);
    }
  });

  it('la densidad es una sola escala que multiplica los paddings', () => {
    const css = leer('app.css');
    expect(css).toContain(".app[data-densidad='compacta'] { --espacio: 0.85; }");
    expect(css).toContain(".app[data-densidad='comoda'] { --espacio: 1.2; }");
    // Botones, pestañas, campos y barra: su padding vertical entra en la escala (el 1 del
    // `var()` es la densidad normal, que por eso no se declara en ningún sitio)…
    for (const selector of ['.boton', '.modo', '.pestana', '.barra', '.estado']) {
      const regla = new RegExp(`\\${selector} \\{[^}]*padding: calc\\(\\d+px \\* var\\(--espacio, 1\\)\\)`);
      expect(css, selector).toMatch(regla);
    }
    // …y las filas de tabla, que se estilan en línea desde ResultsView.
    expect(leer('ResultsView.tsx')).toContain("padding: 'calc(3px * var(--espacio, 1)) 8px'");
    // Ya no quedan reglas sueltas por selector para cada densidad.
    expect(css).not.toContain('padding-block');
  });

  it('pinta las cifras de las tablas en mono y a la derecha', () => {
    const html = renderToStaticMarkup(
      <DataTable
        title="Proceso"
        columns={[
          { display: () => 'T1', header: 'Id', key: 'id', sortValue: () => 'T1' },
          { display: () => '1.234', header: 'Total', key: 'total', numeric: true, sortValue: () => 1234 },
        ]}
        rows={[{}]}
        rowKey={() => 'fila'}
      />,
    );
    expect(html).toContain('font-family:var(--font-mono);text-align:right');
    // La columna de texto se queda con la tipografía de la interfaz.
    expect(html).toContain('text-align:left');
  });
});
