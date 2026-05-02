import React from 'react';
import { T } from './theme';

type TabId = 'sim' | 'assist' | 'sens' | 'stress' | 'bucketlab' | 'optv0' | 'opt' | 'settings';

const icons: Record<TabId, JSX.Element> = {
  sim: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M6 4.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  ),
  assist: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="2.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 12.4 8.7 9.7l2 1.7L14 8.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="12.4" r="1" fill="currentColor" />
      <circle cx="8.7" cy="9.7" r="1" fill="currentColor" />
      <circle cx="10.7" cy="11.4" r="1" fill="currentColor" />
      <circle cx="14" cy="8.2" r="1" fill="currentColor" />
    </svg>
  ),
  sens: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm0 0v10M10 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm0 0v6M15 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm0 0v9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  stress: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M9.5 2 4 11h5l-1 7 6-10h-5l1.5-6Z" fill="currentColor" />
    </svg>
  ),
  bucketlab: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 6.2h12M6.2 10h7.6M8.2 13.8h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="2.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  opt: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 4v3M10 13v3M4 10h3M13 10h3M6.5 6.5l2.1 2.1M11.4 11.4l2.1 2.1M6.5 13.5l2.1-2.1M11.4 8.6l2.1-2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
    </svg>
  ),
  optv0: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 9h8M6 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 3.5 11.1 5h2l.3 1.8 1.6.9-.8 1.7.8 1.7-1.6.9-.3 1.8h-2L10 16.5 8.9 15h-2l-.3-1.8-1.6-.9.8-1.7-.8-1.7 1.6-.9L6.9 5h2L10 3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  ),
};

export function BottomNav({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const items: Array<{ id: TabId; label: string; legacy?: boolean }> = [
    { id: 'sim', label: 'Simulación' },
    { id: 'assist', label: 'Asistida' },
    { id: 'sens', label: 'Palancas' },
    { id: 'stress', label: 'Stress' },
    { id: 'bucketlab', label: 'Bucket Lab' },
    { id: 'optv0', label: 'OPT', legacy: true },
    { id: 'opt', label: 'Optimizador', legacy: true },
    { id: 'settings', label: 'Ajustes' },
  ];
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        zIndex: 20,
        boxShadow: '0 -6px 14px rgba(0,0,0,0.20)',
      }}
    >
      {items.map((item) => {
        const activeTab = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: activeTab ? T.primary : T.textMuted,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 64,
              padding: '4px 2px',
            }}
          >
            {icons[item.id]}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={item.legacy ? { textDecoration: 'line-through' } : undefined}>{item.label}</span>
              {item.legacy ? (
                <span
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: 999,
                    fontSize: 9,
                    fontWeight: 700,
                    color: T.textMuted,
                    padding: '1px 4px',
                    lineHeight: 1.2,
                  }}
                >
                  legacy
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type { TabId };
