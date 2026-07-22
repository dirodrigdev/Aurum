import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const apiSource = readFileSync(resolve(process.cwd(), 'api/midas/publish-snapshot.js'), 'utf8');

test('publish API accepts only canonical closure FX provenance', () => {
  expect(apiSource).toContain("source !== 'closure_fx_metadata'");
  expect(apiSource).toContain("fxReference canónico completo y trazable es obligatorio");
  expect(apiSource).toContain('validationStatus !== \'valid\'');
  expect(apiSource).toContain('rateOrigin');
  expect(apiSource).toContain('rateSource');
});

test('publish API never promotes device-local or existing legacy FX into a snapshot', () => {
  expect(apiSource).not.toContain('normalizeActiveFxRates');
  expect(apiSource).not.toContain('withFxReferenceFromActiveRates');
  expect(apiSource).not.toContain('preserve_existing_fx');
  expect(apiSource).not.toContain('fx_reference_backfill_attempt');
  expect(apiSource).not.toContain('WEALTH_COLLECTION');
});
