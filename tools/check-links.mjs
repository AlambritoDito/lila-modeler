// Checks that every relative markdown link in README*.md and docs/**/*.md points at a file that exists.
// ponytail: existence only — no anchors, no external URLs, no image alt text. That is the ceiling.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
const files = ['README.md', 'README.es.md', ...walk('docs')];
let checked = 0;
const broken = [];
for (const file of files) {
  for (const [, target] of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#|<)/.test(target)) continue;
    const path = decodeURIComponent(target.replace(/[#?].*$/, ''));
    checked++;
    if (!existsSync(resolve(dirname(file), path))) broken.push(`${file}: ${target}`);
  }
}
broken.forEach((b) => console.log(b));
if (broken.length) process.exit(1);
console.log(`${checked} relative links checked, all resolve`);
