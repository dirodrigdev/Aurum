import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import {
  applyTemporarySpendScale,
  computeMaxSpendScalePassingQoL,
  DEFAULT_SPENDING_HEADROOM_THRESHOLDS,
  passesQualityAtSpendScale,
} from './spendingHeadroom';

{
  const base = JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));
  const scaled = applyTemporarySpendScale(base, 1.2);
  assert.equal(base.spendingPhases[0].amountReal, DEFAULT_PARAMETERS.spendingPhases[0].amountReal);
  assert.equal(scaled.spendingPhases[0].amountReal, DEFAULT_PARAMETERS.spendingPhases[0].amountReal * 1.2);
}

{
  const base = JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));
  const scaled = applyTemporarySpendScale(base, 1.3);
  scaled.spendingPhases.forEach((phase, index) => {
    assert.equal(phase.amountReal, base.spendingPhases[index].amountReal * 1.3);
  });
}

{
  assert.equal(
    passesQualityAtSpendScale({
      spendScale: 1,
      qasrStrict: 0.91,
      csr85_4: 0.86,
      classicSuccessRate: 0.91,
      houseSaleRate: 0.9,
      terminalWealthP25: 1,
      terminalWealthP50: 1000,
    }),
    true,
  );
}

{
  const value = computeMaxSpendScalePassingQoL([
    { spendScale: 1, qasrStrict: 0.95, csr85_4: 0.9, classicSuccessRate: 0.95 },
    { spendScale: 1.2, qasrStrict: 0.91, csr85_4: 0.86, classicSuccessRate: 0.91 },
    { spendScale: 1.3, qasrStrict: 0.89, csr85_4: 0.84, classicSuccessRate: 0.91 },
  ]);
  assert.equal(value, 1.2);
}

{
  const value = computeMaxSpendScalePassingQoL([
    { spendScale: 1, qasrStrict: 0.95, csr85_4: 0.9, classicSuccessRate: 0.95 },
    { spendScale: 1.2, qasrStrict: 0.94, csr85_4: 0.88, classicSuccessRate: 0.93 },
    { spendScale: 1.3, qasrStrict: 0.91, csr85_4: 0.86, classicSuccessRate: 0.92 },
  ]);
  assert.equal(value, 1.3);
}

{
  const value = computeMaxSpendScalePassingQoL([
    { spendScale: 1, qasrStrict: 0.89, csr85_4: 0.9, classicSuccessRate: 0.95 },
    { spendScale: 1.2, qasrStrict: 0.91, csr85_4: 0.86, classicSuccessRate: 0.91 },
  ]);
  assert.equal(value, null);
}

{
  assert.equal(DEFAULT_SPENDING_HEADROOM_THRESHOLDS.minQasrStrict, 0.9);
  assert.equal(DEFAULT_SPENDING_HEADROOM_THRESHOLDS.minCsr85_4, 0.85);
  assert.equal(DEFAULT_SPENDING_HEADROOM_THRESHOLDS.minClassicSuccessRate, 0.9);
}

console.log('spendingHeadroom tests passed');
