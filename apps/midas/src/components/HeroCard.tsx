import React from 'react';
import { T, css } from './theme';

export function HeroCard({
  label,
  valuePct,
  subtitle,
  ruinCopy,
  chips,
  mode = 'real',
  stateLabel,
  onStateClick,
}: {
  label: string;
  valuePct: number | null;
  subtitle?: string;
  ruinCopy?: string;
  chips?: Array<{ id: string; value: string; onClick: () => void }>;
  mode?: 'real' | 'sim';
  stateLabel?: string;
  onStateClick?: () => void;
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
  const simMode = mode === 'sim';
  return (
    <div
      style={{
        background: simMode ? 'rgba(91, 140, 255, 0.08)' : T.surface,
        border: simMode ? `1px solid ${T.primary}` : `1px solid ${T.border}`,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onStateClick}
            disabled={!onStateClick}
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: T.primary,
              background: 'rgba(91, 140, 255, 0.18)',
              border: `1px solid ${T.primary}`,
              padding: '4px 10px',
              borderRadius: 999,
              cursor: onStateClick ? 'pointer' : 'default',
              opacity: onStateClick ? 1 : 0.6,
            }}
          >
            {stateLabel ?? (simMode ? 'SIMULACIÓN' : 'BASE')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'flex-start' }}>
        <div
          style={{
            ...css.mono,
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1,
            color: tone,
            minWidth: 0,
            flex: 1,
          }}
        >
          {pct === null ? '—' : `${pct.toFixed(1)}%`}
        </div>
        {chips && chips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chips.map((chip) => (
              <button
                key={chip.id}
                onClick={chip.onClick}
                style={{
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  color: T.textSecondary,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '6px 10px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  minWidth: 96,
                  textAlign: 'center',
                }}
              >
                {chip.value}
              </button>
            ))}
          </div>
        )}
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
