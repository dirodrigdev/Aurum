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
