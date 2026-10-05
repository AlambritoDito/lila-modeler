import { describe, expect, it } from 'vitest';

import { formatDisplay, formatDisplayDuration, roundDisplay } from './formatDisplay';

describe('formatDisplay (#578)', () => {
  it('shows at most two decimals and never pads', () => {
    expect(formatDisplay(1)).toBe('1');
    expect(formatDisplay(1.5)).toBe('1.5');
    expect(formatDisplay(1.23456)).toBe('1.23');
    expect(formatDisplay(2.999)).toBe('3');
    expect(formatDisplay(0.004)).toBe('0');
    expect(formatDisplay(-0.001)).toBe('0');
    expect(formatDisplay(1234567.891)).toBe('1234567.89');
  });

  it('keeps non-finite values as they are', () => {
    expect(formatDisplay(Number.NaN)).toBe('NaN');
    expect(formatDisplay(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });

  it('takes another number of decimals', () => {
    expect(formatDisplay(12.3456, 1)).toBe('12.3');
    expect(roundDisplay(0.123456, 4)).toBe(0.1235);
  });
});

describe('formatDisplayDuration (#578)', () => {
  it('is the base unit with two decimals below an hour', () => {
    expect(formatDisplayDuration(90, 'min')).toBe('1.5');
    expect(formatDisplayDuration(100, 'min')).toBe('1.67');
    expect(formatDisplayDuration(3599, 'min')).toBe('59.98');
    expect(formatDisplayDuration(12.3456, 's')).toBe('12.35');
  });

  it('adds hours from an hour on when the unit is smaller than hours', () => {
    expect(formatDisplayDuration(11_700, 'min')).toBe('3.25 h (195 min)');
    expect(formatDisplayDuration(3600, 'min')).toBe('1 h (60 min)');
    expect(formatDisplayDuration(5400, 's')).toBe('1.5 h (5400 s)');
  });

  it('stays in the base unit when it is hours or days', () => {
    expect(formatDisplayDuration(11_700, 'h')).toBe('3.25');
    expect(formatDisplayDuration(129_600, 'day')).toBe('1.5');
  });
});
