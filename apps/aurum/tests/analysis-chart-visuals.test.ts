import { describe, expect, it } from 'vitest';

import { buildSmartVisualDomain } from '../src/components/analysis/chartVisuals';

describe('analysis chart visual helpers', () => {
  it('does not include zero unnecessarily for positive UF ranges', () => {
    const domain = buildSmartVisualDomain([10_000, 10_400, 10_800]);

    expect(domain.domainMin).toBeGreaterThan(0);
    expect(domain.domainMin).toBeLessThan(10_000);
    expect(domain.domainMax).toBeGreaterThan(10_800);
  });

  it('applies padding around the visible range', () => {
    const domain = buildSmartVisualDomain([1_000, 1_500]);

    expect(domain.domainMin).toBeLessThan(1_000);
    expect(domain.domainMax).toBeGreaterThan(1_500);
    expect(domain.domainMax - domain.domainMin).toBeGreaterThan(500);
  });

  it('keeps a reasonable domain when the range is very small', () => {
    const domain = buildSmartVisualDomain([50_000, 50_010, 50_005]);

    expect(domain.domainMin).toBeGreaterThan(0);
    expect(domain.domainMin).toBeLessThan(50_000);
    expect(domain.domainMax).toBeGreaterThan(50_010);
    expect(domain.domainMax - domain.domainMin).toBeGreaterThan(10);
  });
});
