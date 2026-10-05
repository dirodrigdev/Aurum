import { createHash, timingSafeEqual } from 'node:crypto';
import { getAdminDb } from '../_firestoreAdmin.js';

const EXPECTED_TOKEN_HASH = '531f7a54eb5bf6d2d20c8c78c00404287296b1ee9af4e39abe6a68654448cb23';
const MONTH = '2026-09';

const authorized = (token) => {
  const actual = createHash('sha256').update(String(token || '')).digest();
  const expected = Buffer.from(EXPECTED_TOKEN_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const predecessorShape = (closure) => {
  if (!closure || typeof closure !== 'object') return null;
  return JSON.parse(JSON.stringify({
    id: String(closure.id || ''),
    monthKey: String(closure.monthKey || ''),
    closedAt: String(closure.closedAt || ''),
    replacedAt: new Date().toISOString(),
    summary: closure.summary,
    fxRates: closure.fxRates,
    fxMetadata: closure.fxMetadata,
    fxMissing: closure.fxMissing,
    records: closure.records,
    gastappExpenseClose: closure.gastappExpenseClose,
  }));
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(req.query?.token)) return res.status(404).json({ error: 'not_found' });

  try {
    const snap = await getAdminDb().collection('aurum_wealth').get();
    const matches = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const closures = Array.isArray(data.closures) ? data.closures : [];
      const closure = closures.find((item) => String(item?.monthKey || '') === MONTH);
      if (!closure?.gastappExpenseClose) continue;

      const previousVersions = Array.isArray(closure.previousVersions) ? closure.previousVersions : [];
      const predecessor = predecessorShape(closure);
      const currentJsonBytes = byteLength(data);
      const closureJsonBytes = byteLength(closure);
      const predecessorJsonBytes = predecessor ? byteLength(predecessor) : 0;
      const naiveProjectedJsonBytes = currentJsonBytes + predecessorJsonBytes;

      matches.push({
        documentJsonBytes: currentJsonBytes,
        closureCount: closures.length,
        september: {
          totalEur: closure.gastappExpenseClose.totalEur ?? closure.gastappExpenseClose.total_contable_eur ?? null,
          contractHash: closure.gastappExpenseClose.contractHash ?? null,
          certificationRevision: closure.gastappExpenseClose.certificationRevision ?? null,
          capturedAt: closure.gastappExpenseClose.capturedAt ?? null,
          generatedAt: closure.gastappExpenseClose.generatedAt ?? null,
          closureJsonBytes,
          recordCount: Array.isArray(closure.records) ? closure.records.length : 0,
          previousVersionsCount: previousVersions.length,
          previousVersionJsonBytes: previousVersions.map(byteLength),
          predecessorJsonBytes,
          naiveProjectedJsonBytes,
        },
        updatedAt: data.updatedAt ?? null,
      });
    }
    return res.status(200).json({ matchingDocuments: matches.length, matches });
  } catch (error) {
    console.error('[diag-september-gastapp-closure]', error?.message || error);
    return res.status(500).json({ error: 'diagnostic_read_failed' });
  }
}
