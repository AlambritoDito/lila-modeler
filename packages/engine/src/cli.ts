#!/usr/bin/env node
/**
 * CLI `lila`. Hoy solo `validate`; `run` y `compare` llegan con el motor (M1 y M2).
 *
 * Es el único borde que toca disco: el parser y el validador reciben cadenas y objetos. Sin
 * dependencias: `node:util.parseArgs` viene con Node.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseBpmn } from './bpmn/parse.js';
import { validate } from './bpmn/validate.js';

const USAGE = `Uso: lila validate <archivo.bpmn> [--json]

  validate   Parsea un .bpmn, imprime los nodos y flujos del IR y valida el modelo.
             Sale con 1 si hay errores.

Opciones:
  --json     Imprime el IR y los problemas como JSON en vez de tabla.
  -h, --help Muestra esta ayuda.`;

/** Cuenta los nodos por tipo para la línea de resumen. */
function countByType(nodes: Record<string, { type: string }>): string {
  const counts = new Map<string, number>();
  for (const node of Object.values(nodes)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');
}

async function validateCommand(file: string, json: boolean): Promise<number> {
  const xml = readFileSync(file, 'utf8');
  const { ir, ignoredProcessIds, unsupported } = await parseBpmn(xml);
  const { errors, warnings } = validate(ir, { unsupported });

  if (json) {
    console.log(JSON.stringify({ ir, ignoredProcessIds, errors, warnings }, null, 2));
    return errors.length > 0 ? 1 : 0;
  }

  console.log(`Proceso ${ir.id}${ir.name === '' ? '' : ` (${ir.name})`}`);
  if (ir.source.exporter !== '') {
    console.log(`Exportado por ${ir.source.exporter} ${ir.source.exporterVersion}`.trimEnd());
  }
  console.log('');

  const nodeIds = Object.keys(ir.nodes);
  console.log(`Nodos (${nodeIds.length}): ${countByType(ir.nodes)}`);
  for (const id of nodeIds) {
    const node = ir.nodes[id];
    if (node === undefined) continue;
    const lane = node.lane === undefined ? '' : `  [${node.lane}]`;
    console.log(`  ${node.type.padEnd(9)} ${id}${node.name === '' ? '' : `  ${node.name}`}${lane}`);
  }

  const flowIds = Object.keys(ir.flows);
  console.log('');
  console.log(`Flujos (${flowIds.length}):`);
  for (const id of flowIds) {
    const flow = ir.flows[id];
    if (flow === undefined) continue;
    const mark = flow.isDefault ? '  (por defecto)' : '';
    console.log(`  ${id}: ${flow.from} -> ${flow.to}${flow.name === '' ? '' : `  ${flow.name}`}${mark}`);
  }

  if (ignoredProcessIds.length > 0) {
    console.log('');
    console.log(`Otros procesos del archivo, no simulados: ${ignoredProcessIds.join(', ')}`);
  }

  console.log('');
  for (const warning of warnings) console.log(`aviso  ${warning.code}  ${warning.message}`);
  for (const error of errors) console.log(`error  ${error.code}  ${error.message}`);
  console.log(`${errors.length} errores, ${warnings.length} avisos.`);

  return errors.length > 0 ? 1 : 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });

  const [command, file] = positionals;

  if (values.help === true || command === undefined) {
    console.log(USAGE);
    return command === undefined && values.help !== true ? 1 : 0;
  }

  if (command !== 'validate') {
    console.error(`lila: comando desconocido "${command}".`);
    console.error(USAGE);
    return 1;
  }

  if (file === undefined) {
    console.error('lila validate: falta la ruta del archivo .bpmn.');
    return 1;
  }

  return validateCommand(file, values.json === true);
}

// Se ejecuta solo cuando se invoca como programa, no cuando el test importa `main`. `realpath`
// porque npm instala el bin como symlink en `node_modules/.bin/lila`.
const invoked =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === import.meta.filename;
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`lila: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
