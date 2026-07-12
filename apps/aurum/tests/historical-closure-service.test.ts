import { describe, expect, it, vi } from 'vitest';

import {
  applyHistoricalCorrection,
  exportHistoricalBackup,
  prepareHistoricalCorrection,
  previewHistoricalCorrection,
  rollbackHistoricalCorrection,
} from '../api/admin/_historicalClosureService.js';
import {
  calculateHistoricalClosureSummary,
  fingerprintValue,
  historicalConfirmationText,
} from '../api/admin/_historicalClosureCore.js';

type Stored = Map<string, Record<string, unknown>>;

const clone = <T>(value: T): T => structuredClone(value);

class FakeSnapshot {
  exists: boolean;
  ref: FakeDocRef;
  updateTime: { toDate: () => Date };
  private value?: Record<string, unknown>;

  constructor(ref: FakeDocRef, value?: Record<string, unknown>) {
    this.ref = ref;
    this.exists = value !== undefined;
    this.value = value;
    this.updateTime = { toDate: () => new Date(ref.updateTimeMs()) };
  }

  data() {
    return this.value === undefined ? undefined : clone(this.value);
  }
}

class FakeQuery {
  constructor(private db: FakeFirestore, private prefix: string, private field?: string, private expected?: unknown, private max = Infinity) {}
  where(field: string, _operator: string, expected: unknown) { return new FakeQuery(this.db, this.prefix, field, expected, this.max); }
  limit(max: number) { return new FakeQuery(this.db, this.prefix, this.field, this.expected, max); }
  async get() {
    const docs = [...this.db.store.entries()]
      .filter(([path, value]) => path.startsWith(`${this.prefix}/`) && path.slice(this.prefix.length + 1).split('/').length === 1
        && (!this.field || value[this.field] === this.expected))
      .slice(0, this.max)
      .map(([path, value]) => new FakeSnapshot(new FakeDocRef(this.db, path), value));
    return { size: docs.length, docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(private firestore: FakeFirestore, private path: string) { super(firestore, path); }
  doc(id: string) { return new FakeDocRef(this.firestore, `${this.path}/${id}`); }
}

class FakeDocRef {
  constructor(private db: FakeFirestore, readonly path: string) {}
  collection(name: string) { return new FakeCollectionRef(this.db, `${this.path}/${name}`); }
  async get() { return new FakeSnapshot(this, this.db.store.get(this.path)); }
  updateTimeMs() { return this.db.updateTimeMs(this.path); }
}

class FakeTransaction {
  writes = new Map<string, Record<string, unknown>>();
  constructor(private db: FakeFirestore) {}
  async get(ref: FakeDocRef) { return new FakeSnapshot(ref, this.writes.get(ref.path) ?? this.db.store.get(ref.path)); }
  set(ref: FakeDocRef, value: Record<string, unknown>) { this.writes.set(ref.path, clone(value)); }
  update(ref: FakeDocRef, patch: Record<string, unknown>) {
    const current = this.writes.get(ref.path) ?? this.db.store.get(ref.path);
    if (!current) throw new Error(`missing document ${ref.path}`);
    this.writes.set(ref.path, { ...clone(current), ...clone(patch) });
  }
}

class FakeFirestore {
  store: Stored;
  private revisions = new Map<string, number>();
  beforeCommit?: () => void;
  constructor(seed: Stored) {
    this.store = new Map([...seed].map(([path, value]) => [path, clone(value)]));
    this.store.forEach((_value, path) => this.revisions.set(path, 1));
  }
  collection(name: string) { return new FakeCollectionRef(this, name); }
  doc(path: string) { return new FakeDocRef(this, path); }
  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    this.beforeCommit?.();
    transaction.writes.forEach((value, path) => {
      this.store.set(path, clone(value));
      this.revisions.set(path, (this.revisions.get(path) || 0) + 1);
    });
    return result;
  }
  updateTimeMs(path: string) { return Date.parse('2026-07-12T10:00:00.000Z') + (this.revisions.get(path) || 0); }
}

const identity = { uid: 'owner-uid', email: 'diegorp.1978@gmail.com', emailVerified: true };
const originalFx = { usdClp: 891, eurClp: 1038, ufClp: 40628 };
const proposedFxRates = { usdClp: 922, eurClp: 1054, ufClp: 40834 };
const records = [
  { id: 'asset-usd', block: 'investment', label: 'Cuenta USD', currency: 'USD', amount: 100_000 },
  { id: 'risk-usd', block: 'investment', label: 'Capital de riesgo USD', currency: 'USD', amount: 10_000 },
  { id: 'mortgage', block: 'debt', label: 'Saldo deuda hipotecaria', currency: 'UF', amount: 1_000 },
  { id: 'cash', block: 'bank', label: 'Banco CLP', currency: 'CLP', amount: 40_000_000 },
];
const closure = {
  monthKey: '2026-06',
  closedAt: '2026-06-30T23:59:59.000Z',
  records,
  fxRates: originalFx,
  summary: calculateHistoricalClosureSummary(records, originalFx),
  unknownFutureField: { keep: true },
  legacyDebtAggregate: { amount: 999 },
};
const otherClosure = { monthKey: '2026-05', records: [{ id: 'may' }], fxRates: originalFx, summary: { netClp: 1 } };
const root = {
  records: [{ id: 'live-july', amount: 777 }],
  fx: { usdClp: 999, eurClp: 1111, ufClp: 42000 },
  closures: [otherClosure, closure],
  unknownRootField: { keep: 'root' },
};

const database = () => new FakeFirestore(new Map([[`aurum_wealth/${identity.uid}`, root]]));

describe('historical closure transactional service', () => {
  it('reads cloud-first and previews May/June without writes', async () => {
    const db = database();
    const initial = clone([...db.store.entries()]);
    const preview = await previewHistoricalCorrection({
      db, identity, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), proposedFxRates,
    });
    expect(preview.monthKey).toBe('2026-06');
    expect(preview.withoutRisk.after).not.toBe(preview.withoutRisk.before);
    expect([...db.store.entries()]).toEqual(initial);
    expect(() => localStorage).toThrow();
  });

  it('prepares a cloud-verifiable, reversible, chunked backup and checkpoint', async () => {
    const db = database();
    const prepared = await prepareHistoricalCorrection({
      db, identity, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), proposedFxRates, reason: 'Corregir FX histórico',
    });
    expect(prepared.cloudVerified).toBe(true);
    expect(prepared.approvedCorrection.proposedFxRates).toEqual(proposedFxRates);
    const exported = await exportHistoricalBackup({ db, identity, backupId: prepared.backupId });
    expect(exported.exportPayload.rootDocument).toEqual(root);
    expect(exported.exportPayload.closure.unknownFutureField).toEqual({ keep: true });
    expect(exported.exportPayload.closure.legacyDebtAggregate).toEqual({ amount: 999 });
  });

  it('applies atomically to only the target closure and preserves live, other and unknown data', async () => {
    const db = database();
    const prepared = await prepareHistoricalCorrection({
      db, identity, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), proposedFxRates, reason: 'Corregir FX histórico',
    });
    const result = await applyHistoricalCorrection({
      db, identity, input: {
        monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), backupId: prepared.backupId,
        checkpointId: prepared.checkpointId, approvedCorrectionFingerprint: prepared.approvedCorrectionFingerprint,
        confirmationText: historicalConfirmationText('2026-06'),
      },
    });
    const saved = db.store.get(`aurum_wealth/${identity.uid}`)!;
    expect(saved.records).toEqual(root.records);
    expect(saved.fx).toEqual(root.fx);
    expect(saved.unknownRootField).toEqual(root.unknownRootField);
    expect(saved.closures[0]).toEqual(otherClosure);
    expect(saved.closures[1].records).toEqual(records);
    expect(saved.closures[1].unknownFutureField).toEqual({ keep: true });
    expect(saved.closures[1].legacyDebtAggregate).toEqual({ amount: 999 });
    expect(saved.closures[1].fxRates).toEqual(proposedFxRates);
    expect(result.reconciliation.after).toBe(true);
    expect(result.status).toBe('applied_verified');
    expect(result.persistedFxRates).toEqual(proposedFxRates);
    expect(result.persistedNetClp).toBe(result.preview.withoutRisk.after);
    expect(result.persistedNetClpWithRisk).toBe(result.preview.withRisk.after);
  });

  it('blocks a no-op before creating an applied audit or changing artifact status', async () => {
    const db = database();
    await expect(prepareHistoricalCorrection({
      db,
      identity,
      monthKey: '2026-06',
      expectedFingerprint: fingerprintValue(closure),
      proposedFxRates: originalFx,
      reason: 'No-op accidental',
    })).rejects.toMatchObject({ code: 'no_op' });
    expect(db.store.get(`aurum_wealth/${identity.uid}`)).toEqual(root);
    expect([...db.store.keys()].some((path) => path.includes('aurum_historical_audits'))).toBe(false);
  });

  it('aborts stale or failed transactions without partial writes', async () => {
    const db = database();
    const prepared = await prepareHistoricalCorrection({
      db, identity, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), proposedFxRates, reason: 'Corregir FX histórico',
    });
    const before = clone([...db.store.entries()]);
    await expect(applyHistoricalCorrection({
      db, identity, input: {
        monthKey: '2026-06', expectedFingerprint: 'stale', backupId: prepared.backupId,
        checkpointId: prepared.checkpointId, approvedCorrectionFingerprint: prepared.approvedCorrectionFingerprint,
        confirmationText: historicalConfirmationText('2026-06'),
      },
    })).rejects.toMatchObject({ code: 'artifact_fingerprint_mismatch' });
    expect([...db.store.entries()]).toEqual(before);

    const failingDb = database();
    const failingPrepared = await prepareHistoricalCorrection({
      db: failingDb, identity, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), proposedFxRates, reason: 'Corregir FX histórico',
    });
    const failingBefore = clone([...failingDb.store.entries()]);
    failingDb.beforeCommit = () => { throw new Error('simulated commit failure'); };
    await expect(applyHistoricalCorrection({
      db: failingDb, identity, input: {
        monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), backupId: failingPrepared.backupId,
        checkpointId: failingPrepared.checkpointId, approvedCorrectionFingerprint: failingPrepared.approvedCorrectionFingerprint,
        confirmationText: historicalConfirmationText('2026-06'),
      },
    })).rejects.toThrow('simulated commit failure');
    expect([...failingDb.store.entries()]).toEqual(failingBefore);
  });

  it('rolls back only the target closure and first creates a safety backup', async () => {
    const db = database();
    const prepared = await prepareHistoricalCorrection({
      db, identity, monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), proposedFxRates, reason: 'Corregir FX histórico',
    });
    const applied = await applyHistoricalCorrection({
      db, identity, input: {
        monthKey: '2026-06', expectedFingerprint: fingerprintValue(closure), backupId: prepared.backupId,
        checkpointId: prepared.checkpointId, approvedCorrectionFingerprint: prepared.approvedCorrectionFingerprint,
        confirmationText: historicalConfirmationText('2026-06'),
      },
    });
    const currentRoot = db.store.get(`aurum_wealth/${identity.uid}`)!;
    currentRoot.concurrentUnrelatedField = { arrived: true };
    db.store.set(`aurum_wealth/${identity.uid}`, currentRoot);
    const rollback = await rollbackHistoricalCorrection({
      db, identity, input: {
        monthKey: '2026-06', checkpointId: prepared.checkpointId, expectedFingerprint: applied.fingerprint,
        reason: 'Restaurar cierre original', confirmationText: historicalConfirmationText('2026-06', 'rollback'),
      },
    });
    const restored = db.store.get(`aurum_wealth/${identity.uid}`)!;
    expect(restored.closures[1]).toEqual(closure);
    expect(restored.closures[0]).toEqual(otherClosure);
    expect(restored.concurrentUnrelatedField).toEqual({ arrived: true });
    expect(db.store.has(`aurum_historical_backups/${identity.uid}/operations/${rollback.safetyBackupId}`)).toBe(true);
  });
});
