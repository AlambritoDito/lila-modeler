import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BrowserStore } from './store/BrowserStore';
import pedido from '../../../examples/pedido/model.bpmn?raw';

// Único punto de elección BrowserStore/DesktopStore (OP-01).
const store = new BrowserStore(new Map([['pedido', { xml: pedido, name: 'model.bpmn' }]]));
createRoot(document.getElementById('root')!).render(
  <StrictMode><App store={store} /></StrictMode>,
);
