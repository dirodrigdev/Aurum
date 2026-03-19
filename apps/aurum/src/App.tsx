import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { User, onAuthStateChanged } from 'firebase/auth';
import { Layout } from './components/Layout';
import { Patrimonio } from './pages/Patrimonio';
import { SettingsAurum } from './pages/SettingsAurum';
import { ClosingAurum } from './pages/ClosingAurum';
import { AnalysisAurum } from './pages/AnalysisAurum';
import { DashboardAurum } from './pages/DashboardAurum';
import { auth, ensureAuthPersistence, signInWithGoogle } from './services/firebase';
import {
  WEALTH_DATA_UPDATED_EVENT,
  getIncompleteClosures,
  localYmd,
  loadClosures,
  refreshFxRatesDailyIfNeeded,
  subscribeWealthCloud,
  unsubscribeWealthCloud,
} from './services/wealthStorage';
import { hydrateWealthFromCloudShared } from './services/wealthHydration';

const INCOMPLETE_CLOSURE_PROMPT_DAY_KEY = 'aurum.incomplete-closure.prompt.day.v1';
const CLOSING_FOCUS_MONTH_KEY = 'aurum.closing.focus.month.v1';

type IncompletePrompt = {
  monthKey: string;
  missingCount: number;
  missingFx: boolean;
};

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState('');
  const [incompletePrompt, setIncompletePrompt] = useState<IncompletePrompt | null>(null);

  useEffect(() => {
    void ensureAuthPersistence();
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setAuthError(
        'No pude validar la sesión automáticamente. Puedes continuar con "Entrar con Google".',
      );
    }, 6000);

    const unsub = onAuthStateChanged(
      auth,
      (nextUser) => {
        window.clearTimeout(timeout);
        setUser(nextUser);
        setLoading(false);
      },
      (err) => {
        window.clearTimeout(timeout);
        setAuthError(String(err?.message || 'Error inicializando autenticación.'));
        setLoading(false);
      },
    );
    return () => {
      window.clearTimeout(timeout);
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!user || user.isAnonymous) return;

    const runDailySync = () => {
      void refreshFxRatesDailyIfNeeded();
    };

    runDailySync();

    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      runDailySync();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      runDailySync();
    };
    const onFirstInteraction = () => {
      if (document.visibilityState !== 'visible') return;
      runDailySync();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onFirstInteraction);
    window.addEventListener('touchstart', onFirstInteraction);
    window.addEventListener('keydown', onFirstInteraction);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('touchstart', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, [user?.uid, user?.isAnonymous]);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setIncompletePrompt(null);
      return;
    }
    const refreshIncompletePrompt = () => {
      const today = localYmd(new Date());
      const dismissedDay = String(localStorage.getItem(INCOMPLETE_CLOSURE_PROMPT_DAY_KEY) || '');
      if (dismissedDay === today) {
        setIncompletePrompt(null);
        return;
      }
      const incomplete = getIncompleteClosures(loadClosures())[0] || null;
      if (!incomplete) {
        setIncompletePrompt(null);
        return;
      }
      setIncompletePrompt({
        monthKey: incomplete.monthKey,
        missingCount: incomplete.missingFieldLabels.length,
        missingFx: incomplete.missingFx,
      });
    };

    refreshIncompletePrompt();
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshIncompletePrompt as EventListener);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshIncompletePrompt as EventListener);
    };
  }, [user?.uid, user?.isAnonymous]);

  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      await hydrateWealthFromCloudShared({ force: true, minIntervalMs: 0 });
      const unsub = await subscribeWealthCloud();
      if (cancelled) {
        unsub();
        return;
      }
      cleanup = unsub;
    })().catch(() => {
      // handled by storage/firestore status banners
    });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      else unsubscribeWealthCloud();
    };
  }, [user?.uid, user?.isAnonymous]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Aurum</div>
          <div className="mt-2 text-sm text-slate-500">Cargando sesión segura...</div>
        </div>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f6f3eb] to-[#e9efe4] p-6">
        <div className="w-full max-w-md rounded-3xl border border-[#ddd4c6] bg-white/90 p-7 shadow-lg">
          <div className="text-3xl font-bold text-slate-900">Aurum</div>
          <div className="mt-2 text-sm text-slate-600">
            Inicia sesión con tu cuenta Google para sincronizar el mismo patrimonio en todos tus dispositivos.
          </div>
          {user?.isAnonymous && (
            <div className="mt-2 text-xs text-amber-700">
              Se detectó sesión anónima anterior. Entra con Google para unificar datos entre dispositivos.
            </div>
          )}
          <button
            className="mt-6 w-full rounded-xl bg-[#2f4f2f] px-4 py-3 text-sm font-semibold text-white hover:bg-[#264226]"
            onClick={async () => {
              setAuthError('');
              try {
                await signInWithGoogle();
              } catch (err: any) {
                setAuthError(String(err?.message || 'No pude iniciar sesión con Google.'));
              }
            }}
          >
            Entrar con Google
          </button>
          {!!authError && <div className="mt-3 text-xs text-red-700">{authError}</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {!!incompletePrompt && (
        <div className="fixed inset-0 z-[120] bg-black/45 p-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl">
            <div className="text-lg font-semibold text-slate-900">Cierre mensual incompleto</div>
            <div className="mt-2 text-sm text-slate-600">
              El cierre de <span className="font-semibold">{incompletePrompt.monthKey}</span> aún no está completo.
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Faltan {incompletePrompt.missingCount} campos
              {incompletePrompt.missingFx ? ' + TC/UF del cierre' : ''}.
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  localStorage.setItem(INCOMPLETE_CLOSURE_PROMPT_DAY_KEY, localYmd(new Date()));
                  setIncompletePrompt(null);
                }}
              >
                Omitir
              </button>
              <button
                type="button"
                className="rounded-lg border border-[#7f5528] bg-[#9c6b36] px-3 py-2 text-sm font-semibold text-[#f6efe2] hover:bg-[#8b5f30]"
                onClick={() => {
                  localStorage.setItem(INCOMPLETE_CLOSURE_PROMPT_DAY_KEY, localYmd(new Date()));
                  localStorage.setItem(CLOSING_FOCUS_MONTH_KEY, incompletePrompt.monthKey);
                  window.location.hash = '#/closing';
                  setIncompletePrompt(null);
                }}
              >
                Completar ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const App: React.FC = () => {
  return (
    <AuthGate>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardAurum />} />
            <Route path="/patrimonio" element={<Patrimonio />} />
            <Route path="/closing" element={<ClosingAurum />} />
            <Route path="/analysis" element={<AnalysisAurum />} />
            <Route path="/settings" element={<SettingsAurum />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </AuthGate>
  );
};

export default App;
