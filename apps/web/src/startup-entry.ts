import { failStartup, startStartup } from './startup';
startStartup();
// Keep the controller small and visible even when the editor bundle fails to download.
void import('./main').catch((error: unknown) => {
  console.error('Lila Modeler startup failed', error);
  failStartup();
});
