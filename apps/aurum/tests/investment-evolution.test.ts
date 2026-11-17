import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import {
  buildInvestmentEvolutionHistory,
  convertEvolutionAmount,
  DEFAULT_EVOLUTION_KEYS,
} from '../src/services/investmentEvolution';
import { buildCanonicalClosureSummary } from '../src/services/wealthStorage';
import type { WealthRecord, WealthMonthlyClosure, WealthFxRates } from '../src/services/wealthStorage';

const fx: WealthFxRates = { usdClp: 900, eurClp: 1000, ufClp: 40000 };

const record = (
  label: string,
  amount: number,
  currency: WealthRecord['currency'],
  monthKey: string,
  block: WealthRecord['block'] = 'investment',
): WealthRecord => ({
  id: label + monthKey,
  block,
  source: 'Test',
  label,
  amount,
  currency,
  snapshotDate: monthKey + '-28',
  createdAt: monthKey + '-28T12:00:00Z',
});

const closure = (monthKey: string, records: WealthRecord[]): WealthMonthlyClosure => ({
  id: monthKey,
  monthKey,
  closedAt: monthKey + '-31T12:00:00Z',
  records,
  fxRates: fx,
  summary: buildCanonicalClosureSummary(records, fx),
});

describe('Evolución de inversiones', () => {
  const octRecords = [
    record('SURA inversión financiera', 600_000_000, 'CLP', '2026-10'),
    record('SURA ahorro previsional', 300_000_000, 'CLP', '2026-10'),
    record('BTG total valorización', 280_000_000, 'CLP', '2026-10'),
    record('Global66 Cuenta Vista USD', 100_000, 'USD', '2026-10'),
    record('Valor propiedad', 15000, 'UF', '2026-10', 'real_estate'),
    record('Saldo deuda hipotecaria', 9000, 'UF', '2026-10', 'debt'),
  ];

  it('shows exactly the five principal series by default', () => {
    expect(DEFAULT_EVOLUTION_KEYS).toEqual(['sura', 'btg', 'planvital', 'property', 'global66']);
  });

  it('derives SURA total and other assets from source records without persisting changes', () => {
    const source = closure('2026-10', octRecords);
    const before = JSON.stringify(source);
    const rows = buildInvestmentEvolutionHistory([source], [], fx, new Date(2026, 10, 17));
    expect(rows).toHaveLength(1);
    expect(rows[0].amountsClp.sura).toBe(900_000_000);
    expect(rows[0].amountsClp['sura-fin']).toBe(600_000_000);
    expect(rows[0].amountsClp.btg).toBe(280_000_000);
    expect(rows[0].amountsClp.global66).toBe(90_000_000);
    expect(rows[0].amountsClp.property).toBe(240_000_000);
    expect(rows[0].provisional).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('never invents a named investment from an aggregate-only historical closure', () => {
    const summary = closure('2026-10', octRecords).summary;
    const legacy: WealthMonthlyClosure = {
      id: '2025-12',
      monthKey: '2025-12',
      closedAt: '2026-01-03T12:00:00Z',
      summary,
      fxRates: fx,
    };
    const rows = buildInvestmentEvolutionHistory([legacy], [], fx, new Date(2026, 10, 17));
    expect(rows[0].amountsClp.sura).toBeNull();
    expect(rows[0].amountsClp.btg).toBeNull();
    expect(rows[0].amountsClp.investments).not.toBeNull();
    expect(rows[0].amountsClp.net).not.toBeNull();
  });

  it('includes the provisional month only from live records, and hides incomplete totals', () => {
    const live = [
      record('SURA inversión financiera', 590_000_000, 'CLP', '2026-11'),
      record('SURA ahorro previsional', 300_000_000, 'CLP', '2026-11'),
    ];
    const rows = buildInvestmentEvolutionHistory(
      [closure('2026-10', octRecords)], live, fx, new Date(2026, 10, 17),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].provisional).toBe(true);
    expect(rows[1].amountsClp.sura).toBe(890_000_000);
    expect(rows[1].amountsClp.net).toBeNull();
    expect(rows[1].amountsClp.investments).toBeNull();
  });

  it('shows a provisional total when all previous asset keys are present', () => {
    const live = octRecords.map((item) => ({
      ...item,
      snapshotDate: '2026-11-30',
      createdAt: '2026-11-16T11:00:00Z',
    }));
    const rows = buildInvestmentEvolutionHistory(
      [closure('2026-10', octRecords)], live, fx, new Date(2026, 10, 17),
    );
    expect(rows[1].amountsClp.net).not.toBeNull();
    expect(rows[1].amountsClp.investments).not.toBeNull();
  });

  it('converts each historical value using its own closing exchange rate', () => {
    expect(convertEvolutionAmount(90_000, 'USD', fx)).toBe(100);
    expect(convertEvolutionAmount(90_000, 'EUR', fx)).toBe(90);
    expect(convertEvolutionAmount(90_000, 'UF', fx)).toBe(2.25);
    expect(convertEvolutionAmount(90_000, 'USD', null)).toBeNull();
  });
});
