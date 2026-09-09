/**
 * Prueba de aceptación de LILA-066: «no hay literales de UI fuera de `strings.es.ts`».
 *
 * Relee el código fuente de `apps/web/src` con el parser de TypeScript —no con una expresión
 * regular sobre el texto— y falla si encuentra texto de usuario escrito a mano en un componente:
 *
 * - **texto entre etiquetas JSX** (`ts.isJsxText`): lo que se lee en pantalla;
 * - **atributos de texto** (`label`, `title`, `placeholder`, `aria-label`, `alt`) con un literal
 *   de cadena: lo que leen el tooltip y el lector de pantalla.
 *
 * El parser es lo que evita los falsos positivos que sí tendría un `grep`: un genérico
 * (`activo.get<Canvas>('canvas')`) o una comparación (`caja.x <= centro.x`) no son JSX, así que
 * no aparecen. Y el corte por número de letras deja pasar los símbolos sueltos (`+`, `−`, `✕`,
 * `⚙`, `·`) sin necesidad de listarlos: no son texto que se traduzca.
 *
 * Fuera del barrido, y por qué:
 *
 * - `strings.en.ts` y `strings.es.ts`: son los catálogos, ahí es donde tienen que estar.
 * - `*.test.ts` / `*.test.tsx`: un test puede escribir el texto que espera, y varios lo hacen
 *   porque así se lee mejor qué está comprobando.
 * - `*-demo.tsx`: `results.html` y `compare.html` son páginas de desarrollo que `vite.config.ts`
 *   deja fuera del bundle de producción a propósito. Sus textos salen igual de `strings.es.ts`
 *   (`S.demos`), pero no son la app y no se vigilan aquí.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { en } from './strings.en';
import { es } from './strings.es';

/** `apps/web/src`, resuelto desde este archivo: el test no depende del `cwd` de vitest. */
const RAIZ = fileURLToPath(new URL('.', import.meta.url));

/**
 * Atributos JSX cuyo valor lee una persona (o su lector de pantalla). `etiqueta` y `ayuda` son
 * los nombres que usan los componentes propios (`Campo`, `PestanaConAyuda`) para lo mismo que
 * `label`: si no estuvieran aquí, el rótulo de un campo podría escribirse a mano sin que el
 * guardia se enterase (QA de #271).
 */
const ATRIBUTOS_DE_TEXTO = new Set([
  'alt',
  'aria-label',
  'ayuda',
  'etiqueta',
  'label',
  'placeholder',
  'title',
]);

/**
 * Una cadena cuenta como texto de usuario a partir de tres letras seguidas. Por debajo de ese
 * corte están los símbolos y los rótulos de una tecla (`+`, `−`, `×`, `✕`, `⚙`, `·`, `!`, `⌘K`),
 * que no se traducen y no tienen por qué vivir en el catálogo.
 */
const TEXTO_DE_USUARIO = /\p{Letter}{3,}/u;

/**
 * Lista blanca, corta y explícita. Cada entrada es una cadena **exacta** que puede quedarse en el
 * código con su razón; si crece, casi seguro es que falta moverla a `strings.es.ts`.
 */
const PERMITIDAS = new Map<string, string>([
  // Marca de bpmn.io: es un nombre propio y su presencia la exige la licencia del editor.
  ['bpmn.io', 'nombre propio'],
  // Claves del JSON Schema del escenario: son el nombre del campo en el archivo, no una etiqueta.
  // Su ortografía la manda `docs/SCENARIO_FORMAT.md` (cabecera de `strings.es.ts`).
  ['calendars', 'clave del esquema'],
  ['intervals', 'clave del esquema'],
  ['resources', 'clave del esquema'],
]);

function fuentes(directorio: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(directorio)) {
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      fuentes(ruta, salida);
    } else if (
      /\.tsx?$/.test(entrada) &&
      !/\.test\.tsx?$/.test(entrada) &&
      !/\.d\.ts$/.test(entrada) &&
      !/-demo\.tsx$/.test(entrada) &&
      entrada !== 'strings.en.ts' &&
      entrada !== 'strings.es.ts'
    ) {
      salida.push(ruta);
    }
  }
  return salida;
}

/** `{texto}` como hijo de un elemento JSX, no como valor de un atributo (`title={texto}`). */
function esHijoJsx(nodo: ts.JsxExpression): boolean {
  const padre = nodo.parent;
  return ts.isJsxElement(padre) || ts.isJsxFragment(padre);
}

interface Hallazgo {
  archivo: string;
  linea: number;
  texto: string;
}

/** El detector, sobre código en memoria: es el que usan tanto el barrido como la sonda. */
function literalesEn(codigo: string, nombre: string): Hallazgo[] {
  const fuente = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallazgos: Hallazgo[] = [];

  const anotar = (nodo: ts.Node, bruto: string): void => {
    const texto = bruto.replace(/\s+/gu, ' ').trim();
    if (!TEXTO_DE_USUARIO.test(texto) || PERMITIDAS.has(texto)) return;
    hallazgos.push({
      archivo: nombre,
      linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1,
      texto,
    });
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxText(nodo)) {
      anotar(nodo, nodo.text);
    }
    // Un hijo entre llaves también se lee en pantalla: `<b>{'Sin tipo'}</b>` y
    // `<p>{`Corrida ${n}`}</p>` pintan texto igual que `ts.isJsxText`. Solo se miran los hijos:
    // el mismo nodo como valor de atributo lo cubre la rama de abajo, y ahí un `${…}` con
    // trozos de `S` es lo normal (QA de #271).
    if (ts.isJsxExpression(nodo) && nodo.expression !== undefined && esHijoJsx(nodo)) {
      const dentro = nodo.expression;
      if (ts.isStringLiteral(dentro) || ts.isNoSubstitutionTemplateLiteral(dentro)) {
        anotar(dentro, dentro.text);
      } else if (ts.isTemplateExpression(dentro)) {
        anotar(dentro, dentro.head.text + dentro.templateSpans.map((t) => t.literal.text).join(' '));
      }
    }
    // `aria-label` no es un identificador válido de TS: llega como nombre con guion, así que el
    // nombre del atributo se lee de la fuente y no de `node.name.text`.
    if (ts.isJsxAttribute(nodo) && nodo.initializer !== undefined) {
      const nombre = nodo.name.getText(fuente);
      if (ATRIBUTOS_DE_TEXTO.has(nombre) && ts.isStringLiteral(nodo.initializer)) {
        anotar(nodo.initializer, nodo.initializer.text);
      }
    }
    ts.forEachChild(nodo, visitar);
  };

  visitar(fuente);
  return hallazgos;
}

function literalesDeUi(ruta: string): Hallazgo[] {
  return literalesEn(readFileSync(ruta, 'utf8'), ruta.slice(RAIZ.length));
}

describe('LILA-066 · los textos de la UI viven en strings.es.ts', () => {
  it('barre los archivos de la app y ninguno más', () => {
    const archivos = fuentes(RAIZ).map((r) => r.slice(RAIZ.length));
    // Si esto falla es que el barrido dejó de mirar donde tiene que mirar (o miró de más).
    expect(archivos).toContain('App.tsx');
    expect(archivos).toContain('ScenarioPanel.tsx');
    expect(archivos).toContain('store/DesktopStore.ts');
    // `ids.ts` (LILA-210) is code, not a catalog: the guard has to keep looking at it, or a label
    // could come back in disguised as an id.
    expect(archivos).toContain('ids.ts');
    expect(archivos).not.toContain('strings.en.ts');
    expect(archivos).not.toContain('strings.es.ts');
    expect(archivos.filter((a) => a.includes('.test.'))).toEqual([]);
    expect(archivos.filter((a) => a.endsWith('-demo.tsx'))).toEqual([]);
  });

  it('no queda ningún literal de UI fuera del catálogo', () => {
    const hallazgos = fuentes(RAIZ).flatMap(literalesDeUi);
    // El mensaje del fallo dice archivo, línea y texto: lo justo para moverlo a `strings.es.ts`.
    expect(
      hallazgos.map((h) => `${h.archivo}:${h.linea}  «${h.texto}»`),
    ).toEqual([]);
  });

  it('detecta un literal recién puesto, en el texto y en los atributos', () => {
    // El detector se ejercita sobre fuente sintética, no sobre un archivo real: así la prueba de
    // que el guardia muerde no exige ensuciar un componente ni depende de que siga ensuciado.
    // Y es `literalesEn` —el mismo que barre la app—, no una copia suya: una copia solo prueba
    // que la copia muerde (QA de #271).
    const sonda = (codigo: string): string[] =>
      literalesEn(codigo, 'sonda.tsx').map((h) => h.texto);

    expect(sonda('const x = <p>Guardar cambios</p>;')).toEqual(['Guardar cambios']);
    expect(sonda('const x = <button title="Cerrar diagrama">+</button>;')).toEqual([
      'Cerrar diagrama',
    ]);
    // Un hijo entre llaves se lee en pantalla igual que el texto suelto.
    expect(sonda("const x = <b>{'Texto suelto'}</b>;")).toEqual(['Texto suelto']);
    expect(sonda('const x = <p>{`Corrida numero ${n}`}</p>;')).toEqual(['Corrida numero']);
    // Y el rótulo de un campo, aunque la prop se llame en español.
    expect(sonda('const x = <Campo etiqueta="Nombre del proceso" />;')).toEqual([
      'Nombre del proceso',
    ]);
    // Y no muerde lo que no es texto: símbolos, expresiones y genéricos de TypeScript.
    expect(sonda('const x = <button aria-label={S.app.cerrar}>✕</button>;')).toEqual([]);
    expect(sonda('const x = <p>{S.app.nuevo}{\' \'}·{\' \'}{n}</p>;')).toEqual([]);
    expect(sonda('const x = <Campo etiqueta="intervals" />;')).toEqual([]);
    expect(sonda("const c = modeler.get<Canvas>('canvas');")).toEqual([]);
  });
});

/**
 * Second guard of LILA-210: the two catalogs have to be the *same* catalog in two languages.
 *
 * `tsc` already refuses a translation that forgets a key or invents one — `strings.es.ts` is
 * annotated with `Strings`, which is derived from `strings.en.ts`. What the type cannot see is
 * exactly what breaks at runtime: an entry typed `Record<string, string>` (whose keys are free by
 * construction), and a function whose arity drifted because the translation dropped a parameter it
 * did not need. So the same comparison is done here by walking both objects.
 */
const describir = (valor: unknown, camino: string, salida: Map<string, string>): Map<string, string> => {
  if (EXCEPCIONES.has(camino)) {
    salida.set(camino, 'excepción');
    return salida;
  }
  if (typeof valor === 'function') {
    // The parameters are part of the contract: `replicacion(actual, total)` takes two numbers in
    // every language, and a translation that ignores one still has to accept it.
    salida.set(camino, `función/${(valor as (...args: unknown[]) => unknown).length}`);
  } else if (Array.isArray(valor)) {
    salida.set(camino, `lista/${valor.length}`);
    valor.forEach((item, i) => describir(item, `${camino}[${i}]`, salida));
  } else if (valor !== null && typeof valor === 'object') {
    salida.set(camino, 'objeto');
    for (const [clave, dentro] of Object.entries(valor)) {
      describir(dentro, camino === '' ? clave : `${camino}.${clave}`, salida);
    }
  } else {
    salida.set(camino, typeof valor);
  }
  return salida;
};

/**
 * The only entries whose *shape* is allowed to differ between languages, each with its reason.
 * Their content is asserted one by one below, so an exception is not a hole in the guard.
 */
const EXCEPCIONES = new Map<string, string>([
  [
    'tokenSim.traducciones',
    // The inventory of strings `bpmn-js-token-simulation` writes into the canvas in English. In
    // the base language there is nothing to translate, so it is empty by construction.
    'inventario de cadenas del módulo, vacío en la lengua base',
  ],
]);

describe('LILA-210 · los dos catálogos tienen las mismas claves', () => {
  it('cada clave existe en ambos, con la misma clase de valor y la misma aridad', () => {
    const base = describir(en, '', new Map());
    const traduccion = describir(es, '', new Map());
    // Two directions, and each failure names the paths: the ones the translation is missing, and
    // the ones it invented or gave a different kind of value.
    expect([...traduccion.keys()].filter((k) => !base.has(k))).toEqual([]);
    expect([...base.keys()].filter((k) => !traduccion.has(k))).toEqual([]);
    expect([...base].filter(([k, v]) => traduccion.get(k) !== v).map(([k, v]) => `${k}: ${v} ≠ ${traduccion.get(k)}`)).toEqual([]);
  });

  it('cada excepción está donde dice estar y es la que dice ser', () => {
    // `tokenSim.traducciones` is the one entry whose shape differs: empty in English — the module
    // already writes English — and the actual inventory in Spanish. Both halves are checked, so
    // an exception that stopped being true (a Spanish catalog that lost its inventory) fails here.
    expect([...EXCEPCIONES.keys()]).toEqual(['tokenSim.traducciones']);
    expect(en.tokenSim.traducciones).toEqual({});
    expect(Object.keys(es.tokenSim.traducciones).length).toBeGreaterThan(0);
    // And what it translates is what the module writes: the key is the English text.
    expect(es.tokenSim.traducciones['Reset Simulation']).toBeTypeOf('string');
  });
});
