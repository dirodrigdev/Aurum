import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Button, Card, Input } from '../components/Components';
import {
  clearWealthDataForFreshStart,
  hydrateWealthFromCloud,
  getLastWealthSyncIssue,
  loadFxRates,
  saveFxRates,
  seedDemoWealthTimeline,
  syncWealthNow,
} from '../services/wealthStorage';
import { auth, signOutUser } from '../services/firebase';
import { getFirestoreStatus } from '../services/firestoreStatus';

export const SettingsAurum: React.FC = () => {
  const [fx, setFx] = useState(() => loadFxRates());
  const [seedMessage, setSeedMessage] = useState('');
  const [clearMessage, setClearMessage] = useState('');
  const [clearing, setClearing] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authUid, setAuthUid] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [fsDebug, setFsDebug] = useState('');

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setAuthEmail(user?.email || '');
      setAuthUid(user?.uid || '');
    });
  }, []);

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4">
        <div className="text-lg font-bold text-slate-900">Ajustes</div>
        <div className="mt-1 text-sm text-slate-600">Configuración general de Aurum.</div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Sesión activa</div>
        <div className="text-xs text-slate-600">
          Usa el mismo correo y UID en notebook/celular para sincronizar el mismo patrimonio.
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
          <div>
            <span className="text-slate-500">Correo:</span> {authEmail || 'Sin correo (sesión no lista)'}
          </div>
          <div className="mt-1 break-all">
            <span className="text-slate-500">UID:</span> {authUid || 'Sin UID'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const pushed = await syncWealthNow();
              const hydrated = await hydrateWealthFromCloud();
              const fs = getFirestoreStatus();
              const detail = `${fs.state}${fs.code ? `/${fs.code}` : ''}`;
              setSyncMessage(`Sync manual: push=${pushed ? 'ok' : 'fail'}, pull=${hydrated}, firestore=${detail}.`);
              setFsDebug(getLastWealthSyncIssue() || fs.message || '');
            }}
          >
            Sincronizar ahora
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await signOutUser();
            }}
          >
            Cerrar sesión
          </Button>
        </div>
        {!!syncMessage && <div className="text-xs text-emerald-700">{syncMessage}</div>}
        {!!fsDebug && <div className="text-xs text-slate-500 break-words">Detalle Firestore: {fsDebug}</div>}
        <div className="text-[11px] text-slate-500 break-words">
          Proyecto activo (frontend): {import.meta.env.VITE_FIREBASE_PROJECT_ID || 'no definido'}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Tipos de cambio (consolidado CLP)</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">USD a CLP</div>
            <Input
              value={fx.usdClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, usdClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">EUR a CLP</div>
            <Input
              value={fx.eurClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, eurClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">UF a CLP</div>
            <Input
              value={fx.ufClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, ufClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Simulación de cierres</div>
        <div className="text-xs text-slate-600">
          Crea datos demo: enero (cierre), febrero (cierre) y marzo en curso, para probar Hoy/Cierre/Evolución.
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            const timeline = seedDemoWealthTimeline();
            setSeedMessage(`Demo cargada: ${timeline.janKey}, ${timeline.febKey} y ${timeline.marKey}.`);
            setClearMessage('');
          }}
        >
          Cargar demo Ene-Feb-Mar
        </Button>
        {!!seedMessage && <div className="text-xs text-emerald-700">{seedMessage}</div>}
        <div className="pt-2 border-t border-slate-200">
          <div className="text-xs text-slate-600 mb-2">
            Borra todos los datos patrimoniales (registros, cierres e instrumentos) para empezar desde cero.
          </div>
          <Button
            variant="danger"
            disabled={clearing}
            onClick={async () => {
              const ok = window.confirm(
                'Esto eliminará TODA la información patrimonial (local + nube) y dejará la app en blanco. ¿Continuar?',
              );
              if (!ok) return;
              setClearing(true);
              setSeedMessage('');
              setSyncMessage('');
              setFsDebug('');
              try {
                const result = await clearWealthDataForFreshStart({ preserveFx: true });
                setClearMessage(
                  result.cloudCleared
                    ? 'App en blanco: datos eliminados en este dispositivo y en Firestore.'
                    : 'App en blanco localmente. Firestore no se pudo limpiar ahora; se reintentará con la siguiente sync.',
                );
              } finally {
                setClearing(false);
              }
            }}
          >
            {clearing ? 'Limpiando...' : 'Eliminar simulación y empezar de cero'}
          </Button>
          {!!clearMessage && <div className="mt-2 text-xs text-emerald-700">{clearMessage}</div>}
        </div>
      </Card>
    </div>
  );
};
