import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { QualityOptimizationCandidate } from './qualityRanking';
import {
  RV_RF_PREMIUM_SENSITIVITY_SCENARIOS,
  applyRvRfPremiumSensitivity,
  explainSensitivityShift,
  pickSensitivityWinner,
} from './rvRfPremiumSensitivity';

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
  const base = JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));
  const scenario = RV_RF_PREMIUM_SENSITIVITY_SCENARIOS.find((item) => item.id === 'rv_plus_3')!;
  const result = applyRvRfPremiumSensitivity(base, scenario);
  assert.equal(result.params.returns.rvGlobalAnnual, base.returns.rvGlobalAnnual + 0.03);
  assert.equal(result.params.returns.rvChileAnnual, base.returns.rvChileAnnual + 0.03);
  assert.equal(result.params.returns.rfGlobalAnnual, base.returns.rfGlobalAnnual);
  assert.equal(result.params.returns.rfChileUFAnnual, base.returns.rfChileUFAnnual);
  assert.equal(base.returns.rvGlobalAnnual, DEFAULT_PARAMETERS.returns.rvGlobalAnnual);
}

{
  const base = JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));
  const scenario = RV_RF_PREMIUM_SENSITIVITY_SCENARIOS.find((item) => item.id === 'rv_plus_6')!;
  const result = applyRvRfPremiumSensitivity(base, scenario);
  assert.equal(result.params.returns.rvGlobalAnnual, base.returns.rvGlobalAnnual + 0.06);
  assert.equal(result.params.returns.rvChileAnnual, base.returns.rvChileAnnual + 0.06);
}

{
  const base = JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));
  const scenario = RV_RF_PREMIUM_SENSITIVITY_SCENARIOS.find((item) => item.id === 'rv_plus_10')!;
  const result = applyRvRfPremiumSensitivity(base, scenario);
  assert.equal(result.params.returns.rvGlobalAnnual, base.returns.rvGlobalAnnual + 0.10);
  assert.equal(result.params.returns.rvChileAnnual, base.returns.rvChileAnnual + 0.10);
}

{
  const winner = pickSensitivityWinner([
    makeCandidate({ id: 'a', qasrStrict: 0.91, terminalWealthP25: 50 }),
    makeCandidate({ id: 'b', qasrStrict: 0.88, terminalWealthP25: 5000 }),
  ]);
  assert.equal(winner.winner?.id, 'a');
}

{
  const winner = pickSensitivityWinner([
    makeCandidate({ id: 'a', houseSaleRate: 0.05 }),
    makeCandidate({ id: 'b', houseSaleRate: 0.95 }),
  ]);
  assert.ok(winner.winner?.id === 'a' || winner.winner?.id === 'b');
}

{
  const explanation = explainSensitivityShift(25, [25, 40, 55]);
  assert.match(explanation, /prima RV-RF asumida/i);
}

{
  const explanation = explainSensitivityShift(25, [25, 26, 27]);
  assert.match(explanation, /priorizando estabilidad de consumo/i);
}

{
  const result = pickSensitivityWinner([makeCandidate({ qasrStrict: null, id: 'x' })]);
  assert.equal(result.winner, null);
  assert.ok(result.warnings.length > 0);
}

console.log('rvRfPremiumSensitivity tests passed');
