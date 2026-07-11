import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  auth: { currentUser: null },
  db: {},
}));

import { buildCanonicalClosureSummary, type WealthMonthlyClosure, type WealthRecord } from '../src/services/wealthStorage';
import {
  buildSanitizedClosureAudit,
  isClosureAuditAuthorizedUser,
  normalizeClosureAuditEmail,
  readAuthenticatedClosureAudit,
} from '../src/services/closureAuditDiagnostic';

const fx = { usdClp: 900, eurClp: 1000, ufClp: 40000 };

const records: WealthRecord[] = [
  {
    id: 'sensitive-id',
    block: 'bank',
    source: 'Banco privado',
    label: 'Cuenta secreta USD',
    amount: 1000,
    currency: 'USD',
    snapshotDate: '2026-05-31',
    createdAt: '2026-05-31T12:00:00.000Z',
    note: 'No exportar este comentario',
  },
  {
    id: 'mortgage-id',
    block: 'real_estate',
    source: 'Tasación',
    label: 'Valor propiedad',
    amount: 10000,
    currency: 'UF',
    snapshotDate: '2026-05-31',
    createdAt: '2026-05-31T12:00:00.000Z',
  },
  {
    id: 'debt-id',
    block: 'debt',
    source: 'Banco privado',
    label: 'Saldo deuda hipotecaria',
    amount: 5000,
    currency: 'UF',
    snapshotDate: '2026-05-31',
    createdAt: '2026-05-31T12:00:00.000Z',
  },
];

const closure = (monthKey: string): WealthMonthlyClosure => ({
  id: `closure-${monthKey}`,
  monthKey,
  closedAt: `${monthKey}-28T12:00:00.000Z`,
  fxRates: fx,
  summary: buildCanonicalClosureSummary(records, fx),
  records,
});

describe('closure audit diagnostic sanitization', () => {
  it('authorizes only the normalized temporary email', () => {
    expect(normalizeClosureAuditEmail('  DIEGORP.1978@GMAIL.COM ')).toBe('diegorp.1978@gmail.com');
    expect(isClosureAuditAuthorizedUser({ email: '  DIEGORP.1978@GMAIL.COM ' } as never)).toBe(true);
    expect(isClosureAuditAuthorizedUser({ email: 'other@example.com' } as never)).toBe(false);
  });

  it('blocks the read before Firestore when the current user is not authorized', async () => {
    const firebase = await import('../src/services/firebase');
    (firebase.auth as { currentUser: unknown }).currentUser = {
      uid: 'not-exported',
      email: 'other@example.com',
    };

    await expect(readAuthenticatedClosureAudit()).resolves.toEqual({ status: 'unauthorized' });
  });

  it('exports aggregate metadata only and reconciles detailed closures in memory', () => {
    const audit = buildSanitizedClosureAudit([closure('2026-04'), closure('2026-05')]);
    const entry = audit.closures[0];
    const serialized = JSON.stringify(audit);

    expect(audit.source).toBe('aurum_wealth/authenticated-user');
    expect(entry.classification).toBe('EXACT_POSITION_SNAPSHOT');
    expect(entry.nativeCurrencies).toEqual(['USD', 'UF']);
    expect(entry.nativeLiabilityCurrencies).toEqual(['UF']);
    expect(entry.reconciliation.withoutRisk.status).toBe('EXACT');
    expect(entry.reconciliation.withRisk.status).toBe('EXACT');
    expect(audit.horizons['1M']).toMatchObject({
      initialMonthKey: '2026-04',
      finalMonthKey: '2026-05',
      withoutRisk: 'available',
      withRisk: 'available',
    });
    expect(serialized).not.toContain('Cuenta secreta USD');
    expect(serialized).not.toContain('Banco privado');
    expect(serialized).not.toContain('sensitive-id');
    expect(serialized).not.toContain('No exportar este comentario');
  });

  it('keeps summary-only closures unavailable for detailed endpoint horizons', () => {
    const summaryOnly = closure('2025-05');
    delete summaryOnly.records;
    const audit = buildSanitizedClosureAudit([summaryOnly, closure('2026-05')]);

    expect(audit.closures.find((item) => item.monthKey === '2025-05')?.summaryOnly).toBe(true);
    expect(audit.horizons['12M'].withoutRisk).toBe('unavailable');
  });
});
