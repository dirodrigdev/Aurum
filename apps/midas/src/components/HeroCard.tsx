import React, { useEffect, useState } from 'react';
import { T, css } from './theme';

export function HeroCard({
  label,
  valuePct,
  subtitle,
  ruinCopy,
  labelAccessory,
  chips,
  mode = 'real',
  stale = false,
}: {
  label: string;
  valuePct: number | null;
  subtitle?: string;
  ruinCopy?: string;
  labelAccessory?: React.ReactNode;
  chips?: Array<{ id: string; value: string; onClick: () => void; accessory?: React.ReactNode; note?: string }>;
  mode?: 'real' | 'sim';
  stale?: boolean;
}) {
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 760 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobileViewport(window.innerWidth <= 760);
    onResize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pct = valuePct === null ? null : valuePct * 100;
  const tone =
    pct === null
      ? T.textMuted
      : pct > 92
        ? T.positive
        : pct >= 85
          ? T.warning
          : T.negative;
  const valueTone = stale ? 'rgba(178, 187, 201, 0.68)' : tone;
  const simMode = mode === 'sim';
  return (
    <div
      style={{
        background: simMode ? 'rgba(91, 140, 255, 0.08)' : T.surface,
        border: simMode ? `1px solid ${T.primary}` : `1px solid ${T.border}`,
        borderRadius: 16,
        padding: isMobileViewport ? 14 : 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {label}
        </div>
        {labelAccessory}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'flex-start', flexWrap: isMobileViewport ? 'wrap' : 'nowrap' }}>
        <div
          style={{
            ...css.mono,
            fontSize: 'clamp(48px, 18vw, 72px)',
            fontWeight: 700,
            lineHeight: 1,
            color: valueTone,
            minWidth: 0,
            flex: 1,
            transition: 'color 180ms ease',
          }}
        >
          {pct === null ? '—' : `${pct.toFixed(1)}%`}
        </div>
        {chips && chips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: isMobileViewport ? '100%' : 'auto' }}>
            {chips.map((chip) => (
              <div key={chip.id} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: isMobileViewport ? 'space-between' : 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobileViewport ? 'flex-start' : 'center', gap: 2 }}>
                  <button
                    onClick={chip.onClick}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      color: T.textSecondary,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: isMobileViewport ? '7px 12px' : '6px 10px',
                      borderRadius: 999,
                      cursor: 'pointer',
                      minWidth: isMobileViewport ? 108 : 96,
                      textAlign: 'center',
                    }}
                  >
                    {chip.value}
                  </button>
                  {chip.note ? (
                    <span style={{ color: T.textMuted, fontSize: 10 }}>{chip.note}</span>
                  ) : null}
                </div>
                {chip.accessory}
              </div>
            ))}
          </div>
        )}
      </div>
      {subtitle && (
        <div style={{ color: T.textSecondary, fontSize: isMobileViewport ? 12 : 13, marginTop: 6, lineHeight: 1.35 }}>
          {subtitle}
        </div>
      )}
      <div style={{ height: 1, background: T.border, margin: '12px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: T.textSecondary, fontSize: isMobileViewport ? 11 : 12, flexWrap: isMobileViewport ? 'wrap' : 'nowrap' }}>
        <span>Prob. ruina {pct === null ? '—' : `${(100 - pct).toFixed(1)}%`}</span>
        <span style={{ flex: isMobileViewport ? '1 1 100%' : undefined, textAlign: isMobileViewport ? 'left' : 'right' }}>
          {ruinCopy ?? 'Timing mediano: —'}
        </span>
      </div>
    </div>
  );
}
