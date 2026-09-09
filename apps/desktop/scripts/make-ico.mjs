// Empaqueta resources/icons/icon.png en un .ico multi-resolución (16/32/48/256 px)
// para electron-builder en Windows, sin dependencias: usa `sips` (macOS) para
// reescalar y arma a mano el contenedor ICO (ICONDIR + ICONDIRENTRY con PNG
// embebido, aceptado desde Windows Vista). Ver apps/desktop/package.json → "icons".
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath y no URL.pathname: el checkout de trabajo puede tener espacios
// ("…/Lila Modeler/") y pathname los deja en %20, con lo que sips no encuentra el PNG.
const ICONS_DIR = fileURLToPath(new URL('../resources/icons/', import.meta.url));
const SRC = join(ICONS_DIR, 'icon.png');
const SIZES = [16, 32, 48, 256];

const tmp = mkdtempSync(join(tmpdir(), 'lila-ico-'));
try {
  const images = SIZES.map((size) => {
    const out = join(tmp, `${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), SRC, '--out', out], { stdio: 'ignore' });
    return { size, data: readFileSync(out) };
  });

  const headerSize = 6 + 16 * images.length;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: icono
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // 0 == 256 px, por spec ICO
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // paleta: ninguna (32 bpp)
    entry.writeUInt8(0, 3); // reservado
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por píxel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }

  writeFileSync(
    join(ICONS_DIR, 'icon.ico'),
    Buffer.concat([header, ...entries, ...images.map((i) => i.data)]),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
