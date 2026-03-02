// src/pages/Trips.tsx
import React, { useState, useEffect } from 'react';
import {
  Plus,
  Map,
  Calendar,
  Moon,
  CheckCircle2,
  Plane,
  ChevronRight,
  Users,
  BedDouble,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Palette,
  Check,
  X,
  History,
  MoreVertical,
  Edit3,
  Save,
  Trash2,
  Ticket,
  Coins // Nuevo icono para moneda
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Project } from '../types';
import {
  Card,
  Button,
  Input,
  cn,
  parseYMD
} from '../components/Components';
import { PremiumSummaryCard } from '../components/PremiumSummaryCard';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { isKnownCurrencyCode } from '../data/currencyMaster';
import {
  isBefore,
  isAfter,
  isWithinInterval,
  parseISO,
  format,
  differenceInCalendarDays
} from 'date-fns';
import { es } from 'date-fns/locale';
import { subscribeToProjectsByTipo, createProject, updateProject, getCustomCurrencies } from '../services/db';

/**
 * CONFIGURACIÓN VISUAL: PALETA PREMIUM GASTAPP
 */
const TRIP_COLORS = [
  { name: 'Azul Real', hex: '#3b82f6' },
  { name: 'Esmeralda', hex: '#10b981' },
  { name: 'Ambar', hex: '#f59e0b' },
  { name: 'Rojo Coral', hex: '#ef4444' },
  { name: 'Violeta', hex: '#8b5cf6' },
  { name: 'Rosa', hex: '#ec4899' },
  { name: 'Cian', hex: '#06b6d4' },
  { name: 'Naranja', hex: '#f97316' },
];


// --- HELPERS UX ---
// Noches fuera: diferencia calendario (fin - inicio). Si falla, 0.
const computeNightsOutSafe = (startYMD: string, endYMD: string): number => {
  try {
    if (!startYMD || !endYMD) return 0;
    const start = parseISO(`${startYMD}T12:00:00`);
    const end = parseISO(`${endYMD}T12:00:00`);
    return Math.max(0, differenceInCalendarDays(end, start));
  } catch {
    return 0;
  }
};

// Regla sugerida por Diego:
// - Viajes de 7+ noches fuera: nochesHotel = nochesFuera - 2
// - Viajes de 4 a 6 noches fuera: nochesHotel = nochesFuera - 1
// - Viajes de 1 a 3 noches fuera: nochesHotel = nochesFuera
const defaultHotelNightsFromNightsOut = (nightsOut: number): number => {
  const n = Math.max(0, Math.floor(Number(nightsOut) || 0));
  if (n >= 7) return Math.max(0, n - 2);
  if (n >= 4) return Math.max(0, n - 1);
  return n;
};


export const Trips = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // --- ESTADOS DE DATOS ---
  const [trips, setTrips] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- ESTADOS DE UI ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);

  // --- ESTADOS DE FORMULARIO ---
  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    fechaInicio: format(new Date(), 'yyyy-MM-dd'),
    fechaFin: format(new Date(), 'yyyy-MM-dd'),
    presupuestoTotal: '',
    moneda: 'EUR',
    tipoCambio: '1',
    nochesHotel: '',
    personas: '2',
    color: TRIP_COLORS[Math.floor(Math.random() * TRIP_COLORS.length)].hex
  });

  // UX: nochesHotel puede ser auto-derivado desde fechas (regla por rangos)
  const [nochesHotelAuto, setNochesHotelAuto] = useState(true);

  const [isCustomCurrency, setIsCustomCurrency] = useState(false);
  const [customCurrencies, setCustomCurrencies] = useState<Array<{ code: string; name: string }>>([]);

  /**
   * SUSCRIPCIÓN REAL-TIME (vía db.ts)
   */
  useEffect(() => {
    const unsubscribe = subscribeToProjectsByTipo('viaje', (projects) => {
      const sorted = [...projects].sort((a, b) => {
        const dateA = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
        const dateB = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
        return dateB - dateA;
      });
      setTrips(sorted);
    });

    return () => unsubscribe();
  }, []);

  // AUTO-HOTEL-NIGHTS: deriva noches de hotel por defecto desde fechas, sin pisar edición manual.
  useEffect(() => {
    if (!isFormOpen) return;
    if (!form.fechaInicio || !form.fechaFin) return;

    const nightsOut = computeNightsOutSafe(form.fechaInicio, form.fechaFin);
    const computed = defaultHotelNightsFromNightsOut(nightsOut);
    const nextVal = String(computed);

    setForm((prev) => {
      const prevVal = String(prev.nochesHotel ?? '');
      const shouldAuto = nochesHotelAuto || !prevVal.trim();
      if (!shouldAuto) return prev;
      if (prevVal === nextVal) return prev;
      return { ...prev, nochesHotel: nextVal };
    });
  }, [isFormOpen, form.fechaInicio, form.fechaFin, nochesHotelAuto]);

  // Custom currencies persistidas (meta/custom_currencies)
  useEffect(() => {
    getCustomCurrencies()
      .then((items) => setCustomCurrencies(items || []))
      .catch(() => setCustomCurrencies([]));
  }, []);

  // Abrir edición desde TripDetail (navigate('/trips', { state: { editTripId } }))
  useEffect(() => {
    const state = (location.state as any) || {};
    const editTripId = state.editTripId as string | undefined;
    if (!editTripId) return;
    const found = trips.find((t) => t.id === editTripId);
    if (!found) return;
    openEditTrip(found, { scroll: false });
    // Limpia el state para que no se reabra al volver
    navigate('/trips', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);



  const usedColors = trips.map(t => t.color).filter(Boolean);

  /**
   * RESET
   */
  const resetForm = () => {
    setForm({
      nombre: '',
      descripcion: '',
      fechaInicio: format(new Date(), 'yyyy-MM-dd'),
      fechaFin: format(new Date(), 'yyyy-MM-dd'),
      presupuestoTotal: '',
      moneda: 'EUR',
      tipoCambio: '1',
      nochesHotel: '',
      personas: '2',
      color: TRIP_COLORS[Math.floor(Math.random() * TRIP_COLORS.length)].hex
    });
    setIsCustomCurrency(false);
    setNochesHotelAuto(true);
    setEditingTripId(null);
    setIsFormOpen(false);
  };

  /**
   * ACCIÓN: Preparar Formulario para Edición
   */
    const openEditTrip = (trip: Project, opts?: { scroll?: boolean }) => {
    const doScroll = opts?.scroll !== false;
    setEditingTripId(trip.id || null);

    // Detectar si la moneda es custom
    const currency = String(trip.moneda_proyecto || 'EUR').toUpperCase();
    const cset = new Set((customCurrencies || []).map((c) => String(c.code || '').toUpperCase()));
    const isCommon = isKnownCurrencyCode(currency) || cset.has(currency);

    setForm({
      nombre: trip.nombre,
      descripcion: trip.descripcion || '',
      fechaInicio: trip.fechaInicio ? format(parseISO(trip.fechaInicio), 'yyyy-MM-dd') : '',
      fechaFin: trip.fechaFin ? format(parseISO(trip.fechaFin), 'yyyy-MM-dd') : '',
      presupuestoTotal: String(trip.presupuestoTotal || (trip as any).presupuesto_total || ''),
      moneda: currency,
      tipoCambio: String(trip.tipo_cambio_referencia || 1),
      nochesHotel: String((trip as any).nochesHotel || ''),
      personas: String((trip as any).personas || '2'),
      color: trip.color || TRIP_COLORS[0].hex
    });

    setIsCustomCurrency(!isCommon);

    // UX: si el viaje ya trae nochesHotel guardado, no pisamos con auto-derivación
    const storedHotel = (trip as any).nochesHotel;
    const hasStoredHotel = storedHotel !== undefined && storedHotel !== null && String(storedHotel).trim() !== '';
    setNochesHotelAuto(!hasStoredHotel);
    setIsFormOpen(true);
    if (doScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenEdit = (e: React.MouseEvent, trip: Project) => {
    e.stopPropagation();
    openEditTrip(trip);
  };

  /**
   * ACCIÓN: Guardar
   */
  const handleSaveTrip = async () => {
    if (!form.nombre) return;

    // Validación de fechas
    const isLegacyName = form.nombre.toLowerCase().includes('cancun');
    if (!isLegacyName && (!form.fechaInicio || !form.fechaFin)) {
      alert('Por favor ingresa las fechas del viaje.');
      return;
    }

    // Validación de moneda (evita guardar vacío si el usuario eligió "OTRA" y no completó)
    if (!form.moneda || !form.moneda.trim()) {
      alert('Por favor selecciona una moneda válida (o usa OTRA).');
      return;
    }

    setLoading(true);
    try {
      const tripData: any = {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim(),
        tipo: 'viaje',
        fechaInicio: form.fechaInicio ? parseYMD(form.fechaInicio, 'noon').toISOString() : null,
        fechaFin: form.fechaFin ? parseYMD(form.fechaFin, 'noon').toISOString() : null,
        presupuestoTotal: Number(form.presupuestoTotal) || 0,

        // Configuración de moneda
        moneda_principal: 'EUR',
        moneda_proyecto: form.moneda.toUpperCase(),
        tipo_cambio_referencia: Number(form.tipoCambio) || 1,

        nochesHotel: Number(form.nochesHotel) || 0,
        personas: Number(form.personas) || 1,
        color: form.color,
        updated_at: new Date().toISOString(),
      };

      if (editingTripId) {
        await updateProject(editingTripId, tripData);
      } else {
        await createProject({
          ...tripData,
          miembros: [localStorage.getItem('currentUser') || 'Diego'],
          creado_en: new Date().toISOString(),
          estado: 'activo',
          finalizado: false,
        });
      }
      resetForm();
    } catch (e) {
      console.error('Error al procesar viaje:', e);
    } finally {
      setLoading(false);
    }
  };

  /**
   * ACCIÓN: Toggle Finalizado
   */
  const handleToggleFinish = async (e: React.MouseEvent, trip: Project) => {
  e.stopPropagation();
  if (!trip.id) return;

  const isFinalized = Boolean((trip as any).finalizado);
  const now = new Date();

  // Reabrir siempre permitido (solo confirmación)
  if (isFinalized) {
    const ok = window.confirm('¿Reabrir este viaje?');
    if (!ok) return;
  } else {
    // Validación: no permitir finalizar si no terminó según fechaFin
    if (!trip.fechaFin) {
      alert('No puedo finalizar: falta la fecha fin del viaje.');
      return;
    }
    const end = parseISO(trip.fechaFin);
    end.setHours(23, 59, 59, 999);
    if (isBefore(now, end)) {
      alert(`Aún no termina el viaje. Termina el ${format(end, 'd MMM yyyy', { locale: es })}.`);
      return;
    }
    const ok = window.confirm('¿Marcar este viaje como finalizado?');
    if (!ok) return;
  }

  setBusy(true);
  try {
    const newState = !isFinalized;
    await updateProject(trip.id, {
      finalizado: newState,
      estado: newState ? 'finalizado' : 'activo',
    });
  } catch (err) {
    console.error(err);
    alert('No se pudo actualizar el estado. Revisa consola.');
  } finally {
    setBusy(false);
  }
};


  /**
   * LÓGICA DE ESTADO
   */
  const getTripStatus = (trip: Project) => {
    if ((trip as any).finalizado) return 'finished';
    if (!trip.fechaInicio || !trip.fechaFin) return 'past';

    const now = new Date();
    const start = parseISO(trip.fechaInicio);
    const end = parseISO(trip.fechaFin);
    end.setHours(23, 59, 59);

    if (isWithinInterval(now, { start, end })) return 'current';
    if (isAfter(now, end)) return 'past';
    if (isBefore(now, start)) return 'future';
    return 'past';
  };

  const currentTrips = trips
    .filter(t => getTripStatus(t) === 'current')
    .sort((a, b) => {
      const da = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
      const db = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
      return da - db;
    });

  const futureTrips = trips
    .filter(t => getTripStatus(t) === 'future')
    .sort((a, b) => {
      const da = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
      const db = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
      return da - db;
    });

  const historyTrips = trips
    .filter(t => {
      const s = getTripStatus(t);
      return s === 'past' || s === 'finished';
    })
    .sort((a, b) => {
      const da = a.fechaFin ? new Date(a.fechaFin).getTime() : (a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0);
      const db = b.fechaFin ? new Date(b.fechaFin).getTime() : (b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0);
      return db - da;
    });

  /**
   * SUB-COMPONENTE: Wallet Card
   */
  const WalletCard = ({
  trip,
  state,
  index,
  onCardClick,
}: {
  trip: Project;
  state: 'collapsed' | 'expanded' | 'future' | 'peek';
  index?: number;
  onCardClick?: () => void;
}) => {
  const status = getTripStatus(trip);
  const isIncomplete = !trip.fechaInicio || !trip.fechaFin;

  const startDate = trip.fechaInicio ? parseISO(trip.fechaInicio) : null;
  const endDate = trip.fechaFin ? parseISO(trip.fechaFin) : null;

  const nightsOut = computeNightsOutSafe(trip.fechaInicio, trip.fechaFin);
  const hotelNights = Number((trip as any).nochesHotel || 0);

  const dateText = (() => {
    if (startDate && endDate) {
      return `${format(startDate, 'd MMM', { locale: es })} - ${format(endDate, 'd MMM', { locale: es })}`;
    }
    if (startDate && !endDate) return `Desde ${format(startDate, 'd MMM', { locale: es })}`;
    if (!startDate && endDate) return `Hasta ${format(endDate, 'd MMM', { locale: es })}`;
    return 'Sin fechas';
  })();

  const StatusPill = () => {
    // Compacto y elegante (no protagonista). Sigue siendo clickable para toggle.
    const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border text-white/95';
    if (status === 'finished') return (
      <button
        type="button"
        onClick={(e) => handleToggleFinish(e, trip)}
        className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
        title="Toca para reabrir"
      >
        <Ticket size={10} className="opacity-90" /> Finalizado
      </button>
    );
    if (status === 'current') return (
      <button
        type="button"
        onClick={(e) => handleToggleFinish(e, trip)}
        className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
        title="Toca para finalizar"
      >
        En curso
      </button>
    );
    if (status === 'future') return (
      <button
        type="button"
        onClick={(e) => handleToggleFinish(e, trip)}
        className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
        title="Toca para finalizar (se validará por fecha fin)"
      >
        Futuro
      </button>
    );
    // past (sin finalizar)
    return (
      <button
        type="button"
        onClick={(e) => handleToggleFinish(e, trip)}
        className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
        title="Toca para finalizar"
      >
        Pasado
      </button>
    );
  };

  const onOpen = () => {
    if (onCardClick) return onCardClick();
    if (!trip.id) return;
    navigate(`/trips/${trip.id}`);
  };

  return (
    <PremiumSummaryCard
      accentColor={trip.color || '#3b82f6'}
      onClick={onOpen}
      backgroundFilter="none"
      layout="compact"
      className="min-h-[82px]"
      contentClassName="p-3.5"
      watermark={
        <div className="absolute right-0 top-0 opacity-[0.06]">
          <Plane
            size={110}
            className="text-white transform -rotate-12 translate-x-10 -translate-y-8"
          />
        </div>
      }
      title={
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="truncate">{trip.nombre}</span>
          {isIncomplete && (
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-200/30 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              Incompleto
            </span>
          )}
        </span>
      }
      rightActions={
        <div className="flex items-center gap-2">
          <StatusPill />
          <button
            type="button"
            onClick={(e) => handleOpenEdit(e, trip)}
            className="p-1 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 backdrop-blur-md active:scale-95 transition"
            title="Editar"
          >
            <Edit3 size={14} className="text-white" />
          </button>
        </div>
      }
      subtitle={
        <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-tight text-white/90">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Calendar size={12} className="opacity-90" />
            <span className="truncate">{dateText}</span>
          </span>
        </span>
      }
    />
  );
};

  return (
    <div className="p-4 pb-24 min-h-screen bg-slate-50/50 animate-revealFromCenter">

      {/* --- HEADER --- */}
      <div className="flex justify-between items-center py-2 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')} className="-ml-2 text-slate-400 hover:bg-slate-100 rounded-full">
            <ArrowLeft size={22} />
          </Button>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">Mis Viajes</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Gestión de Viajes</p>
          </div>
        </div>
        <button
          onClick={() => { editingTripId ? resetForm() : setIsFormOpen(!isFormOpen); }}
          className={cn(
            'p-3 rounded-full transition-all shadow-xl active:scale-90',
            isFormOpen ? 'bg-red-500 text-white rotate-45' : 'bg-slate-900 text-white'
          )}
        >
          {editingTripId ? <X size={22} /> : <Plus size={22} />}
        </button>
      </div>

      {/* --- FORMULARIO DESPLEGABLE --- */}
      {isFormOpen && (
        <Card className="mb-8 border-none shadow-2xl bg-white rounded-[2.5rem] overflow-hidden animate-in slide-in-from-top-6 duration-500">
          {/* HEADER */}
          <div className="px-6 pt-5 pb-3 border-b border-slate-50 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                {editingTripId ? 'Editar viaje' : 'Nuevo viaje'}
              </div>
              <div className="text-lg font-black text-slate-900 tracking-tight">
                {editingTripId ? 'Ajustes principales' : 'Configura la aventura'}
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={resetForm}
              className="text-slate-500 hover:bg-slate-100 rounded-full"
            >
              <X size={16} />
            </Button>
          </div>

          {/* PREVIEW (referencia: TripDetail sin modo privacidad) */}
          {(() => {
            const nightsOut = computeNightsOutSafe(form.fechaInicio, form.fechaFin);
            const hotelNights = Number(form.nochesHotel || 0);
            const pax = Math.max(1, Math.floor(Number(form.personas || 2) || 2));
            const currency = (form.moneda || 'EUR').toUpperCase();
            const fx = Number(form.tipoCambio || 1) || 1;
            const fxText = currency === 'EUR' ? '1' : fx.toString();
            const startTxt = form.fechaInicio ? format(parseISO(`${form.fechaInicio}T12:00:00`), 'd MMM', { locale: es }) : '—';
            const endTxt = form.fechaFin ? format(parseISO(`${form.fechaFin}T12:00:00`), 'd MMM', { locale: es }) : '—';

            return (
              <div className="px-6 pt-4">
                <div className="relative overflow-hidden rounded-3xl border border-white/10 shadow-lg bg-gradient-to-br from-slate-800 via-slate-700 to-zinc-600 text-white">
                  <div
                    className="absolute -top-28 -right-28 h-80 w-80 rounded-full opacity-30 blur-3xl"
                    style={{ backgroundColor: form.color || '#3b82f6' }}
                  />
                  <div
                    className="absolute -bottom-28 -left-28 h-80 w-80 rounded-full opacity-20 blur-3xl"
                    style={{ backgroundColor: form.color || '#3b82f6' }}
                  />

                  <div className="relative p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-widest text-white/70">Preview</div>
                        <div
                          className="mt-1 text-2xl font-black tracking-tight text-white truncate"
                          style={{ textShadow: '0 2px 8px rgba(0,0,0,0.55)' }}
                        >
                          {form.nombre?.trim() || 'Nombre del viaje'}
                        </div>
                        <div
                          className="mt-1 text-[11px] font-bold text-white/90"
                          style={{ textShadow: '0 2px 10px rgba(0,0,0,0.55)' }}
                        >
                          {startTxt} → {endTxt}
                          <span className="text-white/40"> · </span>
                          {nightsOut} noche{nightsOut === 1 ? '' : 's'} fuera
                          <span className="text-white/40"> · </span>
                          {hotelNights} noche{hotelNights === 1 ? '' : 's'} hotel
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="px-3 py-1.5 rounded-2xl bg-black/15 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/90">
                          {pax} pax
                        </div>
                        <div className="px-3 py-1.5 rounded-2xl bg-black/15 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/90">
                          {currency}{currency === 'EUR' ? '' : ` · 1€=${fxText}`}
                        </div>
                      </div>
                    </div>

                    {/* Modo AUTO (solo visual) */}
                    {nochesHotelAuto && (
                      <div className="mt-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-[9px] font-black uppercase tracking-widest text-white">
                          <Check size={12} /> AUTO noches hotel
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* FORM (menos "secciones", más flujo) */}
          <div className="px-6 py-5">
            <div className="space-y-4">
              {/* Nombre */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 tracking-widest">Nombre</label>
                <Input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="bg-white border border-slate-100 font-semibold text-slate-800 h-11 rounded-xl"
                  placeholder="Ej: Cancún 2026"
                />
              </div>

              {/* Color */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 flex items-center gap-2 tracking-widest">
                  <Palette size={12} className="text-slate-400" /> Color
                </label>
                <div className="flex flex-wrap gap-3 px-0.5">
                  {TRIP_COLORS.map((c) => {
                    const isSelected = form.color === c.hex;
                    const isUsed = usedColors.includes(c.hex);
                    return (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setForm({ ...form, color: c.hex })}
                        className={cn(
                          'w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center relative',
                          isSelected
                            ? 'border-slate-900 scale-110 shadow-lg z-10'
                            : 'border-transparent opacity-80 hover:opacity-100'
                        )}
                        style={{ backgroundColor: c.hex }}
                        aria-label={`Color ${c.name}`}
                        title={c.name}
                      >
                        {isSelected && <Check size={16} className="text-white drop-shadow-md" strokeWidth={4} />}
                        {isUsed && !isSelected && (
                          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-slate-900 rounded-full border-2 border-white shadow-sm" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Fechas + métricas */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 tracking-widest">Partida</label>
                    <Input
                      type="date"
                      value={form.fechaInicio}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((prev) => {
                          const next = { ...prev, fechaInicio: v };
                          if (!prev.fechaFin || (v && prev.fechaFin < v)) next.fechaFin = v;
                          return next;
                        });
                      }}
                      className="bg-white border border-slate-100 font-semibold text-[12px] h-11 rounded-lg text-center"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 tracking-widest">Retorno</label>
                    <Input
                      type="date"
                      value={form.fechaFin}
                      min={form.fechaInicio || undefined}
                      onChange={(e) => setForm({ ...form, fechaFin: e.target.value })}
                      className="bg-white border border-slate-100 font-semibold text-[12px] h-11 rounded-lg text-center"
                    />
                  </div>
                </div>

                {form.fechaInicio && form.fechaFin && (() => {
                  const n = computeNightsOutSafe(form.fechaInicio, form.fechaFin);
                  const suggested = defaultHotelNightsFromNightsOut(n);
                  return (
                    <div className="flex items-center gap-2 px-0.5">
                      <span className="text-[10px] font-bold text-slate-500">
                        Noches fuera: <span className="font-black text-slate-700">{n}</span>
                      </span>
                      <span className="text-[10px] text-slate-300">•</span>
                      <span className="text-[10px] font-bold text-slate-500">
                        Default hotel: <span className="font-black text-slate-700">{suggested}</span>
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Pax + Noches hotel */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 flex items-center gap-1 tracking-widest">
                    <Users size={12} /> Viajeros
                  </label>
                  <Input
                    type="number"
                    value={form.personas}
                    onChange={(e) => setForm({ ...form, personas: e.target.value })}
                    className="bg-white border border-slate-100 font-semibold text-center h-11 rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 flex items-center gap-1 tracking-widest">
                    <BedDouble size={12} />
                    <span>Noches hotel</span>
                    <button
                      type="button"
                      onClick={() => setNochesHotelAuto(true)}
                      className={cn(
                        'ml-auto text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors',
                        nochesHotelAuto
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      )}
                      title="Recalcular por defecto desde fechas"
                    >
                      AUTO
                    </button>
                  </label>
                  <Input
                    type="number"
                    value={form.nochesHotel}
                    onChange={(e) => {
                      setNochesHotelAuto(false);
                      setForm({ ...form, nochesHotel: e.target.value });
                    }}
                    className="bg-white border border-slate-100 font-semibold text-center h-11 rounded-lg"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Moneda */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 flex items-center gap-1 tracking-widest">
                    <Coins size={12} /> Moneda
                  </label>
                  <CurrencyPicker
                    value={form.moneda}
                    isCustom={isCustomCurrency}
                    onToggleCustom={setIsCustomCurrency}
                    customCurrencies={customCurrencies}
                    onChange={(code) => {
                      const val = (code || '').toUpperCase();
                      setForm({ ...form, moneda: val, tipoCambio: val === 'EUR' ? '1' : form.tipoCambio });
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 tracking-widest">1 EUR = ?</label>
                  <Input
                    type="number"
                    value={form.tipoCambio}
                    onChange={(e) => setForm({ ...form, tipoCambio: e.target.value })}
                    className={cn(
                      'bg-white border border-slate-100 font-semibold text-center h-11 rounded-lg',
                      form.moneda === 'EUR' && 'opacity-50'
                    )}
                    placeholder="1"
                    disabled={form.moneda === 'EUR'}
                  />
                </div>
              </div>

              {/* Opcionales (para que no griten) */}
              <details className="group rounded-2xl bg-slate-50/60 border border-slate-100 p-3">
                <summary className="cursor-pointer list-none flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Opcional</span>
                  <span className="text-[10px] font-black text-slate-400 group-open:rotate-180 transition">▾</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 tracking-widest">Presupuesto total</label>
                    <Input
                      type="number"
                      value={form.presupuestoTotal}
                      onChange={(e) => setForm({ ...form, presupuestoTotal: e.target.value })}
                      className="bg-white border border-slate-100 font-semibold text-[13px] h-11 rounded-lg"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-0.5 tracking-widest">Notas</label>
                    <textarea
                      value={form.descripcion}
                      onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                      className="w-full bg-white border border-slate-100 font-medium text-[13px] rounded-xl p-3 text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      rows={3}
                      placeholder="Vuelos, hoteles, ideas, alertas…"
                    />
                  </div>
                </div>
              </details>

            {/* Acciones */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={resetForm}
                className="flex-1 rounded-2xl h-11 text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveTrip}
                disabled={loading || !form.nombre}
                className="flex-[1.4] h-11 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all text-white border-b-4 border-black/20"
                style={{ backgroundColor: form.color }}
              >
                {loading ? <RefreshCw className="animate-spin" size={18} /> : editingTripId ? 'Guardar' : 'Crear viaje'}
              </Button>
	            </div>
	          </div>
	        </div>
	      </Card>
      )}

      {/* --- SECCIÓN: EN CURSO --- */}
      {currentTrips.length > 0 && (
        <div className="pb-6 pt-4 mb-6">
          <div className="flex items-center gap-2 px-1 mb-4">
            <CheckCircle2 size={14} className="text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">En curso</p>
          </div>
          <div className="flex flex-col gap-4">
            {currentTrips.map((trip, idx) => (
              <WalletCard key={trip.id} trip={trip} state={idx === 0 ? 'expanded' : 'future'} />
            ))}
          </div>
        </div>
      )}

      {/* --- SECCIÓN: VIAJES FUTUROS --- */}
      {futureTrips.length > 0 && (
        <div className="pb-6 pt-4 mb-6">
          <div className="flex items-center gap-2 px-1 mb-4 opacity-60">
            <Plane size={14} className="text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">En el horizonte</p>
          </div>
          <div className="flex flex-col gap-4">
            {futureTrips.map((trip) => (
              <WalletCard key={trip.id} trip={trip} state="future" />
            ))}
          </div>
        </div>
      )}

      {/* --- EMPTY STATE (cuando solo hay historial) --- */}
      {currentTrips.length === 0 && futureTrips.length === 0 && historyTrips.length > 0 && (
        <div className="mb-10">
          <div className="p-10 text-center text-slate-300 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Map size={30} className="opacity-20" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest">Sin viajes en curso</p>
          </div>
        </div>
      )}

      {/* --- SECCIÓN: HISTORIAL --- */}
      <div className="pb-10 pt-4">
        {historyTrips.length > 0 && (
          <div className="flex items-center gap-2 px-1 mb-4">
            <History size={14} className="text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Historial</p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {historyTrips.map((trip) => (
            <WalletCard key={trip.id} trip={trip} state="collapsed" />
          ))}
        </div>
      </div>

      {/* OVERLAY DE CARGA */}
      {busy && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-300">
          <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-3">
            <RefreshCw className="animate-spin text-slate-900" size={30} />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">Sincronizando...</p>
          </div>
        </div>
      )}
    </div>
  );
};