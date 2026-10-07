/**
 * The installable web app (#571, #572, ADR-031): what Chrome and Edge read before they offer
 * «Install». The browser-side check (`Page.getInstallabilityErrors` on the Pages build) is
 * `tools/check-pwa.mjs`; this one keeps the manifest honest on every `npm test`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): Buffer => readFileSync(new URL(path, import.meta.url));
interface Icon { src: string; sizes: string; type: string; purpose?: string }
const manifest = JSON.parse(read('../manifest.webmanifest').toString('utf8')) as {
  id: string; name: string; short_name: string; start_url: string; scope: string; display: string;
  theme_color: string; background_color: string; icons: Icon[];
  file_handlers: { action: string; accept: Record<string, string[]>; icons?: Icon[] }[];
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
/** Manifest icons live in `branding/`, staged from `docs/design/branding/web/` by Vite. */
const iconFile = (src: string): Buffer => {
  expect(src).toMatch(/^branding\/[\w-]+\.png$/);
  return read(`../../../docs/design/branding/web/${src.slice('branding/'.length)}`);
};

describe('manifest.webmanifest', () => {
  it('is relative to its own URL, so one file serves `/` and `/lila-modeler/app/`', () => {
    for (const url of [manifest.id, manifest.start_url, manifest.scope, ...manifest.file_handlers.map((h) => h.action)]) {
      expect(url).toBe('./');
    }
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBe('Lila Modeler');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toBe('#ffffff');
  });

  it('has 192 and 512 icons and a maskable one, each the size it declares', () => {
    const declared = manifest.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
    expect(declared).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of [...manifest.icons, ...manifest.file_handlers.flatMap((h) => h.icons ?? [])]) {
      expect(icon.type).toBe('image/png');
      expect(pngSize(iconFile(icon.src)).join('x')).toBe(icon.sizes);
    }
  });

  it('declares `.lila` as a file it opens (file_handlers)', () => {
    expect(manifest.file_handlers).toHaveLength(1);
    expect(manifest.file_handlers[0]!.accept).toEqual({ 'application/vnd.lila-modeler+zip': ['.lila'] });
  });

  it('is linked from index.html with the same theme color', () => {
    const html = read('../index.html').toString('utf8');
    expect(html).toContain('<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
  });
});
