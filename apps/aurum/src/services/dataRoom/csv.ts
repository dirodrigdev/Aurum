export const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

export const buildCsv = <T extends Record<string, unknown>>(
  headers: string[],
  rows: T[],
): string => {
  const lines = [headers.map((header) => escapeCsvValue(header)).join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','));
  });
  return `${lines.join('\n')}\n`;
};
