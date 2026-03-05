import React, { useMemo } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Landmark, CalendarRange, Settings as SettingsIcon } from 'lucide-react';
import { cn, ConnectionBanner, FirestoreStatusBanner, FxSyncStatusBanner } from './Components';

const NAVIGATE_PATRIMONIO_HOME_EVENT = 'aurum:navigate-patrimonio-home';

export const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = useMemo(
    () => [
      { to: '/patrimonio', label: 'Patrimonio', icon: Landmark },
      { to: '/closing', label: 'Cierre', icon: CalendarRange },
      { to: '/settings', label: 'Ajustes', icon: SettingsIcon },
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <ConnectionBanner />
      <FirestoreStatusBanner onGoSettings={() => navigate('/settings')} />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="max-w-xl mx-auto px-4 py-3">
          <div className="text-lg font-bold text-slate-900">Aurum</div>
          <div className="text-xs text-slate-500">Gestor de patrimonio neto</div>
        </div>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full pb-20">
        <FxSyncStatusBanner onGoSettings={() => navigate('/settings')} />
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
                  if (item.to === '/patrimonio' && location.pathname === '/patrimonio') {
                    event.preventDefault();
                    window.dispatchEvent(new CustomEvent(NAVIGATE_PATRIMONIO_HOME_EVENT));
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
    </div>
  );
};
