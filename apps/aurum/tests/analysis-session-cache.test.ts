import { describe, expect, it, vi } from 'vitest';

import {
  buildClosuresFingerprint,
  clearAnalysisSessionCache,
  getOrBuildAnalysisSessionValue,
} from '../src/services/analysisSessionCache';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

describe('analysis session cache', () => {
  it('refreshes an accepted GastApp revision even when the financial photo stays identical', () => {
    clearAnalysisSessionCache();
    const original = {
      id: 'september', monthKey: '2026-09', closedAt: '2026-10-01T12:00:00Z',
      summary: { netClp: 1_000_000 }, fxRates: { usdClp: 900, eurClp: 1000, ufClp: 38000 },
      gastappExpenseClose: { contractHash: 'old', certificationRevision: 1, totalEur: 2000 },
    } as WealthMonthlyClosure;
    const revised = { ...original, gastappExpenseClose: {
      ...original.gastappExpenseClose!, contractHash: 'new', certificationRevision: 2, totalEur: 2715,
    } };
    const previous = getOrBuildAnalysisSessionValue(buildClosuresFingerprint([original]), () => original);
    const next = getOrBuildAnalysisSessionValue(buildClosuresFingerprint([revised]), () => revised);
    expect(next.value.gastappExpenseClose?.totalEur).toBe(2715);
    expect(previous.value.gastappExpenseClose?.totalEur).toBe(2000);
    expect(next.value.summary).toEqual(previous.value.summary);
    expect(next.value.fxRates).toEqual(previous.value.fxRates);
  });

  it('reuses cache entries for the same fingerprint', () => {
    clearAnalysisSessionCache();
    const builder = vi.fn(() => ({ value: 1 }));

    const first = getOrBuildAnalysisSessionValue('same-fingerprint', builder);
    const second = getOrBuildAnalysisSessionValue('same-fingerprint', builder);

    expect(builder).toHaveBeenCalledTimes(1);
    expect(second.value).toBe(first.value);
    expect(second.builtAt).toBe(first.builtAt);
  });

  it('invalidates cache when the fingerprint changes', () => {
    clearAnalysisSessionCache();
    const builder = vi.fn((fingerprint: string) => ({ fingerprint }));

    const first = getOrBuildAnalysisSessionValue('fp-1', () => builder('fp-1'));
    const second = getOrBuildAnalysisSessionValue('fp-2', () => builder('fp-2'));

    expect(builder).toHaveBeenCalledTimes(2);
    expect(first.value.fingerprint).toBe('fp-1');
    expect(second.value.fingerprint).toBe('fp-2');
  });

  it('rebuilds after manual cache clear', () => {
    clearAnalysisSessionCache();
    const builder = vi.fn(() => ({ value: Math.random() }));

    const first = getOrBuildAnalysisSessionValue('refreshable', builder);
    clearAnalysisSessionCache('refreshable');
    const second = getOrBuildAnalysisSessionValue('refreshable', builder);

    expect(builder).toHaveBeenCalledTimes(2);
    expect(second.value).not.toBe(first.value);
    expect(second.value.value).not.toBe(first.value.value);
  });

  it('treats an incomplete cache entry as a cache miss', () => {
    clearAnalysisSessionCache();
    const builder = vi.fn()
      .mockImplementationOnce(() => ({ ready: false, rows: null }))
      .mockImplementationOnce(() => ({ ready: true, rows: [] }));

    const first = getOrBuildAnalysisSessionValue('incomplete', builder, (value) => Boolean(value?.ready));
    const second = getOrBuildAnalysisSessionValue('incomplete', builder, (value) => Boolean(value?.ready));

    expect(first.value.ready).toBe(false);
    expect(second.value.ready).toBe(true);
    expect(builder).toHaveBeenCalledTimes(2);
  });
});
