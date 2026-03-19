import React from 'react';
import { T, css } from './theme';

export function HeroCard({
  label,
  valuePct,
  subtitle,
  ruinCopy,
}: {
  label: string;
  valuePct: number | null;
  subtitle?: string;
  ruinCopy?: string;
}) {
  const pct = valuePct === null ? null : valuePct * 100;
  const tone =
    pct === null
      ? T.textMuted
      : pct > 92
        ? T.positive
        : pct >= 85
          ? T.warning
          : T.negative;
  const rangeMin = 75;
  const rangeMax = 100;
  const segStart = pct === null ? null : Math.max(rangeMin, pct - 6);
  const segEnd = pct === null ? null : Math.min(rangeMax, pct + 6);
  const segLeft = segStart === null ? 0 : ((segStart - rangeMin) / (rangeMax - rangeMin)) * 100;
  const segRight = segEnd === null ? 0 : ((segEnd - rangeMin) / (rangeMax - rangeMin)) * 100;
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          ...css.mono,
          fontSize: 72,
          fontWeight: 700,
          lineHeight: 1,
          color: tone,
          marginTop: 8,
        }}
      >
        {pct === null ? '—' : `${pct.toFixed(1)}%`}
      </div>
      {subtitle && (
        <div style={{ color: T.textSecondary, fontSize: 13, marginTop: 6 }}>
          {subtitle}
        </div>
      )}
      {pct !== null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...css.mono, color: T.textSecondary, fontSize: 11 }}>{segStart?.toFixed(1)}%</span>
            <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 8, position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: `${segLeft}%`,
                  width: `${Math.max(0, segRight - segLeft)}%`,
                  top: 0,
                  bottom: 0,
                  background: tone,
                  borderRadius: 8,
                }}
              />
            </div>
            <span style={{ ...css.mono, color: T.textSecondary, fontSize: 11 }}>{segEnd?.toFixed(1)}%</span>
          </div>
        </div>
      )}
      <div style={{ height: 1, background: T.border, margin: '12px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: T.textSecondary, fontSize: 12 }}>
        <span>Prob. ruina {pct === null ? '—' : `${(100 - pct).toFixed(1)}%`}</span>
        <span>{ruinCopy ?? 'Timing mediano: —'}</span>
      </div>
    </div>
  );
}
