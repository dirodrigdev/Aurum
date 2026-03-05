import React, { useState, useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as LucideIcons from 'lucide-react';
import { subscribeFirestoreStatus, FirestoreStatus } from '../services/firestoreStatus';
import { FX_LIVE_META_UPDATED_EVENT, loadFxLiveSyncMeta, loadFxRates } from '../services/wealthStorage';
import { periodInfoForDate } from '../utils/period';

// Utility para unir clases de Tailwind sin conflictos
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Helpers de fecha “date-only” (evitan el bug UTC/Z) ---

const pad2 = (n: number) => String(n).padStart(2, '0');

export const toYMD = (d: Date): string => {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const parseYMD = (ymd: string, at: 'start' | 'noon' | 'end' = 'noon'): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (at === 'start') return new Date(y, m - 1, d, 0, 0, 0, 0);
  if (at === 'end') return new Date(y, m - 1, d, 23, 59, 59, 999);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // NOON: nunca se “corre” por zona horaria
};

export const extractYMD = (value: any): string | null => {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

// --- UI COMPONENTS ---

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-2xl bg-white border border-slate-200 shadow-sm', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg' | 'icon';
  }
>(({ className, variant = 'primary', size = 'md', ...props }, ref) => {
  const variants: Record<string, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm active:scale-95',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 active:scale-95',
    outline: 'border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-700',
    ghost: 'hover:bg-slate-100 text-slate-700 hover:text-slate-900',
    danger: 'bg-red-500 text-white hover:bg-red-600 shadow-sm active:scale-95',
  };
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 py-2',
    lg: 'h-12 px-8 text-lg',
    icon: 'h-10 w-10 p-2 flex items-center justify-center',
  };
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = 'Button';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  },
);
Select.displayName = 'Select';

export const SwipeRow = ({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) => {
  return (
    <div className="relative group overflow-hidden rounded-xl">
      <div
        className="absolute inset-y-0 right-0 w-16 bg-red-500 flex items-center justify-center text-white z-0"
        onClick={onDelete}
      >
        <LucideIcons.Trash2 size={20} />
      </div>
      <div className="relative z-10 bg-white transition-transform group-hover:-translate-x-2">
        {children}
      </div>
    </div>
  );
};

// --- BANNER DE CONEXIÓN ---

export const ConnectionBanner: React.FC = () => {
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  const WifiOff = (LucideIcons as any).WifiOff;

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-xs flex items-center justify-center gap-2 py-1">
      <WifiOff size={14} />
      <span>No se detecta conexión. Espera a tener internet para ingresar o sincronizar datos.</span>
    </div>
  );
};

// --- BANNER GLOBAL FIRESTORE (cuotas/permisos/caídas) ---

export const FirestoreStatusBanner: React.FC<{ onGoSettings?: () => void }> = ({ onGoSettings }) => {
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [status, setStatus] = useState<FirestoreStatus>({ state: 'checking', at: Date.now() });

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    return subscribeFirestoreStatus(setStatus);
  }, []);

  if (status.state === 'ok' || status.state === 'checking') return null;

  const topOffset = online ? 0 : 24; // si el banner de conexión está visible, bajamos este un poco

  const ShieldAlert = (LucideIcons as any).ShieldAlert;
  const AlertTriangle = (LucideIcons as any).AlertTriangle;
  const DatabaseZap = (LucideIcons as any).DatabaseZap;

  let title = 'Problema de sincronización';
  let body = 'Firestore no está disponible. Intenta nuevamente en unos minutos.';
  let Icon = AlertTriangle;
  let bg = 'bg-orange-600';

  if (status.state === 'denied') {
    title = 'Dispositivo no autorizado';
    body = 'No tienes permiso para leer/escribir en Firestore desde este dispositivo. Ve a Ajustes para ver tu UID y autorizarlo.';
    Icon = ShieldAlert;
    bg = 'bg-orange-600';
  }
  if (status.state === 'quota') {
    title = 'Límite de Firestore alcanzado';
    body = 'En este momento Firestore está rechazando lecturas/escrituras (cuota). La app puede mostrar datos antiguos, pero no guardará cambios hasta que se restablezca.';
    Icon = DatabaseZap;
    bg = 'bg-red-600';
  }
  if (status.state === 'unavailable') {
    title = 'Firestore temporalmente no disponible';
    body = 'Puede ser una caída temporal o un problema de red. Reintenta en unos minutos.';
    Icon = AlertTriangle;
    bg = 'bg-orange-600';
  }

  return (
    <div
      className={`fixed inset-x-0 z-50 text-white text-xs flex items-start justify-between gap-3 py-2 px-3 ${bg}`}
      style={{ top: topOffset }}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5" />
        <div className="leading-tight">
          <div className="font-semibold">{title}</div>
          <div className="opacity-90">{body}</div>
        </div>
      </div>
      {onGoSettings && (
        <button
          type="button"
          onClick={onGoSettings}
          className="shrink-0 bg-white/15 hover:bg-white/25 px-2 py-1 rounded-lg font-semibold"
        >
          Ajustes
        </button>
      )}
    </div>
  );
};

export const FxSyncStatusBanner: React.FC<{ onGoSettings?: () => void }> = ({ onGoSettings }) => {
  const [meta, setMeta] = useState(() => loadFxLiveSyncMeta());
  const [rates, setRates] = useState(() => loadFxRates());
  const [dismissedKey, setDismissedKey] = useState(() => {
    try {
      return String(localStorage.getItem('aurum_fx_sync_error_dismissed_key') || '');
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const refresh = () => {
      setMeta(loadFxLiveSyncMeta());
      setRates(loadFxRates());
      try {
        setDismissedKey(String(localStorage.getItem('aurum_fx_sync_error_dismissed_key') || ''));
      } catch {
        setDismissedKey('');
      }
    };

    const onMetaUpdated = () => refresh();
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener(FX_LIVE_META_UPDATED_EVENT, onMetaUpdated as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener(FX_LIVE_META_UPDATED_EVENT, onMetaUpdated as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!meta || meta.status !== 'error') return null;

  const errorKey = `${meta.fetchedAt || 's/f'}|${meta.message || 's/m'}`;
  if (dismissedKey === errorKey) return null;

  const AlertTriangle = (LucideIcons as any).AlertTriangle;
  const keepSavedValues = () => {
    try {
      localStorage.setItem('aurum_fx_sync_error_dismissed_key', errorKey);
    } catch {
      // ignore
    }
    setDismissedKey(errorKey);
  };

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="leading-tight">
          <div className="font-semibold">Actualización financiera pendiente</div>
          <div className="mt-0.5">
            No pude actualizar TC/UF automáticamente hoy. Se mantienen los valores guardados:
            {' '}
            USD {Math.round(rates.usdClp).toLocaleString('es-CL')}
            {' · '}
            EUR {Math.round(rates.eurClp).toLocaleString('es-CL')}
            {' · '}
            UF {Math.round(rates.ufClp).toLocaleString('es-CL')}.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={keepSavedValues}
              className="rounded-lg border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-800 hover:bg-amber-100"
            >
              Mantener guardados
            </button>
            {onGoSettings && (
              <button
                type="button"
                onClick={onGoSettings}
                className="rounded-lg bg-amber-700 px-2 py-1 font-semibold text-white hover:bg-amber-800"
              >
                Ingresar manual
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- BOTÓN DE REFRESCO GLOBAL ---

export const RefreshButton: React.FC<{ onClick?: () => void }> = ({ onClick }) => {
  const RotateCw = (LucideIcons as any).RotateCw;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      window.location.reload();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Recargar datos"
      className="h-8 w-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-300 active:scale-95 bg-white"
    >
      <RotateCw size={16} />
    </button>
  );
};

// --- HELPERS NUMÉRICOS ---

export const parseLocaleNumber = (stringNumber: string): number => {
  if (!stringNumber) return 0;
  const clean = stringNumber.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export const formatLocaleNumber = (amount: number, decimals: number = 0): string => {
  let num = Number(amount);
  if (isNaN(num)) num = 0;
  const fixed = num.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals > 0 ? `${intFormatted},${decPart}` : intFormatted;
};

// --- PERIODO (ESTABLE) ---

export const calculatePeriodInfo = (
  currentDate: Date = new Date(),
  closingDay: number = 11,
) => {
  const p = periodInfoForDate(currentDate, closingDay);
  // Compat: Components.tsx historically returned startDate/endDate at NOON and label Pn
  return {
    startDate: p.startNoon,
    endDate: p.endNoon,
    periodNumber: p.periodNumber,
    label: p.label,
  };
};

// --- ICONOS DE CATEGORÍA ---

export const getCategoryIcon = (iconName: string) => {
  const iconMap: Record<string, React.ComponentType<any>> = {
    Home: LucideIcons.Home,
    ShoppingCart: LucideIcons.ShoppingCart,
    Utensils: LucideIcons.Utensils,
    Car: LucideIcons.Car,
    Heart: LucideIcons.Heart,
    Zap: LucideIcons.Zap,
    ShoppingBag: LucideIcons.ShoppingBag,
    Beer: LucideIcons.Beer,
    Plane: LucideIcons.Plane,
    Smartphone: LucideIcons.Smartphone,
    Tv: LucideIcons.Tv,
    Scissors: LucideIcons.Scissors,
    Dumbbell: LucideIcons.Dumbbell,
    Smile: LucideIcons.Smile,
    Shirt: LucideIcons.Shirt,
    AlertCircle: LucideIcons.AlertCircle,

    // 👉 Zona Iker:
    Dog: (LucideIcons as any).Dog,
    PawPrint: (LucideIcons as any).PawPrint,
    Bone: (LucideIcons as any).Bone,

    General: LucideIcons.CircleDollarSign,
  };

  return iconMap[iconName] || LucideIcons.CircleDollarSign;
};

// Iconos que se muestran en el selector de presupuestos
export const ICON_KEYS = [
  'Home',
  'ShoppingCart',
  'Utensils',
  'Car',
  'Heart',
  'Zap',
  'ShoppingBag',
  'Beer',
  'Plane',
  'Smartphone',
  'Tv',
  'Scissors',
  'Dumbbell',
  'Smile',
  'Shirt',
  'AlertCircle',
  // 👉 Iker presets
  'Dog',
  'PawPrint',
  'Bone',
  // genérico
  'General',
];

export const ICON_MAP: any = LucideIcons;
