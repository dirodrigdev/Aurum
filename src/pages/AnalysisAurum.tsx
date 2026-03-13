import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button, Card } from '../components/Components';
import { FreedomTab } from '../components/analysis/FreedomTab';
import { LabTab } from '../components/analysis/LabTab';
import { ReturnsTab } from '../components/analysis/ReturnsTab';
import type {
  AggregatedSummary,
  AnalysisTab,
  CrpContributionInsight,
  FreedomControlDraft,
  MonthlyReturnRow,
} from '../components/analysis/types';
import {
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  currentMonthKey,
  defaultFxRates,
  loadClosures,
  loadIncludeRiskCapitalInTotals,
  saveIncludeRiskCapitalInTotals,
} from '../services/wealthStorage';
import {
  buildCoveragePlan,
  buildMonthlyWithdrawalPlan,
  resolveFinancialFreedomBase,
} from '../services/financialFreedom';
import {
  buildWealthLabModel,
  GASTAPP_TOTALS,
} from '../services/wealthLab';

const loadWealthClosures = () => loadClosures();

const summaryNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const safeUsdClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : defaultFxRates.usdClp;

const safeUfClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : defaultFxRates.ufClp;

const safeFxRaw = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: safeUsdClp(Number(fx?.usdClp)),
  eurClp: Number.isFinite(Number(fx?.eurClp)) && Number(fx?.eurClp) > 0 ? Number(fx?.eurClp) : defaultFxRates.eurClp,
  ufClp: safeUfClp(Number(fx?.ufClp)),
});

const parseNumericDraft = (value: string): number | null => {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDraftPercent = (value: string) => {
  const cleaned = String(value ?? '').replace(/[^\d,.]/g, '').replace(',', '.');
  const [whole, decimal] = cleaned.split('.');
  if (decimal === undefined) return whole;
  return `${whole}.${decimal.slice(0, 2)}`;
};

const formatDraftInteger = (value: string) => String(value ?? '').replace(/[^\d]/g, '');

const formatDraftMoney = (value: string) => {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('es-CL');
};

const sumNumbers = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

const monthYear = (monthKey: string) => Number(monthKey.slice(0, 4));

const buildCrpContributionInsight = (
  rowsWithCrp: MonthlyReturnRow[],
  rowsWithoutCrp: MonthlyReturnRow[],
): CrpContributionInsight | null => {
  const recentWithCrp = rowsWithCrp
    .filter((row) => row.retornoRealClp !== null)
    .slice(Math.max(0, rowsWithCrp.length - 12));
  if (!recentWithCrp.length) return null;

  const comparableRows = recentWithCrp
    .map((row) => {
      const withoutCrp = rowsWithoutCrp.find(
        (candidate) => candidate.monthKey === row.monthKey && candidate.retornoRealClp !== null,
      );
      if (!withoutCrp || row.retornoRealClp === null || withoutCrp.retornoRealClp === null) return null;
      return {
        monthKey: row.monthKey,
        retornoConCrpClp: row.retornoRealClp,
        retornoSinCrpClp: withoutCrp.retornoRealClp,
      };
    })
    .filter(
      (
        item,
      ): item is {
        monthKey: string;
        retornoConCrpClp: number;
        retornoSinCrpClp: number;
      } => item !== null,
    );
  if (!comparableRows.length) return null;

  const aporteClp = sumNumbers(
    comparableRows.map((row) => row.retornoConCrpClp - row.retornoSinCrpClp),
  );
  const retornoConCrpClp = sumNumbers(comparableRows.map((row) => row.retornoConCrpClp));
  const aporteMensualClp = aporteClp / 12;
  const absAporte = Math.abs(aporteMensualClp);
  const tone: CrpContributionInsight['tone'] =
    absAporte < 1_000 ? 'neutral' : aporteClp > 0 ? 'positive' : 'negative';

  const headlineAmount = (() => {
    const abs = Math.abs(aporteMensualClp);
    if (abs >= 1_000_000) {
      const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `$${scaled}MM`;
    }
    if (abs >= 1_000) {
      const scaled = (abs / 1_000).toLocaleString('es-CL', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return `$${scaled}K`;
    }
    return `$${abs.toLocaleString('es-CL')}`;
  })();

  const summaryText =
    tone === 'neutral'
      ? 'CapRiesgo no movió materialmente el resultado en los últ. 12M'
      : aporteMensualClp > 0
        ? `CapRiesgo aportó ${headlineAmount}/mes en los últ. 12M`
        : `CapRiesgo restó ${headlineAmount}/mes en los últ. 12M`;

  const canShowPct = retornoConCrpClp > 1_000_000 && Math.abs(aporteClp) > 100_000;
  const pctCrp = canShowPct ? (aporteClp / retornoConCrpClp) * 100 : null;
  const detailText =
    pctCrp !== null
      ? `Cambio explicado por CapRiesgo · Explicó ${Math.abs(pctCrp).toFixed(1).replace('.', ',')}% del resultado`
      : tone === 'neutral'
        ? null
        : 'Cambio explicado por CapRiesgo';
  const totalText = tone === 'neutral' ? null : `Total período: ${aporteClp.toLocaleString('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  })}`;

  return {
    monthsLabel: 'últ. 12M',
    aporteClp,
    aporteMensualClp,
    total12mClp: aporteClp,
    pctCrp,
    tone,
    summaryText,
    detailText,
    totalText,
  };
};

const computeMonthlyRows = (closures: WealthMonthlyClosure[], includeRiskCapitalInTotals: boolean): MonthlyReturnRow[] => {
  const sorted = [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const calendarCurrent = currentMonthKey();
  const filtered = sorted.filter((closure) => closure.monthKey !== calendarCurrent);
  const rows: MonthlyReturnRow[] = [];
  let previousValidNet: number | null = null;

  for (const closure of filtered) {
    const fxRaw = safeFxRaw(closure.fxRates);
    const fx = fxRaw;
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const prevNetClp = invalidNet ? null : previousValidNet;
    const varPatrimonioClp =
      invalidNet || prevNetClp === null || netClp === null ? null : netClp - prevNetClp;
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey]) ? Number(GASTAPP_TOTALS[closure.monthKey]) : null;
    const gastosClp = invalidNet || gastosEur === null ? null : gastosEur * fx.eurClp;
    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const pct =
      retornoRealClp === null || prevNetClp === null || prevNetClp === 0
        ? null
        : (retornoRealClp / prevNetClp) * 100;

    if (invalidNet) {
      console.warn('[Analysis][invalid-net]', {
        monthKey: closure.monthKey,
        netClp: closure.summary?.netClp ?? null,
        netConsolidatedClp: closure.summary?.netConsolidatedClp ?? null,
      });
    } else {
      previousValidNet = Number(netClp);
    }
    rows.push({
      monthKey: closure.monthKey,
      fx,
      rawEurClp: fxRaw.eurClp,
      netClp,
      prevNetClp,
      invalidNet,
      varPatrimonioClp,
      gastosClp,
      retornoRealClp,
      pct,
    });
  }
  return rows;
};

const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  currency: WealthCurrency,
  baseNetClp: number | null,
): AggregatedSummary => {
  const validRows = rows.filter(
    (row) =>
      row.varPatrimonioClp !== null &&
      row.gastosClp !== null &&
      row.retornoRealClp !== null,
  ) as Array<
    MonthlyReturnRow & {
      varPatrimonioClp: number;
      gastosClp: number;
      retornoRealClp: number;
    }
  >;

  const validMonths = validRows.length;
  const varPatrimonioAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.varPatrimonioClp)) : null;
  const gastosAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.gastosClp)) : null;
  const retornoRealAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.retornoRealClp)) : null;
  let pctRetorno: number | null = null;
  let pctRetornoNote: string | null = null;
  if (validMonths > 0 && retornoRealAcumClp !== null && baseNetClp !== null && baseNetClp > 0) {
    const periodReturn = retornoRealAcumClp / baseNetClp;
    const growthBase = 1 + periodReturn;
    if (growthBase <= 0) {
      pctRetorno = null;
      pctRetornoNote = 'período negativo';
      console.warn('[Analysis][pct-anual-equiv-negativo]', { key, label, validMonths, periodReturn, baseNetClp });
    } else {
      const annualized = (Math.pow(growthBase, 12 / validMonths) - 1) * 100;
      if (annualized > 200 || annualized < -100) {
        pctRetorno = null;
        pctRetornoNote = 'fuera de rango';
        console.warn('[Analysis][pct-anual-equiv-fuera-rango]', {
          key,
          label,
          validMonths,
          annualized,
          periodReturn,
          baseNetClp,
          retornoRealAcumClp,
        });
      } else {
        pctRetorno = annualized;
      }
    }
  }
  const spendPct =
    retornoRealAcumClp === null || retornoRealAcumClp === 0 || gastosAcumClp === null
      ? null
      : (gastosAcumClp / retornoRealAcumClp) * 100;

  const varPatrimonioAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.varPatrimonioClp, currency, row.fx)),
      ) / validMonths
    : null;
  const gastosAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.gastosClp, currency, row.fx)),
      ) / validMonths
    : null;
  const retornoRealAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.retornoRealClp, currency, row.fx)),
      ) / validMonths
    : null;

  return {
    key,
    label,
    validMonths,
    varPatrimonioAcumClp,
    gastosAcumClp,
    retornoRealAcumClp,
    pctRetorno,
    pctRetornoNote,
    spendPct,
    varPatrimonioAvgDisplay,
    gastosAvgDisplay,
    retornoRealAvgDisplay,
  };
};

export const AnalysisAurum: React.FC = () => {
  const location = useLocation();
  const [tab, setTab] = useState<AnalysisTab>('returns');
  const [currency, setCurrency] = useState<WealthCurrency>('CLP');
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() =>
    loadWealthClosures().sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [freedomDraft, setFreedomDraft] = useState<FreedomControlDraft>({
    annualRatePct: '5',
    horizonYears: '40',
    monthlySpendClp: '6000000',
  });
  const initialFreedomOpen = useMemo(() => {
    const initialAnnualRatePct = parseNumericDraft('5');
    const initialHorizonYears = parseNumericDraft('40');
    const initialMonthlySpendClp = parseNumericDraft('6000000');
    const hasBase = resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals).status === 'ok';
    return !(hasBase && initialAnnualRatePct && initialHorizonYears && initialMonthlySpendClp);
  }, [closures, includeRiskCapitalInTotals]);
  const [freedomParametersOpen, setFreedomParametersOpen] = useState(initialFreedomOpen);

  const refreshClosures = useCallback(() => {
    const loaded = loadWealthClosures().sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    setClosures(loaded);
    setErrorMessage('');
  }, []);

  useEffect(() => {
    refreshClosures();
  }, [refreshClosures]);

  useEffect(() => {
    saveIncludeRiskCapitalInTotals(includeRiskCapitalInTotals);
  }, [includeRiskCapitalInTotals]);

  useEffect(() => {
    const refreshRiskToggle = () => setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
    window.addEventListener('storage', refreshRiskToggle);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      refreshRiskToggle as EventListener,
    );
    return () => {
      window.removeEventListener('storage', refreshRiskToggle);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        refreshRiskToggle as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const onWealthUpdated = () => refreshClosures();
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      refreshClosures();
    };
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshClosures]);

  const monthlyRowsAsc = useMemo(
    () => computeMonthlyRows(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );
  const monthlyRowsAscWithoutCrp = useMemo(() => computeMonthlyRows(closures, false), [closures]);
  const monthlyRowsDesc = useMemo(
    () => [...monthlyRowsAsc].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [monthlyRowsAsc],
  );
  const crpContributionInsight = useMemo(() => {
    if (!includeRiskCapitalInTotals) return null;
    return buildCrpContributionInsight(monthlyRowsAsc, monthlyRowsAscWithoutCrp);
  }, [includeRiskCapitalInTotals, monthlyRowsAsc, monthlyRowsAscWithoutCrp]);

  const analysisDiagnostics = useMemo(() => {
    const eurScaleOutliers = monthlyRowsAsc.filter((row) => row.rawEurClp > 10000);
    const invalidNetMonths = monthlyRowsAsc.filter((row) => row.invalidNet).map((row) => row.monthKey);
    const anomalyRaw = [...monthlyRowsAsc]
      .filter((row) => row.pct !== null)
      .sort((a, b) => Math.abs(Number(b.pct)) - Math.abs(Number(a.pct)))[0] || null;
    return { eurScaleOutliers, invalidNetMonths, anomalyRaw };
  }, [monthlyRowsAsc]);

  useEffect(() => {
    if (analysisDiagnostics.invalidNetMonths.length > 0) {
      setErrorMessage(
        `Hay cierres con netClp inválido en: ${analysisDiagnostics.invalidNetMonths.join(', ')}. Se muestran con "—" y no entran en resúmenes.`,
      );
      return;
    }

    if (analysisDiagnostics.eurScaleOutliers.length > 0) {
      setErrorMessage(
        `Detecté EUR/CLP fuera de escala en: ${analysisDiagnostics.eurScaleOutliers
          .map((row) => row.monthKey)
          .join(', ')}. Corrige esos cierres en origen.`,
      );
      return;
    }

    const suspectPost = monthlyRowsAsc.find(
      (row) => row.gastosClp !== null && Math.abs(row.gastosClp) > 100_000_000,
    );
    if (suspectPost) {
      setErrorMessage(
        `Detecté gastos fuera de rango en ${suspectPost.monthKey}. Revisa el EUR/CLP guardado en ese cierre.`,
      );
      return;
    }

    setErrorMessage('');
  }, [analysisDiagnostics, monthlyRowsAsc]);

  const periodSummaries = useMemo(() => {
    const monthKeysAsc = monthlyRowsAsc.map((row) => row.monthKey);
    const toSummary = (count: number, label: string) => {
      const keys = monthKeysAsc.slice(Math.max(0, monthKeysAsc.length - count));
      if (!keys.length) return null;
      const rows = monthlyRowsAsc.filter((row) => keys.includes(row.monthKey));
      const baseNetClp = rows.find((row) => row.netClp !== null)?.netClp ?? null;
      return aggregateRows(`period-${label}`, label, rows, currency, baseNetClp);
    };

    const summaries: AggregatedSummary[] = [];
    const p12 = toSummary(12, '12M');
    if (p12) summaries.push(p12);
    const p24 = toSummary(24, '24M');
    if (p24) summaries.push(p24);
    if (monthKeysAsc.length >= 36) {
      const p36 = toSummary(36, '36M');
      if (p36) summaries.push(p36);
    }
    if (monthKeysAsc.length) {
      const baseNetClp = monthlyRowsAsc.find((row) => row.netClp !== null)?.netClp ?? null;
      summaries.push(aggregateRows('period-inicio', 'Desde inicio', monthlyRowsAsc, currency, baseNetClp));
    }
    return summaries;
  }, [monthlyRowsAsc, currency]);

  const yearlySummaries = useMemo(() => {
    const years = Array.from(new Set(monthlyRowsAsc.map((row) => monthYear(row.monthKey)))).sort((a, b) => a - b);
    return years.map((year) => {
      const rows = monthlyRowsAsc.filter((row) => monthYear(row.monthKey) === year);
      const previousYearBase = monthlyRowsAsc
        .filter((row) => row.monthKey < `${year}-01`)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      const previousYearBaseValid = previousYearBase.filter((row) => row.netClp !== null);
      const baseNetClp = previousYearBaseValid.length
        ? previousYearBaseValid[previousYearBaseValid.length - 1].netClp
        : null;
      return aggregateRows(`year-${year}`, String(year), rows, currency, baseNetClp);
    });
  }, [monthlyRowsAsc, currency]);

  const heroSinceStart = useMemo(() => {
    if (!monthlyRowsAsc.length) return null;
    const baseNetClp = monthlyRowsAsc.find((row) => row.netClp !== null)?.netClp ?? null;
    return aggregateRows('hero-inicio', 'Desde inicio', monthlyRowsAsc, currency, baseNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLast12 = useMemo(() => {
    const rows = monthlyRowsAsc.slice(Math.max(0, monthlyRowsAsc.length - 12));
    if (!rows.length) return null;
    const baseNetClp = rows.find((row) => row.netClp !== null)?.netClp ?? null;
    return aggregateRows('hero-12m', 'Últ. 12M', rows, currency, baseNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLastMonth = useMemo(() => {
    const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealClp !== null) || null;
    if (!row) return null;
    return aggregateRows('hero-ultimo', 'Últ. mes', [row], currency, row.prevNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLastMonthPctMonthly = useMemo(() => {
    const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealClp !== null) || null;
    return row?.pct ?? null;
  }, [monthlyRowsAsc]);

  const wealthLabModel = useMemo(
    () => buildWealthLabModel(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );

  const financialFreedomBase = useMemo(
    () => resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );
  const freedomAnnualRatePct = useMemo(() => parseNumericDraft(freedomDraft.annualRatePct) ?? NaN, [freedomDraft.annualRatePct]);
  const freedomHorizonYears = useMemo(() => parseNumericDraft(freedomDraft.horizonYears) ?? NaN, [freedomDraft.horizonYears]);
  const freedomMonthlySpendClp = useMemo(() => parseNumericDraft(freedomDraft.monthlySpendClp) ?? NaN, [freedomDraft.monthlySpendClp]);
  const financialFreedomWithdrawalPlan = useMemo(
    () => buildMonthlyWithdrawalPlan(closures, freedomAnnualRatePct, freedomHorizonYears, includeRiskCapitalInTotals),
    [closures, freedomAnnualRatePct, freedomHorizonYears, includeRiskCapitalInTotals],
  );
  const financialFreedomCoveragePlan = useMemo(
    () => buildCoveragePlan(closures, freedomAnnualRatePct, freedomMonthlySpendClp, includeRiskCapitalInTotals),
    [closures, freedomAnnualRatePct, freedomMonthlySpendClp, includeRiskCapitalInTotals],
  );
  const freedomInputsAreValid = Boolean(
    financialFreedomBase.status === 'ok' &&
      Number.isFinite(freedomAnnualRatePct) &&
      freedomAnnualRatePct >= 0 &&
      Number.isFinite(freedomHorizonYears) &&
      freedomHorizonYears > 0 &&
      Number.isFinite(freedomMonthlySpendClp) &&
      freedomMonthlySpendClp > 0,
  );

  useEffect(() => {
    const requestedTab = (location.state as { analysisTab?: AnalysisTab } | null)?.analysisTab;
    if (requestedTab === 'returns' || requestedTab === 'freedom' || requestedTab === 'lab') {
      setTab((prev) => (prev === requestedTab ? prev : requestedTab));
    }
  }, [location.state]);

  useEffect(() => {
    if (!freedomInputsAreValid) {
      setFreedomParametersOpen(true);
    }
  }, [freedomInputsAreValid]);

  return (
    <div className="space-y-3 p-3">
      <Card className="sticky top-[68px] z-20 border-slate-200 bg-white/95 p-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant={tab === 'returns' ? 'primary' : 'secondary'} onClick={() => setTab('returns')}>
            Retornos
          </Button>
          <Button size="sm" variant={tab === 'freedom' ? 'primary' : 'secondary'} onClick={() => setTab('freedom')}>
            Libertad Financiera
          </Button>
          <Button size="sm" variant={tab === 'lab' ? 'primary' : 'secondary'} onClick={() => setTab('lab')}>
            Lab
          </Button>
        </div>
        {tab === 'returns' && <div className="mt-2 flex items-center gap-1">
          {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCurrency(item)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                currency === item
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-600'
              }`}
            >
              {item}
            </button>
          ))}
        </div>}
      </Card>

      {tab === 'lab' ? (
        <LabTab
          model={wealthLabModel}
          includeRiskCapitalInTotals={includeRiskCapitalInTotals}
          onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
        />
      ) : tab === 'freedom' ? (
        <FreedomTab
          sourceMonthKey={financialFreedomBase.sourceMonthKey}
          patrimonioBaseClp={financialFreedomBase.patrimonioBaseClp}
          draft={freedomDraft}
          onChange={(key, value) => {
            if (key === 'annualRatePct') {
              setFreedomDraft((prev) => ({ ...prev, annualRatePct: formatDraftPercent(value) }));
              return;
            }
            if (key === 'horizonYears') {
              setFreedomDraft((prev) => ({ ...prev, horizonYears: formatDraftInteger(value) }));
              return;
            }
            setFreedomDraft((prev) => ({ ...prev, monthlySpendClp: formatDraftMoney(value) }));
          }}
          includeRiskCapitalInTotals={includeRiskCapitalInTotals}
          isOpen={freedomParametersOpen}
          onToggleParameters={() => setFreedomParametersOpen((prev) => !prev)}
          onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
          withdrawalPlan={financialFreedomWithdrawalPlan}
          coveragePlan={financialFreedomCoveragePlan}
        />
      ) : (
        <ReturnsTab
          heroSinceStart={heroSinceStart}
          heroLast12={heroLast12}
          heroLastMonth={heroLastMonth}
          heroLastMonthPctMonthly={heroLastMonthPctMonthly}
          currency={currency}
          includeRiskCapitalInTotals={includeRiskCapitalInTotals}
          onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
          crpContributionInsight={crpContributionInsight}
          analysisDiagnostics={{ anomalyRaw: analysisDiagnostics.anomalyRaw }}
          monthlyRowsAsc={monthlyRowsAsc}
          monthlyRowsDesc={monthlyRowsDesc}
          periodSummaries={periodSummaries}
          yearlySummaries={yearlySummaries}
        />
      )}

      {!!errorMessage && (
        <Card className="border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{errorMessage}</Card>
      )}

      <Card className="border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <BarChart3 size={14} />
          Datos en solo lectura: los cálculos de Análisis no modifican cierres ni registros persistidos.
        </div>
      </Card>
    </div>
  );
};
