import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// LILA-010: valida las 4 réplicas de examples/bizagi-levels/level-{1,2,3,4}
// sin depender del parser BPMN (aún no existe): regex sobre id="..." del XML,
// igual que examples.test.ts (LILA-008).

const here = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(here, '../../../examples/bizagi-levels');

function bpmnIds(xml: string): Set<string> {
  const ids = new Set<string>();
  const re = /\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) ids.add(m[1]);
  return ids;
}

const levels = [1, 2, 3, 4] as const;

describe.each(levels)('examples/bizagi-levels/level-%i', (level) => {
  const dir = resolve(levelsDir, `level-${level}`);
  const bpmnXml = readFileSync(resolve(dir, 'model.bpmn'), 'utf8');
  const scenario = JSON.parse(readFileSync(resolve(dir, 'scenario.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(resolve(dir, 'expected.json'), 'utf8'));

  test('el .bpmn es XML BPMN 2.0 bien formado con DI', () => {
    expect(bpmnXml).toMatch(/<bpmn:definitions[^>]*xmlns:bpmn="http:\/\/www\.omg\.org\/spec\/BPMN\/20100524\/MODEL"/);
    expect(bpmnXml).toContain('<bpmndi:BPMNDiagram');
  });

  test('toda sequenceFlow tiene sourceRef/targetRef que resuelven a un id del documento', () => {
    const allIds = bpmnIds(bpmnXml);
    const re = /<bpmn:sequenceFlow\s+id="([^"]+)"[^>]*\ssourceRef="([^"]+)"[^>]*\stargetRef="([^"]+)"/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(bpmnXml))) {
      count++;
      expect(allIds.has(m[2])).toBe(true);
      expect(allIds.has(m[3])).toBe(true);
    }
    expect(count).toBeGreaterThan(0);
  });

  test('scenario.json: version 1, model.bpmn, run.start ISO con offset', () => {
    expect(scenario.version).toBe(1);
    expect(scenario.model).toBe('model.bpmn');
    expect(scenario.run.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  test('R6: al menos uno de run.duration o triggerCount', () => {
    const hasDuration = typeof scenario.run.duration === 'number' && scenario.run.duration > 0;
    const hasTriggerCount = Object.values(scenario.elements ?? {}).some(
      (el: any) => typeof el.triggerCount === 'number' && el.triggerCount > 0,
    );
    expect(hasDuration || hasTriggerCount).toBe(true);
  });

  test('R9: toda ref de resources y todo calendar citados existen', () => {
    const allIds = bpmnIds(bpmnXml);
    for (const key of Object.keys(scenario.elements ?? {})) {
      const el = scenario.elements[key];
      expect(allIds.has(key)).toBe(true); // R3: la clave existe en el IR/BPMN
      for (const r of el.resources ?? []) {
        expect(scenario.resources).toHaveProperty(r.ref);
      }
      if (el.calendar) expect(scenario.calendars).toHaveProperty(el.calendar);
    }
    for (const key of Object.keys(scenario.resources ?? {})) {
      const cal = scenario.resources[key].calendar;
      if (cal) expect(scenario.calendars).toHaveProperty(cal);
    }
  });

  test('R13: intervals[].to > intervals[].from', () => {
    for (const cal of Object.values(scenario.calendars ?? {}) as any[]) {
      for (const iv of cal.intervals) {
        expect(iv.to > iv.from).toBe(true);
      }
    }
  });

  test('expected.json cita la URL de origen en help.bizagi.com', () => {
    expect(expected.source).toMatch(/^https:\/\/help\.bizagi\.com\//);
    expect(expected.level).toBe(level);
  });
});

test('nivel 1: probabilidades del XOR de triage suman 1', () => {
  const scenario = JSON.parse(
    readFileSync(resolve(levelsDir, 'level-1/scenario.json'), 'utf8'),
  );
  const sum =
    scenario.elements.Flow_Green.probability +
    scenario.elements.Flow_Yellow.probability +
    scenario.elements.Flow_Red.probability;
  expect(sum).toBeCloseTo(1, 10);
});

test('nivel 1: los conteos publicados (corregido y roto) suman el total de tokens', () => {
  const expected = JSON.parse(
    readFileSync(resolve(levelsDir, 'level-1/expected.json'), 'utf8'),
  );
  const corrected = expected.values.correctedRun.instancesCompleted;
  expect(corrected.green + corrected.yellow + corrected.red).toBe(corrected.total);
  expect(corrected.total).toBe(expected.values.configuration.maxArrivalCount);
});

test('nivel 3 y nivel 4: mismo proceso y mismos recursos base que nivel 2 (mismo Emergency attendance process)', () => {
  const l2 = readFileSync(resolve(levelsDir, 'level-2/model.bpmn'), 'utf8');
  const l3 = readFileSync(resolve(levelsDir, 'level-3/model.bpmn'), 'utf8');
  const l4 = readFileSync(resolve(levelsDir, 'level-4/model.bpmn'), 'utf8');
  for (const id of ['Task_Recibir', 'Task_Clasificar', 'Task_Gestionar', 'Task_Recoger', 'Task_LlegarQAV', 'Task_LlegarBA', 'Task_Autorizar']) {
    expect(l2).toContain(`id="${id}"`);
    expect(l3).toContain(`id="${id}"`);
    expect(l4).toContain(`id="${id}"`);
  }
});

test('nivel 4: los recursos que Bizagi reporta constantes por turno (nurse, ambulance) no se dividen en pools por calendario', () => {
  const scenario = JSON.parse(
    readFileSync(resolve(levelsDir, 'level-4/scenario.json'), 'utf8'),
  );
  expect(scenario.resources.nurse.calendar).toBeUndefined();
  expect(scenario.resources.ambulance.calendar).toBeUndefined();
  expect(scenario.resources.nurse.capacity).toBe(3);
  expect(scenario.resources.ambulance.capacity).toBe(4);
});
