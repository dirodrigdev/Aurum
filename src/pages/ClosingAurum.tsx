import React, { useMemo, useState } from 'react';
import { Button, Card } from '../components/Components';
import {
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  WealthRecord,
  currentMonthKey,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
} from '../services/wealthStorage';

type ClosingTab = 'hoy' | 'cierre' | 'evolucion';
type EvolutionKind = 'cierre' | 'hoy';

interface EvolutionRow {
  key: string;
  label: string;
  kind: EvolutionKind;
  net: number | null;
}

interface NetBreakdown {
  netClp: number;
  investmentClp: number;
  realEstateNetClp: number;
  bankClp: number;
  nonMortgageDebtClp: number;
}

const groupWithDots = (value: number) =>
  Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

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

const monthLabel = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1, 12, 0, 0, 0);
  const label = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const toClp = (amount: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * fx.usdClp;
  if (currency === 'EUR') return amount * fx.eurClp;
  return amount * fx.ufClp;
};

const fromClp = (amountClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return amountClp / Math.max(1, fx.eurClp);
  return amountClp / Math.max(1, fx.ufClp);
};

const isMortgageMeta = (label: string) => {
  const l = label.toLowerCase();
  return (
    l.includes('saldo deuda hipotecaria') ||
    l.includes('dividendo hipotecario') ||
    l.includes('interés hipotecario') ||
    l.includes('interes hipotecario') ||
    l.includes('seguros hipotecarios') ||
    l.includes('amortización hipotecaria') ||
    l.includes('amortizacion hipotecaria')
  );
};

const buildNetBreakdown = (records: WealthRecord[], fx: WealthFxRates): NetBreakdown => {
  let investmentClp = 0;
  let realEstateAssetsClp = 0;
  let mortgageDebtClp = 0;
  let bankClp = 0;
  let nonMortgageDebtClp = 0;

  records.forEach((r) => {
    const clp = toClp(r.amount, r.currency, fx);
    if (r.block === 'investment') investmentClp += clp;
    if (r.block === 'real_estate') realEstateAssetsClp += clp;
    if (r.block === 'bank') bankClp += clp;
    if (r.block === 'debt') {
      if (r.label.toLowerCase().includes('saldo deuda hipotecaria')) mortgageDebtClp += clp;
      else if (!isMortgageMeta(r.label)) nonMortgageDebtClp += clp;
    }
  });

  const realEstateNetClp = realEstateAssetsClp - mortgageDebtClp;
  const netClp = investmentClp + realEstateNetClp + bankClp - nonMortgageDebtClp;

  return { netClp, investmentClp, realEstateNetClp, bankClp, nonMortgageDebtClp };
};

const BreakdownCard: React.FC<{
  title: string;
  subtitle: string;
  breakdown: NetBreakdown;
  currency: WealthCurrency;
  fx: WealthFxRates;
  compareAgainst?: NetBreakdown | null;
  compareFx?: WealthFxRates;
}> = ({ title, subtitle, breakdown, currency, fx, compareAgainst, compareFx }) => {
  const rows = [
    { key: 'investment', label: 'Inversiones', valueClp: breakdown.investmentClp },
    { key: 'real_estate', label: 'Bienes raíces (neto)', valueClp: breakdown.realEstateNetClp },
    { key: 'bank', label: 'Bancos', valueClp: breakdown.bankClp },
    { key: 'other_debt', label: 'Deudas no hipotecarias', valueClp: -breakdown.nonMortgageDebtClp },
  ];

  const netDisplay = fromClp(breakdown.netClp, currency, fx);
  const compareNet = compareAgainst && compareFx ? fromClp(compareAgainst.netClp, currency, compareFx) : null;
  const delta = compareNet !== null ? netDisplay - compareNet : null;
  const deltaPct = compareNet && compareNet !== 0 ? (delta! / compareNet) * 100 : null;

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>
      <div className="text-3xl font-bold text-slate-900">{formatCurrency(netDisplay, currency)}</div>
      {delta !== null && (
        <div className={`text-sm font-semibold ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {delta >= 0 ? '+' : ''}
          {formatCurrency(delta, currency)}
          {deltaPct !== null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)` : ''}
        </div>
      )}
      <div className="space-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between border-b border-slate-100 py-1">
            <span>{row.label}</span>
            <span className="font-semibold">{formatCurrency(fromClp(row.valueClp, currency, fx), currency)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

export const ClosingAurum: React.FC = () => {
  const [tab, setTab] = useState<ClosingTab>('hoy');
  const [currency, setCurrency] = useState<WealthCurrency>('CLP');

  const monthKey = useMemo(() => currentMonthKey(), []);
  const currentFx = useMemo(() => loadFxRates(), []);
  const closures = useMemo(() => loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)), []);

  const latestClosure = closures[0] || null;
  const previousClosure = closures[1] || null;

  const currentRecords = useMemo(() => latestRecordsForMonth(loadWealthRecords(), monthKey), [monthKey]);
  const currentBreakdown = useMemo(() => buildNetBreakdown(currentRecords, currentFx), [currentRecords, currentFx]);

  const latestClosureBreakdown = useMemo(() => {
    if (!latestClosure?.records?.length) return null;
    return buildNetBreakdown(latestClosure.records, latestClosure.fxRates || currentFx);
  }, [latestClosure, currentFx]);

  const previousClosureBreakdown = useMemo(() => {
    if (!previousClosure?.records?.length) return null;
    return buildNetBreakdown(previousClosure.records, previousClosure.fxRates || currentFx);
  }, [previousClosure, currentFx]);

  const evolutionRows = useMemo(() => {
    const rows: EvolutionRow[] = closures
      .slice()
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((c) => {
        const fx = c.fxRates || currentFx;
        const breakdown = c.records?.length ? buildNetBreakdown(c.records, fx) : null;
        return {
          key: c.monthKey,
          label: monthLabel(c.monthKey),
          kind: 'cierre',
          net: breakdown ? fromClp(breakdown.netClp, currency, fx) : null,
        };
      });

    rows.push({
      key: monthKey,
      label: monthLabel(monthKey),
      kind: 'hoy',
      net: fromClp(currentBreakdown.netClp, currency, currentFx),
    });

    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [closures, currency, monthKey, currentBreakdown.netClp, currentFx]);

  const evolutionWithReturns = useMemo(() => {
    return evolutionRows.map((row, idx) => {
      if (idx === 0 || row.net === null) return { ...row, delta: null as number | null, pct: null as number | null };
      const prev = evolutionRows[idx - 1];
      if (prev.net === null) return { ...row, delta: null as number | null, pct: null as number | null };
      const delta = row.net - prev.net;
      const pct = prev.net !== 0 ? (delta / prev.net) * 100 : null;
      return { ...row, delta, pct };
    });
  }, [evolutionRows]);

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4">
        <div className="text-lg font-bold text-slate-900">Cierre</div>
        <div className="text-xs text-slate-500">Comparación patrimonial por período.</div>
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

      <div className="grid grid-cols-4 gap-2">
        {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((curr) => (
          <Button key={curr} size="sm" variant={currency === curr ? 'primary' : 'secondary'} onClick={() => setCurrency(curr)}>
            {curr}
          </Button>
        ))}
      </div>

      {tab === 'hoy' && (
        <BreakdownCard
          title="Patrimonio hoy"
          subtitle={`${monthLabel(monthKey)} vs último cierre`}
          breakdown={currentBreakdown}
          currency={currency}
          fx={currentFx}
          compareAgainst={latestClosureBreakdown}
          compareFx={latestClosure?.fxRates || currentFx}
        />
      )}

      {tab === 'cierre' && (
        <>
          {!latestClosureBreakdown || !previousClosureBreakdown ? (
            <Card className="p-4 text-xs text-slate-500">Necesitas al menos dos cierres para comparar.</Card>
          ) : (
            <BreakdownCard
              title="Patrimonio cierre"
              subtitle={`${monthLabel(latestClosure!.monthKey)} vs ${monthLabel(previousClosure!.monthKey)}`}
              breakdown={latestClosureBreakdown}
              currency={currency}
              fx={latestClosure?.fxRates || currentFx}
              compareAgainst={previousClosureBreakdown}
              compareFx={previousClosure?.fxRates || currentFx}
            />
          )}
        </>
      )}

      {tab === 'evolucion' && (
        <>
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold">Evolución del patrimonio</div>
            {evolutionWithReturns.map((row) => (
              <div key={`${row.key}-${row.kind}`} className="flex items-center justify-between text-xs border-b border-slate-100 py-1">
                <span>
                  {row.label} {row.kind === 'hoy' ? '(hoy)' : '(cierre)'}
                </span>
                <span className="font-semibold">{row.net === null ? '—' : formatCurrency(row.net, currency)}</span>
              </div>
            ))}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold">Evolución de rentabilidad mensual</div>
            {evolutionWithReturns.map((row) => (
              <div key={`ret-${row.key}-${row.kind}`} className="flex items-center justify-between text-xs border-b border-slate-100 py-1">
                <span>
                  {row.label} {row.kind === 'hoy' ? '(hoy)' : '(cierre)'}
                </span>
                <span className={row.delta === null ? 'text-slate-500' : row.delta >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  {row.delta === null ? 'Base' : `${row.delta >= 0 ? '+' : ''}${formatCurrency(row.delta, currency)}${row.pct !== null ? ` (${row.pct >= 0 ? '+' : ''}${row.pct.toFixed(2)}%)` : ''}`}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}

      <Card className="p-3 text-[11px] text-slate-500">
        Cada cierre usa su propio TC/UF guardado del mes. Los valores de demo usan TC/UF aproximados.
      </Card>
    </div>
  );
};
