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
    usdClp = 900,
    eurClp = 1000,
    records = true,
  }: {
    netClp: number;
    netClpWithRisk?: number;
    investmentUsd?: number;
    bankUsd?: number;
    usdClp?: number;
    eurClp?: number;
    records?: boolean;
  },
): TestClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59-03:00`,
  summary: makeSummary({ netClp, netClpWithRisk, investmentUsd, bankUsd }),
  fxRates: { usdClp, eurClp, ufClp: 38000 },
  records: records
    ? [
        {
          id: `${monthKey}-investment-usd`,
          block: 'investment',
          source: 'test',
          label: 'Global66 Cuenta Vista USD',
          amount: Math.max(0, investmentUsd - 1000),
          currency: 'USD',
          snapshotDate: `${monthKey}-28`,
          createdAt: `${monthKey}-28T10:00:00Z`,
        },
        {
          id: `${monthKey}-risk-usd`,
          block: 'investment',
          source: 'test',
          label: 'Capital de riesgo USD',
          amount: investmentUsd > 0 ? 1000 : 0,
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

  it('marca insuficiencia de detalle USD si el histórico no conserva desglose', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const model = buildWealthLabModel(
      [
        makeClosure('2025-11', { netClp: 90_000_000, records: false }),
        makeClosure('2025-12', { netClp: 95_000_000, records: false }),
      ] as never,
      false,
    );

    expect(model.status).toBe('insufficient_fx_detail');
    expect(model.chartPoints).toHaveLength(0);
    expect(model.notes.some((note) => note.includes('no conservan desglose USD suficiente'))).toBe(true);
  });

  it('usa netClpWithRisk si el modo con CapRiesgo está activo', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const withoutRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000 }),
        makeClosure('2026-02', { netClp: 102_000_000, netClpWithRisk: 130_000_000, investmentUsd: 10_500 }),
      ] as never,
      false,
    );
    const withRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000 }),
        makeClosure('2026-02', { netClp: 102_000_000, netClpWithRisk: 130_000_000, investmentUsd: 10_500 }),
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

  it('no arrastra un único delta FX como si representara Desde inicio o Últ. 12M', async () => {
    const { buildWealthLabModel, selectWealthLabPeriod } = await import('../src/services/wealthLab');
    const model = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, investmentUsd: 10_000, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 110_000_000, investmentUsd: 10_500, usdClp: 1000 }),
      ] as never,
      false,
    );

    const sinceStart = selectWealthLabPeriod(model, 'since_start');
    const last12m = selectWealthLabPeriod(model, 'last_12m');
    const lastMonth = selectWealthLabPeriod(model, 'last_month');

    expect(sinceStart.cumulativeMetrics?.resultadoSinFx.valueClp).toBeNull();
    expect(last12m.cumulativeMetrics?.aporteFx.valueClp).toBeNull();
    expect(lastMonth.monthlyMetrics?.resultadoSinFx.valueClp).not.toBeNull();
  });

  it('cambia usdBlocks y aporte FX cuando CapRiesgo USD entra o sale del modo global', async () => {
    const { buildWealthLabModel } = await import('../src/services/wealthLab');
    const withoutRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 104_000_000, netClpWithRisk: 130_000_000, investmentUsd: 12_000, usdClp: 1000 }),
      ] as never,
      false,
    );
    const withRisk = buildWealthLabModel(
      [
        makeClosure('2026-01', { netClp: 100_000_000, netClpWithRisk: 120_000_000, investmentUsd: 10_000, usdClp: 900 }),
        makeClosure('2026-02', { netClp: 104_000_000, netClpWithRisk: 130_000_000, investmentUsd: 12_000, usdClp: 1000 }),
      ] as never,
      true,
    );

    expect(withRisk.points[1].usdBlocks).toBeGreaterThan(withoutRisk.points[1].usdBlocks ?? 0);
    expect(withRisk.points[1].aportesFxClp).not.toBe(withoutRisk.points[1].aportesFxClp);
  });
});
