import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ensureAnonymousAuth } from './services/firebase';
import { Onboarding } from './pages/Onboarding';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { Budgets } from './pages/Budgets';
import { Reports } from './pages/Reports';
import { Consolidado } from './pages/Consolidado';
import { Closing } from './pages/Closing';
import { Patrimonio } from './pages/Patrimonio';

// PROYECTOS
import { Projects } from './pages/Projects';
import { Trips } from './pages/Trips';
import { TripDetail } from './pages/TripDetail';
import { OtherProjects } from './pages/OtherProjects';
import { OtherProjectDetail } from './pages/OtherProjectDetail';

const ProtectedRoute = ({ children }: React.PropsWithChildren<{}>) => {
  const user = localStorage.getItem('currentUser');
  if (!user) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    ensureAnonymousAuth()
      .then(() => {
        if (!cancelled) setFirebaseReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setFirebaseError(err?.message || 'Error');
          setFirebaseReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!firebaseReady) return <div className="p-10 text-center">Cargando...</div>;

  // Si no pudimos inicializar Auth, no montamos la app (evita listeners/queries sin UID)
  if (firebaseError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-bold text-slate-900">Error inicializando Firebase</div>
          <div className="mt-2 text-sm text-slate-600">{firebaseError}</div>
          <div className="mt-4 text-xs text-slate-500">
            Tip: revisa variables de entorno de Vercel y que el proyecto permita Auth anónimo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Layout />}>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <Navigate to="/" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/budgets"
            element={
              <ProtectedRoute>
                <Budgets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/patrimonio"
            element={
              <ProtectedRoute>
                <Patrimonio />
              </ProtectedRoute>
            }
          />

          {/* Consolidado (standalone). También se puede ver embebido como pestaña dentro de Reports. */}
          <Route
            path="/consolidado"
            element={
              <ProtectedRoute>
                <Consolidado />
              </ProtectedRoute>
            }
          />
          <Route
            path="/closing"
            element={
              <ProtectedRoute>
                <Closing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />

          {/* === RUTAS DE PROYECTOS === */}
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <Projects />
              </ProtectedRoute>
            }
          />

          {/* Rutas directas para evitar conflictos */}
          <Route
            path="/trips"
            element={
              <ProtectedRoute>
                <Trips />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trips/:id"
            element={
              <ProtectedRoute>
                <TripDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="/other-projects"
            element={
              <ProtectedRoute>
                <OtherProjects />
              </ProtectedRoute>
            }
          />
          <Route
            path="/other-projects/:id"
            element={
              <ProtectedRoute>
                <OtherProjectDetail />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
