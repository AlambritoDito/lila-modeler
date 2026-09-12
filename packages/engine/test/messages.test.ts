/**
 * LILA-211 — el catálogo de mensajes es la única fuente de los textos `E-*`/`W-*`.
 *
 * Cinco invariantes:
 *
 * 1. cada código del catálogo está cubierto por `COVERAGE` (completitud en tiempo de compilación:
 *    añadir un código sin añadirlo aquí no compila);
 * 2. `en` y `es` declaran exactamente las mismas entradas, con la misma aridad;
 * 3. toda entrada produce texto no vacío, sin `undefined`, `NaN` ni `[object Object]`;
 * 4. § 17 de `docs/SEMANTICS.md` documenta todos los códigos salvo los guardias internos, y no
 *    documenta ninguno que el catálogo no tenga;
 * 5. no queda ni un literal `"CÓDIGO: …"` fuera de `src/messages/` y `src/core/messages/`
 *    (generalización del test de LILA-204), ni en `packages/mcp/src`, que consume el mismo
 *    catálogo desde LILA-211 parte 2.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { INTERNAL_CODES, en, es, messages, type Catalog, type ProblemCode } from '../src/messages/index.js';

const REPOSITORY_ROOT = new URL('../../../', import.meta.url);
const ENGINE_SRC = fileURLToPath(new URL('packages/engine/src', REPOSITORY_ROOT));
const MCP_SRC = fileURLToPath(new URL('packages/mcp/src', REPOSITORY_ROOT));
const SEMANTICS = readFileSync(
  fileURLToPath(new URL('docs/SEMANTICS.md', REPOSITORY_ROOT)),
  'utf8',
);

/**
 * Los 59 códigos que emite `packages/engine/src`. El tipo obliga a que estén **todos** y a que no
 * sobre ninguno: un código nuevo sin su fila aquí no compila, y una fila de un código que ya no
 * existe tampoco.
 */
const COVERAGE: Record<ProblemCode, true> = {
  'E-AGREGADO-NO-NUMERICO': true,
  'E-CAL-DESCONOCIDO': true,
  'E-CAL-VACIO': true,
  'E-CAMPO-NO-APLICA': true,
  'E-CAPACIDAD-Y-CALENDARIO': true,
  'E-CLAVE-DESCONOCIDA': true,
  'E-COMPARE-VACIO': true,
  'E-ELEMENTO-DESCONOCIDO': true,
  'E-FLUJO-COLGANTE': true,
  'E-GATEWAY-SIN-ARISTAS': true,
  'E-ID-DUPLICADO': true,
  'E-INALCANZABLE': true,
  'E-KPI-INCONSISTENTE': true,
  'E-KPI-NO-FINITO': true,
  'E-NOSOP': true,
  'E-PARSE-INCOMPLETO': true,
  'E-PROB-EN-NODO': true,
  'E-PROB-RANGO': true,
  'E-REC-CANTIDAD': true,
  'E-REC-CAPACIDAD': true,
  'E-REC-DESCONOCIDO': true,
  'E-REC-DUPLICADO': true,
  'E-REC-ESTADO': true,
  'E-REC-LIBERACION': true,
  'E-REC-SIN-ASIGNACION': true,
  'E-REC-SOLICITUD-DUPLICADA': true,
  'E-REF-DESCONOCIDA': true,
  'E-REF-INEXISTENTE': true,
  'E-REPLICACIONES-INSUFICIENTES': true,
  'E-REPLICACIONES-VACIAS': true,
  'E-RESERVADO': true,
  'E-SIN-END': true,
  'E-SIN-PARADA': true,
  'E-SIN-START': true,
  'E-SUBPROC-PARAMETRO': true,
  'E-TIMER-RECURSO': true,
  'E-XOR-SUMA-CERO': true,
  'W-BORDE-SIN-TIEMPO': true,
  'W-COND': true,
  'W-COND-INALCANZABLE': true,
  'W-ELEMENTO-SIN-PARAMETROS': true,
  'W-JOIN-BLOQUEADO': true,
  'W-MSGFLOW': true,
  'W-NORMAL-NEGATIVA': true,
  'W-OR-JOIN-SIN-FORK': true,
  'W-OR-SIN-PROBABILIDAD': true,
  'W-OR-VACIO': true,
  'W-PARSE': true,
  'W-PROB-IGNORADA': true,
  'W-RECURSO-SATURADO': true,
  'W-SIN-SEED': true,
  'W-START-SIN-LLEGADAS': true,
  'W-TAREA-SIN-TIEMPO': true,
  'W-TIMER-SIN-TIEMPO': true,
  'W-USER-NORMALIZADA': true,
  'W-UTILIZACION-MAYOR-UNO': true,
  'W-XOR-DEFAULT-ROTO': true,
  'W-XOR-NORMALIZADA': true,
  'W-XOR-RESIDUO-COMPARTIDO': true,
};

const CODES = Object.keys(COVERAGE).sort() as ProblemCode[];

/** `'E-CAL-VACIO/sin-intervalos'` -> `'E-CAL-VACIO'`. */
function codeOf(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

// `cli` y `mcp` entran en LILA-211 parte 2: el chrome de la CLI y del servidor MCP se traduce con
// las mismas reglas de paridad que los códigos.
const NAMESPACES = ['codes', 'chrome', 'constructions', 'zod', 'cli', 'mcp'] as const;

function entriesOf(catalog: Catalog, namespace: (typeof NAMESPACES)[number]): Record<string, unknown> {
  return catalog[namespace] as unknown as Record<string, unknown>;
}

/** Argumentos ficticios: toda entrada solo interpola sus parámetros, nunca los formatea. */
function callWithDummies(fn: (...args: unknown[]) => string): string {
  return fn(...Array.from({ length: fn.length }, (_, index) => `‹${index}›`));
}

describe('catálogo de mensajes (LILA-211)', () => {
  test('el catálogo cubre exactamente los 59 códigos del motor', () => {
    expect(CODES).toHaveLength(59);
    const fromCatalog = new Set(Object.keys(en.codes).map(codeOf));
    expect([...fromCatalog].sort()).toEqual(CODES);
  });

  test('los 59 códigos son los que aparecen en `packages/engine/src`', () => {
    const found = new Set<string>();
    for (const file of typeScriptFiles(ENGINE_SRC)) {
      for (const [code] of readFileSync(file, 'utf8').matchAll(/[EW]-[A-Z][A-Z0-9-]*/g)) {
        found.add(code);
      }
    }
    // Los ids de regla (`R-CAL-11`) no empiezan por `E-`/`W-`, así que el barrido solo trae
    // códigos del catálogo, estén en código o en un comentario.
    expect([...found].sort()).toEqual(CODES);
  });

  test.each(NAMESPACES)('`en` y `es` declaran las mismas entradas en `%s`', (namespace) => {
    const enEntries = entriesOf(en, namespace);
    const esEntries = entriesOf(es, namespace);

    expect(Object.keys(esEntries).sort()).toEqual(Object.keys(enEntries).sort());
    for (const [key, value] of Object.entries(enEntries)) {
      const translated = esEntries[key];
      expect(typeof translated, `${namespace}.${key}`).toBe(typeof value);
      if (typeof value === 'function') {
        expect((translated as (...args: unknown[]) => string).length, `${namespace}.${key}`).toBe(
          value.length,
        );
      }
    }
  });

  test.each(['en', 'es'] as const)('toda entrada de `%s` produce texto utilizable', (locale) => {
    const catalog = messages(locale);
    for (const namespace of NAMESPACES) {
      for (const [key, value] of Object.entries(entriesOf(catalog, namespace))) {
        const where = `${locale}.${namespace}.${key}`;
        const text =
          typeof value === 'function'
            ? callWithDummies(value as (...args: unknown[]) => string)
            : (value as string);

        expect(typeof text, where).toBe('string');
        expect(text.length, where).toBeGreaterThan(0);
        expect(text, where).toBe(text.trim());
        for (const poison of ['undefined', 'NaN', '[object Object]']) {
          expect(text.includes(poison), `${where} contiene "${poison}": ${text}`).toBe(false);
        }
      }
    }
  });

  test('la clave de una entrada con variante es su código más `/variante`', () => {
    for (const key of Object.keys(en.codes)) {
      expect(CODES, key).toContain(codeOf(key));
      if (key.includes('/')) expect(key.split('/')).toHaveLength(2);
    }
  });

  test('§ 17 documenta todos los códigos que no son guardias internos', () => {
    const documented = new Set(
      [...section17().matchAll(/`([EW]-[A-Z][A-Z0-9-]*)`/g)].map(([, code]) => code!),
    );
    const público = CODES.filter((code) => !INTERNAL_CODES.has(code));

    expect(público).toHaveLength(48);
    expect(INTERNAL_CODES.size).toBe(11);
    expect(público.filter((code) => !documented.has(code))).toEqual([]);
    expect([...documented].filter((code) => !CODES.includes(code as ProblemCode))).toEqual([]);
  });

  test('§ 17 lista los guardias internos y no los mezcla con el catálogo público', () => {
    for (const code of INTERNAL_CODES) expect(SEMANTICS).toContain(code);
  });

  /**
   * LILA-204 lo hacía solo para `E-REC-CAPACIDAD`; desde LILA-211 vale para todo el catálogo:
   * un texto `"CÓDIGO: …"` fuera del catálogo es un texto que no se puede traducir.
   */
  test.each([
    ['packages/engine/src', ENGINE_SRC],
    ['packages/mcp/src', MCP_SRC],
  ])('ningún literal `"CÓDIGO: …"` vive fuera del catálogo (%s)', (_label, root) => {
    const offenders: string[] = [];
    for (const file of typeScriptFiles(root)) {
      const relative = file.slice(root.length + 1).split('\\').join('/');
      if (relative.startsWith('messages/') || relative.startsWith('core/messages/')) continue;
      // Las tres comillas: una comilla doble dejaba pasar el texto sin que el test se enterase.
      for (const [, text] of readFileSync(file, 'utf8').matchAll(
        /['"`]([EW]-[A-Z][A-Z0-9-]*:[^'"`\n]*)['"`]/g,
      )) {
        offenders.push(`${relative}: ${text!}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Cuerpo de la § 17, hasta el encabezado siguiente. */
function section17(): string {
  // Desde #281 (LILA-212) `docs/SEMANTICS.md` es el documento en inglés; el encabezado del § 17
  // se traduce con él, así que el ancla sigue el texto en inglés.
  const start = SEMANTICS.indexOf('## 17. Error and warning catalog');
  expect(start).toBeGreaterThan(-1);
  const end = SEMANTICS.indexOf('\n## ', start + 1);
  return SEMANTICS.slice(start, end === -1 ? undefined : end);
}

function typeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...typeScriptFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files.sort();
}
