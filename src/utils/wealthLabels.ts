export const normalizeForMatch = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const labelMatchKey = (value: string) =>
  normalizeForMatch(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const sameCanonicalLabel = (a: string, b: string) => labelMatchKey(a) === labelMatchKey(b);

