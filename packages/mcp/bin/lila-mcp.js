#!/usr/bin/env node
// Envoltorio del bin, igual al de @lila/engine: existe en el repositorio para que `npm install`
// cree `node_modules/.bin/lila-mcp` ya en la primera instalación, aunque `dist/` no exista todavía.
try {
  await import('../dist/bin.js');
} catch {
  console.error('lila-mcp: falta compilar el paquete. Ejecuta `npm run build` en la raíz del repo.');
  process.exit(1);
}
