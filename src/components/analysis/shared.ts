import type { WealthCurrency, WealthFxRates } from '../../services/wealthStorage';
import { formatCurrency, formatMonthLabel as monthLabel } from '../../utils/wealthFormat';

export const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

export const formatPct = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals).replace('.', ',')}%`;
};

export const formatCompactCurrency = (value: number, currency: WealthCurrency) => {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    const scaled = (abs / 1_000_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'CLP' ? `${sign}$${scaled}B` : `${sign}${scaled}B ${currency}`;
  }

  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'CLP' ? `${sign}$${scaled}MM` : `${sign}${scaled}MM ${currency}`;
  }

  if (abs >= 1_000) {
    const scaled = (abs / 1_000).toLocaleString('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return currency === 'CLP' ? `${sign}$${scaled}K` : `${sign}${scaled}K ${currency}`;
  }

  return formatCurrency(value, currency);
};

export const formatFreedomCompactClp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${sign}$${scaled}MM`;
  }
  if (abs >= 1_000) {
    const scaled = (abs / 1_000).toLocaleString('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}$${scaled}K`;
  }
  return formatCurrency(value, 'CLP');
};

export const xLabelFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-');
  return `${month}/${year.slice(2)}`;
};

export const monthKeyToYearLabel = (monthKey: string | null) => {
  if (!monthKey) return '—';
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '—';
  return `${monthLabel(monthKey)} (${year})`;
};
