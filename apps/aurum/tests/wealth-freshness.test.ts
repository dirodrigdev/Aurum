import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BALANCE_CLP_LABEL,
  BANK_BCHILE_CLP_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  TENENCIA_CXC_PREFIX_LABEL,
  type WealthBlock,
  type WealthCurrency,
  type WealthFxRates,
  type WealthRecord,
} from '../src/services/wealthStorage';
import { buildWealthFreshnessModel } from '../src/services/wealthFreshness';

const fx: WealthFxRates = { usdClp: 950, eurClp: 1030, ufClp: 39000 };
const now = new Date('2026-04-30T12:00:00Z');

const record = ({
  id,
  block = 'investment',
  label,
  amount,
  currency = 'CLP',
  createdAt,
  snapshotDate = '2026-04-30',
  source = 'manual',
  note,
  updatedAt,
  refreshedAt,
  confirmedAt,
}: {
  id: string;
  block?: WealthBlock;
  label: string;
  amount: number;
  currency?: WealthCurrency;
  createdAt: string;
  snapshotDate?: string;
  source?: string;
  note?: string;
  updatedAt?: string;
  refreshedAt?: string;
  confirmedAt?: string;
}): WealthRecord => ({
  id,
  block,
  source,
  label,
  amount,
  currency,
  snapshotDate,
  createdAt,
  ...(note ? { note } : {}),
  ...(updatedAt ? { updatedAt } : {}),
  ...(refreshedAt ? { refreshedAt } : {}),
  ...(confirmedAt ? { confirmedAt } : {}),
});

describe('wealth freshness model', () => {
  it('cuadra porcentajes con componentes fresh, aging, stale y unknown', () => {
    const model = buildWealthFreshnessModel(
      [
        record({ id: 'fresh-investment', label: 'BTG total valorización', amount: 100, createdAt: '2026-04-30T09:00:00Z' }),
        record({ id: 'fresh-bank', block: 'bank', label: BANK_BCHILE_CLP_LABEL, amount: 50, createdAt: '2026-04-30T09:00:00Z' }),
        record({ id: 'fresh-mortgage', block: 'debt', label: MORTGAGE_DEBT_BALANCE_LABEL, amount: 25, createdAt: '2026-04-30T09:00:00Z' }),
        record({ id: 'fresh-card', block: 'debt', label: DEBT_CARD_CLP_LABEL, amount: -25, createdAt: '2026-04-30T09:00:00Z' }),
        record({ id: 'aging', label: 'SURA inversión financiera', amount: 100, createdAt: '2026-04-20T09:00:00Z' }),
        record({ id: 'stale', label: 'PlanVital saldo total', amount: 100, createdAt: '2026-03-01T09:00:00Z' }),
        record({ id: 'unknown', label: 'Global66 Cuenta Vista USD', amount: 100, createdAt: '', snapshotDate: '' }),
      ],
      fx,
      { includeRiskCapitalInTotals: false, now },
    );

    expect(model.status).toBe('ok');
    expect(model.totalExposureClp).toBe(500);
    expect(model.fresh7dPct).toBeCloseTo(0.4, 8);
    expect(model.aging30dPct).toBeCloseTo(0.2, 8);
    expect(model.stalePct).toBeCloseTo(0.4, 8);
    expect(model.components.filter((item) => item.bucket === 'fresh').reduce((sum, item) => sum + item.weightPct, 0)).toBeCloseTo(model.fresh7dPct || 0, 8);
    expect(model.laggards.some((item) => item.bucket === 'fresh')).toBe(false);
    expect(model.components.find((item) => item.label === DEBT_CARD_CLP_LABEL)?.isDebt).toBe(true);
    expect(model.components.find((item) => item.label === DEBT_CARD_CLP_LABEL)?.amountClp).toBe(25);
  });

  it('evita doble conteo entre saldo bancario agregado y cuentas proveedor', () => {
    const model = buildWealthFreshnessModel(
      [
        record({ id: 'bank-aggregate', block: 'bank', label: BANK_BALANCE_CLP_LABEL, amount: 100, createdAt: '2026-04-30T09:00:00Z' }),
        record({ id: 'bank-bchile', block: 'bank', label: BANK_BCHILE_CLP_LABEL, amount: 40, createdAt: '2026-04-30T09:00:00Z' }),
        record({ id: 'bank-scotia', block: 'bank', label: BANK_SCOTIA_CLP_LABEL, amount: 60, createdAt: '2026-04-30T09:00:00Z' }),
      ],
      fx,
      { includeRiskCapitalInTotals: false, now },
    );

    expect(model.totalExposureClp).toBe(100);
    expect(model.components.map((item) => item.label).sort()).toEqual([BANK_BCHILE_CLP_LABEL, BANK_SCOTIA_CLP_LABEL].sort());
  });


  it('mantiene stale un record sólo arrastrado, aunque haya sido copiado este mes', () => {
    const model = buildWealthFreshnessModel(
      [
        record({
          id: 'carried-tenencia-usd',
          label: `${TENENCIA_CXC_PREFIX_LABEL} USD`,
          amount: 1_000,
          currency: 'USD',
          source: 'Imagen',
          snapshotDate: '2026-04-30',
          createdAt: '2026-04-29T18:17:00Z',
          note: 'Mes anterior: cierre 2026-03',
        }),
      ],
      fx,
      { includeRiskCapitalInTotals: false, now: new Date('2026-05-10T12:00:00Z') },
    );

    expect(model.components[0].bucket).toBe('stale');
    expect(model.laggards[0].label).toBe(`${TENENCIA_CXC_PREFIX_LABEL} USD`);
  });

  it('usa updatedAt/refreshedAt/confirmedAt para records tocados y los saca de laggards', () => {
    const model = buildWealthFreshnessModel(
      [
        record({
          id: 'updated-tenencia-usd',
          label: `${TENENCIA_CXC_PREFIX_LABEL} USD`,
          amount: 1_000,
          currency: 'USD',
          source: 'Imagen',
          snapshotDate: '2026-04-30',
          createdAt: '2026-04-01T10:00:00Z',
          updatedAt: '2026-04-29T18:17:00Z',
          note: 'Mes anterior: cierre 2026-03',
        }),
      ],
      fx,
      { includeRiskCapitalInTotals: false, now },
    );

    expect(model.components[0].bucket).toBe('fresh');
    expect(model.components[0].daysOld).toBe(0);
    expect(model.laggards).toHaveLength(0);
  });

  it('dedupe elige el record con updatedAt más reciente para el mismo asset', () => {
    const model = buildWealthFreshnessModel(
      [
        record({
          id: 'old-tenencia-usd',
          label: `${TENENCIA_CXC_PREFIX_LABEL} USD`,
          amount: 1_000,
          currency: 'USD',
          source: 'Imagen',
          createdAt: '2026-04-01T10:00:00Z',
        }),
        record({
          id: 'new-tenencia-usd',
          label: `${TENENCIA_CXC_PREFIX_LABEL} USD`,
          amount: 2_000,
          currency: 'USD',
          source: 'Imagen',
          createdAt: '2026-04-01T09:00:00Z',
          updatedAt: '2026-04-29T18:17:00Z',
        }),
      ],
      fx,
      { includeRiskCapitalInTotals: false, now },
    );

    expect(model.components).toHaveLength(1);
    expect(model.components[0].recordIds).toEqual(['new-tenencia-usd']);
    expect(model.components[0].amountClp).toBe(1_900_000);
    expect(model.components[0].bucket).toBe('fresh');
  });

  it('excluye o incluye CapRiesgo según el toggle global', () => {
    const records = [
      record({ id: 'core', label: 'BTG total valorización', amount: 100, createdAt: '2026-04-30T09:00:00Z' }),
      record({ id: 'risk', label: RISK_CAPITAL_LABEL_CLP, amount: 100, createdAt: '2026-03-01T09:00:00Z' }),
    ];

    const excluded = buildWealthFreshnessModel(records, fx, { includeRiskCapitalInTotals: false, now });
    const included = buildWealthFreshnessModel(records, fx, { includeRiskCapitalInTotals: true, now });

    expect(excluded.totalExposureClp).toBe(100);
    expect(excluded.riskCapitalExcluded).toBe(true);
    expect(excluded.components.some((item) => item.isRiskCapital)).toBe(false);
    expect(included.totalExposureClp).toBe(200);
    expect(included.riskCapitalIncluded).toBe(true);
    expect(included.components.some((item) => item.isRiskCapital)).toBe(true);
    expect(included.stalePct).toBeCloseTo(0.5, 8);
  });
});
