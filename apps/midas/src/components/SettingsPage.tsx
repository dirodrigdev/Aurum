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
  clearInstrumentUniverseSnapshot,
  loadInstrumentUniverseSnapshot,
  saveInstrumentUniverseSnapshot,
  summarizeInstrumentUniverse,
  validateInstrumentUniverseJson,
  type InstrumentUniverseSnapshot,
  type InstrumentUniverseSummary,
  type InstrumentUniverseValidation,
} from '../domain/instrumentUniverse';
import type { PortfolioWeights } from '../domain/model/types';
import { T, css } from './theme';
type AurumIntegrationStatus = 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <SummaryCard
          title="Instrumentos universo"
          value={`${summary.usableInstrumentCount}/${summary.instrumentCount}`}
          subtitle={`Peso útil: ${formatPct(summary.totalWeightPortfolio)}`}
        />
        <SummaryCard
          title="Current mix"
          value={currentMix ? `RV ${formatPct(currentMix.rv)} / RF ${formatPct(currentMix.rf)}` : '—'}
          subtitle={currentMix ? `Cash ${formatPct(currentMix.cash)} · Other ${formatPct(currentMix.other)}` : 'Sin mix utilizable'}
        />
        <SummaryCard
          title="Banda histórica RV"
          value={historical ? formatRvBand(historical.rv.min, historical.rv.max) : '—'}
          subtitle={historical ? `Target: ${formatPct(targetRv)} · ${gapLabel}` : 'Sin banda histórica'}
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
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
        <thead>
          <tr style={{ background: T.surfaceEl, color: T.textMuted, fontSize: 11, textAlign: 'left' }}>
            {['Instrumento', 'Peso', 'Mix usado', 'Rango operativo RV', 'Conf.', 'Fuente', 'Driver', 'Warnings'].map((label) => (
              <th key={label} style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.instruments.map((item) => (
            <tr key={item.instrumentId} style={{ borderBottom: `1px solid ${T.border}`, color: T.textSecondary, fontSize: 12 }}>
              <td style={{ padding: '10px 12px', color: T.textPrimary, fontWeight: 700 }}>
                {item.name || item.instrumentId}
                <div style={{ color: T.textMuted, fontSize: 10 }}>{item.instrumentId}</div>
              </td>
              <td style={{ padding: '10px 12px' }}>{formatPct(item.weightPortfolio)}</td>
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
              <td style={{ padding: '10px 12px' }}>{item.sourcePreference || '—'}</td>
              <td style={{ padding: '10px 12px' }}>{item.structuralMixDriver || '—'}</td>
              <td style={{ padding: '10px 12px', color: item.usable ? T.textMuted : T.warning }}>
                {item.missingCriticalFields.length
                  ? `Faltan: ${item.missingCriticalFields.join(', ')}`
                  : item.warnings.join(' · ') || 'OK'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

export function SettingsPage({
  optimizableBaseReference,
  aurumIntegrationStatus,
  targetWeights,
}: {
  optimizableBaseReference: OptimizableBaseReference;
  aurumIntegrationStatus: AurumIntegrationStatus;
  targetWeights: PortfolioWeights;
}) {
  const [savedSnapshot, setSavedSnapshot] = useState(() => loadInstrumentBaseSnapshot());
  const [editorValue, setEditorValue] = useState(() => loadInstrumentBaseSnapshot()?.rawJson || '');
  const [validation, setValidation] = useState<InstrumentBaseValidation | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [savedUniverseSnapshot, setSavedUniverseSnapshot] = useState(() => loadInstrumentUniverseSnapshot());
  const [universeEditorValue, setUniverseEditorValue] = useState(() => loadInstrumentUniverseSnapshot()?.rawJson || '');
  const [universeValidation, setUniverseValidation] = useState<InstrumentUniverseValidation | null>(null);
  const [universeStatusMessage, setUniverseStatusMessage] = useState<string>('');

  useEffect(() => {
    const snapshot = loadInstrumentBaseSnapshot();
    setSavedSnapshot(snapshot);
    if (!editorValue.trim() && snapshot?.rawJson) {
      setEditorValue(snapshot.rawJson);
    }
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
    setUniverseStatusMessage(next.ok ? 'Universe válido. Puedes guardarlo como contrato paralelo.' : 'Corrige el universe antes de guardar.');
    return next;
  };

  const handleSaveUniverse = () => {
    const next = universeValidation && universeValidation.snapshot?.rawJson === universeEditorValue.trim()
      ? universeValidation
      : validateInstrumentUniverseJson(universeEditorValue, targetWeights);
    setUniverseValidation(next);
    if (!next.ok || !next.snapshot) {
      setUniverseStatusMessage('No pude guardar instrument_universe. Revisa errores.');
      return;
    }
    saveInstrumentUniverseSnapshot(next.snapshot);
    setSavedUniverseSnapshot(next.snapshot);
    setUniverseStatusMessage('Instrument universe guardado en paralelo. No reemplaza la base instrumental actual.');
  };

  const handleClearUniverse = () => {
    clearInstrumentUniverseSnapshot();
    setSavedUniverseSnapshot(null);
    setUniverseValidation(null);
    setUniverseStatusMessage('Instrument universe eliminado de este dispositivo.');
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
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
            Ajustes
          </div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 28, lineHeight: 1.08 }}>Base instrumental real</h2>
          <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.5 }}>
            Pega una base JSON semiestática de instrumentos reales. Esta capa define la distribución oficial (weights) para simulación y optimizador.
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            background: T.surfaceEl,
            borderRadius: 18,
            padding: 14,
            color: T.textSecondary,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          La cobertura se compara contra la <strong style={{ color: T.textPrimary }}>base optimizable oficial</strong>, que debe venir desde Aurum / último cierre confirmado.
        </div>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <SummaryCard
          title="Inversiones optimizables"
          value={formatMoneyClp(optimizableBaseReference.amountClp)}
          subtitle={aurumBaseSubtitle(aurumIntegrationStatus, optimizableBaseReference)}
        />
        {savedSummary && (
          <>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <SummaryCard
                title="Instrumentos guardados"
                value={String(savedSummary.instrumentCount)}
                subtitle={`${savedSummary.managerCount} administradora(s)`}
              />
              <SummaryCard
                title="Base instrumental cargada"
                value={formatMoneyClp(savedSummary.totalAmountCLP)}
                subtitle={`Última actualización: ${formatDateTime(savedSnapshot?.savedAt || null)}`}
              />
              <SummaryCard
                title="Cobertura"
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
              Pegar JSON
            </div>
            <div style={{ marginTop: 6, color: T.textSecondary, fontSize: 13 }}>
              Soporta arreglo directo o objeto con `instruments` / `instrumentos` (incluye campos en español).
            </div>
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
              }}
            >
              Cargar guardado en editor
            </button>
          )}
        </div>

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
            Validar JSON
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              borderRadius: 14,
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              color: T.textPrimary,
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Guardar / reemplazar base
          </button>
          {savedSnapshot && (
            <button
              type="button"
              onClick={handleClearSaved}
              style={{
                borderRadius: 14,
                border: `1px solid ${T.negative}`,
                background: 'transparent',
                color: T.negative,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Eliminar base guardada
            </button>
          )}
        </div>

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
            {statusMessage}
          </div>
        )}

        {validation && (
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
              Resultado de validación
            </div>
            {validation.errors.length > 0 && (
              <div style={{ color: T.negative, fontSize: 13, display: 'grid', gap: 6 }}>
                {validation.errors.map((error) => (
                  <div key={error}>• {error}</div>
                ))}
              </div>
            )}
            {validation.warnings.length > 0 && (
              <div style={{ color: T.warning, fontSize: 13, display: 'grid', gap: 6 }}>
                {validation.warnings.map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
              </div>
            )}
            {validation.summary && (
              <div style={{ color: T.textSecondary, fontSize: 13, display: 'grid', gap: 6 }}>
                <div>Instrumentos válidos: <strong style={{ color: T.textPrimary }}>{validation.summary.instrumentCount}</strong></div>
                <div>Total cargado: <strong style={{ color: T.textPrimary }}>{formatMoneyClp(validation.summary.totalAmountCLP)}</strong></div>
                <div>Cobertura estimada: <strong style={{ color: T.textPrimary }}>{formatPct(validation.summary.coverageVsOptimizableBaseRatio)}</strong></div>
                <div>Diferencia vs base optimizable: <strong style={{ color: T.textPrimary }}>{formatMoneyClp(validation.summary.differenceVsOptimizableBaseClp)}</strong></div>
              </div>
            )}
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
            Instrument universe v1
          </div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 24, lineHeight: 1.08 }}>Panel técnico paralelo</h2>
          <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
            Carga y valida el nuevo schema sin fusionarlo con la base instrumental actual ni con el optimizador.
          </div>
        </div>

        {savedUniverseSummary && (
          <>
            <UniverseSummaryPanel summary={savedUniverseSummary} />
            <InstrumentUniverseTable snapshot={savedUniverseSnapshot} />
            {savedUniverseSummary.warnings.length > 0 && (
              <div style={{ color: T.warning, fontSize: 12, display: 'grid', gap: 5 }}>
                {savedUniverseSummary.warnings.slice(0, 12).map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
                {savedUniverseSummary.warnings.length > 12 && (
                  <div>• Hay {savedUniverseSummary.warnings.length - 12} warning(s) adicionales.</div>
                )}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted }}>
              Cargar instrument_universe.json
            </div>
            <div style={{ marginTop: 6, color: T.textSecondary, fontSize: 13 }}>
              Acepta archivo JSON o pegado manual. Se guarda en storage separado: midas.instrument-universe.v1.
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
                  setUniverseStatusMessage(`Archivo cargado: ${file.name}`);
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
                Cargar guardado
              </button>
            )}
          </div>
        </div>

        <textarea
          value={universeEditorValue}
          onChange={(event) => {
            setUniverseEditorValue(event.target.value);
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
            style={{
              borderRadius: 14,
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              color: T.textPrimary,
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Guardar universe
          </button>
          {savedUniverseSnapshot && (
            <button
              type="button"
              onClick={handleClearUniverse}
              style={{
                borderRadius: 14,
                border: `1px solid ${T.negative}`,
                background: 'transparent',
                color: T.negative,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
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
            {universeStatusMessage}
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
                  <div key={error}>• {error}</div>
                ))}
              </div>
            )}
            {universeValidation.summary && <UniverseSummaryPanel summary={universeValidation.summary} />}
            {universeValidation.warnings.length > 0 && (
              <div style={{ color: T.warning, fontSize: 12, display: 'grid', gap: 5 }}>
                {universeValidation.warnings.slice(0, 12).map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
                {universeValidation.warnings.length > 12 && (
                  <div>• Hay {universeValidation.warnings.length - 12} warning(s) adicionales.</div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
