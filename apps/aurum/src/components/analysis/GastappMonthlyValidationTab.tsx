import React, { useEffect, useState } from 'react';

import { Card } from '../Components';
import {
  loadGastappCanonicalV2Audit,
  type GastappCanonicalV2AuditResult,
  type GastappAuditCheckStatus,
} from '../../services/gastappCanonicalV2Audit';
import { ReturnsTab, type ReturnsTabProps } from './ReturnsTab';

const checkLabel = (status: GastappAuditCheckStatus) => {
  if (status === 'pass') return 'Correcto';
  if (status === 'not_proven') return 'No probado por contrato';
  return 'Alerta';
};

const Check: React.FC<{ label: string; status: GastappAuditCheckStatus }> = ({ label, status }) => (
  <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
    <span>{label}</span>
    <span className={status === 'pass' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
      {checkLabel(status)}
    </span>
  </div>
);

const formatEur = (value: number | null) => value === null
  ? '—'
  : `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const AuditCard: React.FC<{ result: GastappCanonicalV2AuditResult }> = ({ result }) => {
  if (result.status === 'unavailable' || !result.concordance) {
    return (
      <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="gastapp-canonical-v2-audit">
        <div className="font-semibold">Auditoría Canónico V2 no disponible</div>
        <div className="mt-1 text-xs">{result.error}</div>
        <div className="mt-1 text-[11px]">No se usó legacy como fallback y no se hizo ninguna lectura por fila.</div>
      </Card>
    );
  }

  const { concordance, contracts } = result;
  return (
    <Card className="border-slate-200 p-3" data-testid="gastapp-canonical-v2-audit">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">Auditoría de conservación V2</div>
          <div className="mt-0.5 text-[11px] text-slate-600">Períodos reales para trazabilidad; meses calendario como única serie oficial de Aurum.</div>
        </div>
        <div className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
          {concordance.status === 'ok' ? 'Concordancia correcta' : 'Concordancia con límites explícitos'}
        </div>
      </div>

      <div className="mt-2 grid gap-1 text-[11px] text-slate-700 sm:grid-cols-2">
        <div>Hash operativo: <span className="break-all font-semibold">{concordance.canonicalDataHash}</span></div>
        <div>Actualización: <span className="font-semibold">{concordance.generatedAt || 'no publicada'}</span></div>
        <div>Cobertura mensual: <span className="font-semibold">{contracts.months.coverage.completeFromMonthKey || '—'} → {contracts.months.coverage.completeThroughMonthKey || '—'}</span></div>
        <div>Fronteras parciales: <span className="font-semibold">{contracts.months.coverage.partialBoundaryMonths.join(', ') || '—'}</span></div>
      </div>

      <div className="mt-3 grid gap-1 text-[11px] sm:grid-cols-2">
        <Check label="Identidad canónica común" status={concordance.global.identities} />
        <Check label="Conteo global de filas" status={concordance.global.rowCount} />
        <Check label="Total global" status={concordance.global.total} />
        <Check label="Familias globales" status={concordance.global.families} />
        <Check label="Rango exacto por mismas filas" status={concordance.exactDateRange.status} />
        <Check label="Pérdida/duplicación por fila" status={concordance.rowControls.status} />
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
        <div className="font-semibold text-slate-900">Comparación de negocio, no control de integridad</div>
        <div className="mt-1 grid gap-1 sm:grid-cols-3">
          <div>Últimos 12 períodos: <span className="font-semibold">{formatEur(concordance.businessComparison.periods12Eur)}</span></div>
          <div>Últimos 12 meses: <span className="font-semibold">{formatEur(concordance.businessComparison.calendarMonths12Eur)}</span></div>
          <div>Diferencia: <span className="font-semibold">{formatEur(concordance.businessComparison.differenceEur)}</span></div>
        </div>
        <div className="mt-1 text-[10px] text-slate-500">{concordance.businessComparison.detail}</div>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        {concordance.exactDateRange.detail} {concordance.rowControls.detail}
      </div>
    </Card>
  );
};

export const GastappMonthlyValidationTab: React.FC<{
  officialReturnsProps: ReturnsTabProps;
  officialRowsWithoutCrp: unknown[];
}> = ({ officialReturnsProps }) => {
  const [audit, setAudit] = useState<GastappCanonicalV2AuditResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGastappCanonicalV2Audit().then((result) => {
      if (!cancelled) setAudit(result);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-3">
      {!audit ? (
        <Card className="p-4 text-sm text-slate-600">Cargando auditoría Canónico V2…</Card>
      ) : (
        <AuditCard result={audit} />
      )}
      <ReturnsTab {...officialReturnsProps} />
    </div>
  );
};
