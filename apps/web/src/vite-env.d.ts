/// <reference types="vite/client" />

// `diagram-js-minimap` no publica tipos. Solo se usa como módulo de diagram-js
// (`additionalModules`), así que basta con declararlo: el shell nunca lo toca.
declare module 'diagram-js-minimap' {
  const minimapModule: Record<string, unknown>;
  export default minimapModule;
}

// `bpmn-js-token-simulation` (LILA-065) tampoco publica tipos. Mismo trato: solo se usa como
// módulo de bpmn-js (`additionalModules`) y su CSS, así que basta con declarar los dos.
declare module 'bpmn-js-token-simulation' {
  const tokenSimulationModule: Record<string, unknown>;
  export default tokenSimulationModule;
}
declare module 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
