import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Button, Card } from '../components/Components';
import { HistoricalGastappBackfillAuditConsole } from '../components/settings/HistoricalGastappBackfillAuditConsole';
import { auth, consumeRedirectAuthResult, ensureAuthPersistence, signInWithGoogle } from '../services/firebase';

export const HistoricalGastappBackfillAuditDevEntry: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      try {
        await ensureAuthPersistence();
        await consumeRedirectAuthResult();
        if (!alive) return;
        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          if (!alive) return;
          setUser(nextUser);
          setReady(true);
        }, (error) => {
          if (!alive) return;
          setMessage(error instanceof Error ? error.message : 'No se pudo comprobar la sesión.');
          setReady(true);
        });
      } catch (error) {
        if (!alive) return;
        setMessage(error instanceof Error ? error.message : 'No se pudo iniciar la sesión de lectura.');
        setReady(true);
      }
    })();
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const signIn = async () => {
    setBusy(true);
    setMessage('');
    try {
      await signInWithGoogle();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <h1 className="text-xl font-semibold text-slate-950">Auditoría histórica GastApp</h1>
          <p className="mt-1 text-sm text-slate-600">Herramienta de desarrollo aislada del arranque y la sincronización normal de Aurum.</p>
        </header>
        {!ready ? (
          <Card className="p-4">Comprobando sesión…</Card>
        ) : !user ? (
          <Card className="space-y-3 p-4">
            <p className="text-sm text-slate-700">Inicia sesión para habilitar lecturas de servidor. No se cargarán las pantallas normales de Aurum.</p>
            <Button variant="outline" disabled={busy} onClick={() => void signIn()}>{busy ? 'Abriendo sesión…' : 'Entrar con Google'}</Button>
            {message && <p role="alert" className="text-sm text-rose-800">{message}</p>}
          </Card>
        ) : user.email?.trim().toLowerCase() !== 'diegorp.1978@gmail.com' ? (
          <Card className="p-4 text-sm text-slate-700">La sesión actual no corresponde a la cuenta autorizada para esta auditoría.</Card>
        ) : (
          <HistoricalGastappBackfillAuditConsole authEmail={user.email} />
        )}
      </div>
    </main>
  );
};
