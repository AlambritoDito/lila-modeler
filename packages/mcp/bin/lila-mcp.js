#!/usr/bin/env node
// Envoltorio del bin, igual al de @lila-modeler/engine: existe en el repositorio para que `npm install`
// cree `node_modules/.bin/lila-mcp` ya en la primera instalación, aunque `dist/` no exista todavía.
try {
  await import('../dist/bin.js');
} catch (error) {
  // Solo la ausencia de nuestro propio `dist/bin.js` significa "falta compilar" (checkout sin
  // `npm run build`). Una dependencia ausente en una instalación de npm, o cualquier otro fallo de
  // arranque, se reporta tal cual: el paquete publicado ya viene compilado.
  const unbuilt = error?.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find module '[^']*dist[\\/]bin\.js'/.test(String(error?.message));
  console.error(
    unbuilt
      ? 'lila-mcp: the package is not built. Run `npm run build` at the repository root.'
      : `lila-mcp: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
