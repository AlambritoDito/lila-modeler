/// <reference types="vite/client" />

// `diagram-js-minimap` no publica tipos. Solo se usa como módulo de diagram-js
// (`additionalModules`), así que basta con declararlo: el shell nunca lo toca.
declare module 'diagram-js-minimap' {
  const minimapModule: Record<string, unknown>;
  export default minimapModule;
}
