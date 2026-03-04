import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  FileScan,
  Home,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { Button, Card, Input, Select } from '../components/Components';
import { runOcrFromFile } from '../services/ocr';
import { parseWealthFromOcrText, ParsedWealthSuggestion } from '../services/wealthParsers';
import { FintocAccountNormalized, discoverFintocData, FintocDiscoverResponse, syncFintocAccounts } from '../services/bankApi';
import {
  WealthBlock,
  WealthCurrency,
  WealthMonthlyClosure,
  WealthRecord,
  createMonthlyClosure,
  currentMonthKey,
  applyMortgageAutoCalculation,
  FX_RATES_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  fillMissingWithPreviousClosure,
  hydrateWealthFromCloud,
  ensureInitialMortgageDefaults,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
  removeWealthRecord,
  summarizeWealth,
  upsertWealthRecord,
} from '../services/wealthStorage';

type MainSection = 'investment' | 'real_estate' | 'bank';
const PREFERRED_DISPLAY_CURRENCY_KEY = 'aurum.preferred.display.currency';

const sectionLabel: Record<MainSection, string> = {
  investment: 'Inversiones',
  real_estate: 'Bienes raíces',
  bank: 'Bancos',
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
  real_estate: ['Valor propiedad', 'Saldo deuda hipotecaria', 'Dividendo hipotecario mensual'],
  bank: ['Saldo bancos CLP', 'Saldo bancos USD'],
};
type BankProviderId = 'bchile' | 'scotia' | 'santander';

const BANK_PROVIDERS: Array<{ id: BankProviderId; label: string }> = [
  { id: 'bchile', label: 'Banco de Chile' },
  { id: 'scotia', label: 'Scotiabank' },
  { id: 'santander', label: 'Santander' },
];

const FINTOC_LINK_TOKEN_KEY = 'aurum.fintoc.link_token';
const FINTOC_BANK_TOKENS_KEY = 'aurum.fintoc.bank_tokens.v1';
const FINTOC_SYNC_PREFIX_ACCOUNT = 'Cuenta bancaria:';
const FINTOC_SYNC_PREFIX_CARD = 'Tarjeta crédito:';
const FINTOC_SYNC_PREFIX_BANK_TOTAL = 'Saldo bancos ';
const FINTOC_SYNC_PREFIX_CARD_TOTAL = 'Deuda tarjetas ';
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

const todayYmd = () => new Date().toISOString().slice(0, 10);
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

const readBankTokens = (): Partial<Record<BankProviderId, string>> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FINTOC_BANK_TOKENS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeBankTokens = (tokens: Partial<Record<BankProviderId, string>>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FINTOC_BANK_TOKENS_KEY, JSON.stringify(tokens));
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
  usdClp: number;
  eurClp: number;
  ufClp: number;
  carryMessage: string;
  onBack: () => void;
  onDataChanged: () => void;
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
  snapshotDate: string;
}

interface BankMovementsModalState {
  bank: string;
  currency: WealthCurrency;
}

const SectionScreen: React.FC<SectionScreenProps> = ({
  section,
  monthKey,
  recordsForSection,
  usdClp,
  eurClp,
  ufClp,
  carryMessage,
  onBack,
  onDataChanged,
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
  const [openLoadPanel, setOpenLoadPanel] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fintocSyncing, setFintocSyncing] = useState(false);
  const [fintocStatus, setFintocStatus] = useState('');
  const [fintocDiscovering, setFintocDiscovering] = useState(false);
  const [fintocDiscovery, setFintocDiscovery] = useState<FintocDiscoverResponse | null>(null);
  const [fintocLastSync, setFintocLastSync] = useState<{
    assets: FintocAccountNormalized[];
    cards: FintocAccountNormalized[];
  } | null>(null);
  const [bankTokens, setBankTokens] = useState<Partial<Record<BankProviderId, string>>>(() => readBankTokens());
  const [movementsModal, setMovementsModal] = useState<BankMovementsModalState | null>(null);

  useEffect(() => {
    if (section !== 'bank') return;
    const legacy = (window.localStorage.getItem(FINTOC_LINK_TOKEN_KEY) || '').trim();
    if (!legacy || bankTokens.bchile) return;
    const nextTokens = { ...bankTokens, bchile: legacy };
    setBankTokens(nextTokens);
    writeBankTokens(nextTokens);
  }, [section, bankTokens]);

  const sectionTotalClp = useMemo(() => {
    return recordsForSection.reduce((sum, item) => {
      const signed = item.block === 'debt' ? -item.amount : item.amount;
      return sum + toClp(signed, item.currency, usdClp, eurClp, ufClp);
    }, 0);
  }, [recordsForSection, usdClp, eurClp, ufClp]);

  const bankDashboard = useMemo(() => {
    if (section !== 'bank') {
      return {
        bankClp: 0,
        bankUsd: 0,
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

    const bankDetails = recordsForSection.filter(
      (r) => r.block === 'bank' && MANUAL_BANK_ITEMS.some((i) => i.label === r.label),
    );
    const cardDetails = recordsForSection.filter(
      (r) =>
        r.block === 'debt' &&
        (r.label.startsWith(FINTOC_SYNC_PREFIX_CARD) || MANUAL_CARD_ITEMS.some((i) => i.label === r.label)),
    );

    const bankClp = bankDetails.filter((r) => r.currency === 'CLP').reduce((sum, r) => sum + r.amount, 0);
    const bankUsd = bankDetails.filter((r) => r.currency === 'USD').reduce((sum, r) => sum + r.amount, 0);

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
    return { bankClp, bankUsd, movements: allMovements };
  }, [section, recordsForSection, fintocLastSync, fintocDiscovery]);

  const modalMovements = useMemo(() => {
    if (!movementsModal) return [];
    const targetBank = normalizeForMatch(movementsModal.bank);
    return bankDashboard.movements.filter((movement) => {
      if (movement.currency !== movementsModal.currency) return false;
      const movementBank = normalizeForMatch(movement.bank);
      return movementBank.includes(targetBank) || targetBank.includes(movementBank);
    });
  }, [bankDashboard.movements, movementsModal]);

  const normalizeSuggestionBlock = (block: WealthBlock): WealthBlock => {
    if (section === 'real_estate') return block === 'debt' ? 'debt' : 'real_estate';
    return getSectionBlock(section);
  };
  const suggestionKey = (item: Pick<EditableSuggestion, 'block' | 'source' | 'label' | 'currency'>) =>
    `${item.block}::${normalizeForMatch(item.source)}::${normalizeForMatch(item.label)}::${item.currency}`;

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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
    const itemSource = normalizeForMatch(item.source);
    const itemLabel = normalizeForMatch(item.label);
    const existing = recordsForSection.find(
      (r) =>
        r.block === item.block &&
        r.currency === item.currency &&
        normalizeForMatch(r.source) === itemSource &&
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
    onDataChanged();
  };

  const saveAllSuggestions = () => {
    suggestions.forEach((item) => {
      const itemSource = normalizeForMatch(item.source);
      const itemLabel = normalizeForMatch(item.label);
      const existing = recordsForSection.find(
        (r) =>
          r.block === item.block &&
          r.currency === item.currency &&
          normalizeForMatch(r.source) === itemSource &&
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
    onDataChanged();
  };

  const checklistStatus = useMemo(() => {
    return sectionChecklist[section].map((name) => {
      const match = recordsForSection.find((r) => normalizeForMatch(r.label).includes(normalizeForMatch(name)));
      if (!match) {
        return { name, status: 'pendiente' as const, detail: 'Sin base previa' };
      }
      if (isCarriedRecord(match)) {
        return { name, status: 'mes_anterior' as const, detail: `Mes anterior (${match.snapshotDate})` };
      }
      if (isEstimatedRecord(match)) {
        return { name, status: 'estimado' as const, detail: `Estimado (${match.snapshotDate})` };
      }
      return { name, status: 'actualizado' as const, detail: `Actualizado ${match.snapshotDate}` };
    });
  }, [recordsForSection, section]);

  const isSectionComplete = useMemo(() => {
    return checklistStatus.every((row) => row.status !== 'pendiente');
  }, [checklistStatus]);

  const openChecklistItem = (name: string) => {
    const existing = recordsForSection.find((r) => normalizeForMatch(r.label).includes(normalizeForMatch(name)));
    const debtLabels = [
      'Saldo deuda hipotecaria',
      'Dividendo hipotecario mensual',
      'Interés hipotecario mensual',
      'Seguros hipotecarios mensuales',
      'Amortización hipotecaria mensual',
    ];
    const preferredBlock: WealthBlock =
      section === 'real_estate' && debtLabels.some((d) => normalizeForMatch(name).includes(normalizeForMatch(d)))
        ? 'debt'
        : section === 'real_estate'
          ? 'real_estate'
          : getSectionBlock(section);

    if (section === 'real_estate') {
      setQuickFill({
        id: existing?.id,
        block: preferredBlock,
        source: existing?.source || 'manual',
        label: existing?.label || name,
        amount: existing ? String(existing.amount) : '',
        currency: existing?.currency || 'UF',
        snapshotDate: existing?.snapshotDate || todayYmd(),
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
        label: name,
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
      snapshotDate: quickFill.snapshotDate,
    });
    setQuickFill(null);
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
    const fallbackLegacy =
      bankId === 'bchile' ? (window.localStorage.getItem(FINTOC_LINK_TOKEN_KEY) || '').trim() : '';
    const existing = (bankTokens[bankId] || fallbackLegacy || '').trim();
    if (existing && !forcePrompt) return existing;

    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const entered = window.prompt(`Pega link_token de Fintoc para ${bankName}`, existing)?.trim() || '';
    if (!entered) return '';

    const nextTokens = { ...readBankTokens(), ...bankTokens, [bankId]: entered };
    setBankTokens(nextTokens);
    writeBankTokens(nextTokens);
    window.localStorage.setItem(FINTOC_LINK_TOKEN_KEY, entered);
    return entered;
  };

  const runFintocSync = async (bankId: BankProviderId) => {
    if (section !== 'bank') return;
    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const linkToken = ensureBankToken(bankId);
    if (!linkToken) return;

    setFintocSyncing(true);
    setFintocStatus('');

    try {
      const result = await syncFintocAccounts(linkToken);
      if (!result.ok) {
        setFintocStatus(`Error API: ${result.error || 'No se pudo sincronizar.'}`);
        return;
      }

      const snapshotDate = todayYmd();
      const detectedInstitution = String(result.summary?.institution || bankName).trim() || bankName;
      const assets = result.accounts.filter((acc) => !isCreditCardAccount(acc)).map((acc) => ({ ...acc, bank: detectedInstitution }));
      const cards = result.accounts.filter((acc) => isCreditCardAccount(acc)).map((acc) => ({ ...acc, bank: detectedInstitution }));
      let syncedAssets = assets;
      let syncedCards = cards;
      const movementCount = result.accounts.reduce((sum, acc) => sum + (acc.movementCount || 0), 0);
      if (movementCount === 0) {
        const discovered = await discoverFintocData(linkToken);
        if (discovered.ok) {
          setFintocDiscovery(discovered);
          const discoveryBank = String(discovered.summary.institution || detectedInstitution).trim() || detectedInstitution;
          syncedAssets = discovered.accounts
            .filter((acc) => !isCreditCardAccount(acc))
            .map((acc) => ({ ...acc, bank: discoveryBank }));
          syncedCards = discovered.accounts
            .filter((acc) => isCreditCardAccount(acc))
            .map((acc) => ({ ...acc, bank: discoveryBank }));
        }
      }
      const bankTag = `[${detectedInstitution}]`;
      setFintocLastSync((prev) => ({
        assets: mergeAccounts(prev?.assets || [], syncedAssets),
        cards: mergeAccounts(prev?.cards || [], syncedCards),
      }));

      const staleFintocRows = recordsForSection.filter((record) => {
        const source = normalizeForMatch(record.source);
        if (!source.includes('fintoc')) return false;
        const label = record.label || '';
        return label.includes(bankTag);
      });
      staleFintocRows.forEach((row) => removeWealthRecord(row.id));

      const upsertByLabel = (
        block: WealthBlock,
        label: string,
        currency: WealthCurrency,
        amount: number,
        note?: string,
      ) => {
        const existing = recordsForSection.find(
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

      syncedAssets.forEach((account) => {
        const currency = toWealthCurrency(account.currency);
        if (!currency) return;
        const label = `${FINTOC_SYNC_PREFIX_ACCOUNT} ${bankTag}: ${account.name}${account.number ? ` · ${account.number}` : ''}`;
        const note = `Tipo: ${account.type || 'N/D'} · Movimientos: ${account.movementCount || 0}`;
        upsertByLabel('bank', label, currency, account.balance, note);
      });

      syncedCards.forEach((card) => {
        const currency = toWealthCurrency(card.currency);
        if (!currency) return;
        const label = `${FINTOC_SYNC_PREFIX_CARD} ${bankTag}: ${card.name}${card.number ? ` · ${card.number}` : ''}`;
        const note = `Tipo: ${card.type || 'N/D'} · Movimientos: ${card.movementCount || 0}`;
        upsertByLabel('debt', label, currency, Math.abs(card.balance), note);
      });

      const providerTotals = syncedAssets.reduce(
        (acc, account) => {
          const currency = toWealthCurrency(account.currency);
          if (!currency) return acc;
          if (currency === 'CLP') acc.clp += account.balance;
          if (currency === 'USD') acc.usd += account.balance;
          return acc;
        },
        { clp: 0, usd: 0 },
      );

      // Rellena automáticamente los bloques manuales por banco (los cuadros de abajo).
      const manualProviderPrefix = BANK_PROVIDERS.find((provider) => provider.id === bankId)?.label || bankName;
      upsertByLabel(
        'bank',
        `${manualProviderPrefix} CLP`,
        'CLP',
        providerTotals.clp,
        `API ${detectedInstitution} (${syncedAssets.length} cuentas)`,
      );
      upsertByLabel(
        'bank',
        `${manualProviderPrefix} USD`,
        'USD',
        providerTotals.usd,
        `API ${detectedInstitution} (${syncedAssets.length} cuentas)`,
      );

      const refreshedMonthRecords = latestRecordsForMonth(loadWealthRecords(), monthKey);
      const refreshedBankDetails = refreshedMonthRecords.filter((record) => {
        if (record.block !== 'bank') return false;
        return MANUAL_BANK_ITEMS.some((item) => item.label === record.label);
      });
      const refreshedCardDetails = refreshedMonthRecords.filter(
        (record) =>
          record.block === 'debt' &&
          (record.label.startsWith(FINTOC_SYNC_PREFIX_CARD) || MANUAL_CARD_ITEMS.some((item) => item.label === record.label)),
      );

      const totals = {
        bankClp: refreshedBankDetails.filter((record) => record.currency === 'CLP').reduce((sum, record) => sum + record.amount, 0),
        bankUsd: refreshedBankDetails.filter((record) => record.currency === 'USD').reduce((sum, record) => sum + record.amount, 0),
        cardClp: refreshedCardDetails.filter((record) => record.currency === 'CLP').reduce((sum, record) => sum + record.amount, 0),
        cardUsd: refreshedCardDetails.filter((record) => record.currency === 'USD').reduce((sum, record) => sum + record.amount, 0),
      };

      upsertByLabel('bank', 'Saldo bancos CLP', 'CLP', totals.bankClp, 'Calculado desde detalle de cuentas');
      upsertByLabel('bank', 'Saldo bancos USD', 'USD', totals.bankUsd, 'Calculado desde detalle de cuentas');
      upsertByLabel('debt', 'Deuda tarjetas CLP', 'CLP', totals.cardClp, 'Calculado desde detalle de tarjetas');
      upsertByLabel('debt', 'Deuda tarjetas USD', 'USD', totals.cardUsd, 'Calculado desde detalle de tarjetas');

      const detectedMovements = [...syncedAssets, ...syncedCards].reduce(
        (sum, account) => sum + (account.movementCount || 0),
        0,
      );
      onDataChanged();
      setFintocStatus(
        `Sincronizado ${detectedInstitution}: ${syncedAssets.length} cuentas + ${syncedCards.length} tarjetas (${detectedMovements} mov).`,
      );
    } catch (error: any) {
      setFintocStatus(`Error API: ${error?.message || 'No se pudo sincronizar.'}`);
    } finally {
      setFintocSyncing(false);
    }
  };

  const runFintocDiscovery = async (bankId: BankProviderId) => {
    if (section !== 'bank') return;
    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const linkToken = ensureBankToken(bankId);
    if (!linkToken) return;

    setFintocDiscovering(true);
    setFintocStatus('');
    setFintocDiscovery(null);

    try {
      const result = await discoverFintocData(linkToken);
      if (!result.ok) {
        setFintocStatus(`Error API: ${result.error || 'No se pudo explorar.'}`);
        return;
      }
      const snapshotDate = todayYmd();
      setFintocDiscovery(result);
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
        const existing = recordsForSection.find(
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
      onDataChanged();
      setFintocStatus(
        `Exploración ${discoveryBank}: ${result.summary.accounts} cuentas, ${result.summary.movements} movimientos.`,
      );
    } catch (error: any) {
      setFintocStatus(`Error API: ${error?.message || 'No se pudo explorar.'}`);
    } finally {
      setFintocDiscovering(false);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <Card className={`p-4 border-0 bg-gradient-to-br ${sectionTheme[section]} shadow-[0_12px_24px_rgba(15,23,42,0.18)]`}>
        <button className="inline-flex items-center gap-1 text-xs text-slate-600" onClick={onBack}>
          <ArrowLeft size={14} /> Volver
        </button>
        <div className="mt-2 text-lg font-bold text-slate-900">{sectionLabel[section]}</div>
        <div className="text-xs text-slate-600">{monthLabel(monthKey)}</div>
        {section === 'bank' ? (
          <div className="mt-3 text-sm font-medium text-slate-700">Vista informativa (no consolida patrimonio)</div>
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
              <div className="text-2xl font-bold">{formatCurrency(bankDashboard.bankClp, 'CLP')}</div>
            </div>
            <div className="rounded-xl p-3 text-white bg-gradient-to-r from-teal-600 to-sky-500 text-left">
              <div className="text-xs opacity-90">Total USD disponible</div>
              <div className="text-2xl font-bold">{formatCurrency(bankDashboard.bankUsd, 'USD')}</div>
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
                      const existing = recordsForSection.find((r) => r.label === item.label);
                      const bankMovementsCount = bankDashboard.movements.filter(
                        (movement) => movement.bank === group.bank && movement.currency === item.currency,
                      ).length;
                      return (
                        <button
                          key={item.label}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-left hover:bg-slate-100 relative"
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
                                snapshotDate: existing?.snapshotDate || todayYmd(),
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
                          <div className="text-[11px] text-slate-500 mt-1">
                            {bankMovementsCount ? `${bankMovementsCount} movimientos` : 'Sin movimientos'}
                          </div>
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
                      const existing = recordsForSection.find((r) => r.label === item.label);
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
                              snapshotDate: existing?.snapshotDate || todayYmd(),
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
                <div className="mt-3 space-y-1">
                  {!modalMovements.length && (
                    <div className="text-xs text-slate-500">
                      Sin movimientos detectados para este banco en {movementsModal.currency}.
                    </div>
                  )}
                  {modalMovements.slice(0, 30).map((mv, idx) => (
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
        <Card className="p-4 space-y-2">
          <div className="text-sm font-semibold">Cómo se compone</div>
          {recordsForSection.length === 0 && <div className="text-xs text-slate-500">Sin datos para este mes.</div>}
          {recordsForSection.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2 py-1">
              <div>
                <div className="font-medium text-slate-800">{item.label}</div>
                <div className="text-slate-500">{item.source} · {item.snapshotDate}</div>
                {item.note && <div className="text-[11px] text-slate-500">{item.note}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`font-semibold ${item.block === 'debt' ? 'text-red-700' : ''}`}
                  onClick={() => {
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
                  }}
                >
                  {item.block === 'debt' ? '-' : ''}
                  {formatCurrency(item.amount, item.currency)}
                </button>
                <button
                  className="text-slate-400 hover:text-blue-600"
                  onClick={() => {
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
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    removeWealthRecord(item.id);
                    onDataChanged();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-4 space-y-2">
        <div className="text-sm font-semibold">Checklist del bloque</div>
        {section === 'bank' ? (
          <div className="space-y-2">
            <div className="grid md:grid-cols-3 gap-2">
              {BANK_PROVIDERS.map((bank) => (
                <div key={bank.id} className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                  <div className="text-xs font-semibold text-slate-700">{bank.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Token: {bankTokens[bank.id] ? 'guardado' : 'pendiente'}
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => ensureBankToken(bank.id, true)}>
                      Token
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => runFintocDiscovery(bank.id)} disabled={fintocDiscovering}>
                      {fintocDiscovering ? '...' : 'Explorar'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => runFintocSync(bank.id)} disabled={fintocSyncing}>
                      {fintocSyncing ? '...' : 'Sync'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
              Completar pendientes con mes anterior
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
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
        {section === 'bank' && fintocDiscovery && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-600">
              Última exploración: <span className="font-medium">{fintocDiscovery.summary.institution}</span> ·{' '}
              {fintocDiscovery.summary.accounts} cuentas · {fintocDiscovery.summary.movements} movimientos
            </div>
            {!!fintocDiscovery.probes.length && (
              <details>
                <summary className="text-xs text-slate-500 cursor-pointer">Ver endpoints probados</summary>
                <div className="mt-2 space-y-1">
                  {fintocDiscovery.probes.map((probe, idx) => (
                    <div key={`${probe.endpoint}-${idx}`} className="text-[11px] text-slate-600">
                      [{probe.ok ? 'OK' : 'FAIL'} {probe.status}] {probe.endpoint} · items: {probe.items}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        {checklistStatus.map((row) => (
          <div key={row.name} className="w-full text-xs rounded-lg border border-slate-100 px-2 py-1 hover:bg-slate-50">
            <div className="flex items-center justify-between gap-2">
              <button className="text-left flex-1" onClick={() => openChecklistItem(row.name)}>
                <div>{row.name}</div>
                <div className="text-[11px] text-slate-500">{row.detail}</div>
              </button>
              {row.status === 'pendiente' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onUseMissing(section, row.name)}
                >
                  Usar mes anterior
                </Button>
              )}
              <span
                className={
                  row.status === 'actualizado'
                    ? 'text-emerald-700'
                    : row.status === 'mes_anterior'
                      ? 'text-amber-700'
                      : row.status === 'estimado'
                        ? 'text-indigo-700'
                        : 'text-red-700'
                }
              >
                {row.status === 'actualizado'
                  ? 'Actualizado'
                  : row.status === 'mes_anterior'
                    ? 'Mes anterior'
                    : row.status === 'estimado'
                      ? 'Estimado'
                      : 'Pendiente'}
              </span>
            </div>
          </div>
        ))}
      </Card>

      {openLoadPanel && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={() => {
              setOpenLoadPanel(false);
              setQuickFill(null);
            }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
              <Card className="p-4 space-y-3 max-h-[84vh] overflow-y-auto shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Cargar información</div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => {
                      setOpenLoadPanel(false);
                      setQuickFill(null);
                    }}
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
                    <Button onClick={saveQuickFill}>Guardar</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FileScan size={16} /> Carga OCR
                    </div>

                    <label className="h-10 rounded-xl border border-slate-200 px-3 flex items-center justify-center gap-2 text-sm cursor-pointer hover:bg-slate-50">
                      <Camera size={16} /> Seleccionar imagen
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />
                    </label>

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

      {!openLoadPanel && section !== 'real_estate' && (
        <button
          className="fixed right-5 bottom-24 h-14 w-14 rounded-full bg-[#4d5f3b] text-white shadow-lg flex items-center justify-center z-30"
          onClick={() => {
            setQuickFill(null);
            setOpenLoadPanel(true);
          }}
          aria-label="Sumar información"
        >
          <Plus size={22} />
        </button>
      )}
    </div>
  );
};

export const Patrimonio: React.FC = () => {
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => loadClosures());
  const [fx, setFx] = useState(() => loadFxRates());
  const [hydrationReady, setHydrationReady] = useState(false);

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [activeSection, setActiveSection] = useState<MainSection | null>(null);
  const [carryMessage, setCarryMessage] = useState('');
  const [closeError, setCloseError] = useState('');

  const [showSummary, setShowSummary] = useState(false);
  const [showNetWorth, setShowNetWorth] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<WealthCurrency>(() => readPreferredDisplayCurrency());
  const autoCarryAppliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_DISPLAY_CURRENCY_KEY, displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    const refreshFx = () => setFx(loadFxRates());
    const refreshAll = async () => {
      await hydrateWealthFromCloud();
      setRecords(loadWealthRecords());
      setClosures(loadClosures());
      refreshFx();
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
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
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
      setRecords(loadWealthRecords());
      setClosures(loadClosures());
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

  const sectionAmounts = useMemo(() => {
    const blockToClp = (block: WealthBlock) => {
      const b = summary.byBlock[block];
      return b.CLP + b.USD * fx.usdClp + b.EUR * fx.eurClp + b.UF * fx.ufClp;
    };

    return {
      investment: blockToClp('investment'),
      bank: blockToClp('bank'),
      realEstateNet: blockToClp('real_estate') - blockToClp('debt'),
    };
  }, [summary, fx]);

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

  const refreshRecords = () => setRecords(loadWealthRecords());
  const refreshClosures = () => setClosures(loadClosures());

  const recordsForSection = useMemo(() => {
    if (!activeSection) return [];
    if (activeSection === 'real_estate') {
      return monthRecords.filter((r) => r.block === 'real_estate' || r.block === 'debt');
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

  const runMonthlyClose = () => {
    const hasCarriedValues = monthRecords.some(
      (r) =>
        isCarriedRecord(r) && (r.block === 'investment' || r.block === 'real_estate' || r.block === 'debt'),
    );
    if (hasCarriedValues) {
      setCloseError('No se puede cerrar el mes: hay valores en estado "Mes anterior". Actualiza esos pendientes.');
      return;
    }
    setCloseError('');
    createMonthlyClosure(monthRecords, fx, toCloseDateFromMonthKey(monthKey));
    refreshClosures();
  };

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
    if (autoCarryAppliedRef.current.has(monthKey)) return;
    autoCarryAppliedRef.current.add(monthKey);

    const init = ensureInitialMortgageDefaults(monthKey, todayYmd());
    const result = fillMissingWithPreviousClosure(monthKey, todayYmd());
    const auto = applyMortgageAutoCalculation(monthKey, todayYmd());
    if (init.added > 0) {
      refreshRecords();
      setCarryMessage(`Base hipotecaria inicial aplicada (${init.added} registros).`);
      return;
    }
    if (result.added > 0) {
      refreshRecords();
      const msg = [
        `Completado automático: ${result.added} pendientes con mes anterior (${result.sourceMonth}).`,
        auto.changed ? `Autocálculo hipotecario aplicado en ${auto.changed} registros.` : '',
        'Actualiza lo nuevo del mes.',
      ]
        .filter(Boolean)
        .join(' ');
      setCarryMessage(msg);
      return;
    }
    if (auto.changed > 0) {
      refreshRecords();
      setCarryMessage(`Autocálculo hipotecario aplicado en ${auto.changed} registros.`);
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
            setCarryMessage('');
          }}
          onUseMissing={useMissingFromPrevious}
          onApplyMortgageAuto={applyMortgageAutoNow}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card className="relative overflow-hidden border-0 p-5 bg-gradient-to-br from-orange-800 via-amber-800 to-[#4d5f3b] text-white shadow-[0_16px_36px_rgba(78,61,21,0.50)]">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_top_right,_#fdba74_0%,_transparent_45%)]" />
        <div className="relative">
          <div className="text-xs uppercase tracking-[0.22em] text-orange-100">Aurum Wealth</div>
          <div className="mt-1 text-sm text-orange-100/90">Resumen estratégico {monthLabel(monthKey).toLowerCase()}</div>

          {!showSummary ? (
            <div className="mt-6 flex justify-center">
              <button
                className="px-3 py-1 rounded-full bg-white/12 border border-white/20 text-xs text-orange-100/90 shadow-sm"
                onClick={() => setShowSummary(true)}
              >
                Resumen oculto
              </button>
            </div>
          ) : (
            <>
              <button
                className="absolute top-0 right-0 text-xs text-orange-100/85"
                onClick={() => {
                  setShowSummary(false);
                  setShowNetWorth(false);
                }}
              >
                Ocultar
              </button>

              <div className="mt-4 grid grid-cols-[1fr_auto] gap-3 text-xs">
                <div className="space-y-2">
                  <button
                    className="w-full rounded-xl bg-white/12 p-3 text-left min-h-[72px]"
                    onClick={() => setShowNetWorth((v) => !v)}
                  >
                    <div className="text-orange-100">Patrimonio total neto</div>
                    <div className="mt-1 text-base font-semibold">
                      {showNetWorth ? (
                        metricsDisplay.netWorth
                      ) : (
                        <span className="inline-block rounded-md bg-white/20 px-2 py-1 blur-[1.4px] select-none">■■■■■■■■</span>
                      )}
                    </div>
                  </button>

                  <div className="rounded-xl bg-white/12 p-3">
                    <div className="text-orange-100">Incremento mensual vs mes anterior</div>
                    <div className="mt-1 text-base font-semibold">{metricsDisplay.monthIncrease}</div>
                  </div>

                  <div className="rounded-xl bg-white/12 p-3">
                    <div className="text-orange-100">Promedio mensual últimos 12 meses</div>
                    <div className="mt-1 text-base font-semibold">{metricsDisplay.avg12}</div>
                  </div>

                  <div className="rounded-xl bg-white/12 p-3">
                    <div className="text-orange-100">Promedio mensual desde inicio</div>
                    <div className="mt-1 text-base font-semibold">{metricsDisplay.avgSinceStart}</div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {(['CLP', 'USD', 'EUR'] as WealthCurrency[]).map((curr) => (
                    <button
                      key={curr}
                      className={`px-3 py-2 rounded-lg border border-white/20 text-xs ${displayCurrency === curr ? 'bg-white text-slate-900' : 'bg-white/8 text-white'}`}
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
        <button
          className="rounded-2xl border-0 bg-gradient-to-br from-[#f3b179] to-[#d87d3f] p-4 text-left shadow-[0_10px_22px_rgba(165,96,42,0.28)] hover:shadow-[0_12px_24px_rgba(165,96,42,0.34)] transition"
          onClick={() => setActiveSection('investment')}
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#5a2f16]">
            <Landmark size={16} /> Inversiones
          </div>
          <div className="mt-1 text-xs text-[#6b3a1f]">{formatCurrency(sectionAmounts.investment, 'CLP')}</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-[#6b3a1f]">
            Entrar <ArrowRight size={13} />
          </div>
        </button>

        <button
          className="rounded-2xl border-0 bg-gradient-to-br from-[#b6cf9f] to-[#6f8f5d] p-4 text-left shadow-[0_10px_22px_rgba(74,102,64,0.26)] hover:shadow-[0_12px_24px_rgba(74,102,64,0.33)] transition"
          onClick={() => setActiveSection('real_estate')}
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f3e2d]">
            <Home size={16} /> Bienes raíces
          </div>
          <div className="mt-1 text-xs text-[#275238]">{formatCurrency(sectionAmounts.realEstateNet, 'CLP')}</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-[#275238]">
            Entrar <ArrowRight size={13} />
          </div>
        </button>
      </div>

      <button
        className="w-full rounded-2xl border border-sky-200 bg-sky-50 p-4 text-left shadow-sm hover:shadow-md transition"
        onClick={() => setActiveSection('bank')}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-sky-900">
              <Building2 size={16} /> Bancos
            </div>
          </div>
          <Wallet size={18} className="text-sky-700" />
        </div>
      </button>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cierre mensual manual</div>
          <Button size="sm" onClick={runMonthlyClose}>
            Cerrar mes
          </Button>
        </div>
        {!!closeError && <div className="text-xs text-red-700">{closeError}</div>}

        {latestClosure && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Último cierre: {latestClosure.monthKey}</div>
            <div>Neto consolidado: {formatCurrency(latestClosure.summary.netConsolidatedClp, 'CLP')}</div>
            {growthVsPrevClosure && (
              <div className={growthVsPrevClosure.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                vs cierre anterior: {growthVsPrevClosure.abs >= 0 ? '+' : ''}
                {formatCurrency(growthVsPrevClosure.abs, 'CLP')}
                {growthVsPrevClosure.pct !== null ? ` (${growthVsPrevClosure.pct.toFixed(2)}%)` : ''}
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
    </div>
  );
};
