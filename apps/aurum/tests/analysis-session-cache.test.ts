import { describe, expect, it, vi } from 'vitest';

import {
  clearAnalysisSessionCache,
  getOrBuildAnalysisSessionValue,
} from '../src/services/analysisSessionCache';

describe('analysis session cache', () => {
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
});
