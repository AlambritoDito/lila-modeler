/**
 * Panel de escenario (LILA-061): `run`, `calendars`, `resources` y `elements[id]` del elemento
 * seleccionado en el lienzo, con validación en vivo y los mismos textos que la CLI.
 *
 * Tres decisiones que explican todo lo demás:
 *
 * 1. **Los formularios se generan desde el JSON Schema en tiempo de ejecución**, no a mano. El
 *    esquema sale de `toJsonSchema()` de `@lila/engine/schema` —el mismo que publica
 *    `docs/scenario.schema.json`—, así que un campo nuevo en `scenario.ts` aparece en el panel
 *    sin tocar este archivo. Las uniones (`oneOf`/`anyOf`) se dibujan como un selector de
 *    variante más el cuerpo de la elegida: es lo que hace que las 14 distribuciones funcionen
 *    con un solo control, y lo que hará que `resources[pool].capacity` soporte la forma
 *    `number | Array<{calendar, capacity}>` de LILA-164 el día que entre, sin código nuevo.
 *
 * 2. **Se edita el delta, no el resuelto** (`docs/SCENARIO_FORMAT.md` § 6). El panel enseña
 *    siempre el escenario **resuelto** (`resolveExtends`, o sea con los valores heredados del
 *    padre) y escribe cada cambio en el archivo hijo. Borrar un campo que el padre define
 *    escribe `null` —que es como § 6 dice "borra"—; borrar uno que solo estaba en el hijo lo
 *    quita del hijo. Cualquier cambio **dentro de un array** (los `intervals` de un calendario,
 *    los `resources` de una tarea, los `points` de una `user`) escribe el array **entero** en el
 *    delta: § 6 dice que los arrays se reemplazan enteros, así que un `[2]` suelto en el hijo no
 *    significaría nada.
 *
 * 3. **La escritura nunca se bloquea.** Un valor inválido se marca junto al campo con el texto
 *    del validador (zod para el esquema, `validateScenario` para las reglas R3…R14 contra el IR)
 *    y se cuenta en la cabecera, pero se escribe igual y «Guardar» sigue habilitado: es la
 *    aceptación literal del ticket. Guardar es explícito y no automático porque en `BrowserStore`
 *    `putScenario` **descarga un archivo**: guardar en cada tecla sería una descarga por tecla.
 *    El escenario que simula la app es el editado en el panel, sin necesidad de guardar.
 *
 * 4. **Lo que se ofrece depende de lo seleccionado** (#332). El esquema dice qué campos existen;
 *    el **IR** dice cuáles significan algo en el elemento que hay marcado en el lienzo, y es la
 *    tabla de `scenarioFields.ts` (la columna "Applies to" de § 2.5) la que decide cuáles se
 *    dibujan. Una compuerta no tiene campos propios: lo que se parametriza son las
 *    probabilidades de sus salientes, y eso es una vista distinta del mismo
 *    `elements[flowId].probability`. Las duraciones se teclean en `run.baseTimeUnit` y se
 *    guardan en segundos (R1, R2), y `run.start` se compone de una fecha y un desfase (R8).
 *    El JSON crudo sigue estando, plegado al final: es la vista avanzada, no la principal.
 */
import { Fragment, useMemo, useState } from 'react';

import type { ProcessIR } from '@lila/engine';
import {
  parseScenario,
  resolveExtends,
  resolveScenarioPath,
  toJsonSchema,
  validateScenario,
  type ScenarioReader,
} from '@lila/engine/schema';

import { CalendarEditor, tieneMinutos, type Intervalo } from './CalendarEditor.js';
import { LaneAssign } from './LaneAssign.js';
import {
  DESFASES,
  aSegundos,
  aUnidad,
  componerInstante,
  esTiempoEnSegundos,
  esUnidadTiempo,
  fieldsForKind,
  partesInstante,
  type ClaseElemento,
  type UnidadTiempo,
} from './scenarioFields.js';
import { getLocale, strings, useLocale, useStrings, type Locale } from './i18n';

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
function esRegistro(esquema: EsquemaJson): boolean {
  return (
    esquema.type === 'object' &&
    esquema.properties === undefined &&
    typeof esquema.additionalProperties === 'object'
  );
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Tipo JSON del valor, con el vocabulario del schema (`integer` no se distingue de `number`). */
function tipoJson(valor: unknown): string | undefined {
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
  return validateScenario(parsed.data, ir, { locale }).map((problema) => ({
    ruta: problema.path,
    mensaje: problema.message,
    severidad: problema.severity,
  }));
}

function porRuta(problemas: readonly Problema[]): Map<string, Problema[]> {
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
): { archivo: string; escenario: Record<string, unknown> } {
  const S = strings();
  const base = archivo.replace(/\.scenario\.json$/, '');
  const nombre = typeof escenario['name'] === 'string' ? escenario['name'] : base;
  // § 6: `extends` se resuelve **relativo al archivo del hijo**, y la copia vive en el mismo
  // directorio que el original. Con la ruta entera dentro, `escenarios/x` acaba buscando a su
  // padre en `escenarios/escenarios/x` y la cadena se rompe en cuanto hay carpetas.
  const vecino = archivo.slice(archivo.lastIndexOf('/') + 1);
  return {
    archivo: `${base}${S.escenario.sufijoCopia}.scenario.json`,
    escenario: { version: 1, name: `${nombre}${S.escenario.sufijoCopia}`, extends: vecino },
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
   * Varias ediciones en **una sola** escritura del delta (LILA-334). `editar` una por una
   * funcionaría en la app —cada llamada trae el delta nuevo por props— pero no en un anfitrión
   * que agrupe los cambios, y dejaría trece pasos de deshacer donde la acción fue una. Las rutas
   * no llevan índice de array: quien escribe una lista entera (los `resources` de una tarea) pasa
   * el array completo como valor, que es lo que § 6 dice de los arrays.
   */
  editarVarios?(cambios: readonly { ruta: Ruta; valor: unknown }[]): void;
}

function Problemas({ ruta, ctx }: { ruta: Ruta; ctx: Contexto }): React.JSX.Element | null {
  const lista = ctx.problemas.get(rutaTexto(ruta));
  if (lista === undefined) return null;
  return (
    <>
      {lista.map((problema, i) => (
        <p
          key={i}
          role={problema.severidad === 'error' ? 'alert' : undefined}
          className={problema.severidad === 'error' ? 'error' : 'aviso'}
        >
          {problema.mensaje}
        </p>
      ))}
    </>
  );
}

/**
 * Entrada de número con buffer de texto: mientras se escribe, `"0."` o `"1e"` no son números y
 * un `input[type=number]` los reporta como cadena vacía, o sea borraría el campo a media tecla.
 * Se guarda el texto tal cual hasta el `blur`; lo que no es número finito se escribe como texto
 * y lo marca el validador (la escritura no se bloquea nunca).
 *
 * With `unidad` (#332) the field is a **duration**: it is shown and typed in `run.baseTimeUnit`
 * and written to the file in seconds, which is the only unit the format knows (R1, R2). The text
 * buffer is what keeps the conversion from fighting the keyboard: while typing, what is on screen
 * is what was typed, not the round trip through seconds.
 */
function EntradaNumero({
  valor,
  ruta,
  ctx,
  id,
  unidad,
}: {
  valor: unknown;
  ruta: Ruta;
  ctx: Contexto;
  id: string;
  unidad?: UnidadTiempo | null;
}): React.JSX.Element {
  const [texto, setTexto] = useState<string | null>(null);
  const enPantalla = unidad != null && typeof valor === 'number' ? aUnidad(valor, unidad) : valor;
  const mostrado =
    texto ?? (enPantalla === undefined || enPantalla === null ? '' : String(enPantalla));
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={mostrado}
      onChange={(e) => {
        const bruto = e.target.value;
        setTexto(bruto);
        const limpio = bruto.trim();
        if (limpio === '') ctx.quitar(ruta);
        else {
          const numero = Number(limpio);
          if (!Number.isFinite(numero)) ctx.editar(ruta, limpio);
          else ctx.editar(ruta, unidad == null ? numero : aSegundos(numero, unidad));
        }
      }}
      onBlur={() => {
        setTexto(null);
      }}
    />
  );
}

/** `run.baseTimeUnit` del escenario resuelto, o `'s'`: la unidad en que se enseñan los tiempos. */
function unidadBase(ctx: Contexto): UnidadTiempo {
  const run = ctx.resuelto['run'];
  const unidad = esObjeto(run) ? run['baseTimeUnit'] : undefined;
  return esUnidadTiempo(unidad) ? unidad : 's';
}

/* ------------------------------------------------------------------ *
 * Campos reservados (§ 4): priority, preempt, batch, conditions, holidays, timezone.
 * ------------------------------------------------------------------ */

type EstadoReservado = 'ausente' | 'heredado' | 'propio' | 'eliminado';

/**
 * `heredado`: el padre lo define y el hijo no lo toca. `propio`: el hijo trae su propio valor
 * (incluida una `null` explícita heredada de más arriba en la cadena, que ya no se distingue del
 * padre inmediato). `eliminado`: el hijo escribió `null` para borrar lo que el padre define.
 * `ausente`: no hay valor en ningún lado, nada que enseñar.
 */
function estadoReservado(ctx: Contexto, ruta: Ruta): EstadoReservado {
  const enDelta = ctx.delta === undefined ? undefined : leer(ctx.delta, ruta);
  if (enDelta === null) return 'eliminado';
  if (enDelta !== undefined) return 'propio';
  const enPadre = ctx.padre == null ? undefined : leer(ctx.padre, ruta);
  return enPadre === undefined ? 'ausente' : 'heredado';
}

/**
 * El reservado (§ 4): sin editor —el motor lo rechaza con error en v1, así que el panel no ofrece
 * forma de crearlo— pero con el estado heredado/propio/eliminado y el botón para borrarlo, que es
 * lo único que LILA-061/§ 6 pide de un campo que solo puede venir del padre.
 */
function CampoReservado({ ruta, etiqueta, ctx }: { ruta: Ruta; etiqueta: string; ctx: Contexto }): React.JSX.Element | null {
  const S = useStrings();
  const estado = estadoReservado(ctx, ruta);
  if (estado === 'ausente') return null;
  const definidoEnPadre = ctx.padre != null && leer(ctx.padre, ruta) !== undefined;
  const valorMostrado =
    estado === 'propio' ? leer(ctx.delta ?? {}, ruta) : leer(ctx.padre ?? {}, ruta);
  return (
    <div className="campo-schema campo-reservado">
      <span className="etiqueta">{etiqueta}</span>
      <span className={`estado estado-${estado}`}>
        {estado === 'eliminado'
          ? S.escenario.eliminadoNull
          : S.escenario.estadoReservado(estado, JSON.stringify(valorMostrado))}
      </span>
      {estado === 'eliminado' ? (
        <button
          type="button"
          className="enlace"
          onClick={() => {
            ctx.restaurar?.(ruta);
          }}
        >
          {S.escenario.restaurarHeredado}
        </button>
      ) : (
        <button
          type="button"
          className="enlace"
          onClick={() => {
            ctx.quitar(ruta);
          }}
        >
          {definidoEnPadre ? S.escenario.quitarHeredado : S.escenario.quitar}
        </button>
      )}
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * `resources[pool].capacity` (LILA-164): Fija (número) o Por turno (lista de tramos).
 * ------------------------------------------------------------------ */

/** `['resources', <id>, 'capacity']` con una unión: la forma exacta que produce `ResourceSchema`. */
function esCapacidadRecurso(ruta: Ruta, esquema: EsquemaJson): boolean {
  return (
    ruta.length === 3 &&
    ruta[0] === 'resources' &&
    ruta[2] === 'capacity' &&
    variantes(esquema) !== null
  );
}

/**
 * Selector Fija/Por turno + el cuerpo de la variante activa. A diferencia del selector genérico
 * de uniones (`vars !== null` en `Campo`), este conserva el id `campo-resources.<id>.capacity`
 * para la variante numérica —es el id que cita el ticket y el que ya usaba el campo antes de que
 * `capacity` admitiera tramos— y dibuja cada tramo como `{ calendar: <select>, capacity: <nº> }`
 * en vez de un formulario genérico, porque `calendar` tiene que ofrecer los ids ya declarados en
 * `calendars`, no una caja de texto libre.
 */
function CampoCapacidadRecurso({
  esquema,
  ruta,
  ctx,
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const vars = variantes(esquema)!;
  const indiceFija = vars.findIndex((v) => v.type !== 'array');
  const indiceTurno = vars.findIndex((v) => v.type === 'array');
  const valor = leer(ctx.resuelto, ruta);
  const porTurno = Array.isArray(valor);
  const idFija = `campo-${rutaTexto(ruta)}`;
  const idVariante = `${idFija}-variante`;
  const calendarios = esObjeto(ctx.resuelto['calendars'])
    ? Object.keys(ctx.resuelto['calendars'] as Record<string, unknown>)
    : [];

  return (
    <div className="campo-schema">
      <label htmlFor={idVariante}>{S.escenario.claves.capacity}</label>
      <select
        id={idVariante}
        value={porTurno ? 'turno' : 'fija'}
        onChange={(e) => {
          if (e.target.value === 'fija' && indiceFija >= 0) ctx.editar(ruta, valorVacio(vars[indiceFija]!));
          else if (indiceTurno >= 0) ctx.editar(ruta, valorVacio(vars[indiceTurno]!));
        }}
      >
        <option value="fija">{S.escenario.capacidadFija}</option>
        <option value="turno">{S.escenario.capacidadPorTurno}</option>
      </select>
      <Problemas ruta={ruta} ctx={ctx} />
      {porTurno ? (
        <div className="anidado">
          {(valor as unknown[]).map((_, i) => {
            const rutaTramo = [...ruta, i] as Ruta;
            const rutaCalendar = [...rutaTramo, 'calendar'] as Ruta;
            const rutaCapacidad = [...rutaTramo, 'capacity'] as Ruta;
            const idCalendar = `campo-${rutaTexto(rutaCalendar)}`;
            const idCapacidad = `campo-${rutaTexto(rutaCapacidad)}`;
            const calendarElegido = leer(ctx.resuelto, rutaCalendar);
            const opciones =
              typeof calendarElegido === 'string' && !calendarios.includes(calendarElegido)
                ? [calendarElegido, ...calendarios]
                : calendarios;
            return (
              <fieldset key={i} className="entrada">
                <legend>
                  {S.escenario.tramo(i + 1)}
                  <button
                    type="button"
                    className="enlace"
                    aria-label={S.escenario.quitarTramo(i + 1)}
                    onClick={() => {
                      ctx.quitar(rutaTramo);
                    }}
                  >
                    {S.escenario.quitarElemento}
                  </button>
                </legend>
                <label htmlFor={idCalendar}>{S.escenario.claves.calendar}</label>
                <select
                  id={idCalendar}
                  value={typeof calendarElegido === 'string' ? calendarElegido : ''}
                  onChange={(e) => {
                    ctx.editar(rutaCalendar, e.target.value);
                  }}
                >
                  <option value="">{S.escenario.sinDefinir}</option>
                  {opciones.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <label htmlFor={idCapacidad}>{S.escenario.claves.capacity}</label>
                <EntradaNumero
                  valor={leer(ctx.resuelto, rutaCapacidad)}
                  ruta={rutaCapacidad}
                  ctx={ctx}
                  id={idCapacidad}
                />
                <Problemas ruta={rutaTramo} ctx={ctx} />
              </fieldset>
            );
          })}
          <button
            type="button"
            className="boton"
            onClick={() => {
              const esquemaItem = indiceTurno >= 0 ? (vars[indiceTurno]!.items ?? {}) : {};
              ctx.editar([...ruta, (valor as unknown[]).length], valorVacio(esquemaItem));
            }}
          >
            {S.escenario.anadirTramo}
          </button>
          <Problemas ruta={ruta} ctx={ctx} />
        </div>
      ) : (
        <EntradaNumero valor={valor} ruta={ruta} ctx={ctx} id={idFija} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * `calendars[clave].intervals` (LILA-203): rejilla semanal o lista
 * ------------------------------------------------------------------ */

/** `['calendars', <clave>, 'intervals']`: la única ruta donde la rejilla semanal significa algo. */
function esIntervalosCalendario(ruta: Ruta): boolean {
  return ruta.length === 3 && ruta[0] === 'calendars' && ruta[2] === 'intervals';
}

/**
 * La rejilla del artboard 3 más el interruptor a la lista genérica del esquema.
 *
 * La rejilla es una vista **parcial** del formato —su celda es una hora entera y § 2.3 admite
 * cualquier `"HH:MM"`—, así que un calendario con franjas de minutos se edita solo como lista, con
 * el aviso: redondearlo para poder dibujarlo sería cambiar el escenario por enseñarlo.
 *
 * ponytail: la lista se dibuja llamando al mismo `Campo` con un `sufijo`, que es lo que corta la
 * recursión (la intercepción de arriba solo mira el campo sin sufijo). Un `Campo` que ya sabe
 * dibujar arrays de objetos desde el esquema no se duplica aquí por tener dos vistas.
 */
function CampoIntervalos({
  esquema,
  ruta,
  ctx,
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const [rejilla, setRejilla] = useState(true);
  const valor = leer(ctx.resuelto, ruta);
  const intervals = (Array.isArray(valor) ? valor : []) as Intervalo[];
  const conMinutos = tieneMinutos(intervals);
  const enRejilla = rejilla && !conMinutos;
  return (
    <div className="campo-schema">
      <span className="etiqueta">{S.escenario.claves.intervals}</span>
      {conMinutos ? (
        <p className="aviso">{S.escenario.calendarioConMinutos}</p>
      ) : (
        <button
          type="button"
          className="enlace"
          onClick={() => {
            setRejilla(!rejilla);
          }}
        >
          {enRejilla ? S.escenario.editarComoLista : S.escenario.editarComoRejilla}
        </button>
      )}
      {enRejilla ? (
        <>
          <CalendarEditor
            intervals={intervals}
            onCambio={(nuevos) => {
              // § 6: el array entero en el delta, siempre; un intervalo suelto no significaría nada.
              ctx.editar(ruta, nuevos);
            }}
          />
          <Problemas ruta={ruta} ctx={ctx} />
        </>
      ) : (
        <Campo esquema={esquema} ruta={ruta} etiqueta="intervals" requerido ctx={ctx} sufijo="-lista" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * #332: las referencias a otra sección del escenario, como selector
 * ------------------------------------------------------------------ */

/** `elements[id].resources[i].ref`: la clave tiene que existir en `resources` (R9). */
function esRefRecurso(ruta: Ruta): boolean {
  return ruta.length === 5 && ruta[0] === 'elements' && ruta[2] === 'resources' && ruta[4] === 'ref';
}

/** `elements[id].calendar` y `resources[pool].calendar`: la clave existe en `calendars` (R9). */
function esRefCalendario(ruta: Ruta): boolean {
  return (
    ruta.length === 3 &&
    (ruta[0] === 'elements' || ruta[0] === 'resources') &&
    ruta[2] === 'calendar'
  );
}

/**
 * Una referencia a una clave de otra sección, dibujada como selector de lo ya declarado.
 *
 * Escrita a mano —que es como estaba— cualquier errata sale del panel como un `E-REF-DESCONOCIDA`
 * a posteriori, y no hay forma de saber desde el campo qué grupos o calendarios existen. Un valor
 * que no está entre las claves se conserva como opción extra: si el escenario ya trae una
 * referencia rota hay que poder verla y borrarla, no que el control la cambie sola.
 */
function CampoClave({
  ruta,
  etiqueta,
  seccion,
  ctx,
}: {
  ruta: Ruta;
  etiqueta: string;
  seccion: 'resources' | 'calendars';
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const id = `campo-${rutaTexto(ruta)}`;
  const valor = leer(ctx.resuelto, ruta);
  const declaradas = esObjeto(ctx.resuelto[seccion]) ? Object.keys(ctx.resuelto[seccion]) : [];
  const opciones =
    typeof valor === 'string' && valor !== '' && !declaradas.includes(valor)
      ? [valor, ...declaradas]
      : declaradas;
  return (
    <div className="campo-schema">
      <label htmlFor={id}>{etiqueta}</label>
      <select
        id={id}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(e) => {
          if (e.target.value === '') ctx.quitar(ruta);
          else ctx.editar(ruta, e.target.value);
        }}
      >
        <option value="">{S.escenario.sinDefinir}</option>
        {opciones.map((clave) => (
          <option key={clave} value={clave}>
            {clave}
          </option>
        ))}
      </select>
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * #332: `run.start` (R8), con fecha y desfase en vez de un ISO a mano
 * ------------------------------------------------------------------ */

function esInstanteDeCorrida(ruta: Ruta): boolean {
  return ruta.length === 2 && ruta[0] === 'run' && ruta[1] === 'start';
}

/**
 * `YYYY-MM-DDTHH:MM:SS±HH:MM` compuesto por un `datetime-local` y el desfase UTC.
 *
 * El desfase no es decorativo: R8 lo exige y es lo que fija la zona en que se leen los calendarios
 * (§ 2.3). Se guarda aparte en estado local para que elegirlo **antes** de la fecha no se pierda;
 * sin fecha no hay nada que escribir, porque medio instante no pasa el esquema.
 *
 * Un valor que no encaja en ese molde no llega aquí: `Campo` cae a la entrada de texto, que es la
 * única forma de arreglar a mano un `start` escrito por otra herramienta.
 */
function CampoInstante({
  ruta,
  etiqueta,
  ctx,
}: {
  ruta: Ruta;
  etiqueta: string;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const valor = leer(ctx.resuelto, ruta);
  const partes = partesInstante(valor);
  const [desfaseLocal, setDesfaseLocal] = useState<string | null>(null);
  const desfase = partes?.desfase ?? desfaseLocal ?? '+00:00';
  const fechaHora = partes?.fechaHora ?? '';
  const id = `campo-${rutaTexto(ruta)}`;
  const idDesfase = `${id}-desfase`;
  return (
    <div className="campo-schema">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type="datetime-local"
        step="1"
        value={fechaHora}
        onChange={(e) => {
          if (e.target.value === '') ctx.quitar(ruta);
          else ctx.editar(ruta, componerInstante(e.target.value, desfase));
        }}
      />
      <label htmlFor={idDesfase}>{S.escenario.desfase}</label>
      <select
        id={idDesfase}
        value={desfase}
        onChange={(e) => {
          setDesfaseLocal(e.target.value);
          if (fechaHora !== '') ctx.editar(ruta, componerInstante(fechaHora, e.target.value));
        }}
      >
        {DESFASES.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/**
 * Las propiedades de un objeto, saltándose los `const` (los enseña el selector de variante).
 *
 * `visibles` (#332) es la columna "Applies to" de § 2.5: con ella, una tarea deja de ofrecer
 * `interTriggerTimer` y un flujo deja de ofrecer `processingTime`. Lo que **ya está escrito** en
 * el escenario se enseña aunque no aplique, con su error del linter al lado: si no, un campo mal
 * puesto se volvería invisible y no habría forma de borrarlo desde el panel.
 *
 * El rótulo sale del catálogo (`S.escenario.campos`); una clave sin traducir se rotula con su
 * propio nombre, que es como estaba todo antes de este ticket.
 */
function Propiedades({
  esquema,
  ruta,
  ctx,
  visibles,
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
  visibles?: readonly string[] | null;
}): React.JSX.Element {
  const S = useStrings();
  const requeridos = new Set(esquema.required ?? []);
  return (
    <>
      {Object.entries(esquema.properties ?? {})
        .filter(([, sub]) => sub.const === undefined)
        .filter(
          ([clave]) =>
            visibles == null ||
            visibles.includes(clave) ||
            leer(ctx.resuelto, [...ruta, clave]) !== undefined,
        )
        .map(([clave, sub]) => (
          <Fragment key={clave}>
            <Campo
              esquema={sub}
              ruta={[...ruta, clave]}
              etiqueta={S.escenario.campos[clave] ?? clave}
              requerido={requeridos.has(clave)}
              ctx={ctx}
            />
            {S.escenario.ayudas[clave] !== undefined && (
              <p className="ayuda">{S.escenario.ayudas[clave]}</p>
            )}
          </Fragment>
        ))}
    </>
  );
}

/**
 * Añadir una clave a un registro (`calendars`, `resources`, `elements`).
 *
 * Una clave repetida se rechaza en vez de escribirse: `valorVacio` produce el objeto **mínimo**
 * del esquema, así que escribirlo encima del recurso que ya existe se llevaba por delante su
 * nombre, su coste y su calendario sin decir nada.
 */
function AnadirClave({
  onAnadir,
  existe,
}: {
  onAnadir: (clave: string) => void;
  existe: (clave: string) => boolean;
}): React.JSX.Element {
  const S = useStrings();
  const [clave, setClave] = useState('');
  const repetida = clave.trim() !== '' && existe(clave.trim());
  return (
    <div className="anadir">
      <input
        type="text"
        aria-label={S.escenario.claveNueva}
        aria-invalid={repetida ? true : undefined}
        value={clave}
        onChange={(e) => {
          setClave(e.target.value);
        }}
      />
      <button
        type="button"
        className="boton"
        onClick={() => {
          const limpia = clave.trim();
          if (limpia === '' || existe(limpia)) return;
          onAnadir(limpia);
          setClave('');
        }}
      >
        {S.escenario.anadir}
      </button>
      {repetida && (
        <p role="alert" className="error">
          {S.escenario.claveRepetida(clave.trim())}
        </p>
      )}
    </div>
  );
}

/**
 * Un campo del formulario, dibujado a partir de su sub-esquema. Es la única función que sabe
 * traducir JSON Schema a controles, y se llama a sí misma para objetos, arrays y registros.
 */
export function Campo({
  esquema,
  ruta,
  etiqueta,
  requerido,
  ctx,
  sufijo = '',
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  etiqueta: string;
  requerido: boolean;
  ctx: Contexto;
  /**
   * Distingue dos controles que editan la **misma** ruta: el selector de variante de una unión
   * y, si la variante elegida es escalar, la entrada de su valor. Sin esto los dos tendrían el
   * mismo `id` y el `<label>` apuntaría al primero.
   */
  sufijo?: string;
}): React.JSX.Element | null {
  const S = useStrings();
  const valor = leer(ctx.resuelto, ruta);
  const id = `campo-${rutaTexto(ruta)}${sufijo}`;

  // `resources[pool].capacity` (LILA-164): antes de caer al selector genérico de uniones, porque
  // necesita conservar el id de la variante numérica y dibujar `calendar` como un select de los
  // calendarios ya declarados, no como el formulario genérico de un `{calendar, capacity}` suelto.
  if (esCapacidadRecurso(ruta, esquema)) {
    return <CampoCapacidadRecurso esquema={esquema} ruta={ruta} ctx={ctx} />;
  }

  // `calendars[clave].intervals` (LILA-203): la rejilla semanal en vez de la lista genérica de
  // objetos. El `sufijo` corta la recursión: la vista de lista vuelve a entrar aquí ya marcada.
  if (sufijo === '' && esIntervalosCalendario(ruta)) {
    return <CampoIntervalos esquema={esquema} ruta={ruta} ctx={ctx} />;
  }

  // #332: las dos referencias del formato (R9) como selector de lo ya declarado, y `run.start`
  // (R8) como fecha + desfase. Un `start` que no encaje en el molde ISO cae a la entrada de texto
  // de más abajo, que es la única forma de arreglar a mano lo que escribió otra herramienta.
  if (esRefRecurso(ruta)) {
    return <CampoClave ruta={ruta} etiqueta={etiqueta} seccion="resources" ctx={ctx} />;
  }
  if (esRefCalendario(ruta)) {
    return <CampoClave ruta={ruta} etiqueta={etiqueta} seccion="calendars" ctx={ctx} />;
  }
  if (esInstanteDeCorrida(ruta) && (valor === undefined || partesInstante(valor) !== null)) {
    return <CampoInstante ruta={ruta} etiqueta={etiqueta} ctx={ctx} />;
  }

  // Unión: selector de variante + cuerpo de la elegida. Con esto las 14 distribuciones y la
  // `capacity` de LILA-164 salen del esquema sin una línea de código por caso.
  const vars = variantes(esquema);
  if (vars !== null) {
    const indice = indiceVariante(valor, vars);
    const elegida = indice >= 0 ? vars[indice] : undefined;
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <select
          id={id}
          value={String(indice)}
          onChange={(e) => {
            const nuevo = Number(e.target.value);
            if (nuevo < 0) ctx.quitar(ruta);
            else ctx.editar(ruta, valorVacio(vars[nuevo]!));
          }}
        >
          <option value="-1">{S.escenario.sinDefinir}</option>
          {vars.map((variante, i) => (
            <option key={i} value={String(i)}>
              {etiquetaVariante(variante, i)}
            </option>
          ))}
        </select>
        <Problemas ruta={ruta} ctx={ctx} />
        {elegida !== undefined &&
          (elegida.type === 'object' ? (
            <div className="anidado">
              <Propiedades esquema={elegida} ruta={ruta} ctx={ctx} />
            </div>
          ) : (
            <div className="anidado">
              <Campo
                esquema={elegida}
                ruta={ruta}
                etiqueta={etiqueta}
                requerido
                ctx={ctx}
                sufijo="-valor"
              />
            </div>
          ))}
      </div>
    );
  }

  if (esquema.enum !== undefined) {
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <select
          id={id}
          value={valor === undefined ? '' : String(valor)}
          onChange={(e) => {
            if (e.target.value === '') ctx.quitar(ruta);
            else ctx.editar(ruta, e.target.value);
          }}
        >
          <option value="">{S.escenario.sinDefinir}</option>
          {esquema.enum.map((opcion) => (
            <option key={String(opcion)} value={String(opcion)}>
              {String(opcion)}
            </option>
          ))}
        </select>
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esRegistro(esquema)) {
    const entrada = esquemaEntrada(esquema);
    const claves = esObjeto(valor) ? Object.keys(valor) : [];
    return (
      <div className="campo-schema">
        {claves.map((clave) => (
          <fieldset key={clave} className="entrada">
            <legend>
              {clave}
              <button
                type="button"
                className="enlace"
                aria-label={S.escenario.quitarClave(clave)}
                onClick={() => {
                  ctx.quitar([...ruta, clave]);
                }}
              >
                {S.escenario.quitarElemento}
              </button>
            </legend>
            <Propiedades esquema={entrada} ruta={[...ruta, clave]} ctx={ctx} />
            <Problemas ruta={[...ruta, clave]} ctx={ctx} />
          </fieldset>
        ))}
        <AnadirClave
          existe={(clave) => claves.includes(clave)}
          onAnadir={(clave) => {
            ctx.editar([...ruta, clave], valorVacio(entrada));
          }}
        />
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'array') {
    const items = esquema.items ?? {};
    const lista = Array.isArray(valor) ? valor : [];
    return (
      <div className="campo-schema">
        <span className="etiqueta">{etiqueta}</span>
        {lista.map((_, i) => (
          <div key={i} className="anidado">
            {items.type === 'object' && items.properties !== undefined ? (
              <Propiedades esquema={items} ruta={[...ruta, i]} ctx={ctx} />
            ) : (
              <Campo
                esquema={items}
                ruta={[...ruta, i]}
                etiqueta={S.escenario.itemNumerado(etiqueta, i + 1)}
                requerido
                ctx={ctx}
              />
            )}
            <button
              type="button"
              className="enlace"
              aria-label={S.escenario.quitarItem(etiqueta, i + 1)}
              onClick={() => {
                ctx.quitar([...ruta, i]);
              }}
            >
              {S.escenario.quitarElemento}
            </button>
            <Problemas ruta={[...ruta, i]} ctx={ctx} />
          </div>
        ))}
        <button
          type="button"
          className="boton"
          onClick={() => {
            ctx.editar([...ruta, lista.length], valorVacio(items));
          }}
        >
          {S.escenario.anadirEtiqueta(etiqueta)}
        </button>
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'object') {
    return (
      <fieldset className="entrada">
        <legend>{etiqueta}</legend>
        <Propiedades esquema={esquema} ruta={ruta} ctx={ctx} />
        <Problemas ruta={ruta} ctx={ctx} />
      </fieldset>
    );
  }

  if (esquema.type === 'boolean') {
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <input
          id={id}
          type="checkbox"
          checked={valor === true}
          onChange={(e) => {
            ctx.editar(ruta, e.target.checked);
          }}
        />
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'number' || esquema.type === 'integer') {
    // #332: una duración se teclea en `run.baseTimeUnit` y se guarda en segundos (R1, R2); la
    // unidad se enseña al lado, que es lo único que distingue «5» de «5 minutos» en pantalla.
    const unidad = esTiempoEnSegundos(ruta) ? unidadBase(ctx) : null;
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <EntradaNumero valor={valor} ruta={ruta} ctx={ctx} id={id} unidad={unidad} />
        {unidad !== null && <span className="unidad">{S.escenario.unidades[unidad]}</span>}
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'string') {
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <input
          id={id}
          type="text"
          value={valor === undefined || valor === null ? '' : String(valor)}
          onChange={(e) => {
            if (e.target.value === '') ctx.quitar(ruta);
            else ctx.editar(ruta, e.target.value);
          }}
        />
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  // Esquema vacío (`{}`): los campos reservados de § 4 (`priority`, `preempt`, `batch`,
  // `conditions`, `holidays`, `timezone`). El motor los rechaza con error, así que el panel no
  // ofrece forma de crearlos, pero si llegan heredados o propios hace falta poder borrarlos
  // (OP-11): `CampoReservado` enseña el estado y el botón; el problema sigue saliendo también en
  // la cabecera vía `Problemas`.
  return <CampoReservado ruta={ruta} etiqueta={etiqueta} ctx={ctx} />;
}

/* ------------------------------------------------------------------ *
 * #332: la compuerta, con las probabilidades de sus salientes juntas
 * ------------------------------------------------------------------ */

/** La clase del elemento seleccionado: el tipo de nodo del IR, o `'flow'` si es un flujo. */
export function claseDeElemento(ir: ProcessIR | null, id: string | null): ClaseElemento | null {
  if (ir === null || id === null) return null;
  if (ir.flows[id] !== undefined) return 'flow';
  return ir.nodes[id]?.type ?? null;
}

/** Lo que se lee de un flujo: su nombre BPMN si lo tiene, y si no el de su destino; más el id. */
function rotuloFlujo(ir: ProcessIR, S: ReturnType<typeof useStrings>, id: string): string {
  const flujo = ir.flows[id];
  if (flujo === undefined) return id;
  const nombre = flujo.name !== '' ? flujo.name : (ir.nodes[flujo.to]?.name ?? '');
  return nombre === '' ? id : `${nombre}${S.escenario.nombreEntreParentesis(id)}`;
}

/**
 * La vista que hace de una compuerta algo que se parametriza desde el diagrama: sus flujos
 * salientes con su `probability`, la suma, y el aviso cuando no da 1.
 *
 * Sin ella la probabilidad de una rama solo se editaba seleccionando **el flujo**, que en el
 * lienzo es una línea de tres píxeles y que además obliga a recordar cuál es la otra rama para
 * que sumen. La ruta que se escribe es la misma de siempre (`elements[flowId].probability`): esto
 * es otra vista del mismo campo, no un campo nuevo.
 *
 * Solo para XOR e inclusiva: en una AND salen todos los caminos y la probabilidad no significa
 * nada (por eso `fieldsForKind` no la ofrece tampoco en el flujo… que sí la acepta, porque el
 * mismo flujo podría colgar de otra compuerta). La suma se avisa únicamente en la XOR, que es la
 * que R10 normaliza; en la inclusiva cada camino es independiente y no tiene que sumar 1.
 */
function VistaCompuerta({
  ir,
  id,
  clase,
  ctx,
}: {
  ir: ProcessIR;
  id: string;
  clase: ClaseElemento;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const salientes = ir.nodes[id]?.outgoing ?? [];
  if (salientes.length === 0) return <p className="vacio">{S.escenario.compuertaSinSalientes}</p>;

  // El `isDefault` se lleva el resto (R10): darle una casilla sería ofrecer un número que el
  // motor no mira. Por eso tampoco entra en la suma.
  const conValor = salientes.filter((f) => ir.flows[f]?.isDefault !== true);
  const suma = conValor.reduce((acc, f) => {
    const p = leer(ctx.resuelto, ['elements', f, 'probability']);
    return typeof p === 'number' ? acc + p : acc;
  }, 0);
  const algunaDeclarada = conValor.some(
    (f) => leer(ctx.resuelto, ['elements', f, 'probability']) !== undefined,
  );
  const redondeada = Math.round(suma * 1e6) / 1e6;

  return (
    <fieldset className="entrada">
      <legend>{S.escenario.seccionCompuerta}</legend>
      {salientes.map((flujo) => {
        const ruta: Ruta = ['elements', flujo, 'probability'];
        const idCampo = `campo-${rutaTexto(ruta)}`;
        if (ir.flows[flujo]?.isDefault === true) {
          return (
            <div key={flujo} className="campo-schema">
              <span className="etiqueta">{rotuloFlujo(ir, S, flujo)}</span>
              <span className="aviso">{S.escenario.compuertaPorDefecto}</span>
            </div>
          );
        }
        return (
          <div key={flujo} className="campo-schema">
            <label htmlFor={idCampo}>{rotuloFlujo(ir, S, flujo)}</label>
            <EntradaNumero
              valor={leer(ctx.resuelto, ruta)}
              ruta={ruta}
              ctx={ctx}
              id={idCampo}
            />
            <Problemas ruta={ruta} ctx={ctx} />
          </div>
        );
      })}
      <p className="etiqueta">{S.escenario.compuertaSuma(redondeada)}</p>
      {clase === 'xor'
        ? algunaDeclarada &&
          redondeada !== 1 && <p className="aviso">{S.escenario.compuertaSumaAviso}</p>
        : clase === 'or' && <p className="aviso">{S.escenario.compuertaIndependiente}</p>}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ *
 * #332: la vista avanzada, que es el JSON crudo del archivo en edición
 * ------------------------------------------------------------------ */

/**
 * El delta del archivo (§ 6) en un `<textarea>`, plegado y al final del panel.
 *
 * El formulario es la vista principal desde este ticket, pero el JSON no desaparece: es lo que
 * permite pegar un escenario entero, moverlo entre máquinas o tocar algo que el formulario
 * todavía no dibuja. Se aplica de golpe con el botón, no al teclear: un JSON a medio escribir no
 * parsea y aplicarlo en cada tecla borraría el escenario entre dos llaves.
 */
function VistaJson({
  delta,
  onAplicar,
}: {
  delta: Record<string, unknown>;
  onAplicar: (escenario: Record<string, unknown>) => void;
}): React.JSX.Element {
  const S = useStrings();
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mostrado = texto ?? JSON.stringify(delta, null, 2);
  return (
    <details>
      <summary>{S.escenario.seccionJson}</summary>
      <textarea
        className="json-escenario"
        aria-label={S.escenario.seccionJson}
        rows={16}
        value={mostrado}
        onChange={(e) => {
          setTexto(e.target.value);
          setError(null);
        }}
      />
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="boton"
        onClick={() => {
          let leido: unknown;
          try {
            leido = JSON.parse(mostrado);
          } catch (e) {
            setError(S.escenario.jsonInvalido(e instanceof Error ? e.message : String(e)));
            return;
          }
          if (!esObjeto(leido)) {
            setError(S.escenario.jsonNoEsObjeto);
            return;
          }
          setError(null);
          setTexto(null);
          onAplicar(leido);
        }}
      >
        {S.escenario.aplicarJson}
      </button>
    </details>
  );
}

/* ------------------------------------------------------------------ *
 * El panel
 * ------------------------------------------------------------------ */

export interface ScenarioPanelProps {
  /** Nombre de archivo del escenario en edición; es la clave que resuelve `extends`. */
  archivo: string;
  /** Escenarios disponibles por nombre de archivo, **sin resolver**. Incluye el que se edita. */
  escenarios: Readonly<Record<string, Record<string, unknown>>>;
  /** Cada cambio del panel, ya aplicado al delta del archivo en edición. */
  onCambio: (archivo: string, escenario: Record<string, unknown>) => void;
  /** «Guardar»: lo escribe el shell con `ProjectStore.putScenario`. Nunca se deshabilita. */
  onGuardar: () => void;
  /** «Duplicar»: el shell registra el nuevo archivo y lo selecciona. */
  onDuplicar: (archivo: string, escenario: Record<string, unknown>) => void;
  /** IR del diagrama del lienzo. `null` mientras no se haya parseado: solo se valida el esquema. */
  ir: ProcessIR | null;
  /** Id del elemento seleccionado en el lienzo, o `null`. */
  seleccion: string | null;
  onSeleccionar: (id: string | null) => void;
}

export function ScenarioPanel({
  archivo,
  escenarios,
  onCambio,
  onGuardar,
  onDuplicar,
  ir,
  seleccion,
  onSeleccionar,
}: ScenarioPanelProps): React.JSX.Element {
  const S = useStrings();
  // The engine takes the language as a value, not as a catalog: `useLocale()` is what makes the
  // memoised lint below recompute when the app switches language.
  const locale = useLocale();
  const delta = escenarios[archivo] ?? {};

  const lector = useMemo<ScenarioReader>(
    () => (ruta) => {
      const encontrado = escenarios[ruta];
      if (encontrado === undefined) throw new Error(S.escenario.errorEscenarioDesconocido(ruta));
      return encontrado;
    },
    // `S` va en las dependencias porque el lector lo captura (LILA-210): `herencia` guarda el
    // mensaje que este lector lanzó, así que sin esto un `extends` roto se quedaría con el error
    // escrito en el idioma que hubiera al montar el panel. `useStrings()` devuelve un catálogo
    // distinto por idioma, así que la identidad solo cambia cuando el idioma cambia.
    [escenarios, S],
  );

  /**
   * Lo que se enseña: el escenario con `extends` ya aplicado (§ 6), y el fallo de la cadena si
   * la hay. Con la cadena rota (un padre que no existe, un ciclo) se sigue editando el archivo
   * tal cual —dejar el panel en blanco sería la única forma de no poder arreglarlo— pero el
   * fallo **se dice**: todo lo que la cabecera marca sobre un delta sin resolver (falta `run`,
   * falta `model`, elementos sin parámetros) es consecuencia de él y no de lo que se tecleó.
   */
  const herencia = useMemo<{ resuelto: Record<string, unknown>; error: string | null }>(() => {
    try {
      return { resuelto: resolveExtends(archivo, lector), error: null };
    } catch (e) {
      return { resuelto: delta, error: e instanceof Error ? e.message : String(e) };
    }
  }, [archivo, lector, delta]);
  const resuelto = herencia.resuelto;

  /** El padre resuelto, para saber si borrar un campo es `null` (§ 6) o quitarlo del hijo. */
  const padre = useMemo<Record<string, unknown> | null>(() => {
    const referencia = delta['extends'];
    if (typeof referencia !== 'string') return null;
    try {
      return resolveExtends(resolveScenarioPath(archivo, referencia), lector);
    } catch {
      return null;
    }
  }, [archivo, delta, lector]);

  const problemas = useMemo(() => {
    const propios = problemasEscenario(resuelto, ir, locale);
    if (herencia.error === null) return propios;
    return [
      { ruta: 'extends', mensaje: herencia.error, severidad: 'error' as const },
      ...propios,
    ];
    // `locale` is a dependency because the messages cached here are the engine's: without it the
    // list would keep the language it was linted in until the scenario or the IR changed.
  }, [resuelto, ir, herencia.error, locale]);
  const indice = useMemo(() => porRuta(problemas), [problemas]);
  const errores = problemas.filter((p) => p.severidad === 'error').length;
  const avisos = problemas.length - errores;

  /** Primer segmento numérico: a partir de ahí el delta guarda el array entero (§ 6). */
  function baseDeArray(ruta: Ruta): number {
    return ruta.findIndex((seg) => typeof seg === 'number');
  }

  const ctx: Contexto = {
    resuelto,
    problemas: indice,
    delta,
    padre,
    restaurar(ruta) {
      // Deshace el `null` propio del reservado eliminado: se quita del hijo, no se reescribe.
      onCambio(archivo, borrar(delta, ruta));
    },
    editar(ruta, valor) {
      const corte = baseDeArray(ruta);
      if (corte === -1) {
        // § 6: lo que el padre define y el valor nuevo no trae hay que borrarlo con `null`, o el
        // merge profundo lo deja pegado (cambiar de variante de distribución, sobre todo).
        onCambio(archivo, escribir(delta, ruta, conBorrados(valor, leer(padre, ruta))));
        return;
      }
      const base = ruta.slice(0, corte);
      const arreglo = escribir(leer(resuelto, base), ruta.slice(corte), valor);
      onCambio(archivo, escribir(delta, base, arreglo));
    },
    editarVarios(cambios) {
      let siguiente = delta;
      for (const { ruta, valor } of cambios) siguiente = escribir(siguiente, ruta, valor);
      onCambio(archivo, siguiente);
    },
    quitar(ruta) {
      const corte = baseDeArray(ruta);
      if (corte !== -1) {
        const base = ruta.slice(0, corte);
        const arreglo = borrar(leer(resuelto, base), ruta.slice(corte));
        onCambio(archivo, escribir(delta, base, arreglo));
        return;
      }
      // § 6: `null` borra una clave que el padre define; lo que solo estaba en el hijo se quita.
      if (padre !== null && leer(padre, ruta) !== undefined) {
        onCambio(archivo, escribir(delta, ruta, null));
        return;
      }
      onCambio(archivo, borrar(delta, ruta));
    },
  };

  /**
   * El id con el que se edita: el del **IR**, que es la clave del escenario (R3). bpmn-js
   * selecciona con el id que traía el archivo, y para un id no-NCName —los que emite Bizagi— el
   * IR lo saneó (`source.originalIds`, el mismo mapa que usa el overlay de LILA-064). Sin
   * traducirlo, el panel escribía `elements["1Task"]` y el lint lo rechazaba con "no existe en
   * el modelo", sin ninguna forma de llegar al id bueno desde el lienzo.
   */
  const idSeleccionado = useMemo<string | null>(() => {
    if (seleccion === null || ir === null) return seleccion;
    if (ir.nodes[seleccion] !== undefined || ir.flows[seleccion] !== undefined) return seleccion;
    const enIr = Object.entries(ir.source.originalIds).find(([, original]) => original === seleccion);
    return enIr?.[0] ?? seleccion;
  }, [seleccion, ir]);

  /** Qué es lo seleccionado (#332): decide qué campos se ofrecen y si sale la vista de compuerta. */
  const clase = claseDeElemento(ir, idSeleccionado);

  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
  const heredaDe = typeof delta['extends'] === 'string' ? delta['extends'] : null;

  /**
   * El nombre BPMN del id, si el IR lo trae y no está vacío: `ir.nodes`/`ir.flows` ya lo dan sin
   * pedir nada nuevo a A (OP-13 conecta el `ir` vigente, este panel solo lo lee). `null` sin IR o
   * con un id que no aparece en él (el diagrama no se ha parseado, o el elemento ya no existe).
   *
   * Se enseña **junto** al botón que selecciona el id, no dentro de su texto: los gestos de test
   * seleccionan por el texto exacto del botón (`pulsar('Task_TomarPedido')`), y es también lo que
   * hace bpmn-js al resaltar el elemento del lienzo — el nombre es contexto para la persona, el id
   * sigue siendo la única clave que el resto del panel entiende.
   */
  function nombreElemento(id: string): string | null {
    const nombre = ir?.nodes[id]?.name ?? ir?.flows[id]?.name;
    return nombre !== undefined && nombre !== '' ? nombre : null;
  }

  return (
    <div className="escenario">
      <div className="escenario-cabecera">
        <strong>{typeof resuelto['name'] === 'string' ? resuelto['name'] : archivo}</strong>
        <span className={errores > 0 ? 'error' : 'aviso'}>
          {S.escenario.conteo(errores, avisos)}
        </span>
        <button type="button" className="boton" onClick={onGuardar}>
          {S.escenario.guardar}
        </button>
        <button
          type="button"
          className="boton"
          onClick={() => {
            const copia = duplicarEscenario(archivo, delta);
            onDuplicar(copia.archivo, copia.escenario);
          }}
        >
          {S.escenario.duplicar}
        </button>
      </div>

      {heredaDe !== null && (
        <p className="vacio">
          {S.escenario.hereda(heredaDe)}
        </p>
      )}
      <Problemas ruta={['extends']} ctx={ctx} />

      <details open>
        <summary>{S.escenario.seccionCorrida}</summary>
        <Propiedades esquema={esquemaDe('run')} ruta={['run']} ctx={ctx} />
        <Problemas ruta={['run']} ctx={ctx} />
      </details>

      <details>
        <summary>{S.escenario.seccionCalendarios}</summary>
        <Campo
          esquema={esquemaDe('calendars')}
          ruta={['calendars']}
          etiqueta="calendars"
          requerido={false}
          ctx={ctx}
        />
      </details>

      <details>
        <summary>{S.escenario.seccionRecursos}</summary>
        <Campo
          esquema={esquemaDe('resources')}
          ruta={['resources']}
          etiqueta="resources"
          requerido={false}
          ctx={ctx}
        />
        <LaneAssign ir={ir} ctx={ctx} />
      </details>

      <details open>
        <summary>{S.escenario.seccionElemento}</summary>
        {idSeleccionado === null ? (
          <ul className="ids">
            {Object.keys(elementos).map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="enlace"
                  onClick={() => {
                    onSeleccionar(id);
                  }}
                >
                  {id}
                </button>
                {nombreElemento(id) !== null && <span className="nombre"> {nombreElemento(id)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="vacio">
              {idSeleccionado}
              {nombreElemento(idSeleccionado) !== null &&
                S.escenario.nombreEntreParentesis(nombreElemento(idSeleccionado)!)}
            </p>
            <Propiedades
              esquema={esquemaEntrada(esquemaDe('elements'))}
              ruta={['elements', idSeleccionado]}
              ctx={ctx}
              visibles={fieldsForKind(clase)}
            />
            <Problemas ruta={['elements', idSeleccionado]} ctx={ctx} />
            {ir !== null && (clase === 'xor' || clase === 'or') && (
              <VistaCompuerta ir={ir} id={idSeleccionado} clase={clase} ctx={ctx} />
            )}
          </>
        )}
      </details>

      <VistaJson
        delta={delta}
        onAplicar={(escenario) => {
          onCambio(archivo, escenario);
        }}
      />

      {problemas.length > 0 && (
        <details>
          <summary>{S.escenario.seccionValidacion(errores)}</summary>
          <ul className="ids">
            {problemas.map((problema, i) => (
              <li key={i} className={problema.severidad === 'error' ? 'error' : 'aviso'}>
                {problema.mensaje}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
