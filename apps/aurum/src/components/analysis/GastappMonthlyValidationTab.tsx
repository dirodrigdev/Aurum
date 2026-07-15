import React, { useEffect, useMemo, useState } from 'react';

import { Card } from '../Components';
import { buildCrpContributionInsight } from '../../services/returnsCrpInsight';
import {
  buildCalendarReturnsPresentation,
  loadGastappMonthlyCalendarValidation,
  replaceMonthlySpendWithCalendarContract,
} from '../../services/gastappMonthlyCalendarValidation';
import { ReturnsTab, type ReturnsTabProps } from './ReturnsTab';
import type { MonthlyReturnRow } from './types';

export const GastappMonthlyValidationTab: React.FC<{
  officialReturnsProps: ReturnsTabProps;
  officialRowsWithoutCrp: MonthlyReturnRow[];
}> = ({ officialReturnsProps, officialRowsWithoutCrp }) => {
  const [source, setSource] = useState<Awaited<ReturnType<typeof loadGastappMonthlyCalendarValidation>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGastappMonthlyCalendarValidation().then((result) => {
      if (!cancelled) setSource(result);
    });
    return () => { cancelled = true; };
  }, []);

  const calendarModel = useMemo(() => {
    if (!source?.calendarContracts) return null;
    const monthlyRowsAsc = replaceMonthlySpendWithCalendarContract(
      officialReturnsProps.officialMonthlyRowsAsc,
      source.calendarContracts,
      officialReturnsProps.currency,
    );
    const rowsWithoutCrp = replaceMonthlySpendWithCalendarContract(
      officialRowsWithoutCrp,
      source.calendarContracts,
      officialReturnsProps.currency,
    );
    const presentation = buildCalendarReturnsPresentation(monthlyRowsAsc);
    const crpContributionInsight = officialReturnsProps.includeRiskCapitalInTotals
      ? buildCrpContributionInsight(monthlyRowsAsc, rowsWithoutCrp, officialReturnsProps.currency)
      : null;
    const anomalyRaw = [...monthlyRowsAsc]
      .filter((row) => row.pct !== null)
      .sort((a, b) => Math.abs(Number(b.pct)) - Math.abs(Number(a.pct)))[0] || null;
    return {
      ...presentation,
      crpContributionInsight,
      anomalyRaw,
      fxExcludedMonths: monthlyRowsAsc.filter((row) => !row.fxAuditable).map((row) => row.monthKey),
    };
  }, [officialReturnsProps, officialRowsWithoutCrp, source]);

  if (!source) return <Card className="p-4 text-sm text-slate-600">Cargando retornos con mes calendario…</Card>;
  if (source.status !== 'ok' || !calendarModel) {
    return <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No se pudo cargar la comparación: {source.error || source.status}.</Card>;
  }

  return <ReturnsTab
    {...officialReturnsProps}
    visualVariant="calendar-control"
    heroSinceStart={calendarModel.heroSinceStart}
    heroLast12={calendarModel.heroLast12}
    heroYtd2026={calendarModel.heroYtd2026}
    heroLastMonth={calendarModel.heroLastMonth}
    heroLastMonthPctMonthly={calendarModel.heroLastMonthPctMonthly}
    heroLastMonthPctMonthlyReal={calendarModel.heroLastMonthPctMonthlyReal}
    includeEstimatedMonth={false}
    hasEstimatedMonth={false}
    estimatedMonthMeta={null}
    pendingEstimateDetail={null}
    officialAvailabilityNotice={null}
    crpContributionInsight={calendarModel.crpContributionInsight}
    analysisDiagnostics={{ anomalyRaw: calendarModel.anomalyRaw }}
    fxExcludedMonths={calendarModel.fxExcludedMonths}
    officialMonthlyRowsAsc={calendarModel.monthlyRowsAsc}
    monthlyRowsDesc={calendarModel.monthlyRowsDesc}
    periodSummaries={calendarModel.periodSummaries}
    yearlySummaries={calendarModel.yearlySummaries}
  />;
};
