import React from 'react';
import { cn } from './Components';

type Props = {
  /** Color de identidad (hex recomendado). */
  accentColor?: string;
  /** Label centrado (default: "Privado"). */
  label?: string;
  /** Redondeo para calzar con la card (ej: rounded-3xl). */
  roundedClassName?: string;
  /**
   * Intensidad del manto.
   * - soft: se intuye el contenido, pero se vuelve ilegible (default)
   * - hard: pensado para cifras grandes (oculta más fuerte)
   */
  variant?: 'soft' | 'hard';
  className?: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const hexToRgba = (hex?: string, a = 1): string | null => {
  if (!hex) return null;
  const h = hex.trim();
  const m = h.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(a)})`;
};

/**
 * Manto de privacidad "glassy":
 * - No tapa todo (se ve que hay contenido detrás, pero ilegible)
 * - Blur + saturate + tint del color del módulo
 */
export const PrivacyOverlay: React.FC<Props> = ({
  accentColor,
  label = 'Resumen oculto',
  roundedClassName = 'rounded-3xl',
  variant = 'soft',
  className,
}) => {
  // Más tinte para que se sienta integrado (sin verse como placa negra)
  const c1 = hexToRgba(accentColor, 0.38);
  const c2 = hexToRgba(accentColor, 0.22);

  const tintBg = accentColor
    ? {
        backgroundImage: [
          `radial-gradient(120% 80% at 85% 15%, ${c1 || 'rgba(59,130,246,0.18)'} 0%, rgba(0,0,0,0) 55%)`,
          `radial-gradient(120% 80% at 15% 85%, ${c2 || 'rgba(59,130,246,0.12)'} 0%, rgba(0,0,0,0) 60%)`,
        ].join(', '),
      }
    : undefined;

  const isHard = variant === 'hard';

  return (
    <div
      className={cn(
        // Importante: NO bloquear clicks (el ojo debe seguir siendo clickeable)
        'absolute inset-0 z-20 flex items-center justify-center overflow-hidden pointer-events-none',
        roundedClassName,
        className
      )}
    >
      {/* Base oscura + blur */}
      <div
        className={cn(
          'absolute inset-0 backdrop-blur-2xl backdrop-saturate-150',
          isHard
            ? 'bg-gradient-to-br from-slate-950/80 via-slate-950/72 to-slate-950/85'
            : 'bg-gradient-to-br from-slate-950/55 via-slate-900/40 to-slate-950/60'
        )}
      />

      {/* Tintes del color (transición suave al revelar) */}
      {tintBg && <div className="absolute inset-0" style={tintBg} />}

      {/* Sheen sutil (premium) */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10 mix-blend-overlay',
          isHard ? 'opacity-35' : 'opacity-55'
        )}
      />

      {/* Label */}
      <p className="relative z-10 text-[11px] font-black text-white/95 bg-white/10 px-3 py-1 rounded-full border border-white/15 backdrop-blur-md shadow-sm">
        {label}
      </p>
    </div>
  );
};
