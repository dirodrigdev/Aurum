import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { User, onAuthStateChanged } from 'firebase/auth';
import { Layout } from './components/Layout';
import { Patrimonio } from './pages/Patrimonio';
import { SettingsAurum } from './pages/SettingsAurum';
import { ClosingAurum } from './pages/ClosingAurum';
import { auth, ensureAuthPersistence, signInWithGoogle } from './services/firebase';

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
