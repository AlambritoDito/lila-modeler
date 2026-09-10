import { resolveScenarioPath } from '@lila/engine/schema';
import { marcarExportador } from '@lila/engine/bpmn';
import type { ProcessIR } from '@lila/engine';
import { ProjectFormatError, readProjectDocument } from '@lila/engine/project';
import type { ProjectErrorCode } from '@lila/engine/project';
import type { ProjectDocument, ProjectSessionStore, ProjectStore, ScenarioDocument } from './store/ProjectStore';
import { strings } from './i18n';

export function projectStore(store: ProjectStore): ProjectSessionStore | null {
  const candidate = store as Partial<ProjectSessionStore>;
  return typeof candidate.openProject === 'function' && typeof candidate.saveProject === 'function' && typeof candidate.createProject === 'function'
    ? candidate as ProjectSessionStore : null;
}
/**
 * Localized wrapper over the engine's structural validation (ADR-024). The rules themselves moved
 * to `@lila/engine/project` so that the `.lila` container, the desktop folder reader and this app
 * cannot disagree about what a project is; what stays here is the wording, keyed by the stable
 * `code` each failure carries instead of by its English message.
 */
const MENSAJES: Partial<Record<ProjectErrorCode, (S: ReturnType<typeof strings>) => string>> = {
  'LILA-DOCUMENT': (S) => S.proyecto.errorDocumento,
  'LILA-PROBLEMS': (S) => S.proyecto.errorDiagnostico,
  'LILA-RUN': (S) => S.proyecto.errorCorrida,
  'LILA-RUN-INPUTS': (S) => S.proyecto.errorEntradasCorrida,
};

export function readProject(value: unknown): ProjectDocument {
  try {
    return readProjectDocument(value);
  } catch (error) {
    if (error instanceof ProjectFormatError) {
      const mensaje = MENSAJES[error.code];
      throw new Error(mensaje === undefined ? error.message : mensaje(strings()));
    }
    throw error;
  }
}

export function defaultScenarios(ir: ProcessIR): Record<string, ScenarioDocument> {
  const S = strings();
  const elements: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.type === 'start') elements[id] = { triggerCount: 20, interTriggerTimer: { type: 'constant', value: 60 } };
    if (node.type === 'task') elements[id] = { processingTime: { type: 'constant', value: 60 } };
  }
  return {
    'as-is.scenario.json': { version: 1, name: S.proyecto.escenarioAsIs, model: 'model.bpmn', run: { start: '2026-09-07T08:00:00Z', duration: 3600, warmup: 0, replications: 3, seed: 42, baseTimeUnit: 'min', currency: 'MXN' }, elements },
    'to-be.scenario.json': { version: 1, name: S.proyecto.escenarioToBe, extends: 'as-is.scenario.json' },
  };
}
/** Documento inicio → tarea → fin con DI; ids distintos en cada proyecto. */
export function newModelXml(): string {
  const S = strings();
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const p = `Process_${suffix}`, a = `Start_${suffix}`, b = `Task_${suffix}`, c = `End_${suffix}`, f = `Flow_A_${suffix}`, g = `Flow_B_${suffix}`;
  return marcarExportador(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${suffix}" targetNamespace="https://lila-modeler.org/bpmn">
<bpmn:process id="${p}" name="${S.proyecto.procesoNuevo}" isExecutable="false">
<bpmn:startEvent id="${a}" name="${S.proyecto.inicio}"><bpmn:outgoing>${f}</bpmn:outgoing></bpmn:startEvent>
<bpmn:task id="${b}" name="${S.proyecto.actividad}"><bpmn:incoming>${f}</bpmn:incoming><bpmn:outgoing>${g}</bpmn:outgoing></bpmn:task>
<bpmn:endEvent id="${c}" name="${S.proyecto.fin}"><bpmn:incoming>${g}</bpmn:incoming></bpmn:endEvent>
<bpmn:sequenceFlow id="${f}" sourceRef="${a}" targetRef="${b}"/><bpmn:sequenceFlow id="${g}" sourceRef="${b}" targetRef="${c}"/>
</bpmn:process><bpmndi:BPMNDiagram id="Diagram_${suffix}"><bpmndi:BPMNPlane id="Plane_${suffix}" bpmnElement="${p}">
<bpmndi:BPMNShape id="ShapeA_${suffix}" bpmnElement="${a}"><dc:Bounds x="160" y="180" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="ShapeB_${suffix}" bpmnElement="${b}"><dc:Bounds x="260" y="158" width="100" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="ShapeC_${suffix}" bpmnElement="${c}"><dc:Bounds x="430" y="180" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNEdge id="EdgeA_${suffix}" bpmnElement="${f}"><di:waypoint x="196" y="198"/><di:waypoint x="260" y="198"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="EdgeB_${suffix}" bpmnElement="${g}"><di:waypoint x="360" y="198"/><di:waypoint x="430" y="198"/></bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`);
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
