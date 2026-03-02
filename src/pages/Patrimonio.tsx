import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  Eye,
  EyeOff,
  FileScan,
  Home,
  Landmark,
  Plus,
  Trash2,
  Wallet,
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
  fillMissingWithPreviousClosure,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
  removeWealthRecord,
  summarizeWealth,
  upsertWealthRecord,
} from '../services/wealthStorage';

type MainSection = 'investment' | 'real_estate' | 'bank';

const sectionLabel: Record<MainSection, string> = {
  investment: 'Inversiones',
  real_estate: 'Bienes raíces',
  bank: 'Bancos',
};

const sourceOptionsBySection: Record<MainSection, Array<{ value: string; label: string }>> = {
  investment: [
    { value: 'auto', label: 'Auto detectar' },
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
];

const realEstateBlockOptions = [
  { value: 'real_estate', label: 'Activo inmobiliario' },
  { value: 'debt', label: 'Deuda hipotecaria' },
];

const todayYmd = () => new Date().toISOString().slice(0, 10);

const formatCurrency = (value: number, currency: WealthCurrency) => {
  const locale = currency === 'CLP' ? 'es-CL' : 'es-ES';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'CLP' ? 0 : 2,
  }).format(value);
};

const formatClp = (value: number) => formatCurrency(value, 'CLP');

const formatDelta = (value: number | null) => {
  if (value === null) return 'Sin base';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${formatClp(value)}`;
};

const monthPoints = (closures: WealthMonthlyClosure[], currentKey: string, currentNet: number) => {
  const map = new Map<string, number>();
  for (const c of closures) map.set(c.monthKey, c.summary.netConsolidatedClp);
  map.set(currentKey, currentNet);
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, net]) => ({ key, net }));
};

const average = (arr: number[]) => {
  if (!arr.length) return null;
  return arr.reduce((sum, n) => sum + n, 0) / arr.length;
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
  currency: 'CLP',
  note: '',
  snapshotDate: todayYmd(),
});

interface EditableSuggestion extends ParsedWealthSuggestion {
  snapshotDate: string;
}

const getSectionBlock = (section: MainSection): WealthBlock => {
  if (section === 'investment') return 'investment';
  if (section === 'bank') return 'bank';
  return 'real_estate';
};

const blockTheme: Record<MainSection, string> = {
  investment: 'from-amber-100 to-yellow-50 border-amber-200',
  real_estate: 'from-slate-100 to-blue-50 border-slate-200',
  bank: 'from-sky-100 to-indigo-50 border-sky-200',
};

const toCloseDateFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, 1, 12, 0, 0, 0);
};

interface SectionScreenProps {
  section: MainSection;
  monthKey: string;
  recordsForSection: WealthRecord[];
  onBack: () => void;
  onDataChanged: () => void;
  onUseMissing: () => void;
  carryMessage: string;
}

const SectionScreen: React.FC<SectionScreenProps> = ({
  section,
  monthKey,
  recordsForSection,
  onBack,
  onDataChanged,
  onUseMissing,
  carryMessage,
}) => {
  const [sourceHint, setSourceHint] = useState('auto');
  const [ocrProgress, setOcrProgress] = useState<{ pct: number; status: string } | null>(null);
  const [ocrError, setOcrError] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [draft, setDraft] = useState<DraftRecord>(() => buildDraft(section));

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
      const text = await runOcrFromFile(file, (pct, status) => setOcrProgress({ pct, status }));
      setOcrText(text);

      const parsed = parseWealthFromOcrText(text, sourceHint).map((item) => ({
        ...item,
        block: normalizeSuggestionBlock(item.block),
        snapshotDate: todayYmd(),
      }));

      setSuggestions(parsed);
      if (!parsed.length) {
        setOcrError('No pude detectar montos claros. Intenta con una captura más enfocada.');
      }
    } catch (err: any) {
      setOcrError(err?.message || 'Error leyendo imagen');
      setSuggestions([]);
      setOcrText('');
    } finally {
      setOcrProgress(null);
      event.target.value = '';
    }
  };

  const saveSuggestion = (item: EditableSuggestion) => {
    upsertWealthRecord({
      block: item.block,
      source: item.source,
      label: item.label,
      amount: item.amount,
      currency: item.currency,
      note: item.note,
      snapshotDate: item.snapshotDate,
    });
    onDataChanged();
  };

  const saveDraft = () => {
    const amount = Number(draft.amount.replace(/,/g, '.'));
    if (!draft.label.trim() || !Number.isFinite(amount) || amount <= 0) return;

    upsertWealthRecord({
      block: draft.block,
      source: draft.source || 'manual',
      label: draft.label.trim(),
      amount,
      currency: draft.currency,
      note: draft.note.trim() || undefined,
      snapshotDate: draft.snapshotDate,
    });

    setDraft(buildDraft(section));
    onDataChanged();
  };

  return (
    <div className="space-y-4">
      <Card className={`p-4 border bg-gradient-to-br ${blockTheme[section]}`}>
        <button className="inline-flex items-center gap-1 text-xs text-slate-600" onClick={onBack}>
          <ArrowLeft size={14} /> Volver
        </button>
        <div className="mt-2 text-lg font-bold text-slate-900">{sectionLabel[section]}</div>
        <div className="text-xs text-slate-600">Mes {monthKey}</div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Carga de información</div>
          <Button variant="secondary" size="sm" onClick={onUseMissing}>
            Usar faltantes cierre anterior
          </Button>
        </div>

        {!!carryMessage && <div className="text-xs text-blue-700">{carryMessage}</div>}

        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileScan size={16} />
          OCR desde screenshot
        </div>

        <Select
          options={sourceOptionsBySection[section]}
          value={sourceHint}
          onChange={(e) => setSourceHint(e.target.value)}
        />

        <label className="h-10 rounded-xl border border-slate-200 px-3 flex items-center justify-center gap-2 text-sm cursor-pointer hover:bg-slate-50">
          <Camera size={16} />
          Subir imagen
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />
        </label>

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
                <Button size="sm" onClick={() => saveSuggestion(item)}>
                  Guardar
                </Button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => suggestions.forEach((s) => saveSuggestion(s))}>
              Guardar todo
            </Button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="text-sm font-semibold">Carga manual</div>
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
      </Card>

      <Card className="p-4 space-y-2">
        <div className="text-sm font-semibold">Registros del bloque</div>
        {recordsForSection.length === 0 && <div className="text-xs text-slate-500">Sin registros en este mes.</div>}
        {recordsForSection.map((item) => (
          <div key={item.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2 py-1">
            <div>
              <div className="font-medium text-slate-800">{item.label}</div>
              <div className="text-slate-500">{item.source} · {item.snapshotDate}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-semibold ${item.block === 'debt' ? 'text-red-700' : ''}`}>
                {item.block === 'debt' ? '-' : ''}
                {formatCurrency(item.amount, item.currency)}
              </span>
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

      {!!ocrText && (
        <Card className="p-4">
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Ver texto OCR</summary>
            <pre className="whitespace-pre-wrap break-words mt-2 max-h-56 overflow-auto bg-slate-50 p-2 rounded-lg">{ocrText}</pre>
          </details>
        </Card>
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

  const [showSummary, setShowSummary] = useState(false);
  const [showNetWorth, setShowNetWorth] = useState(false);

  const monthRecords = useMemo(() => latestRecordsForMonth(records, monthKey), [records, monthKey]);
  const summary = useMemo(() => summarizeWealth(monthRecords, fx), [monthRecords, fx]);

  const sectionAmounts = useMemo(() => {
    const toClp = (block: WealthBlock) => {
      const b = summary.byBlock[block];
      return b.CLP + b.USD * fx.usdClp + b.EUR * fx.eurClp;
    };

    return {
      investment: toClp('investment'),
      bank: toClp('bank'),
      realEstateNet: toClp('real_estate') - toClp('debt'),
    };
  }, [summary, fx]);

  const metrics = useMemo(() => {
    const points = monthPoints(closures, monthKey, summary.netConsolidatedClp);
    const selectedIdx = points.findIndex((p) => p.key === monthKey);
    const prev = selectedIdx > 0 ? points[selectedIdx - 1] : null;
    const monthIncrease = prev ? points[selectedIdx].net - prev.net : null;

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
    createMonthlyClosure(monthRecords, fx, toCloseDateFromMonthKey(monthKey));
    refreshClosures();
  };

  const useMissingFromPrevious = () => {
    const result = fillMissingWithPreviousClosure(monthKey, todayYmd());
    refreshRecords();

    if (!result.sourceMonth) {
      setCarryMessage('No hay un cierre anterior con detalle para arrastrar información.');
      return;
    }

    if (!result.added) {
      setCarryMessage(`No faltaba información para arrastrar desde ${result.sourceMonth}.`);
      return;
    }

    setCarryMessage(`Se arrastraron ${result.added} registros faltantes desde ${result.sourceMonth}.`);
  };

  if (activeSection) {
    return (
      <div className="p-4">
        <SectionScreen
          section={activeSection}
          monthKey={monthKey}
          recordsForSection={recordsForSection}
          carryMessage={carryMessage}
          onUseMissing={useMissingFromPrevious}
          onBack={() => {
            setActiveSection(null);
            setCarryMessage('');
          }}
          onDataChanged={() => {
            refreshRecords();
            setCarryMessage('');
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card className="relative overflow-hidden border-0 p-5 bg-gradient-to-br from-amber-900 via-yellow-800 to-stone-700 text-white shadow-[0_16px_36px_rgba(120,90,25,0.45)]">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_#fde68a_0%,_transparent_45%)]" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-amber-100">Aurum Wealth</div>
              <div className="mt-1 text-sm text-amber-100/90">Resumen estratégico ({monthKey})</div>
            </div>
            <button
              className="h-9 w-9 rounded-full bg-white/15 flex items-center justify-center"
              onClick={() => setShowSummary((v) => !v)}
              aria-label="Mostrar u ocultar resumen"
            >
              {showSummary ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {!showSummary && (
            <div className="mt-5 rounded-xl border border-white/20 bg-white/10 p-4">
              <div className="text-sm">Resumen oculto</div>
              <div className="text-xs text-amber-100/85 mt-1">Toca el ojo para desbloquear indicadores.</div>
            </div>
          )}

          {showSummary && (
            <>
              <div className="mt-4 rounded-xl border border-white/20 bg-black/15 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-amber-100">Patrimonio total</div>
                  <button
                    className="h-7 w-7 rounded-full bg-white/15 flex items-center justify-center"
                    onClick={() => setShowNetWorth((v) => !v)}
                    aria-label="Mostrar patrimonio total"
                  >
                    {showNetWorth ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">
                  {showNetWorth ? formatClp(summary.netConsolidatedClp) : '••••••••••'}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-white/12 p-3">
                  <div className="text-amber-100">Incremento mensual</div>
                  <div className="mt-1 text-base font-semibold">{formatDelta(metrics.monthIncrease)}</div>
                </div>
                <div className="rounded-xl bg-white/12 p-3">
                  <div className="text-amber-100">Promedio 12 meses</div>
                  <div className="mt-1 text-base font-semibold">{formatDelta(metrics.avg12)}</div>
                </div>
                <div className="rounded-xl bg-white/12 p-3">
                  <div className="text-amber-100">Promedio desde inicio</div>
                  <div className="mt-1 text-base font-semibold">{formatDelta(metrics.avgSinceStart)}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Mes de trabajo</div>
        <Input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value || currentMonthKey())} />
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <button
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left shadow-sm hover:shadow-md transition"
          onClick={() => setActiveSection('investment')}
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Landmark size={16} /> Inversiones
          </div>
          <div className="mt-1 text-xs text-amber-700">{formatClp(sectionAmounts.investment)}</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-amber-800">
            Entrar <ArrowRight size={13} />
          </div>
        </button>

        <button
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left shadow-sm hover:shadow-md transition"
          onClick={() => setActiveSection('real_estate')}
        >
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Home size={16} /> Bienes raíces
          </div>
          <div className="mt-1 text-xs text-slate-700">{formatClp(sectionAmounts.realEstateNet)}</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-slate-700">
            Entrar <ArrowRight size={13} />
          </div>
        </button>
      </div>

      <button
        className="w-full rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left shadow-sm hover:shadow-md transition"
        onClick={() => setActiveSection('bank')}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900">
              <Building2 size={16} /> Bancos
            </div>
            <div className="mt-1 text-xs text-blue-700">{formatClp(sectionAmounts.bank)}</div>
          </div>
          <Wallet size={18} className="text-blue-700" />
        </div>
      </button>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cierre mensual manual</div>
          <Button size="sm" onClick={runMonthlyClose}>
            Cerrar mes
          </Button>
        </div>

        {latestClosure && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Último cierre: {latestClosure.monthKey}</div>
            <div>Neto consolidado: {formatClp(latestClosure.summary.netConsolidatedClp)}</div>
            {growthVsPrevClosure && (
              <div className={growthVsPrevClosure.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                vs cierre anterior: {growthVsPrevClosure.abs >= 0 ? '+' : ''}
                {formatClp(growthVsPrevClosure.abs)}
                {growthVsPrevClosure.pct !== null ? ` (${growthVsPrevClosure.pct.toFixed(2)}%)` : ''}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
