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
import { validate, type ValidationResult } from '../../../packages/engine/src/bpmn/validate.js';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };

const raiz = new URL('../../../', import.meta.url);
const leer = (rel: string): string => readFileSync(new URL(rel, raiz), 'utf8');

/** Lo mismo que hace `saveXML({ format: true })` de la app, sin el DOM. */
async function exportar(xml: string): Promise<string> {
  const moddle = BpmnModdle({ lila });
  const { rootElement } = await moddle.fromXML(xml);
  return (await moddle.toXML(rootElement, { format: true })).xml;
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
  it.each(['examples/pedido/model.bpmn', ...BIZAGI])(
    'exportar %s no cambia lo que dice `lila validate`',
    async (ruta) => {
      const original = leer(ruta);
      expect(await lilaValidate(await exportar(original))).toEqual(await lilaValidate(original));
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
});
