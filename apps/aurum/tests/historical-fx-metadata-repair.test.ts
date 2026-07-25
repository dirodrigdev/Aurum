import { describe, expect, it } from 'vitest';
import { diagnoseHistoricalFxMetadataEvidence, OFFICIAL_FX_SERIALIZATION_TOLERANCE } from '../src/services/historicalFxMetadataRepair';

const suggested = {
  economicDate: '2026-06-30',
  retrievedAt: '2026-07-26T10:00:00.000Z',
  references: {
    usd: { value: 922.34, effectiveDate: '2026-06-30', source: 'https://www.sii.cl/dolar' },
    eur: { value: 1050.38, effectiveDate: '2026-06-30', source: 'bcentral.cl:F072.CLP.EUR.N.O.D' },
    uf: { value: 40820.31, effectiveDate: '2026-06-30', source: 'https://www.sii.cl/uf' },
  },
} as any;

describe('official historical FX metadata diagnosis', () => {
  it('accepts only the three exact official rates and preserves evidence', () => {
    const diagnosis = diagnoseHistoricalFxMetadataEvidence('2026-06', {
      usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31,
    }, suggested);
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.evidence?.rates).toEqual({ usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 });
    expect(diagnosis.rates.every((rate) => Math.abs(rate.difference || 0) <= OFFICIAL_FX_SERIALIZATION_TOLERANCE)).toBe(true);
  });

  it('rejects a single economically distinct rate without permitting a fallback', () => {
    const diagnosis = diagnoseHistoricalFxMetadataEvidence('2026-06', {
      usdClp: 922.35, eurClp: 1050.38, ufClp: 40820.31,
    }, suggested);
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.evidence).toBeNull();
    const usd = diagnosis.rates.find((rate) => rate.key === 'usd');
    expect(usd?.valid).toBe(false);
    expect(usd?.difference).toBeCloseTo(0.01, 8);
  });

  it('accepts only serialization noise, not rounded economic values', () => {
    const diagnosis = diagnoseHistoricalFxMetadataEvidence('2026-06', {
      usdClp: 922.34 + 5e-10, eurClp: 1050.38, ufClp: 40820.31,
    }, suggested);
    expect(diagnosis.ok).toBe(true);
    const rounded = diagnoseHistoricalFxMetadataEvidence('2026-06', {
      usdClp: 922, eurClp: 1050.38, ufClp: 40820.31,
    }, suggested);
    expect(rounded.ok).toBe(false);
  });

  it('rejects an otherwise matching rate when its evidence date is not the close date', () => {
    const wrongDate = {
      ...suggested,
      references: {
        ...suggested.references,
        usd: { ...suggested.references.usd, effectiveDate: '2026-06-29' },
      },
    };
    const diagnosis = diagnoseHistoricalFxMetadataEvidence('2026-06', {
      usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31,
    }, wrongDate);
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.rates.find((rate) => rate.key === 'usd')?.reason).toContain('fecha económica');
  });
});
