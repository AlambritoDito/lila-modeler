/**
 * Lote M, C2: the pure side of the Resources step — what a list row says about a resource, which
 * tasks use it, the key a new one gets, and the one write that changes several fields of a
 * resource at once (switching capacity between fixed and per-shift, R16).
 */
import { descendientesDe, escribir, esObjeto, leer, type Contexto } from './escenarioModelo.js';
import { enMinutos, type Intervalo } from './CalendarEditor.js';

/** `resources` of the resolved scenario, or `{}`. */
export function recursosDe(resuelto: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const recursos = resuelto['resources'];
  if (!esObjeto(recursos)) return {};
  const salida: Record<string, Record<string, unknown>> = {};
  for (const [clave, valor] of Object.entries(recursos)) salida[clave] = esObjeto(valor) ? valor : {};
  return salida;
}

/** The first `<prefijo>-n` not taken: `recurso-1`, `recurso-2`… */
export function claveNueva(existentes: readonly string[], prefijo: string): string {
  for (let n = 1; ; n++) {
    const clave = `${prefijo}-${n}`;
    if (!existentes.includes(clave)) return clave;
  }
}

/** What a resource reads in the list and the header: its `name`, or its key without one. */
export function nombreRecurso(clave: string, recurso: Record<string, unknown> | undefined): string {
  const nombre = recurso?.['name'];
  return typeof nombre === 'string' && nombre.trim() !== '' ? nombre : clave;
}

/** One shift of a per-shift capacity (LILA-164): a calendar and how many units while it is open. */
export interface Turno {
  calendar: unknown;
  capacity: unknown;
}

/** The shifts, when `capacity` is the per-shift list; `null` when it is a fixed number. */
export function turnosDe(recurso: Record<string, unknown> | undefined): Turno[] | null {
  const capacidad = recurso?.['capacity'];
  if (!Array.isArray(capacidad)) return null;
  return capacidad.map((t) => (esObjeto(t) ? { calendar: t['calendar'], capacity: t['capacity'] } : { calendar: undefined, capacity: undefined }));
}

/** The tasks whose resolved `resources` name `clave`, with the quantity each takes. */
export function tareasDeRecurso(
  resuelto: Record<string, unknown>,
  clave: string,
): { id: string; cantidad: number }[] {
  const elementos = resuelto['elements'];
  if (!esObjeto(elementos)) return [];
  const salida: { id: string; cantidad: number }[] = [];
  for (const [id, elemento] of Object.entries(elementos)) {
    const usos = esObjeto(elemento) ? elemento['resources'] : undefined;
    if (!Array.isArray(usos)) continue;
    for (const uso of usos) {
      if (esObjeto(uso) && uso['ref'] === clave) {
        salida.push({ id, cantidad: typeof uso['quantity'] === 'number' ? uso['quantity'] : 1 });
      }
    }
  }
  return salida;
}

/** Hours a week a calendar is open, counting only its weekly intervals (`days`). */
export function horasSemana(calendario: unknown): number {
  const intervals = esObjeto(calendario) ? calendario['intervals'] : undefined;
  if (!Array.isArray(intervals)) return 0;
  let minutos = 0;
  for (const intervalo of intervals as Intervalo[]) {
    if (!Array.isArray(intervalo.days)) continue;
    const desde = enMinutos(intervalo.from);
    const hasta = enMinutos(intervalo.to);
    if (desde === null || hasta === null || hasta <= desde) continue;
    minutos += (hasta - desde) * intervalo.days.length;
  }
  return minutos / 60;
}

/**
 * Writes several fields of `resources[clave]` as **one** change of the delta (§ 6). A field set
 * to `undefined` is removed: with `null` when the parent defines it, which is how § 6 deletes,
 * dropped from the child otherwise. Two `ctx.editar` calls in a row would each start from the
 * same delta and the second would undo the first.
 */
export function editarRecurso(ctx: Contexto, clave: string, cambios: Record<string, unknown>): void {
  const ruta = ['resources', clave] as const;
  if (ctx.delta === undefined || ctx.editarVarios === undefined) {
    for (const [campo, valor] of Object.entries(cambios)) {
      if (valor === undefined) ctx.quitar([...ruta, campo]);
      else ctx.editar([...ruta, campo], valor);
    }
    return;
  }
  const propio = leer(ctx.delta, ruta);
  const siguiente: Record<string, unknown> = esObjeto(propio) ? { ...propio } : {};
  for (const [campo, valor] of Object.entries(cambios)) {
    if (valor !== undefined) siguiente[campo] = valor;
    else if (ctx.padre != null && leer(ctx.padre, [...ruta, campo]) !== undefined) siguiente[campo] = null;
    else delete siguiente[campo];
  }
  ctx.editarVarios([{ ruta, valor: siguiente }]);
}

/** Problems of the resolved scenario under `resources.<clave>` (the row and the tab badges). */
export function problemasBajo(ctx: Contexto, prefijo: string): number {
  let total = 0;
  for (const [ruta, lista] of ctx.problemas) {
    if (ruta === prefijo || ruta.startsWith(`${prefijo}.`) || ruta.startsWith(`${prefijo}[`)) {
      total += lista.filter((p) => p.severidad === 'error').length;
    }
  }
  return total;
}

/** Why a resource key cannot be renamed to `nueva`, or `null` when it can. */
export type MotivoClave = 'vacia' | 'repetida' | 'heredada' | 'enDerivado' | null;

/** The scenarios that `extends` the one being edited (directly or not), when the host gives them. */
export function derivadosDe(ctx: Contexto): string[] {
  return ctx.archivo !== undefined && ctx.escenarios !== undefined ? descendientesDe(ctx.archivo, ctx.escenarios) : [];
}

/** `true` if a delta declares a resource `clave` of its own (not deleted with `null`). */
export function declaraRecurso(delta: Record<string, unknown>, clave: string): boolean {
  const propios = delta['resources'];
  return esObjeto(propios) && propios[clave] !== undefined && propios[clave] !== null;
}

/**
 * A descendant's **own** delta after an ancestor renamed resource `viejo` to `nuevo` (QA of #601):
 * its override or deletion of `resources.<viejo>` moves to `nuevo` (or a TO-BE's «3 cashiers»
 * would become an orphan resource and the inherited tasks would run with the parent's capacity),
 * and its own `elements.*.resources[].ref` follow. What it inherits is fixed by the ancestor.
 */
export function renombrarRecursoEnDescendiente(
  delta: Record<string, unknown>,
  viejo: string,
  nuevo: string,
): Record<string, unknown> {
  let salida = delta;
  const propios = delta['resources'];
  if (esObjeto(propios) && viejo in propios) {
    const movidos: Record<string, unknown> = {};
    for (const [clave, entrada] of Object.entries(propios)) movidos[clave === viejo ? nuevo : clave] = entrada;
    salida = { ...salida, resources: movidos };
  }
  const elementos = delta['elements'];
  for (const [id, elemento] of Object.entries(esObjeto(elementos) ? elementos : {})) {
    const usos = esObjeto(elemento) ? elemento['resources'] : undefined;
    if (!Array.isArray(usos) || !usos.some((u) => esObjeto(u) && u['ref'] === viejo)) continue;
    salida = escribir(salida, ['elements', id, 'resources'], usos.map((u) => (esObjeto(u) && u['ref'] === viejo ? { ...u, ref: nuevo } : u)));
  }
  return salida;
}

/** `true` if a delta names resource `clave` itself: an entry (override or `null`) or a task reference. */
export function nombraRecurso(delta: Record<string, unknown>, clave: string): boolean {
  return renombrarRecursoEnDescendiente(delta, clave, `${clave}\u0000`) !== delta;
}

export function motivoRenombrar(ctx: Contexto, de: string, nueva: string): MotivoClave {
  if (nueva.trim() === '') return 'vacia';
  if (nueva === de) return null;
  if (Object.keys(recursosDe(ctx.resuelto)).includes(nueva)) return 'repetida';
  // A key the parent declares cannot leave the child: § 6 merges by key, so the parent's entry
  // would come back under the old name.
  if (ctx.padre != null && leer(ctx.padre, ['resources', de]) !== undefined) return 'heredada';
  // A descendant with its own resource of that name would end up with two merged into one.
  const escenarios = ctx.escenarios ?? {};
  if (derivadosDe(ctx).some((h) => declaraRecurso(escenarios[h] ?? {}, nueva))) return 'enDerivado';
  return null;
}

/**
 * Renames `resources[de]` to `resources[a]` and every `elements.*.resources[].ref` that named it,
 * as one change of the delta, and then each descendant scenario's own delta in the same gesture
 * (`renombrarRecursoEnDescendiente`). The caller checks `motivoRenombrar` first. The order of the
 * resources is kept, so the list does not reshuffle under the person typing.
 */
export function renombrarRecurso(ctx: Contexto, de: string, a: string): void {
  if (de === a) return;
  const propios = ctx.delta === undefined ? ctx.resuelto['resources'] : leer(ctx.delta, ['resources']);
  const tabla: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(esObjeto(propios) ? propios : {})) tabla[clave === de ? a : clave] = valor;
  const cambios: { ruta: readonly (string | number)[]; valor: unknown }[] = [{ ruta: ['resources'], valor: tabla }];
  const elementos = ctx.resuelto['elements'];
  for (const [id, elemento] of Object.entries(esObjeto(elementos) ? elementos : {})) {
    const usos = esObjeto(elemento) ? elemento['resources'] : undefined;
    if (!Array.isArray(usos) || !usos.some((u) => esObjeto(u) && u['ref'] === de)) continue;
    cambios.push({
      ruta: ['elements', id, 'resources'],
      valor: usos.map((u) => (esObjeto(u) && u['ref'] === de ? { ...u, ref: a } : u)),
    });
  }
  if (ctx.editarVarios !== undefined) ctx.editarVarios(cambios);
  else for (const { ruta, valor } of cambios) ctx.editar(ruta, valor);
  const escenarios = ctx.escenarios ?? {};
  for (const hijo of derivadosDe(ctx)) {
    const antes = escenarios[hijo];
    if (antes === undefined) continue;
    const despues = renombrarRecursoEnDescendiente(antes, de, a);
    if (despues !== antes) ctx.editarArchivo?.(hijo, despues);
  }
}
