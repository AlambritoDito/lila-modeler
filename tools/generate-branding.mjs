/** Repackage approved raster artwork; never redraw it. macOS export tools + Playwright. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const brand = join(root, 'docs/design/branding');
const web = join(brand, 'web');
const desktop = join(root, 'apps/desktop/resources/icons');
mkdirSync(web, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  async function render(source, width, height, rounded = false) {
    const data = readFileSync(join(brand, 'sources', source)).toString('base64');
    const result = await page.evaluate(async ({ data, width, height, rounded }) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (rounded) {
        // Native desktop tile: 5% outer transparent margin, 20% corner radius.
        const margin = width * .05, side = width - margin * 2;
        ctx.beginPath(); ctx.roundRect(margin, margin, side, side, side * .2); ctx.clip();
        ctx.drawImage(img, margin, margin, side, side);
      } else ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { data, width, height, rounded });
    return Buffer.from(result, 'base64');
  }
  writeFileSync(join(web, 'lila-transparent.png'), await render('lila-transparent.png', 256, 256));
  writeFileSync(join(web, 'app-icon.png'), await render('lila-app-master.png', 256, 256));
  writeFileSync(join(web, 'logo-horizontal.png'), await render('lila-horizontal.png', 1086, 362));
  for (const size of [16, 32, 48, 180, 192, 512]) {
    writeFileSync(join(web, `icon-${size}.png`), await render('lila-app-master.png', size, size));
  }
  const images = [16, 32, 48].map(size => ({ size, data: readFileSync(join(web, `icon-${size}.png`)) }));
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16); e[0] = size; e[1] = size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length; return e;
  });
  writeFileSync(join(web, 'favicon.ico'), Buffer.concat([header, ...entries, ...images.map(i => i.data)]));
  writeFileSync(join(desktop, 'icon.png'), await render('lila-app-master.png', 1024, 1024, true));
} finally { await browser.close(); }
const temporary = mkdtempSync(join(tmpdir(), 'lila-brand-'));
try {
  const iconset = join(temporary, 'icon.iconset'); mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), join(desktop, 'icon.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(desktop, 'icon.icns')]);
  execFileSync(process.execPath, [join(root, 'apps/desktop/scripts/make-ico.mjs')]);
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log('Branding exported from approved detailed originals.');
