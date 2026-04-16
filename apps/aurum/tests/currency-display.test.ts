import { describe, expect, it } from 'vitest';
import { buildDisplayDeltaFromClp, fromClpUsingFx } from '../src/services/currencyDisplay';

describe('currencyDisplay', () => {
  it('convierte CLP/USD/EUR/UF con el FX del cierre', () => {
    const fx = { usdClp: 1000, eurClp: 1100, ufClp: 39000 };
    expect(fromClpUsingFx(1_000_000, 'CLP', fx)).toBe(1_000_000);
    expect(fromClpUsingFx(1_000_000, 'USD', fx)).toBe(1000);
    expect(fromClpUsingFx(1_100_000, 'EUR', fx)).toBe(1000);
    expect(fromClpUsingFx(39_000_000, 'UF', fx)).toBe(1000);
  });

  it('calcula delta USD restando cierres ya convertidos por su propio FX', () => {
    const result = buildDisplayDeltaFromClp({
      currentClp: 1_200_000,
      previousClp: 1_000_000,
      currency: 'USD',
      currentFx: { usdClp: 1200, eurClp: 1300, ufClp: 39500 },
      previousFx: { usdClp: 1000, eurClp: 1100, ufClp: 38000 },
    });
    expect(result.currentDisplay).toBeCloseTo(1000, 8);
    expect(result.previousDisplay).toBeCloseTo(1000, 8);
    expect(result.deltaDisplay).toBeCloseTo(0, 8);
    expect(result.pctDisplay).toBeCloseTo(0, 8);
  });

  it('calcula delta UF restando cierres ya convertidos por su propio UF/CLP', () => {
    const result = buildDisplayDeltaFromClp({
      currentClp: 39_000_000,
      previousClp: 37_000_000,
      currency: 'UF',
      currentFx: { usdClp: 950, eurClp: 1030, ufClp: 39_000 },
      previousFx: { usdClp: 920, eurClp: 990, ufClp: 37_000 },
    });
    expect(result.currentDisplay).toBeCloseTo(1000, 8);
    expect(result.previousDisplay).toBeCloseTo(1000, 8);
    expect(result.deltaDisplay).toBeCloseTo(0, 8);
    expect(result.pctDisplay).toBeCloseTo(0, 8);
  });
});
