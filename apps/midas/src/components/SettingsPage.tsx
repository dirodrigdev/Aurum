import React, { useEffect, useMemo, useState } from 'react';
import {
  classifyCoverageQuality,
  clearInstrumentBaseSnapshot,
  loadInstrumentBaseSnapshot,
  type OptimizableBaseReference,
  saveInstrumentBaseSnapshot,
  summarizeInstrumentBase,
  validateInstrumentBaseJson,
  type InstrumentBaseSummary,
  type InstrumentBaseValidation,
} from '../domain/instrumentBase';
import {
  buildInstrumentUniverseSnapshotMetadata,
  clearLastFailedInstrumentUniverseImport,
  clearInstrumentUniverseSnapshot,
  loadInstrumentUniverseSnapshotMetadata,
  loadLastFailedInstrumentUniverseImport,
  loadInstrumentUniverseSnapshot,
  saveInstrumentUniverseSnapshotWithMetadata,
  saveLastFailedInstrumentUniverseImport,
  summarizeInstrumentUniverse,
  validateInstrumentUniverseSnapshot,
  validateInstrumentUniverseJson,
  type InstrumentUniverseFailedImport,
  type InstrumentUniverseSnapshotMetadata,
  type InstrumentUniverseSnapshot,
  type InstrumentUniverseSummary,
  type InstrumentUniverseValidation,
} from '../domain/instrumentUniverse';
import type { PortfolioWeights } from '../domain/model/types';
import {
  hydrateInstrumentUniverseCacheFromFirestore,
  persistInstrumentUniverseActiveToFirestore,
} from '../integrations/midas/instrumentUniversePersistence';
import { T, css } from './theme';
type AurumIntegrationStatus = 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
type SettingsWeightsSourceMode =
  | 'instrument-universe'
  | 'instrument-base'
  | 'json-official'
  | 'last-known-official'
  | 'system-defaults'
  | 'simulation'
  | 'error';
type SettingsUniverseSourceOrigin = 'firestore' | 'bundled' | 'cache-local' | 'none';

const formatMoneyClp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
};

const formatPct = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
};

const formatPp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} pp`;
};

const formatRvBand = (min: number | null, max: number | null) => {
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return '—';
  return `RV ${formatPct(min)}-${formatPct(max)}`;
};

const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const shortHash = (value: string | null | undefined) => {
  if (!value) return '—';
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
};

const normalizeVisibleText = (value: string | null | undefined) => {
  if (!value) return '—';
  return value
    .replaceAll('Ã³', 'ó')
    .replaceAll('Ã¡', 'á')
    .replaceAll('Ã©', 'é')
    .replaceAll('Ã­', 'í')
    .replaceAll('Ãº', 'ú')
    .replaceAll('Ã±', 'ñ')
    .replaceAll('Ã“', 'Ó')
    .replaceAll('Ã‰', 'É')
    .replaceAll('Ãš', 'Ú')
    .replaceAll('Ã‘', 'Ñ')
    .replaceAll('DÃ³lar', 'Dólar')
    .replaceAll('GestiÃ³n', 'Gestión')
    .replaceAll('segÃºn', 'según');
};

const toBoolLabel = (value: boolean | null | undefined) => (value ? 'Sí' : 'No');

const placeholderJson = `{
  "instrumentos": [
    {
      "administradora": "SURA",
      "instrumento": "Multiactivo",
      "monto_clp_eq": 350000000,
      "porcentaje_rv": 60,
      "porcentaje_rf": 40,
      "porcentaje_global": 75,
      "porcentaje_local": 25
    }
  ]
}`;

const placeholderUniverseJson = `{
  "instrument_master": [
    {
      "instrument_id": "fund-a",
      "name": "Fondo A",
      "vehicle_type": "fund",
      "currency": "CLP",
      "tax_wrapper": "general",
      "is_captive": false,
      "is_sellable": true
    }
  ],
  "instrument_mix_profile": [
    {
      "instrument_id": "fund-a",
      "current_mix_used": { "rv": 0.6, "rf": 0.4, "cash": 0, "other": 0 },
      "historical_used_range": { "rv": { "min": 0.45, "max": 0.75 }, "rf": { "min": 0.25, "max": 0.55 } },
      "legal_range": {},
      "observed_window_months": 36,
      "observed_from": "2023-01",
      "observed_to": "2025-12",
      "estimation_method": "reported",
      "confidence_score": 0.9,
      "source_preference": "reported"
    }
  ],
  "portfolio_position": [
    {
      "instrument_id": "fund-a",
      "amount_clp": 100000000,
      "weight_portfolio": 1,
      "role": "core",
      "structural_mix_driver": "rv_rf",
      "estimated_mix_impact_points": 60,
      "replaceability_score": 0.8,
      "replacement_constraint": "none"
    }
  ],
  "optimizer_metadata": {},
  "portfolio_summary": {},
  "methodology": {}
}`;

function SummaryCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        background: T.surfaceEl,
        borderRadius: 18,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
        {title}
      </div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700, color: T.textPrimary }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: T.textSecondary }}>{subtitle}</div>
    </div>
  );
}

function ExposureSummary({ summary }: { summary: InstrumentBaseSummary | null }) {
  if (!summary?.weightedExposure) return null;
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        background: T.surfaceEl,
        borderRadius: 18,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
        Mix implícito cargado
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {[
          { label: 'RV', value: summary.weightedExposure.rv },
          { label: 'RF', value: summary.weightedExposure.rf },
          { label: 'Global', value: summary.weightedExposure.global },
          { label: 'Local', value: summary.weightedExposure.local },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              border: `1px solid ${T.border}`,
              background: T.surface,
              borderRadius: 14,
              padding: '12px 14px',
            }}
          >
            <div style={{ fontSize: 11, color: T.textMuted }}>{item.label}</div>
            <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700 }}>{formatPct(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UniverseSummaryPanel({ summary }: { summary: InstrumentUniverseSummary | null }) {
  if (!summary) return null;
  const currentMix = summary.currentMix;
  const historical = summary.historicalUsedRange;
  const targetRv = summary.targetRv;
  const gapPp =
    targetRv !== null && historical
      ? targetRv < historical.rv.min
        ? (targetRv - historical.rv.min) * 100
        : targetRv > historical.rv.max
          ? (targetRv - historical.rv.max) * 100
          : 0
      : null;
  const gapLabel = (() => {
    if (gapPp === null) return 'Gap: —';
    if (Math.abs(gapPp) < 0.05) return 'Gap: dentro de rango';
    if (gapPp > 0) return `Gap: ${formatPp(gapPp)} sobre techo`;
    return `Gap: ${formatPp(gapPp)} bajo piso`;
  })();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
          Mix estructural derivado
        </div>
        <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
          Mix derivado desde instruments: peso por instrumento × current_mix_used.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <SummaryCard
          title="Instrumentos universo"
          value={`${summary.usableInstrumentCount}/${summary.instrumentCount}`}
          subtitle={`Peso útil: ${formatPct(summary.totalWeightPortfolio)}`}
        />
        <SummaryCard
          title="Mix estructural"
          value={currentMix ? `RV ${formatPct(currentMix.rv)} / RF ${formatPct(currentMix.rf)}` : '—'}
          subtitle={currentMix ? `Cash ${formatPct(currentMix.cash)} · Other ${formatPct(currentMix.other)}` : 'Sin mix utilizable'}
        />
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
          Resultado runtime MIDAS
        </div>
        <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
          Derivado runtime: Aurum + fuente activa de mix. El rango usa bandas operativas por instrumento; no representa historia pura.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <SummaryCard
          title="Rango operativo RV"
          value={historical ? formatRvBand(historical.rv.min, historical.rv.max) : '—'}
          subtitle={historical ? `Target runtime: ${formatPct(targetRv)} · ${gapLabel}` : 'Sin rango operativo'}
        />
        <SummaryCard
          title="Cambio estructural"
          value={summary.structuralChangeRequired === null ? '—' : summary.structuralChangeRequired ? 'Requerido' : 'No requerido'}
          subtitle={
            historical
              ? `Target RV ${formatPct(targetRv)} · Rango alcanzable ${formatPct(historical.rv.min)}-${formatPct(historical.rv.max)} · Gap ${formatPp(gapPp)}`
              : 'Sin banda o target'
          }
        />
      </div>
    </div>
  );
}

function InstrumentUniverseTable({ snapshot }: { snapshot: InstrumentUniverseSnapshot | null }) {
  if (!snapshot) return null;
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 14 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1260 }}>
        <thead>
          <tr style={{ background: T.surfaceEl, color: T.textMuted, fontSize: 11, textAlign: 'left' }}>
            {['Instrumento', 'instrument_id', 'Peso', 'Usable en mix', 'Mix usado', 'Exposición', 'Rango operativo RV', 'Conf.', 'Fuente', 'Driver estructural', 'Warnings'].map((label) => (
              <th key={label} style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.instruments.map((item) => (
            <tr key={item.instrumentId} style={{ borderBottom: `1px solid ${T.border}`, color: T.textSecondary, fontSize: 12 }}>
              <td style={{ padding: '10px 12px', color: T.textPrimary, fontWeight: 700 }}>
                {normalizeVisibleText(item.name || item.instrumentId)}
              </td>
              <td style={{ padding: '10px 12px', ...css.mono }}>{item.instrumentId}</td>
              <td style={{ padding: '10px 12px' }}>{formatPct(item.weightPortfolio)}</td>
              <td style={{ padding: '10px 12px' }}>
                <div>{toBoolLabel(item.usable)}</div>
                {(item.weightPortfolio ?? 0) <= 0 ? (
                  <div style={{ color: T.warning, fontSize: 10 }}>Peso cero — no participa en mix</div>
                ) : null}
              </td>
              <td style={{ padding: '10px 12px' }}>
                {item.currentMixUsed
                  ? (
                    <>
                      <div>RV {formatPct(item.currentMixUsed.rv)} / RF {formatPct(item.currentMixUsed.rf)}</div>
                      <div style={{ color: T.textMuted, fontSize: 10 }}>
                        Cash {formatPct(item.currentMixUsed.cash)} · Other {formatPct(item.currentMixUsed.other)}
                      </div>
                    </>
                  )
                  : '—'}
              </td>
              <td style={{ padding: '10px 12px' }}>
                {item.exposureUsed
                  ? `Global ${formatPct(item.exposureUsed.global)} · Local ${formatPct(item.exposureUsed.local)}`
                  : '—'}
              </td>
              <td style={{ padding: '10px 12px' }}>
                {item.operationalRange
                  ? (
                    <>
                      <div>
                        {formatRvBand(item.operationalRange.rv.min, item.operationalRange.rv.max)}
                      </div>
                      {item.optimizerSafeRange && item.legalRangeMix ? (
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Legal: {formatRvBand(item.legalRangeMix.rv.min, item.legalRangeMix.rv.max)}
                        </div>
                      ) : null}
                    </>
                  )
                  : '—'}
              </td>
              <td style={{ padding: '10px 12px' }}>{formatPct(item.confidenceScore)}</td>
              <td style={{ padding: '10px 12px' }}>{normalizeVisibleText(item.sourcePreference || '—')}</td>
              <td style={{ padding: '10px 12px' }}>
                <div>{normalizeVisibleText(item.structuralMixDriver || '—')}</div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Driver estructural no define si entra al mix.
                </div>
              </td>
              <td style={{ padding: '10px 12px', color: item.usable ? T.textMuted : T.warning }}>
                {(item.weightPortfolio ?? 0) <= 0
                  ? 'Peso cero — no participa en mix'
                  : item.missingCriticalFields.length
                    ? `Faltan: ${item.missingCriticalFields.join(', ')}`
                    : normalizeVisibleText(item.warnings.join(' · ')) || 'OK'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveActiveMixSource(input: {
  weightsSourceMode: SettingsWeightsSourceMode;
  universeSourceOrigin: SettingsUniverseSourceOrigin;
}) {
  if (input.weightsSourceMode === 'instrument-universe' && input.universeSourceOrigin === 'firestore') {
    return {
      title: 'Fuente activa de mix: Instrument Universe V1 cloud',
      subtitle: 'Fuente oficial vigente para pesos y composición estructural.',
      warning: null,
      tone: 'positive' as const,
      official: true,
    };
  }
  if (input.weightsSourceMode === 'instrument-universe' && input.universeSourceOrigin === 'bundled') {
    return {
      title: 'Fuente activa de mix: Instrument Universe V1 backup/bundled',
      subtitle: 'Usando backup oficial de Instrument Universe V1 porque cloud no está disponible.',
      warning: 'Usando backup oficial de Instrument Universe V1 porque cloud no está disponible.',
      tone: 'warning' as const,
      official: true,
    };
  }
  if (input.weightsSourceMode === 'instrument-base') {
    return {
      title: 'Fuente activa de mix: Legacy recovery — deprecated',
      subtitle: 'MIDAS está usando recuperación legacy. Esta no es la fuente oficial de mix.',
      warning: 'MIDAS no está usando una fuente oficial de Instrument Universe V1. La simulación puede no ser confiable hasta cargar un universe válido.',
      tone: 'negative' as const,
      official: false,
    };
  }
  return {
    title: 'Fuente activa de mix: Missing / no valid universe',
    subtitle: 'No hay Instrument Universe V1 válido como fuente activa de mix.',
    warning: 'MIDAS no está usando una fuente oficial de Instrument Universe V1. La simulación puede no ser confiable hasta cargar un universe válido.',
    tone: 'negative' as const,
    official: false,
  };
}

function aurumBaseSubtitle(status: AurumIntegrationStatus, optimizableBaseReference: OptimizableBaseReference) {
  if (status === 'available' || status === 'partial' || status === 'refreshing') {
    const prefix = status === 'partial' ? 'Fuente parcial' : 'Fuente';
    return `${prefix}: ${optimizableBaseReference.sourceLabel}${
      optimizableBaseReference.asOf ? ` · ${formatDateTime(optimizableBaseReference.asOf)}` : ''
    }`;
  }
  if (status === 'loading') return 'Sincronizando base Aurum...';
  if (status === 'missing') return `Sin snapshot publicado en ${optimizableBaseReference.sourceLabel}`;
  if (status === 'error') return `Error leyendo ${optimizableBaseReference.sourceLabel}`;
  return 'Integración Aurum no configurada';
}

const deriveUniverseMetadataFallback = (
  snapshot: InstrumentUniverseSnapshot | null,
): InstrumentUniverseSnapshotMetadata | null => {
  if (!snapshot) return null;
  const validation = validateInstrumentUniverseSnapshot(snapshot);
  return buildInstrumentUniverseSnapshotMetadata(snapshot, validation, {
    source: 'local_cache_legacy',
    loadedAt: snapshot.savedAt,
  });
};

export function SettingsPage({
  optimizableBaseReference,
  aurumIntegrationStatus,
  targetWeights,
  weightsSourceMode,
  universeSourceOrigin,
  activeMixSavedAt,
  activeMixHash,
  localReadOnlyMode = { enabled: false, reason: null },
}: {
  optimizableBaseReference: OptimizableBaseReference;
  aurumIntegrationStatus: AurumIntegrationStatus;
  targetWeights: PortfolioWeights;
  weightsSourceMode: SettingsWeightsSourceMode;
  universeSourceOrigin: SettingsUniverseSourceOrigin;
  activeMixSavedAt: string | null;
  activeMixHash: string | null;
  localReadOnlyMode?: {
    enabled: boolean;
    reason: string | null;
  };
}) {
  const [savedSnapshot, setSavedSnapshot] = useState(() => loadInstrumentBaseSnapshot());
  const [editorValue, setEditorValue] = useState(() => loadInstrumentBaseSnapshot()?.rawJson || '');
  const [validation, setValidation] = useState<InstrumentBaseValidation | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [savedUniverseSnapshot, setSavedUniverseSnapshot] = useState(() => loadInstrumentUniverseSnapshot());
  const [savedUniverseMetadata, setSavedUniverseMetadata] = useState<InstrumentUniverseSnapshotMetadata | null>(
    () => loadInstrumentUniverseSnapshotMetadata() ?? deriveUniverseMetadataFallback(loadInstrumentUniverseSnapshot()),
  );
  const [lastFailedUniverseImport, setLastFailedUniverseImport] = useState<InstrumentUniverseFailedImport | null>(
    () => loadLastFailedInstrumentUniverseImport(),
  );
  const [universeEditorValue, setUniverseEditorValue] = useState(() => loadInstrumentUniverseSnapshot()?.rawJson || '');
  const [universeOriginalFileName, setUniverseOriginalFileName] = useState<string | null>(null);
  const [universeValidation, setUniverseValidation] = useState<InstrumentUniverseValidation | null>(null);
  const [universeStatusMessage, setUniverseStatusMessage] = useState<string>('');
  const [showLegacyRecovery, setShowLegacyRecovery] = useState(false);
  const [legacyRecoveryConfirmed, setLegacyRecoveryConfirmed] = useState(false);

  useEffect(() => {
    const snapshot = loadInstrumentBaseSnapshot();
    setSavedSnapshot(snapshot);
    if (!editorValue.trim() && snapshot?.rawJson) {
      setEditorValue(snapshot.rawJson);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hydrateInstrumentUniverseCacheFromFirestore()
      .then((result) => {
        if (cancelled || !result.ok) return;
        setSavedUniverseSnapshot(result.snapshot);
        setSavedUniverseMetadata(loadInstrumentUniverseSnapshotMetadata() ?? deriveUniverseMetadataFallback(result.snapshot));
        if (!universeEditorValue.trim()) {
          setUniverseEditorValue(result.snapshot.rawJson);
        }
        window.dispatchEvent(new CustomEvent('midas:instrument-universe-updated'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const savedSummary = useMemo(
    () => summarizeInstrumentBase(savedSnapshot, optimizableBaseReference.amountClp),
    [savedSnapshot, optimizableBaseReference.amountClp],
  );
  const savedUniverseSummary = useMemo(
    () => summarizeInstrumentUniverse(savedUniverseSnapshot, targetWeights),
    [savedUniverseSnapshot, targetWeights],
  );
  const coverageQuality = classifyCoverageQuality(savedSummary?.coverageVsOptimizableBaseRatio ?? null);
  const activeMixSource = useMemo(
    () => resolveActiveMixSource({ weightsSourceMode, universeSourceOrigin }),
    [weightsSourceMode, universeSourceOrigin],
  );
  const hasOfficialUniverseSource = activeMixSource.official;
  const currentMix = savedUniverseSummary?.currentMix ?? null;
  const activeUniverseLocalStale =
    Boolean(savedUniverseMetadata?.loadedAt && activeMixSavedAt)
    && new Date(savedUniverseMetadata!.loadedAt).getTime() < new Date(activeMixSavedAt!).getTime();
  const canPersistLegacy =
    !hasOfficialUniverseSource || legacyRecoveryConfirmed;

  const runValidation = () => {
    const next = validateInstrumentBaseJson(editorValue, optimizableBaseReference.amountClp);
    setValidation(next);
    setStatusMessage(next.ok ? 'JSON válido. Puedes guardarlo como base instrumental.' : 'Corrige el JSON antes de guardar.');
    return next;
  };

  const handleSave = () => {
    const next = validation && validation.snapshot?.rawJson === editorValue.trim()
      ? validation
      : validateInstrumentBaseJson(editorValue, optimizableBaseReference.amountClp);
    setValidation(next);
    if (!next.ok || !next.snapshot) {
      setStatusMessage('No pude guardar la base instrumental. Revisa los errores.');
      return;
    }
    saveInstrumentBaseSnapshot(next.snapshot);
    window.dispatchEvent(new CustomEvent('midas:instrument-base-updated'));
    setSavedSnapshot(next.snapshot);
    setStatusMessage('Base instrumental guardada. Puedes reemplazarla con una nueva carga cuando quieras.');
  };

  const handleClearSaved = () => {
    clearInstrumentBaseSnapshot();
    window.dispatchEvent(new CustomEvent('midas:instrument-base-updated'));
    setSavedSnapshot(null);
    setValidation(null);
    setStatusMessage('Base instrumental eliminada de este dispositivo.');
  };

  const runUniverseValidation = () => {
    const next = validateInstrumentUniverseJson(universeEditorValue, targetWeights);
    setUniverseValidation(next);
    setUniverseStatusMessage(
      next.ok
        ? 'Mix válido. Puedes guardarlo como fuente principal.'
        : 'La carga no se aplicó. Corrige el archivo y se mantendrá la última versión válida.',
    );
    return next;
  };

  const handleSaveUniverse = async () => {
    if (
      savedUniverseSnapshot
      && savedUniverseMetadata
      && universeEditorValue.trim() === savedUniverseSnapshot.rawJson.trim()
      && activeUniverseLocalStale
    ) {
      const shouldContinue = typeof window === 'undefined'
        ? false
        : window.confirm(
          'El guardado local parece más antiguo que la fuente activa actual. Si continúas, podrías reintroducir un cache local viejo sobre cloud active. ¿Deseas continuar?',
        );
      if (!shouldContinue) {
        setUniverseStatusMessage('Guardado cancelado: revisa fecha, origen y hash del guardado local antes de sobrescribir cloud.');
        return;
      }
    }
    const next = universeValidation && universeValidation.snapshot?.rawJson === universeEditorValue.trim()
      ? universeValidation
      : validateInstrumentUniverseJson(universeEditorValue, targetWeights);
    setUniverseValidation(next);
    if (!next.ok || !next.snapshot) {
      const failed: InstrumentUniverseFailedImport = {
        attemptedAt: new Date().toISOString(),
        fileName: universeOriginalFileName,
        source: 'settings_upload',
        errors: next.errors,
        warnings: next.warnings,
      };
      saveLastFailedInstrumentUniverseImport(failed);
      setLastFailedUniverseImport(failed);
      setUniverseStatusMessage(
        'La carga no se aplicó. El archivo está vacío o no contiene instrumentos válidos. Se mantiene la última carga válida.',
      );
      return;
    }
    setUniverseStatusMessage('Guardando mix aperturado por instrumento como fuente oficial cloud...');
    const persisted = await persistInstrumentUniverseActiveToFirestore({
      snapshot: next.snapshot,
      fileName: universeOriginalFileName,
      source: 'settings_upload',
    });
    const metadata = buildInstrumentUniverseSnapshotMetadata(next.snapshot, next, {
      fileName: universeOriginalFileName,
      source: persisted.ok ? 'settings_upload' : 'local_cache',
    });
    saveInstrumentUniverseSnapshotWithMetadata(next.snapshot, metadata);
    clearLastFailedInstrumentUniverseImport();
    window.dispatchEvent(new CustomEvent('midas:instrument-universe-updated'));
    setSavedUniverseSnapshot(next.snapshot);
    setSavedUniverseMetadata(metadata);
    setLastFailedUniverseImport(null);
    setUniverseStatusMessage(
      persisted.ok
        ? `Mix aperturado guardado como fuente oficial cloud. ${metadata.instrumentsCount} instrumentos · peso total ${formatPct(metadata.totalWeightPortfolio)}.`
        : `Guardado localmente, pero no quedó como fuente oficial cloud: ${persisted.reason}`,
    );
  };

  const handleClearUniverse = () => {
    clearInstrumentUniverseSnapshot();
    window.dispatchEvent(new CustomEvent('midas:instrument-universe-updated'));
    setSavedUniverseSnapshot(null);
    setSavedUniverseMetadata(null);
    setUniverseValidation(null);
    setUniverseStatusMessage('Cache local eliminado. La versión active persistida en Firestore no se borra desde esta acción.');
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {localReadOnlyMode.enabled && (
        <section
          style={{
            border: `1px solid rgba(212,166,90,0.35)`,
            background: 'rgba(212,166,90,0.08)',
            borderRadius: 18,
            padding: '14px 16px',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ color: '#F3D38A', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Modo local de revisión
          </div>
          <div style={{ color: T.warning, fontSize: 13, lineHeight: 1.5 }}>
            {localReadOnlyMode.reason ?? 'Configuración cloud no disponible. Las escrituras productivas quedan deshabilitadas en este dispositivo.'}
          </div>
        </section>
      )}

      <section
        style={{
          border: `1px solid ${activeMixSource.tone === 'negative' ? 'rgba(212,90,90,0.35)' : activeMixSource.tone === 'warning' ? 'rgba(212,166,90,0.35)' : 'rgba(63,191,127,0.35)'}`,
          background: activeMixSource.tone === 'negative' ? 'rgba(212,90,90,0.08)' : activeMixSource.tone === 'warning' ? 'rgba(212,166,90,0.08)' : 'rgba(63,191,127,0.08)',
          borderRadius: 24,
          padding: 18,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
          Ajustes · Fuente activa
        </div>
        <div style={{ color: T.textPrimary, fontSize: 22, fontWeight: 800 }}>{activeMixSource.title}</div>
        <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>{activeMixSource.subtitle}</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Origen runtime: {universeSourceOrigin} · guardado activo {formatDateTime(activeMixSavedAt)} · hash {shortHash(activeMixHash)}
        </div>
        {activeMixSource.warning && (
          <div style={{ color: activeMixSource.tone === 'warning' ? T.warning : T.negative, fontSize: 13, fontWeight: 700 }}>
            {activeMixSource.warning}
          </div>
        )}
      </section>

      <section
        style={{
          border: `1px solid ${T.border}`,
          background: T.surface,
          borderRadius: 24,
          padding: 18,
          display: 'grid',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em', color: T.textMuted }}>
            Capital económico oficial
          </div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 28, lineHeight: 1.08 }}>Capital económico oficial</h2>
          <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.5 }}>
            Este monto viene desde Aurum y define el capital económico de simulación. El mix estructural se toma desde Instrument Universe V1.
          </div>
        </div>
        <SummaryCard
          title="Inversiones optimizables"
          value={formatMoneyClp(optimizableBaseReference.amountClp)}
          subtitle={normalizeVisibleText(aurumBaseSubtitle(aurumIntegrationStatus, optimizableBaseReference))}
        />
      </section>

      <section
        style={{
          border: `1px solid ${T.border}`,
          background: T.surface,
          borderRadius: 24,
          padding: 18,
          display: 'grid',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em', color: T.textMuted }}>
            Fuente oficial de mix
          </div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 24, lineHeight: 1.08 }}>Instrument Universe V1</h2>
          <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
            Solo este flujo debe usarse normalmente para actualizar el mix estructural.
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            background: T.surfaceEl,
            borderRadius: 18,
            padding: 14,
            display: 'grid',
            gap: 8,
          }}
        >
          {savedUniverseSnapshot && savedUniverseMetadata ? (
            <>
              <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700 }}>
                Última carga válida: {formatDateTime(savedUniverseMetadata.loadedAt)}
              </div>
              <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
                Fuente: {normalizeVisibleText(savedUniverseMetadata.source)} · archivo {normalizeVisibleText(savedUniverseMetadata.fileName || 'manual')} · hash {shortHash(savedUniverseMetadata.checksum)}
              </div>
              <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
                Instrumentos {savedUniverseMetadata.validInstrumentsCount}/{savedUniverseMetadata.instrumentsCount} · peso útil {formatPct(savedUniverseMetadata.totalWeightPortfolio)} · monto total universe {formatMoneyClp(savedUniverseMetadata.totalAmountClp)} · estado válido
              </div>
              <div style={{ color: T.textMuted, fontSize: 12, lineHeight: 1.5 }}>
                {hasOfficialUniverseSource
                  ? 'Fuente oficial de mix: Instrument Universe V1. El capital económico viene desde Aurum; este universe define pesos y composición RV/RF.'
                  : 'No hay Instrument Universe V1 activo como fuente oficial de mix. El capital económico sigue viniendo desde Aurum.'}
              </div>
              {savedUniverseMetadata.warnings.length > 0 && (
                <div style={{ color: T.warning, fontSize: 12, display: 'grid', gap: 5 }}>
                  {savedUniverseMetadata.warnings.slice(0, 4).map((warning) => (
                    <div key={warning}>• {normalizeVisibleText(warning)}</div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: T.textSecondary, fontSize: 13 }}>
              No hay Instrument Universe V1 válido. Carga un universe oficial para habilitar el mix estructural.
            </div>
          )}
          {lastFailedUniverseImport && (
            <div
              style={{
                borderRadius: 14,
                border: `1px solid rgba(212,90,90,0.35)`,
                background: 'rgba(212,90,90,0.08)',
                color: T.negative,
                padding: '10px 12px',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              No se aplicó la última carga. El archivo no contiene instrumentos válidos. Se mantiene la última versión válida.
            </div>
          )}
        </div>

        {savedUniverseSummary && (
          <>
            <UniverseSummaryPanel summary={savedUniverseSummary} />
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
                Tabla de instrumentos
              </div>
              <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
                Driver estructural indica relevancia diagnóstica u operativa. Un instrumento entra al mix si tiene peso útil mayor que cero y datos utilizables.
              </div>
            </div>
            <InstrumentUniverseTable snapshot={savedUniverseSnapshot} />
            {savedUniverseSummary.warnings.length > 0 && (
              <div style={{ color: T.warning, fontSize: 12, display: 'grid', gap: 5 }}>
                {savedUniverseSummary.warnings.slice(0, 12).map((warning) => (
                  <div key={warning}>• {normalizeVisibleText(warning)}</div>
                ))}
                {savedUniverseSummary.warnings.length > 12 && (
                  <div>• Hay {savedUniverseSummary.warnings.length - 12} warning(s) adicionales.</div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section
        style={{
          border: `1px solid ${T.border}`,
          background: T.surface,
          borderRadius: 24,
          padding: 18,
          display: 'grid',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em', color: T.textMuted }}>
            Cargar Instrument Universe V1
          </div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 24, lineHeight: 1.08 }}>Carga oficial del Instrument Universe</h2>
          <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
            Solo se aplica si valida correctamente. Si falla, se conserva la última fuente válida.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
              JSON oficial
            </div>
            <div style={{ marginTop: 6, color: T.textSecondary, fontSize: 13 }}>
              Cargar archivo → Validar universe → Guardar mix aperturado cloud.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label
              style={{
                borderRadius: 14,
                border: `1px solid ${T.border}`,
                background: T.surfaceEl,
                color: T.textPrimary,
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cargar archivo
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input?.files?.[0];
                  if (!file) return;
                  setUniverseEditorValue(await file.text());
                  setUniverseOriginalFileName(file.name);
                  setUniverseStatusMessage(`Archivo cargado: ${normalizeVisibleText(file.name)}`);
                  if (input) input.value = '';
                }}
              />
            </label>
            {savedUniverseSnapshot && (
              <button
                type="button"
                onClick={() => setUniverseEditorValue(savedUniverseSnapshot.rawJson)}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${T.border}`,
                  background: T.surfaceEl,
                  color: T.textPrimary,
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cargar guardado local
              </button>
            )}
          </div>
        </div>

        {savedUniverseMetadata && (
          <div style={{ color: T.textMuted, fontSize: 12, lineHeight: 1.5 }}>
            Guardado local disponible: origen {normalizeVisibleText(savedUniverseMetadata.source)} · fecha {formatDateTime(savedUniverseMetadata.loadedAt)} · hash {shortHash(savedUniverseMetadata.checksum)}
            {activeUniverseLocalStale ? ' · Advertencia: el guardado local parece más antiguo que la fuente activa actual.' : ''}
          </div>
        )}

        <textarea
          value={universeEditorValue}
          onChange={(event) => {
            setUniverseEditorValue(event.target.value);
            setUniverseOriginalFileName(null);
            setUniverseStatusMessage('');
          }}
          placeholder={placeholderUniverseJson}
          spellCheck={false}
          style={{
            ...css.mono,
            width: '100%',
            minHeight: 260,
            resize: 'vertical',
            borderRadius: 18,
            border: `1px solid ${T.border}`,
            background: '#101522',
            color: T.textPrimary,
            padding: 14,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={runUniverseValidation}
            style={{
              borderRadius: 14,
              border: `1px solid ${T.primaryStrong}`,
              background: T.primaryStrong,
              color: '#fff',
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Validar universe
          </button>
          <button
            type="button"
            onClick={handleSaveUniverse}
            disabled={localReadOnlyMode.enabled}
            style={{
              borderRadius: 14,
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              color: localReadOnlyMode.enabled ? T.textMuted : T.textPrimary,
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: 700,
              cursor: localReadOnlyMode.enabled ? 'not-allowed' : 'pointer',
              opacity: localReadOnlyMode.enabled ? 0.6 : 1,
            }}
          >
            Guardar mix aperturado cloud
          </button>
          {savedUniverseSnapshot && (
            <button
              type="button"
              onClick={handleClearUniverse}
              disabled={localReadOnlyMode.enabled}
              style={{
                borderRadius: 14,
                border: `1px solid ${T.negative}`,
                background: 'transparent',
                color: T.negative,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: localReadOnlyMode.enabled ? 'not-allowed' : 'pointer',
                opacity: localReadOnlyMode.enabled ? 0.6 : 1,
              }}
            >
              Eliminar universe
            </button>
          )}
        </div>

        {universeStatusMessage && (
          <div
            style={{
              borderRadius: 16,
              border: `1px solid ${universeValidation?.ok ? 'rgba(63,191,127,0.35)' : 'rgba(212,90,90,0.35)'}`,
              background: universeValidation?.ok ? 'rgba(63,191,127,0.08)' : 'rgba(212,90,90,0.08)',
              color: universeValidation?.ok ? T.positive : T.textSecondary,
              padding: '12px 14px',
              fontSize: 13,
            }}
          >
            {normalizeVisibleText(universeStatusMessage)}
          </div>
        )}

        {universeValidation && (
          <div
            style={{
              display: 'grid',
              gap: 10,
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              borderRadius: 18,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
              Resultado de validación universe
            </div>
            {universeValidation.errors.length > 0 && (
              <div style={{ color: T.negative, fontSize: 13, display: 'grid', gap: 6 }}>
                {universeValidation.errors.map((error) => (
                  <div key={error}>• {normalizeVisibleText(error)}</div>
                ))}
              </div>
            )}
            {universeValidation.summary && <UniverseSummaryPanel summary={universeValidation.summary} />}
            {universeValidation.warnings.length > 0 && (
              <div style={{ color: T.warning, fontSize: 12, display: 'grid', gap: 5 }}>
                {universeValidation.warnings.slice(0, 12).map((warning) => (
                  <div key={warning}>• {normalizeVisibleText(warning)}</div>
                ))}
                {universeValidation.warnings.length > 12 && (
                  <div>• Hay {universeValidation.warnings.length - 12} warning(s) adicionales.</div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <details
        open={showLegacyRecovery}
        onToggle={(event) => setShowLegacyRecovery((event.currentTarget as HTMLDetailsElement).open)}
        style={{
          border: `1px solid ${T.border}`,
          background: T.surface,
          borderRadius: 24,
          padding: 18,
        }}
      >
        <summary style={{ cursor: 'pointer', color: T.textPrimary, fontWeight: 700 }}>
          Recuperación legacy avanzada
        </summary>
        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          <div style={{ color: T.warning, fontSize: 13, lineHeight: 1.5 }}>
            Esta fuente está deprecated, puede estar desactualizada y no es la fuente oficial. No usar salvo recuperación técnica.
          </div>
          {hasOfficialUniverseSource && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.textSecondary, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={legacyRecoveryConfirmed}
                onChange={(event) => setLegacyRecoveryConfirmed(event.target.checked)}
              />
              <span>Confirmo que deseo habilitar recuperación legacy aunque exista un Instrument Universe V1 válido.</span>
            </label>
          )}
          <div style={{ color: T.textSecondary, fontSize: 13 }}>
            Soporta arreglo directo o objeto con `instruments` / `instrumentos` (incluye campos en español).
          </div>
          {savedSnapshot && (
            <button
              type="button"
              onClick={() => setEditorValue(savedSnapshot.rawJson)}
              style={{
                borderRadius: 14,
                border: `1px solid ${T.border}`,
                background: T.surfaceEl,
                color: T.textPrimary,
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                justifySelf: 'start',
              }}
            >
              Cargar guardado legacy local
            </button>
          )}
          <textarea
            value={editorValue}
            onChange={(event) => {
              setEditorValue(event.target.value);
              setStatusMessage('');
            }}
            placeholder={placeholderJson}
            spellCheck={false}
            style={{
              ...css.mono,
              width: '100%',
              minHeight: 220,
              resize: 'vertical',
              borderRadius: 18,
              border: `1px solid ${T.border}`,
              background: '#101522',
              color: T.textPrimary,
              padding: 14,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={runValidation}
              style={{
                borderRadius: 14,
                border: `1px solid ${T.primaryStrong}`,
                background: T.primaryStrong,
                color: '#fff',
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Validar JSON legacy
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={localReadOnlyMode.enabled || !canPersistLegacy}
              style={{
                borderRadius: 14,
                border: `1px solid ${T.border}`,
                background: T.surfaceEl,
                color: localReadOnlyMode.enabled || !canPersistLegacy ? T.textMuted : T.textPrimary,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: localReadOnlyMode.enabled || !canPersistLegacy ? 'not-allowed' : 'pointer',
                opacity: localReadOnlyMode.enabled || !canPersistLegacy ? 0.6 : 1,
              }}
            >
              Guardar recuperación legacy
            </button>
            {savedSnapshot && (
              <button
                type="button"
                onClick={handleClearSaved}
                disabled={localReadOnlyMode.enabled}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${T.negative}`,
                  background: 'transparent',
                  color: T.negative,
                  padding: '12px 16px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: localReadOnlyMode.enabled ? 'not-allowed' : 'pointer',
                  opacity: localReadOnlyMode.enabled ? 0.6 : 1,
                }}
              >
                Eliminar base legacy guardada
              </button>
            )}
          </div>

          {savedSummary && (
            <>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <SummaryCard
                  title="Instrumentos legacy"
                  value={String(savedSummary.instrumentCount)}
                  subtitle={`${savedSummary.managerCount} administradora(s)`}
                />
                <SummaryCard
                  title="Base legacy cargada"
                  value={formatMoneyClp(savedSummary.totalAmountCLP)}
                  subtitle={`Última actualización: ${formatDateTime(savedSnapshot?.savedAt || null)}`}
                />
                <SummaryCard
                  title="Cobertura legacy"
                  value={formatPct(savedSummary.coverageVsOptimizableBaseRatio)}
                  subtitle={`Calidad: ${
                    coverageQuality === 'high'
                      ? 'alta'
                      : coverageQuality === 'partial'
                        ? 'parcial'
                        : coverageQuality === 'insufficient'
                          ? 'insuficiente'
                          : 'sin referencia'
                  } · Diferencia: ${formatMoneyClp(savedSummary.differenceVsOptimizableBaseClp)}`}
                />
              </div>
              <ExposureSummary summary={savedSummary} />
            </>
          )}

          {statusMessage && (
            <div
              style={{
                borderRadius: 16,
                border: `1px solid ${validation?.ok ? 'rgba(63,191,127,0.35)' : 'rgba(212,90,90,0.35)'}`,
                background: validation?.ok ? 'rgba(63,191,127,0.08)' : 'rgba(212,90,90,0.08)',
                color: validation?.ok ? T.positive : T.negative,
                padding: '12px 14px',
                fontSize: 13,
              }}
            >
              {normalizeVisibleText(statusMessage)}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
