
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home as HomeIcon,
  Settings as SettingsIcon,
  PieChart,
  FolderKanban,
  RotateCcw,
  Loader2,
  Landmark,
} from 'lucide-react';
import { cn, ConnectionBanner } from './Components';
import { FirestoreStatusBanner } from './FirestoreStatusBanner';
import { DebugPanel } from './DebugPanel';
import { getCurrentUid } from '../services/firebase';
import { getMonthlyReports } from '../services/db';
import { subscribeToMonthlyReports } from '../services/monthlyReportsRealtime';
import { isMadridDayClosed, madridNowParts } from '../utils/madridTime';
import { runCloseSync } from '../services/closeSync';
import { CloseSummaryModal, CloseSummaryData } from './CloseSummaryModal';

const extractYMDFromISO = (iso: string): string | null => {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const ymdToLabel = (ymd: string) => {
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    return `${d} ${months[dt.getMonth()]}`;
  } catch {
    return ymd;
  }
};

const ymdToNoonDate = (ymd: string): Date | null => {
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  } catch {
    return null;
  }
};


const computeCloseSummaryData = (reports: any[]): CloseSummaryData | null => {
  if (!Array.isArray(reports) || reports.length === 0) return null;

  const candidates = [...reports].filter((r: any) => {
    const closedOk = r?.estado === 'cerrado' || !r?.estado;
    const hasMovement =
      Number(r?.transactionsCount || 0) > 0 ||
      Math.abs(Number(r?.totalGlobalGasto || 0)) > 0.000001;
    const nOk = Number(r?.numeroPeriodo || 0) > 0;

    const endYMD =
      (r as any)?.fechaFinYMD ||
      extractYMDFromISO(String((r as any)?.fechaFin || '')) ||
      null;
    const endOk = endYMD ? isMadridDayClosed(endYMD) : true;

    return closedOk && hasMovement && nOk && endOk;
  });

  candidates.sort((a: any, b: any) => (Number(b?.numeroPeriodo || 0) - Number(a?.numeroPeriodo || 0)));

  const latest = candidates[0];
  if (!latest) return null;

  const pNum = Number(latest?.numeroPeriodo || 0);
  if (!pNum) return null;


  // Ventana de aviso (por dispositivo): si el cierre es muy antiguo, NO lo mostramos en devices nuevos.
  // Regla producto: solo mostrar durante los primeros 5 días desde la fecha fin del periodo.
  const CLOSE_NOTICE_MAX_DAYS = 5;
  const ffYMDForWindow = (latest as any)?.fechaFinYMD || extractYMDFromISO(String((latest as any)?.fechaFin || '')) || null;
  if (ffYMDForWindow) {
    const nowYMD = madridNowParts().ymd;
    const a = ymdToNoonDate(nowYMD);
    const b = ymdToNoonDate(ffYMDForWindow);
    if (a && b) {
      const days = Math.floor((a.getTime() - b.getTime()) / (24 * 3600 * 1000));
      if (days > CLOSE_NOTICE_MAX_DAYS) return null;
    }
  }
  const seenKey = `close_seen_P${pNum}`;
  if (localStorage.getItem(seenKey)) return null;

  // Marcamos como visto al mostrar (una vez por dispositivo)
  localStorage.setItem(seenKey, '1');

  const fi = (latest as any)?.fechaInicioYMD || extractYMDFromISO(String((latest as any)?.fechaInicio || ''));
  const ff = (latest as any)?.fechaFinYMD || extractYMDFromISO(String((latest as any)?.fechaFin || ''));

  const titleLine = fi && ff
    ? `P${pNum} · ${ymdToLabel(fi)}–${ymdToLabel(ff)}`
    : `P${pNum}`;

  const total = Math.abs(Number((latest as any)?.totalGlobalGasto || 0));
  const budget = Math.abs(Number((latest as any)?.totalGlobalPresupuesto || 0));

  const prev = candidates[1];
  const prevTotal = prev ? Math.abs(Number((prev as any)?.totalGlobalGasto || 0)) : 0;

  const vsBudgetPct = budget > 0 ? ((total - budget) / budget) * 100 : null;
  const vsPrevPct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  return {
    titleLine: titleLine.toUpperCase(),
    total,
    currency: '€',
    vsBudgetPct,
    vsPrevPct,
  };
};

const scheduleNextMadridMidnight = (fn: () => void) => {
  try {
    const parts = madridNowParts();
    const remainingMs = Math.max(2000, (86400 - parts.secondsSinceMidnight + 2) * 1000);
    const t = window.setTimeout(() => fn(), remainingMs);
    return () => window.clearTimeout(t);
  } catch {
    return () => {};
  }
};

export const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = localStorage.getItem('currentUser') || '';
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);

  const [isCloseSyncing, setIsCloseSyncing] = useState(false);
  const [closeSummary, setCloseSummary] = useState<CloseSummaryData | null>(null);

  const closeSyncInFlight = useRef(false);

  useEffect(() => {
    setFirebaseUid(getCurrentUid());
  }, []);

  const isTripsUser = currentUser === 'Diego' || currentUser === 'Gastón';

  const navItems = useMemo(
    () => [
      { to: '/', label: 'Gastos', icon: HomeIcon },
      { to: '/patrimonio', label: 'Patrimonio', icon: Landmark },
      { to: '/projects', label: 'Proyectos', icon: FolderKanban, onlyTripsUsers: true },
      { to: '/reports', label: 'Reportes', icon: PieChart },
      { label: 'Actualizar', icon: RotateCcw, onClick: () => window.location.reload() },
      { to: '/settings', label: 'Ajustes', icon: SettingsIcon },
    ],
    [],
  );

  const runCloseSyncAndMaybeNotice = async (reason: string) => {
    if (closeSyncInFlight.current) return;
    closeSyncInFlight.current = true;
    setIsCloseSyncing(true);

    try {
      await runCloseSync(reason);

      // Intentamos mostrar el resumen del último cierre (una vez por dispositivo)
      const reps = await getMonthlyReports();
      const data = computeCloseSummaryData(reps as any[]);
      if (data) setCloseSummary(data);
    } catch {
      // Si falla, no bloqueamos la app: el guardrail antes de escribir sigue protegiendo.
    } finally {
      setIsCloseSyncing(false);
      closeSyncInFlight.current = false;
    }
  };

  // 1) Primer render: intenta auto-close
  useEffect(() => {
    void runCloseSyncAndMaybeNotice('app_mount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Cambio de pantalla: revalida periodo
  useEffect(() => {
    void runCloseSyncAndMaybeNotice('route_change');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // 3) Focus/visibility: si la app estuvo abierta, al volver valida periodo
  useEffect(() => {
    const onFocus = () => void runCloseSyncAndMaybeNotice('focus');
    const onVis = () => {
      if (document.visibilityState === 'visible') void runCloseSyncAndMaybeNotice('visibility');
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4) Timer: al pasar a "día nuevo" (Madrid) ejecuta auto-close sin requerir interacción
  useEffect(() => {
    let cancel = () => {};
    const tick = () => {
      void runCloseSyncAndMaybeNotice('madrid_midnight_timer');
      cancel = scheduleNextMadridMidnight(tick);
    };
    cancel = scheduleNextMadridMidnight(tick);
    return () => cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 5) Realtime cross-device: si otro dispositivo cierra, este device se entera
  useEffect(() => {
    const unsub = subscribeToMonthlyReports((reps) => {
      // Si hay un cierre nuevo que aún no se vio, lo mostramos.
      const data = computeCloseSummaryData(reps as any[]);
      if (data) setCloseSummary(data);
    }, 24);
    return () => {
      try {
        unsub && unsub();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <FirestoreStatusBanner />
      <ConnectionBanner />

      {isCloseSyncing && (
        <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="max-w-md mx-auto px-4 py-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
            <Loader2 className="animate-spin" size={16} />
            <span>Sincronizando…</span>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-md mx-auto w-full pb-20">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 border-t border-slate-200 bg-white/95 backdrop-blur pb-2 z-50">
        <div className="max-w-md mx-auto flex justify-between px-4 pt-1.5 pb-3">
          {navItems
            .filter((item: any) => !item.onlyTripsUsers || isTripsUser)
            .map((item: any) => {
              if (!('to' in item) && typeof item.onClick === 'function') {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      item.onClick();
                    }}
                    className={cn(
                      'flex flex-col items-center gap-0.5 flex-1 text-[11px] touch-manipulation text-slate-400 hover:text-slate-600',
                    )}
                  >
                    <Icon size={20} />
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              }

              const isActive =
                location.pathname === item.to ||
                (item.to === '/projects' &&
                  (location.pathname.startsWith('/trips') || location.pathname.startsWith('/other-projects')));

              const Icon = item.icon;

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'flex flex-col items-center gap-0.5 flex-1 text-[11px] touch-manipulation',
                    isActive ? 'text-blue-600' : 'text-slate-400',
                  )}
                >
                  <Icon size={20} className={cn(isActive && 'stroke-[2.5px]')} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
        </div>
      </nav>

      <CloseSummaryModal
        open={!!closeSummary}
        data={closeSummary}
        onClose={() => setCloseSummary(null)}
        onViewDetails={() => {
          setCloseSummary(null);
          navigate('/reports');
        }}
      />

      <DebugPanel />
    </div>
  );
};
