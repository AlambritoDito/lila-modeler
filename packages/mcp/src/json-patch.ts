/**
 * JSON Patch (RFC 6902) mínimo para `patch_scenario` (LILA-055): `add`/`replace`/`remove`/`test`
 * sobre objetos y arrays planos, con punteros RFC 6901. Sin `move`/`copy` (ponytail): son las dos
 * operaciones que leen de una ubicación distinta a la que escriben, duplicarían la navegación, y
 * ningún caso de uso de `patch_scenario` las necesita — documentado en `docs/MCP.md`.
 *
 * También arma el delta mínimo de un patch, para el modo "crear escenario con `extends`" de
 * `patch_scenario`: la ruta de cada operación, anidada, con una clave borrada traducida a `null`
 * (mismo borrado que usa `extends`, `docs/SCENARIO_FORMAT.md` § 6) y un array tocado en cualquier
 * profundidad reemplazado entero (los arrays no se fusionan por índice en `extends`).
 */

export interface JsonPatchOp {
  op: string;
  path: string;
  value?: unknown;
  from?: string | undefined;
}

const SUPPORTED_OPS = new Set(['add', 'replace', 'remove', 'test']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * RFC 6901 no reserva ningún nombre de clave, pero en JavaScript `obj['__proto__'] = x` no crea
 * una clave: escribe en el prototipo. Un patch con `/__proto__/loQueSea` contaminaba
 * `Object.prototype` del **proceso servidor** entero —un servidor MCP por stdio es de vida larga—
 * y dejaba colgada la llamada y todas las siguientes. `constructor` y `prototype` van a la misma
 * lista: ningún escenario tiene claves así (`docs/SCENARIO_FORMAT.md` § 2).
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function parsePointer(pointer: string): string[] {
  if (pointer === '') throw new Error('json patch: la raíz del documento no se puede parchear.');
  if (!pointer.startsWith('/')) throw new Error(`json patch: puntero inválido: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      if (FORBIDDEN_SEGMENTS.has(key)) {
        throw new Error(`json patch: segmento prohibido "${key}" en ${pointer}: escribiría en el prototipo del objeto.`);
      }
      return key;
    });
}

/**
 * El puntero ya no puede nombrar esas claves, pero el `value` de un `add`/`replace` es JSON del
 * cliente y `JSON.parse('{"__proto__":{…}}')` **sí** crea una clave propia: se escribía tal cual
 * en el escenario guardado y `deepMerge` (LILA-204) se la comía en silencio al resolver el
 * `extends`, dejando en disco un archivo con una clave que el motor ignora. Se rechaza igual que
 * el segmento: aquí el patch es una orden explícita del agente, no un archivo heredado.
 */
function assertValueSinClavesDeProtitipo(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertValueSinClavesDeProtitipo(item, path);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SEGMENTS.has(key)) {
      throw new Error(`json patch: clave prohibida "${key}" en el value de ${path}: escribiría en el prototipo del objeto.`);
    }
    assertValueSinClavesDeProtitipo(nested, path);
  }
}

function child(container: unknown, key: string): unknown {
  if (Array.isArray(container)) return container[Number(key)];
  if (isPlainObject(container)) return container[key];
  return undefined;
}

function get(root: unknown, segments: readonly string[]): unknown {
  let cursor = root;
  for (const segment of segments) cursor = child(cursor, segment);
  return cursor;
}

/** Contenedor y clave del último segmento; lanza si algún tramo intermedio no existe. */
function navigate(root: unknown, segments: string[]): { parent: Record<string, unknown> | unknown[]; key: string } {
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    cursor = child(cursor, segment);
    if (cursor === undefined) throw new Error(`json patch: no existe la ruta hasta "${segment}".`);
  }
  if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
    throw new Error('json patch: la ruta no llega a un objeto o array.');
  }
  return { parent: cursor, key: segments[segments.length - 1] ?? '' };
}

/** Aplica el patch a una copia profunda de `target`; nunca muta el original. */
export function applyJsonPatch(target: unknown, patch: readonly JsonPatchOp[]): unknown {
  const root = structuredClone(target);
  for (const op of patch) {
    if (!SUPPORTED_OPS.has(op.op)) {
      throw new Error(
        `json patch: operación no soportada: "${op.op}" (solo add/replace/remove/test; move/copy no están implementadas).`,
      );
    }
    // RFC 6902 § 4: `add`, `replace` y `test` requieren `value`. Sin esto, un `add` sin `value`
    // escribía `undefined`, que `JSON.stringify` descarta: un borrado silencioso en vez de error.
    if (op.op !== 'remove' && op.value === undefined) {
      throw new Error(`json patch: la operación "${op.op}" requiere "value" (${op.path}).`);
    }
    if (op.op !== 'remove') assertValueSinClavesDeProtitipo(op.value, op.path);
    const segments = parsePointer(op.path);

    if (op.op === 'test') {
      const { parent, key } = navigate(root, segments);
      if (JSON.stringify(child(parent, key)) !== JSON.stringify(op.value)) {
        throw new Error(`json patch: test falló en ${op.path}.`);
      }
      continue;
    }

    const { parent, key } = navigate(root, segments);
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) {
        throw new Error(`json patch: índice inválido en ${op.path}.`);
      }
      if (op.op === 'add') parent.splice(index, 0, op.value);
      else if (index >= parent.length) throw new Error(`json patch: no existe la ruta ${op.path}.`);
      else if (op.op === 'replace') parent[index] = op.value;
      else parent.splice(index, 1); // remove
    } else if (op.op === 'add') {
      parent[key] = op.value;
    } else if (key in parent) {
      if (op.op === 'replace') parent[key] = op.value;
      else delete parent[key]; // remove
    } else {
      throw new Error(`json patch: no existe la ruta ${op.path}.`);
    }
  }
  return root;
}

/**
 * Delta mínimo de un patch: solo las rutas que tocó alguna operación, leídas del documento **ya
 * parcheado** (`patchedRoot`) para reflejar el estado final aunque varias operaciones compongan la
 * misma ruta. Una clave que ya no existe en `patchedRoot` (un `remove`) se traduce a `null`.
 */
export function buildPatchDelta(
  patch: readonly JsonPatchOp[],
  patchedRoot: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const op of patch) {
    if (op.op === 'test' || !SUPPORTED_OPS.has(op.op)) continue;
    const segments = parsePointer(op.path);

    let deltaCursor = delta;
    let patchedCursor: unknown = patchedRoot;
    let stoppedAtArray = false;
    for (const segment of segments.slice(0, -1)) {
      const next = child(patchedCursor, segment);
      if (Array.isArray(next)) {
        deltaCursor[segment] = next; // los arrays se reemplazan enteros, nunca por índice (§ 6).
        stoppedAtArray = true;
        break;
      }
      if (!isPlainObject(deltaCursor[segment])) deltaCursor[segment] = {};
      deltaCursor = deltaCursor[segment] as Record<string, unknown>;
      patchedCursor = next;
    }
    if (stoppedAtArray) continue;

    const lastKey = segments[segments.length - 1]!;
    const leaf = get(patchedRoot, segments);
    deltaCursor[lastKey] = leaf === undefined ? null : leaf;
  }
  return delta;
}
