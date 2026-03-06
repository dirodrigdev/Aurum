import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card } from '../components/Components';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import {
  buildWealthNetBreakdown,
  WealthCurrency,
  WealthFxRates,
  WealthNetBreakdownClp,
  WealthRecord,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  hydrateWealthFromCloud,
  isSyntheticAggregateRecord,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
} from '../services/wealthStorage';

type ClosingTab = 'hoy' | 'cierre' | 'evolucion';
type EvolutionKind = 'cierre' | 'hoy';
const PREFERRED_CLOSING_CURRENCY_KEY = 'aurum.preferred.closing.currency';

interface EvolutionRow {
  key: string;
  label: string;
  kind: EvolutionKind;
  net: number | null;
}

type NetBreakdown = WealthNetBreakdownClp;

interface InvestmentDetailRow {
  key: string;
  label: string;
  currentClp: number;
  compareClp: number | null;
  group: 'financieras' | 'previsionales' | 'otros';
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

const readPreferredClosingCurrency = (): WealthCurrency => {
  if (typeof window === 'undefined') return 'CLP';
  const stored = window.localStorage.getItem(PREFERRED_CLOSING_CURRENCY_KEY);
  if (stored === 'CLP' || stored === 'USD' || stored === 'EUR' || stored === 'UF') return stored;
  return 'CLP';
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

const normalizeForMatch = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const labelMatchKey = (value: string) =>
  normalizeForMatch(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sameCanonicalLabel = (a: string, b: string) => labelMatchKey(a) === labelMatchKey(b);

const REQUIRED_INVESTMENT_LABELS = [
  'SURA inversión financiera',
  'SURA ahorro previsional',
  'PlanVital saldo total',
  'BTG total valorización',
  'Global66 Cuenta Vista USD',
  'Wise Cuenta principal USD',
];

const REQUIRED_REAL_ESTATE_CORE_FOR_NET = ['Valor propiedad', 'Saldo deuda hipotecaria'];

const buildNetBreakdown = (records: WealthRecord[], fx: WealthFxRates): NetBreakdown =>
  buildWealthNetBreakdown(records, fx);

const pct = (curr: number, prev: number | null) => {
  if (prev === null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
};

const investmentBucket = (r: WealthRecord): { label: string; group: 'financieras' | 'previsionales' | 'otros' } | null => {
  const src = r.source.toLowerCase();
  const label = r.label.toLowerCase();
  if (src.includes('btg') || label.includes('btg')) return { label: 'BTG', group: 'financieras' };
  if (src.includes('planvital') || label.includes('planvital')) return { label: 'PlanVital', group: 'previsionales' };
  if (src.includes('wise') || label.includes('wise')) return { label: 'Wise', group: 'financieras' };
  if (src.includes('global66') || label.includes('global66')) return { label: 'Global66', group: 'financieras' };
  if (src.includes('sura') || label.includes('sura')) {
    if (label.includes('previsional')) return { label: 'SURA previsional', group: 'previsionales' };
    return { label: 'SURA financiero', group: 'financieras' };
  }
  return null;
};

const buildInvestmentDetails = (
  currentRecords: WealthRecord[],
  currentFx: WealthFxRates,
  compareRecords: WealthRecord[] | null,
  compareFx: WealthFxRates | null,
): InvestmentDetailRow[] => {
  const current = new Map<string, { amount: number; group: 'financieras' | 'previsionales' | 'otros' }>();
  const compare = new Map<string, number>();

  currentRecords.forEach((r) => {
    if (r.block !== 'investment') return;
    const bucket = investmentBucket(r);
    if (!bucket) return;
    const prev = current.get(bucket.label);
    current.set(bucket.label, {
      amount: (prev?.amount || 0) + toClp(r.amount, r.currency, currentFx),
      group: bucket.group,
    });
  });

  if (compareRecords && compareFx) {
    compareRecords.forEach((r) => {
      if (r.block !== 'investment') return;
      const bucket = investmentBucket(r);
      if (!bucket) return;
      compare.set(bucket.label, (compare.get(bucket.label) || 0) + toClp(r.amount, r.currency, compareFx));
    });
  }

  const keys = Array.from(new Set([...current.keys(), ...compare.keys()]));
  return keys
    .map((key) => ({
      key,
      label: key,
      currentClp: current.get(key)?.amount || 0,
      compareClp: compare.has(key) ? compare.get(key)! : null,
      group: current.get(key)?.group || 'otros',
    }))
    .sort((a, b) => b.currentClp - a.currentClp);
};

const BreakdownCard: React.FC<{
  title: string;
  subtitle: string;
  breakdown: NetBreakdown;
  currency: WealthCurrency;
  fx: WealthFxRates;
  compareAgainst?: NetBreakdown | null;
  compareFx?: WealthFxRates | null;
  currentRecords: WealthRecord[];
  compareRecords?: WealthRecord[] | null;
  showPartialBadge?: boolean;
}> = ({ title, subtitle, breakdown, currency, fx, compareAgainst, compareFx, currentRecords, compareRecords, showPartialBadge }) => {
  const rows = [
    { key: 'investment', label: 'Inversiones', valueClp: breakdown.investmentClp, prevClp: compareAgainst?.investmentClp ?? null },
    {
      key: 'real_estate',
      label: 'Bienes raíces (neto)',
      valueClp: breakdown.realEstateNetClp,
      prevClp: compareAgainst?.realEstateNetClp ?? null,
    },
    { key: 'bank', label: 'Bancos', valueClp: breakdown.bankClp, prevClp: compareAgainst?.bankClp ?? null },
    {
      key: 'other_debt',
      label: 'Deudas no hipotecarias',
      valueClp: -breakdown.nonMortgageDebtClp,
      prevClp: compareAgainst ? -compareAgainst.nonMortgageDebtClp : null,
    },
  ];

  const netDisplay = fromClp(breakdown.netClp, currency, fx);
  const compareNet = compareAgainst && compareFx ? fromClp(compareAgainst.netClp, currency, compareFx) : null;
  const deltaNet = compareNet !== null ? netDisplay - compareNet : null;
  const deltaPct = compareNet && compareNet !== 0 ? (deltaNet! / compareNet) * 100 : null;

  const investmentDetails = useMemo(
    () => buildInvestmentDetails(currentRecords, fx, compareRecords || null, compareFx || null),
    [currentRecords, fx, compareRecords, compareFx],
  );
  const investmentFinancial = investmentDetails.filter((i) => i.group === 'financieras');
  const investmentPrevisional = investmentDetails.filter((i) => i.group === 'previsionales');
  const financialCurrentClp = investmentFinancial.reduce((sum, row) => sum + row.currentClp, 0);
  const financialCompareClp = investmentFinancial.reduce((sum, row) => sum + (row.compareClp ?? 0), 0);
  const financialHasCompare = investmentFinancial.some((row) => row.compareClp !== null);
  const previsionalCurrentClp = investmentPrevisional.reduce((sum, row) => sum + row.currentClp, 0);
  const previsionalCompareClp = investmentPrevisional.reduce((sum, row) => sum + (row.compareClp ?? 0), 0);
  const previsionalHasCompare = investmentPrevisional.some((row) => row.compareClp !== null);
  const financialCurrentDisplay = fromClp(financialCurrentClp, currency, fx);
  const financialCompareDisplay = fromClp(financialCompareClp, currency, compareFx || fx);
  const financialDeltaDisplay = financialCurrentDisplay - financialCompareDisplay;
  const financialPctDisplay =
    financialCompareDisplay !== 0 ? (financialDeltaDisplay / financialCompareDisplay) * 100 : null;
  const previsionalCurrentDisplay = fromClp(previsionalCurrentClp, currency, fx);
  const previsionalCompareDisplay = fromClp(previsionalCompareClp, currency, compareFx || fx);
  const previsionalDeltaDisplay = previsionalCurrentDisplay - previsionalCompareDisplay;
  const previsionalPctDisplay =
    previsionalCompareDisplay !== 0 ? (previsionalDeltaDisplay / previsionalCompareDisplay) * 100 : null;

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-3xl font-bold text-slate-900">{formatCurrency(netDisplay, currency)}</div>
        {showPartialBadge && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Parcial
          </span>
        )}
      </div>
      {deltaNet !== null && (
        <div className={`text-sm font-semibold ${deltaNet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {deltaNet >= 0 ? '+' : ''}
          {formatCurrency(deltaNet, currency)}
          {deltaPct !== null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)` : ''}
        </div>
      )}

      <div className="space-y-2 text-xs">
        {rows.map((row) => {
          const current = fromClp(row.valueClp, currency, fx);
          const prev = row.prevClp !== null && compareFx ? fromClp(row.prevClp, currency, compareFx) : null;
          const delta = prev !== null ? current - prev : null;
          const deltaRowPct = prev !== null ? pct(current, prev) : null;
          return (
            <div key={row.key} className="border-b border-slate-100 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{row.label}</span>
                <div className="min-w-[44%]">
                  <div className="text-base font-bold">{formatCurrency(current, currency)}</div>
                  {delta !== null && (
                    <div className={`mt-0.5 text-[11px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {delta >= 0 ? '+' : ''}
                      {formatCurrency(delta, currency)}
                      {deltaRowPct !== null ? ` (${deltaRowPct >= 0 ? '+' : ''}${deltaRowPct.toFixed(2)}%)` : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-1">
        <div className="mt-2 space-y-2 text-xs">
            <details open className="rounded-lg border border-amber-100 bg-amber-50/50 p-2">
              <summary className="cursor-pointer font-medium">Inversiones financieras</summary>
              <div className="mt-2 rounded-lg bg-white/80 px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Subtotal</span>
                  <div className="text-right">
                    <div className="text-base font-bold">{formatCurrency(fromClp(financialCurrentClp, currency, fx), currency)}</div>
                    {financialHasCompare && (
                      <div
                        className={`text-[11px] ${
                          financialDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {financialDeltaDisplay >= 0 ? '+' : ''}
                        {formatCurrency(financialDeltaDisplay, currency)}
                        {financialPctDisplay !== null
                          ? ` (${financialPctDisplay >= 0 ? '+' : ''}${financialPctDisplay.toFixed(2)}%)`
                          : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {investmentFinancial.map((row) => {
                  const current = fromClp(row.currentClp, currency, fx);
                  const prev = row.compareClp !== null && compareFx ? fromClp(row.compareClp, currency, compareFx) : null;
                  const delta = prev !== null ? current - prev : null;
                  const p = prev !== null ? pct(current, prev) : null;
                  return (
                    <div key={row.key} className="rounded-lg border border-slate-100 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span>{row.label}</span>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{formatCurrency(current, currency)}</div>
                          {delta !== null && (
                            <div className={`text-[11px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {delta >= 0 ? '+' : ''}
                              {formatCurrency(delta, currency)}
                              {p !== null ? ` (${p >= 0 ? '+' : ''}${p.toFixed(2)}%)` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
            <details open className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2">
              <summary className="cursor-pointer font-medium">Inversiones previsionales</summary>
              <div className="mt-2 rounded-lg bg-white/80 px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Subtotal</span>
                  <div className="text-right">
                    <div className="text-base font-bold">{formatCurrency(fromClp(previsionalCurrentClp, currency, fx), currency)}</div>
                    {previsionalHasCompare && (
                      <div
                        className={`text-[11px] ${
                          previsionalDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {previsionalDeltaDisplay >= 0 ? '+' : ''}
                        {formatCurrency(previsionalDeltaDisplay, currency)}
                        {previsionalPctDisplay !== null
                          ? ` (${previsionalPctDisplay >= 0 ? '+' : ''}${previsionalPctDisplay.toFixed(2)}%)`
                          : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {investmentPrevisional.map((row) => {
                  const current = fromClp(row.currentClp, currency, fx);
                  const prev = row.compareClp !== null && compareFx ? fromClp(row.compareClp, currency, compareFx) : null;
                  const delta = prev !== null ? current - prev : null;
                  const p = prev !== null ? pct(current, prev) : null;
                  return (
                    <div key={row.key} className="rounded-lg border border-slate-100 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span>{row.label}</span>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{formatCurrency(current, currency)}</div>
                          {delta !== null && (
                            <div className={`text-[11px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {delta >= 0 ? '+' : ''}
                              {formatCurrency(delta, currency)}
                              {p !== null ? ` (${p >= 0 ? '+' : ''}${p.toFixed(2)}%)` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
            {!investmentDetails.length && <div className="text-[11px] text-slate-500">Sin detalle de inversiones aún.</div>}
        </div>
      </div>
    </Card>
  );
};

export const ClosingAurum: React.FC = () => {
  const [tab, setTab] = useState<ClosingTab>('hoy');
  const [currency, setCurrency] = useState<WealthCurrency>(() => readPreferredClosingCurrency());
  const [currentFx, setCurrentFx] = useState<WealthFxRates>(() => loadFxRates());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_CLOSING_CURRENCY_KEY, currency);
  }, [currency]);

  useEffect(() => {
    const refreshFx = () => setCurrentFx(loadFxRates());
    const refreshAll = async () => {
      await hydrateWealthFromCloud();
      refreshFx();
      setMonthKey(currentMonthKey());
      setRevision((v) => v + 1);
    };
    const onBottomNavRetap = (event: Event) => {
      const custom = event as CustomEvent<{ to?: string }>;
      if (custom.detail?.to !== '/closing') return;
      void refreshAll();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshAll();
    };

    const onFocus = () => {
      void refreshAll();
    };
    const onStorage = () => {
      void refreshAll();
    };
    const onWealthUpdated = () => {
      void refreshAll();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await hydrateWealthFromCloud();
      if (!alive) return;
      setCurrentFx(loadFxRates());
      setMonthKey(currentMonthKey());
      setRevision((v) => v + 1);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const closures = useMemo(() => loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)), [revision]);

  const latestClosure = closures[0] || null;
  const previousClosure = closures[1] || null;

  const currentRecords = useMemo(() => latestRecordsForMonth(loadWealthRecords(), monthKey), [monthKey, revision]);
  const currentBreakdown = useMemo(() => buildNetBreakdown(currentRecords, currentFx), [currentRecords, currentFx]);
  const missingCriticalCount = useMemo(() => {
    const required = [...REQUIRED_INVESTMENT_LABELS, ...REQUIRED_REAL_ESTATE_CORE_FOR_NET];
    return required.filter((requiredLabel) => {
      return !currentRecords.some((record) => {
        if (record.block === 'bank' || isSyntheticAggregateRecord(record)) return false;
        return sameCanonicalLabel(record.label, requiredLabel);
      });
    }).length;
  }, [currentRecords]);

  const latestClosureRecords = latestClosure?.records || null;
  const previousClosureRecords = previousClosure?.records || null;
  const latestClosureFx = latestClosure?.fxRates || currentFx;
  const previousClosureFx = previousClosure?.fxRates || currentFx;

  const latestClosureBreakdown = useMemo(() => {
    if (!latestClosureRecords?.length) return null;
    return buildNetBreakdown(latestClosureRecords, latestClosureFx);
  }, [latestClosureRecords, latestClosureFx]);

  const previousClosureBreakdown = useMemo(() => {
    if (!previousClosureRecords?.length) return null;
    return buildNetBreakdown(previousClosureRecords, previousClosureFx);
  }, [previousClosureRecords, previousClosureFx]);

  const compareClosureForHoy =
    latestClosure && latestClosure.monthKey === monthKey ? previousClosure : latestClosure;
  const compareClosureForHoyRecords = compareClosureForHoy?.records || null;
  const compareClosureForHoyFx = compareClosureForHoy?.fxRates || currentFx;
  const compareClosureForHoyBreakdown = useMemo(() => {
    if (!compareClosureForHoyRecords?.length) return null;
    return buildNetBreakdown(compareClosureForHoyRecords, compareClosureForHoyFx);
  }, [compareClosureForHoyRecords, compareClosureForHoyFx]);

  const evolutionRows = useMemo(() => {
    const rows: EvolutionRow[] = closures
      .slice()
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((c) => {
        const fx = c.fxRates || currentFx;
        const breakdown = c.records?.length ? buildNetBreakdown(c.records, fx) : null;
        return { key: c.monthKey, label: monthLabel(c.monthKey), kind: 'cierre', net: breakdown ? fromClp(breakdown.netClp, currency, fx) : null };
      });
    rows.push({ key: monthKey, label: monthLabel(monthKey), kind: 'hoy', net: fromClp(currentBreakdown.netClp, currency, currentFx) });
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [closures, currency, monthKey, currentBreakdown.netClp, currentFx]);

  const evolutionWithReturns = useMemo(
    () =>
      evolutionRows.map((row, idx) => {
        if (idx === 0 || row.net === null) return { ...row, delta: null as number | null, pct: null as number | null };
        const prev = evolutionRows[idx - 1];
        if (prev.net === null) return { ...row, delta: null as number | null, pct: null as number | null };
        const delta = row.net - prev.net;
        return { ...row, delta, pct: prev.net !== 0 ? (delta / prev.net) * 100 : null };
      }),
    [evolutionRows],
  );

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

      <div className="rounded-2xl bg-gradient-to-r from-[#f5efe2] to-[#e4eadf] border border-[#d8d2c6] p-2">
        <div className="text-[10px] uppercase tracking-wide text-[#6f6552] px-1 pb-1">Moneda de visualización</div>
        <div className="grid grid-cols-4 gap-2">
          {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((curr) => (
            <Button
              key={curr}
              size="sm"
              variant={currency === curr ? 'primary' : 'secondary'}
              className={currency === curr ? 'bg-[#5c4b2d] hover:bg-[#4d3f26]' : 'bg-white text-[#5c4b2d] hover:bg-[#f8f5ee]'}
              onClick={() => setCurrency(curr)}
            >
              {curr}
            </Button>
          ))}
        </div>
      </div>

      {tab === 'hoy' && (
        <BreakdownCard
          title="Patrimonio hoy"
          subtitle={`${monthLabel(monthKey)} vs ${
            compareClosureForHoy ? monthLabel(compareClosureForHoy.monthKey) : 'sin cierre previo'
          }`}
          breakdown={currentBreakdown}
          currency={currency}
          fx={currentFx}
          compareAgainst={compareClosureForHoyBreakdown}
          compareFx={compareClosureForHoyFx}
          currentRecords={currentRecords}
          compareRecords={compareClosureForHoyRecords}
          showPartialBadge={missingCriticalCount > 0}
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
              fx={latestClosureFx}
              compareAgainst={previousClosureBreakdown}
              compareFx={previousClosureFx}
              currentRecords={latestClosureRecords!}
              compareRecords={previousClosureRecords}
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
                  {row.delta === null
                    ? 'Base'
                    : `${row.delta >= 0 ? '+' : ''}${formatCurrency(row.delta, currency)}${row.pct !== null ? ` (${row.pct >= 0 ? '+' : ''}${row.pct.toFixed(2)}%)` : ''}`}
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
