import React from 'react';
import type { SimulationResults } from '../domain/model/types';
import { T, css } from './theme';
import { HeroCard } from './HeroCard';

export function SimulationPage({ result }: { result: SimulationResults | null }) {
  const probSuccess = result ? 1 - result.probRuin : null;
  const ruinPct = result ? result.probRuin * 100 : null;
  const ruinMedian = result?.ruinTimingMedian ?? null;
  const interval = probSuccess === null ? null : [Math.max(0, probSuccess - 0.06), Math.min(1, probSuccess + 0.06)];
  const spendRatio = result?.spendingRatioMedian ?? null;
  const p50 = result?.terminalWealthPercentiles[50] ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <HeroCard
        label="¿LLEGARÁS AL AÑO 40?"
        valuePct={probSuccess}
        subtitle={result ? `${Math.round(result.nRuin)} de ${result.nTotal} simulaciones en ruina` : 'Corre una simulación para ver resultados'}
        ruinCopy={ruinMedian ? `Timing mediano Año ${(ruinMedian / 12).toFixed(1)}` : 'Timing mediano: —'}
      />

      {interval && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>RANGO ESTIMADO</div>
          <div style={{ marginTop: 10, height: 10, background: T.surfaceEl, borderRadius: 10, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                left: `${interval[0] * 100}%`,
                right: `${(1 - interval[1]) * 100}%`,
                top: 0,
                bottom: 0,
                background: T.primary,
                borderRadius: 10,
                opacity: 0.8,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, ...css.mono, color: T.textSecondary }}>
            <span>{(interval[0] * 100).toFixed(1)}%</span>
            <span>{(interval[1] * 100).toFixed(1)}%</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 8 }}>
            Refleja incertidumbre en los supuestos del modelo (±6 pp)
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
        <InfoCard
          label="Gasto efectivo / planificado"
          value={spendRatio !== null ? `${(spendRatio * 100).toFixed(1)}%` : '—'}
        />
        <InfoCard
          label="Patrimonio P50"
          value={p50 !== null ? `$${(p50 / 1e9).toFixed(2)}B` : '—'}
        />
      </div>

      {result && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>FAN CHART</div>
            <div style={{ height: 240, marginTop: 8, color: T.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${T.border}`, borderRadius: 10 }}>
              Fan chart placeholder (usa recharts aquí)
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PERCENTILES</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
              {([5, 25, 50, 75, 90, 95] as const).map((p) => (
                <div key={p} style={{ background: T.surfaceEl, borderRadius: 8, padding: 8 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>P{p}</div>
                  <div style={{ ...css.mono, color: T.textPrimary, fontSize: 13, marginTop: 4 }}>
                    {result.terminalWealthPercentiles[p] !== undefined
                      ? `$${(result.terminalWealthPercentiles[p] / 1e9).toFixed(2)}B`
                      : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em', marginBottom: 4 }}>TCREAL</div>
            <div style={{ color: T.warning, fontSize: 12 }}>
              PRELIMINARY: Este parámetro usa supuestos internos, revísalo antes de tomar decisiones.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, fontSize: 18, fontWeight: 700, color: T.textPrimary, marginTop: 6 }}>{value}</div>
    </div>
  );
}
