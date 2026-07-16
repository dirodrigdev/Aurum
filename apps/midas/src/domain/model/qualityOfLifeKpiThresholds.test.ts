import assert from 'node:assert/strict';
import { resolveQualityOfLifeKpiThreshold } from './qualityOfLifeKpiThresholds';

const productionLikeMetrics = {
  csr85_4: 0.737,
  qualitySurvivalRate: 0.154,
  averageEffectiveSpendingRatio: 0.9600833061762758,
  severeCutYearsMean: 2.9089166666666646,
  monthsBelow85: 34.907,
  terminalWealthRatio: 2.181401876071787,
};

const csr = resolveQualityOfLifeKpiThreshold('csr85_4', productionLikeMetrics);
assert.equal(csr.status, 'yellow');
assert.equal(csr.label, 'Atención');

const strictSurvival = resolveQualityOfLifeKpiThreshold('qualitySurvivalRate', productionLikeMetrics);
assert.equal(strictSurvival.status, 'red');
assert.equal(strictSurvival.label, 'Crítico');

const spending = resolveQualityOfLifeKpiThreshold('averageEffectiveSpendingRatio', productionLikeMetrics);
assert.equal(spending.status, 'yellow');
assert.equal(spending.label, 'Atención');

const severeCut = resolveQualityOfLifeKpiThreshold('severeCutYearsMean', productionLikeMetrics);
assert.equal(severeCut.status, 'yellow');
assert.equal(severeCut.label, 'Atención');

const terminal = resolveQualityOfLifeKpiThreshold('terminalWealthRatio', productionLikeMetrics);
assert.equal(terminal.status, 'yellow');
assert.equal(terminal.label, 'Atención');

const terminalInformational = resolveQualityOfLifeKpiThreshold('terminalWealthRatio', {
  ...productionLikeMetrics,
  terminalWealthRatio: 1.4,
  severeCutYearsMean: 0.4,
});
assert.equal(terminalInformational.status, 'neutral');
assert.equal(terminalInformational.label, 'Informativo');
assert.equal(terminalInformational.isInformationalOnly, true);

console.log('qualityOfLifeKpiThresholds tests passed');
