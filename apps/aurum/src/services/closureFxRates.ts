import type { WealthFxRates } from './wealthStorage';

export type ClosureFxRateKey = 'usd' | 'eur' | 'uf';
export type ClosureFxRateOrigin = 'automatic' | 'manual' | 'fallback';
export type SuggestedClosureRatesStatus = 'available' | 'partial' | 'unavailable';

export interface ClosureFxMetadata {
  economicMonthKey: string;
  economicDate: string;
  suggestedFxRates?: Partial<WealthFxRates>;
  usedFxRates: WealthFxRates;
  rateOrigin: Record<ClosureFxRateKey, ClosureFxRateOrigin>;
  source?: Partial<Record<ClosureFxRateKey, string>>;
  retrievedAt?: string;
  manualOverrideReason?: string;
  previousClosureFxRates?: Partial<WealthFxRates>;
  reconciliation?: {
    status: 'reconciled';
    checkedAt: string;
  };
}

export interface SuggestedClosureRates {
  monthKey: string;
  economicDate: string;
  suggestedFxRates: Partial<WealthFxRates>;
  source: Partial<Record<ClosureFxRateKey, string>>;
  effectiveDate: Partial<Record<ClosureFxRateKey, string>>;
  retrievedAt: string;
  status: SuggestedClosureRatesStatus;
  warnings: string[];
}

export interface ClosureRatesProvider {
  load(input: { monthKey: string; economicDate: string }): Promise<{
    rates?: Partial<WealthFxRates>;
    source?: Partial<Record<ClosureFxRateKey, string>>;
    effectiveDate?: Partial<Record<ClosureFxRateKey, string>>;
    retrievedAt?: string;
    warnings?: string[];
  }>;
}

export interface ClosureFxSelection {
  usedFxRates: WealthFxRates;
  rateOrigin: Record<ClosureFxRateKey, ClosureFxRateOrigin>;
  metadata: ClosureFxMetadata;
  warnings: string[];
  requiresManualReason: boolean;
  requiresManualConfirmation: boolean;
  requiresFallbackConfirmation: boolean;
}

export interface ClosureFxConfirmations {
  economic: boolean;
  manual: boolean;
  fallback: boolean;
}

export interface ClosureFxPreflightContext {
  suggestion: SuggestedClosureRates;
  selection: ClosureFxSelection;
  previousClosureFxRates?: WealthFxRates | null;
  confirmations: ClosureFxConfirmations;
}

const RATE_FIELD: Record<ClosureFxRateKey, keyof WealthFxRates> = {
  usd: 'usdClp',
  eur: 'eurClp',
  uf: 'ufClp',
};

const validRate = (value: unknown): value is number => Number.isFinite(Number(value)) && Number(value) > 0;

export const deriveClosureEconomicDate = (monthKey: string): string | null => {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
};

const defaultProvider: ClosureRatesProvider = {
  load: async ({ monthKey }) => {
    const response = await fetch(`/api/fx/closure?monthKey=${encodeURIComponent(monthKey)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(String(payload?.error || `No pude consultar tasas históricas (${response.status})`));
    }
    return {
      rates: payload.rates,
      source: payload.sources,
      effectiveDate: payload.effectiveDates,
      retrievedAt: payload.retrievedAt,
      warnings: payload.warnings,
    };
  },
};

export const loadSuggestedClosureRates = async (
  monthKey: string,
  provider: ClosureRatesProvider = defaultProvider,
): Promise<SuggestedClosureRates> => {
  const economicDate = deriveClosureEconomicDate(monthKey);
  if (!economicDate) {
    return {
      monthKey,
      economicDate: '',
      suggestedFxRates: {},
      source: {},
      effectiveDate: {},
      retrievedAt: new Date().toISOString(),
      status: 'unavailable',
      warnings: ['El mes económico no tiene formato YYYY-MM válido.'],
    };
  }

  try {
    const loaded = await provider.load({ monthKey, economicDate });
    const fieldContext = [
      ['usdClp', 'usd'],
      ['eurClp', 'eur'],
      ['ufClp', 'uf'],
    ] as const;
    const validationWarnings: string[] = [];
    const suggestedFxRates = Object.fromEntries(
      fieldContext.flatMap(([field, key]) => {
        const value = loaded.rates?.[field];
        const effectiveDate = String(loaded.effectiveDate?.[key] || '');
        const source = String(loaded.source?.[key] || '').trim();
        if (!validRate(value)) return [];
        if (!effectiveDate.startsWith(`${monthKey}-`)) {
          validationWarnings.push(`${key.toUpperCase()}: la referencia recibida no pertenece al mes económico.`);
          return [];
        }
        if (!source) {
          validationWarnings.push(`${key.toUpperCase()}: la referencia no identifica su fuente.`);
          return [];
        }
        return [[field, Number(value)]];
      }),
    ) as Partial<WealthFxRates>;
    const availableCount = Object.keys(suggestedFxRates).length;
    const status: SuggestedClosureRatesStatus =
      availableCount === 3 ? 'available' : availableCount > 0 ? 'partial' : 'unavailable';
    const warnings = [...(loaded.warnings || []), ...validationWarnings];
    if (status !== 'available') {
      warnings.push('No se encontró una referencia automática completa para este mes. Revisa las tasas antes de cerrar.');
    }
    return {
      monthKey,
      economicDate,
      suggestedFxRates,
      source: loaded.source || {},
      effectiveDate: loaded.effectiveDate || {},
      retrievedAt: loaded.retrievedAt || new Date().toISOString(),
      status,
      warnings,
    };
  } catch (error) {
    return {
      monthKey,
      economicDate,
      suggestedFxRates: {},
      source: {},
      effectiveDate: {},
      retrievedAt: new Date().toISOString(),
      status: 'unavailable',
      warnings: [
        'No se encontró una referencia automática completa para este mes. Revisa las tasas antes de cerrar.',
        String((error as { message?: unknown })?.message || 'La fuente histórica no respondió.'),
      ],
    };
  }
};

const differs = (left: unknown, right: unknown) => {
  if (!validRate(left) || !validRate(right)) return true;
  return Math.abs(Number(left) - Number(right)) > 1e-9;
};

export const buildClosureFxSelection = (input: {
  monthKey: string;
  usedFxRates: WealthFxRates;
  suggestion: SuggestedClosureRates;
  touched: Record<ClosureFxRateKey, boolean>;
  previousClosureFxRates?: WealthFxRates | null;
  manualOverrideReason?: string;
  checkedAt?: string;
}): ClosureFxSelection => {
  const rateOrigin = {} as Record<ClosureFxRateKey, ClosureFxRateOrigin>;
  const warnings = [...input.suggestion.warnings];

  (Object.keys(RATE_FIELD) as ClosureFxRateKey[]).forEach((key) => {
    const field = RATE_FIELD[key];
    const suggested = input.suggestion.suggestedFxRates[field];
    if (input.touched[key] || (validRate(suggested) && differs(input.usedFxRates[field], suggested))) {
      rateOrigin[key] = 'manual';
      return;
    }
    rateOrigin[key] = validRate(suggested) ? 'automatic' : 'fallback';
  });

  const requiresManualConfirmation = Object.values(rateOrigin).includes('manual');
  const requiresFallbackConfirmation = Object.values(rateOrigin).includes('fallback');
  const manualOverrideReason = String(input.manualOverrideReason || '').trim();
  if (requiresManualConfirmation) {
    warnings.push('Estás utilizando una tasa manual distinta de la referencia sugerida.');
  }
  if (requiresFallbackConfirmation) {
    warnings.push('No se encontró una referencia automática completa para este mes. Revisa las tasas antes de cerrar.');
  }

  const usedFxRates = { ...input.usedFxRates };
  const source = { ...input.suggestion.source };
  (Object.keys(rateOrigin) as ClosureFxRateKey[]).forEach((key) => {
    if (rateOrigin[key] === 'manual') source[key] = 'manual_user_input';
    if (rateOrigin[key] === 'fallback') source[key] = 'operational_fx_fallback';
  });
  return {
    usedFxRates,
    rateOrigin,
    warnings: [...new Set(warnings)],
    requiresManualReason: requiresManualConfirmation && !manualOverrideReason,
    requiresManualConfirmation,
    requiresFallbackConfirmation,
    metadata: {
      economicMonthKey: input.monthKey,
      economicDate: input.suggestion.economicDate,
      suggestedFxRates: { ...input.suggestion.suggestedFxRates },
      usedFxRates,
      rateOrigin,
      source,
      retrievedAt: input.suggestion.retrievedAt,
      manualOverrideReason: manualOverrideReason || undefined,
      previousClosureFxRates: input.previousClosureFxRates
        ? { ...input.previousClosureFxRates }
        : undefined,
      reconciliation: {
        status: 'reconciled',
        checkedAt: input.checkedAt || new Date().toISOString(),
      },
    },
  };
};

export const closureFxRatesMatchMetadata = (
  fxRates: WealthFxRates | undefined,
  metadata: ClosureFxMetadata | undefined,
) =>
  Boolean(
    fxRates &&
      metadata &&
      !differs(fxRates.usdClp, metadata.usedFxRates.usdClp) &&
      !differs(fxRates.eurClp, metadata.usedFxRates.eurClp) &&
      !differs(fxRates.ufClp, metadata.usedFxRates.ufClp),
  );
