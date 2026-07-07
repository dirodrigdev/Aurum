import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildInstrumentUniverseSnapshotMetadata,
  saveInstrumentUniverseSnapshotWithMetadata,
  validateInstrumentUniverseJson,
} from '../domain/instrumentUniverse';
import { SettingsPage } from './SettingsPage';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
const test = (name: string, fn: TestFn) => tests.push({ name, fn });

const makeLocalStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
};

const withWindow = (fn: () => void) => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: makeLocalStorage(),
    dispatchEvent: () => true,
  };
  try {
    fn();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
};

const VALID_UNIVERSE = JSON.stringify({
  instruments: [
    {
      instrument_master: {
        instrument_id: 'btg_gestion_agresiva',
        name: 'BTG GestiÃ³n Agresiva DÃ³lar',
        vehicle_type: 'fund',
        currency: 'USD',
        is_captive: false,
        is_sellable: true,
      },
      instrument_mix_profile: {
        current_mix_used: { rv: 0.8, rf: 0.2, cash: 0, other: 0 },
        current_exposure_used: { global: 0.8, local: 0.2 },
        historical_used_range: { rv: [0.7, 0.85], rf: [0.15, 0.3], cash: [0, 0], other: [0, 0] },
      },
      portfolio_position: {
        amount_clp: 100,
        weight_portfolio: 1,
        role: 'core',
      },
      optimizer_metadata: {
        structural_mix_driver: 'segÃºn optimizer',
        estimated_mix_impact_points: 2,
        replaceability_score: 1,
        replacement_constraint: 'same_currency',
      },
    },
    {
      instrument_master: {
        instrument_id: 'sura_multiactivo_moderado',
        name: 'SURA GestiÃ³n Moderado',
        vehicle_type: 'fund',
        currency: 'CLP',
        is_captive: false,
        is_sellable: true,
      },
      instrument_mix_profile: {
        current_mix_used: { rv: 0.5, rf: 0.5, cash: 0, other: 0 },
        current_exposure_used: { global: 0.4, local: 0.6 },
        historical_used_range: { rv: [0.45, 0.55], rf: [0.45, 0.55], cash: [0, 0], other: [0, 0] },
      },
      portfolio_position: {
        amount_clp: 0,
        weight_portfolio: 0,
        role: 'optional',
      },
      optimizer_metadata: {
        structural_mix_driver: 'false',
        estimated_mix_impact_points: 0,
        replaceability_score: 0.2,
        replacement_constraint: 'same_currency',
      },
    },
  ],
});

function seedUniverse() {
  const validation = validateInstrumentUniverseJson(VALID_UNIVERSE, {
    rvGlobal: 0.5,
    rfGlobal: 0.1,
    rvChile: 0.2,
    rfChile: 0.2,
  });
  assert.equal(validation.ok, true);
  const metadata = buildInstrumentUniverseSnapshotMetadata(validation.snapshot!, validation, {
    fileName: 'instrument_universe.json',
    source: 'settings_upload',
    loadedAt: '2026-07-05T12:00:00.000Z',
  });
  saveInstrumentUniverseSnapshotWithMetadata(validation.snapshot!, metadata);
}

function renderSettings(props?: Partial<React.ComponentProps<typeof SettingsPage>>) {
  return renderToStaticMarkup(
    <SettingsPage
      optimizableBaseReference={{
        amountClp: 1537924613,
        asOf: '2026-06-30T00:00:00.000Z',
        sourceLabel: 'Aurum · Cierre Junio 2026',
        status: 'available',
      }}
      aurumIntegrationStatus="available"
      targetWeights={{ rvGlobal: 0.5, rfGlobal: 0.1, rvChile: 0.2, rfChile: 0.2 }}
      weightsSourceMode="instrument-universe"
      universeSourceOrigin="firestore"
      activeMixSavedAt="2026-07-05T12:00:00.000Z"
      activeMixHash="fnv1a-abcdef12"
      {...props}
    />,
  );
}

test('official universe source is visible and legacy normal flow is hidden', () => {
  withWindow(() => {
    seedUniverse();
    const html = renderSettings();
    assert.match(html, /Fuente activa de mix: Instrument Universe V1 cloud/);
    assert.match(html, /Capital econ[oó]mico oficial/);
    assert.match(html, /Mix derivado desde instruments: peso por instrumento × current_mix_used\./);
    assert.match(html, /Resultado runtime MIDAS/);
    assert.match(html, /Mix: Instrument Universe V1\. Capital: Aurum\. Resultado: Runtime MIDAS\./);
    assert.match(html, /Rango alcanzable RV/);
    assert.match(html, /Rebalanceo recomendado/);
    assert.match(html, /No requerido/);
    assert.match(html, /Recuperación legacy avanzada/);
    assert.doesNotMatch(html, /Pegar JSON/);
    assert.match(html, /Cargar guardado local/);
    assert.doesNotMatch(html, /Cambio estructural/);
  });
});

test('zero-weight instrument is shown as not usable without error semantics', () => {
  withWindow(() => {
    seedUniverse();
    const html = renderSettings();
    assert.match(html, /SURA Gestión Moderado/);
    assert.match(html, /Usable en mix/);
    assert.match(html, /Peso cero — no participa en mix/);
    assert.match(html, /Participa en el mix si tiene peso útil mayor que cero y composición válida\./);
    assert.match(html, /Driver estructural/);
    assert.match(html, /Driver estructural no define si entra al mix\./);
  });
});

test('bundled source is labeled explicitly and legacy stays as advanced tool only', () => {
  withWindow(() => {
    seedUniverse();
    const bundledHtml = renderSettings({
      weightsSourceMode: 'instrument-universe',
      universeSourceOrigin: 'bundled',
      activeMixHash: 'fnv1a-bundled01',
    });
    assert.match(bundledHtml, /Fuente activa de mix: Instrument Universe V1 backup\/bundled/);
    assert.match(bundledHtml, /Usando backup oficial de Instrument Universe V1 porque cloud no está disponible/);
    const missingHtml = renderSettings({
      weightsSourceMode: 'missing-instrument-universe',
      universeSourceOrigin: 'none',
      activeMixHash: null,
      activeMixSavedAt: null,
    });
    assert.match(missingHtml, /Herramienta de recuperación\/migración/);
    assert.match(missingHtml, /No habilita simulación oficial/);
    assert.doesNotMatch(missingHtml, /Fuente activa de mix: Legacy recovery — deprecated/);
  });
});

test('missing universe keeps legacy behind advanced recovery and shows official CTA', () => {
  withWindow(() => {
    seedUniverse();
    const html = renderSettings({
      weightsSourceMode: 'missing-instrument-universe',
      universeSourceOrigin: 'none',
      activeMixHash: null,
      activeMixSavedAt: null,
    });
    assert.match(html, /Fuente activa de mix: Missing \/ no valid universe/);
    assert.match(html, /Cargar Instrument Universe V1/);
    assert.match(html, /Recuperación legacy avanzada/);
    assert.match(html, /Falta Instrument Universe V1 oficial/);
    assert.doesNotMatch(html, /Pegar JSON/);
  });
});

test('defaults do not become official active source', () => {
  withWindow(() => {
    seedUniverse();
    const html = renderSettings({
      weightsSourceMode: 'system-defaults',
      universeSourceOrigin: 'none',
      activeMixHash: null,
      activeMixSavedAt: null,
    });
    assert.match(html, /Fuente activa de mix: Missing \/ no valid universe/);
    assert.match(html, /simulación oficial queda bloqueada/);
  });
});

const failures: string[] = [];
for (const entry of tests) {
  try {
    entry.fn();
    console.log(`ok: ${entry.name}`);
  } catch (error) {
    failures.push(entry.name);
    console.error(`fail: ${entry.name}`);
    console.error(error);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} test(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
