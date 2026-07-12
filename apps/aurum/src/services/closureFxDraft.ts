import type { WealthFxRates } from './wealthStorage';

const CLOSURE_FX_DRAFT_PREFIX = 'aurum.closure.fx-draft.v1';

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface ClosureFxDraft {
  monthKey: string;
  fxRates: WealthFxRates;
  manualReason: string;
  savedAt: string;
}

const isMonthKey = (value: string) => /^\d{4}-\d{2}$/.test(value);
const isValidRate = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const storageKey = (monthKey: string) => `${CLOSURE_FX_DRAFT_PREFIX}:${monthKey}`;

const browserStorage = (): StorageLike | null =>
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;

export const loadClosureFxDraft = (
  monthKey: string,
  storage: StorageLike | null = browserStorage(),
): ClosureFxDraft | null => {
  if (!storage || !isMonthKey(monthKey)) return null;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(monthKey)) || 'null') as Partial<ClosureFxDraft> | null;
    if (
      !parsed ||
      parsed.monthKey !== monthKey ||
      !isValidRate(parsed.fxRates?.usdClp) ||
      !isValidRate(parsed.fxRates?.eurClp) ||
      !isValidRate(parsed.fxRates?.ufClp)
    ) {
      return null;
    }
    return {
      monthKey,
      fxRates: {
        usdClp: Number(parsed.fxRates.usdClp),
        eurClp: Number(parsed.fxRates.eurClp),
        ufClp: Number(parsed.fxRates.ufClp),
      },
      manualReason: String(parsed.manualReason || ''),
      savedAt: String(parsed.savedAt || ''),
    };
  } catch {
    return null;
  }
};

export const saveClosureFxDraft = (
  draft: Omit<ClosureFxDraft, 'savedAt'>,
  storage: StorageLike | null = browserStorage(),
): ClosureFxDraft | null => {
  if (
    !storage ||
    !isMonthKey(draft.monthKey) ||
    !isValidRate(draft.fxRates.usdClp) ||
    !isValidRate(draft.fxRates.eurClp) ||
    !isValidRate(draft.fxRates.ufClp)
  ) {
    return null;
  }
  const saved: ClosureFxDraft = {
    monthKey: draft.monthKey,
    fxRates: { ...draft.fxRates },
    manualReason: String(draft.manualReason || '').trim(),
    savedAt: new Date().toISOString(),
  };
  storage.setItem(storageKey(draft.monthKey), JSON.stringify(saved));
  return saved;
};

export const clearClosureFxDraft = (
  monthKey: string,
  storage: StorageLike | null = browserStorage(),
) => {
  if (!storage || !isMonthKey(monthKey)) return;
  storage.removeItem(storageKey(monthKey));
};
