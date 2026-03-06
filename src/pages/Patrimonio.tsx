import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  FileScan,
  Home,
  Landmark,
  Pencil,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { Button, Card, Input, Select } from '../components/Components';
import { runOcrFromFile } from '../services/ocr';
import { parseWealthFromOcrText, ParsedWealthSuggestion } from '../services/wealthParsers';
import { FintocAccountNormalized, discoverFintocData, FintocDiscoverResponse } from '../services/bankApi';
import {
  WealthBlock,
  WealthCurrency,
  WealthInvestmentInstrument,
  WealthMonthlyClosure,
  WealthRecord,
  createMonthlyClosure,
  currentMonthKey,
  applyMortgageAutoCalculation,
  buildWealthNetBreakdown,
  FX_RATES_UPDATED_EVENT,
  isSyntheticAggregateRecord,
  WEALTH_DATA_UPDATED_EVENT,
  fillMissingWithPreviousClosure,
  hydrateWealthFromCloud,
  ensureInitialMortgageDefaults,
  latestRecordsForMonth,
  localYmd,
  loadClosures,
  loadFxRates,
  loadBankTokens,
  loadInvestmentInstruments,
  loadWealthRecords,
  removeWealthRecordForMonthAsset,
  saveBankTokens,
  saveWealthRecords,
  setInvestmentInstrumentMonthExcluded,
  summarizeWealth,
  upsertInvestmentInstrument,
  upsertWealthRecord,
} from '../services/wealthStorage';

type MainSection = 'investment' | 'real_estate' | 'bank';
const PREFERRED_DISPLAY_CURRENCY_KEY = 'aurum.preferred.display.currency';
const NAVIGATE_PATRIMONIO_HOME_EVENT = 'aurum:navigate-patrimonio-home';
const BANKS_LAST_AUTO_SYNC_DAY_KEY = 'aurum:banks:last-auto-sync-day:v1';
const BANKS_LAST_AUTO_ATTEMPT_DAY_KEY = 'aurum:banks:last-auto-attempt-day:v1';

const sectionLabel: Record<MainSection, string> = {
  investment: 'Inversiones',
  real_estate: 'Bienes raíces',
  bank: 'Bancos',
};

const readBanksLastAutoSyncDay = () => {
  try {
    return String(window.localStorage.getItem(BANKS_LAST_AUTO_SYNC_DAY_KEY) || '');
  } catch {
    return '';
  }
};

const writeBanksLastAutoSyncDay = (ymd: string) => {
  try {
    window.localStorage.setItem(BANKS_LAST_AUTO_SYNC_DAY_KEY, ymd);
  } catch {
    // ignore
  }
};

const readBanksLastAutoAttemptDay = () => {
  try {
    return String(window.localStorage.getItem(BANKS_LAST_AUTO_ATTEMPT_DAY_KEY) || '');
  } catch {
    return '';
  }
};

const writeBanksLastAutoAttemptDay = (ymd: string) => {
  try {
    window.localStorage.setItem(BANKS_LAST_AUTO_ATTEMPT_DAY_KEY, ymd);
  } catch {
    // ignore
  }
};

const sourceOptionsBySection: Record<MainSection, Array<{ value: string; label: string }>> = {
  investment: [
    { value: 'auto', label: 'Auto detectar' },
    { value: 'planvital', label: 'PlanVital (AFP)' },
    { value: 'sura_resumen', label: 'SURA resumen' },
    { value: 'sura_detalle', label: 'SURA detalle' },
    { value: 'btg', label: 'BTG' },
    { value: 'wise', label: 'Wise' },
    { value: 'global66', label: 'Global66' },
  ],
  real_estate: [
    { value: 'auto', label: 'Auto detectar' },
    { value: 'dividendo', label: 'Dividendo hipotecario' },
  ],
  bank: [
    { value: 'auto', label: 'Auto detectar' },
    { value: 'banco_clp', label: 'Banco Chile/Scotia/Santander (CLP)' },
    { value: 'banco_usd', label: 'Banco Chile/Scotia/Santander (USD)' },
  ],
};

const currencyOptions = [
  { value: 'CLP', label: 'CLP' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'UF', label: 'UF' },
];

const realEstateBlockOptions = [
  { value: 'real_estate', label: 'Activo inmobiliario' },
  { value: 'debt', label: 'Deuda hipotecaria' },
];

const sectionTheme: Record<MainSection, string> = {
  investment: 'from-orange-200 to-amber-100',
  real_estate: 'from-emerald-200 to-lime-100',
  bank: 'from-sky-200 to-cyan-100',
};

const sectionChecklist: Record<MainSection, string[]> = {
  investment: [
    'SURA inversión financiera',
    'SURA ahorro previsional',
    'PlanVital saldo total',
    'BTG total valorización',
    'Global66 Cuenta Vista USD',
    'Wise Cuenta principal USD',
  ],
  real_estate: [
    'Valor propiedad',
    'Saldo deuda hipotecaria',
    'Dividendo hipotecario mensual',
    'Interés hipotecario mensual',
    'Seguros hipotecarios mensuales',
    'Amortización hipotecaria mensual',
  ],
  bank: ['Saldo bancos CLP', 'Saldo bancos USD'],
};
const REAL_ESTATE_DEBT_LABELS = [
  'Saldo deuda hipotecaria',
  'Dividendo hipotecario mensual',
  'Interés hipotecario mensual',
  'Seguros hipotecarios mensuales',
  'Amortización hipotecaria mensual',
];
const REAL_ESTATE_CORE_NET_LABELS = ['Valor propiedad', 'Saldo deuda hipotecaria'];
type BankProviderId = 'bchile' | 'scotia' | 'santander';

const BANK_PROVIDERS: Array<{ id: BankProviderId; label: string }> = [
  { id: 'bchile', label: 'Banco de Chile' },
  { id: 'scotia', label: 'Scotiabank' },
  { id: 'santander', label: 'Santander' },
];

const FINTOC_SYNC_PREFIX_CARD = 'Tarjeta crédito:';
const MANUAL_BANK_ITEMS: Array<{ label: string; currency: WealthCurrency }> = [
  { label: 'Banco de Chile CLP', currency: 'CLP' },
  { label: 'Banco de Chile USD', currency: 'USD' },
  { label: 'Scotiabank CLP', currency: 'CLP' },
  { label: 'Scotiabank USD', currency: 'USD' },
  { label: 'Santander CLP', currency: 'CLP' },
  { label: 'Santander USD', currency: 'USD' },
];
const MANUAL_CARD_ITEMS: Array<{ label: string; currency: WealthCurrency }> = [
  { label: 'Visa Banco de Chile', currency: 'CLP' },
  { label: 'Visa Scotia', currency: 'CLP' },
  { label: 'Mastercard Scotia', currency: 'CLP' },
  { label: 'Mastercard Falabella', currency: 'CLP' },
  { label: 'Mastercard Santander', currency: 'CLP' },
  { label: 'American Express Santander', currency: 'CLP' },
];
const MANUAL_BANK_GROUPS: Array<{ bank: string; items: Array<{ label: string; currency: WealthCurrency }> }> = [
  {
    bank: 'Banco de Chile',
    items: [
      { label: 'Banco de Chile CLP', currency: 'CLP' },
      { label: 'Banco de Chile USD', currency: 'USD' },
    ],
  },
  {
    bank: 'Scotiabank',
    items: [
      { label: 'Scotiabank CLP', currency: 'CLP' },
      { label: 'Scotiabank USD', currency: 'USD' },
    ],
  },
  {
    bank: 'Santander',
    items: [
      { label: 'Santander CLP', currency: 'CLP' },
      { label: 'Santander USD', currency: 'USD' },
    ],
  },
];
const MANUAL_CARD_GROUPS: Array<{
  bank: string;
  className: string;
  items: Array<{ label: string; currency: WealthCurrency }>;
}> = [
  {
    bank: 'Banco de Chile',
    className: 'border-blue-200 bg-blue-50/40',
    items: [{ label: 'Visa Banco de Chile', currency: 'CLP' }],
  },
  {
    bank: 'Scotiabank',
    className: 'border-slate-300 bg-slate-100/70',
    items: [
      { label: 'Visa Scotia', currency: 'CLP' },
      { label: 'Mastercard Scotia', currency: 'CLP' },
    ],
  },
  {
    bank: 'Santander',
    className: 'border-red-200 bg-red-50/40',
    items: [
      { label: 'Mastercard Santander', currency: 'CLP' },
      { label: 'American Express Santander', currency: 'CLP' },
    ],
  },
  {
    bank: 'Falabella',
    className: 'border-emerald-200 bg-emerald-50/40',
    items: [{ label: 'Mastercard Falabella', currency: 'CLP' }],
  },
];

const isCarriedRecord = (record: WealthRecord) => {
  const note = String(record.note || '').toLowerCase();
  return note.includes('arrastrado') || note.includes('mes anterior');
};

const isEstimatedRecord = (record: WealthRecord) => {
  return String(record.note || '').toLowerCase().includes('estimado');
};
const isApiSource = (source: string) => {
  const normalized = String(source || '').toLowerCase();
  return normalized.includes('fintoc') || normalized.includes('api');
};
const isMortgagePrincipalLabel = (label: string) => {
  return normalizeForMatch(label).includes(normalizeForMatch('saldo deuda hipotecaria'));
};
const isManualLikeSource = (source: string) => {
  const normalized = normalizeForMatch(source);
  return (
    normalized.includes('manual') ||
    normalized.includes('base inicial') ||
    normalized.includes('instrumento')
  );
};

const formatRecordUpdatedStamp = (record: WealthRecord) => {
  const created = new Date(record.createdAt);
  if (!Number.isFinite(created.getTime())) return record.snapshotDate;

  const now = new Date();
  const isToday =
    created.getFullYear() === now.getFullYear() &&
    created.getMonth() === now.getMonth() &&
    created.getDate() === now.getDate();
  const time = created.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `hoy ${time}`;

  const dayMonth = created.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).replace('.', '');
  return `${dayMonth} ${time}`;
};

const displayRecordOrigin = (record: WealthRecord) => {
  if (isCarriedRecord(record)) return 'Mes anterior';
  if (isEstimatedRecord(record)) {
    return isMortgagePrincipalLabel(record.label) ? 'Sistema' : 'Mes anterior';
  }
  if (isApiSource(record.source)) return 'API';
  if (isManualLikeSource(record.source)) return 'Manual';
  return 'Imagen';
};

const labelMatchKey = (value: string) =>
  normalizeForMatch(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sameCanonicalLabel = (a: string, b: string) => labelMatchKey(a) === labelMatchKey(b);

const todayYmd = () => localYmd();
const readPreferredDisplayCurrency = (): WealthCurrency => {
  if (typeof window === 'undefined') return 'CLP';
  const stored = window.localStorage.getItem(PREFERRED_DISPLAY_CURRENCY_KEY);
  if (stored === 'CLP' || stored === 'USD' || stored === 'EUR') return stored;
  return 'CLP';
};

const monthLabel = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1, 12, 0, 0, 0);
  const label = d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const groupWithDots = (value: number) => {
  return Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const normalizeForMatch = (value: string) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const formatCurrency = (value: number, currency: WealthCurrency) => {
  const sign = value < 0 ? '-' : '';
  if (currency === 'UF') {
    const abs = Math.abs(value);
    const intPart = Math.trunc(abs);
    const decimalPart = Math.round((abs - intPart) * 100)
      .toString()
      .padStart(2, '0');
    return `${sign}${groupWithDots(intPart)},${decimalPart} UF`;
  }
  if (currency === 'CLP') {
    return `${sign}$${groupWithDots(value)}`;
  }

  const abs = Math.abs(value);
  const intPart = Math.trunc(abs);
  const decimalPart = Math.round((abs - intPart) * 100)
    .toString()
    .padStart(2, '0');
  return `${sign}${groupWithDots(intPart)},${decimalPart} ${currency}`;
};

const formatCurrencyNoDecimals = (value: number, currency: WealthCurrency) => {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  if (currency === 'CLP') return `${sign}$${groupWithDots(rounded)}`;
  if (currency === 'UF') return `${sign}${groupWithDots(rounded)} UF`;
  return `${sign}${groupWithDots(rounded)} ${currency}`;
};

const toWealthCurrency = (currency: string): WealthCurrency | null => {
  const normalized = String(currency || '').trim().toUpperCase();
  if (normalized === 'CLP' || normalized === 'USD' || normalized === 'EUR' || normalized === 'UF') {
    return normalized as WealthCurrency;
  }
  return null;
};

const isCreditCardAccount = (account: Pick<FintocAccountNormalized, 'type' | 'name'>) => {
  const token = `${String(account.type || '').toLowerCase()} ${String(account.name || '').toLowerCase()}`;
  return token.includes('credit') || token.includes('card') || token.includes('tarjeta') || token.includes('tc');
};

const toClp = (amount: number, currency: WealthCurrency, usdClp: number, eurClp: number, ufClp: number) => {
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * usdClp;
  if (currency === 'UF') return amount * ufClp;
  return amount * eurClp;
};

const fromClp = (amountClp: number, currency: WealthCurrency, usdClp: number, eurClp: number, ufClp: number) => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, usdClp);
  if (currency === 'UF') return amountClp / Math.max(1, ufClp);
  return amountClp / Math.max(1, eurClp);
};

const average = (arr: number[]) => {
  if (!arr.length) return null;
  return arr.reduce((sum, n) => sum + n, 0) / arr.length;
};

const monthPoints = (closures: WealthMonthlyClosure[], currentKey: string, currentNet: number) => {
  const map = new Map<string, number>();
  for (const c of closures) map.set(c.monthKey, c.summary.netConsolidatedClp);
  map.set(currentKey, currentNet);

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, net]) => ({ key, net }));
};

const toCloseDateFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, 1, 12, 0, 0, 0);
};

const getSectionBlock = (section: MainSection): WealthBlock => {
  if (section === 'investment') return 'investment';
  if (section === 'bank') return 'bank';
  return 'real_estate';
};

interface DraftRecord {
  block: WealthBlock;
  source: string;
  label: string;
  amount: string;
  currency: WealthCurrency;
  note: string;
  snapshotDate: string;
}

const buildDraft = (section: MainSection): DraftRecord => ({
  block: section === 'investment' ? 'investment' : section === 'real_estate' ? 'real_estate' : 'bank',
  source: 'manual',
  label: '',
  amount: '',
  currency: section === 'real_estate' ? 'UF' : 'CLP',
  note: '',
  snapshotDate: todayYmd(),
});

interface EditableSuggestion extends ParsedWealthSuggestion {
  snapshotDate: string;
}

interface SectionScreenProps {
  section: MainSection;
  monthKey: string;
  recordsForSection: WealthRecord[];
  investmentInstruments: WealthInvestmentInstrument[];
  usdClp: number;
  eurClp: number;
  ufClp: number;
  carryMessage: string;
  onBack: () => void;
  onDataChanged: () => void;
  onCreateInvestmentInstrument: (input: {
    label: string;
    currency: WealthCurrency;
    amount?: number;
    note?: string;
  }) => void;
  onSetInvestmentExcluded: (instrumentId: string, excluded: boolean) => void;
  onUseMissing: (section: MainSection, itemName?: string) => void;
  onApplyMortgageAuto: () => void;
}

interface QuickFillDraft {
  id?: string;
  block: WealthBlock;
  source: string;
  label: string;
  amount: string;
  currency: WealthCurrency;
  note?: string;
  snapshotDate: string;
}

interface MultiQuickFillDraft {
  source: string;
  snapshotDate: string;
  entries: Array<{
    id?: string;
    label: string;
    currency: WealthCurrency;
    amount: string;
    note?: string;
  }>;
}

interface InvestmentSourceContext {
  title: string;
  sourceHint: string;
  source: string;
  labels: Array<{ label: string; currency: WealthCurrency }>;
  instrumentId?: string;
  isCustom?: boolean;
}

interface ChecklistRow {
  name: string;
  status: 'actualizado' | 'mes_anterior' | 'estimado' | 'pendiente' | 'excluido';
  detail: string;
  isCustomInstrument?: boolean;
  instrumentId?: string;
  context?: InvestmentSourceContext;
}

interface BankMovementsModalState {
  bank: string;
  currency: WealthCurrency;
}

interface BankMovementMeta {
  known: boolean;
  count: number;
}

type CloseValidationIssueType =
  | 'future_month'
  | 'missing_required_value'
  | 'incomplete_new_source'
  | 'carried_value_unconfirmed';

interface CloseValidationIssue {
  type: CloseValidationIssueType;
  level: 'error' | 'warning';
  label: string;
  section: MainSection;
  instrumentId?: string;
  canResolveWithPrevious?: boolean;
  canExcludeThisMonth?: boolean;
}

const SectionScreen: React.FC<SectionScreenProps> = ({
  section,
  monthKey,
  recordsForSection,
  investmentInstruments,
  usdClp,
  eurClp,
  ufClp,
  carryMessage,
  onBack,
  onDataChanged,
  onCreateInvestmentInstrument,
  onSetInvestmentExcluded,
  onUseMissing,
  onApplyMortgageAuto,
}) => {
  const [sourceHint, setSourceHint] = useState(section === 'real_estate' ? 'dividendo' : 'auto');
  const [ocrProgress, setOcrProgress] = useState<{ pct: number; status: string } | null>(null);
  const [ocrError, setOcrError] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [draft, setDraft] = useState<DraftRecord>(() => buildDraft(section));
  const [quickFill, setQuickFill] = useState<QuickFillDraft | null>(null);
  const [multiQuickFill, setMultiQuickFill] = useState<MultiQuickFillDraft | null>(null);
  const [openLoadPanel, setOpenLoadPanel] = useState(false);
  const [openSourceMenu, setOpenSourceMenu] = useState(false);
  const [activeSourceContext, setActiveSourceContext] = useState<InvestmentSourceContext | null>(null);
  const [openCreateInvestmentModal, setOpenCreateInvestmentModal] = useState(false);
  const [newInvestmentDraft, setNewInvestmentDraft] = useState<{
    label: string;
    currency: WealthCurrency;
    amount: string;
    note: string;
  }>({ label: '', currency: 'CLP', amount: '', note: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fintocStatus, setFintocStatus] = useState('');
  const [fintocDiscovering, setFintocDiscovering] = useState(false);
  const [fintocDiscovery, setFintocDiscovery] = useState<FintocDiscoverResponse | null>(null);
  const [fintocLastSync, setFintocLastSync] = useState<{
    assets: FintocAccountNormalized[];
    cards: FintocAccountNormalized[];
  } | null>(null);
  const [bankTokens, setBankTokens] = useState<Partial<Record<BankProviderId, string>>>(() => loadBankTokens());
  const [movementsModal, setMovementsModal] = useState<BankMovementsModalState | null>(null);
  const [bankMovementMeta, setBankMovementMeta] = useState<Partial<Record<BankProviderId, BankMovementMeta>>>({});
  const [updatingAllBanks, setUpdatingAllBanks] = useState(false);
  const hiddenUploadInputRef = useRef<HTMLInputElement | null>(null);
  const sectionTitle = section === 'real_estate' ? 'Bienes raíces (neto)' : sectionLabel[section];

  useEffect(() => {
    if (section !== 'bank') return;
    const refreshTokens = () => setBankTokens(loadBankTokens());
    refreshTokens();
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshTokens as EventListener);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshTokens as EventListener);
    };
  }, [section]);

  const dedupedSectionRecords = useMemo(() => {
    const byLogicalKey = new Map<string, WealthRecord>();
    const ordered = [...recordsForSection].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    for (const item of ordered) {
      const key = `${item.block}::${normalizeForMatch(item.label)}::${item.currency}`;
      if (!byLogicalKey.has(key)) byLogicalKey.set(key, item);
    }
    return [...byLogicalKey.values()];
  }, [recordsForSection]);

  const sectionTotalClp = useMemo(() => {
    if (section === 'real_estate') {
      const realEstateAssetsClp = dedupedSectionRecords
        .filter((item) => item.block === 'real_estate')
        .reduce((sum, item) => sum + toClp(item.amount, item.currency, usdClp, eurClp, ufClp), 0);
      const mortgageDebtClp = dedupedSectionRecords
        .filter((item) => item.block === 'debt' && isMortgagePrincipalLabel(item.label))
        .reduce((sum, item) => sum + toClp(item.amount, item.currency, usdClp, eurClp, ufClp), 0);
      return realEstateAssetsClp - mortgageDebtClp;
    }
    return dedupedSectionRecords.reduce((sum, item) => {
      const signed = item.block === 'debt' ? -item.amount : item.amount;
      return sum + toClp(signed, item.currency, usdClp, eurClp, ufClp);
    }, 0);
  }, [section, dedupedSectionRecords, usdClp, eurClp, ufClp]);

  const bankDashboard = useMemo(() => {
    if (section !== 'bank') {
      return {
        bankClp: 0,
        bankUsd: 0,
        cardClp: 0,
        cardUsd: 0,
        hasCardClpData: false,
        hasCardUsdData: false,
        movements: [] as Array<{
          bank: string;
          account: string;
          description: string;
          date: string;
          amount: number;
          currency: WealthCurrency;
        }>,
      };
    }

    const bankDetails = dedupedSectionRecords.filter(
      (r) => r.block === 'bank' && MANUAL_BANK_ITEMS.some((i) => i.label === r.label),
    );
    const cardDetails = dedupedSectionRecords.filter(
      (r) =>
        r.block === 'debt' &&
        (r.label.startsWith(FINTOC_SYNC_PREFIX_CARD) || MANUAL_CARD_ITEMS.some((i) => i.label === r.label)),
    );

    const bankClp = bankDetails.filter((r) => r.currency === 'CLP').reduce((sum, r) => sum + r.amount, 0);
    const bankUsd = bankDetails.filter((r) => r.currency === 'USD').reduce((sum, r) => sum + r.amount, 0);
    const cardClp = cardDetails.filter((r) => r.currency === 'CLP').reduce((sum, r) => sum + r.amount, 0);
    const cardUsd = cardDetails.filter((r) => r.currency === 'USD').reduce((sum, r) => sum + r.amount, 0);
    const hasCardClpData = cardDetails.some((r) => r.currency === 'CLP');
    const hasCardUsdData = cardDetails.some((r) => r.currency === 'USD');

    const syncAccounts = fintocLastSync?.assets?.length
      ? fintocLastSync.assets
      : (fintocDiscovery?.accounts || []).filter((acc) => !isCreditCardAccount(acc));

    const allMovements = syncAccounts.flatMap((acc) =>
      (acc.movementsSample || []).map((m) => ({
        bank: acc.bank || 'Banco',
        account: `${acc.name}${acc.number ? ` · ${acc.number}` : ''}`,
        description: m.description || 'Movimiento',
        date: m.date || '',
        amount: m.amount,
        currency: (toWealthCurrency(m.currency) || toWealthCurrency(acc.currency) || 'CLP') as WealthCurrency,
      })),
    );
    return { bankClp, bankUsd, cardClp, cardUsd, hasCardClpData, hasCardUsdData, movements: allMovements };
  }, [section, dedupedSectionRecords, fintocLastSync, fintocDiscovery]);

  const bankApiPresenceByProvider = useMemo(() => {
    const result: Record<BankProviderId, boolean> = { bchile: false, scotia: false, santander: false };
    for (const record of dedupedSectionRecords) {
      if (record.block !== 'bank' || !isApiSource(record.source)) continue;
      const label = normalizeForMatch(record.label);
      if (label.includes(normalizeForMatch('Banco de Chile'))) result.bchile = true;
      if (label.includes(normalizeForMatch('Scotiabank'))) result.scotia = true;
      if (label.includes(normalizeForMatch('Santander'))) result.santander = true;
    }
    return result;
  }, [dedupedSectionRecords]);

  const modalMovements = useMemo(() => {
    if (!movementsModal) return [];
    const targetBank = normalizeForMatch(movementsModal.bank);
    return bankDashboard.movements.filter((movement) => {
      if (movement.currency !== movementsModal.currency) return false;
      const movementBank = normalizeForMatch(movement.bank);
      return movementBank.includes(targetBank) || targetBank.includes(movementBank);
    });
  }, [bankDashboard.movements, movementsModal]);

  const renderCardDebtTotal = (hasData: boolean, value: number, currency: WealthCurrency) => {
    if (!hasData) return '';
    if (Math.round(value) === 0) return '';
    return `-${formatCurrencyNoDecimals(value, currency)}`;
  };

  const buildInvestmentContext = (name: string, instrument?: WealthInvestmentInstrument): InvestmentSourceContext => {
    if (instrument) {
      return {
        title: instrument.label,
        sourceHint: 'auto',
        source: 'Instrumento manual',
        labels: [{ label: instrument.label, currency: instrument.currency }],
        instrumentId: instrument.id,
        isCustom: true,
      };
    }

    const n = normalizeForMatch(name);
    if (n.includes('sura')) {
      return {
        title: 'SURA',
        sourceHint: 'sura_resumen',
        source: 'SURA',
        labels: [
          { label: 'SURA inversión financiera', currency: 'CLP' },
          { label: 'SURA ahorro previsional', currency: 'CLP' },
        ],
      };
    }
    if (n.includes('planvital')) {
      return {
        title: 'PlanVital',
        sourceHint: 'planvital',
        source: 'PlanVital',
        labels: [{ label: 'PlanVital saldo total', currency: 'CLP' }],
      };
    }
    if (n.includes('btg')) {
      return {
        title: 'BTG',
        sourceHint: 'btg',
        source: 'BTG Pactual',
        labels: [{ label: 'BTG total valorización', currency: 'CLP' }],
      };
    }
    if (n.includes('global66')) {
      return {
        title: 'Global66',
        sourceHint: 'global66',
        source: 'Global66',
        labels: [{ label: 'Global66 Cuenta Vista USD', currency: 'USD' }],
      };
    }
    if (n.includes('wise')) {
      return {
        title: 'Wise',
        sourceHint: 'wise',
        source: 'Wise',
        labels: [{ label: 'Wise Cuenta principal USD', currency: 'USD' }],
      };
    }
    return {
      title: name,
      sourceHint: 'auto',
      source: 'Manual',
      labels: [{ label: name, currency: 'CLP' }],
    };
  };

  const findRecordForLabel = (label: string, currency?: WealthCurrency) => {
    const target = normalizeForMatch(label);
    return dedupedSectionRecords.find((r) => {
      if (r.block !== 'investment') return false;
      if (currency && r.currency !== currency) return false;
      return normalizeForMatch(r.label) === target;
    });
  };

  const checklistRows = useMemo<ChecklistRow[]>(() => {
    const baseRows = sectionChecklist[section].map((name): ChecklistRow => {
      const match = dedupedSectionRecords.find((r) => normalizeForMatch(r.label).includes(normalizeForMatch(name)));
      if (!match) {
        return {
          name,
          status: 'pendiente',
          detail: 'Sin dato este mes',
          context: section === 'investment' ? buildInvestmentContext(name) : undefined,
        };
      }
      if (isCarriedRecord(match)) {
        return {
          name,
          status: 'mes_anterior',
          detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
          context: section === 'investment' ? buildInvestmentContext(name) : undefined,
        };
      }
      if (isEstimatedRecord(match)) {
        if (section === 'real_estate' && !isMortgagePrincipalLabel(match.label)) {
          return {
            name,
            status: 'mes_anterior',
            detail: `Mes anterior · ${formatRecordUpdatedStamp(match)}`,
            context: undefined,
          };
        }
        return {
          name,
          status: 'estimado',
          detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
          context: section === 'investment' ? buildInvestmentContext(name) : undefined,
        };
      }
      return {
        name,
        status: 'actualizado',
        detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
        context: section === 'investment' ? buildInvestmentContext(name) : undefined,
      };
    });

    if (section !== 'investment') return baseRows;

    const customRows: ChecklistRow[] = investmentInstruments.map((instrument) => {
      const isExcluded = (instrument.excludedMonths || []).includes(monthKey);
      if (isExcluded) {
        return {
          name: instrument.label,
          status: 'excluido',
          detail: `No considerado en ${monthLabel(monthKey).toLowerCase()}`,
          isCustomInstrument: true,
          instrumentId: instrument.id,
          context: buildInvestmentContext(instrument.label, instrument),
        };
      }

      const match = findRecordForLabel(instrument.label, instrument.currency);
      if (!match) {
        return {
          name: instrument.label,
          status: 'pendiente',
          detail: 'Sin valor este mes',
          isCustomInstrument: true,
          instrumentId: instrument.id,
          context: buildInvestmentContext(instrument.label, instrument),
        };
      }
      if (isCarriedRecord(match)) {
        return {
          name: instrument.label,
          status: 'mes_anterior',
          detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
          isCustomInstrument: true,
          instrumentId: instrument.id,
          context: buildInvestmentContext(instrument.label, instrument),
        };
      }
      return {
        name: instrument.label,
        status: 'actualizado',
        detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
        isCustomInstrument: true,
        instrumentId: instrument.id,
        context: buildInvestmentContext(instrument.label, instrument),
      };
    });

    return [...baseRows, ...customRows];
  }, [section, dedupedSectionRecords, investmentInstruments, monthKey]);

  const normalizeSuggestionBlock = (block: WealthBlock): WealthBlock => {
    if (section === 'real_estate') return block === 'debt' ? 'debt' : 'real_estate';
    return getSectionBlock(section);
  };
  const suggestionKey = (item: Pick<EditableSuggestion, 'block' | 'source' | 'label' | 'currency'>) =>
    `${item.block}::${normalizeForMatch(item.source)}::${normalizeForMatch(item.label)}::${item.currency}`;

  const openImagePicker = () => {
    if (!hiddenUploadInputRef.current) return;
    hiddenUploadInputRef.current.click();
  };

  const applyInvestmentContextToParsed = (parsed: EditableSuggestion[]): EditableSuggestion[] => {
    if (section !== 'investment' || !activeSourceContext) return parsed;

    if (activeSourceContext.labels.length === 1) {
      const target = activeSourceContext.labels[0];
      const exact = parsed.find((item) => normalizeForMatch(item.label) === normalizeForMatch(target.label));
      const fallback = exact || parsed[0] || null;
      if (!fallback) return [];
      return [
        {
          ...fallback,
          block: 'investment',
          source: activeSourceContext.source,
          label: target.label,
          currency: target.currency,
        },
      ];
    }

    return activeSourceContext.labels
      .map((target) => {
        const exact = parsed.find((item) => normalizeForMatch(item.label) === normalizeForMatch(target.label));
        if (!exact) return null;
        return {
          ...exact,
          block: 'investment' as WealthBlock,
          source: activeSourceContext.source,
          label: target.label,
          currency: target.currency,
        };
      })
      .filter((item): item is EditableSuggestion => !!item);
  };

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setOpenLoadPanel(true);
    setOcrError('');
    setOcrProgress({ pct: 0, status: 'iniciando' });

    try {
      const text = await runOcrFromFile(file, sourceHint, (pct, status) => setOcrProgress({ pct, status }));
      setOcrText(text);

      const rawParsed = parseWealthFromOcrText(text, sourceHint);
      let parsed = rawParsed.map((item) => ({
        ...item,
        block: normalizeSuggestionBlock(item.block),
        snapshotDate: todayYmd(),
      }));
      parsed = applyInvestmentContextToParsed(parsed);

      // En Bienes raíces el documento de dividendo debe traer ambos valores.
      if (section === 'real_estate' && sourceHint === 'dividendo') {
        const strictDividendParsed = parseWealthFromOcrText(text, 'dividendo').map((item) => ({
          ...item,
          block: normalizeSuggestionBlock(item.block),
          snapshotDate: todayYmd(),
        }));
        const hasDividend = strictDividendParsed.some((i) => i.label === 'Dividendo hipotecario mensual');
        const hasDebt = strictDividendParsed.some((i) => i.label === 'Saldo deuda hipotecaria');
        if (!hasDividend || !hasDebt) {
          setOcrError('Para este documento deben detectarse ambos valores: dividendo y saldo deuda después del pago.');
          return;
        }
        parsed = strictDividendParsed;
      }

      if (section === 'investment' && activeSourceContext?.labels.length && parsed.length < activeSourceContext.labels.length) {
        setOcrError(
          `No pude detectar todos los valores de ${activeSourceContext.title}. Intenta una captura más clara o usa "Ingresar monto".`,
        );
        return;
      }

      if (!parsed.length) {
        setOcrError('No pude detectar montos claros. Intenta con otra captura.');
        return;
      }

      const isLikelyWrongSection =
        (section === 'investment' && rawParsed.some((r) => r.block === 'debt' || r.block === 'real_estate')) ||
        (section === 'real_estate' && rawParsed.some((r) => r.block === 'investment' || r.block === 'bank')) ||
        (section === 'bank' && rawParsed.some((r) => r.block !== 'bank'));

      if (isLikelyWrongSection) {
        setOcrError('La imagen parece pertenecer a otro bloque. Revisa antes de guardar.');
      }

      // Permite subir varias imágenes antes de guardar todo, evitando duplicados por activo.
      setSuggestions((prev) => {
        const next = [...prev];
        const indexByKey = new Map(next.map((item, idx) => [suggestionKey(item), idx]));

        parsed.forEach((item) => {
          const key = suggestionKey(item);
          const existingIdx = indexByKey.get(key);
          if (existingIdx === undefined) {
            indexByKey.set(key, next.length);
            next.push(item);
          } else {
            next[existingIdx] = item;
          }
        });

        return next;
      });
    } catch (err: any) {
      setOcrError(err?.message || 'Error leyendo imagen');
    } finally {
      setOcrProgress(null);
      event.target.value = '';
    }
  };

  const saveSuggestion = (item: EditableSuggestion, idx?: number) => {
    const itemLabel = normalizeForMatch(item.label);
    const existing = dedupedSectionRecords.find(
      (r) =>
        r.block === item.block &&
        r.currency === item.currency &&
        normalizeForMatch(r.label) === itemLabel,
    );

    upsertWealthRecord({
      id: existing?.id,
      block: item.block,
      source: item.source,
      label: item.label,
      amount: item.amount,
      currency: item.currency,
      note: item.note,
      snapshotDate: item.snapshotDate,
    });

    if (typeof idx === 'number') {
      setSuggestions((prev) => prev.filter((_, i) => i !== idx));
    }

    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    onDataChanged();
  };

  const saveAllSuggestions = () => {
    suggestions.forEach((item) => {
      const itemLabel = normalizeForMatch(item.label);
      const existing = dedupedSectionRecords.find(
        (r) =>
          r.block === item.block &&
          r.currency === item.currency &&
          normalizeForMatch(r.label) === itemLabel,
      );

      upsertWealthRecord({
        id: existing?.id,
        block: item.block,
        source: item.source,
        label: item.label,
        amount: item.amount,
        currency: item.currency,
        note: item.note,
        snapshotDate: item.snapshotDate,
      });
    });
    setSuggestions([]);
    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    onDataChanged();
  };

  const saveDraft = () => {
    const amount = Number(draft.amount.replace(/,/g, '.'));
    if (!draft.label.trim() || !Number.isFinite(amount) || amount <= 0) return;

    upsertWealthRecord({
      id: editingId || undefined,
      block: draft.block,
      source: draft.source || 'manual',
      label: draft.label.trim(),
      amount,
      currency: draft.currency,
      note: draft.note.trim() || undefined,
      snapshotDate: draft.snapshotDate,
    });

    setDraft(buildDraft(section));
    setEditingId(null);
    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    onDataChanged();
  };

  const isSectionComplete = useMemo(() => {
    return checklistRows.every((row) => row.status !== 'pendiente');
  }, [checklistRows]);

  const sortedChecklistRows = useMemo(() => {
    const weight = (row: ChecklistRow) => {
      if (row.status === 'pendiente') return 0;
      if (row.status === 'mes_anterior') return 1;
      if (row.status === 'estimado') return 2;
      if (row.status === 'actualizado') return 3;
      return 4;
    };
    return [...checklistRows].sort((a, b) => weight(a) - weight(b));
  }, [checklistRows]);

  const missingRowsForCompose = useMemo(
    () => sortedChecklistRows.filter((row) => row.status === 'pendiente').map((row) => row.name),
    [sortedChecklistRows],
  );

  const checklistSummary = useMemo(() => {
    const total = checklistRows.length;
    const pending = checklistRows.filter((row) => row.status === 'pendiente').length;
    const excluded = checklistRows.filter((row) => row.status === 'excluido').length;
    const notUpdated = checklistRows.filter((row) => row.status === 'mes_anterior' || row.status === 'estimado').length;
    const updated = checklistRows.filter((row) => row.status === 'actualizado').length;
    const completed = total - pending - excluded;
    return { total, pending, excluded, notUpdated, updated, completed };
  }, [checklistRows]);

  const closeLoadPanel = () => {
    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setSuggestions([]);
    setOcrError('');
    setOcrText('');
    setActiveSourceContext(null);
  };

  const openQuickFillForContext = (context: InvestmentSourceContext) => {
    if (context.labels.length > 1) {
      const entries = context.labels.map((entry) => {
        const existing = findRecordForLabel(entry.label, entry.currency);
        return {
          id: existing?.id,
          label: entry.label,
          currency: entry.currency,
          amount: existing ? String(existing.amount) : '',
          note: existing?.note || undefined,
        };
      });
      setMultiQuickFill({
        source: context.source,
        snapshotDate: `${monthKey}-01`,
        entries,
      });
      setQuickFill(null);
      setOpenLoadPanel(true);
      return;
    }

    const entry = context.labels[0];
    const existing = findRecordForLabel(entry.label, entry.currency);
    setQuickFill({
      id: existing?.id,
      block: 'investment',
      source: context.source,
      label: entry.label,
      amount: existing ? String(existing.amount) : '',
      currency: entry.currency,
      note: existing?.note || '',
      snapshotDate: existing?.snapshotDate || `${monthKey}-01`,
    });
    setMultiQuickFill(null);
    setOpenLoadPanel(true);
  };

  const openChecklistItem = (row: ChecklistRow) => {
    if (section === 'investment' && row.context) {
      setActiveSourceContext(row.context);
      setOpenSourceMenu(true);
      return;
    }

    const existing = dedupedSectionRecords.find((r) => normalizeForMatch(r.label).includes(normalizeForMatch(row.name)));
    const preferredBlock: WealthBlock =
      section === 'real_estate' &&
      REAL_ESTATE_DEBT_LABELS.some((item) => normalizeForMatch(row.name).includes(normalizeForMatch(item)))
        ? 'debt'
        : section === 'real_estate'
          ? 'real_estate'
          : getSectionBlock(section);

    if (section === 'real_estate') {
      setActiveSourceContext(null);
      setQuickFill({
        id: existing?.id,
        block: preferredBlock,
        source: existing?.source || 'manual',
        label: existing?.label || row.name,
        amount: existing ? String(existing.amount) : '',
        currency: existing?.currency || 'UF',
        snapshotDate: existing?.snapshotDate || `${monthKey}-01`,
      });
      setOpenLoadPanel(true);
      return;
    }

    if (existing) {
      setEditingId(existing.id);
      setDraft({
        block: existing.block,
        source: existing.source,
        label: existing.label,
        amount: String(existing.amount),
        currency: existing.currency,
        note: isCarriedRecord(existing) || isEstimatedRecord(existing) ? '' : existing.note || '',
        snapshotDate: existing.snapshotDate,
      });
    } else {
      setEditingId(null);
      setDraft({
        ...buildDraft(section),
        block: preferredBlock,
        label: row.name,
        currency: buildDraft(section).currency,
      });
    }
    setOpenLoadPanel(true);
  };

  const saveQuickFill = () => {
    if (!quickFill) return;
    const amount = Number(quickFill.amount.replace(/,/g, '.'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    upsertWealthRecord({
      id: quickFill.id,
      block: quickFill.block,
      source: quickFill.source,
      label: quickFill.label,
      amount,
      currency: quickFill.currency,
      note: quickFill.note?.trim() || undefined,
      snapshotDate: quickFill.snapshotDate,
    });
    setQuickFill(null);
    setActiveSourceContext(null);
    setOpenLoadPanel(false);
    onDataChanged();
  };

  const saveMultiQuickFill = () => {
    if (!multiQuickFill) return;
    const parsedEntries = multiQuickFill.entries
      .map((entry) => ({
        ...entry,
        amountParsed: Number(String(entry.amount || '').replace(/,/g, '.')),
      }))
      .filter((entry) => Number.isFinite(entry.amountParsed) && entry.amountParsed > 0);
    if (!parsedEntries.length) return;

    parsedEntries.forEach((entry) => {
      upsertWealthRecord({
        id: entry.id,
        block: 'investment',
        source: multiQuickFill.source,
        label: entry.label,
        amount: entry.amountParsed,
        currency: entry.currency,
        note: entry.note?.trim() || undefined,
        snapshotDate: multiQuickFill.snapshotDate,
      });
    });
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    setOpenLoadPanel(false);
    onDataChanged();
  };

  const mergeAccounts = (prev: FintocAccountNormalized[], next: FintocAccountNormalized[]) => {
    const map = new Map<string, FintocAccountNormalized>();
    [...prev, ...next].forEach((account) => {
      const key = `${account.bank || 'Banco'}::${account.id}`;
      map.set(key, account);
    });
    return [...map.values()];
  };

  const ensureBankToken = (bankId: BankProviderId, forcePrompt = false) => {
    const existing = String(bankTokens[bankId] || '').trim();
    if (existing && !forcePrompt) return existing;

    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const entered = window.prompt(`Pega link_token de Fintoc para ${bankName}`, existing)?.trim() || '';
    if (!entered) return '';

    const nextTokens = { ...loadBankTokens(), ...bankTokens, [bankId]: entered };
    setBankTokens(nextTokens);
    saveBankTokens(nextTokens);
    return entered;
  };

  const runFintocDiscovery = async (bankId: BankProviderId, options?: { silent?: boolean }) => {
    if (section !== 'bank') return;
    const silent = !!options?.silent;
    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const linkToken = ensureBankToken(bankId);
    if (!linkToken) return;

    setFintocDiscovering(true);
    if (!silent) {
      setFintocStatus('');
      setFintocDiscovery(null);
    }

    try {
      const result = await discoverFintocData(linkToken);
      if (!result.ok) {
        if (!silent) setFintocStatus(`Error API: ${result.error || 'No se pudo explorar.'}`);
        setBankMovementMeta((prev) => ({ ...prev, [bankId]: { known: false, count: 0 } }));
        return;
      }
      const snapshotDate = todayYmd();
      if (!silent) setFintocDiscovery(result);
      const discoveryBank = String(result.summary.institution || bankName).trim() || bankName;
      setFintocLastSync((prev) => ({
        assets: mergeAccounts(
          prev?.assets || [],
          result.accounts.filter((acc) => !isCreditCardAccount(acc)).map((acc) => ({ ...acc, bank: discoveryBank })),
        ),
        cards: mergeAccounts(
          prev?.cards || [],
          result.accounts.filter((acc) => isCreditCardAccount(acc)).map((acc) => ({ ...acc, bank: discoveryBank })),
        ),
      }));

      // También actualiza los cuadros principales del banco para evitar que queden "Pendiente" tras explorar.
      const discoveryAssets = result.accounts.filter((acc) => !isCreditCardAccount(acc));
      const providerTotals = discoveryAssets.reduce(
        (acc, account) => {
          const currency = toWealthCurrency(account.currency);
          if (!currency) return acc;
          if (currency === 'CLP') acc.clp += account.balance;
          if (currency === 'USD') acc.usd += account.balance;
          return acc;
        },
        { clp: 0, usd: 0 },
      );
      const manualProviderPrefix = BANK_PROVIDERS.find((provider) => provider.id === bankId)?.label || bankName;
      const upsertByLabel = (
        block: WealthBlock,
        label: string,
        currency: WealthCurrency,
        amount: number,
        note?: string,
      ) => {
        const existing = dedupedSectionRecords.find(
          (r) =>
            normalizeForMatch(r.label) === normalizeForMatch(label) &&
            r.currency === currency &&
            r.block === block,
        );
        upsertWealthRecord({
          id: existing?.id,
          block,
          source: 'Fintoc API',
          label,
          amount: Math.max(0, amount),
          currency,
          snapshotDate,
          note,
        });
      };
      upsertByLabel(
        'bank',
        `${manualProviderPrefix} CLP`,
        'CLP',
        providerTotals.clp,
        `API ${discoveryBank} (${discoveryAssets.length} cuentas)`,
      );
      upsertByLabel(
        'bank',
        `${manualProviderPrefix} USD`,
        'USD',
        providerTotals.usd,
        `API ${discoveryBank} (${discoveryAssets.length} cuentas)`,
      );
      const refreshedMonthRecords = latestRecordsForMonth(loadWealthRecords(), monthKey);
      const refreshedBankDetails = refreshedMonthRecords.filter(
        (record) => record.block === 'bank' && MANUAL_BANK_ITEMS.some((item) => item.label === record.label),
      );
      const totalClp = refreshedBankDetails.filter((record) => record.currency === 'CLP').reduce((sum, record) => sum + record.amount, 0);
      const totalUsd = refreshedBankDetails.filter((record) => record.currency === 'USD').reduce((sum, record) => sum + record.amount, 0);
      upsertByLabel('bank', 'Saldo bancos CLP', 'CLP', totalClp, 'Calculado desde detalle de cuentas');
      upsertByLabel('bank', 'Saldo bancos USD', 'USD', totalUsd, 'Calculado desde detalle de cuentas');
      const movementProbes = (result.probes || []).filter((probe) => probe.endpoint.includes('/movements'));
      const movementKnown = movementProbes.some((probe) => probe.ok);
      const movementCount = movementKnown
        ? movementProbes.reduce((sum, probe) => sum + (probe.ok ? probe.items : 0), 0)
        : 0;
      setBankMovementMeta((prev) => ({ ...prev, [bankId]: { known: movementKnown, count: movementCount } }));
      onDataChanged();
      if (!silent) {
        setFintocStatus(
          `Exploración ${discoveryBank}: ${result.summary.accounts} cuentas, ${result.summary.movements} movimientos.`,
        );
      }
    } catch (error: any) {
      if (!silent) setFintocStatus(`Error API: ${error?.message || 'No se pudo explorar.'}`);
      setBankMovementMeta((prev) => ({ ...prev, [bankId]: { known: false, count: 0 } }));
    } finally {
      setFintocDiscovering(false);
    }
  };

  const runUpdateAllBanks = async (silent = false) => {
    if (section !== 'bank') return;
    const banksWithToken = BANK_PROVIDERS.filter((bank) => {
      const token = (bankTokens[bank.id] || '').trim();
      return !!token;
    });
    if (!banksWithToken.length) {
      if (!silent) setFintocStatus('No hay tokens guardados. Carga al menos un token de banco.');
      return;
    }

    setUpdatingAllBanks(true);
    if (!silent) setFintocStatus('');
    for (const bank of banksWithToken) {
      // eslint-disable-next-line no-await-in-loop
      await runFintocDiscovery(bank.id, { silent: true });
    }
    setUpdatingAllBanks(false);
    if (!silent) {
      setFintocStatus(`Bancos actualizados: ${banksWithToken.map((b) => b.label).join(', ')}.`);
    }
  };

  const openRecordEditor = (item: WealthRecord) => {
    if (section === 'investment') {
      setActiveSourceContext({
        title: item.label,
        sourceHint: 'auto',
        source: item.source,
        labels: [{ label: item.label, currency: item.currency }],
      });
      setQuickFill({
        id: item.id,
        block: item.block,
        source: item.source,
        label: item.label,
        amount: String(item.amount),
        currency: item.currency,
        note: isCarriedRecord(item) || isEstimatedRecord(item) ? '' : item.note || '',
        snapshotDate: item.snapshotDate,
      });
      setMultiQuickFill(null);
      setOpenLoadPanel(true);
      return;
    }

    if (section === 'real_estate') {
      setActiveSourceContext(null);
      setQuickFill({
        id: item.id,
        block: item.block,
        source: item.source,
        label: item.label,
        amount: String(item.amount),
        currency: item.currency,
        note: isCarriedRecord(item) || isEstimatedRecord(item) ? '' : item.note || '',
        snapshotDate: item.snapshotDate,
      });
      setMultiQuickFill(null);
      setOpenLoadPanel(true);
      return;
    }

    setEditingId(item.id);
    setDraft({
      block: item.block,
      source: item.source,
      label: item.label,
      amount: String(item.amount),
      currency: item.currency,
      note: isCarriedRecord(item) || isEstimatedRecord(item) ? '' : item.note || '',
      snapshotDate: item.snapshotDate,
    });
    setOpenLoadPanel(true);
  };

  useEffect(() => {
    if (section !== 'bank') return;

    let running = false;
    const runDailyIfNeeded = async () => {
      if (running) return;
      const today = localYmd();
      if (readBanksLastAutoSyncDay() === today) return;
      if (readBanksLastAutoAttemptDay() === today) return;
      const hasAnyToken = BANK_PROVIDERS.some((bank) => String((bankTokens[bank.id] || '').trim()));
      if (!hasAnyToken) return;

      running = true;
      writeBanksLastAutoAttemptDay(today);
      try {
        const before = loadWealthRecords();
        await runUpdateAllBanks(true);
        const after = loadWealthRecords();
        if (after.length >= before.length) writeBanksLastAutoSyncDay(today);
      } finally {
        running = false;
      }
    };

    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void runDailyIfNeeded();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void runDailyIfNeeded();
    };
    const onInteraction = () => {
      void runDailyIfNeeded();
    };

    void runDailyIfNeeded();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onInteraction);
    window.addEventListener('keydown', onInteraction);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown', onInteraction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, bankTokens]);

  return (
    <div className="space-y-4 pb-24">
      <input ref={hiddenUploadInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />

      <Card className={`p-4 border-0 bg-gradient-to-br ${sectionTheme[section]} shadow-[0_12px_24px_rgba(15,23,42,0.18)]`}>
        <button className="inline-flex items-center gap-1 text-xs text-slate-600" onClick={onBack}>
          <ArrowLeft size={14} /> Volver
        </button>
        <div className="mt-2 text-lg font-bold text-slate-900">{sectionTitle}</div>
        <div className="text-xs text-slate-600">{monthLabel(monthKey)}</div>
        {section === 'bank' ? (
          <div className="mt-3 text-sm font-medium text-slate-700">Vista operativa (impacta patrimonio neto)</div>
        ) : section === 'real_estate' && !isSectionComplete ? (
          <>
            <div className="mt-3 text-3xl font-semibold text-slate-900">--</div>
            <div className="text-xs text-slate-700">Completa Valor propiedad, Saldo deuda y Dividendo para ver total</div>
          </>
        ) : (
          <div className="mt-3 text-3xl font-semibold text-slate-900">{formatCurrency(sectionTotalClp, 'CLP')}</div>
        )}
      </Card>

      {section === 'bank' && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">Dashboard bancario</div>
          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-xl p-3 text-white bg-gradient-to-r from-cyan-600 to-blue-500 text-left">
              <div className="text-xs opacity-90">Total CLP disponible</div>
              <div className="text-2xl font-bold">{formatCurrencyNoDecimals(bankDashboard.bankClp, 'CLP')}</div>
            </div>
            <div className="rounded-xl p-3 text-white bg-gradient-to-r from-teal-600 to-sky-500 text-left">
              <div className="text-xs opacity-90">Total USD disponible</div>
              <div className="text-2xl font-bold">{formatCurrencyNoDecimals(bankDashboard.bankUsd, 'USD')}</div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-xl p-2 border border-rose-200 bg-rose-50 text-left">
              <div className="text-[11px] text-rose-700">Deuda tarjetas CLP</div>
              <div className="text-lg font-semibold text-rose-700">
                {renderCardDebtTotal(bankDashboard.hasCardClpData, bankDashboard.cardClp, 'CLP')}
              </div>
            </div>
            <div className="rounded-xl p-2 border border-rose-200 bg-rose-50 text-left">
              <div className="text-[11px] text-rose-700">Deuda tarjetas USD</div>
              <div className="text-lg font-semibold text-rose-700">
                {renderCardDebtTotal(bankDashboard.hasCardUsdData, bankDashboard.cardUsd, 'USD')}
              </div>
            </div>
          </div>

          <details open className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <summary className="cursor-pointer text-sm font-medium">Bancos manuales (Chile / Scotia / Santander)</summary>
            <div className="mt-2 space-y-2">
              {MANUAL_BANK_GROUPS.map((group) => (
                <div key={group.bank} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="text-xs font-semibold text-slate-600 mb-2">{group.bank}</div>
                  <div className="grid md:grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const existing = dedupedSectionRecords.find((r) => r.label === item.label);
                      const providerId = BANK_PROVIDERS.find((bank) => bank.label === group.bank)?.id;
                      const movementMeta = providerId ? bankMovementMeta[providerId] : undefined;
                      const movementLabel = !movementMeta
                        ? 'S/I movimientos'
                        : !movementMeta.known
                          ? 'S/I movimientos'
                          : movementMeta.count === 0
                            ? '0 movimientos'
                            : `${movementMeta.count} movimientos`;
                      return (
                        <button
                          key={item.label}
                          className={`rounded-lg px-2 py-2 text-left relative ${
                            existing
                              ? 'border border-slate-700 bg-slate-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
                              : 'border border-slate-200 bg-slate-50 hover:bg-slate-100'
                          }`}
                          onClick={() => {
                            setMovementsModal({ bank: group.bank, currency: item.currency });
                          }}
                        >
                          <span
                            className="absolute right-2 top-2 text-slate-400 hover:text-blue-600"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setQuickFill({
                                id: existing?.id,
                                block: 'bank',
                                source: 'Manual bancos',
                                label: item.label,
                                amount: existing ? String(existing.amount) : '',
                                currency: existing?.currency || item.currency,
                                snapshotDate: existing?.snapshotDate || `${monthKey}-01`,
                              });
                              setOpenLoadPanel(true);
                            }}
                          >
                            <Pencil size={14} />
                          </span>
                          {existing && (
                            <span
                              className={`absolute right-8 top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                                isApiSource(existing.source)
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                              title={isApiSource(existing.source) ? 'Valor API/automático' : 'Valor manual'}
                            >
                              {isApiSource(existing.source) ? 'A' : 'M'}
                            </span>
                          )}
                          <div className="text-xs font-medium text-slate-700">{item.currency}</div>
                          <div className="text-sm font-semibold text-slate-900 mt-1">
                            {existing ? formatCurrency(existing.amount, existing.currency) : 'Pendiente'}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">{movementLabel}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details open className="rounded-lg border border-rose-200 bg-rose-50/40 p-2">
            <summary className="cursor-pointer text-sm font-medium text-rose-700">Tarjetas (cupo usado manual)</summary>
            <div className="mt-2 space-y-2">
              {MANUAL_CARD_GROUPS.map((group) => (
                <div key={group.bank} className={`rounded-lg border p-2 ${group.className}`}>
                  <div className="text-xs font-semibold text-slate-700 mb-2">{group.bank}</div>
                  <div className="grid md:grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const existing = dedupedSectionRecords.find((r) => r.label === item.label);
                      return (
                        <button
                          key={item.label}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-left hover:bg-slate-50"
                          onClick={() => {
                            setQuickFill({
                              id: existing?.id,
                              block: 'debt',
                              source: existing?.source || 'Manual tarjetas',
                              label: item.label,
                              amount: existing ? String(existing.amount) : '',
                              currency: existing?.currency || item.currency,
                              snapshotDate: existing?.snapshotDate || `${monthKey}-01`,
                            });
                            setOpenLoadPanel(true);
                          }}
                        >
                          <div className="text-xs font-medium text-slate-700">{item.label}</div>
                          <div className="text-sm font-semibold text-rose-700 mt-1">
                            {existing ? `-${formatCurrency(existing.amount, existing.currency)}` : 'Pendiente'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>

          <div className="text-[11px] text-slate-500">
            Los movimientos se consultan por banco al tocar cada saldo (CLP o USD).
          </div>
        </Card>
      )}

      {section === 'bank' && movementsModal && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40" onClick={() => setMovementsModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
              <Card className="p-4 max-h-[82vh] overflow-y-auto shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Movimientos {movementsModal.currency}</div>
                    <div className="text-xs text-slate-500">{movementsModal.bank}</div>
                  </div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => setMovementsModal(null)}
                    aria-label="Cerrar movimientos"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-3 space-y-1 max-h-[62vh] overflow-y-auto pr-1">
                  {!modalMovements.length && (
                    <div className="text-xs text-slate-500">
                      Sin movimientos detectados para este banco en {movementsModal.currency}.
                    </div>
                  )}
                  {modalMovements.map((mv, idx) => (
                    <div
                      key={`${mv.bank}-${mv.account}-${idx}`}
                      className="grid grid-cols-[90px_1fr_130px] gap-2 text-xs border-b border-slate-100 py-1"
                    >
                      <div className="text-slate-500">{mv.date || '-'}</div>
                      <div>
                        <div className="font-medium text-slate-700">{mv.account}</div>
                        <div className="text-slate-500">{mv.description}</div>
                      </div>
                      <div className={`text-right font-semibold ${mv.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {mv.amount >= 0 ? '+' : ''}
                        {formatCurrency(mv.amount, mv.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {section !== 'bank' && (
        <Card className="p-4 space-y-2 border border-slate-200 shadow-sm bg-white">
          <div className="text-sm font-semibold text-slate-900">Cómo se compone</div>
          {dedupedSectionRecords.length === 0 && <div className="text-xs text-slate-500">Sin datos para este mes.</div>}
          {dedupedSectionRecords.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2 py-1">
              <div>
                <div className="font-medium text-slate-800">{item.label}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`font-semibold ${
                    item.block === 'debt'
                      ? 'text-red-700'
                      : section === 'investment' && !isCarriedRecord(item) && !isEstimatedRecord(item)
                        ? 'text-emerald-700'
                        : ''
                  }`}
                  onClick={() => openRecordEditor(item)}
                >
                  {item.block === 'debt' ? '-' : ''}
                  {formatCurrency(item.amount, item.currency)}
                </button>
                <button
                  className="text-slate-400 hover:text-blue-600"
                  onClick={() => openRecordEditor(item)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    removeWealthRecordForMonthAsset({
                      block: item.block,
                      label: item.label,
                      currency: item.currency,
                      monthKey,
                    });
                    onDataChanged();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {!!missingRowsForCompose.length && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-2 py-2 text-xs text-amber-800">
              <div className="font-medium">Falta cargar</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {missingRowsForCompose.map((name) => (
                  <span key={name} className="rounded-full border border-amber-200 bg-white/70 px-2 py-0.5 text-[11px]">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-4 space-y-2 border border-slate-200 bg-slate-50/80">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">Checklist del bloque</div>
          {checklistSummary.pending === 0 && checklistSummary.notUpdated === 0 && (
            <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
              <CheckCircle2 size={12} />
              Todo cargado
            </div>
          )}
          {checklistSummary.pending === 0 && checklistSummary.notUpdated > 0 && (
            <div className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
              <CheckCircle2 size={12} />
              Completo con arrastres
            </div>
          )}
        </div>
        <div className="text-[11px] text-slate-600">
          Completadas {checklistSummary.completed} de {checklistSummary.total}
          {checklistSummary.pending ? ` · Pendientes ${checklistSummary.pending}` : ''}
          {checklistSummary.notUpdated ? ` · No actualizadas ${checklistSummary.notUpdated}` : ''}
          {checklistSummary.updated ? ` · Actualizadas ${checklistSummary.updated}` : ''}
          {checklistSummary.excluded ? ` · No consideradas ${checklistSummary.excluded}` : ''}
        </div>
        {section === 'bank' ? (
          <div className="space-y-2">
            <div className="grid md:grid-cols-3 gap-2">
              {BANK_PROVIDERS.map((bank) => (
                <div key={bank.id} className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                  <div className="text-xs font-semibold text-slate-700">{bank.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {bankTokens[bank.id]
                      ? 'Token: guardado'
                      : bankApiPresenceByProvider[bank.id]
                        ? 'Token: no guardado en este dispositivo (hay datos API)'
                        : 'Token: pendiente'}
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => ensureBankToken(bank.id, true)}>
                      Cambiar token
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => runUpdateAllBanks()} disabled={updatingAllBanks || fintocDiscovering}>
                {updatingAllBanks || fintocDiscovering ? 'Actualizando...' : 'Actualizar bancos'}
              </Button>
            </div>
            <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
              Completar pendientes con mes anterior
            </Button>
          </div>
        ) : (
          <div className="flex items-center flex-wrap gap-2">
            {section === 'real_estate' && (
              <Button variant="outline" size="sm" onClick={onApplyMortgageAuto}>
                Autocálculo hipotecario
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
              Completar pendientes con mes anterior
            </Button>
          </div>
        )}
        {!!carryMessage && <div className="text-xs text-blue-700">{carryMessage}</div>}
        {!!fintocStatus && (
          <div className={`text-xs ${fintocStatus.startsWith('Error') ? 'text-red-700' : 'text-emerald-700'}`}>
            {fintocStatus}
          </div>
        )}
        {section === 'bank' && !!fintocDiscovery && (
          <div className="text-[11px] text-slate-500">
            Diagnóstico API disponible (modo técnico oculto en esta vista).
          </div>
        )}
        {sortedChecklistRows.map((row) => (
          <div
            key={row.instrumentId ? `custom-${row.instrumentId}` : row.name}
            className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1 hover:bg-slate-100/60 cursor-pointer"
            onClick={() => openChecklistItem(row)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-left flex-1">
                <div>{row.name}</div>
                <div className="text-[11px] text-slate-500">{row.detail}</div>
              </div>
              {row.status === 'pendiente' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUseMissing(section, row.name);
                  }}
                >
                  Usar mes anterior
                </Button>
              )}
              {section === 'investment' && row.isCustomInstrument && row.instrumentId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetInvestmentExcluded(row.instrumentId as string, row.status !== 'excluido');
                  }}
                >
                  {row.status === 'excluido' ? 'Incluir mes' : 'Excluir mes'}
                </Button>
              )}
              {row.status === 'pendiente' && <span className="text-red-700">Pendiente</span>}
              {row.status === 'mes_anterior' && <span className="text-amber-700">Arrastre de mes anterior</span>}
              {row.status === 'estimado' && <span className="text-amber-700">Estimado del sistema</span>}
              {row.status === 'actualizado' && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 size={12} />
                  Actualizado
                </span>
              )}
              {row.status === 'excluido' && <span className="text-slate-500">No considerado</span>}
            </div>
          </div>
        ))}
        {section === 'investment' && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNewInvestmentDraft({ label: '', currency: 'CLP', amount: '', note: '' });
                setOpenCreateInvestmentModal(true);
              }}
            >
              Agregar inversión
            </Button>
          </div>
        )}
      </Card>

      {openSourceMenu && activeSourceContext && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={() => {
              setOpenSourceMenu(false);
              setActiveSourceContext(null);
            }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
              <Card className="p-4 space-y-3 shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{activeSourceContext.title}</div>
                    <div className="text-xs text-slate-500">Selecciona cómo quieres actualizar esta fuente.</div>
                  </div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => {
                      setOpenSourceMenu(false);
                      setActiveSourceContext(null);
                    }}
                    aria-label="Cerrar"
                  >
                    <X size={14} />
                  </button>
                </div>
                <Button
                  onClick={() => {
                    setSourceHint(activeSourceContext.sourceHint);
                    setQuickFill(null);
                    setMultiQuickFill(null);
                    setSuggestions([]);
                    setOcrError('');
                    setOcrText('');
                    setOpenSourceMenu(false);
                    requestAnimationFrame(() => openImagePicker());
                  }}
                >
                  Subir imagen
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenSourceMenu(false);
                    openQuickFillForContext(activeSourceContext);
                  }}
                >
                  Ingresar monto
                </Button>
                {activeSourceContext.isCustom && activeSourceContext.instrumentId && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const row = checklistRows.find((item) => item.instrumentId === activeSourceContext.instrumentId);
                      onSetInvestmentExcluded(activeSourceContext.instrumentId as string, row?.status !== 'excluido');
                      setOpenSourceMenu(false);
                      setActiveSourceContext(null);
                    }}
                  >
                    {(() => {
                      const row = checklistRows.find((item) => item.instrumentId === activeSourceContext.instrumentId);
                      return row?.status === 'excluido' ? 'Incluir este mes' : 'Excluir este mes';
                    })()}
                  </Button>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {openCreateInvestmentModal && section === 'investment' && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={() => setOpenCreateInvestmentModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
              <Card className="p-4 space-y-3 shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Agregar inversión</div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => setOpenCreateInvestmentModal(false)}
                    aria-label="Cerrar"
                  >
                    <X size={14} />
                  </button>
                </div>
                <Input
                  placeholder="Nombre del instrumento"
                  value={newInvestmentDraft.label}
                  onChange={(event) => setNewInvestmentDraft((prev) => ({ ...prev, label: event.target.value }))}
                />
                <Select
                  options={currencyOptions.filter((item) => item.value !== 'UF')}
                  value={newInvestmentDraft.currency}
                  onChange={(event) =>
                    setNewInvestmentDraft((prev) => ({ ...prev, currency: event.target.value as WealthCurrency }))
                  }
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Monto inicial (opcional)"
                  value={newInvestmentDraft.amount}
                  onChange={(event) => setNewInvestmentDraft((prev) => ({ ...prev, amount: event.target.value }))}
                />
                <Input
                  placeholder="Nota (opcional)"
                  value={newInvestmentDraft.note}
                  onChange={(event) => setNewInvestmentDraft((prev) => ({ ...prev, note: event.target.value }))}
                />
                <Button
                  disabled={!newInvestmentDraft.label.trim()}
                  onClick={() => {
                    const amountNum = Number(String(newInvestmentDraft.amount || '').replace(/,/g, '.'));
                    onCreateInvestmentInstrument({
                      label: newInvestmentDraft.label,
                      currency: newInvestmentDraft.currency,
                      amount:
                        Number.isFinite(amountNum) && amountNum > 0
                          ? amountNum
                          : undefined,
                      note: newInvestmentDraft.note.trim() || undefined,
                    });
                    setOpenCreateInvestmentModal(false);
                  }}
                >
                  Crear instrumento
                </Button>
              </Card>
            </div>
          </div>
        </>
      )}

      {openLoadPanel && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={closeLoadPanel}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
              <Card className="p-4 space-y-3 max-h-[84vh] overflow-y-auto shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {activeSourceContext ? `Cargar ${activeSourceContext.title}` : 'Cargar información'}
                  </div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={closeLoadPanel}
                  >
                    <X size={14} />
                  </button>
                </div>

                {quickFill ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Ingresar valor</div>
                    <div className="text-xs text-slate-600">{quickFill.label}</div>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Monto"
                      value={quickFill.amount}
                      onChange={(e) => setQuickFill({ ...quickFill, amount: e.target.value })}
                    />
                    <div className="text-[11px] text-slate-500">Moneda: {quickFill.currency}</div>
                    <Input
                      placeholder="Nota (opcional)"
                      value={quickFill.note || ''}
                      onChange={(e) => setQuickFill({ ...quickFill, note: e.target.value })}
                    />
                    <Button onClick={saveQuickFill}>Guardar</Button>
                  </div>
                ) : multiQuickFill ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Ingresar valores</div>
                    <div className="text-xs text-slate-600">{multiQuickFill.source}</div>
                    <div className="space-y-2">
                      {multiQuickFill.entries.map((entry, idx) => (
                        <div key={`${entry.label}-${idx}`} className="rounded-lg border border-slate-200 p-2 space-y-2">
                          <div className="text-xs font-medium text-slate-700">{entry.label}</div>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Monto"
                            value={entry.amount}
                            onChange={(e) => {
                              const next = [...multiQuickFill.entries];
                              next[idx] = { ...next[idx], amount: e.target.value };
                              setMultiQuickFill({ ...multiQuickFill, entries: next });
                            }}
                          />
                          <div className="text-[11px] text-slate-500">Moneda: {entry.currency}</div>
                        </div>
                      ))}
                    </div>
                    <Button onClick={saveMultiQuickFill}>Guardar</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FileScan size={16} /> Carga OCR
                    </div>

                    <button
                      className="h-10 rounded-xl border border-slate-200 px-3 flex items-center justify-center gap-2 text-sm cursor-pointer hover:bg-slate-50"
                      onClick={() => openImagePicker()}
                    >
                      <Camera size={16} /> Seleccionar imagen
                    </button>

                    {activeSourceContext ? (
                      <div className="text-[11px] text-slate-500">Fuente fija: {activeSourceContext.title}</div>
                    ) : (
                      <details>
                        <summary className="text-xs text-slate-500 cursor-pointer">Opciones avanzadas</summary>
                        <div className="mt-2 space-y-2">
                          <Select
                            options={sourceOptionsBySection[section]}
                            value={sourceHint}
                            onChange={(e) => setSourceHint(e.target.value)}
                          />
                        </div>
                      </details>
                    )}

                    {ocrProgress && <div className="text-xs text-slate-500">Leyendo: {ocrProgress.pct}%</div>}
                    {ocrError && <div className="text-xs text-red-600">{ocrError}</div>}
                    {!!suggestions.length && (
                      <div className="space-y-2">
                    {suggestions.map((item, idx) => (
                      <div key={`${item.label}-${idx}`} className="rounded-xl border border-slate-200 p-2 space-y-2">
                        <Input
                          value={item.label}
                          onChange={(e) => {
                            const next = [...suggestions];
                            next[idx].label = e.target.value;
                            setSuggestions(next);
                          }}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          {section === 'real_estate' ? (
                            <Select
                              options={realEstateBlockOptions}
                              value={item.block}
                              onChange={(e) => {
                                const next = [...suggestions];
                                next[idx].block = e.target.value as WealthBlock;
                                setSuggestions(next);
                              }}
                            />
                          ) : (
                            <Input disabled value={sectionLabel[section]} />
                          )}
                          <Select
                            options={currencyOptions}
                            value={item.currency}
                            onChange={(e) => {
                              const next = [...suggestions];
                              next[idx].currency = e.target.value as WealthCurrency;
                              setSuggestions(next);
                            }}
                          />
                        </div>
                        <Input
                          type="number"
                          value={item.amount}
                          onChange={(e) => {
                            const next = [...suggestions];
                            next[idx].amount = Number(e.target.value) || 0;
                            setSuggestions(next);
                          }}
                        />
                        <div className="text-[11px] text-slate-500">
                          {formatCurrency(item.amount, item.currency)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => saveSuggestion(item, idx)}>
                            Guardar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSuggestions((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={saveAllSuggestions}>
                        Guardar todo
                      </Button>
                      <Button variant="outline" onClick={() => setSuggestions([])}>
                        Limpiar lista
                      </Button>
                    </div>
                      </div>
                    )}

                    {section !== 'investment' && (
                      <details>
                        <summary className="text-sm font-medium cursor-pointer">Carga manual (secundario)</summary>
                        <div className="mt-2 space-y-2">
                          {editingId && <div className="text-xs text-blue-700">Editando registro</div>}
                          <Input
                            placeholder="Nombre del activo"
                            value={draft.label}
                            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            {section === 'real_estate' ? (
                              <Select
                                options={realEstateBlockOptions}
                                value={draft.block}
                                onChange={(e) => setDraft({ ...draft, block: e.target.value as WealthBlock })}
                              />
                            ) : (
                              <Input disabled value={sectionLabel[section]} />
                            )}
                            <Select
                              options={currencyOptions}
                              value={draft.currency}
                              onChange={(e) => setDraft({ ...draft, currency: e.target.value as WealthCurrency })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              placeholder="Monto"
                              value={draft.amount}
                              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                            />
                            <Input
                              type="date"
                              value={draft.snapshotDate}
                              onChange={(e) => setDraft({ ...draft, snapshotDate: e.target.value })}
                            />
                          </div>
                          <Input
                            placeholder="Fuente"
                            value={draft.source}
                            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                          />
                          <Button onClick={saveDraft}>Guardar registro</Button>
                        </div>
                      </details>
                    )}

                    {!!ocrText && (
                      <details className="text-xs text-slate-500">
                        <summary className="cursor-pointer">Texto OCR (opcional)</summary>
                        <pre className="whitespace-pre-wrap break-words mt-2 max-h-56 overflow-auto bg-slate-50 p-2 rounded-lg">
                          {ocrText}
                        </pre>
                      </details>
                    )}
                  </>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

    </div>
  );
};

export const Patrimonio: React.FC = () => {
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => loadClosures());
  const [investmentInstruments, setInvestmentInstruments] = useState<WealthInvestmentInstrument[]>(() =>
    loadInvestmentInstruments(),
  );
  const [fx, setFx] = useState(() => loadFxRates());
  const [hydrationReady, setHydrationReady] = useState(false);

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [activeSection, setActiveSection] = useState<MainSection | null>(null);
  const [carryMessage, setCarryMessage] = useState('');
  const [closeError, setCloseError] = useState('');
  const [closeInfo, setCloseInfo] = useState('');
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeMonthDraft, setCloseMonthDraft] = useState(currentMonthKey());

  const [showSummary, setShowSummary] = useState(false);
  const [showNetWorth, setShowNetWorth] = useState(false);
  const [visibleMainCards, setVisibleMainCards] = useState<Record<MainSection, boolean>>({
    investment: false,
    real_estate: false,
    bank: false,
  });
  const [displayCurrency, setDisplayCurrency] = useState<WealthCurrency>(() => readPreferredDisplayCurrency());
  const autoCarryAppliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!closeConfirmOpen) setCloseMonthDraft(monthKey);
  }, [monthKey, closeConfirmOpen]);

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_DISPLAY_CURRENCY_KEY, displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    setCarryMessage('');
  }, [activeSection]);

  useEffect(() => {
    let runningRefresh = false;
    const refreshFromCloudNow = async () => {
      if (runningRefresh) return;
      runningRefresh = true;
      try {
        await hydrateWealthFromCloud();
        setRecords(loadWealthRecords());
        setClosures(loadClosures());
        setInvestmentInstruments(loadInvestmentInstruments());
        setFx(loadFxRates());
      } finally {
        runningRefresh = false;
      }
    };

    const goPatrimonioHome = () => {
      setActiveSection(null);
      setCarryMessage('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      void refreshFromCloudNow();
    };

    window.addEventListener(NAVIGATE_PATRIMONIO_HOME_EVENT, goPatrimonioHome as EventListener);
    return () => {
      window.removeEventListener(NAVIGATE_PATRIMONIO_HOME_EVENT, goPatrimonioHome as EventListener);
    };
  }, []);

  useEffect(() => {
    const refreshFromLocal = () => {
      setRecords(loadWealthRecords());
      setClosures(loadClosures());
      setInvestmentInstruments(loadInvestmentInstruments());
      setFx(loadFxRates());
    };
    const onStorage = () => refreshFromLocal();
    const onWealthUpdated = () => {
      refreshFromLocal();
    };
    const refreshFx = () => setFx(loadFxRates());

    window.addEventListener('storage', onStorage);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await hydrateWealthFromCloud();
      if (!alive) return;
      setRecords(loadWealthRecords());
      setClosures(loadClosures());
      setInvestmentInstruments(loadInvestmentInstruments());
      setFx(loadFxRates());
      setHydrationReady(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const monthRecords = useMemo(() => latestRecordsForMonth(records, monthKey), [records, monthKey]);
  const summary = useMemo(() => summarizeWealth(monthRecords, fx), [monthRecords, fx]);

  const metrics = useMemo(() => {
    const points = monthPoints(closures, monthKey, summary.netConsolidatedClp);
    const idx = points.findIndex((p) => p.key === monthKey);
    const prev = idx > 0 ? points[idx - 1] : null;
    const monthIncrease = prev ? points[idx].net - prev.net : null;

    const deltas: number[] = [];
    for (let i = 1; i < points.length; i += 1) deltas.push(points[i].net - points[i - 1].net);

    return {
      monthIncrease,
      avg12: average(deltas.slice(-12)),
      avgSinceStart: average(deltas),
    };
  }, [closures, monthKey, summary.netConsolidatedClp]);

  const latestClosure = closures[0] || null;
  const previousClosure = closures[1] || null;

  const growthVsPrevClosure = useMemo(() => {
    if (!latestClosure || !previousClosure) return null;
    const current = latestClosure.summary.netConsolidatedClp;
    const prev = previousClosure.summary.netConsolidatedClp;
    const abs = current - prev;
    const pct = prev !== 0 ? (abs / prev) * 100 : null;
    return { abs, pct };
  }, [latestClosure, previousClosure]);
  const selectedClosureForDraft = useMemo(
    () => closures.find((closure) => closure.monthKey === closeMonthDraft) || null,
    [closures, closeMonthDraft],
  );
  const recentCloseWarning = useMemo(() => {
    if (!latestClosure) return null;
    const latestTs = new Date(latestClosure.closedAt).getTime();
    if (!Number.isFinite(latestTs)) return null;
    const days = (Date.now() - latestTs) / (1000 * 60 * 60 * 24);
    if (days >= 30) return null;
    if (latestClosure.monthKey === closeMonthDraft) return null;
    return `El último cierre fue hace ${Math.max(0, Math.floor(days))} día(s). Confirma que quieres cerrar ${monthLabel(closeMonthDraft).toLowerCase()}.`;
  }, [latestClosure, closeMonthDraft]);

  const sectionAmounts = useMemo(() => {
    const breakdown = buildWealthNetBreakdown(monthRecords, fx);
    return {
      investment: breakdown.investmentClp,
      bank: breakdown.bankClp,
      realEstateNet: breakdown.realEstateNetClp,
      nonMortgageDebt: breakdown.nonMortgageDebtClp,
      financialNet: breakdown.bankClp - breakdown.nonMortgageDebtClp,
    };
  }, [monthRecords, fx]);

  const sectionAmountsDisplay = useMemo(() => {
    const convert = (valueClp: number) => fromClp(valueClp, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
    return {
      investment: convert(sectionAmounts.investment),
      bank: convert(sectionAmounts.bank),
      realEstateNet: convert(sectionAmounts.realEstateNet),
      nonMortgageDebt: convert(sectionAmounts.nonMortgageDebt),
      financialNet: convert(sectionAmounts.financialNet),
    };
  }, [displayCurrency, fx.eurClp, fx.ufClp, fx.usdClp, sectionAmounts]);

  const metricsDisplay = useMemo(() => {
    const convert = (value: number | null) => {
      if (value === null) return null;
      return fromClp(value, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
    };

    const formatted = (value: number | null) => {
      if (value === null) return 'Sin base';
      const prefix = value >= 0 ? '+' : '';
      return `${prefix}${formatCurrency(value, displayCurrency)}`;
    };

    return {
      netWorth: formatCurrency(
        fromClp(summary.netConsolidatedClp, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp),
        displayCurrency,
      ),
      monthIncrease: formatted(convert(metrics.monthIncrease)),
      avg12: formatted(convert(metrics.avg12)),
      avgSinceStart: formatted(convert(metrics.avgSinceStart)),
    };
  }, [displayCurrency, fx, metrics, summary.netConsolidatedClp]);

  const missingCriticalCount = useMemo(() => {
    const requiredNames = [...sectionChecklist.investment, ...REAL_ESTATE_CORE_NET_LABELS];
    return requiredNames.filter((required) => {
      return !monthRecords.some((record) => {
        if (record.block === 'bank' || isSyntheticAggregateRecord(record)) return false;
        return sameCanonicalLabel(record.label, required);
      });
    }).length;
  }, [monthRecords]);

  const latestClosureDisplay = useMemo(() => {
    if (!latestClosure) return null;
    return fromClp(latestClosure.summary.netConsolidatedClp, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
  }, [displayCurrency, fx.eurClp, fx.ufClp, fx.usdClp, latestClosure]);

  const growthVsPrevClosureDisplay = useMemo(() => {
    if (!growthVsPrevClosure) return null;
    return {
      abs: fromClp(growthVsPrevClosure.abs, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp),
      pct: growthVsPrevClosure.pct,
    };
  }, [displayCurrency, fx.eurClp, fx.ufClp, fx.usdClp, growthVsPrevClosure]);
  const hasRealEstateCoreInputs = useMemo(() => {
    let hasProperty = false;
    let hasMortgageDebt = false;

    monthRecords.forEach((record) => {
      if (isSyntheticAggregateRecord(record)) return;
      if (record.block === 'real_estate' && sameCanonicalLabel(record.label, 'Valor propiedad')) {
        hasProperty = true;
      }
      if (record.block === 'debt' && sameCanonicalLabel(record.label, 'Saldo deuda hipotecaria')) {
        hasMortgageDebt = true;
      }
    });

    return hasProperty && hasMortgageDebt;
  }, [monthRecords]);

  const toggleMainCardVisibility = (section: MainSection) => {
    setVisibleMainCards((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const hiddenAmountPill = (tone: 'amber' | 'green' | 'sky') => {
    const toneClass =
      tone === 'amber'
        ? 'bg-amber-50/45 text-amber-900'
        : tone === 'green'
          ? 'bg-emerald-50/45 text-emerald-900'
          : 'bg-sky-50/45 text-sky-900';
    return (
      <span className={`relative inline-flex items-center rounded-md px-3 py-1.5 ${toneClass}`}>
        <span className="absolute inset-0 rounded-md bg-white/40 blur-[2px]" />
        <span className="relative tracking-[0.18em] blur-[1.6px]">8.888.888</span>
      </span>
    );
  };

  const refreshRecords = () => setRecords(loadWealthRecords());
  const refreshClosures = () => setClosures(loadClosures());
  const refreshInstruments = () => setInvestmentInstruments(loadInvestmentInstruments());
  const completeMonthlyClose = (targetMonthKey: string) => {
    const targetRecords = latestRecordsForMonth(records, targetMonthKey);
    setCloseError('');
    setCloseInfo('');
    setCloseConfirmOpen(false);
    createMonthlyClosure(targetRecords, fx, toCloseDateFromMonthKey(targetMonthKey));
    refreshClosures();
  };

  const recordsForSection = useMemo(() => {
    if (!activeSection) return [];
    if (activeSection === 'real_estate') {
      return monthRecords.filter((record) => {
        if (record.block === 'real_estate') return true;
        if (record.block !== 'debt') return false;
        const label = normalizeForMatch(record.label);
        return REAL_ESTATE_DEBT_LABELS.some((item) => normalizeForMatch(item) === label);
      });
    }
    if (activeSection === 'bank') {
      return monthRecords.filter((r) => {
        if (r.block === 'bank') return true;
        if (r.block !== 'debt') return false;
        const source = normalizeForMatch(r.source);
        const label = normalizeForMatch(r.label);
        return source.includes('fintoc') || label.includes('tarjeta') || MANUAL_CARD_ITEMS.some((item) => normalizeForMatch(item.label) === label);
      });
    }
    return monthRecords.filter((r) => r.block === activeSection);
  }, [activeSection, monthRecords]);

  const createInvestmentInstrument = (input: {
    label: string;
    currency: WealthCurrency;
    amount?: number;
    note?: string;
  }) => {
    const instrument = upsertInvestmentInstrument({
      label: input.label,
      currency: input.currency,
      note: input.note,
    });
    if (!instrument) return;

    if (typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0) {
      upsertWealthRecord({
        block: 'investment',
        source: 'Instrumento manual',
        label: instrument.label,
        amount: input.amount,
        currency: instrument.currency,
        note: input.note || undefined,
        snapshotDate: `${monthKey}-01`,
      });
    }
    refreshRecords();
    refreshInstruments();
    setCarryMessage('');
  };

  const setInvestmentExcludedForMonth = (instrumentId: string, targetMonthKey: string, excluded: boolean) => {
    const updated = setInvestmentInstrumentMonthExcluded(instrumentId, targetMonthKey, excluded);
    if (!updated) return;

    if (excluded) {
      const next = loadWealthRecords().filter(
        (record) =>
          !(
            record.block === 'investment' &&
            record.snapshotDate.startsWith(`${targetMonthKey}-`) &&
            record.currency === updated.currency &&
            normalizeForMatch(record.label) === normalizeForMatch(updated.label)
          ),
      );
      saveWealthRecords(next);
    }

    refreshRecords();
    refreshInstruments();
    return updated;
  };

  const setInvestmentExcluded = (instrumentId: string, excluded: boolean) => {
    const updated = setInvestmentExcludedForMonth(instrumentId, monthKey, excluded);
    if (!updated) return;
    setCarryMessage(
      excluded
        ? `"${updated.label}" quedó excluido de ${monthLabel(monthKey).toLowerCase()}.`
        : `"${updated.label}" volvió a considerarse en ${monthLabel(monthKey).toLowerCase()}.`,
    );
  };

  const evaluateCloseValidation = (targetMonthKey: string): { issues: CloseValidationIssue[]; targetRecords: WealthRecord[] } => {
    const issues: CloseValidationIssue[] = [];
    const targetRecords = latestRecordsForMonth(records, targetMonthKey);
    const realCurrentMonth = currentMonthKey();

    if (targetMonthKey > realCurrentMonth) {
      issues.push({
        type: 'future_month',
        level: 'error',
        label: `No se puede cerrar un mes futuro (${monthLabel(targetMonthKey).toLowerCase()}). Mes actual: ${monthLabel(realCurrentMonth).toLowerCase()}.`,
        section: 'investment',
      });
      return { issues, targetRecords };
    }

    const requiredInvestment = new Set(sectionChecklist.investment.map((label) => normalizeForMatch(label)));
    const requiredNames = [...sectionChecklist.investment, ...sectionChecklist.real_estate];
    requiredNames.forEach((required) => {
      const exists = targetRecords.some((record) => {
        if (record.block === 'bank' || isSyntheticAggregateRecord(record)) return false;
        return sameCanonicalLabel(record.label, required);
      });
      if (exists) return;
      issues.push({
        type: 'missing_required_value',
        level: 'error',
        label: required,
        section: requiredInvestment.has(normalizeForMatch(required)) ? 'investment' : 'real_estate',
        canResolveWithPrevious: true,
      });
    });

    investmentInstruments.forEach((instrument) => {
      if ((instrument.excludedMonths || []).includes(targetMonthKey)) return;
      const exists = targetRecords.some(
        (record) =>
          record.block === 'investment' &&
          record.currency === instrument.currency &&
          normalizeForMatch(record.label) === normalizeForMatch(instrument.label),
      );
      if (exists) return;
      issues.push({
        type: 'incomplete_new_source',
        level: 'error',
        label: instrument.label,
        section: 'investment',
        instrumentId: instrument.id,
        canResolveWithPrevious: true,
        canExcludeThisMonth: true,
      });
    });

    const carriedLabels = Array.from(
      new Set(
        targetRecords
          .filter(
            (record) =>
              isCarriedRecord(record) &&
              (record.block === 'investment' ||
                record.block === 'real_estate' ||
                (record.block === 'debt' && isMortgagePrincipalLabel(record.label))),
          )
          .map((record) => record.label),
      ),
    );

    carriedLabels.forEach((label) => {
      const isInvestment = requiredInvestment.has(normalizeForMatch(label)) || !!investmentInstruments.find(
        (instrument) => normalizeForMatch(instrument.label) === normalizeForMatch(label),
      );
      issues.push({
        type: 'carried_value_unconfirmed',
        level: 'warning',
        label,
        section: isInvestment ? 'investment' : 'real_estate',
      });
    });

    return { issues, targetRecords };
  };

  const closeValidationDraft = useMemo(
    () => evaluateCloseValidation(closeMonthDraft),
    [closeMonthDraft, records, investmentInstruments],
  );

  const resolveCloseIssueWithPrevious = (issue: CloseValidationIssue) => {
    if (!issue.canResolveWithPrevious) return;
    const result = fillMissingWithPreviousClosure(closeMonthDraft, todayYmd(), [issue.label]);
    refreshRecords();
    if (result.added > 0) {
      setCloseError('');
      setCloseInfo(`Completado con mes anterior: "${issue.label}" (base ${result.sourceMonth || 'sin mes'}).`);
      return;
    }
    setCloseInfo('');
    setCloseError(`No pude completar "${issue.label}" con mes anterior (sin base o ya estaba cargado).`);
  };

  const resolveCloseIssueExclude = (issue: CloseValidationIssue) => {
    if (!issue.canExcludeThisMonth || !issue.instrumentId) return;
    const updated = setInvestmentExcludedForMonth(issue.instrumentId, closeMonthDraft, true);
    if (!updated) {
      setCloseInfo('');
      setCloseError(`No pude excluir "${issue.label}" para ${monthLabel(closeMonthDraft).toLowerCase()}.`);
      return;
    }
    setCloseError('');
    setCloseInfo(`"${issue.label}" quedó excluido en ${monthLabel(closeMonthDraft).toLowerCase()}.`);
  };

  const reviewCloseIssue = (issue: CloseValidationIssue) => {
    setCloseConfirmOpen(false);
    setMonthKey(closeMonthDraft);
    setActiveSection(issue.section);
    setCloseInfo('');
    setCloseError(`Revisa "${issue.label}" en ${sectionLabel[issue.section].toLowerCase()}.`);
  };

  const attemptMonthlyClose = (targetMonthKey: string) => {
    const evaluation = evaluateCloseValidation(targetMonthKey);
    const blocking = evaluation.issues.filter((issue) => issue.level === 'error');
    const carried = evaluation.issues.filter((issue) => issue.type === 'carried_value_unconfirmed');

    if (blocking.length) {
      if (blocking[0].type === 'future_month') {
        setCloseInfo('');
        setCloseError(blocking[0].label);
        return;
      }
      const preview = blocking.slice(0, 3).map((issue) => issue.label).join(', ');
      const suffix = blocking.length > 3 ? ` (+${blocking.length - 3})` : '';
      setCloseInfo('');
      setCloseError(`No se puede cerrar: faltan ${blocking.length} ítem(s) (${preview}${suffix}).`);
      return;
    }

    completeMonthlyClose(targetMonthKey);
    if (carried.length) {
      setCarryMessage(
        `Cierre realizado con ${carried.length} valor(es) arrastrados de mes anterior. Puedes actualizarlos luego para el mes en curso.`,
      );
    }
  };

  const runMonthlyClose = () => {
    setCloseError('');
    setCloseInfo('');
    setCloseMonthDraft(monthKey);
    setCloseConfirmOpen(true);
  };

  const closeBlockingIssues = useMemo(
    () => closeValidationDraft.issues.filter((issue) => issue.level === 'error'),
    [closeValidationDraft],
  );
  const closeWarningIssues = useMemo(
    () => closeValidationDraft.issues.filter((issue) => issue.level === 'warning'),
    [closeValidationDraft],
  );

  const useMissingFromPrevious = (section: MainSection, itemName?: string) => {
    const isSingleItem = !!itemName;
    const isRealEstate = section === 'real_estate';
    const init = isRealEstate && !isSingleItem ? ensureInitialMortgageDefaults(monthKey, todayYmd()) : { added: 0 };
    const result = fillMissingWithPreviousClosure(monthKey, todayYmd(), itemName ? [itemName] : undefined);
    const auto = isRealEstate && !isSingleItem
      ? applyMortgageAutoCalculation(monthKey, todayYmd())
      : { changed: 0, sourceMonth: null, reason: null };
    refreshRecords();

    if (isSingleItem) {
      if (!result.sourceMonth) {
        setCarryMessage(`No hay cierre anterior disponible para completar "${itemName}".`);
        return;
      }
      if (result.added > 0) {
        setCarryMessage(`Completado con mes anterior: "${itemName}" (base ${result.sourceMonth}).`);
        return;
      }
      setCarryMessage(`"${itemName}" ya estaba actualizado o no existe en el cierre ${result.sourceMonth}.`);
      return;
    }

    if (!result.sourceMonth) {
      if (init.added > 0 || auto.changed > 0) {
        setCarryMessage('Base hipotecaria inicial cargada automáticamente.');
        return;
      }
      setCarryMessage('No hay un cierre anterior con detalle para completar pendientes.');
      return;
    }

    if (isRealEstate && !result.added && !auto.changed && auto.reason === 'missing_base_debt') {
      setCarryMessage('Sin cierre previo y sin base de deuda: ingresa manualmente "Saldo deuda hipotecaria" para iniciar el autocálculo.');
      return;
    }

    if (!result.added && !auto.changed) {
      setCarryMessage(`No había pendientes para completar desde ${result.sourceMonth}.`);
      return;
    }

    const parts: string[] = [];
    if (result.added) parts.push(`Se completaron ${result.added} pendientes con mes anterior (${result.sourceMonth})`);
    if (isRealEstate && auto.changed) parts.push(`Autocálculo hipotecario aplicado en ${auto.changed} registros`);
    setCarryMessage(`${parts.join('. ')}. Variación simulada hasta actualizar valores reales.`);
  };

  const applyMortgageAutoNow = () => {
    const auto = applyMortgageAutoCalculation(monthKey, todayYmd());
    refreshRecords();
    if (auto.changed > 0) {
      setCarryMessage(`Autocálculo hipotecario aplicado en ${auto.changed} registros (base ${auto.sourceMonth}).`);
      return;
    }
    if (auto.reason === 'missing_base_debt') {
      setCarryMessage('No pude aplicar autocálculo: primero ingresa manualmente "Saldo deuda hipotecaria" de este mes como base inicial.');
      return;
    }
    if (!auto.sourceMonth) {
      setCarryMessage('No pude aplicar autocálculo: falta un cierre anterior con registros.');
      return;
    }
    setCarryMessage(`No hubo cambios por autocálculo (ya había datos actualizados en este mes).`);
  };

  useEffect(() => {
    if (!hydrationReady) return;
    const realCurrentMonth = currentMonthKey();
    if (monthKey !== realCurrentMonth) return;
    if (autoCarryAppliedRef.current.has(monthKey)) return;
    autoCarryAppliedRef.current.add(monthKey);

    const currentMonthRecordCount = latestRecordsForMonth(loadWealthRecords(), monthKey).length;
    if (currentMonthRecordCount > 0) return;

    const init = ensureInitialMortgageDefaults(monthKey, todayYmd());
    if (init.added > 0) {
      refreshRecords();
      setCarryMessage(`Base hipotecaria inicial aplicada (${init.added} registros).`);
      return;
    }

    const result = fillMissingWithPreviousClosure(monthKey, todayYmd());
    const auto = applyMortgageAutoCalculation(monthKey, todayYmd());
    if (result.added > 0 || auto.changed > 0) {
      refreshRecords();
      const parts: string[] = [];
      if (result.added > 0 && result.sourceMonth) {
        parts.push(`Mes iniciado con ${result.added} arrastres (${result.sourceMonth})`);
      }
      if (auto.changed > 0) {
        parts.push(`Autocálculo hipotecario aplicado en ${auto.changed} registros`);
      }
      setCarryMessage(`${parts.join('. ')}.`);
      return;
    }

    const previousMonth = loadClosures().find((item) => item.monthKey < monthKey && (item.records?.length || 0) > 0);
    if (previousMonth) {
      setCarryMessage(`No se pudo arrastrar automáticamente desde ${previousMonth.monthKey}. Revisa cierres previos.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, hydrationReady]);

  if (activeSection) {
    return (
      <div className="p-4">
        <SectionScreen
          section={activeSection}
          monthKey={monthKey}
          recordsForSection={recordsForSection}
          investmentInstruments={investmentInstruments}
          usdClp={fx.usdClp}
          eurClp={fx.eurClp}
          ufClp={fx.ufClp}
          carryMessage={carryMessage}
          onBack={() => {
            setActiveSection(null);
            setCarryMessage('');
          }}
          onDataChanged={() => {
            refreshRecords();
            refreshInstruments();
            setCarryMessage('');
          }}
          onCreateInvestmentInstrument={createInvestmentInstrument}
          onSetInvestmentExcluded={setInvestmentExcluded}
          onUseMissing={useMissingFromPrevious}
          onApplyMortgageAuto={applyMortgageAutoNow}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card className="relative overflow-hidden border-0 p-5 bg-gradient-to-br from-[#103c35] via-[#165347] to-[#1f4a3a] text-white shadow-[0_16px_36px_rgba(11,38,34,0.55)]">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_#c59a6c_0%,_transparent_46%)]" />
        <div className="relative">
          <div className="text-xs uppercase tracking-[0.22em] text-[#f3eadb]">Aurum Wealth</div>
          <div className="mt-1 text-sm text-[#e0d6c5]">Resumen estratégico {monthLabel(monthKey).toLowerCase()}</div>

          {!showSummary ? (
            <div className="mt-6 flex justify-center">
              <button
                className="px-3 py-1 rounded-full bg-[#f3eadb]/10 border border-[#c59a6c]/40 text-xs text-[#f1e7d6] shadow-sm"
                onClick={() => setShowSummary(true)}
              >
                Resumen oculto
              </button>
            </div>
          ) : (
            <>
              <button
                className="absolute top-0 right-0 text-xs text-[#efe4d1]"
                onClick={() => {
                  setShowSummary(false);
                  setShowNetWorth(false);
                  setVisibleMainCards({
                    investment: false,
                    real_estate: false,
                    bank: false,
                  });
                }}
              >
                Ocultar
              </button>

              <div className="mt-4 grid grid-cols-[1fr_auto] gap-3 text-xs">
                <div className="space-y-2">
                  <button
                    className="w-full rounded-xl bg-[#f6efe3]/10 p-3 text-left min-h-[72px] border border-[#c59a6c]/25"
                    onClick={() => setShowNetWorth((v) => !v)}
                  >
                    <div className="text-[#e7dcc9] text-[11px] uppercase tracking-wide">Patrimonio total neto</div>
                    <div className="mt-1 text-3xl font-bold leading-none tracking-tight flex items-center gap-2">
                      {showNetWorth ? (
                        <>
                          <span>{metricsDisplay.netWorth}</span>
                          {missingCriticalCount > 0 && (
                            <span className="rounded-full border border-[#c59a6c]/70 bg-[#a97747]/20 px-2 py-0.5 text-[10px] font-semibold text-[#f3eadb]">
                              Parcial
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="relative inline-block select-none align-middle">
                          <span className="absolute inset-0 rounded-md bg-[#f3eadb]/18 blur-sm" />
                          <span className="absolute inset-0 rounded-md bg-[#f3eadb]/14 blur-md" />
                          <span className="absolute inset-0 rounded-md bg-[#f3eadb]/10 blur-lg" />
                          <span className="relative inline-block rounded-md bg-[#f3eadb]/10 px-3 py-1.5 text-xl tracking-[0.2em] blur-[2.6px]">
                            8.888.888.888
                          </span>
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="rounded-xl border border-[#c59a6c]/30 bg-[#f6efe3]/12 p-3">
                    <div className="text-[#e7dcc9] text-[11px] uppercase tracking-wide">Incremento mensual</div>
                    <div className="mt-1 text-xl font-semibold">{metricsDisplay.monthIncrease}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-[#f6efe3]/10 p-3">
                      <div className="text-[#e7dcc9] text-[11px]">Promedio 12M</div>
                      <div className="mt-1 text-sm font-semibold">{metricsDisplay.avg12}</div>
                    </div>
                    <div className="rounded-xl bg-[#f6efe3]/10 p-3">
                      <div className="text-[#e7dcc9] text-[11px]">Promedio desde inicio</div>
                      <div className="mt-1 text-sm font-semibold">{metricsDisplay.avgSinceStart}</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {(['CLP', 'USD', 'EUR'] as WealthCurrency[]).map((curr) => (
                    <button
                      key={curr}
                      className={`px-3 py-2 rounded-lg border text-xs ${
                        displayCurrency === curr
                          ? 'bg-[#f3eadb] text-[#1d3c33] border-[#f3eadb]/70'
                          : 'bg-[#f3eadb]/10 text-[#f3eadb] border-[#c59a6c]/45'
                      }`}
                      onClick={() => setDisplayCurrency(curr)}
                    >
                      {curr}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border-0 bg-gradient-to-br from-[#f3b179] to-[#d87d3f] p-4 text-left shadow-[0_10px_22px_rgba(165,96,42,0.28)] transition">
          <div className="flex items-start justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#5a2f16]">
              <Landmark size={16} /> Inversiones
            </div>
            <button
              className="text-[10px] rounded-md border border-[#7f4927]/25 bg-white/35 px-1.5 py-0.5 text-[#5a2f16]"
              onClick={() => toggleMainCardVisibility('investment')}
              type="button"
            >
              {visibleMainCards.investment ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          <button
            type="button"
            className="mt-2 w-full text-left text-2xl font-bold leading-tight text-[#5a2f16]"
            onClick={() => toggleMainCardVisibility('investment')}
          >
            {visibleMainCards.investment
              ? formatCurrency(sectionAmountsDisplay.investment, displayCurrency)
              : hiddenAmountPill('amber')}
          </button>
          <div className="mt-1 text-[11px] text-[#6b3a1f]">Consolidado en {displayCurrency}</div>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 text-xs text-[#6b3a1f]"
            onClick={() => setActiveSection('investment')}
          >
            Entrar <ArrowRight size={13} />
          </button>
        </div>

        <div className="rounded-2xl border-0 bg-gradient-to-br from-[#b6cf9f] to-[#6f8f5d] p-4 text-left shadow-[0_10px_22px_rgba(74,102,64,0.26)] transition">
          <div className="flex items-start justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f3e2d]">
              <Home size={16} /> Bienes raíces (neto)
            </div>
            <button
              className="text-[10px] rounded-md border border-[#2d5a3b]/25 bg-white/35 px-1.5 py-0.5 text-[#1f3e2d]"
              onClick={() => toggleMainCardVisibility('real_estate')}
              type="button"
            >
              {visibleMainCards.real_estate ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          {hasRealEstateCoreInputs ? (
            <>
              <button
                type="button"
                className="mt-2 w-full text-left text-2xl font-bold leading-tight text-[#1f3e2d]"
                onClick={() => toggleMainCardVisibility('real_estate')}
              >
                {visibleMainCards.real_estate
                  ? formatCurrency(sectionAmountsDisplay.realEstateNet, displayCurrency)
                  : hiddenAmountPill('green')}
              </button>
              <div className="mt-1 text-[11px] text-[#275238]">Consolidado en {displayCurrency}</div>
            </>
          ) : (
            <div className="mt-2 text-[11px] text-[#275238]">Completa inputs para mostrar total</div>
          )}
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 text-xs text-[#275238]"
            onClick={() => setActiveSection('real_estate')}
          >
            Entrar <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-sky-200 bg-sky-50 p-4 text-left shadow-sm transition">
        <div className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-sky-900">
              <Building2 size={16} /> Bancos
            </div>
            <button
              type="button"
              className="mt-1 text-left text-xl font-bold text-sky-900"
              onClick={() => toggleMainCardVisibility('bank')}
            >
              {visibleMainCards.bank
                ? formatCurrency(sectionAmountsDisplay.bank, displayCurrency)
                : hiddenAmountPill('sky')}
            </button>
            {visibleMainCards.bank ? (
              <>
                <div className="text-xs text-sky-700">
                  Deudas no hipotecarias: {formatCurrency(-sectionAmountsDisplay.nonMortgageDebt, displayCurrency)}
                </div>
                <div className="text-[11px] text-sky-700/90">
                  Neto financiero: {formatCurrency(sectionAmountsDisplay.financialNet, displayCurrency)}
                </div>
              </>
            ) : (
              <div className="text-xs text-sky-700/90">Toca el monto para revelar</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              className="text-[10px] rounded-md border border-sky-300 bg-white/70 px-1.5 py-0.5 text-sky-800"
              onClick={() => toggleMainCardVisibility('bank')}
              type="button"
            >
              {visibleMainCards.bank ? 'Ocultar' : 'Ver'}
            </button>
            <Wallet size={18} className="text-sky-700" />
          </div>
        </div>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 text-xs text-sky-800"
          onClick={() => setActiveSection('bank')}
        >
          Entrar <ArrowRight size={13} />
        </button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cierre mensual manual</div>
          <Button size="sm" onClick={runMonthlyClose}>
            Cerrar mes
          </Button>
        </div>
        {!!closeInfo && <div className="text-xs text-emerald-700">{closeInfo}</div>}
        {!!closeError && <div className="text-xs text-red-700">{closeError}</div>}

        {latestClosure && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Último cierre: {latestClosure.monthKey}</div>
            <div>
              Neto consolidado:{' '}
              {formatCurrency(latestClosureDisplay ?? latestClosure.summary.netConsolidatedClp, displayCurrency)}
            </div>
            {growthVsPrevClosureDisplay && (
              <div className={growthVsPrevClosureDisplay.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                vs cierre anterior: {growthVsPrevClosureDisplay.abs >= 0 ? '+' : ''}
                {formatCurrency(growthVsPrevClosureDisplay.abs, displayCurrency)}
                {growthVsPrevClosureDisplay.pct !== null ? ` (${growthVsPrevClosureDisplay.pct.toFixed(2)}%)` : ''}
              </div>
            )}
          </div>
        )}

        <details>
          <summary className="text-xs text-slate-500 cursor-pointer">Cambiar mes de visualización</summary>
          <div className="mt-2">
            <Input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value || currentMonthKey())} />
          </div>
        </details>
      </Card>

      {closeConfirmOpen && (
        <div className="fixed inset-0 z-[90] bg-black/40 p-4 flex items-end sm:items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="text-base font-semibold text-slate-900">Confirmar cierre mensual</div>
            <div className="mt-1 text-sm text-slate-600">Selecciona el mes que quieres cerrar y resuelve bloqueos aquí mismo.</div>

            <div className="mt-3">
              <label className="text-xs text-slate-600">Mes a cerrar</label>
              <Input
                type="month"
                value={closeMonthDraft}
                onChange={(e) => setCloseMonthDraft(e.target.value || monthKey)}
              />
            </div>

            {selectedClosureForDraft && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Este mes ya tiene cierre ({selectedClosureForDraft.monthKey}). Si continúas, se sobrescribirá.
              </div>
            )}

            {recentCloseWarning && (
              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                {recentCloseWarning}
              </div>
            )}
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Bloqueos: {closeBlockingIssues.length} · Advertencias: {closeWarningIssues.length}
            </div>

            {!!closeBlockingIssues.length && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2">
                <div className="text-xs font-semibold text-red-800">Debes resolver estos bloqueos antes de cerrar:</div>
                <div className="mt-2 space-y-2">
                  {closeBlockingIssues.map((issue, idx) => (
                    <div key={`close-block-${issue.type}-${issue.label}-${idx}`} className="rounded border border-red-200 bg-white p-2">
                      <div className="text-xs text-red-700">{issue.label}</div>
                      {issue.type !== 'future_month' && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {issue.canResolveWithPrevious && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resolveCloseIssueWithPrevious(issue)}
                            >
                              Usar mes anterior
                            </Button>
                          )}
                          {issue.canExcludeThisMonth && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resolveCloseIssueExclude(issue)}
                            >
                              Excluir este mes
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => reviewCloseIssue(issue)}>
                            Revisar bloque
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!!closeWarningIssues.length && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
                <div className="text-xs font-semibold text-amber-800">
                  Advertencia: hay valores arrastrados de mes anterior (puedes cerrar igual)
                </div>
                <div className="mt-2 max-h-28 overflow-auto text-xs text-amber-800 space-y-1">
                  {closeWarningIssues.map((issue, idx) => (
                    <div key={`close-warn-${issue.type}-${issue.label}-${idx}`} className="flex items-center justify-between gap-2">
                      <span>{issue.label}</span>
                      <Button size="sm" variant="outline" onClick={() => reviewCloseIssue(issue)}>
                        Revisar
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!!closeInfo && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {closeInfo}
              </div>
            )}

            {!!closeError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {closeError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCloseConfirmOpen(false);
                  setCloseError('');
                  setCloseInfo('');
                }}
              >
                Cancelar
              </Button>
              <Button onClick={() => attemptMonthlyClose(closeMonthDraft)} disabled={closeBlockingIssues.length > 0}>
                {selectedClosureForDraft
                  ? closeWarningIssues.length
                    ? 'Sobrescribir con arrastres'
                    : 'Sobrescribir cierre'
                  : closeWarningIssues.length
                    ? 'Cerrar con arrastres'
                    : 'Confirmar cierre'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
