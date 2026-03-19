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
      <div style={{ height: 1, background: T.border, margin: '12px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: T.textSecondary, fontSize: 12 }}>
        <span>Prob. ruina {pct === null ? '—' : `${(100 - pct).toFixed(1)}%`}</span>
        <span>{ruinCopy ?? 'Timing mediano: —'}</span>
      </div>
    </div>
  );
}
