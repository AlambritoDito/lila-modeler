/**
 * #534: deleting a pool and undoing it has to give the simulation back the model it had.
 *
 * The bench is `AtributosExtendidos.test.tsx`'s `bancoDePegado` without the canvas (jsdom cannot
 * draw): a real diagram-js `CommandStack` and, for the semantic side of `shape.delete`, bpmn-js's
 * own `BpmnUpdater.updateSemanticParent` — the call that takes a pool's process out of
 * `definitions.rootElements` and, on ⌘Z, puts it back at the end.
 */
import { simulate } from '@lila-modeler/engine';
import BpmnUpdater from 'bpmn-js/lib/features/modeling/BpmnUpdater';
import UnclaimIdBehavior from 'bpmn-js/lib/features/modeling/behavior/UnclaimIdBehavior';
import IdClaimHandler from 'bpmn-js/lib/features/modeling/cmd/IdClaimHandler';
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import CommandStack from 'diagram-js/lib/command/CommandStack';
import EventBus from 'diagram-js/lib/core/EventBus';
import { Ids } from 'ids';
import { expect, it } from 'vitest';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import { EJEMPLOS } from './ejemplos';
import { OrdenAlDeshacer, ReclamoDeProcesos } from './lote';
import { prepareSimulation } from './simulationGate';

const pedido = EJEMPLOS.find((e) => e.id === 'pedido')!;
const archivo = Object.keys(pedido.escenarios)[0]!;

async function simular(modelo: string) {
  const { ir, scenario } = await prepareSimulation(modelo, archivo, pedido.escenarios);
  return simulate(ir, { ...scenario, run: { ...scenario.run, replications: 1, duration: 86_400, seed: 7 } });
}

it('deleting the Restaurant pool and undoing it simulates exactly as before (#534)', async () => {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(pedido.modelo);
  const eventBus = new EventBus();
  const commandStack = new CommandStack(eventBus, { get: () => undefined } as never);
  const colaboracion = definitions.rootElements!.find((r) => r.$type === 'bpmn:Collaboration')!;
  type Ctx = { shape?: { type: string; businessObject: ModdleElement }; connection?: { businessObject: ModdleElement }; padre?: ModdleElement | undefined };
  // What `DeleteShapeHandler` and `BpmnUpdater` do, minus the canvas: a pool's message flows and
  // children go first, as nested deletes, and each element leaves its parent's list and comes
  // back to its END on ⌘Z (bpmn-js's own `updateSemanticParent`).
  const borrar = (bo: ModdleElement) => (bo.$type === 'bpmn:SequenceFlow' || bo.$type === 'bpmn:MessageFlow'
    ? commandStack.execute('connection.delete', { connection: { businessObject: bo } })
    : commandStack.execute('shape.delete', { shape: { type: bo.$type, businessObject: bo } }));
  const handler = {
    preExecute: ({ shape }: Ctx) => {
      if (shape?.type !== 'bpmn:Participant') return;
      const proceso = shape.businessObject.processRef!;
      const dentro = new Set([shape.businessObject, ...proceso.flowElements!]);
      for (const m of [...colaboracion.messageFlows!]) if (dentro.has(m.sourceRef!) || dentro.has(m.targetRef!)) borrar(m);
      for (const fe of [...proceso.flowElements!]) borrar(fe);
    },
    execute: (ctx: Ctx) => {
      const bo = (ctx.shape ?? ctx.connection)!.businessObject;
      ctx.padre = bo.$parent;
      BpmnUpdater.prototype.updateSemanticParent.call({}, bo as never, null as never, undefined as never);
      return [];
    },
    revert: (ctx: Ctx) => {
      BpmnUpdater.prototype.updateSemanticParent.call({}, (ctx.shape ?? ctx.connection)!.businessObject as never, ctx.padre as never, undefined as never);
      return [];
    },
  };
  commandStack.register('shape.delete', handler as never);
  commandStack.register('connection.delete', handler as never);
  new OrdenAlDeshacer(eventBus as never);

  const pool = colaboracion.participants!.find((p) => p.id === 'Participant_Restaurante')!;
  commandStack.execute('shape.delete', { shape: { type: 'bpmn:Participant', businessObject: pool } });
  commandStack.undo();

  const deshecho = (await moddle.toXML(definitions)).xml;
  expect((await simular(deshecho)).process).toEqual((await simular(pedido.modelo)).process);
  expect(colaboracion.participants!.map((p) => p.id)).toEqual(['Participant_Restaurante', 'Participant_Cliente']);

  // Redo deletes it again (taking the places again); a second undo restores the same document,
  // which is the one before the first delete.
  commandStack.redo();
  commandStack.undo();
  expect((await moddle.toXML(definitions)).xml).toBe(deshecho);
  expect(deshecho).toBe((await moddle.toXML((await moddle.fromXML(pedido.modelo)).rootElement)).xml);
});

it('a paste redone after undoing it and the delete before it keeps its ids, so the next paste gets new ones (#534)', () => {
  const moddle = BpmnModdle({ lila });
  const ids = new Ids([32, 36, 1]);
  const eventBus = new EventBus();
  const commandStack = new CommandStack(eventBus, { get: () => undefined } as never);
  const proceso = moddle.create('bpmn:Process', { id: 'Process_R' });
  const pool = moddle.create('bpmn:Participant', { id: 'Participant_R', processRef: proceso });
  ids.claim('Participant_R', pool);
  ids.claim('Process_R', proceso);
  commandStack.register('id.updateClaim', new IdClaimHandler({ ids } as never));
  const nada = { execute: () => [], revert: () => [] };
  commandStack.register('shape.delete', nada as never);
  commandStack.register('shape.create', nada as never);
  new UnclaimIdBehavior({} as never, { invoke: (F: (bus: unknown) => void, self: unknown) => F.call(self, eventBus) } as never, { ids } as never,
    { unclaimId: (id: string, element: unknown) => commandStack.execute('id.updateClaim', { id, element }) } as never);
  new ReclamoDeProcesos(eventBus as never, { ids } as never);

  commandStack.execute('shape.delete', { shape: { type: 'bpmn:Participant', businessObject: pool, di: {} } });
  // The paste of the copy keeps both freed ids (`ModdleCopy._copyId` claims them, outside the command).
  const procesoPegado = moddle.create('bpmn:Process', { id: 'Process_R' });
  const pegado = moddle.create('bpmn:Participant', { id: 'Participant_R', processRef: procesoPegado });
  ids.claim('Participant_R', pegado);
  ids.claim('Process_R', procesoPegado);
  commandStack.execute('shape.create', { shape: { type: 'bpmn:Participant', businessObject: pegado } });

  commandStack.undo();
  commandStack.undo();
  commandStack.redo();
  commandStack.redo();
  expect(ids.assigned('Participant_R')).toBe(pegado);
  expect(ids.assigned('Process_R')).toBe(procesoPegado);
});
