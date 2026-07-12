import { describe, expect, it } from 'vitest';
import {
  clearClosureFxDraft,
  loadClosureFxDraft,
  saveClosureFxDraft,
} from '../src/services/closureFxDraft';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe('closure FX draft', () => {
  it('persists an explicit draft by month and restores its manual reason', () => {
    const storage = createStorage();
    const saved = saveClosureFxDraft({
      monthKey: '2026-07',
      fxRates: { usdClp: 930, eurClp: 1065, ufClp: 40850 },
      manualReason: 'Referencia contractual',
    }, storage);

    expect(saved?.savedAt).toBeTruthy();
    expect(loadClosureFxDraft('2026-07', storage)).toMatchObject({
      monthKey: '2026-07',
      fxRates: { usdClp: 930, eurClp: 1065, ufClp: 40850 },
      manualReason: 'Referencia contractual',
    });
    expect(loadClosureFxDraft('2026-08', storage)).toBeNull();
  });

  it('clears the draft when returning to the reference', () => {
    const storage = createStorage();
    saveClosureFxDraft({
      monthKey: '2026-07',
      fxRates: { usdClp: 930, eurClp: 1065, ufClp: 40850 },
      manualReason: '',
    }, storage);

    clearClosureFxDraft('2026-07', storage);

    expect(loadClosureFxDraft('2026-07', storage)).toBeNull();
  });

  it('rejects incomplete or invalid rates', () => {
    const storage = createStorage();
    expect(saveClosureFxDraft({
      monthKey: '2026-07',
      fxRates: { usdClp: 0, eurClp: 1065, ufClp: 40850 },
      manualReason: '',
    }, storage)).toBeNull();
  });
});
