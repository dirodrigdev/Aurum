// src/pages/OtherProjects.tsx
import React, { useState, useEffect } from 'react';
import {
  Plus,
  Shapes,
  ArrowLeft,
  Palette,
  Check,
  X,
  History,
  Edit3,
  CheckCircle2,
  Calendar,
  Coins,
  Wallet,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Project } from '../types';
import {
  Card,
  Button,
  Input,
  cn,
  parseYMD,
} from '../components/Components';
import { PremiumSummaryCard } from '../components/PremiumSummaryCard';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { isKnownCurrencyCode } from '../data/currencyMaster';
import { format, isBefore, isAfter, isWithinInterval, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { subscribeToProjectsByTipo, createProject, updateProject, deleteProject, getCustomCurrencies } from '../services/db';
import { useDataEvent } from '../hooks/useDataEvent';

// Paleta (misma gama que Viajes): más viva por defecto.
// Nota: el "look" premium lo damos con overlays/blur/titanio (no con colores apagados).
const PROJECT_COLORS = [
  { name: 'Azul Real', hex: '#3b82f6' },
  { name: 'Esmeralda', hex: '#10b981' },
  { name: 'Ambar', hex: '#f59e0b' },
  { name: 'Rojo Coral', hex: '#ef4444' },
  { name: 'Violeta', hex: '#8b5cf6' },
  { name: 'Rosa', hex: '#ec4899' },
  { name: 'Cian', hex: '#06b6d4' },
  { name: 'Naranja', hex: '#f97316' },
];


export const OtherProjects = () => {
  const navigate = useNavigate();
  const customCurrRev = useDataEvent('custom_currencies_changed');

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    moneda: 'EUR',
    tipoCambio: '1',
    presupuestoTotal: '',
    color: PROJECT_COLORS[0].hex,
    fechaInicio: format(new Date(), 'yyyy-MM-dd'),
    fechaFin: '',

    // Flags (no afectan totales; solo promedios estilo de vida)
    excludeFromAvg: false,
  });

  const [isCustomCurrency, setIsCustomCurrency] = useState(false);
  const [customCurrencies, setCustomCurrencies] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    const unsubscribe = subscribeToProjectsByTipo('proyecto', (items) => {
      const sorted = [...items].sort((a, b) => {
        const af = (a as any).finalizado ? 1 : 0;
        const bf = (b as any).finalizado ? 1 : 0;
        return af - bf;
      });
      setProjects(sorted);
    });

    return () => unsubscribe();
  }, []);

  // Custom currencies persistidas (meta/custom_currencies)
  useEffect(() => {
    getCustomCurrencies()
      .then((items) => setCustomCurrencies(items || []))
      .catch(() => setCustomCurrencies([]));
  }, [customCurrRev]);


  const resetForm = () => {
    setForm({
      nombre: '',
      descripcion: '',
      moneda: 'EUR',
      tipoCambio: '1',
      presupuestoTotal: '',
      color: PROJECT_COLORS[0].hex,
      fechaInicio: format(new Date(), 'yyyy-MM-dd'),
      fechaFin: '',

      excludeFromAvg: false,
    });
    setIsCustomCurrency(false);
    setEditingProjectId(null);
    setIsFormOpen(false);
  };

  const handleOpenEdit = (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    setEditingProjectId(p.id || null);

    const currency = String(p.moneda_proyecto || 'EUR').toUpperCase();
    const isCommon = isKnownCurrencyCode(currency) || customCurrencies.some((c) => String(c.code).toUpperCase() === String(currency).toUpperCase());

    setForm({
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      moneda: currency,
      tipoCambio: String(p.tipo_cambio_referencia || 1),
      presupuestoTotal: String((p as any).presupuesto_total || ''),
      color: p.color || PROJECT_COLORS[0].hex,
      fechaInicio: p.fechaInicio ? p.fechaInicio.slice(0, 10) : '',
      fechaFin: p.fechaFin ? p.fechaFin.slice(0, 10) : '',

      excludeFromAvg: Boolean((p as any).exclude_from_lifestyle_avg),
    });

    setIsCustomCurrency(!isCommon);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteProject = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    if (!window.confirm(`¿Estás seguro de eliminar el proyecto "${p.nombre}"?`)) return;

    try {
      if (p.id) await deleteProject(p.id);
    } catch (e) {
      console.error('Error al eliminar', e);
    }
  };


const handleToggleFinishProject = async (e: React.MouseEvent, project: Project) => {
  e.stopPropagation();
  if (!project.id) return;

  const isFinalized = Boolean((project as any).finalizado);
  const now = new Date();

  if (isFinalized) {
    const ok = window.confirm('¿Reabrir este proyecto?');
    if (!ok) return;
  } else {
    if (project.fechaFin) {
      const end = parseISO(project.fechaFin);
      end.setHours(23, 59, 59, 999);
      if (isBefore(now, end)) {
        alert(`Aún no termina. Termina el ${format(end, 'd MMM yyyy', { locale: es })}.`);
        return;
      }
    }
    const ok = window.confirm('¿Marcar este proyecto como finalizado?');
    if (!ok) return;
  }

  setLoading(true);
  try {
    const newState = !isFinalized;
    await updateProject(project.id, {
      finalizado: newState,
      estado: newState ? 'finalizado' : 'activo',
    });
  } catch (err) {
    console.error(err);
    alert('No se pudo actualizar el estado. Revisa consola.');
  } finally {
    setLoading(false);
  }
};

  const handleSave = async () => {
    if (!form.nombre) return;

    // Validación de moneda (evita guardar vacío si el usuario eligió "OTRA" y no completó)
    if (!form.moneda || !form.moneda.trim()) {
      alert('Por favor selecciona una moneda válida (o usa OTRA).');
      return;
    }
    setLoading(true);
    try {
      const data: any = {
        tipo: 'proyecto',
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim(),
        moneda_principal: 'EUR',
        moneda_proyecto: form.moneda.toUpperCase(),
        tipo_cambio_referencia: Number(form.tipoCambio) || 1,
        presupuesto_total: Number(form.presupuestoTotal) || 0,
        color: form.color,
        fechaInicio: form.fechaInicio ? parseYMD(form.fechaInicio, 'noon').toISOString() : null,
        fechaFin: form.fechaFin ? parseYMD(form.fechaFin, 'noon').toISOString() : null,

        // ✅ no afecta totales: solo promedios estilo de vida
        exclude_from_lifestyle_avg: Boolean((form as any).excludeFromAvg),
        updated_at: new Date().toISOString()
      };

      if (editingProjectId) {
        await updateProject(editingProjectId, data);
      } else {
        await createProject({
          ...data,
          miembros: [localStorage.getItem('currentUser') || 'Diego'],
          estado: 'activo',
          finalizado: false
        });
      }
      resetForm();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  /**
   * LÓGICA DE ESTADO (igual que Viajes)
   */
  const getProjectStatus = (p: Project) => {
    if ((p as any).finalizado) return 'finished' as const;

    const now = new Date();
    const start = p.fechaInicio ? parseISO(p.fechaInicio) : null;
    const endRaw = p.fechaFin ? parseISO(p.fechaFin) : null;
    const end = endRaw ? new Date(endRaw) : null;
    if (end) end.setHours(23, 59, 59, 999);

    if (start && end) {
      if (isWithinInterval(now, { start, end })) return 'current' as const;
      if (isAfter(now, end)) return 'past' as const;
      if (isBefore(now, start)) return 'future' as const;
      return 'past' as const;
    }

    if (start && !end) {
      if (isBefore(now, start)) return 'future' as const;
      return 'current' as const;
    }

    if (!start && end) {
      if (isAfter(now, end)) return 'past' as const;
      return 'current' as const;
    }

    // Sin fechas: se considera en curso (activo)
    return 'current' as const;
  };

  const currentProjects = projects
    .filter(p => getProjectStatus(p) === 'current')
    .sort((a, b) => {
      const da = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
      const db = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
      return da - db;
    });

  const futureProjects = projects
    .filter(p => getProjectStatus(p) === 'future')
    .sort((a, b) => {
      const da = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
      const db = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
      return da - db;
    });

  const historyProjects = projects
    .filter(p => {
      const s = getProjectStatus(p);
      return s === 'past' || s === 'finished';
    })
    .sort((a, b) => {
      const da = a.fechaFin ? new Date(a.fechaFin).getTime() : (a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0);
      const db = b.fechaFin ? new Date(b.fechaFin).getTime() : (b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0);
      return db - da;
    });

  
  // --- COMPONENTE CARD (WALLET) ---
  const ProjectCard = ({ project }: { project: Project }) => {
  const status = getProjectStatus(project);
  const isIncomplete = !project.nombre;

  const startDate = project.fechaInicio ? parseISO(project.fechaInicio) : null;
  const endDate = project.fechaFin ? parseISO(project.fechaFin) : null;

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
    const base =
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border text-white/95';
    if (status === 'finished')
      return (
        <button
          type="button"
          onClick={(e) => handleToggleFinishProject(e, project)}
          className={cn(base, 'bg-white/15 border-white/25 hover:bg-white/20')}
          title="Toca para reabrir"
        >
          <CheckCircle2 size={10} className="opacity-90" /> Finalizado
        </button>
      );
    if (status === 'current')
      return (
        <button
          type="button"
          onClick={(e) => handleToggleFinishProject(e, project)}
          className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
          title="Toca para finalizar"
        >
          En curso
        </button>
      );
    if (status === 'future')
      return (
        <button
          type="button"
          onClick={(e) => handleToggleFinishProject(e, project)}
          className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
          title="Toca para finalizar (se validará por fecha fin)"
        >
          Futuro
        </button>
      );
    return (
      <button
        type="button"
        onClick={(e) => handleToggleFinishProject(e, project)}
        className={cn(base, 'bg-white/10 border-white/20 hover:bg-white/15')}
        title="Toca para finalizar"
      >
        Pasado
      </button>
    );
  };

  const onOpen = () => {
    if (!project.id) return;
    navigate(`/other-projects/${project.id}`);
  };

  return (
    <PremiumSummaryCard
      accentColor={project.color || '#3b82f6'}
      onClick={onOpen}
      backgroundFilter="none"
      layout="compact"
      className="min-h-[82px]"
      contentClassName="p-3.5"
      watermark={
        <div className="absolute right-0 top-0 opacity-[0.06]">
          <Shapes
            size={110}
            className="text-white transform -rotate-12 translate-x-10 -translate-y-8"
          />
        </div>
      }
      title={<span className="truncate">{project.nombre}</span>}
      rightActions={
        <div className="flex items-center gap-2">
          <StatusPill />
          <button
            type="button"
            onClick={(e) => handleOpenEdit(e, project)}
            className="p-1 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 backdrop-blur-md active:scale-95 transition"
            title="Editar"
          >
            <Edit3 size={14} className="text-white" />
          </button>
        </div>
      }
      subtitle={
        <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-tight text-white/95">
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

      {/* HEADER */}
      <div className="flex justify-between items-center py-2 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')} className="-ml-2 text-slate-400 hover:bg-slate-100 rounded-full">
            <ArrowLeft size={22} />
          </Button>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">Mis Proyectos</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Gestión de Gastos</p>
          </div>
        </div>
        <button
          onClick={() => { editingProjectId ? resetForm() : setIsFormOpen(!isFormOpen); }}
          className={cn(
            'p-4 rounded-full transition-all shadow-xl active:scale-90',
            isFormOpen ? 'bg-slate-800 text-white rotate-45' : 'bg-white text-slate-800 border border-slate-200'
          )}
        >
          {editingProjectId ? <X size={24} /> : <Plus size={24} />}
        </button>
      </div>

      {/* FORMULARIO */}
      {isFormOpen && (
        <Card className="mb-8 border-none shadow-2xl bg-white rounded-[2.5rem] overflow-hidden animate-in slide-in-from-top-6">
          {/* Header */}
          <div className="p-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {editingProjectId ? 'Editar proyecto' : 'Nuevo proyecto'}
                </p>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Configura el proyecto</h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsFormOpen(false);
                }}
                className="p-2 rounded-full text-slate-400 hover:bg-slate-100 active:scale-95 transition"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="px-5">
            <PremiumSummaryCard
              accentColor={form.color || '#3b82f6'}
              backgroundFilter="none"
              size="lg"
              onClick={() => {}}
              className="mb-5 cursor-default"
              contentClassName="p-5"
              title={<span className="truncate">{form.nombre?.trim() || 'Nombre del proyecto'}</span>}
              subtitle={
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={12} className="opacity-90" />
                    <span>
                      {form.fechaInicio && form.fechaFin
                        ? `${format(parseISO(form.fechaInicio), 'd MMM', { locale: es })} → ${format(parseISO(form.fechaFin), 'd MMM', { locale: es })}`
                        : form.fechaInicio
                        ? `Desde ${format(parseISO(form.fechaInicio), 'd MMM', { locale: es })}`
                        : form.fechaFin
                        ? `Hasta ${format(parseISO(form.fechaFin), 'd MMM', { locale: es })}`
                        : 'Sin fechas'}
                    </span>
                  </span>
                  <span className="text-white/70">•</span>
                  <span className="inline-flex items-center gap-1">
                    <Coins size={12} className="opacity-90" />
                    <span className="font-black">{(form.moneda || 'EUR').toUpperCase()}</span>
                  </span>
                </span>
              }
              rightActions={
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-[11px] font-black uppercase tracking-widest">
                    {(form.moneda || 'EUR').toUpperCase()}
                  </div>
                </div>
              }
            />
          </div>

          {/* Form */}
          <div className="px-5 pb-6 space-y-4">
            {/* Nombre */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nombre</label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className="bg-slate-50 border-none font-black text-[18px] h-12 rounded-2xl"
                placeholder="Ej: Reforma Cocina"
              />
            </div>

            {/* Color */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                  <Palette size={12} /> Color
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.hex })}
                    className={cn(
                      'w-7 h-7 rounded-full border flex items-center justify-center transition-all',
                      form.color === c.hex
                        ? 'border-slate-900 ring-2 ring-slate-900/15 scale-[1.03]'
                        : 'border-transparent opacity-70 hover:opacity-100'
                    )}
                    style={{ backgroundColor: c.hex }}
                    aria-label={c.name}
                    title={c.name}
                  >
                    {form.color === c.hex && <Check size={14} className="text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Inicio</label>
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
                  className="bg-slate-50 border-none font-bold text-xs h-11 rounded-2xl text-center"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Fin</label>
                <Input
                  type="date"
                  value={form.fechaFin}
                  min={form.fechaInicio || undefined}
                  onChange={(e) => setForm({ ...form, fechaFin: e.target.value })}
                  className="bg-slate-50 border-none font-bold text-xs h-11 rounded-2xl text-center"
                />
              </div>
            </div>

            {/* Moneda */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Moneda</label>
                <div className="relative">
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
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">1 EUR =</label>
                <Input
                  type="number"
                  value={form.tipoCambio}
                  onChange={(e) => setForm({ ...form, tipoCambio: e.target.value })}
                  className={cn(
                    'bg-slate-50 border-none font-black text-center h-11 rounded-2xl',
                    form.moneda === 'EUR' && 'opacity-50'
                  )}
                  placeholder="1"
                  disabled={form.moneda === 'EUR'}
                />
              </div>
            </div>

            {/* Opcionales */}
            <details className="group rounded-2xl bg-slate-50/70 border border-slate-100">
              <summary className="list-none cursor-pointer select-none px-4 py-3 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Opcionales</span>
                <span className="text-slate-400 group-open:rotate-180 transition">▾</span>
              </summary>
              <div className="px-4 pb-4 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Presupuesto total</label>
                  <Input
                    type="number"
                    value={form.presupuestoTotal}
                    onChange={(e) => setForm({ ...form, presupuestoTotal: e.target.value })}
                    className="bg-white border-none font-black text-[16px] h-11 rounded-2xl"
                    placeholder="0"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Notas</label>
                  <textarea
                    value={form.descripcion}
                    onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                    placeholder="Ideas, recordatorios, links…"
                    className="w-full min-h-[90px] bg-white rounded-2xl px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400/70 outline-none border border-transparent focus:border-slate-200"
                  />
                </div>
              </div>
            </details>

            {/* Extraordinario (solo afecta promedios, no totales) */}
            <div className="rounded-2xl bg-slate-50/70 border border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Extraordinario</p>
                  {(form as any).excludeFromAvg && (
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      Se excluirá de promedios de estilo de vida. Totales: igual.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean((form as any).excludeFromAvg)}
                  onClick={() => setForm((prev) => ({ ...prev, excludeFromAvg: !Boolean((prev as any).excludeFromAvg) }))}
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-all shrink-0',
                    Boolean((form as any).excludeFromAvg) ? 'bg-slate-900' : 'bg-slate-200'
                  )}
                  title={Boolean((form as any).excludeFromAvg) ? 'Excluido de promedios' : 'Incluido en promedios'}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                      Boolean((form as any).excludeFromAvg) ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-1 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsFormOpen(false);
                }}
                className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-700 font-black uppercase text-[11px] tracking-widest active:scale-[0.99] transition"
              >
                Cancelar
              </button>

              <Button
                onClick={handleSave}
                disabled={loading || !form.nombre}
                className="flex-1 py-6 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest shadow-xl"
              >
                {loading ? <RefreshCw className="animate-spin" size={20} /> : editingProjectId ? 'Guardar' : 'Crear'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      
      {/* --- SECCIÓN: EN CURSO --- */}
      {currentProjects.length > 0 && (
        <div className="pb-6 pt-4 mb-6">
          <div className="flex items-center gap-2 px-1 mb-4">
            <CheckCircle2 size={14} className="text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              En curso
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {currentProjects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}

      {/* --- SECCIÓN: EN EL HORIZONTE --- */}
      {futureProjects.length > 0 && (
        <div className="pb-6 pt-4 mb-6">
          <div className="flex items-center gap-2 px-1 mb-4 opacity-60">
            <Calendar size={14} className="text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              En el horizonte
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {futureProjects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}

      {/* --- EMPTY STATE (cuando solo hay historial) --- */}
      {currentProjects.length === 0 && futureProjects.length === 0 && historyProjects.length > 0 && (
        <div className="mb-10">
          <div className="p-10 text-center text-slate-300 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shapes size={30} className="opacity-20" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin proyectos en curso
            </p>
          </div>
        </div>
      )}

      {/* --- SECCIÓN: HISTORIAL --- */}
      <div className="pb-10 pt-4">
        {historyProjects.length > 0 && (
          <div className="flex items-center gap-2 px-1 mb-4">
            <History size={14} className="text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Historial
            </p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {historyProjects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </div>

{projects.length === 0 && !isFormOpen && (
        <div className="p-10 text-center text-slate-300 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 mx-auto mt-10">
          <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shapes size={30} className="opacity-20" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest">Sin proyectos activos</p>
        </div>
      )}
    </div>
  );
};