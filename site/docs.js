/*
 * Behaviour of the rendered docs (tools/build-docs.mjs): sidebar search, "/" and ⌘K to focus it,
 * the mobile drawer and copy buttons on code blocks. The pages work without it.
 */
(() => {
  const search = document.getElementById('doc-search');
  const groups = [...document.querySelectorAll('.side details')];
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    groups.forEach((g) => {
      let any = false;
      g.querySelectorAll('li').forEach((li) => { const hit = !q || li.textContent.toLowerCase().includes(q); li.hidden = !hit; any ||= hit; });
      g.hidden = !any;
      if (q) g.open = true;
    });
    if (q && matchMedia('(max-width: 860px)').matches) setDrawer(true);
  });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape') setDrawer(false);
  });

  const btn = document.getElementById('drawer-btn');
  function setDrawer(open) {
    // The header wraps to a different height at each width; the drawer starts right below it.
    document.querySelector('.side').style.paddingTop = open ? `${document.querySelector('.docs-top').offsetHeight + 16}px` : '';
    document.body.classList.toggle('drawer', open);
    btn.setAttribute('aria-expanded', open);
    btn.firstChild.textContent = open ? '✕' : '☰';
  }
  btn.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer')));

  const lang = document.documentElement.lang === 'es';
  document.querySelectorAll('.doc pre').forEach((pre) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'copy'; b.textContent = lang ? 'Copiar' : 'Copy';
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText); b.textContent = lang ? 'Copiado ✓' : 'Copied ✓'; }
      catch { b.textContent = '×'; }
      setTimeout(() => { b.textContent = lang ? 'Copiar' : 'Copy'; }, 1400);
    });
    pre.append(b);
  });
})();
