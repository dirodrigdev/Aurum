import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ArrowLeft,
  PieChart,
  Layers,
  TrendingUp,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Plus,
  Undo2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Lock,
} from 'lucide-react';

import { Consolidado } from './Consolidado';

import {
  Card,
  Button,
  cn,
  Input,
  formatLocaleNumber,
  parseLocaleNumber,
} from '../components/Components';

import {
  getMonthlyReports,
  getExpensesInRangeOnce,
  getCategories,
  addMonthlyExpense,
  updateMonthlyExpense,
  deleteMonthlyExpense,
  getClosingConfig,
} from '../services/db';

import { rebuildReportForPeriod } from '../services/periodClosing';
import { EditExpenseModal } from '../components/EditExpenseModal';
import { useDataEvent } from '../hooks/useDataEvent';
import { isMadridDayClosed } from '../utils/madridTime';
import { getCloseSyncState, runCloseSync } from '../services/closeSync';

import { Category, MonthlyExpense, MonthlyReport } from '../types';
import { periodNumberFromStartYMD } from '../utils/period';

// ✅ Legacy P1–P30 (fallback en memoria para que nunca “desaparezcan”)

type ViewMode = 'monthly' | 'history' | 'consolidated';
type AggregateMode = 'single' | 'last12' | 'last24' | 'sinceStart' | 'custom';

type AnyReport = (MonthlyReport & Record<string, any>) | Record<string, any>;

const SLIGHT_OVER_PCT = 5;

const TOTAL_BUDGET_FALLBACK = 5700;

const MASTER_BUDGETS: Record<string, number> = {
  ALQUILER: 2800,
  'COMIDA FUERA': 700,
  SUPERMERCADO: 650,
  OCIO: 400,
  TRANSPORTE: 225,
  ROPA: 170,
  SERVICIOS: 163,
  AMAZON: 150,
  'SEGURO DE SALUD': 123,
  EXTRA: 100,
  IKER: 89,
  GYM: 70,
  PLATAFORMAS: 35,
  PELUQUERIA: 25,
};

const extractYMDFromISO = (iso: string): string | null => {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const parseYMDNoon = (ymd: string): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const ymdToKey = (ymd: string) => Number(ymd.replace(/-/g, ''));

const canonKey = (s: string) => {
  const raw = (s || '').trim();
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
};

const titleCaseFromKey = (key: string) => {
  const parts = (key || '').toLowerCase().split(' ');
  return parts.map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
};

const getPctColor = (pct: number) => {
  if (pct > 100 + SLIGHT_OVER_PCT) return 'bg-red-500';
  if (pct > 100) return 'bg-yellow-500';
  return 'bg-green-500';
};

// -------------------------
// ✅ DEDUPE determinístico
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

const dedupeByPeriodKey = (items: AnyReport[]) => {
  const byKey = new Map<string, AnyReport[]>();

  (items || []).forEach((raw) => {
    const info = getReportRangeInfo(raw);
    if (!info) return;

    const r: AnyReport = {
      ...raw,
      numeroPeriodo: info.numeroPeriodo,
      // Normalizamos para que el resto del UI sea consistente
      fechaInicioYMD: info.startYMD,
      fechaFinYMD: info.endYMD,
      periodKey: info.periodKey,
    };

    if (!byKey.has(info.periodKey)) byKey.set(info.periodKey, []);
    byKey.get(info.periodKey)!.push(r);
  });

  const result: AnyReport[] = [];

  for (const [key, arr] of byKey.entries()) {
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
        `[REPORTS] Duplicados por rango ${key}. Mantengo: ${best?.id}. Candidatos:`,
        arr.map((x) => ({
          id: x?.id,
          numeroPeriodo: x?.numeroPeriodo,
          fechaInicioYMD: (x as any)?.fechaInicioYMD,
          fechaFinYMD: (x as any)?.fechaFinYMD,
          totalGlobalGasto: x?.totalGlobalGasto,
          transactionsCount: x?.transactionsCount,
          updatedAt: x?.updatedAt,
          fechaCierre: x?.fechaCierre,
        })),
      );
    }

    result.push(best);
  }

  return result;
};

const getReportRangeInfo = (r: AnyReport) => {
  const startYMD = String((r as any)?.fechaInicioYMD || extractYMDFromISO((r as any)?.fechaInicio || '') || '').trim();
  const endYMD = String((r as any)?.fechaFinYMD || extractYMDFromISO((r as any)?.fechaFin || '') || '').trim();
  if (!startYMD || !endYMD) return null;
  const periodKey = `${startYMD}__${endYMD}`;
  const numeroPeriodo = periodNumberFromStartYMD(startYMD);
  return { startYMD, endYMD, periodKey, numeroPeriodo };
};


const isLegacyReport = (r: AnyReport) => String(r?.id || '').startsWith('legacy-');

export const Reports = () => {
  const navigate = useNavigate();
  const reportsRev = useDataEvent('monthly_reports_changed');
  const expensesRev = useDataEvent('monthly_expenses_changed');
  const catsRev = useDataEvent('categories_changed');
  const currentUser = localStorage.getItem('currentUser') || 'Usuario';

  const [reports, setReports] = useState<AnyReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aggregateMode, setAggregateMode] = useState<AggregateMode>('single');

  // Personalizado
  const [customFromId, setCustomFromId] = useState<string>('');
  const [customToId, setCustomToId] = useState<string>('');

  // Ajustes / transacciones
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showTransactions, setShowTransactions] = useState(false);
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  // Alta de transacción
  const [amount, setAmount] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [refundAuto, setRefundAuto] = useState(false);
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCatName, setSelectedCatName] = useState('');

  // Edición
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<MonthlyExpense | null>(null);

  const fmt0 = (n: number) => formatLocaleNumber(Number(n || 0), 0);
  const fmt2 = (n: number) => formatLocaleNumber(Number(n || 0), 2);

  useEffect(() => {
    void loadData();

    let cancelled = false;
    (async () => {
      try {
        const cats = await getCategories();
        if (!cancelled) setCategories(cats || []);
      } catch {
        if (!cancelled) setCategories([]);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsRev, catsRev]);

  async function loadData() {
    try {
      setLoading(true);
      setPermissionDenied(false);
      setLoadError(null);

      const dbData = (await getMonthlyReports()) as AnyReport[];


      const deduped = dedupeByPeriodKey(dbData || []);

      const sorted = deduped.sort((a, b) => (b?.numeroPeriodo || 0) - (a?.numeroPeriodo || 0));
      setReports(sorted);

      if (sorted.length > 0) {
        setSelectedReportId((prev) => prev || String(sorted[0]?.id || ''));
      }

      // init custom range
      if (sorted.length > 0) {
        const newest = sorted[0];
        const oldest = sorted[sorted.length - 1];
        setCustomFromId((prev) => prev || String(oldest?.id || ''));
        setCustomToId((prev) => prev || String(newest?.id || ''));
      }
    } catch (error) {
      console.error('[REPORTS] Error cargando:', error);

      const code = (error as any)?.code;
      const msg = String((error as any)?.message || '');
      const isPerm =
        code === 'permission-denied' ||
        msg.toLowerCase().includes('insufficient permissions') ||
        msg.toLowerCase().includes('permission-denied');

      if (isPerm) {
        setPermissionDenied(true);
        setLoadError(
          'Este dispositivo NO está autorizado para acceder a los datos. Ve a Ajustes, copia tu UID y autorízalo en Firestore en /allowed_uids.'
        );
      } else {
        setPermissionDenied(false);
        setLoadError('No pude cargar los informes. Revisa tu conexión e inténtalo nuevamente.');
      }

      setReports([]);
      setSelectedReportId('');
      setCustomFromId('');
      setCustomToId('');
    } finally {
      setLoading(false);
    }
  }

  const currentReport = useMemo(() => {
    return reports.find((r) => String(r?.id) === String(selectedReportId)) || reports[0] || null;
  }, [reports, selectedReportId]);

  // Carga puntual de gastos del reporte seleccionado (sin listener) para reducir lecturas.
  useEffect(() => {
    if (aggregateMode !== 'single') {
      setExpenses([]);
      return;
    }
    if (!currentReport?.fechaInicio || !currentReport?.fechaFin) return;

    const startYMD = format(new Date(currentReport.fechaInicio), 'yyyy-MM-dd');
    const endYMD = format(new Date(currentReport.fechaFin), 'yyyy-MM-dd');

    let cancelled = false;
    (async () => {
      try {
        const data = await getExpensesInRangeOnce(startYMD, endYMD);
        if (!cancelled) setExpenses(data || []);
      } catch {
        // El estado global de Firestore ya se gestiona en db.ts
        if (!cancelled) setExpenses([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aggregateMode, currentReport?.fechaInicio, currentReport?.fechaFin, expensesRev]);

  const getPeriodLabel = (report: AnyReport, short = false) => {
    try {
      const pNum = report?.numeroPeriodo ? `P${report.numeroPeriodo}` : 'P?';
      if (short) return pNum;

      const fi = report?.fechaInicio || report?.fechaInicioYMD;
      const ff = report?.fechaFin || report?.fechaFinYMD;

      const fiYMD = typeof fi === 'string' ? (fi.includes('-') ? extractYMDFromISO(fi) || fi : fi) : null;
      const ffYMD = typeof ff === 'string' ? (ff.includes('-') ? extractYMDFromISO(ff) || ff : ff) : null;

      if (fiYMD && ffYMD) {
        const start = parseYMDNoon(fiYMD);
        const end = parseYMDNoon(ffYMD);
        return `${pNum} (${format(start, 'd MMM', { locale: es })} - ${format(end, 'd MMM', { locale: es })})`.toUpperCase();
      }
      return pNum;
    } catch {
      return 'P?';
    }
  };

  const closedWithMovementDesc = useMemo(() => {
    const arr = [...(reports || [])].filter((r) => {
      const closedOk = r?.estado === 'cerrado' || !r?.estado; // legacy
      const hasMovement =
        Number(r?.transactionsCount || 0) > 0 ||
        Math.abs(Number(r?.totalGlobalGasto || 0)) > 0.000001;
      const nOk = Number(r?.numeroPeriodo || 0) > 0;

      // Evitar que reportes "futuros" contaminen el selector por defecto.
      // Si la fechaFin está más allá de hoy (Madrid), no lo consideramos candidato.
      const endYMD =
        (r as any)?.fechaFinYMD ||
        extractYMDFromISO(String((r as any)?.fechaFin || '')) ||
        null;
      const endOk = endYMD ? isMadridDayClosed(endYMD) : true;

      return closedOk && hasMovement && nOk && endOk;
    });

    arr.sort((a, b) => (b?.numeroPeriodo || 0) - (a?.numeroPeriodo || 0));
    return arr;
  }, [reports]);

  const closedWithMovementAsc = useMemo(() => {
    return [...closedWithMovementDesc].sort((a, b) => (a?.numeroPeriodo || 0) - (b?.numeroPeriodo || 0));
  }, [closedWithMovementDesc]);

  const lastClosedPeriodNumber = useMemo(() => {
    return closedWithMovementDesc[0]?.numeroPeriodo ?? null;
  }, [closedWithMovementDesc]);

  const lastClosedReportId = useMemo(() => {
    return closedWithMovementDesc[0]?.id ? String(closedWithMovementDesc[0].id) : '';
  }, [closedWithMovementDesc]);

  const last12 = useMemo(() => closedWithMovementDesc.slice(0, 12), [closedWithMovementDesc]);
  const last24 = useMemo(() => closedWithMovementDesc.slice(0, 24), [closedWithMovementDesc]);

  const customWindow = useMemo(() => {
    if (!customFromId || !customToId) return [];
    const a = reports.find((r) => String(r?.id) === String(customFromId));
    const b = reports.find((r) => String(r?.id) === String(customToId));
    const na = Number(a?.numeroPeriodo || 0);
    const nb = Number(b?.numeroPeriodo || 0);
    if (!na || !nb) return [];
    const min = Math.min(na, nb);
    const max = Math.max(na, nb);
    return closedWithMovementAsc.filter((r) => {
      const n = Number(r?.numeroPeriodo || 0);
      return n >= min && n <= max;
    });
  }, [customFromId, customToId, reports, closedWithMovementAsc]);

  const selectedScopeReports = useMemo(() => {
    if (aggregateMode === 'last12') return last12;
    if (aggregateMode === 'last24') return last24;
    if (aggregateMode === 'sinceStart') return closedWithMovementAsc;
    if (aggregateMode === 'custom') return customWindow;
    return currentReport ? [currentReport] : [];
  }, [aggregateMode, last12, last24, closedWithMovementAsc, customWindow, currentReport]);

  const scopeCount = selectedScopeReports.length || 1;
  const isMultiScope = aggregateMode !== 'single' && scopeCount > 1;

  const scopeTotals = useMemo(() => {
    const presupuesto = selectedScopeReports.reduce((acc, r) => {
      const p = Number(r?.totalGlobalPresupuesto || 0);
      return acc + (p > 0 ? p : TOTAL_BUDGET_FALLBACK);
    }, 0);

    const gasto = selectedScopeReports.reduce((acc, r) => acc + Number(r?.totalGlobalGasto || 0), 0);
    const diff = presupuesto - gasto;
    const percent = presupuesto > 0 ? (Math.max(0, gasto) / presupuesto) * 100 : 0;

    return { presupuesto, gasto, diff, percent };
  }, [selectedScopeReports]);

  const summaryBarClass = useMemo(() => getPctColor(scopeTotals.percent), [scopeTotals.percent]);

  // ✅ “vs mes anterior” (solo single)
  const vsPrevPct = useMemo(() => {
    if (aggregateMode !== 'single') return null;
    if (!currentReport) return null;

    const curNum = Number(currentReport?.numeroPeriodo || 0);
    if (!curNum) return null;

    // buscamos el periodo anterior real (en cierres con movimiento)
    const idx = closedWithMovementDesc.findIndex((r) => Number(r?.numeroPeriodo || 0) === curNum);
    if (idx < 0) return null;

    const prev = closedWithMovementDesc[idx + 1];
    if (!prev) return null;

    const prevG = Number(prev?.totalGlobalGasto || 0);
    const curG = Number(currentReport?.totalGlobalGasto || 0);
    if (!isFinite(prevG) || prevG <= 0) return null;

    return ((curG - prevG) / prevG) * 100;
  }, [aggregateMode, currentReport, closedWithMovementDesc]);

  const scopeDetails = useMemo(() => {
    const byKey = new Map<
      string,
      {
        categoryKey: string;
        categoryName: string;
        presupuesto: number;
        gastoReal: number;
      }
    >();

    selectedScopeReports.forEach((rep, repIdx) => {
      const repIsLegacy = isLegacyReport(rep);

      (rep?.detalles || []).forEach((d: any, idx: number) => {
        const k = canonKey(d?.categoryName || '');
        if (!k) return;

        const incomingBudget = Number(d?.presupuesto || 0);
        const master = MASTER_BUDGETS[k];

        const budget = incomingBudget > 0 ? incomingBudget : (master ?? 0);
        const gasto = Number(d?.gastoReal || 0);

        if (!byKey.has(k)) {
          byKey.set(k, {
            categoryKey: k,
            categoryName: String(d?.categoryName || titleCaseFromKey(k)),
            presupuesto: budget,
            gastoReal: gasto,
          });
        } else {
          const prev = byKey.get(k)!;
          byKey.set(k, {
            ...prev,
            presupuesto: prev.presupuesto + budget,
            gastoReal: prev.gastoReal + gasto,
          });
        }

        void repIdx;
        void idx;
        void repIsLegacy;
      });
    });

    // Si hay categorías master que no aparecen, las metemos con gasto 0
    Object.keys(MASTER_BUDGETS).forEach((k) => {
      if (!byKey.has(k)) {
        byKey.set(k, {
          categoryKey: k,
          categoryName: titleCaseFromKey(k),
          presupuesto: (MASTER_BUDGETS[k] || 0) * scopeCount,
          gastoReal: 0,
        });
      }
    });

    const arr = Array.from(byKey.values()).map((d) => {
      const diferencia = Number(d.presupuesto || 0) - Number(d.gastoReal || 0);
      const pct = d.presupuesto > 0 ? (Math.max(0, d.gastoReal) / d.presupuesto) * 100 : 0;
      return { ...d, diferencia, pct };
    });

    arr.sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      return a.categoryName.localeCompare(b.categoryName, 'es');
    });

    return arr;
  }, [selectedScopeReports, scopeCount]);

  // ✅ En agregados: categorías se muestran como PROMEDIO (presupuesto/gasto/diferencia), totales siguen siendo totales
  const scopeDetailsUI = useMemo(() => {
    if (!isMultiScope) return scopeDetails;

    return (scopeDetails || []).map((d) => {
      const presupuesto = Number(d.presupuesto || 0) / scopeCount;
      const gastoReal = Number(d.gastoReal || 0) / scopeCount;
      const diferencia = presupuesto - gastoReal;
      const pct = presupuesto > 0 ? (Math.max(0, gastoReal) / presupuesto) * 100 : 0;
      return { ...d, presupuesto, gastoReal, diferencia, pct };
    });
  }, [scopeDetails, isMultiScope, scopeCount]);

  const topDeviations = useMemo(() => {
    const base = (scopeDetailsUI || [])
      .map((d) => {
        const overAmount = Math.max(0, d.gastoReal - d.presupuesto);
        const underAmount = Math.max(0, d.presupuesto - d.gastoReal);
        return { ...d, overAmount, underAmount };
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
  }, [scopeDetailsUI]);

  // -------------------------
  // ✅ Selector + rangos
  // -------------------------
  const scopeSelectValue =
    aggregateMode === 'last12'
      ? '__last12__'
      : aggregateMode === 'last24'
        ? '__last24__'
        : aggregateMode === 'sinceStart'
          ? '__since__'
          : aggregateMode === 'custom'
            ? '__custom__'
            : (aggregateMode === 'single' && lastClosedReportId && String(selectedReportId) === lastClosedReportId)
              ? '__lastClosed__'
              : (currentReport?.id ? String(currentReport.id) : '');

  const onChangeScopeSelect = (val: string) => {
    // ✅ nuevo: último periodo cerrado
    if (val === '__lastClosed__') {
      if (lastClosedReportId) {
        setAggregateMode('single');
        setSelectedReportId(lastClosedReportId);
      }
      setShowTransactions(false);
      setShowAdjustPanel(false);
      return;
    }

    if (val === '__last12__') {
      setAggregateMode('last12');
      setShowTransactions(false);
      setShowAdjustPanel(false);
      return;
    }
    if (val === '__last24__') {
      setAggregateMode('last24');
      setShowTransactions(false);
      setShowAdjustPanel(false);
      return;
    }
    if (val === '__since__') {
      setAggregateMode('sinceStart');
      setShowTransactions(false);
      setShowAdjustPanel(false);
      return;
    }
    if (val === '__custom__') {
      setAggregateMode('custom');
      setShowTransactions(false);
      setShowAdjustPanel(false);
      return;
    }

    setAggregateMode('single');
    setSelectedReportId(val);
    setShowTransactions(false);
    setShowAdjustPanel(false);
  };

  const monthlyHeader = useMemo(() => {
    if (aggregateMode === 'last12') return 'Últimos 12 periodos';
    if (aggregateMode === 'last24') return 'Últimos 24 periodos';
    if (aggregateMode === 'sinceStart') return 'Desde el inicio';
    if (aggregateMode === 'custom') {
      const a = reports.find((r) => String(r?.id) === String(customFromId));
      const b = reports.find((r) => String(r?.id) === String(customToId));
      const na = Number(a?.numeroPeriodo || 0);
      const nb = Number(b?.numeroPeriodo || 0);
      if (na && nb) return `Personalizado (P${Math.min(na, nb)}–P${Math.max(na, nb)})`;
      return 'Personalizado';
    }
    return currentReport ? `Periodo: ${getPeriodLabel(currentReport)}` : 'Mensual';
  }, [aggregateMode, currentReport, reports, customFromId, customToId, getPeriodLabel]);

  // -------------------------
  // ✅ Periodo (para transacciones + ajustes)
  // -------------------------
  const singlePeriod = useMemo(() => {
    if (aggregateMode !== 'single') return null;
    const r = currentReport;
    if (!r) return null;

    const fiYMD = r?.fechaInicioYMD || extractYMDFromISO(String(r?.fechaInicio || ''));
    const ffYMD = r?.fechaFinYMD || extractYMDFromISO(String(r?.fechaFin || ''));
    if (!fiYMD || !ffYMD) return null;

    const startNoon = parseYMDNoon(fiYMD);
    const endNoon = parseYMDNoon(ffYMD);

    const startLocal = new Date(startNoon);
    startLocal.setHours(0, 0, 0, 0);
    const endLocal = new Date(endNoon);
    endLocal.setHours(23, 59, 59, 999);

    return { fiYMD, ffYMD, startNoon, endNoon, startLocal, endLocal };
  }, [aggregateMode, currentReport]);

  // Ventana de revisión: “hasta el próximo cierre”
  const [reviewEnabled, setReviewEnabled] = useState(false);

  useEffect(() => {
    const compute = async () => {
      try {
        if (!singlePeriod) return setReviewEnabled(false);

        const cfg = await getClosingConfig();
        const tipo = cfg?.tipo || 'diaFijo';
        const dia = cfg?.diaFijo || 11;

        let nextCloseNoon: Date;
        if (tipo === 'ultimoDia') {
          nextCloseNoon = new Date(
            singlePeriod.endNoon.getFullYear(),
            singlePeriod.endNoon.getMonth() + 2,
            0,
            12, 0, 0, 0,
          );
        } else {
          nextCloseNoon = new Date(
            singlePeriod.endNoon.getFullYear(),
            singlePeriod.endNoon.getMonth() + 1,
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

    void compute();
  }, [singlePeriod]);

  const isSelectedLastClosed = useMemo(() => {
    if (aggregateMode !== 'single') return false;
    if (!currentReport || lastClosedPeriodNumber == null) return false;
    return Number(currentReport?.numeroPeriodo || 0) === Number(lastClosedPeriodNumber);
  }, [aggregateMode, currentReport, lastClosedPeriodNumber]);

  const canAdjust = aggregateMode === 'single' && isSelectedLastClosed && reviewEnabled;
  const canEditTransactions = canAdjust;

  // Por defecto, fecha del input dentro del rango del cierre
  useEffect(() => {
    if (!singlePeriod) return;
    const todayYMD = format(new Date(), 'yyyy-MM-dd');
    if (todayYMD >= singlePeriod.fiYMD && todayYMD <= singlePeriod.ffYMD) setExpenseDate(todayYMD);
    else setExpenseDate(singlePeriod.ffYMD);
  }, [singlePeriod]);

  const inPeriodExpenses = useMemo(() => {
    if (!singlePeriod) return [];
    return (expenses || [])
      .filter((e) => e?.estado !== 'borrado')
      .filter((e) => {
        const ymd = extractYMDFromISO(e?.fecha || '');
        if (!ymd) return false;
        const k = ymdToKey(ymd);
        return k >= ymdToKey(singlePeriod.fiYMD) && k <= ymdToKey(singlePeriod.ffYMD);
      })
      .slice()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }, [expenses, singlePeriod]);

  // -------------------------
  // ✅ Acciones (add/edit/delete + rebuild)
  // -------------------------
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
    if (!singlePeriod || !canAdjust) return;

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

    // Si cambió el periodo (auto-cierre) al momento de guardar, fuerza reintento.
    const beforeKey = getCloseSyncState().currentPeriod?.periodKey;
    await runCloseSync('before_monthly_write');
    const afterKey = getCloseSyncState().currentPeriod?.periodKey;
    if (beforeKey && afterKey && beforeKey !== afterKey) {
      window.alert('Se actualizó el periodo. Revisa el cierre y vuelve a intentar.');
      return;
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

    const beforeKey = getCloseSyncState().currentPeriod?.periodKey;
    await runCloseSync('before_monthly_write');
    const afterKey = getCloseSyncState().currentPeriod?.periodKey;
    if (beforeKey && afterKey && beforeKey !== afterKey) {
      window.alert('Se actualizó el periodo. Revisa el cierre y vuelve a intentar.');
      return;
    }

    await updateMonthlyExpense(updated);
    setDirty(true);
  };

  const handleDeleteExpense = async (id: string) => {
    if (!canEditTransactions) return;

    const beforeKey = getCloseSyncState().currentPeriod?.periodKey;
    await runCloseSync('before_monthly_write');
    const afterKey = getCloseSyncState().currentPeriod?.periodKey;
    if (beforeKey && afterKey && beforeKey !== afterKey) {
      window.alert('Se actualizó el periodo. Revisa el cierre y vuelve a intentar.');
      return;
    }

    await deleteMonthlyExpense(id);
    setDirty(true);
  };

  const handleRebuild = async () => {
    if (!currentReport || !singlePeriod || !canAdjust) return;
    setRebuilding(true);
    try {
      await rebuildReportForPeriod({
        numeroPeriodo: Number(currentReport?.numeroPeriodo),
        startNoon: singlePeriod.startNoon,
        endNoon: singlePeriod.endNoon,
      });
      setDirty(false);
      await loadData();
    } catch (e) {
      console.error(e);
      window.alert('Falló el recálculo del cierre. Revisa consola / permisos.');
    } finally {
      setRebuilding(false);
    }
  };

  // -------------------------
  // ✅ Evolución (gráfico simple)
  // -------------------------
  const renderChart = () => {
    if (closedWithMovementAsc.length < 1) return null;

    const values = closedWithMovementAsc.map((p) => Number(p?.totalGlobalGasto || 0));
    const maxData = Math.max(...values, 0);

    const avg =
      values.length > 0
        ? values.reduce((acc, v) => acc + v, 0) / values.length
        : 0;

    const budgetLine = TOTAL_BUDGET_FALLBACK;

    const maxY = Math.max(7000, Math.ceil(maxData / 1000) * 1000);
    const step = 1000;

    const W = 360;
    const H = 180;
    const padL = 44;
    const padR = 10;
    const padT = 12;
    const padB = 32;

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const n = closedWithMovementAsc.length;
    const dx = n === 1 ? 0 : plotW / (n - 1);

    const xAt = (i: number) => padL + i * dx;
    const yAt = (val: number) => padT + plotH * (1 - val / maxY);

    const points = closedWithMovementAsc
      .map((p, i) => `${xAt(i)},${yAt(Number(p?.totalGlobalGasto || 0))}`)
      .join(' ');

    const yAvg = yAt(avg);
    const yBudget = yAt(budgetLine);

    // ✅ labels X cada 3 o 5 según cantidad
    const labelEvery = n <= 12 ? 1 : n <= 30 ? 3 : 5;

    // ✅ líneas verticales sutiles en inicio de año: P8, P20, P32, P44...
    const isYearStart = (pNum: number) => pNum >= 8 && ((pNum - 8) % 12 === 0);

    return (
      <div className="bg-white rounded-xl border border-slate-100 p-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Tendencia (Gasto total)
          </h3>
          <span className="text-[11px] text-slate-500">
            Periodos: {closedWithMovementAsc[0]?.numeroPeriodo} →{' '}
            {closedWithMovementAsc[closedWithMovementAsc.length - 1]?.numeroPeriodo}
          </span>
        </div>

        <div className="flex items-center gap-4 mb-2 text-[11px] text-slate-500">
          <div className="inline-flex items-center gap-2">
            <span className="inline-block h-[2px] w-5 bg-blue-600 rounded" />
            <span>Gasto</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="inline-block h-[2px] w-5 bg-emerald-600 rounded opacity-80" />
            <span>Ppto</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="inline-block h-[2px] w-5 bg-slate-400 rounded opacity-80" />
            <span>Prom: {fmt0(avg)}</span>
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {Array.from({ length: maxY / step + 1 }).map((_, idx) => {
            const v = idx * step;
            const y = yAt(v);
            return (
              <g key={v}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="currentColor" className="text-slate-100" />
                <text
                  x={padL - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fontWeight="700"
                  fill="currentColor"
                  className="text-slate-400"
                >
                  {fmt0(v)}
                </text>
              </g>
            );
          })}

          {/* ✅ líneas verticales “inicio de año” (súper sutiles) */}
          {closedWithMovementAsc.map((p, i) => {
            const num = Number(p?.numeroPeriodo || 0);
            if (!num || !isYearStart(num)) return null;
            const x = xAt(i);
            return (
              <line
                key={String(p?.id || '') + '_year'}
                x1={x}
                y1={padT}
                x2={x}
                y2={H - padB}
                stroke="currentColor"
                className="text-slate-200"
                strokeWidth="1"
                opacity={0.6}
              />
            );
          })}

          <line
            x1={padL}
            y1={yBudget}
            x2={W - padR}
            y2={yBudget}
            stroke="currentColor"
            className="text-emerald-600"
            strokeWidth="2"
            strokeDasharray="4 4"
            opacity={0.85}
          />

          <line
            x1={padL}
            y1={yAvg}
            x2={W - padR}
            y2={yAvg}
            stroke="currentColor"
            className="text-slate-400"
            strokeWidth="2"
            strokeDasharray="3 3"
            opacity={0.85}
          />

          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-blue-600"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* ✅ labels cada 3/5 (o 1 si pocos) */}
          {closedWithMovementAsc.map((p, i) => {
            const show = i % labelEvery === 0 || i === n - 1;
            if (!show) return null;

            return (
              <text
                key={String(p?.id || '') + '_x'}
                x={xAt(i)}
                y={H - 12}
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                fill="currentColor"
                className="text-slate-500"
              >
                P{p?.numeroPeriodo}
              </text>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-5 pb-24">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Informes</h1>
        </div>
      </div>

      {(loading || rebuilding) && (
        <Card className="p-4">
          <p className="text-sm text-slate-600">
            {rebuilding ? 'Recalculando cierre...' : 'Cargando informes...'}
          </p>
        </Card>
      )}

      {!loading && permissionDenied && (
        <Card className="p-4 border border-orange-200 bg-orange-50">
          <div className="flex gap-3 items-start">
            <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-orange-800">Este dispositivo NO está autorizado</p>
              <p className="text-xs text-orange-700 mt-1">
                Ve a Ajustes, copia tu UID y autorízalo en Firestore en la colección 
                <span className="font-mono">allowed_uids</span>.
              </p>
              <div className="mt-3 flex gap-2">
                <Link to="/settings" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Ir a Ajustes
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}


      {!loading && !permissionDenied && reports.length > 0 && (
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setViewMode('monthly')}
            className={cn(
              'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2',
              viewMode === 'monthly' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500',
            )}
          >
            <PieChart size={14} /> Mensual
          </button>
          <button
            onClick={() => setViewMode('history')}
            className={cn(
              'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2',
              viewMode === 'history' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500',
            )}
          >
            <TrendingUp size={14} /> Evolución
          </button>
          <button
            onClick={() => setViewMode('consolidated')}
            className={cn(
              'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2',
              viewMode === 'consolidated' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500',
            )}
          >
            <Layers size={14} /> Consolidado
          </button>
        </div>
      )}

      {!loading && !permissionDenied && reports.length === 0 && viewMode !== 'consolidated' && (
        <Card className="p-4 border border-orange-200 bg-orange-50">
          <div className="flex gap-3 items-start">
            <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-orange-800">Sin informes para mostrar</p>
              <p className="text-xs text-orange-700 mt-1">
                {loadError ? loadError : 'No encontré cierres con movimiento en Firestore.'}
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

      {/* ===================== CONSOLIDADO (skeleton / tab) ===================== */}
      {!loading && !permissionDenied && viewMode === 'consolidated' && (
        <div className="animate-in fade-in slide-in-from-bottom-2">
          <Consolidado embedded />
        </div>
      )}

      {/* ===================== MENSUAL (definitiva) ===================== */}
      {!loading && !permissionDenied && viewMode === 'monthly' && reports.length > 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          {/* Header + Selector (✅ ahora en 2 filas, sin cambiar estética) */}
          <Card className="p-4">
            <div className="space-y-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {monthlyHeader}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {aggregateMode === 'single'
                    ? 'Periodo seleccionado'
                    : `Vista agregada: ${selectedScopeReports.length} periodos`}
                </p>
              </div>

              <div className="w-full">
                <select
                  className="w-full p-2 bg-gray-50 rounded-lg text-slate-700 outline-none border-transparent focus:border-brand-500 text-xs"
                  value={scopeSelectValue}
                  onChange={(e) => onChangeScopeSelect(e.target.value)}
                >
                  {/* ✅ nuevo */}
                  <option value="__lastClosed__">Último periodo cerrado</option>

                  <option value="__last12__">Últimos 12 periodos</option>
                  <option value="__last24__">Últimos 24 periodos</option>
                  <option value="__since__">Desde el inicio</option>
                  <option value="__custom__">Personalizado (P.. a P..)</option>

                  <option disabled value="__sep__">
                    ─────────────
                  </option>

                  {reports.map((r) => (
                    <option key={String(r?.id)} value={String(r?.id)}>
                      {getPeriodLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {aggregateMode === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Desde
                  </p>
                  <select
                    className="w-full p-2 bg-white rounded-lg text-slate-700 border border-slate-200 text-xs"
                    value={customFromId}
                    onChange={(e) => setCustomFromId(e.target.value)}
                  >
                    {reports
                      .slice()
                      .sort((a, b) => (a?.numeroPeriodo || 0) - (b?.numeroPeriodo || 0))
                      .map((r) => (
                        <option key={'from_' + String(r?.id)} value={String(r?.id)}>
                          {getPeriodLabel(r, true)}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Hasta
                  </p>
                  <select
                    className="w-full p-2 bg-white rounded-lg text-slate-700 border border-slate-200 text-xs"
                    value={customToId}
                    onChange={(e) => setCustomToId(e.target.value)}
                  >
                    {reports
                      .slice()
                      .sort((a, b) => (a?.numeroPeriodo || 0) - (b?.numeroPeriodo || 0))
                      .map((r) => (
                        <option key={'to_' + String(r?.id)} value={String(r?.id)}>
                          {getPeriodLabel(r, true)}
                        </option>
                      ))}
                  </select>
                </div>

                <p className="col-span-2 text-[11px] text-slate-500">
                  Se agregan automáticamente solo los cierres con movimiento dentro del rango.
                </p>
              </div>
            )}
          </Card>

          {/* Resumen (estética Closing) */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {aggregateMode === 'single' ? 'Resultado del cierre' : 'Resultado agregado'}
                </p>

                <p className="text-3xl font-bold text-slate-900 mt-1">
                  € {fmt0(scopeTotals.gasto)}
                </p>

                <p className="text-xs text-slate-500 mt-1">
                  Presupuesto: € {fmt0(scopeTotals.presupuesto)}
                </p>

                <div className="mt-3">
                  <div className="h-2 w-56 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', summaryBarClass)}
                      style={{ width: `${Math.min(100, Math.max(0, scopeTotals.percent))}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {Math.max(0, scopeTotals.percent).toFixed(0)}% del presupuesto
                  </p>

                  {/* ✅ nuevo: vs mes anterior (solo single) */}
                  {aggregateMode === 'single' && (
                    <p className="text-[11px] text-slate-400">
                      vs mes anterior:{' '}
                      <span className="font-bold">
                        {vsPrevPct == null
                          ? '—'
                          : `${vsPrevPct >= 0 ? '+' : ''}${Math.round(vsPrevPct)}%`}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <p className="text-xs text-slate-500">Diferencia</p>
                <p
                  className={cn(
                    'text-xl font-bold',
                    scopeTotals.diff < 0 ? 'text-red-600' : 'text-emerald-700',
                  )}
                >
                  {scopeTotals.diff < 0 ? '-' : '+'}€ {fmt0(Math.abs(scopeTotals.diff))}
                </p>

                <button
                  type="button"
                  onClick={() => setViewMode('history')}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 mt-3"
                >
                  Ver evolución <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </Card>

          {/* Mayores desvíos (estética Closing) */}
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
                        <div key={`over_${d.categoryKey}`} className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{d.categoryName}</p>
                            <p className="text-[11px] text-slate-500">{Math.round(d.pct)}% del ppto</p>
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
                      <TrendingUp size={16} className="rotate-180" />
                      <p className="text-sm font-bold">Las que más sobraron</p>
                    </div>

                    <div className="mt-2 space-y-2">
                      {topDeviations.under.map((d) => (
                        <div key={`under_${d.categoryKey}`} className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{d.categoryName}</p>
                            <p className="text-[11px] text-slate-500">{Math.round(d.pct)}% del ppto</p>
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

          {/* Detalle por categoría */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">
              Detalle por categoría
            </h3>

            <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
              {scopeDetailsUI.map((d) => {
                const pct = d.presupuesto > 0 ? (Math.max(0, d.gastoReal) / d.presupuesto) * 100 : 0;
                const remaining = d.presupuesto - d.gastoReal;
                const isOver = remaining < 0;
                const bar = getPctColor(pct);

                return (
                  <div key={d.categoryKey} className="p-3">
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
                      <span className="text-slate-500">
                        Gasto{isMultiScope ? ' prom' : ''}: € {fmt2(Math.abs(d.gastoReal))}
                      </span>
                      <span className={cn('font-semibold', isOver ? 'text-red-600' : 'text-emerald-700')}>
                        {isOver ? 'Te pasaste' : 'Quedó'} € {fmt2(Math.abs(remaining))}
                      </span>
                    </div>
                  </div>
                );
              })}

              {scopeDetailsUI.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">
                  Este cierre no tiene detalle de categorías.
                </div>
              )}
            </div>
          </div>

          {/* ✅ AJUSTES (solo single + último cierre + ventana) */}
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
                      Agrega/edita/borra transacciones de este periodo y luego recalcula el cierre.
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

                {singlePeriod && (
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
                          min={singlePeriod.fiYMD}
                          max={singlePeriod.ffYMD}
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
                        {categories.map((c) => (
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

          {/* Transacciones (solo real para single; en agregado mostramos aviso) */}
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

            {showTransactions && aggregateMode !== 'single' && (
              <Card className="p-4">
                <p className="text-xs text-slate-600">
                  En vistas agregadas no muestro transacciones (sería un tsunami). Selecciona un periodo específico.
                </p>
              </Card>
            )}

            {showTransactions && aggregateMode === 'single' && (
              <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
                {inPeriodExpenses.map((e) => {
                  const isRefundItem = (e.monto || 0) < 0;
                  const sign = isRefundItem ? '+' : '-';
                  const absVal = Math.abs(e.monto || 0);
                  const fechaFmt = format(new Date(e.fecha), 'dd MMM', { locale: es });

                  return (
                    <div
                      key={String(e.id)}
                      onClick={() => handleEditClick(e)}
                      className={cn(
                        'p-3 flex items-center justify-between',
                        canEditTransactions ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-80',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{e.categoria}</p>
                        <p className="text-xs text-slate-400 truncate">
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
        </div>
      )}

      {/* ===================== EVOLUCIÓN ===================== */}
      {!loading && !permissionDenied && viewMode === 'history' && reports.length > 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-2">
          {renderChart()}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="text-[10px] text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-3 font-bold sticky left-0 bg-gray-50 z-10 w-24 border-r border-gray-100 shadow-sm">
                      Categoría
                    </th>
                    {closedWithMovementAsc.map((p) => (
                      <th
                        key={String(p?.id)}
                        className="px-3 py-3 font-bold text-center min-w-[70px]"
                      >
                        {getPeriodLabel(p, true)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-50">
                  {Object.keys(MASTER_BUDGETS)
                    .map((k) => ({ key: k, display: titleCaseFromKey(k) }))
                    .map((cat) => (
                      <tr key={cat.key} className="hover:bg-gray-50">
                        <td
                          className="px-3 py-2 font-medium text-slate-700 sticky left-0 bg-white z-10 border-r border-gray-100 shadow-sm truncate max-w-[120px]"
                          title={cat.display}
                        >
                          {cat.display}
                        </td>

                        {closedWithMovementAsc.map((p) => {
                          const detail = (p?.detalles || []).find(
                            (d: any) => canonKey(String(d?.categoryName || '')) === canonKey(cat.key),
                          );
                          const val = detail ? Number(detail?.gastoReal || 0) : 0;

                          return (
                            <td
                              key={String(p?.id) + '_' + cat.key}
                              className="px-3 py-2 text-right text-xs text-slate-600 tabular-nums"
                            >
                              {val > 0 ? fmt0(val) : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}

                  <tr className="bg-slate-50 font-bold border-t border-gray-200">
                    <td className="px-3 py-3 text-slate-800 sticky left-0 bg-slate-50 z-10 border-r border-gray-200">
                      TOTAL
                    </td>
                    {closedWithMovementAsc.map((p) => (
                      <td
                        key={String(p?.id) + '_total'}
                        className="px-3 py-3 text-right text-xs text-slate-900 tabular-nums"
                      >
                        €{fmt0(Number(p?.totalGlobalGasto || 0))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <Card className="p-4">
            <p className="text-xs text-slate-600">
              Nota: esta tabla usa el set “MASTER_BUDGETS” como catálogo de filas para que sea estable.
              Si quieres que también aparezcan categorías nuevas automáticamente, lo hago (pero hoy lo dejé seguro y ordenado).
            </p>
          </Card>
        </div>
      )}
    </div>
  );
};