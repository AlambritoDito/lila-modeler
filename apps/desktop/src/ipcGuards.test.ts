import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './ipcGuards.js';

describe('isTrustedSender', () => {
  it('acepta el protocolo empaquetado de la app', () => {
    expect(isTrustedSender('lila://app/index.html', undefined)).toBe(true);
    expect(isTrustedSender('lila://app/assets/main.js', undefined)).toBe(true);
  });

  it('rechaza otros hosts del mismo protocolo', () => {
    expect(isTrustedSender('lila://otro-host/index.html', undefined)).toBe(false);
  });

  it('rechaza http(s) cuando no hay devUrl configurada', () => {
    expect(isTrustedSender('http://localhost:5174/', undefined)).toBe(false);
    expect(isTrustedSender('https://evil.example/', undefined)).toBe(false);
  });

  it('acepta el mismo origen que devUrl en desarrollo', () => {
    expect(isTrustedSender('http://localhost:5174/', 'http://localhost:5174')).toBe(true);
    expect(isTrustedSender('http://localhost:5174/index.html?x=1', 'http://localhost:5174/')).toBe(true);
  });

  it('rechaza un origen distinto aunque comparta puerto o ruta', () => {
    expect(isTrustedSender('http://evil.example:5174/', 'http://localhost:5174')).toBe(false);
    expect(isTrustedSender('http://localhost:9999/', 'http://localhost:5174')).toBe(false);
  });

  it('rechaza confusión de prefijo textual: el origen debe coincidir exactamente', () => {
    // "http://localhost:51740.evil.com" comparte el PREFIJO de caracteres con
    // "http://localhost:5174", pero es un origen distinto — un startsWith ingenuo lo dejaría pasar.
    expect(isTrustedSender('http://localhost:51740.evil.com/', 'http://localhost:5174')).toBe(false);
    expect(isTrustedSender('lila://app.evil.com/index.html', undefined)).toBe(false);
  });

  it('URL inválida en frameUrl o devUrl no lanza y se trata como no confiable', () => {
    expect(isTrustedSender('no-es-una-url', 'http://localhost:5174')).toBe(false);
    expect(isTrustedSender('http://localhost:5174/', 'no-es-una-url')).toBe(false);
  });
});
