/**
 * Aceptación de LILA-057: «exportar produce XML válido que `lila validate` acepta».
 *
 * La app exporta con `modeler.saveXML({ format: true })`, y por debajo eso es bpmn-moddle con
 * el descriptor `lila` serializando el árbol que el propio bpmn-moddle leyó al importar. Aquí
 * se reproduce ese ida y vuelta sin bpmn-js: montar el modelador de verdad exige un DOM con
 * SVG (`getBBox`, `getComputedTextLength`) que jsdom no implementa, y jsdom sería una
 * dependencia nueva que este ticket no puede añadir. Lo que sí se comprueba es exactamente lo
 * que hace `lila validate` con el archivo exportado: `validate(parseBpmn(xml))`.
 *
 * El ida y vuelta real con bpmn-js —abrir el benchmark en el navegador, exportar y pasar el
 * archivo descargado por `lila validate`— está verificado a mano; queda escrito en el
 * comentario del issue, con la captura en `docs/design/shell-modelar.png`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import { parseBpmn } from '../../../packages/engine/src/bpmn/parse.js';
import { sanitizeXmlIds } from '../../../packages/engine/src/bpmn/ids.js';
import { version } from '../../../packages/engine/src/version.js';
import { validate, type ValidationResult } from '../../../packages/engine/src/bpmn/validate.js';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import {
  advertenciasDePerdida,
  autorizarExportacion,
  finalizarExportacion,
  prepararImportacionTransaccional,
  referenciasRotas,
} from './modelerXml';

const raiz = new URL('../../../', import.meta.url);
const leer = (rel: string): string => readFileSync(new URL(rel, raiz), 'utf8');

/** Lo mismo que hace `saveXML({ format: true })` de la app, sin el DOM. */
async function exportar(xml: string): Promise<string> {
  const preparado = sanitizeXmlIds(xml);
  const moddle = BpmnModdle({ lila });
  const { rootElement } = await moddle.fromXML(preparado.xml);
  const serializado = (await moddle.toXML(rootElement, { format: true })).xml;
  return finalizarExportacion(serializado, preparado.sanitizedToOriginal);
}

/** Lo que imprimiría `lila validate` sobre ese XML. */
async function lilaValidate(xml: string): Promise<ValidationResult> {
  const parsed = await parseBpmn(xml);
  return validate(parsed.ir, {
    unsupported: parsed.unsupported,
    messageFlowCount: parsed.messageFlowCount,
    conditionFlowIds: parsed.conditionFlowIds,
  });
}

const BIZAGI = readdirSync(fileURLToPath(new URL('examples/bizagi-exports', raiz)))
  .filter((f) => f.endsWith('.bpmn'))
  .map((f) => `examples/bizagi-exports/${f}`);

describe('el XML que exporta la app web', () => {
  it('el benchmark exportado pasa `lila validate` con cero errores', async () => {
    const exportado = await exportar(leer('examples/pedido/model.bpmn'));

    expect(exportado.startsWith('<?xml')).toBe(true);
    // Los avisos no abortan (`docs/SEMANTICS.md` § 17): el benchmark tiene dos flujos de
    // mensaje entre pools y `lila validate` los reporta como W-MSGFLOW y sale con 0.
    expect((await lilaValidate(exportado)).errors).toEqual([]);
  });

  // Los fixtures de Bizagi son archivos reales, no procesos simulables: algunos traen
  // construcciones fuera de perfil y nodos inalcanzables, y `lila validate` los reporta con
  // razón. Lo que este ticket promete de ellos es que abrir y exportar no los empeora.
  //
  // Los `W-PARSE` (LILA-185) se comparan aparte: hablan del *archivo*, no del modelo. El
  // original trae referencias rotas a mensajes, data stores y categorías, y tipos que moddle
  // no conoce; al exportar, bpmn-moddle escribe el árbol que sí pudo leer y esas referencias
  // rotas ya no están, así que el archivo exportado tiene menos avisos de lectura, nunca más.
  // Lo que no puede pasar es que exportar haga aparecer pérdida de grafo donde no la había.
  it.each(['examples/pedido/model.bpmn', ...BIZAGI])(
    'exportar %s no cambia lo que dice `lila validate`',
    async (ruta) => {
      const original = leer(ruta);
      const antes = await lilaValidate(original);
      const despues = await lilaValidate(await exportar(original));

      const sinParse = (r: ValidationResult): ValidationResult => ({
        errors: r.errors,
        warnings: r.warnings.filter((w) => w.code !== 'W-PARSE'),
      });

      expect(sinParse(despues)).toEqual(sinParse(antes));
      expect(despues.warnings.filter((w) => w.code === 'W-PARSE').length).toBeLessThanOrEqual(
        antes.warnings.filter((w) => w.code === 'W-PARSE').length,
      );
    },
  );

  // Lo mismo que promete LILA-020 para la CLI: la app tampoco puede comerse las extensiones
  // ajenas. Se cuentan las etiquetas, no se compara el XML entero, porque bpmn-moddle
  // reordena atributos y reindenta al serializar.
  it.each(BIZAGI)('exportar %s conserva uno a uno los bizagi:', async (ruta) => {
    const original = leer(ruta);
    const etiquetas = (xml: string): number => (xml.match(/<bizagi:[A-Za-z]+/g) ?? []).length;

    expect(etiquetas(original)).toBeGreaterThan(0);
    expect(etiquetas(await exportar(original))).toBe(etiquetas(original));
  });

  it('conserva los elementos lila: al exportar', async () => {
    // Es lo que compra `moddleExtensions: { lila }`: sin el descriptor, bpmn-moddle trata los
    // `lila:*` como nodos genéricos.
    const con = leer('examples/pedido/model.bpmn')
      .replace(
        'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"\n' +
          '                  xmlns:lila="https://lila-modeler.org/schema/bpmn/1"',
      )
      .replace(
        '<bpmn:incoming>',
        '<bpmn:extensionElements><lila:responsibility type="R" roleRef="rol-cajero" />' +
          '</bpmn:extensionElements><bpmn:incoming>',
      );

    const exportado = await exportar(con);

    expect(exportado).toContain('<lila:responsibility type="R" roleRef="rol-cajero" />');
    expect((await lilaValidate(exportado)).errors).toEqual([]);
  });

  it.each(['"', "'"])('restaura ids no-NCName, referencias y DI con comilla %s', async (quote) => {
    const q = quote;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="Definitions_1" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id=${q}9Task bad.x${q} name="Revisar">
      <bpmn:extensionElements><lila:responsibility type="R" roleRef="rol-1" /></bpmn:extensionElements>
      <bpmn:documentation>Documento intacto</bpmn:documentation>
    </bpmn:task>
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef='Start_1' targetRef=${q}9Task bad.x${q} />
    <bpmn:sequenceFlow id="Flow_2" sourceRef=${q}9Task bad.x${q} targetRef='End_1' />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="Shape_Task" bpmnElement=${q}9Task bad.x${q}><dc:Bounds x="180" y="80" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Edge_1" bpmnElement="Flow_1"><di:waypoint x="100" y="120" /><di:waypoint x="180" y="120" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const exportado = await exportar(xml);
    expect(exportado).toContain('id="9Task bad.x"');
    expect(exportado).toContain('targetRef="9Task bad.x"');
    expect(exportado).toContain('sourceRef="9Task bad.x"');
    expect(exportado).toContain('bpmnElement="9Task bad.x"');
    expect(exportado).toContain('<bpmn:documentation>Documento intacto</bpmn:documentation>');
    expect(exportado).toContain('<lila:responsibility type="R" roleRef="rol-1" />');
    expect(exportado).toContain('exporter="Lila Modeler"');
    expect(exportado).toContain(`exporterVersion="${version}"`);

    const reabierto = await parseBpmn(exportado);
    const taskId = Object.keys(reabierto.ir.nodes).find(
      (id) => reabierto.ir.source.originalIds[id] === '9Task bad.x',
    );
    expect(taskId).toBeDefined();
    expect(Object.keys(reabierto.ir.flows)).toHaveLength(2);
    expect((await lilaValidate(exportado)).errors).toEqual([]);
  });

  it('prepara el reemplazo en una instancia candidata y destruye solo la fallida', async () => {
    const previo = { xml: '<modelo-previo />', historial: ['mover tarea'] };
    let destruido = false;
    const candidato = {
      importXML: async (): Promise<{ warnings: readonly unknown[] }> => {
        throw new Error('XML truncado');
      },
      destroy: (): void => {
        destruido = true;
      },
    };

    await expect(
      prepararImportacionTransaccional('<bpmn:definitions', () => candidato),
    ).rejects.toThrow('XML truncado');
    expect(destruido).toBe(true);
    expect(previo).toEqual({ xml: '<modelo-previo />', historial: ['mover tarea'] });
  });

  it('entrega al candidato el XML saneado y conserva el mapa reversible de esa instancia', async () => {
    let recibido = '';
    const candidato = {
      importXML: async (xml: string): Promise<{ warnings: readonly unknown[] }> => {
        recibido = xml;
        return { warnings: [] };
      },
      destroy: (): void => undefined,
    };

    const preparada = await prepararImportacionTransaccional(
      "<bpmn:task id='9Task bad.x' />",
      () => candidato,
    );
    const [saneado] = [...preparada.originalIds.keys()];
    expect(saneado).toBeDefined();
    expect(recibido).toContain(`id='${saneado}'`);
    expect(recibido).not.toContain('9Task bad.x');
    expect(preparada.originalIds.get(saneado as string)).toBe('9Task bad.x');
  });

  // Ante pérdida se corta todo —simulación, snapshot de guardar y descarga— salvo que venga el
  // `aceptarPerdida` que solo pone `App.tsx` tras el sí del usuario en el diálogo (LILA-192).
  it('bloquea toda exportación con pérdida salvo la que trae el sí del usuario', () => {
    const perdidas = ['unresolved reference <Flow_inexistente>'];

    expect(() => autorizarExportacion(perdidas, {})).toThrow(
      /Exportación bloqueada.*Flow_inexistente/s,
    );
    expect(() => autorizarExportacion(perdidas)).toThrow(/Exportación bloqueada/);
    expect(() => autorizarExportacion(perdidas, { aceptarPerdida: true })).not.toThrow();
    expect(() => autorizarExportacion([], {})).not.toThrow();
  });

  // LILA-192: el aviso previo a la descarga sale de aquí. Los `messageRef` / `dataStoreRef` /
  // `categoryValueRef` de los fixtures de Bizagi apuntan a ids que el archivo nunca declara;
  // bpmn-moddle no los resuelve, no entran en el árbol y el XML exportado ya no los lleva.
  it('enumera las referencias rotas del fixture de Bizagi que exportar se lleva por delante', async () => {
    const ruta = 'examples/bizagi-exports/bizagi-miwg-B.1.0-roundtrip.bpmn';
    const original = leer(ruta);

    expect(referenciasRotas(original)).toEqual([
      'Message_1373655174960',
      'Message_1373655174959',
      'DS1373655174514',
      'Value_Cat1373655174961',
    ]);
    // Y es verdad que se pierden: ninguno sobrevive al ida y vuelta.
    const exportado = await exportar(original);
    for (const id of referenciasRotas(original)) expect(exportado).not.toContain(id);
    // El resto de fixtures no tiene ninguna, así que abrirlos no enseña el aviso.
    expect(referenciasRotas(leer('examples/pedido/model.bpmn'))).toEqual([]);
  });

  it('no confunde una referencia resuelta ni un id declarado más abajo con una rota', () => {
    const sano = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
      <bpmn:receiveTask id="Task_1" messageRef='Message_1' />
      <bpmn:message id="Message_1" name="Pedido" />
    </bpmn:definitions>`;
    expect(referenciasRotas(sano)).toEqual([]);
    expect(referenciasRotas(sano.replace('id="Message_1"', 'id="Otro"'))).toEqual(['Message_1']);
  });

  // QA LILA-192: `dataObjectRef` se comporta igual que los otros tres —moddle no lo resuelve,
  // el elemento sale del árbol y el exportado lo pierde— pero no emite aviso, así que sin
  // enumerarlo la pérdida vuelve a ser silenciosa, que es justo lo que el ticket prohíbe.
  it('cuenta el `dataObjectRef` colgante, que se pierde sin que el import avise', async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">
      <bpmn:process id="P">
        <bpmn:dataObjectReference id="DOR_1" dataObjectRef="DO_fantasma" name="Solicitud" />
        <bpmn:dataObject id="DO_2" />
        <bpmn:dataObjectReference id="DOR_2" dataObjectRef="DO_2" />
      </bpmn:process>
    </bpmn:definitions>`;

    expect(referenciasRotas(xml)).toEqual(['DO_fantasma']);
    expect(await exportar(xml)).not.toContain('DO_fantasma');
    // Y ningún fixture real gana una referencia rota por mirar también este atributo.
    expect(referenciasRotas(leer('examples/pedido/model.bpmn'))).toEqual([]);
  });

  it('la importación preparada trae las referencias rotas del XML de origen', async () => {
    const candidato = {
      importXML: async (): Promise<{ warnings: readonly unknown[] }> => ({ warnings: [] }),
      destroy: (): void => undefined,
    };
    const preparada = await prepararImportacionTransaccional(
      '<bpmn:receiveTask id="Task_1" messageRef="Message_fantasma" />',
      () => candidato,
    );

    expect(preparada.refsRotas).toEqual(['Message_fantasma']);
    expect(preparada.perdidas).toEqual([]);
  });

  it('escapa la comilla doble de un id definido originalmente con comillas simples', async () => {
    const original = '9Task "bad"';
    const preparado = sanitizeXmlIds(`<bpmn:task id='${original}' />`);
    const [saneado] = [...preparado.sanitizedToOriginal.keys()];
    expect(saneado).toBeDefined();

    const restaurado = finalizarExportacion(
      `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ` +
        `id="Definitions_1"><bpmn:task id="${saneado}" /></bpmn:definitions>`,
      preparado.sanitizedToOriginal,
    );
    expect(restaurado).toContain('id="9Task &quot;bad&quot;"');
    await expect(BpmnModdle({ lila }).fromXML(restaurado)).resolves.toBeDefined();
  });

  it('identifica una referencia default rota real con su id y no confunde metadatos', async () => {
    const moddle = BpmnModdle({ lila });
    const roto = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
      id="Definitions_1" targetNamespace="urn:lila:test">
      <bpmn:process id="Process_1"><bpmn:exclusiveGateway id="Gateway_1"
        default="Flow_inexistente" /></bpmn:process>
    </bpmn:definitions>`;
    const { warnings } = await moddle.fromXML(roto);

    expect(advertenciasDePerdida(warnings)).toEqual([
      'unresolved reference <Flow_inexistente>',
    ]);
    expect(
      advertenciasDePerdida([
        { message: 'unresolved reference <Message_1>', property: 'bpmn:messageRef' },
      ]),
    ).toEqual([]);
  });
});
