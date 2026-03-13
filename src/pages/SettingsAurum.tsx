import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ChevronDown } from 'lucide-react';
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
  formatCurrency,
  formatIsoDateTime as formatDateTime,
  formatMonthLabel,
  formatRateInt as formatFxInteger,
} from '../utils/wealthFormat';
import {
  TENENCIA_CXC_PREFIX_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  MORTGAGE_AMORTIZATION_LABEL,
  createWealthBackupSnapshot,
  listWealthBackupSnapshots,
  loadCloudClosuresSummary,
  loadClosures,
  saveClosures,
  clearCurrentMonthData,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  hydrateWealthFromCloud,
  getLastWealthSyncIssue,
  importHistoricalAggregatedClosuresFromCsv,
  importHistoricalClosuresFromCsv,
  previewHistoricalClosuresCsv,
  loadFxLiveSyncMeta,
  loadFxRates,
  defaultFxRates,
  clearWealthDataForFreshStart,
  isMortgageMetaDebtLabel,
  isNonMortgageDebtRecord,
  isRiskCapitalInvestmentLabel,
  loadInvestmentInstruments,
  loadWealthRecords,
  removeWealthRecord,
  refreshFxRatesFromLive,
  restoreWealthFromBackupSnapshot,
  saveInvestmentInstruments,
  WEALTH_DATA_UPDATED_EVENT,
  saveFxRates,
  repairMarch2025EurClpScale,
  seedDemoWealthTimeline,
  saveWealthRecords,
  setInvestmentInstrumentMonthExcluded,
  summarizeWealth,
  syncWealthNow,
  validateFxRange,
  WealthBackupSnapshotMeta,
  WealthMonthlyClosure,
} from '../services/wealthStorage';
import { auth, signOutUser } from '../services/firebase';
import { getFirestoreStatus } from '../services/firestoreStatus';

const CLOSING_CONFIG_STORAGE_KEY = 'aurum.closing.config.v1';
const CLOSURE_REVIEW_PENDING_STORAGE_KEY = 'aurum.closure.review.pending.v1';
const HIDE_SENSITIVE_AMOUNTS_PREF_KEY = 'aurum.hide-sensitive-amounts.v1';
const HIDE_SENSITIVE_AMOUNTS_UPDATED_EVENT = 'aurum:hide-sensitive-amounts-updated';

interface ClosureReviewPendingEntry {
  status: 'complete' | 'pending';
  source: ClosureReviewSource;
  reviewedAt: string;
}

type ClosureReviewPendingMap = Record<string, ClosureReviewPendingEntry>;
type SettingsSectionKey =
  | 'quick'
  | 'fx'
  | 'rules'
  | 'instruments'
  | 'sync'
  | 'backup'
  | 'danger'
  | 'lab';
type CsvImportMode = 'detailed' | 'aggregated';

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

type PreflightStatus = 'ok' | 'warn' | 'error';

type PreflightCheckResult = {
  key: string;
  title: string;
  status: PreflightStatus;
  details: string;
  resolution: string;
};

type BackupDecisionState = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
};

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

const readHideSensitiveAmountsEnabled = () => {
  try {
    return window.localStorage.getItem(HIDE_SENSITIVE_AMOUNTS_PREF_KEY) === '1';
  } catch {
    return false;
  }
};

const monthAfterKey = (monthKey: string) => {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const calendarMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const deriveOperationalMonthKeyFromClosures = (
  closures: WealthMonthlyClosure[],
  calendarMonth: string,
) => {
  const ordered = [...closures].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const latest = ordered[0] || null;
  if (!latest?.monthKey) return calendarMonth;
  const monthSet = new Set(ordered.map((closure) => closure.monthKey));
  let candidate = monthAfterKey(latest.monthKey) || calendarMonth;
  let guard = 0;
  while (monthSet.has(candidate) && guard < 24) {
    candidate = monthAfterKey(candidate) || candidate;
    guard += 1;
  }
  return candidate;
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
  const [backupDecisionState, setBackupDecisionState] = useState<BackupDecisionState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Continuar',
  });
  const [availableClosures, setAvailableClosures] = useState(() =>
    loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
  );
  const [selectedClosureToDelete, setSelectedClosureToDelete] = useState('');
  const [deleteClosureMessage, setDeleteClosureMessage] = useState('');
  const [deletingClosure, setDeletingClosure] = useState(false);
  const [allRecords, setAllRecords] = useState(() => loadWealthRecords());
  const [checklistMonthKey, setChecklistMonthKey] = useState(() =>
    deriveOperationalMonthKeyFromClosures(loadClosures(), currentMonthKey()),
  );
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
  const [repairingMarch2025, setRepairingMarch2025] = useState(false);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [preflightResults, setPreflightResults] = useState<PreflightCheckResult[]>([]);
  const [preflightSummaryMessage, setPreflightSummaryMessage] = useState('');
  const [loadingBackupSnapshots, setLoadingBackupSnapshots] = useState(false);
  const [backupSnapshots, setBackupSnapshots] = useState<WealthBackupSnapshotMeta[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState('');
  const [restoreBackupBusy, setRestoreBackupBusy] = useState(false);
  const [restoreBackupConfirmOpen, setRestoreBackupConfirmOpen] = useState(false);
  const [csvConfirmOpen, setCsvConfirmOpen] = useState(false);
  const [csvImportMode, setCsvImportMode] = useState<CsvImportMode>('detailed');
  const [deleteClosureConfirmOpen, setDeleteClosureConfirmOpen] = useState(false);
  const [deleteAllClosuresConfirmOpen, setDeleteAllClosuresConfirmOpen] = useState(false);
  const [deleteBlocksConfirmOpen, setDeleteBlocksConfirmOpen] = useState(false);
  const [fxFallbackDecisionOpen, setFxFallbackDecisionOpen] = useState(false);
  const [fxFallbackSavedText, setFxFallbackSavedText] = useState('');
  const [openSection, setOpenSection] = useState<SettingsSectionKey | null>('quick');
  const [hideSensitiveAmountsEnabled, setHideSensitiveAmountsEnabled] = useState(() =>
    readHideSensitiveAmountsEnabled(),
  );
  const syncSectionRef = useRef<HTMLDivElement | null>(null);
  const csvImportSectionRef = useRef<HTMLDivElement | null>(null);
  const hydrationRunningRef = useRef(false);
  const lastHydrateAtRef = useRef(0);
  const pendingUnsafeBackupActionRef = useRef<null | (() => Promise<void> | void)>(null);

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
    const month = currentMonthKey();
    const invalid = [
      validateFxRange('usd_clp', usdClp),
      validateFxRange('eur_usd', eurUsd),
      validateFxRange('uf_clp', ufClp),
      validateFxRange('eur_clp', eurClp),
    ].find((result) => !!result);
    if (invalid) {
      console.error('[Settings][fx-range-error]', {
        monthKey: month,
        field: invalid.field,
        value: invalid.value,
        min: invalid.min,
        max: invalid.max,
      });
      setFxLiveMessage(
        `Valor fuera de rango esperado. Campo: ${invalid.field}, valor: ${invalid.value}, mes: ${month}. Verifica formato.`,
      );
      syncDraftFromFx(fx);
      return;
    }
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
2026-01,2026-01-31T23:59:59-03:00,857.56,930.25,39762.28,,,,,,,,,,,,,,,,,`;

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
  const monthRecords = useMemo(
    () => allRecords.filter((record) => String(record.snapshotDate || '').startsWith(`${checklistMonthKey}-`)),
    [allRecords, checklistMonthKey],
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
    const closuresNow = loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    const nextChecklistMonthKey = deriveOperationalMonthKeyFromClosures(closuresNow, currentMonthKey());
    console.info('[Settings][checklist-month-before]', {
      currentChecklistMonthKey: checklistMonthKey,
      closuresCount: closuresNow.length,
      calendarMonthKey: currentMonthKey(),
    });
    console.info('[Settings][checklist-month-after]', {
      nextChecklistMonthKey,
      closuresCount: closuresNow.length,
    });
    if (!/^\d{4}-\d{2}$/.test(nextChecklistMonthKey)) {
      setResetAllMessage('No pude determinar el mes operativo del checklist.');
      return;
    }
    setChecklistMonthKey(nextChecklistMonthKey);
    setFx(loadFxRates());
    setFxLiveMeta(loadFxLiveSyncMeta());
    setAvailableClosures(closuresNow);
    setAllRecords(loadWealthRecords());
    setInvestmentInstruments(loadInvestmentInstruments());
    setFsStatus(getFirestoreStatus());
  };

  const refreshBackupSnapshots = async () => {
    setLoadingBackupSnapshots(true);
    try {
      const snapshots = await listWealthBackupSnapshots(30);
      setBackupSnapshots(snapshots);
      if (!selectedBackupId && snapshots.length > 0) {
        setSelectedBackupId(snapshots[0].id);
      } else if (selectedBackupId && !snapshots.some((item) => item.id === selectedBackupId)) {
        setSelectedBackupId(snapshots[0]?.id || '');
      }
    } finally {
      setLoadingBackupSnapshots(false);
    }
  };

  const backupBeforeDestructiveOperation = async (reason: string) => {
    const before = {
      records: loadWealthRecords().length,
      closures: loadClosures().length,
      instruments: loadInvestmentInstruments().length,
    };
    console.info('[Settings][backup-before][before]', { reason, ...before });
    const backup = await createWealthBackupSnapshot(reason);
    console.info('[Settings][backup-before][after]', {
      reason,
      ok: backup.ok,
      backupId: backup.backupId,
      createdAt: backup.createdAt,
      message: backup.message,
    });
    if (backup.ok && backup.createdAt) {
      setBackupMessage(
        `Backup generado el ${formatDateTime(backup.createdAt)}. Puedes restaurarlo desde Ajustes → Respaldo.`,
      );
      await refreshBackupSnapshots();
      return backup;
    }
    setBackupMessage(`No pude generar backup automático: ${backup.message}`);
    return backup;
  };

  const buildVisibleBackupExportPayload = () => ({
    exportedAt: new Date().toISOString(),
    wealth: {
      records: loadWealthRecords(),
      closures: loadClosures(),
      investmentInstruments: loadInvestmentInstruments(),
      fxRates: loadFxRates(),
      fxMeta: loadFxLiveSyncMeta(),
    },
  });

  const runDestructiveActionWithBackupGuard = async (input: {
    backupReason: string;
    actionLabel: string;
    onProceed: () => Promise<void> | void;
  }) => {
    const backup = await backupBeforeDestructiveOperation(input.backupReason);
    if (backup.ok) {
      await input.onProceed();
      return;
    }

    pendingUnsafeBackupActionRef.current = input.onProceed;
    setBackupDecisionState({
      open: true,
      title: 'No pude generar respaldo previo',
      message:
        `Iba a ${input.actionLabel}, pero el respaldo automático falló. ` +
        'Si continúas ahora, la operación se ejecutará sin respaldo garantizado y podría ser irreversible.',
      confirmText: 'Continuar sin respaldo',
    });
    setBackupMessage(
      `No pude generar backup automático. La operación quedó detenida hasta que confirmes continuar sin respaldo.`,
    );
  };

  const runPreflightCheckNow = async () => {
    setRunningPreflight(true);
    setPreflightSummaryMessage('');
    setPreflightResults([]);
    try {
      const localFx = loadFxRates();
      const localClosures = loadClosures();
      const localRecords = loadWealthRecords();
      const homeMonthKey = currentMonthKey();
      const expectedOperationalMonth = deriveOperationalMonthKeyFromClosures(localClosures, calendarMonthKey());

      const checks: PreflightCheckResult[] = [];

      const fxOk = localFx.usdClp > 0 && localFx.eurClp > 0 && localFx.ufClp > 0;
      checks.push({
        key: 'fx',
        title: 'Tipos de cambio',
        status: fxOk ? 'ok' : 'error',
        details: fxOk
          ? `USD/CLP ${formatFxInteger(localFx.usdClp)} · EUR/CLP ${formatFxInteger(localFx.eurClp)} · UF/CLP ${formatFxInteger(localFx.ufClp)}`
          : 'Uno o más tipos de cambio son 0 o inválidos.',
        resolution: fxOk
          ? 'Sin acción.'
          : 'Completa USD/CLP, EUR/CLP y UF/CLP en la sección "Tipos de cambio".',
      });

      const operationalOk = expectedOperationalMonth === homeMonthKey && checklistMonthKey === homeMonthKey;
      checks.push({
        key: 'operational-month',
        title: 'Mes operativo',
        status: operationalOk ? 'ok' : 'error',
        details: `Home: ${homeMonthKey} · Settings: ${checklistMonthKey} · Esperado: ${expectedOperationalMonth}`,
        resolution: operationalOk
          ? 'Sin acción.'
          : 'Pulsa "Sincronizar ahora" y vuelve a entrar a Ajustes para refrescar el mes operativo.',
      });

      const closureCounts = new Map<string, number>();
      localClosures.forEach((closure) => {
        closureCounts.set(closure.monthKey, (closureCounts.get(closure.monthKey) || 0) + 1);
      });
      const duplicateClosureMonths = Array.from(closureCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([month]) => month)
        .sort();
      checks.push({
        key: 'duplicate-closures',
        title: 'Cierres duplicados por mes',
        status: duplicateClosureMonths.length ? 'error' : 'ok',
        details: duplicateClosureMonths.length
          ? `Duplicados detectados: ${duplicateClosureMonths.join(', ')}`
          : 'Sin duplicados por month_key.',
        resolution: duplicateClosureMonths.length
          ? 'Revisa y elimina duplicados en "Zona de peligro" o reimporta el mes correcto.'
          : 'Sin acción.',
      });

      const expectedMonthSet = new Set<string>([homeMonthKey, ...localClosures.map((closure) => closure.monthKey)]);
      const outOfExpectedMonth = localRecords
        .filter((record) => !expectedMonthSet.has(String(record.snapshotDate || '').slice(0, 7)))
        .map((record) => `${record.snapshotDate} · ${record.label}`);
      checks.push({
        key: 'snapshot-month',
        title: 'snapshotDate fuera del mes esperado',
        status: outOfExpectedMonth.length ? 'warn' : 'ok',
        details: outOfExpectedMonth.length
          ? `${outOfExpectedMonth.length} registro(s) fuera del set esperado (${Array.from(expectedMonthSet).join(', ')})`
          : 'Todos los registros están en meses esperados.',
        resolution: outOfExpectedMonth.length
          ? 'Revisa mes visual antes de guardar o corrige esos registros desde Patrimonio.'
          : 'Sin acción.',
      });

      const cloudSummary = await loadCloudClosuresSummary();
      if (!cloudSummary.available) {
        checks.push({
          key: 'local-vs-cloud',
          title: 'Consistencia local vs nube',
          status: 'warn',
          details: `No disponible: ${cloudSummary.message}`,
          resolution: 'Inicia sesión y ejecuta "Sincronizar ahora".',
        });
      } else {
        const localMonths = localClosures.map((closure) => closure.monthKey).sort();
        const cloudMonths = cloudSummary.monthKeys.sort();
        const same =
          localMonths.length === cloudMonths.length &&
          localMonths.every((month, index) => month === cloudMonths[index]);
        checks.push({
          key: 'local-vs-cloud',
          title: 'Consistencia local vs nube',
          status: same ? 'ok' : 'error',
          details: same
            ? `Meses coinciden (${localMonths.length}).`
            : `Local: [${localMonths.join(', ')}] · Nube: [${cloudMonths.join(', ')}]`,
          resolution: same ? 'Sin acción.' : 'Ejecuta "Sincronizar ahora" y vuelve a verificar.',
        });
      }

      setPreflightResults(checks);
      const errorCount = checks.filter((item) => item.status === 'error').length;
      const warnCount = checks.filter((item) => item.status === 'warn').length;
      if (errorCount) {
        setPreflightSummaryMessage(`Pre-flight finalizado con ${errorCount} error(es) y ${warnCount} advertencia(s).`);
      } else if (warnCount) {
        setPreflightSummaryMessage(`Pre-flight finalizado con ${warnCount} advertencia(s).`);
      } else {
        setPreflightSummaryMessage('Pre-flight finalizado: sistema OK.');
      }
    } catch (err: any) {
      setPreflightSummaryMessage(`No pude ejecutar pre-flight: ${String(err?.message || err || 'error')}`);
    } finally {
      setRunningPreflight(false);
    }
  };

  const restoreSelectedBackupNow = async () => {
    if (!selectedBackupId) return;
    setRestoreBackupConfirmOpen(false);
    setRestoreBackupBusy(true);
    try {
      const before = {
        records: loadWealthRecords().length,
        closures: loadClosures().length,
      };
      console.info('[Settings][restore-backup][before]', { selectedBackupId, ...before });
      const result = await restoreWealthFromBackupSnapshot(selectedBackupId);
      refreshLocalState();
      const after = {
        records: loadWealthRecords().length,
        closures: loadClosures().length,
      };
      console.info('[Settings][restore-backup][after]', { selectedBackupId, ...after, ok: result.ok });
      setBackupMessage(result.ok ? 'Backup restaurado correctamente.' : `No pude restaurar backup: ${result.message}`);
      await refreshBackupSnapshots();
    } finally {
      setRestoreBackupBusy(false);
    }
  };

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

  useEffect(() => {
    if (openSection !== 'backup') return;
    void refreshBackupSnapshots();
  }, [openSection]);

  const scrollToSettingsElement = (element: HTMLElement | null) => {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToCsvImportSection = () => {
    setOpenSection('backup');
    window.setTimeout(() => {
      scrollToSettingsElement(csvImportSectionRef.current);
    }, 120);
  };

  const goToFxSection = () => {
    setOpenSection('fx');
    scrollToSettingsElement(syncSectionRef.current);
  };

  const toggleSection = (key: SettingsSectionKey) => {
    setOpenSection((prev) => (prev === key ? null : key));
  };

  const onToggleHideSensitiveAmounts = (enabled: boolean) => {
    try {
      window.localStorage.setItem(HIDE_SENSITIVE_AMOUNTS_PREF_KEY, enabled ? '1' : '0');
      setHideSensitiveAmountsEnabled(enabled);
      window.dispatchEvent(new Event(HIDE_SENSITIVE_AMOUNTS_UPDATED_EVENT));
    } catch {
      setResetAllMessage('No pude guardar la preferencia de ocultar montos.');
    }
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
    const monthKey = currentMonthKey();

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
      const beforeCount = loadClosures().length;
      console.info('[Settings][csv-import][before]', {
        mode: csvImportMode,
        beforeClosures: beforeCount,
        detectedFormat: csvPreview.format,
      });
      const result =
        csvImportMode === 'aggregated'
          ? await importHistoricalAggregatedClosuresFromCsv(csvDraft)
          : await importHistoricalClosuresFromCsv(csvDraft);
      const summary = [
        result.importedMonths.length ? `Importados: ${result.importedMonths.join(', ')}` : 'Importados: 0',
        result.replacedMonths.length ? `Reemplazados: ${result.replacedMonths.join(', ')}` : 'Reemplazados: 0',
        result.skippedMonths.length ? `Omitidos: ${result.skippedMonths.join(', ')}` : 'Omitidos: 0',
      ].join(' · ');
      setCsvImportMessage(summary);
      setCsvImportWarnings(result.warnings);
      setCsvImportedResultVisible(true);
      refreshLocalState();
      const afterCount = loadClosures().length;
      console.info('[Settings][csv-import][after]', {
        mode: csvImportMode,
        afterClosures: afterCount,
        deltaClosures: afterCount - beforeCount,
        importedMonths: result.importedMonths.length,
        replacedMonths: result.replacedMonths.length,
        skippedMonths: result.skippedMonths.length,
      });
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
    const monthKeyToDelete = selectedClosureToDelete;
    setDeleteClosureConfirmOpen(false);
    setDeletingClosure(true);
    setDeleteClosureMessage('');
    try {
      const beforeLocalMonthKeys = loadClosures().map((closure) => closure.monthKey);
      console.info('[Settings][delete-closure][before]', {
        monthKeyToDelete,
        beforeLocalMonthKeys,
      });
      const current = loadClosures();
      const next = current.filter((closure) => closure.monthKey !== monthKeyToDelete);
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
      const localAfterMonthKeys = loadClosures().map((closure) => closure.monthKey);
      const localDeleted = !localAfterMonthKeys.includes(monthKeyToDelete);
      let cloudDeleted: boolean | null = null;
      let cloudMessage = '';
      try {
        const cloudSummary = await loadCloudClosuresSummary();
        if (cloudSummary.available) {
          cloudDeleted = !cloudSummary.monthKeys.includes(monthKeyToDelete);
          cloudMessage = cloudDeleted ? 'Cierre eliminado en nube' : 'Cierre sigue existiendo en nube';
        } else {
          cloudMessage = cloudSummary.message;
        }
      } catch (err: any) {
        cloudMessage = String(err?.message || 'No pude verificar nube');
      }
      console.info('[Settings][delete-closure][after]', {
        monthKeyToDelete,
        pushed,
        hydrated,
        localAfterMonthKeys,
        localDeleted,
        cloudDeleted,
        cloudMessage,
      });
      setSelectedClosureToDelete('');
      if (!localDeleted || cloudDeleted === false) {
        setDeleteClosureMessage(
          `No pude confirmar el borrado completo de ${monthKeyToDelete}. Local=${localDeleted ? 'OK' : 'ERROR'} · Nube=${cloudDeleted === null ? 'sin validar' : cloudDeleted ? 'OK' : 'ERROR'}.`,
        );
        return;
      }
      setDeleteClosureMessage(`Cierre ${monthKeyToDelete} eliminado. ${describeLocalThenCloudSync(pushed, hydrated)}.`);
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
      let removedBankAndDebt = 0;
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
        if (
          deleteBlocksDraft.bank &&
          (record.block === 'bank' || isNonMortgageDebtRecord(record))
        ) {
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

      const removableRecords = recordsAfterRealEstate.filter((record) => removeById.has(record.id));
      removeById.forEach((id) => removeWealthRecord(id));
      if (removeById.size) {
        removedRecords += removeById.size;
        removedBankAndDebt += removableRecords.filter(
          (record) => record.block === 'bank' || isNonMortgageDebtRecord(record),
        ).length;
        removedInvestment += removableRecords.filter((record) => record.block === 'investment').length;
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
          ? `Bloques limpiados: ${removedRecords} registros (${removedBankAndDebt} bancos/deudas no hipotecarias, ${removedInvestment} inversiones, ${removedRealEstate} bienes raíces/hipoteca). ${describeLocalThenCloudSync(pushed, hydrated)}.`
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
      console.info('[seed-demo] estado antes de reset', {
        records: loadWealthRecords().length,
        closures: loadClosures().map((c) => c.monthKey),
        instruments: loadInvestmentInstruments().length,
        has2025: loadWealthRecords().some((record) => record.snapshotDate.startsWith('2025-')),
      });
      await clearWealthDataForFreshStart({ preserveFx: false });
      const recordsAfterReset = loadWealthRecords();
      const closuresAfterReset = loadClosures();
      const instrumentsAfterReset = loadInvestmentInstruments();
      if (recordsAfterReset.length || closuresAfterReset.length || instrumentsAfterReset.length) {
        throw new Error('Reset incompleto: aún existen datos locales después del borrado.');
      }
      console.info('[seed-demo] estado después de reset', {
        records: recordsAfterReset.length,
        closures: closuresAfterReset.length,
        instruments: instrumentsAfterReset.length,
      });
      seedDemoWealthTimeline();

      const hasAuth = Boolean(auth.currentUser?.uid);
      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      if (hasAuth) {
        try {
          pushed = await syncWealthNow();
        } catch {
          pushed = false;
        }
        try {
          hydrated = pushed ? await hydrateWealthFromCloud() : 'none';
        } catch {
          hydrated = 'none';
        }
      }

      const closuresAfterSeed = loadClosures().map((closure) => closure.monthKey).sort();
      const currentMonth = currentMonthKey();
      const currentMonthRecords = loadWealthRecords().filter((record) =>
        record.snapshotDate.startsWith(`${currentMonth}-`),
      );
      const has2025Data = loadWealthRecords().some((record) => record.snapshotDate.startsWith('2025-'));
      const hasMarch2026Closure = closuresAfterSeed.includes('2026-03');
      const expectedClosures =
        closuresAfterSeed.length === 2 && closuresAfterSeed.includes('2026-01') && closuresAfterSeed.includes('2026-02');
      if (!expectedClosures) {
        throw new Error(`Seed inválido: cierres esperados [2026-01, 2026-02], recibidos [${closuresAfterSeed.join(', ')}].`);
      }
      if (has2025Data) {
        throw new Error('Seed inválido: quedaron registros 2025 después de cargar demo.');
      }
      if (hasMarch2026Closure) {
        throw new Error('Seed inválido: existe cierre 2026-03 y no debería existir.');
      }

      console.info('[seed-demo] verificación post-seed', {
        closures: closuresAfterSeed,
        currentMonthKey: currentMonth,
        currentMonthRecordsCount: currentMonthRecords.length,
        has2025Data,
        hasMarch2026Closure,
        syncImmediate: pushed,
        hydratedFromCloud: hydrated,
      });
      refreshLocalState();
      if (!hasAuth) {
        setSeedDemoMessage('Debes estar autenticado para realizar esta operación en la nube. Datos cargados solo en local.');
        return;
      }
      if (!pushed || hydrated === 'unavailable' || hydrated === 'none') {
        setSeedDemoMessage('Datos de prueba cargados en local. No se pudo confirmar sincronización en la nube.');
        return;
      }
      setSeedDemoMessage('Datos de prueba cargados y sincronizados. Abriendo Patrimonio...');
      window.setTimeout(() => {
        window.location.hash = '#/patrimonio';
      }, 120);
    } catch (err: any) {
      setSeedDemoMessage(`No pude cargar datos de prueba: ${String(err?.message || err || 'error')}`);
    } finally {
      setSeedingDemo(false);
    }
  };

  const resetAllDataNow = async () => {
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
      if (result.cloudCleared) {
        setResetAllMessage('Reset completado. Datos limpiados en local y nube.');
      } else if (!auth.currentUser?.uid) {
        setResetAllMessage('Debes estar autenticado para realizar esta operación en la nube. Reset aplicado solo en local.');
      } else {
        const issue = getLastWealthSyncIssue();
        const detail = issue ? ` (${issue})` : '';
        setResetAllMessage(`Reset aplicado solo en local. No se pudo limpiar la nube${detail}.`);
      }
      setResetStepTwoOpen(false);
    } catch (err: any) {
      setResetAllMessage(`Error en reset total: ${String(err?.message || err || 'error')}`);
    } finally {
      setResettingAll(false);
    }
  };

  const repairMarch2025Now = async () => {
    setRepairingMarch2025(true);
    setSeedDemoMessage('');
    try {
      const result = await repairMarch2025EurClpScale();
      refreshLocalState();
      if (result.ok) {
        const gastos = result.gastosClpAfter !== null ? formatCurrency(result.gastosClpAfter, 'CLP') : '—';
        const pct =
          result.pctAfter === null
            ? '—'
            : `${result.pctAfter >= 0 ? '+' : ''}${result.pctAfter.toFixed(2).replace('.', ',')}%`;
        setSeedDemoMessage(
          `Reparación 2025-03 OK. eur_clp: ${result.beforeEurClp} → ${result.afterEurClp}. Gastos: ${gastos}. %: ${pct}.`,
        );
      } else {
        setSeedDemoMessage(result.message);
      }
    } catch (err: any) {
      setSeedDemoMessage(`Error al reparar 2025-03: ${String(err?.message || err || 'error')}`);
    } finally {
      setRepairingMarch2025(false);
    }
  };

  return (
    <div className="p-4 pb-32 space-y-2">
      {(!!resetAllMessage || !!closureReviewMessage || !!closingConfigMessage) && (
        <Card className="border border-slate-200 bg-white p-2.5 space-y-1">
          {!!resetAllMessage && <div className="text-xs text-slate-700">{resetAllMessage}</div>}
          {!!closureReviewMessage && <div className="text-xs text-slate-700">{closureReviewMessage}</div>}
          {!!closingConfigMessage && <div className="text-xs text-slate-700">{closingConfigMessage}</div>}
        </Card>
      )}

      <Card className="border border-slate-200 bg-white p-3">
        <button
          type="button"
          className="w-full flex items-center justify-between text-left"
          onClick={() => toggleSection('quick')}
        >
          <div>
            <div className="text-sm font-semibold text-slate-900">Estado rápido</div>
            <div className="text-[11px] text-slate-500">Historial y mes actual</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'quick' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'quick' && (
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">Historial</span>
                <span>{historicalStatus.icon}</span>
              </div>
              <div className="mt-1">Cierres: <span className="font-semibold">{availableClosures.length}</span> · {historicalStatus.text}</div>
              {!!historicalPendingMonthKeys.length && (
                <div className="mt-1 text-amber-700">Pendientes: {historicalPendingMonthKeys.join(', ')}</div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={goToCsvImportSection}>Ir a importación</Button>
                <Button variant="outline" size="sm" onClick={openManualClosureReview} disabled={!availableClosures.length}>
                  {historicalPendingMonthKeys.length ? `Revisar pendientes (${historicalPendingMonthKeys.length})` : 'Revisar cierre'}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <div className="text-xs text-slate-600 mb-2">{formatMonthLabel(checklistMonthKey)} · estado por módulo</div>
              <div className="space-y-1.5">
                {monthChecklist.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2"><span>{item.ok ? '✅' : '❌'}</span><span>{item.label}</span></div>
                    {item.key === 'fx' ? (
                      <Button variant="outline" size="sm" onClick={goToFxSection}>Ir a TC</Button>
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
                        Ir a...
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-2">
              <div className="text-xs text-slate-600">Pre-flight antes de cargar datos reales</div>
              <Button variant="outline" size="sm" disabled={runningPreflight} onClick={() => void runPreflightCheckNow()}>
                {runningPreflight ? 'Verificando...' : 'Verificar estado del sistema'}
              </Button>
              {!!preflightSummaryMessage && <div className="text-[11px] text-slate-600">{preflightSummaryMessage}</div>}
              {!!preflightResults.length && (
                <div className="space-y-1.5">
                  {preflightResults.map((item) => (
                    <div key={item.key} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span>{item.status === 'ok' ? '✅' : item.status === 'warn' ? '⚠️' : '❌'}</span>
                        <span className="font-medium text-slate-800">{item.title}</span>
                      </div>
                      <div className="mt-0.5 text-slate-600">{item.details}</div>
                      {item.status !== 'ok' && <div className="mt-0.5 text-slate-700">Cómo resolver: {item.resolution}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <div className="text-xs text-slate-600 mb-2">Preferencias</div>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>Ocultar montos sensibles</span>
                <input
                  type="checkbox"
                  checked={hideSensitiveAmountsEnabled}
                  onChange={(event) => onToggleHideSensitiveAmounts(event.target.checked)}
                />
              </label>
              <div className="mt-1 text-[11px] text-slate-500">
                {hideSensitiveAmountsEnabled
                  ? 'ON: se habilita Ver/Ocultar en Patrimonio.'
                  : 'OFF: montos siempre visibles.'}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="border border-slate-200 bg-white p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('fx')}>
          <div>
            <div className="text-sm font-semibold text-slate-900">Tipos de cambio</div>
            <div className="text-[11px] text-slate-500">TC/UF online y manual</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'fx' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'fx' && (
          <div ref={syncSectionRef} className="mt-3 space-y-2">
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
                  } catch {
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
                {syncingLiveFx ? 'Actualizando...' : 'Actualizar TC/UF'}
              </Button>
            </div>
            {!!fxLiveMeta && (
              <div className={`rounded-lg border px-2.5 py-2 text-xs ${fxLiveMeta.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                Estado: {fxLiveMeta.status === 'ok' ? 'OK' : 'Error'} · {humanizeFxSource(fxLiveMeta.source)} · {formatDateTime(fxLiveMeta.fetchedAt)}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input value={fxDraft.usdClp} type="text" inputMode="decimal" onChange={(e) => setFxDraft((prev) => ({ ...prev, usdClp: e.target.value }))} onBlur={commitDraftFx} placeholder="USD/CLP" />
              <Input value={fxDraft.eurUsd} type="text" inputMode="decimal" onChange={(e) => setFxDraft((prev) => ({ ...prev, eurUsd: e.target.value }))} onBlur={commitDraftFx} placeholder="EUR/USD" />
              <Input value={fxDraft.ufClp} type="text" inputMode="decimal" onChange={(e) => setFxDraft((prev) => ({ ...prev, ufClp: e.target.value }))} onBlur={commitDraftFx} placeholder="UF/CLP" />
            </div>
            <Button variant="outline" onClick={commitDraftFx}>Guardar TC manual</Button>
            {!!fxLiveMessage && <div className="text-xs text-slate-600">{fxLiveMessage}</div>}
          </div>
        )}
      </Card>

      <Card className="border border-slate-200 bg-white p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('rules')}>
          <div>
            <div className="text-sm font-semibold text-slate-900">Reglas de cierre</div>
            <div className="text-[11px] text-slate-500">Campo · ON/OFF · días</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'rules' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'rules' && (
          <div className="mt-3 space-y-1.5">
            {closingConfigRows.map((row) => (
              <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                <div className="truncate">{row.label}</div>
                <label className="inline-flex items-center gap-1">
                  <span>{row.enabled ? 'ON' : 'OFF'}</span>
                  <input type="checkbox" checked={row.enabled} onChange={(event) => onToggleClosingRule(row.key, event.target.checked)} />
                </label>
                {row.supportsMaxAge && row.enabled ? (
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    className="h-7 w-16"
                    value={row.maxAgeDays === null ? '' : String(row.maxAgeDays)}
                    onChange={(event) => onMaxAgeClosingRuleChange(row.key, event.target.value)}
                  />
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border border-amber-200 bg-amber-50/40 p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('instruments')}>
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-slate-900">Gestionar instrumentos</div>
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">⚠️</span>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'instruments' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'instruments' && (
          <div className="mt-3 space-y-1.5">
            {investmentClosingRows.map((row) => (
              <div key={row.key} className="rounded-lg border border-amber-200 bg-white px-2 py-2 text-xs space-y-2">
                <div className="truncate font-medium">{row.label}</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => row.investmentId && setClosingInvestmentCloseTargetId(row.investmentId)}>
                    Cerrar desde este mes
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => row.investmentId && setClosingInvestmentDeleteTargetId(row.investmentId)}>
                    Eliminar completamente
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border border-slate-200 bg-white p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('sync')}>
          <div>
            <div className="text-sm font-semibold text-slate-900">Sincronización</div>
            <div className="text-[11px] text-slate-500">Estado Firestore y sesión</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'sync' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'sync' && (
          <div className="mt-3 space-y-2 text-xs">
            <div className={`rounded-lg border px-2.5 py-2 ${fsStatus.state === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {fsStatus.state === 'ok' ? 'Firestore OK' : 'Firestore con error'} · UID: {authUid || 'Sin UID'}
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
              <Button variant="secondary" onClick={async () => { await signOutUser(); }}>
                Cerrar sesión
              </Button>
            </div>
            {!!syncMessage && <div className="text-xs text-slate-600">{syncMessage}</div>}
            {!!fsDebug && <div className="text-xs text-slate-500 break-words">{fsDebug}</div>}
          </div>
        )}
      </Card>

      <Card className="border border-slate-200 bg-white p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('backup')}>
          <div>
            <div className="text-sm font-semibold text-slate-900">Respaldo e importación</div>
            <div className="text-[11px] text-slate-500">JSON + CSV</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'backup' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'backup' && (
          <div ref={csvImportSectionRef} className="mt-3 space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    const now = new Date();
                    const pad = (v: number) => String(v).padStart(2, '0');
                    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
                    const payload = buildVisibleBackupExportPayload();
                    const filename = `aurum_backup_${stamp}.json`;
                    downloadTextFile(JSON.stringify(payload, null, 2), filename, 'application/json');
                    setBackupMessage(`Respaldo descargado: ${filename} (sin tokens bancarios ni datos de sesión).`);
                  } catch (err: any) {
                    setBackupMessage(`No pude generar respaldo: ${String(err?.message || err || 'error')}`);
                  }
                }}
              >
                Descargar respaldo JSON
              </Button>
              <Button variant="secondary" onClick={() => { void copyCsvFormatToClipboard(); }}>
                Copiar formato CSV
              </Button>
              <Button variant="outline" onClick={() => void refreshBackupSnapshots()} disabled={loadingBackupSnapshots}>
                {loadingBackupSnapshots ? 'Cargando backups...' : 'Cargar backups nube'}
              </Button>
            </div>
            {!!backupMessage && <div className="text-slate-600">{backupMessage}</div>}
            {!!csvTemplateCopyMessage && <div className="text-slate-600">{csvTemplateCopyMessage}</div>}
            {!!backupSnapshots.length && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-2">
                <div className="text-[11px] text-slate-600">Backups disponibles en la nube</div>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={selectedBackupId}
                  onChange={(event) => setSelectedBackupId(event.target.value)}
                >
                  {backupSnapshots.map((backup) => (
                    <option key={backup.id} value={backup.id}>
                      {formatDateTime(backup.createdAt)} · {backup.reason} · {backup.closuresCount} cierres
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={!selectedBackupId || restoreBackupBusy}
                    onClick={() => setRestoreBackupConfirmOpen(true)}
                  >
                    {restoreBackupBusy ? 'Restaurando...' : 'Restaurar backup'}
                  </Button>
                </div>
              </div>
            )}
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
            <textarea
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              rows={6}
              placeholder="Pega aquí tu CSV histórico..."
              value={csvDraft}
              onChange={(e) => {
                setCsvImportedResultVisible(false);
                setCsvDraft(e.target.value);
              }}
            />
            <div className="text-[11px] text-slate-500">
              Usa <span className="font-semibold">Importar CSV detallado</span> para cierres con instrumentos.
              Usa <span className="font-semibold">Importar historial agregado</span> para cierres históricos sin detalle por instrumento.
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
                  if (csvPreview.format === 'aggregated') {
                    setCsvImportMessage('Este archivo es histórico agregado. Usa el botón "Importar historial agregado".');
                    setCsvImportWarnings(csvPreview.warnings);
                    setCsvImportedResultVisible(true);
                    return;
                  }
                  setCsvImportMode('detailed');
                  setCsvConfirmOpen(true);
                }}
              >
                {csvImporting && csvImportMode === 'detailed' ? 'Importando...' : 'Importar CSV detallado'}
              </Button>
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
                  if (csvPreview.format !== 'aggregated') {
                    setCsvImportMessage('Este archivo no corresponde a historial agregado (falta inv_fin_clp).');
                    setCsvImportWarnings(csvPreview.warnings);
                    setCsvImportedResultVisible(true);
                    return;
                  }
                  setCsvImportMode('aggregated');
                  setCsvConfirmOpen(true);
                }}
              >
                {csvImporting && csvImportMode === 'aggregated' ? 'Importando...' : 'Importar historial agregado'}
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
                Limpiar
              </Button>
            </div>
            {!!csvImportMessage && <div className="text-slate-700">{csvImportMessage}</div>}
            {!!csvImportWarnings.length && csvImportedResultVisible && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                <div className="font-medium">Advertencias</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {csvImportWarnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="border border-red-200 bg-red-50/40 p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('danger')}>
          <div>
            <div className="text-sm font-semibold text-red-900">Zona de peligro 🔴</div>
            <div className="text-[11px] text-red-700">Acciones destructivas</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-red-500 transition-transform ${openSection === 'danger' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'danger' && (
          <div className="mt-3 space-y-3 text-xs">
            <div className="rounded-lg border border-red-200 bg-white px-2.5 py-2 space-y-2">
              <div className="font-medium text-red-800">Reset total</div>
              <Button variant="danger" onClick={() => setResetAllOpen(true)} disabled={resettingAll}>Resetear todos los datos</Button>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 space-y-2">
              <div className="font-medium text-amber-800">Borrar cierre específico</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={selectedClosureToDelete}
                  onChange={(event) => setSelectedClosureToDelete(event.target.value)}
                >
                  <option value="">Selecciona mes...</option>
                  {availableClosures.map((closure) => (
                    <option key={closure.id} value={closure.monthKey}>{formatMonthLabel(closure.monthKey)} ({closure.monthKey})</option>
                  ))}
                </select>
                <Button variant="danger" disabled={deletingClosure || !selectedClosureToDelete} onClick={() => setDeleteClosureConfirmOpen(true)}>
                  {deletingClosure ? 'Borrando...' : 'Borrar cierre'}
                </Button>
              </div>
              <Button variant="outline" disabled={deletingClosure || !availableClosures.length} onClick={() => setDeleteAllClosuresConfirmOpen(true)}>
                Borrar todos los cierres
              </Button>
              {!!deleteClosureMessage && <div className="text-slate-700">{deleteClosureMessage}</div>}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-2">
              <div className="font-medium text-slate-800">Borrar bloques del mes actual</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={deleteBlocksDraft.bank} onChange={(event) => setDeleteBlocksDraft((prev) => ({ ...prev, bank: event.target.checked }))} />Bancos</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={deleteBlocksDraft.investment} onChange={(event) => setDeleteBlocksDraft((prev) => ({ ...prev, investment: event.target.checked }))} />Inversiones</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={deleteBlocksDraft.risk} onChange={(event) => setDeleteBlocksDraft((prev) => ({ ...prev, risk: event.target.checked }))} />Capital de riesgo</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={deleteBlocksDraft.realEstate} onChange={(event) => setDeleteBlocksDraft((prev) => ({ ...prev, realEstate: event.target.checked }))} />Propiedad + hipoteca</label>
              </div>
              <Button variant="danger" disabled={deletingBlocks || selectedDeleteBlocks === 0} onClick={() => setDeleteBlocksConfirmOpen(true)}>
                {deletingBlocks ? 'Borrando...' : 'Borrar bloques seleccionados'}
              </Button>
              {!!deleteBlocksMessage && <div className="text-slate-700">{deleteBlocksMessage}</div>}
            </div>
          </div>
        )}
      </Card>

      <Card className="border border-indigo-200 bg-indigo-50/40 p-3">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => toggleSection('lab')}>
          <div>
            <div className="text-sm font-semibold text-slate-900">Laboratorio</div>
            <div className="text-[11px] text-slate-500">Herramientas de prueba</div>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${openSection === 'lab' ? 'rotate-180' : ''}`} />
        </button>
        {openSection === 'lab' && (
          <div className="mt-3 space-y-2 text-xs">
            <Button
              variant="secondary"
              disabled={seedingDemo}
              onClick={() =>
                void runDestructiveActionWithBackupGuard({
                  backupReason: 'Cargar datos de prueba',
                  actionLabel: 'reemplazar los datos actuales por datos de prueba',
                  onProceed: loadDemoDataNow,
                })
              }
            >
              {seedingDemo ? 'Cargando datos de prueba...' : 'Cargar datos de prueba'}
            </Button>
            <Button
              variant="outline"
              disabled={repairingMarch2025}
              onClick={() =>
                void runDestructiveActionWithBackupGuard({
                  backupReason: 'Reparar EUR/CLP 2025-03',
                  actionLabel: 'corregir el cierre 2025-03',
                  onProceed: repairMarch2025Now,
                })
              }
            >
              {repairingMarch2025 ? 'Reparando 2025-03...' : 'Reparar EUR/CLP 2025-03'}
            </Button>
            {!!seedDemoMessage && <div className="text-indigo-800">{seedDemoMessage}</div>}
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
        message="Esto borrará todos tus datos. Antes de continuar, intentaré generar un respaldo en la nube; si falla, te pediré una confirmación adicional para seguir sin respaldo."
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
        onConfirm={() => {
          setResetStepTwoOpen(false);
          void runDestructiveActionWithBackupGuard({
            backupReason: 'Reset total de datos',
            actionLabel: 'borrar todos los datos de la app',
            onProceed: resetAllDataNow,
          });
        }}
      />

      <ConfirmActionModal
        open={backupDecisionState.open}
        tone="danger"
        title={backupDecisionState.title}
        message={backupDecisionState.message}
        confirmText={backupDecisionState.confirmText}
        cancelText="Cancelar"
        onCancel={() => {
          pendingUnsafeBackupActionRef.current = null;
          setBackupDecisionState((prev) => ({ ...prev, open: false }));
        }}
        onConfirm={() => {
          const action = pendingUnsafeBackupActionRef.current;
          pendingUnsafeBackupActionRef.current = null;
          setBackupDecisionState((prev) => ({ ...prev, open: false }));
          if (action) void action();
        }}
      />

      <ConfirmActionModal
        open={csvConfirmOpen}
        busy={csvImporting}
        title={
          csvImportMode === 'aggregated'
            ? 'Confirmar importación de historial agregado'
            : 'Confirmar importación CSV detallado'
        }
        message={
          csvImportMode === 'aggregated'
            ? `Se importará/reemplazará ${
                csvPreview.monthKeys.length === 1
                  ? `el mes ${csvPreview.monthKeys[0]}`
                  : `${csvPreview.monthKeys.length} meses (${csvPreview.monthKeys.join(', ')})`
              } como cierres históricos sin detalle por instrumento. Antes de continuar, intentaré generar un respaldo.`
            : `Se importará/reemplazará ${
                csvPreview.monthKeys.length === 1
                  ? `el mes ${csvPreview.monthKeys[0]}`
                  : `${csvPreview.monthKeys.length} meses (${csvPreview.monthKeys.join(', ')})`
              } según month_key. Antes de continuar, intentaré generar un respaldo.`
        }
        confirmText="Importar ahora"
        cancelText="Cancelar"
        onCancel={() => setCsvConfirmOpen(false)}
        onConfirm={() => {
          setCsvConfirmOpen(false);
          void runDestructiveActionWithBackupGuard({
            backupReason: 'Import masivo de CSV histórico',
            actionLabel: 'importar o reemplazar cierres históricos',
            onProceed: importCsvNow,
          });
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
            ? `Vas a borrar el cierre ${selectedClosureToDelete}. Esta acción no borra registros del mes. Antes de continuar, intentaré generar un respaldo.`
            : 'Selecciona un cierre antes de continuar.'
        }
        confirmText="Borrar cierre"
        cancelText="Cancelar"
        onCancel={() => setDeleteClosureConfirmOpen(false)}
        onConfirm={() => {
          setDeleteClosureConfirmOpen(false);
          void runDestructiveActionWithBackupGuard({
            backupReason: `Borrar cierre ${selectedClosureToDelete}`,
            actionLabel: `borrar el cierre ${selectedClosureToDelete}`,
            onProceed: deleteSelectedClosureNow,
          });
        }}
      />

      <ConfirmActionModal
        open={deleteAllClosuresConfirmOpen}
        tone="danger"
        busy={deletingClosure}
        title="Confirmar borrado total de cierres"
        message={`Se eliminarán todos los cierres guardados (${availableClosures.length}). No borra registros mensuales. Antes de continuar, intentaré generar un respaldo.`}
        confirmText="Borrar todos los cierres"
        cancelText="Cancelar"
        onCancel={() => setDeleteAllClosuresConfirmOpen(false)}
        onConfirm={() => {
          setDeleteAllClosuresConfirmOpen(false);
          void runDestructiveActionWithBackupGuard({
            backupReason: 'Borrar todos los cierres',
            actionLabel: 'borrar todos los cierres',
            onProceed: deleteAllClosuresNow,
          });
        }}
      />

      <ConfirmActionModal
        open={deleteBlocksConfirmOpen}
        tone="danger"
        busy={deletingBlocks}
        title="Confirmar borrado de bloques"
        message="Se eliminarán los bloques seleccionados del mes actual. Antes de continuar, intentaré generar un respaldo. Esta acción no se puede deshacer."
        confirmText="Borrar bloques"
        cancelText="Cancelar"
        onCancel={() => setDeleteBlocksConfirmOpen(false)}
        onConfirm={() => {
          setDeleteBlocksConfirmOpen(false);
          void runDestructiveActionWithBackupGuard({
            backupReason: 'Borrar bloques del mes actual',
            actionLabel: 'borrar bloques del mes actual',
            onProceed: deleteSelectedBlocksNow,
          });
        }}
      />

      <ConfirmActionModal
        open={restoreBackupConfirmOpen}
        busy={restoreBackupBusy}
        title="Restaurar backup"
        message="Se reemplazarán los datos locales por el backup seleccionado y se sincronizarán con la nube. Antes de continuar, intentaré generar un respaldo del estado actual."
        confirmText="Restaurar ahora"
        cancelText="Cancelar"
        onCancel={() => {
          if (restoreBackupBusy) return;
          setRestoreBackupConfirmOpen(false);
        }}
        onConfirm={() => {
          setRestoreBackupConfirmOpen(false);
          void runDestructiveActionWithBackupGuard({
            backupReason: `Restaurar backup ${selectedBackupId || 'seleccionado'}`,
            actionLabel: 'reemplazar tus datos actuales por el backup seleccionado',
            onProceed: restoreSelectedBackupNow,
          });
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
            ? 'Se eliminará esta inversión de registros e historial de cierres con detalle. Antes de continuar, intentaré generar un respaldo. Esta acción impacta períodos anteriores y no se puede deshacer.'
            : ''
        }
        confirmText="Eliminar completamente"
        cancelText="Cancelar"
        onCancel={() => {
          if (closingInvestmentActionBusy) return;
          setClosingInvestmentDeleteTargetId(null);
        }}
        onConfirm={() => {
          setClosingInvestmentDeleteTargetId(null);
          void runDestructiveActionWithBackupGuard({
            backupReason: 'Eliminar inversión completamente',
            actionLabel: 'eliminar una inversión del historial con detalle',
            onProceed: deleteInvestmentCompletelyNow,
          });
        }}
      />
    </div>
  );
};
