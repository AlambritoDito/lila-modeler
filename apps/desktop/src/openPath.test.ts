import { describe, expect, it } from 'vitest';
import { findBpmnArg, isBpmnPath, isMiscasedModelFile } from './openPath.js';

describe('isBpmnPath', () => {
  it('acepta .bpmn en cualquier combinación de mayúsculas/minúsculas', () => {
    expect(isBpmnPath('/ruta/model.bpmn')).toBe(true);
    expect(isBpmnPath('/ruta/Model.BPMN')).toBe(true);
  });

  it('rechaza otras extensiones', () => {
    expect(isBpmnPath('/ruta/model.xml')).toBe(false);
    expect(isBpmnPath('/ruta/sin-extension')).toBe(false);
  });
});

describe('isMiscasedModelFile (LILA-206, P3 del QA)', () => {
  it('detecta model.bpmn escrito con otras mayúsculas', () => {
    expect(isMiscasedModelFile('Model.bpmn')).toBe(true);
    expect(isMiscasedModelFile('MODEL.BPMN')).toBe(true);
    expect(isMiscasedModelFile('model.BPMN')).toBe(true);
  });

  it('el model.bpmn exacto no lo es: es el modelo del proyecto y se abre con normalidad', () => {
    expect(isMiscasedModelFile('model.bpmn')).toBe(false);
  });

  it('otro diagrama de la misma carpeta no lo es, con las mayúsculas que sea', () => {
    expect(isMiscasedModelFile('ventas.bpmn')).toBe(false);
    expect(isMiscasedModelFile('Ventas.BPMN')).toBe(false);
    expect(isMiscasedModelFile('modelo.bpmn')).toBe(false);
  });
});

describe('findBpmnArg', () => {
  it('encuentra la primera ruta .bpmn a partir de "skip"', () => {
    const argv = ['/usr/bin/electron', '/app', '--flag', '/ruta/model.bpmn'];
    expect(findBpmnArg(argv, 2)).toBe('/ruta/model.bpmn');
  });

  it('ignora lo que hay antes de "skip"', () => {
    const argv = ['/ruta/anterior.bpmn', '/app', '/ruta/actual.bpmn'];
    expect(findBpmnArg(argv, 1)).toBe('/ruta/actual.bpmn');
  });

  it('null si ningún argumento califica', () => {
    expect(findBpmnArg(['/usr/bin/electron', '/app', '--flag'], 2)).toBeNull();
  });

  it('ignora una flag que "termina" en .bpmn (empieza por "-")', () => {
    expect(findBpmnArg(['/usr/bin/electron', '/app', '--modelo.bpmn'], 2)).toBeNull();
  });

  it('second-instance: skip=1 salta solo el propio ejecutable', () => {
    expect(findBpmnArg(['/usr/bin/lila-modeler', '/ruta/model.bpmn'], 1)).toBe('/ruta/model.bpmn');
  });
});
