import { resolveScenarioPath } from '@lila/engine/schema';
import type { ProcessIR } from '@lila/engine';
import { runResultSchema } from '@lila/engine/result-schema';
import type { ProjectDocument, ProjectSessionStore, ProjectStore, ScenarioDocument } from './store/ProjectStore';

export function projectStore(store: ProjectStore): ProjectSessionStore | null {
  const candidate = store as Partial<ProjectSessionStore>;
  return typeof candidate.openProject === 'function' && typeof candidate.saveProject === 'function' && typeof candidate.createProject === 'function'
    ? candidate as ProjectSessionStore : null;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function revision(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
/** Validación de estructura; los escenarios pueden contener borradores inválidos. */
export function readProject(value: unknown): ProjectDocument {
  if (!object(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string' || !object(value.model)
    || typeof value.model.id !== 'string' || typeof value.model.name !== 'string' || typeof value.model.xml !== 'string' || !revision(value.model.revision)
    || !object(value.scenarios) || !Object.values(value.scenarios).every(object) || !object(value.scenarioRevisions)
    || !Object.values(value.scenarioRevisions).every(revision) || !Array.isArray(value.runs)) throw new Error('Documento de proyecto inválido o versión no soportada.');
  for (const run of value.runs) {
    if (!object(run) || typeof run.id !== 'string' || typeof run.scenarioName !== 'string' || !object(run.inputs)
      || !revision(run.inputs.modelRevision) || !revision(run.inputs.scenarioRevision) || typeof run.inputs.xml !== 'string' || !object(run.inputs.scenario)
      || !runResultSchema.safeParse(run.result).success) throw new Error('Corrida guardada inválida.');
  }
  return value as unknown as ProjectDocument;
}
export function defaultScenarios(ir: ProcessIR): Record<string, ScenarioDocument> {
  const elements: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.type === 'start') elements[id] = { triggerCount: 20, interTriggerTimer: { type: 'constant', value: 60 } };
    if (node.type === 'task') elements[id] = { processingTime: { type: 'constant', value: 60 } };
  }
  return {
    'as-is.scenario.json': { version: 1, name: 'AS-IS', model: 'model.bpmn', run: { start: '2026-09-07T08:00:00Z', duration: 3600, warmup: 0, replications: 3, seed: 42, baseTimeUnit: 'min', currency: 'MXN' }, elements },
    'to-be.scenario.json': { version: 1, name: 'TO-BE', extends: 'as-is.scenario.json' },
  };
}
/** Documento inicio → tarea → fin con DI; ids distintos en cada proyecto. */
export function newModelXml(): string {
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const p = `Process_${suffix}`, a = `Start_${suffix}`, b = `Task_${suffix}`, c = `End_${suffix}`, f = `Flow_A_${suffix}`, g = `Flow_B_${suffix}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${suffix}" targetNamespace="https://lila-modeler.org/bpmn" exporter="Lila Modeler" exporterVersion="0.0.0">
<bpmn:process id="${p}" name="Mi proceso" isExecutable="false">
<bpmn:startEvent id="${a}" name="Inicio"><bpmn:outgoing>${f}</bpmn:outgoing></bpmn:startEvent>
<bpmn:task id="${b}" name="Actividad"><bpmn:incoming>${f}</bpmn:incoming><bpmn:outgoing>${g}</bpmn:outgoing></bpmn:task>
<bpmn:endEvent id="${c}" name="Fin"><bpmn:incoming>${g}</bpmn:incoming></bpmn:endEvent>
<bpmn:sequenceFlow id="${f}" sourceRef="${a}" targetRef="${b}"/><bpmn:sequenceFlow id="${g}" sourceRef="${b}" targetRef="${c}"/>
</bpmn:process><bpmndi:BPMNDiagram id="Diagram_${suffix}"><bpmndi:BPMNPlane id="Plane_${suffix}" bpmnElement="${p}">
<bpmndi:BPMNShape id="ShapeA_${suffix}" bpmnElement="${a}"><dc:Bounds x="160" y="180" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="ShapeB_${suffix}" bpmnElement="${b}"><dc:Bounds x="260" y="158" width="100" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="ShapeC_${suffix}" bpmnElement="${c}"><dc:Bounds x="430" y="180" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNEdge id="EdgeA_${suffix}" bpmnElement="${f}"><di:waypoint x="196" y="198"/><di:waypoint x="260" y="198"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="EdgeB_${suffix}" bpmnElement="${g}"><di:waypoint x="360" y="198"/><di:waypoint x="430" y="198"/></bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
export function changeToken(id: string, modelRevision: number, scenarios: Readonly<Record<string, number>>, runIds: readonly string[]): string {
  return JSON.stringify([id, modelRevision, scenarios, runIds]);
}

/** Editar un padre invalida sus descendientes; los escenarios independientes siguen actuales. */
export function nextScenarioRevisions(file: string, scenarios: Readonly<Record<string, ScenarioDocument>>, revisions: Readonly<Record<string, number>>): Record<string, number> {
  const affected = new Set([file]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, raw] of Object.entries(scenarios)) {
      if (typeof raw.extends === 'string' && affected.has(resolveScenarioPath(name, raw.extends)) && !affected.has(name)) { affected.add(name); grew = true; }
    }
  }
  return { ...revisions, ...Object.fromEntries([...affected].map((name) => [name, (revisions[name] ?? 0) + 1])) };
}
