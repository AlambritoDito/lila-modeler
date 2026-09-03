import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { annotateElement, readAnnotations } from '../../src/bpmn/annotate.js';

const pedido = readFileSync(
  fileURLToPath(new URL('../../../../examples/pedido/model.bpmn', import.meta.url)),
  'utf8',
);

const bizagi = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn',
      import.meta.url,
    ),
  ),
  'utf8',
);

// Aceptación LILA-022: añadir `lila:responsibility` y volver a leer devuelve lo escrito.
test('escribe lila:responsibility y volver a leer devuelve lo escrito', async () => {
  const written = await annotateElement(pedido, 'Task_TomarPedido', {
    documentation: 'El cajero toma el pedido en mostrador.',
    responsibilities: [
      { type: 'R', roleRef: 'rol-cajero' },
      { type: 'A', roleRef: 'rol-gerente' },
    ],
    refs: { systemRef: ['sys-pos'], kpiRef: ['kpi-tiempo-atencion'] },
  });

  const read = await readAnnotations(written);
  expect(read['Task_TomarPedido']).toEqual({
    documentation: 'El cajero toma el pedido en mostrador.',
    responsibilities: [
      { type: 'R', roleRef: 'rol-cajero' },
      { type: 'A', roleRef: 'rol-gerente' },
    ],
    refs: { systemRef: ['sys-pos'], kpiRef: ['kpi-tiempo-atencion'] },
  });
});

// Aceptación LILA-022: el resto del XML no cambia (diff mínimo). Se mide contra otra salida de
// bpmn-moddle, porque la primera serialización normaliza el formato del archivo de entrada.
test('anotar un elemento no cambia ninguna otra línea del XML', async () => {
  const base = await annotateElement(pedido, 'Task_TomarPedido', { documentation: 'a' });
  const changed = await annotateElement(base, 'Task_Preparar', {
    responsibilities: [{ type: 'R', roleRef: 'rol-cocinero' }],
  });

  const before = base.split('\n');
  const after = changed.split('\n');
  const added = after.filter((line) => !before.includes(line));
  const removed = before.filter((line) => !after.includes(line));

  // Lo único que se añade es el bloque del elemento anotado; lo único que se "quita" es la
  // línea de `bpmn:definitions`, y solo porque ahora declara el namespace lila.
  expect(added).toEqual([
    expect.stringContaining('xmlns:lila='),
    '      <bpmn:extensionElements>',
    '        <lila:responsibility type="R" roleRef="rol-cocinero" />',
    '      </bpmn:extensionElements>',
  ]);
  expect(removed).toHaveLength(1);
  expect(removed[0]).toContain('<bpmn:definitions');
  expect(removed[0]).not.toContain('xmlns:lila=');
});

test('anotar dos veces reemplaza, no duplica', async () => {
  const once = await annotateElement(pedido, 'Task_Revisar', {
    responsibilities: [{ type: 'R', roleRef: 'rol-a' }],
  });
  const twice = await annotateElement(once, 'Task_Revisar', {
    responsibilities: [{ type: 'R', roleRef: 'rol-b' }],
  });

  const read = await readAnnotations(twice);
  expect(read['Task_Revisar']?.responsibilities).toEqual([{ type: 'R', roleRef: 'rol-b' }]);
});

test('una clave ausente deja intacto lo que ya estaba', async () => {
  const withBoth = await annotateElement(pedido, 'Task_Revisar', {
    documentation: 'texto',
    responsibilities: [{ type: 'R', roleRef: 'rol-a' }],
  });
  const onlyDoc = await annotateElement(withBoth, 'Task_Revisar', { documentation: 'otro' });

  const read = await readAnnotations(onlyDoc);
  expect(read['Task_Revisar']).toEqual({
    documentation: 'otro',
    responsibilities: [{ type: 'R', roleRef: 'rol-a' }],
  });
});

test('conserva las extensiones ajenas de un archivo real de Bizagi', async () => {
  const countBizagi = (xml: string) => (xml.match(/<bizagi:/g) ?? []).length;

  const targetId = /<bpmn:task id="([^"]+)"|<task id="([^"]+)"/i.exec(bizagi);
  const id = targetId?.[1] ?? targetId?.[2];
  expect(id).toBeDefined();

  const written = await annotateElement(bizagi, id as string, {
    responsibilities: [{ type: 'R', roleRef: 'rol-1' }],
  });

  expect(countBizagi(written)).toBe(countBizagi(bizagi));
  expect((await readAnnotations(written))[id as string]?.responsibilities).toEqual([
    { type: 'R', roleRef: 'rol-1' },
  ]);
});

test('un id inexistente falla citando el id', async () => {
  await expect(annotateElement(pedido, 'No_Existe', { documentation: 'x' })).rejects.toThrow(
    /No_Existe/,
  );
});

test('un elemento sin anotaciones no aparece en readAnnotations', async () => {
  const read = await readAnnotations(pedido);
  expect(read['Task_TomarPedido']).toBeUndefined();
});
