import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '../components/Components';
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
  upsertMonthlyClosure,
} from '../services/wealthStorage';

type ClosingTab = 'hoy' | 'cierre' | 'evolucion';
type EvolutionKind = 'cierre' | 'hoy';
const PREFERRED_CLOSING_CURRENCY_KEY = 'aurum.preferred.closing.currency';
const ANKRE_DEEP_GREEN = '#0f3f3a';
const ANKRE_BRONZE = '#9c6b36';
const ANKRE_BRONZE_DARK = '#7f5528';

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

const nextMonthKey = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1, 12, 0, 0, 0);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const formatCloseTimestamp = (iso?: string) => {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatTodayContext = () => {
  return new Date().toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
  });
};

const parseNumberInput = (raw: string) => {
  const compact = String(raw || '').trim().replace(/\s+/g, '');
  if (!compact) return NaN;

  let normalized = compact;
  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');

  if (hasComma && hasDot) {
    if (compact.lastIndexOf(',') > compact.lastIndexOf('.')) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaAsThousands = /^\d{1,3}(,\d{3})+$/.test(compact);
    normalized = commaAsThousands ? compact.replace(/,/g, '') : compact.replace(',', '.');
  } else if (hasDot) {
    const dotAsThousands = /^\d{1,3}(\.\d{3})+$/.test(compact);
    normalized = dotAsThousands ? compact.replace(/\./g, '') : compact;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const parseRateInput = (raw: string) => {
  const compact = String(raw || '').trim().replace(/\s+/g, '');
  if (!compact) return NaN;
  let normalized = compact;
  if (compact.includes(',') && compact.includes('.')) {
    if (compact.lastIndexOf(',') > compact.lastIndexOf('.')) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatRateInt = (value: number) => Math.round(value).toLocaleString('es-CL');
const formatRateDecimal = (value: number, decimals = 4) =>
  Number(value || 0).toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

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
const CLOSURES_PER_PAGE = 6;

type EditableFieldKey =
  | 'suraFin'
  | 'suraPrev'
  | 'btg'
  | 'planvital'
  | 'global66'
  | 'wise'
  | 'valorProp'
  | 'saldoHipoteca'
  | 'bancosClp'
  | 'bancosUsd'
  | 'tarjetasClp'
  | 'tarjetasUsd';

interface ClosureEditableField {
  key: EditableFieldKey;
  label: string;
  block: WealthRecord['block'];
  canonicalLabel: string;
  currency: WealthCurrency;
  section: 'inversiones' | 'bienes_raices' | 'bancos' | 'deudas';
  normalizeAmount?: (value: number) => number;
}

const CLOSURE_EDITABLE_FIELDS: ClosureEditableField[] = [
  {
    key: 'suraFin',
    label: 'SURA inversión financiera',
    block: 'investment',
    canonicalLabel: 'sura inversion financiera',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'suraPrev',
    label: 'SURA ahorro previsional',
    block: 'investment',
    canonicalLabel: 'sura ahorro previsional',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'btg',
    label: 'BTG total valorización',
    block: 'investment',
    canonicalLabel: 'btg total valorizacion',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'planvital',
    label: 'PlanVital saldo total',
    block: 'investment',
    canonicalLabel: 'planvital saldo total',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'global66',
    label: 'Global66 Cuenta Vista USD',
    block: 'investment',
    canonicalLabel: 'global66 cuenta vista usd',
    currency: 'USD',
    section: 'inversiones',
  },
  {
    key: 'wise',
    label: 'Wise Cuenta principal USD',
    block: 'investment',
    canonicalLabel: 'wise cuenta principal usd',
    currency: 'USD',
    section: 'inversiones',
  },
  {
    key: 'valorProp',
    label: 'Valor propiedad',
    block: 'real_estate',
    canonicalLabel: 'valor propiedad',
    currency: 'UF',
    section: 'bienes_raices',
  },
  {
    key: 'saldoHipoteca',
    label: 'Saldo deuda hipotecaria',
    block: 'real_estate',
    canonicalLabel: 'saldo deuda hipotecaria',
    currency: 'UF',
    section: 'bienes_raices',
  },
  {
    key: 'bancosClp',
    label: 'Saldo bancos CLP',
    block: 'bank',
    canonicalLabel: 'saldo bancos clp',
    currency: 'CLP',
    section: 'bancos',
  },
  {
    key: 'bancosUsd',
    label: 'Saldo bancos USD',
    block: 'bank',
    canonicalLabel: 'saldo bancos usd',
    currency: 'USD',
    section: 'bancos',
  },
  {
    key: 'tarjetasClp',
    label: 'Deuda tarjetas CLP',
    block: 'debt',
    canonicalLabel: 'deuda tarjetas clp',
    currency: 'CLP',
    section: 'deudas',
    normalizeAmount: (value) => Math.abs(value),
  },
  {
    key: 'tarjetasUsd',
    label: 'Deuda tarjetas USD',
    block: 'debt',
    canonicalLabel: 'deuda tarjetas usd',
    currency: 'USD',
    section: 'deudas',
    normalizeAmount: (value) => Math.abs(value),
  },
];

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

const dedupeClosureRecords = (records: WealthRecord[]) => {
  const map = new Map<string, WealthRecord>();
  const ordered = [...records].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  ordered.forEach((record) => {
    const key = `${record.block}::${labelMatchKey(record.label)}::${record.currency}`;
    if (!map.has(key)) map.set(key, record);
  });
  return [...map.values()];
};

const findRecordByCanonicalLabel = (records: WealthRecord[], canonicalLabel: string) =>
  records.find((record) => labelMatchKey(record.label) === canonicalLabel) || null;

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
  headerAction?: React.ReactNode;
  showClosureRates?: boolean;
}> = ({
  title,
  subtitle,
  breakdown,
  currency,
  fx,
  compareAgainst,
  compareFx,
  currentRecords,
  compareRecords,
  showPartialBadge,
  headerAction,
  showClosureRates,
}) => {
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
    <Card className="p-3 space-y-2 border-[#d9d8d1]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-500">{subtitle}</div>
        </div>
        {headerAction}
      </div>
      <div className="flex items-center gap-2">
        <div className="text-[30px] leading-none font-bold text-slate-900">{formatCurrency(netDisplay, currency)}</div>
        {showPartialBadge && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            Parcial
          </span>
        )}
      </div>
      {showClosureRates && (
        <div className="text-[10px] text-slate-500">
          USD/CLP {formatRateInt(fx.usdClp)} · EUR/USD {formatRateDecimal(fx.eurClp / Math.max(1, fx.usdClp), 4)} · UF/CLP{' '}
          {formatRateInt(fx.ufClp)}
        </div>
      )}
      {deltaNet !== null && (
        <div className={`text-xs font-semibold ${deltaNet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {deltaNet >= 0 ? '+' : ''}
          {formatCurrency(deltaNet, currency)}
          {deltaPct !== null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)` : ''}
        </div>
      )}

      <div className="space-y-1.5 text-xs">
        {rows.map((row) => {
          const current = fromClp(row.valueClp, currency, fx);
          const prev = row.prevClp !== null && compareFx ? fromClp(row.prevClp, currency, compareFx) : null;
          const delta = prev !== null ? current - prev : null;
          const deltaRowPct = prev !== null ? pct(current, prev) : null;
          return (
            <div key={row.key} className="rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-slate-700">{row.label}</span>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900">{formatCurrency(current, currency)}</div>
                  {delta !== null && (
                    <div className={`text-[10px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
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

      <details className="rounded-xl border border-[#e2dccf] bg-[#f8f5ef]">
        <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-semibold text-slate-700">
          Ver detalle de inversiones
        </summary>
        <div className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-[#d8c39d] bg-[#f6ead7] px-2.5 py-2">
              <div className="text-[11px] font-semibold text-[#7f5528]">Inversiones financieras</div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="text-[11px] text-slate-500">Subtotal</span>
                <div className="text-right">
                  <div className="text-sm font-bold">{formatCurrency(fromClp(financialCurrentClp, currency, fx), currency)}</div>
                  {financialHasCompare && (
                    <div className={`text-[10px] ${financialDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
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
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
              <div className="text-[11px] font-semibold text-emerald-800">Inversiones previsionales</div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="text-[11px] text-slate-500">Subtotal</span>
                <div className="text-right">
                  <div className="text-sm font-bold">{formatCurrency(fromClp(previsionalCurrentClp, currency, fx), currency)}</div>
                  {previsionalHasCompare && (
                    <div className={`text-[10px] ${previsionalDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
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
          </div>

          <div className="space-y-1.5">
            {investmentDetails.map((row) => {
              const current = fromClp(row.currentClp, currency, fx);
              const prev = row.compareClp !== null && compareFx ? fromClp(row.compareClp, currency, compareFx) : null;
              const delta = prev !== null ? current - prev : null;
              const p = prev !== null ? pct(current, prev) : null;
              return (
                <div key={row.key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-slate-700">{row.label}</span>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-900">{formatCurrency(current, currency)}</div>
                      {delta !== null && (
                        <div className={`text-[10px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
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
            {!investmentDetails.length && <div className="text-[11px] text-slate-500">Sin detalle de inversiones aún.</div>}
          </div>
        </div>
      </details>
    </Card>
  );
};

export const ClosingAurum: React.FC = () => {
  const [tab, setTab] = useState<ClosingTab>('hoy');
  const [currency, setCurrency] = useState<WealthCurrency>(() => readPreferredClosingCurrency());
  const [currentFx, setCurrentFx] = useState<WealthFxRates>(() => loadFxRates());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [revision, setRevision] = useState(0);
  const [selectedClosureMonthKey, setSelectedClosureMonthKey] = useState('');
  const [closurePage, setClosurePage] = useState(0);
  const [closureEditOpen, setClosureEditOpen] = useState(false);
  const [closureEditError, setClosureEditError] = useState('');
  const [closureEditDraft, setClosureEditDraft] = useState<Record<EditableFieldKey, string>>(
    () =>
      CLOSURE_EDITABLE_FIELDS.reduce((acc, field) => {
        acc[field.key] = '';
        return acc;
      }, {} as Record<EditableFieldKey, string>),
  );
  const [closureEditRates, setClosureEditRates] = useState({
    usdClp: '',
    eurUsd: '',
    ufClp: '',
  });

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_CLOSING_CURRENCY_KEY, currency);
  }, [currency]);

  useEffect(() => {
    let runningHydrate = false;
    let lastHydrateAt = 0;
    const HYDRATE_THROTTLE_MS = 15_000;

    const refreshLocal = () => {
      setCurrentFx(loadFxRates());
      setMonthKey(currentMonthKey());
      setRevision((v) => v + 1);
    };
    const refreshFromCloudIfNeeded = async (force = false) => {
      if (runningHydrate) return;
      const now = Date.now();
      if (!force && now - lastHydrateAt < HYDRATE_THROTTLE_MS) {
        refreshLocal();
        return;
      }
      runningHydrate = true;
      try {
        await hydrateWealthFromCloud();
        lastHydrateAt = Date.now();
      } finally {
        runningHydrate = false;
      }
      refreshLocal();
    };

    const onBottomNavRetap = (event: Event) => {
      const custom = event as CustomEvent<{ to?: string }>;
      if (custom.detail?.to !== '/closing') return;
      void refreshFromCloudIfNeeded();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshFromCloudIfNeeded();
    };

    const onFocus = () => {
      void refreshFromCloudIfNeeded();
    };
    const onStorage = () => {
      refreshLocal();
    };
    const onWealthUpdated = () => {
      refreshLocal();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshLocal as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    document.addEventListener('visibilitychange', onVisibility);
    void refreshFromCloudIfNeeded(true);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshLocal as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const closures = useMemo(() => loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)), [revision]);
  const latestClosure = closures[0] || null;

  useEffect(() => {
    if (!closures.length) {
      setSelectedClosureMonthKey('');
      setClosurePage(0);
      return;
    }
    setSelectedClosureMonthKey((prev) => {
      if (prev && closures.some((closure) => closure.monthKey === prev)) return prev;
      return closures[0].monthKey;
    });
  }, [closures]);

  useEffect(() => {
    if (!closures.length || !selectedClosureMonthKey) return;
    const idx = closures.findIndex((closure) => closure.monthKey === selectedClosureMonthKey);
    if (idx < 0) return;
    const page = Math.floor(idx / CLOSURES_PER_PAGE);
    setClosurePage(page);
  }, [closures, selectedClosureMonthKey]);

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

  const selectedClosure = useMemo(
    () => closures.find((closure) => closure.monthKey === selectedClosureMonthKey) || null,
    [closures, selectedClosureMonthKey],
  );
  const compareClosureForSelected = useMemo(() => {
    if (!selectedClosure) return null;
    return (
      closures
        .filter((closure) => closure.monthKey < selectedClosure.monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null
    );
  }, [closures, selectedClosure]);

  const closureTotalPages = Math.max(1, Math.ceil(closures.length / CLOSURES_PER_PAGE));
  const safeClosurePage = Math.min(Math.max(closurePage, 0), closureTotalPages - 1);
  const pagedClosures = closures.slice(
    safeClosurePage * CLOSURES_PER_PAGE,
    safeClosurePage * CLOSURES_PER_PAGE + CLOSURES_PER_PAGE,
  );

  const selectedClosureRecords = selectedClosure?.records || null;
  const compareClosureForSelectedRecords = compareClosureForSelected?.records || null;
  const selectedClosureFx = selectedClosure?.fxRates || currentFx;
  const compareClosureForSelectedFx = compareClosureForSelected?.fxRates || currentFx;

  const selectedClosureBreakdown = useMemo(() => {
    if (!selectedClosureRecords?.length) return null;
    return buildNetBreakdown(selectedClosureRecords, selectedClosureFx);
  }, [selectedClosureRecords, selectedClosureFx]);

  const compareClosureForSelectedBreakdown = useMemo(() => {
    if (!compareClosureForSelectedRecords?.length) return null;
    return buildNetBreakdown(compareClosureForSelectedRecords, compareClosureForSelectedFx);
  }, [compareClosureForSelectedRecords, compareClosureForSelectedFx]);

  const previousClosureForLatest = useMemo(() => {
    if (!latestClosure) return null;
    return (
      closures
        .filter((closure) => closure.monthKey < latestClosure.monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null
    );
  }, [closures, latestClosure]);

  const compareClosureForHoy =
    latestClosure && latestClosure.monthKey === monthKey ? previousClosureForLatest : latestClosure;
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

  const closureHistoryVersions = selectedClosure?.previousVersions || [];
  const hoyMonthHeadlineKey = useMemo(() => {
    if (!latestClosure) return monthKey;
    return monthKey <= latestClosure.monthKey ? nextMonthKey(latestClosure.monthKey) : monthKey;
  }, [latestClosure, monthKey]);

  const openClosureEditModal = () => {
    if (!selectedClosure || !selectedClosureRecords?.length) return;
    const nextDraft = CLOSURE_EDITABLE_FIELDS.reduce((acc, field) => {
      const existing = findRecordByCanonicalLabel(selectedClosureRecords, field.canonicalLabel);
      acc[field.key] = existing ? String(existing.amount) : '';
      return acc;
    }, {} as Record<EditableFieldKey, string>);
    setClosureEditDraft(nextDraft);
    setClosureEditRates({
      usdClp: String(Math.round(selectedClosureFx.usdClp)),
      eurUsd: String(selectedClosureFx.eurClp / Math.max(1, selectedClosureFx.usdClp)),
      ufClp: String(Math.round(selectedClosureFx.ufClp)),
    });
    setClosureEditError('');
    setClosureEditOpen(true);
  };

  const applyClosureEdit = () => {
    if (!selectedClosure || !selectedClosureRecords?.length) return;

    const usdClp = parseRateInput(closureEditRates.usdClp);
    const eurUsd = parseRateInput(closureEditRates.eurUsd);
    const ufClp = parseRateInput(closureEditRates.ufClp);
    if (![usdClp, eurUsd, ufClp].every((n) => Number.isFinite(n) && n > 0)) {
      setClosureEditError('Revisa TC/UF: USD/CLP, EUR/USD y UF/CLP deben ser mayores que 0.');
      return;
    }
    const nextFx: WealthFxRates = {
      usdClp,
      eurClp: usdClp * eurUsd,
      ufClp,
    };

    const nextRecords = dedupeClosureRecords(
      selectedClosureRecords.map((record) => ({ ...record })),
    );

    const snapshotDate = `${selectedClosure.monthKey}-01`;
    const createdAt = new Date().toISOString();
    for (const field of CLOSURE_EDITABLE_FIELDS) {
      const raw = closureEditDraft[field.key];
      if (String(raw || '').trim() === '') continue;
      const parsed = parseNumberInput(raw);
      if (!Number.isFinite(parsed)) {
        setClosureEditError(`Monto inválido en "${field.label}".`);
        return;
      }
    }

    CLOSURE_EDITABLE_FIELDS.forEach((field) => {
      const raw = closureEditDraft[field.key];
      if (String(raw || '').trim() === '') return;
      const parsed = parseNumberInput(raw);
      if (!Number.isFinite(parsed)) return;
      const normalized = field.normalizeAmount ? field.normalizeAmount(parsed) : parsed;
      const idx = nextRecords.findIndex(
        (record) => labelMatchKey(record.label) === field.canonicalLabel,
      );
      if (idx >= 0) {
        const existing = nextRecords[idx];
        nextRecords[idx] = {
          ...existing,
          amount: normalized,
          currency: field.currency,
          createdAt,
          snapshotDate,
          source: existing.source || 'Edición cierre',
          note: `Edición manual cierre ${selectedClosure.monthKey}`,
        };
        return;
      }
      nextRecords.push({
        id: crypto.randomUUID(),
        block: field.block,
        source: 'Edición cierre',
        label: field.label,
        amount: normalized,
        currency: field.currency,
        createdAt,
        snapshotDate,
        note: `Edición manual cierre ${selectedClosure.monthKey}`,
      });
    });

    upsertMonthlyClosure({
      monthKey: selectedClosure.monthKey,
      records: nextRecords,
      fxRates: nextFx,
      closedAt: new Date().toISOString(),
    });
    setClosureEditOpen(false);
    setClosureEditError('');
    setRevision((v) => v + 1);
  };

  return (
    <div className="p-4 space-y-3">
      <Card className="p-2 border-[#d5d7ce] bg-gradient-to-r from-[#f5f2e8] to-[#edf3ec]">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-3 gap-1">
            <Button
              variant={tab === 'hoy' ? 'primary' : 'secondary'}
              size="sm"
              className={
                tab === 'hoy'
                  ? 'text-[#f4efe3]'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }
              style={tab === 'hoy' ? { backgroundColor: ANKRE_DEEP_GREEN } : undefined}
              onClick={() => setTab('hoy')}
            >
              Hoy
            </Button>
            <Button
              variant={tab === 'cierre' ? 'primary' : 'secondary'}
              size="sm"
              className={
                tab === 'cierre'
                  ? 'text-[#f4efe3]'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }
              style={tab === 'cierre' ? { backgroundColor: ANKRE_DEEP_GREEN } : undefined}
              onClick={() => setTab('cierre')}
            >
              Cierre
            </Button>
            <Button
              variant={tab === 'evolucion' ? 'primary' : 'secondary'}
              size="sm"
              className={
                tab === 'evolucion'
                  ? 'text-[#f4efe3]'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }
              style={tab === 'evolucion' ? { backgroundColor: ANKRE_DEEP_GREEN } : undefined}
              onClick={() => setTab('evolucion')}
            >
              Evolución
            </Button>
          </div>
          <div className="flex items-center gap-1 self-end md:self-auto">
            {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => setCurrency(curr)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                  currency === curr
                    ? 'text-[#f4efe3]'
                    : 'border-slate-300 bg-white text-slate-600'
                }`}
                style={
                  currency === curr
                    ? { backgroundColor: ANKRE_BRONZE, borderColor: ANKRE_BRONZE_DARK }
                    : undefined
                }
              >
                {curr}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {tab === 'hoy' && (
        <>
          <Card className="p-3 border border-slate-200 bg-white">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Mes en curso</div>
            <div className="mt-0.5 text-2xl font-bold text-slate-900">{monthLabel(hoyMonthHeadlineKey)}</div>
            <div className="text-[11px] text-slate-500">al {formatTodayContext()}</div>
          </Card>
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
        </>
      )}

      {tab === 'cierre' && (
        <>
          {!selectedClosure ? (
            <Card className="p-4 text-xs text-slate-500">Todavía no hay cierres mensuales guardados.</Card>
          ) : (
            <>
              <Card className="p-3 border border-slate-200 bg-white">
                <div className="grid gap-3 lg:grid-cols-[1fr,1.1fr]">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Cierre seleccionado</div>
                    <div className="mt-0.5 text-xl font-bold text-slate-900">{monthLabel(selectedClosure.monthKey)}</div>
                    <div className="text-[11px] text-slate-500">
                      Cerrado el {formatCloseTimestamp(selectedClosure.closedAt)}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      USD/CLP {formatRateInt(selectedClosureFx.usdClp)} · EUR/USD{' '}
                      {formatRateDecimal(selectedClosureFx.eurClp / Math.max(1, selectedClosureFx.usdClp), 4)} · UF/CLP{' '}
                      {formatRateInt(selectedClosureFx.ufClp)}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Historial de cierres</div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={safeClosurePage <= 0}
                          onClick={() => setClosurePage((prev) => Math.max(0, prev - 1))}
                        >
                          ◀
                        </Button>
                        <div className="text-[11px] text-slate-500">
                          {safeClosurePage + 1} / {closureTotalPages}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={safeClosurePage >= closureTotalPages - 1}
                          onClick={() => setClosurePage((prev) => Math.min(closureTotalPages - 1, prev + 1))}
                        >
                          ▶
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {pagedClosures.map((closure) => {
                        const selected = closure.monthKey === selectedClosureMonthKey;
                        return (
                          <button
                            key={closure.id}
                            onClick={() => setSelectedClosureMonthKey(closure.monthKey)}
                            className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                              selected
                                ? 'border-[#5c4b2d] bg-[#f5efe2] text-[#4d3f26]'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-wide">{monthLabel(closure.monthKey)}</div>
                            <div className="mt-0.5 text-[11px] font-semibold">
                              {formatCurrency(
                                fromClp(closure.summary.netConsolidatedClp, currency, closure.fxRates || currentFx),
                                currency,
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {!selectedClosureRecords?.length && (
                  <div className="mt-3 text-[11px] text-amber-700">
                    Este cierre no tiene detalle de registros para edición rápida.
                  </div>
                )}
              </Card>

              {!selectedClosureBreakdown ? (
                <Card className="p-4 text-xs text-slate-500">
                  Este cierre no tiene detalle suficiente para comparación.
                </Card>
              ) : (
                <BreakdownCard
                  title={monthLabel(selectedClosure.monthKey)}
                  subtitle={
                    compareClosureForSelected
                      ? `vs ${monthLabel(compareClosureForSelected.monthKey)}`
                      : 'Sin cierre previo para comparar'
                  }
                  breakdown={selectedClosureBreakdown}
                  currency={currency}
                  fx={selectedClosureFx}
                  compareAgainst={compareClosureForSelectedBreakdown}
                  compareFx={compareClosureForSelectedFx}
                  currentRecords={selectedClosureRecords || []}
                  compareRecords={compareClosureForSelectedRecords}
                  showClosureRates
                  headerAction={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openClosureEditModal}
                      disabled={!selectedClosureRecords?.length}
                    >
                      Editar
                    </Button>
                  }
                />
              )}

              {!!closureHistoryVersions.length && (
                <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">
                    Versiones anteriores de este cierre ({closureHistoryVersions.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {closureHistoryVersions.map((version) => (
                      <div key={`${version.id}-${version.closedAt}`} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                        <div className="font-medium text-slate-700">
                          {monthLabel(version.monthKey)} · {formatCloseTimestamp(version.closedAt)}
                        </div>
                        {!!version.replacedAt && (
                          <div className="text-[11px] text-slate-500">
                            Reemplazado el {formatCloseTimestamp(version.replacedAt)}
                          </div>
                        )}
                        <div className="text-[11px]">
                          Neto:{' '}
                          {formatCurrency(
                            fromClp(version.summary.netConsolidatedClp, currency, version.fxRates || currentFx),
                            currency,
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
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

      {closureEditOpen && selectedClosure && (
        <div className="fixed inset-0 z-[90] bg-black/40 p-4 flex items-end sm:items-center justify-center">
          <div className="w-full max-w-2xl max-h-[88vh] overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="text-base font-semibold text-slate-900">
              Editar cierre {monthLabel(selectedClosure.monthKey)}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Edita fuentes directas del cierre (no campos calculados). Al guardar, se sobrescribe este cierre y se conserva la versión anterior.
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">Tipos de cambio usados en el cierre</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-slate-600">USD/CLP</label>
                  <Input
                    value={closureEditRates.usdClp}
                    onChange={(e) => setClosureEditRates((prev) => ({ ...prev, usdClp: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-600">EUR/USD</label>
                  <Input
                    value={closureEditRates.eurUsd}
                    onChange={(e) => setClosureEditRates((prev) => ({ ...prev, eurUsd: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-600">UF/CLP</label>
                  <Input
                    value={closureEditRates.ufClp}
                    onChange={(e) => setClosureEditRates((prev) => ({ ...prev, ufClp: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['inversiones', 'bienes_raices', 'bancos', 'deudas'] as const).map((section) => {
                const titleMap: Record<'inversiones' | 'bienes_raices' | 'bancos' | 'deudas', string> = {
                  inversiones: 'Inversiones',
                  bienes_raices: 'Bienes raíces',
                  bancos: 'Bancos',
                  deudas: 'Deudas no hipotecarias',
                };
                const fields = CLOSURE_EDITABLE_FIELDS.filter((f) => f.section === section);
                return (
                  <div key={section} className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-700">{titleMap[section]}</div>
                    {fields.map((field) => (
                      <div key={field.key}>
                        <label className="text-[11px] text-slate-600">
                          {field.label} ({field.currency})
                        </label>
                        <Input
                          value={closureEditDraft[field.key]}
                          onChange={(e) =>
                            setClosureEditDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          inputMode="decimal"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {!!closureEditError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {closureEditError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setClosureEditOpen(false);
                  setClosureEditError('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  const ok = window.confirm(
                    `Vas a sobrescribir el cierre de ${monthLabel(selectedClosure.monthKey)}. Se guardará una versión anterior. ¿Confirmas?`,
                  );
                  if (!ok) return;
                  applyClosureEdit();
                }}
              >
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card className="p-3 text-[11px] text-slate-500">
        Cada cierre usa su propio TC/UF guardado del mes. Los valores de demo usan TC/UF aproximados.
      </Card>
    </div>
  );
};
