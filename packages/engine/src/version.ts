/**
 * Versión del paquete `@lila/engine`. Vive aquí, y no como `import` de
 * `packages/engine/package.json`, porque el `rootDir` del paquete es `src/`: importar el
 * manifiesto sacaría el `outDir` de sitio y rompería el bundle. el test de `marcarExportador`
 * en `packages/engine/test/bpmn/ids.test.ts` lee el manifiesto y comprueba que no se
 * desincronizan.
 */
export const version = '0.0.0';
