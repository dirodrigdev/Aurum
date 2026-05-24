const normalizeSeed = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.trunc(numeric);
  if (!Number.isInteger(rounded) || rounded <= 0) return null;
  return rounded;
};

export function selectRunSeed(canonicalSeed: unknown, fallbackSeed: unknown): number {
  const preferred = normalizeSeed(canonicalSeed);
  if (preferred !== null) return preferred;
  const fallback = normalizeSeed(fallbackSeed);
  if (fallback !== null) return fallback;
  return 42;
}

