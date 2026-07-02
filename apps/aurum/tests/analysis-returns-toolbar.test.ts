/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/components/analysis/ReturnsTab', () => ({
  ReturnsTab: () => React.createElement('div', null, 'ReturnsTab mock'),
}));

vi.mock('../src/components/analysis/FreedomTab', () => ({
  FreedomTab: () => React.createElement('div', null, 'FreedomTab mock'),
}));

vi.mock('../src/components/analysis/LabTab', () => ({
  LabTab: () => React.createElement('div', null, 'LabTab mock'),
}));

vi.mock('../src/services/wealthStorage', () => ({
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT: 'risk-pref-updated',
  WEALTH_DATA_UPDATED_EVENT: 'wealth-updated',
  currentMonthKey: () => '2026-07',
  defaultFxRates: () => ({ usdClp: 950, eurClp: 1030, ufClp: 39000 }),
  loadClosures: () => [],
  loadIncludeRiskCapitalInTotals: () => false,
  repairKnownHistoricalUfClpClosures: vi.fn(async () => ({ repairedCount: 0 })),
  saveIncludeRiskCapitalInTotals: vi.fn(),
}));

vi.mock('../src/services/financialFreedom', () => ({
  buildCoveragePlan: () => null,
  buildMonthlyWithdrawalPlan: () => null,
  resolveFinancialFreedomBase: () => ({ status: 'missing', sourceMonthKey: null, patrimonioBaseClp: null }),
}));

vi.mock('../src/services/returnsAnalysis', () => ({
  aggregateRows: vi.fn(),
  buildWealthEvolutionComparisonModel: () => ({
    source: 'returns_analysis_closures',
    baseMonth: null,
    missingFxMonths: [],
    missingUfMonths: [],
    suspiciousUfMonths: [],
    hasIncompleteConversion: false,
    points: [],
    clpSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
    ufSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
    usdSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
    eurSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
    ufTrendSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
    base100Series: {
      CLP: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
      USD: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
      EUR: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
      UF: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
    },
  }),
  buildReturnsSeriesView: () => ({
    officialRows: [],
    estimatedRows: [],
    hasEstimatedMonth: false,
    pendingEstimate: null,
    pendingEstimateDetail: null,
    officialAvailabilityNotice: null,
  }),
  buildTrailingSummary: () => null,
  computeMonthlyRows: () => [],
  enumerateMonthKeys: () => [],
  monthYear: () => 2026,
}));

vi.mock('../src/services/wealthLab', () => ({
  buildWealthLabModel: () => ({ status: 'empty' }),
}));

vi.mock('../src/services/returnsCrpInsight', () => ({
  buildCrpContributionInsight: () => null,
}));

vi.mock('../src/services/analysisSessionCache', () => ({
  clearAnalysisSessionCache: vi.fn(),
  getOrBuildAnalysisSessionValue: vi.fn(() => ({
    builtAt: '2026-07-02T22:16:00.000Z',
    value: {
      officialMonthlyRowsAsc: [],
      monthlyRowsAscWithoutCrp: [],
      returnsSeriesView: {
        officialRows: [],
        estimatedRows: [],
        hasEstimatedMonth: false,
        pendingEstimate: null,
        pendingEstimateDetail: null,
        officialAvailabilityNotice: null,
      },
      monthlyRowsAsc: [],
      monthlyRowsDesc: [],
      wealthEvolutionModel: {
        source: 'returns_analysis_closures',
        baseMonth: null,
        missingFxMonths: [],
        missingUfMonths: [],
        suspiciousUfMonths: [],
        hasIncompleteConversion: false,
        points: [],
        clpSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
        ufSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
        usdSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
        eurSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
        ufTrendSeries: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
        base100Series: {
          CLP: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
          USD: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
          EUR: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
          UF: { status: 'empty', points: [], markers: [], domainMin: null, domainMax: null },
        },
      },
      crpContributionInsight: null,
      analysisDiagnostics: {
        eurScaleOutliers: [],
        invalidNetMonths: [],
        anomalyRaw: null,
        missingSpendMonths: [],
        fxExcludedMonths: [],
      },
      periodSummaries: [],
      yearlySummaries: [],
      heroSinceStart: null,
      heroLast12: null,
      heroYtd2026: null,
      heroLastMonth: null,
      heroLastMonthPctMonthly: null,
      heroLastMonthPctMonthlyReal: null,
      wealthLabModel: { status: 'empty' },
      financialFreedomBase: { status: 'missing', sourceMonthKey: null, patrimonioBaseClp: null },
    },
  })),
}));

vi.mock('../src/services/gastosMonthly', () => ({
  GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT: 'gastapp-source-updated',
  getGastappMonthlyRuntimeDiagnostic: () => ({
    status: 'idle',
    mode: 'unconfigured',
    error: null,
    errorCode: null,
    docsLoaded: 0,
    lastUpdatedAt: null,
  }),
  warmGastappMonthlyContable: vi.fn(async () => undefined),
}));

vi.mock('../src/services/dataRoom/gastappAccessGuidance', () => ({
  describeGastappAnalysisAccessIssue: () => null,
  describeGastappZipExportStatus: () => 'ok',
}));

vi.mock('../src/services/dataRoom/exportDataRoomZip', () => ({
  exportFinancialDataRoomWithTransactionsZip: vi.fn(),
  exportFinancialDataRoomZip: vi.fn(),
}));

import { AnalysisAurum } from '../src/pages/AnalysisAurum';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AnalysisAurum returns toolbar', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('keeps the update strip compact while still showing time and action', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(MemoryRouter, null, React.createElement(AnalysisAurum)),
      );
    });

    expect(container.textContent).toMatch(/Act\.\s\d{2}:\d{2}/);
    expect(container.textContent).toContain('Actualizar');
    expect(container.textContent).not.toContain('Última actualización:');
  });
});
