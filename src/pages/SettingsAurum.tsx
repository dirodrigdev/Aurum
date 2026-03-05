import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Button, Card, Input } from '../components/Components';
import {
  clearCurrentMonthData,
  clearSimulationHistoryData,
  currentMonthKey,
  getSimulationHistoryMonthKeys,
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
  const [clearSimMessage, setClearSimMessage] = useState('');
  const [clearMonthMessage, setClearMonthMessage] = useState('');
  const [clearingSim, setClearingSim] = useState(false);
  const [clearingMonth, setClearingMonth] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authUid, setAuthUid] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [fsDebug, setFsDebug] = useState('');

  const formatMonthLabel = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
    const dt = new Date(y, m - 1, 1);
    const label = dt.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

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
            setClearSimMessage('');
            setClearMonthMessage('');
          }}
        >
          Cargar demo Ene-Feb-Mar
        </Button>
        {!!seedMessage && <div className="text-xs text-emerald-700">{seedMessage}</div>}
        <div className="pt-2 border-t border-slate-200">
          <div className="text-xs text-slate-600 mb-2">
            Limpia solo meses históricos de simulación (no toca automáticamente el mes actual).
          </div>
          <Button
            variant="danger"
            disabled={clearingSim}
            onClick={async () => {
              const candidates = getSimulationHistoryMonthKeys();
              const monthText = candidates.length
                ? candidates.map((m) => formatMonthLabel(m)).join(', ')
                : 'meses históricos detectados';
              const ok = window.confirm(
                `Se eliminarán datos simulados de: ${monthText}. No se borrará automáticamente el mes actual. ¿Continuar?`,
              );
              if (!ok) return;
              setClearingSim(true);
              setSeedMessage('');
              setSyncMessage('');
              setFsDebug('');
              setClearMonthMessage('');
              try {
                const result = await clearSimulationHistoryData();
                if (!result.monthKeys.length || (result.removedRecords === 0 && result.removedClosures === 0)) {
                  setClearSimMessage(
                    'No encontré simulación histórica para eliminar (o ya estaba limpia).',
                  );
                } else {
                  setClearSimMessage(
                    result.cloudCleared
                      ? `Simulación histórica eliminada (${result.removedClosures} cierres, ${result.removedRecords} registros).`
                      : `Simulación eliminada localmente (${result.removedClosures} cierres, ${result.removedRecords} registros). Firestore no se pudo actualizar ahora.`,
                  );
                }
              } finally {
                setClearingSim(false);
              }
            }}
          >
            {clearingSim ? 'Limpiando...' : 'Eliminar solo simulación histórica'}
          </Button>
          {!!clearSimMessage && <div className="mt-2 text-xs text-emerald-700">{clearSimMessage}</div>}
        </div>

        <div className="pt-2 border-t border-slate-200">
          <div className="text-xs text-slate-600 mb-2">
            Borra datos del mes actual por bloque (Inversiones y/o Bienes raíces), con confirmación.
          </div>
          <Button
            variant="outline"
            disabled={clearingMonth}
            onClick={async () => {
              const month = currentMonthKey();
              const inv = window.confirm(
                `¿Quieres borrar Inversiones de ${formatMonthLabel(month)}?`,
              );
              const re = window.confirm(
                `¿Quieres borrar Bienes raíces de ${formatMonthLabel(month)}?`,
              );
              if (!inv && !re) {
                setClearMonthMessage('No se seleccionó ningún bloque para borrar.');
                return;
              }
              const finalOk = window.confirm(
                `Confirmar borrado del mes actual (${formatMonthLabel(month)}): ${inv ? 'Inversiones' : ''}${
                  inv && re ? ' + ' : ''
                }${re ? 'Bienes raíces' : ''}.`,
              );
              if (!finalOk) return;

              setClearingMonth(true);
              setSeedMessage('');
              setSyncMessage('');
              setFsDebug('');
              setClearSimMessage('');
              try {
                const result = await clearCurrentMonthData({
                  clearInvestments: inv,
                  clearRealEstate: re,
                });
                setClearMonthMessage(
                  result.cloudCleared
                    ? `Mes actual limpiado: ${result.removedRecords} registros (${result.removedInvestment} inversiones, ${result.removedRealEstate} bienes raíces/deuda hipotecaria).`
                    : `Mes limpiado localmente: ${result.removedRecords} registros. Firestore no se pudo actualizar ahora.`,
                );
              } finally {
                setClearingMonth(false);
              }
            }}
          >
            {clearingMonth ? 'Borrando...' : 'Borrar datos del mes actual (por bloque)'}
          </Button>
          {!!clearMonthMessage && <div className="mt-2 text-xs text-emerald-700">{clearMonthMessage}</div>}
        </div>
      </Card>
    </div>
  );
};
