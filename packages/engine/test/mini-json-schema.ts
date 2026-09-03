/**
 * Validador mínimo de JSON Schema, solo para los tests.
 *
 * Por qué existe: la aceptación de LILA-013 pide comprobar `docs/scenario.schema.json` con un
 * validador **externo al esquema zod**, y el repo no añade una dependencia (ajv) para eso. Cubre
 * exactamente las palabras clave que emite `z.toJSONSchema` para este esquema y nada más.
 *
 * ponytail: si algún día el esquema usa `$ref`, `allOf` o `if/then`, esto se queda corto en
 * silencio; el camino de mejora es cambiarlo por ajv en `devDependencies` cuando haga falta.
 */

type Schema = Record<string, unknown>;

const KNOWN = new Set([
  '$id',
  '$schema',
  'title',
  'default',
  'description',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'oneOf',
  'anyOf',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'pattern',
  'minItems',
  'items',
]);

/** Palabras clave del esquema que este validador no entiende: mejor gritar que aprobar de más. */
export function unsupportedKeywords(schema: unknown, path = '$'): string[] {
  const found: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => found.push(...unsupportedKeywords(s, `${path}[${i}]`)));
    return found;
  }
  if (typeof schema !== 'object' || schema === null) return found;
  for (const [key, value] of Object.entries(schema as Schema)) {
    if (!KNOWN.has(key)) found.push(`${path}.${key}`);
    if (key === 'properties' || key === '$defs') {
      for (const [k, v] of Object.entries(value as Schema)) {
        found.push(...unsupportedKeywords(v, `${path}.${key}.${k}`));
      }
    } else if (['items', 'additionalProperties', 'propertyNames', 'oneOf', 'anyOf'].includes(key)) {
      found.push(...unsupportedKeywords(value, `${path}.${key}`));
    }
  }
  return found;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Devuelve la lista de errores; `[]` significa válido. */
export function validateJsonSchema(schema: unknown, value: unknown, path = '$'): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const s = schema as Schema;
  const errors: string[] = [];

  if (typeof s['type'] === 'string') {
    const actual = typeOf(value);
    const ok =
      s['type'] === 'integer'
        ? actual === 'number' && Number.isInteger(value)
        : actual === s['type'];
    if (!ok) return [`${path}: se esperaba ${String(s['type'])} y llegó ${actual}`];
  }

  if ('const' in s && value !== s['const']) {
    errors.push(`${path}: se esperaba const ${JSON.stringify(s['const'])}`);
  }
  if (Array.isArray(s['enum']) && !s['enum'].includes(value)) {
    errors.push(`${path}: valor fuera de enum`);
  }

  if (typeof value === 'number') {
    if (typeof s['minimum'] === 'number' && value < s['minimum']) {
      errors.push(`${path}: ${value} < minimum ${s['minimum']}`);
    }
    if (typeof s['maximum'] === 'number' && value > s['maximum']) {
      errors.push(`${path}: ${value} > maximum ${s['maximum']}`);
    }
    if (typeof s['exclusiveMinimum'] === 'number' && value <= s['exclusiveMinimum']) {
      errors.push(`${path}: ${value} <= exclusiveMinimum ${s['exclusiveMinimum']}`);
    }
    if (typeof s['exclusiveMaximum'] === 'number' && value >= s['exclusiveMaximum']) {
      errors.push(`${path}: ${value} >= exclusiveMaximum ${s['exclusiveMaximum']}`);
    }
  }

  if (typeof value === 'string' && typeof s['pattern'] === 'string') {
    if (!new RegExp(s['pattern']).test(value)) errors.push(`${path}: no casa con pattern`);
  }

  if (Array.isArray(value)) {
    if (typeof s['minItems'] === 'number' && value.length < s['minItems']) {
      errors.push(`${path}: menos de ${s['minItems']} elementos`);
    }
    if (s['items'] !== undefined) {
      value.forEach((item, i) =>
        errors.push(...validateJsonSchema(s['items'], item, `${path}[${i}]`)),
      );
    }
  }

  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>;
    const properties = (s['properties'] ?? {}) as Schema;
    for (const key of (s['required'] ?? []) as string[]) {
      if (!(key in object)) errors.push(`${path}.${key}: falta una propiedad obligatoria`);
    }
    for (const [key, child] of Object.entries(object)) {
      if (s['propertyNames'] !== undefined) {
        errors.push(...validateJsonSchema(s['propertyNames'], key, `${path}.${key} (nombre)`));
      }
      if (key in properties) {
        errors.push(...validateJsonSchema(properties[key], child, `${path}.${key}`));
      } else if (s['additionalProperties'] === false) {
        errors.push(`${path}.${key}: propiedad no permitida`);
      } else if (typeof s['additionalProperties'] === 'object') {
        errors.push(...validateJsonSchema(s['additionalProperties'], child, `${path}.${key}`));
      }
    }
  }

  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = s[key];
    if (!Array.isArray(branches)) continue;
    const matches = branches.filter((b) => validateJsonSchema(b, value, path).length === 0).length;
    const ok = key === 'oneOf' ? matches === 1 : matches >= 1;
    if (!ok) errors.push(`${path}: ${matches} ramas de ${key} casan`);
  }

  return errors;
}
