/**
 * Temas del usuario (LILA-114): validar un tema que viene de fuera, agrupar los 40 tokens para el
 * editor y las operaciones de la lista. Sin DOM y sin React: `settings/Apariencia.tsx` es la
 * pantalla y `App.tsx` sigue siendo el único que aplica (`applyTheme` + `Modelador.repintar`).
 *
 * **Dónde vive un tema del usuario.** En `ajustes.temas` (escritorio, `<userData>/estado.json`) o
 * en `localStorage['lila.temas']` (web), con la misma forma `TemaGuardado` en los dos sitios; el
 * reparto por modalidad ya lo hacen `preferencias()`/`recordar()` de `App.tsx` (LILA-113). Lo que
 * se exporta e importa es solo `tema` (`{ name, tokens }`, `docs/THEMES.md`): `id` y `origen` son
 * de la app, no del formato.
 *
 * **Por qué se valida aquí y no solo en `applyTheme`.** `applyTheme` comprueba lo que le impide
 * escribir CSS sano (clave conocida, valor de texto) y lanza con el nombre del tema. Un JSON de
 * disco o de un archivo elegido por el usuario puede además traer un color que no es un color o
 * una densidad inventada: eso no rompe `applyTheme` —CSS ignora el valor inválido en silencio—
 * pero deja la app medio pintada sin decir por qué. `validarTema` es esa segunda regla, y es la
 * misma para importar y para releer lo guardado.
 */
import { S } from '../strings.es';
import { DENSIDAD_IDS } from '../ids';
import type { Theme } from './applyTheme';
import { COLOR_TOKEN_NAMES, TOKEN_NAMES, type TokenName } from './tokens';
// Solo el tipo (se borra al compilar): la forma de lo persistido es parte del contrato del puente.
import type { TemaGuardado } from '../../../desktop/src/bridge.js';

export type { TemaGuardado };

/** Los valores que `docs/THEMES.md` acepta para un token de color. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CONOCIDOS: ReadonlySet<string> = new Set(TOKEN_NAMES);
const COLORES: ReadonlySet<string> = new Set(COLOR_TOKEN_NAMES);
const DENSIDADES: ReadonlySet<string> = new Set(DENSIDAD_IDS);

/** Prefijo de los ids de tema del usuario; los integrados son `eva-01` y `papel`. */
const PREFIJO = 'u:';
export const esDelUsuario = (id: string): boolean => id.startsWith(PREFIJO);

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Devuelve el tema **normalizado** (solo `name` y `tokens`, en ese orden) o lanza con un mensaje
 * en español listo para enseñar. Normalizar es lo que hace exacta la ida y vuelta exportar →
 * importar → exportar: lo que el archivo traiga de más no entra en la app ni vuelve a salir.
 */
export function validarTema(dato: unknown): Theme {
  if (!esObjeto(dato) || !esObjeto(dato.tokens)) throw new Error(S.apariencia.errorForma);
  if (typeof dato.name !== 'string' || dato.name.trim() === '') throw new Error(S.apariencia.errorNombre);
  const tokens: Theme['tokens'] = {};
  for (const [token, valor] of Object.entries(dato.tokens)) {
    if (!CONOCIDOS.has(token)) throw new Error(S.apariencia.errorToken(token));
    if (typeof valor !== 'string') throw new Error(S.apariencia.errorValor(token));
    if (COLORES.has(token) && !HEX.test(valor)) throw new Error(S.apariencia.errorHex(token, valor));
    if (token === 'density' && !DENSIDADES.has(valor)) throw new Error(S.apariencia.errorDensidad(valor));
    tokens[token as TokenName] = valor;
  }
  return { name: dato.name, tokens };
}

/**
 * `true` si el valor es el que ese token acepta. Las mismas tres reglas que `validarTema`, sin
 * mensaje: aquí se usan donde no hay a quién enseñárselo (el saneo) o donde el propio control ya
 * lo dice (el editor de tokens).
 */
export function valorValido(token: string, valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  if (COLORES.has(token) && !HEX.test(valor)) return false;
  if (token === 'density' && !DENSIDADES.has(valor)) return false;
  return true;
}

/** Los tokens conocidos que valen, en el orden de `TOKEN_NAMES`; el que no vale cae al `respaldo`. */
function tokensSanos(dato: unknown, respaldo: Record<string, string>): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const token of TOKEN_NAMES) {
    const valor: unknown = esObjeto(dato) ? dato[token] : undefined;
    const bueno = valorValido(token, valor) ? valor : respaldo[token];
    if (bueno !== undefined) tokens[token] = bueno;
  }
  return tokens;
}

/**
 * Lo guardado, **reparado token a token**. Antes se descartaba el tema entero al primer valor que
 * no validara, y eso convertía cualquier edición dejada a medias —un hex tecleado hasta `#12`— en
 * la pérdida silenciosa de los 40 tokens al recargar (QA de #277). Ahora el token roto vuelve al
 * `origen` del tema y, si ahí tampoco vale, se cae de la lista: un token ausente es legal y lo
 * pinta el valor por defecto de `tokens.css` (Eva-01), que es lo que promete `docs/THEMES.md`.
 *
 * Lo único que se descarta es el tema que no se puede reconstruir: sin `id` del usuario o sin
 * `name`, porque no habría cómo elegirlo en la lista.
 */
export function saneaTemas(dato: unknown): TemaGuardado[] {
  if (!Array.isArray(dato)) return [];
  const temas: TemaGuardado[] = [];
  for (const t of dato as unknown[]) {
    if (!esObjeto(t) || typeof t.id !== 'string' || !esDelUsuario(t.id)) continue;
    if (!esObjeto(t.tema) || typeof t.tema.name !== 'string' || t.tema.name.trim() === '') continue;
    const origen = tokensSanos(t.origen, {});
    temas.push({ id: t.id, tema: { name: t.tema.name, tokens: tokensSanos(t.tema.tokens, origen) }, origen });
  }
  return temas;
}

export const temaDe = (id: string, temas: readonly TemaGuardado[]): TemaGuardado | undefined =>
  temas.find((t) => t.id === id);

/**
 * Copia del tema activo como tema nuevo del usuario. `origen` guarda los tokens de partida, que es
 * lo único que necesita «Restablecer»: no hace falta volver a pedir el integrado por `fetch` ni
 * confiar en que su JSON siga igual, y funciona igual para un tema importado, que no tiene
 * integrado detrás.
 */
export function duplicar(tema: Theme, temas: readonly TemaGuardado[], nombre?: string): TemaGuardado {
  const usados = temas.map((t) => Number(t.id.slice(PREFIJO.length))).filter((n) => Number.isFinite(n));
  const tokens = { ...tema.tokens };
  return {
    id: `${PREFIJO}${Math.max(0, ...usados) + 1}`,
    tema: { name: nombre ?? S.apariencia.copia(tema.name), tokens },
    origen: tokens,
  };
}

/**
 * Los tokens agrupados como los pinta el editor. El orden y el reparto son los de `TOKEN_NAMES`
 * (que ya viene por grupos); aquí solo se cortan las tandas seguidas que comparten rótulo, así que
 * un token nuevo en `tokens.ts` aparece en su grupo sin tocar nada de esto.
 */
export const GRUPOS: readonly { readonly titulo: string; readonly tokens: readonly TokenName[] }[] = (() => {
  const grupos: { titulo: string; tokens: TokenName[] }[] = [];
  for (const token of TOKEN_NAMES) {
    const titulo = S.apariencia.grupos[token.split('.')[0]!] ?? token;
    const ultimo = grupos.at(-1);
    if (ultimo?.titulo === titulo) ultimo.tokens.push(token);
    else grupos.push({ titulo, tokens: [token] });
  }
  return grupos;
})();

/** `true` si el token se edita con selector de color (y no con `<select>` o número). */
export const esColor = (token: string): boolean => COLORES.has(token);
