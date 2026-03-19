import type { CrpContributionInsight, MonthlyReturnRow } from '../components/analysis/types';
import type { WealthCurrency, WealthFxRates } from './wealthStorage';
import { formatCompactCurrency } from '../components/analysis/shared';
import { formatCurrency } from '../utils/wealthFormat';
import { convertFromClp } from './returnsAnalysis';

export const buildCrpContributionInsight = (
  rowsWithCrp: MonthlyReturnRow[],
  rowsWithoutCrp: MonthlyReturnRow[],
  currency: WealthCurrency,
): CrpContributionInsight | null => {
  const recentWithCrp = rowsWithCrp
    .filter((row) => row.retornoRealDisplay !== null)
    .slice(Math.max(0, rowsWithCrp.length - 12));
  if (!recentWithCrp.length) return null;

  const comparableRows = recentWithCrp
    .map((row) => {
      const withoutCrp = rowsWithoutCrp.find(
        (candidate) => candidate.monthKey === row.monthKey && candidate.retornoRealDisplay !== null,
      );
      if (!withoutCrp || row.retornoRealDisplay === null || withoutCrp.retornoRealDisplay === null) return null;
      return {
        monthKey: row.monthKey,
        retornoConCrp: row.retornoRealDisplay,
        retornoSinCrp: withoutCrp.retornoRealDisplay,
        fx: row.fx,
      };
    })
    .filter(
      (
        item,
      ): item is {
        monthKey: string;
        retornoConCrp: number;
        retornoSinCrp: number;
        fx: WealthFxRates;
      } => item !== null,
    );
  if (!comparableRows.length) return null;

  const fxAverage = comparableRows.reduce(
    (acc, row) => ({
      usdClp: acc.usdClp + row.fx.usdClp,
      eurClp: acc.eurClp + row.fx.eurClp,
      ufClp: acc.ufClp + row.fx.ufClp,
    }),
    { usdClp: 0, eurClp: 0, ufClp: 0 },
  );
  const fxAverageRates: WealthFxRates = {
    usdClp: fxAverage.usdClp / comparableRows.length,
    eurClp: fxAverage.eurClp / comparableRows.length,
    ufClp: fxAverage.ufClp / comparableRows.length,
  };

  const aporteDisplay = comparableRows.reduce((sum, row) => sum + (row.retornoConCrp - row.retornoSinCrp), 0);
  const retornoConCrpDisplay = comparableRows.reduce((sum, row) => sum + row.retornoConCrp, 0);
  const aporteMensualDisplay = aporteDisplay / 12;
  const absAporte = Math.abs(aporteMensualDisplay);
  const neutralThreshold = convertFromClp(1_000, currency, fxAverageRates);
  const tone: CrpContributionInsight['tone'] =
    absAporte < neutralThreshold ? 'neutral' : aporteDisplay > 0 ? 'positive' : 'negative';

  const headlineAmount = (() => {
    const abs = Math.abs(aporteMensualDisplay);
    return formatCompactCurrency(abs, currency);
  })();

  const summaryText =
    tone === 'neutral'
      ? 'CapRiesgo no movió materialmente el resultado en los últ. 12M'
      : aporteMensualDisplay > 0
        ? `CapRiesgo aportó ${headlineAmount}/mes en los últ. 12M`
        : `CapRiesgo restó ${headlineAmount}/mes en los últ. 12M`;

  const pctReturnThreshold = convertFromClp(1_000_000, currency, fxAverageRates);
  const pctAporteThreshold = convertFromClp(100_000, currency, fxAverageRates);
  const canShowPct =
    retornoConCrpDisplay > pctReturnThreshold && Math.abs(aporteDisplay) > pctAporteThreshold;
  const pctCrp = canShowPct ? (aporteDisplay / retornoConCrpDisplay) * 100 : null;
  const detailText =
    pctCrp !== null
      ? `Cambio explicado por CapRiesgo · Explicó ${Math.abs(pctCrp).toFixed(1).replace('.', ',')}% del resultado`
      : tone === 'neutral'
        ? null
        : 'Cambio explicado por CapRiesgo';
  const totalText = tone === 'neutral' ? null : `Total período: ${formatCurrency(aporteDisplay, currency)}`;

  return {
    monthsLabel: 'últ. 12M',
    aporteDisplay,
    aporteMensualDisplay,
    total12mDisplay: aporteDisplay,
    pctCrp,
    tone,
    summaryText,
    detailText,
    totalText,
  };
};
