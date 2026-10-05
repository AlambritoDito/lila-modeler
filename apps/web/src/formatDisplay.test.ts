import { describe, expect, it } from 'vitest';

import { exactDuration, formatDisplay, formatDisplayDuration, formatDisplayDurationWithUnit, roundDisplay } from './formatDisplay';

describe('formatDisplay (#578)', () => {
  it('shows at most two decimals and never pads', () => {
    expect(formatDisplay(1)).toBe('1');
    expect(formatDisplay(1.5)).toBe('1.5');
    expect(formatDisplay(1.23456)).toBe('1.23');
    expect(formatDisplay(2.999)).toBe('3');
    expect(formatDisplay(0)).toBe('0');
    expect(formatDisplay(-0)).toBe('0');
    expect(formatDisplay(1234567.891)).toBe('1234567.89');
  });

  it('never shows a non-zero value as "0": two significant digits below 0.01 (QA of #585)', () => {
    expect(formatDisplay(0.004158)).toBe('0.0042');
    expect(formatDisplay(0.004)).toBe('0.004');
    expect(formatDisplay(-0.001)).toBe('-0.001');
    expect(formatDisplay(0.00999)).toBe('0.01');
    expect(formatDisplay(0.05, 1)).toBe('0.05');
  });

  it('rounds halves away from zero without binary error (QA of #585)', () => {
    expect(formatDisplay(0.025)).toBe('0.03');
    expect(formatDisplay(1.005)).toBe('1.01');
    expect(formatDisplay(-1.005)).toBe('-1.01');
    expect(formatDisplay(1.0049)).toBe('1');
    expect(roundDisplay(2.675)).toBe(2.68);
    expect(roundDisplay(1e21)).toBe(1e21);
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

  it('a short but real wait in hours or days is not "0" (QA of #585)', () => {
    expect(formatDisplayDuration(14.97, 'h')).toBe('0.0042');
    expect(formatDisplayDuration(1, 'day')).toBe('0.000012');
  });

  it('with the unit, for a sentence: the same hours as the tables', () => {
    expect(formatDisplayDurationWithUnit(180_033.6, 'min')).toBe('50.01 h (3000.56 min)');
    expect(formatDisplayDurationWithUnit(90, 'min')).toBe('1.5 min');
    expect(formatDisplayDurationWithUnit(11_700, 'h')).toBe('3.25 h');
  });

  it('the exact value carries its unit', () => {
    expect(exactDuration(478_642.787_34, 'min')).toBe('7977.379789 min');
  });
});
