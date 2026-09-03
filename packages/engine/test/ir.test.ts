import { describe, expect, expectTypeOf, test } from 'vitest';

import {
  validateIr,
  type Flow,
  type IrProblem,
  type Node,
  type NodeType,
  type ProcessIR,
} from '../src/core/ir.js';

/** IR mínimo bien formado: start -> task -> end. */
function baseIr(): ProcessIR {
  return {
    id: 'Process_Pedido',
    name: 'Pedido',
    nodes: {
      StartEvent_Pedido: { type: 'start', name: 'Llega pedido', incoming: [], outgoing: ['Flow_1'] },
      Task_TomarPedido: {
        type: 'task',
        name: 'Tomar pedido',
        lane: 'Caja',
        incoming: ['Flow_1'],
        outgoing: ['Flow_2'],
      },
      EndEvent_Listo: { type: 'end', name: 'Pedido listo', incoming: ['Flow_2'], outgoing: [] },
    },
    flows: {
      Flow_1: { from: 'StartEvent_Pedido', to: 'Task_TomarPedido', name: '', isDefault: false },
      Flow_2: { from: 'Task_TomarPedido', to: 'EndEvent_Listo', name: '', isDefault: false },
    },
    source: {
      exporter: 'Bizagi Modeler',
      exporterVersion: '4.2.0',
      originalIds: {
        StartEvent_Pedido: 'StartEvent_Pedido',
        Task_TomarPedido: 'Task_TomarPedido',
        EndEvent_Listo: 'EndEvent_Listo',
      },
    },
  };
}

// ponytail: las aserciones `expectTypeOf` solo fallan con `vitest --typecheck`, que este repo
// todavía no ejecuta (haría falta un tsconfig que incluya `test/`, hoy fuera de `include`).
// Mientras tanto documentan el contrato y las bloquea el editor; el camino de mejora es
// cablearlo en el ticket de CI, no aquí.
describe('tipos del IR', () => {
  test('NodeType es exactamente el perfil soportado', () => {
    expectTypeOf<NodeType>().toEqualTypeOf<
      'start' | 'end' | 'terminate' | 'task' | 'xor' | 'or' | 'and' | 'timer'
    >();
  });

  test('nodos y flujos van keyed por id, nunca por nombre', () => {
    expectTypeOf<ProcessIR['nodes']>().toEqualTypeOf<Record<string, Node>>();
    expectTypeOf<ProcessIR['flows']>().toEqualTypeOf<Record<string, Flow>>();
    expectTypeOf<ProcessIR['source']['originalIds']>().toEqualTypeOf<Record<string, string>>();
  });

  test('lane y subprocessId son opcionales; el resto obligatorio', () => {
    expectTypeOf<Node>().toHaveProperty('incoming').toEqualTypeOf<string[]>();
    expectTypeOf<Flow>().toHaveProperty('isDefault').toEqualTypeOf<boolean>();
    const sinOpcionales: Node = { type: 'timer', name: 'Reposo', incoming: [], outgoing: [] };
    expect(sinOpcionales.lane).toBeUndefined();
    expect(sinOpcionales.subprocessId).toBeUndefined();
  });

  test('validateIr devuelve una lista de problemas', () => {
    expectTypeOf(validateIr).returns.toEqualTypeOf<IrProblem[]>();
  });
});

describe('validateIr', () => {
  test('un IR bien formado no tiene problemas', () => {
    expect(validateIr(baseIr())).toEqual([]);
  });

  test('un IR con flujo colgante es inválido', () => {
    const ir = baseIr();
    ir.flows['Flow_Colgante'] = {
      from: 'Task_TomarPedido',
      to: 'Task_Inexistente',
      name: '',
      isDefault: false,
    };

    const problems = validateIr(ir);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('E-FLUJO-COLGANTE');
    expect(problems[0]?.id).toBe('Flow_Colgante');
    expect(problems[0]?.message).toContain('Task_Inexistente');
  });

  test('un flujo cuyo origen no existe también es colgante', () => {
    const ir = baseIr();
    ir.flows['Flow_Colgante'] = {
      from: 'Task_Inexistente',
      to: 'EndEvent_Listo',
      name: '',
      isDefault: false,
    };

    expect(validateIr(ir).map((p) => p.code)).toEqual(['E-FLUJO-COLGANTE']);
  });

  test('un id declarado como nodo y como flujo es duplicado', () => {
    const ir = baseIr();
    ir.flows['Task_TomarPedido'] = {
      from: 'StartEvent_Pedido',
      to: 'EndEvent_Listo',
      name: '',
      isDefault: false,
    };

    const problems = validateIr(ir);

    expect(problems.map((p) => p.code)).toContain('E-ID-DUPLICADO');
    expect(problems.find((p) => p.code === 'E-ID-DUPLICADO')?.id).toBe('Task_TomarPedido');
  });

  test('incoming/outgoing que citan un flujo inexistente son referencia rota', () => {
    const ir = baseIr();
    ir.nodes['Task_TomarPedido']!.outgoing.push('Flow_Fantasma');

    const problems = validateIr(ir);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('E-REF-INEXISTENTE');
    expect(problems[0]?.id).toBe('Task_TomarPedido');
    expect(problems[0]?.message).toContain('Flow_Fantasma');
  });

  test('devuelve todos los problemas en una sola pasada', () => {
    const ir = baseIr();
    ir.flows['Flow_A'] = { from: 'Nodo_X', to: 'Nodo_Y', name: '', isDefault: false };
    ir.nodes['EndEvent_Listo']!.incoming.push('Flow_Fantasma');

    expect(validateIr(ir).map((p) => p.code)).toEqual([
      'E-REF-INEXISTENTE',
      'E-FLUJO-COLGANTE',
      'E-FLUJO-COLGANTE',
    ]);
  });
});
