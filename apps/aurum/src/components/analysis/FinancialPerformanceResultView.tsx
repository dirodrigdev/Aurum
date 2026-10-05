import React from 'react';
import type { FinancialPerformanceConfirmation, FinancialPerformanceResult, AttributionCoverageStatus } from '../../services/financialPerformance';
import { selectFinancialPerformanceClosure } from '../../services/financialPerformance';
import { dedupeLatestByAsset, isRiskCapitalInvestmentLabel, isSyntheticAggregateRecord, type WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatMonthLabel } from '../../utils/wealthFormat';
import { formatFreedomCompactClp } from './shared';

const pct = (value: number | null) => value === null ? '—' : `${(value * 100).toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;
const money = (value: number | null) => value === null ? 'Pendiente' : formatFreedomCompactClp(value);
const exactMoney = (value: number | null) => value === null ? 'Pendiente' : `$${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coverage = (status: AttributionCoverageStatus, value: number | null) =>
  status === 'no_exposure' ? 'Sin exposición' : status === 'not_evaluated' ? 'Pendiente de atribución' : `Cobertura ${(value ?? 0).toFixed(0)}%`;

export const FinancialPerformanceResultView: React.FC<{
  result: FinancialPerformanceResult;
  confirmation: FinancialPerformanceConfirmation | null;
  hasSavedConfirmation: boolean;
  isLoading: boolean;
  storageReady: boolean;
  storageError: boolean;
  closures: WealthMonthlyClosure[];
  includeRiskCapital: boolean;
}> = ({ result, confirmation, hasSavedConfirmation, isLoading, storageReady, storageError, closures, includeRiskCapital }) => {
  const canPublish = storageReady && !isLoading &&
    (result.quality === 'RECONSTRUIDO' || result.quality === 'EXACTO') && result.returnPct !== null;
  const method = result.returnMethod === 'simple' ? 'Método simple' : result.returnMethod === 'simple_adjusted' ? 'Método simple ajustado' : result.returnMethod === 'modified_dietz' ? 'Modified Dietz' : 'Método pendiente';
  const flowCount = confirmation?.flows.length ?? 0;
  const flowLabel = result.flowListComplete ? `Lista completa${hasSavedConfirmation ? '' : ' · supuesto'} · ${flowCount} ${flowCount === 1 ? 'movimiento' : 'movimientos'}` : 'Lista pendiente';
  const explanation = result.attributionComplete
    ? hasSavedConfirmation
      ? 'Cambio completamente explicado: resultado de inversiones, tipo de cambio e indexación UF.'
      : 'Cambio completamente explicado bajo los supuestos iniciales de esta pantalla.'
    : result.flowListComplete && flowCount > 0
      ? hasSavedConfirmation
        ? 'La rentabilidad usa los flujos confirmados. Sin movimientos de capital por posición, el resultado permanece sin desglose por causa.'
        : 'La rentabilidad provisional usa los flujos ingresados en el borrador, que aún no está guardado.'
      : !result.flowListComplete
        ? 'Falta confirmar la lista completa de aportes y retiros. El cambio de saldo todavía no es rentabilidad.'
        : confirmation?.positionMovementCompleteness !== 'no_unrecorded_movements'
          ? 'Falta confirmar que no hubo compras, ventas ni traslados de posiciones sin registrar.'
          : 'Explicación parcial: faltan posiciones comparables o tasas confiables para completar el desglose.';
  const qualityReason = !hasSavedConfirmation && storageReady
    ? `Supuesto local sin guardar. ${result.qualityReason}`
    : result.qualityReason;
  const causes = [
    { label: 'Resultado de inversiones', value: result.investmentAttributable, id: 'instruments', note: result.investmentAttributable === null ? 'Pendiente de atribución' : result.attributionComplete ? 'Posiciones conciliadas' : 'Atribución parcial' },
    { label: 'Efecto tipo de cambio · USD', value: result.usdFxAttributable, id: 'usd', note: coverage(result.usdFxCoverageStatus, result.usdFxCoveragePct) },
    { label: 'Efecto tipo de cambio · EUR', value: result.eurFxAttributable, id: 'eur', note: coverage(result.eurFxCoverageStatus, result.eurFxCoveragePct) },
    { label: 'Indexación UF', value: result.ufAttributable, id: 'uf', note: coverage(result.ufCoverageStatus, result.ufCoveragePct) },
    { label: 'No explicado', value: result.unexplainedResidual, id: 'residual', note: result.attributionComplete ? 'Residuo dentro de la tolerancia de cálculo' : 'Incluye las causas pendientes; no se atribuye a instrumentos' },
  ];
  const auditValues = [
    ['Saldo inicial', result.initialValue], ['Saldo final', result.finalValue], ['Cambio observado', result.observedChange],
    ['Flujos conocidos', result.confirmedFlowsNetClp], ...causes.map(cause => [cause.label, cause.value]),
  ] as Array<[string, number | null]>;

  return <>
    <div className="mt-5 grid gap-2 border-b border-white/10 pb-4 sm:grid-cols-2">
      {[
        [`Valor inicial · ${formatMonthLabel(result.period.startMonth)}`, result.initialValue],
        [`Valor final · ${formatMonthLabel(result.period.endMonth)}`, result.finalValue],
        ['Variación observada', result.observedChange],
      ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs text-slate-300">{label}</div>
        <div title={exactMoney(value as number | null)} data-testid={label === 'Variación observada' ? 'financial-performance-observed-change' : undefined} className="mt-1 break-words text-base font-semibold text-white">{money(value as number | null)}</div>
      </div>)}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs text-slate-300">Aportes y retiros</div>
        <div className="mt-1 text-base font-semibold text-white">{result.flowListComplete || flowCount ? money(result.confirmedFlowsNetClp) : 'No confirmado'}</div>
        <div className="mt-1 text-xs text-slate-300">{flowLabel}</div>
      </div>
    </div>
    <div className="mt-4 rounded-xl border border-sky-200/20 bg-sky-200/5 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-100">{canPublish ? 'Rentabilidad financiera' : 'Rentabilidad pendiente de validación'}</div>
      <div className="mt-1 break-words text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        <span data-testid="financial-performance-published-value">{isLoading ? 'Cargando…' : canPublish ? pct(result.returnPct) : '—'}</span>
      </div>
      <p className="mt-2 text-xs text-slate-300">{canPublish
        ? hasSavedConfirmation
          ? `${method} · resultado de cartera ${money(result.portfolioResult)}`
          : flowCount === 0
            ? `Supuesto inicial sin guardar · ${method} · la lista vacía se interpreta como cero aportes/retiros.`
            : `Borrador sin guardar · ${method} · se usan los ${flowCount} aportes/retiros ingresados.`
        : storageError ? 'No pudimos comprobar la confirmación guardada.' : 'Se muestra la variación de saldos, no una rentabilidad confirmada.'}</p>
      {canPublish && <p className="mt-1 text-xs text-slate-300">{flowCount > 0
        ? `Rentabilidad en CLP ajustada por los aportes y retiros${hasSavedConfirmation ? ' confirmados' : ' ingresados en el borrador'}.`
        : 'Rentabilidad total observada en CLP, incluidos tipo de cambio e indexación cuando existe exposición.'}</p>}
    </div>
    {canPublish && result.returnWithoutFxPct !== null && <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
      <div className="rounded-lg border border-white/10 p-3"><span>Rentabilidad sin efecto cambiario</span><strong className="mt-1 block text-base text-white">{pct(result.returnWithoutFxPct)}</strong><span>Resultado de inversiones e indexación UF.</span></div>
      <div className="rounded-lg border border-white/10 p-3"><span>Contribución del tipo de cambio</span><strong className="mt-1 block text-base text-white">{result.fxContributionPct === null ? '—' : `${(result.fxContributionPct * 100).toLocaleString('es-CL', { maximumFractionDigits: 2 })} pp`}</strong><span>Sobre el saldo inicial; suma a la rentabilidad sin efecto cambiario.</span></div>
    </div>}
    <section className="mt-5" aria-label="Explicación del cambio">
      <h4 className="text-sm font-semibold text-white">Por qué cambió</h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">{explanation}</p>
      <dl className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10 bg-white/5 px-3">
        {causes.map(cause => <div key={cause.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-3">
          <dt className="min-w-0 flex-1 text-xs text-slate-200">{cause.label}<span className="mt-1 block text-[11px] leading-relaxed text-slate-300">{cause.note}</span></dt>
          <dd title={exactMoney(cause.value)} data-testid={`financial-performance-${cause.id}-result`} className={`max-w-full break-words text-right text-sm font-semibold ${cause.id === 'residual' ? 'text-amber-100' : 'text-white'}`}>{money(cause.value)}</dd>
        </div>)}
      </dl>
    </section>
    <details className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
      <summary className="min-h-6 cursor-pointer font-semibold text-white">Ver cómo se concilia el cálculo</summary>
      <p className="mt-2 leading-relaxed">Variación = flujos conocidos + resultado de inversiones + USD + EUR + UF + no explicado. Los componentes pendientes siguen dentro de lo no explicado.</p>
      <dl className="mt-2 space-y-2">{auditValues.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="break-all font-semibold text-white">{exactMoney(value)}</dd></div>)}</dl>
      <p className="mt-3">{qualityReason}</p>
      <p className="mt-2">{result.attributionComplete ? 'Todas las posiciones conciliadas; tolerancia de $0,01 CLP. No se utiliza el redondeo de la pantalla como prueba de cobertura.' : 'Desglose por causa pendiente o parcial; un residuo redondeado a cero no confirma la cobertura.'}</p>
      {[result.period.startMonth, result.period.endMonth].map(monthKey => {
        const closure = selectFinancialPerformanceClosure(closures, monthKey, includeRiskCapital);
        return <details key={monthKey} className="mt-3 border-t border-white/10 pt-3">
          <summary className="cursor-pointer font-semibold text-white">Cierre y posiciones · {formatMonthLabel(monthKey)}</summary>
          <p className="mt-2 break-words">Cierre {closure?.id || 'no disponible'} · guardado {closure?.closedAt || 'sin fecha'} · mes económico {closure?.fxMetadata?.economicMonthKey || 'no informado'}</p>
          <p className="mt-2 break-words">FX guardado: USD {closure?.fxRates?.usdClp ?? 'pendiente'} · EUR {closure?.fxRates?.eurClp ?? 'pendiente'} · UF {closure?.fxRates?.ufClp ?? 'pendiente'}. Procedencia: USD {closure?.fxMetadata?.rateOrigin?.usd || 'desconocida'} · EUR {closure?.fxMetadata?.rateOrigin?.eur || 'desconocida'} · UF {closure?.fxMetadata?.rateOrigin?.uf || 'desconocida'}.</p>
          <p className="mt-2 break-words">Fecha económica: {closure?.fxMetadata?.economicDate || 'no informada'}. Fuentes: USD {closure?.fxMetadata?.source?.usd || 'no informada'} · EUR {closure?.fxMetadata?.source?.eur || 'no informada'} · UF {closure?.fxMetadata?.source?.uf || 'no informada'}.</p>
          {closure?.fxMetadata?.manualOverrideReason && <p className="mt-2">Motivo manual: {closure.fxMetadata.manualOverrideReason}</p>}
          <ul className="mt-2 space-y-2">{dedupeLatestByAsset(closure?.records || []).map(record => {
            const exclusion = record.block !== 'investment' ? 'Otro bloque patrimonial' : isSyntheticAggregateRecord(record) ? 'Resumen agregado' : !includeRiskCapital && isRiskCapitalInvestmentLabel(record.label) ? 'CapRiesgo fuera del perímetro' : null;
            return <li key={record.id} className="break-words"><span className="font-semibold text-white">{record.label}</span> · {record.currency} · {exclusion ? `Excluida: ${exclusion}` : 'Incluida'}</li>;
          })}</ul>
        </details>;
      })}
    </details>
  </>;
};
