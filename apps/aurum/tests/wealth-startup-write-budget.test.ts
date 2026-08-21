import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/services/wealthStorage.ts'), 'utf8');
const hydrateStart = source.indexOf('export const hydrateWealthFromCloud');
const hydrateEnd = source.indexOf('export const loadClosuresFromRaw', hydrateStart);
const hydrateSource = source.slice(hydrateStart, hydrateEnd);

describe('Aurum cold-open Firestore write budget', () => {
  it('does not publish optimizableInvestments from the hydration-only path', () => {
    expect(hydrateStart).toBeGreaterThan(0);
    expect(hydrateEnd).toBeGreaterThan(hydrateStart);
    expect(hydrateSource).not.toContain('publishAurumOptimizableInvestmentsSnapshot(');
    expect(hydrateSource).toContain('if (cloudNeedsUpdate) scheduleWealthCloudSync(10)');
  });

  it('keeps the single MIDAS publication in the durable material sync path', () => {
    expect(source.match(/publishAurumOptimizableInvestmentsSnapshot\(/g)).toHaveLength(1);
    expect(source).toContain("logFxTrace('sync_publish_snapshot'");
  });
});
