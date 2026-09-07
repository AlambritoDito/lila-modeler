import { describe, expect, it } from 'vitest';
import { findBpmnArg, isBpmnPath } from './openPath.js';

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
