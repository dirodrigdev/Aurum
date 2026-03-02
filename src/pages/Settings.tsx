// src/pages/Settings.tsx
import React, { useEffect, useState, useRef } from 'react';
import {
  Layers,
  ShieldCheck,
  Download,
  Upload,
  AlertTriangle,
  FileSpreadsheet,
  Clock,
  Database,
  RefreshCw,
  Search,
  ChevronDown,
  LogOut,
  User as UserIcon,
  HardDrive,
  ListRestart,
  Lock,
  Cpu,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { doc, getDoc, updateDoc, collection, getDocs, setDoc } from 'firebase/firestore';

import { Button, Card, Input, cn } from '../components/Components';
import { CategoryBudgetsManager } from '../components/CategoryBudgetsManager';
import { calculatePeriodInfo } from '../components/Components';

import { isKnownCurrencyCode } from '../data/currencyMaster';

import {
  getClosingConfig,
  saveClosingConfig,
  getCustomCurrencies,
  upsertCustomCurrency,
  deleteCustomCurrency,
  auditProjectExpenseOrphans,
  softDeleteProjectExpenseOrphans,
  getExpensesInRangeOnce,
  forceRebuildPeriodSummary,
} from '../services/db';

import { ensureAutoCloseMissingPeriods } from '../services/periodClosing';
import { seedLegacyReportsP1P30ToFirestore } from '../services/legacyReportsP1P30';
import { archiveDuplicateMonthlyReports } from '../services/reportDedupe';
import { db, getCurrentUid } from '../services/firebase';
import { ClosingConfig, MonthlyExpense, Project, ProjectExpense, Category } from '../types';
import { emitDataEvent } from '../state/dataEvents';
import { getMaintenanceLog, markMaintenanceAction } from '../services/maintenanceLog';

// --- HELPERS TÉCNICOS ---
function normalizeCurrency(v: any) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s || s === 'XXX') return 'EUR';
  if (s === 'MEX') return 'MXN';
  return s;
}
function fmtDateSafe(v: any) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'dd/MM/yyyy');
}
function fmtNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '0,00';
}
function safe(s?: string) {
  return (s ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ').trim();
}

async function fetchColl<T>(name: string): Promise<Array<T & { id: string }>> {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

export const Settings = () => {
  const navigate = useNavigate();
  const currentUser = localStorage.getItem('currentUser');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs para "deep link" a botones de reparación (desde Diagnóstico)
  const refRebuildSummary = useRef<HTMLButtonElement>(null);
  const refCleanOrphans = useRef<HTMLButtonElement>(null);
  const refArchiveDuplicates = useRef<HTMLButtonElement>(null);

  const [closingConfig, setClosingConfig] = useState<ClosingConfig>({ tipo: 'diaFijo', diaFijo: 11 });
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [uidAllowed, setUidAllowed] = useState<boolean | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [catTab, setCatTab] = useState<'home' | 'trip'>('home');
  const categoriesRef = useRef<HTMLDivElement>(null);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Log de acciones de mantenimiento (para evitar "apretar a ciegas")
  const [maintLog, setMaintLog] = useState<any>({ actions: {} });

  // Diagnóstico guiado
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<
    | null
    | {
        generatedAt: string;
        issues: Array<{
          severity: 'info' | 'warn' | 'error';
          title: string;
          details?: string;
          actionKey?: string;
        }>;
      }
  >(null);

  // Huérfanos (project_expenses sin project)
  const [orphanAudit, setOrphanAudit] = useState<any>(null);

  // Monedas custom (persistidas en Firestore: meta/custom_currencies)
  const [customCurrencies, setCustomCurrencies] = useState<Array<{ code: string; name: string }>>([]);
  const [newCurrencyCode, setNewCurrencyCode] = useState('');
  const [newCurrencyName, setNewCurrencyName] = useState('');

  const refreshCustomCurrencies = async () => {
    try {
      const items = await getCustomCurrencies();
      setCustomCurrencies(items || []);
    } catch {
      setCustomCurrencies([]);
    }
  };

  const refreshMaintLog = async () => {
    try {
      const l = await getMaintenanceLog();
      setMaintLog(l || { actions: {} });
    } catch {
      setMaintLog({ actions: {} });
    }
  };

  const lastRunText = (key: string) => {
    const e = maintLog?.actions?.[key];
    if (!e?.lastAt) return 'Nunca ejecutado';
    const who = e?.lastBy ? ` • ${e.lastBy}` : '';
    const res = e?.lastResult ? ` • ${e.lastResult}` : '';
    return `${fmtDateSafe(e.lastAt)}${who}${res}`;
  };

  const runDiagnosis = async () => {
    setDiagRunning(true);
    try {
      const issues: Array<{ severity: 'info' | 'warn' | 'error'; title: string; details?: string; actionKey?: string }> = [];

      const closingDay = Number((closingConfig as any)?.diaFijo || 11);
      const p = calculatePeriodInfo(new Date(), closingDay);
      const periodId = `P${p.periodNumber}`;
      const startYMD = format(p.startDate, 'yyyy-MM-dd');
      const endYMD = format(p.endDate, 'yyyy-MM-dd');

      // 1) Totales del periodo: Movimientos vs period_summaries
      const all = await getExpensesInRangeOnce(startYMD, endYMD);
      const totalMov = (all || [])
        .filter((e: any) => e?.estado !== 'borrado')
        .reduce((acc: number, e: any) => acc + Number(e?.monto || 0), 0);

      const sumSnap = await getDoc(doc(db, 'period_summaries', periodId));
      const sumTotal = sumSnap.exists() ? Number((sumSnap.data() as any)?.total || 0) : null;

      if (sumTotal == null) {
        issues.push({
          severity: 'warn',
          title: 'Falta resumen del periodo (period_summaries)',
          details: `${periodId} (${startYMD} → ${endYMD})`,
          actionKey: 'rebuild_period_summary',
        });
      } else {
        const diff = Math.abs(sumTotal - totalMov);
        if (diff > 0.009) {
          issues.push({
            severity: 'error',
            title: 'Totales fantasmas: el resumen no cuadra con Movimientos',
            details: `Movimientos: ${totalMov.toFixed(2)} | Resumen: ${sumTotal.toFixed(2)} | Δ ${diff.toFixed(2)} (${periodId})`,
            actionKey: 'rebuild_period_summary',
          });
        }
      }

      // 2) Huérfanos: project_expenses sin project
      try {
        const r = await auditProjectExpenseOrphans();
        if (r?.total > 0) {
          issues.push({
            severity: 'warn',
            title: 'Hay gastos de proyecto huérfanos (ProjectExpenses sin Project)',
            details: `Total: ${r.total}`,
            actionKey: 'clean_orphans',
          });
        }
      } catch {
        issues.push({
          severity: 'info',
          title: 'No pude auditar huérfanos (falla de lectura)',
        });
      }

      // 3) Duplicados de cierres (monthly_reports)
      try {
        const r = await archiveDuplicateMonthlyReports({ dryRun: true });
        const planned = Number(r?.updatesPlanned || 0);
        if (planned > 0) {
          issues.push({
            severity: 'warn',
            title: 'Hay cierres duplicados / futuros en monthly_reports (archivables)',
            details: `Actualizaciones planificadas: ${planned} (dup: ${r.archivedDuplicates}, futuros: ${r.archivedFuture})`,
            actionKey: 'archive_duplicates',
          });
        }
      } catch {
        issues.push({
          severity: 'info',
          title: 'No pude auditar duplicados de cierres (falla de lectura)',
        });
      }

      if (issues.length === 0) {
        issues.push({ severity: 'info', title: 'Diagnóstico OK: no detecté problemas típicos ✅' });
      }

      setDiagResult({ generatedAt: new Date().toISOString(), issues });
    } catch (e) {
      console.error(e);
      setDiagResult({
        generatedAt: new Date().toISOString(),
        issues: [{ severity: 'error', title: 'Diagnóstico falló (ver consola)' }],
      });
    } finally {
      setDiagRunning(false);
    }
  };


  const actionLabel = (k?: string) => {
    switch (k) {
      case 'rebuild_period_summary':
        return 'Reconstruir resumen del periodo';
      case 'clean_orphans':
        return 'Limpiar huérfanos';
      case 'archive_duplicates':
        return 'Archivar duplicados de cierres';
      default:
        return k || 'Acción';
    }
  };

  const goToRepairButton = (k?: string) => {
    if (!k) return;

    // Mapeo: acción sugerida -> sección + botón
    const targets: Record<string, { sectionId: string; ref?: React.RefObject<HTMLButtonElement> }> = {
      rebuild_period_summary: { sectionId: 'repair_closings', ref: refRebuildSummary },
      clean_orphans: { sectionId: 'repair_integrity', ref: refCleanOrphans },
      archive_duplicates: { sectionId: 'repair_integrity', ref: refArchiveDuplicates },
    };

    const t = targets[k];
    if (!t) return;

    setOpenSection(t.sectionId);

    // Scroll al botón correcto (deja que el accordion se abra primero)
    window.setTimeout(() => {
      try {
        t.ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        t.ref?.current?.focus?.();
      } catch {}
    }, 150);
  };

  const confirmGoToRepair = (k?: string, title?: string) => {
    if (!k) return;
    const label = actionLabel(k);
    const ok = window.confirm(`Diagnóstico: ${title || label}

¿Deseas reparar ahora? Te llevaré al botón correcto.`);
    if (!ok) return;
    goToRepairButton(k);
  };

  const runSuggested = async (actionKey?: string) => {
    if (!actionKey) return;

    // Nota: estas acciones se diseñan para ser *idempotentes* (idem + potens):
    // si las ejecutas 1 vez o 10, el resultado final debería ser el mismo.
    try {
      if (actionKey === 'rebuild_period_summary') {
        const closingDay = Number((closingConfig as any)?.diaFijo || 11);
        const p = calculatePeriodInfo(new Date(), closingDay);
        const periodId = `P${p.periodNumber}`;
        const startYMD = format(p.startDate, 'yyyy-MM-dd');
        const endYMD = format(p.endDate, 'yyyy-MM-dd');

        const ok = confirm(
          `Recalcular resumen del periodo actual (${periodId})?\n\nEsto re-hace period_summaries desde Movimientos.`,
        );
        if (!ok) {
          await markMaintenanceAction({
            key: 'rebuild_period_summary',
            title: 'Recalcular resumen periodo',
            user: currentUser || undefined,
            result: 'cancelled',
          });
          return;
        }
        setBusy(true);
        await forceRebuildPeriodSummary(periodId, startYMD, endYMD);
        await markMaintenanceAction({
          key: 'rebuild_period_summary',
          title: 'Recalcular resumen periodo',
          user: currentUser || undefined,
          result: 'ok',
          message: `${periodId} ${startYMD}→${endYMD}`,
        });
        refreshMaintLog();
        alert('Resumen recalculado ✅');
        return;
      }

      if (actionKey === 'clean_orphans') {
        const r = orphanAudit || (await auditProjectExpenseOrphans());
        if (!r?.total) {
          alert('No hay huérfanos ✅');
          return;
        }
        const ok = prompt(`Se marcarán como BORRADO ${r.total} gastos huérfanos.\n\nEscribe BORRAR para confirmar:`);
        if (String(ok || '').trim().toUpperCase() !== 'BORRAR') {
          await markMaintenanceAction({
            key: 'clean_orphans',
            title: 'Limpiar huérfanos',
            user: currentUser || undefined,
            result: 'cancelled',
          });
          return;
        }
        setBusy(true);
        const res = await softDeleteProjectExpenseOrphans();
        setOrphanAudit(null);
        await markMaintenanceAction({
          key: 'clean_orphans',
          title: 'Limpiar huérfanos',
          user: currentUser || undefined,
          result: 'ok',
          message: `updated ${res.updated}/${res.toUpdate}`,
        });
        refreshMaintLog();
        alert(`Huérfanos marcados como BORRADO: ${res.updated}/${res.toUpdate} ✅`);
        return;
      }

      if (actionKey === 'archive_duplicates') {
        const ok = prompt(
          `Esto va a ARCHIVAR duplicados en /monthly_reports (no borra nada).\n\nTambién archivará cierres "futuros" (periodos que aún no han terminado).\n\nEscribe ARCHIVAR para confirmar:`,
        );
        if (String(ok || '').trim().toUpperCase() !== 'ARCHIVAR') {
          await markMaintenanceAction({
            key: 'archive_duplicates',
            title: 'Archivar duplicados monthly_reports',
            user: currentUser || undefined,
            result: 'cancelled',
          });
          return;
        }
        setBusy(true);
        const res = await archiveDuplicateMonthlyReports({ dryRun: false });
        emitDataEvent('monthly_reports_changed');
        await markMaintenanceAction({
          key: 'archive_duplicates',
          title: 'Archivar duplicados monthly_reports',
          user: currentUser || undefined,
          result: 'ok',
          message: `dup ${res.archivedDuplicates}, futuros ${res.archivedFuture}`,
        });
        refreshMaintLog();
        alert(`Listo ✅\n\nArchivados (duplicados): ${res.archivedDuplicates}\nArchivados (futuros): ${res.archivedFuture}`);
        return;
      }
    } catch (e) {
      console.error(e);
      await markMaintenanceAction({ key: actionKey, user: currentUser || undefined, result: 'error' });
      refreshMaintLog();
      alert('Error ejecutando la acción sugerida.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setFirebaseUid(getCurrentUid());
    getClosingConfig().then(setClosingConfig);
    refreshCustomCurrencies();
    refreshMaintLog();
  }, []);

  useEffect(() => {
    if (!firebaseUid) return;
    getDoc(doc(db, 'allowed_uids', firebaseUid)).then((snap) => setUidAllowed(snap.exists()));
  }, [firebaseUid]);

  // --- EXPORTACIÓN MAESTRA ---
  // Nota: algunos navegadores bloquean descargas múltiples desde un solo clic.
  // Por eso separamos en 2 acciones explícitas: Backup JSON y Excel Total (CSV).
  const handleExportJson = async () => {
    setBusy(true);
    setMsg('Preparando backup JSON...');
    try {
      const [closing, categories, reports, expenses, projects, pExpenses, periodSummaries, customCurrencyItems] =
        await Promise.all([
          getClosingConfig(),
          fetchColl<Category>('categories'),
          fetchColl<any>('monthly_reports'),
          fetchColl<MonthlyExpense>('monthly_expenses'),
          fetchColl<Project>('projects'),
          fetchColl<ProjectExpense>('project_expenses'),
          fetchColl<any>('period_summaries'),
          getCustomCurrencies(),
        ]);

      const nowStr = format(new Date(), 'yyyyMMdd_HHmm');

      // Detecta gastos con proyecto inexistente (para que el backup lo deje explícito)
      const projectIds = new Set(projects.map((p) => p.id));
      const missingProjectIds = Array.from(
        new Set(
          (pExpenses || [])
            .filter((e: any) => e?.estado !== 'borrado' && e?.proyecto_id && !projectIds.has(e.proyecto_id))
            .map((e: any) => e.proyecto_id),
        ),
      );

      const backupJson = {
        meta: {
          user: currentUser,
          date: new Date().toISOString(),
          uid: firebaseUid,
          missing_project_ids: missingProjectIds,
        },
        data: {
          closing_config: closing,
          categories,
          monthly_reports: reports,
          monthly_expenses: expenses,
          projects,
          project_expenses: pExpenses,
          period_summaries: periodSummaries,
          custom_currencies: customCurrencyItems,
        },
      };

      const bJson = new Blob([JSON.stringify(backupJson, null, 2)], { type: 'application/json' });
      const aJson = document.createElement('a');
      aJson.href = URL.createObjectURL(bJson);
      aJson.download = `GastApp_BACKUP_${nowStr}.json`;
      aJson.click();

      setMsg('Backup JSON descargado ✅');
    } catch (e) {
      console.error(e);
      setMsg('Error exportando JSON');
    } finally {
      setBusy(false);
    }
  };

  const handleExportExcelTotal = async () => {
    setBusy(true);
    setMsg('Preparando Excel Total...');
    try {
      const [_closing, _categories, _reports, expenses, projects, pExpenses] = await Promise.all([
        getClosingConfig(),
        fetchColl<Category>('categories'),
        fetchColl<any>('monthly_reports'),
        fetchColl<MonthlyExpense>('monthly_expenses'),
        fetchColl<Project>('projects'),
        fetchColl<ProjectExpense>('project_expenses'),
      ]);

      const nowStr = format(new Date(), 'yyyyMMdd_HHmm');

      let csv = 'Origen;Fecha;Categoría;Descripción;Monto_EUR;Moneda_Original;Monto_Original;Proyecto;Usuario\n';

      expenses
        .filter((e) => e.estado !== 'borrado')
        .forEach((e) => {
          const userName = safe((e.creado_por_usuario_id as any) || 'UNKNOWN');
          csv += `DIARIO;${fmtDateSafe(e.fecha)};${safe(e.categoria)};${safe(e.descripcion)};${fmtNum(
            e.monto,
          )};${normalizeCurrency(e.moneda)};${fmtNum(e.monto)};;${userName}\n`;
        });

      pExpenses
        .filter((e) => e.estado !== 'borrado')
        .forEach((e) => {
          const p = projects.find((x) => x.id === e.proyecto_id);
          const projectName = p?.nombre
            ? safe(p.nombre)
            : e.proyecto_id
              ? `[MISSING PROJECT] ${safe(e.proyecto_id)}`
              : '';
          const userName = safe((e.creado_por_usuario_id as any) || (e.creado_por as any) || 'UNKNOWN');
          csv += `PROYECTO;${fmtDateSafe(e.fecha)};${safe(e.categoria)};${safe(
            e.descripcion,
          )};${fmtNum(e.monto_en_moneda_principal)};${normalizeCurrency(
            e.moneda_original,
          )};${fmtNum(e.monto_original)};${projectName};${userName}\n`;
        });

      const bCsv = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const aCsv = document.createElement('a');
      aCsv.href = URL.createObjectURL(bCsv);
      aCsv.download = `GastApp_EXCEL_TOTAL_${nowStr}.csv`;
      aCsv.click();

      setMsg('Excel Total descargado ✅');
    } catch (e) {
      console.error(e);
      setMsg('Error exportando CSV');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !uidAllowed) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backup = JSON.parse(e.target?.result as string);
        if (!window.confirm(`¿Restaurar datos de ${backup.meta.user}? Se sobrescribirá Firestore.`)) return;
        setBusy(true);
        const {
          categories,
          monthly_expenses,
          projects,
          project_expenses,
          monthly_reports,
          closing_config,
          period_summaries,
          custom_currencies,
        } = backup.data;
        const upload = async (coll: string, items: any[]) => {
          for (const item of items || []) {
            const { id, ...data } = item;
            await setDoc(doc(db, coll, id), data);
          }
        };
        await Promise.all([
          upload('categories', categories),
          upload('monthly_expenses', monthly_expenses),
          upload('projects', projects),
          upload('project_expenses', project_expenses),
          upload('monthly_reports', monthly_reports),
          upload('period_summaries', period_summaries),
          setDoc(doc(db, 'meta', 'closing_config'), closing_config),
          setDoc(
            doc(db, 'meta', 'custom_currencies'),
            { items: custom_currencies || [], updated_at: new Date().toISOString(), version: 1 },
            { merge: true },
          ),
        ]);
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert('Error al restaurar');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
  };

  const Section = ({ id, title, icon: Icon, children, subtitle, danger }: any) => (
    <div className="space-y-2">
      <button
        onClick={() => setOpenSection(openSection === id ? null : id)}
        className={cn(
          'w-full flex items-center justify-between p-4 rounded-2xl transition-all duration-300',
          openSection === id
            ? 'bg-white border border-slate-200 shadow-md'
            : 'bg-white border border-slate-100 shadow-sm',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-2 rounded-xl transition-colors',
              openSection === id
                ? danger
                  ? 'bg-red-500 text-white'
                  : 'bg-slate-900 text-white'
                : 'bg-slate-50 text-slate-400',
            )}
          >
            <Icon size={18} />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800">{title}</p>
            {subtitle && <p className="text-[10px] text-slate-400 uppercase font-semibold">{subtitle}</p>}
          </div>
        </div>
        <ChevronDown
          size={18}
          className={cn('text-slate-300 transition-transform', openSection === id && 'rotate-180')}
        />
      </button>
      {openSection === id && <div className="px-1 py-2 animate-in fade-in slide-in-from-top-2">{children}</div>}
    </div>
  );

  return (
    <div className="p-4 space-y-6 pb-24 animate-revealFromCenter bg-slate-50/50 min-h-screen">
      {/* HEADER */}
      <div className="flex flex-col gap-1 py-2">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-900 rounded-lg text-white shadow-lg">
            <Cpu size={20} />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Settings</h1>
        </div>
        <p className="text-xs text-slate-400 font-medium ml-1">GastApp Premium • Gestión de Configuración</p>
      </div>

      {/* 1) CONFIGURACIÓN */}
      <div className="space-y-3">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Configuración</h2>

        <div ref={categoriesRef}>
          <Section
            id="catbud"
            title="Categorías y Presupuestos"
            icon={Layers}
            subtitle="Home y Viajes (fuente única)"
          >
            <Card className="p-4 space-y-4 border-slate-100 shadow-sm">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCatTab('home')}
                  className={cn(
                    'px-3 py-2 rounded-xl text-sm font-bold transition-all border',
                    catTab === 'home'
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-700 border-slate-100 hover:bg-slate-50',
                  )}
                >
                  Home
                </button>
                <button
                  onClick={() => setCatTab('trip')}
                  className={cn(
                    'px-3 py-2 rounded-xl text-sm font-bold transition-all border',
                    catTab === 'trip'
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-700 border-slate-100 hover:bg-slate-50',
                  )}
                >
                  Viajes
                </button>
              </div>

              {catTab === 'home' ? (
                <CategoryBudgetsManager scope="home" showBudget allowMaintenanceRename />
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    En Viajes se usan categorías (con ícono). Presupuestos por categoría no aplican por ahora.
                  </p>
                  <CategoryBudgetsManager scope="trip" showBudget={false} autoSuggestFromHistory />
                </div>
              )}
            </Card>
          </Section>
        </div>

        <Section id="cutoff" title="Día de corte" icon={Clock} subtitle="Afecta periodo abierto y futuros">
          <Card className="p-4 space-y-3 border-slate-100 shadow-sm">
            <div>
              <p className="text-sm font-bold text-slate-800">Día de corte</p>
              <p className="text-[10px] text-slate-500 italic">Afecta solo al periodo abierto y futuros.</p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-700">Día de corte</p>
                <p className="text-[10px] text-slate-500">(ej: 11 = 12→11)</p>
              </div>
              <Input
                type="number"
                className="w-16 text-center font-bold"
                value={closingConfig.diaFijo}
                onChange={(e) => setClosingConfig({ ...closingConfig, diaFijo: parseInt(e.target.value) })}
              />
            </div>
            <Button
              onClick={async () => {
                await saveClosingConfig(closingConfig);
                alert('Fecha actualizada.');
              }}
              className="w-full bg-slate-800 shadow-lg"
              disabled={busy || !uidAllowed}
            >
              Actualizar Fecha
            </Button>
          </Card>
        </Section>

        <Section id="currencies" title="Monedas personalizadas" icon={Database} subtitle="Cripto / custom">
          <Card className="p-4 space-y-3 border-slate-100 shadow-sm">
            <div>
              <p className="text-sm font-bold text-slate-800">Listado de monedas custom</p>
              <p className="text-[10px] text-slate-500">
                Se guardan en Firestore y aparecen en selector de moneda. Útil para cripto u otras monedas no ISO.
              </p>
            </div>

            <div className="space-y-2">
              {customCurrencies.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic">No tienes monedas custom aún.</p>
              ) : (
                <div className="space-y-2">
                  {customCurrencies
                    .slice()
                    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
                    .map((c) => (
                      <div
                        key={c.code}
                        className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-800 tracking-widest">{c.code}</p>
                          <p className="text-[10px] text-slate-500 truncate">{c.name}</p>
                        </div>
                        <Button
                          variant="ghost"
                          className="text-red-500 hover:bg-red-50 rounded-xl"
                          onClick={async () => {
                            if (!confirm(`¿Eliminar moneda custom ${c.code}?`)) return;
                            setBusy(true);
                            try {
                              await deleteCustomCurrency(c.code);
                              await refreshCustomCurrencies();
                            } catch (e) {
                              console.error(e);
                              alert('Error eliminando moneda');
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Eliminar
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-2">
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.15em]">Agregar / actualizar</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={newCurrencyCode}
                  onChange={(e) => setNewCurrencyCode(e.target.value)}
                  placeholder="Código (BTC)"
                  className="font-black uppercase"
                />
                <Input
                  value={newCurrencyName}
                  onChange={(e) => setNewCurrencyName(e.target.value)}
                  placeholder="Nombre (Bitcoin)"
                  className="font-bold"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    const code = String(newCurrencyCode || '')
                      .toUpperCase()
                      .replace(/\s+/g, '')
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 10);
                    const name = String(newCurrencyName || '').trim().replace(/\s+/g, ' ').slice(0, 60);

                    if (!code || !name) {
                      alert('Completa código y nombre');
                      return;
                    }
                    if (isKnownCurrencyCode(code)) {
                      alert(`"${code}" ya existe en ISO. Usa una moneda custom solo si NO es ISO.`);
                      return;
                    }
                    setBusy(true);
                    try {
                      await upsertCustomCurrency(code, name);
                      setNewCurrencyCode('');
                      setNewCurrencyName('');
                      await refreshCustomCurrencies();
                      alert('Moneda guardada ✅');
                    } catch (e) {
                      console.error(e);
                      alert('Error guardando moneda');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="flex-1 bg-slate-800 shadow-lg"
                  disabled={busy || !uidAllowed}
                >
                  Guardar
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await refreshCustomCurrencies();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="bg-white"
                  disabled={busy || !uidAllowed}
                >
                  Refrescar
                </Button>
              </div>
            </div>
          </Card>
        </Section>

        <Section id="user" title="Usuario" icon={UserIcon}>
          <Card className="p-4 space-y-4 border-slate-100 shadow-sm">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                  <UserIcon size={20} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Sesión</p>
                  <p className="font-bold text-slate-800">{currentUser}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  localStorage.removeItem('currentUser');
                  navigate('/onboarding');
                }}
                className="text-red-500 hover:bg-red-50 rounded-full h-10 w-10 p-0"
              >
                <LogOut size={18} />
              </Button>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[9px] text-slate-400 font-mono break-all leading-tight">
              UID: {firebaseUid}
            </div>
          </Card>
        </Section>
      </div>

      {/* 2) DATOS Y RESPALDOS */}
      <div className="space-y-3 mt-10">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Datos y respaldos</h2>
        <Section id="vault" title="Exportación" icon={Database} subtitle="Backup JSON + Excel Total">
          <Card className="bg-gradient-to-br from-slate-800 via-slate-700 to-zinc-600 p-5 border-none shadow-xl text-white text-shadow-soft space-y-4 relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-xs opacity-80 mb-4">Exporta toda tu historia en un clic o restaura una copia anterior.</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={handleExportJson}
                  disabled={busy || !uidAllowed}
                  className="bg-white text-slate-900 font-bold h-auto py-5 flex-col gap-1 shadow-lg active:scale-95 transition-transform"
                >
                  <Download size={20} /> <span className="text-[10px]">Backup total (JSON)</span>
                </Button>
                <Button
                  onClick={handleExportExcelTotal}
                  disabled={busy || !uidAllowed}
                  className="bg-white text-slate-900 font-bold h-auto py-5 flex-col gap-1 shadow-lg active:scale-95 transition-transform"
                >
                  <FileSpreadsheet size={20} /> <span className="text-[10px]">CSV gigante (todo)</span>
                </Button>
              </div>
              <div className="mt-3">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || !uidAllowed}
                  className="w-full border-white/20 text-white font-bold h-auto py-4 flex-row justify-center gap-2 active:scale-95 transition-transform"
                >
                  <Upload size={18} /> <span className="text-[10px]">Restaurar JSON</span>
                </Button>
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleRestoreFile} />
            </div>
            <HardDrive className="absolute -right-4 -bottom-4 text-white/5 w-32 h-32" />
          </Card>
        </Section>
      </div>

      {/* 4) DIAGNÓSTICO Y REPARACIÓN */}
      <div className="space-y-3 mt-10">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Diagnóstico y reparación</h2>

        <Section id="diag" title="Diagnóstico" icon={ShieldCheck} subtitle="Qué botón apretar (y cuál NO)">
          <Card className="p-4 space-y-3 border-slate-100 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">Diagnóstico</p>
                <p className="text-[10px] text-slate-500 italic">
                  Te dice qué botón apretar (y cuál NO). Si no hay problemas, también te lo dice.
                </p>
              </div>
              <Button variant="outline" className="h-8 px-3 text-xs" disabled={busy || diagRunning} onClick={runDiagnosis}>
                {diagRunning ? 'Analizando…' : 'Ejecutar'}
              </Button>
            </div>

            {diagResult && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400">Último diagnóstico: {fmtDateSafe(diagResult.generatedAt)}</p>
                <div className="space-y-2">
                  {diagResult.issues.map((it, idx) => {
                    const tone =
                      it.severity === 'error'
                        ? 'border-red-100 bg-red-50/30'
                        : it.severity === 'warn'
                          ? 'border-amber-100 bg-amber-50/30'
                          : 'border-slate-100 bg-slate-50/30';
                    const titleTone =
                      it.severity === 'error'
                        ? 'text-red-700'
                        : it.severity === 'warn'
                          ? 'text-amber-800'
                          : 'text-slate-700';
                    return (
                      <div key={idx} className={cn('rounded-xl border p-3 flex items-start justify-between gap-3', tone)}>
                        <div>
                          <p className={cn('text-[11px] font-black', titleTone)}>{it.title}</p>
                          {it.details && <p className="text-[10px] text-slate-600 mt-1">{it.details}</p>}
                          {it.actionKey && (
                            <p className="text-[10px] text-slate-500 mt-2">Acción sugerida: {actionLabel(it.actionKey)}</p>
                          )}
                        </div>
                        {it.actionKey && (
                          <Button variant="outline" className="h-8 px-3 text-xs" disabled={busy} onClick={() => confirmGoToRepair(it.actionKey, it.title)}>
                            Reparar
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </Section>

        <Section id="repair_closings" title="Cierres" icon={Lock} subtitle="Cerrar, sincronizar y alinear periodos">
          <Card className="p-4 space-y-3 border-slate-100 shadow-sm">
            <div>
              <p className="text-sm font-bold text-slate-800">Cierres</p>
              <p className="text-[10px] text-slate-500 italic">
                Herramientas para alinear periodos y cierres si algo quedó a medias.
              </p>
            </div>

            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm('¿Sincronizar cierres pendientes?')) return;
                setBusy(true);
                try {
                  await ensureAutoCloseMissingPeriods();
                  await markMaintenanceAction({
                    key: 'sync_close_missing_periods',
                    title: 'Sincronizar cierres olvidados',
                    user: currentUser || undefined,
                    result: 'ok',
                  });
                  refreshMaintLog();
                  alert('Sincronización completa.');
                } catch (e) {
                  console.error(e);
                  await markMaintenanceAction({
                    key: 'sync_close_missing_periods',
                    title: 'Sincronizar cierres olvidados',
                    user: currentUser || undefined,
                    result: 'error',
                  });
                  refreshMaintLog();
                  alert('Error sincronizando cierres.');
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full justify-start gap-3 border-slate-200 text-slate-700 h-auto py-4 bg-white"
            >
              <ListRestart size={18} className="text-blue-500" />
              <div className="text-left">
                <p className="text-xs font-bold">Sincronizar cierres olvidados</p>
                <p className="text-[9px] opacity-70">Detecta meses vencidos y los cierra automáticamente.</p>
              </div>
            </Button>
            <p className="text-[10px] text-slate-400 -mt-2 px-1">Último uso: {lastRunText('sync_close_missing_periods')}</p>

            <Button
              ref={refRebuildSummary}
              variant="outline"
              onClick={async () => {
                const closingDay = Number((closingConfig as any)?.diaFijo || 11);
                const p = calculatePeriodInfo(new Date(), closingDay);
                const periodId = `P${p.periodNumber}`;
                const startYMD = format(p.startDate, 'yyyy-MM-dd');
                const endYMD = format(p.endDate, 'yyyy-MM-dd');

                if (
                  !confirm(
                    `¿Reconstruir el resumen del periodo actual?

${periodId} (${startYMD} → ${endYMD})

Esto recalcula period_summaries desde Movimientos (no borra movimientos).`,
                  )
                )
                  return;

                setBusy(true);
                try {
                  await forceRebuildPeriodSummary(periodId, startYMD, endYMD);
                  await markMaintenanceAction({
                    key: 'rebuild_period_summary',
                    title: 'Reconstruir resumen del periodo',
                    user: currentUser || undefined,
                    result: 'ok',
                  });
                  refreshMaintLog();
                  emitDataEvent('period_summaries_changed');
                  alert('Resumen reconstruido ✅');
                } catch (e) {
                  console.error(e);
                  await markMaintenanceAction({
                    key: 'rebuild_period_summary',
                    title: 'Reconstruir resumen del periodo',
                    user: currentUser || undefined,
                    result: 'error',
                  });
                  refreshMaintLog();
                  alert('Error reconstruyendo resumen.');
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full justify-start gap-3 border-slate-200 text-slate-700 h-auto py-4 bg-white"
            >
              <RefreshCw size={18} className="text-purple-500" />
              <div className="text-left">
                <p className="text-xs font-bold">Reconstruir resumen del periodo</p>
                <p className="text-[9px] opacity-70">Recalcula period_summaries del periodo actual desde Movimientos.</p>
              </div>
            </Button>
            <p className="text-[10px] text-slate-400 -mt-2 px-1">Último uso: {lastRunText('rebuild_period_summary')}</p>

            <Button
              variant="outline"
              onClick={() => navigate('/closing')}
              className="w-full justify-start gap-3 border-slate-200 text-slate-700 h-auto py-4 bg-white"
            >
              <Lock size={18} className="text-orange-500" />
              <div className="text-left">
                <p className="text-xs font-bold">Cierre mensual anticipado</p>
                <p className="text-[9px] opacity-70">Finaliza el periodo actual hoy e inicia el siguiente.</p>
              </div>
            </Button>
          </Card>
        </Section>

        <Section id="repair_currency" title="Monedas (reparación)" icon={Database} subtitle="Normaliza y limpia códigos históricos">
          <div className="space-y-3">
            <Card className="p-4 space-y-3 border-slate-100 shadow-sm">
              <div>
                <p className="text-sm font-bold text-slate-800">Monedas</p>
                <p className="text-[10px] text-slate-500 italic">
                  Mantenimiento de códigos (normaliza, corrige y limpia). Son acciones diseñadas para ser idempotentes (idem +
                  potens).
                </p>
              </div>

              <Button
                variant="outline"
                onClick={async () => {
                  if (!confirm('¿Reparar monedas? (XXX/vacío → EUR + normalizar mayúsculas, incluye gastos diarios)')) {
                    await markMaintenanceAction({
                      key: 'currency_repair',
                      title: 'Reparar monedas',
                      user: currentUser || undefined,
                      result: 'cancelled',
                    });
                    refreshMaintLog();
                    return;
                  }
                  setBusy(true);
                  try {
                    const [projs, exps, daily] = await Promise.all([
                      fetchColl<Project>('projects'),
                      fetchColl<ProjectExpense>('project_expenses'),
                      fetchColl<MonthlyExpense>('monthly_expenses'),
                    ]);

                    for (const p of projs) {
                      const moneda_principal = normalizeCurrency((p as any).moneda_principal);
                      const moneda_proyecto_raw = (p as any).moneda_proyecto;
                      const moneda_proyecto = moneda_proyecto_raw
                        ? String(moneda_proyecto_raw).toUpperCase()
                        : moneda_principal;

                      const patch: any = {};
                      if ((p as any).moneda_principal !== moneda_principal) patch.moneda_principal = moneda_principal;
                      if (moneda_proyecto_raw && String(moneda_proyecto_raw) !== moneda_proyecto) patch.moneda_proyecto = moneda_proyecto;
                      if (!moneda_proyecto_raw) patch.moneda_proyecto = moneda_proyecto;

                      if (Object.keys(patch).length) {
                        await updateDoc(doc(db, 'projects', p.id), patch);
                      }
                    }

                    for (const e of exps) {
                      const raw = (e as any).moneda_original;
                      const normalized = normalizeCurrency(raw);
                      if (raw !== normalized) {
                        await updateDoc(doc(db, 'project_expenses', e.id), { moneda_original: normalized });
                      }
                    }

                    for (const e of daily) {
                      const raw = (e as any).moneda;
                      const normalized = normalizeCurrency(raw);
                      if (raw !== normalized) {
                        await updateDoc(doc(db, 'monthly_expenses', e.id), { moneda: normalized });
                      }
                    }

                    await markMaintenanceAction({
                      key: 'currency_repair',
                      title: 'Reparar monedas',
                      user: currentUser || undefined,
                      result: 'ok',
                    });
                    refreshMaintLog();
                    alert('Reparación de monedas completada ✅');
                  } catch (e) {
                    console.error(e);
                    await markMaintenanceAction({
                      key: 'currency_repair',
                      title: 'Reparar monedas',
                      user: currentUser || undefined,
                      result: 'error',
                    });
                    refreshMaintLog();
                    alert('Error reparando monedas');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full justify-start gap-3 border-slate-200 text-slate-700 h-auto py-3 bg-white shadow-sm"
              >
                <Cpu size={16} /> <p className="text-xs font-bold">Reparar monedas (XXX/vacío → EUR)</p>
              </Button>
              <p className="text-[10px] text-slate-400 -mt-2 px-1">Último uso: {lastRunText('currency_repair')}</p>

              <Button
                variant="outline"
                onClick={async () => {
                  if (!confirm('¿Limpiar monedas inválidas? (Normaliza + fuerza EUR si el código no existe)')) {
                    await markMaintenanceAction({
                      key: 'currency_clean_invalid',
                      title: 'Limpiar monedas inválidas',
                      user: currentUser || undefined,
                      result: 'cancelled',
                    });
                    refreshMaintLog();
                    return;
                  }
                  setBusy(true);
                  try {
                    const [projs, exps, daily] = await Promise.all([
                      fetchColl<Project>('projects'),
                      fetchColl<ProjectExpense>('project_expenses'),
                      fetchColl<MonthlyExpense>('monthly_expenses'),
                    ]);

                    let updated = 0;
                    const bump = async (coll: string, id: string, patch: any) => {
                      await updateDoc(doc(db, coll, id), patch);
                      updated++;
                    };

                    const isKnown = (code: string) =>
                      isKnownCurrencyCode(code) || (customCurrencies || []).some((c) => c.code === code);

                    for (const p of projs) {
                      const mp_raw = (p as any).moneda_principal;
                      const mp = normalizeCurrency(mp_raw);
                      const mproj_raw = (p as any).moneda_proyecto;
                      const mproj_fixed = normalizeCurrency(mproj_raw || mp);

                      const patch: any = {};
                      if (mp_raw !== mp && isKnown(mp)) patch.moneda_principal = mp;
                      if (!isKnown(mp)) patch.moneda_principal = 'EUR';

                      if (mproj_raw && String(mproj_raw).toUpperCase() !== mproj_fixed && isKnown(mproj_fixed)) patch.moneda_proyecto = mproj_fixed;
                      if (!mproj_raw) patch.moneda_proyecto = mproj_fixed;
                      if (!isKnown(mproj_fixed)) patch.moneda_proyecto = 'EUR';

                      if (Object.keys(patch).length) await bump('projects', p.id, patch);
                    }

                    for (const e of exps as any[]) {
                      const raw = e.moneda_original;
                      const mo = normalizeCurrency(raw);
                      if (raw !== mo && isKnown(mo)) {
                        await bump('project_expenses', e.id, { moneda_original: mo });
                        continue;
                      }
                      if (!isKnown(mo)) {
                        await bump('project_expenses', e.id, { moneda_original: 'EUR' });
                      }
                    }

                    for (const e of daily as any[]) {
                      const raw = e.moneda;
                      const mo = normalizeCurrency(raw);
                      if (raw !== mo && isKnown(mo)) {
                        await bump('monthly_expenses', e.id, { moneda: mo });
                        continue;
                      }
                      if (!isKnown(mo)) {
                        await bump('monthly_expenses', e.id, { moneda: 'EUR' });
                      }
                    }

                    await markMaintenanceAction({
                      key: 'currency_clean_invalid',
                      title: 'Limpiar monedas inválidas',
                      user: currentUser || undefined,
                      result: 'ok',
                      message: `${updated} updates`,
                    });
                    refreshMaintLog();
                    alert(`Limpieza completada ✅ (${updated} docs actualizados)`);
                  } catch (e) {
                    console.error(e);
                    await markMaintenanceAction({
                      key: 'currency_clean_invalid',
                      title: 'Limpiar monedas inválidas',
                      user: currentUser || undefined,
                      result: 'error',
                    });
                    refreshMaintLog();
                    alert('Error limpiando monedas inválidas');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full justify-start gap-3 border-slate-200 text-slate-700 h-auto py-3 bg-white shadow-sm"
              >
                <Search size={16} /> <p className="text-xs font-bold">Limpiar monedas inválidas</p>
              </Button>
              <p className="text-[10px] text-slate-400 -mt-2 px-1">Último uso: {lastRunText('currency_clean_invalid')}</p>

              <Button
                variant="outline"
                onClick={async () => {
                  if (!confirm('¿Migrar MEX → MXN? (proyectos + gastos de proyectos + gastos diarios)')) {
                    await markMaintenanceAction({
                      key: 'currency_mex_to_mxn',
                      title: 'Migrar MEX → MXN',
                      user: currentUser || undefined,
                      result: 'cancelled',
                    });
                    refreshMaintLog();
                    return;
                  }
                  setBusy(true);
                  try {
                    const [projs, exps, daily] = await Promise.all([
                      fetchColl<Project>('projects'),
                      fetchColl<ProjectExpense>('project_expenses'),
                      fetchColl<MonthlyExpense>('monthly_expenses'),
                    ]);

                    let updated = 0;
                    const bump = async (coll: string, id: string, patch: any) => {
                      await updateDoc(doc(db, coll, id), patch);
                      updated++;
                    };

                    for (const p of projs) {
                      const raw = (p as any).moneda_proyecto;
                      if (!raw) continue;
                      const v = String(raw).toUpperCase();
                      if (v === 'MEX') await bump('projects', p.id, { moneda_proyecto: 'MXN' });
                    }

                    for (const e of exps) {
                      const raw = (e as any).moneda_original;
                      if (!raw) continue;
                      const v = String(raw).toUpperCase();
                      if (v === 'MEX') await bump('project_expenses', e.id, { moneda_original: 'MXN' });
                    }

                    for (const e of daily) {
                      const raw = (e as any).moneda;
                      if (!raw) continue;
                      const v = String(raw).toUpperCase();
                      if (v === 'MEX') await bump('monthly_expenses', e.id, { moneda: 'MXN' });
                    }

                    await markMaintenanceAction({
                      key: 'currency_mex_to_mxn',
                      title: 'Migrar MEX → MXN',
                      user: currentUser || undefined,
                      result: 'ok',
                      message: `${updated} updates`,
                    });
                    refreshMaintLog();
                    alert(`Migración completada ✅ (${updated} docs actualizados)`);
                  } catch (e) {
                    console.error(e);
                    await markMaintenanceAction({
                      key: 'currency_mex_to_mxn',
                      title: 'Migrar MEX → MXN',
                      user: currentUser || undefined,
                      result: 'error',
                    });
                    refreshMaintLog();
                    alert('Error migrando MEX→MXN');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full justify-start gap-3 border-slate-200 text-slate-700 h-auto py-3 bg-white shadow-sm"
              >
                <RefreshCw size={16} /> <p className="text-xs font-bold">Migrar MEX → MXN</p>
              </Button>
              <p className="text-[10px] text-slate-400 -mt-2 px-1">Último uso: {lastRunText('currency_mex_to_mxn')}</p>
            </Card>
          </div>
        </Section>

        <Section id="repair_integrity" title="Reparación avanzada" icon={Cpu} subtitle="Acciones para corregir datos cuando algo se desalineó">
          <div className="space-y-3">
            <div className="pt-4 border-t border-slate-100 mt-2">
              <button
                onClick={() => setShowDangerZone(!showDangerZone)}
                className="w-full flex items-center justify-between text-[10px] font-black text-red-500 uppercase tracking-[0.15em] px-2 py-1"
              >
                <span>Acciones de un solo uso</span>
                <ChevronDown
                  size={14}
                  className={cn('transition-transform duration-300', showDangerZone && 'rotate-180')}
                />
              </button>

              {showDangerZone && (
                <div className="mt-3 space-y-2 animate-in zoom-in-95">
                  <Card className="p-3 border-red-100 bg-red-50/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="text-red-600 mt-[2px]" />
                      <div>
                        <p className="text-[10px] font-black text-red-700">Advertencia</p>
                        <p className="text-[10px] text-slate-600">
                          Estas acciones son para limpieza/migración. Haz backup antes. Algunas no son reversibles salvo restore.
                        </p>
                      </div>
                    </div>
                  </Card>

                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!confirm('¿Reparar ProjectExpenses legacy? (completa campos faltantes como monto_original / tipo_cambio_usado / creado_por_usuario_id)'))
                        return;
                      setBusy(true);
                      try {
                        const [projs, exps] = await Promise.all([
                          fetchColl<Project>('projects'),
                          fetchColl<ProjectExpense>('project_expenses'),
                        ]);

                        const pmap = new Map<string, any>();
                        for (const p of projs) {
                          pmap.set(p.id, {
                            moneda_principal: normalizeCurrency((p as any).moneda_principal),
                            moneda_proyecto: normalizeCurrency((p as any).moneda_proyecto || (p as any).moneda_principal),
                          });
                        }

                        let updated = 0;
                        let noChange = 0;

                        for (const e0 of exps as any[]) {
                          if (e0?.estado === 'borrado') {
                            noChange++;
                            continue;
                          }

                          const p = e0?.proyecto_id ? pmap.get(e0.proyecto_id) : null;
                          const mp = normalizeCurrency(p?.moneda_principal || 'EUR');
                          const mproj = normalizeCurrency(p?.moneda_proyecto || mp);

                          const patch: any = {};

                          const moneda_original_raw = (e0 as any).moneda_original ?? mp;
                          const moneda_original = normalizeCurrency(moneda_original_raw);
                          if ((e0 as any).moneda_original !== moneda_original) patch.moneda_original = moneda_original;

                          if (!(e0 as any).creado_por_usuario_id) {
                            const v = (e0 as any).creado_por || currentUser || 'UNKNOWN';
                            patch.creado_por_usuario_id = v;
                          }

                          if ((e0 as any).monto_original == null) {
                            if (moneda_original === mproj && (e0 as any).monto_en_moneda_proyecto != null) {
                              patch.monto_original = (e0 as any).monto_en_moneda_proyecto;
                            } else if (moneda_original === mp && (e0 as any).monto_en_moneda_principal != null) {
                              patch.monto_original = (e0 as any).monto_en_moneda_principal;
                            }
                          }

                          if ((e0 as any).tipo_cambio_usado == null) {
                            if (moneda_original === mp) {
                              patch.tipo_cambio_usado = 1;
                            } else {
                              const a = Number((e0 as any).monto_en_moneda_proyecto);
                              const b = Number((e0 as any).monto_en_moneda_principal);
                              if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
                                patch.tipo_cambio_usado = a / b;
                              }
                            }
                          }

                          if (Object.keys(patch).length) {
                            await updateDoc(doc(db, 'project_expenses', (e0 as any).id), patch);
                            updated++;
                          } else {
                            noChange++;
                          }
                        }

                        alert(`Repair legacy ProjectExpenses: actualizados ${updated}, sin cambios ${noChange} ✅`);
                      } catch (e) {
                        console.error(e);
                        alert('Error reparando ProjectExpenses legacy');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full justify-start gap-3 border-red-100 text-red-700 h-auto py-3 bg-red-50/30"
                  >
                    <Cpu size={16} /> <p className="text-xs font-bold">Reparar ProjectExpenses (Legacy)</p>
                  </Button>

                  <Button
                    variant="outline"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await auditProjectExpenseOrphans();
                        setOrphanAudit(r);
                        alert(`Huérfanos detectados (ProjectExpenses sin project): ${r.total}`);
                      } catch (e) {
                        console.error(e);
                        alert('Error auditando huérfanos');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full justify-start gap-3 border-red-100 text-red-700 h-auto py-3 bg-red-50/30"
                  >
                    <Search size={16} /> <p className="text-xs font-bold">Auditar Huérfanos</p>
                  </Button>

                  <Button
                    ref={refCleanOrphans}
                    variant="outline"
                    onClick={async () => {
                      try {
                        const r = orphanAudit || (await auditProjectExpenseOrphans());
                        if (!r?.total) {
                          alert('No hay huérfanos ✅');
                          return;
                        }
                        const ok = prompt(`Se marcarán como BORRADO ${r.total} gastos huérfanos.\n\nEscribe BORRAR para confirmar:`);
                        if (String(ok || '').trim().toUpperCase() !== 'BORRAR') return;

                        setBusy(true);
                        const res = await softDeleteProjectExpenseOrphans();
                        setOrphanAudit(null);
                        alert(`Huérfanos marcados como BORRADO: ${res.updated}/${res.toUpdate} (batches: ${res.batches}) ✅`);
                      } catch (e) {
                        console.error(e);
                        alert('Error limpiando huérfanos');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full justify-start gap-3 border-red-100 text-red-700 h-auto py-3 bg-red-50/30"
                  >
                    <ListRestart size={16} /> <p className="text-xs font-bold">Limpiar Huérfanos (marcar borrado)</p>
                  </Button>

                  {orphanAudit?.total > 0 && (
                    <Card className="p-4 border-red-100 bg-red-50/20">
                      <p className="text-xs font-black text-red-700">Huérfanos detectados: {orphanAudit.total}</p>
                      <p className="text-[10px] text-slate-600 mt-1">Top IDs de proyecto faltantes (count):</p>
                      <div className="mt-2 space-y-1">
                        {(orphanAudit.byProjectId || []).slice(0, 6).map((x: any) => (
                          <p key={x.projectId} className="text-[10px] text-slate-700">
                            • <span className="font-black">{x.projectId}</span> — {x.count}
                          </p>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-600 mt-3">Muestra (hasta 5):</p>
                      <div className="mt-1 space-y-1">
                        {(orphanAudit.sample || []).slice(0, 5).map((e: any) => (
                          <p key={e.id} className="text-[10px] text-slate-700">
                            • {String(e.fecha || '').slice(0, 10)} — {String(e.descripcion || '').slice(0, 40)} —{' '}
                            {Number(e.monto_en_moneda_principal || 0).toFixed(2)} EUR
                          </p>
                        ))}
                      </div>
                    </Card>
                  )}

                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!confirm('¿Migrar Historia P1-P30?')) return;
                      setBusy(true);
                      const r = await seedLegacyReportsP1P30ToFirestore();
                      setBusy(false);
                      alert(`Migrados correctamente: ${r.saved}`);
                      emitDataEvent('monthly_reports_changed');
                    }}
                    className="w-full justify-start gap-3 border-red-100 text-red-700 h-auto py-3 bg-red-50/30"
                  >
                    <Download size={16} /> <p className="text-xs font-bold">Migrar Historia P1-P30</p>
                  </Button>

                  <Button
                    ref={refArchiveDuplicates}
                    variant="outline"
                    onClick={async () => {
                      const ok = prompt(
                        `Esto va a ARCHIVAR duplicados en /monthly_reports (no borra nada).\n\nTambién archivará cierres "futuros" (periodos que aún no han terminado).\n\nEscribe ARCHIVAR para confirmar:`,
                      );
                      if (String(ok || '').trim().toUpperCase() !== 'ARCHIVAR') return;

                      setBusy(true);
                      try {
                        const res = await archiveDuplicateMonthlyReports({ dryRun: false });
                        alert(
                          `Listo ✅\n\nTotal reports: ${res.totalReports}\nArchivados (duplicados): ${res.archivedDuplicates}\nArchivados (futuros): ${res.archivedFuture}\nYa archivados: ${res.skippedArchived}`,
                        );
                        emitDataEvent('monthly_reports_changed');
                      } catch (e) {
                        console.error(e);
                        alert('Error archivando duplicados');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full justify-start gap-3 border-red-100 text-red-700 h-auto py-3 bg-red-50/30"
                  >
                    <ListRestart size={16} /> <p className="text-xs font-bold">Archivar duplicados de cierres (monthly_reports)</p>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Section>
      </div>

      {msg && (
        <p className="text-center text-[10px] font-bold text-emerald-600 bg-emerald-50 py-2 rounded-xl border border-emerald-100 animate-pulse">
          {msg}
        </p>
      )}
    </div>
  );
};
