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
  aggregateRows,
  buildWealthEvolutionComparisonModel,
  buildReturnsSeriesView,
  buildTrailingSummary,
  computeMonthlyRows,
  monthYear,
} from '../services/returnsAnalysis';
import {
  buildWealthLabModel,
} from '../services/wealthLab';
import { buildCrpContributionInsight } from '../services/returnsCrpInsight';
import {
  GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
  warmGastappMonthlyContable,
} from '../services/gastosMonthly';

const loadWealthClosures = () => loadClosures();

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
  const [gastosSourceVersion, setGastosSourceVersion] = useState(0);
  const [includeEstimatedMonth, setIncludeEstimatedMonth] = useState(false);
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
    const onGastosSourceUpdated = () => setGastosSourceVersion((current) => current + 1);
    window.addEventListener(
      GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
      onGastosSourceUpdated as EventListener,
    );
    void warmGastappMonthlyContable();
    return () => {
      window.removeEventListener(
        GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
        onGastosSourceUpdated as EventListener,
      );
    };
  }, []);

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

  const officialMonthlyRowsAsc = useMemo(
    () => computeMonthlyRows(closures, includeRiskCapitalInTotals, currency),
    [closures, includeRiskCapitalInTotals, currency, gastosSourceVersion],
  );
  const monthlyRowsAscWithoutCrp = useMemo(
    () => computeMonthlyRows(closures, false, currency),
    [closures, currency, gastosSourceVersion],
  );
  const returnsSeriesView = useMemo(
    () => buildReturnsSeriesView(officialMonthlyRowsAsc),
    [officialMonthlyRowsAsc],
  );
  const monthlyRowsAsc = includeEstimatedMonth && returnsSeriesView.hasEstimatedMonth
    ? returnsSeriesView.estimatedRows
    : returnsSeriesView.officialRows;
  const monthlyRowsDesc = useMemo(
    () => [...monthlyRowsAsc].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [monthlyRowsAsc],
  );
  useEffect(() => {
    if (!returnsSeriesView.hasEstimatedMonth) {
      setIncludeEstimatedMonth(false);
    }
  }, [returnsSeriesView.hasEstimatedMonth]);
  const wealthEvolutionModel = useMemo(
    () => buildWealthEvolutionComparisonModel(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );
  const crpContributionInsight = useMemo(() => {
    if (!includeRiskCapitalInTotals) return null;
    return buildCrpContributionInsight(monthlyRowsAsc, monthlyRowsAscWithoutCrp, currency);
  }, [includeRiskCapitalInTotals, monthlyRowsAsc, monthlyRowsAscWithoutCrp, currency]);

  const analysisDiagnostics = useMemo(() => {
    const eurScaleOutliers = officialMonthlyRowsAsc.filter((row) => row.rawEurClp > 10000);
    const invalidNetMonths = officialMonthlyRowsAsc.filter((row) => row.invalidNet).map((row) => row.monthKey);
    const anomalyRaw = [...officialMonthlyRowsAsc]
      .filter((row) => row.pct !== null)
      .sort((a, b) => Math.abs(Number(b.pct)) - Math.abs(Number(a.pct)))[0] || null;
    const missingSpendMonths = officialMonthlyRowsAsc
      .filter((row) => row.gastosStatus === 'missing')
      .map((row) => row.monthKey);
    const fxExcludedMonths = officialMonthlyRowsAsc
      .filter((row) => !row.fxAuditable)
      .map((row) => row.monthKey);
    return { eurScaleOutliers, invalidNetMonths, anomalyRaw, missingSpendMonths, fxExcludedMonths };
  }, [officialMonthlyRowsAsc]);

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

    if (analysisDiagnostics.missingSpendMonths.length > 0) {
      setErrorMessage(
        `Faltan gastos contables cerrados en: ${analysisDiagnostics.missingSpendMonths.join(', ')}. Esos meses no se incluyen en agregados.`,
      );
      return;
    }

    const suspectPost = officialMonthlyRowsAsc.find(
      (row) => row.gastosClp !== null && Math.abs(row.gastosClp) > 100_000_000,
    );
    if (suspectPost) {
      setErrorMessage(
        `Detecté gastos fuera de rango en ${suspectPost.monthKey}. Revisa el EUR/CLP guardado en ese cierre.`,
      );
      return;
    }

    setErrorMessage('');
  }, [analysisDiagnostics, officialMonthlyRowsAsc]);

  const periodSummaries = useMemo(() => {
    const monthKeysAsc = monthlyRowsAsc.map((row) => row.monthKey);

    const summaries: AggregatedSummary[] = [];
    const p12 = buildTrailingSummary(monthlyRowsAsc, 12, 'period-12M', '12M');
    if (p12) summaries.push(p12);
    const p24 = buildTrailingSummary(monthlyRowsAsc, 24, 'period-24M', '24M');
    if (p24) summaries.push(p24);
    if (monthKeysAsc.length >= 36) {
      const p36 = buildTrailingSummary(monthlyRowsAsc, 36, 'period-36M', '36M');
      if (p36) summaries.push(p36);
    }
    if (monthKeysAsc.length) {
      const baseNetDisplay = monthlyRowsAsc.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
      summaries.push(aggregateRows('period-inicio', 'Desde inicio', monthlyRowsAsc, baseNetDisplay));
    }
    return summaries;
  }, [monthlyRowsAsc]);

  const yearlySummaries = useMemo(() => {
    const years = Array.from(new Set(monthlyRowsAsc.map((row) => monthYear(row.monthKey)))).sort((a, b) => a - b);
    return years.map((year) => {
      const rows = monthlyRowsAsc.filter((row) => monthYear(row.monthKey) === year);
      const previousYearBase = monthlyRowsAsc
        .filter((row) => row.monthKey < `${year}-01`)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      const previousYearBaseValid = previousYearBase.filter((row) => row.netDisplay !== null);
      const baseNetDisplay = previousYearBaseValid.length
        ? previousYearBaseValid[previousYearBaseValid.length - 1].netDisplay
        : null;
      return aggregateRows(`year-${year}`, String(year), rows, baseNetDisplay);
    });
  }, [monthlyRowsAsc]);

  const heroSinceStart = useMemo(() => {
    if (!monthlyRowsAsc.length) return null;
    const baseNetDisplay = monthlyRowsAsc.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
    return aggregateRows('hero-inicio', 'Desde inicio', monthlyRowsAsc, baseNetDisplay);
  }, [monthlyRowsAsc]);

  const heroLast12 = useMemo(() => {
    return buildTrailingSummary(monthlyRowsAsc, 12, 'hero-12m', 'Últ. 12M');
  }, [monthlyRowsAsc]);

  const heroYtd2026 = useMemo(() => {
    const ytdRows = monthlyRowsAsc.filter((row) => row.monthKey >= '2026-01' && row.monthKey <= '2026-12');
    if (!ytdRows.length) return null;
    const baseRow = monthlyRowsAsc
      .filter((row) => row.monthKey < '2026-01' && row.netDisplay !== null)
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .at(-1);
    return aggregateRows('hero-ytd-2026', 'YTD 2026', ytdRows, baseRow?.netDisplay ?? null);
  }, [monthlyRowsAsc]);

  const heroLastMonth = useMemo(() => {
    const row = [...returnsSeriesView.officialRows].reverse().find((item) => item.retornoRealDisplay !== null) || null;
    if (!row) return null;
    return aggregateRows('hero-ultimo', 'Últ. mes válido', [row], row.prevNetDisplay);
  }, [returnsSeriesView.officialRows]);

  const heroLastMonthPctMonthly = useMemo(() => {
    const row = [...returnsSeriesView.officialRows].reverse().find((item) => item.retornoRealDisplay !== null) || null;
    return row?.pct ?? null;
  }, [returnsSeriesView.officialRows]);

  const wealthLabModel = useMemo(
    () => buildWealthLabModel(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals, gastosSourceVersion],
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
          heroYtd2026={heroYtd2026}
          heroLastMonth={heroLastMonth}
          heroLastMonthPctMonthly={heroLastMonthPctMonthly}
          currency={currency}
          includeEstimatedMonth={includeEstimatedMonth && returnsSeriesView.hasEstimatedMonth}
          hasEstimatedMonth={returnsSeriesView.hasEstimatedMonth}
          estimatedMonthMeta={returnsSeriesView.pendingEstimate}
          pendingEstimateDetail={returnsSeriesView.pendingEstimateDetail}
          officialAvailabilityNotice={returnsSeriesView.officialAvailabilityNotice}
          onToggleIncludeEstimatedMonth={() => setIncludeEstimatedMonth((prev) => !prev)}
          includeRiskCapitalInTotals={includeRiskCapitalInTotals}
          onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
          crpContributionInsight={crpContributionInsight}
          analysisDiagnostics={{ anomalyRaw: analysisDiagnostics.anomalyRaw }}
          fxExcludedMonths={analysisDiagnostics.fxExcludedMonths}
          officialMonthlyRowsAsc={returnsSeriesView.officialRows}
          monthlyRowsDesc={monthlyRowsDesc}
          periodSummaries={periodSummaries}
          yearlySummaries={yearlySummaries}
          wealthEvolutionModel={wealthEvolutionModel}
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
