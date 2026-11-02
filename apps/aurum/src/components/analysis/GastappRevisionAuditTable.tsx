import React from 'react';
import type { GastappHistoricalRevisionAuditRow } from '../../services/acceptReviewedGastappRevision';

const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

export const GastappRevisionAuditTable = ({ rows }: { rows: GastappHistoricalRevisionAuditRow[] }) => (
  <section aria-label="Auditoría mensual GastApp" className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
    <h2 className="font-semibold">Auditoría mensual GastApp · solo lectura</h2>
    <p className="my-2 text-xs text-slate-600">Diferencia = GastApp vigente − snapshot efectivo de Aurum. Se muestran ambos almacenes; el cierre tiene prioridad sobre el sidecar.</p>
    {!rows.length ? <p>No hay meses para comparar.</p> : <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Detalle mensual de importes y hashes">
      <table className="w-full min-w-[780px] text-left text-xs">
        <thead><tr>{['Mes / estado', 'Cierre Aurum', 'Sidecar Aurum', 'GastApp vigente', 'Diferencia EUR'].map((title) => <th className="p-2" key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>{rows.map((row) => {
          const stored = row.effectiveSource === 'closure' ? row.closureSnapshot : row.effectiveSource === 'sidecar' ? row.sidecarSnapshot : null;
          const difference = stored?.totalEur != null && row.currentTotalEur !== null ? row.currentTotalEur - stored.totalEur : null;
          return <tr key={`${row.monthKey}:${row.closureId}`} className="border-t border-slate-200 align-top">
            <th scope="row" className="p-2"><span>{row.monthKey}</span><br /><strong>{row.status}</strong><p className="font-normal">Fuente: {row.effectiveSource}</p>{row.message && <p className="max-w-48 font-normal">{row.message}</p>}</th>
            {[row.closureSnapshot, row.sidecarSnapshot].map((snapshot, index) => <td className="p-2" key={index}><p>{money(snapshot.totalEur)} · {snapshot.status}</p><code className="block max-w-56 break-all">{snapshot.contractHash || 'Sin hash'}</code></td>)}
            <td className="p-2"><p>{money(row.currentTotalEur)}</p><code className="block max-w-56 break-all">{row.currentContractHash || 'Sin contrato vigente'}</code></td>
            <td className="p-2 whitespace-nowrap">{money(difference)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </section>
);
