import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Button, Card, Input } from '../components/Components';
import { ClosingConfigRowView, ClosingConfigSection } from '../components/settings/ClosingConfigSection';
import { ConfirmActionModal } from '../components/settings/ConfirmActionModal';
import {
  ClosureReviewModal,
  ClosureReviewModalResult,
  ClosureReviewSource,
} from '../components/settings/ClosureReviewModal';
import { TypedConfirmModal } from '../components/settings/TypedConfirmModal';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import { parseStrictNumber } from '../utils/numberUtils';
import { normalizeForMatch, sameCanonicalLabel } from '../utils/wealthLabels';
import {
  formatIsoDateTime as formatDateTime,
  formatMonthLabel,
  formatRateInt as formatFxInteger,
} from '../utils/wealthFormat';
import {
  TENENCIA_CXC_PREFIX_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  MORTGAGE_AMORTIZATION_LABEL,
  loadBankTokens,
  loadClosures,
  saveClosures,
  clearCurrentMonthData,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  hydrateWealthFromCloud,
  getLastWealthSyncIssue,
  importHistoricalClosuresFromCsv,
  previewHistoricalClosuresCsv,
  loadFxLiveSyncMeta,
  loadFxRates,
  defaultFxRates,
  clearWealthDataForFreshStart,
  isMortgageMetaDebtLabel,
  isRiskCapitalInvestmentLabel,
  loadInvestmentInstruments,
  loadWealthRecords,
  removeWealthRecord,
  refreshFxRatesFromLive,
  saveInvestmentInstruments,
  WEALTH_DATA_UPDATED_EVENT,
  saveFxRates,
  seedDemoWealthTimeline,
  saveWealthRecords,
  setInvestmentInstrumentMonthExcluded,
  summarizeWealth,
  syncWealthNow,
  WealthMonthlyClosure,
} from '../services/wealthStorage';
import { auth, signOutUser } from '../services/firebase';
import { getFirestoreStatus } from '../services/firestoreStatus';

const CLOSING_CONFIG_STORAGE_KEY = 'aurum.closing.config.v1';
const CLOSURE_REVIEW_PENDING_STORAGE_KEY = 'aurum.closure.review.pending.v1';

interface ClosureReviewPendingEntry {
  status: 'complete' | 'pending';
  source: ClosureReviewSource;
  reviewedAt: string;
}

type ClosureReviewPendingMap = Record<string, ClosureReviewPendingEntry>;

type ClosingStaticFieldKey =
  | 'investments_value'
  | 'banks_fintoc'
  | 'tenencia'
  | 'cards_used'
  | 'property_value'
  | 'mortgage_balance'
  | 'mortgage_amortization';

interface ClosingRuleConfig {
  enabled: boolean;
  maxAgeDays: number | null;
}

interface ClosingConfigState {
  rules: Record<string, ClosingRuleConfig>;
}

const STATIC_CLOSING_FIELDS: Array<{
  key: ClosingStaticFieldKey;
  label: string;
  defaultEnabled: boolean;
  defaultMaxAgeDays: number | null;
}> = [
  { key: 'investments_value', label: 'Inversiones (valor)', defaultEnabled: true, defaultMaxAgeDays: 3 },
  { key: 'banks_fintoc', label: 'Bancos (Fintoc)', defaultEnabled: true, defaultMaxAgeDays: 3 },
  { key: 'tenencia', label: 'Tenencia', defaultEnabled: false, defaultMaxAgeDays: null },
  { key: 'cards_used', label: 'Cupos tarjetas', defaultEnabled: false, defaultMaxAgeDays: null },
  { key: 'property_value', label: REAL_ESTATE_PROPERTY_VALUE_LABEL, defaultEnabled: false, defaultMaxAgeDays: null },
  { key: 'mortgage_balance', label: MORTGAGE_DEBT_BALANCE_LABEL, defaultEnabled: false, defaultMaxAgeDays: null },
  { key: 'mortgage_amortization', label: 'Amortización mensual', defaultEnabled: false, defaultMaxAgeDays: null },
];

const STATIC_CLOSING_FIELDS_MAP = new Map(
  STATIC_CLOSING_FIELDS.map((field) => [field.key, field] as const),
);

const readClosingConfig = (): ClosingConfigState => {
  try {
    const raw = localStorage.getItem(CLOSING_CONFIG_STORAGE_KEY);
    if (!raw) return { rules: {} };
    const parsed = JSON.parse(raw) as ClosingConfigState;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.rules !== 'object') return { rules: {} };
    return { rules: parsed.rules || {} };
  } catch {
    return { rules: {} };
  }
};

const saveClosingConfig = (state: ClosingConfigState) => {
  try {
    localStorage.setItem(CLOSING_CONFIG_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const readClosureReviewPending = (): ClosureReviewPendingMap => {
  try {
    const raw = localStorage.getItem(CLOSURE_REVIEW_PENDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ClosureReviewPendingMap;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const saveClosureReviewPending = (state: ClosureReviewPendingMap) => {
  try {
    localStorage.setItem(CLOSURE_REVIEW_PENDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const toRuleKeyFromInvestmentId = (investmentId: string) => `investment:${investmentId}`;

const toDefaultRule = (enabled: boolean, maxAgeDays: number | null): ClosingRuleConfig => ({
  enabled,
  maxAgeDays,
});

const isTenenciaLabel = (label: string) =>
  normalizeForMatch(label).includes(normalizeForMatch(TENENCIA_CXC_PREFIX_LABEL));
const isTenenciaInstrument = (instrumentLabel: string) => isTenenciaLabel(instrumentLabel);

const daysSinceIso = (iso?: string) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
};

export const SettingsAurum: React.FC = () => {
  const buildDraftFromFx = (rates: { usdClp: number; eurClp: number; ufClp: number }) => {
    const safeUsd = Number.isFinite(rates.usdClp) && rates.usdClp > 0 ? rates.usdClp : defaultFxRates.usdClp;
    const safeEur = Number.isFinite(rates.eurClp) && rates.eurClp > 0 ? rates.eurClp : defaultFxRates.eurClp;
    const safeUf = Number.isFinite(rates.ufClp) && rates.ufClp > 0 ? rates.ufClp : defaultFxRates.ufClp;
    return {
      usdClp: String(Math.round(safeUsd)),
      eurUsd: String(safeEur / safeUsd),
      ufClp: String(Math.round(safeUf)),
    };
  };

  const [fx, setFx] = useState(() => loadFxRates());
  const [fxDraft, setFxDraft] = useState(() => buildDraftFromFx(fx));
  const [fxLiveMeta, setFxLiveMeta] = useState(() => loadFxLiveSyncMeta());
  const [fxLiveMessage, setFxLiveMessage] = useState('');
  const [syncingLiveFx, setSyncingLiveFx] = useState(false);
  const [csvDraft, setCsvDraft] = useState('');
  const [csvImportMessage, setCsvImportMessage] = useState('');
  const [csvImportWarnings, setCsvImportWarnings] = useState<string[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvTemplateCopyMessage, setCsvTemplateCopyMessage] = useState('');
  const [csvImportedResultVisible, setCsvImportedResultVisible] = useState(false);
  const [closureReviewOpen, setClosureReviewOpen] = useState(false);
  const [closureReviewQueue, setClosureReviewQueue] = useState<WealthMonthlyClosure[]>([]);
  const [closureReviewSource, setClosureReviewSource] = useState<ClosureReviewSource>('csv');
  const [closureReviewMessage, setClosureReviewMessage] = useState('');
  const [closureReviewPending, setClosureReviewPending] = useState<ClosureReviewPendingMap>(() =>
    readClosureReviewPending(),
  );
  const [deleteBlocksMessage, setDeleteBlocksMessage] = useState('');
  const [deletingBlocks, setDeletingBlocks] = useState(false);
  const [deleteBlocksDraft, setDeleteBlocksDraft] = useState({
    bank: false,
    investment: false,
    risk: false,
    realEstate: false,
  });
  const [authEmail, setAuthEmail] = useState('');
  const [authUid, setAuthUid] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [fsDebug, setFsDebug] = useState('');
  const [fsStatus, setFsStatus] = useState(() => getFirestoreStatus());
  const [backupMessage, setBackupMessage] = useState('');
  const [availableClosures, setAvailableClosures] = useState(() =>
    loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
  );
  const [selectedClosureToDelete, setSelectedClosureToDelete] = useState('');
  const [deleteClosureMessage, setDeleteClosureMessage] = useState('');
  const [deletingClosure, setDeletingClosure] = useState(false);
  const [allRecords, setAllRecords] = useState(() => loadWealthRecords());
  const [investmentInstruments, setInvestmentInstruments] = useState(() => loadInvestmentInstruments());
  const [closingConfig, setClosingConfig] = useState<ClosingConfigState>(() => readClosingConfig());
  const [closingConfigMessage, setClosingConfigMessage] = useState('');
  const [closingInvestmentCloseTargetId, setClosingInvestmentCloseTargetId] = useState<string | null>(null);
  const [closingInvestmentDeleteTargetId, setClosingInvestmentDeleteTargetId] = useState<string | null>(null);
  const [closingInvestmentActionBusy, setClosingInvestmentActionBusy] = useState(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [resetStepTwoOpen, setResetStepTwoOpen] = useState(false);
  const [resetAllMessage, setResetAllMessage] = useState('');
  const [seedDemoMessage, setSeedDemoMessage] = useState('');
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvConfirmOpen, setCsvConfirmOpen] = useState(false);
  const [deleteClosureConfirmOpen, setDeleteClosureConfirmOpen] = useState(false);
  const [deleteAllClosuresConfirmOpen, setDeleteAllClosuresConfirmOpen] = useState(false);
  const [deleteBlocksConfirmOpen, setDeleteBlocksConfirmOpen] = useState(false);
  const [fxFallbackDecisionOpen, setFxFallbackDecisionOpen] = useState(false);
  const [fxFallbackSavedText, setFxFallbackSavedText] = useState('');
  const syncSectionRef = useRef<HTMLDivElement | null>(null);
  const csvImportSectionRef = useRef<HTMLDetailsElement | null>(null);
  const hydrationRunningRef = useRef(false);
  const lastHydrateAtRef = useRef(0);

  const describeManualSync = (
    pushed: boolean,
    hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none',
  ) => {
    if (hydrated === 'unavailable') return 'Sin conexión con la nube';
    if (pushed && (hydrated === 'cloud' || hydrated === 'local')) return 'Sincronizado';
    return 'Error al sincronizar';
  };

  const describeLocalThenCloudSync = (
    pushed: boolean,
    hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none',
  ) => {
    if (pushed && (hydrated === 'cloud' || hydrated === 'local')) return 'Sincronizado';
    if (hydrated === 'unavailable') return 'Guardado localmente · Sin conexión con la nube';
    return 'Guardado localmente · Error al sincronizar';
  };

  const syncDraftFromFx = (rates: { usdClp: number; eurClp: number; ufClp: number }) => {
    setFxDraft(buildDraftFromFx(rates));
  };

  const downloadTextFile = (content: string, filename: string, mimeType = 'text/plain;charset=utf-8;') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    try {
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
    } finally {
      if (document.body.contains(link)) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const commitDraftFx = () => {
    const usdClp = parseStrictNumber(fxDraft.usdClp);
    const eurUsd = parseStrictNumber(fxDraft.eurUsd);
    const ufClp = parseStrictNumber(fxDraft.ufClp);
    if (![usdClp, eurUsd, ufClp].every((n) => Number.isFinite(n) && n > 0)) {
      syncDraftFromFx(fx);
      setFxLiveMessage('No pude guardar: revisa que USD/CLP, EUR/USD y UF/CLP sean mayores a 0.');
      return;
    }
    const eurClpCandidate = usdClp * eurUsd;
    const eurClp =
      Number.isFinite(fx.eurClp) &&
      fx.eurClp > 0 &&
      Math.abs(eurClpCandidate - fx.eurClp) < 1e-9 * Math.max(1, Math.abs(fx.eurClp))
        ? fx.eurClp
        : eurClpCandidate;
    const next = { usdClp, eurClp, ufClp };
    setFx(next);
    saveFxRates(next);
    syncDraftFromFx(next);
    setFxLiveMessage('Tipos de cambio guardados manualmente.');
  };

  const humanizeFxSource = (raw?: string) => {
    const source = String(raw || '').trim();
    const value = source.toLowerCase();
    if (!value) return 'Automática';

    const humanizeSingle = (item: string, indicator?: 'USD' | 'EUR' | 'UF') => {
      const v = item.trim().toLowerCase();
      if (!v) return '';
      if (v.includes('f073.tco.pre.z.d') || v.includes('bcentral.cl')) {
        return indicator ? `${indicator}: Banco Central` : 'Banco Central';
      }
      if (v.includes('valoruf')) return indicator ? `${indicator}: valoruf.cl` : 'valoruf.cl';
      if (v.includes('open.er-api.com')) return indicator ? `${indicator}: open.er-api.com` : 'open.er-api.com';
      if (v.includes('frankfurter.app')) return indicator ? `${indicator}: frankfurter.app` : 'frankfurter.app';
      return indicator ? `${indicator}: ${item.trim()}` : item.trim();
    };

    const parts: string[] = [];
    const usdMatch = source.match(/USD:([^·]+)/i);
    const ufMatch = source.match(/UF:([^·]+)/i);
    if (usdMatch?.[1]) parts.push(humanizeSingle(usdMatch[1], 'USD'));
    if (ufMatch?.[1]) parts.push(humanizeSingle(ufMatch[1], 'UF'));
    if (parts.length) return parts.join(' · ');

    return humanizeSingle(source);
  };

  const historicalCsvTemplate = `month_key,closed_at,usd_clp,eur_clp,uf_clp,sura_fin_clp,sura_prev_clp,btg_clp,planvital_clp,global66_usd,wise_usd,valor_prop_uf,saldo_deuda_uf,dividendo_uf,interes_uf,seguros_uf,amortizacion_uf,bancos_clp,bancos_usd,tarjetas_clp,tarjetas_usd
2026-01,2026-01-31T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
2026-02,2026-02-28T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
2026-03,2026-03-31T23:59:59-03:00,,,,,,,,,,,,,,,,,,,`;
  const historicalSimpleCsvTemplate = `month_key,closed_at,usd_clp,eur_clp,uf_clp,net_clp
2023-05,2023-05-31T23:59:59-04:00,,,,
2023-06,2023-06-30T23:59:59-04:00,,,,
2023-07,2023-07-31T23:59:59-04:00,,,,`;
  const historicalCsvAiFormat = `FORMATO CSV AURUM (copiar y completar):

Objetivo:
- Una fila por mes (month_key = YYYY-MM).
- closed_at en ISO con zona horaria (ej: 2026-02-28T23:59:59-03:00).
- Usa punto decimal. Si un valor no existe, déjalo vacío.
- Monedas: *_clp en CLP, *_usd en USD, *_uf en UF.

Columnas:
- month_key: mes del cierre (YYYY-MM). Ej: 2026-02
- closed_at: fecha/hora de cierre. Ej: 2026-02-28T23:59:59-03:00
- usd_clp: tipo de cambio USD/CLP. Ej: 857.56
- eur_clp: tipo de cambio EUR/CLP (opcional si tienes eur_usd en otro flujo).
- uf_clp: valor UF/CLP. Ej: 39762.28
- sura_fin_clp: saldo SURA inversión financiera (CLP)
- sura_prev_clp: saldo SURA previsional (CLP)
- btg_clp: total BTG (CLP)
- planvital_clp: total PlanVital (CLP)
- global66_usd: saldo Global66 (USD)
- wise_usd: saldo Wise (USD)
- valor_prop_uf: valor propiedad (UF)
- saldo_deuda_uf: saldo deuda hipotecaria (UF)
- dividendo_uf: dividendo hipotecario mensual (UF)
- interes_uf: interés hipotecario mensual (UF)
- seguros_uf: seguros hipotecarios mensuales (UF)
- amortizacion_uf: amortización hipotecaria mensual (UF)
- bancos_clp: saldo bancos en CLP
- bancos_usd: saldo bancos en USD
- tarjetas_clp: deuda tarjetas en CLP
- tarjetas_usd: deuda tarjetas en USD

Plantilla:
month_key,closed_at,usd_clp,eur_clp,uf_clp,sura_fin_clp,sura_prev_clp,btg_clp,planvital_clp,global66_usd,wise_usd,valor_prop_uf,saldo_deuda_uf,dividendo_uf,interes_uf,seguros_uf,amortizacion_uf,bancos_clp,bancos_usd,tarjetas_clp,tarjetas_usd
2026-01,2026-01-31T23:59:59-03:00,869.12,944.43,39711.00,601583627,282697790,261428257,244443361,66767.40,4039.66,14500,8887.0006,53.2454,21.4029,4.1431,27.6994,5374622,2800,112400000,0
2026-02,2026-02-28T23:59:59-03:00,857.56,930.25,39762.28,607337347,286420525,264741547,249092726,67098.43,4048.23,14500,8859.3012,53.2454,21.4029,4.1431,27.6994,5400000,1800,112400000,0`;

  const deferredCsvDraft = useDeferredValue(csvDraft);
  const csvPreview = useMemo(() => previewHistoricalClosuresCsv(deferredCsvDraft), [deferredCsvDraft]);
  const csvPreviewMonthLabel =
    csvPreview.monthKeys.length === 1 ? formatMonthLabel(csvPreview.monthKeys[0]) : '';
  const closureHasMissingFx = (closure: WealthMonthlyClosure) => {
    const fxRates = closure.fxRates;
    if (!fxRates) return true;
    if (Array.isArray(closure.fxMissing) && closure.fxMissing.length > 0) return true;
    return !(fxRates.usdClp > 0 && fxRates.eurClp > 0 && fxRates.ufClp > 0);
  };
  const closureDataPendingMonthKeys = useMemo(
    () =>
      availableClosures
        .filter((closure) => closureHasMissingFx(closure) || !(closure.records && closure.records.length > 0))
        .map((closure) => closure.monthKey),
    [availableClosures],
  );
  const closureReviewPendingMonthKeys = useMemo(
    () =>
      Object.entries(closureReviewPending)
        .filter(([, entry]) => entry.status === 'pending')
        .map(([monthKey]) => monthKey)
        .filter((monthKey) => availableClosures.some((closure) => closure.monthKey === monthKey)),
    [closureReviewPending, availableClosures],
  );
  const historicalPendingMonthKeys = useMemo(
    () => Array.from(new Set([...closureDataPendingMonthKeys, ...closureReviewPendingMonthKeys])).sort(),
    [closureDataPendingMonthKeys, closureReviewPendingMonthKeys],
  );
  const monthKey = useMemo(() => currentMonthKey(), []);
  const monthRecords = useMemo(
    () => allRecords.filter((record) => String(record.snapshotDate || '').startsWith(`${monthKey}-`)),
    [allRecords, monthKey],
  );
  const historicalStatus = useMemo(() => {
    const count = availableClosures.length;
    if (!count) return { icon: '❌', tone: 'error' as const, text: 'Sin cierres guardados' };
    if (historicalPendingMonthKeys.length > 0) {
      return {
        icon: '⚠️',
        tone: 'warn' as const,
        text: `Hay ${historicalPendingMonthKeys.length} cierre(s) pendiente(s) de revisión`,
      };
    }
    return { icon: '✅', tone: 'ok' as const, text: 'Cierres históricos completos' };
  }, [availableClosures, historicalPendingMonthKeys]);
  const monthChecklist = useMemo(
    () => [
      {
        key: 'bank',
        label: 'Bancos',
        ok: monthRecords.some((record) => record.block === 'bank'),
      },
      {
        key: 'investment',
        label: 'Inversiones',
        ok: monthRecords.some((record) => record.block === 'investment'),
      },
      {
        key: 'risk',
        label: 'Capital de riesgo',
        ok: monthRecords.some(
          (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
        ),
      },
      {
        key: 'real-estate',
        label: 'Propiedad + hipoteca',
        ok: monthRecords.some((record) => sameCanonicalLabel(record.label, REAL_ESTATE_PROPERTY_VALUE_LABEL)),
      },
      {
        key: 'fx',
        label: 'TC actual',
        ok: fx.usdClp > 0 && fx.ufClp > 0,
      },
    ],
    [monthRecords, fx],
  );

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setAuthEmail(user?.email || '');
      setAuthUid(user?.uid || '');
    });
  }, []);

  useEffect(() => {
    syncDraftFromFx(fx);
  }, [fx]);

  const refreshLocalState = () => {
    setFx(loadFxRates());
    setFxLiveMeta(loadFxLiveSyncMeta());
    setAvailableClosures(loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
    setAllRecords(loadWealthRecords());
    setInvestmentInstruments(loadInvestmentInstruments());
    setFsStatus(getFirestoreStatus());
  };

  const canShowDemoSeedButton =
    import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_DEMO_SEED || '').toLowerCase() === 'true';

  const copyCsvFormatToClipboard = async () => {
    const text = historicalCsvAiFormat;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCsvTemplateCopyMessage('Formato copiado al portapapeles.');
    } catch {
      setCsvTemplateCopyMessage('No pude copiar automáticamente. Usa la descarga de formato.');
    }
  };

  const persistClosureReviewPendingState = (next: ClosureReviewPendingMap) => {
    setClosureReviewPending(next);
    saveClosureReviewPending(next);
  };

  useEffect(() => {
    const HYDRATE_THROTTLE_MS = 20_000;
    const refreshFromCloudIfNeeded = async (force = false) => {
      if (hydrationRunningRef.current) return;
      const now = Date.now();
      if (!force && now - lastHydrateAtRef.current < HYDRATE_THROTTLE_MS) {
        refreshLocalState();
        return;
      }
      hydrationRunningRef.current = true;
      try {
        await hydrateWealthFromCloud();
        lastHydrateAtRef.current = Date.now();
      } finally {
        hydrationRunningRef.current = false;
      }
      refreshLocalState();
    };
    const onBottomNavRetap = (event: Event) => {
      const custom = event as CustomEvent<{ to?: string }>;
      if (custom.detail?.to !== '/settings') return;
      void refreshFromCloudIfNeeded();
    };
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshFromCloudIfNeeded();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshFromCloudIfNeeded();
    };
    const onLocalWealthChange = () => refreshLocalState();

    window.addEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(FX_RATES_UPDATED_EVENT, onLocalWealthChange as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onLocalWealthChange as EventListener);
    void refreshFromCloudIfNeeded(true);
    return () => {
      window.removeEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, onLocalWealthChange as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onLocalWealthChange as EventListener);
    };
  }, []);

  useEffect(() => {
    const existingMonthKeys = new Set(availableClosures.map((closure) => closure.monthKey));
    let changed = false;
    const next: ClosureReviewPendingMap = {};
    Object.entries(closureReviewPending).forEach(([monthKey, entry]) => {
      if (!existingMonthKeys.has(monthKey)) {
        changed = true;
        return;
      }
      next[monthKey] = entry;
    });
    if (changed) persistClosureReviewPendingState(next);
  }, [availableClosures, closureReviewPending]);

  const scrollToSettingsElement = (element: HTMLElement | null) => {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToCsvImportSection = () => {
    setCsvImportOpen(true);
    window.setTimeout(() => {
      scrollToSettingsElement(csvImportSectionRef.current);
    }, 120);
  };

  const goToFxSection = () => {
    scrollToSettingsElement(syncSectionRef.current);
  };

  const openClosureReview = (monthKeys: string[], source: ClosureReviewSource) => {
    const targetMonthKeys = Array.from(new Set(monthKeys.filter(Boolean)));
    if (!targetMonthKeys.length) return;
    const monthSet = new Set(targetMonthKeys);
    const closures = loadClosures()
      .filter((closure) => monthSet.has(closure.monthKey))
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    if (!closures.length) return;
    setClosureReviewSource(source);
    setClosureReviewQueue(closures);
    setClosureReviewOpen(true);
  };

  const openManualClosureReview = () => {
    if (historicalPendingMonthKeys.length > 0) {
      openClosureReview(historicalPendingMonthKeys, 'manual');
      return;
    }
    if (!availableClosures.length) return;
    openClosureReview([availableClosures[0].monthKey], 'manual');
  };

  const onClosureReviewFinish = (result: ClosureReviewModalResult) => {
    const updatedById = new Map(result.updatedClosures.map((closure) => [closure.id, closure]));
    const currentClosures = loadClosures();
    const mergedClosures = currentClosures.map((closure) => updatedById.get(closure.id) || closure);
    saveClosures(mergedClosures);

    const nextPending: ClosureReviewPendingMap = { ...closureReviewPending };
    const pendingSet = new Set(result.pendingMonthKeys);
    result.reviewedMonthKeys.forEach((monthKey) => {
      nextPending[monthKey] = {
        status: pendingSet.has(monthKey) ? 'pending' : 'complete',
        source: closureReviewSource,
        reviewedAt: new Date().toISOString(),
      };
    });
    persistClosureReviewPendingState(nextPending);

    const completeCount = result.completeMonthKeys.length;
    const pendingCount = result.pendingMonthKeys.length;
    setClosureReviewMessage(
      `Revisión guardada (${closureReviewSource === 'csv' ? 'importación CSV' : 'manual'}): ${completeCount} completos · ${pendingCount} pendientes.`,
    );
    setClosureReviewOpen(false);
    setClosureReviewQueue([]);
    refreshLocalState();
  };

  const navigateToPatrimonioAndScroll = (candidates: string[]) => {
    if (!window.location.hash.startsWith('#/patrimonio')) {
      window.location.hash = '#/patrimonio';
    }
    const normalized = candidates.map((value) => value.toLowerCase());
    const tryScroll = (attempt = 0) => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('section,article,div,button,a,h1,h2,h3,span,p'));
      const target = nodes.find((node) => {
        const text = String(node.textContent || '').toLowerCase();
        if (!text) return false;
        return normalized.some((candidate) => text.includes(candidate));
      });
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (attempt < 18) {
        window.setTimeout(() => tryScroll(attempt + 1), 120);
      }
    };
    window.setTimeout(() => tryScroll(0), 140);
  };

  const selectedDeleteBlocks = useMemo(
    () => Object.values(deleteBlocksDraft).filter(Boolean).length,
    [deleteBlocksDraft],
  );

  const toSafeFxRates = (input?: { usdClp: number; eurClp: number; ufClp: number }) => ({
    usdClp: Number.isFinite(input?.usdClp) && (input?.usdClp || 0) > 0 ? (input?.usdClp as number) : defaultFxRates.usdClp,
    eurClp: Number.isFinite(input?.eurClp) && (input?.eurClp || 0) > 0 ? (input?.eurClp as number) : defaultFxRates.eurClp,
    ufClp: Number.isFinite(input?.ufClp) && (input?.ufClp || 0) > 0 ? (input?.ufClp as number) : defaultFxRates.ufClp,
  });

  const resolveRuleConfig = (key: string): ClosingRuleConfig => {
    const fromState = closingConfig.rules[key];
    if (fromState) return fromState;
    if (key.startsWith('investment:')) return toDefaultRule(true, 3);
    const staticField = STATIC_CLOSING_FIELDS_MAP.get(key as ClosingStaticFieldKey);
    return toDefaultRule(staticField?.defaultEnabled ?? false, staticField?.defaultMaxAgeDays ?? null);
  };

  const persistClosingConfig = (next: ClosingConfigState) => {
    setClosingConfig(next);
    saveClosingConfig(next);
  };

  const updateClosingRule = (key: string, next: ClosingRuleConfig) => {
    persistClosingConfig({
      rules: {
        ...closingConfig.rules,
        [key]: next,
      },
    });
  };

  const getLatestDays = (matcher: (label: string) => boolean, block?: 'bank' | 'investment' | 'real_estate' | 'debt') => {
    const matching = monthRecords.filter((record) => {
      if (block && record.block !== block) return false;
      return matcher(record.label);
    });
    if (!matching.length) return null;
    const latestIso = matching
      .map((record) => record.createdAt || record.snapshotDate)
      .filter(Boolean)
      .sort((a, b) => String(b).localeCompare(String(a)))[0];
    return daysSinceIso(latestIso);
  };

  const staticClosingRows = useMemo<ClosingConfigRowView[]>(() => {
    return STATIC_CLOSING_FIELDS.map((field) => {
      const rule = resolveRuleConfig(field.key);
      let lastUpdatedDays: number | null = null;
      if (field.key === 'investments_value') {
        lastUpdatedDays = monthRecords.some(
          (record) => record.block === 'investment' && !isRiskCapitalInvestmentLabel(record.label),
        )
          ? getLatestDays(
              (label) => !isRiskCapitalInvestmentLabel(label) && !isTenenciaLabel(label),
              'investment',
            )
          : null;
      } else if (field.key === 'banks_fintoc') {
        lastUpdatedDays = getLatestDays(() => true, 'bank');
      } else if (field.key === 'tenencia') {
        lastUpdatedDays = getLatestDays((label) => isTenenciaLabel(label), 'investment');
      } else if (field.key === 'cards_used') {
        lastUpdatedDays = getLatestDays(
          (label) => !sameCanonicalLabel(label, MORTGAGE_DEBT_BALANCE_LABEL) && !isMortgageMetaDebtLabel(label),
          'debt',
        );
      } else if (field.key === 'property_value') {
        lastUpdatedDays = getLatestDays((label) => sameCanonicalLabel(label, REAL_ESTATE_PROPERTY_VALUE_LABEL), 'real_estate');
      } else if (field.key === 'mortgage_balance') {
        lastUpdatedDays = getLatestDays((label) => sameCanonicalLabel(label, MORTGAGE_DEBT_BALANCE_LABEL), 'debt');
      } else if (field.key === 'mortgage_amortization') {
        lastUpdatedDays = getLatestDays(
          (label) => sameCanonicalLabel(label, MORTGAGE_AMORTIZATION_LABEL),
          'debt',
        );
      }
      return {
        key: field.key,
        label: field.label,
        enabled: rule.enabled,
        maxAgeDays: rule.maxAgeDays,
        supportsMaxAge: field.defaultMaxAgeDays !== null,
        lastUpdatedDays,
      };
    });
  }, [closingConfig.rules, monthRecords]);

  const investmentClosingRows = useMemo<ClosingConfigRowView[]>(() => {
    const sortedInstruments = [...investmentInstruments]
      .filter((instrument) => !isTenenciaInstrument(instrument.label))
      .sort((a, b) => normalizeForMatch(a.label).localeCompare(normalizeForMatch(b.label)));
    return sortedInstruments.map((instrument) => {
      const key = toRuleKeyFromInvestmentId(instrument.id);
      const rule = resolveRuleConfig(key);
      return {
        key,
        label: `${instrument.label} (${instrument.currency})`,
        enabled: rule.enabled,
        maxAgeDays: rule.maxAgeDays,
        supportsMaxAge: true,
        lastUpdatedDays: getLatestDays((label) => sameCanonicalLabel(label, instrument.label), 'investment'),
        investmentId: instrument.id,
      };
    });
  }, [closingConfig.rules, investmentInstruments, monthRecords]);

  const closingConfigRows = useMemo<ClosingConfigRowView[]>(
    () => [...staticClosingRows, ...investmentClosingRows],
    [staticClosingRows, investmentClosingRows],
  );

  useEffect(() => {
    const nextRules = { ...closingConfig.rules };
    let changed = false;

    if (nextRules.risk_capital) {
      delete nextRules.risk_capital;
      changed = true;
    }

    STATIC_CLOSING_FIELDS.forEach((field) => {
      if (!nextRules[field.key]) {
        nextRules[field.key] = toDefaultRule(field.defaultEnabled, field.defaultMaxAgeDays);
        changed = true;
      }
    });

    investmentInstruments.forEach((instrument) => {
      if (isTenenciaInstrument(instrument.label)) return;
      const key = toRuleKeyFromInvestmentId(instrument.id);
      if (!nextRules[key]) {
        nextRules[key] = toDefaultRule(true, 3);
        changed = true;
      }
    });

    Object.keys(nextRules).forEach((key) => {
      if (!key.startsWith('investment:')) return;
      const investmentId = key.replace('investment:', '');
      if (
        !investmentInstruments.some(
          (instrument) => instrument.id === investmentId && !isTenenciaInstrument(instrument.label),
        )
      ) {
        delete nextRules[key];
        changed = true;
      }
    });

    if (changed) persistClosingConfig({ rules: nextRules });
  }, [investmentInstruments, closingConfig.rules]);

  const onToggleClosingRule = (key: string, enabled: boolean) => {
    const currentRule = resolveRuleConfig(key);
    const defaultMax = key.startsWith('investment:')
      ? 3
      : (STATIC_CLOSING_FIELDS_MAP.get(key as ClosingStaticFieldKey)?.defaultMaxAgeDays ?? null);
    updateClosingRule(key, {
      enabled,
      maxAgeDays: enabled ? currentRule.maxAgeDays ?? defaultMax : currentRule.maxAgeDays,
    });
  };

  const onMaxAgeClosingRuleChange = (key: string, rawValue: string) => {
    const currentRule = resolveRuleConfig(key);
    const parsed = parseInt(rawValue, 10);
    const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    updateClosingRule(key, {
      ...currentRule,
      maxAgeDays: safeValue,
    });
  };

  const applyRecordRemovalToClosures = (
    matcher: (label: string) => boolean,
    monthFilter: ((monthKey: string) => boolean) | null,
  ) => {
    const closures = loadClosures();
    let changed = false;
    const nextClosures = closures.map((closure) => {
      const shouldChangeCurrent = !monthFilter || monthFilter(closure.monthKey);
      const currentRecords = closure.records || [];
      let nextClosure = closure;
      if (shouldChangeCurrent && currentRecords.length) {
        const filtered = currentRecords.filter(
          (record) => !(record.block === 'investment' && matcher(record.label)),
        );
        if (filtered.length !== currentRecords.length) {
          changed = true;
          nextClosure = {
            ...nextClosure,
            records: filtered,
            summary: summarizeWealth(filtered, toSafeFxRates(nextClosure.fxRates)),
          };
        }
      }

      if (nextClosure.previousVersions?.length) {
        const nextVersions = nextClosure.previousVersions.map((version) => {
          if (!shouldChangeCurrent || !version.records?.length) return version;
          const filteredVersionRecords = version.records.filter(
            (record) => !(record.block === 'investment' && matcher(record.label)),
          );
          if (filteredVersionRecords.length === version.records.length) return version;
          changed = true;
          return {
            ...version,
            records: filteredVersionRecords,
            summary: summarizeWealth(filteredVersionRecords, toSafeFxRates(version.fxRates)),
          };
        });
        nextClosure = { ...nextClosure, previousVersions: nextVersions };
      }

      return nextClosure;
    });

    if (changed) saveClosures(nextClosures);
    return changed;
  };

  const closeInvestmentFromCurrentMonthNow = async () => {
    const targetId = closingInvestmentCloseTargetId;
    if (!targetId) return;
    const targetInstrument = investmentInstruments.find((item) => item.id === targetId);
    if (!targetInstrument) return;

    setClosingInvestmentActionBusy(true);
    setClosingConfigMessage('');
    try {
      setInvestmentInstrumentMonthExcluded(targetId, monthKey, true);
      const records = loadWealthRecords();
      const monthPrefix = `${monthKey}-`;
      const nextRecords = records.filter(
        (record) =>
          !(
            record.block === 'investment' &&
            record.snapshotDate.startsWith(monthPrefix) &&
            sameCanonicalLabel(record.label, targetInstrument.label)
          ),
      );
      if (nextRecords.length !== records.length) {
        saveWealthRecords(nextRecords);
      }
      applyRecordRemovalToClosures((label) => sameCanonicalLabel(label, targetInstrument.label), (closureMonth) =>
        closureMonth >= monthKey,
      );

      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setClosingConfigMessage(
        `Instrumento "${targetInstrument.label}" cerrado desde ${formatMonthLabel(monthKey)}. ${describeLocalThenCloudSync(pushed, hydrated)}.`,
      );
    } finally {
      setClosingInvestmentActionBusy(false);
      setClosingInvestmentCloseTargetId(null);
    }
  };

  const deleteInvestmentCompletelyNow = async () => {
    const targetId = closingInvestmentDeleteTargetId;
    if (!targetId) return;
    const targetInstrument = investmentInstruments.find((item) => item.id === targetId);
    if (!targetInstrument) return;

    setClosingInvestmentActionBusy(true);
    setClosingConfigMessage('');
    try {
      const nextInstruments = loadInvestmentInstruments().filter((item) => item.id !== targetId);
      saveInvestmentInstruments(nextInstruments);

      const records = loadWealthRecords();
      const nextRecords = records.filter(
        (record) => !(record.block === 'investment' && sameCanonicalLabel(record.label, targetInstrument.label)),
      );
      if (nextRecords.length !== records.length) {
        saveWealthRecords(nextRecords);
      }
      applyRecordRemovalToClosures((label) => sameCanonicalLabel(label, targetInstrument.label), null);

      const nextRules = { ...closingConfig.rules };
      delete nextRules[toRuleKeyFromInvestmentId(targetId)];
      persistClosingConfig({ rules: nextRules });

      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setClosingConfigMessage(
        `Instrumento "${targetInstrument.label}" eliminado completamente de registros y cierres con detalle. ${describeLocalThenCloudSync(pushed, hydrated)}.`,
      );
    } finally {
      setClosingInvestmentActionBusy(false);
      setClosingInvestmentDeleteTargetId(null);
    }
  };

  const importCsvNow = async () => {
    setCsvConfirmOpen(false);
    setCsvImporting(true);
    setCsvImportedResultVisible(false);
    setClosureReviewMessage('');
    setCsvImportMessage('');
    setCsvImportWarnings([]);
    try {
      const result = await importHistoricalClosuresFromCsv(csvDraft);
      const summary = [
        result.importedMonths.length ? `Importados: ${result.importedMonths.join(', ')}` : 'Importados: 0',
        result.replacedMonths.length ? `Reemplazados: ${result.replacedMonths.join(', ')}` : 'Reemplazados: 0',
        result.skippedMonths.length ? `Omitidos: ${result.skippedMonths.join(', ')}` : 'Omitidos: 0',
      ].join(' · ');
      setCsvImportMessage(summary);
      setCsvImportWarnings(result.warnings);
      setCsvImportedResultVisible(true);
      refreshLocalState();
      const reviewMonths = Array.from(new Set([...result.importedMonths, ...result.replacedMonths]));
      if (reviewMonths.length) {
        openClosureReview(reviewMonths, 'csv');
      }
    } catch (err: any) {
      setCsvImportMessage(String(err?.message || 'No pude importar el historial CSV.'));
      setCsvImportWarnings([]);
      setCsvImportedResultVisible(true);
    } finally {
      setCsvImporting(false);
    }
  };

  const deleteSelectedClosureNow = async () => {
    if (!selectedClosureToDelete) return;
    setDeleteClosureConfirmOpen(false);
    setDeletingClosure(true);
    setDeleteClosureMessage('');
    try {
      const current = loadClosures();
      const next = current.filter((closure) => closure.monthKey !== selectedClosureToDelete);
      saveClosures(next);
      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setSelectedClosureToDelete('');
      setDeleteClosureMessage(
        `Cierre ${selectedClosureToDelete} eliminado. ${describeLocalThenCloudSync(pushed, hydrated)}.`,
      );
    } finally {
      setDeletingClosure(false);
    }
  };

  const deleteAllClosuresNow = async () => {
    setDeleteAllClosuresConfirmOpen(false);
    setDeletingClosure(true);
    setDeleteClosureMessage('');
    try {
      saveClosures([]);
      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setSelectedClosureToDelete('');
      setDeleteClosureMessage(`Se eliminaron todos los cierres. ${describeLocalThenCloudSync(pushed, hydrated)}.`);
    } finally {
      setDeletingClosure(false);
    }
  };

  const deleteSelectedBlocksNow = async () => {
    if (!selectedDeleteBlocks) return;
    setDeleteBlocksConfirmOpen(false);
    setDeletingBlocks(true);
    setDeleteBlocksMessage('');
    try {
      const month = currentMonthKey();
      let removedRecords = 0;
      let removedInvestment = 0;
      let removedRealEstate = 0;

      if (deleteBlocksDraft.realEstate) {
        const realEstateResult = await clearCurrentMonthData({ clearRealEstate: true });
        removedRecords += realEstateResult.removedRecords;
        removedRealEstate += realEstateResult.removedRealEstate;
      }

      const monthPrefix = `${month}-`;
      const recordsAfterRealEstate = loadWealthRecords();
      const removeById = new Set<string>();
      recordsAfterRealEstate.forEach((record) => {
        if (!record.snapshotDate.startsWith(monthPrefix)) return;
        if (deleteBlocksDraft.bank && record.block === 'bank') {
          removeById.add(record.id);
          return;
        }
        if (record.block === 'investment') {
          const risk = isRiskCapitalInvestmentLabel(record.label);
          if ((deleteBlocksDraft.investment && !risk) || (deleteBlocksDraft.risk && risk)) {
            removeById.add(record.id);
          }
        }
      });

      removeById.forEach((id) => removeWealthRecord(id));
      if (removeById.size) {
        removedRecords += removeById.size;
        removedInvestment += removeById.size;
      }

      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setDeleteBlocksMessage(
        removedRecords
          ? `Bloques limpiados: ${removedRecords} registros (${removedInvestment} bancos/inversiones, ${removedRealEstate} bienes raíces/hipoteca). ${describeLocalThenCloudSync(pushed, hydrated)}.`
          : 'No había registros para borrar en los bloques seleccionados.',
      );
    } finally {
      setDeletingBlocks(false);
    }
  };

  const loadDemoDataNow = async () => {
    setSeedingDemo(true);
    setSeedDemoMessage('');
    try {
      seedDemoWealthTimeline();
      let pushed = false;
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      refreshLocalState();
      setSeedDemoMessage(
        pushed ? 'Datos de prueba cargados' : 'Datos de prueba cargados (sin conexión con la nube).',
      );
    } catch (err: any) {
      setSeedDemoMessage(`No pude cargar datos de prueba: ${String(err?.message || err || 'error')}`);
    } finally {
      setSeedingDemo(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <Card className="space-y-4 border border-[#d9c8ae] bg-gradient-to-br from-[#f6efe2] via-[#fbf7ef] to-white p-4">
        <div>
          <div className="text-lg font-semibold text-slate-900">Estado de tu patrimonio</div>
          <div className="text-xs text-slate-600">
            Checklist rápido para validar histórico, mes actual y datos base.
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Historial</div>
              <div className="text-xs text-slate-600">Estado de cierres históricos y calidad de TC/UF.</div>
            </div>
            <div className="text-lg leading-none">{historicalStatus.icon}</div>
          </div>
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              historicalStatus.tone === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : historicalStatus.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            Cierres guardados: <span className="font-semibold">{availableClosures.length}</span> · {historicalStatus.text}
          </div>
          {!!historicalPendingMonthKeys.length && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Pendientes: {historicalPendingMonthKeys.join(', ')}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={goToCsvImportSection}>
              Ir a importar historial CSV
            </Button>
            <Button variant="outline" size="sm" onClick={openManualClosureReview} disabled={!availableClosures.length}>
              {historicalPendingMonthKeys.length
                ? `Revisar pendientes (${historicalPendingMonthKeys.length})`
                : 'Revisar último cierre'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-3 space-y-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Mes actual</div>
            <div className="text-xs text-slate-600">{formatMonthLabel(monthKey)} · estado por módulo</div>
          </div>
          <div className="space-y-2">
            {monthChecklist.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 text-sm text-slate-800">
                  <span className="text-base leading-none">{item.ok ? '✅' : '❌'}</span>
                  <span>{item.label}</span>
                </div>
                {item.key === 'fx' ? (
                  <Button variant="outline" size="sm" onClick={goToFxSection}>
                    Ir a TC
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigateToPatrimonioAndScroll(
                        item.key === 'bank'
                          ? ['bancos', 'liquidez']
                          : item.key === 'investment'
                            ? ['inversiones']
                            : item.key === 'risk'
                              ? ['riesgo on', 'riesgo off', 'capital de riesgo']
                              : ['bienes raíces', 'valor propiedad'],
                      )
                    }
                  >
                    Ir a sección
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {!!resetAllMessage && (
          <div className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-700">
            {resetAllMessage}
          </div>
        )}
        {!!closureReviewMessage && (
          <div className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-700">
            {closureReviewMessage}
          </div>
        )}
      </Card>

      <Card className="space-y-4 border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
        <ClosingConfigSection
          rows={closingConfigRows}
          onToggle={onToggleClosingRule}
          onMaxAgeDaysChange={onMaxAgeClosingRuleChange}
          onCloseInvestmentFromCurrentMonth={(investmentId) => setClosingInvestmentCloseTargetId(investmentId)}
          onDeleteInvestmentCompletely={(investmentId) => setClosingInvestmentDeleteTargetId(investmentId)}
        />
        {!!closingConfigMessage && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {closingConfigMessage}
          </div>
        )}
      </Card>

      <Card className="border-0 bg-gradient-to-br from-[#103c35] via-[#165347] to-[#1f4a3a] p-5 text-[#f3eadb] shadow-[0_14px_30px_rgba(11,38,34,0.42)]">
        <div className="text-xs uppercase tracking-[0.22em] text-[#f3eadb]/90">Aurum Wealth</div>
        <div className="mt-1 text-2xl font-semibold">Ajustes</div>
        <div className="mt-1 text-sm text-[#e7dcc9]/95">
          Centro de configuración, respaldo y control de datos.
        </div>
      </Card>

      <div className="space-y-4">
        <Card ref={syncSectionRef} className="space-y-4 border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">Sincronización y mercado</div>
              <div className="text-xs text-slate-600">Sesión, nube y tipos de cambio.</div>
            </div>
            <div
              className={`rounded-full border px-2 py-1 text-[11px] font-medium ${
                fsStatus.state === 'ok'
                  ? 'border-emerald-200 bg-emerald-100/70 text-emerald-800'
                  : 'border-amber-200 bg-amber-100/70 text-amber-800'
              }`}
            >
              {fsStatus.state === 'ok' ? 'Firestore OK' : 'Firestore con error'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/85 p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Sesión activa</div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
              <div>
                <span className="text-slate-500">Correo:</span> {authEmail || 'Sin correo (sesión no lista)'}
              </div>
              <div className="mt-1 break-all">
                <span className="text-slate-500">UID:</span> {authUid || 'Sin UID'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  let pushed = false;
                  let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
                  try {
                    pushed = await syncWealthNow();
                  } catch {
                    pushed = false;
                  }
                  try {
                    hydrated = await hydrateWealthFromCloud();
                  } catch {
                    hydrated = 'none';
                  }
                  const fs = getFirestoreStatus();
                  setFsStatus(fs);
                  setSyncMessage(describeManualSync(pushed, hydrated));
                  setFsDebug(getLastWealthSyncIssue() || fs.message || '');
                }}
              >
                Sincronizar ahora
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await signOutUser();
                }}
              >
                Cerrar sesión
              </Button>
            </div>
            {!!syncMessage && (
              <div
                className={`text-xs ${
                  syncMessage.includes('Error') || syncMessage.includes('Sin conexión')
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {syncMessage}
              </div>
            )}
            {!!fsDebug && <div className="text-xs text-slate-500 break-words">Detalle Firestore: {fsDebug}</div>}
            <div className="text-[11px] text-slate-500 break-words">
              Proyecto activo (frontend): {import.meta.env.VITE_FIREBASE_PROJECT_ID || 'no definido'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/85 p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Tipos de cambio (CLP)</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={syncingLiveFx}
                onClick={async () => {
                  setSyncingLiveFx(true);
                  setFxLiveMessage('');
                  try {
                    const result = await refreshFxRatesFromLive({ force: true });
                    setFx(result.rates);
                    setFxLiveMeta(loadFxLiveSyncMeta());
                    setFxLiveMessage('');
                  } catch (err: any) {
                    setFxLiveMeta(loadFxLiveSyncMeta());
                    const currentSaved = loadFxRates();
                    setFx(currentSaved);
                    const savedText = `USD ${formatFxInteger(currentSaved.usdClp)} · EUR ${formatFxInteger(currentSaved.eurClp)} · UF ${formatFxInteger(currentSaved.ufClp)}`;
                    setFxFallbackSavedText(savedText);
                    setFxFallbackDecisionOpen(true);
                  } finally {
                    setSyncingLiveFx(false);
                  }
                }}
              >
                {syncingLiveFx ? 'Actualizando TC/UF...' : 'Actualizar TC/UF real ahora'}
              </Button>
            </div>

            {!!fxLiveMeta && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  fxLiveMeta.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                <div>
                  Estado: {fxLiveMeta.status === 'ok' ? 'OK' : 'Error'} · Fuente: {humanizeFxSource(fxLiveMeta.source)}
                </div>
                <div className="mt-0.5">Última actualización: {formatDateTime(fxLiveMeta.fetchedAt)}</div>
                {!!(fxLiveMessage || (fxLiveMeta.status === 'error' ? fxLiveMeta.message : '')) && (
                  <div className="mt-0.5 break-words">
                    {fxLiveMessage || fxLiveMeta.message}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div className="text-xs text-slate-500 mb-1">USD a CLP</div>
                <Input
                  value={fxDraft.usdClp}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    setFxDraft((prev) => ({ ...prev, usdClp: e.target.value }));
                  }}
                  onBlur={commitDraftFx}
                />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">EUR a USD</div>
                <Input
                  value={fxDraft.eurUsd}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    setFxDraft((prev) => ({ ...prev, eurUsd: e.target.value }));
                  }}
                  onBlur={commitDraftFx}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Referencia: EUR/CLP {formatFxInteger(fx.eurClp)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">UF a CLP</div>
                <Input
                  value={fxDraft.ufClp}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    setFxDraft((prev) => ({ ...prev, ufClp: e.target.value }));
                  }}
                  onBlur={commitDraftFx}
                />
              </div>
            </div>
            <div className="flex justify-start">
              <Button variant="outline" onClick={commitDraftFx}>
                Guardar TC manual
              </Button>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 border border-amber-100 bg-gradient-to-br from-amber-50/85 to-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">Respaldo e historial</div>
              <div className="text-xs text-slate-600">Backups e importación de cierres.</div>
            </div>
            <div className="rounded-full border border-amber-200 bg-amber-100/80 px-2 py-1 text-[11px] font-medium text-amber-800">
              Datos
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/85 p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Respaldo Aurum (JSON)</div>
            <div className="text-xs text-slate-600">
              Incluye patrimonio, cierres, instrumentos, TC/UF y tokens bancarios guardados.
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  const now = new Date();
                  const pad = (v: number) => String(v).padStart(2, '0');
                  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
                  const payload = {
                    exportedAt: now.toISOString(),
                    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
                    user: {
                      email: auth.currentUser?.email || '',
                      uid: auth.currentUser?.uid || '',
                    },
                    wealth: {
                      records: loadWealthRecords(),
                      closures: loadClosures(),
                      investmentInstruments: loadInvestmentInstruments(),
                      fxRates: loadFxRates(),
                      bankTokens: loadBankTokens(),
                      fxMeta: loadFxLiveSyncMeta(),
                    },
                  };
                  const filename = `aurum_backup_${stamp}.json`;
                  downloadTextFile(JSON.stringify(payload, null, 2), filename, 'application/json');
                  setBackupMessage(`Respaldo descargado: ${filename}`);
                } catch (err: any) {
                  setBackupMessage(`No pude generar respaldo: ${String(err?.message || err || 'error')}`);
                }
              }}
            >
              Descargar respaldo ahora
            </Button>
            {!!backupMessage && <div className="text-xs text-slate-600">{backupMessage}</div>}
          </div>

          <details
            ref={csvImportSectionRef}
            open={csvImportOpen}
            onToggle={(event) => setCsvImportOpen((event.currentTarget as HTMLDetailsElement).open)}
            className="rounded-xl border border-slate-200 bg-white/85 p-3"
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
              Importar historial mensual (CSV)
            </summary>
            <div className="mt-3 space-y-3">
              <div className="text-xs text-slate-600">
                El importador reemplaza el mes si ya existe (según <code>month_key</code>).
              </div>
              {!!csvDraft.trim() && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    csvPreview.monthKeys.length === 1
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {csvPreview.monthKeys.length === 1
                    ? `Modo mensual detectado: ${csvPreviewMonthLabel} (${csvPreview.monthKeys[0]}).`
                    : `Meses detectados: ${
                        csvPreview.monthKeys.length ? csvPreview.monthKeys.join(', ') : 'ninguno válido'
                      } · filas: ${csvPreview.totalRows}.`}
                </div>
              )}
              {!!csvPreview.warnings.length && !csvImportedResultVisible && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <ul className="list-disc pl-4 space-y-0.5">
                    {csvPreview.warnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void copyCsvFormatToClipboard();
                  }}
                >
                  Copiar formato
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    downloadTextFile(historicalCsvTemplate, 'HISTORIAL_AURUM_TEMPLATE.csv', 'text/csv;charset=utf-8;');
                  }}
                >
                  Descargar formato completo (detalle)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    downloadTextFile(
                      historicalSimpleCsvTemplate,
                      'HISTORIAL_AURUM_SIMPLE_TEMPLATE.csv',
                      'text/csv;charset=utf-8;',
                    );
                  }}
                >
                  Descargar formato simple (solo neto)
                </Button>
              </div>
              {!!csvTemplateCopyMessage && <div className="text-xs text-slate-600">{csvTemplateCopyMessage}</div>}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="text-[11px] text-slate-500 mb-1">Formatos admitidos:</div>
                <code className="block text-[11px] text-slate-700 break-all">
                  month_key,closed_at,usd_clp,eur_clp,uf_clp,sura_fin_clp,sura_prev_clp,btg_clp,planvital_clp,global66_usd,wise_usd,valor_prop_uf,saldo_deuda_uf,dividendo_uf,interes_uf,seguros_uf,amortizacion_uf,bancos_clp,bancos_usd,tarjetas_clp,tarjetas_usd
                </code>
                <div className="mt-1 text-[11px] text-slate-500">
                  Nota: si no tienes <code>eur_clp</code>, puedes enviar <code>eur_usd</code> y se calculará con <code>usd_clp</code>.
                </div>
                <code className="mt-1 block text-[11px] text-slate-700 break-all">
                  month_key,closed_at,usd_clp,eur_clp,uf_clp,net_clp
                </code>
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">Cargar archivo CSV</div>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      setCsvDraft(text);
                      setCsvImportedResultVisible(false);
                      setCsvImportMessage(`Archivo cargado: ${file.name} (${Math.round(text.length / 1024)} KB).`);
                      setCsvImportWarnings([]);
                    } catch (err: any) {
                      setCsvImportedResultVisible(false);
                      setCsvImportMessage(`No pude leer archivo CSV: ${String(err?.message || err || 'error')}`);
                      setCsvImportWarnings([]);
                    }
                    event.currentTarget.value = '';
                  }}
                />
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">O pega el CSV aquí</div>
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  rows={8}
                  placeholder="month_key,closed_at,usd_clp,..."
                  value={csvDraft}
                  onChange={(e) => {
                    setCsvImportedResultVisible(false);
                    setCsvDraft(e.target.value);
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={csvImporting}
                  onClick={async () => {
                    if (!csvDraft.trim()) {
                      setCsvImportMessage('Pega o carga un CSV antes de importar.');
                      setCsvImportWarnings([]);
                      return;
                    }
                    if (!csvPreview.monthKeys.length) {
                      setCsvImportMessage('No detecté ningún month_key válido en el CSV.');
                      setCsvImportWarnings(csvPreview.warnings);
                      return;
                    }
                    setCsvConfirmOpen(true);
                  }}
                >
                  {csvImporting ? 'Importando historial...' : 'Importar historial CSV'}
                </Button>
                <Button
                  variant="outline"
                  disabled={csvImporting}
                  onClick={() => {
                    setCsvDraft('');
                    setCsvImportedResultVisible(false);
                    setCsvImportMessage('');
                    setCsvImportWarnings([]);
                  }}
                >
                  Limpiar CSV
                </Button>
              </div>

              {!!csvImportMessage && <div className="text-xs text-slate-700">{csvImportMessage}</div>}
              {!!csvImportWarnings.length && csvImportedResultVisible && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <div className="font-medium">Advertencias de importación</div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {csvImportWarnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </Card>
      </div>

      <Card className="space-y-4 border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Laboratorio y limpieza</div>
          <div className="text-xs text-slate-600">Tres niveles de borrado con confirmación guiada.</div>
        </div>

        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-3">
          <div className="text-xs uppercase tracking-wide text-red-800 font-semibold">Nivel 1 — Reset total</div>
          <div className="text-xs text-red-700">
            Borra todos los datos de la app en local y nube. Acción de máximo impacto.
          </div>
          <Button variant="danger" onClick={() => setResetAllOpen(true)} disabled={resettingAll}>
            Resetear todos los datos
          </Button>
          {!!resetAllMessage && <div className="text-xs text-red-800">{resetAllMessage}</div>}
        </div>

        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <div className="text-xs uppercase tracking-wide text-amber-800 font-semibold">
            Nivel 2 — Borrar un cierre específico
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <select
              className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={selectedClosureToDelete}
              onChange={(event) => setSelectedClosureToDelete(event.target.value)}
            >
              <option value="">Selecciona mes de cierre para borrar...</option>
              {availableClosures.map((closure) => (
                <option key={closure.id} value={closure.monthKey}>
                  {formatMonthLabel(closure.monthKey)} ({closure.monthKey})
                </option>
              ))}
            </select>
            <Button
              variant="danger"
              disabled={deletingClosure || !selectedClosureToDelete}
              onClick={() => setDeleteClosureConfirmOpen(true)}
            >
              {deletingClosure ? 'Borrando...' : 'Borrar cierre seleccionado'}
            </Button>
          </div>
          {!!deleteClosureMessage && (
            <div
              className={`text-xs ${
                deleteClosureMessage.includes('Error') || deleteClosureMessage.includes('Sin conexión')
                  ? 'text-amber-800'
                  : 'text-emerald-700'
              }`}
            >
              {deleteClosureMessage}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-slate-800 font-semibold">
            Nivel 3 — Borrar bloque del mes actual
          </div>
          <div className="text-xs text-slate-600">
            Mes objetivo: <span className="font-medium">{formatMonthLabel(currentMonthKey())}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.bank}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, bank: event.target.checked }))
                }
              />
              Bancos
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.investment}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, investment: event.target.checked }))
                }
              />
              Inversiones
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.risk}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, risk: event.target.checked }))
                }
              />
              Capital de riesgo
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.realEstate}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, realEstate: event.target.checked }))
                }
              />
              Propiedad + hipoteca
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={deletingBlocks || selectedDeleteBlocks === 0}
              onClick={() => setDeleteBlocksConfirmOpen(true)}
            >
              {deletingBlocks ? 'Borrando...' : 'Borrar bloques seleccionados'}
            </Button>
            <Button
              variant="outline"
              disabled={deletingClosure || !availableClosures.length}
              onClick={() => setDeleteAllClosuresConfirmOpen(true)}
            >
              Borrar todos los cierres
            </Button>
          </div>
          {!!deleteBlocksMessage && (
            <div className="text-xs text-slate-700">{deleteBlocksMessage}</div>
          )}
        </div>

        {canShowDemoSeedButton && (
          <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
            <div className="text-xs uppercase tracking-wide text-indigo-800 font-semibold">
              Desarrollo — Datos de prueba
            </div>
            <div className="text-xs text-indigo-700">
              Carga ene/feb 2025 cerrados y mar 2025 en curso para validar cálculos y flujos.
            </div>
            <Button variant="secondary" disabled={seedingDemo} onClick={() => void loadDemoDataNow()}>
              {seedingDemo ? 'Cargando datos de prueba...' : 'Cargar datos de prueba'}
            </Button>
            {!!seedDemoMessage && <div className="text-xs text-indigo-800">{seedDemoMessage}</div>}
          </div>
        )}
      </Card>

      <ClosureReviewModal
        open={closureReviewOpen}
        source={closureReviewSource}
        closures={closureReviewQueue}
        onCancel={() => {
          setClosureReviewOpen(false);
          setClosureReviewQueue([]);
        }}
        onFinish={onClosureReviewFinish}
      />

      <ConfirmActionModal
        open={resetAllOpen}
        tone="danger"
        title="¿Estás seguro?"
        message="Esto borrará todos tus datos sin posibilidad de recuperarlos."
        confirmText="Sí, continuar"
        cancelText="Cancelar"
        onCancel={() => {
          if (resettingAll) return;
          setResetAllOpen(false);
        }}
        onConfirm={() => {
          setResetAllOpen(false);
          setResetStepTwoOpen(true);
        }}
      />

      <TypedConfirmModal
        open={resetStepTwoOpen}
        busy={resettingAll}
        title="Confirmación final de reset"
        message="Esta acción es irreversible. Escribe CONFIRMAR para continuar."
        expectedText="CONFIRMAR"
        confirmText="Resetear definitivamente"
        onCancel={() => {
          if (resettingAll) return;
          setResetStepTwoOpen(false);
        }}
        onConfirm={async () => {
          setResettingAll(true);
          setResetAllMessage('');
          try {
            const result = await clearWealthDataForFreshStart({ preserveFx: false });
            setFx(loadFxRates());
            setFxLiveMeta(loadFxLiveSyncMeta());
            setAvailableClosures(loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
            setAllRecords(loadWealthRecords());
            setFsStatus(getFirestoreStatus());
            setSelectedClosureToDelete('');
            setDeleteClosureMessage('');
            setCsvImportMessage('');
            setCsvImportWarnings([]);
            setCsvImportedResultVisible(false);
            setClosureReviewMessage('');
            persistClosureReviewPendingState({});
            setDeleteBlocksMessage('');
            setSyncMessage('');
            setFsDebug('');
            setBackupMessage('');
            setResetAllMessage(
              result.cloudCleared
                ? 'Reset completado. Datos limpiados en local y nube.'
                : 'Reset completado solo en local. Sin conexión con la nube por ahora.',
            );
            setResetStepTwoOpen(false);
          } finally {
            setResettingAll(false);
          }
        }}
      />

      <ConfirmActionModal
        open={csvConfirmOpen}
        busy={csvImporting}
        title="Confirmar importación CSV"
        message={`Se importará/reemplazará ${
          csvPreview.monthKeys.length === 1
            ? `el mes ${csvPreview.monthKeys[0]}`
            : `${csvPreview.monthKeys.length} meses (${csvPreview.monthKeys.join(', ')})`
        } según month_key.`}
        confirmText="Importar ahora"
        cancelText="Cancelar"
        onCancel={() => setCsvConfirmOpen(false)}
        onConfirm={() => {
          void importCsvNow();
        }}
      />

      <ConfirmActionModal
        open={fxFallbackDecisionOpen}
        title="No pude actualizar TC/UF online"
        message={`Valores guardados actuales: ${fxFallbackSavedText}`}
        confirmText="Mantener guardados"
        cancelText="Ingresar manualmente"
        onCancel={() => {
          setFxFallbackDecisionOpen(false);
          setFxLiveMessage('Decisión: ingresa los valores manualmente en los campos inferiores.');
        }}
        onConfirm={() => {
          setFxFallbackDecisionOpen(false);
          setFxLiveMessage(`Decisión: se mantienen valores guardados (${fxFallbackSavedText}).`);
        }}
      />

      <ConfirmActionModal
        open={deleteClosureConfirmOpen}
        tone="danger"
        busy={deletingClosure}
        title="Confirmar borrado de cierre"
        message={
          selectedClosureToDelete
            ? `Vas a borrar el cierre ${selectedClosureToDelete}. Esta acción no borra registros del mes.`
            : 'Selecciona un cierre antes de continuar.'
        }
        confirmText="Borrar cierre"
        cancelText="Cancelar"
        onCancel={() => setDeleteClosureConfirmOpen(false)}
        onConfirm={() => {
          void deleteSelectedClosureNow();
        }}
      />

      <ConfirmActionModal
        open={deleteAllClosuresConfirmOpen}
        tone="danger"
        busy={deletingClosure}
        title="Confirmar borrado total de cierres"
        message={`Se eliminarán todos los cierres guardados (${availableClosures.length}). No borra registros mensuales.`}
        confirmText="Borrar todos los cierres"
        cancelText="Cancelar"
        onCancel={() => setDeleteAllClosuresConfirmOpen(false)}
        onConfirm={() => {
          void deleteAllClosuresNow();
        }}
      />

      <ConfirmActionModal
        open={deleteBlocksConfirmOpen}
        tone="danger"
        busy={deletingBlocks}
        title="Confirmar borrado de bloques"
        message="Se eliminarán los bloques seleccionados del mes actual. Esta acción no se puede deshacer."
        confirmText="Borrar bloques"
        cancelText="Cancelar"
        onCancel={() => setDeleteBlocksConfirmOpen(false)}
        onConfirm={() => {
          void deleteSelectedBlocksNow();
        }}
      />

      <ConfirmActionModal
        open={!!closingInvestmentCloseTargetId}
        busy={closingInvestmentActionBusy}
        title="Cerrar inversión desde este mes"
        message={
          closingInvestmentCloseTargetId
            ? 'Esta inversión dejará de exigirse y de arrastrarse desde el mes actual, pero se conserva completa en el historial anterior.'
            : ''
        }
        confirmText="Cerrar desde este mes"
        cancelText="Cancelar"
        onCancel={() => {
          if (closingInvestmentActionBusy) return;
          setClosingInvestmentCloseTargetId(null);
        }}
        onConfirm={() => {
          void closeInvestmentFromCurrentMonthNow();
        }}
      />

      <ConfirmActionModal
        open={!!closingInvestmentDeleteTargetId}
        busy={closingInvestmentActionBusy}
        tone="danger"
        title="Eliminar inversión completamente"
        message={
          closingInvestmentDeleteTargetId
            ? 'Se eliminará esta inversión de registros e historial de cierres con detalle. Esta acción impacta períodos anteriores y no se puede deshacer.'
            : ''
        }
        confirmText="Eliminar completamente"
        cancelText="Cancelar"
        onCancel={() => {
          if (closingInvestmentActionBusy) return;
          setClosingInvestmentDeleteTargetId(null);
        }}
        onConfirm={() => {
          void deleteInvestmentCompletelyNow();
        }}
      />
    </div>
  );
};
