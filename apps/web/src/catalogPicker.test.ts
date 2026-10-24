/**
 * The catalog picker's pure half (#93): options, filter, duplicate names and the resolution of the
 * value a reference holds. The component is `PropertiesPanel.catalogo.test.tsx`.
 */
import type { CatalogObject } from '@lila-modeler/engine/project';
import { describe, expect, it } from 'vitest';
import { createName, pickerKindOf, pickerOptions, resolveReference } from './catalogPicker';

const objeto = (type: string, id: string, name: string): CatalogObject => ({ type, id, name, revision: 1 });

const CATALOGO: readonly CatalogObject[] = [
  objeto('role', 'role-rec', 'Receptionist'),
  objeto('role', 'role-adm', 'Árbitro'),
  objeto('role', 'role-b', 'billing clerk'),
  objeto('system', 'sys-crm', 'CRM'),
  objeto('document', 'doc-form', 'Admission form'),
  objeto('risk', 'risk-1', 'Receptionist absent'),
];

describe('pickerKindOf', () => {
  it('maps each reference of the panel to the type RM-01 § 3.1 expects; risks, controls and KPIs stay text', () => {
    expect(pickerKindOf('lila:Responsibility')).toBe('role');
    expect(pickerKindOf('lila:SystemRef')).toBe('system');
    expect(pickerKindOf('lila:DocumentRef')).toBe('document');
    expect(pickerKindOf('lila:Input')).toBe('document');
    expect(pickerKindOf('lila:Output')).toBe('document');
    for (const tipo of ['lila:RiskRef', 'lila:ControlRef', 'lila:KpiRef', 'bpmn:Task', 'toString', '__proto__']) expect(pickerKindOf(tipo)).toBeNull();
  });
});

describe('pickerOptions', () => {
  it('lists only the objects of the kind, sorted by name ignoring case and accents', () => {
    expect(pickerOptions(CATALOGO, 'role').map((o) => o.label)).toEqual(['Árbitro', 'billing clerk', 'Receptionist']);
    expect(pickerOptions(CATALOGO, 'system').map((o) => o.object.id)).toEqual(['sys-crm']);
    expect(pickerOptions(CATALOGO, 'unit')).toEqual([]);
  });

  it('filters by name or id as you type, ignoring case and accents', () => {
    expect(pickerOptions(CATALOGO, 'role', 'arb').map((o) => o.object.id)).toEqual(['role-adm']);
    expect(pickerOptions(CATALOGO, 'role', '  RECEP ').map((o) => o.object.id)).toEqual(['role-rec']);
    expect(pickerOptions(CATALOGO, 'role', 'role-b').map((o) => o.object.id)).toEqual(['role-b']);
    expect(pickerOptions(CATALOGO, 'role', 'nobody')).toEqual([]);
  });

  it('disambiguates objects of the same type with the same name by id, and only those', () => {
    const conDobles = [...CATALOGO, objeto('role', 'role-rec2', 'receptionist'), objeto('system', 'sys-x', 'Receptionist')];
    expect(pickerOptions(conDobles, 'role').map((o) => o.label)).toEqual(['Árbitro', 'billing clerk', 'Receptionist (role-rec)', 'receptionist (role-rec2)']);
    expect(pickerOptions(conDobles, 'system').map((o) => o.label)).toEqual(['CRM', 'Receptionist']);
  });

  it('is deterministic for equal names: by id', () => {
    const iguales = [objeto('role', 'role-z', 'Same'), objeto('role', 'role-a', 'Same')];
    expect(pickerOptions(iguales, 'role').map((o) => o.object.id)).toEqual(['role-a', 'role-z']);
  });
});

describe('createName', () => {
  it('offers the typed text, trimmed, unless empty or already the name of an object of the kind', () => {
    expect(createName(CATALOGO, 'role', '  Front desk ')).toBe('Front desk');
    expect(createName(CATALOGO, 'role', '   ')).toBeNull();
    expect(createName(CATALOGO, 'role', 'receptionist')).toBeNull();
    expect(createName(CATALOGO, 'role', 'arbitro')).toBeNull();
    // Another type's name does not count.
    expect(createName(CATALOGO, 'role', 'CRM')).toBe('CRM');
  });
});

describe('resolveReference', () => {
  it('resolves an id to its object and label', () => {
    expect(resolveReference(CATALOGO, 'role', 'role-rec')).toEqual({ state: 'object', object: CATALOGO[0], label: 'Receptionist' });
    // Spaces count, as in the engine's usage index: a hand-written « role-rec » is not role-rec.
    expect(resolveReference(CATALOGO, 'role', ' role-rec ')).toEqual({ state: 'unresolved', id: ' role-rec ', adoptable: false });
  });

  it('an empty or absent value is empty', () => {
    expect(resolveReference(CATALOGO, 'role', undefined)).toEqual({ state: 'empty' });
    expect(resolveReference(CATALOGO, 'role', '  ')).toEqual({ state: 'empty' });
  });

  it('keeps an id no object of the kind has, adoptable only when adopting it rewrites no BPMN', () => {
    expect(resolveReference(CATALOGO, 'role', 'cajero')).toEqual({ state: 'unresolved', id: 'cajero', adoptable: true });
    // An object of another type has the id: adopting would generate a new id and rewrite (#675).
    expect(resolveReference(CATALOGO, 'role', 'sys-crm')).toEqual({ state: 'unresolved', id: 'sys-crm', adoptable: false });
    // Not of the id grammar, or a name Windows reserves.
    expect(resolveReference(CATALOGO, 'role', 'Cajero Principal')).toEqual({ state: 'unresolved', id: 'Cajero Principal', adoptable: false });
    expect(resolveReference(CATALOGO, 'role', 'con')).toEqual({ state: 'unresolved', id: 'con', adoptable: false });
    expect(resolveReference([], 'role', 'cajero')).toEqual({ state: 'unresolved', id: 'cajero', adoptable: true });
  });
});
