import React from 'react';
import { T } from './theme';

type TabId = 'sim' | 'sens' | 'stress' | 'opt';

const icons: Record<TabId, JSX.Element> = {
  sim: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M6 4.5v11l9-5.5-9-5.5Z" fill="currentColor" />
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
  opt: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 4v3M10 13v3M4 10h3M13 10h3M6.5 6.5l2.1 2.1M11.4 11.4l2.1 2.1M6.5 13.5l2.1-2.1M11.4 8.6l2.1-2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
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
  const items: Array<{ id: TabId; label: string }> = [
    { id: 'sim', label: 'Simulación' },
    { id: 'sens', label: 'Sensibilidades' },
    { id: 'stress', label: 'Stress' },
    { id: 'opt', label: 'Optimizador' },
  ];
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        zIndex: 20,
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
            }}
          >
            {icons[item.id]}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export type { TabId };
