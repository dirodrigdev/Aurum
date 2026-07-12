import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { buildCanonicalClosureSummary } from '../src/services/wealthStorage';
import {
  applyCorrectionToRoot,
  assertAuthorizedIdentity,
  buildHistoricalPreview,
  calculateHistoricalClosureSummary,
  createBackupPackage,
  decodeFirestoreValue,
  encodeFirestoreValue,
  fingerprintValue,
  historicalConfirmationText,
  joinBackupPayload,
  restoreClosureInRoot,
} from '../api/admin/_historicalClosureCore.js';

const fx = { usdClp: 891, eurClp: 1038, ufClp: 40628 };
const proposedFx = { usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 };
const record = (input: Record<string, unknown>) => ({
  id: String(input.id),
  source: 'Manual',
  snapshotDate: '2026-06-30',
  createdAt: '2026-06-30T23:00:00.000Z',
  ...input,
});

const records = [
  record({ id: 'investment-clp', block: 'investment', label: 'BTG total valorización', currency: 'CLP', amount: 500_000_000 }),
  record({ id: 'investment-usd', block: 'investment', label: 'Wise Cuenta principal USD', currency: 'USD', amount: 120_000 }),
  record({ id: 'risk-clp', block: 'investment', label: 'Capital de riesgo CLP', currency: 'CLP', amount: 20_000_000 }),
  record({ id: 'risk-usd', block: 'investment', label: 'Capital de riesgo USD', currency: 'USD', amount: 10_000 }),
  record({ id: 'property', block: 'real_estate', label: 'Valor propiedad', currency: 'UF', amount: 12_000 }),
  record({ id: 'mortgage', block: 'debt', label: 'Saldo deuda hipotecaria', currency: 'UF', amount: 4_000 }),
  record({ id: 'bank-clp', block: 'bank', source: 'Fintoc', label: 'Banco de Chile CLP', currency: 'CLP', amount: 80_000_000 }),
  record({ id: 'bank-usd', block: 'bank', source: 'Fintoc', label: 'Banco de Chile USD', currency: 'USD', amount: 25_000 }),
  record({ id: 'bank-legacy', block: 'bank', label: 'Saldo bancos USD', currency: 'USD', amount: 4_500, legacyDebtAggregate: true }),
  record({ id: 'card-detail', block: 'debt', label: 'Mastercard Santander', currency: 'CLP', amount: 12_000_000 }),
  record({ id: 'card-legacy', block: 'debt', label: 'Deuda tarjetas CLP', currency: 'CLP', amount: 90_000_000, nestedUnknownMetadata: { keep: true } }),
];

const closure = {
  id: 'closure-june',
  monthKey: '2026-06',
  closedAt: '2026-06-30T23:59:59.000Z',
  records,
  fxRates: fx,
  summary: buildCanonicalClosureSummary(records as never[], fx),
  unknownFutureField: { preserved: true },
  legacyDebtAggregate: { amount: 90_000_000 },
};

const rootData = {
  updatedAt: '2026-07-11T10:00:00.000Z',
  records: [{ id: 'live-july', amount: 999 }],
  fx,
  unknownRootField: { keep: 'yes' },
  closures: [
    { id: 'other', monthKey: '2026-05', closedAt: '2026-05-31T23:59:59.000Z', records: [], summary: { netClp: 1 }, fxRates: fx },
    closure,
  ],
};

const identity = { uid: 'test-user', email: 'diegorp.1978@gmail.com', emailVerified: true };

describe('historical closure correction core', () => {
  it('authorizes only the verified administrative Firebase identity', () => {
    expect(assertAuthorizedIdentity(identity, 'test-user')).toEqual({ uid: 'test-user', email: identity.email });
    expect(() => assertAuthorizedIdentity({ ...identity, email: 'other@example.com' })).toThrow('no autorizada');
    expect(() => assertAuthorizedIdentity({ ...identity, emailVerified: false })).toThrow('no autorizada');
    expect(() => assertAuthorizedIdentity(identity, 'other-user')).toThrow('UID');
    expect(() => assertAuthorizedIdentity(null)).toThrow('no autenticado');
  });

  it('creates deterministic fingerprints including unknown fields and Firestore types', () => {
    const one = { z: 1, a: { seconds: 10, nanoseconds: 20 }, unknownFutureField: { value: 7 } };
    const two = { unknownFutureField: { value: 7 }, a: { nanoseconds: 20, seconds: 10 }, z: 1 };
    expect(fingerprintValue(one)).toBe(fingerprintValue(two));
    expect(fingerprintValue(one)).not.toBe(fingerprintValue({ ...two, unknownFutureField: { value: 8 } }));
  });

  it('serializes Firestore-like values explicitly and reversibly', () => {
    const encoded = encodeFirestoreValue({
      timestamp: { seconds: 10, nanoseconds: 20 },
      date: new Date('2026-06-30T00:00:00.000Z'),
      reference: { path: 'x/y', firestore: {} },
      geo: { latitude: -33.4, longitude: -70.6 },
      bytes: Buffer.from('aurum'),
    });
    const decoded = decodeFirestoreValue(encoded, {
      timestamp: (seconds: number, nanoseconds: number) => ({ seconds, nanoseconds }),
      documentReference: (path: string) => ({ path, restored: true }),
      geoPoint: (latitude: number, longitude: number) => ({ latitude, longitude }),
    });
    expect(decoded.timestamp).toEqual({ seconds: 10, nanoseconds: 20 });
    expect(decoded.date).toEqual(new Date('2026-06-30T00:00:00.000Z'));
    expect(decoded.reference).toEqual({ path: 'x/y', restored: true });
    expect(Buffer.from(decoded.bytes).toString()).toBe('aurum');
  });

  it('matches the canonical frontend summary and excludes competing legacy aggregates', () => {
    const server = calculateHistoricalClosureSummary(records, fx);
    const canonical = buildCanonicalClosureSummary(records as never[], fx);
    expect(server.netClp).toBeCloseTo(Number(canonical.netClp), 6);
    expect(server.netClpWithRisk).toBeCloseTo(Number(canonical.netClpWithRisk), 6);
    expect(server.bankClp).toBeCloseTo(Number(canonical.bankClp), 6);
    expect(server.nonMortgageDebtClp).toBeCloseTo(Number(canonical.nonMortgageDebtClp), 6);
    expect(server.riskCapitalClp).toBeCloseTo(Number(canonical.riskCapitalClp), 6);
  });

  it('builds a pure preview for May/June fixtures without writing or mutating records', () => {
    const original = structuredClone(closure);
    const preview = buildHistoricalPreview(closure, proposedFx);
    expect(preview.monthKey).toBe('2026-06');
    expect(preview.recordCount).toBe(records.length);
    expect(preview.reconciliation).toEqual({ beforeWithoutRisk: true, beforeWithRisk: true, after: true });
    expect(preview.withoutRisk.after).not.toBe(preview.withoutRisk.before);
    expect(preview.exposureNetByCurrency.USD).toBeGreaterThan(0);
    expect(closure).toEqual(original);
    expect(() => buildHistoricalPreview({ ...closure, monthKey: '2026-05', records: [] }, proposedFx)).toThrow('records detallados');
  });

  it('creates a complete chunked backup preserving root, closure, unknown and legacy fields', () => {
    const backup = createBackupPackage({
      rootData,
      rawClosure: closure,
      identity,
      monthKey: '2026-06',
      reason: 'Corrección FX histórica',
      rootUpdateTime: '2026-07-11T10:00:00.000Z',
      operationId: 'operation-1',
    });
    const restored = joinBackupPayload(backup.chunks);
    expect(restored.rootDocument).toEqual(rootData);
    expect(restored.closure.unknownFutureField).toEqual({ preserved: true });
    expect(restored.closure.legacyDebtAggregate).toEqual({ amount: 90_000_000 });
    expect(backup.manifest.closureFingerprint).toBe(fingerprintValue(closure));
    expect(backup.checkpoint.backupId).toBe(backup.backupId);
    expect(backup.checkpoint.backupChunkCount).toBe(backup.chunks.length);
  });

  it('applies only the target closure, preserves records/unknown fields and records audit', () => {
    const expectedFingerprint = fingerprintValue(closure);
    const result = applyCorrectionToRoot({
      rootData,
      monthKey: '2026-06',
      expectedFingerprint,
      proposedFxRates: proposedFx,
      suggestedFxRates: proposedFx,
      reason: 'Corrección de fecha económica',
      identity,
      backupId: 'backup-1',
      checkpointId: 'checkpoint-1',
      operationId: 'apply-1',
    });
    expect(result.nextRootData.records).toEqual(rootData.records);
    expect(result.nextRootData.fx).toEqual(rootData.fx);
    expect(result.nextRootData.unknownRootField).toEqual(rootData.unknownRootField);
    expect(result.nextRootData.closures[0]).toBe(rootData.closures[0]);
    expect(result.nextClosure.records).toEqual(closure.records);
    expect(result.nextClosure.unknownFutureField).toEqual(closure.unknownFutureField);
    expect(result.nextClosure.legacyDebtAggregate).toEqual(closure.legacyDebtAggregate);
    expect(result.nextClosure.fxRates).toEqual(proposedFx);
    expect(result.nextClosure.summary.netClp).toBe(result.preview.withoutRisk.after);
    expect(result.nextClosure.historicalFxCorrectionAudit).toHaveLength(1);
    expect(() => applyCorrectionToRoot({
      rootData,
      monthKey: '2026-06',
      expectedFingerprint: 'stale',
      proposedFxRates: proposedFx,
      reason: 'x', identity, backupId: 'b', checkpointId: 'c',
    })).toThrow('cambió');
  });

  it('restores only the target closure from an integrity-checked checkpoint', () => {
    const applied = applyCorrectionToRoot({
      rootData, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure),
      proposedFxRates: proposedFx, reason: 'Corrección', identity, backupId: 'backup-1', checkpointId: 'checkpoint-1',
    });
    const checkpoint = {
      checkpointId: 'checkpoint-1', monthKey: '2026-06', rawClosure: closure,
      closureFingerprint: fingerprintValue(closure),
    };
    const rollback = restoreClosureInRoot({
      rootData: applied.nextRootData,
      monthKey: '2026-06',
      expectedFingerprint: fingerprintValue(applied.nextClosure),
      checkpoint,
      identity,
      reason: 'Rollback validado',
    });
    expect(rollback.restoredClosure).toEqual(closure);
    expect(rollback.nextRootData.records).toEqual(rootData.records);
    expect(rollback.nextRootData.closures[0]).toBe(rootData.closures[0]);
    expect(() => restoreClosureInRoot({
      rootData: applied.nextRootData, monthKey: '2026-06', expectedFingerprint: fingerprintValue(applied.nextClosure),
      checkpoint: { ...checkpoint, closureFingerprint: 'bad' }, identity, reason: 'x',
    })).toThrow('integridad');
  });

  it('requires exact independent confirmation text for apply and rollback', () => {
    expect(historicalConfirmationText('2026-05')).toBe('CONFIRMO MAYO');
    expect(historicalConfirmationText('2026-06', 'rollback')).toBe('RESTAURAR JUNIO');
  });
});
