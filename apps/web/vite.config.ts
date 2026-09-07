import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ponytail: los temas viven en `src/theme/themes/` (fuente única, la que leen los tests)
// y esa carpeta es el `publicDir` de Vite, así que se sirven tal cual en `/eva-01.json`
// y se copian verbatim a `dist/`. Editar un valor del JSON y recargar cambia la UI sin
// recompilar, que es la aceptación de LILA-112. Si algún día hacen falta otros assets
// estáticos, se crea `apps/web/public/` y se mueven los temas a `public/themes/`.
export default defineConfig({
  plugins: [react()],
  publicDir: 'src/theme/themes',
  // Ningún asset incrustado como `data:`: Vite inlinea por defecto lo que pesa menos de 4 KB y
  // los subconjuntos griego/cirílico de JetBrains Mono (#238) caen ahí, y el CSP de Electron
  // (`font-src 'self'`, `apps/desktop/src/main.ts`) los bloquea. Con archivos sueltos la CSP
  // se queda como está; el smoke (`LILA_SMOKE=1`) es quien lo vigila.
  build: { assetsInlineLimit: 0 },
  // Ni `results.html` (demo de LILA-062) ni `compare.html` (demo de LILA-063) se declaran como
  // entrada de `build`: en dev Vite sirve cualquier `.html` de la raíz del proyecto, así que
  // `npm run dev` las abre igual, y así el bundle de producción —el que publica LILA-067 en
  // GitHub Pages— no incluye páginas de demostración que nadie debería encontrarse en la app.
  //
  // `server.fs.allow` **acota**, no amplía: por defecto Vite deja servir toda la raíz del
  // monorepo (la detecta por `package-lock.json`), incluidos `BACKLOG.md` e
  // `investigacion-2026-09-03/`. Aquí se reduce a lo que la web necesita de verdad —
  // `apps/web`, los `examples/` que importa la demo y el `dist` del motor—; todo lo demás
  // responde 403 en el dev server. Solo aplica a `vite dev`; `vite build` no lo mira.
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../../examples', import.meta.url)),
        fileURLToPath(new URL('../../packages/engine', import.meta.url)),
        // #225: bpmn-js referencia sus fuentes (`bpmn.woff2`, …) desde el CSS por `url()`, y esas
        // peticiones salen como `/@fs/<raíz>/node_modules/...`; sin esta entrada Vite las
        // rechaza con 403 y los iconos de la paleta se ven vacíos.
        fileURLToPath(new URL('../../node_modules', import.meta.url)),
      ],
    },
  },
});
