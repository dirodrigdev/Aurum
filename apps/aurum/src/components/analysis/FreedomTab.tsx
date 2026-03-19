import React from 'react';
import { ChevronDown, Zap } from 'lucide-react';
import { Card, Input, cn } from '../Components';
import {
  type buildCoveragePlan,
  type buildMonthlyWithdrawalPlan,
} from '../../services/financialFreedom';
import { formatCurrency, formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import type { FreedomControlDraft } from './types';
import { formatFreedomCompactClp, monthKeyToYearLabel, xLabelFromMonthKey } from './shared';

type FreedomTabProps = {
  sourceMonthKey: string | null;
  patrimonioBaseClp: number | null;
  draft: FreedomControlDraft;
  onChange: (key: keyof FreedomControlDraft, value: string) => void;
  includeRiskCapitalInTotals: boolean;
  isOpen: boolean;
  onToggleParameters: () => void;
  onToggleRiskMode: () => void;
  withdrawalPlan: ReturnType<typeof buildMonthlyWithdrawalPlan>;
  coveragePlan: ReturnType<typeof buildCoveragePlan>;
};

const FreedomStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config =
    status === 'ok'
      ? { label: 'Listo', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
      : status === 'never_depletes'
        ? { label: 'No se agota', className: 'border-sky-200 bg-sky-50 text-sky-700' }
        : status === 'missing_patrimony'
          ? { label: 'Sin patrimonio', className: 'border-amber-200 bg-amber-50 text-amber-700' }
          : { label: 'Revisar', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', config.className)}>
      {config.label}
    </span>
  );
};

const FreedomParametersCard: React.FC<{
  sourceMonthKey: string | null;
  patrimonioBaseClp: number | null;
  draft: FreedomControlDraft;
  onChange: (key: keyof FreedomControlDraft, value: string) => void;
  includeRiskCapitalInTotals: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onToggleRiskMode: () => void;
}> = ({
  sourceMonthKey,
  patrimonioBaseClp,
  draft,
  onChange,
  includeRiskCapitalInTotals,
  isOpen,
  onToggle,
  onToggleRiskMode,
}) => (
  <Card className="border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Simulación</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">Simulación de Libertad Financiera</div>
          {includeRiskCapitalInTotals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              +CapRiesgo
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {sourceMonthKey ? `Tomado automáticamente desde ${monthLabel(sourceMonthKey)}.` : 'Sin cierre base confirmado todavía.'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleRiskMode}
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-full border transition',
            includeRiskCapitalInTotals
              ? 'border-amber-300 bg-amber-50 text-amber-600'
              : 'border-slate-300 bg-white text-slate-500',
          )}
          title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
          aria-label="Alternar capital de riesgo"
        >
          <Zap size={16} />
        </button>
        <div className="rounded-xl bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
          {sourceMonthKey ? monthLabel(sourceMonthKey) : 'Sin cierre'}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600"
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Ocultar parámetros' : 'Mostrar parámetros'}
        >
          <span>{isOpen ? 'Ocultar' : 'Editar'}</span>
          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', isOpen ? 'rotate-180' : '')} />
        </button>
      </div>
    </div>

    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Patrimonio base</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold text-slate-900">
          {patrimonioBaseClp && patrimonioBaseClp > 0 ? formatCurrency(patrimonioBaseClp, 'CLP') : 'Sin datos de patrimonio'}
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">Dato de escenario, no editable.</div>
    </div>

    {!isOpen && (
      <button
        type="button"
        onClick={onToggle}
        className="mt-3 flex w-full items-center justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left text-[11px] text-slate-600"
      >
        <span>Ajustar tasa, horizonte y retiro mensual</span>
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </button>
    )}

    {isOpen && (
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 md:col-span-2">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Tasa anual supuesta</span>
              <div className="relative">
                <Input
                  value={draft.annualRatePct}
                  onChange={(event) => onChange('annualRatePct', event.target.value)}
                  inputMode="decimal"
                  placeholder="5"
                  className="pr-8"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">%</span>
              </div>
              <span className="text-[11px] text-slate-500">Rango pensado para UI: 1% a 15%. Motor usa tasa mensual compuesta.</span>
            </label>

            <label className="grid gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Horizonte años</span>
              <Input
                value={draft.horizonYears}
                onChange={(event) => onChange('horizonYears', event.target.value)}
                inputMode="numeric"
                placeholder="40"
              />
              <span className="text-[11px] text-slate-500">Referencia para el cálculo de retiro mensual máximo.</span>
            </label>

            <label className="grid gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Retiro mensual supuesto</span>
              <div className="relative">
                <Input
                  value={draft.monthlySpendClp}
                  onChange={(event) => onChange('monthlySpendClp', event.target.value)}
                  inputMode="numeric"
                  placeholder="6.000.000"
                  className="pl-7"
                />
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">$</span>
              </div>
              <span className="text-[11px] text-slate-500">Usado para estimar cuántos años duraría el patrimonio.</span>
            </label>
          </div>
        </div>
      </div>
    )}

    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-slate-700">
      <span className="font-medium text-slate-900">Simulación simple determinista:</span>{' '}
      usa una tasa constante y no incorpora volatilidad, crisis, secuencia de retornos ni simulación Monte Carlo.
      Úsalo como referencia rápida, no como proyección exhaustiva.
    </div>
  </Card>
);

const FreedomDrawdownChart: React.FC<{
  points: { monthKey: string; balanceEndClp: number }[];
}> = ({ points }) => {
  if (points.length < 2) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4 text-[11px] text-slate-500">
        La curva aparecerá cuando haya un cálculo válido.
      </div>
    );
  }

  const width = 640;
  const height = 160;
  const padding = { top: 14, right: 14, bottom: 26, left: 14 };
  const values = points.map((point) => point.balanceEndClp);
  const max = Math.max(...values, 1);
  const min = 0;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
  const y = (value: number) => padding.top + ((max - value) / Math.max(1e-6, max - min)) * innerHeight;
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.balanceEndClp).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${x(0).toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
  const labelIndexes = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const startPoint = points[0];
  const midPoint = points[Math.floor((points.length - 1) / 2)];
  const endPoint = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
        <defs>
          <linearGradient id="freedomArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#freedomArea)" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
        {points.map((point, index) => {
          if (!labelIndexes.includes(index)) return null;
          return (
            <g key={`${point.monthKey}-${index}`}>
              <circle cx={x(index)} cy={y(point.balanceEndClp)} r="3.5" fill="#1d4ed8" />
              <text x={x(index)} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                {xLabelFromMonthKey(point.monthKey)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-500">
        <div className="rounded-xl bg-white px-2 py-2">
          <div className="uppercase tracking-wide text-slate-400">Inicio</div>
          <div className="mt-0.5 font-semibold text-slate-700">{formatFreedomCompactClp(startPoint.balanceEndClp)}</div>
        </div>
        <div className="rounded-xl bg-white px-2 py-2">
          <div className="uppercase tracking-wide text-slate-400">Mitad</div>
          <div className="mt-0.5 font-semibold text-slate-700">{formatFreedomCompactClp(midPoint.balanceEndClp)}</div>
        </div>
        <div className="rounded-xl bg-white px-2 py-2">
          <div className="uppercase tracking-wide text-slate-400">Final</div>
          <div className="mt-0.5 font-semibold text-slate-700">{formatFreedomCompactClp(endPoint.balanceEndClp)}</div>
        </div>
      </div>
    </div>
  );
};

const FreedomWithdrawalBlock: React.FC<{
  plan: ReturnType<typeof buildMonthlyWithdrawalPlan>;
  includeRiskCapitalInTotals: boolean;
}> = ({ plan, includeRiskCapitalInTotals }) => (
  <Card className="border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">¿Cuánto puedo retirar?</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Consumiendo capital + rendimientos hasta llegar a 0.</span>
          {includeRiskCapitalInTotals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              +CapRiesgo
            </span>
          )}
        </div>
      </div>
      <FreedomStatusBadge status={plan.status} />
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {plan.horizonYears} años
      </span>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {plan.annualRatePct.toFixed(1).replace('.', ',')}% anual
      </span>
    </div>

    <div className="mt-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">Retiro mensual estimado</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
        {plan.monthlyWithdrawalClp !== null ? formatFreedomCompactClp(plan.monthlyWithdrawalClp) : '—'}
      </div>
      <div className="mt-1 text-[12px] text-slate-600">
        {plan.status === 'ok'
          ? `mensual durante ${plan.horizonYears} años con tasa supuesta de ${plan.annualRatePct.toFixed(1).replace('.', ',')}% anual`
          : plan.message || 'Completa parámetros válidos para calcular el retiro mensual.'}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {plan.totalWithdrawnClp !== null
          ? `Total retirado en el período: ${formatFreedomCompactClp(plan.totalWithdrawnClp)}`
          : 'El total retirado aparecerá cuando el cálculo sea válido.'}
      </div>
    </div>

    <div className="mt-4">
      <FreedomDrawdownChart points={plan.curve} />
    </div>
  </Card>
);

const FreedomCoverageBlock: React.FC<{
  plan: ReturnType<typeof buildCoveragePlan>;
  includeRiskCapitalInTotals: boolean;
}> = ({ plan, includeRiskCapitalInTotals }) => (
  <Card className="border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cobertura estimada del patrimonio</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Cuánto duraría bajo el mismo supuesto determinista.</span>
          {includeRiskCapitalInTotals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              +CapRiesgo
            </span>
          )}
        </div>
      </div>
      <FreedomStatusBadge status={plan.status} />
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {plan.annualRatePct.toFixed(1).replace('.', ',')}% anual
      </span>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {formatFreedomCompactClp(plan.monthlySpendClp)}/mes
      </span>
    </div>

    <div className="mt-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">Años de cobertura</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
        {plan.status === 'never_depletes'
          ? 'No se agota'
          : plan.yearsCoverage !== null
            ? `${plan.yearsCoverage.toFixed(1).replace('.', ',')} años`
            : '—'}
      </div>
      <div className="mt-1 text-[12px] text-slate-600">
        {plan.status === 'never_depletes'
          ? 'Con este escenario simple, el patrimonio no se agota.'
          : plan.status === 'ok'
            ? `retirando ${formatFreedomCompactClp(plan.monthlySpendClp)} mensual con tasa supuesta de ${plan.annualRatePct.toFixed(1).replace('.', ',')}% anual`
            : plan.message || 'Completa parámetros válidos para estimar la cobertura.'}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {plan.status === 'ok'
          ? `Año calendario aproximado: ${monthKeyToYearLabel(plan.approximateEndMonthKey)}`
          : plan.status === 'never_depletes'
            ? `Sin año de agotamiento estimado desde el cierre base ${monthKeyToYearLabel(plan.sourceMonthKey)}`
            : 'El año calendario aproximado aparecerá cuando el cálculo sea válido.'}
      </div>
    </div>

    <div className="mt-4">
      <FreedomDrawdownChart points={plan.curve} />
    </div>
  </Card>
);

export const FreedomTab: React.FC<FreedomTabProps> = ({
  sourceMonthKey,
  patrimonioBaseClp,
  draft,
  onChange,
  includeRiskCapitalInTotals,
  isOpen,
  onToggleParameters,
  onToggleRiskMode,
  withdrawalPlan,
  coveragePlan,
}) => (
  <>
    <FreedomParametersCard
      sourceMonthKey={sourceMonthKey}
      patrimonioBaseClp={patrimonioBaseClp}
      draft={draft}
      onChange={onChange}
      includeRiskCapitalInTotals={includeRiskCapitalInTotals}
      isOpen={isOpen}
      onToggle={onToggleParameters}
      onToggleRiskMode={onToggleRiskMode}
    />

    <div className="grid gap-3 lg:grid-cols-2">
      <FreedomWithdrawalBlock plan={withdrawalPlan} includeRiskCapitalInTotals={includeRiskCapitalInTotals} />
      <FreedomCoverageBlock plan={coveragePlan} includeRiskCapitalInTotals={includeRiskCapitalInTotals} />
    </div>
  </>
);
