// src/pages/TripDetail.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Undo2,
  Plane,
  Hotel,
  Utensils,
  ShoppingBag,
  Car,
  Ticket,
  Landmark,
  Sparkles,
  PlusCircle,
  Edit3,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { format, parseISO, isBefore } from 'date-fns';
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
  subscribeToCategories,
} from '../services/db';
import { Project, ProjectExpense, Category, User } from '../types';
import {
  Card,
  Button,
  Input,
  cn,
  RefreshButton,
  formatLocaleNumber,
  parseLocaleNumber,
  parseYMD,
  getCategoryIcon,
} from '../components/Components';
import { HeroCard } from '../components/hero/HeroUi';
import { emitDataEvent } from '../state/dataEvents';

const todayYMD = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 50;

export const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [trip, setTrip] = useState<Project | null>(null);

  // Paginación / realtime top-of-list
  const [page1, setPage1] = useState<ProjectExpense[]>([]);
  const [older, setOlder] = useState<ProjectExpense[]>([]);
  const [page1Cursor, setPage1Cursor] = useState<any | null>(null);
  const [cursor, setCursor] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [loading, setLoading] = useState(true);

  // Formulario de gasto
  const [fecha, setFecha] = useState<string>(todayYMD());
  const [tripCategories, setTripCategories] = useState<Category[]>([]);
  const [categoria, setCategoria] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [montoEn, setMontoEn] = useState<'LOCAL' | 'EUR'>('LOCAL');
  const [isRefund, setIsRefund] = useState(false);
  const [refundAuto, setRefundAuto] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  // UI
  const [isPrivate, setIsPrivate] = useState(true);
  const [saving, setSaving] = useState(false);

  // Copiar movimientos (UI estilo Home)
  const [copiedAllMovements, setCopiedAllMovements] = useState(false);
  const [copiedMovementId, setCopiedMovementId] = useState<string | null>(null);

  const currentUser = (localStorage.getItem('currentUser') as unknown as User) || 'Diego';

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

  // Asegura agregados (one-shot) si hay data legacy sin totales.
  const ensuredAggRef = useRef(false);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setTrip(null);
    setPage1([]);
    setOlder([]);
    setPage1Cursor(null);
    setCursor(null);
    setHasMore(false);
    setLoadingMore(false);

    // 1) Proyecto (doc listener, barato y mantiene totales al día)
    const unsubTrip = onSnapshot(
      doc(db, 'projects', id),
      async (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as Project;
          setTrip(data);

          if (!ensuredAggRef.current) {
            ensuredAggRef.current = true;
            // Si faltan agregados, los recalculamos una vez (sin listeners).
            ensureProjectAggregatesIfMissing(id).catch(() => {});
          }
        } else {
          setTrip(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );

    // 2) Gastos - solo primera página en realtime
    const unsubPage1 = subscribeToProjectExpensesFirstPage(id, PAGE_SIZE, ({ items, cursor: c }) => {
      const active = (items || []).filter((e) => (e.estado || 'activo') !== 'borrado');
      setPage1(active);
      setPage1Cursor(c);

      // Si todavía no cargamos páginas extra, el cursor de paginación parte desde el fin de la página 1.
      setCursor((prev) => (older.length === 0 ? c : prev));

      // Si recibimos PAGE_SIZE, probablemente hay más. (cursor null => no más)
      setHasMore(Boolean(c) && active.length >= PAGE_SIZE);

      setLoading(false);
    });

    return () => {
      unsubTrip();
      unsubPage1();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ✅ Categorías de viaje (scope: 'trip') desde Settings
  useEffect(() => {
    const unsub = subscribeToCategories((data) => {
      setTripCategories(data || []);
    }, 'trip');
    return () => unsub?.();
  }, []);

  // ✅ Default categoría (Trips):
  // - Si hay categorías definidas en Settings (scope: 'trip'), usamos 'Otros' (o la 1ª)
  // - Si no hay categorías aún, caemos a 'extra' (fallback legacy)
  useEffect(() => {
    const hasTripCats = tripCategories.length > 0;
    if (hasTripCats) {
      const preferred = tripCategories.find((c: any) => String((c as any).key || '').toLowerCase() === 'otros') || tripCategories[0];
      const preferredName = (preferred as any)?.nombre || (preferred as any)?.label || '';
      const currentNorm = String(categoria || '').toLowerCase();
      const isLegacyFallback = !categoria || currentNorm === 'extra' || currentNorm === 'otros';
      if (isLegacyFallback && preferredName) setCategoria(preferredName);
    } else {
      if (!categoria) setCategoria('extra');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripCategories]);

  // Moneda de input (si el viaje es EUR, forzamos EUR)
  useEffect(() => {
    const mp = (trip?.moneda_proyecto || 'EUR').toUpperCase();
    if (mp === 'EUR') setMontoEn('EUR');
  }, [trip?.moneda_proyecto]);

  const handleRefreshLocal = () => {
    // No tocamos el listener; solo “reseteamos” páginas extra por si había drift.
    setOlder([]);
    setCursor(page1Cursor);
    setHasMore(Boolean(page1Cursor) && page1.length >= PAGE_SIZE);
  };

  const resetForm = () => {
    setFecha(todayYMD());
    setCategoria(() => {
      if (tripCategories.length) {
        const preferred = tripCategories.find((c: any) => String((c as any).key || '').toLowerCase() === 'otros') || tripCategories[0];
        return preferred?.nombre || (preferred as any)?.label || '';
      }
      return 'extra';
    });
    setDescripcion('');
    setMonto('');
    const mp = (trip?.moneda_proyecto || 'EUR').toUpperCase();
    setMontoEn(mp === 'EUR' ? 'EUR' : 'LOCAL');
    setIsRefund(false);
    setRefundAuto(false);
    setEditingExpenseId(null);
  };

  const handleMontoChange = (raw: string) => {
    setMonto(raw);
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

  const handleMontoBlur = () => {
    const val = parseLocaleNumber(monto);
    if (!val) return;
    const abs = Math.abs(val);
    const formatted = formatLocaleNumber(abs, 2);
    setMonto(isRefund ? `-${formatted}` : formatted);
  };

  const toggleRefund = () => {
    setIsRefund((prev) => !prev);
    setRefundAuto(false);
  };

  const getDateLabel = () => {
    try {
      const dateObj = new Date(`${fecha}T00:00:00`);
      const today = new Date();
      const same = dateObj.toDateString() === today.toDateString();
      if (same) return 'HOY';
      return format(dateObj, 'd MMM', { locale: es }).toUpperCase();
    } catch {
      return '';
    }
  };

  const safeMovementDayMonth = (iso: string) => {
    try {
      return format(new Date(iso), 'dd/MM');
    } catch {
      return '';
    }
  };

  const buildMovementCopyLine = (e: ProjectExpense) => {
    const eur = Number((e as any)?.monto_en_moneda_principal) || 0;
    const isRefundItem = eur < 0;
    const sign = isRefundItem ? '+' : '-';
    const absVal = Math.abs(eur);

    const date = safeMovementDayMonth((e as any)?.fecha || '');
    const descRaw = String((e as any)?.descripcion || '').replace(/\s+/g, ' ').trim();
    const catRaw = String((resolveTripCategory(e)?.nombre) || (e as any)?.categoria || '').trim();
    const desc = descRaw || catRaw;
    const cat = catRaw || '';

    return `${date};${desc};${cat};${sign}€${formatLocaleNumber(absVal, 2)}`;
  };

  const handleCopyMovement = async (evt: React.MouseEvent, item: ProjectExpense) => {
    evt.stopPropagation();
    try {
      const line = buildMovementCopyLine(item);
      if (!line) return;
      await navigator.clipboard.writeText(line);
      setCopiedMovementId(item.id || 'row');
      setTimeout(() => setCopiedMovementId(null), 1500);
    } catch {
      // Safari/iOS a veces bloquea clipboard si no es gesto válido.
    }
  };

  const handleCopyAllMovements = async () => {
    try {
      if (!expenses.length) return;
      // Para copiar, orden cronológico (antiguo -> nuevo)
      const ordered = expenses
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

  const toggleFinishTrip = async () => {
    if (!trip || !id) return;

    const currentlyFinished = Boolean(trip.finalizado);
    const newState = !currentlyFinished;

    // ✅ Reabrir siempre permitido.
    // ✅ Finalizar: solo si ya terminó según fechaFin (fin del día).
    if (newState) {
      if (!trip.fechaFin) {
        alert('No puedo marcarlo como Finalizado si no tiene fecha de término. Completa las fechas del viaje.');
        return;
      }
      const end = parseISO(trip.fechaFin);
      end.setHours(23, 59, 59, 999);
      const now = new Date();

      if (isBefore(now, end)) {
        alert(`Aún no termina el viaje. Fecha fin: ${format(end, 'd MMM yyyy', { locale: es })}.\n\nTip: si fue un error, puedes Reabrirlo cuando quieras.`);
        return;
      }
    }

    await updateDoc(doc(db, 'projects', id), {
      finalizado: newState,
      estado: newState ? 'finalizado' : 'activo',
      updated_at: new Date().toISOString(),
    } as any);
        emitDataEvent('projects_changed');
};

  const totals = useMemo(() => {
    const eurAgg = Number((trip as any)?.gasto_total_eur);
    const localAgg = Number((trip as any)?.gasto_total_local);

    const hasAggEur = Number.isFinite(eurAgg);
    const hasAggLocal = Number.isFinite(localAgg);

    const totalEur = hasAggEur
      ? eurAgg
      : expenses.reduce((acc, curr) => acc + (Number(curr.monto_en_moneda_principal) || 0), 0);

    const totalLocal = hasAggLocal
      ? localAgg
      : expenses.reduce((acc, curr) => acc + (Number(curr.monto_en_moneda_proyecto) || 0), 0);

    return { totalEur, totalLocal };
  }, [trip, expenses]);
  // ✅ Category resolver (Trips): usa categorías definidas en Settings (scope: 'trip')
  const resolveCategoryKey = (input: any): string => {
    if (!input) return '';
    if (typeof input === 'string') return input;
    return (
      input.categoria ??
      input.categoryName ??
      input.categoryId ??
      input.category ??
      input.categoria_id ??
      input.tipo ??
      input.tipo_gasto ??
      ''
    );
  };

  const stripDiacritics = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const normKey = (s: string) =>
    stripDiacritics(String(s || '').trim().toLowerCase()).replace(/\s+/g, '');

  const canonicalTripKey = (raw: string): string => {
    const s = stripDiacritics((raw || '').trim().toLowerCase());
    if (!s) return 'otros';
    if (/(vuelo|flight|air|aereo|avion|avi[oó]n)/.test(s)) return 'vuelos';
    if (/(hotel|aloj|hosped|airbnb|hostel|resort)/.test(s)) return 'alojamiento';
    if (/(comida|food|rest|cena|almuerzo|desayuno|snack|bar)/.test(s)) return 'comida';
    if (/(uber|taxi|metro|bus|tren|transp|parking|peaje|gasolina|nafta)/.test(s)) return 'transporte';
    if (/(tour|entrada|ocio|actividad|excursion|excursi[oó]n|show|museo)/.test(s)) return 'actividades';
    if (/(compr|shopping|souvenir|tienda|ropa)/.test(s)) return 'compras';
    if (/(imp|tax|iva|aduana)/.test(s)) return 'impuestos';
    return 'otros';
  };

  const resolveTripCategory = (raw: any): Category | undefined => {
    const s0 = resolveCategoryKey(raw);
    const s = String(s0 || '').trim();
    if (!s) return undefined;

    // 1) match exact nombre/label
    const exact = tripCategories.find((c) => c.nombre === s || (c as any).label === s);
    if (exact) return exact;

    // 2) match por key
    const k = normKey(s);
    const byKey = tripCategories.find((c) => normKey(String((c as any).key || '')) == k);
    if (byKey) return byKey;

    // 3) canonicaliza legacy
    const canon = canonicalTripKey(s);
    const byCanon = tripCategories.find((c) => normKey(String((c as any).key || c.nombre || (c as any).label || '')) === canon);
    if (byCanon) return byCanon;

    return undefined;
  };

  const categoryIcon = (raw: any) => {
    const cat = resolveTripCategory(raw);
    return getCategoryIcon((cat as any)?.icono || 'General');
  };

  const handleEditExpense = (exp: ProjectExpense) => {
    setEditingExpenseId(exp.id || null);
    setFecha(exp.fecha?.slice(0, 10) || todayYMD());
    setCategoria((resolveTripCategory(exp)?.nombre) || (typeof (exp as any)?.categoria === 'string' ? (exp as any).categoria : '') || categoria || '');
    setDescripcion((exp.descripcion || '').toString());

    const monedaOriginal = (exp.moneda_original || (trip?.moneda_proyecto || 'EUR')).toUpperCase();
    if (monedaOriginal === 'EUR') {
      setMontoEn('EUR');
      setMonto(formatLocaleNumber(Number(exp.monto_en_moneda_principal) || 0, 2));
    } else {
      setMontoEn('LOCAL');
      setMonto(formatLocaleNumber(Number(exp.monto_en_moneda_proyecto) || 0, 2));
    }

    const rawAmount = monedaOriginal === 'EUR'
      ? Number(exp.monto_en_moneda_principal) || 0
      : Number(exp.monto_en_moneda_proyecto) || 0;
    setIsRefund(rawAmount < 0);
    setRefundAuto(false);
  };

  const upsertLocalExpense = (idToUpdate: string, payload: Partial<ProjectExpense>) => {
    setPage1((prev) => prev.map((e) => (e.id === idToUpdate ? ({ ...e, ...payload, id: idToUpdate } as any) : e)));
    setOlder((prev) => prev.map((e) => (e.id === idToUpdate ? ({ ...e, ...payload, id: idToUpdate } as any) : e)));
  };

  const removeLocalExpense = (idToRemove: string) => {
    setPage1((prev) => prev.filter((e) => e.id !== idToRemove));
    setOlder((prev) => prev.filter((e) => e.id !== idToRemove));
  };

  const handleAddExpense = async () => {
    if (!trip || !id) return;
    if (!monto) return;

    setSaving(true);
    try {
      const rawNum = parseLocaleNumber(monto) || 0;
      const abs = Math.abs(rawNum);
      if (abs <= 0) return;
      const finalIsRefund = isRefund || rawNum < 0;
      const enteredAmount = finalIsRefund ? -abs : abs;

      if (finalIsRefund) {
        const ok = window.confirm('Estás ingresando una DEVOLUCIÓN. Esto disminuirá el total del viaje.\n\n¿Continuar?');
        if (!ok) return;
      }

      const tc = Number(trip.tipo_cambio_referencia) || 1;
      const monedaProyecto = (trip.moneda_proyecto || 'EUR').toUpperCase();

      let montoLocal = 0;
      let montoEur = 0;
      let monedaOriginal: string = monedaProyecto;

      if (monedaProyecto === 'EUR') {
        montoLocal = enteredAmount;
        montoEur = enteredAmount;
        monedaOriginal = 'EUR';
      } else if (montoEn === 'EUR') {
        montoEur = enteredAmount;
        montoLocal = tc ? enteredAmount * tc : enteredAmount;
        monedaOriginal = 'EUR';
      } else {
        montoLocal = enteredAmount;
        montoEur = tc ? enteredAmount / tc : enteredAmount;
        monedaOriginal = monedaProyecto;
      }

      const payloadBase: Omit<ProjectExpense, 'id'> = {
        proyecto_id: id,
        fecha: parseYMD(fecha, 'noon').toISOString(),
        monto_original: enteredAmount,
        moneda_original: monedaOriginal,
        tipo_cambio_usado: tc,
        monto_en_moneda_proyecto: montoLocal,
        monto_en_moneda_principal: montoEur,
        categoria,
        descripcion: descripcion.trim(),
        creado_por_usuario_id: currentUser,
        estado: 'activo',
      };

      if (editingExpenseId) {
        await updateProjectExpense({ id: editingExpenseId, ...payloadBase } as ProjectExpense);
        upsertLocalExpense(editingExpenseId, payloadBase as any);
      } else {
        const ref = await addProjectExpense(payloadBase as any);
        // Optimista: lo empujamos al principio (el listener lo confirmará)
        const optimistic: ProjectExpense = { id: ref.id, ...payloadBase } as any;
        setPage1((prev) => {
          const next = [optimistic, ...prev];
          // No recortamos aquí: si recortamos, “perderíamos” items al deslizar; el listener traerá la realidad.
          return next;
        });
      }

      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!expenseId) return;
    if (!window.confirm('¿Eliminar este gasto?')) return;
    await deleteProjectExpense(expenseId);
    removeLocalExpense(expenseId);
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

  if (!trip) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/trips')} className="-ml-2">
          <ArrowLeft size={18} /> Volver
        </Button>
        <div className="mt-6 text-slate-400">{loading ? 'Cargando…' : 'No encontrado'}</div>
      </div>
    );
  }

  const monedaProyecto = (trip.moneda_proyecto || 'EUR').toUpperCase();
  const gastoCount = Number.isFinite(Number((trip as any)?.gastos_count)) ? Number((trip as any)?.gastos_count) : expenses.length;

  // Preview de conversión (solo UI): inspirado en Home
  const tcRef = Number(trip.tipo_cambio_referencia) || 1;
  const previewAmount = (() => {
    const v = parseLocaleNumber(monto) || 0;
    if (!v) return 0;
    const abs = Math.abs(v);
    return (isRefund ? -abs : abs);
  })();
  const previewText = (() => {
    if (!previewAmount) return '';
    if (monedaProyecto === 'EUR') return '';
    if (!tcRef) return '';
    if (montoEn === 'LOCAL') {
      const eur = previewAmount / tcRef;
      return `≈ € ${formatLocaleNumber(eur, 2)}`;
    }
    const local = previewAmount * tcRef;
    return `≈ ${formatLocaleNumber(local, 0)} ${monedaProyecto}`;
  })();

  return (
    <div className="p-4 pb-24 min-h-screen bg-slate-50/50 animate-revealFromCenter">
      {/* HEADER */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/trips')} className="-ml-2 text-slate-400 hover:bg-slate-100 rounded-full">
            <ArrowLeft size={22} />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{trip.nombre}</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Detalle del viaje</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <RefreshButton onClick={handleRefreshLocal} />
        </div>
      </div>

      {/* RESUMEN */}
      
<HeroCard
  variant="trip"
  accentColor={trip.color || '#3b82f6'}
  isPrivate={isPrivate}
  onTogglePrivate={() => setIsPrivate((v) => !v)}
  status={{
    label: trip.finalizado ? 'Finalizado' : 'En curso',
    finished: !!trip.finalizado,
    title: trip.finalizado ? 'Reabrir' : 'Finalizar',
    onClick: toggleFinishTrip,
  }}
>
  <div className="flex items-start justify-between">
    <div>
      <div className="text-[10px] text-slate-200 font-black uppercase tracking-widest">Total gastado</div>
      <div className="text-4xl font-black tracking-tight text-white">
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


{/* FORM (inspirado en Home) */}
      <Card className="p-4 border-none shadow-lg bg-white rounded-3xl mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {editingExpenseId ? 'Editar gasto' : 'Nuevo gasto'}
          </div>
          <div className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black border border-slate-200">
            {monedaProyecto}
            {monedaProyecto !== 'EUR' && trip.tipo_cambio_referencia ? ` · 1 EUR = ${trip.tipo_cambio_referencia}` : ''}
          </div>
        </div>

        {/* Selector EUR / Moneda del viaje (solo si el viaje NO es EUR) */}
        {monedaProyecto !== 'EUR' && (
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMontoEn('LOCAL')}
              className={cn(
                'px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all',
                montoEn === 'LOCAL'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              )}
            >
              {monedaProyecto}
            </button>
            <button
              type="button"
              onClick={() => setMontoEn('EUR')}
              className={cn(
                'px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all',
                montoEn === 'EUR'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              )}
            >
              EUR
            </button>
          </div>
        )}

        {/* Monto + Fecha */}
        <div className="flex gap-2 items-center">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
              {montoEn === 'EUR' ? '€' : ''}
            </span>
            <Input
              value={monto}
              onChange={(e) => handleMontoChange(e.target.value)}
              onBlur={handleMontoBlur}
              placeholder="0,00"
              className={cn(
                'py-2 text-2xl font-bold border-none bg-slate-50 focus:ring-0 rounded-lg text-slate-800 placeholder:text-slate-200',
                montoEn === 'EUR' ? 'pl-8' : 'pl-3'
              )}
              inputMode="decimal"
              aria-label="Monto del gasto"
            />
          </div>

          <div className="relative">
            <button
              type="button"
              aria-label="Cambiar fecha del gasto"
              className="h-12 w-12 bg-slate-50 rounded-lg flex flex-col items-center justify-center text-blue-600 border border-slate-100 relative overflow-hidden"
            >
              <Calendar size={18} aria-hidden="true" />
              <span className="text-[9px] font-bold">{getDateLabel()}</span>
              <input
                type="date"
                aria-label="Selector de fecha"
                className="absolute inset-0 opacity-0 cursor-pointer"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </button>
          </div>
        </div>

        {previewText && (
          <div className="mt-1 text-[10px] text-slate-400 text-right">{previewText}</div>
        )}

        {/* Tipo movimiento (devolución) */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <span className="text-[11px] text-slate-500">Tipo de movimiento</span>
          <button
            type="button"
            onClick={toggleRefund}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium border transition-colors',
              isRefund
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-white border-slate-200 text-slate-600'
            )}
            aria-pressed={isRefund}
          >
            <Undo2 size={14} aria-hidden="true" />
            <span>{isRefund ? 'Devolución activa' : 'Marcar devolución'}</span>
          </button>
        </div>

        {/* Categorías (chips estilo Home) */}
        <div
          role="group"
          aria-label="Categoría del gasto"
          className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1 mt-3"
        >
          {(tripCategories.length ? tripCategories : ([
            { key: 'vuelos', label: 'Vuelos', icon: Plane },
            { key: 'alojamiento', label: 'Alojamiento', icon: Hotel },
            { key: 'comida', label: 'Comida', icon: Utensils },
            { key: 'compras', label: 'Compras', icon: ShoppingBag },
            { key: 'transporte', label: 'Transporte', icon: Car },
            { key: 'actividades', label: 'Actividades', icon: Ticket },
            { key: 'impuestos', label: 'Impuestos', icon: Landmark },
            { key: 'otros', label: 'Otros', icon: Sparkles },
          ] as any[])).map((cat: any) => {
            const isFromSettings = !!(cat as any).nombre;
            const catName = isFromSettings ? String(cat.nombre) : String(cat.key);
            const label = isFromSettings ? String((cat as any).label || cat.nombre) : String(cat.label);
            const Icon = isFromSettings ? getCategoryIcon((cat as any).icono || 'General') : (cat.icon as any);
            const isSelected = categoria === catName || (isFromSettings && categoria === String(cat.nombre));

            return (
              <button
                key={String((cat as any).id || catName)}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setCategoria(isFromSettings ? String(cat.nombre) : catName)}
                className={cn(
                  'flex flex-col items-center gap-1 min-w-[76px] p-2 rounded-xl transition-all border',
                  isSelected
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md scale-[1.02]'
                    : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50'
                )}
              >
                <Icon size={20} className={isSelected ? 'text-white' : 'text-current'} aria-hidden="true" />
                <span className="text-[9px] font-medium truncate w-full text-center">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Descripción + acción */}
        <div className="flex gap-2 mt-3">
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Descripción (opcional)"
            className="py-2 text-sm bg-slate-50 border-none"
          />
          <Button
            onClick={handleAddExpense}
            disabled={saving || !monto || !categoria}
            className={cn(
              'aspect-square p-0 w-10 h-10 rounded-xl text-white shrink-0',
              editingExpenseId ? 'bg-amber-500' : (isRefund ? 'bg-emerald-600' : 'bg-slate-800')
            )}
            aria-label={editingExpenseId ? 'Guardar cambios' : 'Agregar gasto'}
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
      <div>
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Movimientos</h3>
            <p className="text-[10px] text-slate-400">Toca para editar • Copia o borra desde aquí</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {gastoCount} regs
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopyAllMovements}
              aria-label="Copiar todos los movimientos"
              disabled={!expenses.length}
            >
              {copiedAllMovements ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div
            className="max-h-[520px] overflow-y-auto divide-y divide-slate-50"
            role="list"
            aria-label="Lista de gastos del viaje"
          >
            {expenses.map((exp) => {
              const Icon = categoryIcon(exp);
              const catLabel = String((resolveTripCategory(exp)?.nombre) || (exp as any)?.categoria || '');
              const desc = String((exp.descripcion || '').toString().trim());
              const fechaFmt = exp.fecha ? format(new Date(exp.fecha), 'dd MMM', { locale: es }) : '';

              const eur = Number((exp as any)?.monto_en_moneda_principal) || 0;
              const isRefundItem = eur < 0;
              const sign = isRefundItem ? '+' : '-';
              const absVal = Math.abs(eur);

              const local = Number((exp as any)?.monto_en_moneda_proyecto) || 0;
              const localAbs = Math.abs(local);

              const rowCopied = copiedMovementId === (exp.id || 'row');

              return (
                <div
                  role="listitem"
                  key={exp.id}
                  onClick={() => handleEditExpense(exp)}
                  className="p-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-brand-50 text-brand-600 p-2 rounded-lg shrink-0">
                      <Icon size={18} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{catLabel || 'Sin categoría'}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {desc ? `${desc} · ${fechaFmt}` : fechaFmt}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p
                        className={cn(
                          'text-sm font-bold',
                          isRefundItem ? 'text-emerald-700' : 'text-slate-900'
                        )}
                      >
                        {sign}€{formatLocaleNumber(absVal, 2)}
                      </p>
                      {monedaProyecto !== 'EUR' && (
                        <p className="text-[10px] text-slate-400 font-mono">
                          {sign}{formatLocaleNumber(localAbs, 0)} {monedaProyecto}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleCopyMovement(e, exp)}
                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="Copiar movimiento"
                        type="button"
                      >
                        {rowCopied ? <Check size={16} /> : <Copy size={16} />}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!exp.id) return;
                          const ok = window.confirm('¿Borrar este gasto del viaje?');
                          if (!ok) return;
                          void handleDeleteExpense(exp.id);
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="Borrar gasto"
                        type="button"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {expenses.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">Sin movimientos este viaje</div>
            )}
          </div>

          {/* Cargar más */}
          {expenses.length > 0 && hasMore && (
            <div className="p-3 border-t border-slate-50 bg-white">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full"
              >
                {loadingMore ? 'Cargando…' : 'Cargar más'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};