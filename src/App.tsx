import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { User, onAuthStateChanged } from 'firebase/auth';
import { Layout } from './components/Layout';
import { Patrimonio } from './pages/Patrimonio';
import { SettingsAurum } from './pages/SettingsAurum';
import { ClosingAurum } from './pages/ClosingAurum';
import { auth, ensureAuthPersistence, signInWithGoogle } from './services/firebase';
import {
  hydrateWealthFromCloud,
  refreshFxRatesDailyIfNeeded,
  subscribeWealthCloud,
  unsubscribeWealthCloud,
} from './services/wealthStorage';

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState('');

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
    if (!user || user.isAnonymous) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      await hydrateWealthFromCloud();
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

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <AuthGate>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/patrimonio" replace />} />
            <Route path="/patrimonio" element={<Patrimonio />} />
            <Route path="/closing" element={<ClosingAurum />} />
            <Route path="/settings" element={<SettingsAurum />} />
          </Route>
          <Route path="*" element={<Navigate to="/patrimonio" replace />} />
        </Routes>
      </HashRouter>
    </AuthGate>
  );
};

export default App;
