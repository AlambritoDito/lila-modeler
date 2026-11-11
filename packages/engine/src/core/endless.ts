/**
 * #727 (R-ARR-11): a static check, before the first event, for a part of the process that a case
 * can enter but never leave, when the scenario has no `run.duration`.
 *
 * Without `run.duration` the run only ends when the heap empties (R-ARR-3). A case that reaches a
 * node from which no way out of the process can ever be taken cycles forever: the run never
 * stops and its event log grows until memory runs out. The only way the engine itself makes a
 * flow impossible is a probability of exactly 0, so that is the only thing this check reads; any
 * other way out, however unlikely, counts as one. The check is therefore conservative: it never
 * rejects a model whose cases can all end, and it does not catch an endless run whose cause is
 * anything other than probability 0.
 *
 * This file is `core/`: it imports nothing outside `core/`.
 */

import type { Node, ProcessIR } from './ir.js';
import { coded, coreMessages, type Locale } from './messages/index.js';

/** The part of a scenario the check reads; both `SimScenario` and the lint's `Scenario` fit. */
export interface EndlessCheckScenario {
  readonly run?: { readonly duration?: number | undefined } | undefined;
  readonly elements?: Readonly<Record<string, {
    readonly probability?: number | undefined;
    readonly conditions?: readonly unknown[] | undefined;
    readonly triggerCount?: number | undefined;
    readonly interTriggerTimer?: unknown;
  } | undefined>> | undefined;
}

/** A region a case can enter and never leave. */
export interface EndlessCycle {
  /** The first node of the region a case reaches, in breadth-first order from the starts. */
  entryId: string;
  /** A gateway inside the region whose only ways out have probability 0, when there is one. */
  gatewayId?: string;
}

type Elements = NonNullable<EndlessCheckScenario['elements']>;

/**
 * The outgoing flows of an exclusive gateway that its draw can take, with the weights of
 * R-XOR-1…5 (`drawXor` in `sim.ts`). A gateway with `conditions` on any outgoing flow keeps all
 * of them: which probability applies depends on the path the case took (R-COND-2). A gateway
 * whose weights add up to 0 is `E-XOR-SUMA-CERO`, reported elsewhere; it keeps all of them too.
 */
function xorTakeable(node: Node, elements: Elements): string[] {
  const outs = node.outgoing;
  if (outs.some((flowId) => elements[flowId]?.conditions !== undefined)) return outs;
  const declared = outs.map((flowId) => elements[flowId]?.probability);
  const missing = declared.filter((p) => p === undefined).length;
  const declaredSum = declared.reduce<number>((acc, p) => acc + (p ?? 0), 0);
  const share = missing === outs.length ? 1 / outs.length : Math.max(0, 1 - declaredSum) / missing;
  const weights = declared.map((p) => p ?? share);
  if (!weights.some((w) => w > 0)) return outs;
  return outs.filter((_, i) => weights[i]! > 0);
}

/**
 * The outgoing flows of an inclusive gateway that can be activated (R-OR-1…3, `drawOr` in
 * `sim.ts`): those with a weight above 0, plus the fallback of R-OR-3 when every draw can fail.
 */
function orTakeable(node: Node, ir: ProcessIR, elements: Elements): string[] {
  const outs = node.outgoing;
  const weights = outs.map((flowId) => elements[flowId]?.probability ?? 1);
  const takeable = outs.filter((_, i) => weights[i]! > 0);
  if (weights.every((w) => w < 1)) {
    let pick = outs.findIndex((flowId) => ir.flows[flowId]?.isDefault === true);
    if (pick < 0) {
      pick = 0;
      for (let i = 1; i < outs.length; i++) if (weights[i]! > weights[pick]!) pick = i;
    }
    if (!takeable.includes(outs[pick]!)) takeable.push(outs[pick]!);
  }
  return takeable;
}

/**
 * Finds a region of the process that a case can reach and never leave, when the scenario has no
 * `run.duration`; `undefined` otherwise. The exact rule is R-ARR-11 in `docs/SEMANTICS.md`.
 */
export function findEndlessCycle(ir: ProcessIR, scenario: EndlessCheckScenario): EndlessCycle | undefined {
  if (scenario.run?.duration !== undefined) return undefined;
  const elements: Elements = scenario.elements ?? {};
  const nodes = ir.nodes;
  const ids = Object.keys(nodes);

  // A terminate kills every token of its case (R-EVT-5): with a fork anywhere, one could end a
  // case whose other token is still cycling, so no region is ever certain to trap a case.
  const forks = ids.some((id) => {
    const node = nodes[id]!;
    return ((node.type === 'and' || node.type === 'or') && node.outgoing.length >= 2)
      || (node.attachedTo !== undefined && node.interrupting === false);
  });
  if (forks && ids.some((id) => nodes[id]!.type === 'terminate')) return undefined;

  // Boundary events, by host: the host can always leave through them (when in doubt, a way out).
  const boundaries = new Map<string, string[]>();
  for (const id of ids) {
    const host = nodes[id]!.attachedTo;
    if (host === undefined) continue;
    const list = boundaries.get(host);
    if (list === undefined) boundaries.set(host, [id]);
    else list.push(id);
  }
  // A node inside an embedded sub-process with a boundary event of its own (or of any enclosing
  // one) may be cancelled from outside: it is never reported, and counts as a way out.
  const parentOf = (subprocessId: string): string | undefined => ir.subprocesses?.[subprocessId]?.parent;
  const cancellable = (node: Node): boolean => {
    for (let s = node.subprocessId; s !== undefined; s = parentOf(s)) if (boundaries.has(s)) return true;
    return false;
  };

  /** Successors a token can actually move to, flows first, then the host's boundary events. */
  const removed = new Map<string, string[]>();
  const successors = (id: string): string[] => {
    const node = nodes[id]!;
    let flows = node.outgoing;
    if (node.type === 'xor' || node.type === 'or') {
      flows = node.type === 'xor' ? xorTakeable(node, elements) : orTakeable(node, ir, elements);
      if (flows.length < node.outgoing.length) {
        removed.set(id, node.outgoing.filter((flowId) => !flows.includes(flowId)));
      }
    }
    const next: string[] = [];
    for (const flowId of flows) {
      const to = ir.flows[flowId]?.to;
      if (to !== undefined && nodes[to] !== undefined) next.push(to);
    }
    for (const boundaryId of boundaries.get(id) ?? []) next.push(boundaryId);
    return next;
  };
  const graph = new Map<string, string[]>();
  for (const id of ids) graph.set(id, successors(id));

  // Ways out: an end, a terminate, a node with no outgoing flow, or a cancellable node.
  const canEnd = new Set<string>();
  const predecessors = new Map<string, string[]>();
  for (const id of ids) {
    for (const to of graph.get(id)!) {
      const list = predecessors.get(to);
      if (list === undefined) predecessors.set(to, [id]);
      else list.push(id);
    }
  }
  const queue: string[] = [];
  for (const id of ids) {
    const node = nodes[id]!;
    if (node.type === 'end' || node.type === 'terminate' || node.outgoing.length === 0 || cancellable(node)) {
      canEnd.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const from of predecessors.get(id) ?? []) {
      if (!canEnd.has(from)) {
        canEnd.add(from);
        queue.push(from);
      }
    }
  }
  if (canEnd.size === ids.length) return undefined;

  // Nodes a case can reach from a start that generates arrivals (R-ARR-1), breadth-first. A
  // parallel join is entered only once every one of its incoming flows can carry a token.
  const reached = new Set<string>();
  const order: string[] = [];
  const arrivedFrom = new Map<string, Set<string>>();
  const visit: string[] = [];
  for (const id of ids) {
    const node = nodes[id]!;
    const element = elements[id];
    if (node.type !== 'start') continue;
    if (element?.triggerCount === undefined && element?.interTriggerTimer === undefined) continue;
    reached.add(id);
    visit.push(id);
  }
  while (visit.length > 0) {
    const id = visit.shift()!;
    order.push(id);
    for (const to of graph.get(id)!) {
      if (reached.has(to)) continue;
      const target = nodes[to]!;
      if (target.type === 'and' && target.incoming.length >= 2) {
        const sources = arrivedFrom.get(to) ?? new Set<string>();
        sources.add(id);
        arrivedFrom.set(to, sources);
        if (sources.size < new Set(target.incoming.map((flowId) => ir.flows[flowId]?.from)).size) continue;
      }
      reached.add(to);
      visit.push(to);
    }
  }

  const trapped = order.filter((id) => !canEnd.has(id));
  if (trapped.length === 0) return undefined;
  // Every path from a trapped node goes on forever in a finite graph, so it ends up in a cycle:
  // name the first node of one, rather than a start or a task on the way to it.
  const onCycle = (id: string): boolean => {
    const seen = new Set<string>();
    const stack = [...graph.get(id)!];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === id) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...graph.get(next)!);
    }
    return false;
  };
  const entryId = trapped.find(onCycle) ?? trapped[0]!;
  const zeroExit = (id: string): boolean =>
    (removed.get(id) ?? []).some((flowId) => canEnd.has(ir.flows[flowId]!.to));
  const gatewayId = trapped.find(zeroExit) ?? trapped.find((id) => removed.has(id));
  return gatewayId === undefined ? { entryId } : { entryId, gatewayId };
}

/** The node's name with its id, or the bare id when it has no name of its own. */
export function nodeLabel(ir: ProcessIR, id: string): string {
  const name = ir.nodes[id]?.name;
  return !name || name === id ? id : `${name} (${id})`;
}

/** The message body of `E-CICLO-SIN-SALIDA` for a region `findEndlessCycle` found. */
export function endlessCycleMessage(ir: ProcessIR, cycle: EndlessCycle, locale: Locale = 'en'): string {
  const M = coreMessages(locale).codes;
  return cycle.gatewayId === undefined
    ? M['E-CICLO-SIN-SALIDA/elemento'](nodeLabel(ir, cycle.entryId))
    : M['E-CICLO-SIN-SALIDA/gateway'](nodeLabel(ir, cycle.entryId), nodeLabel(ir, cycle.gatewayId));
}

/**
 * R-ARR-11: preflight with the same contract as the loop marker's (before any public callback).
 * `validateScenario` reports the same defect; `core/` repeats it because the run would never stop.
 */
export function assertNoEndlessCycle(ir: ProcessIR, scenario: EndlessCheckScenario, locale: Locale = 'en'): void {
  const cycle = findEndlessCycle(ir, scenario);
  if (cycle !== undefined) throw new RangeError(coded('E-CICLO-SIN-SALIDA', endlessCycleMessage(ir, cycle, locale)));
}
