import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const driver = fileURLToPath(new URL('./fixtures/zero-time-driver.ts', import.meta.url));
/** The parent kills synchronous loops; a Vitest timeout alone cannot stop them. */
function run(mode: string, locale = 'en') {
  return JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=256', '--import', 'tsx', driver, mode, locale], {
    encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
  }));
}

test.each(['xor', 'xor-no-duration', 'missing', 'missing-no-duration', 'event-timer', 'event-message', 'boundary', 'disabled', 'warmup', 'replications'])(
  '#368: %s aborts with a diagnostic, never timeout or OOM', (mode) => {
    const result = run(mode);
    expect(result.error).toMatch(/^E-LIMITE-SIN-AVANCE: .*case 1, replication 0, time 0 s:.*100000/);
    expect(result.process).toBeUndefined();
    expect(result.maxReplication).toBe(0);
    if (mode === 'replications') expect(result.emitted).toBeGreaterThan(0);
  },
);

test('the diagnostic is deterministic and localized', () => {
  expect(run('xor').error).toBe(run('xor').error);
  expect(run('xor', 'es').error).toMatch(/^E-LIMITE-SIN-AVANCE: .*caso 1, réplica 0, instante 0 s:.*100000/);
});

test('exact budget: 100,000 case events allowed, the next is rejected', () => {
  const result = run('threshold');
  expect(result.steps).toBe(100_002); // arrival + allowed events + rejected attempt
  expect(result.error).toContain('replication 2');
  expect(run('cancel-at-limit')).toEqual({ cancelled: true, steps: 100_002 });
});

test.each(['positive', 'tiny'])('advancing time resets the budget: %s', (mode) => {
  const result = run(mode);
  expect(result.error).toBeUndefined();
  expect(result.process.inFlight).toBe(1);
});

test.each(['probabilistic', 'conditioned', 'chain', 'and', 'or', 'many'])('finite simultaneous work still completes: %s', (mode) => {
  const result = run(mode);
  expect(result.error).toBeUndefined();
  expect(result.process.completed).toBe(mode === 'many' ? 30_000 : 1);
  expect(result.process.inFlight).toBe(0);
});

test('event branches with no time remain blocked, rather than firing at zero', () => {
  const result = run('missing-branches');
  expect(result.error).toBeUndefined();
  expect(result.process.inFlight).toBe(1);
  expect(result.warnings.some((w: string) => w.startsWith('W-JOIN-BLOQUEADO:'))).toBe(true);
});

test('the web worker reports error without a done result', () => {
  const result = run('worker');
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({ type: 'error', message: expect.stringContaining('E-LIMITE-SIN-AVANCE:') });
});

test('the built CLI exits with 1 and preserves the runtime diagnostic', async () => {
  const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'lila-zero-time-cli-'));
  try {
    const fixture = run('fixture');
    writeFileSync(join(directory, 'model.bpmn'), fixture.xml);
    writeFileSync(join(directory, 'scenario.json'), JSON.stringify(fixture.scenario));
    const result = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(new URL('../bin/lila.js', import.meta.url)), 'run', join(directory, 'model.bpmn'), join(directory, 'scenario.json'), '--json', join(directory, 'result.json')], {
      encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('E-LIMITE-SIN-AVANCE:');
    expect(existsSync(join(directory, 'result.json'))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('the budget scales with IR nodes and flows', () => {
  const result = run('scaled');
  const limit = 1_024 * (4 + 60 + 4 + 60);
  expect(limit).toBeGreaterThan(100_000);
  expect(result.steps).toBe(limit + 2);
  expect(result.error).toContain(`limit of ${limit} events`);
});
