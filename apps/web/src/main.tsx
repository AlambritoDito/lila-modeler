import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BrowserStore } from './store/BrowserStore';
import { DesktopStore } from './store/DesktopStore';
import pedido from '../../../examples/pedido/model.bpmn?raw';
// Archivo es la tipografía que eligió el diseño (`docs/design/README.md`). Vite empaqueta los
// `.woff2`, así que la app sigue funcionando sin red y dentro del CSP `'self'` de Electron.
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';

// Único punto de elección BrowserStore/DesktopStore (OP-01).
const desktop = typeof window.lila !== 'undefined';
const store = desktop ? new DesktopStore() : new BrowserStore(new Map([['pedido', { xml: pedido, name: 'model.bpmn' }]]));
createRoot(document.getElementById('root')!).render(
  <StrictMode><App store={store} bpmnFilesEnabled={!desktop} /></StrictMode>,
);
