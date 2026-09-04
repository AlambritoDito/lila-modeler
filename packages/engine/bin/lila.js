#!/usr/bin/env node
// Envoltorio del bin. Existe en el repositorio (a diferencia de `dist/cli.js`, que se compila)
// para que `npm install` cree `node_modules/.bin/lila` ya en la primera instalación. Sin él,
// `npx lila` en un checkout recién clonado no encuentra el bin local y npm se descarga y
// ejecuta el paquete público `lila`, que no tiene nada que ver con este proyecto.
let main;
try {
  ({ main } = await import('../dist/cli.js'));
} catch {
  console.error('lila: falta compilar el paquete. Ejecuta `npm run build` en la raíz del repo.');
  process.exit(1);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`lila: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
