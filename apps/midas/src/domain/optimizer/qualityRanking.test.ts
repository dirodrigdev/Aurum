import assert from 'node:assert/strict';
import type { QualityOptimizationCandidate } from './qualityRanking';
import { compareQualityOptimizationCandidates, rankQualityOptimizationCandidates } from './qualityRanking';

function makeCandidate(overrides: Partial<QualityOptimizationCandidate>): QualityOptimizationCandidate {
  return {
    id: 'candidate',
    rvWeight: 0.5,
    rfWeight: 0.5,
    qasrStrict: 0.8,
    csr85_4: 0.75,
    classicSuccessRate: 0.9,
    monthsInSevereCutMean: 12,
    maxConsecutiveSevereCutMonthsP75: 6,
    terminalWealthP25: 100,
    terminalWealthP50: 150,
    houseSaleRate: 0.2,
    warnings: [],
    ...overrides,
  };
}

{
  const winner = makeCandidate({ id: 'a', qasrStrict: 0.9 });
  const loser = makeCandidate({ id: 'b', qasrStrict: 0.85 });
  const ranked = rankQualityOptimizationCandidates([loser, winner]);
  assert.equal(ranked[0].id, 'a');
}

{
  const higherCsr = makeCandidate({ id: 'a', qasrStrict: 0.9, csr85_4: 0.8 });
  const lowerCsr = makeCandidate({ id: 'b', qasrStrict: 0.896, csr85_4: 0.75 });
  const ranked = rankQualityOptimizationCandidates([lowerCsr, higherCsr]);
  assert.equal(ranked[0].id, 'a');
}

{
  const higherSuccess = makeCandidate({ id: 'a', qasrStrict: 0.9, csr85_4: 0.8, classicSuccessRate: 0.92 });
  const lowerSuccess = makeCandidate({ id: 'b', qasrStrict: 0.897, csr85_4: 0.796, classicSuccessRate: 0.89 });
  const ranked = rankQualityOptimizationCandidates([lowerSuccess, higherSuccess]);
  assert.equal(ranked[0].id, 'a');
}

{
  const higherQasr = makeCandidate({ id: 'a', qasrStrict: 0.82, terminalWealthP25: 50, terminalWealthP50: 60 });
  const lowerQasrHigherTerminal = makeCandidate({ id: 'b', qasrStrict: 0.79, terminalWealthP25: 5_000, terminalWealthP50: 8_000 });
  const ranked = rankQualityOptimizationCandidates([lowerQasrHigherTerminal, higherQasr]);
  assert.equal(ranked[0].id, 'a');
}

{
  const lowHouseSale = makeCandidate({ id: 'a', houseSaleRate: 0.05 });
  const highHouseSale = makeCandidate({ id: 'b', houseSaleRate: 0.95 });
  const comparison = compareQualityOptimizationCandidates(lowHouseSale, highHouseSale);
  assert.equal(comparison, 0);
}

{
  const valid = makeCandidate({ id: 'a', qasrStrict: 0.8 });
  const invalid = makeCandidate({ id: 'b', qasrStrict: null });
  const ranked = rankQualityOptimizationCandidates([invalid, valid]);
  assert.equal(ranked[0].id, 'a');
  assert.equal(ranked[1].id, 'b');
}

{
  const lowerSevereCut = makeCandidate({ id: 'a', qasrStrict: 0.8, csr85_4: 0.75, classicSuccessRate: 0.9, monthsInSevereCutMean: 8 });
  const higherSevereCut = makeCandidate({ id: 'b', qasrStrict: 0.8, csr85_4: 0.75, classicSuccessRate: 0.9, monthsInSevereCutMean: 16 });
  const ranked = rankQualityOptimizationCandidates([higherSevereCut, lowerSevereCut]);
  assert.equal(ranked[0].id, 'a');
}

console.log('qualityRanking tests passed');
