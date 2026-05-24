import React, { useEffect, useRef, useState } from 'react';
import { T } from './theme';

export function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'left' | 'right' | 'center'>('center');
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = wrapRef.current;
      if (!node) return;
      if (event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const node = wrapRef.current;
    if (!node) return undefined;
    const rect = node.getBoundingClientRect();
    const minSideSpace = 140;
    const nextPlacement =
      window.innerWidth - rect.right < minSideSpace
        ? 'right'
        : rect.left < minSideSpace
          ? 'left'
          : 'center';
    setPlacement(nextPlacement);
    return undefined;
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        aria-label="Mostrar explicación"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 999,
          border: `1px solid ${T.border}`,
          color: T.textMuted,
          background: T.surface,
          fontSize: 11,
          fontWeight: 800,
          cursor: 'pointer',
          userSelect: 'none',
          padding: 0,
        }}
      >
        i
      </button>
      {open && (
        <span
          role="note"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            [placement === 'left' ? 'left' : placement === 'right' ? 'right' : 'left']: placement === 'center' ? '50%' : 0,
            transform: placement === 'center' ? 'translateX(-50%)' : 'none',
            width: 230,
            maxWidth: 'min(74vw, 230px)',
            padding: '8px 10px',
            borderRadius: 10,
            background: T.surfaceEl,
            border: `1px solid ${T.border}`,
            color: T.textPrimary,
            fontSize: 11,
            lineHeight: 1.35,
            zIndex: 20,
            boxShadow: '0 10px 22px rgba(6,18,34,0.3)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
