import React, { useEffect, useMemo, useState } from 'react';
import {
  clearInstrumentBaseSnapshot,
  loadInstrumentBaseSnapshot,
  type OptimizableBaseReference,
  saveInstrumentBaseSnapshot,
  summarizeInstrumentBase,
  validateInstrumentBaseJson,
  type InstrumentBaseSummary,
  type InstrumentBaseValidation,
} from '../domain/instrumentBase';
import { T, css } from './theme';

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
  "version": 1,
  "instruments": [
    {
      "name": "Fondo A",
      "manager": "BTG",
      "currentAmountCLP": 350000000,
      "exposure": {
        "rv": 0.60,
        "rf": 0.40,
        "global": 0.75,
        "local": 0.25
      }
    }
  ]
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

export function SettingsPage({ optimizableBaseReference }: { optimizableBaseReference: OptimizableBaseReference }) {
  const [savedSnapshot, setSavedSnapshot] = useState(() => loadInstrumentBaseSnapshot());
  const [editorValue, setEditorValue] = useState(() => loadInstrumentBaseSnapshot()?.rawJson || '');
  const [validation, setValidation] = useState<InstrumentBaseValidation | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

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
    setSavedSnapshot(next.snapshot);
    setStatusMessage('Base instrumental guardada. Puedes reemplazarla con una nueva carga cuando quieras.');
  };

  const handleClearSaved = () => {
    clearInstrumentBaseSnapshot();
    setSavedSnapshot(null);
    setValidation(null);
    setStatusMessage('Base instrumental eliminada de este dispositivo.');
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
            Pega una base JSON semiestática de instrumentos reales. Esta capa queda guardada aparte y todavía no alimenta el optimizador.
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
          subtitle={
            optimizableBaseReference.status === 'available'
              ? `Fuente: ${optimizableBaseReference.sourceLabel}${optimizableBaseReference.asOf ? ` · ${formatDateTime(optimizableBaseReference.asOf)}` : ''}`
              : `Pendiente de conexión con ${optimizableBaseReference.sourceLabel}`
          }
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
                subtitle={`Diferencia vs base optimizable: ${formatMoneyClp(savedSummary.differenceVsOptimizableBaseClp)}`}
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
              Soporta arreglo directo o objeto con `instruments`.
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
    </div>
  );
}
