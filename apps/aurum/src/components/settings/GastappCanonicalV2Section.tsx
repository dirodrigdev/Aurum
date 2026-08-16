import React from 'react';
import { Button, Card } from '../Components';
import type {
  GastappCanonicalV2Contracts,
  GastappCanonicalV2ReadCode,
  GastappDataRoomV2ArtifactMode,
  GastappDataRoomV2Pointer,
} from '../../services/gastappCanonicalV2';

export type GastappCanonicalV2DownloadState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  message: string;
};

export type GastappCanonicalV2DiagnosticViewState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  message: string;
  technicalDetail: string | null;
  errorCode: GastappCanonicalV2ReadCode | null;
  contracts: GastappCanonicalV2Contracts | null;
  pointer: GastappDataRoomV2Pointer | null;
  downloads: Record<GastappDataRoomV2ArtifactMode, GastappCanonicalV2DownloadState>;
};

export const describeGastappCanonicalV2DiagnosticState = (
  state: GastappCanonicalV2DiagnosticViewState,
): 'loading' | 'ok' | 'error' => {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'ok') return 'ok';
  return 'error';
};

type Props = {
  state: GastappCanonicalV2DiagnosticViewState;
  onRefresh: () => void;
  onDownload: (mode: GastappDataRoomV2ArtifactMode) => void;
};

const statusLabel = (status: GastappCanonicalV2DiagnosticViewState['status']) =>
  status === 'loading' ? 'Leyendo…' : status === 'ok' ? 'Verificado' : 'Pendiente';

export const GastappCanonicalV2Section: React.FC<Props> = ({ state, onRefresh, onDownload }) => {
  const contracts = state.contracts;
  const pointer = state.pointer;
  const showAccessGuidance = state.errorCode === 'permission_denied';
  return (
    <Card className="border border-emerald-200 bg-emerald-50/30 p-3" data-testid="gastapp-canonical-v2-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">GastApp Canónico V2</div>
          <div className="text-[11px] text-slate-600">Contratos separados y artefactos ZIP preconstruidos · sólo lectura</div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Comprobando…' : 'Comprobar actualización'}
        </Button>
      </div>

      <div className="mt-2 text-[11px] text-slate-700">
        Estado: <span className="font-semibold">{statusLabel(state.status)}</span>
      </div>
      {showAccessGuidance ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
          <div className="font-semibold">Acceso GastApp cerrado</div>
          <div className="mt-1">Los contratos mensuales automáticos siguen disponibles. Express usa acceso estable y sólo se lee al pulsar descargar; Full requiere abrir en GastApp la ventana temporal “Data Room para Aurum” durante 30 min.</div>
          <div className="mt-1">Después pulsa “Comprobar actualización”.</div>
          {state.technicalDetail && <div className="mt-1 break-words text-[10px] text-amber-900/80">{state.technicalDetail}</div>}
        </div>
      ) : (
        <div className="mt-2 whitespace-pre-line text-[11px] text-slate-600">{state.message}</div>
      )}

      {contracts && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-[11px] text-slate-700 sm:grid-cols-2">
            <div>Proyecto: <span className="font-semibold">duofin-c1894</span></div>
            <div>Hash canónico: <span className="font-semibold break-all">{contracts.metadata.canonicalDataHash}</span></div>
            <div>Última publicación: <span className="font-semibold">{contracts.metadata.generatedAt || 'sin fecha'}</span></div>
            <div>Revisión operacional: <span className="font-semibold">{contracts.metadata.operationalRevision ?? '—'}</span></div>
            <div className="sm:col-span-2">Hash operacional: <span className="font-semibold break-all">{contracts.metadata.operationalDataHash || '—'}</span></div>
            <div>Filas: <span className="font-semibold">{contracts.metadata.counts.canonicalRows?.toLocaleString('es-ES') || '—'}</span></div>
            <div>Total: <span className="font-semibold">{contracts.metadata.totalsEur.exact?.toLocaleString('es-ES', { minimumFractionDigits: 2 }) || '—'} €</span></div>
            <div>Períodos aceptados: <span className="font-semibold">{contracts.metadata.counts.acceptedPeriods ?? '—'}/{contracts.metadata.counts.periods ?? '—'}</span></div>
            <div>Diferencia meses/filas: <span className="font-semibold">{contracts.metadata.totalsEur.calendarMinusCanonical ?? '—'} €</span></div>
            <div>Cobertura completa: <span className="font-semibold">{contracts.metadata.coverage.completeFromMonthKey || '—'} → {contracts.metadata.coverage.completeThroughMonthKey || '—'}</span></div>
            <div>Fronteras parciales: <span className="font-semibold">{contracts.metadata.coverage.partialBoundaryMonths.join(', ') || '—'}</span></div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700">
              <div className="font-semibold text-slate-900">Períodos reales</div>
              <div className="mt-1">{contracts.periods.version} · eje {contracts.periods.axis}</div>
              <div className="break-all">Hash: {contracts.periods.contractHash}</div>
              <div>{contracts.periods.periods.length} períodos · {contracts.periods.rowCount.toLocaleString('es-ES')} filas · {contracts.periods.totalEur.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700">
              <div className="font-semibold text-slate-900">Meses calendario</div>
              <div className="mt-1">{contracts.months.version} · eje {contracts.months.axis}</div>
              <div className="break-all">Hash: {contracts.months.contractHash}</div>
              <div>{contracts.months.months.length} meses · {contracts.months.rowCount.toLocaleString('es-ES')} filas · {contracts.months.totalEur.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</div>
            </div>
          </div>
        </>
      )}

      {pointer && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700">
          <div className="font-semibold text-slate-900">Artefactos preconstruidos</div>
          <div className="mt-1">Backend: <span className="font-semibold">{pointer.storageBackend}</span> · lecturas de descarga: puntero → un artefacto</div>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
            <div>Express: {pointer.express.bytes.toLocaleString('es-ES')} bytes</div>
            <div className="break-all">{pointer.express.hash}</div>
            <div>Full: {pointer.full.bytes.toLocaleString('es-ES')} bytes</div>
            <div className="break-all">{pointer.full.hash}</div>
            <div className="sm:col-span-2">Fecha Full: <span className="font-semibold">{pointer.fullFreshness.generatedAt}</span></div>
            <div className="sm:col-span-2">Estado Full: <span className={pointer.fullFreshness.isStale ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>{pointer.fullFreshness.isStale ? 'Stale: snapshot anterior conservado' : 'Fresco: coincide con la operación vigente'}</span></div>
            <div className="sm:col-span-2 break-all">Hash operacional del snapshot: <span className="font-semibold">{pointer.fullFreshness.snapshotOperationalDataHash}</span></div>
            <div className="sm:col-span-2 break-all">Hash operacional vigente: <span className="font-semibold">{pointer.fullFreshness.currentOperationalDataHash}</span></div>
            {pointer.fullFreshness.isStale && <div className="sm:col-span-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">El Full conserva un snapshot inmutable anterior. No afecta gasto mensual, retornos ni Express.</div>}
          </div>
        </div>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(['express', 'full'] as const).map((mode) => {
          const download = state.downloads[mode];
          return (
            <div key={mode} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{mode}</div>
              <Button variant="secondary" size="sm" className="mt-1 w-full" disabled={download.status === 'loading'} onClick={() => onDownload(mode)}>
                {download.status === 'loading' ? 'Verificando…' : `Descargar ${mode}`}
              </Button>
              {!!download.message && <div className="mt-1 whitespace-pre-line break-words text-[10px] text-slate-600">{download.message}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
};
