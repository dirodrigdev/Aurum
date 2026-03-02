import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  ChevronDown,
  Calendar as CalendarIcon,
  Eye,
  EyeOff,
  Undo2,
  Copy,
  Check,
  Trash2,
  Wallet,        // Icono para la tarjeta nueva
  TrendingUp,    // Icono para estado
  TrendingDown,  // Icono para estado
} from 'lucide-react';
import { format, isSameDay, isBefore, startOfDay, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Card,
  Button,
  calculatePeriodInfo,
  getCategoryIcon,
  parseLocaleNumber,
  formatLocaleNumber,
  Input,
  cn,
  extractYMD,
  parseYMD,
} from '../components/Components';
import {
  subscribeToExpensesFirstPageInRange,
  subscribeToCategories,
  addMonthlyExpense,
  updateMonthlyExpense,
  deleteMonthlyExpense,
  getClosingConfig,
  getMonthlyReports,
  saveCategory,
  getExpensesPageInRange,
  getExpensesInRangeOnce,
  subscribeToPeriodSummary,
  ensurePeriodSummary,
  forceRebuildPeriodSummary,
} from '../services/db';
import { MonthlyExpense, Category } from '../types';
import { EditExpenseModal } from '../components/EditExpenseModal';
import { useDataEvent } from '../hooks/useDataEvent';
import { periodNumberFromStartYMD } from '../utils/period';

const ymdKey = (d: Date) =>
  d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const ymdKeyFromISO = (iso: string) => {
  const ymd = extractYMD(iso);
  if (!ymd) return 0;
  const [y, m, d] = ymd.split('-').map(Number);
  return y * 10000 + m * 100 + d;
};

// Helper para forzar punto de miles sin decimales en encabezados (Ej: 3.192)
const formatMoneyHeader = (n: number) => {
  const entero = Math.round(n).toString();
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const SLIGHT_OVER_PCT = 5;

const getPctColor = (pct: number) => {
  if (pct > 100 + SLIGHT_OVER_PCT) return 'bg-red-500';
  if (pct > 100) return 'bg-yellow-500';
  return 'bg-green-500';
};


export const Home = () => {
  const navigate = useNavigate();
  const expensesRev = useDataEvent('monthly_expenses_changed');

  // Bootstrapping para evitar “flash” de datos del periodo anterior:
  // - Primero resolvemos config + rango real del periodo (initData)
  // - Recién después suscribimos resumen/movimientos
  const [bootstrapped, setBootstrapped] = useState<boolean>(false);
  const [movementsHydrated, setMovementsHydrated] = useState<boolean>(false);
  const [summaryHydrated, setSummaryHydrated] = useState<boolean>(false);
  const [amount, setAmount] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [refundAuto, setRefundAuto] = useState(false);

  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Period Info State
  // ⚠️ Evita el “flash” de números inconsistentes al recargar/Actualizar:
  // en vez de partir con calendario (día 1 → hoy), partimos con el periodo teórico (closingDay=11)
  // y luego initData lo ajusta con la config real + reportes.
  const initialPeriod = useMemo(() => calculatePeriodInfo(new Date(), 11), []);
  const [activeStartDate, setActiveStartDate] = useState<Date>(() => new Date(initialPeriod.startDate));
  const [activeEndDate, setActiveEndDate] = useState<Date>(() => new Date(initialPeriod.endDate));
  const [periodLabel, setPeriodLabel] = useState<string>(() => {
    const uiStart = new Date(initialPeriod.startDate);
    const uiEnd = new Date(initialPeriod.endDate);
    return `P${initialPeriod.periodNumber} (${format(uiStart, 'd MMM', { locale: es })} - ${format(uiEnd, 'd MMM', { locale: es })})`.toUpperCase();
  });
  const [daysRemaining, setDaysRemaining] = useState<number>(() => {
    const uiEnd = new Date(initialPeriod.endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const msPerDay = 1000 * 60 * 60 * 24;
    const remaining = Math.ceil((uiEnd.getTime() - now.getTime()) / msPerDay);
    return Math.max(0, remaining);
  });

  // Bulldozer v2: Movimientos paginados + primera página en realtime
  const PAGE_SIZE = 50;
  const [recentExpenses, setRecentExpenses] = useState<MonthlyExpense[]>([]);
  const [olderExpenses, setOlderExpenses] = useState<MonthlyExpense[]>([]);
  const [firstPageCursor, setFirstPageCursor] = useState<any>(null);
  const [olderCursor, setOlderCursor] = useState<any>(null);
  const [hasMoreMovements, setHasMoreMovements] = useState<boolean>(true);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState<boolean>(false);

  const [activePeriodId, setActivePeriodId] = useState<string>(() => `P${initialPeriod.periodNumber}`);
  const [periodSummary, setPeriodSummary] = useState<any | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sortedCategories, setSortedCategories] = useState<Category[]>([]);
  // Auditoría UX: orden de categorías “seed” por periodo para evitar orden alfabético en un mes nuevo.
  const sortedCatsRef = useRef<Category[]>([]);
  // Guardamos los movimientos del periodo actual en un ref para poder derivar el “seed” al cambiar de periodo
  // (sin depender del orden final por frecuencia).
  const expensesRef = useRef<MonthlyExpense[]>([]);
  const prevPeriodIdRef = useRef<string | null>(null);

  const [selectedCatName, setSelectedCatName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showBudgetDetails, setShowBudgetDetails] = useState(false);

  // Seguridad anti "totales fantasmas": chequeo liviano (y explícito) de consistencia.
  const [summaryHealth, setSummaryHealth] = useState<
    | { status: 'idle' | 'checking' | 'ok' | 'mismatch' | 'error'; details?: string }
  >({ status: 'idle' });
  const [healthNonce, setHealthNonce] = useState(0);

  // Detalle por categoría (Home):
  // - Queremos consistencia 1:1 con Movimientos, especialmente después de editar.
  // - Cuando el panel está abierto, cargamos (una vez) todos los gastos del periodo y los
  //   actualizamos localmente en add/edit/delete para que el UI no quede “stale”.
  const [budgetDetailsExpenses, setBudgetDetailsExpenses] = useState<MonthlyExpense[] | null>(null);
  const [budgetDetailsLoading, setBudgetDetailsLoading] = useState(false);
  const [budgetDetailsError, setBudgetDetailsError] = useState<string>('');
  const [currentUser] = useState(localStorage.getItem('currentUser') || 'Usuario');

  // Edit State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<MonthlyExpense | null>(null);

  // Copiar movimientos (UI Home)
  const [copiedAllMovements, setCopiedAllMovements] = useState(false);
  const [copiedMovementId, setCopiedMovementId] = useState<string | null>(null);

  // Visibilidad del resumen (“ojito”)
  const [isSummaryHidden, setIsSummaryHidden] = useState<boolean>(true);
// Auto-cierre de periodos faltantes (estado UI)
  const [autoCloseState, setAutoCloseState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [autoCloseMsg, setAutoCloseMsg] = useState<string>('');

  useEffect(() => {
    const unsubscribeCategories = subscribeToCategories((data) => {
      if (data.length === 0) {
        const legacy = localStorage.getItem('categories');
        if (legacy) {
          try {
            const parsed: Category[] = JSON.parse(legacy);
            setCategories(parsed);
            parsed.forEach((cat) => {
              saveCategory(cat);
            });
            localStorage.removeItem('categories');
          } catch (e) {
            console.error('No se pudieron parsear las categorías legacy', e);
          }
        }
      }
      setCategories(data);
    });

    let cancelled = false;
    const run = async () => {
      // initData ya maneja el bootstrapping para evitar “flash”
      await initData();
    };

    void run();

    return () => {
      cancelled = true;
      unsubscribeCategories();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Suscripción a primera página (Bulldozer v2) + cursor para "Cargar más"
  useEffect(() => {
    if (!bootstrapped) return;
    if (!activeStartDate || !activeEndDate) return;

    // reset por cambio de periodo
    setRecentExpenses([]);
    setOlderExpenses([]);
    setFirstPageCursor(null);
    setOlderCursor(null);
    setHasMoreMovements(true);
    setMovementsHydrated(false);

    const startYMD = format(activeStartDate, 'yyyy-MM-dd');
    const endYMD = format(activeEndDate, 'yyyy-MM-dd');

    const unsubscribeExpenses = subscribeToExpensesFirstPageInRange(
      startYMD,
      endYMD,
      PAGE_SIZE,
      ({ items, cursor }) => {
        setMovementsHydrated(true);
        setRecentExpenses(items || []);
        setFirstPageCursor(cursor || null);
        // Heurística: si no llena la página, probablemente no hay más
        if ((items || []).length < PAGE_SIZE) setHasMoreMovements(false);
      },
    );

    return () => {
      unsubscribeExpenses?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, activeStartDate, activeEndDate]);

  // ✅ Evita “flash” de resumen viejo cuando cambia el periodo
  useEffect(() => {
    setPeriodSummary(null);
    setSummaryHealth({ status: 'idle' });
    setSummaryHydrated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeriodId]);

  // ✅ Reset del snapshot de detalle por categoría cuando cambia el periodo
  useEffect(() => {
    setBudgetDetailsExpenses(null);
    setBudgetDetailsError('');
    setBudgetDetailsLoading(false);
  }, [activePeriodId, activeStartDate, activeEndDate]);

  const refreshBudgetDetails = async () => {
    try {
      setBudgetDetailsError('');
      setBudgetDetailsLoading(true);
      const startYMD = format(activeStartDate, 'yyyy-MM-dd');
      const endYMD = format(activeEndDate, 'yyyy-MM-dd');
      const all = await getExpensesInRangeOnce(startYMD, endYMD);
      setBudgetDetailsExpenses(all || []);
    } catch {
      setBudgetDetailsError('No se pudo actualizar el detalle por categoría.');
    } finally {
      setBudgetDetailsLoading(false);
    }
  };

  // ✅ Al abrir el panel, traemos el “snapshot completo” del periodo (fuente única para el detalle).
  useEffect(() => {
    if (!bootstrapped) return;
    if (!showBudgetDetails) return;
    void refreshBudgetDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, showBudgetDetails, activePeriodId, activeStartDate, activeEndDate]);

  
  // ✅ Blindaje: si hay cambios en Movimientos y el panel está abierto, refrescamos el snapshot.
  useEffect(() => {
    if (!bootstrapped) return;
    if (!showBudgetDetails) return;
    void refreshBudgetDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expensesRev]);
// ✅ Resumen live del periodo: asegura / se suscribe por doc
  useEffect(() => {
    if (!bootstrapped) return;
    if (!activePeriodId) return;

    // Evita “flash” de resumen del periodo anterior
    setSummaryHydrated(false);

    const startYMD = format(activeStartDate, 'yyyy-MM-dd');
    const endYMD = format(activeEndDate, 'yyyy-MM-dd');

    // build (one-shot) si falta / desfasado
    void ensurePeriodSummary(activePeriodId, startYMD, endYMD);

    const unsub = subscribeToPeriodSummary(activePeriodId, (s) => {
      setSummaryHydrated(true);
      setPeriodSummary(s || null);
    });
    return () => {
      unsub?.();
    };
  }, [bootstrapped, activePeriodId, activeStartDate, activeEndDate]);

  // 🔒 Chequeo de consistencia: si el resumen (totales/categorías) se desincroniza,
  // lo detectamos y damos una acción explícita para recalcular.
  useEffect(() => {
    if (!activePeriodId) return;
    if (!periodSummary) return;

    let cancelled = false;
    const run = async () => {
      try {
        setSummaryHealth({ status: 'checking' });
        const startYMD = format(activeStartDate, 'yyyy-MM-dd');
        const endYMD = format(activeEndDate, 'yyyy-MM-dd');
        const all = await getExpensesInRangeOnce(startYMD, endYMD);
        if (cancelled) return;

        const totalFromMovements = (all || [])
          .filter((e) => (e as any).estado !== 'BORRADO' && (e as any).estado !== 'borrado')
          .reduce((acc, e) => acc + (Number(e.monto) || 0), 0);

        const summaryTotal = Number(periodSummary?.total || 0);
        const diff = Math.abs(totalFromMovements - summaryTotal);

        if (diff > 0.01) {
          setSummaryHealth({
            status: 'mismatch',
            details: `Movimientos: €${totalFromMovements.toFixed(2)} · Resumen: €${summaryTotal.toFixed(2)} (Δ €${diff.toFixed(2)})`,
          });
        } else {
          setSummaryHealth({ status: 'ok' });
        }
      } catch {
        if (!cancelled) setSummaryHealth({ status: 'error', details: 'No se pudo validar consistencia del resumen.' });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeriodId, activeStartDate, activeEndDate, periodSummary?.updated_at, healthNonce]);

  // Clamp de fecha seleccionada al rango del periodo
  useEffect(() => {
    try {
      const minYMD = format(activeStartDate, 'yyyy-MM-dd');
      const maxYMD = format(activeEndDate, 'yyyy-MM-dd');

      if (!expenseDate) return;

      if (expenseDate < minYMD) setExpenseDate(minYMD);
      else if (expenseDate > maxYMD) setExpenseDate(maxYMD);
    } catch {
      // no-op
    }
  }, [activeStartDate, activeEndDate, expenseDate]);

  // Forzar fecha mínima si estamos en el "limbo"
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(activeStartDate);
    start.setHours(0, 0, 0, 0);
    if (isBefore(today, start)) {
      setExpenseDate(format(start, 'yyyy-MM-dd'));
    }
  }, [activeStartDate]);

  // Lista única + ordenada (nuevos + páginas viejas)
  const expenses: MonthlyExpense[] = useMemo(() => {
    const map = new Map<string, MonthlyExpense>();
    const all = [...recentExpenses, ...olderExpenses];
    for (const e of all) {
      const id = e.id || '';
      if (id) map.set(id, e);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    );
  }, [recentExpenses, olderExpenses]);

  // Mantener referencia al set actual de movimientos (para seed al cambiar de periodo)
  useEffect(() => {
    expensesRef.current = expenses;
  }, [expenses]);

  
  // Mantener referencia al último orden calculado (para persistir al cambiar de periodo)
  useEffect(() => {
    sortedCatsRef.current = sortedCategories;
  }, [sortedCategories]);

  // Al cambiar de periodo, persistimos el orden del periodo anterior como “seed”
  useEffect(() => {
    const prev = prevPeriodIdRef.current;
    if (prev && prev !== activePeriodId) {
      // 🔥 Regla nueva (Diego): el “seed” NO es el orden final por frecuencia.
      // Debe replicar el orden de aparición de las categorías en los PRIMEROS movimientos
      // del periodo anterior (first-seen order), asumiendo que ese es el patrón de ingreso.
      const prevExpenses = (expensesRef.current || []).slice();

      const firstSeen: string[] = [];
      const seen = new Set<string>();

      const getExpenseTime = (e: MonthlyExpense) => {
        // created_at es más fiel para “orden de ingreso”. Fallback a fecha.
        const t1 = e.created_at ? new Date(e.created_at).getTime() : NaN;
        if (Number.isFinite(t1)) return t1;
        const t2 = e.fecha ? new Date(e.fecha).getTime() : NaN;
        return Number.isFinite(t2) ? t2 : 0;
      };

      prevExpenses.sort((a, b) => getExpenseTime(a) - getExpenseTime(b));
      for (const e of prevExpenses) {
        const cat = (e?.categoria || '').trim();
        if (!cat) continue;
        if (!seen.has(cat)) {
          seen.add(cat);
          firstSeen.push(cat);
        }
      }

      // Si no hay movimientos previos, caemos al orden calculado (mejor que nada)
      const names = firstSeen.length > 0
        ? firstSeen
        : (sortedCatsRef.current || []).map((c) => c?.nombre).filter(Boolean);

      if (names.length > 0) {
        try {
          localStorage.setItem(`home_cat_order_seed_${prev}`, JSON.stringify(names));
          localStorage.setItem('home_cat_order_seed_last', JSON.stringify(names));
        } catch {
          // no-op (quota / private mode)
        }
      }
    }
    prevPeriodIdRef.current = activePeriodId;
  }, [activePeriodId]);

// Reordenar categorías según uso:
// - 1) Si ya hay señal en el periodo actual → orden por frecuencia (desc).
// - 2) Si aún no hay movimientos (mes nuevo) → repetir “patrón” del periodo anterior (seed) hasta que haya señal.
  useEffect(() => {
    if (categories.length === 0) {
      setSortedCategories([]);
      return;
    }

    // 1) Señal del periodo actual (preferimos lo que vemos en Movimientos, no el summary)
    const usageCount: Record<string, number> = {};
    const startKey = ymdKey(activeStartDate);

    for (const e of expenses) {
      const key = e.fecha ? ymdKeyFromISO(e.fecha) : 0;
      if (key >= startKey) {
        const k = e.categoria;
        if (k) usageCount[k] = (usageCount[k] || 0) + 1;
      }
    }

    const totalSignals = Object.values(usageCount).reduce((acc, n) => acc + (Number(n) || 0), 0);

    // 2) Seed del periodo anterior (si no hay señal todavía)
    let seedOrder: string[] = [];
    const parsePeriodNum = (pid: string) => {
      const n = Number(String(pid || '').replace(/^P/i, ''));
      return Number.isFinite(n) ? n : NaN;
    };
    const curNum = parsePeriodNum(activePeriodId);
    const prevId = Number.isFinite(curNum) ? `P${Math.max(0, curNum - 1)}` : '';

    if (totalSignals === 0) {
      try {
        const raw =
          (prevId && localStorage.getItem(`home_cat_order_seed_${prevId}`)) ||
          localStorage.getItem('home_cat_order_seed_last');
        if (raw) seedOrder = JSON.parse(raw) || [];
      } catch {
        seedOrder = [];
      }
    }

    const seedIndex = new Map<string, number>();
    seedOrder.forEach((name, i) => {
      if (typeof name === 'string' && name) seedIndex.set(name, i);
    });

    const sorted = [...categories].sort((a, b) => {
      if (totalSignals > 0) {
        const countA = usageCount[a.nombre] || 0;
        const countB = usageCount[b.nombre] || 0;
        if (countA !== countB) return countB - countA;
        return a.nombre.localeCompare(b.nombre, 'es');
      }

      // Mes nuevo (sin señal): repetir patrón anterior
      const ia = seedIndex.has(a.nombre) ? seedIndex.get(a.nombre)! : Number.POSITIVE_INFINITY;
      const ib = seedIndex.has(b.nombre) ? seedIndex.get(b.nombre)! : Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia - ib;

      return a.nombre.localeCompare(b.nombre, 'es');
    });

    setSortedCategories(sorted);
  }, [expenses, categories, activeStartDate, activePeriodId]);


  const formatMoney = (amountVal: number, decimals: number = 0) => {
    let num = Number(amountVal);
    if (isNaN(num)) num = 0;
    const fixed = num.toFixed(decimals);
    const [intPart, decPart] = fixed.split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decimals > 0 ? `${intFormatted},${decPart}` : intFormatted;
  };

  const formatWithDecimals = (val: number) => formatLocaleNumber(val, 2);

  const computeClosingYMDFromStart = (startNoon: Date, closingDay: number) => {
    const y = startNoon.getFullYear();
    const m = startNoon.getMonth();

    let candidate = new Date(y, m, closingDay, 12, 0, 0, 0);
    const startAtNoon = new Date(y, m, startNoon.getDate(), 12, 0, 0, 0);

    if (candidate.getTime() < startAtNoon.getTime()) {
      candidate = new Date(y, m + 1, closingDay, 12, 0, 0, 0);
    }
    return candidate;
  };

  const initData = async () => {
      try {
      // Evita “flash” de datos anteriores al recalcular el periodo:
      // ocultamos/reseteamos hasta terminar el bootstrap.
      setBootstrapped(false);
      setMovementsHydrated(false);
      setSummaryHydrated(false);
      setPeriodSummary(null);

      const [config, reports] = await Promise.all([getClosingConfig(), getMonthlyReports()]);
      const diaCierre = config.diaFijo || 11;

      const theoretical = calculatePeriodInfo(new Date(), diaCierre);

      const now = new Date();
      const todayYMD = format(now, 'yyyy-MM-dd');
      const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

      const normalizedReports = (reports || [])
        .map((r: any) => {
          const startYMD = (r?.fechaInicioYMD || extractYMD(r?.fechaInicio || '')) as string | undefined;
          const endYMD = (r?.fechaFinYMD || extractYMD(r?.fechaFin || '')) as string | undefined;
          const closedOk = r?.estado === 'cerrado' || !r?.estado;
          if (!startYMD || !endYMD || !closedOk) return null;

          // Evita avisos/duplicados por periodos futuros (ej: un bug que generó un cierre adelantado)
          const endKey = Number(endYMD.replaceAll('-', ''));
          const todayKey = Number(todayYMD.replaceAll('-', ''));
          if (endKey > todayKey) return null;
          if (endKey === todayKey && nowSeconds < 23 * 3600 + 59 * 60) return null;

          const periodKey = `${startYMD}__${endYMD}`;
          const numeroPeriodo = periodNumberFromStartYMD(startYMD);

          const t =
            typeof r?.updatedAt === 'string'
              ? new Date(r.updatedAt).getTime()
              : typeof r?.fechaCierre === 'string'
                ? new Date(r.fechaCierre).getTime()
                : typeof r?.fechaFin === 'string'
                  ? new Date(r.fechaFin).getTime()
                  : 0;

          return { ...r, numeroPeriodo, __startYMD: startYMD, __endYMD: endYMD, __periodKey: periodKey, __t: t };
        })
        .filter(Boolean) as any[];

      // Dedupe por rango (start/end), no por numeroPeriodo
      const byKey = new Map<string, any[]>();
      for (const r of normalizedReports) {
        const k = String(r?.__periodKey || '');
        if (!k) continue;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(r);
      }

      const scoreReport = (r: any) => {
        const gasto = Math.abs(Number(r?.totalGlobalGasto || 0));
        const presu = Math.abs(Number(r?.totalGlobalPresupuesto || 0));
        const tx = Number(r?.transactionsCount || 0);

        let score = 0;
        if (gasto > 0.000001) score += 100000;
        if (tx > 0) score += 50000;
        if (presu > 0.000001) score += 10000;
        if (String(r?.id || '').startsWith('legacy-')) score += 2000;

        const t =
          typeof r?.updatedAt === 'string'
            ? new Date(r.updatedAt).getTime()
            : typeof r?.fechaCierre === 'string'
              ? new Date(r.fechaCierre).getTime()
              : typeof r?.fechaFin === 'string'
                ? new Date(r.fechaFin).getTime()
                : 0;

        score += Math.floor((t || 0) / 10000000);
        return score;
      };

      const timeTie = (r: any) => {
        const t =
          typeof r?.updatedAt === 'string'
            ? new Date(r.updatedAt).getTime()
            : typeof r?.fechaCierre === 'string'
              ? new Date(r.fechaCierre).getTime()
              : typeof r?.fechaFin === 'string'
                ? new Date(r.fechaFin).getTime()
                : 0;
        return t || 0;
      };

      const dedupedReports = [...byKey.values()].map((arr) => {
        return [...arr].sort((a, b) => {
          const sa = scoreReport(a);
          const sb = scoreReport(b);
          if (sb != sa) return sb - sa;

          const ta = timeTie(a);
          const tb = timeTie(b);
          if (tb != ta) return tb - ta;

          const ida = String(a?.id || '');
          const idb = String(b?.id || '');
          return idb.localeCompare(ida, 'en');
        })[0];
      });

      // El periodo activo se define por calendario (día de cierre), no por el último reporte.
      // Los reports pueden incluir catch-up/históricos o incluso datos corruptos; no deben empujar el periodo.
      const realStartNoon = theoretical.startDate; // noon
      const periodNumber = theoretical.periodNumber;
      const closingNoon = theoretical.endDate; // noon

      const uiStart = new Date(
        realStartNoon.getFullYear(),
        realStartNoon.getMonth(),
        realStartNoon.getDate(),
        0, 0, 0, 0,
      );
      const uiEnd = new Date(
        closingNoon.getFullYear(),
        closingNoon.getMonth(),
        closingNoon.getDate(),
        23, 59, 59, 999,
      );

      setActiveStartDate(uiStart);
      setActiveEndDate(uiEnd);

  const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      const msPerDay = 1000 * 60 * 60 * 24;
      const remaining = Math.ceil((uiEnd.getTime() - todayMidnight.getTime()) / msPerDay);

      setDaysRemaining(Math.max(0, remaining));
      setPeriodLabel(
        `P${periodNumber} (${format(uiStart, 'd MMM', { locale: es })} - ${format(uiEnd, 'd MMM', { locale: es })})`.toUpperCase(),
      );
      setActivePeriodId(`P${periodNumber}`);
    } catch (error) {
      console.error('Error initializing period data:', error);
    } finally {
      setBootstrapped(true);
    }
  };

  const handleAmountBlur = () => {
    const val = parseLocaleNumber(amount);
    if (!val) return;
    const abs = Math.abs(val);
    const formatted = formatWithDecimals(abs);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

    setLoading(true);

    const [y, m, d] = expenseDate.split('-').map(Number);
    const finalDate = new Date(y, m - 1, d);
    finalDate.setHours(12, 0, 0, 0);

    const start = new Date(activeStartDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(activeEndDate);
    end.setHours(23, 59, 59, 999);

    if (finalDate.getTime() < start.getTime() || finalDate.getTime() > end.getTime()) {
      window.alert(
        `Fecha fuera del periodo activo.\n\nPermitido: ${format(start, 'yyyy-MM-dd')} → ${format(end, 'yyyy-MM-dd')}`,
      );
      setLoading(false);
      return;
    }

    const now = new Date();
    if (isSameDay(finalDate, now)) {
      finalDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    }

    const selectedCat = categories.find((c) => c.nombre === selectedCatName);
    const createdRes: any = await addMonthlyExpense({
      fecha: finalDate.toISOString(),
      monto: finalAmount,
      moneda: 'EUR',
      categoria: selectedCatName,
      ...(selectedCat?.id ? { categoryId: selectedCat.id } : {}),
      descripcion: description,
      creado_por_usuario_id: currentUser as any,
      estado: 'activo',
    });

    // Si el panel de detalle está abierto, mantenemos el snapshot consistente.
    if (showBudgetDetails) {
      const newId = String(createdRes?.id || '');
      if (newId) {
        const newItem: MonthlyExpense = {
          id: newId,
          fecha: finalDate.toISOString(),
          monto: finalAmount,
          moneda: 'EUR' as any,
          categoria: selectedCatName,
          categoryId: selectedCat?.id,
          descripcion: description,
          creado_por_usuario_id: currentUser as any,
          estado: 'activo' as any,
        } as any;
        setBudgetDetailsExpenses((prev) => {
          if (!prev) return [newItem];
          // evita duplicados
          const exists = prev.some((e) => e.id === newId);
          return exists ? prev : [newItem, ...prev];
        });
      } else {
        void refreshBudgetDetails();
      }
    }

    setAmount('');
    setDescription('');
    setSelectedCatName('');
    setIsRefund(false);
    setRefundAuto(false);

    const start2 = new Date(activeStartDate);
    start2.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isBefore(today, start2)) setExpenseDate(format(start2, 'yyyy-MM-dd'));
    else setExpenseDate(format(new Date(), 'yyyy-MM-dd'));

    setLoading(false);
    setHealthNonce((n) => n + 1);
  };

  const handleEditClick = (expense: MonthlyExpense) => {
    setSelectedExpense(expense);
    setEditModalOpen(true);
  };

  const handleUpdateExpense = async (updated: MonthlyExpense) => {
    await updateMonthlyExpense(updated);
    // Si la fila estaba en páginas viejas, la actualizamos local para no mostrar stale.
    const id = updated.id;
    if (!id) return;
    setOlderExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated } : e)));
    // Para la primera página, la suscripción debería refrescar sola, pero ayudamos igual.
    setRecentExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated } : e)));

    // Mantener consistente el detalle por categoría (snapshot completo del periodo)
    setBudgetDetailsExpenses((prev) => {
      if (!prev) return prev;
      const startYMD = format(activeStartDate, 'yyyy-MM-dd');
      const endYMD = format(activeEndDate, 'yyyy-MM-dd');
      const ymd = extractYMD(updated.fecha);
      const inRange = !!ymd && ymd >= startYMD && ymd <= endYMD;

      const idx = prev.findIndex((e) => e.id === id);
      if (!inRange) {
        if (idx === -1) return prev;
        return prev.filter((e) => e.id !== id);
      }

      if (idx === -1) return [{ ...updated }, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...updated };
      return next;
    });

    // Fuerza un chequeo liviano (por si algún agregado quedó stale en algún lugar)
    setHealthNonce((n) => n + 1);
  };

  const handleDeleteExpense = async (id: string) => {
    await deleteMonthlyExpense(id);
    setOlderExpenses((prev) => prev.filter((e) => e.id !== id));
    setRecentExpenses((prev) => prev.filter((e) => e.id !== id));

    setBudgetDetailsExpenses((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));

    setHealthNonce((n) => n + 1);
  };

  const handleLoadMoreMovements = async () => {
    if (loadingMoreMovements) return;
    if (!hasMoreMovements) return;

    const startYMD = format(activeStartDate, 'yyyy-MM-dd');
    const endYMD = format(activeEndDate, 'yyyy-MM-dd');
    const cursor = olderCursor || firstPageCursor;
    if (!cursor) {
      setHasMoreMovements(false);
      return;
    }

    try {
      setLoadingMoreMovements(true);
      const res: any = await getExpensesPageInRange(startYMD, endYMD, PAGE_SIZE, cursor);
      const items: MonthlyExpense[] = (res?.items || []) as MonthlyExpense[];

      const existing = new Set<string>();
      for (const e of [...recentExpenses, ...olderExpenses]) if (e.id) existing.add(e.id);

      const fresh = items.filter((e) => e.id && !existing.has(e.id));
      if (fresh.length) setOlderExpenses((prev) => [...prev, ...fresh]);

      setOlderCursor(res?.cursor || null);
      if (!items || items.length < PAGE_SIZE) setHasMoreMovements(false);
    } catch (e) {
      console.error('[Bulldozer] Error cargando más movimientos:', e);
    } finally {
      setLoadingMoreMovements(false);
    }
  };

  const safeMovementDayMonth = (iso: string) => {
    try {
      return format(new Date(iso), 'dd/MM');
    } catch {
      const ymd = extractYMD(iso);
      if (!ymd) return '';
      // yyyy-MM-dd -> dd/MM
      return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
    }
  };

  const buildMovementCopyLine = (e: MonthlyExpense) => {
    const isRefundItem = (e.monto || 0) < 0;
    const sign = isRefundItem ? '+' : '-';
    const absVal = Math.abs(e.monto || 0);

    const date = safeMovementDayMonth(e.fecha || '');
    const descRaw = (e.descripcion || '').replace(/\s+/g, ' ').trim();
    const desc = descRaw || (e.categoria || '');
    const cat = e.categoria || '';

    return `${date};${desc};${cat};${sign}${formatWithDecimals(absVal)}`;
  };

  const handleCopyMovement = async (evt: React.MouseEvent, item: MonthlyExpense) => {
    evt.stopPropagation();
    try {
      const line = buildMovementCopyLine(item);
      if (!line) return;
      await navigator.clipboard.writeText(line);
      setCopiedMovementId(item.id || 'row');
      setTimeout(() => setCopiedMovementId(null), 1500);
    } catch {
      // iOS/Safari a veces bloquea clipboard si no es gesto válido.
    }
  };

  const handleCopyAllMovements = async () => {
    try {
      const startYMD = format(activeStartDate, 'yyyy-MM-dd');
      const endYMD = format(activeEndDate, 'yyyy-MM-dd');
      const all = await getExpensesInRangeOnce(startYMD, endYMD);
      if (all.length === 0) return;

      // Para copiar, mejor orden cronológico (antiguo -> nuevo)
      const ordered = all
        .slice()
        .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      const textData = ordered.map(buildMovementCopyLine).join('\n');
      await navigator.clipboard.writeText(textData);

      setCopiedAllMovements(true);
      setTimeout(() => setCopiedAllMovements(false), 2000);
    } catch {
      // no-op
    }
  };

  const getDateLabel = () => {
    const [y, m, d] = expenseDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (isSameDay(dateObj, new Date())) return 'HOY';
    return format(dateObj, 'd MMM', { locale: es }).toUpperCase();
  };

  // --- LÓGICA DE RESUMEN / PRESUPUESTOS ---
  const startKey = ymdKey(activeStartDate);
  const currentExpenses = expenses.filter((e) => {
    const key = e.fecha ? ymdKeyFromISO(e.fecha) : 0;
    return key >= startKey;
  });

  const orderedCurrentExpenses = currentExpenses
    .slice()
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const catsFromSummary = (periodSummary?.categories || {}) as Record<string, any>;
  const hasSummary = periodSummary && typeof periodSummary.total === 'number';

  // Firestore summary guarda categorías en un map con keys sanitizadas.
  // Reusamos la misma lógica que en db.ts para poder “resolver” legacy names.
  const toSafeCategoryKey = (v: any, fallback: string = 'SIN_CATEGORIA') => {
    const raw = String(v ?? '').trim();
    if (!raw) return fallback;
    const cleaned = raw
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned || fallback;
  };

  const categoryIdByNameLower = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of categories) {
      const name = (c.nombre || '').trim().toLowerCase();
      const id = (c as any).id as string | undefined;
      if (name && id) out[name] = id;
    }
    return out;
  }, [categories]);

  // Snapshot completo del periodo (solo cuando el panel está abierto):
  // agregamos por categoryId (o por match de nombre legacy → categoryId).
  const budgetDetailsAggByCatId = useMemo(() => {
    if (!budgetDetailsExpenses) return null;
    const out: Record<string, { spent: number; count: number }> = {};

    for (const e of budgetDetailsExpenses) {
      if ((e as any).estado && (e as any).estado !== 'activo') continue;
      const amt = Number((e as any).monto || 0);
      if (!Number.isFinite(amt)) continue;

      let catId = String((e as any).categoryId || '').trim();
      if (!catId) {
        const legacy = String((e as any).categoria || '').trim().toLowerCase();
        catId = legacy ? (categoryIdByNameLower[legacy] || '') : '';
      }
      if (!catId) continue;

      const prev = out[catId] || { spent: 0, count: 0 };
      prev.spent += amt;
      prev.count += 1;
      out[catId] = prev;
    }
    return out;
  }, [budgetDetailsExpenses, categoryIdByNameLower]);

  const getSummaryEntryForCategory = (cat: Category) => {
    const id = (cat as any).id as string | undefined;
    const name = String(cat.nombre || '').trim();
    const keysToTry = [
      id,
      id ? toSafeCategoryKey(id, '') : '',
      name,
      name ? toSafeCategoryKey(name, '') : '',
    ].filter((k) => !!k);

    for (const k of keysToTry) {
      const v = catsFromSummary[String(k)];
      if (v) return v;
    }

    // Último recurso: matchea por entry.name
    const target = name.toLowerCase();
    if (target) {
      for (const v of Object.values(catsFromSummary)) {
        const vn = String((v as any)?.name || '').trim().toLowerCase();
        if (vn && vn === target) return v as any;
      }
    }
    return null;
  };

  const categoryStats = categories.map((cat) => {
    let spentNet = 0;
    let count = 0;
    if (showBudgetDetails && budgetDetailsAggByCatId) {
      const id = (cat as any).id as string | undefined;
      const agg = id ? budgetDetailsAggByCatId[id] : undefined;
      spentNet = Number(agg?.spent || 0);
      count = Number(agg?.count || 0);
    } else if (hasSummary) {
      const entry = getSummaryEntryForCategory(cat);
      spentNet = Number((entry as any)?.spent || 0);
      count = Number((entry as any)?.count || 0);
    } else {
      // fallback (por si summary todavía no está)
      const catExps = currentExpenses.filter((e) => e.categoria === cat.nombre);
      spentNet = catExps.reduce((acc, curr) => acc + (curr.monto || 0), 0);
      count = catExps.length;
    }

    const spentForPercent = Math.max(0, spentNet);
    const percent = cat.presupuestoMensual > 0 ? (spentForPercent / cat.presupuestoMensual) * 100 : 0;

    return { ...cat, spent: spentNet, percent, count };
  });


  // ✅ Detalle por categoría (Home): MISMO diseño que Reports → solo categorías con presupuesto activo
  const budgetDetailsCategories = useMemo(() => {
    const budgeted = categoryStats.filter((c) => (c.presupuestoMensual || 0) > 0);
    budgeted.sort((a, b) => b.percent - a.percent);
    return budgeted;
  }, [categoryStats]);

  const totalBudget = categoryStats.reduce((acc, c) => acc + c.presupuestoMensual, 0);
  const totalSpent = hasSummary ? Number(periodSummary?.total || 0) : categoryStats.reduce((acc, c) => acc + (c.spent || 0), 0);

  // ✅ Para evitar “flash” (mes anterior → 0 → mes actual), solo mostramos métricas cuando:
  // - ya resolvimos el periodo real (bootstrapped)
  // - ya hidratamos la primera página de movimientos (aunque venga vacía)
  const metricsReady = bootstrapped && movementsHydrated;

  // ✅ Ritmo del periodo: usamos un %"variable" que excluye gastos fijos.
  // FIX: antes era heurística (95–105% + 1 ejecución) y podía “cambiar de opinión” por efectos de datos/summary.
  // Ahora es explícito: el usuario marca "Gasto fijo" en Settings (Home).
  const fixedCategories = categoryStats.filter((c) => !!(c as any).isFixed);
  const fixedCategoryNameSet = new Set(fixedCategories.map((c) => c.nombre));
  const fixedBudget = fixedCategories.reduce((acc, c) => acc + c.presupuestoMensual, 0);
  const fixedSpentForPercent = fixedCategories.reduce((acc, c) => acc + Math.max(0, c.spent || 0), 0);

  const totalSpentForPercent = Math.max(0, totalSpent);
  const totalPercentExact = totalBudget > 0 ? (totalSpentForPercent / totalBudget) * 100 : 0;

  const variableCategories = categoryStats.filter((c) => !(c as any).isFixed);
  const variableBudget = variableCategories.reduce((acc, c) => acc + (c.presupuestoMensual || 0), 0);
  const variableSpentForPercent = variableCategories.reduce(
    (acc, c) => acc + Math.max(0, c.spent || 0),
    0,
  );

  // Si NO hay presupuesto variable (p.ej. marcaste todo como fijo), no tiene sentido evaluar "ritmo variable".
  const hasVariableBudget = variableBudget > 0.000001;
  const variablePercentExact = hasVariableBudget ? (variableSpentForPercent / variableBudget) * 100 : 0;

  // ✅ Ritmo del periodo (robusto): usamos DÍAS calendario, no milisegundos.
  // Motivo: con ms (hora/minuto + tz) puedes ver saltos raros de “Ojo”/colores sin haber gastado.
  const startDay = startOfDay(activeStartDate);
  const endDay = startOfDay(activeEndDate);
  const todayDay = startOfDay(new Date());

  // +1 para considerar el día de inicio como parte del periodo (inclusive)
  const totalDays = Math.max(1, differenceInCalendarDays(endDay, startDay) + 1);
  const elapsedDaysRaw = differenceInCalendarDays(todayDay, startDay) + 1;
  const elapsedDays = Math.min(totalDays, Math.max(0, elapsedDaysRaw));

  const timePercent = (elapsedDays / totalDays) * 100;

  // Disponible (presupuesto - gasto)
  const diff = totalBudget - totalSpent;
  const isOverBudget = diff <= 0;

  // "Al límite": cuando queda <= 1% del presupuesto (mín €5)
  const nearLimitThreshold = totalBudget > 0 ? Math.max(5, totalBudget * 0.01) : 0;
  const isNearLimit = !isOverBudget && diff <= nearLimitThreshold;

  // "Ojo": gastando por encima del ritmo del tiempo (solo si aún no estás al límite)
  // Nota: Para el "ritmo" usamos el gasto VARIABLE (excluye fijos que suelen caer 1 vez, p.ej. alquiler)
  const isAheadOfPace = hasVariableBudget && !isOverBudget && !isNearLimit && variablePercentExact > timePercent + 5;

  // Unificamos criterio: color + texto vienen del mismo estado
  let donutColor = 'text-emerald-400';
  if (isOverBudget) donutColor = 'text-red-400';
  else if (isNearLimit) donutColor = 'text-orange-400';
  else if (isAheadOfPace) donutColor = 'text-yellow-400';

  const statusLabel = isOverBudget
    ? 'Excedido'
    : isNearLimit
      ? 'Al límite'
      : isAheadOfPace
        ? 'Ojo'
        : 'Bajo control';

  const statusPillClass = isOverBudget
    ? 'bg-red-500/20 text-red-100'
    : isNearLimit
      ? 'bg-orange-500/20 text-orange-100'
      : isAheadOfPace
        ? 'bg-yellow-500/20 text-yellow-100'
        : 'bg-emerald-500/20 text-emerald-100';

  const StatusIcon = (isOverBudget || isNearLimit || isAheadOfPace) ? TrendingUp : TrendingDown;

  const radius = 28; // Radio más grande para la nueva card
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (Math.min(totalPercentExact, 100) / 100) * circumference;

  const percentLabel = (() => {
    if (totalBudget <= 0) return 0;
    const rounded = Math.round(Math.min(totalPercentExact, 999));
    // Nunca muestres 100% si aún queda presupuesto (redondeo)
    if (!isOverBudget && rounded >= 100) return 99;
    return rounded;
  })();

  const activeCurrency = '€';

  // Variables de UI “seguras” (evitan mostrar datos viejos o 0 transitorio)
  const displaySpentText = metricsReady ? `${activeCurrency} ${formatMoneyHeader(totalSpent)}` : null;
  const displayBudgetText = metricsReady ? `${activeCurrency} ${formatMoneyHeader(totalBudget)}` : null;
  const displayDiffText = metricsReady ? `${diff > 0 ? '+' : ''}${activeCurrency} ${formatMoneyHeader(diff)}` : null;
  const displayPercentText = metricsReady ? `${percentLabel}%` : '—';
  const displayDonutColor = metricsReady ? donutColor : 'text-slate-300';
  const displayStrokeDashoffset = metricsReady ? strokeDashoffset : circumference;
  const displayStatusLabel = metricsReady ? statusLabel : 'Cargando…';
  const displayStatusPillClass = metricsReady ? statusPillClass : 'bg-white/10 text-slate-200';
  const DisplayStatusIcon = metricsReady ? StatusIcon : TrendingDown;

  const formatDeltaPct = (p?: number) => {
    if (typeof p !== 'number' || isNaN(p)) return null;
    const sign = p > 0 ? '+' : '';
    return `${sign}${Math.round(p * 100)}%`;
  };

  return (
    <div className="p-4 space-y-5 pb-24">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Hola, {currentUser}</h1>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {periodLabel}
          </span>
          {autoCloseState === 'running' && (
            <div className="mt-1 text-[10px] text-slate-400">Actualizando cierres…</div>
          )}
          {autoCloseState === 'error' && (
            <button
              type="button"
              onClick={initData}
              className="mt-1 text-[10px] text-red-500 font-bold underline"
            >
              Auto-cierre falló · Reintentar
            </button>
          )}
          {autoCloseState === 'ok' && autoCloseMsg && (
            <div className="mt-1 text-[10px] text-slate-400">{autoCloseMsg}</div>
          )}
        </div>
      </div>

      {/* TARJETA TITANIO (GRIS AZULADO) */}
      <Card className="relative overflow-hidden border-none shadow-lg bg-gradient-to-br from-slate-800 via-slate-700 to-zinc-600 text-white text-shadow-soft">

        {/* Manto de privacidad */}
        {isSummaryHidden && (
          <div className="absolute inset-0 bg-slate-800/95 z-20 flex flex-col items-center justify-center">
            <p className="text-xs font-medium text-slate-300 bg-slate-700/50 px-3 py-1 rounded-full border border-slate-600/50">
              Resumen oculto
            </p>
          </div>
        )}

        {/*
          Wrapper "principal" del resumen:
          - Mantiene el botón de privacidad fijo en la card principal (no se desplaza con el detalle por categoría).
        */}
        <div className="relative">
        <div className={cn('p-6 transition-all duration-300', isSummaryHidden && 'opacity-20 blur-sm')}>
          <div className="flex justify-between items-start mb-1">
            <div className="flex items-center gap-2">
               <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm border border-white/5">
                 <Wallet size={20} className="text-slate-100" />
               </div>
               <span className="text-xs text-slate-200 uppercase tracking-wider font-semibold">Gastado este mes</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2">
            {/* Lado Izquierdo: Monto y Estado */}
            <div>
              <div className="text-4xl font-bold tracking-tight text-white">
                {displaySpentText ? (
                  displaySpentText
                ) : (
                  <span className="inline-block h-10 w-44 rounded-lg bg-white/10 animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                 <div className={cn("text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-medium", displayStatusPillClass)}>
                    <DisplayStatusIcon size={12} />
                    <span>{displayStatusLabel}</span>
                 </div>
              </div>
            </div>

            {/* Lado Derecho: Donut Chart (RECUPERADO) */}
            <div className="relative h-20 w-20 flex items-center justify-center shrink-0">
               <svg className="w-full h-full transform -rotate-90" viewBox="0 0 64 64">
                  {/* Fondo del anillo */}
                  <circle
                    cx="32" cy="32" r={radius}
                    stroke="currentColor" strokeWidth="6" fill="transparent"
                    className="text-slate-900/30"
                  />
                  {/* Progreso */}
                  <circle
                    cx="32" cy="32" r={radius}
                    stroke="currentColor" strokeWidth="6" fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={displayStrokeDashoffset}
                    strokeLinecap="round"
                    className={cn("transition-all duration-1000 ease-out", displayDonutColor)}
                  />
               </svg>
               <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">
                    {displayPercentText}
                  </span>
               </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-white/10 flex justify-between items-end relative z-10">
             <div>
                <p className="text-[10px] text-slate-300 uppercase">Presupuesto</p>
                <p className="text-sm font-semibold text-white">
                  {displayBudgetText ? (
                    displayBudgetText
                  ) : (
                    <span className="inline-block h-4 w-24 rounded bg-white/10 animate-pulse" />
                  )}
                </p>
             </div>
             {/* Padding right 12 (pr-12) para que el texto no toque el botón ojo */}
             <div className="text-right pr-12">
                <p className="text-[10px] text-slate-300 uppercase">Disponible</p>
                <p className={cn("text-lg font-bold", isOverBudget ? "text-red-300" : "text-emerald-300")}>
                   {displayDiffText ? (
                     displayDiffText
                   ) : (
                     <span className="inline-block h-5 w-28 rounded bg-white/10 animate-pulse" />
                   )}
                </p>
             </div>
          </div>
        </div>

        {/* Botón Ojo — siempre en la card principal */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsSummaryHidden((prev) => {
              const next = !prev;
              // Si activas privacidad, colapsa el detalle para no quedar en "modo privacidad largo"
              if (next) setShowBudgetDetails(false);
              return next;
            });
          }}
          className="absolute bottom-4 right-4 z-30 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white/90 transition-colors backdrop-blur-md"
        >
          {isSummaryHidden ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        </div>

        {/* Chevron sutil (sin ocupar espacio): toggle del detalle por categoría */}
        {!isSummaryHidden && (
          <div className="relative h-0 z-40">
            <button
              type="button"
              onClick={() => setShowBudgetDetails((v) => !v)}
              aria-expanded={showBudgetDetails}
              className="absolute left-1/2 -top-6 -translate-x-1/2 p-1.5 text-white/60 hover:text-white/90 transition-colors"
              title={showBudgetDetails ? 'Ocultar detalle por categoría' : 'Ver detalle por categoría'}
            >
              <ChevronDown
                size={16}
                className={cn('transition-transform duration-200', showBudgetDetails && 'rotate-180')}
              />
            </button>
          </div>
        )}

        {/* Aviso de consistencia (solo si hay desync) */}
        {!isSummaryHidden && summaryHealth.status === 'mismatch' && (
          <div className="px-4 pb-3">
            <div className="mt-2 rounded-xl border border-white/10 bg-white/10 backdrop-blur-sm p-3 flex items-start justify-between gap-3">
              <div className="text-[11px] text-white/90">
                <div className="font-extrabold tracking-wide">Resumen desincronizado</div>
                <div className="mt-0.5 text-white/70">{summaryHealth.details}</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setSummaryHealth({ status: 'checking' });
                    const startYMD = format(activeStartDate, 'yyyy-MM-dd');
                    const endYMD = format(activeEndDate, 'yyyy-MM-dd');
                    await forceRebuildPeriodSummary(activePeriodId, startYMD, endYMD);
                    setHealthNonce((n) => n + 1);
                  } catch {
                    setSummaryHealth({ status: 'error', details: 'No se pudo recalcular el resumen.' });
                  }
                }}
                className="text-[11px] font-extrabold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white/80"
                title="Recalcula el resumen (totales/categorías) leyendo Movimientos"
              >
                Recalcular
              </button>
            </div>
          </div>
        )}

        {/* Detalle por categoría (colapsable) — mismo look que Reports/Mensual */}
        {!isSummaryHidden && showBudgetDetails && (
          <div className={cn('px-4 pb-4 pt-3 bg-white text-slate-900', isSummaryHidden && 'opacity-20 blur-sm')}>
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Detalle por categoría
              </p>
              <button
                type="button"
                onClick={refreshBudgetDetails}
                disabled={budgetDetailsLoading}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                {budgetDetailsLoading ? 'Actualizando…' : 'Actualizar'}
              </button>
            </div>

            {!!budgetDetailsError && (
              <div className="mt-1 px-1 text-xs font-semibold text-red-600">{budgetDetailsError}</div>
            )}

            <div className="mt-2 bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
              {budgetDetailsLoading && !budgetDetailsExpenses ? (
                <div className="p-6 text-center text-slate-400 text-sm">Actualizando…</div>
              ) : (
                budgetDetailsCategories.map((cat) => {
                const presupuesto = Number(cat.presupuestoMensual || 0);
                const gastoReal = Number(cat.spent || 0);
                const pct = presupuesto > 0 ? (Math.max(0, gastoReal) / presupuesto) * 100 : 0;
                const remaining = presupuesto - gastoReal;
                const isOver = remaining < 0;
                const bar = getPctColor(pct);

                return (
                  <div key={cat.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-800">{cat.nombre}</p>
                      <p className="text-xs text-slate-500">{Math.round(pct)}%</p>
                    </div>

                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
                      <div
                        className={cn('h-full rounded-full', bar)}
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">
                        Gasto: € {formatMoney(Math.abs(gastoReal), 2)}
                      </span>
                      <span className={cn('font-semibold', isOver ? 'text-red-600' : 'text-emerald-700')}>
                        {isOver ? 'Te pasaste' : 'Quedó'} € {formatMoney(Math.abs(remaining), 2)}
                      </span>
                    </div>
                  </div>
                );
                })
              )}

              {!budgetDetailsLoading && budgetDetailsCategories.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">
                  No hay categorías con presupuesto activo.
                </div>
              )}
            </div>
          </div>
        )}
      </Card>


      {/* INPUT */}
      <Card className="p-3 bg-white shadow-sm border border-slate-100">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2 items-center">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                €
              </span>
              <Input
                id="amount-input"
                type="text"
                inputMode="decimal"
                aria-label="Monto del gasto"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onBlur={handleAmountBlur}
                placeholder="0,00"
                className="pl-8 py-2 text-2xl font-bold border-none bg-slate-50 focus:ring-0 rounded-lg text-slate-800 placeholder:text-slate-200"
              />
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Cambiar fecha del gasto"
                className="h-12 w-12 bg-slate-50 rounded-lg flex flex-col items-center justify-center text-blue-600 border border-slate-100 relative overflow-hidden"
              >
                <CalendarIcon size={18} aria-hidden="true" />
                <span className="text-[9px] font-bold">{getDateLabel()}</span>
                <input
                  type="date"
                  aria-label="Selector de fecha"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  value={expenseDate}
                  min={format(activeStartDate, 'yyyy-MM-dd')}
                  max={format(activeEndDate, 'yyyy-MM-dd')}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">Tipo de movimiento</span>
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
              <span>{isRefund ? 'Devolución activa' : 'Marcar devolución'}</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="Categoría del gasto"
            className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1"
          >
            {sortedCategories.map((cat) => {
              const Icon = getCategoryIcon(cat.icono || 'General');
              const isSelected = selectedCatName === cat.nombre;
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedCatName(cat.nombre)}
                  className={cn(
                    'flex flex-col items-center gap-1 min-w-[64px] p-2 rounded-xl transition-all border',
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white shadow-md scale-105'
                      : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50',
                  )}
                >
                  <Icon size={20} className={isSelected ? 'text-white' : 'text-current'} aria-hidden="true" />
                  <span className="text-[9px] font-medium truncate w-full text-center">{cat.nombre}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Input
              id="description-input"
              aria-label="Descripción del gasto (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción (Opcional)"
              className="py-2 text-sm bg-slate-50 border-none"
            />
            <Button
              type="submit"
              disabled={loading}
              aria-label="Agregar Gasto"
              className={cn(
                'aspect-square p-0 w-10 h-10 rounded-xl text-white shrink-0',
                isRefund ? 'bg-emerald-600' : 'bg-blue-600',
              )}
            >
              <Plus size={20} aria-hidden="true" />
            </Button>
          </div>
        </form>
      </Card>

      {/* MOVIMIENTOS (Historial + Últimos) */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Movimientos
            </h3>
            <p className="text-[10px] text-slate-400">Toca para editar • Copia o borra desde aquí</p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyAllMovements}
            aria-label="Copiar todos los movimientos al portapapeles"
            disabled={orderedCurrentExpenses.length === 0}
          >
            {copiedAllMovements ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
          </Button>
        </div>

        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div
            className="max-h-[520px] overflow-y-auto divide-y divide-slate-50"
            role="list"
            aria-label="Lista de movimientos del periodo"
          >
            {orderedCurrentExpenses.map((item) => {
              const category = categories.find((c) => c.nombre === item.categoria);
              const Icon = getCategoryIcon(category?.icono || 'General');
              const fechaFmt = format(new Date(item.fecha), 'dd MMM', { locale: es });

              const isRefundItem = (item.monto || 0) < 0;
              const sign = isRefundItem ? '+' : '-';
              const absVal = Math.abs(item.monto || 0);

              const by = (item.creado_por_usuario_id || '').toString();
              const byShort = by ? by.substring(0, 3) : '---';

              const rowCopied = copiedMovementId === (item.id || 'row');

              return (
                <div
                  role="listitem"
                  key={item.id}
                  onClick={() => handleEditClick(item)}
                  className="p-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-brand-50 text-brand-600 p-2 rounded-lg shrink-0">
                      <Icon size={18} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {item.categoria}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {item.descripcion ? `${item.descripcion} · ${fechaFmt}` : fechaFmt}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p
                        className={cn(
                          'text-sm font-bold',
                          isRefundItem ? 'text-emerald-700' : 'text-slate-900',
                        )}
                      >
                        {sign}€{formatWithDecimals(absVal)}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase">{byShort}</p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleCopyMovement(e, item)}
                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="Copiar movimiento"
                        type="button"
                      >
                        {rowCopied ? <Check size={16} /> : <Copy size={16} />}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!item.id) return;
                          const ok = window.confirm('¿Borrar este gasto?');
                          if (!ok) return;
                          void handleDeleteExpense(item.id);
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="Borrar movimiento"
                        type="button"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {orderedCurrentExpenses.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">
                Sin movimientos este periodo
              </div>
            )}
          </div>

          {hasMoreMovements && (
            <div className="p-3 border-t border-slate-50 bg-white">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleLoadMoreMovements()}
                disabled={loadingMoreMovements || !firstPageCursor}
                className="w-full"
              >
                {loadingMoreMovements ? 'Cargando…' : 'Cargar más'}
              </Button>
              {!firstPageCursor && (
                <div className="mt-2 text-[10px] text-slate-400 text-center">
                  No hay más para cargar.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EditExpenseModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        expense={selectedExpense}
        onSave={handleUpdateExpense}
        onDelete={handleDeleteExpense}
        minDate={activeStartDate}
        maxDate={activeEndDate}
      />
    </div>
  );
};