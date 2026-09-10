import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { extractLang, main, resolveLocale } from '../src/cli.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pedido = `${repo}examples/pedido/model.bpmn`;
const boundary = fileURLToPath(new URL('./fixtures/boundary-event.bpmn', import.meta.url));
const warningsFixture = fileURLToPath(new URL('./fixtures/warnings.bpmn', import.meta.url));
const incompleto = fileURLToPath(new URL('./fixtures/parse-incompleto.bpmn', import.meta.url));

let out: string[];

beforeEach(() => {
  out = [];
  const capture = (...args: unknown[]) => void out.push(args.join(' '));
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Aceptación LILA-045: `lila validate examples/pedido/model.bpmn` ⇒ 0 errores.
test('validate sobre examples/pedido imprime el IR y sale con 0', async () => {
  const code = await main(['validate', pedido]);
  const text = out.join('\n');

  expect(code).toBe(0);
  expect(text).toContain('0 errors, 1 warnings.');
  expect(text).toContain('W-MSGFLOW');
  expect(text).toContain('Task_TomarPedido');
  expect(text).toContain('Flow_Aprobado: Gateway_Aprobacion -> Timer_Reposo');
  expect(text).toContain('Nodes (11)');
  expect(text).toContain('Flows (11)');
});

// Aceptación LILA-045: con un fixture con boundary event ⇒ error y exit 1.
test('validate sobre un modelo con boundary event sale con 1 y cita el id', async () => {
  const code = await main(['validate', boundary]);
  const text = out.join('\n');

  expect(code).toBe(1);
  expect(text).toContain('E-NOSOP');
  expect(text).toContain('not supported by the simulator');
});

test('--json imprime JSON parseable con ir, errores y avisos', async () => {
  const code = await main(['validate', pedido, '--json']);
  const parsed = JSON.parse(out.join('\n')) as {
    ir: { nodes: Record<string, unknown> };
    errors: unknown[];
    warnings: { code: string; id: string }[];
  };

  expect(code).toBe(0);
  expect(Object.keys(parsed.ir.nodes)).toContain('Task_TomarPedido');
  expect(parsed.errors).toEqual([]);
  expect(parsed.warnings).toMatchObject([
    { code: 'W-MSGFLOW', id: 'Process_Restaurante' },
  ]);
});

test('propaga W-MSGFLOW y cada W-COND en salida humana y JSON', async () => {
  expect(await main(['validate', warningsFixture])).toBe(0);
  const human = out.join('\n');
  expect(human).toContain('warning  W-MSGFLOW  Process_Warnings: 2 message flows');
  expect(human).toContain('warning  W-COND  Flow_Condition: conditionExpression is ignored');
  expect(human).toContain('0 errors, 2 warnings.');

  out = [];
  expect(await main(['validate', warningsFixture, '--json'])).toBe(0);
  const json = JSON.parse(out.join('\n')) as { warnings: { code: string; id: string }[] };
  expect(json.warnings).toEqual([
    expect.objectContaining({ code: 'W-MSGFLOW', id: 'Process_Warnings' }),
    expect.objectContaining({ code: 'W-COND', id: 'Flow_Condition' }),
  ]);
});

test('sin argumentos imprime el uso y sale con 1', async () => {
  expect(await main([])).toBe(1);
  expect(out.join('\n')).toContain('Usage: lila validate');
});

test('un comando desconocido sale con 1', async () => {
  expect(await main(['simular', pedido])).toBe(1);
  expect(out.join('\n')).toContain('unknown command');
});

test('validate sin ruta sale con 1', async () => {
  expect(await main(['validate'])).toBe(1);
  expect(out.join('\n')).toContain('the path of the .bpmn file is missing');
});

test('--help sale con 0', async () => {
  expect(await main(['--help'])).toBe(0);
});

// Aceptación LILA-185: un modelo que perdió elementos al cargarse sale con 1 y lo dice.
test('validate sobre un export que pierde elementos sale con 1 e imprime E-PARSE-INCOMPLETO', async () => {
  const code = await main(['validate', incompleto]);
  const text = out.join('\n');

  expect(code).toBe(1);
  expect(text).toContain(
    'error  E-PARSE-INCOMPLETO  Task_Revisar: the XML reader discarded model content, which was left incomplete:',
  );
  expect(text).toContain('duplicate ID <Task_Revisar>');
  expect(text).toContain(
    'warning  W-PARSE  Process_Incompleto: XML reader notice, with no loss of nodes or flows:',
  );
});

// QA LILA-185: un export con solo avisos de lectura (`W-PARSE`) no puede salir con 1, y el JSON
// de `--json` tiene que seguir siendo JSON con los mensajes crudos de moddle (traen `<` y `>`).
test('validate --json lleva los avisos del lector y sale con 0 si no hay errores', async () => {
  const code = await main(['validate', '--json', `${repo}examples/bizagi-exports/bizagi-miwg-B.1.0-roundtrip.bpmn`]);
  const report = JSON.parse(out.join('\n')) as {
    ir: { source: { warnings: { message: string }[] } };
    errors: unknown[];
    warnings: { code: string; message: string }[];
  };

  expect(code).toBe(0);
  expect(report.errors).toEqual([]);
  expect(report.ir.source.warnings.length).toBeGreaterThan(0);
  expect(report.warnings.filter((w) => w.code === 'W-PARSE')).toHaveLength(
    report.ir.source.warnings.length,
  );
});

/* ------------------------------------------------------------------ *
 * Idioma de la salida (LILA-211, parte 2)
 * ------------------------------------------------------------------ */

describe('--lang / LILA_LANG / LANG', () => {
  test('`--lang es` imprime el chrome en español y no toca los códigos', async () => {
    expect(await main(['validate', pedido, '--lang', 'es'])).toBe(0);
    const text = out.join('\n');

    expect(text).toContain('Proceso Process_Restaurante (Restaurant)');
    expect(text).toContain('Nodos (11)');
    expect(text).toContain('Flujos (11)');
    expect(text).toContain('0 errores, 1 avisos.');
    // El código viaja igual en los dos idiomas; lo que cambia es el cuerpo del mensaje.
    expect(text).toContain('aviso  W-MSGFLOW  Process_Restaurante: se ignoraron 2 flujos de mensaje');
  });

  test('`--lang=es` vale igual, y en cualquier posición de la línea', async () => {
    expect(await main(['--lang=es', 'validate', pedido])).toBe(0);
    expect(out.join('\n')).toContain('0 errores, 1 avisos.');
  });

  test('`lila mcp --lang es` no muere en el parseArgs de mcp: --lang no es un positional', async () => {
    // Sin `extractLang` esto salía por «no acepta argumentos» antes de mirar el idioma.
    expect(await main(['mcp', '--lang', 'es', 'de-más'])).toBe(1);
    expect(out.join('\n')).toContain('lila mcp: no acepta argumentos.');
  });

  test('`--help` y el uso salen traducidos', async () => {
    expect(await main(['--help', '--lang', 'es'])).toBe(0);
    expect(out.join('\n')).toContain('Uso: lila validate');
    expect(out.join('\n')).toContain('--lang en|es');
  });

  test('un idioma que no existe sale con 1 y lista los que sí', async () => {
    expect(await main(['validate', pedido, '--lang', 'zz'])).toBe(1);
    expect(out.join('\n')).toContain('lila: --lang only accepts: en, es; got "zz".');
    // Y no llegó a validar nada.
    expect(out.join('\n')).not.toContain('Process Process_Restaurante');
  });

  test('`--lang` sin valor sale con 1', async () => {
    expect(await main(['validate', pedido, '--lang'])).toBe(1);
    expect(out.join('\n')).toContain('lila: --lang requires a value: en, es.');
  });

  test.each([
    ['argv sin --lang', ['validate', 'a.bpmn'], { argv: ['validate', 'a.bpmn'], lang: undefined }],
    ['--lang es', ['validate', '--lang', 'es', 'a.bpmn'], { argv: ['validate', 'a.bpmn'], lang: 'es' }],
    ['--lang=es', ['--lang=es', 'run'], { argv: ['run'], lang: 'es' }],
    ['--lang ES_MX.UTF-8', ['--lang', 'ES_MX.UTF-8'], { argv: [], lang: 'es' }],
    ['el último --lang gana', ['--lang=es', '--lang=en'], { argv: [], lang: 'en' }],
  ])('extractLang: %s', (_name, argv, expected) => {
    const { argv: rest, lang, invalid } = extractLang(argv as string[]);
    expect({ argv: rest, lang }).toEqual(expected);
    expect(invalid).toBeUndefined();
  });

  test.each([
    ['un idioma que no existe', ['--lang', 'zz'], 'zz'],
    ['--lang sin valor', ['validate', '--lang'], ''],
    ['--lang= vacío', ['--lang='], ''],
  ])('extractLang rechaza %s', (_name, argv, invalid) => {
    expect(extractLang(argv as string[]).invalid).toBe(invalid);
  });

  test.each([
    ['sin nada, inglés', undefined, {}, 'en'],
    ['LILA_LANG=es', undefined, { LILA_LANG: 'es' }, 'es'],
    ['LANG=es_MX.UTF-8', undefined, { LANG: 'es_MX.UTF-8' }, 'es'],
    ['LANG=C es la locale neutra, no un idioma', undefined, { LANG: 'C' }, 'en'],
    ['LANG=POSIX igual', undefined, { LANG: 'POSIX' }, 'en'],
    ['un idioma que no shipeamos cae a inglés en silencio', undefined, { LANG: 'fr_FR.UTF-8' }, 'en'],
    ['--lang gana a LILA_LANG', 'en', { LILA_LANG: 'es', LANG: 'es_MX' }, 'en'],
    ['LILA_LANG gana a LC_ALL y a LANG', undefined, { LILA_LANG: 'es', LC_ALL: 'en_US', LANG: 'en_US' }, 'es'],
    ['LC_ALL gana a LC_MESSAGES y a LANG', undefined, { LC_ALL: 'es_MX', LC_MESSAGES: 'en_US', LANG: 'en_US' }, 'es'],
    ['LC_MESSAGES gana a LANG', undefined, { LC_MESSAGES: 'es_MX', LANG: 'en_US' }, 'es'],
    ['una variable con basura no bloquea a la siguiente', undefined, { LILA_LANG: 'zz', LANG: 'es_MX' }, 'es'],
  ])('resolveLocale: %s', (_name, explicit, env, expected) => {
    expect(resolveLocale(explicit as string | undefined, env as Record<string, string>)).toBe(expected);
  });
});
