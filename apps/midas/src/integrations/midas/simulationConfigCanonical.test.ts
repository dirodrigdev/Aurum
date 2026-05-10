import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../../domain/model/defaults';
import type { ModelParameters } from '../../domain/model/types';
import { buildSimulationConfigHash, shouldPersistActiveSimulationConfig } from './simulationConfigCanonical';

const clone = (value: ModelParameters): ModelParameters => JSON.parse(JSON.stringify(value)) as ModelParameters;

(() => {
  const params = clone(DEFAULT_PARAMETERS);
  const hash = buildSimulationConfigHash(params);
  assert.equal(buildSimulationConfigHash(clone(params)), hash, 'same config must produce stable hash');
})();

(() => {
  const params = clone(DEFAULT_PARAMETERS);
  const original = buildSimulationConfigHash(params);
  params.spendingPhases[0].amountReal = Number(params.spendingPhases[0].amountReal) + 250_000;
  const changed = buildSimulationConfigHash(params);
  assert.notEqual(changed, original, 'changing F1 must change config hash');
})();

(() => {
  assert.equal(
    shouldPersistActiveSimulationConfig({ hydrationStatus: 'loading', nextHash: 'local-old', cloudHash: 'cloud-new' }),
    false,
    'local boot cache must not overwrite cloud while hydration is pending',
  );
  assert.equal(
    shouldPersistActiveSimulationConfig({ hydrationStatus: 'error', nextHash: 'local-old', cloudHash: 'cloud-new' }),
    false,
    'local cache must not overwrite cloud after hydration error',
  );
})();

(() => {
  assert.equal(
    shouldPersistActiveSimulationConfig({ hydrationStatus: 'cloud', nextHash: 'cloud-new', cloudHash: 'cloud-new' }),
    false,
    'matching cloud config should not be rewritten',
  );
  assert.equal(
    shouldPersistActiveSimulationConfig({ hydrationStatus: 'cloud', nextHash: 'user-change', cloudHash: 'cloud-new' }),
    true,
    'user changes after cloud hydration can persist',
  );
})();

(() => {
  assert.equal(
    shouldPersistActiveSimulationConfig({ hydrationStatus: 'missing', nextHash: 'local-first', cloudHash: null }),
    true,
    'local fallback can seed cloud only when active cloud config is missing',
  );
})();

console.log('simulationConfigCanonical tests passed');
