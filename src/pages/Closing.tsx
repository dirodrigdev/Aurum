import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  ChevronRight,
  Plus,
  Undo2,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Lock,
} from 'lucide-react';

import {
  Card,
  Button,
  cn,
  formatLocaleNumber,
  parseLocaleNumber,
  Input,
} from '../components/Components';

import {
  getMonthlyReports,
  subscribeToExpensesInRange,
  subscribeToCategories,
  addMonthlyExpense,
  updateMonthlyExpense,
  deleteMonthlyExpense,
  getClosingConfig,
} from '../services/db';

import { rebuildReportForPeriod } from '../services/periodClosing';
import { EditExpenseModal } from '../components/EditExpenseModal';
import { useDataEvent } from '../hooks/useDataEvent';
import { Category, MonthlyExpense } from '../types';

type AnyReport = any;

const SLIGHT_OVER_PCT = 5; // amarillo solo si te pasaste poquito (hasta +5%)

const extractYMDFromISO = (iso: string): string | null => {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const parseYMDNoon = (ymd: string): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const lastDayOfMonthNoon = (year: number, month0: number) => {
  // Día 0 del mes siguiente = último día del mes actual
  return new Date(year, month0 + 1, 0, 12, 0, 0, 0);
};

// -------------------------
// ✅ DEDUPE determinístico (igual espíritu que Reports)
// -------------------------
const scoreReport = (r: AnyReport) => {
  const gasto = Math.abs(Number(r?.totalGlobalGasto || 0));
  const presu = Math.abs(Number(r?.totalGlobalPresupuesto || 0));
  const tx = Number(r?.transactionsCount || 0);

  let score = 0;
  if (gasto > 0.000001) score += 100000;
  if (tx > 0) score += 50000;
  if (presu > 0.000001) score += 10000;
  if (String(r?.id || '').startsWith('legacy-')) score += 2000;

  const t =
    r?.updatedAt
      ? new Date(r.updatedAt).getTime()
      : r?.fechaCierre
        ? new Date(r.fechaCierre).getTime()
        : r?.fechaFin
          ? new Date(r.fechaFin).getTime()
          : 0;

  score += Math.floor((t || 0) / 10000000);
  return score;
};

const timeTie = (r: AnyReport) => {
  const t =
    r?.updatedAt
      ? new Date(r.updatedAt).getTime()
      : r?.fechaCierre
        ? new Date(r.fechaCierre).getTime()
        : r?.fechaFin
          ? new Date(r.fechaFin).getTime()
          : 0;
  return t || 0;
};

const dedupeByPeriodNumber = (items: AnyReport[]) => {
  const byNum = new Map<number, AnyReport[]>();

  (items || []).forEach((r) => {
    const n = Number(r?.numeroPeriodo || 0);
    if (!n) return;
    if (!byNum.has(n)) byNum.set(n, []);
    byNum.get(n)!.push(r);
  });

  const result: AnyReport[] = [];

  for (const [n, arr] of byNum.entries()) {
    const best = [...arr].sort((a, b) => {
      const sa = scoreReport(a);
      const sb = scoreReport(b);
      if (sb !== sa) return sb - sa;

      const ta = timeTie(a);
      const tb = timeTie(b);
      if (tb !== ta) return tb - ta;

      const ida = String(a?.id || '');
      const idb = String(b?.id || '');
      return idb.localeCompare(ida, 'en');
    })[0];

    if (arr.length > 1) {
      console.warn(
        `[CLOSING] Duplicados P${n}. Mantengo: ${best?.id}. Candidatos:`,
        arr.map((x) => ({
          id: x?.id,
          gasto: x?.totalGlobalGasto,
          ppto: x?.totalGlobalPresupuesto,
          tx: x?.transactionsCount,
          fin: x?.fechaFin,
          cierre: x?.fechaCierre,
          updatedAt: x?.updatedAt,
        })),
      );
    }

    result.push(best);
  }

  return result;
};

const pickLastClosedReport = (reports: AnyReport[]) => {
  const valid = (reports || []).filter((r) => {
    const nOk = typeof r?.numeroPeriodo === 'number' && !isNaN(r.numeroPeriodo);
    const closedOk = r?.estado === 'cerrado' || !r?.estado; // legacy
    const finOk =
      typeof r?.fechaFin === 'string'
        ? !!extractYMDFromISO(r.fechaFin)
        : typeof r?.fechaFinYMD === 'string';

    const hasMovement =
      Number(r?.transactionsCount || 0) > 0 ||
      Math.abs(Number(r?.totalGlobalGasto || 0)) > 0.000001;

    const notEmpty = r?.isEmpty !== true;

    return nOk && closedOk && finOk && hasMovement && notEmpty;
  });

  valid.sort((a, b) => (b.numeroPeriodo || 0) - (a.numeroPeriodo || 0));
  return valid[0] || null;
};

export const Closing: React.FC = () => {
  const currentUser = localStorage.getItem('currentUser') || 'Usuario';

  const reportsRev = useDataEvent('monthly_reports_changed');
  const closingCfgRev = useDataEvent('closing_config_changed');

  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [dirty, setDirty] = useState(false);

  // “report” = el periodo que estoy viendo (cuando haya selector, cambia esto)
  const [report, setReport] = useState<AnyReport | null>(null);

  // “lastClosedPeriodNumber” = el último cierre REAL (para limitar ajustes)
  const [lastClosedPeriodNumber, setLastClosedPeriodNumber] = useState<number | null>(null);

  const [error, setError] = useState<string>('');

  // Para “ajustes”
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const homeCategories = useMemo(
    () => (categories || []).filter((c) => (c?.scope || 'home') !== 'trip'),
    [categories],
  );

  // ✅ por defecto ocultas
  const [showTransactions, setShowTransactions] = useState(false);

  // ✅ Ajustes comprimidos: barrita plegable
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);

  const [amount, setAmount] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [refundAuto, setRefundAuto] = useState(false);
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCatName, setSelectedCatName] = useState('');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<MonthlyExpense | null>(null);

  const fmt0 = (n: number) => formatLocaleNumber(Number(n || 0), 0);
  const fmt2 = (n: number) => formatLocaleNumber(Number(n || 0), 2);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const reportsRaw = await getMonthlyReports();

      // ✅ Dedupe antes de elegir “último cierre”
      const deduped = dedupeByPeriodNumber((reportsRaw || []) as AnyReport[]);
      const last = pickLastClosedReport(deduped);

      setReport(last);
      setLastClosedPeriodNumber(last?.numeroPeriodo ?? null);

      if (!last) {
        setError('No se encontró un “último cierre” válido (cerrado con movimientos).');
      }
    } catch (e: any) {
      console.error(e);
      setError('No se pudo cargar el cierre desde Firestore.');
      setReport(null);
      setLastClosedPeriodNumber(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    const unsubCats = subscribeToCategories((data) => setCategories(data || []));

    return () => {
      unsubCats?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsRev, closingCfgRev]);

  // Suscripción a gastos SOLO del periodo mostrado (evita leer toda la colección)
  useEffect(() => {
    if (!report?.fechaInicio || !report?.fechaFin) return;

    const startYMD = format(new Date(report.fechaInicio), 'yyyy-MM-dd');
    const endYMD = format(new Date(report.fechaFin), 'yyyy-MM-dd');

    const unsubExp = subscribeToExpensesInRange(startYMD, endYMD, (data) =>
      setExpenses(data || []),
    );

    return () => {
      unsubExp?.();
    };
  }, [report?.fechaInicio, report?.fechaFin]);;

  const headerLabel = useMemo(() => {
    if (!report) return '';
    const fi = report?.fechaInicio ? new Date(report.fechaInicio) : null;
    const ff = report?.fechaFin ? new Date(report.fechaFin) : null;

    if (fi && !isNaN(fi.getTime()) && ff && !isNaN(ff.getTime())) {
      return `P${report.numeroPeriodo} (${format(fi, 'd MMM', { locale: es })} - ${format(ff, 'd MMM', { locale: es })})`.toUpperCase();
    }
    return `P${report.numeroPeriodo}`.toUpperCase();
  }, [report]);

  const period = useMemo(() => {
    if (!report) return null;
    const fiYMD = report?.fechaInicioYMD || extractYMDFromISO(report?.fechaInicio || '');
    const ffYMD = report?.fechaFinYMD || extractYMDFromISO(report?.fechaFin || '');
    if (!fiYMD || !ffYMD) return null;

    const startNoon = parseYMDNoon(fiYMD);
    const endNoon = parseYMDNoon(ffYMD);

    const startLocal = new Date(startNoon);
    startLocal.setHours(0, 0, 0, 0);
    const endLocal = new Date(endNoon);
    endLocal.setHours(23, 59, 59, 999);

    return { fiYMD, ffYMD, startNoon, endNoon, startLocal, endLocal };
  }, [report]);

  // ✅ Solo permite ajustes si el periodo que miro es el último cierre real
  const isSelectedLastClosed = useMemo(() => {
    if (!report || lastClosedPeriodNumber == null) return false;
    return Number(report.numeroPeriodo) === Number(lastClosedPeriodNumber);
  }, [report, lastClosedPeriodNumber]);

  // Ventana de revisión: “hasta el próximo cierre”
  const [reviewEnabled, setReviewEnabled] = useState(false);

  useEffect(() => {
    const compute = async () => {
      try {
        if (!period) return setReviewEnabled(false);

        const cfg = await getClosingConfig();
        const tipo = cfg?.tipo || 'diaFijo';
        const dia = cfg?.diaFijo || 11;

        let nextCloseNoon: Date;

        if (tipo === 'ultimoDia') {
          nextCloseNoon = lastDayOfMonthNoon(
            period.endNoon.getFullYear(),
            period.endNoon.getMonth() + 1,
          );
        } else {
          nextCloseNoon = new Date(
            period.endNoon.getFullYear(),
            period.endNoon.getMonth() + 1,
            dia,
            12, 0, 0, 0,
          );
        }

        const nextCloseEOD = new Date(nextCloseNoon);
        nextCloseEOD.setHours(23, 59, 59, 999);

        setReviewEnabled(new Date().getTime() <= nextCloseEOD.getTime());
      } catch {
        setReviewEnabled(false);
      }
    };
    compute();
  }, [period, closingCfgRev]);

  // ✅ “se puede ajustar” SOLO si: último cierre + dentro de ventana
  const canAdjust = isSelectedLastClosed && reviewEnabled;
  const canEditTransactions = canAdjust;

  // Por defecto, fecha del input dentro del rango del cierre
  useEffect(() => {
    if (!period) return;
    const todayYMD = format(new Date(), 'yyyy-MM-dd');
    if (todayYMD >= period.fiYMD && todayYMD <= period.ffYMD) setExpenseDate(todayYMD);
    else setExpenseDate(period.ffYMD);
  }, [period, closingCfgRev]);

  const inPeriodExpenses = useMemo(() => {
    if (!period) return [];
    return (expenses || [])
      .filter((e) => {
        const dt = new Date(e.fecha);
        const t = dt.getTime();
        return t >= period.startLocal.getTime() && t <= period.endLocal.getTime();
      })
      .slice()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }, [expenses, period]);

  const totals = useMemo(() => {
    const presupuesto = Number(report?.totalGlobalPresupuesto || 0);
    const gasto = Number(report?.totalGlobalGasto || 0);
    const diff = Number(report?.totalGlobalDiferencia || (presupuesto - gasto));
    const percent = presupuesto > 0 ? (Math.max(0, gasto) / presupuesto) * 100 : 0;
    return { presupuesto, gasto, diff, percent };
  }, [report]);

  const getPctColor = (pct: number) => {
    if (pct > 100 + SLIGHT_OVER_PCT) return 'bg-red-500';
    if (pct > 100) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const summaryBarClass = useMemo(() => getPctColor(totals.percent), [totals.percent]);

  const details = useMemo(() => {
    const det = Array.isArray(report?.detalles) ? report.detalles : [];

    const scopeById = new Map<string, 'home' | 'trip'>();
    const scopeByName = new Map<string, 'home' | 'trip'>();

    (categories || []).forEach((c) => {
      const id = String(c?.id || '').trim();
      if (id) scopeById.set(id, (c?.scope || 'home') as any);
      const nameKey = String(c?.nombre || '').trim();
      if (nameKey) scopeByName.set(nameKey.toLowerCase(), (c?.scope || 'home') as any);
    });

    const getScopeForDetail = (d: any): 'home' | 'trip' => {
      const id = String(d?.categoryId || '').trim();
      if (id && scopeById.has(id)) return scopeById.get(id)!;
      const nm = String(d?.categoryName || '').trim().toLowerCase();
      if (nm && scopeByName.has(nm)) return scopeByName.get(nm)!;
      return 'home';
    };

    return det
      .filter((d: any) => getScopeForDetail(d) !== 'trip')
      .map((d: any) => ({
        categoryId: String(d?.categoryId || ''),
        categoryName: String(d?.categoryName || 'SIN CATEGORÍA'),
        presupuesto: Number(d?.presupuesto || 0),
        gastoReal: Number(d?.gastoReal || 0),
        diferencia: Number(d?.diferencia ?? (Number(d?.presupuesto || 0) - Number(d?.gastoReal || 0))),
      }))
      .sort((a, b) => {
        const pa = a.presupuesto > 0 ? Math.max(0, a.gastoReal) / a.presupuesto : 0;
        const pb = b.presupuesto > 0 ? Math.max(0, b.gastoReal) / b.presupuesto : 0;
        if (pb !== pa) return pb - pa;
        return a.categoryName.localeCompare(b.categoryName, 'es');
      });
  }, [report, categories]);

  const topDeviations = useMemo(() => {
    const base = (details || [])
      .map((d) => {
        const overAmount = Math.max(0, d.gastoReal - d.presupuesto);
        const underAmount = Math.max(0, d.presupuesto - d.gastoReal);
        const pct = d.presupuesto > 0 ? (Math.max(0, d.gastoReal) / d.presupuesto) * 100 : 0;
        return { ...d, overAmount, underAmount, pct };
      })
      .filter((d) => d.presupuesto > 0);

    const over = base
      .filter((d) => d.overAmount > 0.000001)
      .sort((a, b) => b.overAmount - a.overAmount)
      .slice(0, 2);

    const under = base
      .filter((d) => d.underAmount > 0.000001)
      .sort((a, b) => b.underAmount - a.underAmount)
      .slice(0, 2);

    return { over, under };
  }, [details]);

  const handleAmountBlur = () => {
    const val = parseLocaleNumber(amount);
    if (!val) return;
    const abs = Math.abs(val);
    const formatted = formatLocaleNumber(abs, 2);
    setAmount(val < 0 ? `-${formatted}` : formatted);
  };

  const handleAmountChange = (raw: string) => {
    setAmount(raw);

    const trimmed = raw.trim();
    if (trimmed.startsWith('-')) {
      if (!isRefund) setIsRefund(true);
      setRefundAuto(true);
      return;
    }

    if (refundAuto) {
      setIsRefund(false);
      setRefundAuto(false);
    }
  };

  const toggleRefund = () => {
    setIsRefund((prev) => !prev);
    setRefundAuto(false);
  };

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!period || !canAdjust) return;

    const rawNum = parseLocaleNumber(amount);
    const abs = Math.abs(rawNum);

    if (!amount || abs <= 0) return;
    if (!selectedCatName) return;

    const finalIsRefund = isRefund || rawNum < 0;
    const finalAmount = finalIsRefund ? -abs : abs;

    if (finalIsRefund) {
      const ok = window.confirm(
        'Estás ingresando una DEVOLUCIÓN. Esto disminuirá tus gastos en esta categoría.\n\n¿Continuar?',
      );
      if (!ok) return;
    }

    const [y, m, d] = expenseDate.split('-').map(Number);
    const finalDate = new Date(y, m - 1, d);

    const now = new Date();
    if (isSameDay(finalDate, now)) {
      finalDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    } else {
      finalDate.setHours(12, 0, 0, 0);
    }

    await addMonthlyExpense({
      fecha: finalDate.toISOString(),
      monto: finalAmount,
      moneda: 'EUR',
      categoria: selectedCatName,
      descripcion: description,
      creado_por_usuario_id: currentUser as any,
      estado: 'activo',
    });

    setDirty(true);
    setAmount('');
    setDescription('');
    setSelectedCatName('');
    setIsRefund(false);
    setRefundAuto(false);
  };

  const handleEditClick = (expense: MonthlyExpense) => {
    if (!canEditTransactions) return;
    setSelectedExpense(expense);
    setEditModalOpen(true);
  };

  const handleUpdateExpense = async (updated: MonthlyExpense) => {
    if (!canEditTransactions) return;
    await updateMonthlyExpense(updated);
    setDirty(true);
  };

  const handleDeleteExpense = async (id: string) => {
    if (!canEditTransactions) return;
    await deleteMonthlyExpense(id);
    setDirty(true);
  };

  const handleRebuild = async () => {
    if (!report || !period || !canAdjust) return;
    setRebuilding(true);
    setError('');
    try {
      await rebuildReportForPeriod({
        numeroPeriodo: Number(report.numeroPeriodo),
        startNoon: period.startNoon,
        endNoon: period.endNoon,
      });
      setDirty(false);
      await load();
    } catch (e) {
      console.error(e);
      setError('Falló el recálculo del cierre. Revisa conexión / rules / permisos.');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="p-4 space-y-5 pb-24">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cierre de mes</h1>
          <p className="text-xs text-slate-400 mt-1">
            Esto muestra el <span className="font-semibold">último periodo cerrado</span> (no el activo).
          </p>
        </div>

        {!!headerLabel && (
          <div className="text-right">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {headerLabel}
            </span>
          </div>
        )}
      </div>

      {(loading || rebuilding) && (
        <Card className="p-4">
          <p className="text-sm text-slate-600">
            {rebuilding ? 'Recalculando cierre...' : 'Cargando cierre...'}
          </p>
        </Card>
      )}

      {!loading && (error || !report) && (
        <Card className="p-4 border border-orange-200 bg-orange-50">
          <div className="flex gap-3 items-start">
            <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-orange-800">No hay cierre para mostrar</p>
              <p className="text-xs text-orange-700 mt-1">
                {error || 'No se encontró un último cierre válido.'}
              </p>

              <div className="mt-3 flex gap-2">
                <Link to="/" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Ir a Inicio
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {!loading && !!report && (
        <>
          {/* RESUMEN */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Resultado del cierre
                </p>
                <p className="text-3xl font-bold text-slate-900 mt-1">
                  € {fmt0(totals.gasto)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Presupuesto: € {fmt0(totals.presupuesto)}
                </p>

                <div className="mt-3">
                  <div className="h-2 w-56 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', summaryBarClass)}
                      style={{ width: `${Math.min(100, Math.max(0, totals.percent))}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {Math.max(0, totals.percent).toFixed(0)}% del presupuesto
                  </p>
                </div>
              </div>

              <div className="text-right">
                <p className="text-xs text-slate-500">Diferencia</p>
                <p
                  className={cn(
                    'text-xl font-bold',
                    totals.diff < 0 ? 'text-red-600' : 'text-emerald-700',
                  )}
                >
                  {totals.diff < 0 ? '-' : '+'}€ {fmt0(Math.abs(totals.diff))}
                </p>

                <Link
                  to="/reports"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 mt-3"
                >
                  Ver histórico <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          </Card>

          {/* MAYORES DESVÍOS */}
          {(topDeviations.over.length > 0 || topDeviations.under.length > 0) && (
            <Card className="p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Mayores desvíos
              </p>

              <div className="mt-3 grid grid-cols-1 gap-3">
                {topDeviations.over.length > 0 && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-3">
                    <div className="flex items-center gap-2 text-red-700">
                      <TrendingUp size={16} />
                      <p className="text-sm font-bold">Las que más se pasaron</p>
                    </div>

                    <div className="mt-2 space-y-2">
                      {topDeviations.over.map((d) => (
                        <div key={`over_${d.categoryName}`} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{d.categoryName}</p>
                            <p className="text-[11px] text-slate-500">{d.presupuesto > 0 ? `+${Math.round((d.overAmount / d.presupuesto) * 100)}% sobre presupuesto` : '—'}</p>
                          </div>
                          <p className="text-sm font-bold text-red-700">+€ {fmt2(d.overAmount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {topDeviations.under.length > 0 && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <TrendingDown size={16} />
                      <p className="text-sm font-bold">Las que más sobraron</p>
                    </div>

                    <div className="mt-2 space-y-2">
                      {topDeviations.under.map((d) => (
                        <div key={`under_${d.categoryName}`} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{d.categoryName}</p>
                            <p className="text-[11px] text-slate-500">{d.presupuesto > 0 ? `${Math.round((d.underAmount / d.presupuesto) * 100)}% bajo presupuesto` : '—'}</p>
                          </div>
                          <p className="text-sm font-bold text-emerald-700">€ {fmt2(d.underAmount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* DETALLE POR CATEGORÍA */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">
              Detalle por categoría
            </h3>

            <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
              {details.map((d) => {
                const pct = d.presupuesto > 0 ? (Math.max(0, d.gastoReal) / d.presupuesto) * 100 : 0;
                const remaining = d.presupuesto - d.gastoReal;
                const isOver = remaining < 0;

                const bar = getPctColor(pct);

                return (
                  <div key={d.categoryName} className="p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-800">{d.categoryName}</p>
                      <p className="text-xs text-slate-500">{Math.round(pct)}%</p>
                    </div>

                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
                      <div
                        className={cn('h-full rounded-full', bar)}
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Gasto: € {fmt2(Math.abs(d.gastoReal))}</span>
                      <span className={cn('font-semibold', isOver ? 'text-red-600' : 'text-emerald-700')}>
                        {isOver ? 'Te pasaste' : 'Quedó'} € {fmt2(Math.abs(remaining))}
                      </span>
                    </div>
                  </div>
                );
              })}

              {details.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">
                  Este cierre no tiene detalle de categorías.
                </div>
              )}
            </div>
          </div>

          {/* ✅ AJUSTES (COMPRIMIDO + SOLO ÚLTIMO CIERRE) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                if (!canAdjust) return;
                setShowAdjustPanel((p) => !p);
              }}
              className={cn(
                'w-full text-left bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between',
                canAdjust ? 'cursor-pointer hover:bg-slate-50' : 'opacity-70',
              )}
            >
              <div className="flex items-center gap-2">
                {!canAdjust && <Lock size={16} className="text-slate-400" />}
                <div>
                  <p className="text-sm font-bold text-slate-900">Ajustar este cierre</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {canAdjust
                      ? 'Disponible hasta el próximo cierre'
                      : 'Solo se puede ajustar el último cierre (y dentro de la ventana).'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {dirty && (
                  <span className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded-full">
                    Cambios pendientes
                  </span>
                )}
                {canAdjust && (showAdjustPanel ? <ChevronUp size={18} /> : <ChevronDown size={18} />)}
              </div>
            </button>

            {canAdjust && showAdjustPanel && (
              <Card className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Ajustes de este cierre</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Agrega/edita/borrar transacciones de este periodo y luego recalcula el cierre.
                    </p>
                  </div>

                  <Button
                    onClick={handleRebuild}
                    disabled={rebuilding}
                    className="whitespace-nowrap"
                  >
                    {rebuilding ? 'Recalculando...' : 'Recalcular cierre'}
                  </Button>
                </div>

                {period && (
                  <form onSubmit={handleSubmitAdd} className="space-y-3">
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                          €
                        </span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => handleAmountChange(e.target.value)}
                          onBlur={handleAmountBlur}
                          placeholder="0,00"
                          className="pl-8 py-2 text-xl font-bold border-none bg-slate-50 focus:ring-0 rounded-lg text-slate-800 placeholder:text-slate-200"
                        />
                      </div>

                      <div className="w-[140px]">
                        <Input
                          type="date"
                          value={expenseDate}
                          min={period.fiYMD}
                          max={period.ffYMD}
                          onChange={(e) => setExpenseDate(e.target.value)}
                          className="bg-slate-50 border-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">Tipo</span>
                      <button
                        type="button"
                        onClick={toggleRefund}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium border transition-colors',
                          isRefund
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : 'bg-white border-slate-200 text-slate-600',
                        )}
                        aria-pressed={isRefund}
                      >
                        <Undo2 size={14} aria-hidden="true" />
                        <span>{isRefund ? 'Devolución' : 'Gasto'}</span>
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <select
                        value={selectedCatName}
                        onChange={(e) => setSelectedCatName(e.target.value)}
                        className="flex-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">Selecciona categoría</option>
                        {homeCategories.map((c) => (
                          <option key={c.id} value={c.nombre}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>

                      <Button
                        type="submit"
                        className={cn(
                          'aspect-square p-0 w-10 h-10 rounded-xl text-white shrink-0',
                          isRefund ? 'bg-emerald-600' : 'bg-blue-600',
                        )}
                      >
                        <Plus size={18} />
                      </Button>
                    </div>

                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Descripción (opcional)"
                      className="bg-slate-50 border-none"
                    />
                  </form>
                )}
              </Card>
            )}
          </div>

          {/* TRANSACCIONES (SIEMPRE OPCIONAL, PERO EDITABLE SOLO ÚLTIMO CIERRE) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">
                Transacciones del cierre
              </h3>
              <button
                onClick={() => setShowTransactions((p) => !p)}
                className="text-xs text-slate-600 inline-flex items-center gap-1"
              >
                {showTransactions ? <EyeOff size={14} /> : <Eye size={14} />}
                {showTransactions ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>

            {showTransactions && (
              <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
                {inPeriodExpenses.map((e) => {
                  const isRefundItem = (e.monto || 0) < 0;
                  const sign = isRefundItem ? '+' : '-';
                  const absVal = Math.abs(e.monto || 0);
                  const fechaFmt = format(new Date(e.fecha), 'dd MMM', { locale: es });

                  return (
                    <div
                      key={e.id}
                      onClick={() => handleEditClick(e)}
                      className={cn(
                        'p-3 flex items-center justify-between',
                        canEditTransactions ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-80',
                      )}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-800">{e.categoria}</p>
                        <p className="text-xs text-slate-400">
                          {e.descripcion ? `${e.descripcion} · ${fechaFmt}` : fechaFmt}
                        </p>
                        {!canEditTransactions && (
                          <p className="text-[10px] text-slate-400 mt-1">
                            Solo lectura (periodo histórico)
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <p className={cn('text-sm font-bold', isRefundItem ? 'text-emerald-700' : 'text-slate-900')}>
                          {sign}€{fmt2(absVal)}
                        </p>
                        <p className="text-[10px] text-slate-400 uppercase">
                          {String(e.creado_por_usuario_id || '').substring(0, 3)}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {inPeriodExpenses.length === 0 && (
                  <div className="p-6 text-center text-slate-400 text-sm">
                    No hay transacciones en este cierre.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal solo si se puede editar */}
          {canEditTransactions && (
            <EditExpenseModal
              isOpen={editModalOpen}
              onClose={() => setEditModalOpen(false)}
              expense={selectedExpense}
              onSave={handleUpdateExpense}
              onDelete={handleDeleteExpense}
            />
          )}
        </>
      )}
    </div>
  );
};
