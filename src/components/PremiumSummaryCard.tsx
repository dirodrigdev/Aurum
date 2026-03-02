import React from 'react';
import { cn } from './Components';
import { PrivacyOverlay } from './PrivacyOverlay';

type Metric = {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label?: React.ReactNode;
};

type Privacy = {
  hidden: boolean;
  label?: string;
  /** Si no se pasa, usa accentColor */
  tintColor?: string;
  /** Fuerza visual del manto (default: soft) */
  variant?: 'soft' | 'hard';
};

export type PremiumSummaryCardProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  primary?: React.ReactNode;
  statusPill?: React.ReactNode;
  icon?: React.ReactNode;
  watermark?: React.ReactNode;
  metrics?: Metric[];
  rightActions?: React.ReactNode;
  bottomRight?: React.ReactNode;

  /** Acción flotante (ej: lapicito) en esquina inferior derecha, sin agregar altura */
  cornerAction?: React.ReactNode;

  accentColor?: string; // hex recomendado
  backgroundFilter?: string; // solo afecta a capas de fondo (no al texto)
  privacy?: Privacy;
  onClick?: () => void;
  className?: string;
  contentClassName?: string;
  size?: 'md' | 'lg';

  /** Layout compacto para listas (2 líneas aprox.) */
  layout?: 'default' | 'compact';
};

/**
 * Tarjeta premium (base titanio + acento por color).
 * - El filtro (grayscale/brightness) se aplica solo en el fondo para no “matar” el texto en iOS.
 * - La privacidad (manto) puede activarse desde afuera.
 */
export const PremiumSummaryCard: React.FC<PremiumSummaryCardProps> = ({
  title,
  subtitle,
  primary,
  statusPill,
  icon,
  watermark,
  metrics,
  rightActions,
  bottomRight,
  cornerAction,
  accentColor,
  backgroundFilter,
  privacy,
  onClick,
  className,
  contentClassName,
  size = 'md',
  layout = 'default',
}) => {
  // Halos (inspirado en TripDetail): usar el color puro + opacidad vía clases
  const accent = accentColor || undefined;

  const padding = size === 'lg' ? 'p-6' : 'p-4';
  const minH = (() => {
    if (layout === 'compact') return 'min-h-[86px]';
    return size === 'lg' ? 'min-h-[160px]' : 'min-h-[110px]';
  })();
  const radius = size === 'lg' ? 'rounded-[2.5rem]' : 'rounded-2xl';

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative w-full overflow-hidden cursor-pointer select-none',
        radius,
        minH,
        'shadow-lg border border-white/10',
        'transition-all duration-300 active:scale-[0.995]',
        className,
      )}
    >
      {/* Fondo (NO afecta texto) */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ filter: backgroundFilter || 'none' }}
      >
        {/* Base premium (mismo tono que TripDetail) */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-700 to-zinc-600" />

        {/* Halos de color (como TripDetail sin privacidad) */}
        {accent && (
          <div
            className="absolute -top-28 -right-28 h-80 w-80 rounded-full opacity-30 blur-3xl"
            style={{ backgroundColor: accent }}
          />
        )}
        {accent && (
          <div
            className="absolute -bottom-28 -left-28 h-80 w-80 rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: accent }}
          />
        )}

        {/* (sin lift extra) para que el color se vea igual que en TripDetail */}

        {/* Watermark opcional */}
        {watermark && (
          <div className="absolute inset-0 opacity-[0.07]">
            {watermark}
          </div>
        )}
      </div>

      {/* Manto de privacidad */}
      {privacy?.hidden && (
        <PrivacyOverlay
          accentColor={privacy.tintColor || accentColor}
          label={privacy.label || 'Privado'}
          roundedClassName={radius}
          variant={privacy.variant}
        />
      )}

      {/* Contenido */}
      <div
        className={cn('relative z-10 text-white', padding, contentClassName)}
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.75)' }}
      >
        {layout === 'compact' ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className={cn('min-w-0 font-black tracking-tight leading-none truncate', 'text-[18px]')}>
                {title}
              </div>
              {rightActions && <div className="shrink-0 -mt-0.5">{rightActions}</div>}
            </div>

            {(subtitle || cornerAction) && (
              <div className="flex items-center justify-between gap-3">
                {subtitle ? (
                  <div className="min-w-0 text-[11px] font-bold text-white/90 truncate">
                    {subtitle}
                  </div>
                ) : (
                  <div />
                )}
                {cornerAction && (
                  <div className="shrink-0" style={{ textShadow: 'none' }}>
                    {cornerAction}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {icon && (
                    <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm border border-white/5 shrink-0">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className={cn('font-black tracking-tight leading-none truncate', size === 'lg' ? 'text-2xl' : 'text-lg')}>
                      {title}
                    </div>
                    {subtitle && (
                      <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-white/80">
                        {subtitle}
                      </div>
                    )}
                  </div>
                </div>

                {(primary || statusPill) && (
                  <div className="mt-4">
                    {primary && (
                      <div
                        className={cn(
                          'font-bold tracking-tight',
                          size === 'lg' ? 'text-4xl' : 'text-2xl',
                          // Cinturón y tirantes: si está en privado, el número NO debe ser legible,
                          // incluso si Safari decide ignorar parte del backdrop-blur.
                          privacy?.hidden ? 'opacity-0 select-none' : null
                        )}
                      >
                        {primary}
                      </div>
                    )}
                    {statusPill && <div className="mt-2">{statusPill}</div>}
                  </div>
                )}
              </div>

              {rightActions && !cornerAction && <div className="shrink-0">{rightActions}</div>}
            </div>

            {(metrics?.length || bottomRight) && (
              <div className="mt-4 pt-4 border-t border-white/10 flex items-end justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {(metrics || []).map((m, i) => (
                    <div
                      key={i}
                      className="bg-black/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-white/5"
                    >
                      {m.icon}
                      <div className="text-xs font-bold">
                        {m.value}
                        {m.label && <span className="ml-1 text-[10px] font-black text-white/80">{m.label}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {bottomRight && <div className="shrink-0">{bottomRight}</div>}
              </div>
            )}
          </>
        )}

      </div>

      {layout !== 'compact' && cornerAction && (
        <div className="absolute bottom-4 right-4 z-30 pointer-events-auto" style={{ textShadow: 'none' }}>
          {cornerAction}
        </div>
      )}
    </div>
  );
};
