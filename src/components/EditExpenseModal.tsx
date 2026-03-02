import React, { useState, useEffect } from 'react';
import { X, Trash2, Save, Calendar, Undo2 } from 'lucide-react';
import { MonthlyExpense, Category, ProjectExpense } from '../types';
import {
  Button,
  Input,
  formatLocaleNumber,
  parseLocaleNumber,
  getCategoryIcon,
  cn,
} from './Components';
import { getCategories } from '../services/db';
import { format } from 'date-fns';

type EditableExpense = MonthlyExpense | ProjectExpense;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  expense: EditableExpense | null;
  onSave: (updatedExpense: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isProject?: boolean;

  /** Opcional: si viene, restringe y valida la fecha (ideal para Home / periodo activo) */
  minDate?: Date;
  maxDate?: Date;
}

export const EditExpenseModal = ({
  isOpen,
  onClose,
  expense,
  onSave,
  onDelete,
  isProject,
  minDate,
  maxDate,
}: Props) => {
  const [amount, setAmount] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [refundAuto, setRefundAuto] = useState(false);

  const [description, setDescription] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [dateVal, setDateVal] = useState('');
  const [loading, setLoading] = useState(false);

  // Cargar categorías al abrir
  useEffect(() => {
    if (isOpen) {
      getCategories().then(setCategories);
    }
  }, [isOpen]);

  // Sincronizar datos del gasto (mensual o de proyecto)
  useEffect(() => {
    if (isOpen && expense) {
      const projectMode = isProject || 'monto_original' in expense;
      const rawAmount = projectMode
        ? (expense as ProjectExpense).monto_original
        : (expense as MonthlyExpense).monto;

      const isRefundInit = (rawAmount || 0) < 0;
      setIsRefund(isRefundInit);
      setRefundAuto(true);

      const abs = Math.abs(rawAmount || 0);
      const formatted = formatLocaleNumber(abs, 2);
      setAmount(isRefundInit ? `-${formatted}` : formatted);

      setDescription(expense.descripcion || '');
      setCategoryName(expense.categoria);
      setDateVal(format(new Date(expense.fecha), 'yyyy-MM-dd'));
    }
  }, [isOpen, expense, isProject]);

  if (!isOpen || !expense) return null;

  const minYMD = minDate ? format(minDate, 'yyyy-MM-dd') : undefined;
  const maxYMD = maxDate ? format(maxDate, 'yyyy-MM-dd') : undefined;

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

  const handleSave = async () => {
    setLoading(true);

    const rawNum = parseLocaleNumber(amount);
    const abs = Math.abs(rawNum);
    const finalIsRefund = isRefund || rawNum < 0;
    const finalAmount = finalIsRefund ? -abs : abs;

    if (abs <= 0) {
      setLoading(false);
      return;
    }

    if (!dateVal) {
      window.alert('Fecha inválida.');
      setLoading(false);
      return;
    }

    // Validación dura si hay rango
    if (minYMD && dateVal < minYMD) {
      window.alert(`Fecha fuera del periodo. Mínimo permitido: ${minYMD}`);
      setLoading(false);
      return;
    }
    if (maxYMD && dateVal > maxYMD) {
      window.alert(`Fecha fuera del periodo. Máximo permitido: ${maxYMD}`);
      setLoading(false);
      return;
    }

    if (finalIsRefund) {
      const ok = window.confirm(
        'Estás guardando una DEVOLUCIÓN. Esto disminuirá tus gastos.\n\n¿Continuar?',
      );
      if (!ok) {
        setLoading(false);
        return;
      }
    }

    // Reconstruir fecha manteniendo la hora original si coincide el día
    const originalDate = new Date(expense.fecha);
    const [y, m, d] = dateVal.split('-').map(Number);
    const newDate = new Date(y, m - 1, d);

    if (
      originalDate.getFullYear() === y &&
      originalDate.getMonth() === m - 1 &&
      originalDate.getDate() === d
    ) {
      newDate.setHours(
        originalDate.getHours(),
        originalDate.getMinutes(),
        originalDate.getSeconds(),
      );
    } else {
      newDate.setHours(12, 0, 0);
    }

    const projectMode = isProject || 'monto_original' in expense;
    const catName = (categoryName || '').trim();
    if (!catName) {
      window.alert('Selecciona una categoría antes de guardar.');
      setLoading(false);
      return;
    }

    const updated: any = {
      ...expense,
      descripcion: description,
      categoria: catName,
      fecha: newDate.toISOString(),
    };

    // Guardrail (caso B): en gastos mensuales, forzamos vínculo canónico a categoría (categoryId).
    // Esto evita que un gasto quede "con nombre" pero sin link, lo que puede producir dif entre Home y cierre.
    if (!projectMode) {
      const found = categories.find((c) => (c.nombre || '').trim() === catName);
      const foundId = (found as any)?.id as string | undefined;
      if (!foundId) {
        window.alert('Categoría inválida o incompleta. Vuelve a seleccionarla.');
        setLoading(false);
        return;
      }
      (updated as MonthlyExpense).categoryId = foundId;
    }

    if (projectMode) {
      (updated as ProjectExpense).monto_original = finalAmount;
    } else {
      (updated as MonthlyExpense).monto = finalAmount;
    }

    await onSave(updated);
    setLoading(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!expense) return;
    if (confirm('¿Estás seguro de eliminar este gasto?')) {
      setLoading(true);
      await onDelete(expense.id!);
      setLoading(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800">Editar Gasto</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Toggle devolución */}
          <div className="flex items-center justify-between">
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

          {/* Monto */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Monto
            </label>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              onBlur={handleAmountBlur}
            />
          </div>

          {/* Categoría */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Categoría
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const Icon = getCategoryIcon(cat.icono || 'General');
                const isActive = cat.nombre === categoryName;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryName(cat.nombre)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs',
                      isActive
                        ? 'bg-brand-50 border-brand-400 text-brand-700'
                        : 'bg-white border-slate-200 text-slate-600',
                    )}
                  >
                    <Icon
                      size={14}
                      className={isActive ? 'text-brand-600' : 'text-slate-400'}
                    />
                    <span>{cat.nombre}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Descripción
            </label>
            <Input
              type="text"
              placeholder="Opcional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Fecha */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Fecha
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateVal}
                min={minYMD}
                max={maxYMD}
                onChange={(e) => setDateVal(e.target.value)}
                className="flex-1"
              />
              <div className="p-2 rounded-full bg-slate-100 text-slate-500">
                <Calendar size={16} />
              </div>
            </div>
            {(minYMD || maxYMD) && (
              <p className="text-[10px] text-slate-400 mt-1">
                Permitido: {minYMD || '—'} → {maxYMD || '—'}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            onClick={handleDelete}
            disabled={loading}
          >
            <Trash2 size={18} className="mr-2" /> Borrar
          </Button>
          <Button className="flex-[2]" onClick={handleSave} disabled={loading}>
            <Save size={18} className="mr-2" /> Guardar Cambios
          </Button>
        </div>
      </div>
    </div>
  );
};
