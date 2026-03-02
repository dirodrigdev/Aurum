import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Layers,
  TrendingUp,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

import { Card, cn, formatLocaleNumber } from '../components/Components';
import { getMonthlyReports, getProjects } from '../services/db';
import { useDataEvent } from '../hooks/useDataEvent';
import type { MonthlyReport, Project } from '../types';

type RangeKey = 'ALL' | 'YTD_JAN12' | 'LAST_12' | 'LAST_24' | 'LAST_36' | 'LAST_1' | 'PICK_PERIOD';

type AvgMode = 'LIFESTYLE' | 'ALL';
const AVG_MODE_STORAGE_KEY = 'gastapp_consolidado_avg_mode';

const RANGE_OPTIONS: { key: RangeKey; label: string; hint: string }[] = [
  { key: 'ALL', label: 'Desde P1 a último cierre', hint: 'Todo el historial cerrado' },
  { key: 'YTD_JAN12', label: 'Año (12 ene)', hint: 'YTD (año fiscal)' },
  { key: 'LAST_12', label: 'Últimos 12', hint: '12 periodos' },
  { key: 'LAST_24', label: 'Últimos 24', hint: '24 periodos' },
  { key: 'LAST_36', label: 'Últimos 36', hint: '36 periodos' },
  { key: 'LAST_1', label: 'Último periodo', hint: 'P último' },
  { key: 'PICK_PERIOD', label: 'Elegir periodo', hint: 'P específico' },
];

const QUICK_KEYS: RangeKey[] = ['ALL', 'YTD_JAN12', 'LAST_12'];

type ConsolidadoProps = {
  /** Si es true, se renderiza sin header/back (para usarlo como pestaña dentro de Reports). */
  embedded?: boolean;
};

type LegacyRow = {
  date: Date;
  tipo: 'viaje' | 'otros';
  total: number;
  label: string;
};

const toNoon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);

const safeNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const parseISODateNoon = (isoLike: string): Date | null => {
  if (!isoLike) return null;
  // soporta 'YYYY-MM-DD' o ISO con hora
  const m = String(isoLike).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
};

const parsePeriodNumber = (pid: string) => {
  const m = String(pid || '').match(/P(\d+)/i);
  return m ? Number(m[1]) : 0;
};

// --- Periodos (ancla real del producto) ---
// P1 = 12-may-2023 → 11-jun-2023 (Madrid). El número se deriva SOLO desde la fecha de inicio.
const PERIOD_ANCHOR = new Date(2023, 4, 12, 12, 0, 0, 0); // 2023-05-12 @ 12:00

const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const periodNumberFromStart = (start: Date) => {
  const a = PERIOD_ANCHOR;
  const months = (start.getFullYear() - a.getFullYear()) * 12 + (start.getMonth() - a.getMonth());
  return Math.max(1, months + 1);
};

const periodKeyFrom = (start: Date, end: Date) => `${ymd(start)}__${ymd(end)}`;

// Dedupe defensivo: NO por numeroPeriodo (porque puede venir corrupto), sino por rango real start/end.
// Además, ignoramos cualquier "cierre" cuya fecha fin sea >= hoy (para evitar fantasmas del periodo abierto).
const dedupeReports = (items: MonthlyReport[]) => {
  const todayNoon = toNoon(new Date());
  const byKey = new Map<string, MonthlyReport[]>();

  for (const r of items || []) {
    const start = parseISODateNoon((r as any)?.fechaInicio || (r as any)?.fechaCierre || (r as any)?.fechaFin);
    const end = parseISODateNoon((r as any)?.fechaFin || (r as any)?.fechaCierre || (r as any)?.fechaInicio);
    if (!start || !end) continue;

    // "Cerrado" = end < hoy@12:00 (a prueba de zona horaria y del 11/ene antes de las 23:59)
    if (toNoon(end).getTime() >= todayNoon.getTime()) continue;

    const key = periodKeyFrom(toNoon(start), toNoon(end));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  const score = (r: any) => {
    const gasto = Math.abs(Number(r?.totalGlobalGasto || 0));
    const tx = Number(r?.transactionsCount || 0);
    let s = 0;
    if (gasto > 0.000001) s += 100000;
    if (tx > 0) s += 20000;
    const t = r?.updatedAt
      ? new Date(r.updatedAt).getTime()
      : r?.fechaCierre
        ? new Date(r.fechaCierre).getTime()
        : r?.fechaFin
          ? new Date(r.fechaFin).getTime()
          : 0;
    s += Math.floor((t || 0) / 10000000);
    return s;
  };

  const out: MonthlyReport[] = [];
  for (const arr of byKey.values()) {
    const best = [...arr].sort((a, b) => score(b as any) - score(a as any))[0];
    // Normalizamos numeroPeriodo desde el start (ancla real), para que toda la UI sea consistente.
    const start = parseISODateNoon((best as any)?.fechaInicio || (best as any)?.fechaCierre || (best as any)?.fechaFin);
    const end = parseISODateNoon((best as any)?.fechaFin || (best as any)?.fechaCierre || (best as any)?.fechaInicio);
    const numeroPeriodo = start ? periodNumberFromStart(toNoon(start)) : Number((best as any)?.numeroPeriodo || 0);
    const enriched: any = {
      ...best,
      numeroPeriodo,
      __periodKey: start && end ? periodKeyFrom(toNoon(start), toNoon(end)) : undefined,
      __startYMD: start ? ymd(toNoon(start)) : undefined,
      __endYMD: end ? ymd(toNoon(end)) : undefined,
    };
    out.push(enriched);
  }

  // Orden desc por numeroPeriodo (P más reciente arriba)
  out.sort((a: any, b: any) => Number(b?.numeroPeriodo || 0) - Number(a?.numeroPeriodo || 0));
  return out;
};

const fmtEUR0 = (n: number) => `${formatLocaleNumber(n, 0)} €`;

const fmtShortEs = (d: Date) =>
  d
    .toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    })
    .replace('.', '');

const within = (d: Date, from: Date, to: Date) => {
  const x = d.getTime();
  return x >= from.getTime() && x <= to.getTime();
};

const parseCsv = (csv: string): LegacyRow[] => {
  const lines = String(csv || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const rows = lines.slice(1); // header
  const out: LegacyRow[] = [];
  for (const raw of rows) {
    // naive split by comma (nuestros labels no llevan coma)
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.length < 4) continue;
    const date = parseISODateNoon(parts[0]);
    if (!date) continue;
    const tipoRaw = parts[1].toLowerCase();
    const tipo = tipoRaw === 'otros' ? 'otros' : 'viaje';
    const total = safeNum(parts[2]);
    const label = parts.slice(3).join(',').trim();
    out.push({ date: toNoon(date), tipo, total, label });
  }
  return out;
};

export const Consolidado = ({ embedded = false }: ConsolidadoProps) => {
  const navigate = useNavigate();

  const reportsRev = useDataEvent('monthly_reports_changed');
  const projectsRev = useDataEvent('projects_changed');

  const [range, setRange] = useState<RangeKey>('ALL');
  const [pickedPeriod, setPickedPeriod] = useState<string>('P1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // ✅ Toggle temporal: usa CSV legacy solo para (Viajes + Otros)
  // Por defecto ON: hoy la info real de Viajes/Otros puede no estar completa.
  const [useLegacyNonHome, setUseLegacyNonHome] = useState<boolean>(true);

  // Promedios: estilo de vida (excluye one-offs en Otros) vs completo.
  // Importante: los totales NO cambian nunca.
  const [avgMode, setAvgMode] = useState<AvgMode>(() => {
    try {
      const raw = localStorage.getItem(AVG_MODE_STORAGE_KEY);
      return raw === 'ALL' ? 'ALL' : 'LIFESTYLE';
    } catch {
      return 'LIFESTYLE';
    }
  });
  const [legacyRows, setLegacyRows] = useState<LegacyRow[]>([]);
  const [legacyLoaded, setLegacyLoaded] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [rawReports, rawProjects] = await Promise.all([getMonthlyReports(), getProjects()]);
        if (cancelled) return;

        const cleanReports = dedupeReports(rawReports || []);
        setReports(cleanReports);
        setProjects(rawProjects || []);

        const maxP = cleanReports.length
          ? Math.max(...cleanReports.map((r: any) => Number(r?.numeroPeriodo || 0)).filter(Boolean))
          : 1;
        setPickedPeriod(`P${Math.max(1, maxP)}`);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'No se pudo cargar Consolidado');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportsRev, projectsRev]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!useLegacyNonHome) return;
      if (legacyLoaded) return;

      try {
        // Primero: si el usuario lo pegó en localStorage, usamos eso.
        const ls = localStorage.getItem('gastapp_legacy_trips_otros_csv');
        const csvText =
          (ls && ls.trim().length > 50 ? ls : null) ||
          (await fetch('/legacy_trips_otros.csv', { cache: 'no-store' }).then((r) => r.text()));
        if (cancelled) return;
        setLegacyRows(parseCsv(csvText));
        setLegacyLoaded(true);
      } catch {
        if (!cancelled) {
          setLegacyRows([]);
          setLegacyLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [useLegacyNonHome, legacyLoaded]);

  useEffect(() => {
    try {
      localStorage.setItem(AVG_MODE_STORAGE_KEY, avgMode);
    } catch {
      // ignore
    }
  }, [avgMode]);

  const periodOptions = useMemo(() => {
    const nums = Array.from(
      new Set((reports || []).map((r: any) => Number(r?.numeroPeriodo || 0)).filter(Boolean))
    ).sort((a, b) => a - b);
    if (!nums.length) return ['P1'];
    return nums.map((n) => `P${n}`);
  }, [reports]);

  const lastClosed = useMemo(() => {
    const list = reports || [];
    if (!list.length) return null;
    const withDates = list
      .map((r: any) => {
        const end = parseISODateNoon(r?.fechaFin || r?.fechaCierre || r?.fechaInicio);
        if (!end) return null;
        return { r, end: toNoon(end) };
      })
      .filter(Boolean) as { r: any; end: Date }[];
    if (!withDates.length) return null;
    withDates.sort((a, b) => b.end.getTime() - a.end.getTime());
    const top = withDates[0];
    return {
      n: Number((top.r as any)?.numeroPeriodo || 0),
      end: top.end,
    };
  }, [reports]);

  const selectedReports = useMemo(() => {
    const list = reports || [];
    if (!list.length) return [];

    const byNumDesc = [...list].sort(
      (a: any, b: any) => Number(b?.numeroPeriodo || 0) - Number(a?.numeroPeriodo || 0)
    );

    if (range === 'LAST_1') return byNumDesc.slice(0, 1);
    if (range === 'LAST_12') return byNumDesc.slice(0, 12);
    if (range === 'LAST_24') return byNumDesc.slice(0, 24);
    if (range === 'LAST_36') return byNumDesc.slice(0, 36);

    if (range === 'PICK_PERIOD') {
      const n = parsePeriodNumber(pickedPeriod);
      const hit = byNumDesc.find((r: any) => Number(r?.numeroPeriodo || 0) === n);
      return hit ? [hit] : [];
    }

    if (range === 'YTD_JAN12') {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 12, 12, 0, 0, 0);
      return byNumDesc
        .filter((r: any) => {
          const d = parseISODateNoon(r?.fechaInicio || r?.fechaCierre || r?.fechaFin);
          if (!d) return false;
          return d.getTime() >= start.getTime();
        })
        .sort((a: any, b: any) => Number(b?.numeroPeriodo || 0) - Number(a?.numeroPeriodo || 0));
    }

    // ALL
    return byNumDesc;
  }, [reports, range, pickedPeriod]);

  const periodCount = Math.max(1, selectedReports.length || 1);

  const dateWindow = useMemo(() => {
    // Ventana temporal del rango seleccionado (para filtrar legacy y proyectos por fechaInicio)
    const sel = selectedReports || [];
    const starts = sel
      .map((r: any) => parseISODateNoon(r?.fechaInicio || r?.fechaCierre || r?.fechaFin))
      .filter(Boolean) as Date[];
    const ends = sel
      .map((r: any) => parseISODateNoon(r?.fechaFin || r?.fechaCierre || r?.fechaInicio))
      .filter(Boolean) as Date[];

    if (!starts.length || !ends.length) {
      const now = toNoon(new Date());
      return { from: now, to: now };
    }

    const from = toNoon(new Date(Math.min(...starts.map((d) => d.getTime()))));
    const to = toNoon(new Date(Math.max(...ends.map((d) => d.getTime()))));
    return { from, to };
  }, [selectedReports]);

  const homeTotals = useMemo(() => {
    const total = selectedReports.reduce((acc, r: any) => acc + safeNum(r?.totalGlobalGasto), 0);
    const avg = total / periodCount;
    return { total, avg };
  }, [selectedReports, periodCount]);

  const legacyTotals = useMemo(() => {
    if (!legacyRows.length) return { trips: 0, others: 0 };
    const inRange = legacyRows.filter((r) => within(r.date, dateWindow.from, dateWindow.to));
    const trips = inRange.filter((r) => r.tipo === 'viaje').reduce((a, r) => a + r.total, 0);
    const others = inRange.filter((r) => r.tipo === 'otros').reduce((a, r) => a + r.total, 0);
    return { trips, others };
  }, [legacyRows, dateWindow]);

  const realProjectTotals = useMemo(() => {
    const from = dateWindow.from;
    const to = dateWindow.to;

    const inRange = (p: Project) => {
      const d =
        parseISODateNoon((p as any)?.fechaInicio) ||
        parseISODateNoon((p as any)?.created_at) ||
        null;
      if (!d) return true; // si no hay fecha, no lo filtramos (mejor mostrar algo a 0)
      return within(toNoon(d), from, to);
    };

    const trips = (projects || [])
      .filter((p) => String((p as any)?.tipo || '').toLowerCase() === 'viaje')
      .filter(inRange)
      .reduce((acc, p) => acc + safeNum((p as any)?.gasto_total_eur), 0);

    const others = (projects || [])
      .filter((p) => String((p as any)?.tipo || '').toLowerCase() !== 'viaje')
      .filter(inRange)
      .reduce((acc, p) => acc + safeNum((p as any)?.gasto_total_eur), 0);

    const othersExtra = (projects || [])
      .filter((p) => String((p as any)?.tipo || '').toLowerCase() !== 'viaje')
      .filter(inRange)
      .filter((p) => Boolean((p as any)?.exclude_from_lifestyle_avg))
      .reduce((acc, p) => acc + safeNum((p as any)?.gasto_total_eur), 0);

    return { trips, others, othersExtra };
  }, [projects, dateWindow]);

  const nonHomeTotals = useMemo(() => {
    const trips = useLegacyNonHome ? legacyTotals.trips : (realProjectTotals as any).trips;
    const others = useLegacyNonHome ? legacyTotals.others : (realProjectTotals as any).others;

    // One-offs (solo Otros) para el promedio “Estilo de vida”
    const othersExtra = useLegacyNonHome ? 0 : safeNum((realProjectTotals as any)?.othersExtra);
    const othersForAvg = avgMode === 'LIFESTYLE' && !useLegacyNonHome ? Math.max(0, others - othersExtra) : others;

    // Totales contables (NO cambian por el modo)
    const total = trips + others;

    // Totales para promedio (pueden excluir one-offs)
    const totalForAvg = trips + othersForAvg;
    const avg = totalForAvg / periodCount;

    return {
      trips,
      others,
      total,
      totalForAvg,
      avg,
      avgTrips: trips / periodCount,
      avgOthers: othersForAvg / periodCount,
      othersExtra,
    };
  }, [avgMode, useLegacyNonHome, legacyTotals, realProjectTotals, periodCount]);

  const grandTotals = useMemo(() => {
    const total = homeTotals.total + nonHomeTotals.total;
    const totalForAvg = homeTotals.total + (nonHomeTotals as any).totalForAvg;
    const avg = totalForAvg / periodCount;
    return { total, avg };
  }, [homeTotals, nonHomeTotals, periodCount]);

  const rangeLabel = useMemo(() => {
    if (range === 'PICK_PERIOD') return pickedPeriod;
    const opt = RANGE_OPTIONS.find((o) => o.key === range);
    return opt?.label ?? '—';
  }, [range, pickedPeriod]);

  const showPeriodPicker = range === 'PICK_PERIOD';

  // UI tokens (titanio suave) — evita negros puros/neones
  const surface = 'bg-white/80 backdrop-blur-md';

  // Hero (promedio global): azul metálico con gradiente
  const heroSurface = 'bg-gradient-to-br from-slate-700/85 via-slate-800/80 to-sky-900/70 text-white';
  const heroBorder = 'border border-white/10';
  const heroShadow = 'shadow-[0_22px_70px_-38px_rgba(2,6,23,0.65)]';
  const heroHeading = 'text-white';
  const heroMuted = 'text-slate-200/80';

  // Cards Familia A/B: celeste metálico con gradiente (más claro que el Hero)
  const familyWrap = 'relative rounded-2xl p-2 bg-gradient-to-br from-slate-50/90 via-sky-50/70 to-slate-100/90';
  const familySurface = 'bg-gradient-to-br from-white/70 via-sky-50/60 to-slate-100/70 backdrop-blur-md';

  const borderSoft = 'border border-slate-200/70';
  const shadowSoft = 'shadow-[0_14px_40px_-28px_rgba(2,6,23,0.35)]';
  const heading = 'text-slate-900';
  const muted = 'text-slate-500';
  const btnBase =
    'h-10 w-full px-3 rounded-xl text-[11px] leading-tight font-semibold border transition flex items-center justify-center text-center';

  return (
    <div className={cn('px-4 pb-24', embedded ? 'pt-2' : 'pt-4')}>
      {!embedded && (
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate('/reports')}
            className="h-10 w-10 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center shadow-sm"
            title="Volver"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <div className="text-sm text-slate-500">Reportes</div>
            <div className="text-xl font-black tracking-tight text-slate-900">Consolidado</div>
          </div>

          <Link
            to="/reports"
            className="text-sm text-slate-600 hover:text-slate-900 underline underline-offset-4"
          >
            Mensual / Evolución
          </Link>
        </div>
      )}

      {/* Selector de rango (título horizontal + controles debajo) */}
      <Card className={cn('mb-4 p-3', surface, borderSoft, shadowSoft)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={cn('text-[12px] font-semibold', muted)}>Rango</div>
            <div className={cn('text-sm font-black tracking-tight', heading)}>{rangeLabel}</div>
          </div>

          <div className={cn('text-[12px]', muted)}>
            {selectedReports.length || 1} P · promedio / P
            {lastClosed?.n && lastClosed?.end ? (
              <div className="mt-0.5 text-[11px] text-slate-500">
                Hasta: P{lastClosed.n} · {fmtShortEs(lastClosed.end)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {QUICK_KEYS.map((k) => {
            const active = range === k;
            const opt = RANGE_OPTIONS.find((o) => o.key === k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                className={cn(
                  btnBase,
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white/70 text-slate-700 border-slate-200 hover:bg-white'
                )}
              >
                {opt?.label}
              </button>
            );
          })}

          <div className="relative">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              className={cn(
                'appearance-none h-10 w-full px-3 pr-8 rounded-xl text-[11px] leading-tight font-semibold border focus:outline-none',
                'bg-white/70 text-slate-700 border-slate-200 hover:bg-white'
              )}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
        </div>

        {showPeriodPicker && (
          <div className="mt-3 flex items-center gap-2">
            <div className={cn('text-[12px] font-semibold', muted)}>Periodo específico</div>
            <select
              value={pickedPeriod}
              onChange={(e) => setPickedPeriod(e.target.value)}
              className={cn(
                'appearance-none h-9 px-3 rounded-xl text-[12px] leading-tight font-semibold border focus:outline-none',
                'bg-white/70 text-slate-700 border-slate-200 hover:bg-white'
              )}
            >
              {periodOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {loading && (
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 className="animate-spin" size={18} />
          Cargando consolidado...
        </div>
      )}

      {!loading && error && (
        <Card className="p-3 border border-red-200 bg-red-50 text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5" />
            <div>
              <div className="font-semibold">Error</div>
              <div className="text-sm">{error}</div>
            </div>
          </div>
        </Card>
      )}

      {!loading && !error && (
        <>
          {/* TOTAL (Titanio azulado, no negro) */}
          <Card className={cn('p-5 mb-3 overflow-hidden', heroSurface, heroBorder, heroShadow)}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={cn('text-[12px] font-semibold flex items-center gap-2', heroMuted)}>
                  <TrendingUp size={14} /> Promedio global (EUR)
                </div>
                <div className={cn('text-3xl font-black tracking-tight mt-1', heroHeading)}>
                  {fmtEUR0(grandTotals.avg)} <span className={cn('text-base font-semibold', heroMuted)}>/ P</span>
                </div>
                <div className={cn('text-[12px] mt-1', heroMuted)}>Total: {fmtEUR0(grandTotals.total)}</div>
              </div>
            </div>
          </Card>

          {/* Dos bloques equivalentes: Día a día vs Viajes+Otros */}
          {/*
            IMPORTANTE: esta sección debe mantener jerarquía vertical (como en Home):
            1) Día a día (card completa)
            2) Viajes + Otros (card completa)
            3) Dentro de Viajes+Otros: 2 sub-cards (Viajes / Otros)

            Evitamos un grid responsive aquí porque en anchos intermedios (p.ej. iPad / Safari,
            o zoom/viewport) se dispara el breakpoint y rompe la lectura visual.
          */}
          <div className={cn('mb-1', familyWrap)}>
            <div className="space-y-2">
              {/* Día a día */}
              <Card className={cn('p-4', familySurface, borderSoft, shadowSoft)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={cn('text-[12px] font-semibold flex items-center gap-2', muted)}>
                    <Calendar size={14} /> Día a día
                  </div>
                  <div className={cn('text-2xl font-black tracking-tight mt-1', heading)}>
                    {fmtEUR0(homeTotals.avg)} <span className={cn('text-sm font-semibold', muted)}>/ P</span>
                  </div>
                  <div className={cn('text-[12px] mt-1', muted)}>Total: {fmtEUR0(homeTotals.total)}</div>
                </div>
              </div>
            </Card>

            {/* Viajes + Otros (mismo tamaño, con subgrupos dentro) */}
            <Card className={cn('p-4', familySurface, borderSoft, shadowSoft)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={cn('text-[12px] font-semibold flex items-center gap-2', muted)}>
                    <Layers size={14} /> Viajes + Otros
                  </div>
                  <div className={cn('text-2xl font-black tracking-tight mt-1', heading)}>
                    {fmtEUR0(nonHomeTotals.avg)} <span className={cn('text-sm font-semibold', muted)}>/ P</span>
                  </div>
                  <div className={cn('text-[12px] mt-1', muted)}>Total: {fmtEUR0(nonHomeTotals.total)}</div>

                  {!useLegacyNonHome && avgMode === 'LIFESTYLE' && (nonHomeTotals as any).othersExtra > 0 ? (
                    <div className={cn('text-[11px] mt-1', muted)}>
                      Excluidos del promedio (Otros): {fmtEUR0((nonHomeTotals as any).othersExtra)}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className={cn('rounded-xl p-3', 'bg-gradient-to-br from-white/70 via-sky-50/60 to-slate-100/70', 'border border-slate-200/70')}>
                  <div className={cn('text-[12px] font-semibold', muted)}>Viajes</div>
                  <div className={cn('text-lg font-black mt-1', heading)}>
                    {fmtEUR0(nonHomeTotals.avgTrips)} <span className={cn('text-[12px] font-semibold', muted)}>/ P</span>
                  </div>
                  <div className={cn('text-[12px] mt-1', muted)}>Total: {fmtEUR0(nonHomeTotals.trips)}</div>
                </div>

                <div className={cn('rounded-xl p-3', 'bg-gradient-to-br from-white/70 via-sky-50/60 to-slate-100/70', 'border border-slate-200/70')}>
                  <div className={cn('text-[12px] font-semibold', muted)}>Otros</div>
                  <div className={cn('text-lg font-black mt-1', heading)}>
                    {fmtEUR0(nonHomeTotals.avgOthers)} <span className={cn('text-[12px] font-semibold', muted)}>/ P</span>
                  </div>
                  <div className={cn('text-[12px] mt-1', muted)}>Total: {fmtEUR0(nonHomeTotals.others)}</div>
                </div>
              </div>

              {/* Controles (promedio + fuente) */}
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={cn('text-[12px] font-semibold', muted)}>Promedio:</div>
                    <button
                      type="button"
                      onClick={() => setAvgMode((v) => (v === 'ALL' ? 'LIFESTYLE' : 'ALL'))}
                      disabled={useLegacyNonHome}
                      className={cn(
                        'h-9 px-3 rounded-xl text-[11px] font-semibold border transition',
                        useLegacyNonHome
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : avgMode === 'ALL'
                            ? 'bg-gradient-to-r from-slate-800 to-sky-900 text-white border-white/10'
                            : 'bg-white/70 text-slate-700 border-slate-200 hover:bg-white'
                      )}
                      title={useLegacyNonHome ? 'Disponible cuando Fuente esté en App' : 'Cambia cómo se calcula el promedio'}
                    >
                      Completo {avgMode === 'ALL' ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className={cn('text-[12px] font-semibold', muted)}>Fuente:</div>
                    <button
                      type="button"
                      onClick={() => setUseLegacyNonHome((v) => !v)}
                      className={cn(
                        'h-9 px-3 rounded-xl text-[11px] font-semibold border transition',
                        useLegacyNonHome
                          ? 'bg-gradient-to-r from-slate-800 to-sky-900 text-white border-white/10'
                          : 'bg-white/70 text-slate-700 border-slate-200 hover:bg-white'
                      )}
                      title="Temporal: usa CSV legacy para Viajes+Otros"
                    >
                      {useLegacyNonHome ? 'Manual ON' : 'Manual OFF'}
                    </button>
                  </div>
                </div>

                <div className={cn('text-[12px]', muted)}>
                  {useLegacyNonHome
                    ? 'Manual: usa el CSV legacy para Viajes+Otros (promedio en modo completo).'
                    : avgMode === 'LIFESTYLE'
                      ? 'Estilo de vida: excluye one-shots de Otros en el promedio.'
                      : 'Completo: incluye todo (más contable).'}
                </div>

                {useLegacyNonHome && legacyLoaded && (
                  <div className={cn('text-[12px]', muted)}>
                    Manual = <span className="font-semibold">legacy_trips_otros.csv</span> (solo Viajes+Otros). Día a día viene de Home.
                  </div>
                )}
              </div>
            </Card>
            </div>
          </div>

          <div className={cn('mt-4 text-[12px]', muted)}>
            Nota: “Manual” es marcha blanca. Cuando cierres el cálculo real de Viajes/Otros, se apaga.
          </div>
        </>
      )}
    </div>
  );
};
