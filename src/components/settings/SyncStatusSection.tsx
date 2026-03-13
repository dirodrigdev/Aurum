import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Card } from '../Components';
import type { FirestoreStatus } from '../../services/firestoreStatus';

interface SyncStatusSectionProps {
  open: boolean;
  authUid: string;
  fsStatus: FirestoreStatus;
  syncMessage: string;
  fsDebug: string;
  onToggle: () => void;
  onSyncNow: () => void;
  onSignOut: () => void | Promise<void>;
}

export const SyncStatusSection: React.FC<SyncStatusSectionProps> = ({
  open,
  authUid,
  fsStatus,
  syncMessage,
  fsDebug,
  onToggle,
  onSyncNow,
  onSignOut,
}) => {
  const isOk = fsStatus.state === 'ok';
  const statusLabel =
    fsStatus.state === 'ok'
      ? 'Firestore OK'
      : fsStatus.state === 'checking'
        ? 'Firestore verificando'
        : 'Firestore con error';
  return (
    <Card className="border border-slate-200 bg-white p-3">
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={onToggle}>
        <div>
          <div className="text-sm font-semibold text-slate-900">Sincronización</div>
          <div className="text-[11px] text-slate-500">Estado Firestore y sesión</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs">
          <div
            className={`rounded-lg border px-2.5 py-2 ${
              isOk
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {statusLabel} · UID: {authUid || 'Sin UID'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onSyncNow}>
              Sincronizar ahora
            </Button>
            <Button variant="secondary" onClick={() => void onSignOut()}>
              Cerrar sesión
            </Button>
          </div>
          {!!syncMessage && <div className="text-xs text-slate-600">{syncMessage}</div>}
          {!!fsDebug && <div className="text-xs text-slate-500 break-words">{fsDebug}</div>}
        </div>
      )}
    </Card>
  );
};
