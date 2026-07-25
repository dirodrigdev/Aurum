import React, { useState } from 'react';
import { Button, Card } from '../Components';
import { loadSuggestedClosureRates } from '../../services/closureFxRates';
import {
  diagnoseHistoricalFxMetadataEvidence,
  type HistoricalFxMetadataDiagnosis,
} from '../../services/historicalFxMetadataRepair';
import {
  readHistoricalClosureCloud,
  reconfirmHistoricalFxMetadataForMidas,
  type HistoricalClosureRead,
} from '../../services/historicalClosureCorrectionClient';
import { publishAurumOptimizableInvestmentsSnapshot } from '../../services/midasPublished';

const confirmationFor = (monthKey: string) => `RECONFIRMO FX ${monthKey}`;
const format = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 6 }).format(value);

export const MidasHistoricalFxMetadataRepair: React.FC<{
  onApplied: (read: HistoricalClosureRead) => Promise<void> | void;
}> = ({ onApplied }) => {
  const monthKey = '2026-06';
  const [read, setRead] = useState<HistoricalClosureRead | null>(null);
  const [diagnosis, setDiagnosis] = useState<HistoricalFxMetadataDiagnosis | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<'diagnose' | 'apply' | null>(null);
  const [message, setMessage] = useState('');

  const diagnose = async () => {
    setBusy('diagnose');
    setMessage('');
    try {
      const cloud = await readHistoricalClosureCloud(monthKey);
      const official = await loadSuggestedClosureRates(monthKey);
      const next = diagnoseHistoricalFxMetadataEvidence(monthKey, cloud.closure.fxRates, official);
      setRead(cloud);
      setDiagnosis(next);
      setReviewed(false);
      setConfirmation('');
      setMessage(next.ok
        ? 'Las tres tasas selladas coinciden exactamente con las referencias oficiales. Puedes confirmar la reparación de metadata.'
        : 'No se escribió nada: alguna tasa no coincide con la evidencia oficial.');
    } catch (error) {
      setMessage(String((error as Error)?.message || 'No pude leer la evidencia histórica oficial.'));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!read || !diagnosis?.ok || !diagnosis.evidence || !reviewed || confirmation.trim().toUpperCase() !== confirmationFor(monthKey)) return;
    setBusy('apply');
    try {
      const result = await reconfirmHistoricalFxMetadataForMidas({
        monthKey,
        expectedFingerprint: read.fingerprint,
        evidence: diagnosis.evidence,
        confirmationText: confirmation,
      });
      if (!result.verification.fxRatesPreserved || !result.verification.metadataCanonical) {
        throw new Error('La verificación posterior no confirmó la metadata canónica.');
      }
      const reread = await readHistoricalClosureCloud(monthKey);
      const published = await publishAurumOptimizableInvestmentsSnapshot([reread.closure as any]);
      if (published.ok === false) throw new Error(`La metadata se guardó, pero no pude publicar hacia MIDAS: ${published.reason}`);
      setRead(reread);
      const sourceCloseId = String(published.snapshot.fxReference?.sourceId || '—');
      setMessage(result.status === 'already_verified'
        ? `La metadata FX ya estaba confirmada y el snapshot ${published.snapshot.snapshotMonth} fue republicado. sourceCloseId: ${sourceCloseId}.`
        : `Metadata FX reparada, auditada y publicada hacia MIDAS. Cierre/snapshot ${published.snapshot.snapshotMonth} · sourceCloseId: ${sourceCloseId} · backup ${result.backupId || '—'}.`);
      await onApplied(reread);
    } catch (error) {
      setMessage(String((error as Error)?.message || 'No pude confirmar la reparación de metadata FX.'));
    } finally {
      setBusy(null);
    }
  };

  return <Card data-testid="midas-historical-fx-metadata-repair" className="mt-3 border border-sky-200 bg-sky-50/40 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-sky-950">Recuperar y republicar cierre 2026-06 para MIDAS</h3><p className="mt-1 text-[11px] text-sky-800">Solo verifica y completa provenance. No permite cambiar las tasas selladas ni recalcula totales.</p></div>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void diagnose()}>{busy === 'diagnose' ? 'Validando…' : 'Validar recuperación histórica'}</Button>
    </div>
    {message && <div role="status" className={`mt-3 rounded-lg border px-2.5 py-2 text-xs ${diagnosis && !diagnosis.ok ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-sky-200 bg-white text-slate-700'}`}>{message}</div>}
    {diagnosis && <div className="mt-3 space-y-3">
      <div className="overflow-x-auto"><table className="min-w-[640px] w-full text-[11px]"><thead className="text-left text-slate-500"><tr><th>Tasa</th><th className="text-right">Sellada</th><th className="text-right">Oficial</th><th className="text-right">Diferencia</th><th>Fecha efectiva / fuente</th><th>Resultado</th></tr></thead><tbody>{diagnosis.rates.map((row) => <tr key={row.key} className="border-t border-sky-100"><td className="py-1.5 font-medium">{row.field}</td><td className="py-1.5 text-right tabular-nums">{format(row.sealed)}</td><td className="py-1.5 text-right tabular-nums">{format(row.official)}</td><td className="py-1.5 text-right tabular-nums">{format(row.difference)}</td><td className="py-1.5">{row.effectiveDate || '—'} · {row.source || '—'}</td><td className={row.valid ? 'py-1.5 text-emerald-700' : 'py-1.5 text-rose-700'}>{row.valid ? 'Coincide' : row.reason}</td></tr>)}</tbody></table></div>
      <div className="text-[11px] text-sky-800">Fecha económica: {diagnosis.economicDate || '—'} · evidencia consultada: {diagnosis.retrievedAt || '—'} · tolerancia técnica: 1e-9.</div>
      {diagnosis.ok && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2"><div className="text-xs font-semibold text-amber-950">Confirmar recuperación y publicación sin cambiar tasas</div><div className="text-[11px] text-amber-900">Se registrará auditoría y backup del cierre {monthKey}; la publicación MIDAS se regenerará y verificará inmediatamente.</div><label className="flex gap-2 text-[11px] text-amber-950"><input type="checkbox" checked={reviewed} disabled={busy !== null} onChange={(event) => setReviewed(event.target.checked)} />Revisé los tres valores, sus fuentes oficiales y la diferencia.</label><div className="text-[11px] font-semibold text-amber-950">Escribe: {confirmationFor(monthKey)}</div><input aria-label="Confirmación metadata FX histórica" className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={confirmation} disabled={busy !== null} onChange={(event) => setConfirmation(event.target.value)} /><Button size="sm" disabled={busy !== null || !reviewed || confirmation.trim().toUpperCase() !== confirmationFor(monthKey)} onClick={() => void apply()}>{busy === 'apply' ? 'Aplicando…' : 'Confirmar recuperación y republicación'}</Button></div>}
    </div>}
  </Card>;
};
