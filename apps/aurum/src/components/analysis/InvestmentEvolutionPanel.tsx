import React, { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Info, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Card } from '../Components';
import { buildSmartVisualDomain } from './chartVisuals';
import {
  buildInvestmentEvolutionHistory,
  convertEvolutionAmount,
  DEFAULT_EVOLUTION_KEYS,
  EVOLUTION_SERIES,
} from '../../services/investmentEvolution';
import type { EvolutionKey, EvolutionMonth } from '../../services/investmentEvolution';
import { loadFxRates, loadWealthRecords } from '../../services/wealthStorage';
import type { WealthCurrency, WealthMonthlyClosure } from '../../services/wealthStorage';

type Period = 3 | 6 | 12 | 14 | 18 | 24 | 36 | 'all';
type ScaleMode = 'auto' | 'zero' | 'manual';
type ChartMode = 'balance' | 'base100';
type Layout = 'panels' | 'overlay';

interface InvestmentEvolutionPanelProps {
  closures: WealthMonthlyClosure[];
  dataRevision: number;
}

type ChartLine = {
  key: EvolutionKey;
  label: string;
  color: string;
  values: Array<number | null>;
};

const PERIODS: Period[] = [3, 6, 12, 14, 18, 24, 36, 'all'];
const PREFS_KEY = 'aurum:investment-evolution-view-v1';
const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

const monthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-');
  const index = Number(month) - 1;
  return index >= 0 && index < 12 ? monthNames[index] + ' ' + year : monthKey;
};

const shortMonth = (monthKey: string) => {
  const [year, month] = monthKey.split('-');
  const index = Number(month) - 1;
  return index >= 0 && index < 12 ? monthNames[index] + ' ' + year.slice(-2) : monthKey;
};

const unitScale = (currency: WealthCurrency) => currency === 'CLP' ? 1_000_000 : 1_000;
const unitLabel = (currency: WealthCurrency) => currency === 'CLP' ? 'MM CLP' : 'mil ' + currency;
const formatNumber = (value: number, digits = 1) =>
  value.toLocaleString('es-CL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatAxisNumber = (value: number) =>
  value.toLocaleString('es-CL', { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 });

const buttonClass = (active: boolean) =>
  'min-h-9 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition touch-manipulation ' +
  (active ? 'border-slate-800 bg-slate-800 text-white shadow-sm' :
    'border-slate-200 bg-white text-slate-600 hover:bg-slate-50');

const readPrefs = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const result: unknown = raw ? JSON.parse(raw) : null;
    return result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

type PlotProps = {
  rows: EvolutionMonth[];
  lines: ChartLine[];
  scaleMode: ScaleMode;
  manualMin: string;
  manualMax: string;
  unit: string;
  compact?: boolean;
};

const EvolutionPlot: React.FC<PlotProps> = ({
  rows, lines, scaleMode, manualMin, manualMax, unit, compact = false,
}) => {
  const [hovered, setHovered] = useState<{ key: EvolutionKey; index: number } | null>(null);
  const clipId = useId();
  const values = lines.flatMap((line) => line.values.filter((value): value is number => value !== null));
  if (!values.length) {
    return <div className="rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-500">
      No hay valores detallados para esta selección y período.
    </div>;
  }

  const domain = buildSmartVisualDomain(values);
  const validManual = manualMin.trim() !== '' && manualMax.trim() !== '' &&
    Number.isFinite(Number(manualMin)) && Number.isFinite(Number(manualMax)) &&
    Number(manualMax) > Number(manualMin);
  let min = scaleMode === 'zero' ? Math.min(0, domain.domainMin) : domain.domainMin;
  let max = domain.domainMax;
  if (scaleMode === 'manual' && validManual) {
    min = Number(manualMin);
    max = Number(manualMax);
  }
  if (max <= min) max = min + 1;

  const width = 820;
  const height = compact ? 170 : 280;
  const left = 71;
  const right = 20;
  const top = 15;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + plotWidth * index / Math.max(1, rows.length - 1);
  const y = (value: number) => top + (max - value) * plotHeight / (max - min);
  const linePath = (points: Array<number | null>) => {
    let result = '';
    let previousValid = false;
    points.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        previousValid = false;
      } else {
        result += (previousValid ? ' L ' : ' M ') + x(index).toFixed(2) + ' ' + y(value).toFixed(2);
        previousValid = true;
      }
    });
    return result;
  };
  const xStep = Math.max(1, Math.ceil(rows.length / 6));
  const activeLine = lines.find((line) => line.key === hovered?.key);
  const activeValue = hovered && activeLine ? activeLine.values[hovered.index] : null;

  return (
    <div className="min-w-0">
      <svg
        viewBox={'0 0 ' + width + ' ' + height}
        className={'block w-full ' + (compact ? 'h-[155px] sm:h-[170px]' : 'h-[240px] sm:h-[290px]')}
        role="img"
        aria-label={'Curvas de evolución de inversiones, eje vertical en ' + unit}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        {Array.from({ length: 5 }, (_, index) => {
          const tick = min + (max - min) * index / 4;
          const yy = y(tick);
          return (
            <g key={'y-' + index}>
              <line x1={left} x2={width - right} y1={yy} y2={yy}
                stroke="#e2e8f0" strokeDasharray="3 4" />
              <text x={left - 10} y={yy + 3} textAnchor="end"
                fontSize="11" fill="#64748b">{formatAxisNumber(tick)}</text>
            </g>
          );
        })}
        {rows.map((row, index) =>
          index === 0 || index === rows.length - 1 || index % xStep === 0 ? (
            <text key={row.monthKey} x={x(index)} y={height - 9} textAnchor="middle"
              fontSize="11" fill="#64748b">
              {shortMonth(row.monthKey) + (row.provisional ? '*' : '')}
            </text>
          ) : null,
        )}
        <g clipPath={'url(#' + clipId + ')'}>
        {lines.map((line) => (
          <g key={line.key}>
            <path d={linePath(line.values)} fill="none" stroke={line.color}
              strokeWidth={compact ? 2.7 : 3} strokeLinecap="round"
              strokeLinejoin="round" />
            {line.values.map((value, index) => {
              if (value === null) return null;
              return (
                <circle
                  key={rows[index].monthKey}
                  cx={x(index)}
                  cy={y(value)}
                  r={hovered?.key === line.key && hovered?.index === index ? 6 : 3.5}
                  stroke="white" strokeWidth="1.5" fill={line.color}
                  tabIndex={0}
                  role="button"
                  aria-label={line.label + ', ' + monthLabel(rows[index].monthKey) + ': ' + formatNumber(value, 2) + ' ' + unit}
                  onMouseEnter={() => setHovered({ key: line.key, index })}
                  onFocus={() => setHovered({ key: line.key, index })}
                  onClick={() => setHovered({ key: line.key, index })}
                />
              );
            })}
          </g>
        ))}
        </g>
      </svg>
      {activeLine && hovered && activeValue !== null ? (
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[11px] text-slate-700" role="status">
          <span className="font-semibold" style={{ color: activeLine.color }}>{activeLine.label}</span>
          <span>{monthLabel(rows[hovered.index].monthKey)}</span>
          <span className="font-semibold tabular-nums">{formatNumber(activeValue, 2)} {unit}</span>
          {rows[hovered.index].provisional && <span className="text-amber-700">(provisional)</span>}
        </div>
      ) : null}
      {scaleMode !== 'zero' && min > 0 && (
        <p className="px-2 text-[10px] text-slate-500">
          Eje vertical ajustado: empieza en {formatAxisNumber(min)}, no en cero.
        </p>
      )}
      {scaleMode === 'manual' && !validManual && (
        <p className="px-2 text-[10px] text-amber-700">
          Límites manuales inválidos; se utiliza la escala automática.
        </p>
      )}
    </div>
  );
};

export const InvestmentEvolutionPanel: React.FC<InvestmentEvolutionPanelProps> = ({
  closures, dataRevision,
}) => {
  const [period, setPeriod] = useState<Period>(() => {
    const saved = readPrefs().period;
    return PERIODS.includes(saved as Period) ? saved as Period : 6;
  });
  const [currency, setCurrency] = useState<WealthCurrency>(() => {
    const saved = readPrefs().currency;
    return ['CLP', 'USD', 'EUR', 'UF'].includes(String(saved)) ? saved as WealthCurrency : 'CLP';
  });
  const [mode, setMode] = useState<ChartMode>(() => readPrefs().mode === 'base100' ? 'base100' : 'balance');
  const [layout, setLayout] = useState<Layout>(() => readPrefs().layout === 'overlay' ? 'overlay' : 'panels');
  const [scaleMode, setScaleMode] = useState<ScaleMode>(() => {
    const saved = readPrefs().scaleMode;
    return saved === 'zero' || saved === 'manual' ? saved : 'auto';
  });
  const [manualMin, setManualMin] = useState('');
  const [manualMax, setManualMax] = useState('');
  const [selected, setSelected] = useState<EvolutionKey[]>(() => {
    const saved = readPrefs().selected;
    const validKeys = new Set(EVOLUTION_SERIES.map((item) => item.key));
    const clean = Array.isArray(saved) ? saved.filter((key): key is EvolutionKey =>
      typeof key === 'string' && validKeys.has(key as EvolutionKey)) : [];
    return clean.length ? [...new Set(clean)] : [...DEFAULT_EVOLUTION_KEYS];
  });
  const [focused, setFocused] = useState<EvolutionKey | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        period, currency, mode, layout, scaleMode, selected,
      }));
    } catch {
      // UI preferences do not affect financial data or cloud synchronization.
    }
  }, [period, currency, mode, layout, scaleMode, selected]);

  const history = useMemo(
    () => buildInvestmentEvolutionHistory(closures, loadWealthRecords(), loadFxRates()),
    // dataRevision signals newly hydrated/edited wealth records even if closures did not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closures, dataRevision],
  );
  const visibleMonths = useMemo(
    () => period === 'all' ? history : history.slice(-period),
    [history, period],
  );
  const visibleDefs = EVOLUTION_SERIES.filter((definition) => selected.includes(definition.key));
  const activeDefs = visibleDefs.filter((definition) => !focused || definition.key === focused);
  const scaleFactor = unitScale(currency);
  const chartLines: ChartLine[] = activeDefs.map((definition) => {
    const rawValues = visibleMonths.map((row) => {
      const converted = convertEvolutionAmount(row.amountsClp[definition.key], currency, row.fx);
      return converted === null ? null : converted / scaleFactor;
    });
    if (mode === 'balance') return { ...definition, values: rawValues };
    const baseIndex = rawValues.findIndex((value) => value !== null && value !== 0);
    const base = baseIndex >= 0 ? rawValues[baseIndex] : null;
    return {
      ...definition,
      values: base === null
        ? rawValues.map(() => null)
        : rawValues.map((value, index) => index < baseIndex || value === null ? null : value / base * 100),
    };
  });
  const validSeries = chartLines.filter((line) => line.values.some((value) => value !== null));
  const currentUnit = mode === 'base100' ? 'índice' : unitLabel(currency);
  const effectiveLayout = mode === 'base100' ? 'overlay' : layout;
  const lastMonth = visibleMonths.at(-1);
  const hasProvisional = Boolean(lastMonth?.provisional);
  const historicalMissing = validSeries.some((line) => line.values.some((value) => value === null));

  const toggleSelect = (key: EvolutionKey) => {
    setSelected((previous) => previous.includes(key)
      ? previous.filter((item) => item !== key)
      : [...previous, key]);
    setFocused(null);
  };
  const resetView = () => {
    setPeriod(6);
    setCurrency('CLP');
    setMode('balance');
    setLayout('panels');
    setScaleMode('auto');
    setManualMin('');
    setManualMax('');
    setSelected([...DEFAULT_EVOLUTION_KEYS]);
    setFocused(null);
  };

  return (
    <Card className="space-y-3 border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Evolución de inversiones</h2>
          <p className="text-xs text-slate-500">Saldos por institución y patrimonio · cierres mensuales</p>
        </div>
        <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          aria-expanded={showAdvanced} aria-controls="evolution-advanced"
          onClick={() => setShowAdvanced((value) => !value)}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          Personalizar
          <ChevronDown size={13} aria-hidden="true" className={showAdvanced ? 'rotate-180' : ''} />
        </button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-semibold text-slate-500">Período</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Período de evolución">
            {PERIODS.map((item) => (
              <button key={item} type="button" aria-pressed={period === item}
                onClick={() => { setPeriod(item); setFocused(null); }}
                className={buttonClass(period === item)}>
                {item === 'all' ? 'Todo' : String(item) + 'M'}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-semibold text-slate-500">Inversiones</p>
          <div className="flex gap-1">
            <button type="button" className={buttonClass(
              selected.length === DEFAULT_EVOLUTION_KEYS.length &&
              DEFAULT_EVOLUTION_KEYS.every((key) => selected.includes(key)),
            )} onClick={() => { setSelected([...DEFAULT_EVOLUTION_KEYS]); setFocused(null); }}>
              5 principales
            </button>
            <button type="button" className={buttonClass(showPicker)} aria-expanded={showPicker}
              onClick={() => setShowPicker((value) => !value)}>
              Elegir ({selected.length})
            </button>
          </div>
        </div>
      </div>

      {showPicker && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Seleccionar series</span>
            <div className="flex gap-2">
              <button type="button" className="text-xs font-semibold text-slate-600 underline"
                onClick={() => { setSelected(EVOLUTION_SERIES.map((item) => item.key)); setFocused(null); }}>
                Todas
              </button>
              <button type="button" className="text-xs font-semibold text-slate-600 underline"
                onClick={() => { setSelected([]); setFocused(null); }}>
                Ninguna
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
            {EVOLUTION_SERIES.map((item) => (
              <label key={item.key} className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={selected.includes(item.key)}
                  onChange={() => toggleSelect(item.key)}
                  className="h-4 w-4 rounded border-slate-300 accent-slate-800" />
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-slate-500">Moneda</span>
          {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((item) => (
            <button key={item} type="button" onClick={() => setCurrency(item)}
              aria-pressed={currency === item} className={buttonClass(currency === item)}>{item}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={buttonClass(mode === 'balance')} aria-pressed={mode === 'balance'}
            onClick={() => setMode('balance')}>Saldos</button>
          <button type="button" className={buttonClass(mode === 'base100')} aria-pressed={mode === 'base100'}
            onClick={() => setMode('base100')}>Base 100</button>
        </div>
      </div>

      {showAdvanced && (
        <div id="evolution-advanced" className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700">Escala vertical</p>
            <div className="flex flex-wrap gap-1">
              {([
                ['auto', 'Automática'],
                ['zero', 'Desde cero'],
                ['manual', 'Manual'],
              ] as Array<[ScaleMode, string]>).map(([key, label]) => (
                <button key={key} type="button" className={buttonClass(scaleMode === key)}
                  aria-pressed={scaleMode === key} onClick={() => setScaleMode(key)}>{label}</button>
              ))}
            </div>
            {scaleMode === 'manual' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="text-[11px] text-slate-600">
                  Mínimo ({currentUnit})
                  <input type="number" step="any" value={manualMin}
                    onChange={(event) => setManualMin(event.target.value)}
                    className="mt-1 block w-28 rounded-lg border border-slate-300 bg-white p-2 text-xs" />
                </label>
                <label className="text-[11px] text-slate-600">
                  Máximo ({currentUnit})
                  <input type="number" step="any" value={manualMax}
                    onChange={(event) => setManualMax(event.target.value)}
                    className="mt-1 block w-28 rounded-lg border border-slate-300 bg-white p-2 text-xs" />
                </label>
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700">Disposición de curvas</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" className={buttonClass(layout === 'panels')}
                onClick={() => setLayout('panels')}>Paneles independientes</button>
              <button type="button" className={buttonClass(layout === 'overlay')}
                onClick={() => setLayout('overlay')}>Superpuestas</button>
            </div>
            {mode === 'base100' && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                En base 100 las curvas se superponen para facilitar su comparación.
              </p>
            )}
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button type="button" onClick={resetView}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
              <RotateCcw size={13} aria-hidden="true" /> Restablecer vista
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50/70 p-2">
        {visibleDefs.map((item) => (
          <button key={item.key} type="button"
            aria-pressed={focused === item.key}
            aria-label={'Aislar ' + item.label + (focused === item.key ? '; volver a todas' : '')}
            title={focused === item.key ? 'Volver a todas las seleccionadas' : 'Ver solo ' + item.label}
            onClick={() => setFocused((previous) => previous === item.key ? null : item.key)}
            className={'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition ' +
              (focused === item.key ? 'bg-white text-slate-900 shadow ring-1 ring-slate-200' :
                focused ? 'text-slate-400 hover:bg-white/60' : 'text-slate-700 hover:bg-white')}>
            <span className="h-0.5 w-5 rounded" style={{ backgroundColor: item.color }} />
            {item.label}
          </button>
        ))}
        {focused && (
          <button type="button" onClick={() => setFocused(null)}
            className="min-h-8 rounded-md px-2 text-[11px] font-semibold text-slate-600 underline">
            Mostrar todas
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Toca el nombre de una curva para verla sola. Vuelve a tocarlo para recuperar la selección.
      </p>

      {!visibleMonths.length || !selected.length ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
          {!visibleMonths.length ? 'Aún no hay cierres patrimoniales.' :
            'Selecciona alguna inversión en «Elegir» para mostrar su evolución.'}
        </div>
      ) : effectiveLayout === 'panels' && !focused && validSeries.length > 1 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {validSeries.map((line) => {
            const latest = [...line.values].reverse().find((value) => value !== null);
            const first = line.values.find((value) => value !== null);
            return (
              <div key={line.key} className="min-w-0 rounded-xl border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-1 px-1">
                  <button type="button" className="flex min-h-8 items-center gap-1.5 text-left text-xs font-semibold"
                    onClick={() => setFocused(line.key)}>
                    <span className="h-0.5 w-5" style={{ backgroundColor: line.color }} />
                    {line.label}
                  </button>
                  <span className="text-xs font-semibold tabular-nums text-slate-700">
                    {latest === undefined ? '—' : formatNumber(latest, 1)} {currentUnit}
                    {first !== undefined && latest !== undefined && first !== 0 && (
                      <span className="ml-2 text-[11px] font-normal text-slate-500">
                        {formatNumber((latest / first - 1) * 100, 1)}%
                      </span>
                    )}
                  </span>
                </div>
                <EvolutionPlot rows={visibleMonths} lines={[line]} scaleMode={scaleMode}
                  manualMin={manualMin} manualMax={manualMax} unit={currentUnit} compact />
              </div>
            );
          })}
        </div>
      ) : validSeries.length ? (
        <EvolutionPlot rows={visibleMonths} lines={validSeries} scaleMode={scaleMode}
          manualMin={manualMin} manualMax={manualMax} unit={currentUnit} />
      ) : (
        <div className="rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-500">
          Los activos seleccionados no tienen registros en este período.
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2 text-[11px] text-slate-500">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p>
            {mode === 'base100'
              ? 'Base 100: cada serie parte de su primera observación disponible en el período. No mide rentabilidad ajustada por flujos.'
              : 'Saldos nominales. Incluyen aportes, retiros, traspasos y fluctuaciones de moneda; no equivalen a rentabilidad.'}
            {' '}Los tipos de cambio corresponden a cada mes cerrado.
          </p>
          {hasProvisional && <p>* Último mes provisional: valores todavía sujetos a cambios.</p>}
          {historicalMissing && <p>Algunas series empiezan después del inicio seleccionado: no se inventan valores anteriores.</p>}
          {effectiveLayout === 'overlay' && validSeries.length > 1 && mode !== 'base100' &&
            <p>Las series de distinta magnitud comparten eje. Elige «Paneles independientes» para apreciar sus movimientos.</p>}
          <p>Los subtotales y componentes individuales pueden solaparse; no deben sumarse entre sí.</p>
        </div>
      </div>
    </Card>
  );
};
