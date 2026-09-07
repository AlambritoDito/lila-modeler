// Escribe `release/ORIGEN.txt` tras `dist:mac`: SHA, fecha y arquitectura del host que compiló.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.resolve(here, '..', 'release');
const sha = execSync('git rev-parse HEAD').toString().trim();
const arch = execSync('uname -m').toString().trim();
mkdirSync(releaseDir, { recursive: true });
writeFileSync(path.join(releaseDir, 'ORIGEN.txt'), `sha=${sha}\nfecha=${new Date().toISOString()}\narch=${arch}\n`);
console.log(`Escrito ${path.join(releaseDir, 'ORIGEN.txt')}`);
