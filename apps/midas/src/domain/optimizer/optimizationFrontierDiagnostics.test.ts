import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { OptimizationDiagnosticRow } from './optimizationFrontierDiagnostics';
import {
  buildCandidateMixDiagnostics,
  buildEffectiveRvRfAssumptions,
  buildOptimizationFrontierDiagnostics,
  explainWinningMix,
  selectBenchmarkRows,
} from './optimizationFrontierDiagnostics';

const makeRow = (overrides: Partial<OptimizationDiagnosticRow>): OptimizationDiagnosticRow => ({
  id: '50-50',
  rvPct: 50,
  rfPct: 50,
  weights: { rvGlobal: 0.35, rvChile: 0.15, rfGlobal: 0.30, rfChile: 0.20 },
  qasrStrict: 0.85,
  csr85_4: 0.8,
  classicSuccessRate: 0.9,
  monthsInSevereCutMean: 12,
  maxConsecutiveSevereCutMonthsP75: 6,
  terminalWealthP25: 100,
  terminalWealthP50: 150,
  houseSaleRate: 0.2,
  ...overrides,
});

{
  const assumptions = buildEffectiveRvRfAssumptions(DEFAULT_PARAMETERS);
  assert.equal(assumptions.units, 'real_annual');
  assert.equal(assumptions.rvGlobalReturn, 0.069);
  assert.equal(assumptions.rfGlobalReturn, 0.024);
}

{
  const assumptions = buildEffectiveRvRfAssumptions(DEFAULT_PARAMETERS);
  const diag = buildCandidateMixDiagnostics(assumptions, makeRow({}));
  assert.ok((diag.rvRfSpread ?? 0) > 0);
}

{
  const rows = [
    makeRow({ id: '0', rvPct: 0, rfPct: 100, weights: { rvGlobal: 0, rvChile: 0, rfGlobal: 0.7, rfChile: 0.3 } }),
    makeRow({ id: '25', rvPct: 25, rfPct: 75, weights: { rvGlobal: 0.18, rvChile: 0.07, rfGlobal: 0.53, rfChile: 0.22 } }),
    makeRow({ id: '50', rvPct: 50, rfPct: 50 }),
    makeRow({ id: '75', rvPct: 75, rfPct: 25, weights: { rvGlobal: 0.52, rvChile: 0.23, rfGlobal: 0.17, rfChile: 0.08 } }),
    makeRow({ id: '80', rvPct: 80, rfPct: 20, weights: { rvGlobal: 0.56, rvChile: 0.24, rfGlobal: 0.14, rfChile: 0.06 } }),
    makeRow({ id: '100', rvPct: 100, rfPct: 0, weights: { rvGlobal: 0.7, rvChile: 0.3, rfGlobal: 0, rfChile: 0 } }),
  ];
  assert.deepEqual(selectBenchmarkRows(rows).map((row) => row.rvPct), [0, 25, 50, 75, 80, 100]);
}

{
  const winner = makeRow({ id: 'winner', qasrStrict: 0.901, csr85_4: 0.81 });
  const challenger = makeRow({ id: 'challenger', qasrStrict: 0.899, csr85_4: 0.76 });
  const reason = explainWinningMix(winner, [winner, challenger]);
  assert.match(reason, /CSR/i);
  assert.doesNotMatch(reason, /venta de casa/i);
}

{
  const winner = makeRow({ id: 'winner', rvPct: 25, rfPct: 75, qasrStrict: 0.88, csr85_4: 0.82, terminalWealthP25: 100 });
  const aggressive = makeRow({
    id: 'aggressive',
    rvPct: 80,
    rfPct: 20,
    weights: { rvGlobal: 0.56, rvChile: 0.24, rfGlobal: 0.14, rfChile: 0.06 },
    qasrStrict: 0.876,
    csr85_4: 0.82,
    monthsInSevereCutMean: 12,
    terminalWealthP25: 200,
  });
  const reason = explainWinningMix(winner, [winner, aggressive]);
  assert.match(reason, /patrimonio esperado/i);
}

{
  const winner = makeRow({ id: 'winner', qasrStrict: 0.9 });
  const diagnostics = buildOptimizationFrontierDiagnostics(DEFAULT_PARAMETERS, [winner], winner);
  assert.equal(diagnostics.benchmarkRows.length, 1);
  assert.equal(diagnostics.winningMixReason, 'Gana por mayor QASR estricto.');
}

console.log('optimizationFrontierDiagnostics tests passed');
