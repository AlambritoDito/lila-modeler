import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { annotateElement, readAnnotations, writeAttributeDefinitions } from '../../src/bpmn/annotate.js';

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

// Fallos encontrados por el QA adversarial del PR 158.

test('un archivo cuyo contenido bpmn-moddle no sabe reescribir falla en vez de perderlo', async () => {
  const b20 = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../examples/bizagi-exports/bizagi-miwg-B.2.0-roundtrip.bpmn',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  await expect(readAnnotations(b20)).rejects.toThrow(/se perdería al guardarlo/);
  // bpmn-moddle's warnings are plain objects: their message, never "[object Object]" (#633).
  const error = await readAnnotations(b20).catch((e: unknown) => e as Error);
  expect(error.message).not.toContain('[object Object]');
  expect(error.message).toMatch(/unparsable content|unresolved reference/);
});

test('un id duplicado falla en vez de borrar el elemento repetido', async () => {
  const dup = pedido.replace('id="Task_Empacar"', 'id="Task_Revisar"');
  await expect(annotateElement(dup, 'Task_Revisar', { documentation: 'x' })).rejects.toThrow(
    /se perdería al guardarlo/,
  );
});

test('anota y lee un bpmn:lane, que no cuelga de flowElements', async () => {
  const conLane = pedido.replace(
    '<bpmn:startEvent id="StartEvent_Pedido"',
    '<bpmn:laneSet id="LaneSet_1"><bpmn:lane id="Lane_Caja" name="Caja" /></bpmn:laneSet><bpmn:startEvent id="StartEvent_Pedido"',
  );
  const written = await annotateElement(conLane, 'Lane_Caja', {
    responsibilities: [{ type: 'A', roleRef: 'rol-jefe' }],
  });
  expect((await readAnnotations(written))['Lane_Caja']?.responsibilities).toEqual([
    { type: 'A', roleRef: 'rol-jefe' },
  ]);
});

test('anota y lee un bpmn:participant de la colaboración', async () => {
  const written = await annotateElement(pedido, 'Participant_Restaurante', {
    refs: { systemRef: ['sys-pos'] },
  });
  expect((await readAnnotations(written))['Participant_Restaurante']?.refs).toEqual({
    systemRef: ['sys-pos'],
  });
});

test('lee y escribe lila:versionTag en el proceso', async () => {
  const written = await annotateElement(pedido, 'Process_Restaurante', { versionTag: '1.3.0' });
  expect((await readAnnotations(written))['Process_Restaurante']?.versionTag).toBe('1.3.0');
});

test('documentation vacía borra la documentación', async () => {
  const conDoc = await annotateElement(pedido, 'Task_Revisar', { documentation: 'algo' });
  const sinDoc = await annotateElement(conDoc, 'Task_Revisar', { documentation: '' });

  expect((await readAnnotations(conDoc))['Task_Revisar']?.documentation).toBe('algo');
  expect((await readAnnotations(sinDoc))['Task_Revisar']).toBeUndefined();
});

test('varias bpmn:documentation se leen todas', async () => {
  const dos = pedido.replace(
    '<bpmn:task id="Task_Revisar"',
    '<bpmn:task id="Task_X" name="X"><bpmn:documentation>uno</bpmn:documentation><bpmn:documentation>dos</bpmn:documentation></bpmn:task><bpmn:task id="Task_Revisar"',
  );
  expect((await readAnnotations(dos))['Task_X']?.documentation).toBe('uno\ndos');
});

describe('writeAttributeDefinitions (#633)', () => {
  const sla = { id: 'Attr_sla', name: 'SLA', type: 'number', appliesTo: 'task' };
  const level = { id: 'Attr_level', name: 'Level', type: 'list', appliesTo: 'task', options: ['Low', 'High'] };

  test('writes them on the collaboration and consolidates the copies left on a process', async () => {
    let xml = await annotateElement(pedido, 'Process_Restaurante', { versionTag: '3', attributeDefinitions: [sla] });
    xml = await annotateElement(xml, 'Collaboration_Pedido', { documentation: 'Pedidos', attributeDefinitions: [sla] });
    const out = await writeAttributeDefinitions(xml, [sla, level]);
    const read = await readAnnotations(out);
    expect(read['Collaboration_Pedido']).toEqual({ documentation: 'Pedidos', attributeDefinitions: [sla, level] });
    // The process keeps its other lila: elements; only the stray copy goes.
    expect(read['Process_Restaurante']).toEqual({ documentation: expect.any(String), versionTag: '3' });
  });

  test('on a diagram without a collaboration, the process holds them', async () => {
    const plain = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
  <bpmn:process id="P" isExecutable="false"><bpmn:task id="T" /></bpmn:process>
</bpmn:definitions>`;
    const read = await readAnnotations(await writeAttributeDefinitions(plain, [sla]));
    expect(read['P']).toEqual({ attributeDefinitions: [sla] });
  });

  test('drops the values the caller picks, and an extensionElements left empty', async () => {
    let xml = await annotateElement(pedido, 'Collaboration_Pedido', { attributeDefinitions: [sla, level] });
    xml = await annotateElement(xml, 'Task_TomarPedido', { attributes: [{ ref: 'Attr_level', value: 'High' }] });
    xml = await annotateElement(xml, 'Task_Revisar', {
      refs: { systemRef: ['sys-pos'] },
      attributes: [{ ref: 'Attr_level', value: 'Low' }, { ref: 'Attr_sla', value: '2' }],
    });
    const seen: string[] = [];
    const out = await writeAttributeDefinitions(xml, [sla], (value) => {
      seen.push(`${value.elementId}:${value.ref}=${value.value}`);
      return value.ref === 'Attr_level';
    });
    expect(seen).toEqual(['Task_TomarPedido:Attr_level=High', 'Task_Revisar:Attr_level=Low', 'Task_Revisar:Attr_sla=2']);
    const read = await readAnnotations(out);
    expect(read['Task_TomarPedido']).toBeUndefined();
    expect(read['Task_Revisar']).toEqual({ refs: { systemRef: ['sys-pos'] }, attributes: [{ ref: 'Attr_sla', value: '2' }] });
    expect(read['Collaboration_Pedido']).toEqual({ attributeDefinitions: [sla] });
    expect(out).not.toMatch(/<bpmn:extensionElements\s*\/>/);
  });

  test('none left: the host keeps no empty extensionElements, and the rest of the file is as bpmn-moddle writes it', async () => {
    const withOne = await annotateElement(pedido, 'Collaboration_Pedido', { attributeDefinitions: [sla] });
    const none = await writeAttributeDefinitions(withOne, []);
    expect(await readAnnotations(none)).toEqual(await readAnnotations(pedido));
    expect(none).toBe(await writeAttributeDefinitions(pedido, []));
  });
});
