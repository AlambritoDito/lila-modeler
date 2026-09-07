import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { main } from '../src/cli.js';

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
  expect(text).toContain('0 errores, 1 avisos.');
  expect(text).toContain('W-MSGFLOW');
  expect(text).toContain('Task_TomarPedido');
  expect(text).toContain('Flow_Aprobado: Gateway_Aprobacion -> Timer_Reposo');
  expect(text).toContain('Nodos (11)');
  expect(text).toContain('Flujos (11)');
});

// Aceptación LILA-045: con un fixture con boundary event ⇒ error y exit 1.
test('validate sobre un modelo con boundary event sale con 1 y cita el id', async () => {
  const code = await main(['validate', boundary]);
  const text = out.join('\n');

  expect(code).toBe(1);
  expect(text).toContain('E-NOSOP');
  expect(text).toContain('no soportado por el simulador');
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
  expect(human).toContain('aviso  W-MSGFLOW  Process_Warnings: se ignoraron 2 flujos de mensaje');
  expect(human).toContain('aviso  W-COND  Flow_Condition: conditionExpression se ignora');
  expect(human).toContain('0 errores, 2 avisos.');

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
  expect(out.join('\n')).toContain('Uso: lila validate');
});

test('un comando desconocido sale con 1', async () => {
  expect(await main(['simular', pedido])).toBe(1);
  expect(out.join('\n')).toContain('comando desconocido');
});

test('validate sin ruta sale con 1', async () => {
  expect(await main(['validate'])).toBe(1);
  expect(out.join('\n')).toContain('falta la ruta');
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
    'error  E-PARSE-INCOMPLETO  Task_Revisar: el lector XML descartó contenido del modelo, que quedó incompleto:',
  );
  expect(text).toContain('duplicate ID <Task_Revisar>');
  expect(text).toContain(
    'aviso  W-PARSE  Process_Incompleto: aviso del lector XML, sin pérdida de nodos ni flujos:',
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
