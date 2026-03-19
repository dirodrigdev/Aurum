import { describe, it, expect } from 'vitest';
import {
  periodInfoForDate,
  periodNumberFromStartYMD,
  DEFAULT_CLOSING_DAY,
} from '../src/utils/period';

describe('period utils', () => {
  it('computes P33 for 2026-01-12 (closingDay=11)', () => {
    const d = new Date(2026, 0, 12, 9, 0, 0, 0); // Jan 12 2026
    const p = periodInfoForDate(d, DEFAULT_CLOSING_DAY);
    expect(p.periodNumber).toBe(33);
    expect(p.periodId).toBe('P33');
    expect(p.startYMD).toBe('2026-01-12');
    expect(p.endYMD).toBe('2026-02-11');
  });

  it('computes P32 for 2026-01-11 (closingDay=11)', () => {
    const d = new Date(2026, 0, 11, 12, 0, 0, 0); // Jan 11 2026
    const p = periodInfoForDate(d, DEFAULT_CLOSING_DAY);
    expect(p.periodNumber).toBe(32);
    expect(p.periodId).toBe('P32');
    expect(p.startYMD).toBe('2025-12-12');
    expect(p.endYMD).toBe('2026-01-11');
  });

  it('computes period number from startYMD', () => {
    expect(periodNumberFromStartYMD('2025-12-12')).toBe(32);
    expect(periodNumberFromStartYMD('2026-01-12')).toBe(33);
  });
});
