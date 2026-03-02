// src/pages/Projects.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button } from '../components/Components';

import { PremiumSummaryCard } from '../components/PremiumSummaryCard';
import {
  FolderKanban,
  Plane,
  Shapes,
  ChevronRight,
  Eye,
  EyeOff,
  Palmtree,   // Icono para viajes (Palmera)
  Armchair,   // Icono para muebles/proyectos
  Smartphone, // Icono para tecnología/otros
} from 'lucide-react';
import { getProjectsCached, rebuildProjectAggregates } from '../services/db';
import { Project, ProjectType } from '../types';

// Forzar punto de miles sin decimales (Ej: 13.456 €)
const formatEur = (n: number) => {
  const entero = Math.round(n).toString();
  return `€ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
};

export const Projects = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [rebuildBusy, setRebuildBusy] = useState(false);

  const [summaryHidden, setSummaryHidden] = useState<boolean>(true);
useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = await getProjectsCached();
        if (cancelled) return;
        setProjects(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const needsRebuild = useMemo(
    () =>
      projects.some(
        (p) => (p as any).gasto_total_eur === undefined || (p as any).gastos_count === undefined
      ),
    [projects]
  );

  const totals = useMemo(() => {
    const trips = projects.filter((p) => p.tipo === ProjectType.TRIP);
    const others = projects.filter((p) => p.tipo === ProjectType.PROJECT);

    const spentOf = (p: Project) => Number((p as any).gasto_total_eur) || 0;
    const countOf = (p: Project) => Number((p as any).gastos_count) || 0;

    const sum = (arr: Project[]) => arr.reduce((acc, p) => acc + spentOf(p), 0);
    const countExpenses = (arr: Project[]) => arr.reduce((acc, p) => acc + countOf(p), 0);

    const tripsTotal = sum(trips);
    const othersTotal = sum(others);

    return {
      trips,
      others,
      tripsTotal,
      othersTotal,
      total: tripsTotal + othersTotal,
      tripsExpenseCount: countExpenses(trips),
      othersExpenseCount: countExpenses(others),
    };
  }, [projects]);

  const handleRebuildTotals = async () => {
    if (rebuildBusy) return;
    const ok = window.confirm(
      'Esto recalcula los totales de Proyectos leyendo todos los gastos UNA sola vez. ¿Continuar?'
    );
    if (!ok) return;

    try {
      setRebuildBusy(true);
      await rebuildProjectAggregates();
      const p = await getProjectsCached();
      setProjects(p);
      alert('Listo: totales recalculados.');
    } catch (e: any) {
      console.error(e);
      alert('No se pudo recalcular. Revisa consola.');
    } finally {
      setRebuildBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-6 pb-24 animate-revealFromCenter">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Proyectos</h1>
          <p className="text-xs text-slate-500">Viajes + otros gastos puntuales.</p>
        </div>
      </div>

      {needsRebuild && (
        <Card className="p-4 border-amber-200 bg-amber-50/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-800">Totales de proyectos: modo rápido</p>
              <p className="text-xs text-slate-600">
                Esta pantalla ya no descarga todos los gastos. Si vienes de una versión antigua,
                presiona “Recalcular” una vez.
              </p>
            </div>
            <Button onClick={handleRebuildTotals} disabled={rebuildBusy} className="bg-slate-800">
              {rebuildBusy ? 'Recalculando…' : 'Recalcular'}
            </Button>
          </div>
        </Card>
      )}

      {/* TARJETA PRINCIPAL (COBRE) */}
      <PremiumSummaryCard
        accentColor="#f59e0b"
        className="relative overflow-hidden min-h-[150px]"
        // Queremos misma curvatura que las cards de abajo (size=md),
        // pero manteniendo presencia “hero” por la altura.
        size="md"
        title="Total proyectos"
        // No enmascaramos con puntos/guiones: dejamos el valor real y
        // lo tapamos con el mismo manto de privacidad que usa Home (Hero).
        primary={loading ? '' : formatEur(totals.total)}
        privacy={{ hidden: summaryHidden, label: 'Resumen oculto', variant: 'soft' }}
        subtitle={
          <span className="!normal-case !tracking-normal !font-medium text-white/85 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
            {totals.trips.length + totals.others.length} proyectos activos · {totals.tripsExpenseCount + totals.othersExpenseCount} movimientos
          </span>
        }
        cornerAction={
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSummaryHidden(!summaryHidden);
            }}
            className="p-2 bg-black/25 hover:bg-black/35 rounded-full text-white transition-colors backdrop-blur-xl"
            title={summaryHidden ? 'Mostrar montos' : 'Ocultar montos'}
            type="button"
          >
            {summaryHidden ? <Eye size={20} /> : <EyeOff size={20} />}
          </button>
        }

      />


      <div className="grid gap-3">
        {/* BOTON VIAJES - ESTILO SOFISTICADO */}
        <PremiumSummaryCard
        accentColor="#38bdf8"
        onClick={() => navigate('/trips')}
        className="cursor-pointer min-h-[92px]"
        watermark={
          <div className="absolute right-0 top-0 opacity-[0.06]">
            <Plane size={120} className="text-white transform -rotate-12 translate-x-10 -translate-y-8" />
          </div>
        }
        title="Viajes"
        subtitle="Tus viajes y gastos"
        rightActions={
          !summaryHidden && !loading ? (
            <div className="text-white font-black text-lg drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]">
              {formatEur(totals.tripsTotal)}
            </div>
          ) : null
        }
      />


        {/* BOTON OTROS - ESTILO SOFISTICADO */}
        <PremiumSummaryCard
        accentColor="#a78bfa"
        onClick={() => navigate('/other-projects')}
        className="cursor-pointer min-h-[92px]"
        watermark={
          <div className="absolute right-0 top-0 opacity-[0.06]">
            <Shapes size={120} className="text-white transform -rotate-12 translate-x-10 -translate-y-8" />
          </div>
        }
        title="Otros"
        subtitle="Reformas, compras, etc."
        rightActions={
          !summaryHidden && !loading ? (
            <div className="text-white font-black text-lg drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]">
              {formatEur(totals.othersTotal)}
            </div>
          ) : null
        }
      />

      </div>
    </div>
  );
};
