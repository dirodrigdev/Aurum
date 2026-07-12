import React, { useEffect, useState } from 'react';
import { Button, Card, Input } from '../Components';
import { formatCurrency, formatMonthLabel } from '../../utils/wealthFormat';
import { loadSuggestedClosureRates, type SuggestedClosureRates } from '../../services/closureFxRates';
import {
  applyHistoricalClosureCorrection,
  downloadHistoricalBackup,
  exportHistoricalClosureBackup,
  prepareHistoricalClosureCorrection,
  previewHistoricalClosureCorrection,
  previewHistoricalClosureRollback,
  readHistoricalClosureCloud,
  rollbackHistoricalClosureCorrection,
  type HistoricalClosureRead,
  type HistoricalFxRates,
  type HistoricalPreparedCorrection,
  type HistoricalPreview,
  type HistoricalRollbackPreview,
} from '../../services/historicalClosureCorrectionClient';

const ADMIN_EMAIL = 'diegorp.1978@gmail.com';
const MONTHS = ['2026-05', '2026-06'];
const rateRows = [
  ['usd', 'USD/CLP', 'usdClp'],
  ['eur', 'EUR/CLP', 'eurClp'],
  ['uf', 'UF/CLP', 'ufClp'],
] as const;

type FxKey = typeof rateRows[number][2];
type ReasonKind = 'previous' | 'economic' | 'manual' | 'other';

const exactConfirmation = (monthKey: string, rollback = false) => {
  const month = formatMonthLabel(monthKey).toLowerCase();
  return rollback
    ? `Confirmo que deseo restaurar el cierre histórico de ${month} desde el checkpoint.`
    : `Confirmo que deseo corregir las tasas y recalcular el cierre histórico de ${month}.`;
};

const asFx = (rates: Record<FxKey, string>): HistoricalFxRates | null => {
  const parsed = Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, Number(String(value).replace(',', '.'))])) as HistoricalFxRates;
  return Object.values(parsed).every((value) => Number.isFinite(value) && value > 0) ? parsed : null;
};

const number = (value: number | null | undefined, decimals = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('es-CL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value))
  : '—';

const percent = (value: number | null | undefined) => value === null || !Number.isFinite(Number(value))
  ? '—'
  : `${Number(value) > 0 ? '+' : ''}${number(Number(value) * 100)}%`;

const toRateDraft = (fx: HistoricalFxRates) => ({
  usdClp: String(fx.usdClp),
  eurClp: String(fx.eurClp),
  ufClp: String(fx.ufClp),
});

const errorMessage = (error: unknown) => String((error as { message?: string })?.message || 'No pude completar la operación.');

export const HistoricalFxCorrectionConsole: React.FC<{
  authEmail: string;
  onApplied: () => Promise<void> | void;
}> = ({ authEmail, onApplied }) => {
  const authorized = authEmail.trim().toLowerCase() === ADMIN_EMAIL;
  const [monthKey, setMonthKey] = useState('2026-05');
  const [read, setRead] = useState<HistoricalClosureRead | null>(null);
  const [references, setReferences] = useState<SuggestedClosureRates | null>(null);
  const [draft, setDraft] = useState<Record<FxKey, string>>({ usdClp: '', eurClp: '', ufClp: '' });
  const [manual, setManual] = useState(false);
  const [preview, setPreview] = useState<HistoricalPreview | null>(null);
  const [prepared, setPrepared] = useState<HistoricalPreparedCorrection | null>(null);
  const [backupExported, setBackupExported] = useState(false);
  const [reasonKind, setReasonKind] = useState<ReasonKind>('economic');
  const [otherReason, setOtherReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [rollbackPreview, setRollbackPreview] = useState<HistoricalRollbackPreview | null>(null);
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');
  const [busy, setBusy] = useState<'read' | 'preview' | 'prepare' | 'export' | 'apply' | 'rollback-preview' | 'rollback' | null>(null);
  const [message, setMessage] = useState('');
  const [resultState, setResultState] = useState<'idle' | 'read' | 'preview' | 'prepared' | 'applied' | 'restored' | 'conflict' | 'error'>('idle');

  const reason = reasonKind === 'previous'
    ? 'Tasa heredada del cierre anterior.'
    : reasonKind === 'economic'
      ? 'Corrección de fecha económica.'
      : reasonKind === 'manual'
        ? 'Corrección manual.'
        : otherReason.trim();
  const fx = asFx(draft);
  const confirmationText = exactConfirmation(monthKey);
  const rollbackText = exactConfirmation(monthKey, true);

  const invalidatePrepared = () => {
    setPreview(null);
    setPrepared(null);
    setBackupExported(false);
    setReviewed(false);
    setConfirmation('');
    setRollbackPreview(null);
    setRollbackConfirmation('');
  };

  useEffect(() => {
    setRead(null);
    setReferences(null);
    setDraft({ usdClp: '', eurClp: '', ufClp: '' });
    setManual(false);
    invalidatePrepared();
    setMessage('');
    setResultState('idle');
  }, [monthKey]);

  if (!authorized) return null;

  const readCloud = async () => {
    setBusy('read');
    setMessage('');
    try {
      const cloud = await readHistoricalClosureCloud(monthKey);
      setRead(cloud);
      const suggested = await loadSuggestedClosureRates(monthKey);
      setReferences(suggested);
      const source = suggested.status === 'available'
        ? { ...cloud.closure.fxRates, ...suggested.suggestedFxRates }
        : cloud.closure.fxRates;
      setDraft(toRateDraft(source));
      setManual(false);
      invalidatePrepared();
      setResultState('read');
      setMessage('Cierre leído directamente desde Firestore.');
    } catch (error) {
      const text = errorMessage(error);
      setResultState(Number((error as { status?: number })?.status) === 409 ? 'conflict' : 'error');
      setMessage(text);
    } finally {
      setBusy(null);
    }
  };

  const calculatePreview = async () => {
    if (!read || !fx) return setMessage('Completa USD/CLP, EUR/CLP y UF/CLP con valores positivos.');
    setBusy('preview');
    setMessage('');
    try {
      const next = await previewHistoricalClosureCorrection({ monthKey, expectedFingerprint: read.fingerprint, proposedFxRates: fx });
      setPreview(next);
      setPrepared(null);
      setBackupExported(false);
      setReviewed(false);
      setConfirmation('');
      setResultState('preview');
      setMessage('Preview calculada sin escribir datos.');
    } catch (error) {
      const status = Number((error as { status?: number })?.status);
      if (status === 409) invalidatePrepared();
      setResultState(status === 409 ? 'conflict' : 'error');
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const prepare = async () => {
    if (!read || !preview || !reason) return setMessage('Indica un motivo antes de preparar la corrección.');
    setBusy('prepare');
    try {
      const next = await prepareHistoricalClosureCorrection({ monthKey, expectedFingerprint: read.fingerprint, reason });
      setPrepared(next);
      setBackupExported(false);
      setResultState('prepared');
      setMessage('Backup y checkpoint preparados y verificados en cloud.');
    } catch (error) {
      setResultState(Number((error as { status?: number })?.status) === 409 ? 'conflict' : 'error');
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = async () => {
    if (!prepared) return;
    setBusy('export');
    try {
      const payload = await exportHistoricalClosureBackup(prepared.backupId);
      downloadHistoricalBackup(payload, monthKey);
      setBackupExported(true);
      setMessage('Backup exportado. Revisa el archivo antes de aplicar.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!read || !preview || !prepared || !fx || !reason || !backupExported || !reviewed || confirmation !== confirmationText) return;
    setBusy('apply');
    try {
      const result = await applyHistoricalClosureCorrection({
        monthKey,
        expectedFingerprint: read.fingerprint,
        backupId: prepared.backupId,
        checkpointId: prepared.checkpointId,
        proposedFxRates: fx,
        suggestedFxRates: references?.suggestedFxRates || fx,
        reason,
        confirmationText: confirmation,
      });
      const reread = await readHistoricalClosureCloud(monthKey);
      setRead(reread);
      setResultState('applied');
      setMessage(`Corrección aplicada y verificada. Operación ${result.operationId}.`);
      await onApplied();
    } catch (error) {
      const status = Number((error as { status?: number })?.status);
      if (status === 409) invalidatePrepared();
      setResultState(status === 409 ? 'conflict' : 'error');
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const inspectRollback = async () => {
    if (!prepared) return;
    setBusy('rollback-preview');
    try {
      setRollbackPreview(await previewHistoricalClosureRollback(monthKey, prepared.checkpointId));
      setMessage('Restauración revisada. Se creará un nuevo backup preventivo al confirmar.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async () => {
    if (!read || !prepared || !rollbackPreview || rollbackConfirmation !== rollbackText) return;
    setBusy('rollback');
    try {
      const result = await rollbackHistoricalClosureCorrection({
        monthKey,
        checkpointId: prepared.checkpointId,
        expectedFingerprint: read.fingerprint,
        reason: 'Restauración manual revisada desde la consola de FX histórico.',
        confirmationText: rollbackConfirmation,
      });
      setRead(await readHistoricalClosureCloud(monthKey));
      setResultState('restored');
      setMessage(`Cierre restaurado y verificado. Backup preventivo ${result.safetyBackupId}.`);
      await onApplied();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="historical-fx-correction-console" className="border border-amber-200 bg-amber-50/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Corrección segura de FX históricos</h3>
          <p className="mt-1 text-[11px] text-slate-600">Esta herramienta modifica cierres históricos. Cada corrección requiere backup, checkpoint, preview y confirmación explícita.</p>
        </div>
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Solo auditoría autorizada</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
        <label className="text-xs text-slate-700">Mes
          <select data-testid="historical-month-select" value={monthKey} onChange={(event) => setMonthKey(event.target.value)} disabled={busy !== null} className="mt-1 block h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs">
            {MONTHS.map((month) => <option key={month} value={month}>{formatMonthLabel(month)}</option>)}
          </select>
        </label>
        <div className="text-[11px] text-slate-500">Estado: <span className="font-medium text-slate-700">{resultState === 'idle' ? 'No leído' : resultState === 'read' ? 'Leído' : resultState === 'preview' ? 'Preview lista' : resultState === 'prepared' ? 'Backup preparado' : resultState === 'applied' ? 'Corregido' : resultState === 'restored' ? 'Restaurado' : resultState === 'conflict' ? 'Conflicto' : 'Error'}</span></div>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void readCloud()}>{busy === 'read' ? 'Leyendo...' : 'Leer cierre desde Firestore'}</Button>
      </div>

      {!!message && <div role="status" className={`mt-3 rounded-lg border px-2.5 py-2 text-xs ${resultState === 'error' || resultState === 'conflict' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700'}`}>{message}</div>}

      {read && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Fecha económica</div><div className="font-medium">{new Date(`${monthKey}-01T12:00:00`).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Fecha operativa</div><div className="font-medium">{read.closure.closedAt ? new Date(read.closure.closedAt).toLocaleString('es-CL') : '—'}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Records / monedas</div><div className="font-medium">{read.recordCount} · {read.currencies.join(', ') || '—'}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Auditoría</div><div className="font-medium">{read.checkpointCount} checkpoint(s)</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Neto sin / con CapRiesgo</div><div className="font-medium tabular-nums">{Number.isFinite(Number(read.closure.summary?.netClp)) ? formatCurrency(Number(read.closure.summary.netClp), 'CLP') : '—'} / {Number.isFinite(Number(read.closure.summary?.netClpWithRisk)) ? formatCurrency(Number(read.closure.summary.netClpWithRisk), 'CLP') : '—'}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Snapshot / metadata FX</div><div className="font-medium">{read.closure.records?.length ? 'Detallado' : 'Summary-only'} · {read.closure.fxMetadata ? 'sí' : 'no'}</div></div>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-sky-950">Tasas históricas del cierre</div><div className="text-[11px] text-sky-800">La referencia se consulta para este mes económico; la propuesta no persiste hasta aplicar.</div></div><span className="text-[10px] text-sky-700">Fingerprint {read.fingerprint.slice(0, 12)}…</span></div>
            <div className="mt-2 overflow-x-auto"><table className="min-w-[580px] w-full text-[11px]"><thead className="text-left text-slate-500"><tr><th className="pb-1">Tasa</th><th className="pb-1 text-right">Actual persistida</th><th className="pb-1 text-right">Referencia de cierre</th><th className="pb-1 text-right">Propuesta editable</th><th className="pb-1 text-right">Diferencia</th></tr></thead><tbody>
              {rateRows.map(([key, label, field]) => {
                const current = Number(read.closure.fxRates?.[field]);
                const reference = references?.references[key];
                const proposal = Number(draft[field]);
                return <tr key={key} className="border-t border-sky-100"><td className="py-1.5 font-medium text-slate-800">{label}</td><td className="py-1.5 text-right tabular-nums">{number(current)}</td><td className="py-1.5 text-right tabular-nums"><div>{reference?.value ? number(reference.value) : '—'}</div><div className="text-[10px] text-sky-700">{reference?.effectiveDate ? `${reference.availability === 'final' ? 'Referencia de cierre' : reference.availability} · ${reference.effectiveDate}` : references ? 'No disponible' : 'Cargando referencia…'}</div></td><td className="py-1.5 text-right"><Input aria-label={`${label} propuesta`} className="ml-auto h-7 w-24 px-2 text-right text-[11px] tabular-nums" value={draft[field]} inputMode="decimal" disabled={busy !== null || resultState === 'applied'} onChange={(event) => { setDraft((previous) => ({ ...previous, [field]: event.target.value })); setManual(true); invalidatePrepared(); setResultState('read'); }} /></td><td className="py-1.5 text-right tabular-nums">{Number.isFinite(proposal) ? number(proposal - current) : '—'}</td></tr>;
              })}
            </tbody></table></div>
            <div className="mt-2 text-[11px] text-sky-800">Origen de propuesta: <span className="font-medium">{manual ? 'Manual' : references?.status === 'available' ? 'Referencia' : 'Fallback persistido'}</span>{references?.warnings?.length ? ` · ${references.warnings[0]}` : ''}</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="text-xs text-slate-700">Motivo<select value={reasonKind} onChange={(event) => { setReasonKind(event.target.value as ReasonKind); invalidatePrepared(); }} className="mt-1 block h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="previous">Tasa heredada del cierre anterior</option><option value="economic">Corrección de fecha económica</option><option value="manual">Corrección manual</option><option value="other">Otro</option></select></label><div className="flex items-end"><Button size="sm" disabled={busy !== null || !fx} onClick={() => void calculatePreview()}>{busy === 'preview' ? 'Calculando...' : 'Calcular impacto'}</Button></div></div>
          {reasonKind === 'other' && <Input aria-label="Motivo adicional" className="h-8 text-xs" value={otherReason} onChange={(event) => { setOtherReason(event.target.value); invalidatePrepared(); }} placeholder="Describe el motivo" />}

          {preview && <PreviewPanel preview={preview} />}

          {preview && <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold">Backup y checkpoint</div><div className="text-[11px] text-slate-500">Se preparan en cloud antes de habilitar una escritura.</div></div><Button size="sm" variant="outline" disabled={busy !== null || !reason} onClick={() => void prepare()}>{busy === 'prepare' ? 'Preparando...' : 'Preparar corrección'}</Button></div>{prepared && <div className="rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-900">Backup {prepared.backupId} · checkpoint {prepared.checkpointId} · {prepared.chunkCount} chunk(s) · cloud verificado: {prepared.cloudVerified ? 'sí' : 'no'}<div className="mt-2"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void exportBackup()}>{busy === 'export' ? 'Exportando...' : 'Descargar backup JSON'}</Button>{backupExported && <span className="ml-2 font-medium">Backup preparado y descargable</span>}</div></div>}</div>}

          {prepared && preview && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2"><div className="text-xs font-semibold text-amber-950">Aplicar corrección histórica</div><div className="text-[11px] text-amber-900">{formatMonthLabel(monthKey)} · neto sin CapRiesgo {formatCurrency(preview.withoutRisk.before, 'CLP')} → {formatCurrency(preview.withoutRisk.after, 'CLP')} · backup listo: {prepared.backupId}</div><label className="flex gap-2 text-[11px] text-amber-950"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={busy !== null || !backupExported} />Confirmo que revisé el backup y el impacto de esta corrección.</label><Input aria-label="Confirmación exacta de corrección" className="h-8 text-xs" disabled={busy !== null || !backupExported} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={confirmationText} /><Button variant="danger" size="sm" disabled={busy !== null || !backupExported || !reviewed || confirmation !== confirmationText} onClick={() => void apply()}>{busy === 'apply' ? 'Aplicando...' : 'Aplicar corrección histórica'}</Button></div>}

          {resultState === 'applied' && prepared && <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"><div className="text-xs font-semibold">Rollback</div><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void inspectRollback()}>{busy === 'rollback-preview' ? 'Revisando...' : 'Revisar restauración'}</Button>{rollbackPreview && <><div className="text-[11px] text-slate-700">USD/CLP {number(rollbackPreview.currentFxRates.usdClp)} → {number(rollbackPreview.restoredFxRates.usdClp)} · neto {formatCurrency(rollbackPreview.currentNetClp, 'CLP')} → {formatCurrency(rollbackPreview.restoredNetClp, 'CLP')}</div><Input aria-label="Confirmación exacta de rollback" className="h-8 text-xs" value={rollbackConfirmation} onChange={(event) => setRollbackConfirmation(event.target.value)} placeholder={rollbackText} /><Button size="sm" variant="danger" disabled={busy !== null || rollbackConfirmation !== rollbackText} onClick={() => void rollback()}>{busy === 'rollback' ? 'Restaurando...' : 'Restaurar desde checkpoint'}</Button></>}</div>}
        </div>
      )}
    </Card>
  );
};

const PreviewPanel: React.FC<{ preview: HistoricalPreview }> = ({ preview }) => <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs font-semibold text-slate-900">Preview de impacto</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><DeltaCard title="Patrimonio sin CapRiesgo" delta={preview.withoutRisk} /><DeltaCard title="Patrimonio con CapRiesgo" delta={preview.withRisk} /></div><div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">{Object.entries(preview.exposureNetByCurrency).map(([currency, value]) => <div key={currency} className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-slate-500">Exposición {currency}</div><div className="font-medium tabular-nums">{number(value)}</div></div>)}</div><div className="mt-3 text-[11px] text-slate-600">Reconciliación: sin riesgo {preview.reconciliation.beforeWithoutRisk ? 'OK' : 'pendiente'} · con riesgo {preview.reconciliation.beforeWithRisk ? 'OK' : 'pendiente'} · propuesta {preview.reconciliation.after ? 'OK' : 'pendiente'}</div><div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2"><div><div className="font-medium">Impacta al releer</div>{preview.consumers.derivedAutomatically.map((item) => <div key={item}>• {item}</div>)}</div><div><div className="font-medium">No modifica</div>{preview.consumers.notModified.map((item) => <div key={item}>• {item}</div>)}</div></div></div>;

const DeltaCard: React.FC<{ title: string; delta: { before: number; after: number; difference: number; differencePct: number | null } }> = ({ title, delta }) => <div className="rounded-lg border border-slate-200 bg-white p-2 text-[11px]"><div className="text-slate-500">{title}</div><div className="mt-1 font-medium tabular-nums">{formatCurrency(delta.before, 'CLP')} → {formatCurrency(delta.after, 'CLP')}</div><div className="mt-1 tabular-nums text-emerald-700">{formatCurrency(delta.difference, 'CLP')} · {percent(delta.differencePct)}</div></div>;
