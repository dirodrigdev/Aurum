import { WealthCurrency } from '../services/wealthStorage';

export const groupWithDots = (value: number) =>
  Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const formatCurrency = (value: number, currency: WealthCurrency) => {
  const sign = value < 0 ? '-' : '';
  if (currency === 'UF') {
    const abs = Math.abs(value);
    const intPart = Math.trunc(abs);
    const decimalPart = Math.round((abs - intPart) * 100)
      .toString()
      .padStart(2, '0');
    return `${sign}${groupWithDots(intPart)},${decimalPart} UF`;
  }
  if (currency === 'CLP') {
    return `${sign}$${groupWithDots(value)}`;
  }

  const abs = Math.abs(value);
  const intPart = Math.trunc(abs);
  const decimalPart = Math.round((abs - intPart) * 100)
    .toString()
    .padStart(2, '0');
  return `${sign}${groupWithDots(intPart)},${decimalPart} ${currency}`;
};

export const formatCurrencyNoDecimals = (value: number, currency: WealthCurrency) => {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  if (currency === 'CLP') return `${sign}$${groupWithDots(rounded)}`;
  if (currency === 'UF') return `${sign}${groupWithDots(rounded)} UF`;
  return `${sign}${groupWithDots(rounded)} ${currency}`;
};

export const formatMonthLabel = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  const d = new Date(y, (m || 1) - 1, 1, 12, 0, 0, 0);
  const label = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const formatIsoDateTime = (
  iso?: string,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
) => {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('es-CL', options);
};

export const formatTodayContext = () =>
  new Date().toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
  });

export const formatRateInt = (value: number) => Math.round(value).toLocaleString('es-CL');

export const formatRateDecimal = (value: number, decimals = 4) =>
  Number(value || 0).toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

