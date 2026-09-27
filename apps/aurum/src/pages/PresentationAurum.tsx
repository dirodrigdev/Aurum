import React, { useCallback, useEffect, useState } from 'react';
import { buildAurumPresentationModel, type AurumPresentationViewModel } from '../services/presentationAurumModel';
import {
  FX_RATES_UPDATED_EVENT,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  loadClosures,
  loadFxRates,
  loadIncludeRiskCapitalInTotals,
  loadWealthRecords,
} from '../services/wealthStorage';

const blockLabels = { inversiones: 'Inversiones', bancos: 'Bancos', vivienda: 'Vivienda' } as const;
const blockColors = { inversiones: 'bg-[#15385d]', bancos: 'bg-[#8299a9]', vivienda: 'bg-[#bc8f59]' } as const;
const formatPct = (value: number | null) => value === null ? 'No disponible' : `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;

const AurumPresentationView: React.FC<{ model: AurumPresentationViewModel }> = ({ model }) => {
  const top = [...model.assetShares].sort((a, b) => b.pct - a.pct)[0];
  return <div className="min-h-screen bg-[#f7f3eb] text-[#16253a]" data-testid="aurum-presentation">
    <div className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
      <header className="flex items-center justify-between border-b border-[#233d59]/15 py-5 text-sm">
        <span className="font-bold text-[#15385d]">Aurum <span className="font-normal text-slate-500">· 02 Patrimonio</span></span>
        <span className="text-xs text-slate-500">Presentación · Datos relativos</span>
      </header>
      <main>
        <section className="max-w-3xl pb-9 pt-10 sm:pt-14">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#926430]">Situación patrimonial</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Tu situación patrimonial, reunida y puesta en contexto</h1>
          <p className="mt-4 text-base text-slate-600 sm:text-lg">Estructura, rendimiento histórico y actualización.</p>
        </section>
        <section className="grid gap-5 border-y border-[#233d59]/15 py-6 sm:grid-cols-3 sm:gap-8" aria-label="Señales principales">
          <div className="flex items-baseline justify-between gap-4 border-b border-[#233d59]/15 pb-4 sm:block sm:border-0 sm:pb-0">
            <h2 className="text-sm font-semibold text-slate-600 sm:min-h-11">Mayor componente</h2>
            <p className="text-right text-xl font-semibold text-[#15385d] sm:mt-3 sm:text-left sm:text-lg md:text-xl lg:text-2xl">{top ? `${blockLabels[top.block]} · ${formatPct(top.pct)}` : 'No disponible'}</p>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-[#233d59]/15 pb-4 sm:block sm:border-0 sm:pb-0">
            <div className="sm:min-h-11"><h2 className="text-sm font-semibold text-slate-600">Rendimiento histórico</h2><p className="mt-1 text-xs text-slate-500">36 meses · UF</p></div>
            <p className="text-right text-xl font-semibold text-[#15385d] sm:mt-3 sm:text-left sm:text-2xl">{model.return36mUfPct === null ? 'No disponible' : `${formatPct(model.return36mUfPct)} anualizado`}</p>
            <p className="mt-2 w-full text-xs text-slate-500">El rendimiento histórico es una referencia ajustada por inflación. {model.return36mUfPct === null && model.returnValidMonths > 0 ? `${model.returnValidMonths} de 36 meses válidos.` : ''}</p>
          </div>
          <div className="flex items-baseline justify-between gap-4 sm:block">
            <h2 className="text-sm font-semibold text-slate-600 sm:min-h-11">Actualizado en 7 días</h2>
            <p className="text-right text-lg font-semibold text-[#42576c] sm:mt-3 sm:text-left sm:text-xl">{formatPct(model.fresh7dPct)}</p>
          </div>
        </section>
        <p className="mt-4 text-sm text-slate-600">{model.closurePeriodLabel ? `Cierre: ${model.closurePeriodLabel}. ` : 'Sin cierre con desglose fiable. '}{model.riskCapitalScope === 'incluido' ? 'Con capital de riesgo.' : model.riskCapitalScope === 'excluido' ? 'Sin capital de riesgo.' : ''}</p>
        <section className="py-11" aria-labelledby="aurum-composition-title">
          <h2 id="aurum-composition-title" className="text-2xl font-semibold">Composición de los activos</h2>
          {model.assetShares.length ? <div className="mt-8" data-testid="aurum-asset-chart">
            <div className="flex h-10 overflow-hidden rounded-lg bg-slate-200" role="img" aria-label="Composición relativa de inversiones, bancos y vivienda">
              {model.assetShares.map((item) => <div key={item.block} className={blockColors[item.block]} style={{ width: `${item.pct}%` }} />)}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {model.assetShares.map((item) => <div key={item.block} className="flex items-center justify-between gap-3 text-sm sm:justify-start">
                <span className={`h-3 w-3 shrink-0 rounded-sm ${blockColors[item.block]}`} aria-hidden="true" />
                <span>{blockLabels[item.block]}</span><strong>{formatPct(item.pct)}</strong>
              </div>)}
            </div>
          </div> : <p className="mt-6 text-slate-600" data-testid="aurum-asset-unavailable">Aún no hay un desglose confirmado para mostrar.</p>}
          <p className="mt-6 text-sm text-slate-600">El reparto muestra activos. Las deudas se descuentan al calcular el patrimonio neto.</p>
        </section>
        <section className="border-t border-[#233d59]/15 py-9" aria-labelledby="aurum-conclusions-title">
          <h2 id="aurum-conclusions-title" className="text-2xl font-semibold">Qué indica esta lectura</h2>
          <dl className="mt-5 divide-y divide-[#233d59]/15">
            {([['Estructura', model.conclusions.structure], ['Evolución', model.conclusions.evolution], ['Alcance', model.conclusions.scope]] as const).map(([label, value]) => <div key={label} className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]"><dt className="text-sm font-semibold text-[#926430]">{label}</dt><dd className="text-sm text-slate-700">{value}</dd></div>)}
          </dl>
        </section>
        <section className="flex flex-col gap-4 border-t border-[#233d59]/20 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-xl font-semibold">De la base patrimonial a sus posibles futuros</h2><p className="mt-1 text-sm text-slate-600">MIDAS evalúa si el plan puede sostenerse.</p></div>
          <a href="https://midas-neon.vercel.app/#/presentation" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#17304d] px-5 text-sm font-semibold text-white transition hover:bg-[#234567] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c5964e]">Continuar con MIDAS →</a>
        </section>
      </main>
    </div>
  </div>;
};

export const PresentationAurum: React.FC = () => {
  const forceEmpty = import.meta.env.MODE === 'e2e' && new URLSearchParams(window.location.hash.split('?')[1] || '').get('demoState') === 'empty';
  const readModel = useCallback(() => buildAurumPresentationModel({
    closures: forceEmpty ? [] : loadClosures(),
    records: forceEmpty ? [] : loadWealthRecords(),
    fx: loadFxRates(),
    includeRiskCapitalInTotals: loadIncludeRiskCapitalInTotals(),
  }), [forceEmpty]);
  const [model, setModel] = useState(readModel);

  useEffect(() => {
    const refresh = () => setModel(readModel());
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refresh);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refresh);
    window.addEventListener(RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT, refresh);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refresh);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refresh);
      window.removeEventListener(RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT, refresh);
      window.removeEventListener('focus', onFocus);
    };
  }, [readModel]);

  return <AurumPresentationView model={model} />;
};
