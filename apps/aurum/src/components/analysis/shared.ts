import type { WealthCurrency, WealthFxRates } from '../../services/wealthStorage';
import { formatCurrency, formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import type { AggregatedSummary, ReturnSpendInsight } from './types';

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

const LOW_RETURN_SPEND_PCT_THRESHOLD = 300;

export const buildReturnSpendInsight = (summary: AggregatedSummary | null | undefined): ReturnSpendInsight => {
  if (!summary || summary.gastosAcumClp === null || summary.retornoRealAcumClp === null) {
    return {
      kind: 'unavailable',
      tone: 'neutral',
      primaryText: '—',
      secondaryText: null,
      titleText: 'Sin base suficiente para evaluar gasto vs retorno',
    };
  }

  if (summary.retornoRealAcumClp <= 0) {
    return {
      kind: 'negative-return',
      tone: 'negative',
      primaryText: 'Retorno negativo',
      secondaryText: 'El gasto no fue cubierto por el retorno del período',
      titleText: 'Retorno negativo en el período',
    };
  }

  if (summary.spendPct === null || !Number.isFinite(summary.spendPct)) {
    return {
      kind: 'unavailable',
      tone: 'neutral',
      primaryText: '—',
      secondaryText: null,
      titleText: 'Sin base suficiente para evaluar gasto vs retorno',
    };
  }

  if (summary.spendPct > LOW_RETURN_SPEND_PCT_THRESHOLD) {
    return {
      kind: 'low-return',
      tone: 'warning',
      primaryText: 'Ratio no representativo',
      secondaryText: 'Gasto muy superior al retorno del período',
      titleText: 'Retorno positivo demasiado bajo para mostrar un % útil',
    };
  }

  return {
    kind: 'pct',
    tone: summary.spendPct > 100 ? 'warning' : 'positive',
    primaryText: `${summary.spendPct.toFixed(1).replace('.', ',')}%`,
    secondaryText: 'del retorno',
    titleText: `${summary.spendPct.toFixed(1).replace('.', ',')}% del retorno se gasta`,
  };
};
