import { hydrateWealthFromCloud } from './wealthStorage';

export type SharedWealthHydrationResult = Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'skipped';

let sharedHydrationPromise: Promise<SharedWealthHydrationResult> | null = null;
let lastSharedHydrationAt = 0;

/**
 * Client-side hydration gate.
 *
 * Use this helper from screens and app bootstrap instead of calling
 * `hydrateWealthFromCloud()` directly from multiple places. It deduplicates
 * in-flight hydrations and throttles repeated reads caused by focus, visibility
 * changes or bottom-nav retaps.
 *
 * Source of truth:
 * - local state remains the immediate source of truth for UI after local mutations
 * - cloud hydration is only for bootstrap/manual refresh/reconciliation
 */
export const hydrateWealthFromCloudShared = async (options?: {
  force?: boolean;
  minIntervalMs?: number;
}): Promise<SharedWealthHydrationResult> => {
  const force = options?.force === true;
  const minIntervalMs = Math.max(0, options?.minIntervalMs ?? 15_000);

  if (sharedHydrationPromise) {
    return sharedHydrationPromise;
  }

  const now = Date.now();
  if (!force && now - lastSharedHydrationAt < minIntervalMs) {
    return 'skipped';
  }

  sharedHydrationPromise = (async () => {
    try {
      return await hydrateWealthFromCloud();
    } finally {
      lastSharedHydrationAt = Date.now();
      sharedHydrationPromise = null;
    }
  })();

  return sharedHydrationPromise;
};

export const resetSharedWealthHydration = () => {
  lastSharedHydrationAt = 0;
};
