/*
 * Geometría y colores que solo viven en la hoja de estilos (LILA-208).
 *
 * jsdom no maquetea: `getBoundingClientRect` devuelve ceros para todo, así que la distancia de
 * los controles de zoom a la marca de agua no se puede medir en `App.test.tsx`. El dato vive en
 * `app.css`, y aquí se comprueba ahí mismo. Sin `@vitest-environment jsdom` a propósito: esto
 * es lectura de un archivo, no un render.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// La ruta va en una variable a propósito: el plugin de assets de Vite reescribe
// `new URL('./algo.css', import.meta.url)` con la ruta literal y devuelve una URL http, que
// `readFileSync` rechaza. Con la ruta en una variable el `file://` llega intacto.
const ruta = './app.css';
const appCss = readFileSync(new URL(ruta, import.meta.url), 'utf8');

/** Escapa lo que un selector CSS puede traer y un `RegExp` no puede leer literal (`[`, `]`, `'`…). */
const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cuerpo de la primera regla con ese selector exacto. */
const bloque = (selector: string): string =>
  new RegExp(`${escaparRegex(selector)}\\s*\\{([^}]*)\\}`).exec(appCss)?.[1] ?? '';

/**
 * Como `bloque()`, pero solo cuenta como regla la que empieza su propia línea Y esa línea no es
 * la cola de una lista de selectores: `bloque()` a secas encontraría `.boton.icono` dentro de
 * `.iconos .boton.icono {`, y el `(?<!,)` de aquí hace falta además para no colar `.archivo`
 * dentro de `.proyecto,\n.archivo {`, que sigue siendo un selector compuesto, no la regla suelta.
 */
const bloqueDeLinea = (selector: string): string =>
  new RegExp(`(?<!,)\\n${escaparRegex(selector)}\\s*\\{([^}]*)\\}`).exec(appCss)?.[1] ?? '';

it('la pila de zoom deja libre la esquina de la marca de agua', () => {
  // «Powered by bpmn.io» es obligatoria por la licencia de bpmn.io: es un enlace absoluto a
  // 15 px del borde inferior derecho del lienzo y mide unos 14 px de alto. La pila arranca
  // por encima de esos 15 px y alineada con ella.
  const zoom = bloque('.zoom');
  expect(zoom).toContain('right: 15px');
  expect(Number.parseInt(/bottom:\s*(\d+)px/.exec(zoom)?.[1] ?? '0', 10)).toBeGreaterThanOrEqual(40);
});

it('el minimapa se viste con los tokens del tema y sin radio', () => {
  const minimapa = bloque('.lienzo .djs-minimap');
  expect(minimapa).toContain('var(--canvas-bg)');
  expect(minimapa).toContain('var(--border-strong)');
  expect(minimapa).toContain('border-radius: 0');
  // Abajo a la izquierda, no arriba a la derecha como lo pone el plugin.
  expect(minimapa).toContain('bottom: 14px');
  expect(minimapa).toContain('left: 14px');
  expect(bloque('.lienzo .djs-minimap .viewport-dom')).toContain('var(--accent-primary)');
});

it('«Validar rutas» solo esconde el interruptor propio del módulo, no sus mandos (LILA-065)', () => {
  // El modo se enciende desde la barra superior, así que el botón «Token Simulation» que el
  // módulo inyecta en el lienzo sobra. Lo que NO puede taparse es el resto de su interfaz: la
  // paleta de play/pausa/reiniciar (`.bts-palette`), los botones sobre las figuras que arrancan
  // un token y ponen puntos de parada (`.bts-context-pad`), el registro (`.bts-log`) y sus
  // avisos (`.bts-notifications`). Sin ellos no se puede animar paso a paso, que es la
  // aceptación del ticket.
  expect(bloque('.lienzo .bts-toggle-mode')).toContain('display: none');
  for (const mando of ['bts-palette', 'bts-context-pad', 'bts-log', 'bts-notification', 'bts-token']) {
    const reglas = appCss.match(new RegExp(`[^}]*\\.${mando}[^{]*\\{[^}]*\\}`, 'g')) ?? [];
    expect(reglas.filter((r) => /display:\s*none|visibility:\s*hidden/.test(r))).toEqual([]);
  }
});

it('the scenario toggle is icon-only at every width, like `.boton.icono` (#405)', () => {
  // The label lives only in `aria-label`/`title` (no `<span>` in App.tsx), so the icon is the
  // permanent 30x30 box, with no `@media` step that used to swap text for icon below 1500 px.
  const icono = bloqueDeLinea('.boton.icono');
  expect(icono).toContain('background: var(--bg-elevated)');
  expect(icono).toContain('border: 1px solid var(--border)');
  expect(icono).toContain('color: var(--fg-muted)');
  expect(icono).toContain('height: 30px');
  expect(icono).toContain('width: 30px');
  expect(appCss).not.toContain('@media (max-width: 1500px)');

  // `className="boton icono desacoplar"` (App.tsx, should-fix of #417) gets the box above for
  // free; `.boton.desacoplar` only carries its own pressed state, no base rule that would
  // duplicate `.boton.icono`'s.
  expect(appCss).not.toMatch(/\.boton\.desacoplar\s*\{/);

  const activo = bloque(".boton.desacoplar[aria-pressed='true']");
  expect(activo).toContain('background: var(--bg-hover)');
  expect(activo).toContain('color: var(--fg-primary)');
  expect(activo).toContain('border-color: var(--border-strong)');
});

it('el select, la casilla y la fecha nativos pierden el aspecto del navegador (diseño 2d)', () => {
  const select = bloque('.app select');
  expect(select).toContain('appearance: none');
  expect(select).toContain('border-radius: 0');

  const casilla = bloque(".app input[type='checkbox']");
  expect(casilla).toContain('appearance: none');
  expect(casilla).toContain('border-radius: 0');

  const fecha = bloque(".app input[type='datetime-local']");
  expect(fecha).toContain('border-radius: 0');
  // Sin esto el borde suma 2 px al alto de contenido y el campo sale de 32 px, no 30 como el
  // resto (QA de la ronda 1 de #392).
  expect(fecha).toContain('box-sizing: border-box');
});

it('el glifo del selector de fecha no se invierte por encima de `color-scheme: dark` (QA de la ronda 1 de #392)', () => {
  // `color-scheme: dark` ya hace que el navegador pinte el glifo en claro sobre este control
  // oscuro; invertirlo aquí encima lo devolvía a oscuro sobre oscuro (negro sobre negro en
  // Eva-01/Akira). La regla sigue viva —solo la opacidad—, así que se busca por su selector
  // exacto y se comprueba que no trae ningún `filter`.
  const glifo = bloque("input[type='datetime-local']::-webkit-calendar-picker-indicator");
  expect(glifo).not.toEqual('');
  expect(glifo).not.toContain('filter');
});

it('los modos no se envuelven: son de lo primero que tiene que caber en la barra (QA de la ronda 1 de #392)', () => {
  // Sin esto, «Validate paths»/«Validar rutas» se parte en dos líneas antes de que el buscador
  // inerte —lo único prescindible de la barra— ceda su sitio, y la barra crece de 53 px a 60-67.
  expect(bloque('.modo')).toContain('white-space: nowrap');

  const buscador = bloqueDeLinea('.buscador');
  // Its zone is the bar's spring (#423): basis 0, so it gives way before the brand lockup, and the
  // field inside keeps at least 120 px or wraps out of sight instead of an empty box.
  const zona = bloque('.zona-buscador');
  expect(zona).toContain('flex: 1 1 0');
  expect(zona).toContain('flex-wrap: wrap');
  expect(zona).toContain('justify-content: flex-end');
  expect(zona).toContain('height: 30px');
  expect(zona).toContain('min-width: 0');
  expect(zona).toContain('overflow: hidden');
  const muelle = bloque('.zona-buscador::before');
  expect(muelle).toContain('flex: 1 0 0');
  expect(muelle).toContain('height: 0');
  expect(buscador).toContain('flex: 0 1 210px');
  expect(buscador).toContain('min-width: 120px');
  // And goes away below 1320 px, where even at its minimum it left the Spanish project name short
  // (QA of #393).
  expect(appCss).toMatch(/@media \(max-width: 1320px\) \{\s*\.zona-buscador \{\s*display: none;/);
  // El ancho fijo de antes competía con el `flex` de arriba por quién manda; tiene que quedar
  // solo el `flex`, no los dos.
  expect(buscador).not.toContain('width: 210px');
});

it('el nombre del proyecto y el del archivo se recortan con «…» en vez de desbordar la barra (QA de la ronda 2 de #392)', () => {
  // `.identidad { flex: none }` (ronda 1) evitaba el envuelto, pero le impedía encogerse y sacaba
  // la página por el borde en angosto: `flex: 0 1 auto` es lo que deja que el bloque encoja.
  const identidad = bloque('.identidad');
  expect(identidad).toContain('flex: 0 1 auto');
  expect(identidad).not.toContain('flex: none');
  expect(identidad).not.toContain('flex-shrink: 0');

  const recorte = bloque('.proyecto,\n.archivo');
  expect(recorte).toContain('overflow: hidden');
  expect(recorte).toContain('text-overflow: ellipsis');
  expect(recorte).toContain('white-space: nowrap');
});

it('the identity block stays shrinkable, but never narrower than the file line (#399, QA must-fix of #417)', () => {
  // No more freezing `.identidad` solid above 1320 px (that stopped a long project name from
  // ellipsizing and pushed Run/⚙ out of the window). Instead the text column is a grid, and
  // `.archivo`'s own min-content — its full text, since it can't wrap — sets the column's floor;
  // `.identidad`'s `min-width: min-content` (not 0) carries that floor up through logo and name.
  const identidad = bloque('.identidad');
  expect(identidad).toContain('min-width: min-content');
  expect(identidad).not.toContain('flex-shrink: 0');
  expect(identidad).not.toContain('flex: none');
  expect(appCss).not.toContain('@media (min-width: 1321px)');

  const div = bloque('.identidad > div');
  expect(div).toContain('display: grid');
  expect(div).toContain('min-width: min-content');

  // `.proyecto` is the one that ellipsizes first…
  expect(bloque('.proyecto')).toContain('min-width: 0');
  // …because `.archivo` explicitly claims the column's min-content: `overflow: hidden` (shared
  // with `.proyecto` above) turns a grid item's automatic minimum size to 0, so without this the
  // file line would clip too instead of setting the floor.
  expect(bloqueDeLinea('.archivo')).toContain('min-width: min-content');
});

it('below 1280 px the identity block gives up its file-line floor too, so the bar never overflows (#399, QA must-fix of #417)', () => {
  // At 1024 px in Spanish the file-line floor above still overflowed the bar by 46 px once the
  // search field and the product name were already gone: below 1280 px `.identidad` and
  // `.archivo` both go back to `min-width: 0`, like before #399, and the file line clips too
  // (the owner accepts that at 1024 px, just not the bar overflowing).
  const desdeMedia = appCss.slice(appCss.indexOf('@media (max-width: 1280px)'));
  const cierre = desdeMedia.indexOf('\n}');
  expect(cierre).toBeGreaterThan(0);
  const bloqueMedia = desdeMedia.slice(0, cierre);
  expect(bloqueMedia).toMatch(/\.identidad\s*\{\s*\n\s*min-width: 0;/);
  expect(bloqueMedia).toMatch(/\.archivo\s*\{\s*\n\s*min-width: 0;/);
});

it('the mode tabs give up some padding below 1365 px, not just 1280 (QA of #417)', () => {
  // Measured worst case: default project name, dirty state («Sin guardar»), Spanish, Simulate —
  // with `.identidad` shrinkable again (#399) and the scenario toggle (#405, 30 px, flex: none)
  // in the bar, the bar overflowed by up to 21 px between 1281 and 1303 px, and by up to 13 px
  // between 1321 and 1328 px (the search field reappearing at 1321 px eats the same room back),
  // and by 12 px at 1346 fading to 1 px at 1357 once `.producto` stopped wrapping (round 2).
  // Reverting this to 1280 alone (the QA's mutation test) reproduces the overflows, so the
  // wider threshold is load-bearing and not just the file-line fix's leftover.
  expect(appCss).toMatch(/@media \(max-width: 1365px\) \{\s*\n\s*\.modo \{/);
});

it('the product name never wraps, or the identity floor is computed too low (QA of #417, round 2)', () => {
  expect(bloqueDeLinea('.producto')).toContain('white-space: nowrap');
});

it('el nombre del producto y su regla se callan por debajo de 1280 px, antes de que le toque al proyecto (QA de la ronda 2 de #392)', () => {
  // `bloque()` no sirve aquí: para en la primera `}` que encuentra, y dentro de un `@media` esa
  // es la de la primera regla anidada (`.buscador`), no la del bloque entero. Se toma todo lo que
  // hay entre el `@media (max-width: 1280px)` y su `}` de cierre —sin indentar, a diferencia del
  // de sus reglas anidadas, que sí lo están— y se busca la regla de `.producto` ahí dentro.
  const desdeMedia = appCss.slice(appCss.indexOf('@media (max-width: 1280px)'));
  const cierre = desdeMedia.indexOf('\n}');
  expect(cierre).toBeGreaterThan(0);
  const bloqueMedia = desdeMedia.slice(0, cierre);
  expect(bloqueMedia).toMatch(/\.producto,\s*\n\s*\.identidad \.separador\s*\{\s*\n\s*display: none;/);
});

it('en toda la hoja el radio es 0, salvo el círculo marcado del disco de validación', () => {
  const radios = [...appCss.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim());
  // Si esto falla con algo que no sea «50%» es que una regla nueva volvió a redondear una
  // esquina sin decir por qué (el comentario que acompaña al 50% es el sitio para esa excepción).
  expect(radios.filter((r) => r !== '0')).toEqual(['50%']);
});

it('no select rule uses the `background` shorthand, which would wipe the themed chevron (seam of #391 and #392)', () => {
  // `.app select` (design 2d) draws the arrow as a `background-image`; a later `background: …`
  // on a more specific select rule (the detached window's fields, #391) reset it to none.
  const sinComentarios = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas = [...sinComentarios.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /\bselect\b/.test(m[1]!) && /(^|[;\s])background:/.test(m[2]!))
    .map((m) => m[1]!.trim());
  expect(reglas).toEqual([]);
});

it('text fields of the scenario and properties forms are 30 px like the themed select (QA of #393)', () => {
  // At 22 px a text field sat lower than the select or date beside it in the two-column form.
  expect(bloque(".campo-schema input[type='text']")).toContain('height: 30px');
  const propiedades = bloque(".campos input:not([type='checkbox'])");
  expect(propiedades).toContain('height: 30px');
  expect(propiedades).toContain('box-sizing: border-box');
});
