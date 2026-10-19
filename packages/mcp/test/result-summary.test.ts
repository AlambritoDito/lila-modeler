/**
 * `groupWarnings` (#629, #645): the warnings of a summary, once each with how many times they came
 * up. A coded warning groups by its code and subject, so the singular and the plural of one
 * `W-JOIN-BLOQUEADO` are one group.
 */
import { messages } from '@lila-modeler/engine/messages';
import { expect, test } from 'vitest';

import { groupWarnings } from '../src/result-summary.js';

test('the singular and the plural of one W-JOIN-BLOQUEADO are one group, in both languages (#645)', () => {
  for (const locale of ['en', 'es'] as const) {
    const join = messages(locale).codes['W-JOIN-BLOQUEADO'];
    const one = `W-JOIN-BLOQUEADO: ${join('Join_1', 1)}`;
    const many = `W-JOIN-BLOQUEADO: ${join('Join_1', 3)}`;
    expect(one, locale).not.toBe(many.replace('3', '1'));
    expect(groupWarnings([one, many, many]), locale).toEqual([{ message: one, count: 3 }]);
  }
});

test('the same code about two elements is two groups, in order of first appearance', () => {
  const join = messages('en').codes['W-JOIN-BLOQUEADO'];
  const first = `W-JOIN-BLOQUEADO: ${join('Join_2', 2)}`;
  const second = `W-JOIN-BLOQUEADO: ${join('Join_1', 1)}`;
  expect(groupWarnings([first, second, `W-JOIN-BLOQUEADO: ${join('Join_2', 1)}`])).toEqual([
    { message: first, count: 2 },
    { message: second, count: 1 },
  ]);
});

test('copies that differ only in loose numbers are one group; numbers inside an id are not', () => {
  const warnings = [
    'the run took 2941 steps (2941 times)',
    'the run took 12 steps (3 times)',
    'Task_1 waited',
    'Task_2 waited',
  ];
  expect(groupWarnings(warnings)).toEqual([
    { message: 'the run took 2941 steps (2941 times)', count: 2 },
    { message: 'Task_1 waited', count: 1 },
    { message: 'Task_2 waited', count: 1 },
  ]);
});

test('no warnings, no groups', () => {
  expect(groupWarnings([])).toEqual([]);
});
