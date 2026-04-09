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
  subtitle?: React.ReactNode;
  ruinCopy?: string;
  labelAccessory?: React.ReactNode;
  chips?: Array<{ id: string; value: string; onClick: () => void; accessory?: React.ReactNode; note?: string }>;
  mode?: 'real' | 'sim';
  stale?: boolean;
}) {
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 760 : false
  );
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 390 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => {
      setIsMobileViewport(window.innerWidth <= 760);
      setIsCompactViewport(window.innerWidth <= 390);
    };
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
        padding: isMobileViewport ? 12 : 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {label}
        </div>
        {labelAccessory}
      </div>

      <div style={{ display: 'flex', gap: isMobileViewport ? 8 : 12, marginTop: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div
          style={{
            ...css.mono,
            fontSize: isMobileViewport ? 'clamp(42px, 16vw, 60px)' : 'clamp(48px, 18vw, 72px)',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobileViewport ? 6 : 8, width: isMobileViewport ? (isCompactViewport ? 128 : 138) : 'auto', flexShrink: 0 }}>
            {chips.map((chip) => (
              <div key={chip.id} style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                {chip.accessory ? <span style={{ display: 'inline-flex', alignItems: 'center' }}>{chip.accessory}</span> : null}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobileViewport ? 'stretch' : 'center', gap: 1, minWidth: 0 }}>
                  <button
                    onClick={chip.onClick}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      color: T.textSecondary,
                      fontSize: isMobileViewport ? 11 : 12,
                      fontWeight: 700,
                      padding: isMobileViewport ? '5px 8px' : '6px 10px',
                      borderRadius: 999,
                      cursor: 'pointer',
                      minWidth: isMobileViewport ? 84 : 96,
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {chip.value}
                  </button>
                  {chip.note ? (
                    <span style={{ color: T.textMuted, fontSize: 10 }}>{chip.note}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {subtitle && (
        <div style={{ color: T.textSecondary, fontSize: isMobileViewport ? 11 : 13, marginTop: 4, lineHeight: 1.3 }}>
          {subtitle}
        </div>
      )}
      <div style={{ height: 1, background: T.border, margin: isMobileViewport ? '10px 0 8px' : '12px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: isMobileViewport ? 8 : 12, color: T.textSecondary, fontSize: isMobileViewport ? 10 : 12, flexWrap: isMobileViewport ? 'wrap' : 'nowrap', lineHeight: 1.3 }}>
        <span>Prob. ruina {pct === null ? '—' : `${(100 - pct).toFixed(1)}%`}</span>
        <span style={{ flex: isMobileViewport ? '1 1 100%' : undefined, textAlign: isMobileViewport ? 'left' : 'right' }}>
          {ruinCopy ?? 'Timing mediano: —'}
        </span>
      </div>
    </div>
  );
}
