import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Card } from '../Components';
import {
  GastappCanonicalV2Section,
  type GastappCanonicalV2DiagnosticViewState,
} from './GastappCanonicalV2Section';
import type { GastappReportExportKind } from '../../services/gastappFullHandoff';
import type { FirestoreStatus } from '../../services/firestoreStatus';

export type MidasPublicationViewState = {
  status: 'idle' | 'publishing' | 'ok' | 'error';
  message: string;
};

interface SyncStatusSectionProps {
  open: boolean;
  authUid: string;
  fsStatus: FirestoreStatus;
  syncMessage: string;
  fsDebug: string;
  gastappCanonicalV2: GastappCanonicalV2DiagnosticViewState;
  midasPublication: MidasPublicationViewState;
  onToggle: () => void;
  onSyncNow: () => void;
  onSignOut: () => void | Promise<void>;
  onRefreshGastappCanonicalV2: () => void;
  onDownloadGastappCanonicalV2: (kind: GastappReportExportKind) => void;
  onRepublishMidas: () => void;
}

export const SyncStatusSection: React.FC<SyncStatusSectionProps> = ({
  open,
  authUid,
  fsStatus,
  syncMessage,
  fsDebug,
  gastappCanonicalV2,
  midasPublication,
  onToggle,
  onSyncNow,
  onSignOut,
  onRefreshGastappCanonicalV2,
  onDownloadGastappCanonicalV2,
  onRepublishMidas,
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
          <div className="text-sm font-semibold text-slate-900">Integración con GastApp</div>
          <div className="text-[11px] text-slate-500">Estado de conexión, sesión e informes</div>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">Publicación Aurum → MIDAS</div>
                <div className="text-[11px] text-slate-500">Último cierre completo y trazable disponible</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={midasPublication.status === 'publishing'}
                onClick={onRepublishMidas}
              >
                {midasPublication.status === 'publishing' ? 'Publicando…' : 'Regenerar publicación MIDAS'}
              </Button>
            </div>
            <div
              className={`whitespace-pre-line text-[11px] ${
                midasPublication.status === 'error' ? 'text-amber-700' : 'text-slate-600'
              }`}
            >
              {midasPublication.message}
            </div>
          </div>
          <GastappCanonicalV2Section
            state={gastappCanonicalV2}
            onRefresh={onRefreshGastappCanonicalV2}
            onDownload={onDownloadGastappCanonicalV2}
          />
        </div>
      )}
    </Card>
  );
};
