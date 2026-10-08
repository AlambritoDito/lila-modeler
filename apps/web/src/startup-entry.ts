import { registrarServiceWorker } from './pwa';
import { failStartup, startStartup } from './startup';
startStartup();
// After `load`, so precaching the app does not compete with the first download of the editor.
window.addEventListener('load', () => void registrarServiceWorker(), { once: true });
// Keep the controller small and visible even when the editor bundle fails to download.
void import('./main').catch((error: unknown) => {
  console.error('Lila Modeler startup failed', error);
  failStartup();
});
