/*
 * Behaviour of the landing page (site/index.html), ported from the Claude Design mock
 * `Landing.dc.html`: the live replay in the hero, the replication histogram, the KPI bars, the
 * typing terminal, the screenshot switcher, the mobile menu and the English/Spanish toggle.
 * The page reads fine without it. Colours come from the CSS tokens (Lila Light / Lila Dark).
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const LANG_KEY = 'lila-landing-lang';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Spanish strings; the English ones are the page's own markup, captured at load.
  const ES = {
    nav1: 'Capacidades', nav2: 'Cómo corre', nav3: 'Comparar', nav4: 'Inicio rápido', nav5: 'Pantallas',
    badge: 'Beta de escritorio para macOS · Novedades →',
    h1: 'Mira tu proceso <span class="hl">correr</span> antes de que corra.',
    lede: 'Simulador de eventos discretos para BPMN, de código abierto. Dibuja el proceso, define tiempos, recursos y calendarios, y reproduce cada caso sobre el diagrama — con <strong>comparaciones AS-IS vs TO-BE al 95% de confianza</strong>. Sin cuenta, sin servidor.',
    ctaDemo: 'Probar la demo', ctaQuick: 'Inicio rápido', ctaBizagi: '¿Vienes de Bizagi?',
    tagPlatforms: 'Navegador · Escritorio · CLI · MCP', tagSeeded: 'Con semilla y reproducible',
    live: 'Reproducción en vivo', hudClock: 'Reloj', hudDone: 'Completados', hudCycle: 'Ciclo prom.', speed: 'Velocidad',
    lgToken: 'Token de caso', lgWait: 'Esperando un recurso', lgBusy: 'Recurso ocupado', lgCount: 'completados / iniciados', swipe: 'desliza el diagrama',
    capH: 'Un motor, cuatro entradas.', capP: 'El núcleo no tiene dependencias, así que los números son idénticos desde una pestaña del navegador, una terminal o un agente.',
    c1: 'Modelar', c1l: '<li>Editor BPMN sobre bpmn-js</li><li>Compuertas XOR / OR / AND</li><li>Temporizadores, subprocesos, carriles</li><li>Validación sobre el diagrama</li>',
    c2: 'Simular', c2l: '<li>Los cuatro niveles de Bizagi, como pasos</li><li>13 distribuciones BPSim</li><li>Pools de recursos con costos</li><li>Calendarios de turnos semanales</li>',
    c3: 'Analizar', c3l: '<li>Tablas de resultados estilo Bizagi</li><li>Cuellos de botella ordenados</li><li>Reproducción sobre el diagrama</li><li>Exporta a CSV y XLSX</li>',
    c4: 'Integrar', c4l: '<li>lila run / compare para CI</li><li>Servidor MCP, cinco herramientas</li><li>Proyectos .lila portables</li><li>Escenarios en JSON plano</li>',
    runH: 'No un número de suerte. Treinta replicaciones.', runP: 'Cada corrida lleva semilla y se replica. Cada replicación cae en la distribución y el intervalo de confianza se estrecha — misma semilla, misma respuesta, siempre.',
    levels: '<li><span class="k">L1</span><span><b>Validación</b><span class="d"> — todo camino llega a un fin</span></span></li><li><span class="k">L2</span><span><b>Tiempo</b><span class="d"> — llegadas y tiempos de proceso</span></span></li><li><span class="k">L3</span><span><b>Recursos</b><span class="d"> — pools, capacidad, costo</span></span></li><li><span class="k">L4</span><span><b>Calendarios</b><span class="d"> — turnos semanales</span></span></li>',
    repTitle: 'Tiempo de ciclo · min', repMean: 'media', repCi: 'IC 95%',
    cmpH: 'AS-IS vs TO-BE, sin el ruido.', cmpP: 'Pon escenarios lado a lado. Las diferencias significativas al 95% llevan marca; en las demás no conviene apostar.',
    cashiers: '3 cajeros', sigHead: 'significativa', yes: '● sí', no: '○ no',
    k1: 'Tiempo de ciclo', k2: 'Cola en Tomar pedido', k3: 'Uso de cajeros', k4: 'Costo por caso',
    illus: 'Cifras ilustrativas · corre lila compare sobre examples/pedido para las reales.',
    qsH: 'Tres comandos hasta un benchmark.', qsP: 'Clona, npm ci &amp;&amp; npm run build, y luego valida, corre y compara el ejemplo del restaurante. O dale el mismo motor a un agente por MCP.',
    qsWeb: 'Abre la demo en tu navegador', qsMac: 'Descarga la beta de escritorio (Apple Silicon, sin firmar)', qsDocs: 'Lee la documentación',
    scH: 'Modela. Simula. Reproduce. Decide.',
    s1: 'Modelar', s2: 'Simular', s3: 'Animar', s4: 'Resultados', s5: 'Comparar',
    faqH: 'Preguntas, resueltas.',
    q1: '¿Lila Modeler es gratis?', a1: 'Sí. Apache-2.0, sin cuenta, sin plan de pago. El mismo motor corre en el navegador, la app de escritorio, la CLI y el servidor MCP.',
    q2: '¿Dónde vive mi trabajo?', a2: 'En el almacenamiento local del navegador mientras trabajas — eso no es un respaldo. Archivo ▸ Guardar descarga el proyecto completo como un archivo .lila portable.',
    q3: '¿Necesito Bizagi?', a3: 'No. Lila sigue el mismo flujo de cuatro niveles y el formato de tablas para que los usuarios de Bizagi se sientan en casa, pero es totalmente independiente.',
    q4: '¿Pueden dos personas editar el mismo proyecto?', a4: 'No a la vez. Compartir es pasar un archivo .lila; no hay backend ni sincronización en tiempo real.',
    q5: '¿Qué plataformas soporta?', a5: 'Cualquier navegador de escritorio moderno para la app web. La beta de escritorio es para macOS en Apple Silicon y no está firmada ni notarizada — ve la guía de la beta para el primer arranque, y no desactives Gatekeeper.',
    ftLicense: 'Software libre bajo Apache-2.0. © Perfer Process.', ftRes: 'Recursos', ftDocs: 'Documentación', ftSem: 'Semántica del motor', ftMcp: 'Servidor MCP', ftBeta: 'Guía de la beta de escritorio', ftProj: 'Proyecto',
    ftTm: 'Bizagi y Bizagi Modeler son marcas de Bizagi. Lila Modeler es independiente y no está afiliado ni respaldado por Bizagi. El editor usa bpmn-js (MIT), cuya licencia mantiene visible la marca “Powered by bpmn.io” en el lienzo.',
  };
  const SHOTS = {
    en: ['Model — the bpmn-js editor with palette, properties and validation marked on the elements.', 'Simulate — run settings, times, resource pools and calendars, in the order Bizagi users know.', 'Animate — the event log replayed over the diagram, with live counters and pool occupancy.', 'Results — Bizagi-style tables, ranked bottlenecks, CSV and XLSX export.', 'Compare — per-metric deltas with a marker on differences significant at 95%.'],
    es: ['Modelar — el editor bpmn-js con paleta, propiedades y validación marcada en los elementos.', 'Simular — ajustes de corrida, tiempos, pools de recursos y calendarios, en el orden que conocen los usuarios de Bizagi.', 'Animar — el log de eventos reproducido sobre el diagrama, con contadores en vivo y ocupación de pools.', 'Resultados — tablas estilo Bizagi, cuellos de botella, exportación CSV y XLSX.', 'Comparar — diferencias por métrica con marca en las significativas al 95%.'],
  };
  const NODES = {
    en: { start: 'Order received', take: 'Take order', prep: 'Prepare food', pack: 'Pack order', review: 'Review order', xor: 'Approved?', ok: 'Delivered', rej: 'Rejected' },
    es: { start: 'Pedido recibido', take: 'Tomar pedido', prep: 'Preparar comida', pack: 'Empacar pedido', review: 'Revisar pedido', xor: '¿Aprobado?', ok: 'Entregado', rej: 'Rechazado' },
  };
  // Abridged from the real output of `lila compare` on examples/pedido (seed 42, 30 replications).
  const TERM = {
    cli: (es) => [
      ['', '$ npx lila validate examples/pedido/model.bpmn'],
      ['mut', 'Process Process_Restaurante (Restaurant)'],
      ['ok', 'Nodes (11): and 2, end 2, start 1, task 4, timer 1, xor 1'],
      ['', ' '],
      ['', '$ npx lila compare examples/pedido/model.bpmn \\'],
      ['', '    as-is.scenario.json to-be-3-cajeros.scenario.json --seed 42 --replications 30'],
      ['mut', es ? '  AS-IS (base)  vs  TO-BE 3 cajeros · 30 replicaciones' : '  AS-IS (base)  vs  TO-BE 3 cashiers · 30 replications'],
      ['ok', es ? '  Tomar pedido   espera por recurso   0.249 → 0.036 min  (−85%)*' : '  Take order     wait for resource    0.249 → 0.036 min  (−85%)*'],
      ['ok', es ? '  Tomar pedido   largo de cola        0.054 → 0.006      (−89%)*' : '  Take order     queue length         0.054 → 0.006      (−89%)*'],
      ['warn', es ? '  horno: la cola crece sin estabilizarse (λ/μ·c ≈ 2.0)' : '  horno: the queue grows without settling (λ/μ·c ≈ 2.0)'],
      ['dim', es ? '  * diferencia significativa (IC 95% sin traslape)' : '  * significant difference (95% CI without overlap)'],
    ],
    mcp: (es) => [
      ['', '$ npx lila mcp'],
      ['ok', es ? '  servidor MCP en stdio · 5 herramientas' : '  MCP server on stdio · 5 tools'],
      ['mut', '  › validate_bpmn'],
      ['mut', '  › describe_process'],
      ['mut', '  › run_simulation'],
      ['mut', '  › compare_scenarios'],
      ['mut', '  › patch_scenario'],
      ['', ' '],
      ['dim', (es ? '← agente' : '← agent') + ': run_simulation { seed: 42, replications: 30 }'],
      ['ok', es ? '→ ok · mismos números que la CLI y la app' : '→ ok · the same numbers as the CLI and the app'],
    ],
  };

  let lang = null;
  try { const s = localStorage.getItem(LANG_KEY); if (s === 'en' || s === 'es') lang = s; } catch {}
  if (!lang) for (const l of navigator.languages || [navigator.language || '']) {
    const b = String(l).toLowerCase().slice(0, 2); if (b === 'es' || b === 'en') { lang = b; break; }
  }
  lang ||= 'en';

  // --- Language ------------------------------------------------------------------------------
  const i18nEls = [...document.querySelectorAll('[data-i18n]')];
  i18nEls.forEach((el) => { el.dataset.en = el.innerHTML; });
  let shot = 0, tab = 'cli', term = 0;
  function applyLang() {
    document.documentElement.lang = lang;
    i18nEls.forEach((el) => { el.innerHTML = lang === 'es' ? ES[el.dataset.i18n] ?? el.dataset.en : el.dataset.en; });
    $('#lang').textContent = lang === 'es' ? 'EN' : 'ES';
    $('#shot-cap').textContent = SHOTS[lang][shot];
    $('#shot-img').alt = SHOTS[lang][shot];
    term = reduce ? 99 : 0; drawTerm();
  }
  $('#lang').addEventListener('click', () => {
    lang = lang === 'es' ? 'en' : 'es';
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
    applyLang();
  });

  // --- Menu ----------------------------------------------------------------------------------
  const bar = $('#top-bar'), menuBtn = $('#menu-btn');
  const setMenu = (open) => { bar.classList.toggle('open', open); menuBtn.textContent = open ? '✕' : '☰'; menuBtn.setAttribute('aria-expanded', open); };
  menuBtn.addEventListener('click', () => setMenu(!bar.classList.contains('open')));
  bar.querySelectorAll('.menu a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  // --- Screens -------------------------------------------------------------------------------
  const pills = [...document.querySelectorAll('#pills button')];
  pills.forEach((b, i) => b.addEventListener('click', () => {
    shot = i;
    pills.forEach((p, j) => p.setAttribute('aria-pressed', j === i));
    $('#shot-img').src = `img/${b.dataset.shot}.png`;
    $('#shot-cap').textContent = $('#shot-img').alt = SHOTS[lang][i];
  }));

  // --- Terminal ------------------------------------------------------------------------------
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function drawTerm() {
    const lines = TERM[tab](lang === 'es');
    $('#term').innerHTML = lines.slice(0, term).map(([c, t]) => `<span class="${c}">${esc(t)}</span>`).join('\n') +
      (term >= lines.length ? '\n' : '') + '<span class="caret"></span>';
  }
  document.querySelectorAll('.term .tabs button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab; term = reduce ? 99 : 0;
    document.querySelectorAll('.term .tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    drawTerm();
  }));

  // --- Hero glow: follows the pointer (mouse, pen or finger) and returns to its spot on leave ---
  const hero = $('.hero');
  const point = (e) => {
    const r = hero.getBoundingClientRect(), x = `${e.clientX - r.left}px`, y = `${e.clientY - r.top}px`;
    hero.classList.add('pointing');
    hero.style.setProperty('--gx', x); hero.style.setProperty('--gy', y);
    hero.style.setProperty('--px', x); hero.style.setProperty('--py', y);
  };
  const leave = () => { hero.classList.remove('pointing'); hero.style.removeProperty('--gx'); hero.style.removeProperty('--gy'); };
  hero.addEventListener('pointermove', point);
  hero.addEventListener('pointerdown', point);
  hero.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leave(); });
  // A finger lifts (or starts scrolling) right away: let the glow linger where it was touched.
  let linger;
  const later = (e) => { if (e.pointerType !== 'mouse') { clearTimeout(linger); linger = setTimeout(leave, 1400); } };
  hero.addEventListener('pointerup', later);
  hero.addEventListener('pointercancel', later);

  // --- KPI bars: grow when the section scrolls into view --------------------------------------
  new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { $('#kpis').classList.add('on'); o.disconnect(); } }, { threshold: 0.3 }).observe($('#kpis'));

  // --- Theme tokens for the canvases ---------------------------------------------------------
  let C;
  const readTokens = () => {
    const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
    const hex = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    C = { acc: v('--accent-primary'), accRgb: hex(v('--accent-primary')), warn: v('--status-warning'), warnRgb: hex(v('--status-warning')),
      surface: v('--bg-surface'), border: v('--border'), grid: v('--canvas-grid'), fg: v('--fg-primary'), muted: v('--fg-muted'), dim: v('--fg-disabled'),
      dark: matchMedia('(prefers-color-scheme: dark)').matches };
  };
  readTokens();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTokens);
  const rgba = (rgb, a) => `rgba(${rgb},${a})`;

  // --- Hero: a small token simulation of examples/pedido ---------------------------------------
  const expo = (m) => -Math.log(1 - Math.random()) * m;
  const norm = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let speed = 1;
  const N = {
    start: { k: 'start', x: 60, y: 200 }, take: { k: 'task', x: 170, y: 200, cap: 2, mean: 1.4 }, and1: { k: 'and', x: 290, y: 200 },
    prep: { k: 'task', x: 410, y: 110, cap: 3, mean: 3.6 }, pack: { k: 'task', x: 410, y: 290, cap: 1, mean: 1.25 }, and2: { k: 'and', x: 530, y: 200 },
    review: { k: 'task', x: 650, y: 200, cap: 1, mean: 0.95 }, xor: { k: 'xor', x: 770, y: 200 }, ok: { k: 'end', x: 910, y: 200 }, rej: { k: 'end', x: 910, y: 320 },
  };
  Object.entries(N).forEach(([id, n]) => Object.assign(n, { id, started: 0, done: 0, busy: 0, queue: [], flash: 0 }));
  const E = [
    ['start', 'take', [[74, 200], [115, 200]]], ['take', 'and1', [[225, 200], [272, 200]]],
    ['and1', 'prep', [[290, 182], [290, 110], [355, 110]]], ['and1', 'pack', [[290, 218], [290, 290], [355, 290]]],
    ['prep', 'and2', [[465, 110], [530, 110], [530, 182]]], ['pack', 'and2', [[465, 290], [530, 290], [530, 218]]],
    ['and2', 'review', [[548, 200], [595, 200]]], ['review', 'xor', [[705, 200], [752, 200]]],
    ['xor', 'ok', [[788, 200], [896, 200]]], ['xor', 'rej', [[770, 218], [770, 320], [896, 320]]],
  ].map(([from, to, pts]) => {
    const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    return { from, to, pts, seg, len: seg.reduce((a, b) => a + b, 0), pulse: 0 };
  });
  const out = {}; E.forEach((e, i) => (out[e.from] ||= []).push(i));
  const S = { tokens: [], next: 0.2, t: 0, cases: {}, cid: 0, cycles: [], doneCount: 0 };

  const spawn = (ei, cid, rej) => { E[ei].pulse = 1; S.tokens.push({ e: ei, d: 0, cid, rej, trail: [], state: 'move' }); };
  const pos = (e, d) => {
    let r = d;
    for (let i = 0; i < e.seg.length; i++) {
      if (r <= e.seg[i] || i === e.seg.length - 1) { const a = e.pts[i], b = e.pts[i + 1], f = Math.min(1, r / e.seg[i]); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      r -= e.seg[i];
    }
  };
  const startWork = (tok, n) => { n.busy++; tok.state = 'work'; tok.node = n; tok.until = S.t + expo(n.mean); };
  function arrive(tok, key) {
    const n = N[key]; tok.dead = true;
    if (n.k === 'task') {
      n.started++; tok.dead = false; tok.key = key;
      if (n.busy < n.cap) startWork(tok, n); else { tok.state = 'queue'; n.queue.push(tok); }
    } else if (key === 'and1') out.and1.forEach((ei) => spawn(ei, tok.cid));
    else if (n.k === 'and') { const c = S.cases[tok.cid]; c.j = (c.j || 0) + 1; if (c.j === 2) spawn(out.and2[0], tok.cid); }
    else if (n.k === 'xor') { const r = Math.random() < 0.82; spawn(out.xor[r ? 0 : 1], tok.cid, !r); }
    else if (n.k === 'end') {
      n.done++; n.flash = 1; S.doneCount++;
      S.cycles.push(S.t - S.cases[tok.cid].t0); if (S.cycles.length > 60) S.cycles.shift();
      delete S.cases[tok.cid];
    }
  }
  function stepHero(dt) {
    S.t += dt; S.next -= dt;
    if (S.next <= 0) { S.next = expo(1.15); const cid = ++S.cid; S.cases[cid] = { t0: S.t }; N.start.flash = 1; spawn(out.start[0], cid); }
    S.tokens.forEach((tok) => {
      if (tok.state === 'move') {
        const e = E[tok.e]; tok.d += 150 * dt;
        tok.trail.push(pos(e, Math.min(tok.d, e.len))); if (tok.trail.length > 14) tok.trail.shift();
        if (tok.d >= e.len) arrive(tok, e.to);
      } else if (tok.state === 'work' && S.t >= tok.until) {
        const n = tok.node; n.busy--; n.done++; n.flash = 1;
        tok.state = 'move'; tok.trail = []; tok.e = out[tok.key][0]; tok.d = 0; E[tok.e].pulse = 1;
        if (n.queue.length) startWork(n.queue.shift(), n);
      }
    });
    S.tokens = S.tokens.filter((t) => !t.dead);
    Object.values(N).forEach((n) => { n.flash = Math.max(0, n.flash - dt * 2.5); });
    E.forEach((e) => { e.pulse = Math.max(0, e.pulse - dt * 1.5); });
  }
  for (let i = 0; i < 260; i++) stepHero(0.05);

  function fit(c, W, H) {
    const dpr = devicePixelRatio || 1, cw = c.clientWidth;
    if (!cw) return null;
    if (c._w !== cw) { c._w = cw; c.width = cw * dpr; c.height = (cw * H / W) * dpr; }
    const ctx = c.getContext('2d'), s = (cw / W) * dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0); ctx.clearRect(0, 0, W, H); return ctx;
  }
  const dots = (ctx, W, H) => { ctx.fillStyle = C.grid; for (let x = 10; x < W; x += 20) for (let y = 10; y < H; y += 20) ctx.fillRect(x, y, 1.5, 1.5); };
  const MONO = '"JetBrains Mono", ui-monospace, monospace', UI = 'Archivo, system-ui, sans-serif';

  function drawHero() {
    const c = $('#hero-canvas'), ctx = fit(c, 1000, 400); if (!ctx) return;
    const t = S.t, L = NODES[lang], glow = C.dark ? 18 : 10;
    dots(ctx, 1000, 400);
    const sy = ((t * 60) % 460) - 30, g = ctx.createLinearGradient(0, sy - 30, 0, sy + 30);
    g.addColorStop(0, rgba(C.accRgb, 0)); g.addColorStop(0.5, rgba(C.accRgb, 0.06)); g.addColorStop(1, rgba(C.accRgb, 0));
    ctx.fillStyle = g; ctx.fillRect(0, sy - 30, 1000, 60);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    E.forEach((e) => {
      ctx.beginPath(); e.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
      ctx.strokeStyle = rgba(C.accRgb, 0.15 + e.pulse * 0.35); ctx.setLineDash([2, 8]); ctx.lineDashOffset = -t * 40; ctx.stroke(); ctx.setLineDash([]);
      const a = e.pts[e.pts.length - 2], b = e.pts[e.pts.length - 1];
      ctx.save(); ctx.translate(b[0], b[1]); ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -4); ctx.lineTo(-7, 4); ctx.closePath(); ctx.fillStyle = C.muted; ctx.fill(); ctx.restore();
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    Object.values(N).forEach((n) => {
      const label = L[n.id];
      if (n.k === 'task') {
        const w = 110, h = 56, x = n.x - w / 2, y = n.y - h / 2, act = n.busy > 0;
        ctx.save(); if (act) { ctx.shadowColor = rgba(C.accRgb, 0.45); ctx.shadowBlur = glow; }
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fillStyle = C.surface; ctx.fill(); ctx.restore();
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.strokeStyle = act ? rgba(C.accRgb, 0.6 + n.flash * 0.4) : C.border; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = C.fg; ctx.font = `600 12px ${UI}`; ctx.fillText(label, n.x, n.y - 5);
        const pw = 12, gap = 4, tw = n.cap * pw + (n.cap - 1) * gap;
        for (let i = 0; i < n.cap; i++) {
          const px = n.x - tw / 2 + i * (pw + gap); ctx.beginPath(); ctx.roundRect(px, n.y + 11, pw, 5, 1.5);
          if (i < n.busy) { ctx.fillStyle = C.acc; ctx.fill(); } else { ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke(); }
        }
        const lbl = `${n.done}/${n.started}`; ctx.font = `500 10px ${MONO}`; const lw = ctx.measureText(lbl).width + 10;
        ctx.fillStyle = C.surface; ctx.strokeStyle = n.flash > 0 ? rgba(C.accRgb, n.flash) : C.border;
        ctx.beginPath(); ctx.roundRect(x, y - 20, lw, 15, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.fillText(lbl, x + 5, y - 12.5); ctx.textAlign = 'center';
        const q = n.queue.length;
        for (let i = 0; i < Math.min(q, 7); i++) { ctx.beginPath(); ctx.arc(x + w - 5 - i * 8, y - 12.5, 2.8, 0, 7); ctx.fillStyle = C.warn; ctx.fill(); }
        if (q > 7) { ctx.fillStyle = C.warn; ctx.font = `500 9px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(`+${q - 7}`, x + w - 60, y - 12.5); ctx.textAlign = 'center'; }
      } else if (n.k === 'and' || n.k === 'xor') {
        ctx.beginPath(); ctx.moveTo(n.x, n.y - 18); ctx.lineTo(n.x + 18, n.y); ctx.lineTo(n.x, n.y + 18); ctx.lineTo(n.x - 18, n.y); ctx.closePath();
        ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = C.fg; ctx.lineWidth = 2.5; ctx.beginPath();
        if (n.k === 'and') { ctx.moveTo(n.x - 7, n.y); ctx.lineTo(n.x + 7, n.y); ctx.moveTo(n.x, n.y - 7); ctx.lineTo(n.x, n.y + 7); }
        else { ctx.moveTo(n.x - 5, n.y - 5); ctx.lineTo(n.x + 5, n.y + 5); ctx.moveTo(n.x + 5, n.y - 5); ctx.lineTo(n.x - 5, n.y + 5); }
        ctx.stroke();
        if (label) { ctx.fillStyle = C.muted; ctx.font = `500 11px ${UI}`; ctx.fillText(label, n.x, n.y - 30); }
      } else {
        const end = n.k === 'end', col = n.id === 'rej' ? C.warn : C.acc;
        ctx.save(); if (n.flash > 0) { ctx.shadowColor = col; ctx.shadowBlur = 20 * n.flash; }
        ctx.beginPath(); ctx.arc(n.x, n.y, 14, 0, 7); ctx.fillStyle = C.surface; ctx.fill(); ctx.restore();
        ctx.beginPath(); ctx.arc(n.x, n.y, 14, 0, 7); ctx.strokeStyle = n.flash > 0 ? col : C.fg; ctx.lineWidth = end ? 3.5 : 1.5; ctx.stroke();
        ctx.fillStyle = C.muted; ctx.font = `500 11px ${UI}`; ctx.fillText(label, n.x, n.y + 28);
        if (end) { ctx.font = `500 10px ${MONO}`; ctx.fillStyle = C.fg; ctx.fillText(String(n.done), n.x, n.y + 42); }
      }
    });
    ctx.globalCompositeOperation = C.dark ? 'lighter' : 'source-over';
    S.tokens.forEach((tok) => {
      if (tok.state !== 'move' || !tok.trail.length) return;
      const col = tok.rej ? C.warnRgb : C.accRgb;
      for (let i = 1; i < tok.trail.length; i++) {
        const a = tok.trail[i - 1], b = tok.trail[i]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = rgba(col, (i / tok.trail.length) * 0.55); ctx.lineWidth = (2.2 * i) / tok.trail.length + 0.4; ctx.stroke();
      }
      const p = tok.trail[tok.trail.length - 1], rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 11);
      rg.addColorStop(0, rgba(col, 0.55)); rg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p[0], p[1], 11, 0, 7); ctx.fill();
      ctx.fillStyle = C.dark ? '#ffffff' : `rgb(${col})`; ctx.beginPath(); ctx.arc(p[0], p[1], 2.8, 0, 7); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- 30 replications falling into a histogram -----------------------------------------------
  const R = { samples: [], drops: [], timer: 0.3, hold: 0 };
  if (reduce) for (let i = 0; i < 30; i++) R.samples.push(18.4 + norm() * 2.1);
  function stepRep(dt) {
    R.drops.forEach((d) => { d.p = Math.min(1, d.p + dt * 2.2); if (d.p >= 1 && !d.landed) { d.landed = true; R.samples.push(d.v); } });
    R.drops = R.drops.filter((d) => !d.landed);
    if (R.samples.length + R.drops.length >= 30) { if (!R.drops.length && (R.hold += dt) > 2.6) { R.samples = []; R.hold = 0; } return; }
    if ((R.timer -= dt) <= 0) { R.timer = 0.22; R.drops.push({ v: 18.4 + norm() * 2.1, p: 0 }); }
  }
  function repStats() {
    const s = R.samples, n = s.length; if (n < 2) return { n, m: null, ci: null };
    const m = s.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
    return { n, m, ci: (1.96 * sd) / Math.sqrt(n) };
  }
  function drawRep() {
    const W = 560, H = 320, ctx = fit($('#rep-canvas'), W, H); if (!ctx) return;
    const x0 = 36, x1 = W - 20, yb = H - 40, lo = 12, hi = 25, bins = 26, bw = (x1 - x0) / bins, unit = 22;
    const X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0), bin = (v) => Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins)));
    dots(ctx, W, H);
    const st = repStats();
    if (st.m != null) {
      const a = X(st.m - st.ci), b = X(st.m + st.ci);
      ctx.fillStyle = rgba(C.accRgb, 0.1); ctx.fillRect(a, 30, b - a, yb - 30);
      ctx.strokeStyle = rgba(C.accRgb, 0.5); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(a, 30); ctx.lineTo(a, yb); ctx.moveTo(b, 30); ctx.lineTo(b, yb); ctx.stroke(); ctx.setLineDash([]);
    }
    const counts = new Array(bins).fill(0); R.samples.forEach((v) => counts[bin(v)]++);
    counts.forEach((k, i) => { for (let j = 0; j < k; j++) { ctx.beginPath(); ctx.roundRect(x0 + i * bw + 2, yb - (j + 1) * unit + 3, bw - 4, unit - 4, 3); ctx.fillStyle = j === k - 1 ? C.acc : rgba(C.accRgb, 0.55); ctx.fill(); } });
    R.drops.forEach((d) => {
      const b = bin(d.v), ty = yb - (counts[b] + 0.5) * unit, y = 20 + (ty - 20) * d.p * d.p, x = x0 + b * bw + bw / 2;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 12); rg.addColorStop(0, rgba(C.accRgb, 0.7)); rg.addColorStop(1, rgba(C.accRgb, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(C.accRgb, 0.35); ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, y); ctx.stroke();
    });
    if (st.m != null) { ctx.strokeStyle = C.fg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(st.m), 24); ctx.lineTo(X(st.m), yb); ctx.stroke(); }
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = `500 10px ${MONO}`; ctx.textAlign = 'center';
    for (let v = 12; v <= 25; v += 2) ctx.fillText(String(v), X(v), yb + 16);
  }

  function pushHud() {
    const mins = Math.floor(S.t * 4), st = repStats();
    $('#hud-clock').textContent = `${String(8 + (Math.floor(mins / 60) % 12)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    $('#hud-done').textContent = S.doneCount;
    $('#hud-wip').textContent = Object.keys(S.cases).length;
    $('#hud-cycle').textContent = S.cycles.length ? `${((S.cycles.reduce((a, b) => a + b, 0) / S.cycles.length) * 4).toFixed(1)} min` : '—';
    $('#rep-n').textContent = st.n;
    $('#rep-mean').textContent = st.m != null ? st.m.toFixed(2) : '—';
    $('#rep-ci').textContent = st.ci != null ? st.ci.toFixed(2) : '—';
  }

  const speedIn = $('#speed');
  speedIn.addEventListener('input', () => { speed = parseFloat(speedIn.value); $('#speed-out').textContent = `${speed}×`; });

  // Animate only while visible; reduced motion draws the settled frames once per theme change.
  let visible = true, last = performance.now();
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; last = performance.now(); });
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (visible && !reduce) { stepHero(dt * speed); stepRep(dt); }
    drawHero(); drawRep();
    requestAnimationFrame(loop);
  }
  applyLang();
  pushHud();
  requestAnimationFrame(loop);
  setInterval(pushHud, 250);
  if (!reduce) setInterval(() => { if (term < 20) { term++; drawTerm(); } }, 380);
})();
