import { describe, expect, it } from 'vitest';
import {
  buildClosureFxSelection,
  closureFxRatesMatchMetadata,
  deriveClosureEconomicDate,
  loadSuggestedClosureRates,
  type ClosureRatesProvider,
} from '../src/services/closureFxRates';

const provider = (result: Awaited<ReturnType<ClosureRatesProvider['load']>>): ClosureRatesProvider => ({
  load: async () => result,
});

const completeProvider = provider({
  rates: { usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 },
  source: { usd: 'sii.cl', eur: 'bcentral.cl', uf: 'sii.cl' },
  effectiveDate: { usd: '2026-06-30', eur: '2026-06-30', uf: '2026-06-30' },
  retrievedAt: '2026-07-03T10:42:00.000Z',
});

describe('closure rates by economic month', () => {
  it('derives the last calendar day from monthKey independently from closedAt', async () => {
    expect(deriveClosureEconomicDate('2026-06')).toBe('2026-06-30');
    let receivedEconomicDate = '';
    const suggestion = await loadSuggestedClosureRates('2026-06', {
      load: async (input) => {
        receivedEconomicDate = input.economicDate;
        return completeProvider.load(input);
      },
    });

    expect(receivedEconomicDate).toBe('2026-06-30');
    expect(suggestion.economicDate).toBe('2026-06-30');
    expect(suggestion.status).toBe('available');
  });

  it('accepts the last official publication inside a weekend-ending month', async () => {
    const suggestion = await loadSuggestedClosureRates('2026-05', provider({
      rates: { usdClp: 892.89, eurClp: 1040.06, ufClp: 40610.69 },
      source: { usd: 'sii.cl', eur: 'bcentral.cl', uf: 'sii.cl' },
      effectiveDate: { usd: '2026-05-29', eur: '2026-05-29', uf: '2026-05-31' },
    }));

    expect(suggestion.status).toBe('available');
    expect(suggestion.effectiveDate.usd).toBe('2026-05-29');
    expect(suggestion.suggestedFxRates.usdClp).toBe(892.89);
  });

  it('rejects a rate from the following month instead of inheriting it silently', async () => {
    const suggestion = await loadSuggestedClosureRates('2026-05', provider({
      rates: { usdClp: 900, eurClp: 1040.06, ufClp: 40610.69 },
      source: { usd: 'sii.cl', eur: 'bcentral.cl', uf: 'sii.cl' },
      effectiveDate: { usd: '2026-06-01', eur: '2026-05-29', uf: '2026-05-31' },
    }));

    expect(suggestion.status).toBe('partial');
    expect(suggestion.suggestedFxRates.usdClp).toBeUndefined();
    expect(suggestion.warnings.join(' ')).toContain('no pertenece al mes económico');
  });

  it('returns partial or unavailable when official sources are missing', async () => {
    const partial = await loadSuggestedClosureRates('2026-06', provider({
      rates: { usdClp: 922.34 },
      source: { usd: 'sii.cl' },
      effectiveDate: { usd: '2026-06-30' },
    }));
    const unavailable = await loadSuggestedClosureRates('2026-06', provider({}));

    expect(partial.status).toBe('partial');
    expect(unavailable.status).toBe('unavailable');
  });

  it('classifies automatic, manual and fallback rates without changing used values', async () => {
    const suggestion = await loadSuggestedClosureRates('2026-06', completeProvider);
    const automatic = buildClosureFxSelection({
      monthKey: '2026-06',
      usedFxRates: { usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 },
      suggestion,
      touched: { usd: false, eur: false, uf: false },
      previousClosureFxRates: { usdClp: 892.89, eurClp: 1040.06, ufClp: 40610.69 },
    });
    const manual = buildClosureFxSelection({
      monthKey: '2026-06',
      usedFxRates: { usdClp: 920, eurClp: 1050.38, ufClp: 40820.31 },
      suggestion,
      touched: { usd: true, eur: false, uf: false },
      manualOverrideReason: 'Tasa contractual documentada',
    });
    const partial = await loadSuggestedClosureRates('2026-06', provider({
      rates: { usdClp: 922.34, eurClp: 1050.38 },
      source: { usd: 'sii.cl', eur: 'bcentral.cl' },
      effectiveDate: { usd: '2026-06-30', eur: '2026-06-30' },
    }));
    const fallback = buildClosureFxSelection({
      monthKey: '2026-06',
      usedFxRates: { usdClp: 922.34, eurClp: 1050.38, ufClp: 40800 },
      suggestion: partial,
      touched: { usd: false, eur: false, uf: false },
    });

    expect(automatic.rateOrigin).toEqual({ usd: 'automatic', eur: 'automatic', uf: 'automatic' });
    expect(manual.rateOrigin.usd).toBe('manual');
    expect(manual.metadata.source?.usd).toBe('manual_user_input');
    expect(manual.requiresManualReason).toBe(false);
    expect(manual.requiresManualConfirmation).toBe(true);
    expect(fallback.rateOrigin.uf).toBe('fallback');
    expect(fallback.metadata.source?.uf).toBe('operational_fx_fallback');
    expect(fallback.requiresFallbackConfirmation).toBe(true);
    expect(closureFxRatesMatchMetadata(manual.usedFxRates, manual.metadata)).toBe(true);
  });

  it('requires a reason for any manual override', async () => {
    const suggestion = await loadSuggestedClosureRates('2026-06', completeProvider);
    const selection = buildClosureFxSelection({
      monthKey: '2026-06',
      usedFxRates: { usdClp: 920, eurClp: 1050.38, ufClp: 40820.31 },
      suggestion,
      touched: { usd: true, eur: false, uf: false },
    });

    expect(selection.requiresManualReason).toBe(true);
    expect(selection.metadata.manualOverrideReason).toBeUndefined();
  });
});
