// @vitest-environment jsdom
/**
 * The language store of LILA-210: how a locale is picked, and what changing it moves.
 *
 * jsdom reports `navigator.language === 'en-US'`, so the module boots in English on its own — the
 * same thing that happens in `App.test.tsx`, and the reason that suite can read the base catalog.
 * Everything about *choosing* the language is `detectLocale`, a pure function, so it is checked as
 * a table and not through the DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, getLocale, getPreferencia, setLocale, strings, subscribe, t } from './i18n';
import { en } from './strings.en';
import { es } from './strings.es';

// The store is module state: whatever a test leaves set would be read by the next one.
afterEach(() => setLocale('auto'));

describe('detectLocale · qué idioma toca', () => {
  it.each([
    // Anything Spanish, however the platform spells the tag: a region, the Latin-American code,
    // and the POSIX form Electron can hand over on Linux (`es_MX.UTF-8`).
    ['es', 'es'],
    ['es-MX', 'es'],
    ['es-419', 'es'],
    ['es_MX.UTF-8', 'es'],
    ['ES-mx', 'es'],
    // Everything else is English, which is the base catalog: an app in a language nobody wrote is
    // worse than an app in the language it was written in. `pt-BR` matters because it is the
    // nearest miss — Romance, and next door.
    ['en-US', 'en'],
    ['pt-BR', 'en'],
    ['fr', 'en'],
    ['zh-Hans', 'en'],
    ['', 'en'],
    // Not Spanish either, however much it starts with the same two letters.
    ['esperanto', 'en'],
    ['et-EE', 'en'],
  ])('«%s» → %s', (idiomaDelSistema, esperado) => {
    expect(detectLocale(idiomaDelSistema)).toBe(esperado);
  });

  it('lo guardado manda sobre el sistema', () => {
    expect(detectLocale('en-US', 'es')).toBe('es');
    expect(detectLocale('es-MX', 'en')).toBe('en');
  });

  it('«auto» y lo que ya no vale caen en el idioma del sistema', () => {
    // `auto` es lo que guarda Ajustes cuando se sigue al sistema; `fr` y `''` son un valor de una
    // versión anterior o un `estado.json` tocado a mano.
    for (const guardada of ['auto', 'fr', 'ES', '', 'en-US']) {
      expect(detectLocale('es-MX', guardada)).toBe('es');
      expect(detectLocale('en-US', guardada)).toBe('en');
    }
  });
});

describe('setLocale · qué mueve cambiar de idioma', () => {
  it('avisa a los suscritos y escribe <html lang>', () => {
    const avisado = vi.fn();
    const desuscribir = subscribe(avisado);
    setLocale('es');
    expect(avisado).toHaveBeenCalledOnce();
    expect(getLocale()).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    setLocale('en');
    expect(avisado).toHaveBeenCalledTimes(2);
    expect(document.documentElement.lang).toBe('en');
    // Desuscribirse deja de recibir: es lo que `useSyncExternalStore` hace al desmontar.
    desuscribir();
    setLocale('es');
    expect(avisado).toHaveBeenCalledTimes(2);
  });

  it('poner el mismo idioma no repinta a nadie', () => {
    setLocale('es');
    const avisado = vi.fn();
    subscribe(avisado);
    setLocale('es');
    expect(avisado).not.toHaveBeenCalled();
  });

  it('guarda la preferencia, no el idioma resuelto', () => {
    // Es la diferencia que hace que una máquina que cambie de idioma de sistema siga cambiando de
    // idioma la app: con `auto` guardado resuelto («en») se habría quedado en inglés para siempre.
    setLocale('auto');
    expect(getPreferencia()).toBe('auto');
    expect(getLocale()).toBe('en'); // jsdom habla `en-US`.
    setLocale('es');
    expect(getPreferencia()).toBe('es');
  });

  it('«auto» vuelve a preguntarle al sistema', () => {
    // `navigator.language` es de solo lectura y vive en el prototipo: se tapa con una propiedad
    // propia y se quita luego, que es como vuelve a verse la de jsdom («en-US»).
    Object.defineProperty(navigator, 'language', { value: 'es-MX', configurable: true });
    try {
      setLocale('auto');
      expect(getLocale()).toBe('es');
    } finally {
      delete (navigator as { language?: string }).language;
    }
    expect(navigator.language).toBe('en-US');
  });
});

describe('strings() · el catálogo activo', () => {
  it('devuelve el catálogo del idioma vivo en el momento de llamarlo', () => {
    setLocale('en');
    expect(strings()).toBe(en);
    setLocale('es');
    expect(strings()).toBe(es);
    // `t` es el mismo: el nombre corto con el que lo lee el ticket.
    expect(t).toBe(strings);
    expect(t().app.guardar).toBe(es.app.guardar);
  });
});
