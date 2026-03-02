// src/pages/OtherProjectDetail.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  PlusCircle,
  Trash2,
  Edit3,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  // Smart icons
  Hammer,
  Wrench,
  ShoppingBag,
  Stethoscope,
  GraduationCap,
  Zap,
  Briefcase,
  CreditCard,
  Layers,
  Car,
  Tag,
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
  ensureProjectAggregatesIfMissing,
} from '../services/db';
import { Project, ProjectExpense, User } from '../types';
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

const todayYMD = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 50;

export const OtherProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);

  // Paginación / realtime top-of-list
  const [page1, setPage1] = useState<ProjectExpense[]>([]);
  const [older, setOlder] = useState<ProjectExpense[]>([]);
  const [page1Cursor, setPage1Cursor] = useState<any | null>(null);
  const [cursor, setCursor] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const expenses = useMemo(() => {
    const m = new Map<string, ProjectExpense>();
    for (const e of page1) {
      if (!e?.id) continue;
      if ((e.estado || 'activo') === 'borrado') continue;
      m.set(e.id, e);
    }
    for (const e of older) {
      if (!e?.id) continue;
      if ((e.estado || 'activo') === 'borrado') continue;
      if (!m.has(e.id)) m.set(e.id, e);
    }
    const arr = Array.from(m.values());
    arr.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    return arr;
  }, [page1, older]);

  const [loading, setLoading] = useState(true);

  // Formulario
  const [fecha, setFecha] = useState<string>(todayYMD());
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');

  // Moneda de entrada:
  // - Si la moneda del proyecto es EUR, no se muestra el selector (sería EUR/EUR).
  // - Si la moneda del proyecto NO es EUR, el usuario puede ingresar en moneda del proyecto o en EUR.
  const [montoEn, setMontoEn] = useState<'PROYECTO' | 'EUR'>('PROYECTO');

  // UI
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(true); // Oculto por defecto
  const [saving, setSaving] = useState(false);

  const currentUser = (localStorage.getItem('currentUser') as unknown as User) || 'Diego';

  const ensuredAggRef = useRef(false);

  const getSmartIcon = (conceptOrLegacyCategory: string) => {
    const c = (conceptOrLegacyCategory || '').toLowerCase();
    if (/(madera|carpinter|mueble|mesa|silla|sof[aá]|cama|closet|armario)/.test(c)) return Hammer;
    if (/(obra|albañil|pintur|reparaci[oó]n|arreglo|plomer|fontaner|electric)/.test(c)) return Wrench;
    if (/(compra|tienda|amazon|ikea|super|mercadona|carrefour)/.test(c)) return ShoppingBag;
    if (/(dent|salud|m[eé]dic|cl[ií]nic|farmac)/.test(c)) return Stethoscope;
    if (/(curso|clase|educaci[oó]n|master|mba|certif)/.test(c)) return GraduationCap;
    if (/(suscrip|netflix|spotify|internet|luz|agua|gas|servicio)/.test(c)) return Zap;
    if (/(honorario|abogad|contador|asesor|consultor)/.test(c)) return Briefcase;
    if (/(uber|taxi|metro|bus|tren|transporte|auto|coche)/.test(c)) return Car;
    // fallback neutral
    return Layers;
  };

  // Suscripción a proyecto (doc) + agregados legacy (one-shot)
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setProject(null);

    const unsubProject = onSnapshot(
      doc(db, 'projects', id),
      async (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as Project;
          setProject(data);

          if (!ensuredAggRef.current) {
            ensuredAggRef.current = true;
            ensureProjectAggregatesIfMissing(id).catch(() => {});
          }
        } else {
          setProject(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsubProject();
  }, [id]);

  // Realtime solo primera página de expenses
  useEffect(() => {
    if (!id) return;

    setPage1([]);
    setOlder([]);
    setPage1Cursor(null);
    setCursor(null);
    setHasMore(false);
    setLoadingMore(false);

    const unsub = subscribeToProjectExpensesFirstPage(id, PAGE_SIZE, ({ items, cursor: c }) => {
      const active = (items || []).filter((e) => (e.estado || 'activo') !== 'borrado');
      setPage1(active);
      setPage1Cursor(c);
      setCursor((prev) => (older.length === 0 ? c : prev));
      setHasMore(Boolean(c) && active.length >= PAGE_SIZE);
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Selector de moneda: si el proyecto es EUR, forzamos EUR.
  useEffect(() => {
    const mp = (project?.moneda_proyecto || 'EUR').toUpperCase();
    if (mp === 'EUR') setMontoEn('EUR');
  }, [project?.moneda_proyecto]);

  const handleRefreshLocal = () => {
    setOlder([]);
    setCursor(page1Cursor);
    setHasMore(Boolean(page1Cursor) && page1.length >= PAGE_SIZE);
  };

  const resetForm = () => {
    setFecha(todayYMD());
    setDescripcion('');
    setMonto('');
    const mp = (project?.moneda_proyecto || 'EUR').toUpperCase();
    setMontoEn(mp === 'EUR' ? 'EUR' : 'PROYECTO');
    setEditingExpenseId(null);
  };

  const upsertLocalExpense = (idToUpdate: string, payload: Partial<ProjectExpense>) => {
    setPage1((prev) => prev.map((e) => (e.id === idToUpdate ? ({ ...e, ...payload, id: idToUpdate } as any) : e)));
    setOlder((prev) => prev.map((e) => (e.id === idToUpdate ? ({ ...e, ...payload, id: idToUpdate } as any) : e)));
  };

  const removeLocalExpense = (idToRemove: string) => {
    setPage1((prev) => prev.filter((e) => e.id !== idToRemove));
    setOlder((prev) => prev.filter((e) => e.id !== idToRemove));
  };

  const totals = useMemo(() => {
    const eurAgg = Number((project as any)?.gasto_total_eur);
    const localAgg = Number((project as any)?.gasto_total_local);

    const hasAggEur = Number.isFinite(eurAgg);
    const hasAggLocal = Number.isFinite(localAgg);

    const totalEur = hasAggEur
      ? eurAgg
      : expenses.reduce((acc, curr) => acc + (Number(curr.monto_en_moneda_principal) || 0), 0);

    const totalLocal = hasAggLocal
      ? localAgg
      : expenses.reduce((acc, curr) => acc + (Number(curr.monto_en_moneda_proyecto) || 0), 0);

    return { totalEur, totalLocal };
  }, [project, expenses]);

  const toggleFinishProject = async () => {
    if (!project || !id) return;
    const newState = !project.finalizado;
    await updateDoc(doc(db, 'projects', id), {
      finalizado: newState,
      estado: newState ? 'finalizado' : 'activo',
      updated_at: new Date().toISOString(),
    } as any);
        emitDataEvent('projects_changed');
};

  const loadMore = async () => {
    if (!id) return;
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const start = cursor || page1Cursor;
      if (!start) {
        setHasMore(false);
        return;
      }

      const res = await getProjectExpensesPage(id, PAGE_SIZE, start);
      const items = (res.items || []).filter((e) => (e.estado || 'activo') !== 'borrado');

      setOlder((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const toAdd = items.filter((x) => x.id && !seen.has(x.id));
        return [...prev, ...toAdd];
      });

      setCursor(res.cursor);
      setHasMore(Boolean(res.cursor) && items.length >= PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleAddOrUpdateExpense = async () => {
    if (!project || !id) return;
    if (!monto) return;

    setSaving(true);
    try {
      const enteredAmount = parseLocaleNumber(monto) || 0;
      const tc = Number(project.tipo_cambio_referencia) || 1;
      const monedaProyecto = (project.moneda_proyecto || 'EUR').toUpperCase();

      let montoEnProyecto = 0;
      let montoEur = 0;
      let monedaOriginal: string = monedaProyecto;

      if (monedaProyecto === 'EUR') {
        montoEnProyecto = enteredAmount;
        montoEur = enteredAmount;
        monedaOriginal = 'EUR';
      } else if (montoEn === 'EUR') {
        montoEur = enteredAmount;
        montoEnProyecto = tc ? enteredAmount * tc : enteredAmount;
        monedaOriginal = 'EUR';
      } else {
        montoEnProyecto = enteredAmount;
        montoEur = tc ? enteredAmount / tc : enteredAmount;
        monedaOriginal = monedaProyecto;
      }

      const concept = descripcion.trim();

      const payloadBase: Omit<ProjectExpense, 'id'> = {
        proyecto_id: id,
        fecha: parseYMD(fecha, 'noon').toISOString(),
        monto_original: enteredAmount,
        moneda_original: monedaOriginal,
        tipo_cambio_usado: tc,
        monto_en_moneda_proyecto: montoEnProyecto,
        monto_en_moneda_principal: montoEur,
        // En Otros Proyectos la “categoría” real es concepto (obligatorio).
        categoria: concept || 'Concepto',
        descripcion: concept,
        creado_por_usuario_id: currentUser,
        estado: 'activo',
      };

      if (editingExpenseId) {
        await updateProjectExpense({ id: editingExpenseId, ...payloadBase } as ProjectExpense);
        upsertLocalExpense(editingExpenseId, payloadBase as any);
      } else {
        const ref = await addProjectExpense(payloadBase as any);
        const optimistic: ProjectExpense = { id: ref.id, ...payloadBase } as any;
        setPage1((prev) => [optimistic, ...prev]);
      }

      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleEditExpense = (exp: ProjectExpense) => {
    setEditingExpenseId(exp.id || null);
    setFecha(exp.fecha?.slice(0, 10) || todayYMD());
    setDescripcion((exp.descripcion || exp.categoria || '').toString());

    const monedaOriginal = (exp.moneda_original || (project?.moneda_proyecto || 'EUR')).toUpperCase();
    if (monedaOriginal === 'EUR') {
      setMontoEn('EUR');
      setMonto(String(Number(exp.monto_en_moneda_principal) || 0));
    } else {
      setMontoEn('PROYECTO');
      setMonto(String(Number(exp.monto_en_moneda_proyecto) || 0));
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!expenseId) return;
    if (!window.confirm('¿Eliminar este gasto?')) return;
    await deleteProjectExpense(expenseId);
    removeLocalExpense(expenseId);
  };

  if (!project) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/projects')} className="-ml-2">
          <ArrowLeft size={18} /> Volver
        </Button>
        <div className="mt-6 text-slate-400">{loading ? 'Cargando…' : 'No encontrado'}</div>
      </div>
    );
  }

  // 🎨 Color de identidad del proyecto (misma fuente que el listado).
  // Si no existe, caemos a un slate neutro.
  const accentColor = (project as any)?.color || '#475569';

  const monedaProyecto = (project.moneda_proyecto || 'EUR').toUpperCase();
  const ConceptIcon = getSmartIcon((project.nombre || '').toString());
  const gastoCount = Number.isFinite(Number((project as any)?.gastos_count)) ? Number((project as any)?.gastos_count) : expenses.length;

  return (
    <div className="p-4 pb-24 min-h-screen bg-slate-50/50 animate-revealFromCenter">
      {/* HEADER */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')} className="-ml-2 text-slate-400 hover:bg-slate-100 rounded-full">
            <ArrowLeft size={22} />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{project.nombre}</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Proyecto</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <RefreshButton onClick={handleRefreshLocal} />
        </div>
      </div>

      {/* RESUMEN (premium/titanio) */}
      
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
  contentClassName="p-6 pr-16 pb-16"
>
  <div className="flex items-start justify-between">
    <div>
      <div className="text-[10px] text-slate-200 font-black uppercase tracking-widest">Total gastado</div>
      <div className="text-3xl font-black tracking-tight text-white">
        € {formatLocaleNumber(totals.totalEur, 0)}
      </div>
      {monedaProyecto !== 'EUR' && (
        <div className="text-xs text-slate-200/80 mt-1 font-mono">
          {formatLocaleNumber(totals.totalLocal, 0)} {monedaProyecto}
        </div>
      )}
    </div>
  </div>
</HeroCard>


      {/* FORM */}
      <Card className="p-4 border-none shadow-lg bg-white rounded-3xl mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {editingExpenseId ? 'Editar gasto' : 'Nuevo gasto'}
          </div>
          <div className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black border border-slate-200">
            {monedaProyecto}
            {monedaProyecto !== 'EUR' && project.tipo_cambio_referencia ? ` · 1 EUR = ${project.tipo_cambio_referencia}` : ''}
          </div>
        </div>

        {/* Selector EUR / moneda del proyecto (solo si NO es EUR) */}
        {(monedaProyecto !== 'EUR') && (
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMontoEn('PROYECTO')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all",
                montoEn === 'PROYECTO'
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              )}
            >
              {monedaProyecto}
            </button>
            <button
              type="button"
              onClick={() => setMontoEn('EUR')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all",
                montoEn === 'EUR'
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              )}
            >
              EUR
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
              {montoEn === 'EUR' ? '€' : ''}
            </span>
            <Input
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0"
              className={cn("text-lg font-bold", montoEn === 'EUR' ? 'pl-7' : 'pl-3')}
              inputMode="decimal"
            />
          </div>
          <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-black border border-slate-200 whitespace-nowrap">
            {montoEn === 'EUR' ? 'EUR' : monedaProyecto}
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative w-1/3">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full pl-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          </div>

          <div className="flex-1">
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción (obligatoria, rápido)"
              className="text-xs"
            />
          </div>

          <Button
            onClick={handleAddOrUpdateExpense}
            disabled={saving || !monto || !descripcion.trim()}
            className={cn("w-12 flex items-center justify-center transition-colors", editingExpenseId ? "bg-amber-500" : "bg-slate-800")}
          >
            {editingExpenseId ? <Edit3 size={18} /> : <PlusCircle size={18} />}
          </Button>
        </div>

        {editingExpenseId && (
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={resetForm} className="text-slate-500">
              Cancelar
            </Button>
          </div>
        )}
      </Card>

      {/* LISTA */}
      <div className="space-y-2">
        <div className="flex justify-between items-end px-1">
          <h3 className="text-xs font-bold text-slate-500 uppercase">Movimientos</h3>
          <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {gastoCount} regs
          </span>
        </div>

        {expenses.map((exp) => {
          const Icon = getSmartIcon((exp.categoria || exp.descripcion || '').toString());
          const title = (exp.descripcion || '').toString().trim() || 'Sin descripción';

          return (
            <div key={exp.id} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 border border-slate-100 shrink-0">
                  <Icon size={18} strokeWidth={2} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 leading-tight">{title}</p>
                  <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                    {exp.fecha ? format(new Date(exp.fecha), 'd MMM', { locale: es }) : ''}
                    <span className="inline-flex items-center gap-1 ml-2 text-slate-400">
                      <Tag size={12} />
                      {(exp.categoria || 'Concepto').toString()}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-black text-slate-900">€ {formatLocaleNumber((exp.monto_en_moneda_principal as any) || 0, 2)}</p>
                  {monedaProyecto !== 'EUR' && (
                    <p className="text-[10px] text-slate-400 font-mono">
                      {formatLocaleNumber((exp.monto_en_moneda_proyecto as any) || 0, 0)} {monedaProyecto}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 pl-2 border-l border-slate-100 ml-1">
                  <button onClick={() => handleEditExpense(exp)} className="p-1.5 text-slate-300 hover:text-blue-500">
                    <Edit3 size={16} />
                  </button>
                  <button onClick={() => handleDeleteExpense(exp.id!)} className="p-1.5 text-slate-300 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {expenses.length === 0 && (
          <div className="p-10 text-center text-slate-300 bg-white rounded-3xl border-2 border-dashed border-slate-100">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <CreditCard size={30} className="opacity-20" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest">Sin gastos aún</p>
          </div>
        )}

        {/* Cargar más */}
        {expenses.length > 0 && hasMore && (
          <div className="pt-2 flex justify-center">
            <Button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm"
            >
              {loadingMore ? 'Cargando…' : 'Cargar más'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};