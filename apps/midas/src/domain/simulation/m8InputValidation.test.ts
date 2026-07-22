import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import { resolveCapital } from './capitalResolver';
import { toM8Input, validateM8Preconditions } from './m8Adapter';
import { validateM8Input } from './engineM8';
import type { M8Input } from './m8.types';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function buildParams() {
  const params = clone(DEFAULT_PARAMETERS);
  params.simulation = {
    ...params.simulation,
    horizonMonths: 480,
    nSim: 2,
    seed: 42,
    useHistoricalData: false,
  };
  return params;
}

function buildInput(): M8Input {
  const params = buildParams();
  return toM8Input(params, resolveCapital({ params }));
}

function hasError(input: M8Input, fragment: string): boolean {
  return validateM8Input(input).some((error) => error.includes(fragment));
}

const valid = buildInput();
assert.deepEqual(validateM8Input(valid), [], 'canonical input should pass validation');

{
  const invalid = clone(valid);
  invalid.seed = 42.5;
  assert.equal(hasError(invalid, 'seed debe ser entero positivo'), true);
}

{
  const invalid = clone(valid);
  invalid.n_paths = 1.5;
  assert.equal(hasError(invalid, 'n_paths debe ser entero positivo'), true);
}

{
  const invalid = clone(valid);
  invalid.generator_params.sleeves.eq_global.vol_annual = -0.01;
  assert.equal(hasError(invalid, 'vol_annual debe ser >= 0'), true);
}

{
  const invalid = clone(valid);
  invalid.generator_params.sleeves.eq_global.mean_annual = Number.NaN;
  assert.equal(hasError(invalid, 'mean_annual y vol_annual finitos'), true);
}

{
  const invalid = clone(valid);
  invalid.portfolio_mix.eq_global = -0.1;
  assert.equal(hasError(invalid, 'portfolio_mix.eq_global debe ser finito y >= 0'), true);
}

{
  const invalid = clone(valid);
  (invalid.portfolio_mix as unknown as Record<string, number>).unknown_sleeve = 0.1;
  assert.equal(hasError(invalid, 'sleeve desconocida'), true);
}

{
  const invalid = clone(valid);
  invalid.generator_params.correlation_matrix[0][1] = 1.2;
  assert.equal(hasError(invalid, 'debe estar en [-1, 1]'), true);
}

{
  const invalid = clone(valid);
  invalid.generator_params.correlation_matrix[0][1] = 0.2;
  assert.equal(hasError(invalid, 'debe ser simetrica'), true);
}

{
  const invalid = clone(valid);
  invalid.generator_params.correlation_matrix[0][0] = 0.9;
  assert.equal(hasError(invalid, 'debe ser 1'), true);
}

{
  const singular = clone(valid);
  singular.generator_params.correlation_matrix = singular.generator_params.correlation_matrix.map((row) => row.slice());
  for (let i = 0; i < singular.generator_params.correlation_matrix.length; i += 1) {
    singular.generator_params.correlation_matrix[1][i] = singular.generator_params.correlation_matrix[0][i];
    singular.generator_params.correlation_matrix[i][1] = singular.generator_params.correlation_matrix[i][0];
  }
  singular.generator_params.correlation_matrix[1][1] = 1;
  assert.deepEqual(validateM8Input(singular), [], 'valid singular correlation matrix must remain accepted');
}

{
  const invalid = clone(valid);
  invalid.generator_params.correlation_matrix[0][1] = 0.9;
  invalid.generator_params.correlation_matrix[0][2] = 0.9;
  invalid.generator_params.correlation_matrix[1][0] = 0.9;
  invalid.generator_params.correlation_matrix[1][2] = -0.9;
  invalid.generator_params.correlation_matrix[2][0] = 0.9;
  invalid.generator_params.correlation_matrix[2][1] = -0.9;
  assert.equal(hasError(invalid, 'no es semidefinida positiva'), true);
}

{
  const deterministic = clone(valid);
  for (const stats of Object.values(deterministic.generator_params.sleeves)) stats.vol_annual = 0;
  assert.deepEqual(validateM8Input(deterministic), [], 'zero-volatility sleeves remain valid');
}

{
  const invalid = clone(valid);
  (invalid as unknown as { generator_params?: unknown }).generator_params = undefined;
  assert.doesNotThrow(() => validateM8Input(invalid));
  assert.equal(hasError(invalid, 'generator_params es obligatorio'), true);
}

{
  const zeroEvent = clone(valid);
  zeroEvent.future_events = [{ id: 'zero', type: 'inflow', amount: 0, currency: 'USD', effective_month: 1 }];
  assert.deepEqual(validateM8Input(zeroEvent), [], 'a zero-valued future event must remain neutral and valid');
}

{
  const params = buildParams();
  params.simulation.seed = 42.5;
  const validation = validateM8Preconditions(params, resolveCapital({ params }));
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('simulation.seed')));
}

{
  const params = buildParams();
  (params.returns as unknown as { correlationMatrix: unknown }).correlationMatrix = { invalid: true };
  const validation = validateM8Preconditions(params, resolveCapital({ params }));
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('correlationMatrix')));
}

console.log('m8InputValidation tests passed');
