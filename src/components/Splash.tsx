import React, { useEffect, useState } from 'react';

interface SplashProps {
  onFinish: () => void;
}

/**
 * Splash de inicio:
 * - Fondo oscuro
 * - Marco de colores que primero ocupa casi toda la pantalla (modo “borde iPhone”)
 * - Luego se encoge hasta tamaño consola central
 * - Fade-out suave y llama a onFinish para montar la app real
 */
export const Splash: React.FC<SplashProps> = ({ onFinish }) => {
  const [stage, setStage] = useState<'draw' | 'shrink' | 'fade'>('draw');

  useEffect(() => {
    // 1) animación “borde grande”
    const t1 = setTimeout(() => setStage('shrink'), 800);
    // 2) encogido a consola central
    const t2 = setTimeout(() => setStage('fade'), 1500);
    // 3) desmontar splash y mostrar app
    const t3 = setTimeout(() => {
      onFinish();
    }, 1850);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onFinish]);

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    width: '100vw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#020617', // slate-950
    transition: 'opacity 280ms ease-out',
    opacity: stage === 'fade' ? 0 : 1,
  };

  const frameStyle: React.CSSProperties = {
    position: 'relative',
    borderRadius: 36,
    border: '2px solid transparent',
    backgroundImage:
      'linear-gradient(#020617, #020617), linear-gradient(135deg,#22c55e,#06b6d4,#6366f1,#f97316,#ec4899)',
    backgroundClip: 'padding-box, border-box',
    boxShadow:
      '0 0 40px rgba(15,23,42,0.9), 0 0 60px rgba(37,99,235,0.35)',
    width: '86vw',
    height: stage === 'draw' ? '78vh' : '36vh', // de “borde iPhone” a consola
    maxWidth: 420,
    maxHeight: stage === 'draw' ? 820 : 320,
    transition: 'all 650ms cubic-bezier(0.22,0.61,0.36,1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const innerStyle: React.CSSProperties = {
    width: '94%',
    height: '86%',
    borderRadius: 30,
    background:
      'radial-gradient(circle at top, rgba(148,163,184,0.22), transparent 55%), rgba(15,23,42,0.96)',
    boxShadow: '0 0 35px rgba(15,23,42,0.9) inset',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#e5e7eb',
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: 1,
  };

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={innerStyle}>
          GastApp
        </div>
      </div>
    </div>
  );
};
