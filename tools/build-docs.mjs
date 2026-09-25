/**
 * Renders the public Markdown under `docs/` into static HTML at `<site>/docs/`, plus an index,
 * for the GitHub Pages site. Every `.md` in `docs/`, `docs/es/` and `docs/releases/` is published
 * automatically, so a new document needs no HTML edit; add its name to `INTERNAL` to keep it out.
 * `docs/design/**` (captures, comparisons, branding reviews) is never published.
 *
 * Links between published docs become `.html`; any other relative link (source files, internal
 * docs, design notes) points to the file on GitHub, so nothing in the rendered pages 404s.
 *
 * Layout from the Claude Design mock `Docs.dc.html`: grouped sidebar with search, breadcrumb,
 * "On this page" from the h2s, previous/next in sidebar order and a link to the page in the other
 * language. Styles live in `site/site.css`, behaviour in `site/docs.js`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';

export const INTERNAL = new Set(['PAGES.md', 'STABILIZATION-HANDOFF.md', 'DECISIONS-corpus-previo.md']);
const FOLDERS = ['', 'es', 'releases'];
const BLOB = 'https://github.com/AlambritoDito/lila-modeler/blob/main/';

/** Doc paths relative to `docs/`, e.g. `SEMANTICS.md`, `es/SEMANTICS.md`. */
export function listDocs(docsDir) {
  return FOLDERS.flatMap((folder) =>
    readdirSync(path.join(docsDir, folder))
      .filter((name) => name.endsWith('.md') && !INTERNAL.has(name))
      .sort()
      .map((name) => path.posix.join(folder, name)),
  );
}

/** Rewrites a link found in `from` (a doc path relative to `docs/`). */
export function rewriteHref(href, from, published) {
  if (/^([a-z]+:|#|\/)/i.test(href)) return href;
  const [target, hash] = href.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  const anchor = hash === undefined ? '' : `#${hash}`;
  if (published.has(resolved)) {
    const rel = path.posix.relative(path.posix.dirname(from), resolved) || path.posix.basename(resolved);
    return rel.replace(/\.md$/, '.html') + anchor;
  }
  // `docs/` itself sits under the repo root; `../README.md` from `docs/` resolves to `../README.md`.
  return BLOB + path.posix.normalize(path.posix.join('docs', resolved)) + anchor;
}

/** GitHub's heading id: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(markdown, from, published) {
  const slug = slugger();
  const toc = [];
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link' || token.type === 'image') token.href = rewriteHref(token.href, from, published);
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = html.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, (e) =>
          ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[e] ?? '');
        const id = slug(text);
        if (depth === 2) toc.push({ id, text });
        return `<h${depth} id="${id}">${html}</h${depth}>\n`;
      },
    },
  });
  return { html: marked.parse(markdown), toc };
}


const titleOf = (markdown, fallback) => markdown.match(/^#\s+(.+)$/m)?.[1].replace(/`/g, '') ?? fallback;

/** Spanish docs whose file name differs from their English counterpart. */
const ES_ALIAS = { 'ATAJOS.md': 'SHORTCUTS.md', 'GUIA-BETA-MAC.md': 'BETA-MAC-GUIDE.md' };
/** English name of a doc, which is what places it in the sidebar in both languages. */
const canonical = (doc) => { const base = path.posix.basename(doc); return ES_ALIAS[base] ?? base; };

const GROUPS = [
  { en: 'Getting started', es: 'Primeros pasos', docs: ['BETA-MAC-GUIDE.md', 'COMING-FROM-BIZAGI.md'] },
  { en: 'Guides', es: 'Guías', docs: ['THEMES.md', 'SHORTCUTS.md', 'BIZAGI_PARITY.md'] },
  { en: 'Reference', es: 'Referencia', docs: ['SCENARIO_FORMAT.md', 'RESULTS_FORMAT.md', 'PROJECT_FORMAT.md', 'SEMANTICS.md', 'BPMN_EXTENSION.md'] },
  { en: 'Integrations', es: 'Integraciones', docs: ['MCP.md', 'ORACLES.md'] },
  { en: 'Project', es: 'Proyecto', docs: ['DECISIONS.md', 'EXAMPLES_POLICY.md', 'BRANDING.md'] },
];
const LABELS = {
  'BETA-MAC-GUIDE.md': ['Desktop beta (macOS)', 'Beta de escritorio (macOS)'], 'COMING-FROM-BIZAGI.md': ['Coming from Bizagi', 'Si vienes de Bizagi'],
  'THEMES.md': ['Themes', 'Temas'], 'SHORTCUTS.md': ['Keyboard shortcuts', 'Atajos de teclado'], 'BIZAGI_PARITY.md': ['Bizagi parity', 'Paridad con Bizagi'],
  'SCENARIO_FORMAT.md': ['Scenario format', 'Formato de escenario'], 'RESULTS_FORMAT.md': ['Results format', 'Formato de resultados'],
  'PROJECT_FORMAT.md': ['Project format', 'Formato de proyecto'], 'SEMANTICS.md': ['Engine semantics', 'Semántica del motor'],
  'BPMN_EXTENSION.md': ['BPMN extension', 'Extensión BPMN'], 'MCP.md': ['MCP server', 'Servidor MCP'], 'ORACLES.md': ['Oracles', 'Oráculos'],
  'DECISIONS.md': ['Architecture decisions', 'Decisiones de arquitectura'], 'EXAMPLES_POLICY.md': ['Examples policy', 'Política de ejemplos'],
  'BRANDING.md': ['Branding', 'Branding'],
};
const T = {
  en: { start: 'Start here', intro: 'Introduction', demo: 'Try the demo', more: 'More', releases: 'Releases', reference: 'Reference', search: 'Search docs', menu: 'Menu', prev: 'Previous', next: 'Next', edit: 'Edit this page', targets: 'Targets', onPage: 'On this page', other: 'ES', otherTitle: 'Leer en español' },
  es: { start: 'Empieza aquí', intro: 'Introducción', demo: 'Probar la demo', more: 'Más', releases: 'Versiones', reference: 'Referencia', search: 'Buscar en la documentación', menu: 'Menú', prev: 'Anterior', next: 'Siguiente', edit: 'Editar esta página', targets: 'Para', onPage: 'En esta página', other: 'EN', otherTitle: 'Read in English' },
};

/**
 * The sidebar of one language: groups of `{ doc, label }`, where `doc` is relative to `docs/`
 * (`index` stands for that language's introduction page). Its flattened order is prev/next.
 */
export function sidebar(docs, lang, titles = {}) {
  const mine = docs.filter((d) => (lang === 'es' ? d.startsWith('es/') : !d.includes('/')));
  const label = (d) => LABELS[canonical(d)]?.[lang === 'es' ? 1 : 0] ?? titles[d] ?? path.posix.basename(d, '.md');
  const used = new Set();
  const groups = [{ title: T[lang].start, items: [{ doc: lang === 'es' ? 'es/index' : 'index', label: T[lang].intro }] }];
  for (const g of GROUPS) {
    const items = g.docs.flatMap((name) => mine.filter((d) => canonical(d) === name)).map((d) => (used.add(d), { doc: d, label: label(d) }));
    if (items.length) groups.push({ title: g[lang], items });
  }
  const rest = mine.filter((d) => !used.has(d));
  if (rest.length) groups.push({ title: T[lang].more, items: rest.map((d) => ({ doc: d, label: label(d) })) });
  const releases = docs.filter((d) => d.startsWith('releases/'));
  if (releases.length) groups.push({ title: T[lang].releases, items: releases.map((d) => ({ doc: d, label: path.posix.basename(d, '.md') })) });
  return groups;
}

/** The same page in the other language, or that language's introduction. */
export function counterpart(doc, published) {
  if (doc === 'index') return 'es/index';
  if (doc === 'es/index') return 'index';
  if (doc.startsWith('es/')) { const en = canonical(doc); return published.has(en) ? en : 'index'; }
  if (doc.startsWith('releases/')) return 'es/index';
  const alias = Object.keys(ES_ALIAS).find((k) => ES_ALIAS[k] === doc) ?? doc;
  return published.has(`es/${alias}`) ? `es/${alias}` : 'es/index';
}

const INTRO = {
  en: {
    lead: 'Lila Modeler is an open-source discrete-event simulator and modeler for BPMN processes. Draw the process, describe a scenario, run it with replications, and compare the result against an alternative — all on your own machine.',
    givesH: 'What Lila gives you',
    gives: [['One engine, everywhere.', 'Browser, desktop, CLI and MCP share the same dependency-free core, so results match.'], ["Bizagi's workflow, open.", 'Validation, time, resources and calendars as four steps; result tables in the layout Bizagi users already read.'], ['Numbers you can defend.', 'Seeded replications with 95% confidence intervals, not a single run.'], ['Plain files.', 'A project is a folder; scenarios are JSON; a .lila file is that folder zipped.']],
    overviewH: 'Feature overview',
    features: [['Model', 'bpmn-js editor: events, timers, tasks, call activities, subprocesses, XOR/OR/AND gateways, lanes and pools'], ['Simulate', 'Four steps — validation, time, resources, calendars; 13 BPSim distributions'], ['Results', 'Process, element, resource and flow tables; bottlenecks, percentiles, cost per case'], ['Animate', 'Replay of the event log over the diagram, from 1× to instant'], ['Compare', 'Side-by-side scenarios with deltas significant at 95%'], ['Export', 'JSON, CSV and multi-sheet XLSX'], ['Interfaces', 'Web, desktop (Electron), CLI and MCP server']],
    qsH: 'Quick start', qsP: 'Simulate <code>examples/pedido</code> — a restaurant process with a parallel branch, an approval and a timer — from a fresh clone. Node 22 and npm are all you need.',
    steps: ['Clone and build', 'Validate the model', 'Simulate the AS-IS scenario', 'Compare against TO-BE'],
    note: 'Lila is not published to npm — the <code>lila</code> package on the registry is unrelated. Inside the checkout, <code>npx</code> resolves the workspace\'s own binary.',
    nextH: 'Next steps', next: [['COMING-FROM-BIZAGI.md', 'Where each Bizagi screen and field lives here.'], ['SCENARIO_FORMAT.md', 'Arrivals, times, pools and calendars as JSON.'], ['BETA-MAC-GUIDE.md', 'Install the unsigned macOS beta.']],
  },
  es: {
    lead: 'Lila Modeler es un simulador de eventos discretos y modelador de procesos BPMN, de código abierto. Dibuja el proceso, describe un escenario, córrelo con replicaciones y compara el resultado contra una alternativa — todo en tu propia máquina.',
    givesH: 'Qué te da Lila',
    gives: [['Un motor, en todas partes.', 'Navegador, escritorio, CLI y MCP comparten el mismo núcleo sin dependencias, así que los resultados coinciden.'], ['El flujo de Bizagi, abierto.', 'Validación, tiempo, recursos y calendarios en cuatro pasos; tablas de resultados con el formato que ya leen los usuarios de Bizagi.'], ['Números defendibles.', 'Replicaciones con semilla e intervalos de confianza al 95%, no una sola corrida.'], ['Archivos planos.', 'Un proyecto es una carpeta; los escenarios son JSON; un archivo .lila es esa carpeta comprimida.']],
    overviewH: 'Resumen de funciones',
    features: [['Modelar', 'Editor bpmn-js: eventos, temporizadores, tareas, actividades de llamada, subprocesos, compuertas XOR/OR/AND, carriles y pools'], ['Simular', 'Cuatro pasos — validación, tiempo, recursos, calendarios; 13 distribuciones BPSim'], ['Resultados', 'Tablas de proceso, elementos, recursos y flujos; cuellos de botella, percentiles, costo por caso'], ['Animar', 'Reproducción del log de eventos sobre el diagrama, de 1× a instantáneo'], ['Comparar', 'Escenarios lado a lado con diferencias significativas al 95%'], ['Exportar', 'JSON, CSV y XLSX de varias hojas'], ['Interfaces', 'Web, escritorio (Electron), CLI y servidor MCP']],
    qsH: 'Inicio rápido', qsP: 'Simula <code>examples/pedido</code> — un proceso de restaurante con una rama paralela, una aprobación y un temporizador — desde un clon limpio. Solo necesitas Node 22 y npm.',
    steps: ['Clonar y compilar', 'Validar el modelo', 'Simular el escenario AS-IS', 'Comparar contra TO-BE'],
    note: 'Lila no está publicado en npm — el paquete <code>lila</code> del registro es otro proyecto. Dentro del checkout, <code>npx</code> resuelve el binario del propio workspace.',
    nextH: 'Siguientes pasos', next: [['es/COMING-FROM-BIZAGI.md', 'Dónde vive aquí cada pantalla y campo de Bizagi.'], ['es/SCENARIO_FORMAT.md', 'Llegadas, tiempos, pools y calendarios en JSON.'], ['es/GUIA-BETA-MAC.md', 'Instala la beta de macOS sin firmar.']],
  },
};
const STEP_CODE = [
  'git clone https://github.com/AlambritoDito/lila-modeler.git\ncd lila-modeler\nnpm ci &amp;&amp; npm run build',
  'npx lila validate examples/pedido/model.bpmn',
  'npx lila run \\\n  examples/pedido/model.bpmn examples/pedido/as-is.scenario.json \\\n  --seed 42 --replications 30 \\\n  --json out/result.json --csv out/csv',
  'npx lila compare \\\n  examples/pedido/model.bpmn \\\n  examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json \\\n  --seed 42 --replications 30',
];

function introBody(lang, published, titles) {
  const t = INTRO[lang];
  const href = (d) => path.posix.relative(lang === 'es' ? 'es' : '.', d).replace(/\.md$/, '.html');
  const next = t.next.filter(([d]) => published.has(d))
    .map(([d, text]) => `<a href="${href(d)}"><b>${escapeHtml(LABELS[canonical(d)]?.[lang === 'es' ? 1 : 0] ?? titles[d])} →</b><span>${text}</span></a>`).join('\n');
  const toc = [t.givesH, t.overviewH, t.qsH, t.nextH].map((text, i) => ({ id: ['gives', 'overview', 'quick-start', 'next'][i], text }));
  const html = `<h1>${T[lang].intro}</h1>
<p class="lead">${t.lead}</p>
<h2 id="gives">${t.givesH}</h2>
<ul>${t.gives.map(([b, x]) => `<li><b>${b}</b> ${x}</li>`).join('')}</ul>
<h2 id="overview">${t.overviewH}</h2>
<table><tbody>${t.features.map(([a, w]) => `<tr><th>${a}</th><td>${w}</td></tr>`).join('')}</tbody></table>
<h2 id="quick-start">${t.qsH}</h2>
<p>${t.qsP}</p>
${t.steps.map((s, i) => `<h3>${i + 1}. ${s}</h3>\n<pre><code>${STEP_CODE[i]}</code></pre>`).join('\n')}
<blockquote><p>${t.note}</p></blockquote>
<h2 id="next">${t.nextH}</h2>
<div class="cards">${next}</div>`;
  return { html, toc };
}

function page({ doc, title, lang, html, toc, groups, published, version }) {
  const dir = path.posix.dirname(doc);
  const up = '../'.repeat(dir === '.' ? 1 : 2);
  const rel = (d) => (path.posix.relative(dir, d) || path.posix.basename(d)).replace(/\.md$/, '') + '.html';
  const t = T[lang];
  const flat = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.title })));
  const i = flat.findIndex((it) => it.doc === doc);
  const [prev, next] = [flat[i - 1], flat[i + 1]];
  const other = counterpart(doc, published);
  const side = groups.map((g) => `<details open><summary>${escapeHtml(g.title)}</summary><ul>
${g.items.map((it) => `<li><a href="${rel(it.doc)}"${it.doc === doc ? ' aria-current="page"' : ''}>${escapeHtml(it.label)}</a></li>`).join('\n')}
</ul></details>`).join('\n');
  const source = doc.endsWith('index') ? 'tools/build-docs.mjs' : `docs/${doc}`;
  return `<!doctype html>
<!-- Generated by tools/build-docs.mjs from docs/. Edit the Markdown, not this file. -->
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — Lila Modeler</title>
    <meta name="color-scheme" content="light dark" />
    <link rel="stylesheet" href="${up}site.css" />
    <link rel="icon" href="${up}branding/favicon.ico" sizes="any" />
    <script src="${up}docs.js" defer></script>
  </head>
  <body>
    <header class="top docs-top">
      <div class="wrap top-row">
        <a class="brand" href="${up}"><img src="${up}branding/lila-transparent.png" alt="" width="28" height="28" /> Lila Modeler</a>
        <nav class="nav" aria-label="Docs">
          <a class="on" href="${rel(lang === 'es' ? 'es/index' : 'index')}">Docs</a>
          <a href="${rel(lang === 'es' && published.has('es/SCENARIO_FORMAT.md') ? 'es/SCENARIO_FORMAT.md' : 'SCENARIO_FORMAT.md')}">${t.reference}</a>
          <a href="https://github.com/AlambritoDito/lila-modeler/blob/main/CHANGELOG.md">Changelog</a>
        </nav>
        <label class="search"><span class="mono">/</span><input id="doc-search" type="search" placeholder="${t.search}" aria-label="${t.search}" /><kbd>⌘K</kbd></label>
        <span class="ver">v${version}</span>
        <a class="chip" href="${rel(other)}" hreflang="${lang === 'es' ? 'en' : 'es'}" title="${t.otherTitle}">${t.other}</a>
        <a class="btn btn-sm" href="https://github.com/AlambritoDito/lila-modeler">GitHub</a>
      </div>
      <button class="drawer-btn" id="drawer-btn" type="button" aria-expanded="false"><span>☰</span><span>${escapeHtml(title)}</span><span style="margin-left:auto;font-size:12px;color:var(--fg-disabled)">${t.menu}</span></button>
    </header>
    <div class="docs-grid">
      <aside class="side" aria-label="Docs">
${side}
        <ul><li><a href="${up}app/">${t.demo} <small>↗</small></a></li></ul>
      </aside>
      <main class="doc-main">
        <article class="doc">
          <div class="crumb"><span>Docs</span><span>›</span><span>${escapeHtml(flat[i]?.group ?? '')}</span><span>›</span><span>${escapeHtml(flat[i]?.label ?? title)}</span></div>
${html}
          <nav class="pager">
            ${prev ? `<a href="${rel(prev.doc)}"><span>${t.prev}</span><b>« ${escapeHtml(prev.label)}</b></a>` : ''}
            ${next ? `<a class="next" href="${rel(next.doc)}"><span>${t.next}</span><b>${escapeHtml(next.label)} »</b></a>` : ''}
          </nav>
          <div class="doc-foot"><a href="https://github.com/AlambritoDito/lila-modeler/blob/main/${source}">✎ ${t.edit}</a><span>${t.targets} v${version}</span></div>
        </article>
      </main>
      <aside class="toc" aria-label="${t.onPage}">
        ${toc.length ? `<div class="h">${t.onPage}</div><nav>${toc.map((h) => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`).join('')}</nav>` : ''}
      </aside>
    </div>
  </body>
</html>
`;
}

export function buildDocs(root, siteDir) {
  const docsDir = path.join(root, 'docs');
  const version = JSON.parse(readFileSync(path.join(root, 'apps/web/package.json'), 'utf8')).version;
  const docs = listDocs(docsDir);
  const published = new Set(docs);
  const sources = new Map(docs.map((doc) => [doc, readFileSync(path.join(docsDir, doc), 'utf8')]));
  const titles = Object.fromEntries(docs.map((doc) => [doc, titleOf(sources.get(doc), path.posix.basename(doc, '.md'))]));
  const groups = { en: sidebar(docs, 'en', titles), es: sidebar(docs, 'es', titles) };
  const langOf = (doc) => (doc.startsWith('es/') ? 'es' : 'en');
  const write = (doc, title, lang, body) => {
    const out = path.join(siteDir, 'docs', `${doc.replace(/\.md$/, '')}.html`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, page({ doc, title, lang, ...body, groups: groups[lang], published, version }));
  };
  const entries = docs.map((doc) => {
    write(doc, titles[doc], langOf(doc), render(sources.get(doc), doc, published));
    return { doc, title: titles[doc] };
  });
  write('index', T.en.intro, 'en', introBody('en', published, titles));
  write('es/index', T.es.intro, 'es', introBody('es', published, titles));
  return entries;
}
