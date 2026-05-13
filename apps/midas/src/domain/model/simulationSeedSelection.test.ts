import assert from 'node:assert/strict';
import { selectRunSeed } from './simulationSeedSelection';

{
  const result = selectRunSeed(42, 123638458);
  assert.equal(result, 42, 'must prioritize canonical input seed when valid');
}

{
  const result = selectRunSeed(null, 123638458);
  assert.equal(result, 123638458, 'must use fallback seed when canonical seed is missing');
}

{
  const result = selectRunSeed(0, 98765);
  assert.equal(result, 98765, 'must ignore non-positive canonical seed');
}

{
  const result = selectRunSeed(undefined, undefined);
  assert.equal(result, 42, 'must fall back to deterministic default when both are invalid');
}

