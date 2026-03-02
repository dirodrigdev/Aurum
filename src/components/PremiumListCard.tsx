import React from 'react';
import { Calendar, Edit3 } from 'lucide-react';
import { cn } from './Components';
import { PremiumSummaryCard } from './PremiumSummaryCard';

type Props = {
  accentColor?: string;
  /** Título (izquierda). Idealmente texto corto. */
  title: React.ReactNode;
  /** Estado (derecha). Suele ser un pill/botón pequeño. */
  rightStatus?: React.ReactNode;
  /** Texto de fechas (línea 2). */
  dateText: string;
  /** Meta compacta adicional (línea 2). Mantener MUY corta para no romper 2 líneas. */
  metaText?: React.ReactNode;
  watermark?: React.ReactNode;
  onOpen: () => void;
  onEdit?: (e: React.MouseEvent) => void;
  className?: string;
};

/**
 * Contract: card de lista premium (máximo 2 líneas visuales)
 * L1: Título izq + Estado der
 * L2: Fechas + meta compacta + Edit en esquina
 */
export const PremiumListCard: React.FC<Props> = ({
  accentColor,
  title,
  rightStatus,
  dateText,
  metaText,
  watermark,
  onOpen,
  onEdit,
  className,
}) => {
  return (
    <PremiumSummaryCard
      accentColor={accentColor}
      onClick={onOpen}
      backgroundFilter="none"
      layout="compact"
      className={cn('min-h-[86px]', className)}
      contentClassName="p-4"
      watermark={watermark}
      title={<span className="truncate">{title}</span>}
      rightActions={rightStatus ? <div className="shrink-0">{rightStatus}</div> : null}
      subtitle={
        <span className="inline-flex items-center gap-2 min-w-0 overflow-hidden whitespace-nowrap text-[11px] font-black uppercase tracking-tight text-white/95">
          <span className="inline-flex items-center gap-1.5 min-w-0 overflow-hidden">
            <Calendar size={12} className="opacity-90 shrink-0" />
            <span className="truncate">{dateText}</span>
          </span>
          {metaText ? <span className="opacity-70 shrink-0">•</span> : null}
          {metaText ? <span className="shrink-0">{metaText}</span> : null}
        </span>
      }
      cornerAction={
        onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-full bg-black/25 hover:bg-black/35 border border-white/10 backdrop-blur-md active:scale-95 transition"
            title="Editar"
          >
            <Edit3 size={14} className="text-white" />
          </button>
        ) : null
      }
    />
  );
};
