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
import {
  WealthBlock,
  WealthCurrency,
  WealthMonthlyClosure,
  WealthRecord,
  createMonthlyClosure,
  currentMonthKey,
  applyMortgageAutoCalculation,
  fillMissingWithPreviousClosure,
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
    { value: 'wise', label: 'Wise' },
    { value: 'global66', label: 'Global66' },
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
    'BTG total valorización',
    'Global66 Cuenta Vista USD',
    'Wise Cuenta principal USD',
  ],
  real_estate: ['Valor propiedad', 'Saldo deuda hipotecaria', 'Dividendo hipotecario mensual'],
  bank: ['Wise Cuenta principal USD', 'Global66 Cuenta Vista USD'],
};

const isCarriedRecord = (record: WealthRecord) => {
  return String(record.note || '').toLowerCase().includes('arrastrado');
};

const isEstimatedRecord = (record: WealthRecord) => {
  return String(record.note || '').toLowerCase().includes('estimado');
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
  onUseMissing: (section: MainSection) => void;
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

  const sectionTotalClp = useMemo(() => {
    return recordsForSection.reduce((sum, item) => {
      const signed = item.block === 'debt' ? -item.amount : item.amount;
      return sum + toClp(signed, item.currency, usdClp, eurClp, ufClp);
    }, 0);
  }, [recordsForSection, usdClp, eurClp, ufClp]);

  const normalizeSuggestionBlock = (block: WealthBlock): WealthBlock => {
    if (section === 'real_estate') return block === 'debt' ? 'debt' : 'real_estate';
    return getSectionBlock(section);
  };

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

      // Permite subir varias imágenes antes de guardar todo.
      setSuggestions((prev) => [...prev, ...parsed]);
    } catch (err: any) {
      setOcrError(err?.message || 'Error leyendo imagen');
    } finally {
      setOcrProgress(null);
      event.target.value = '';
    }
  };

  const saveSuggestion = (item: EditableSuggestion, idx?: number) => {
    const existing = recordsForSection.find(
      (r) =>
        r.block === item.block &&
        r.currency === item.currency &&
        r.source.toLowerCase() === item.source.toLowerCase() &&
        r.label.toLowerCase() === item.label.toLowerCase(),
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
      const existing = recordsForSection.find(
        (r) =>
          r.block === item.block &&
          r.currency === item.currency &&
          r.source.toLowerCase() === item.source.toLowerCase() &&
          r.label.toLowerCase() === item.label.toLowerCase(),
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
      const match = recordsForSection.find((r) => r.label.toLowerCase().includes(name.toLowerCase()));
      if (!match) {
        return { name, status: 'pendiente' as const, detail: 'Sin base previa' };
      }
      if (isCarriedRecord(match)) {
        return { name, status: 'arrastrado' as const, detail: `Desde cierre anterior (${match.snapshotDate})` };
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
    const existing = recordsForSection.find((r) => r.label.toLowerCase().includes(name.toLowerCase()));
    const debtLabels = [
      'Saldo deuda hipotecaria',
      'Dividendo hipotecario mensual',
      'Interés hipotecario mensual',
      'Seguros hipotecarios mensuales',
      'Amortización hipotecaria mensual',
    ];
    const preferredBlock: WealthBlock =
      section === 'real_estate' && debtLabels.some((d) => name.toLowerCase().includes(d.toLowerCase()))
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

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Checklist del bloque</div>
          <div className="flex items-center gap-2">
            {section === 'real_estate' && (
              <Button variant="outline" size="sm" onClick={onApplyMortgageAuto}>
                Autocálculo hipotecario
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
              Usar faltantes
            </Button>
          </div>
        </div>
        {!!carryMessage && <div className="text-xs text-blue-700">{carryMessage}</div>}
        {checklistStatus.map((row) => (
          <button
            key={row.name}
            className="w-full text-left flex items-center justify-between text-xs rounded-lg border border-slate-100 px-2 py-1 hover:bg-slate-50"
            onClick={() => openChecklistItem(row.name)}
          >
            <div>
              <div>{row.name}</div>
              <div className="text-[11px] text-slate-500">{row.detail}</div>
            </div>
            <span
              className={
                row.status === 'actualizado'
                  ? 'text-emerald-700'
                  : row.status === 'arrastrado'
                    ? 'text-amber-700'
                    : row.status === 'estimado'
                      ? 'text-indigo-700'
                      : 'text-red-700'
              }
            >
              {row.status === 'actualizado'
                ? 'Actualizado'
                : row.status === 'arrastrado'
                  ? 'Arrastrado'
                  : row.status === 'estimado'
                    ? 'Estimado'
                    : 'Pendiente'}
            </span>
          </button>
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
  const [fx] = useState(() => loadFxRates());

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
    return monthRecords.filter((r) => r.block === activeSection);
  }, [activeSection, monthRecords]);

  const runMonthlyClose = () => {
    const hasCarriedValues = monthRecords.some(
      (r) =>
        isCarriedRecord(r) && (r.block === 'investment' || r.block === 'real_estate' || r.block === 'debt'),
    );
    if (hasCarriedValues) {
      setCloseError('No se puede cerrar el mes: hay valores arrastrados del cierre anterior. Actualiza los faltantes.');
      return;
    }
    setCloseError('');
    createMonthlyClosure(monthRecords, fx, toCloseDateFromMonthKey(monthKey));
    refreshClosures();
  };

  const useMissingFromPrevious = (section: MainSection) => {
    const isRealEstate = section === 'real_estate';
    const init = isRealEstate ? ensureInitialMortgageDefaults(monthKey, todayYmd()) : { added: 0 };
    const result = fillMissingWithPreviousClosure(monthKey, todayYmd());
    const auto = isRealEstate
      ? applyMortgageAutoCalculation(monthKey, todayYmd())
      : { changed: 0, sourceMonth: null, reason: null };
    refreshRecords();

    if (!result.sourceMonth) {
      if (init.added > 0 || auto.changed > 0) {
        setCarryMessage('Base hipotecaria inicial cargada automáticamente.');
        return;
      }
      setCarryMessage('No hay un cierre anterior con detalle para arrastrar información.');
      return;
    }

    if (isRealEstate && !result.added && !auto.changed && auto.reason === 'missing_base_debt') {
      setCarryMessage('Sin cierre previo y sin base de deuda: ingresa manualmente "Saldo deuda hipotecaria" para iniciar el autocálculo.');
      return;
    }

    if (!result.added && !auto.changed) {
      setCarryMessage(`No faltaba información para arrastrar desde ${result.sourceMonth}.`);
      return;
    }

    const parts: string[] = [];
    if (result.added) parts.push(`Se arrastraron ${result.added} registros faltantes desde ${result.sourceMonth}`);
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
        `Arrastre automático aplicado: ${result.added} faltantes desde ${result.sourceMonth}.`,
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
  }, [monthKey]);

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
