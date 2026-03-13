import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/wealthStorage', () => ({
  currentMonthKey: () => '2026-04',
  defaultFxRates: { usdClp: 900, eurClp: 1000, ufClp: 38000 },
  isRiskCapitalInvestmentLabel: (label: string) => label === 'Capital de riesgo USD' || label === 'Capital de riesgo CLP',
}));

type TestSummary = {
  netByCurrency: { CLP: number; USD: number; EUR: number; UF: number };
  assetsByCurrency: { CLP: number; USD: number; EUR: number; UF: number };
  debtsByCurrency: { CLP: number; USD: number; EUR: number; UF: number };
  netConsolidatedClp: number;
  byBlock: {
    bank: { CLP: number; USD: number; EUR: number; UF: number };
    investment: { CLP: number; USD: number; EUR: number; UF: number };
    real_estate: { CLP: number; USD: number; EUR: number; UF: number };
    debt: { CLP: number; USD: number; EUR: number; UF: number };
  };
  investmentClp?: number;
  riskCapitalClp?: number;
  investmentClpWithRisk?: number;
  netClp?: number;
  netClpWithRisk?: number;
};

type TestClosure = {
  id: string;
  monthKey: string;
  closedAt: string;
  summary: TestSummary;
  fxRates: { usdClp: number; eurClp: number; ufClp: number };
  records?: Array<{
    id: string;
    block: string;
    source: string;
    label: string;
    amount: number;
    currency: string;
    snapshotDate: string;
    createdAt: string;
  }>;
};

const makeSummary = ({
  netClp,
  netClpWithRisk,
  investmentUsd = 0,
  bankUsd = 0,
  riskUsd = 0,
}: {
  netClp: number;
  netClpWithRisk?: number;
  investmentUsd?: number;
  bankUsd?: number;
}): TestSummary => ({
  netByCurrency: { CLP: netClp, USD: investmentUsd + bankUsd, EUR: 0, UF: 0 },
  assetsByCurrency: { CLP: netClp, USD: investmentUsd + bankUsd, EUR: 0, UF: 0 },
  debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
  netConsolidatedClp: netClpWithRisk ?? netClp,
  byBlock: {
    bank: { CLP: 0, USD: bankUsd, EUR: 0, UF: 0 },
    investment: { CLP: netClp, USD: investmentUsd, EUR: 0, UF: 0 },
    real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
  },
  investmentClp: netClp,
  riskCapitalClp: 0,
  investmentClpWithRisk: netClpWithRisk ?? netClp,
  netClp,
  netClpWithRisk: netClpWithRisk ?? netClp,
});

const makeClosure = (
  monthKey: string,
  {
    netClp,
    netClpWithRisk,
    investmentUsd = 0,
    bankUsd = 0,
    riskUsd = 1000,
    usdClp = 900,
    eurClp = 1000,
    records = true,
    includeAnalysis = true,
  }: {
    netClp: number;
    netClpWithRisk?: number;
    investmentUsd?: number;
    bankUsd?: number;
    riskUsd?: number;
    usdClp?: number;
    eurClp?: number;
    records?: boolean;
    includeAnalysis?: boolean;
  },
): TestClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59-03:00`,
  summary: {
    ...makeSummary({ netClp, netClpWithRisk, investmentUsd, bankUsd }),
    ...(includeAnalysis
      ? {
          analysisByCurrency: {
            clpWithoutRisk: netClp - Math.max(0, investmentUsd + bankUsd - riskUsd) * usdClp,
            usdWithoutRisk: Math.max(0, investmentUsd + bankUsd - riskUsd),
            clpWithRisk: (netClpWithRisk ?? netClp) - (investmentUsd + bankUsd) * usdClp,
            usdWithRisk: investmentUsd + bankUsd,
            source: 'records' as const,
          },
        }
      : {}),
  },
  fxRates: { usdClp, eurClp, ufClp: 38000 },
  records: records
    ? [
        {
          id: `${monthKey}-investment-usd`,
          block: 'investment',
          source: 'test',
          label: 'Global66 Cuenta Vista USD',
          amount: Math.max(0, investmentUsd - riskUsd),
          currency: 'USD',
          snapshotDate: `${monthKey}-28`,
          createdAt: `${monthKey}-28T10:00:00Z`,
        },
        {
          id: `${monthKey}-risk-usd`,
          block: 'investment',
          source: 'test',
          label: 'Capital de riesgo USD',
          amount: investmentUsd > 0 ? riskUsd : 0,
          currency: 'USD',
          snapshotDate: `${monthKey}-28`,
          createdAt: `${monthKey}-28T10:00:00Z`,
        },
      ].filter((record) => record.amount > 0)
    : undefined,
});

describe('wealthLab model', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('construye la serie con índices real y sin FX cuando hay exposición USD identificable', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const model = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, investmentUsd: 10_000, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 110_000_000, investmentUsd: 10_000, usdClp: 1000 }),
        makeClosure('2026-03', { netClp: 120_000_000, investmentUsd: 11_000, usdClp: 1000 }),
      ] as never,
      false,
    );

    expect(model.status).toBe('ok');
    expect(model.chartPoints.length).toBeGreaterThanOrEqual(2);
    expect(model.latestComparablePoint?.aportesFxClp).not.toBeNull();
    expect(model.monthlyMetrics?.resultadoSinFx.valueClp).not.toBeNull();
  });

  it('marca insuficiencia de detalle USD si el histórico no conserva serie CLP/USD suficiente', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const model = buildWealthLabModel(
      [
        makeClosure('2031-11', { netClp: 90_000_000, records: false, includeAnalysis: false }),
        makeClosure('2031-12', { netClp: 95_000_000, records: false, includeAnalysis: false }),
      ] as never,
      false,
    );

    expect(model.status).toBe('insufficient_fx_detail');
    expect(model.chartPoints).toHaveLength(0);
    expect(model.notes.some((note) => note.includes('base CLP/USD suficiente'))).toBe(true);
  });

  it('usa netClpWithRisk si el modo con CapRiesgo está activo', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const withoutRisk = buildWealthLabModel(
      [
        makeClosure('2032-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000 }),
        makeClosure('2032-02', { netClp: 102_000_000, netClpWithRisk: 130_000_000, investmentUsd: 10_500 }),
      ] as never,
      false,
    );
    const withRisk = buildWealthLabModel(
      [
        makeClosure('2032-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000 }),
        makeClosure('2032-02', { netClp: 102_000_000, netClpWithRisk: 130_000_000, investmentUsd: 10_500 }),
      ] as never,
      true,
    );

    expect(withRisk.points[1].netClp).toBe(130_000_000);
    expect(withoutRisk.points[1].netClp).toBe(102_000_000);
  });

  it('recorta correctamente el período seleccionado para que Desde inicio y Últ. 12M no usen siempre los mismos meses', async () => {
    const { buildWealthLabModel, selectWealthLabPeriod } = await import('../src/services/wealthLab');
    const closures = Array.from({ length: 14 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      return makeClosure(`2025-${month}`, {
        netClp: 100_000_000 + index * 1_000_000,
        investmentUsd: 10_000 + index * 100,
        usdClp: 900 + index,
      });
    });
    const model = buildWealthLabModel(closures as never, false);
    const sinceStart = selectWealthLabPeriod(model, 'since_start');
    const last12m = selectWealthLabPeriod(model, 'last_12m');

    expect(sinceStart.cumulativeMetrics?.real.months).toBeGreaterThan(last12m.cumulativeMetrics?.real.months ?? 0);
    expect(last12m.cumulativeMetrics?.real.months).toBe(12);
  });

  it('no fabrica métricas sin FX cuando el tramo no conserva base CLP/USD suficiente', async () => {
    const { buildWealthLabModel, selectWealthLabPeriod } = await import('../src/services/wealthLab');
    const model = buildWealthLabModel(
      [
        makeClosure('2031-01', { netClp: 100_000_000, investmentUsd: 0, usdClp: 900, includeAnalysis: false, records: false }),
        makeClosure('2031-02', { netClp: 110_000_000, investmentUsd: 0, usdClp: 1000, includeAnalysis: false, records: false }),
      ] as never,
      false,
    );

    const sinceStart = selectWealthLabPeriod(model, 'since_start');
    const last12m = selectWealthLabPeriod(model, 'last_12m');
    const lastMonth = selectWealthLabPeriod(model, 'last_month');

    expect(sinceStart.cumulativeMetrics?.resultadoSinFx.valueClp).toBeNull();
    expect(last12m.cumulativeMetrics?.aporteFx.valueClp).toBeNull();
    expect(lastMonth.monthlyMetrics?.resultadoSinFx.valueClp).toBeNull();
  });

  it('cambia usdBlocks y aporte FX cuando CapRiesgo USD entra o sale del modo global', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const withoutRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000, riskUsd: 1_500, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 104_000_000, netClpWithRisk: 130_000_000, investmentUsd: 12_000, riskUsd: 1_500, usdClp: 1000 }),
      ] as never,
      false,
    );
    const withRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000, riskUsd: 1_500, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 104_000_000, netClpWithRisk: 130_000_000, investmentUsd: 12_000, riskUsd: 1_500, usdClp: 1000 }),
      ] as never,
      true,
    );

    expect(withRisk.points[1].usdBlocks).toBeGreaterThan(withoutRisk.points[1].usdBlocks ?? 0);
    expect(withRisk.points[1].aportesFxClp).not.toBe(withoutRisk.points[1].aportesFxClp);
  });

  it('usa la serie agregada CLP/USD para que Desde inicio, Últ. 12M y Últ. mes cambien de verdad', async () => {
    const { buildWealthLabModel, selectWealthLabPeriod } = await import('../src/services/wealthLab');
    const closures = Array.from({ length: 14 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const usdClp = 900 + index * 5;
      const usdWithoutRisk = 8_000 + index * 200;
      const usdWithRisk = usdWithoutRisk + 1_200;
      const clpWithoutRisk = 80_000_000 + index * 2_000_000;
      const clpWithRisk = clpWithoutRisk + 10_000_000 + index * 250_000;
      const netClp = clpWithoutRisk + usdWithoutRisk * usdClp;
      const netClpWithRisk = clpWithRisk + usdWithRisk * usdClp;
      return makeClosure(`2025-${month}`, {
        netClp,
        netClpWithRisk,
        investmentUsd: usdWithRisk,
        riskUsd: 1_200,
        usdClp,
        includeAnalysis: false,
        records: false,
      });
    }).map((closure, index) => ({
      ...closure,
      summary: {
        ...closure.summary,
        analysisByCurrency: {
          clpWithoutRisk: 80_000_000 + index * 2_000_000,
          usdWithoutRisk: 8_000 + index * 200,
          clpWithRisk: 90_000_000 + index * 2_250_000,
          usdWithRisk: 9_200 + index * 200,
          source: 'aggregated_csv' as const,
        },
      },
    }));

    const model = buildWealthLabModel(closures as never, false);
    const sinceStart = selectWealthLabPeriod(model, 'since_start');
    const last12m = selectWealthLabPeriod(model, 'last_12m');
    const lastMonth = selectWealthLabPeriod(model, 'last_month');

    expect(sinceStart.cumulativeMetrics?.resultadoSinFx.valueClp).not.toBeNull();
    expect(last12m.cumulativeMetrics?.resultadoSinFx.valueClp).not.toBeNull();
    expect(lastMonth.monthlyMetrics?.resultadoSinFx.valueClp).not.toBeNull();
    expect(sinceStart.cumulativeMetrics?.resultadoSinFx.valueClp).not.toBe(last12m.cumulativeMetrics?.resultadoSinFx.valueClp);
    expect(last12m.cumulativeMetrics?.resultadoSinFx.valueClp).not.toBe(lastMonth.monthlyMetrics?.resultadoSinFx.valueClp);
    expect(sinceStart.cumulativeMetrics?.aporteFx.valueClp).not.toBe(last12m.cumulativeMetrics?.aporteFx.valueClp);
  });

  it('alinea el header de Lab en base mensual equivalente usando el mismo corte temporal para real, sin FX y aporte FX', async () => {
    const { buildWealthLabModel, selectWealthLabPeriod } = await import('../src/services/wealthLab');
    const closures = Array.from({ length: 14 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const usdClp = 900 + index * 4;
      const usdWithoutRisk = 7_500 + index * 180;
      const usdWithRisk = usdWithoutRisk + 1_000;
      const clpWithoutRisk = 70_000_000 + index * 1_750_000;
      const clpWithRisk = clpWithoutRisk + 8_500_000 + index * 220_000;
      const netClp = clpWithoutRisk + usdWithoutRisk * usdClp;
      const netClpWithRisk = clpWithRisk + usdWithRisk * usdClp;
      return makeClosure(`2024-${month}`, {
        netClp,
        netClpWithRisk,
        investmentUsd: usdWithRisk,
        riskUsd: 1_000,
        usdClp,
        includeAnalysis: false,
        records: false,
      });
    }).map((closure, index) => ({
      ...closure,
      summary: {
        ...closure.summary,
        analysisByCurrency: {
          clpWithoutRisk: 70_000_000 + index * 1_750_000,
          usdWithoutRisk: 7_500 + index * 180,
          clpWithRisk: 78_500_000 + index * 1_970_000,
          usdWithRisk: 8_500 + index * 180,
          source: 'aggregated_csv' as const,
        },
      },
    }));

    const model = buildWealthLabModel(closures as never, false);
    const sinceStart = selectWealthLabPeriod(model, 'since_start');
    const last12m = selectWealthLabPeriod(model, 'last_12m');
    const lastMonth = selectWealthLabPeriod(model, 'last_month');

    expect(sinceStart.headlineMetrics?.real.months).toBe(13);
    expect(last12m.headlineMetrics?.real.months).toBe(12);
    expect(lastMonth.headlineMetrics?.real.months).toBe(1);
    expect(sinceStart.headlineMetrics?.real.monthlyEquivalentClp).not.toBe(last12m.headlineMetrics?.real.monthlyEquivalentClp);
    expect(last12m.headlineMetrics?.real.monthlyEquivalentClp).not.toBe(lastMonth.headlineMetrics?.real.monthlyEquivalentClp);
    expect(sinceStart.headlineMetrics?.resultadoSinFx.monthlyEquivalentClp).not.toBe(last12m.headlineMetrics?.resultadoSinFx.monthlyEquivalentClp);
    expect(last12m.headlineMetrics?.aporteFx.monthlyEquivalentClp).not.toBe(lastMonth.headlineMetrics?.aporteFx.monthlyEquivalentClp);
  });

  it('actualiza el promedio mensual equivalente y el aporte FX del header cuando cambia CapRiesgo', async () => {
    const { buildWealthLabModel, selectWealthLabPeriod } = await import('../src/services/wealthLab');
    const withoutRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 121_000_000, investmentUsd: 11_000, riskUsd: 1_500, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 106_000_000, netClpWithRisk: 133_000_000, investmentUsd: 12_500, riskUsd: 1_500, usdClp: 990 }),
      ] as never,
      false,
    );
    const withRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 121_000_000, investmentUsd: 11_000, riskUsd: 1_500, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 106_000_000, netClpWithRisk: 133_000_000, investmentUsd: 12_500, riskUsd: 1_500, usdClp: 990 }),
      ] as never,
      true,
    );

    const withoutRiskPeriod = selectWealthLabPeriod(withoutRisk, 'since_start');
    const withRiskPeriod = selectWealthLabPeriod(withRisk, 'since_start');

    expect(withRiskPeriod.headlineMetrics?.real.monthlyEquivalentClp).not.toBe(withoutRiskPeriod.headlineMetrics?.real.monthlyEquivalentClp);
    expect(withRiskPeriod.headlineMetrics?.aporteFx.monthlyEquivalentClp).not.toBe(withoutRiskPeriod.headlineMetrics?.aporteFx.monthlyEquivalentClp);
  });

  it('usa la serie externa local como fallback para cierres históricos ya guardados sin analysisByCurrency', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const model = buildWealthLabModel(
      [
        makeClosure('2025-01', { netClp: 1, records: false, includeAnalysis: false }),
        makeClosure('2025-02', { netClp: 1, records: false, includeAnalysis: false }),
      ] as never,
      false,
    );

    expect(model.points[0].usdExposureSource).toBe('external_series');
    expect(model.points[1].usdExposureSource).toBe('external_series');
    expect(model.points[1].aportesFxClp).not.toBeNull();
  });
});
