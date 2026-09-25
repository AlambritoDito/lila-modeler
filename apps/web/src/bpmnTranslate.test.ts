/**
 * #456: bpmn-js's context pad and replace menu follow the app language. The service reads the
 * catalog on every call, so switching the language changes the next menu without remounting.
 */
import { afterEach, expect, it } from 'vitest';
import { moduloTraduccion, traducir } from './bpmnTranslate';
import { setLocale } from './i18n';

afterEach(() => setLocale('en'));

it('translates bpmn-js templates in the active language and leaves unknown ones as they are', () => {
  setLocale('es');
  expect(traducir('Append task')).toBe('Añadir tarea');
  expect(traducir('Open {element}', { element: 'Revisar' })).toBe('Abrir Revisar');
  expect(traducir('A template bpmn-js adds tomorrow')).toBe('A template bpmn-js adds tomorrow');
  // A key of `Object.prototype` is not a template of the catalog.
  expect(traducir('constructor')).toBe('constructor');

  setLocale('en');
  expect(traducir('Append task')).toBe('Append task');
  expect(traducir('Change element')).toBe('Change element');
});

it('is registered as the `translate` value service of the modeler', () => {
  expect(moduloTraduccion.translate).toEqual(['value', traducir]);
});
