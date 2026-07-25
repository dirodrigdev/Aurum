import type { WealthFxRates } from './wealthStorage';
import type { SuggestedClosureRates } from './closureFxRates';

export const OFFICIAL_FX_SERIALIZATION_TOLERANCE = 1e-9;

export type HistoricalFxMetadataEvidence = {
  monthKey: string;
  economicDate: string;
  retrievedAt: string;
  rates: WealthFxRates;
  references: Record<'usd' | 'eur' | 'uf', { value: number; effectiveDate: string; source: string }>;
};

export type HistoricalFxMetadataDiagnosis = {
  ok: boolean;
  monthKey: string;
  economicDate: string;
  retrievedAt: string;
  rates: Array<{
    key: 'usd' | 'eur' | 'uf';
    field: keyof WealthFxRates;
    sealed: number | null;
    official: number | null;
    difference: number | null;
    effectiveDate: string;
    source: string;
    valid: boolean;
    reason: string;
  }>;
  evidence: HistoricalFxMetadataEvidence | null;
};

const RATE_FIELDS = [
  ['usd', 'usdClp'],
  ['eur', 'eurClp'],
  ['uf', 'ufClp'],
] as const;

const finitePositive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

/**
 * `1e-9` only absorbs IEEE-754 serialization noise. It deliberately does not
 * permit business rounding: a one-cent/peso/UF difference remains a rejection.
 */
export const diagnoseHistoricalFxMetadataEvidence = (
  monthKey: string,
  sealedRates: WealthFxRates | undefined,
  suggested: SuggestedClosureRates,
): HistoricalFxMetadataDiagnosis => {
  const economicDate = String(suggested.economicDate || '');
  const retrievedAt = String(suggested.retrievedAt || '');
  const rates = RATE_FIELDS.map(([key, field]) => {
    const sealed = finitePositive(sealedRates?.[field]) ? Number(sealedRates![field]) : null;
    const reference = suggested.references?.[key];
    const official = finitePositive(reference?.value) ? Number(reference!.value) : null;
    const difference = sealed !== null && official !== null ? sealed - official : null;
    const effectiveDate = String(reference?.effectiveDate || '');
    const source = String(reference?.source || '').trim();
    const valid = Boolean(
      sealed !== null && official !== null && difference !== null &&
      Math.abs(difference) <= OFFICIAL_FX_SERIALIZATION_TOLERANCE &&
      effectiveDate === economicDate && source && Number.isFinite(Date.parse(retrievedAt)),
    );
    return {
      key,
      field,
      sealed,
      official,
      difference,
      effectiveDate,
      source,
      valid,
      reason: valid
        ? 'Coincidencia exacta de evidencia oficial.'
        : sealed === null
          ? 'La tasa sellada es inválida.'
          : official === null
            ? 'La fuente oficial no devolvió una tasa válida.'
            : Math.abs(difference!) > OFFICIAL_FX_SERIALIZATION_TOLERANCE
              ? 'La tasa sellada no coincide exactamente con la evidencia oficial.'
              : effectiveDate !== economicDate
                ? 'La evidencia no corresponde a la fecha económica del cierre.'
                : !source
                  ? 'La evidencia no identifica su fuente.'
                  : 'La evidencia no tiene timestamp verificable.',
    };
  });
  const ok = rates.every((item) => item.valid) && economicDate === `${monthKey}-${new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0)).getUTCDate()}`;
  return {
    ok,
    monthKey,
    economicDate,
    retrievedAt,
    rates,
    evidence: ok
      ? {
          monthKey,
          economicDate,
          retrievedAt,
          rates: { ...sealedRates! },
          references: Object.fromEntries(rates.map((item) => [item.key, {
            value: item.official!, effectiveDate: item.effectiveDate, source: item.source,
          }])) as HistoricalFxMetadataEvidence['references'],
        }
      : null,
  };
};
