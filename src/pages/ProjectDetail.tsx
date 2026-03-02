// src/pages/ProjectDetail.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  PlusCircle,
  Trash2,
  Edit3,
  Calendar,
  CheckCircle2,
  Unlock,
  Eye,
  EyeOff,
  // Iconos Temáticos
  Hammer, // Materiales/Obra
  Wrench, // Reparaciones
  ShoppingBag, // Compras
  Stethoscope, // Salud
  GraduationCap, // Educación
  Zap, // Servicios
  Briefcase, // Honorarios
  CreditCard,
  Layers, // Default
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

import { db } from '../services/firebase';
import {
  addProjectExpense,
  updateProjectExpense,
  deleteProjectExpense,
  subscribeToProjectExpensesFirstPage,
  getProjectExpensesPage,
} from '../services/db';

import { Project, ProjectExpense } from '../types';
import {
  Card,
  Button,
  Input,
  cn,
  RefreshButton,
  formatLocaleNumber,
  parseLocaleNumber,
  parseYMD,
} from '../components/Components';
import { HeroCard } from '../components/hero/HeroUi';
import { emitDataEvent } from '../state/dataEvents';

// Categorías para proyectos generales
const PROJECT_CATEGORIES = [
  'Materiales',
  'Mano de Obra',
  'Compras',
  'Honorarios',
  'Salud',
  'Educación',
  'Servicios',
  'Otros',
];

type CurrencyMode = 'EUR' | 'LOCAL';

const todayYMD = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 50;

export const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Datos
  const [project, setProject] = useState<Project | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  // Paginación: primera página en real-time + páginas adicionales on-demand
  const [page1Items, setPage1Items] = useState<ProjectExpense[]>([]);
  const [olderItems, setOlderItems] = useState<ProjectExpense[]>([]);
  const [page1Cursor, setPage1Cursor] = useState<any | null>(null);
  const [pageCursor, setPageCursor] = useState<any | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Formulario
  const [fecha, setFecha] = useState<string>(todayYMD());
  const [categoria, setCategoria] = useState(PROJECT_CATEGORIES[0]);
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('LOCAL');

  // UI
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(true); // Privacidad por defecto
  const [saving, setSaving] = useState(false);

  const currentUser = localStorage.getItem('currentUser') || 'Diego';

  const expenses = useMemo(() => {
    const page1Ids = new Set((page1Items || []).map((e) => e.id));
    const dedupedOlder = (olderItems || []).filter((e) => !page1Ids.has(e.id));
    return [...(page1Items || []), ...dedupedOlder];
  }, [page1Items, olderItems]);

  // HELPER ICONOS INTELIGENTE
  // ✅ Back-compat: older docs might store category under different keys
  const resolveExpenseCategory = (input: any): string => {
    if (!input) return '';
    if (typeof input === 'string') return input;
    return (
      input.categoria ??
      input.categoryId ??
      input.category ??
      input.categoria_id ??
      input.tipo ??
      input.tipo_gasto ??
      ''
    ).toString();
  };

  const getCategoryIcon = (catName: string) => {
    const c = (catName || '').toLowerCase();
    if (c.includes('material') || c.includes('obra')) return Hammer;
    if (c.includes('mano') || c.includes('reparacion')) return Wrench;
    if (c.includes('compra') || c.includes('super')) return ShoppingBag;
    if (c.includes('salud') || c.includes('dentista') || c.includes('doctor')) return Stethoscope;
    if (c.includes('educacion') || c.includes('curso')) return GraduationCap;
    if (c.includes('servicio') || c.includes('luz')) return Zap;
    if (c.includes('honorario') || c.includes('abogado')) return Briefcase;
    return Layers;
  };

  // Suscripción al proyecto + primera página (realtime)
  useEffect(() => {
    if (!id) return;

    setLoadingProject(true);
    setLoadingExpenses(true);
    setPage1Items([]);
    setOlderItems([]);
    setPage1Cursor(null);
    setPageCursor(null);
    setHasLoadedMore(false);
    setHasMore(false);

    const unsubProject = onSnapshot(
      doc(db, 'projects', id),
      (snap) => {
        if (snap.exists()) setProject({ id: snap.id, ...(snap.data() as any) } as Project);
        setLoadingProject(false);
      },
      () => {
        setLoadingProject(false);
      }
    );

    const unsubExpenses = subscribeToProjectExpensesFirstPage(id, PAGE_SIZE, ({ items, cursor }) => {
      setPage1Items(items);
      setPage1Cursor(cursor);
      if (!hasLoadedMore) setPageCursor(cursor);
      // Heurística simple: si devolvió PAGE_SIZE, probablemente hay más.
      setHasMore(items.length === PAGE_SIZE);
      setLoadingExpenses(false);
    });

    return () => {
      unsubProject();
      unsubExpenses();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadMore = async () => {
    if (!id) return;
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    try {
      const { items, cursor } = await getProjectExpensesPage(id, PAGE_SIZE, pageCursor);
      setOlderItems((prev) => {
        const prevIds = new Set(prev.map((e) => e.id));
        const incoming = items.filter((e) => !prevIds.has(e.id));
        return [...prev, ...incoming];
      });
      setHasLoadedMore(true);
      setPageCursor(cursor);
      setHasMore(items.length === PAGE_SIZE && !!cursor);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  };

  // Toggle Finalizar (Switch Visual)
  const toggleFinishProject = async () => {
    if (!project || !id) return;
    const newState = !project.finalizado;
    try {
      await updateDoc(doc(db, 'projects', id), { finalizado: newState });
            emitDataEvent('projects_changed');
setProject({ ...project, finalizado: newState });
    } catch (e) {
      console.error('Error al actualizar estado:', e);
    }
  };

  // Preparar formulario para Editar
  const handleEditExpense = (exp: ProjectExpense) => {
    setEditingExpenseId(exp.id || null);
    setFecha(exp.fecha.slice(0, 10));
    setCategoria(exp.categoria);
    setDescripcion(exp.descripcion || '');

    if (exp.moneda_original === 'EUR') {
      setCurrencyMode('EUR');
      setMonto(String(exp.monto_en_moneda_principal));
    } else {
      setCurrencyMode('LOCAL');
      setMonto(String(exp.monto_en_moneda_proyecto || exp.monto_original));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const applyLocalUpsert = (exp: ProjectExpense) => {
    // Si está en la primera página, lo dejamos que lo resuelva el realtime. Si no, hacemos update local.
    setOlderItems((prev) => {
      const idx = prev.findIndex((e) => e.id === exp.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = exp;
      // mantener orden por fecha desc
      copy.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      return copy;
    });
  };

  const applyLocalDelete = (expenseId: string) => {
    setPage1Items((prev) => prev.filter((e) => e.id !== expenseId));
    setOlderItems((prev) => prev.filter((e) => e.id !== expenseId));
  };

  // Guardar Gasto
  const handleAddExpense = async () => {
    if (!project || !id) return;

    const val = parseLocaleNumber(monto);
    if (!val || val <= 0) {
      alert('Ingresa un monto válido');
      return;
    }

    setSaving(true);
    try {
      const tc = project.tipo_cambio_referencia || 1;
      let mEur = 0;
      let mLocal = 0;

      if (currencyMode === 'EUR') {
        mEur = val;
        mLocal = val * tc;
      } else {
        mLocal = val;
        mEur = val / tc;
      }

      const expenseData: Omit<ProjectExpense, 'id'> & Record<string, any> = {
        proyecto_id: id,
        fecha: new Date(fecha).toISOString(),
        monto_original: val,
        moneda_original: currencyMode === 'EUR' ? 'EUR' : project.moneda_proyecto || 'LOCAL',
        tipo_cambio_usado: tc,
        monto_en_moneda_principal: mEur,
        monto_en_moneda_proyecto: mLocal,
        categoria: categoria,
        descripcion: descripcion,
        creado_por_usuario_id: currentUser,
        estado: 'activo',
      };

      if (editingExpenseId) {
        const updated: ProjectExpense & Record<string, any> = { id: editingExpenseId, ...(expenseData as any) };
        await updateProjectExpense(updated);
        applyLocalUpsert(updated as any);
      } else {
        const ref: any = await addProjectExpense(expenseData);
        // Insert localmente por si el realtime tarda (y para páginas ya cargadas)
        const created: ProjectExpense = { id: ref?.id, ...(expenseData as any) } as any;
        setPage1Items((prev) => {
          const next = [created, ...prev];
          next.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
          return next.slice(0, PAGE_SIZE);
        });
      }

      setMonto('');
      setDescripcion('');
      setEditingExpenseId(null);
    } catch (e) {
      console.error(e);
      alert('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!window.confirm('¿Borrar gasto?')) return;

    try {
      await deleteProjectExpense(expenseId);
      applyLocalDelete(expenseId);
    } catch (e) {
      console.error(e);
      alert('Error al borrar');
    }
  };

  if (!project) return <div className="p-10 text-center">Cargando...</div>;

  // 🎨 Color de identidad del proyecto (misma fuente que el listado).
  // Si no existe, caemos a un slate neutro (evita “azul random” y mantiene coherencia).
  const accentColor = (project as any)?.color || '#475569';

  const totalSpent =
    typeof (project as any)?.gasto_total_eur === 'number'
      ? (project as any).gasto_total_eur
      : expenses.reduce((acc, curr) => acc + (curr.monto_en_moneda_principal || 0), 0);

  const totalLocal =
    typeof (project as any)?.gasto_total_local === 'number'
      ? (project as any).gasto_total_local
      : expenses.reduce((acc, curr) => acc + (curr.monto_en_moneda_proyecto || 0), 0);

  return (
    <div className="p-4 pb-24 min-h-screen bg-slate-50 animate-revealFromCenter">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-800 leading-none">{project.nombre}</h1>
            <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
              {project.fechaInicio && (
                <span className="flex items-center gap-1">
                  <Calendar size={10} />
                  {format(new Date(project.fechaInicio), 'd MMM', { locale: es })}
                  {project.fechaFin
                    ? ` - ${format(new Date(project.fechaFin), 'd MMM', { locale: es })}`
                    : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <RefreshButton onClick={() => {}} />
        </div>
      </div>

      {/* CARD RESUMEN METÁLICA */}
      
<HeroCard
  variant="project"
  accentColor={accentColor}
  isPrivate={isPrivate}
  onTogglePrivate={() => setIsPrivate((v) => !v)}
  status={{
    label: project.finalizado ? 'Finalizado' : 'En curso',
    finished: !!project.finalizado,
    title: project.finalizado ? 'Reabrir' : 'Finalizar',
    onClick: toggleFinishProject,
  }}
  contentClassName="p-5 pr-16 pb-16"
>
  <div className="flex justify-between items-start">
    <div>
      <div className="text-xs uppercase tracking-widest text-slate-200">Gastado</div>
      <div className="text-4xl font-bold mt-1">€ {formatLocaleNumber(totalSpent)}</div>
      <div className="text-xs text-slate-200/80 mt-1">
        {project.moneda_proyecto || 'LOCAL'} {formatLocaleNumber(totalLocal)}
      </div>
    </div>
  </div>
</HeroCard>


      {/* FORM */}
      <Card className="p-4 mt-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">Fecha</div>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Tipo</div>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {PROJECT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">Moneda</div>
            <div className="flex gap-2">
              <Button
                variant={currencyMode === 'LOCAL' ? 'primary' : 'outline'}
                className="flex-1"
                onClick={() => setCurrencyMode('LOCAL')}
                type="button"
              >
                {project.moneda_proyecto || 'LOCAL'}
              </Button>
              <Button
                variant={currencyMode === 'EUR' ? 'primary' : 'outline'}
                className="flex-1"
                onClick={() => setCurrencyMode('EUR')}
                type="button"
              >
                EUR
              </Button>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Monto</div>
            <Input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-xs text-slate-500 mb-1">Descripción</div>
          <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Opcional" />
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={handleAddExpense} disabled={saving}>
            <PlusCircle size={18} className="mr-2" />
            {editingExpenseId ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </div>
      </Card>

      {/* LISTA */}
      <div className="mt-6">
        <div className="text-lg font-semibold text-slate-800">Movimientos</div>
        <div className="text-xs text-slate-500">Toca para editar · borra desde aquí</div>

        {(loadingProject || loadingExpenses) && (
          <div className="mt-4 text-sm text-slate-500">Cargando...</div>
        )}

        <div className="mt-3 space-y-2">
          {expenses.map((exp) => {
                      const Icon = getCategoryIcon(resolveExpenseCategory(exp));
            const amountEur = exp.monto_en_moneda_principal || 0;
            const amountLocal = exp.monto_en_moneda_proyecto || 0;

            return (
              <Card key={exp.id} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{exp.categoria}</div>
                    <div className="text-xs text-slate-500">
                      {format(new Date(exp.fecha), 'd MMM yyyy', { locale: es })}
                      {exp.descripcion ? ` · ${exp.descripcion}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={cn('text-right', isPrivate && 'blur-[6px] select-none')}>
                    <div className="text-sm font-bold text-slate-800">€ {formatLocaleNumber(amountEur)}</div>
                    <div className="text-xs text-slate-500">
                      {project.moneda_proyecto || 'LOCAL'} {formatLocaleNumber(amountLocal)}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditExpense(exp)}
                    className="text-slate-500 hover:text-slate-800"
                    title="Editar"
                  >
                    <Edit3 size={18} />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteExpense(exp.id)}
                    className="text-red-500 hover:text-red-600"
                    title="Borrar"
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>

        {/* CARGAR MÁS */}
        <div className="mt-4 flex justify-center">
          {hasMore ? (
            <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Cargando…' : 'Cargar más'}
            </Button>
          ) : hasLoadedMore ? (
            <div className="text-xs text-slate-400">No hay más movimientos</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};