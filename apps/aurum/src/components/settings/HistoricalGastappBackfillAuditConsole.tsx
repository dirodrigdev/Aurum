import React, { useState } from 'react';
import { Button } from '../Components';
import {
  runHistoricalGastappBackfillAudit,
  type HistoricalGastappBackfillAuditResult,
} from '../../services/historicalGastappSnapshotBackfill';

const ADMIN_EMAIL = 'diegorp.1978@gmail.com';

const number = (value: number | null | undefined) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(value))
  : '—';

const coverage = (valid: number, expected: number) => `${valid}/${expected}`;

export const HistoricalGastappBackfillAuditConsole: React.FC<{ authEmail: string }> = ({ authEmail }) => {
  const [result, setResult] = useState<HistoricalGastappBackfillAuditResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const authorized = authEmail.trim().toLowerCase() === ADMIN_EMAIL;

  if (!authorized) return null;

  const runAudit = async () => {
    setBusy(true);
    setMessage('');
    setResult(null);
    try {
      setResult(await runHistoricalGastappBackfillAudit());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la auditoría de solo lectura.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-sm" aria-labelledby="historical-gastapp-audit-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="historical-gastapp-audit-title" className="font-semibold text-slate-900">Auditoría histórica GastApp · solo lectura</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Lee desde servidor los cierres de Aurum y el contrato mensual oficial Canonical V2. Simula en memoria los snapshots compatibles; no escribe en Aurum ni en GastApp.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void runAudit()}>
          {busy ? 'Leyendo y simulando…' : 'Generar auditoría read-only'}
        </Button>
      </div>

      {message && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-white p-2 text-rose-800">{message}</p>}

      {result && (() => {
        const { preview, sources } = result;
        const size = preview.documentSize;
        const sizeLabel = size.available
          ? `${number(size.currentApproxBytes)} B → ${number(size.projectedApproxBytes)} B; margen estimado ${number(size.maxBytes - (size.projectedApproxBytes || 0))} B`
          : 'No disponible: la lectura no permitió medir el documento completo.';
        const current = preview.coverage.current;
        const projected = preview.coverage.projected;
        const statusLabel = {
          within_limit: 'Dentro del margen',
          near_limit: 'Cerca del límite: bloquear escritura',
          over_limit: 'Supera el límite: bloquear escritura',
          unavailable: 'No disponible',
        }[size.status];
        return (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
              <div>Aurum: <span className="font-mono">{sources.wealthProjectId || 'proyecto desconocido'}</span> · documento {sources.wealthDocumentExists ? 'encontrado' : 'no encontrado'} · actualizado {sources.wealthUpdatedAt || '—'}</div>
              <div>GastApp: <span className="font-mono">{sources.gastappProjectId || 'proyecto desconocido'}</span> · {sources.gastappContractVersion} · publicado {sources.gastappGeneratedAt} · {sources.gastappMonthsRead} meses</div>
              <div>Lectura de servidor: {result.auditedAt} · {sources.readMode}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric label="Cierres / meses comparables" value={`${preview.totalClosures} / ${preview.comparableMonths}`} />
              <Metric label="Snapshots presentes / por completar" value={`${preview.snapshotsPresent} / ${preview.snapshotsToComplete}`} />
              <Metric label="Último mes oficial" value={preview.lastOfficialMonth || '—'} />
              <Metric label="Bloqueos" value={String(preview.blockers)} />
            </div>

            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              <CoverageMetric label="Desde inicio" current={current.sinceStart} projected={projected.sinceStart} />
              <CoverageMetric label="Últimos 12 meses" current={current.last12m} projected={projected.last12m} />
              <CoverageMetric label="Año hasta la fecha" current={current.ytd} projected={projected.ytd} />
            </div>

            <div className={`rounded-lg border p-2 text-xs ${size.status === 'within_limit' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
              <strong>Tamaño aproximado del documento:</strong> {sizeLabel} · {statusLabel}. Reserva configurada: {number(size.reserveBytes)} B.
            </div>

            {preview.blockers > 0 && (
              <div className="rounded-lg border border-amber-200 bg-white p-2 text-xs text-amber-950">
                <strong>Blockers:</strong> {Object.entries(preview.blockersByStatus).map(([status, count]) => `${status}: ${count}`).join(' · ')}
              </div>
            )}

            <details className="rounded-lg border border-slate-200 bg-white p-2">
              <summary className="cursor-pointer font-medium text-slate-800">Manifest determinista por mes ({preview.manifest.length})</summary>
              <div className="mt-2 max-h-[32rem] overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(preview.manifest, null, 2)}</pre>
              </div>
            </details>

            <p className="rounded-lg border border-slate-200 bg-white p-2 text-xs font-medium text-slate-700">
              Proyección en memoria. Fingerprints financieros PRE/POST verificados por cierre. No se modificó ningún dato.
            </p>
          </div>
        );
      })()}
    </section>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-2">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mt-1 font-semibold tabular-nums text-slate-900">{value}</div>
  </div>
);

const CoverageMetric: React.FC<{
  label: string;
  current: { valid: number; expected: number };
  projected: { valid: number; expected: number };
}> = ({ label, current, projected }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-2">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mt-1 flex items-center justify-between gap-2 font-semibold tabular-nums text-slate-900">
      <span>Actual {coverage(current.valid, current.expected)}</span>
      <span aria-hidden="true">→</span>
      <span>Proyectada {coverage(projected.valid, projected.expected)}</span>
    </div>
  </div>
);
