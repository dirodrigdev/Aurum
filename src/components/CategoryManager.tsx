import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Button, Card, Input, Select, cn, getCategoryIcon, ICON_KEYS } from './Components';
import { deleteCategory, saveCategory, subscribeToCategories } from '../services/db';
import { db } from '../services/firebase';
import { Category, Project, ProjectExpense, ProjectType } from '../types';

type Scope = 'home' | 'trip';

const DEFAULT_ICON_BY_CANONICAL: Record<string, string> = {
  Vuelos: 'Plane',
  Vuelo: 'Plane',
  Alojamiento: 'Home',
  Hotel: 'Home',
  Comida: 'Utensils',
  Transporte: 'Car',
  Actividades: 'Zap',
  Compras: 'ShoppingBag',
  Otros: 'General',
};

function stripDiacritics(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function canonicalizeTripLabel(raw: string): string {
  const s = stripDiacritics((raw || '').trim().toLowerCase());
  if (!s) return 'Otros';

  if (/(vuelo|flight|air|aereo|aéreo|avi(o|ó)n)/.test(s)) return 'Vuelos';
  if (/(hotel|aloj|hosped|airbnb|hostel|resort)/.test(s)) return 'Alojamiento';
  if (/(comida|food|rest|cena|almuerzo|desayuno|snack|bar)/.test(s)) return 'Comida';
  if (/(uber|taxi|metro|bus|tren|transp|parking|peaje|gasolina|nafta)/.test(s)) return 'Transporte';
  if (/(tour|entrada|ocio|actividad|excursion|excursi(o|ó)n|show|museo)/.test(s)) return 'Actividades';
  if (/(compr|shopping|souvenir|tienda|ropa)/.test(s)) return 'Compras';

  return 'Otros';
}

async function buildTripSuggestionsFromHistory(): Promise<Array<{ nombre: string; icono: string }>> {
  // 1) Obtén ids de proyectos tipo viaje
  const projectsSnap = await getDocs(collection(db, 'projects'));
  const tripIds = new Set<string>();
  projectsSnap.forEach((d) => {
    const p = { id: d.id, ...(d.data() as any) } as Project;
    if ((p.tipo as any) === ProjectType.TRIP || (p.tipo as any) === 'viaje') tripIds.add(d.id);
  });

  // 2) Lee gastos y cuenta categorías usadas en viajes
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

  // Fallback mínimo si no hay data (o está vacía)
  const base = sorted.length ? sorted : ['Vuelos', 'Alojamiento', 'Comida', 'Transporte', 'Actividades', 'Compras', 'Otros'];

  // Top 7 y garantizar "Otros"
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

export function CategoryManager({
  scope,
  title,
  showBudget,
  autoSuggestFromHistory,
}: {
  scope: Scope;
  title?: string;
  showBudget?: boolean;
  autoSuggestFromHistory?: boolean;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [formNombre, setFormNombre] = useState('');
  const [formIcono, setFormIcono] = useState<string>('General');
  const [formPresupuesto, setFormPresupuesto] = useState<number>(0);
  const [formActiva, setFormActiva] = useState(true);

  const budgetEnabled = showBudget ?? (scope === 'home');

  const iconOptions = useMemo(() => ICON_KEYS, []);

  useEffect(() => {
    const unsub = subscribeToCategories((data) => setCategories(data), scope);
    return () => unsub();
  }, [scope]);

  // Auto-sugerencias para Viajes (solo si aún no hay categorías definidas)
  useEffect(() => {
    if (!autoSuggestFromHistory) return;
    if (scope !== 'trip') return;
    if (seeded) return;
    if (categories.length > 0) return;

    (async () => {
      try {
        setBusy(true);
        const suggestions = await buildTripSuggestionsFromHistory();
        for (const s of suggestions) {
          await saveCategory({
            id: '',
            nombre: s.nombre,
            presupuestoMensual: 0,
            activa: true,
            icono: s.icono,
            scope: 'trip',
          });
        }
      } finally {
        setSeeded(true);
        setBusy(false);
      }
    })();
  }, [autoSuggestFromHistory, scope, seeded, categories.length]);

  const resetForm = () => {
    setFormNombre('');
    setFormIcono('General');
    setFormPresupuesto(0);
    setFormActiva(true);
  };

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setFormNombre(c.nombre || '');
    setFormIcono((c.icono as any) || 'General');
    setFormPresupuesto(Number((c as any).presupuestoMensual ?? 0));
    setFormActiva(Boolean((c as any).activa ?? true));
  };

  const cancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const submit = async () => {
    const nombre = formNombre.trim();
    if (!nombre) return;

    setBusy(true);
    try {
      await saveCategory({
        id: editingId || '',
        nombre,
        presupuestoMensual: budgetEnabled ? Number(formPresupuesto || 0) : 0,
        activa: formActiva,
        icono: formIcono || 'General',
        scope,
      } as any);
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: Category) => {
    setBusy(true);
    try {
      await saveCategory({
        ...(c as any),
        activa: !(c as any).activa,
        scope: (c as any).scope ?? 'home',
        presupuestoMensual: Number((c as any).presupuestoMensual ?? 0),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Category) => {
    const ok = window.confirm(`Eliminar la categoría "${c.nombre}"?\n\nOjo: esto no recategoriza gastos antiguos.`);
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCategory(c.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {title && <p className="text-sm font-bold text-slate-800">{title}</p>}

      <Card className="p-4 space-y-3 border-slate-100 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-500 uppercase tracking-[0.18em]">
            {editingId ? 'Editar categoría' : 'Nueva categoría'}
          </p>
          {busy && <span className="text-[11px] text-slate-400">Trabajando…</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="md:col-span-2">
            <Input
              value={formNombre}
              onChange={(e: any) => setFormNombre(e.target.value)}
              placeholder={scope === 'trip' ? 'Ej: Vuelos, Alojamiento, Comida…' : 'Ej: Supermercado, Restaurante…'}
              disabled={busy}
            />
          </div>

          <Select value={formIcono} onChange={(e: any) => setFormIcono(e.target.value)} disabled={busy} options={iconOptions.map((k) => ({ value: k, label: k }))} />

          {budgetEnabled && (
            <Input
              type="number"
              value={formPresupuesto}
              onChange={(e: any) => setFormPresupuesto(Number(e.target.value))}
              placeholder="Presupuesto mensual"
              disabled={busy}
            />
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formActiva}
              onChange={(e) => setFormActiva(e.target.checked)}
              disabled={busy}
            />
            Activa
          </label>
        </div>

        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy || !formNombre.trim()}>
            {editingId ? 'Guardar' : 'Crear'}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={cancelEdit} disabled={busy}>
              Cancelar
            </Button>
          )}
        </div>
      </Card>

      <div className="space-y-2">
        {categories.length === 0 ? (
          <Card className="p-4 border-slate-100 shadow-sm">
            <p className="text-sm text-slate-600">
              {scope === 'trip'
                ? 'Aún no tienes categorías de Viajes.'
                : 'Aún no tienes categorías.'}
            </p>
            {scope === 'trip' && autoSuggestFromHistory && (
              <p className="text-xs text-slate-400 mt-1">
                Se autogenerarán sugerencias basadas en tus gastos históricos (si existen).
              </p>
            )}
          </Card>
        ) : (
          categories.map((c) => {
            const Icon = getCategoryIcon((c as any).icono || 'General');
            return (
              <Card key={c.id} className={cn("p-3 border-slate-100 shadow-sm", (c as any).activa ? "" : "opacity-60")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-slate-50 flex items-center justify-center text-slate-600 shrink-0">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{c.nombre}</p>
                      {budgetEnabled && (
                        <p className="text-[11px] text-slate-400">
                          Presupuesto: {Number((c as any).presupuestoMensual ?? 0).toLocaleString('es-ES')} €
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" onClick={() => toggleActive(c)} disabled={busy}>
                      {(c as any).activa ? 'Desactivar' : 'Activar'}
                    </Button>
                    <Button variant="ghost" onClick={() => startEdit(c)} disabled={busy}>
                      Editar
                    </Button>
                    <Button variant="ghost" onClick={() => remove(c)} disabled={busy}>
                      Eliminar
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
