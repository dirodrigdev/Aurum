import React, { useMemo, useState } from 'react';
import { Camera, FileScan, Landmark, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Input, Select } from '../components/Components';
import { runOcrFromFile } from '../services/ocr';
import { parseWealthFromOcrText, ParsedWealthSuggestion } from '../services/wealthParsers';
import {
  WealthBlock,
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  WealthRecord,
  createMonthlyClosure,
  loadClosures,
  loadFxRates,
  loadWealthRecords,
  removeWealthRecord,
  saveFxRates,
  summarizeWealth,
  upsertWealthRecord,
} from '../services/wealthStorage';

const blockLabel: Record<WealthBlock, string> = {
  bank: 'Bancos',
  investment: 'Inversiones',
  real_estate: 'Bienes raíces',
  debt: 'Deudas',
};

const blockOptions = [
  { value: 'bank', label: 'Bancos' },
  { value: 'investment', label: 'Inversiones' },
  { value: 'real_estate', label: 'Bienes raíces' },
  { value: 'debt', label: 'Deudas' },
];

const currencyOptions = [
  { value: 'CLP', label: 'CLP' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

const sourceOptions = [
  { value: 'auto', label: 'Auto detectar' },
  { value: 'wise', label: 'Wise' },
  { value: 'global66', label: 'Global66' },
  { value: 'sura_resumen', label: 'SURA resumen' },
  { value: 'sura_detalle', label: 'SURA detalle' },
  { value: 'btg', label: 'BTG' },
  { value: 'dividendo', label: 'Dividendo hipotecario' },
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

interface DraftRecord {
  block: WealthBlock;
  source: string;
  label: string;
  amount: string;
  currency: WealthCurrency;
  note: string;
  snapshotDate: string;
}

const emptyDraft: DraftRecord = {
  block: 'investment',
  source: 'manual',
  label: '',
  amount: '',
  currency: 'CLP',
  note: '',
  snapshotDate: todayYmd(),
};

interface EditableSuggestion extends ParsedWealthSuggestion {
  snapshotDate: string;
}

export const Patrimonio: React.FC = () => {
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => loadClosures());
  const [fx, setFx] = useState<WealthFxRates>(() => loadFxRates());
  const [sourceHint, setSourceHint] = useState<string>('auto');
  const [ocrProgress, setOcrProgress] = useState<{ pct: number; status: string } | null>(null);
  const [ocrError, setOcrError] = useState<string>('');
  const [ocrText, setOcrText] = useState<string>('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [draft, setDraft] = useState<DraftRecord>(emptyDraft);

  const summary = useMemo(() => summarizeWealth(records, fx), [records, fx]);

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

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setOcrError('');
    setOcrProgress({ pct: 0, status: 'starting' });

    try {
      const text = await runOcrFromFile(file, (pct, status) => setOcrProgress({ pct, status }));
      setOcrText(text);

      const parsed = parseWealthFromOcrText(text, sourceHint).map((item) => ({
        ...item,
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
    setDraft(emptyDraft);
  };

  const runMonthlyClose = () => {
    createMonthlyClosure(records, fx, new Date());
    refreshClosures();
  };

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-700 text-white border-0">
        <div className="flex items-center gap-2 text-sm text-slate-200">
          <Landmark size={16} />
          <span>Patrimonio neto</span>
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
        <div className="text-sm font-semibold">Tipo de cambio para consolidado CLP</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">USD a CLP</div>
            <Input
              value={fx.usdClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, usdClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">EUR a CLP</div>
            <Input
              value={fx.eurClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, eurClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileScan size={16} />
          Cargar screenshot (OCR)
        </div>

        <Select options={sourceOptions} value={sourceHint} onChange={(e) => setSourceHint(e.target.value)} />

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
                    options={blockOptions}
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
                <div className="text-[11px] text-slate-500">
                  Fuente: {item.source} · Confianza OCR: {(item.confidence * 100).toFixed(0)}%
                </div>
                {item.note && <div className="text-[11px] text-amber-700">{item.note}</div>}
                <Button size="sm" onClick={() => saveSuggestion(item)}>
                  Guardar este
                </Button>
              </div>
            ))}
            <Button variant="secondary" onClick={saveAllSuggestions}>Guardar todo</Button>
          </div>
        )}

        {!!ocrText && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Ver texto OCR</summary>
            <pre className="whitespace-pre-wrap break-words mt-2 max-h-56 overflow-auto bg-slate-50 p-2 rounded-lg">{ocrText}</pre>
          </details>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Agregar registro manual</div>
          <Plus size={16} className="text-slate-500" />
        </div>

        <Input
          placeholder="Nombre (ej: SURA saldo total)"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-2">
          <Select
            options={blockOptions}
            value={draft.block}
            onChange={(e) => setDraft({ ...draft, block: e.target.value as WealthBlock })}
          />
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
          placeholder="Fuente (manual / Wise / SURA ...)"
          value={draft.source}
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
        />

        <Input
          placeholder="Nota opcional"
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />

        <Button onClick={saveDraft}>Guardar registro</Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cierre mensual manual</div>
          <Button size="sm" onClick={runMonthlyClose}>Cerrar mes actual</Button>
        </div>

        {latestClosure && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Último cierre: {latestClosure.monthKey}</div>
            <div>Neto consolidado: {formatClp(latestClosure.summary.netConsolidatedClp)}</div>
            {growthVsPrev && (
              <div className={growthVsPrev.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                vs cierre anterior: {growthVsPrev.abs >= 0 ? '+' : ''}{formatClp(growthVsPrev.abs)}
                {growthVsPrev.pct !== null ? ` (${growthVsPrev.pct.toFixed(2)}%)` : ''}
              </div>
            )}
          </div>
        )}

        {!!closures.length && (
          <div className="space-y-1 text-xs text-slate-600">
            {closures.slice(0, 6).map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1">
                <span>{item.monthKey}</span>
                <span>{formatClp(item.summary.netConsolidatedClp)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="text-sm font-semibold">Registros actuales</div>
        {(['bank', 'investment', 'real_estate', 'debt'] as WealthBlock[]).map((block) => {
          const byCurrency = summary.byBlock[block];
          const blockItems = records.filter((r) => r.block === block).slice(0, 20);
          return (
            <div key={block} className="rounded-xl border border-slate-200 p-2">
              <div className="text-sm font-semibold">{blockLabel[block]}</div>
              <div className="text-xs text-slate-600">
                CLP {formatCurrency(byCurrency.CLP, 'CLP')} · USD {formatCurrency(byCurrency.USD, 'USD')} · EUR {formatCurrency(byCurrency.EUR, 'EUR')}
              </div>
              <div className="mt-2 space-y-1">
                {blockItems.length === 0 && <div className="text-xs text-slate-400">Sin registros.</div>}
                {blockItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2 py-1">
                    <div className="pr-2">
                      <div className="font-medium text-slate-800">{item.label}</div>
                      <div className="text-slate-500">{item.source} · {item.snapshotDate}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatCurrency(item.amount, item.currency)}</span>
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
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
};
