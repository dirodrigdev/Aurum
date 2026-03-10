import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Input } from '../components/Components';
import { BreakdownCard } from '../components/closing/BreakdownCard';
import { ConfirmActionModal } from '../components/settings/ConfirmActionModal';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import { parseStrictNumber } from '../utils/numberUtils';
import { labelMatchKey, sameCanonicalLabel } from '../utils/wealthLabels';
import {
  formatCurrency,
  formatIsoDateTime,
  formatMonthLabel as monthLabel,
  formatRateDecimal,
  formatRateInt,
  formatTodayContext,
} from '../utils/wealthFormat';
import {
  buildWealthNetBreakdown,
  computeWealthHomeSectionAmounts,
  resolveRiskCapitalRecordsForTotals,
  WealthCurrency,
  WealthFxRates,
  WealthNetBreakdownClp,
  WealthRecord,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  loadIncludeRiskCapitalInTotals,
  WEALTH_DATA_UPDATED_EVENT,
  hydrateWealthFromCloud,
  isSyntheticAggregateRecord,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
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

const formatCloseTimestamp = (iso?: string) => {
  return formatIsoDateTime(iso, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const readPreferredClosingCurrency = (): WealthCurrency => {
  if (typeof window === 'undefined') return 'CLP';
  const stored = window.localStorage.getItem(PREFERRED_CLOSING_CURRENCY_KEY);
  if (stored === 'CLP' || stored === 'USD' || stored === 'EUR' || stored === 'UF') return stored;
  return 'CLP';
};

const fromClp = (amountClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return amountClp / Math.max(1, fx.eurClp);
  return amountClp / Math.max(1, fx.ufClp);
};

const CLOSURE_CANONICAL_ALIASES: Record<string, string[]> = {
  'saldo bancos clp': ['bancos clp historico'],
  'saldo bancos usd': ['bancos usd historico'],
  'deuda tarjetas clp': ['tarjetas clp historico'],
  'deuda tarjetas usd': ['tarjetas usd historico'],
};

const matchCanonicalWithAliases = (label: string, canonicalLabel: string) => {
  const key = labelMatchKey(label);
  if (key === canonicalLabel) return true;
  const aliases = CLOSURE_CANONICAL_ALIASES[canonicalLabel] || [];
  return aliases.some((alias) => key === labelMatchKey(alias));
};

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
const CLOSING_FOCUS_MONTH_KEY = 'aurum.closing.focus.month.v1';

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
    block: 'debt',
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
    label: 'Tarjetas CLP histórico',
    block: 'debt',
    canonicalLabel: 'deuda tarjetas clp',
    currency: 'CLP',
    section: 'deudas',
    normalizeAmount: (value) => Math.abs(value),
  },
  {
    key: 'tarjetasUsd',
    label: 'Tarjetas USD histórico',
    block: 'debt',
    canonicalLabel: 'deuda tarjetas usd',
    currency: 'USD',
    section: 'deudas',
    normalizeAmount: (value) => Math.abs(value),
  },
];

const buildNetBreakdown = (records: WealthRecord[], fx: WealthFxRates): NetBreakdown =>
  buildWealthNetBreakdown(records, fx);

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
  records.find((record) => matchCanonicalWithAliases(record.label, canonicalLabel)) || null;

interface ComparableVersionFields {
  bankClp: number | null;
  investmentClp: number | null;
  realEstateNetClp: number | null;
  nonMortgageDebtClp: number | null;
  netClp: number;
}

const buildComparableVersionFields = (
  records: WealthRecord[] | undefined,
  summaryNetClp: number,
  fx: WealthFxRates,
  includeRiskCapitalInTotals: boolean,
): ComparableVersionFields => {
  if (Array.isArray(records) && records.length > 0) {
    const resolved = resolveRiskCapitalRecordsForTotals(records, includeRiskCapitalInTotals);
    const breakdown = buildNetBreakdown(resolved.recordsForTotals, fx);
    return {
      bankClp: breakdown.bankClp,
      investmentClp: breakdown.investmentClp,
      realEstateNetClp: breakdown.realEstateNetClp,
      nonMortgageDebtClp: breakdown.nonMortgageDebtClp,
      netClp: breakdown.netClp,
    };
  }

  return {
    bankClp: null,
    investmentClp: null,
    realEstateNetClp: null,
    nonMortgageDebtClp: null,
    netClp: Number(summaryNetClp || 0),
  };
};

const getChangedFieldLabels = (
  older: ComparableVersionFields,
  newer: ComparableVersionFields,
) => {
  const changed: string[] = [];
  if (
    older.bankClp !== null &&
    newer.bankClp !== null &&
    Math.round(older.bankClp) !== Math.round(newer.bankClp)
  ) {
    changed.push('Bancos');
  }
  if (
    older.investmentClp !== null &&
    newer.investmentClp !== null &&
    Math.round(older.investmentClp) !== Math.round(newer.investmentClp)
  ) {
    changed.push('Inversiones');
  }
  if (
    older.realEstateNetClp !== null &&
    newer.realEstateNetClp !== null &&
    Math.round(older.realEstateNetClp) !== Math.round(newer.realEstateNetClp)
  ) {
    changed.push('Bienes raíces');
  }
  if (
    older.nonMortgageDebtClp !== null &&
    newer.nonMortgageDebtClp !== null &&
    Math.round(older.nonMortgageDebtClp) !== Math.round(newer.nonMortgageDebtClp)
  ) {
    changed.push('Deuda');
  }
  if (Math.round(older.netClp) !== Math.round(newer.netClp)) {
    changed.push('Patrimonio total');
  }
  return changed;
};


export const ClosingAurum: React.FC = () => {
  const [tab, setTab] = useState<ClosingTab>('hoy');
  const [currency, setCurrency] = useState<WealthCurrency>(() => readPreferredClosingCurrency());
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [currentFx, setCurrentFx] = useState<WealthFxRates>(() => loadFxRates());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [revision, setRevision] = useState(0);
  const [selectedClosureMonthKey, setSelectedClosureMonthKey] = useState('');
  const [closurePage, setClosurePage] = useState(0);
  const [closureEditOpen, setClosureEditOpen] = useState(false);
  const [closureEditConfirmOpen, setClosureEditConfirmOpen] = useState(false);
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
  const hydrationRunningRef = useRef(false);
  const lastHydrateAtRef = useRef(0);

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_CLOSING_CURRENCY_KEY, currency);
  }, [currency]);

  useEffect(() => {
    const HYDRATE_THROTTLE_MS = 15_000;

    const refreshLocal = () => {
      setCurrentFx(loadFxRates());
      setMonthKey(currentMonthKey());
      setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
      setRevision((v) => v + 1);
    };
    const refreshFromCloudIfNeeded = async (force = false) => {
      if (hydrationRunningRef.current) return;
      const now = Date.now();
      if (!force && now - lastHydrateAtRef.current < HYDRATE_THROTTLE_MS) {
        refreshLocal();
        return;
      }
      hydrationRunningRef.current = true;
      try {
        await hydrateWealthFromCloud();
        lastHydrateAtRef.current = Date.now();
      } finally {
        hydrationRunningRef.current = false;
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
    const onRiskCapitalPreference = () => {
      setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
      setRevision((v) => v + 1);
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshLocal as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      onRiskCapitalPreference as EventListener,
    );
    document.addEventListener('visibilitychange', onVisibility);
    void refreshFromCloudIfNeeded(true);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshLocal as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        onRiskCapitalPreference as EventListener,
      );
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const closures = useMemo(() => loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)), [revision]);

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

  useEffect(() => {
    if (!closures.length) return;
    const target = String(window.localStorage.getItem(CLOSING_FOCUS_MONTH_KEY) || '').trim();
    if (!target) return;
    if (!closures.some((closure) => closure.monthKey === target)) return;
    setTab('cierre');
    setSelectedClosureMonthKey(target);
    window.localStorage.removeItem(CLOSING_FOCUS_MONTH_KEY);
  }, [closures]);

  const currentRecordsRaw = useMemo(() => latestRecordsForMonth(loadWealthRecords(), monthKey), [monthKey, revision]);
  const currentRecords = useMemo(
    // [PRODUCT RULE] Si excluir capital de riesgo vacía el set, se usa base sin filtrar.
    () => resolveRiskCapitalRecordsForTotals(currentRecordsRaw, includeRiskCapitalInTotals).recordsForTotals,
    [currentRecordsRaw, includeRiskCapitalInTotals],
  );
  const currentHomeSectionAmounts = useMemo(
    () => computeWealthHomeSectionAmounts(currentRecords, currentFx),
    [currentRecords, currentFx],
  );

  const currentBreakdown = useMemo<NetBreakdown>(
    () => ({
      netClp: currentHomeSectionAmounts.totalNetClp,
      investmentClp: currentHomeSectionAmounts.investment,
      realEstateNetClp: currentHomeSectionAmounts.realEstateNet,
      bankClp: currentHomeSectionAmounts.bank,
      nonMortgageDebtClp: currentHomeSectionAmounts.nonMortgageDebt,
      // requeridos por tipo, no usados por BreakdownCard en esta vista:
      realEstateAssetsClp: 0,
      mortgageDebtClp: 0,
    }),
    [currentHomeSectionAmounts],
  );
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

  const closureDisplayNetByMonth = useMemo(() => {
    const map = new Map<string, number>();
    closures.forEach((closure) => {
      const fx = closure.fxRates || currentFx;
      const hasClosureRecords = Array.isArray(closure.records) && closure.records.length > 0;
      const records = hasClosureRecords
        ? resolveRiskCapitalRecordsForTotals(closure.records, includeRiskCapitalInTotals).recordsForTotals
        : null;
      const netClp = hasClosureRecords
        ? buildNetBreakdown(records || [], fx).netClp
        : closure.summary.netConsolidatedClp;
      // [PRODUCT RULE] Cada período histórico usa su propio FX del momento del cierre.
      map.set(closure.monthKey, fromClp(netClp, currency, fx));
    });
    return map;
  }, [closures, currentFx, includeRiskCapitalInTotals, currency]);

  const selectedClosureRecordsRaw = selectedClosure?.records || null;
  const compareClosureForSelectedRecordsRaw = compareClosureForSelected?.records || null;
  const selectedClosureRecords = useMemo(
    () =>
      selectedClosureRecordsRaw
        ? resolveRiskCapitalRecordsForTotals(selectedClosureRecordsRaw, includeRiskCapitalInTotals).recordsForTotals
        : null,
    [selectedClosureRecordsRaw, includeRiskCapitalInTotals],
  );
  const compareClosureForSelectedRecords = useMemo(
    () =>
      compareClosureForSelectedRecordsRaw
        ? resolveRiskCapitalRecordsForTotals(compareClosureForSelectedRecordsRaw, includeRiskCapitalInTotals).recordsForTotals
        : null,
    [compareClosureForSelectedRecordsRaw, includeRiskCapitalInTotals],
  );
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

  const compareClosureForHoy = useMemo(
    () =>
      closures
        .filter((closure) => closure.monthKey < monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null,
    [closures, monthKey],
  );
  const compareClosureForHoyRecordsRaw = compareClosureForHoy?.records || null;
  const compareClosureForHoyRecords = useMemo(
    () =>
      compareClosureForHoyRecordsRaw
        ? resolveRiskCapitalRecordsForTotals(compareClosureForHoyRecordsRaw, includeRiskCapitalInTotals).recordsForTotals
        : null,
    [compareClosureForHoyRecordsRaw, includeRiskCapitalInTotals],
  );
  const compareClosureForHoyFx = compareClosureForHoy?.fxRates || currentFx;
  const compareClosureForHoyBreakdown = useMemo<NetBreakdown | null>(() => {
    if (!compareClosureForHoyRecords?.length) return null;
    const compareHomeSectionAmounts = computeWealthHomeSectionAmounts(
      compareClosureForHoyRecords,
      compareClosureForHoyFx,
    );
    return {
      netClp: compareHomeSectionAmounts.totalNetClp,
      investmentClp: compareHomeSectionAmounts.investment,
      realEstateNetClp: compareHomeSectionAmounts.realEstateNet,
      bankClp: compareHomeSectionAmounts.bank,
      nonMortgageDebtClp: compareHomeSectionAmounts.nonMortgageDebt,
      // requeridos por tipo, no usados por BreakdownCard en esta vista:
      realEstateAssetsClp: 0,
      mortgageDebtClp: 0,
    };
  }, [compareClosureForHoyRecords, compareClosureForHoyFx]);

  const evolutionRows = useMemo(() => {
    const rows: EvolutionRow[] = closures
      .slice()
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((c) => {
        const fx = c.fxRates || currentFx;
        const hasClosureRecords = Array.isArray(c.records) && c.records.length > 0;
        const records = hasClosureRecords
          ? resolveRiskCapitalRecordsForTotals(c.records, includeRiskCapitalInTotals).recordsForTotals
          : null;
        const netClp = hasClosureRecords
          ? buildNetBreakdown(records || [], fx).netClp
          : c.summary.netConsolidatedClp;
        return {
          key: c.monthKey,
          label: monthLabel(c.monthKey),
          kind: 'cierre',
          net: fromClp(netClp, currency, fx),
        };
      });
    rows.push({ key: monthKey, label: monthLabel(monthKey), kind: 'hoy', net: fromClp(currentBreakdown.netClp, currency, currentFx) });
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [closures, currency, monthKey, currentBreakdown.netClp, currentFx, includeRiskCapitalInTotals]);

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
  const closureVersionChangesById = useMemo(() => {
    const map = new Map<string, string>();
    if (!selectedClosure || closureHistoryVersions.length <= 1) return map;

    const chain = [selectedClosure, ...closureHistoryVersions];
    const comparable = chain.map((item) => {
      const fx = item.fxRates || currentFx;
      return buildComparableVersionFields(
        item.records,
        Number(item.summary?.netConsolidatedClp || 0),
        fx,
        includeRiskCapitalInTotals,
      );
    });

    for (let i = 1; i < chain.length; i += 1) {
      const older = chain[i];
      const olderFields = comparable[i];
      const newerFields = comparable[i - 1];
      const changed = getChangedFieldLabels(olderFields, newerFields);
      map.set(
        `${older.id}-${older.closedAt}`,
        changed.length ? `Cambió: ${changed.join(', ')}` : 'Sin cambios numéricos',
      );
    }

    return map;
  }, [selectedClosure, closureHistoryVersions, currentFx, includeRiskCapitalInTotals]);
  const closureVersionNetDisplayById = useMemo(() => {
    const map = new Map<string, number>();
    closureHistoryVersions.forEach((version) => {
      const fx = version.fxRates || currentFx;
      const hasVersionRecords = Array.isArray(version.records) && version.records.length > 0;
      const records = hasVersionRecords
        ? resolveRiskCapitalRecordsForTotals(version.records, includeRiskCapitalInTotals).recordsForTotals
        : null;
      const netClp = hasVersionRecords
        ? buildNetBreakdown(records || [], fx).netClp
        : version.summary.netConsolidatedClp;
      // [PRODUCT RULE] Cada versión histórica se muestra con su FX guardado en ese momento.
      map.set(`${version.id}-${version.closedAt}`, fromClp(netClp, currency, fx));
    });
    return map;
  }, [closureHistoryVersions, currentFx, includeRiskCapitalInTotals, currency]);
  const hoyMonthHeadlineKey = monthKey;

  const openClosureEditModal = () => {
    if (!selectedClosure || !selectedClosureRecordsRaw?.length) return;
    const nextDraft = CLOSURE_EDITABLE_FIELDS.reduce((acc, field) => {
      const existing = findRecordByCanonicalLabel(selectedClosureRecordsRaw, field.canonicalLabel);
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
    if (!selectedClosure || !selectedClosureRecordsRaw?.length) return;

    const usdClp = parseStrictNumber(closureEditRates.usdClp);
    const eurUsd = parseStrictNumber(closureEditRates.eurUsd);
    const ufClp = parseStrictNumber(closureEditRates.ufClp);
    if (![usdClp, eurUsd, ufClp].every((n) => Number.isFinite(n) && n > 0)) {
      setClosureEditError('Revisa TC/UF: USD/CLP, EUR/USD y UF/CLP deben ser mayores que 0.');
      return;
    }
    const eurClpCandidate = usdClp * eurUsd;
    const eurClp =
      Number.isFinite(selectedClosureFx.eurClp) &&
      selectedClosureFx.eurClp > 0 &&
      Math.abs(eurClpCandidate - selectedClosureFx.eurClp) <
        1e-9 * Math.max(1, Math.abs(selectedClosureFx.eurClp))
        ? selectedClosureFx.eurClp
        : eurClpCandidate;
    const nextFx: WealthFxRates = { usdClp, eurClp, ufClp };

    let nextRecords = dedupeClosureRecords(
      selectedClosureRecordsRaw.map((record) => ({ ...record })),
    );

    const snapshotDate = `${selectedClosure.monthKey}-01`;
    const createdAt = new Date().toISOString();
    for (const field of CLOSURE_EDITABLE_FIELDS) {
      const raw = closureEditDraft[field.key];
      if (String(raw || '').trim() === '') continue;
      const parsed = parseStrictNumber(raw);
      if (!Number.isFinite(parsed)) {
        setClosureEditError(`Monto inválido en "${field.label}".`);
        return;
      }
    }

    CLOSURE_EDITABLE_FIELDS.forEach((field) => {
      const raw = closureEditDraft[field.key];
      const existing = findRecordByCanonicalLabel(nextRecords, field.canonicalLabel);
      if (String(raw || '').trim() === '') {
        return;
      }
      nextRecords = nextRecords.filter(
        (record) => !matchCanonicalWithAliases(record.label, field.canonicalLabel),
      );
      const parsed = parseStrictNumber(raw);
      if (!Number.isFinite(parsed)) return;
      const normalized = field.normalizeAmount ? field.normalizeAmount(parsed) : parsed;
      nextRecords.push({
        id: existing?.id || crypto.randomUUID(),
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
    <div className="p-4 space-y-2.5">
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
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Mes en curso</div>
              <div className="text-[11px] text-slate-500">al {formatTodayContext()}</div>
            </div>
            <div className="text-xl font-bold text-slate-900">{monthLabel(hoyMonthHeadlineKey)}</div>
          </div>
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
            currentRecords={currentRecordsRaw}
            compareRecords={compareClosureForHoyRecordsRaw}
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
                                closureDisplayNetByMonth.get(closure.monthKey) ??
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
                {!selectedClosureRecordsRaw?.length && (
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
                  currentRecords={selectedClosureRecordsRaw || []}
                  compareRecords={compareClosureForSelectedRecordsRaw}
                  showClosureRates
                  headerAction={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openClosureEditModal}
                      disabled={!selectedClosureRecordsRaw?.length}
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
                            closureVersionNetDisplayById.get(`${version.id}-${version.closedAt}`) ??
                              fromClp(version.summary.netConsolidatedClp, currency, version.fxRates || currentFx),
                            currency,
                          )}
                        </div>
                        {closureHistoryVersions.length > 1 && (
                          <div className="text-[11px] text-slate-500">
                            {closureVersionChangesById.get(`${version.id}-${version.closedAt}`) ||
                              'Sin cambios numéricos'}
                          </div>
                        )}
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
                  setClosureEditConfirmOpen(false);
                  setClosureEditOpen(false);
                  setClosureEditError('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  setClosureEditConfirmOpen(true);
                }}
              >
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={closureEditConfirmOpen}
        title="Confirmar guardado de edición"
        message={
          selectedClosure
            ? `Vas a sobrescribir el cierre de ${monthLabel(selectedClosure.monthKey)}. Se guardará una versión anterior.`
            : 'Vas a sobrescribir este cierre y se guardará una versión anterior.'
        }
        confirmText="Confirmar guardado"
        cancelText="Cancelar"
        onCancel={() => setClosureEditConfirmOpen(false)}
        onConfirm={() => {
          setClosureEditConfirmOpen(false);
          applyClosureEdit();
        }}
      />

      <Card className="p-3 text-[11px] text-slate-500">
        Cada cierre usa su propio TC/UF guardado del mes. Los valores de demo usan TC/UF aproximados.
      </Card>
    </div>
  );
};
