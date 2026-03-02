import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from './Components';

type Props = {
  isPrivate: boolean;
  onToggle: () => void;
  accentColor?: string;
  className?: string;
  title?: string;
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
 * Botón de privacidad (ojito) consistente y sin el "ring" azul del browser.
 * - Subtil, premium
 * - Sin aro/borde marcado: solo una sombra suave y un halo muy leve
 */
export const PrivacyToggle: React.FC<Props> = ({
  isPrivate,
  onToggle,
  accentColor,
  className,
  title,
}) => {
  const halo = hexToRgba(accentColor, 0.18) || 'rgba(255,255,255,0.12)';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'h-9 w-9 grid place-items-center rounded-full text-white/90 transition-colors backdrop-blur-lg',
        'bg-black/14 hover:bg-black/22',
        'outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0',
        className,
      )}
      style={{
        // 1) Sombra principal
        // 2) Halo difuso teñido (no se ve como un "aro")
        boxShadow: `0 10px 24px rgba(0,0,0,0.22), 0 0 18px ${halo}`,
      }}
      title={title || (isPrivate ? 'Mostrar' : 'Ocultar')}
      aria-label={title || (isPrivate ? 'Mostrar' : 'Ocultar')}
    >
      {isPrivate ? <Eye size={15} /> : <EyeOff size={15} />}
    </button>
  );
};
