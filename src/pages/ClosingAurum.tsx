import React, { useMemo, useState } from 'react';
import { Card, Button } from '../components/Components';
import {
  WealthBlock,
  WealthCurrency,
  currentMonthKey,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
  summarizeWealth,
} from '../services/wealthStorage';

type ClosingTab = 'hoy' | 'cierre' | 'evolucion';

const groupWithDots = (value: number) => {
  return Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatCurrency = (value: number, currency: WealthCurrency) => {
  const sign = value < 0 ? '-' : '';
  if (currency === 'CLP') return `${sign}$${groupWithDots(value)}`;
  if (currency === 'UF') {
    const abs = Math.abs(value);
    const intPart = Math.trunc(abs);
    const decimalPart = Math.round((abs - intPart) * 100)
      .toString()
      .padStart(2, '0');
    return `${sign}${groupWithDots(intPart)},${decimalPart} UF`;
  }
  const abs = Math.abs(value);
  const intPart = Math.trunc(abs);
  const decimalPart = Math.round((abs - intPart) * 100)
    .toString()
    .padStart(2, '0');
  return `${sign}${groupWithDots(intPart)},${decimalPart} ${currency}`;
};

const toClp = (amount: number, currency: WealthCurrency, fx: ReturnType<typeof loadFxRates>) => {
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * fx.usdClp;
  if (currency === 'EUR') return amount * fx.eurClp;
  return amount * fx.ufClp;
};

const monthLabel = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1, 12, 0, 0, 0);
  const label = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const blockClp = (
  summary: ReturnType<typeof summarizeWealth>,
  block: WealthBlock,
  fx: ReturnType<typeof loadFxRates>,
) => {
  const b = summary.byBlock[block];
  return b.CLP + b.USD * fx.usdClp + b.EUR * fx.eurClp + b.UF * fx.ufClp;
};

export const ClosingAurum: React.FC = () => {
  const [tab, setTab] = useState<ClosingTab>('hoy');
  const fx = useMemo(() => loadFxRates(), []);
  const monthKey = useMemo(() => currentMonthKey(), []);

  const closures = useMemo(() => loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)), []);
  const latestClosure = closures[0] || null;
  const previousClosure = closures[1] || null;

  const currentSummary = useMemo(() => {
    const monthRecords = latestRecordsForMonth(loadWealthRecords(), monthKey);
    return summarizeWealth(monthRecords, fx);
  }, [monthKey, fx]);

  const hoyVsLast = useMemo(() => {
    if (!latestClosure) return null;
    const current = currentSummary.netConsolidatedClp;
    const prev = latestClosure.summary.netConsolidatedClp;
    return { abs: current - prev, pct: prev !== 0 ? ((current - prev) / prev) * 100 : null };
  }, [latestClosure, currentSummary]);

  const closeVsPrev = useMemo(() => {
    if (!latestClosure || !previousClosure) return null;
    const current = latestClosure.summary.netConsolidatedClp;
    const prev = previousClosure.summary.netConsolidatedClp;
    return { abs: current - prev, pct: prev !== 0 ? ((current - prev) / prev) * 100 : null };
  }, [latestClosure, previousClosure]);

  const evolutionPoints = useMemo(() => {
    const points = closures
      .slice()
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((c) => ({ key: c.monthKey, net: c.summary.netConsolidatedClp, kind: 'cierre' as const }));
    points.push({ key: monthKey, net: currentSummary.netConsolidatedClp, kind: 'hoy' as const });
    return points.sort((a, b) => a.key.localeCompare(b.key));
  }, [closures, monthKey, currentSummary.netConsolidatedClp]);

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4">
        <div className="text-lg font-bold text-slate-900">Cierre</div>
        <div className="text-xs text-slate-500">Hoy, cierre mensual y evolución patrimonial.</div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Button variant={tab === 'hoy' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('hoy')}>
          Hoy
        </Button>
        <Button variant={tab === 'cierre' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('cierre')}>
          Cierre
        </Button>
        <Button variant={tab === 'evolucion' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('evolucion')}>
          Evolución
        </Button>
      </div>

      {tab === 'hoy' && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-semibold">Hoy ({monthLabel(monthKey)}) vs último cierre</div>
          {!latestClosure && <div className="text-xs text-slate-500">No hay cierres previos aún.</div>}
          {latestClosure && hoyVsLast && (
            <>
              <div className="text-xs text-slate-600">Referencia: cierre {monthLabel(latestClosure.monthKey)}</div>
              <div className="text-xl font-semibold">{formatCurrency(currentSummary.netConsolidatedClp, 'CLP')}</div>
              <div className={`text-sm font-semibold ${hoyVsLast.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {hoyVsLast.abs >= 0 ? '+' : ''}
                {formatCurrency(hoyVsLast.abs, 'CLP')}
                {hoyVsLast.pct !== null ? ` (${hoyVsLast.pct >= 0 ? '+' : ''}${hoyVsLast.pct.toFixed(2)}%)` : ''}
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'cierre' && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-semibold">Cierre vs cierre anterior</div>
          {(!latestClosure || !previousClosure || !closeVsPrev) && (
            <div className="text-xs text-slate-500">Necesitas al menos dos cierres para comparar.</div>
          )}
          {latestClosure && previousClosure && closeVsPrev && (
            <>
              <div className="text-xs text-slate-600">
                {monthLabel(latestClosure.monthKey)} vs {monthLabel(previousClosure.monthKey)}
              </div>
              <div className={`text-sm font-semibold ${closeVsPrev.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {closeVsPrev.abs >= 0 ? '+' : ''}
                {formatCurrency(closeVsPrev.abs, 'CLP')}
                {closeVsPrev.pct !== null ? ` (${closeVsPrev.pct >= 0 ? '+' : ''}${closeVsPrev.pct.toFixed(2)}%)` : ''}
              </div>
              <div className="pt-2 space-y-1 text-xs">
                {(['investment', 'real_estate', 'debt', 'bank'] as WealthBlock[]).map((block) => {
                  const curr = blockClp(latestClosure.summary, block, fx);
                  const prev = blockClp(previousClosure.summary, block, fx);
                  const delta = curr - prev;
                  return (
                    <div key={block} className="flex items-center justify-between">
                      <span className="capitalize">{block.replace('_', ' ')}</span>
                      <span className={delta >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                        {delta >= 0 ? '+' : ''}
                        {formatCurrency(delta, 'CLP')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'evolucion' && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-semibold">Evolución patrimonial</div>
          <div className="space-y-1">
            {evolutionPoints.map((p) => (
              <div key={`${p.key}-${p.kind}`} className="flex items-center justify-between text-xs border-b border-slate-100 py-1">
                <span>
                  {monthLabel(p.key)} {p.kind === 'hoy' ? '(hoy)' : '(cierre)'}
                </span>
                <span className="font-semibold">{formatCurrency(p.net, 'CLP')}</span>
              </div>
            ))}
          </div>
          {evolutionPoints.length < 2 && <div className="text-xs text-slate-500">Aún no hay suficiente historial.</div>}
        </Card>
      )}

      <Card className="p-3 text-[11px] text-slate-500">
        Valores expresados en CLP consolidado con TC actuales (USD/CLP, EUR/CLP y UF/CLP).
      </Card>
    </div>
  );
};
