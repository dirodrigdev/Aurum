import React, { useEffect, useMemo, useState } from 'react';
import { X, Bug, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { getFirestoreStatus, subscribeFirestoreStatus } from '../services/firestoreStatus';
import { getPerfSnapshot, perfReset, subscribePerf } from '../services/perf';
import { cn } from './Components';

const isEnabled = () => {
  try {
    const v = localStorage.getItem('gastapp_debug');
    if (v === '1' || v === 'true') return true;

    const url = new URL(window.location.href);
    const q = url.searchParams.get('debug');
    if (q === '1' || q === 'true') return true;
  } catch {
    // no-op
  }
  return false;
};

export const DebugPanel: React.FC = () => {
  const [enabled, setEnabled] = useState(isEnabled());
  const [collapsed, setCollapsed] = useState(true);
  const [fsStatus, setFsStatus] = useState(getFirestoreStatus());
  const [perf, setPerf] = useState(getPerfSnapshot());

  useEffect(() => {
    if (!enabled) return;
    const u1 = subscribeFirestoreStatus(setFsStatus);
    const u2 = subscribePerf(setPerf);
    return () => {
      u1();
      u2();
    };
  }, [enabled]);

  const badge = useMemo(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { text: 'OFFLINE', cls: 'bg-slate-600' };
    }
    if (fsStatus?.state === 'ok') return { text: 'OK', cls: 'bg-emerald-600' };
    if (fsStatus?.state === 'checking') return { text: 'CHECK', cls: 'bg-slate-500' };
    if (fsStatus?.state === 'quota') return { text: 'QUOTA', cls: 'bg-orange-600' };
    if (fsStatus?.state === 'denied') return { text: 'DENIED', cls: 'bg-red-600' };
    if (fsStatus?.state === 'unavailable') return { text: 'DOWN', cls: 'bg-slate-600' };
    return { text: 'ERROR', cls: 'bg-amber-600' };
  }, [fsStatus]);

  if (!enabled) return null;

  const close = () => {
    try {
      localStorage.setItem('gastapp_debug', '0');
    } catch {
      // no-op
    }
    setEnabled(false);
  };

  const reset = () => {
    perfReset();
  };

  return (
    <div className="fixed right-3 bottom-20 z-[60] w-[320px] max-w-[90vw]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 text-xs font-bold text-slate-700"
            title="Debug panel"
          >
            <Bug size={14} />
            Debug
            <span className={cn('text-[10px] text-white px-2 py-0.5 rounded-full', badge.cls)}>
              {badge.text}
            </span>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={reset}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Reset contadores"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={close}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="p-3 space-y-2 text-[11px] text-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Firestore</span>
              <span className="font-mono">
                {fsStatus?.state || 'unknown'} / {typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500">Listeners</span>
              <span className="font-mono">{perf.listeners}</span>
            </div>

            <div className="rounded-xl bg-slate-50 p-2">
              <div className="text-slate-500 mb-1">Listeners por módulo</div>
              {Object.keys(perf.listenersByKey).length === 0 ? (
                <div className="text-slate-400">(vacío)</div>
              ) : (
                <div className="space-y-1">
                  {Object.entries(perf.listenersByKey).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between font-mono">
                      <span className="truncate max-w-[220px]">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {fsStatus?.code && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-2 text-amber-900">
                <div className="text-[10px] uppercase font-bold opacity-80">Último error</div>
                <div className="font-mono break-words">{fsStatus.code}</div>
                {fsStatus.message && <div className="mt-1 break-words opacity-80">{fsStatus.message}</div>}
              </div>
            )}

            <div className="text-[10px] text-slate-400 leading-relaxed">
              Tip: activar/desactivar con <span className="font-mono">localStorage.gastapp_debug=1</span> o <span className="font-mono">?debug=1</span>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
