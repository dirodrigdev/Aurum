import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GastappRevisionAuditTable } from '../src/components/analysis/GastappRevisionAuditTable';
import type { GastappHistoricalRevisionAuditRow } from '../src/services/acceptReviewedGastappRevision';

describe('monthly read-only audit table', () => {
  it('shows full hashes, both stores, current amount, effective difference and all states', () => {
    const rows = ['current', 'stale', 'missing', 'blocked'].map((status, index) => ({
      monthKey: `2026-${['01', '02', '04', '09'][index]}`, closureId: `${index}`, status,
      effectiveSource: index === 1 ? 'sidecar' : index < 2 ? 'closure' : 'none',
      currentContractHash: `sha256:${'b'.repeat(64)}`, currentTotalEur: 7764.01,
      closureSnapshot: { status: 'stale', contractHash: `sha256:${'a'.repeat(64)}`, totalEur: 7675.01 },
      sidecarSnapshot: { status: 'stale', contractHash: 'sidecar-hash', totalEur: 7600 },
      message: index === 3 ? 'Contrato no certificado' : null,
    })) as GastappHistoricalRevisionAuditRow[];
    const html = renderToStaticMarkup(React.createElement(GastappRevisionAuditTable, { rows }));
    for (const value of ['current', 'stale', 'missing', 'blocked', '89,00', '164,01', '7764,01', '7675,01', '7600,00', 'sidecar-hash', `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, 'Contrato no certificado']) expect(html).toContain(value);
    expect(html).not.toContain('<button');
  });
  it('shows an empty state without inventing values', () => {
    expect(renderToStaticMarkup(React.createElement(GastappRevisionAuditTable, { rows: [] }))).toContain('No hay meses para comparar.');
  });
});
