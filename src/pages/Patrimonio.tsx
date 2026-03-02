import React, { useMemo, useState } from 'react';
import { ArrowRight, Camera, FileScan, Landmark, Plus, Trash2, Wallet } from 'lucide-react';
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

const currencyOptions = [
  { value: 'CLP', label: 'CLP' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

const debtOrRealEstateOptions = [
  { value: 'real_estate', label: 'Activo inmobiliario' },
  { value: 'debt', label: 'Deuda hipotecaria' },
];

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

interface DraftRecord {
  block: WealthBlock;
  source: string;
  label: string;
  amount: string;
  currency: WealthCurrency;
  note: string;
  snapshotDate: string;
}

const buildEmptyDraft = (section: MainSection): DraftRecord => ({
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

const normalizeSuggestionBlock = (section: MainSection, block: WealthBlock): WealthBlock => {
  if (section === 'real_estate') {
    if (block === 'debt') return 'debt';
    return 'real_estate';
  }
  if (section === 'investment') return 'investment';
  return 'bank';
};

const toCloseDateFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, 1, 12, 0, 0, 0);
};

export const Patrimonio: React.FC = () => {
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => loadClosures());
  const [fx] = useState(() => loadFxRates());

  const [monthKey, setMonthKey] = useState<string>(() => currentMonthKey());
  const [activeSection, setActiveSection] = useState<MainSection>('investment');
  const [sourceHint, setSourceHint] = useState<string>('auto');
  const [ocrProgress, setOcrProgress] = useState<{ pct: number; status: string } | null>(null);
  const [ocrError, setOcrError] = useState<string>('');
  const [ocrText, setOcrText] = useState<string>('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [draft, setDraft] = useState<DraftRecord>(() => buildEmptyDraft('investment'));
  const [carryMessage, setCarryMessage] = useState<string>('');

  const monthRecords = useMemo(() => latestRecordsForMonth(records, monthKey), [records, monthKey]);
  const summary = useMemo(() => summarizeWealth(monthRecords, fx), [monthRecords, fx]);

  const latestClosure = closures[0] || null;
  const previousClosure = closures[1] || null;

  const growthVsPrev = useMemo(() => {
    if (!latestClosure || !previousClosure) return null;
    const current = latestClosure.summary.netConsolidatedClp;
    const prev = previousClosure.summary.netConsolidatedClp;
    const abs = current - prev;
    const pct = prev !== 0 ? (abs / prev) * 100 : null;
    return { abs, pct };
  }, [latestClosure, previousClosure]);

  const refreshRecords = () => setRecords(loadWealthRecords());
  const refreshClosures = () => setClosures(loadClosures());

  const setSection = (section: MainSection) => {
    setActiveSection(section);
    setSourceHint('auto');
    setSuggestions([]);
    setDraft(buildEmptyDraft(section));
    setCarryMessage('');
    setOcrError('');
    setOcrText('');
  };

  const recordsForActiveSection = useMemo(() => {
    if (activeSection === 'real_estate') {
      return monthRecords.filter((r) => r.block === 'real_estate' || r.block === 'debt');
    }
    return monthRecords.filter((r) => r.block === activeSection);
  }, [activeSection, monthRecords]);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setOcrError('');
    setCarryMessage('');
    setOcrProgress({ pct: 0, status: 'iniciando' });

    try {
      const text = await runOcrFromFile(file, (pct, status) => setOcrProgress({ pct, status }));
      setOcrText(text);

      const parsed = parseWealthFromOcrText(text, sourceHint).map((item) => ({
        ...item,
        block: normalizeSuggestionBlock(activeSection, item.block),
        snapshotDate: todayYmd(),
      }));

      setSuggestions(parsed);
      if (!parsed.length) {
        setOcrError('No pude detectar montos claros. Prueba con una captura más cerca del saldo principal.');
      }
    } catch (err: any) {
      setOcrError(err?.message || 'Error leyendo la imagen.');
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
    refreshRecords();
  };

  const saveAllSuggestions = () => {
    suggestions.forEach((item) => saveSuggestion(item));
    setSuggestions([]);
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
      snapshotDate: draft.snapshotDate || todayYmd(),
    });

    refreshRecords();
    setDraft(buildEmptyDraft(activeSection));
  };

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

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-700 text-white border-0">
        <div className="flex items-center gap-2 text-sm text-slate-200">
          <Landmark size={16} />
          <span>Patrimonio neto ({monthKey})</span>
        </div>
        <div className="mt-2 text-2xl font-bold">{formatClp(summary.netConsolidatedClp)}</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-white/10 p-2">
            <div className="text-slate-200">CLP</div>
            <div className="font-semibold">{formatCurrency(summary.netByCurrency.CLP, 'CLP')}</div>
          </div>
          <div className="rounded-lg bg-white/10 p-2">
            <div className="text-slate-200">USD</div>
            <div className="font-semibold">{formatCurrency(summary.netByCurrency.USD, 'USD')}</div>
          </div>
          <div className="rounded-lg bg-white/10 p-2">
            <div className="text-slate-200">EUR</div>
            <div className="font-semibold">{formatCurrency(summary.netByCurrency.EUR, 'EUR')}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Mes de trabajo</div>
        <Input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value || currentMonthKey())} />
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <button
          className={`rounded-2xl border p-4 text-left ${
            activeSection === 'investment' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
          }`}
          onClick={() => setSection('investment')}
        >
          <div className="text-sm font-semibold text-slate-900">Inversiones</div>
          <div className="mt-1 text-xs text-slate-500">SURA, BTG, previsional, fondos</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-blue-700">
            Entrar <ArrowRight size={13} />
          </div>
        </button>

        <button
          className={`rounded-2xl border p-4 text-left ${
            activeSection === 'real_estate' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
          }`}
          onClick={() => setSection('real_estate')}
        >
          <div className="text-sm font-semibold text-slate-900">Bienes raíces</div>
          <div className="mt-1 text-xs text-slate-500">Valor, dividendo, deuda hipotecaria</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-blue-700">
            Entrar <ArrowRight size={13} />
          </div>
        </button>
      </div>

      <button
        className={`w-full rounded-2xl border p-4 text-left ${
          activeSection === 'bank' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
        }`}
        onClick={() => setSection('bank')}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Bancos</div>
            <div className="mt-1 text-xs text-slate-500">Wise, Global66 y cuentas corrientes</div>
          </div>
          <Wallet size={18} className="text-slate-500" />
        </div>
      </button>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Módulo: {sectionLabel[activeSection]}</div>
          <Button variant="secondary" size="sm" onClick={useMissingFromPrevious}>
            Usar info faltante cierre anterior
          </Button>
        </div>

        {!!carryMessage && <div className="text-xs text-blue-700">{carryMessage}</div>}

        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileScan size={16} />
          Subir screenshot (OCR)
        </div>

        <Select
          options={sourceOptionsBySection[activeSection]}
          value={sourceHint}
          onChange={(e) => setSourceHint(e.target.value)}
        />

        <label className="h-10 rounded-xl border border-slate-200 px-3 flex items-center justify-center gap-2 text-sm cursor-pointer hover:bg-slate-50">
          <Camera size={16} />
          Subir imagen
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />
        </label>

        {ocrProgress && (
          <div className="text-xs text-slate-500">
            Leyendo imagen: {ocrProgress.pct}% ({ocrProgress.status})
          </div>
        )}

        {ocrError && <div className="text-xs text-red-600">{ocrError}</div>}

        {!!suggestions.length && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-600">Sugerencias detectadas</div>
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
                  <Select
                    options={activeSection === 'real_estate' ? debtOrRealEstateOptions : [{ value: item.block, label: sectionLabel[activeSection] }]}
                    value={item.block}
                    onChange={(e) => {
                      const next = [...suggestions];
                      next[idx].block = e.target.value as WealthBlock;
                      setSuggestions(next);
                    }}
                  />
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
                  Guardar este
                </Button>
              </div>
            ))}
            <Button variant="secondary" onClick={saveAllSuggestions}>
              Guardar todo
            </Button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Agregar registro manual</div>
            <Plus size={16} className="text-slate-500" />
          </div>

          <Input
            placeholder="Nombre del activo"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />

          <div className="grid grid-cols-2 gap-2">
            {activeSection === 'real_estate' ? (
              <Select
                options={debtOrRealEstateOptions}
                value={draft.block}
                onChange={(e) => setDraft({ ...draft, block: e.target.value as WealthBlock })}
              />
            ) : (
              <Input value={sectionLabel[activeSection]} disabled />
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

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cierre mensual manual ({monthKey})</div>
          <Button size="sm" onClick={runMonthlyClose}>
            Cerrar mes
          </Button>
        </div>

        {latestClosure && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Último cierre: {latestClosure.monthKey}</div>
            <div>Neto consolidado: {formatClp(latestClosure.summary.netConsolidatedClp)}</div>
            {growthVsPrev && (
              <div className={growthVsPrev.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                vs cierre anterior: {growthVsPrev.abs >= 0 ? '+' : ''}
                {formatClp(growthVsPrev.abs)}
                {growthVsPrev.pct !== null ? ` (${growthVsPrev.pct.toFixed(2)}%)` : ''}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="text-sm font-semibold">{sectionLabel[activeSection]} ({monthKey})</div>
        {recordsForActiveSection.length === 0 && (
          <div className="text-xs text-slate-500">
            No hay datos en este bloque para el mes seleccionado. Puedes cargar imagen o usar faltantes desde el cierre anterior.
          </div>
        )}
        {recordsForActiveSection.map((item) => (
          <div key={item.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2 py-1">
            <div className="pr-2">
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
                  refreshRecords();
                }}
                aria-label="Eliminar registro"
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
            <pre className="whitespace-pre-wrap break-words mt-2 max-h-56 overflow-auto bg-slate-50 p-2 rounded-lg">
              {ocrText}
            </pre>
          </details>
        </Card>
      )}
    </div>
  );
};
