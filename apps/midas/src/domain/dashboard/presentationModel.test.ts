import assert from 'node:assert/strict';
import { buildMidasPresentationModel } from './presentationModel';

const model = buildMidasPresentationModel({
  status: 'ready', horizonYears: 35, completionRate: 0.82, qualitySurvivalRate: 0.31,
  severeCutYearsMean: 1.4, qualityTone: 'warning', severeCutsTone: 'warning',
  scenarios: [
    { id: 'optimistic', success: 0.93 }, { id: 'base', success: 0.82 }, { id: 'pessimistic', success: null },
  ],
});
assert.equal(model.horizonYears, 35);
assert.equal(model.completionPct, 82);
assert.equal(model.qualitySurvivalPct, 31);
assert.equal(model.scenarios[2].completionPct, null, 'null scenario remains unavailable, never zero');
assert.equal(model.fragility, 'quality');
assert.deepEqual(Object.keys(model).sort(), [
  'completionPct', 'conclusions', 'fragility', 'horizonYears', 'qualitySurvivalPct', 'qualityTone',
  'scenarios', 'severeCutYearsMean', 'severeCutsTone', 'status',
].sort());
assert.doesNotMatch(JSON.stringify(model), /capital|gasto|edad|patrimonio|scenarioLabel|m8/i);

const empty = buildMidasPresentationModel({
  status: 'empty', horizonYears: 0, completionRate: null, qualitySurvivalRate: null, severeCutYearsMean: null,
  qualityTone: null, severeCutsTone: null, scenarios: [],
});
assert.equal(empty.completionPct, null);
assert.equal(empty.qualitySurvivalPct, null);
assert.equal(empty.scenarios[0].completionPct, null);
assert.equal(empty.fragility, 'unavailable');

console.log('MIDAS presentation model tests passed');
