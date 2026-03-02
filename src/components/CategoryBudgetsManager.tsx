import React, { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  X,
  RefreshCw,
  TrendingUp,
  Wand2,
  Wrench,
  Pin,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { Button, Card, Input, cn, getCategoryIcon, ICON_KEYS } from './Components';
import { subscribeToCategories, saveCategory, deleteCategory } from '../services/db';
import { db } from '../services/firebase';
import { Category, Project, ProjectExpense, ProjectType } from '../types';

type Scope = 'home' | 'trip';

const CATEGORY_ICONS = ICON_KEYS;

const DEFAULT_ICON_BY_CANONICAL: Record<string, string> = {
  Vuelos: 'Plane',
  Alojamiento: 'Home',
  Comida: 'Utensils',
  Transporte: 'Car',
  Actividades: 'Zap',
  Compras: 'ShoppingBag',
  Otros: 'General',
};

function stripDiacritics(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeCategoryName(raw: string) {
  return stripDiacritics(String(raw ?? '')).trim().toLowerCase();
}

function canonicalizeTripLabel(raw: string): string {
  const s = stripDiacritics((raw || '').trim().toLowerCase());
  if (!s) return 'Otros';

  if (/(vuelo|flight|air|aereo|avi(o|ó)n)/.test(s)) return 'Vuelos';
  if (/(hotel|aloj|hosped|airbnb|hostel|resort)/.test(s)) return 'Alojamiento';
  if (/(comida|food|rest|cena|almuerzo|desayuno|snack|bar)/.test(s)) return 'Comida';
  if (/(uber|taxi|metro|bus|tren|transp|parking|peaje|gasolina|nafta)/.test(s)) return 'Transporte';
  if (/(tour|entrada|ocio|actividad|excursion|excursi(o|ó)n|show|museo)/.test(s)) return 'Actividades';
  if (/(compr|shopping|souvenir|tienda|ropa)/.test(s)) return 'Compras';

  return 'Otros';
}

async function getTripProjectIds(): Promise<Set<string>> {
  const projectsSnap = await getDocs(collection(db, 'projects'));
  const tripIds = new Set<string>();
  projectsSnap.forEach((d) => {
    const p = { id: d.id, ...(d.data() as any) } as Project;
    if ((p.tipo as any) === ProjectType.TRIP || (p.tipo as any) === 'viaje') tripIds.add(d.id);
  });
  return tripIds;
}

async function buildTripSuggestionsFromHistory(): Promise<Array<{ nombre: string; icono: string }>> {
  // 1) ids de proyectos tipo viaje
  const tripIds = await getTripProjectIds();

  // 2) recuenta categorías usadas en project_expenses para esos viajes
  const expSnap = await getDocs(collection(db, 'project_expenses'));
  const counts = new Map<string, number>();
  expSnap.forEach((d) => {
    const e = { id: d.id, ...(d.data() as any) } as ProjectExpense;
    if (!tripIds.has((e as any).proyecto_id)) return;
    const raw = (e as any).categoria || '';
    const canon = canonicalizeTripLabel(raw);
    counts.set(canon, (counts.get(canon) || 0) + 1);
  });

  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([nombre]) => nombre);

  const base = sorted.length
    ? sorted
    : ['Vuelos', 'Alojamiento', 'Comida', 'Transporte', 'Actividades', 'Compras', 'Otros'];

  const picked: string[] = [];
  for (const n of base) {
    if (!picked.includes(n)) picked.push(n);
    if (picked.length >= 7) break;
  }
  if (!picked.includes('Otros')) picked.push('Otros');

  return picked.map((nombre) => ({
    nombre,
    icono: DEFAULT_ICON_BY_CANONICAL[nombre] || 'General',
  }));
}


async function getExistingTripCategoryNames(): Promise<Set<string>> {
  // Importante: no confiar en state todavía (puede no haber cargado); leemos Firestore.
  const snap = await getDocs(query(collection(db, 'categories'), where('scope', '==', 'trip')));
  const set = new Set<string>();
  snap.forEach((d) => {
    const c = d.data() as any;
    const n = normalizeCategoryName(c?.nombre || '');
    if (n) set.add(n);
  });
  return set;
}

async function countTripExpensesUsingCategoryNombre(nombre: string): Promise<{ count: number; expenseDocIds: string[] }>{
  const tripIds = await getTripProjectIds();
  const expSnap = await getDocs(query(collection(db, 'project_expenses'), where('categoria', '==', nombre)));
  let count = 0;
  const ids: string[] = [];
  expSnap.forEach((d) => {
    const e = d.data() as any;
    if (!tripIds.has(e?.proyecto_id)) return;
    if (e?.estado === 'borrado') return;
    count += 1;
    ids.push(d.id);
  });
  return { count, expenseDocIds: ids };
}

async function batchUpdateProjectExpensesCategoria(docIds: string[], newNombre: string) {
  // Firestore batch limit: 500 ops. Vamos conservador a 400.
  const CHUNK = 400;
  for (let i = 0; i < docIds.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const id of docIds.slice(i, i + CHUNK)) {
      batch.update(doc(db, 'project_expenses', id), { categoria: newNombre });
    }
    await batch.commit();
  }
}

export function CategoryBudgetsManager({
  scope,
  showBudget,
  autoSuggestFromHistory,
  allowMaintenanceRename,
}: {
  scope: Scope;
  showBudget?: boolean;
  autoSuggestFromHistory?: boolean;
  allowMaintenanceRename?: boolean;
}) {
  const budgetEnabled = showBudget ?? (scope === 'home');
  const canRename = allowMaintenanceRename ?? (scope === 'home');

  const [categories, setCategories] = useState<Category[]>([]);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // UI
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isMaintOpen, setIsMaintOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Form
  const [form, setForm] = useState({
    nombre: '',
    presupuestoMensual: 0,
    icono: 'ShoppingCart',
    activa: true,
    isFixed: false,
  });

  // Maintenance (rename)
  const [maintOldName, setMaintOldName] = useState('');
  const [maintNewName, setMaintNewName] = useState('');

  // Maintenance (delete / merge)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleteCount, setDeleteCount] = useState<number | null>(null);
  const [deleteExpenseIds, setDeleteExpenseIds] = useState<string[]>([]);
  const [deleteReassignTo, setDeleteReassignTo] = useState<string>('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Maintenance (trip: normalize legacy category strings)
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [normalizeBusy, setNormalizeBusy] = useState(false);
  const [normalizeFallback, setNormalizeFallback] = useState<string>('');
  const [normalizeStats, setNormalizeStats] = useState<
    | {
        total: number;
        willChange: number;
        examples: Array<{ from: string; to: string; n: number }>;
      }
    | null
  >(null);

  const currentUser = localStorage.getItem('currentUser') || 'Usuario';

  useEffect(() => {
    const unsubscribe = subscribeToCategories((data) => {
      const sorted = data
        .map((c) => ({ ...c, label: (c as any).label ?? c.nombre, key: (c as any).key }))
        .sort((a, b) => String((a as any).label ?? a.nombre).localeCompare(String((b as any).label ?? b.nombre), 'es'));
      setCategories(sorted);
    }, scope);
    return () => unsubscribe();
  }, [scope]);

  // Auto-sugerencias para Viajes (solo si aún no hay categorías definidas)
  useEffect(() => {
    if (!autoSuggestFromHistory) return;
    if (scope !== 'trip') return;
    if (seeded) return;
    if (categories.length > 0) {
      setSeeded(true);
      return;
    }

    // IMPORTANTE:
    // - el componente puede montarse antes de que el onSnapshot entregue data;
    // - si seedamos "a ciegas" se crean duplicadas.
    // Por eso: validamos en Firestore si ya existen categorías de viaje antes de crear.
    (async () => {
      setBusy(true);
      try {
        const existingSnap = await getDocs(query(collection(db, 'categories'), where('scope', '==', 'trip')));
        if (!existingSnap.empty) {
          setSeeded(true);
          return;
        }

        const suggestions = await buildTripSuggestionsFromHistory();
        const createdNorm = new Set<string>();
        for (const s of suggestions) {
          const norm = normalizeCategoryName(s.nombre);
          if (!norm || createdNorm.has(norm)) continue;
          createdNorm.add(norm);
          await saveCategory({
            nombre: s.nombre,
            label: s.nombre,
            presupuestoMensual: 0,
            activa: true,
            icono: s.icono,
            scope: 'trip',
          } as any);
        }
      } finally {
        setSeeded(true);
        setBusy(false);
      }
    })();
  }, [autoSuggestFromHistory, scope, seeded, categories.length]);

  const resetForm = () => {
    setForm({ nombre: '', presupuestoMensual: 0, icono: 'ShoppingCart', activa: true, isFixed: false });
    setIsEditing(null);
    setIsFormOpen(false);
  };

  const logActivity = async (accion: string, detalle: string, afectados: number = 0) => {
    try {
      await addDoc(collection(db, 'activity_logs'), {
        fecha: serverTimestamp(),
        usuario: currentUser,
        accion,
        detalle,
        registrosAfectados: afectados,
        tipo: 'ESTRUCTURAL',
      });
    } catch (e) {
      console.error('Error escribiendo bitácora:', e);
    }
  };

  // Renombrado batch (mantenimiento). Por seguridad, en HOME sólo toca monthly_expenses.
  const renameCategoryInExpenses = async (oldName: string, newName: string) => {
    const batch = writeBatch(db);
    let totalUpdated = 0;
    const collectionsToProcess = scope === 'home' ? ['monthly_expenses'] : ['project_expenses'];

    for (const collName of collectionsToProcess) {
      const q = query(collection(db, collName), where('categoria', '==', oldName));
      const snap = await getDocs(q);
      snap.forEach((d) => {
        batch.update(doc(db, collName, d.id), { categoria: newName });
        totalUpdated++;
      });
    }
    if (totalUpdated > 0) await batch.commit();
    return totalUpdated;
  };

  const handleMaintenanceRename = async () => {
    if (!maintOldName || !maintNewName) return;
    const catToUpdate = categories.find((c) => c.nombre === maintOldName);
    if (!catToUpdate) {
      alert('Error: La categoría seleccionada ya no existe.');
      return;
    }

    const confirmMsg = `ACCIÓN IRREVERSIBLE\n\nSe reemplazará "${maintOldName}" por "${maintNewName}" en el historial.\n\n¿Continuar?`;
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const afectados = await renameCategoryInExpenses(maintOldName, maintNewName);
      await saveCategory({ ...catToUpdate, nombre: maintNewName, label: maintNewName, key: (catToUpdate as any).key, scope: (catToUpdate as any).scope ?? (scope as any) } as any);
      await logActivity('CIRUGIA_RENOMBRAR', `[${scope}] De "${maintOldName}" a "${maintNewName}"`, afectados);
      setMsg({ text: `Renombrado OK: ${afectados} registros actualizados.`, type: 'success' });
      setMaintOldName('');
      setMaintNewName('');
      setIsMaintOpen(false);
    } catch {
      setMsg({ text: 'Error durante el renombrado.', type: 'error' });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) return;
    setBusy(true);
    try {
      const oldCat = isEditing ? categories.find((c) => c.id === isEditing) : null;

      await saveCategory({
        id: isEditing || undefined,
        nombre: form.nombre.trim(),
        label: form.nombre.trim(),
        key: (oldCat as any)?.key,
        presupuestoMensual: budgetEnabled ? Number(form.presupuestoMensual) : 0,
        icono: form.icono,
        activa: form.activa ?? true,
        scope,
      } as any);

      if (oldCat && budgetEnabled && oldCat.presupuestoMensual !== Number(form.presupuestoMensual)) {
        await logActivity(
          'AJUSTE_PRESUPUESTO',
          `[${scope}] "${form.nombre}": €${oldCat.presupuestoMensual} -> €${form.presupuestoMensual}`
        );
      } else if (!isEditing) {
        await logActivity('NUEVA_CATEGORIA', `[${scope}] Se creó "${form.nombre}"`);
      }

      setMsg({ text: 'Guardado ✅', type: 'success' });
      resetForm();
    } catch {
      setMsg({ text: 'Error al conectar con Firestore.', type: 'error' });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const handleToggleActive = async (cat: Category) => {
    const newState = !cat.activa;
    setBusy(true);
    try {
      await saveCategory({
        ...(cat as any),
        activa: newState,
        scope: (cat as any).scope ?? scope,
        presupuestoMensual: Number((cat as any).presupuestoMensual ?? 0),
      } as any);
      await logActivity('TOGGLE_CATEGORIA', `[${scope}] ${cat.nombre} => ${newState ? 'ON' : 'OFF'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleFixed = async (cat: Category) => {
    // Solo Home: esto NO toca historial, solo afecta el cálculo de "ritmo" (variable vs fijo)
    try {
      setBusy(true);
      await saveCategory({ ...cat, isFixed: !(cat as any).isFixed });
      setMsg({ text: 'Actualizado', type: 'success' });
      setTimeout(() => setMsg(null), 1500);
    } catch (e: any) {
      setMsg({ text: e?.message || 'No se pudo actualizar', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const closeDeleteModal = () => {
    setDeleteOpen(false);
    setDeleteTarget(null);
    setDeleteCount(null);
    setDeleteExpenseIds([]);
    setDeleteReassignTo('');
    setDeleteBusy(false);
  };

  const countTripExpenseUsageForCategory = async (categoryName: string): Promise<{ count: number; ids: string[] }> => {
    // Cuenta SOLO en gastos de proyectos tipo Viaje (TRIP)
    const tripIds = await getTripProjectIds();
    if (tripIds.size === 0) return { count: 0, ids: [] };

    const q = query(collection(db, 'project_expenses'), where('categoria', '==', categoryName));
    const snap = await getDocs(q);
    const ids: string[] = [];
    snap.forEach((d) => {
      const e = { id: d.id, ...(d.data() as any) } as any;
      if (!tripIds.has(e.proyecto_id)) return;
      ids.push(d.id);
    });
    return { count: ids.length, ids };
  };

  const openDeleteCategory = async (cat: Category) => {
    if (scope !== 'trip') return;
    setDeleteOpen(true);
    setDeleteTarget(cat);
    setDeleteCount(null);
    setDeleteExpenseIds([]);
    setDeleteReassignTo('');

    try {
      const { count, ids } = await countTripExpenseUsageForCategory(cat.nombre);
      setDeleteCount(count);
      setDeleteExpenseIds(ids);

      // Default reasignación: 'Otros' si existe, si no la primera distinta
      const candidates = categories
        .filter((c) => c.id !== cat.id)
        .map((c) => c.nombre)
        .filter(Boolean);

      const otros = candidates.find((n) => normalizeCategoryName(n) === 'otros');
      setDeleteReassignTo(otros || candidates[0] || '');
    } catch {
      setDeleteCount(0);
      setDeleteExpenseIds([]);
    }
  };

  const batchUpdateProjectExpensesCategory = async (expenseIds: string[], newCategoryName: string) => {
    const chunkSize = 450; // seguridad bajo el límite 500
    for (let i = 0; i < expenseIds.length; i += chunkSize) {
      const batch = writeBatch(db);
      const chunk = expenseIds.slice(i, i + chunkSize);
      for (const id of chunk) {
        batch.update(doc(db, 'project_expenses', id), { categoria: newCategoryName });
      }
      await batch.commit();
    }
  };

  const confirmAndDeleteCategory = async () => {
    if (!deleteTarget) return;
    if (!deleteTarget.id) {
      alert('No se puede eliminar: falta id de categoría.');
      return;
    }
    if (scope !== 'trip') return;

    const count = deleteCount ?? 0;
    if (count > 0) {
      if (!deleteReassignTo || normalizeCategoryName(deleteReassignTo) === normalizeCategoryName(deleteTarget.nombre)) {
        alert('Para eliminar una categoría en uso, debes reasignar esos gastos a otra categoría.');
        return;
      }
    }

    const msg1 = `Vas a ELIMINAR la categoría "${deleteTarget.nombre}".\n\nGastos afectados (viajes): ${count}.\n\n${count > 0 ? `Se reasignarán a: "${deleteReassignTo}".` : 'No hay gastos asociados.'}\n\n¿Continuar?`;
    if (!window.confirm(msg1)) return;
    const msg2 = 'Última confirmación: esta acción es irreversible. ¿Eliminar ahora?';
    if (!window.confirm(msg2)) return;

    setDeleteBusy(true);
    try {
      if (count > 0) {
        await batchUpdateProjectExpensesCategory(deleteExpenseIds, deleteReassignTo);
      }

      await deleteCategory(deleteTarget.id);
      await logActivity(
        'ELIMINAR_CATEGORIA',
        `[trip] Eliminada "${deleteTarget.nombre}". ${count > 0 ? `Reasignada a "${deleteReassignTo}" (${count})` : 'Sin gastos asociados'}`,
        count
      );

      setMsg({ text: 'Categoría eliminada ✅', type: 'success' });
      closeDeleteModal();
    } catch {
      setMsg({ text: 'Error al eliminar la categoría.', type: 'error' });
      setDeleteBusy(false);
    } finally {
      setTimeout(() => setMsg(null), 3000);
    }
  };

  // ------------------------------
  // MANTENIMIENTO (Viajes): normalizar strings legacy de categoria en project_expenses
  // ------------------------------
  const closeNormalizeModal = () => {
    setNormalizeOpen(false);
    setNormalizeBusy(false);
    setNormalizeFallback('');
    setNormalizeStats(null);
  };

  const resolveTripCategoryTarget = (
    raw: string,
    byNorm: Map<string, string>,
    fallback: string
  ): string => {
    const direct = byNorm.get(normalizeCategoryName(raw));
    if (direct) return direct;

    const canon = canonicalizeTripLabel(raw);
    const canonMatch = byNorm.get(normalizeCategoryName(canon));
    if (canonMatch) return canonMatch;

    return fallback;
  };

  const openNormalizeTrip = async () => {
    if (scope !== 'trip') return;
    if (categories.length === 0) {
      setMsg({ text: 'No hay categorías de Viajes definidas todavía.', type: 'error' });
      setTimeout(() => setMsg(null), 3000);
      return;
    }

    // fallback sugerido: "Otros" si existe
    const candidates = categories.map((c) => c.nombre).filter(Boolean);
    const otros = candidates.find((n) => normalizeCategoryName(n) === 'otros');
    const fallback = otros || candidates[0] || 'Otros';
    setNormalizeFallback(fallback);
    setNormalizeOpen(true);
    setNormalizeStats(null);

    setNormalizeBusy(true);
    try {
      const tripIds = await getTripProjectIds();
      if (tripIds.size === 0) {
        setNormalizeStats({ total: 0, willChange: 0, examples: [] });
        return;
      }

      const byNorm = new Map<string, string>();
      for (const c of categories) byNorm.set(normalizeCategoryName(c.nombre), c.nombre);

      const snap = await getDocs(collection(db, 'project_expenses'));
      const changes = new Map<string, number>();
      let total = 0;
      let willChange = 0;

      snap.forEach((d) => {
        const e = { id: d.id, ...(d.data() as any) } as ProjectExpense;
        if (!tripIds.has((e as any).proyecto_id)) return;
        total += 1;
        const from = String((e as any).categoria || '');
        const to = resolveTripCategoryTarget(from, byNorm, fallback);
        if (to !== from) {
          willChange += 1;
          const k = `${from}→${to}`;
          changes.set(k, (changes.get(k) || 0) + 1);
        }
      });

      const examples = Array.from(changes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, n]) => {
          const [from, to] = k.split('→');
          return { from, to, n };
        });

      setNormalizeStats({ total, willChange, examples });
    } catch {
      setNormalizeStats(null);
      setMsg({ text: 'Error preparando la normalización.', type: 'error' });
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setNormalizeBusy(false);
    }
  };

  const runNormalizeTrip = async () => {
    if (scope !== 'trip') return;
    if (!normalizeFallback) {
      alert('Selecciona una categoría fallback (para casos no reconocidos).');
      return;
    }

    const stats = normalizeStats;
    const warn = `Vas a normalizar el historial de categorías de VIAJES.\n\n` +
      (stats ? `Total gastos de viajes: ${stats.total}.\nSe actualizarán: ${stats.willChange}.\n\n` : '') +
      `Fallback: "${normalizeFallback}"\n\n¿Continuar?`;
    if (!window.confirm(warn)) return;
    if (!window.confirm('Última confirmación: esto modifica el historial de viajes. ¿Ejecutar ahora?')) return;

    setNormalizeBusy(true);
    try {
      const tripIds = await getTripProjectIds();
      if (tripIds.size === 0) {
        setMsg({ text: 'No se encontraron viajes para normalizar.', type: 'success' });
        closeNormalizeModal();
        return;
      }

      const byNorm = new Map<string, string>();
      for (const c of categories) byNorm.set(normalizeCategoryName(c.nombre), c.nombre);

      const snap = await getDocs(collection(db, 'project_expenses'));
      const toUpdate: Array<{ id: string; to: string }> = [];
      snap.forEach((d) => {
        const e = { id: d.id, ...(d.data() as any) } as ProjectExpense;
        if (!tripIds.has((e as any).proyecto_id)) return;
        const from = String((e as any).categoria || '');
        const to = resolveTripCategoryTarget(from, byNorm, normalizeFallback);
        if (to !== from) toUpdate.push({ id: d.id, to });
      });

      // Batch por destino: agrupamos para minimizar batches
      const byTarget = new Map<string, string[]>();
      for (const u of toUpdate) {
        const arr = byTarget.get(u.to) || [];
        arr.push(u.id);
        byTarget.set(u.to, arr);
      }
      for (const [to, ids] of byTarget.entries()) {
        await batchUpdateProjectExpensesCategory(ids, to);
      }

      await logActivity(
        'NORMALIZAR_TRIP_CATEGORIAS',
        `[trip] Normalización legacy: ${toUpdate.length} gastos actualizados (fallback "${normalizeFallback}")`,
        toUpdate.length
      );

      setMsg({ text: `Normalización OK: ${toUpdate.length} gastos actualizados.`, type: 'success' });
      closeNormalizeModal();
    } catch {
      setMsg({ text: 'Error durante la normalización.', type: 'error' });
      setNormalizeBusy(false);
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      {/* --- TOP BAR (título implícito por tab) --- */}
      <div className="flex justify-end items-center">
        <button
          onClick={() => {
            resetForm();
            setIsFormOpen(!isFormOpen);
          }}
          className={cn(
            // Pantalla secundaria: botones más sutiles (sin perder tap target)
            'p-2 rounded-full transition-all shadow-lg active:scale-90',
            isFormOpen ? 'bg-red-500 text-white rotate-45' : 'bg-slate-900 text-white'
          )}
          title={isFormOpen ? 'Cerrar' : 'Nueva categoría'}
        >
          <Plus size={18} />
        </button>
      </div>

      {/* --- MODAL ELIMINAR (mantenimiento) --- */}
      {deleteOpen && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-[520px] p-6 bg-white rounded-[2.25rem] border-none shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-4 rounded-3xl bg-slate-900 text-white shrink-0">
                  {React.createElement(getCategoryIcon(deleteTarget.icono || 'ShoppingCart'), { size: 26 })}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Eliminar categoría</p>
                  <p className="text-xl font-black text-slate-900 truncate">{deleteTarget.nombre}</p>
                </div>
              </div>
              <button onClick={closeDeleteModal} className="text-slate-300 hover:text-slate-600" title="Cerrar">
                <X size={22} />
              </button>
            </div>

            <div className="flex gap-2 items-start bg-orange-50 p-4 rounded-3xl">
              <AlertCircle size={18} className="text-orange-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] text-orange-900 font-black">Modo mantenimiento</p>
                <p className="text-[11px] text-orange-800 font-bold leading-relaxed">
                  Esto es para arreglar errores de diseño (duplicadas, nombres mal puestos). Si la categoría está en uso, debes reasignar.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-3xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gastos afectados (viajes)</p>
                <p className="text-2xl font-black text-slate-900 tracking-tight">
                  {deleteCount === null ? <span className="inline-flex items-center gap-2"><RefreshCw className="animate-spin" size={16} /> contando…</span> : deleteCount}
                </p>
              </div>
              {deleteCount !== null && deleteCount === 0 && (
                <span className="inline-flex items-center gap-2 text-emerald-700 font-black text-xs">
                  <CheckCircle2 size={16} /> Sin uso
                </span>
              )}
            </div>

            {deleteCount !== null && deleteCount > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reasignar gastos a</p>
                <select
                  value={deleteReassignTo}
                  onChange={(e) => setDeleteReassignTo((e.target as any).value)}
                  className="w-full h-12 px-4 bg-slate-50 rounded-2xl text-sm font-black border-none text-slate-900"
                >
                  {categories
                    .filter((c) => c.id !== deleteTarget.id)
                    .map((c) => (
                      <option key={c.id} value={c.nombre}>
                        {c.nombre}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-500 font-bold">
                  Se actualizarán {deleteCount} registros en el historial de Viajes.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={closeDeleteModal}
                className="flex-1 py-6 rounded-2xl bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmAndDeleteCategory}
                disabled={deleteBusy || deleteCount === null}
                className="flex-1 py-6 rounded-2xl bg-red-600 hover:bg-red-700"
              >
                {deleteBusy ? <RefreshCw className="animate-spin" size={18} /> : <span className="font-black uppercase text-xs tracking-[0.2em]">Eliminar</span>}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* --- MODAL NORMALIZAR (mantenimiento viajes) --- */}
      {normalizeOpen && scope === 'trip' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-[560px] p-6 bg-white rounded-[2.25rem] border-none shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-4 rounded-3xl bg-slate-900 text-white shrink-0">
                  <Wand2 size={26} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mantenimiento</p>
                  <p className="text-xl font-black text-slate-900 truncate">Normalizar historial de Viajes</p>
                </div>
              </div>
              <button onClick={closeNormalizeModal} className="text-slate-300 hover:text-slate-600" title="Cerrar">
                <X size={22} />
              </button>
            </div>

            <div className="flex gap-2 items-start bg-orange-50 p-4 rounded-3xl">
              <AlertCircle size={18} className="text-orange-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] text-orange-900 font-black">Esto modifica el historial</p>
                <p className="text-[11px] text-orange-800 font-bold leading-relaxed">
                  Unifica categorías antiguas (vuelo/flight/Hotel/etc.) para que coincidan con las categorías definidas en Settings.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-3xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Preview</p>
                {normalizeBusy && (
                  <span className="inline-flex items-center gap-2 text-slate-500 font-black text-xs">
                    <RefreshCw className="animate-spin" size={16} /> calculando…
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-2xl bg-white">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total gastos viaje</p>
                  <p className="text-2xl font-black text-slate-900 tracking-tight">{normalizeStats?.total ?? '—'}</p>
                </div>
                <div className="p-3 rounded-2xl bg-white">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Se actualizarán</p>
                  <p className="text-2xl font-black text-slate-900 tracking-tight">{normalizeStats?.willChange ?? '—'}</p>
                </div>
              </div>

              {normalizeStats?.examples?.length ? (
                <div className="pt-2 space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ejemplos</p>
                  <div className="space-y-1">
                    {normalizeStats.examples.map((ex) => (
                      <div key={`${ex.from}-${ex.to}`} className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                        <span className="truncate max-w-[60%]">{ex.from || '(vacío)'} → <span className="font-black">{ex.to}</span></span>
                        <span className="text-slate-400">{ex.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fallback para no reconocidos</p>
              <select
                value={normalizeFallback}
                onChange={(e) => setNormalizeFallback((e.target as any).value)}
                className="w-full h-12 px-4 bg-slate-50 rounded-2xl text-sm font-black border-none text-slate-900"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.nombre}>{c.nombre}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 font-bold">Si una categoría antigua no calza con nada, se moverá aquí.</p>
            </div>

            <div className="flex gap-3">
              <Button onClick={closeNormalizeModal} className="flex-1 py-6 rounded-2xl bg-slate-100 text-slate-700 hover:bg-slate-200">
                Cancelar
              </Button>
              <Button
                onClick={runNormalizeTrip}
                disabled={normalizeBusy}
                className="flex-1 py-6 rounded-2xl bg-slate-900 hover:bg-black"
              >
                {normalizeBusy ? <RefreshCw className="animate-spin" size={18} /> : <span className="font-black uppercase text-xs tracking-[0.2em]">Ejecutar</span>}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* --- FORMULARIO --- */}
      {isFormOpen && (
        <Card className="p-6 border-none shadow-2xl bg-white rounded-[2rem] space-y-6 animate-in slide-in-from-top-4">
          <div className="flex items-center justify-between border-b border-slate-50 pb-3">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              {isEditing ? <Edit2 size={14} /> : <Plus size={14} />}
              {isEditing ? 'Editar' : 'Nueva Categoría'}
            </h2>
            <button onClick={() => setIsFormOpen(false)} className="text-slate-300 hover:text-slate-500">
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-3 space-y-1">
              <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">Nombre</label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: (e.target as any).value })}
                disabled={!!isEditing}
                placeholder={scope === 'trip' ? 'Ej: Vuelos' : 'Ej: Supermercado'}
                className={cn('bg-slate-50 border-none font-bold h-12', !!isEditing && 'opacity-50 cursor-not-allowed')}
              />
              {!!isEditing && (
                <p className="text-[9px] text-slate-400 ml-1">Para renombrar: usa mantenimiento.</p>
              )}
            </div>

            <div className="col-span-1 space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase text-center block">Icono</label>
              <div className="relative h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100">
                {React.createElement(getCategoryIcon(form.icono), { size: 18, className: 'text-slate-700' })}
                <select
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                  value={form.icono}
                  onChange={(e) => setForm({ ...form, icono: (e.target as any).value })}
                >
                  {CATEGORY_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {budgetEnabled && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">Presupuesto Mensual</label>
                  <span className="text-[9px] text-slate-400">Afecta periodo abierto y futuros</span>
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-300 text-base">€</span>
                  <Input
                    type="number"
                    value={form.presupuestoMensual}
                    onChange={(e) => setForm({ ...form, presupuestoMensual: Number((e.target as any).value) })}
                    className="bg-slate-50 border-none font-black text-lg h-12 pl-10 rounded-2xl text-slate-900"
                  />
                </div>
              </div>

              {scope === 'home' && (
                <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Gasto fijo</p>
                    <p className="text-[10px] text-slate-400 font-bold leading-snug">
                      Se excluye del cálculo de <span className="font-black">ritmo</span> (ej: alquiler).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, isFixed: !(form as any).isFixed })}
                    className={cn(
                      // Más sutil (Settings no es pantalla core)
                      "w-10 h-5 rounded-full p-0.5 cursor-pointer transition-colors duration-500 ease-in-out relative shadow-inner shrink-0",
                      (form as any).isFixed ? "bg-slate-900" : "bg-slate-300"
                    )}
                    title={(form as any).isFixed ? "Marcar como variable" : "Marcar como fijo"}
                  >
                    <div
                      className={cn(
                        "bg-white w-4 h-4 rounded-full shadow-lg transform transition-transform duration-300 ease-out",
                        (form as any).isFixed ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={busy || !form.nombre}
            className={cn(
              'w-full py-8 rounded-2xl shadow-xl transition-all active:scale-95',
              isEditing ? 'bg-blue-600' : 'bg-slate-900'
            )}
          >
            {busy ? (
              <RefreshCw className="animate-spin" size={20} />
            ) : (
              <span className="font-black uppercase text-xs tracking-[0.2em]">{isEditing ? 'Guardar' : 'Crear'}</span>
            )}
          </Button>
        </Card>
      )}

      {/* --- LISTADO --- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <TrendingUp size={12} /> Categorías
          </h2>
          <span className="text-[9px] font-bold text-slate-300">{categories.filter((c) => c.activa).length} ON</span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className={cn(
                // Más compacto: esta pantalla es utilitaria y debe sentirse liviana.
                'group p-4 rounded-[2.25rem] bg-white border border-slate-100 shadow-sm flex items-center justify-between transition-all',
                !cat.activa && 'opacity-40 grayscale bg-slate-50'
              )}
            >
              <div className="flex items-center gap-4 min-w-0">
                <div
                  className={cn(
                    'p-3 rounded-3xl shadow-inner transition-all shrink-0',
                    cat.activa ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400'
                  )}
                >
                  {React.createElement(getCategoryIcon(cat.icono || 'ShoppingCart'), { size: 18 })}
                </div>

                <div className="flex flex-col min-w-0">
                  {/* Nombre = protagonista (más grande). */}
                  <p className="text-[15px] font-black text-slate-900 tracking-tight leading-tight truncate">
                    {(cat as any).label ?? cat.nombre}
                  </p>

                  {/* Monto/estado = secundario (más chico y sutil). */}
                  {budgetEnabled ? (
                    <p className="mt-1 text-[11px] font-bold text-slate-900/65 tracking-tight leading-none">
                      €{Number(cat.presupuestoMensual || 0).toLocaleString('es-ES')}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] font-bold text-slate-500 leading-none min-h-[14px]">
                      {cat.activa ? '' : 'Inactiva'}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div
                  onClick={() => handleToggleActive(cat)}
                  className={cn(
                    'w-10 h-5 rounded-full p-0.5 cursor-pointer transition-colors duration-500 ease-in-out relative shadow-inner',
                    cat.activa ? 'bg-emerald-500' : 'bg-slate-300'
                  )}
                  title={cat.activa ? 'Desactivar' : 'Activar'}
                >
                  <div
                    className={cn(
                      'bg-white w-4 h-4 rounded-full shadow-lg transform transition-transform duration-300 ease-out',
                      cat.activa ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </div>

                {scope === 'home' && (
                  <button
                    onClick={() => handleToggleFixed(cat)}
                    className={cn(
                      'px-2 py-2 transition-colors rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-400',
                      (cat as any).isFixed ? 'text-slate-900' : 'text-slate-300',
                      'opacity-60 hover:opacity-100'
                    )}
                    title="Fijo/Variable"
                  >
                    <Pin size={16} className={cn((cat as any).isFixed ? 'fill-current' : '')} />
                  </button>
                )}

                {scope === 'trip' && (
                  <button
                    onClick={() => openDeleteCategory(cat)}
                    className={cn(
                      'p-2 transition-colors rounded-2xl bg-slate-50 hover:bg-red-50 text-slate-300 hover:text-red-600',
                      'opacity-40 hover:opacity-100'
                    )}
                    title="Eliminar (mantenimiento)"
                  >
                    <Trash2 size={16} />
                  </button>
                )}

                <button
                  onClick={() => {
                    setIsEditing(cat.id || null);
                    setForm({
                      nombre: (cat as any).label ?? cat.nombre,
                      presupuestoMensual: Number(cat.presupuestoMensual || 0),
                      icono: cat.icono || 'ShoppingCart',
                      activa: cat.activa ?? true,
                      isFixed: !!(cat as any).isFixed,
                    });
                    setIsFormOpen(true);
                  }}
                  className="p-2 text-slate-300 hover:text-blue-500 transition-colors bg-slate-50 rounded-2xl hover:bg-blue-50"
                  title="Editar"
                >
                  <Edit2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- MANTENIMIENTO (renombrar) --- */}
      {canRename && (
        <div className="pt-2">
          <button
            onClick={() => setIsMaintOpen(!isMaintOpen)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-2xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100"
          >
            <div className="flex items-center gap-2 font-black text-[9px] uppercase tracking-widest opacity-70">
              <Wrench size={14} className="text-orange-500" />
              Renombrar (mantenimiento)
            </div>
            <ChevronDown size={16} className={cn('transition-transform duration-300 opacity-50', isMaintOpen && 'rotate-180')} />
          </button>

          {isMaintOpen && (
            <Card className="mt-3 p-5 bg-white border border-orange-100 rounded-3xl space-y-4 animate-in zoom-in-95">
              <div className="flex gap-2 items-start bg-orange-50 p-3 rounded-2xl">
                <AlertCircle size={18} className="text-orange-600 shrink-0 mt-0.5" />
                <p className="text-[10px] text-orange-800 font-bold leading-relaxed">
                  Esto cambia el nombre en el historial. Úsalo sólo para mantenimiento.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Categoría a reemplazar</label>
                  <select
                    value={maintOldName}
                    onChange={(e) => setMaintOldName((e.target as any).value)}
                    className="w-full h-11 px-4 bg-slate-50 rounded-xl text-xs font-black border-none text-slate-800"
                  >
                    <option value="">Seleccionar…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.nombre}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Nuevo nombre</label>
                  <Input
                    value={maintNewName}
                    onChange={(e) => setMaintNewName((e.target as any).value)}
                    placeholder="Ej: Alimentación"
                    className="text-sm font-black h-11 bg-slate-50 border-none"
                  />
                </div>

                <Button
                  onClick={handleMaintenanceRename}
                  disabled={busy || !maintOldName || !maintNewName}
                  className="w-full bg-orange-600 hover:bg-red-700 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all"
                >
                  {busy ? <RefreshCw className="animate-spin" size={18} /> : 'Ejecutar'}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* --- MANTENIMIENTO (viajes): normalizar legacy --- */}
      {scope === 'trip' && (
        <div className="pt-2">
          <button
            onClick={openNormalizeTrip}
            className="w-full flex items-center justify-between px-3 py-2 rounded-2xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100"
          >
            <div className="flex items-center gap-2 font-black text-[9px] uppercase tracking-widest opacity-70">
              <Wand2 size={14} className="text-orange-500" />
              Normalizar historial (mantenimiento)
            </div>
            <span className="text-[9px] font-black text-slate-300">1-click</span>
          </button>
        </div>
      )}

      {/* --- TOAST --- */}
      {msg && (
        <div className="fixed bottom-24 left-6 right-6 p-4 bg-slate-900 text-white rounded-[2rem] shadow-2xl flex items-center justify-center gap-3 animate-in slide-in-from-bottom-10 z-50">
          {msg.type === 'success' ? (
            <CheckCircle2 className="text-emerald-400" size={20} />
          ) : (
            <AlertCircle className="text-red-400" size={20} />
          )}
          <span className="text-[10px] font-black uppercase tracking-widest">{msg.text}</span>
        </div>
      )}
    </div>
  );
}
