import React from 'react';
import { Button, Card } from '../Components';
import type {
  GastappCanonicalV2Contracts,
  GastappCanonicalV2ReadCode,
  GastappDataRoomV2Pointer,
} from '../../services/gastappCanonicalV2';
import type { GastappReportExportKind } from '../../services/gastappFullHandoff';

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
  downloads: Record<GastappReportExportKind, GastappCanonicalV2DownloadState>;
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
  onDownload: (kind: GastappReportExportKind) => void;
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
          <div className="text-sm font-semibold text-slate-900">Integración con GastApp</div>
          <div className="text-[11px] text-slate-600">Gasto mensual oficial e informes · sólo lectura</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            data-testid="open-gastapp-link"
            href="https://gastapp-chi.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Abrir GastApp
          </a>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Comprobando…' : 'Comprobar actualización'}
          </Button>
        </div>
      </div>

      <div className="mt-2 rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-[11px] text-slate-700">
        Estado de integración: <span className="font-semibold">{statusLabel(state.status)}</span>
      </div>
      {showAccessGuidance ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
          <div className="font-semibold">Informe completo no disponible</div>
          <div className="mt-1">El Informe completo sólo puede leerse con una sesión autenticada de administrador. El Canonical mensual y el Informe resumido siguen disponibles de forma independiente.</div>
          <div className="mt-1">Comprueba la sesión admin y vuelve a intentarlo.</div>
          {state.technicalDetail && (
            <details className="mt-2 text-[10px] text-amber-900/80">
              <summary className="cursor-pointer font-semibold">Detalles técnicos</summary>
              <div className="mt-1 break-words">{state.technicalDetail}</div>
            </details>
          )}
        </div>
      ) : (
        <div className="mt-2 whitespace-pre-line text-[11px] text-slate-600">{state.message}</div>
      )}

      {contracts && (
        <>
          <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700 sm:grid-cols-2">
            <div>Última actualización: <span className="font-semibold">{contracts.metadata.generatedAt || 'sin fecha'}</span></div>
            <div>Revisión operacional: <span className="font-semibold">{contracts.metadata.operationalRevision ?? '—'}</span></div>
            <div>Cobertura: <span className="font-semibold">{contracts.metadata.coverage.completeFromMonthKey || '—'} → {contracts.metadata.coverage.completeThroughMonthKey || '—'}</span></div>
            <div>Estado mensual: <span className="font-semibold">{contracts.months.months.length} meses · {contracts.months.rowCount.toLocaleString('es-ES')} filas</span></div>
            <div className="sm:col-span-2">Informe completo: <span className={pointer?.full ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-500'}>{pointer?.full ? 'Disponible' : 'No disponible'}</span></div>
          </div>

          <details className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700">
            <summary className="cursor-pointer font-semibold text-slate-900">Detalles técnicos</summary>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
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
          </details>
        </>
      )}

      {pointer && (
        <details className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700">
          <summary className="cursor-pointer font-semibold text-slate-900">Detalles técnicos de los informes</summary>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            <div>Informe resumido: {pointer.express.bytes.toLocaleString('es-ES')} bytes</div>
            <div className="break-all">{pointer.express.hash}</div>
            {pointer.full && pointer.fullFreshness ? <>
              <div>Informe completo: {pointer.full.bytes.toLocaleString('es-ES')} bytes</div>
              <div className="break-all">{pointer.full.hash}</div>
              <div className="sm:col-span-2">Fecha informe completo: <span className="font-semibold">{pointer.fullFreshness.generatedAt}</span></div>
              <div className="sm:col-span-2">Estado informe completo: <span className={pointer.fullFreshness.isStale ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>{pointer.fullFreshness.isStale ? 'Versión anterior conservada' : 'Actualizado'}</span></div>
              <div className="sm:col-span-2 break-all">Hash operacional del snapshot: <span className="font-semibold">{pointer.fullFreshness.snapshotOperationalDataHash}</span></div>
              <div className="sm:col-span-2 break-all">Hash operacional vigente: <span className="font-semibold">{pointer.fullFreshness.currentOperationalDataHash}</span></div>
              {pointer.fullFreshness.isStale && <div className="sm:col-span-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">El informe completo conserva una versión anterior. No afecta el gasto mensual oficial, los retornos ni el informe resumido.</div>}
            </> : <div className="sm:col-span-2">Informe completo: <span className="font-semibold">no presente</span></div>}
          </div>
        </details>
      )}

      <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2" data-testid="gastapp-reports-block">
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">INFORMES</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            ['summary_xlsx', 'Descargar informe resumido (.xlsx)'],
            ['full_xlsx', 'Descargar informe completo (.xlsx)'],
            ['ai_json', 'Descargar datos para IA (.json)'],
          ] as const).map(([kind, label]) => {
            const legacyDownloads = state.downloads as typeof state.downloads & { express?: GastappCanonicalV2DownloadState; full?: GastappCanonicalV2DownloadState };
            const download = state.downloads[kind] || (kind === 'summary_xlsx' ? legacyDownloads.express : legacyDownloads.full) || { status: 'idle' as const, message: '' };
            return (
              <div key={kind} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                <Button variant="secondary" size="sm" className="w-full" disabled={download.status === 'loading'} onClick={() => onDownload(kind)}>
                  {download.status === 'loading' ? 'Comprobando…' : label}
                </Button>
                {!!download.message && <div className="mt-1 whitespace-pre-line break-words text-[10px] text-slate-600">{download.message}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
