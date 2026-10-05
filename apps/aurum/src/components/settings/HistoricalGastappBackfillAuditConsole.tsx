import React, { useState } from 'react';
import { Button } from '../Components';
import {
  runHistoricalGastappBackfillAudit,
  type HistoricalGastappBackfillAuditResult,
} from '../../services/historicalGastappSnapshotBackfill';
import { executeHistoricalGastappSidecarBackfill } from '../../services/historicalGastappBackfillWrite';

const ADMIN_EMAIL = 'diegorp.1978@gmail.com';

const number = (value: number | null | undefined) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(value))
  : '—';

const coverage = (valid: number, expected: number) => `${valid}/${expected}`;

export const HistoricalGastappBackfillAuditConsole: React.FC<{ authEmail: string }> = ({ authEmail }) => {
  const [result, setResult] = useState<HistoricalGastappBackfillAuditResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const authorized = authEmail.trim().toLowerCase() === ADMIN_EMAIL ||
    (import.meta.env.VITE_E2E_USE_FIREBASE_EMULATOR === 'true' && authEmail.trim().toLowerCase() === 'aurum.e2e@example.test');

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

  const executeBackfill = async () => {
    setBusy(true);
    setMessage('Ejecutando controles, backup y transacción sidecar…');
    try {
      const outcome = await executeHistoricalGastappSidecarBackfill();
      setMessage(`Completado: ${outcome.created} snapshots; ${outcome.backupId ? `backup ${outcome.backupId}` : 'sin backup nuevo (idempotencia)'}; cierres PRE/POST ${outcome.rootPreFingerprint === outcome.rootPostFingerprint ? 'idénticos' : 'DIFERENTES'}.`);
      setResult(await runHistoricalGastappBackfillAudit());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Backfill detenido.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-sm" aria-labelledby="historical-gastapp-audit-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="historical-gastapp-audit-title" className="font-semibold text-slate-900">Auditoría histórica GastApp</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Lee desde servidor los cierres de Aurum, el sidecar y el contrato mensual oficial Canonical V2. La auditoría no escribe datos.
          </p>
        </div>
        <Button className="h-auto min-h-10" variant="outline" disabled={busy} onClick={() => void runAudit()}>
          {busy ? 'Leyendo y simulando…' : 'Generar auditoría read-only'}
        </Button>
      </div>

      {message && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-white p-2 text-rose-800">{message}</p>}

      {result && (() => {
        const { preview, sources } = result;
        const size = preview.sidecarSize;
        const sizeLabel = `${number(size.currentApproxBytes)} B → ${number(size.projectedApproxBytes)} B; margen estimado ${number(size.maxBytes - size.projectedApproxBytes)} B`;
        const current = preview.coverage.current;
        const projected = preview.coverage.projected;
        const statusLabel = {
          within_limit: 'Dentro del margen',
          near_limit: 'Cerca del límite: bloquear escritura',
          over_limit: 'Supera el límite: bloquear escritura',
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
              <strong>Tamaño aproximado del sidecar:</strong> {sizeLabel} · {statusLabel}. Reserva configurada: {number(size.reserveBytes)} B.
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
              Proyección en memoria. Fingerprints financieros PRE/POST verificados por cierre. El documento raíz permanece intacto.
            </p>
            {preview.blockers === 0 && size.status === 'within_limit' && (
              <Button variant="outline" disabled={busy} onClick={() => void executeBackfill()}>
                {busy ? 'Verificando…' : preview.snapshotsToComplete === 0 ? 'Verificar idempotencia (0 cambios)' : 'Ejecutar backfill sidecar certificado'}
              </Button>
            )}
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
