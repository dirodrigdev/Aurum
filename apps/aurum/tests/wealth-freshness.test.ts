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
}: {
  id: string;
  block?: WealthBlock;
  label: string;
  amount: number;
  currency?: WealthCurrency;
  createdAt: string;
  snapshotDate?: string;
  source?: string;
}): WealthRecord => ({
  id,
  block,
  source,
  label,
  amount,
  currency,
  snapshotDate,
  createdAt,
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
