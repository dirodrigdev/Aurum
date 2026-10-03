import type { WealthMonthlyClosure } from './wealthStorage';

type AnalysisSessionCacheEntry<T> = {
  fingerprint: string;
  builtAt: string;
  value: T;
};

const analysisSessionCache = new Map<string, AnalysisSessionCacheEntry<unknown>>();

export const getOrBuildAnalysisSessionValue = <T>(
  fingerprint: string,
  builder: () => T,
  isValid?: (value: T) => boolean,
): AnalysisSessionCacheEntry<T> => {
  const cached = analysisSessionCache.get(fingerprint) as AnalysisSessionCacheEntry<T> | undefined;
  if (cached && (!isValid || isValid(cached.value))) return cached;

  const entry: AnalysisSessionCacheEntry<T> = {
    fingerprint,
    builtAt: new Date().toISOString(),
    value: builder(),
  };
  analysisSessionCache.set(fingerprint, entry);
  return entry;
};

export const clearAnalysisSessionCache = (fingerprint?: string) => {
  if (fingerprint) {
    analysisSessionCache.delete(fingerprint);
    return;
  }
  analysisSessionCache.clear();
};
export const buildClosuresFingerprint = (closures: WealthMonthlyClosure[]) =>
  closures.map((closure) => [
    closure.monthKey,
    closure.closedAt || '',
    Number(closure.summary?.netClp ?? ''),
    Number(closure.summary?.netClpWithRisk ?? ''),
    Number(closure.summary?.netConsolidatedClp ?? ''),
    Number(closure.fxRates?.usdClp ?? ''),
    Number(closure.fxRates?.eurClp ?? ''),
    Number(closure.fxRates?.ufClp ?? ''),
    JSON.stringify(closure.gastappExpenseClose ?? null),
  ].join(':')).join('|');
