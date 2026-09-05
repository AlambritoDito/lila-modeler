#!/usr/bin/env node
// Envoltorio del bin, igual al de @lila/engine: existe en el repositorio para que `npm install`
// cree `node_modules/.bin/lila-mcp` ya en la primera instalación, aunque `dist/` no exista todavía.
try {
  await import('../dist/bin.js');
} catch (error) {
  // Solo un módulo ausente significa "falta compilar"; cualquier otro fallo de arranque se
  // reporta tal cual, o el usuario se queda compilando un paquete que ya estaba compilado.
  console.error(
    error?.code === 'ERR_MODULE_NOT_FOUND'
      ? 'lila-mcp: falta compilar el paquete. Ejecuta `npm run build` en la raíz del repo.'
      : `lila-mcp: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
