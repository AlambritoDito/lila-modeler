/**
 * Validación de origen de mensajes IPC (OP-14, revisión de A sobre OP-02: issue #71 — "falta
 * validar senderFrame/navegación"). Pura: sin `electron`, para poder probarla sin un proceso de
 * Electron detrás. `main.ts` la usa tanto para envolver cada `ipcMain.handle`/`ipcMain.on` (contra
 * `event.senderFrame.url`) como para decidir qué destinos permite `will-navigate` — mismo criterio
 * en ambos casos: "¿esta URL es la app, o el dev server declarado?".
 *
 * Comparación por origen (`new URL(...).origin`), no por prefijo de texto: un `startsWith` ingenuo
 * dejaría pasar `http://localhost:5174.evil.com` contra un `devUrl` de `http://localhost:5174` (el
 * prefijo de caracteres coincide sin ser el mismo origen). `URL.origin` no sufre esa confusión.
 */

/** Origen esperado del protocolo empaquetado: `lila://app/...`. */
const APP_PROTOCOL = 'lila:';
const APP_HOST = 'app';

/**
 * `true` si `frameUrl` pertenece a la propia app: el protocolo empaquetado (`lila://app/...`) o,
 * en desarrollo, el mismo origen que `devUrl` (típicamente el dev server de Vite). `frameUrl`/
 * `devUrl` inválidas como URL se tratan como no confiables en vez de lanzar.
 */
export function isTrustedSender(frameUrl: string, devUrl: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(frameUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === APP_PROTOCOL && parsed.host === APP_HOST) return true;
  if (!devUrl) return false;
  try {
    return parsed.origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}
