import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Landmark, CalendarRange, Settings as SettingsIcon } from 'lucide-react';
import { cn, ConnectionBanner, FirestoreStatusBanner, FxSyncStatusBanner } from './Components';
import { WealthDeltaToast } from './ui/WealthDeltaToast';
import { useWealthDelta } from '../hooks/useWealthDelta';
import {
  loadIncludeRiskCapitalInTotals,
  loadWealthSyncUiState,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  saveIncludeRiskCapitalInTotals,
  syncWealthNow,
  WEALTH_SYNC_STATUS_UPDATED_EVENT,
  WealthSyncUiState,
} from '../services/wealthStorage';

const NAVIGATE_PATRIMONIO_HOME_EVENT = 'aurum:navigate-patrimonio-home';
export const BOTTOM_NAV_RETAP_EVENT = 'aurum:bottom-nav-retap';

export const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const wealthDelta = useWealthDelta();
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [syncState, setSyncState] = useState<WealthSyncUiState>(() => loadWealthSyncUiState());

  const navItems = useMemo(
    () => [
      { to: '/patrimonio', label: 'Patrimonio', icon: Landmark },
      { to: '/closing', label: 'Cierre', icon: CalendarRange },
      { to: '/settings', label: 'Ajustes', icon: SettingsIcon },
    ],
    [],
  );

  useEffect(() => {
    // [PRODUCT RULE] Al abrir la app la vista por defecto siempre parte sin capital de riesgo.
    saveIncludeRiskCapitalInTotals(false);
    setIncludeRiskCapitalInTotals(false);
  }, []);

  useEffect(() => {
    const refresh = () => setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
    const onPreferenceUpdated = () => refresh();
    const onStorage = () => refresh();
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      onPreferenceUpdated as EventListener,
    );
    window.addEventListener('storage', onStorage);
    refresh();
    return () => {
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        onPreferenceUpdated as EventListener,
      );
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setSyncState(loadWealthSyncUiState());
    const onSyncStatusUpdated = () => refresh();
    const onStorage = () => refresh();
    window.addEventListener(WEALTH_SYNC_STATUS_UPDATED_EVENT, onSyncStatusUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    refresh();
    return () => {
      window.removeEventListener(WEALTH_SYNC_STATUS_UPDATED_EVENT, onSyncStatusUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const syncStatusView = useMemo(() => {
    if (syncState.status === 'dirty') return { icon: '🟡', text: 'Cambios sin guardar', canRetry: false };
    if (syncState.status === 'syncing') return { icon: '🔄', text: 'Guardando...', canRetry: false };
    if (syncState.status === 'error') return { icon: '🔴', text: 'Error al guardar', canRetry: true };
    return { icon: '✅', text: 'Todo guardado', canRetry: false };
  }, [syncState.status]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <ConnectionBanner />
      <FirestoreStatusBanner onGoSettings={() => navigate('/settings')} />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="max-w-xl mx-auto px-4 py-3">
          <div className="text-lg font-bold text-slate-900">Aurum</div>
          <div className="text-xs text-slate-500">Gestor de patrimonio neto</div>
        </div>
        <div className="border-t border-slate-100 bg-slate-50/80">
          <div className="max-w-xl mx-auto grid grid-cols-1 gap-2 px-4 py-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => saveIncludeRiskCapitalInTotals(!includeRiskCapitalInTotals)}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left text-xs font-medium transition',
                includeRiskCapitalInTotals
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900',
              )}
            >
              {includeRiskCapitalInTotals
                ? 'Vista: Con capital de riesgo'
                : 'Vista: Patrimonio puro'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!syncStatusView.canRetry) return;
                void syncWealthNow();
              }}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left text-xs font-medium transition',
                syncState.status === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-slate-200 bg-white text-slate-700',
              )}
            >
              <span className="mr-2">{syncStatusView.icon}</span>
              {syncStatusView.text}
              {syncStatusView.canRetry ? ' (toca para reintentar)' : ''}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full pb-20">
        {location.pathname.startsWith('/settings') ? (
          <FxSyncStatusBanner onGoSettings={() => navigate('/settings')} />
        ) : null}
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 border-t border-slate-200 bg-white/95 backdrop-blur pb-2 z-50">
        <div className="max-w-xl mx-auto flex justify-between px-4 pt-1.5 pb-3">
          {navItems.map((item: any) => {
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

            const isActive = location.pathname === item.to;
            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={(event) => {
                  if (location.pathname === item.to) {
                    event.preventDefault();
                    if (item.to === '/patrimonio') {
                      window.dispatchEvent(new CustomEvent(NAVIGATE_PATRIMONIO_HOME_EVENT));
                    }
                    window.dispatchEvent(new CustomEvent(BOTTOM_NAV_RETAP_EVENT, { detail: { to: item.to } }));
                  }
                }}
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
      <WealthDeltaToast visible={wealthDelta.visible} delta={wealthDelta.delta} reason={wealthDelta.reason} />
    </div>
  );
};
