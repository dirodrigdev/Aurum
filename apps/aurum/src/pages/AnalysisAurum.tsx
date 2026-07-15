import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button, Card } from '../components/Components';
import { FreedomTab } from '../components/analysis/FreedomTab';
import { LabTab } from '../components/analysis/LabTab';
import { ReturnsTab, type ReturnsTabProps } from '../components/analysis/ReturnsTab';
import { GastappMonthlyValidationTab } from '../components/analysis/GastappMonthlyValidationTab';
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
  repairKnownHistoricalUfClpClosures,
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
  enumerateMonthKeys,
  monthYear,
} from '../services/returnsAnalysis';
import {
  buildWealthLabModel,
} from '../services/wealthLab';
import { buildCrpContributionInsight } from '../services/returnsCrpInsight';
import {
  clearAnalysisSessionCache,
  getOrBuildAnalysisSessionValue,
} from '../services/analysisSessionCache';
import {
  GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
  getGastappMonthlyRuntimeDiagnostic,
  warmGastappMonthlyContable,
} from '../services/gastosMonthly';
import {
  describeGastappAnalysisAccessIssue,
  describeGastappZipExportStatus,
} from '../services/dataRoom/gastappAccessGuidance';
import {
  exportFinancialDataRoomWithTransactionsZip,
  exportFinancialDataRoomZip,
} from '../services/dataRoom/exportDataRoomZip';

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

const sortClosuresAsc = (items: WealthMonthlyClosure[]) =>
  [...items].sort((a, b) => a.monthKey.localeCompare(b.monthKey));

const buildClosuresFingerprint = (closures: WealthMonthlyClosure[]) =>
  closures
    .map((closure) =>
      [
        closure.monthKey,
        closure.closedAt || '',
        Number(closure.summary?.netClp ?? ''),
        Number(closure.summary?.netClpWithRisk ?? ''),
        Number(closure.summary?.netConsolidatedClp ?? ''),
        Number(closure.fxRates?.usdClp ?? ''),
        Number(closure.fxRates?.eurClp ?? ''),
        Number(closure.fxRates?.ufClp ?? ''),
      ].join(':'),
    )
    .join('|');

const buildAnalysisFingerprint = ({
  closuresFingerprint,
  includeRiskCapitalInTotals,
  currency,
  includeEstimatedMonth,
  gastappSourceFingerprint,
}: {
  closuresFingerprint: string;
  includeRiskCapitalInTotals: boolean;
  currency: WealthCurrency;
  includeEstimatedMonth: boolean;
  gastappSourceFingerprint: string;
}) =>
  JSON.stringify({
    closuresFingerprint,
    includeRiskCapitalInTotals,
    currency,
    includeEstimatedMonth,
    gastappSourceFingerprint,
  });

const formatAnalysisUpdatedAt = (iso: string) => {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const AnalysisAurum: React.FC = () => {
  const location = useLocation();
  const [tab, setTab] = useState<AnalysisTab>('returns');
  const [currency, setCurrency] = useState<WealthCurrency>('CLP');
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() =>
    sortClosuresAsc(loadWealthClosures()),
  );
  const [gastosSourceVersion, setGastosSourceVersion] = useState(0);
  const [includeEstimatedMonth, setIncludeEstimatedMonth] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportingDataRoomKind, setExportingDataRoomKind] = useState<'consolidated' | 'transactions' | null>(null);
  const [analysisRefreshTick, setAnalysisRefreshTick] = useState(0);
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
    const loaded = sortClosuresAsc(loadWealthClosures());
    const loadedFingerprint = buildClosuresFingerprint(loaded);
    setClosures((current) => {
      const currentFingerprint = buildClosuresFingerprint(current);
      return currentFingerprint === loadedFingerprint ? current : loaded;
    });
    setErrorMessage('');
  }, []);

  useEffect(() => {
    refreshClosures();
  }, [refreshClosures]);

  useEffect(() => {
    let cancelled = false;
    void repairKnownHistoricalUfClpClosures().then((result) => {
      if (cancelled || result.repairedCount === 0) return;
      refreshClosures();
    });
    return () => {
      cancelled = true;
    };
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

  const closuresFingerprint = useMemo(() => buildClosuresFingerprint(closures), [closures]);
  const gastappSourceFingerprint = useMemo(() => {
    const diagnostic = getGastappMonthlyRuntimeDiagnostic();
    return JSON.stringify({
      status: diagnostic.status,
      mode: diagnostic.mode,
      error: diagnostic.error,
      docsLoaded: diagnostic.docsLoaded,
      lastUpdatedAt: diagnostic.lastUpdatedAt,
    });
  }, [gastosSourceVersion]);
  const gastappRuntimeDiagnostic = useMemo(() => getGastappMonthlyRuntimeDiagnostic(), [gastosSourceVersion]);
  const analysisFingerprint = useMemo(
    () =>
      buildAnalysisFingerprint({
        closuresFingerprint,
        includeRiskCapitalInTotals,
        currency,
        includeEstimatedMonth,
        gastappSourceFingerprint,
      }),
    [closuresFingerprint, includeRiskCapitalInTotals, currency, includeEstimatedMonth, gastappSourceFingerprint],
  );
  const analysisEntry = useMemo(
    () =>
      getOrBuildAnalysisSessionValue(analysisFingerprint, () => {
        const officialMonthlyRowsAsc = computeMonthlyRows(closures, includeRiskCapitalInTotals, currency);
        const monthlyRowsAscWithoutCrp = computeMonthlyRows(closures, false, currency);
        const returnsSeriesView = buildReturnsSeriesView(officialMonthlyRowsAsc);
        const monthlyRowsAsc =
          includeEstimatedMonth && returnsSeriesView.hasEstimatedMonth
            ? returnsSeriesView.estimatedRows
            : returnsSeriesView.officialRows;
        const monthlyRowsDesc = [...monthlyRowsAsc].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
        const wealthEvolutionModel = buildWealthEvolutionComparisonModel(closures, includeRiskCapitalInTotals);
        const crpContributionInsight = includeRiskCapitalInTotals
          ? buildCrpContributionInsight(monthlyRowsAsc, monthlyRowsAscWithoutCrp, currency)
          : null;
        const analysisDiagnostics = (() => {
          const eurScaleOutliers = officialMonthlyRowsAsc.filter((row) => row.rawEurClp > 10000);
          const invalidNetMonths = officialMonthlyRowsAsc.filter((row) => row.invalidNet).map((row) => row.monthKey);
          const anomalyRaw =
            [...officialMonthlyRowsAsc]
              .filter((row) => row.pct !== null)
              .sort((a, b) => Math.abs(Number(b.pct)) - Math.abs(Number(a.pct)))[0] || null;
          const missingSpendMonths = officialMonthlyRowsAsc
            .filter((row) => row.gastosStatus === 'missing')
            .map((row) => row.monthKey);
          const fxExcludedMonths = officialMonthlyRowsAsc
            .filter((row) => !row.fxAuditable)
            .map((row) => row.monthKey);
          return { eurScaleOutliers, invalidNetMonths, anomalyRaw, missingSpendMonths, fxExcludedMonths };
        })();
        const periodSummaries = (() => {
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
            summaries.push(
              aggregateRows('period-inicio', 'Desde inicio', monthlyRowsAsc, baseNetDisplay, {
                expectedMonthKeys: enumerateMonthKeys(monthKeysAsc[0], monthKeysAsc[monthKeysAsc.length - 1]),
              }),
            );
          }
          return summaries;
        })();
        const yearlySummaries = (() => {
          const years = Array.from(new Set(monthlyRowsAsc.map((row) => monthYear(row.monthKey)))).sort((a, b) => a - b);
          const latestYear = years[years.length - 1] ?? null;
          return years.map((year) => {
            const rows = monthlyRowsAsc.filter((row) => monthYear(row.monthKey) === year);
            const lastYearMonthKey = year < (latestYear ?? year) ? `${year}-12` : rows[rows.length - 1]?.monthKey ?? `${year}-12`;
            const previousYearBase = monthlyRowsAsc
              .filter((row) => row.monthKey < `${year}-01`)
              .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
            const previousYearBaseValid = previousYearBase.filter((row) => row.netDisplay !== null);
            const baseNetDisplay = previousYearBaseValid.length
              ? previousYearBaseValid[previousYearBaseValid.length - 1].netDisplay
              : null;
            return aggregateRows(`year-${year}`, String(year), rows, baseNetDisplay, {
              expectedMonthKeys: enumerateMonthKeys(`${year}-01`, lastYearMonthKey),
            });
          });
        })();
        const heroSinceStart = (() => {
          if (!monthlyRowsAsc.length) return null;
          const baseNetDisplay = monthlyRowsAsc.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
          return aggregateRows('hero-inicio', 'Desde inicio', monthlyRowsAsc, baseNetDisplay, {
            expectedMonthKeys: enumerateMonthKeys(monthlyRowsAsc[0].monthKey, monthlyRowsAsc[monthlyRowsAsc.length - 1].monthKey),
          });
        })();
        const heroLast12 = buildTrailingSummary(monthlyRowsAsc, 12, 'hero-12m', 'Últ. 12M');
        const heroYtd2026 = (() => {
          const ytdRows = monthlyRowsAsc.filter((row) => row.monthKey >= '2026-01' && row.monthKey <= '2026-12');
          if (!ytdRows.length) return null;
          const baseRow = monthlyRowsAsc
            .filter((row) => row.monthKey < '2026-01' && row.netDisplay !== null)
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
            .at(-1);
          return aggregateRows('hero-ytd-2026', 'YTD 2026', ytdRows, baseRow?.netDisplay ?? null, {
            expectedMonthKeys: enumerateMonthKeys('2026-01', ytdRows[ytdRows.length - 1].monthKey),
          });
        })();
        const heroLastMonth = (() => {
          const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealDisplay !== null) || null;
          if (!row) return null;
          return aggregateRows('hero-ultimo', 'Últ. mes válido', [row], row.prevNetDisplay, {
            expectedMonthKeys: [row.monthKey],
          });
        })();
        const heroLastMonthPctMonthly =
          [...monthlyRowsAsc].reverse().find((item) => item.retornoRealDisplay !== null)?.pct ?? null;
        const heroLastMonthPctMonthlyReal =
          [...monthlyRowsAsc].reverse().find((item) => item.retornoRealDisplay !== null)?.pctReal ?? null;
        const wealthLabModel = buildWealthLabModel(closures, includeRiskCapitalInTotals);
        const financialFreedomBase = resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals);

        return {
          officialMonthlyRowsAsc,
          monthlyRowsAscWithoutCrp,
          returnsSeriesView,
          monthlyRowsAsc,
          monthlyRowsDesc,
          wealthEvolutionModel,
          crpContributionInsight,
          analysisDiagnostics,
          periodSummaries,
          yearlySummaries,
          heroSinceStart,
          heroLast12,
          heroYtd2026,
          heroLastMonth,
          heroLastMonthPctMonthly,
          heroLastMonthPctMonthlyReal,
          wealthLabModel,
          financialFreedomBase,
        };
      }, (value) => {
        const candidate = value as {
          returnsSeriesView?: unknown;
          wealthEvolutionModel?: unknown;
          periodSummaries?: unknown;
          yearlySummaries?: unknown;
          financialFreedomBase?: unknown;
          officialMonthlyRowsAsc?: unknown;
        } | null;

        return Boolean(
          candidate &&
          candidate.returnsSeriesView &&
          candidate.wealthEvolutionModel &&
          Array.isArray(candidate.periodSummaries) &&
          Array.isArray(candidate.yearlySummaries) &&
          candidate.financialFreedomBase &&
          Array.isArray(candidate.officialMonthlyRowsAsc),
        );
      }),
    [analysisFingerprint, analysisRefreshTick, closures, includeRiskCapitalInTotals, currency, includeEstimatedMonth, gastosSourceVersion],
  );
  const {
    officialMonthlyRowsAsc,
    monthlyRowsAscWithoutCrp,
    returnsSeriesView,
    monthlyRowsAsc,
    monthlyRowsDesc,
    wealthEvolutionModel,
    crpContributionInsight,
    analysisDiagnostics,
    periodSummaries,
    yearlySummaries,
    heroSinceStart,
    heroLast12,
    heroYtd2026,
    heroLastMonth,
    heroLastMonthPctMonthly,
    heroLastMonthPctMonthlyReal,
    wealthLabModel,
    financialFreedomBase,
  } = analysisEntry.value;
  useEffect(() => {
    if (!returnsSeriesView.hasEstimatedMonth) {
      setIncludeEstimatedMonth(false);
    }
  }, [returnsSeriesView.hasEstimatedMonth]);

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
      const gastappAccessIssue = describeGastappAnalysisAccessIssue({
        status: gastappRuntimeDiagnostic.status,
        mode: gastappRuntimeDiagnostic.mode,
        errorCode: gastappRuntimeDiagnostic.errorCode,
        errorMessage: gastappRuntimeDiagnostic.error,
        missingMonths: analysisDiagnostics.missingSpendMonths,
      });
      if (gastappAccessIssue) {
        setErrorMessage(gastappAccessIssue);
        return;
      }
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
  }, [analysisDiagnostics, gastappRuntimeDiagnostic, officialMonthlyRowsAsc]);

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
    if (requestedTab === 'returns' || requestedTab === 'gastapp-validation' || requestedTab === 'freedom' || requestedTab === 'lab') {
      setTab((prev) => (prev === requestedTab ? prev : requestedTab));
    }
  }, [location.state]);

  useEffect(() => {
    if (!freedomInputsAreValid) {
      setFreedomParametersOpen(true);
    }
  }, [freedomInputsAreValid]);

  const refreshAnalysisModels = useCallback(() => {
    clearAnalysisSessionCache(analysisFingerprint);
    refreshClosures();
    setAnalysisRefreshTick((current) => current + 1);
  }, [analysisFingerprint, refreshClosures]);

  const handleExportDataRoom = useCallback(async () => {
    setExportingDataRoomKind('consolidated');
    setExportMessage('');
    try {
      const bundle = await exportFinancialDataRoomZip({
        closures,
        officialMonthlyRowsAsc: returnsSeriesView.officialRows,
        wealthEvolutionModel,
        periodSummaries,
        yearlySummaries,
        heroSinceStart,
        heroLast12,
        heroYtd2026,
        heroLastMonth,
      }, {
        onProgress: setExportMessage,
      });
      const gastappStatus = bundle.manifest.source_status.gastapp_status;
      const ledgerPreviewStatus = bundle.manifest.gastapp_ledger_preview_status;
      setExportMessage(describeGastappZipExportStatus({
        filename: bundle.filename,
        gastappStatus,
        ledgerPreviewStatus,
      }));
    } catch (error: any) {
      setExportMessage(String(error?.message || error || 'No pude generar el ZIP.'));
    } finally {
      setExportingDataRoomKind(null);
    }
  }, [
    closures,
    returnsSeriesView.officialRows,
    wealthEvolutionModel,
    periodSummaries,
    yearlySummaries,
    heroSinceStart,
    heroLast12,
    heroYtd2026,
    heroLastMonth,
  ]);

  const handleExportDataRoomWithTransactions = useCallback(async () => {
    setExportingDataRoomKind('transactions');
    setExportMessage('');
    try {
      const bundle = await exportFinancialDataRoomWithTransactionsZip({
        closures,
        officialMonthlyRowsAsc: returnsSeriesView.officialRows,
        wealthEvolutionModel,
        periodSummaries,
        yearlySummaries,
        heroSinceStart,
        heroLast12,
        heroYtd2026,
        heroLastMonth,
      }, {
        onProgress: setExportMessage,
      });
      setExportMessage(`ZIP generado: ${bundle.filename} · Incluye manifest, period summaries y rows de GastApp Data Room v2.`);
    } catch (error: any) {
      setExportMessage(String(error?.message || error || 'No pude generar el ZIP con transacciones.'));
    } finally {
      setExportingDataRoomKind(null);
    }
  }, [
    closures,
    returnsSeriesView.officialRows,
    wealthEvolutionModel,
    periodSummaries,
    yearlySummaries,
    heroSinceStart,
    heroLast12,
    heroYtd2026,
    heroLastMonth,
  ]);

  const returnsTabProps: ReturnsTabProps = {
    heroSinceStart,
    heroLast12,
    heroYtd2026,
    heroLastMonth,
    heroLastMonthPctMonthly,
    heroLastMonthPctMonthlyReal,
    currency,
    includeEstimatedMonth: includeEstimatedMonth && returnsSeriesView.hasEstimatedMonth,
    hasEstimatedMonth: returnsSeriesView.hasEstimatedMonth,
    estimatedMonthMeta: returnsSeriesView.pendingEstimate,
    pendingEstimateDetail: returnsSeriesView.pendingEstimateDetail,
    officialAvailabilityNotice: returnsSeriesView.officialAvailabilityNotice,
    onToggleIncludeEstimatedMonth: () => setIncludeEstimatedMonth((prev) => !prev),
    includeRiskCapitalInTotals,
    onToggleRiskMode: () => setIncludeRiskCapitalInTotals((prev) => !prev),
    crpContributionInsight,
    analysisDiagnostics: { anomalyRaw: analysisDiagnostics.anomalyRaw },
    fxExcludedMonths: analysisDiagnostics.fxExcludedMonths,
    officialMonthlyRowsAsc: returnsSeriesView.officialRows,
    monthlyRowsDesc,
    periodSummaries,
    yearlySummaries,
    wealthEvolutionModel,
    onExportConsolidatedDataRoom: handleExportDataRoom,
    onExportTransactionalDataRoom: handleExportDataRoomWithTransactions,
    exportMessage,
    exportingConsolidatedDataRoom: exportingDataRoomKind === 'consolidated',
    exportingTransactionalDataRoom: exportingDataRoomKind === 'transactions',
  };

  return (
    <div className="space-y-3 p-3">
      <Card className="sticky top-[68px] z-20 border-slate-200 bg-white/95 p-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant={tab === 'returns' ? 'primary' : 'secondary'} onClick={() => setTab('returns')}>
            Retornos
          </Button>
          <Button size="sm" variant={tab === 'gastapp-validation' ? 'primary' : 'secondary'} onClick={() => setTab('gastapp-validation')}>
            Validación mensual
          </Button>
          <Button size="sm" variant={tab === 'freedom' ? 'primary' : 'secondary'} onClick={() => setTab('freedom')}>
            Libertad Financiera
          </Button>
          <Button size="sm" variant={tab === 'lab' ? 'primary' : 'secondary'} onClick={() => setTab('lab')}>
            Lab
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {tab === 'returns' || tab === 'gastapp-validation' ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
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
            </div>
          ) : (
            <div />
          )}
          <div className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
            <span className="whitespace-nowrap">{`Act. ${formatAnalysisUpdatedAt(analysisEntry.builtAt)}`}</span>
            <button
              type="button"
              onClick={refreshAnalysisModels}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Actualizar
            </button>
          </div>
        </div>
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
      ) : tab === 'gastapp-validation' ? (
        <GastappMonthlyValidationTab
          officialReturnsProps={returnsTabProps}
          officialRowsWithoutCrp={monthlyRowsAscWithoutCrp}
        />
      ) : (
        <ReturnsTab {...returnsTabProps} />
      )}

      {!!errorMessage && (
        <Card className="whitespace-pre-line border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{errorMessage}</Card>
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
