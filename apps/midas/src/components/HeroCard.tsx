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
  const tone =
    valuePct === null
      ? T.textMuted
      : valuePct > 0.9
        ? T.positive
        : valuePct >= 0.8
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
        {valuePct === null ? '—' : `${(valuePct * 100).toFixed(1)}%`}
      </div>
      {subtitle && (
        <div style={{ color: T.textSecondary, fontSize: 13, marginTop: 6 }}>
          {subtitle}
        </div>
      )}
      <div style={{ height: 1, background: T.border, margin: '12px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: T.textSecondary, fontSize: 12 }}>
        <span>Prob. ruina {valuePct === null ? '—' : `${(100 - valuePct * 100).toFixed(1)}%`}</span>
        <span>{ruinCopy ?? 'Timing mediano: —'}</span>
      </div>
    </div>
  );
}
