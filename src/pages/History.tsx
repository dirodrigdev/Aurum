import React, { useEffect, useState } from 'react';
import {
  getExpensesPageInRange,
  getExpensesInRangeOnce,
  deleteMonthlyExpense,
  updateMonthlyExpense,
  getClosingConfig,
  getMonthlyReports,
  getCategories,
} from '../services/db';
import { MonthlyExpense, Category } from '../types';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  calculatePeriodInfo,
  Button,
  getCategoryIcon,
  cn,
} from '../components/Components';
import { pickLastClosedReport } from '../services/reportDedupe';
import { Copy, Check, Trash2 } from 'lucide-react';
import { EditExpenseModal } from '../components/EditExpenseModal';
import { useDataEvent } from '../hooks/useDataEvent';

export const History = () => {
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [copied, setCopied] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<MonthlyExpense | null>(
    null,
  );
  const [activeStartDate, setActiveStartDate] = useState<Date | null>(null);

  const expensesRev = useDataEvent('monthly_expenses_changed');
  const reportsRev = useDataEvent('monthly_reports_changed');
  const closingCfgRev = useDataEvent('closing_config_changed');
  const catsRev = useDataEvent('categories_changed');

  // Paginación para reducir lecturas iniciales
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageCursor, setPageCursor] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Helper con decimales para lista detallada
  const formatWithDecimals = (val: number) => {
    return new Intl.NumberFormat('es-ES', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  // Categorías: lectura puntual (no listener). Reduce lecturas vs onSnapshot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats = await getCategories();
        if (!cancelled) setCategories(cats);
      } catch (e) {
        // Si Firestore está caído/bloqueado, History igual puede funcionar sin íconos.
        if (!cancelled) setCategories([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catsRev]);

  // Inicializar periodo + suscripción a gastos
  useEffect(() => {
    initData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsRev, closingCfgRev]);

  // Lectura paginada de gastos del periodo activo (sin listener). Reduce lecturas vs onSnapshot.
  useEffect(() => {
    if (!activeStartDate) return;
    // reset + primera página
    void loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStartDate, expensesRev]);

  const initData = async () => {
    const [config, reports] = await Promise.all([
      getClosingConfig(),
      getMonthlyReports(),
    ]);
    const diaCierre = config.diaFijo || 11;
    const theoreticalPeriod = calculatePeriodInfo(new Date(), diaCierre);
    // Importante: puede haber duplicados de cierres para el mismo periodo.
    // Tomamos siempre el "winner" del último periodo cerrado.
    const lastReport = pickLastClosedReport(reports) as any | null;

    let realStartDate = theoreticalPeriod.startDate;
    if (lastReport) {
      const endYMD = String(lastReport?.fechaFinYMD || '').trim();
      const lastEnd = endYMD ? new Date(`${endYMD}T12:00:00`) : new Date(lastReport.fechaFin);
      lastEnd.setHours(12, 0, 0, 0);
      const nextStart = addDays(lastEnd, 1);
      nextStart.setHours(0, 0, 0, 0);
      realStartDate = nextStart;
    } else {
      realStartDate.setHours(0, 0, 0, 0);
    }
    setActiveStartDate(realStartDate);
  };

  const PAGE_SIZE = 80;

  const loadFirstPage = async () => {
    if (!activeStartDate) return;
    const startYMD = format(activeStartDate, 'yyyy-MM-dd');
    const endYMD = format(new Date(), 'yyyy-MM-dd');

    setLoadingPage(true);
    try {
      const res = await getExpensesPageInRange(startYMD, endYMD, PAGE_SIZE, null);
      setExpenses(res.items);
      setPageCursor(res.cursor);
      setHasMore(res.items.length === PAGE_SIZE);
    } finally {
      setLoadingPage(false);
    }
  };

  const loadMore = async () => {
    if (!activeStartDate) return;
    if (!hasMore || loadingMore) return;
    const startYMD = format(activeStartDate, 'yyyy-MM-dd');
    const endYMD = format(new Date(), 'yyyy-MM-dd');

    setLoadingMore(true);
    try {
      const res = await getExpensesPageInRange(startYMD, endYMD, PAGE_SIZE, pageCursor);
      setExpenses((prev) => [...prev, ...res.items]);
      setPageCursor(res.cursor);
      setHasMore(res.items.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!activeStartDate) return;
    // Reset al cambiar periodo activo
    setExpenses([]);
    setPageCursor(null);
    setHasMore(false);
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStartDate, expensesRev]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('¿Borrar este gasto?')) {
      await deleteMonthlyExpense(id);
    }
  };

  const handleUpdate = async (updated: MonthlyExpense) => {
    await updateMonthlyExpense(updated);
  };

  const handleCopyAll = async () => {
    if (expenses.length === 0) return;

    let list = expenses;
    if (hasMore && activeStartDate) {
      const ok = window.confirm(
        'Hay más movimientos sin cargar. ¿Cargar todos y copiar?'
      );
      if (!ok) return;

      const startYMD = format(activeStartDate, 'yyyy-MM-dd');
      const endYMD = format(new Date(), 'yyyy-MM-dd');
      list = await getExpensesInRangeOnce(startYMD, endYMD);
    }

    const textData = list
      .map((e) => {
        const isRefund = (e.monto || 0) < 0;
        const sign = isRefund ? '+' : '-';
        const absVal = Math.abs(e.monto || 0);

        return `${format(new Date(e.fecha), 'dd/MM')};${
          e.descripcion || ''
        };${e.categoria};${sign}${formatWithDecimals(absVal)}`;
      })
      .join('\n');

    await navigator.clipboard.writeText(textData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEditClick = (e: MonthlyExpense) => {
    setSelectedExpense(e);
    setEditModalOpen(true);
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Historial</h1>
          <p className="text-xs text-slate-400">Toca para editar</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopyAll}
          aria-label="Copiar todo al portapapeles"
        >
          {copied ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="space-y-2" role="list">
        {loadingPage && expenses.length === 0 && (
          <p className="text-center text-gray-400 mt-10">Cargando movimientos…</p>
        )}

        {expenses.map((item) => {
          // Buscamos la categoría para sacar el icono correcto
          const category = categories.find((c) => c.nombre === item.categoria);
          const Icon = getCategoryIcon(category?.icono || 'General');

          const isRefund = (item.monto || 0) < 0;
          const sign = isRefund ? '+' : '-';
          const absVal = Math.abs(item.monto || 0);

          return (
            <div
              key={item.id}
              role="listitem"
              className="bg-white rounded-xl border border-slate-100 p-3 flex items-center justify-between active:bg-slate-50 transition-colors shadow-sm"
              onClick={() => handleEditClick(item)}
            >
              <div className="flex items-center gap-3 overflow-hidden flex-1">
                <div className="flex flex-col items-center justify-center bg-slate-50 w-10 h-10 rounded-lg shrink-0">
                  <span className="text-xs font-bold text-slate-700">
                    {format(new Date(item.fecha), 'dd')}
                  </span>
                  <span className="text-[9px] text-slate-400 uppercase">
                    {format(new Date(item.fecha), 'MMM', { locale: es })}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate pr-2">
                    {item.descripcion || item.categoria}
                  </p>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Icon size={10} aria-hidden="true" />
                    <p className="text-xs">{item.categoria}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'font-bold whitespace-nowrap',
                    isRefund ? 'text-emerald-700' : 'text-slate-900',
                  )}
                >
                  {sign} {formatWithDecimals(absVal)} €
                </span>
                <button
                  onClick={(e) => handleDelete(e, item.id!)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          );
        })}

        {expenses.length === 0 && (
          <p className="text-center text-gray-400 mt-10">
            Sin movimientos activos
          </p>
        )}

        {hasMore && (
          <div className="pt-2 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Cargando…' : 'Cargar más'}
            </Button>
          </div>
        )}
      </div>

      <EditExpenseModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        expense={selectedExpense}
        onSave={handleUpdate}
        onDelete={() => Promise.resolve()}
      />
    </div>
  );
};
