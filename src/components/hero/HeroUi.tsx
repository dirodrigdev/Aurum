import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Card, cn } from '../Components';
import { PrivacyOverlay } from '../PrivacyOverlay';

export type HeroVariant = 'trip' | 'project';

export type HeroStatus = {
  label: string;
  finished?: boolean;
  title?: string;
  onClick?: () => void;
};

type HeroCardProps = {
  accentColor: string;
  variant?: HeroVariant;
  isPrivate: boolean;
  onTogglePrivate: () => void;
  status?: HeroStatus;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
};

/**
 * HeroCard: contrato visual único para el "header" premium (Trips/Projects/OtherProjects).
 * - Fondo premium + halos
 * - Overlay privacidad glassy (blur + tinte)
 * - Estado top-right (secundario) + ojo bottom-right (sutil)
 */
export const HeroCard = ({
  accentColor,
  variant = 'trip',
  isPrivate,
  onTogglePrivate,
  status,
  className,
  contentClassName,
  children,
}: HeroCardProps) => {
  const vAccent = accentColor || '#3b82f6';

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-none shadow-lg text-white text-shadow-soft rounded-3xl mb-4',
        className
      )}
    >
      {/* Fondo base */}
      {variant === 'trip' ? (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-700 to-zinc-600" />
          {/* halos */}
          <div
            className="absolute -top-28 -right-28 h-80 w-80 rounded-full opacity-30 blur-3xl"
            style={{ backgroundColor: vAccent }}
          />
          <div
            className="absolute -bottom-28 -left-28 h-80 w-80 rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: vAccent }}
          />
          {/* sheen */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/30 opacity-60" />
        </>
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(145deg, ${vAccent} 0%, #0f172a 72%, #3f3f46 140%)`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/30 opacity-60" />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: vAccent, opacity: 0.10, mixBlendMode: 'soft-light' as any }}
          />
        </>
      )}

      {/* Overlay privacidad (glassy + tint del accentColor) */}
      {isPrivate && (
        <PrivacyOverlay
          accentColor={vAccent}
          label="Resumen oculto"
          roundedClassName="rounded-3xl"
          variant="soft"
        />
      )}

      {/* Contenido (reserva espacio para el ojo) */}
      <div
        className={cn(
          'relative z-10 p-6 pr-16 pb-14 transition-all duration-300',
          // Debe ser imposible leer cifras incluso en Safari/iOS.
          // Preferencia Diego: opacity ~0.08 + blur fuerte (si esPrivate).
          isPrivate && 'opacity-[0.08] blur-[16px] select-none',
          contentClassName
        )}
      >
        {children}
      </div>

      {/* Estado (top-right) — secundario y alineado al rail del ojo */}
      {!isPrivate && status && (
        <div className="absolute top-4 right-4 z-30 flex items-start justify-end">
          <HeroStatusPill
            label={status.label}
            finished={status.finished}
            title={status.title}
            onClick={status.onClick}
          />
        </div>
      )}

      {/* Ojo (bottom-right) */}
      <HeroEyeButton isPrivate={isPrivate} onToggle={onTogglePrivate} />
    </Card>
  );
};

export const HeroStatusPill = ({
  label,
  finished,
  title,
  onClick,
}: {
  label: string;
  finished?: boolean;
  title?: string;
  onClick?: () => void;
}) => {
  const base = cn(
    'px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest border shadow-sm backdrop-blur-md',
    finished ? 'bg-emerald-500/15 text-emerald-100 border-emerald-300/25' : 'bg-white/10 text-slate-100 border-white/10',
  );

  if (!onClick) {
    return (
      <div className={base} title={title}>
        {label}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(base, 'hover:bg-white/15')} title={title}>
      {label}
    </button>
  );
};

export const HeroEyeButton = ({
  isPrivate,
  onToggle,
}: {
  isPrivate: boolean;
  onToggle: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'absolute bottom-4 right-4 z-40 pointer-events-auto h-9 w-9 flex items-center justify-center rounded-full backdrop-blur-md transition-colors',
        'bg-black/15 hover:bg-black/25 text-white/90'
      )}
      title={isPrivate ? 'Mostrar' : 'Ocultar'}
    >
      {isPrivate ? <Eye size={18} /> : <EyeOff size={18} />}
    </button>
  );
};
