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
 */
import { useMemo, useState } from 'react';

import type { ProcessIR } from '@lila/engine';
import {
  ScenarioSchema,
  resolveExtends,
  resolveScenarioPath,
  toJsonSchema,
  validateScenario,
  type ScenarioReader,
} from '@lila/engine/schema';

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

const TIPOS_ES: Readonly<Record<string, string>> = {
  string: 'texto',
  number: 'número',
  integer: 'número entero',
  boolean: 'sí/no',
  object: 'objeto',
  array: 'lista',
};

/** Etiqueta de una variante: su discriminador si lo tiene, y si no, su tipo JSON en español. */
export function etiquetaVariante(variante: EsquemaJson, indice: number): string {
  const discriminador = Object.values(variante.properties ?? {}).find(
    (sub) => typeof sub.const === 'string',
  );
  if (discriminador !== undefined) return String(discriminador.const);
  if (variante.type !== undefined) return TIPOS_ES[variante.type] ?? variante.type;
  return `opción ${indice + 1}`;
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
 */
export function problemasEscenario(resuelto: unknown, ir: ProcessIR | null): Problema[] {
  const parsed = ScenarioSchema.safeParse(resuelto);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      ruta: rutaTexto(issue.path as Ruta),
      mensaje: issue.message,
      severidad: 'error' as const,
    }));
  }
  if (ir === null) return [];
  return validateScenario(parsed.data, ir).map((problema) => ({
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
  const base = archivo.replace(/\.scenario\.json$/, '');
  const nombre = typeof escenario['name'] === 'string' ? escenario['name'] : base;
  // § 6: `extends` se resuelve **relativo al archivo del hijo**, y la copia vive en el mismo
  // directorio que el original. Con la ruta entera dentro, `escenarios/x` acaba buscando a su
  // padre en `escenarios/escenarios/x` y la cadena se rompe en cuanto hay carpetas.
  const vecino = archivo.slice(archivo.lastIndexOf('/') + 1);
  return {
    archivo: `${base} (copia).scenario.json`,
    escenario: { version: 1, name: `${nombre} (copia)`, extends: vecino },
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
 */
function EntradaNumero({
  valor,
  ruta,
  ctx,
  id,
}: {
  valor: unknown;
  ruta: Ruta;
  ctx: Contexto;
  id: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState<string | null>(null);
  const mostrado = texto ?? (valor === undefined || valor === null ? '' : String(valor));
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
          ctx.editar(ruta, Number.isFinite(numero) && limpio !== '' ? numero : limpio);
        }
      }}
      onBlur={() => {
        setTexto(null);
      }}
    />
  );
}

/** Las propiedades de un objeto, saltándose los `const` (los enseña el selector de variante). */
function Propiedades({
  esquema,
  ruta,
  ctx,
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
}): React.JSX.Element {
  const requeridos = new Set(esquema.required ?? []);
  return (
    <>
      {Object.entries(esquema.properties ?? {})
        .filter(([, sub]) => sub.const === undefined)
        .map(([clave, sub]) => (
          <Campo
            key={clave}
            esquema={sub}
            ruta={[...ruta, clave]}
            etiqueta={clave}
            requerido={requeridos.has(clave)}
            ctx={ctx}
          />
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
  const [clave, setClave] = useState('');
  const repetida = clave.trim() !== '' && existe(clave.trim());
  return (
    <div className="anadir">
      <input
        type="text"
        aria-label="clave nueva"
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
        Añadir
      </button>
      {repetida && (
        <p role="alert" className="error">
          {clave.trim()} ya existe; edítalo abajo o usa otro id.
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
  const valor = leer(ctx.resuelto, ruta);
  const id = `campo-${rutaTexto(ruta)}${sufijo}`;

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
          <option value="-1">(sin definir)</option>
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
          <option value="">(sin definir)</option>
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
                aria-label={`quitar ${clave}`}
                onClick={() => {
                  ctx.quitar([...ruta, clave]);
                }}
              >
                quitar
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
                etiqueta={`${etiqueta} ${i + 1}`}
                requerido
                ctx={ctx}
              />
            )}
            <button
              type="button"
              className="enlace"
              aria-label={`quitar ${etiqueta} ${i + 1}`}
              onClick={() => {
                ctx.quitar([...ruta, i]);
              }}
            >
              quitar
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
          Añadir {etiqueta}
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
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <EntradaNumero valor={valor} ruta={ruta} ctx={ctx} id={id} />
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
  // ofrece forma de crearlos; si llegan heredados, el problema sale en la cabecera.
  return null;
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
  const delta = escenarios[archivo] ?? {};

  const lector = useMemo<ScenarioReader>(
    () => (ruta) => {
      const encontrado = escenarios[ruta];
      if (encontrado === undefined) throw new Error(`escenario desconocido: ${ruta}`);
      return encontrado;
    },
    [escenarios],
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
    const propios = problemasEscenario(resuelto, ir);
    if (herencia.error === null) return propios;
    return [
      { ruta: 'extends', mensaje: herencia.error, severidad: 'error' as const },
      ...propios,
    ];
  }, [resuelto, ir, herencia.error]);
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

  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
  const heredaDe = typeof delta['extends'] === 'string' ? delta['extends'] : null;

  return (
    <div className="escenario">
      <div className="escenario-cabecera">
        <strong>{typeof resuelto['name'] === 'string' ? resuelto['name'] : archivo}</strong>
        <span className={errores > 0 ? 'error' : 'aviso'}>
          {errores} {errores === 1 ? 'error' : 'errores'} · {avisos}{' '}
          {avisos === 1 ? 'aviso' : 'avisos'}
        </span>
        <button type="button" className="boton" onClick={onGuardar}>
          Guardar
        </button>
        <button
          type="button"
          className="boton"
          onClick={() => {
            const copia = duplicarEscenario(archivo, delta);
            onDuplicar(copia.archivo, copia.escenario);
          }}
        >
          Duplicar
        </button>
      </div>

      {heredaDe !== null && (
        <p className="vacio">
          Hereda de {heredaDe}: se muestran los valores resueltos y se edita solo el delta.
        </p>
      )}
      <Problemas ruta={['extends']} ctx={ctx} />

      <details open>
        <summary>Corrida</summary>
        <Propiedades esquema={esquemaDe('run')} ruta={['run']} ctx={ctx} />
        <Problemas ruta={['run']} ctx={ctx} />
      </details>

      <details>
        <summary>Calendarios</summary>
        <Campo
          esquema={esquemaDe('calendars')}
          ruta={['calendars']}
          etiqueta="calendars"
          requerido={false}
          ctx={ctx}
        />
      </details>

      <details>
        <summary>Recursos</summary>
        <Campo
          esquema={esquemaDe('resources')}
          ruta={['resources']}
          etiqueta="resources"
          requerido={false}
          ctx={ctx}
        />
      </details>

      <details open>
        <summary>Elemento seleccionado</summary>
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
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="vacio">{idSeleccionado}</p>
            <Propiedades
              esquema={esquemaEntrada(esquemaDe('elements'))}
              ruta={['elements', idSeleccionado]}
              ctx={ctx}
            />
            <Problemas ruta={['elements', idSeleccionado]} ctx={ctx} />
          </>
        )}
      </details>

      {problemas.length > 0 && (
        <details>
          <summary>
            Validación ({errores} {errores === 1 ? 'error' : 'errores'})
          </summary>
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
