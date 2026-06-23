import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Card } from '../Components';
import type { FirestoreStatus } from '../../services/firestoreStatus';
import type {
  GastappDataRoomV2Manifest,
  GastappDataRoomV2PeriodSummary,
  GastappDataRoomV2Row,
  GastappDataRoomV2Status,
} from '../../services/dataRoom/dataRoomTypes';

export type GastappDataRoomV2DiagnosticViewState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  sourceStatus: GastappDataRoomV2Status | null;
  message: string;
  manifest: GastappDataRoomV2Manifest | null;
  summariesSample: GastappDataRoomV2PeriodSummary[];
  rowsSample: GastappDataRoomV2Row[];
};

export const describeGastappDataRoomV2DiagnosticState = (
  state: GastappDataRoomV2DiagnosticViewState,
): string => {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'ok') return 'ok';
  return 'error';
};

interface SyncStatusSectionProps {
  open: boolean;
  authUid: string;
  fsStatus: FirestoreStatus;
  syncMessage: string;
  fsDebug: string;
  gastappDataRoomV2: GastappDataRoomV2DiagnosticViewState;
  onToggle: () => void;
  onSyncNow: () => void;
  onSignOut: () => void | Promise<void>;
  onRefreshGastappDataRoomV2: () => void;
}

export const SyncStatusSection: React.FC<SyncStatusSectionProps> = ({
  open,
  authUid,
  fsStatus,
  syncMessage,
  fsDebug,
  gastappDataRoomV2,
  onToggle,
  onSyncNow,
  onSignOut,
  onRefreshGastappDataRoomV2,
}) => {
  const isOk = fsStatus.state === 'ok';
  const statusLabel =
    fsStatus.state === 'ok'
      ? 'Firestore OK'
      : fsStatus.state === 'checking'
        ? 'Firestore verificando'
        : 'Firestore con error';
  const v2StatusLabel = describeGastappDataRoomV2DiagnosticState(gastappDataRoomV2);
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
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">GastApp Data Room v2</div>
                <div className="text-[11px] text-slate-500">Diagnóstico read-only usando el adapter v2</div>
              </div>
              <Button variant="outline" size="sm" onClick={onRefreshGastappDataRoomV2}>
                Reintentar
              </Button>
            </div>
            <div className="text-[11px] text-slate-700">
              Estado de lectura: <span className="font-semibold">{v2StatusLabel}</span>
            </div>
            <div className="whitespace-pre-line text-[11px] text-slate-600">{gastappDataRoomV2.message}</div>
            <div className="grid grid-cols-1 gap-1 text-[11px] text-slate-700 sm:grid-cols-2">
              <div>Manifest leído: <span className="font-semibold">{gastappDataRoomV2.manifest ? 'sí' : 'no'}</span></div>
              <div>dataHash: <span className="font-semibold">{gastappDataRoomV2.manifest?.dataHash || '—'}</span></div>
              <div>sourceCommit: <span className="font-semibold">{gastappDataRoomV2.manifest?.sourceCommit || '—'}</span></div>
              <div>readinessStatus: <span className="font-semibold">{gastappDataRoomV2.manifest?.readinessStatus || '—'}</span></div>
              <div>officialRefreshAllowed: <span className="font-semibold">{gastappDataRoomV2.manifest?.officialRefreshAllowed === true ? 'true' : gastappDataRoomV2.manifest?.officialRefreshAllowed === false ? 'false' : '—'}</span></div>
              <div>blockers count: <span className="font-semibold">{gastappDataRoomV2.manifest?.blockers.length ?? 0}</span></div>
              <div>warnings count: <span className="font-semibold">{gastappDataRoomV2.manifest?.warnings.length ?? 0}</span></div>
              <div>period summaries sample count: <span className="font-semibold">{gastappDataRoomV2.summariesSample.length}</span></div>
              <div>rows sample count: <span className="font-semibold">{gastappDataRoomV2.rowsSample.length}</span></div>
            </div>
            {gastappDataRoomV2.summariesSample.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700">
                <div className="font-medium text-slate-800">Period summaries sample</div>
                <div className="mt-1">
                  {gastappDataRoomV2.summariesSample.map((item) => item.period).join(', ')}
                </div>
              </div>
            )}
            {gastappDataRoomV2.rowsSample.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700">
                <div className="font-medium text-slate-800">Rows sample</div>
                <div className="mt-1">
                  {gastappDataRoomV2.rowsSample.map((item) => item.id).join(', ')}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
