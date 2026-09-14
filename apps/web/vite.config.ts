import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Stage local assets without moving theme sources or changing their public URLs.
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const webVersion = (JSON.parse(readFileSync(here('./package.json'), 'utf8')) as { version: string }).version;
const desktopVersion = (JSON.parse(readFileSync(here('../desktop/package.json'), 'utf8')) as { version: string }).version;
if (webVersion !== desktopVersion) throw new Error('Web and desktop versions must match before building.');
mkdirSync(here('./public'), { recursive: true });
cpSync(here('./src/theme/themes'), here('./public'), { recursive: true });
cpSync(here('../../docs/design/branding/web'), here('./public/branding'), { recursive: true });

export default defineConfig({
  plugins: [react(), {
    name: 'lila-branding',
    transformIndexHtml: (html) => html.replaceAll('%LILA_APP_VERSION%', webVersion),
    configureServer(server) {
      // Preserve live theme editing: refreshing must read the edited source JSON.
      const sources = [
        [here('./src/theme/themes'), here('./public')],
        [here('../../docs/design/branding/web'), here('./public/branding')],
      ] as const;
      for (const [source, target] of sources) {
        server.watcher.add(source);
        const sync = (file: string, removed = false) => {
          const rel = relative(source, file);
          if (!rel || rel.startsWith(`..${sep}`) || rel === '..') return;
          const dest = resolve(target, rel);
          if (removed) rmSync(dest, { force: true });
          else { mkdirSync(dirname(dest), { recursive: true }); cpSync(file, dest); }
        };
        server.watcher.on('change', file => sync(file));
        server.watcher.on('add', file => sync(file));
        server.watcher.on('unlink', file => sync(file, true));
      }
    },
  }],
  publicDir: 'public',
  // The default `/` is what the desktop needs: Electron loads `lila://app/index.html`, so the
  // bundle has to keep referencing its assets from the root of that custom scheme. The GitHub
  // Pages demo (LILA-067) is served from a sub-path instead
  // (`https://alambritodito.github.io/lila-modeler/app/`), and `.github/workflows/pages.yml`
  // builds it with `LILA_WEB_BASE=/lila-modeler/app/`. Nothing else in the app hardcodes `/`:
  // themes are fetched as `./<id>.json` (relative to the document) and the worker goes through
  // `new URL('./worker.ts', import.meta.url)`, which Vite rewrites with this same `base`.
  base: process.env.LILA_WEB_BASE ?? '/',
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
