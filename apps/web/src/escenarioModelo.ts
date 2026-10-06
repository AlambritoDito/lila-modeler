/**
 * The scenario panel's model (LILA-061), split out of `ScenarioPanel.tsx`: the JSON Schema subset
 * the forms are generated from, path helpers that read and write the delta (§ 6), the live lint
 * and «Duplicate». Pure functions plus the `Contexto` every control receives; no React here.
 * `ScenarioPanel.tsx` re-exports all of it, so importers keep using that module.
 */
import type { ProcessIR } from '@lila-modeler/engine';
import {
  parseScenario,
  toJsonSchema,
  validateScenario,
  type ValidateScenarioOptions,
} from '@lila-modeler/engine/schema';

import { getLocale, strings, type Locale } from './i18n';

/* ------------------------------------------------------------------ *
 * JSON Schema: el subconjunto que produce `z.toJSONSchema` para el escenario
 * ------------------------------------------------------------------ */

/**
 * Lo que hace falta leer del JSON Schema. No es el draft 2020-12 entero: es exactamente lo que
 * `z.toJSONSchema(ScenarioSchema)` emite hoy (objetos estrictos, registros con
 * `additionalProperties`, arrays, enums, `const` como discriminador y `oneOf` para las uniones)
 * más `anyOf`, que es lo que emite una unión no discriminada como la de LILA-164.
 */
export interface EsquemaJson {
  type?: string;
  properties?: Record<string, EsquemaJson>;
  required?: readonly string[];
  additionalProperties?: EsquemaJson | boolean;
  items?: EsquemaJson;
  enum?: readonly unknown[];
  const?: unknown;
  oneOf?: readonly EsquemaJson[];
  anyOf?: readonly EsquemaJson[];
  default?: unknown;
  minimum?: number;
  description?: string;
}

/** El esquema no cambia en toda la sesión; generarlo con zod en cada render sería tirar CPU. */
let esquemaRaizCache: EsquemaJson | undefined;

export function esquemaRaiz(): EsquemaJson {
  esquemaRaizCache ??= toJsonSchema() as EsquemaJson;
  return esquemaRaizCache;
}

/** Sub-esquema de una propiedad de la raíz (`run`, `calendars`, `resources`, `elements`). */
export function esquemaDe(seccion: string): EsquemaJson {
  return esquemaRaiz().properties?.[seccion] ?? {};
}

/** El esquema de cada entrada de un registro (`calendars.*`, `resources.*`, `elements.*`). */
export function esquemaEntrada(registro: EsquemaJson): EsquemaJson {
  const extra = registro.additionalProperties;
  return typeof extra === 'object' ? extra : {};
}

export function variantes(esquema: EsquemaJson): readonly EsquemaJson[] | null {
  return esquema.oneOf ?? esquema.anyOf ?? null;
}

/** Un registro es un objeto sin `properties` cuyo valor lo describe `additionalProperties`. */
export function esRegistro(esquema: EsquemaJson): boolean {
  return (
    esquema.type === 'object' &&
    esquema.properties === undefined &&
    typeof esquema.additionalProperties === 'object'
  );
}

export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Tipo JSON del valor, con el vocabulario del schema (`integer` no se distingue de `number`). */
export function tipoJson(valor: unknown): string | undefined {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  switch (typeof valor) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return undefined;
  }
}

/**
 * Variante que describe `valor`, o `-1` si ninguna.
 *
 * Primero por discriminador (`{ "type": { "const": "normal" } }`, que es lo que produce el
 * `discriminatedUnion` de las distribuciones) y si no lo hay, por tipo JSON: es lo único que
 * separa las dos ramas de una unión no discriminada como la `number | Array<…>` de LILA-164.
 */
export function indiceVariante(valor: unknown, vars: readonly EsquemaJson[]): number {
  if (valor === undefined) return -1;
  for (const [i, variante] of vars.entries()) {
    const consts = Object.entries(variante.properties ?? {}).filter(
      ([, sub]) => sub.const !== undefined,
    );
    if (consts.length > 0 && esObjeto(valor) && consts.every(([k, s]) => valor[k] === s.const)) {
      return i;
    }
  }
  const tipo = tipoJson(valor);
  for (const [i, variante] of vars.entries()) {
    if (variante.type === tipo) return i;
    if (variante.type === 'integer' && tipo === 'number') return i;
  }
  return -1;
}

/** Etiqueta de una variante: su discriminador si lo tiene, y si no, su tipo JSON del idioma. */
export function etiquetaVariante(variante: EsquemaJson, indice: number): string {
  const S = strings();
  const discriminador = Object.values(variante.properties ?? {}).find(
    (sub) => typeof sub.const === 'string',
  );
  if (discriminador !== undefined) {
    const tipo = String(discriminador.const);
    return S.escenario.distribuciones[tipo] ?? tipo;
  }
  if (variante.type !== undefined) return S.escenario.tiposJson[variante.type] ?? variante.type;
  return S.escenario.opcionN(indice + 1);
}

/** Valor mínimo que satisface `esquema`: lo que se escribe al elegir una variante o añadir. */
export function valorVacio(esquema: EsquemaJson): unknown {
  if (esquema.const !== undefined) return esquema.const;
  if (esquema.default !== undefined) return esquema.default;
  if (esquema.enum !== undefined) return esquema.enum[0];
  const vars = variantes(esquema);
  if (vars !== null && vars.length > 0) return valorVacio(vars[0]!);
  switch (esquema.type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return esquema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object': {
      const salida: Record<string, unknown> = {};
      for (const clave of esquema.required ?? []) {
        salida[clave] = valorVacio(esquema.properties?.[clave] ?? {});
      }
      return salida;
    }
    default:
      return null;
  }
}

/**
 * A new item of an array: `valorVacio` plus the defaults the schema declares for its properties,
 * so that adding `resources[]` writes `quantity: 1` (§ 2.5) instead of leaving the box empty and
 * the form reading differently from the file that is saved.
 *
 * Only array items: adding a key to an object map (a pool, a calendar) keeps writing the bare
 * minimum, so a scenario written from the panel does not grow keys nobody typed.
 */
export function itemVacio(esquema: EsquemaJson): unknown {
  const base = valorVacio(esquema);
  if (esquema.type !== 'object' || !esObjeto(base)) return base;
  const salida: Record<string, unknown> = { ...base };
  for (const [clave, sub] of Object.entries(esquema.properties ?? {})) {
    if (sub.default !== undefined && salida[clave] === undefined) salida[clave] = sub.default;
  }
  return salida;
}

/* ------------------------------------------------------------------ *
 * Rutas: las mismas que citan los problemas del motor
 * ------------------------------------------------------------------ */

export type Ruta = readonly (string | number)[];

/**
 * `['elements','Task_1','resources',0,'ref']` → `elements.Task_1.resources[0].ref`: la ortografía
 * exacta de `ScenarioProblem.path` y de las rutas de zod, para poder cruzarlas con los campos.
 */
export function rutaTexto(ruta: Ruta): string {
  return ruta.reduce<string>(
    (acc, seg) =>
      typeof seg === 'number' ? `${acc}[${seg}]` : acc === '' ? String(seg) : `${acc}.${String(seg)}`,
    '',
  );
}

export function leer(raiz: unknown, ruta: Ruta): unknown {
  let actual: unknown = raiz;
  for (const seg of ruta) {
    if (actual === null || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string | number, unknown>)[seg];
  }
  return actual;
}

/** Copia `raiz` con `valor` puesto en `ruta`, creando los contenedores que falten. */
export function escribir<T>(raiz: T, ruta: Ruta, valor: unknown): T {
  if (ruta.length === 0) return valor as T;
  const [seg, ...resto] = ruta;
  if (typeof seg === 'number') {
    const copia = Array.isArray(raiz) ? [...(raiz as unknown[])] : [];
    copia[seg] = escribir(copia[seg], resto, valor);
    return copia as T;
  }
  const copia: Record<string, unknown> = esObjeto(raiz) ? { ...raiz } : {};
  copia[seg!] = escribir(copia[seg!], resto, valor);
  return copia as T;
}

/**
 * Lo que hay que escribir en el delta para que el **resuelto** sea exactamente `valor` (§ 6).
 *
 * `deepMerge` fusiona objeto con objeto, así que escribir `{type:"normal",…}` encima de un
 * `{type:"triangular",min,mode,max}` heredado deja `min`/`mode`/`max` pegados a la `normal`: el
 * archivo deja de pasar el esquema y el panel no ofrece control para borrarlos, porque el
 * formulario de la variante nueva no los dibuja. Las claves que el padre define y el valor nuevo
 * no trae se borran con `null`, que es como § 6 dice "borra".
 *
 * ponytail: un solo nivel. Es donde se cambia de variante (las distribuciones, la `capacity` de
 * LILA-164) y son objetos planos; un `null` en la clave de arriba se lleva el subárbol entero.
 */
export function conBorrados(valor: unknown, heredado: unknown): unknown {
  if (!esObjeto(valor) || !esObjeto(heredado)) return valor;
  const borrados: Record<string, unknown> = {};
  for (const clave of Object.keys(heredado)) {
    if (!(clave in valor)) borrados[clave] = null;
  }
  return { ...borrados, ...valor };
}

/** Copia `raiz` sin la clave de `ruta`; un índice de array se quita con `splice`, sin dejar hueco. */
export function borrar<T>(raiz: T, ruta: Ruta): T {
  if (ruta.length === 0) return undefined as T;
  const [seg, ...resto] = ruta;
  if (typeof seg === 'number') {
    if (!Array.isArray(raiz)) return raiz;
    const copia = [...(raiz as unknown[])];
    if (resto.length === 0) copia.splice(seg, 1);
    else copia[seg] = borrar(copia[seg], resto);
    return copia as T;
  }
  if (!esObjeto(raiz)) return raiz;
  const copia: Record<string, unknown> = { ...raiz };
  if (resto.length === 0) delete copia[seg!];
  else copia[seg!] = borrar(copia[seg!], resto);
  return copia as T;
}

/* ------------------------------------------------------------------ *
 * Validación en vivo: zod para el esquema, `validateScenario` para las reglas
 * ------------------------------------------------------------------ */

export interface Problema {
  ruta: string;
  mensaje: string;
  severidad: 'error' | 'warning';
}

/**
 * Problemas del escenario **resuelto**, con los textos de la CLI y sin duplicarlos aquí.
 *
 * Si el esquema no pasa, `validateScenario` no puede correr (necesita un `Scenario` parseado):
 * salen los defectos de zod, que son los mismos que imprime `loadResolvedScenario`. Sin IR
 * —el diagrama todavía no se ha parseado— solo se valida el esquema.
 *
 * These messages are the engine's and are shown verbatim; since #280 the engine is asked for
 * them in `locale`, which defaults to the app's active language, so the live lint of the panel
 * finally speaks the language the rest of the UI speaks. A component passes it explicitly, read
 * with `useLocale()`, so the `useMemo` that caches this list recomputes on a language change.
 */
export function problemasEscenario(
  resuelto: unknown,
  ir: ProcessIR | null,
  locale: Locale = getLocale(),
  /** #546: `elsewhere` of the parse, so an entry of another process says where it is. */
  elsewhere?: ValidateScenarioOptions['elsewhere'],
): Problema[] {
  const parsed = parseScenario(resuelto, { locale });
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      ruta: rutaTexto(issue.path as Ruta),
      mensaje: issue.message,
      severidad: 'error' as const,
    }));
  }
  if (ir === null) return [];
  return validateScenario(parsed.data, ir, { locale, elsewhere }).map((problema) => ({
    ruta: problema.path,
    mensaje: problema.message,
    severidad: problema.severity,
  }));
}

export function porRuta(problemas: readonly Problema[]): Map<string, Problema[]> {
  const mapa = new Map<string, Problema[]>();
  for (const problema of problemas) {
    const lista = mapa.get(problema.ruta);
    if (lista === undefined) mapa.set(problema.ruta, [problema]);
    else lista.push(problema);
  }
  return mapa;
}

/* ------------------------------------------------------------------ *
 * Duplicar (§ 6: el what-if de la casa es un delta con `extends`)
 * ------------------------------------------------------------------ */

export function duplicarEscenario(
  archivo: string,
  escenario: Record<string, unknown>,
  existentes: readonly string[],
): { archivo: string; escenario: Record<string, unknown> } {
  const S = strings();
  const base = archivo.replace(/\.scenario\.json$/, '');
  const nombre = typeof escenario['name'] === 'string' ? escenario['name'] : base;
  // § 6: `extends` se resuelve **relativo al archivo del hijo**, y la copia vive en el mismo
  // directorio que el original. Con la ruta entera dentro, `escenarios/x` acaba buscando a su
  // padre en `escenarios/escenarios/x` y la cadena se rompe en cuanto hay carpetas.
  const vecino = archivo.slice(archivo.lastIndexOf('/') + 1);
  // #397: a second copy of the same scenario must not overwrite the first one, so the suffix
  // is numbered — « (copy)», « (copy 2)», « (copy 3)»… — until the file name is free.
  const copia = S.escenario.sufijoCopia;
  // The number goes inside the closing parenthesis when the catalog has one, after it otherwise,
  // so a catalog without «)» cannot make this loop spin forever.
  const numerado = (n: number): string => (copia.endsWith(')') ? `${copia.slice(0, -1)} ${n})` : `${copia} ${n}`);
  let sufijo = copia;
  for (let n = 2; existentes.includes(`${base}${sufijo}.scenario.json`); n++) sufijo = numerado(n);
  return {
    archivo: `${base}${sufijo}.scenario.json`,
    escenario: { version: 1, name: `${nombre}${sufijo}`, extends: vecino },
  };
}

/* ------------------------------------------------------------------ *
 * Controles
 * ------------------------------------------------------------------ */

export interface Contexto {
  resuelto: Record<string, unknown>;
  problemas: ReadonlyMap<string, readonly Problema[]>;
  editar(ruta: Ruta, valor: unknown): void;
  quitar(ruta: Ruta): void;
  /**
   * El delta crudo del archivo en edición y el padre resuelto (o `null` sin `extends` o con la
   * cadena rota), para distinguir heredado/propio/eliminado en un campo reservado (§ 4, OP-11).
   * Opcionales: las sondas de test que no tocan campos reservados no necesitan construirlos.
   */
  delta?: Record<string, unknown>;
  padre?: Record<string, unknown> | null;
  /** Deshace un `quitar()` sobre un reservado eliminado: borra el `null` propio, no lo escribe. */
  restaurar?(ruta: Ruta): void;
  /**
   * El IR vigente, para los campos cuya aplicabilidad depende del elemento y no del esquema:
   * hoy solo `conditions` (ADR-028). Opcional: las sondas de test que no lo tocan no lo pasan.
   */
  ir?: ProcessIR | null;
  /**
   * Varias ediciones en **una sola** escritura del delta (LILA-334). `editar` una por una
   * funcionaría en la app —cada llamada trae el delta nuevo por props— pero no en un anfitrión
   * que agrupe los cambios, y dejaría trece pasos de deshacer donde la acción fue una. Las rutas
   * no llevan índice de array: quien escribe una lista entera (los `resources` de una tarea) pasa
   * el array completo como valor, que es lo que § 6 dice de los arrays.
   */
  editarVarios?(cambios: readonly { ruta: Ruta; valor: unknown }[]): void;
}
