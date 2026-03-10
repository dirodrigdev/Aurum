import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Button, Card, Input } from '../components/Components';
import { ConfirmActionModal } from '../components/settings/ConfirmActionModal';
import { TypedConfirmModal } from '../components/settings/TypedConfirmModal';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import { parseStrictNumber } from '../utils/numberUtils';
import { sameCanonicalLabel } from '../utils/wealthLabels';
import {
  formatIsoDateTime as formatDateTime,
  formatMonthLabel,
  formatRateInt as formatFxInteger,
} from '../utils/wealthFormat';
import {
  loadBankTokens,
  loadClosures,
  saveClosures,
  clearCurrentMonthData,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  hydrateWealthFromCloud,
  getLastWealthSyncIssue,
  importHistoricalClosuresFromCsv,
  previewHistoricalClosuresCsv,
  loadFxLiveSyncMeta,
  loadFxRates,
  defaultFxRates,
  clearWealthDataForFreshStart,
  isRiskCapitalInvestmentLabel,
  loadInvestmentInstruments,
  loadWealthRecords,
  removeWealthRecord,
  refreshFxRatesFromLive,
  WEALTH_DATA_UPDATED_EVENT,
  saveFxRates,
  syncWealthNow,
} from '../services/wealthStorage';
import { auth, signOutUser } from '../services/firebase';
import { getFirestoreStatus } from '../services/firestoreStatus';

export const SettingsAurum: React.FC = () => {
  const buildDraftFromFx = (rates: { usdClp: number; eurClp: number; ufClp: number }) => {
    const safeUsd = Number.isFinite(rates.usdClp) && rates.usdClp > 0 ? rates.usdClp : defaultFxRates.usdClp;
    const safeEur = Number.isFinite(rates.eurClp) && rates.eurClp > 0 ? rates.eurClp : defaultFxRates.eurClp;
    const safeUf = Number.isFinite(rates.ufClp) && rates.ufClp > 0 ? rates.ufClp : defaultFxRates.ufClp;
    return {
      usdClp: String(Math.round(safeUsd)),
      eurUsd: String(safeEur / safeUsd),
      ufClp: String(Math.round(safeUf)),
    };
  };

  const [fx, setFx] = useState(() => loadFxRates());
  const [fxDraft, setFxDraft] = useState(() => buildDraftFromFx(fx));
  const [fxLiveMeta, setFxLiveMeta] = useState(() => loadFxLiveSyncMeta());
  const [fxLiveMessage, setFxLiveMessage] = useState('');
  const [syncingLiveFx, setSyncingLiveFx] = useState(false);
  const [csvDraft, setCsvDraft] = useState('');
  const [csvImportMessage, setCsvImportMessage] = useState('');
  const [csvImportWarnings, setCsvImportWarnings] = useState<string[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportedResultVisible, setCsvImportedResultVisible] = useState(false);
  const [deleteBlocksMessage, setDeleteBlocksMessage] = useState('');
  const [deletingBlocks, setDeletingBlocks] = useState(false);
  const [deleteBlocksDraft, setDeleteBlocksDraft] = useState({
    bank: false,
    investment: false,
    risk: false,
    realEstate: false,
  });
  const [authEmail, setAuthEmail] = useState('');
  const [authUid, setAuthUid] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [fsDebug, setFsDebug] = useState('');
  const [fsStatus, setFsStatus] = useState(() => getFirestoreStatus());
  const [backupMessage, setBackupMessage] = useState('');
  const [availableClosures, setAvailableClosures] = useState(() =>
    loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
  );
  const [selectedClosureToDelete, setSelectedClosureToDelete] = useState('');
  const [deleteClosureMessage, setDeleteClosureMessage] = useState('');
  const [deletingClosure, setDeletingClosure] = useState(false);
  const [allRecords, setAllRecords] = useState(() => loadWealthRecords());
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [resetStepTwoOpen, setResetStepTwoOpen] = useState(false);
  const [resetAllMessage, setResetAllMessage] = useState('');
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvConfirmOpen, setCsvConfirmOpen] = useState(false);
  const [deleteClosureConfirmOpen, setDeleteClosureConfirmOpen] = useState(false);
  const [deleteAllClosuresConfirmOpen, setDeleteAllClosuresConfirmOpen] = useState(false);
  const [deleteBlocksConfirmOpen, setDeleteBlocksConfirmOpen] = useState(false);
  const [fxFallbackDecisionOpen, setFxFallbackDecisionOpen] = useState(false);
  const [fxFallbackSavedText, setFxFallbackSavedText] = useState('');
  const syncSectionRef = useRef<HTMLDivElement | null>(null);
  const csvImportSectionRef = useRef<HTMLDetailsElement | null>(null);
  const hydrationRunningRef = useRef(false);
  const lastHydrateAtRef = useRef(0);

  const describeManualSync = (
    pushed: boolean,
    hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none',
  ) => {
    if (hydrated === 'unavailable') return 'Sin conexión con la nube';
    if (pushed && (hydrated === 'cloud' || hydrated === 'local')) return 'Sincronizado';
    return 'Error al sincronizar';
  };

  const describeLocalThenCloudSync = (
    pushed: boolean,
    hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none',
  ) => {
    if (pushed && (hydrated === 'cloud' || hydrated === 'local')) return 'Sincronizado';
    if (hydrated === 'unavailable') return 'Guardado localmente · Sin conexión con la nube';
    return 'Guardado localmente · Error al sincronizar';
  };

  const syncDraftFromFx = (rates: { usdClp: number; eurClp: number; ufClp: number }) => {
    setFxDraft(buildDraftFromFx(rates));
  };

  const downloadTextFile = (content: string, filename: string, mimeType = 'text/plain;charset=utf-8;') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    try {
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
    } finally {
      if (document.body.contains(link)) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const commitDraftFx = () => {
    const usdClp = parseStrictNumber(fxDraft.usdClp);
    const eurUsd = parseStrictNumber(fxDraft.eurUsd);
    const ufClp = parseStrictNumber(fxDraft.ufClp);
    if (![usdClp, eurUsd, ufClp].every((n) => Number.isFinite(n) && n > 0)) {
      syncDraftFromFx(fx);
      setFxLiveMessage('No pude guardar: revisa que USD/CLP, EUR/USD y UF/CLP sean mayores a 0.');
      return;
    }
    const eurClpCandidate = usdClp * eurUsd;
    const eurClp =
      Number.isFinite(fx.eurClp) &&
      fx.eurClp > 0 &&
      Math.abs(eurClpCandidate - fx.eurClp) < 1e-9 * Math.max(1, Math.abs(fx.eurClp))
        ? fx.eurClp
        : eurClpCandidate;
    const next = { usdClp, eurClp, ufClp };
    setFx(next);
    saveFxRates(next);
    syncDraftFromFx(next);
    setFxLiveMessage('Tipos de cambio guardados manualmente.');
  };

  const humanizeFxSource = (raw?: string) => {
    const source = String(raw || '').trim();
    const value = source.toLowerCase();
    if (!value) return 'Automática';

    const humanizeSingle = (item: string, indicator?: 'USD' | 'EUR' | 'UF') => {
      const v = item.trim().toLowerCase();
      if (!v) return '';
      if (v.includes('f073.tco.pre.z.d') || v.includes('bcentral.cl')) {
        return indicator ? `${indicator}: Banco Central` : 'Banco Central';
      }
      if (v.includes('valoruf')) return indicator ? `${indicator}: valoruf.cl` : 'valoruf.cl';
      if (v.includes('open.er-api.com')) return indicator ? `${indicator}: open.er-api.com` : 'open.er-api.com';
      if (v.includes('frankfurter.app')) return indicator ? `${indicator}: frankfurter.app` : 'frankfurter.app';
      return indicator ? `${indicator}: ${item.trim()}` : item.trim();
    };

    const parts: string[] = [];
    const usdMatch = source.match(/USD:([^·]+)/i);
    const ufMatch = source.match(/UF:([^·]+)/i);
    if (usdMatch?.[1]) parts.push(humanizeSingle(usdMatch[1], 'USD'));
    if (ufMatch?.[1]) parts.push(humanizeSingle(ufMatch[1], 'UF'));
    if (parts.length) return parts.join(' · ');

    return humanizeSingle(source);
  };

  const historicalCsvTemplate = `month_key,closed_at,usd_clp,eur_clp,uf_clp,sura_fin_clp,sura_prev_clp,btg_clp,planvital_clp,global66_usd,wise_usd,valor_prop_uf,saldo_deuda_uf,dividendo_uf,interes_uf,seguros_uf,amortizacion_uf,bancos_clp,bancos_usd,tarjetas_clp,tarjetas_usd
2026-01,2026-01-31T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
2026-02,2026-02-28T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
2026-03,2026-03-31T23:59:59-03:00,,,,,,,,,,,,,,,,,,,`;
  const historicalSimpleCsvTemplate = `month_key,closed_at,usd_clp,eur_clp,uf_clp,net_clp
2023-05,2023-05-31T23:59:59-04:00,,,,
2023-06,2023-06-30T23:59:59-04:00,,,,
2023-07,2023-07-31T23:59:59-04:00,,,,`;

  const deferredCsvDraft = useDeferredValue(csvDraft);
  const csvPreview = useMemo(() => previewHistoricalClosuresCsv(deferredCsvDraft), [deferredCsvDraft]);
  const csvPreviewMonthLabel =
    csvPreview.monthKeys.length === 1 ? formatMonthLabel(csvPreview.monthKeys[0]) : '';
  const monthKey = useMemo(() => currentMonthKey(), []);
  const monthRecords = useMemo(
    () => allRecords.filter((record) => String(record.snapshotDate || '').startsWith(`${monthKey}-`)),
    [allRecords, monthKey],
  );
  const historicalStatus = useMemo(() => {
    const count = availableClosures.length;
    if (!count) return { icon: '❌', tone: 'error' as const, text: 'Sin cierres guardados' };
    const hasInvalidFx = availableClosures.some((closure) => {
      const fxRates = closure.fxRates;
      if (!fxRates) return true;
      if (Array.isArray(closure.fxMissing) && closure.fxMissing.length > 0) return true;
      return !(fxRates.usdClp > 0 && fxRates.eurClp > 0 && fxRates.ufClp > 0);
    });
    if (hasInvalidFx) {
      return { icon: '⚠️', tone: 'warn' as const, text: 'Hay cierres con TC/UF incompleto' };
    }
    return { icon: '✅', tone: 'ok' as const, text: 'Cierres históricos completos' };
  }, [availableClosures]);
  const monthChecklist = useMemo(
    () => [
      {
        key: 'bank',
        label: 'Bancos',
        ok: monthRecords.some((record) => record.block === 'bank'),
      },
      {
        key: 'investment',
        label: 'Inversiones',
        ok: monthRecords.some((record) => record.block === 'investment'),
      },
      {
        key: 'risk',
        label: 'Capital de riesgo',
        ok: monthRecords.some(
          (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
        ),
      },
      {
        key: 'real-estate',
        label: 'Propiedad + hipoteca',
        ok: monthRecords.some((record) => sameCanonicalLabel(record.label, 'Valor propiedad')),
      },
      {
        key: 'fx',
        label: 'TC actual',
        ok: fx.usdClp > 0 && fx.ufClp > 0,
      },
    ],
    [monthRecords, fx],
  );

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setAuthEmail(user?.email || '');
      setAuthUid(user?.uid || '');
    });
  }, []);

  useEffect(() => {
    syncDraftFromFx(fx);
  }, [fx]);

  const refreshLocalState = () => {
    setFx(loadFxRates());
    setFxLiveMeta(loadFxLiveSyncMeta());
    setAvailableClosures(loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
    setAllRecords(loadWealthRecords());
    setFsStatus(getFirestoreStatus());
  };

  useEffect(() => {
    const HYDRATE_THROTTLE_MS = 20_000;
    const refreshFromCloudIfNeeded = async (force = false) => {
      if (hydrationRunningRef.current) return;
      const now = Date.now();
      if (!force && now - lastHydrateAtRef.current < HYDRATE_THROTTLE_MS) {
        refreshLocalState();
        return;
      }
      hydrationRunningRef.current = true;
      try {
        await hydrateWealthFromCloud();
        lastHydrateAtRef.current = Date.now();
      } finally {
        hydrationRunningRef.current = false;
      }
      refreshLocalState();
    };
    const onBottomNavRetap = (event: Event) => {
      const custom = event as CustomEvent<{ to?: string }>;
      if (custom.detail?.to !== '/settings') return;
      void refreshFromCloudIfNeeded();
    };
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshFromCloudIfNeeded();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshFromCloudIfNeeded();
    };
    const onLocalWealthChange = () => refreshLocalState();

    window.addEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(FX_RATES_UPDATED_EVENT, onLocalWealthChange as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onLocalWealthChange as EventListener);
    void refreshFromCloudIfNeeded(true);
    return () => {
      window.removeEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, onLocalWealthChange as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onLocalWealthChange as EventListener);
    };
  }, []);

  const scrollToSettingsElement = (element: HTMLElement | null) => {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToCsvImportSection = () => {
    setCsvImportOpen(true);
    window.setTimeout(() => {
      scrollToSettingsElement(csvImportSectionRef.current);
    }, 120);
  };

  const goToFxSection = () => {
    scrollToSettingsElement(syncSectionRef.current);
  };

  const navigateToPatrimonioAndScroll = (candidates: string[]) => {
    if (!window.location.hash.startsWith('#/patrimonio')) {
      window.location.hash = '#/patrimonio';
    }
    const normalized = candidates.map((value) => value.toLowerCase());
    const tryScroll = (attempt = 0) => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('section,article,div,button,a,h1,h2,h3,span,p'));
      const target = nodes.find((node) => {
        const text = String(node.textContent || '').toLowerCase();
        if (!text) return false;
        return normalized.some((candidate) => text.includes(candidate));
      });
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (attempt < 18) {
        window.setTimeout(() => tryScroll(attempt + 1), 120);
      }
    };
    window.setTimeout(() => tryScroll(0), 140);
  };

  const selectedDeleteBlocks = useMemo(
    () => Object.values(deleteBlocksDraft).filter(Boolean).length,
    [deleteBlocksDraft],
  );

  const importCsvNow = async () => {
    setCsvConfirmOpen(false);
    setCsvImporting(true);
    setCsvImportedResultVisible(false);
    setCsvImportMessage('');
    setCsvImportWarnings([]);
    try {
      const result = await importHistoricalClosuresFromCsv(csvDraft);
      const summary = [
        result.importedMonths.length ? `Importados: ${result.importedMonths.join(', ')}` : 'Importados: 0',
        result.replacedMonths.length ? `Reemplazados: ${result.replacedMonths.join(', ')}` : 'Reemplazados: 0',
        result.skippedMonths.length ? `Omitidos: ${result.skippedMonths.join(', ')}` : 'Omitidos: 0',
      ].join(' · ');
      setCsvImportMessage(summary);
      setCsvImportWarnings(result.warnings);
      setCsvImportedResultVisible(true);
      refreshLocalState();
    } catch (err: any) {
      setCsvImportMessage(String(err?.message || 'No pude importar el historial CSV.'));
      setCsvImportWarnings([]);
      setCsvImportedResultVisible(true);
    } finally {
      setCsvImporting(false);
    }
  };

  const deleteSelectedClosureNow = async () => {
    if (!selectedClosureToDelete) return;
    setDeleteClosureConfirmOpen(false);
    setDeletingClosure(true);
    setDeleteClosureMessage('');
    try {
      const current = loadClosures();
      const next = current.filter((closure) => closure.monthKey !== selectedClosureToDelete);
      saveClosures(next);
      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setSelectedClosureToDelete('');
      setDeleteClosureMessage(
        `Cierre ${selectedClosureToDelete} eliminado. ${describeLocalThenCloudSync(pushed, hydrated)}.`,
      );
    } finally {
      setDeletingClosure(false);
    }
  };

  const deleteAllClosuresNow = async () => {
    setDeleteAllClosuresConfirmOpen(false);
    setDeletingClosure(true);
    setDeleteClosureMessage('');
    try {
      saveClosures([]);
      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setSelectedClosureToDelete('');
      setDeleteClosureMessage(`Se eliminaron todos los cierres. ${describeLocalThenCloudSync(pushed, hydrated)}.`);
    } finally {
      setDeletingClosure(false);
    }
  };

  const deleteSelectedBlocksNow = async () => {
    if (!selectedDeleteBlocks) return;
    setDeleteBlocksConfirmOpen(false);
    setDeletingBlocks(true);
    setDeleteBlocksMessage('');
    try {
      const month = currentMonthKey();
      let removedRecords = 0;
      let removedInvestment = 0;
      let removedRealEstate = 0;

      if (deleteBlocksDraft.realEstate) {
        const realEstateResult = await clearCurrentMonthData({ clearRealEstate: true });
        removedRecords += realEstateResult.removedRecords;
        removedRealEstate += realEstateResult.removedRealEstate;
      }

      const monthPrefix = `${month}-`;
      const recordsAfterRealEstate = loadWealthRecords();
      const removeById = new Set<string>();
      recordsAfterRealEstate.forEach((record) => {
        if (!record.snapshotDate.startsWith(monthPrefix)) return;
        if (deleteBlocksDraft.bank && record.block === 'bank') {
          removeById.add(record.id);
          return;
        }
        if (record.block === 'investment') {
          const risk = isRiskCapitalInvestmentLabel(record.label);
          if ((deleteBlocksDraft.investment && !risk) || (deleteBlocksDraft.risk && risk)) {
            removeById.add(record.id);
          }
        }
      });

      removeById.forEach((id) => removeWealthRecord(id));
      if (removeById.size) {
        removedRecords += removeById.size;
        removedInvestment += removeById.size;
      }

      let pushed = false;
      let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
      try {
        pushed = await syncWealthNow();
      } catch {
        pushed = false;
      }
      try {
        hydrated = await hydrateWealthFromCloud();
      } catch {
        hydrated = 'none';
      }
      refreshLocalState();
      setDeleteBlocksMessage(
        removedRecords
          ? `Bloques limpiados: ${removedRecords} registros (${removedInvestment} bancos/inversiones, ${removedRealEstate} bienes raíces/hipoteca). ${describeLocalThenCloudSync(pushed, hydrated)}.`
          : 'No había registros para borrar en los bloques seleccionados.',
      );
    } finally {
      setDeletingBlocks(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <Card className="space-y-4 border border-[#d9c8ae] bg-gradient-to-br from-[#f6efe2] via-[#fbf7ef] to-white p-4">
        <div>
          <div className="text-lg font-semibold text-slate-900">Estado de tu patrimonio</div>
          <div className="text-xs text-slate-600">
            Checklist rápido para validar histórico, mes actual y datos base.
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Historial</div>
              <div className="text-xs text-slate-600">Estado de cierres históricos y calidad de TC/UF.</div>
            </div>
            <div className="text-lg leading-none">{historicalStatus.icon}</div>
          </div>
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              historicalStatus.tone === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : historicalStatus.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            Cierres guardados: <span className="font-semibold">{availableClosures.length}</span> · {historicalStatus.text}
          </div>
          <Button variant="outline" size="sm" onClick={goToCsvImportSection}>
            Ir a importar historial CSV
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 p-3 space-y-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Mes actual</div>
            <div className="text-xs text-slate-600">{formatMonthLabel(monthKey)} · estado por módulo</div>
          </div>
          <div className="space-y-2">
            {monthChecklist.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 text-sm text-slate-800">
                  <span className="text-base leading-none">{item.ok ? '✅' : '❌'}</span>
                  <span>{item.label}</span>
                </div>
                {item.key === 'fx' ? (
                  <Button variant="outline" size="sm" onClick={goToFxSection}>
                    Ir a TC
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigateToPatrimonioAndScroll(
                        item.key === 'bank'
                          ? ['bancos', 'liquidez']
                          : item.key === 'investment'
                            ? ['inversiones']
                            : item.key === 'risk'
                              ? ['riesgo on', 'riesgo off', 'capital de riesgo']
                              : ['bienes raíces', 'valor propiedad'],
                      )
                    }
                  >
                    Ir a sección
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {!!resetAllMessage && (
          <div className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-700">
            {resetAllMessage}
          </div>
        )}
      </Card>

      <Card className="border-0 bg-gradient-to-br from-[#103c35] via-[#165347] to-[#1f4a3a] p-5 text-[#f3eadb] shadow-[0_14px_30px_rgba(11,38,34,0.42)]">
        <div className="text-xs uppercase tracking-[0.22em] text-[#f3eadb]/90">Aurum Wealth</div>
        <div className="mt-1 text-2xl font-semibold">Ajustes</div>
        <div className="mt-1 text-sm text-[#e7dcc9]/95">
          Centro de configuración, respaldo y control de datos.
        </div>
      </Card>

      <div className="space-y-4">
        <Card ref={syncSectionRef} className="space-y-4 border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">Sincronización y mercado</div>
              <div className="text-xs text-slate-600">Sesión, nube y tipos de cambio.</div>
            </div>
            <div
              className={`rounded-full border px-2 py-1 text-[11px] font-medium ${
                fsStatus.state === 'ok'
                  ? 'border-emerald-200 bg-emerald-100/70 text-emerald-800'
                  : 'border-amber-200 bg-amber-100/70 text-amber-800'
              }`}
            >
              {fsStatus.state === 'ok' ? 'Firestore OK' : 'Firestore con error'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/85 p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Sesión activa</div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
              <div>
                <span className="text-slate-500">Correo:</span> {authEmail || 'Sin correo (sesión no lista)'}
              </div>
              <div className="mt-1 break-all">
                <span className="text-slate-500">UID:</span> {authUid || 'Sin UID'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  let pushed = false;
                  let hydrated: Awaited<ReturnType<typeof hydrateWealthFromCloud>> | 'none' = 'none';
                  try {
                    pushed = await syncWealthNow();
                  } catch {
                    pushed = false;
                  }
                  try {
                    hydrated = await hydrateWealthFromCloud();
                  } catch {
                    hydrated = 'none';
                  }
                  const fs = getFirestoreStatus();
                  setFsStatus(fs);
                  setSyncMessage(describeManualSync(pushed, hydrated));
                  setFsDebug(getLastWealthSyncIssue() || fs.message || '');
                }}
              >
                Sincronizar ahora
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await signOutUser();
                }}
              >
                Cerrar sesión
              </Button>
            </div>
            {!!syncMessage && (
              <div
                className={`text-xs ${
                  syncMessage.includes('Error') || syncMessage.includes('Sin conexión')
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {syncMessage}
              </div>
            )}
            {!!fsDebug && <div className="text-xs text-slate-500 break-words">Detalle Firestore: {fsDebug}</div>}
            <div className="text-[11px] text-slate-500 break-words">
              Proyecto activo (frontend): {import.meta.env.VITE_FIREBASE_PROJECT_ID || 'no definido'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/85 p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Tipos de cambio (CLP)</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={syncingLiveFx}
                onClick={async () => {
                  setSyncingLiveFx(true);
                  setFxLiveMessage('');
                  try {
                    const result = await refreshFxRatesFromLive({ force: true });
                    setFx(result.rates);
                    setFxLiveMeta(loadFxLiveSyncMeta());
                    setFxLiveMessage('');
                  } catch (err: any) {
                    setFxLiveMeta(loadFxLiveSyncMeta());
                    const currentSaved = loadFxRates();
                    setFx(currentSaved);
                    const savedText = `USD ${formatFxInteger(currentSaved.usdClp)} · EUR ${formatFxInteger(currentSaved.eurClp)} · UF ${formatFxInteger(currentSaved.ufClp)}`;
                    setFxFallbackSavedText(savedText);
                    setFxFallbackDecisionOpen(true);
                  } finally {
                    setSyncingLiveFx(false);
                  }
                }}
              >
                {syncingLiveFx ? 'Actualizando TC/UF...' : 'Actualizar TC/UF real ahora'}
              </Button>
            </div>

            {!!fxLiveMeta && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  fxLiveMeta.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                <div>
                  Estado: {fxLiveMeta.status === 'ok' ? 'OK' : 'Error'} · Fuente: {humanizeFxSource(fxLiveMeta.source)}
                </div>
                <div className="mt-0.5">Última actualización: {formatDateTime(fxLiveMeta.fetchedAt)}</div>
                {!!(fxLiveMessage || (fxLiveMeta.status === 'error' ? fxLiveMeta.message : '')) && (
                  <div className="mt-0.5 break-words">
                    {fxLiveMessage || fxLiveMeta.message}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div className="text-xs text-slate-500 mb-1">USD a CLP</div>
                <Input
                  value={fxDraft.usdClp}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    setFxDraft((prev) => ({ ...prev, usdClp: e.target.value }));
                  }}
                  onBlur={commitDraftFx}
                />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">EUR a USD</div>
                <Input
                  value={fxDraft.eurUsd}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    setFxDraft((prev) => ({ ...prev, eurUsd: e.target.value }));
                  }}
                  onBlur={commitDraftFx}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Referencia: EUR/CLP {formatFxInteger(fx.eurClp)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">UF a CLP</div>
                <Input
                  value={fxDraft.ufClp}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    setFxDraft((prev) => ({ ...prev, ufClp: e.target.value }));
                  }}
                  onBlur={commitDraftFx}
                />
              </div>
            </div>
            <div className="flex justify-start">
              <Button variant="outline" onClick={commitDraftFx}>
                Guardar TC manual
              </Button>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 border border-amber-100 bg-gradient-to-br from-amber-50/85 to-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">Respaldo e historial</div>
              <div className="text-xs text-slate-600">Backups e importación de cierres.</div>
            </div>
            <div className="rounded-full border border-amber-200 bg-amber-100/80 px-2 py-1 text-[11px] font-medium text-amber-800">
              Datos
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/85 p-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Respaldo Aurum (JSON)</div>
            <div className="text-xs text-slate-600">
              Incluye patrimonio, cierres, instrumentos, TC/UF y tokens bancarios guardados.
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  const now = new Date();
                  const pad = (v: number) => String(v).padStart(2, '0');
                  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
                  const payload = {
                    exportedAt: now.toISOString(),
                    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
                    user: {
                      email: auth.currentUser?.email || '',
                      uid: auth.currentUser?.uid || '',
                    },
                    wealth: {
                      records: loadWealthRecords(),
                      closures: loadClosures(),
                      investmentInstruments: loadInvestmentInstruments(),
                      fxRates: loadFxRates(),
                      bankTokens: loadBankTokens(),
                      fxMeta: loadFxLiveSyncMeta(),
                    },
                  };
                  const filename = `aurum_backup_${stamp}.json`;
                  downloadTextFile(JSON.stringify(payload, null, 2), filename, 'application/json');
                  setBackupMessage(`Respaldo descargado: ${filename}`);
                } catch (err: any) {
                  setBackupMessage(`No pude generar respaldo: ${String(err?.message || err || 'error')}`);
                }
              }}
            >
              Descargar respaldo ahora
            </Button>
            {!!backupMessage && <div className="text-xs text-slate-600">{backupMessage}</div>}
          </div>

          <details
            ref={csvImportSectionRef}
            open={csvImportOpen}
            onToggle={(event) => setCsvImportOpen((event.currentTarget as HTMLDetailsElement).open)}
            className="rounded-xl border border-slate-200 bg-white/85 p-3"
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
              Importar historia mensual (CSV)
            </summary>
            <div className="mt-3 space-y-3">
              <div className="text-xs text-slate-600">
                El importador reemplaza el mes si ya existe (según <code>month_key</code>).
              </div>
              {!!csvDraft.trim() && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    csvPreview.monthKeys.length === 1
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {csvPreview.monthKeys.length === 1
                    ? `Modo mensual detectado: ${csvPreviewMonthLabel} (${csvPreview.monthKeys[0]}).`
                    : `Meses detectados: ${
                        csvPreview.monthKeys.length ? csvPreview.monthKeys.join(', ') : 'ninguno válido'
                      } · filas: ${csvPreview.totalRows}.`}
                </div>
              )}
              {!!csvPreview.warnings.length && !csvImportedResultVisible && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <ul className="list-disc pl-4 space-y-0.5">
                    {csvPreview.warnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    downloadTextFile(historicalCsvTemplate, 'HISTORIAL_AURUM_TEMPLATE.csv', 'text/csv;charset=utf-8;');
                  }}
                >
                  Descargar formato completo (detalle)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    downloadTextFile(
                      historicalSimpleCsvTemplate,
                      'HISTORIAL_AURUM_SIMPLE_TEMPLATE.csv',
                      'text/csv;charset=utf-8;',
                    );
                  }}
                >
                  Descargar formato simple (solo neto)
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="text-[11px] text-slate-500 mb-1">Formatos admitidos:</div>
                <code className="block text-[11px] text-slate-700 break-all">
                  month_key,closed_at,usd_clp,eur_clp,uf_clp,sura_fin_clp,sura_prev_clp,btg_clp,planvital_clp,global66_usd,wise_usd,valor_prop_uf,saldo_deuda_uf,dividendo_uf,interes_uf,seguros_uf,amortizacion_uf,bancos_clp,bancos_usd,tarjetas_clp,tarjetas_usd
                </code>
                <div className="mt-1 text-[11px] text-slate-500">
                  Nota: si no tienes <code>eur_clp</code>, puedes enviar <code>eur_usd</code> y se calculará con <code>usd_clp</code>.
                </div>
                <code className="mt-1 block text-[11px] text-slate-700 break-all">
                  month_key,closed_at,usd_clp,eur_clp,uf_clp,net_clp
                </code>
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">Cargar archivo CSV</div>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      setCsvDraft(text);
                      setCsvImportedResultVisible(false);
                      setCsvImportMessage(`Archivo cargado: ${file.name} (${Math.round(text.length / 1024)} KB).`);
                      setCsvImportWarnings([]);
                    } catch (err: any) {
                      setCsvImportedResultVisible(false);
                      setCsvImportMessage(`No pude leer archivo CSV: ${String(err?.message || err || 'error')}`);
                      setCsvImportWarnings([]);
                    }
                    event.currentTarget.value = '';
                  }}
                />
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">O pega el CSV aquí</div>
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  rows={8}
                  placeholder="month_key,closed_at,usd_clp,..."
                  value={csvDraft}
                  onChange={(e) => {
                    setCsvImportedResultVisible(false);
                    setCsvDraft(e.target.value);
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={csvImporting}
                  onClick={async () => {
                    if (!csvDraft.trim()) {
                      setCsvImportMessage('Pega o carga un CSV antes de importar.');
                      setCsvImportWarnings([]);
                      return;
                    }
                    if (!csvPreview.monthKeys.length) {
                      setCsvImportMessage('No detecté ningún month_key válido en el CSV.');
                      setCsvImportWarnings(csvPreview.warnings);
                      return;
                    }
                    setCsvConfirmOpen(true);
                  }}
                >
                  {csvImporting ? 'Importando historial...' : 'Importar historial CSV'}
                </Button>
                <Button
                  variant="outline"
                  disabled={csvImporting}
                  onClick={() => {
                    setCsvDraft('');
                    setCsvImportedResultVisible(false);
                    setCsvImportMessage('');
                    setCsvImportWarnings([]);
                  }}
                >
                  Limpiar CSV
                </Button>
              </div>

              {!!csvImportMessage && <div className="text-xs text-slate-700">{csvImportMessage}</div>}
              {!!csvImportWarnings.length && csvImportedResultVisible && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <div className="font-medium">Advertencias de importación</div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {csvImportWarnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </Card>
      </div>

      <Card className="space-y-4 border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Laboratorio y limpieza</div>
          <div className="text-xs text-slate-600">Tres niveles de borrado con confirmación guiada.</div>
        </div>

        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-3">
          <div className="text-xs uppercase tracking-wide text-red-800 font-semibold">Nivel 1 — Reset total</div>
          <div className="text-xs text-red-700">
            Borra todos los datos de la app en local y nube. Acción de máximo impacto.
          </div>
          <Button variant="danger" onClick={() => setResetAllOpen(true)} disabled={resettingAll}>
            Resetear todos los datos
          </Button>
          {!!resetAllMessage && <div className="text-xs text-red-800">{resetAllMessage}</div>}
        </div>

        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <div className="text-xs uppercase tracking-wide text-amber-800 font-semibold">
            Nivel 2 — Borrar un cierre específico
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <select
              className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={selectedClosureToDelete}
              onChange={(event) => setSelectedClosureToDelete(event.target.value)}
            >
              <option value="">Selecciona mes de cierre para borrar...</option>
              {availableClosures.map((closure) => (
                <option key={closure.id} value={closure.monthKey}>
                  {formatMonthLabel(closure.monthKey)} ({closure.monthKey})
                </option>
              ))}
            </select>
            <Button
              variant="danger"
              disabled={deletingClosure || !selectedClosureToDelete}
              onClick={() => setDeleteClosureConfirmOpen(true)}
            >
              {deletingClosure ? 'Borrando...' : 'Borrar cierre seleccionado'}
            </Button>
          </div>
          {!!deleteClosureMessage && (
            <div
              className={`text-xs ${
                deleteClosureMessage.includes('Error') || deleteClosureMessage.includes('Sin conexión')
                  ? 'text-amber-800'
                  : 'text-emerald-700'
              }`}
            >
              {deleteClosureMessage}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-slate-800 font-semibold">
            Nivel 3 — Borrar bloque del mes actual
          </div>
          <div className="text-xs text-slate-600">
            Mes objetivo: <span className="font-medium">{formatMonthLabel(currentMonthKey())}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.bank}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, bank: event.target.checked }))
                }
              />
              Bancos
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.investment}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, investment: event.target.checked }))
                }
              />
              Inversiones
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.risk}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, risk: event.target.checked }))
                }
              />
              Capital de riesgo
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteBlocksDraft.realEstate}
                onChange={(event) =>
                  setDeleteBlocksDraft((prev) => ({ ...prev, realEstate: event.target.checked }))
                }
              />
              Propiedad + hipoteca
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={deletingBlocks || selectedDeleteBlocks === 0}
              onClick={() => setDeleteBlocksConfirmOpen(true)}
            >
              {deletingBlocks ? 'Borrando...' : 'Borrar bloques seleccionados'}
            </Button>
            <Button
              variant="outline"
              disabled={deletingClosure || !availableClosures.length}
              onClick={() => setDeleteAllClosuresConfirmOpen(true)}
            >
              Borrar todos los cierres
            </Button>
          </div>
          {!!deleteBlocksMessage && (
            <div className="text-xs text-slate-700">{deleteBlocksMessage}</div>
          )}
        </div>
      </Card>

      <ConfirmActionModal
        open={resetAllOpen}
        tone="danger"
        title="¿Estás seguro?"
        message="Esto borrará todos tus datos sin posibilidad de recuperarlos."
        confirmText="Sí, continuar"
        cancelText="Cancelar"
        onCancel={() => {
          if (resettingAll) return;
          setResetAllOpen(false);
        }}
        onConfirm={() => {
          setResetAllOpen(false);
          setResetStepTwoOpen(true);
        }}
      />

      <TypedConfirmModal
        open={resetStepTwoOpen}
        busy={resettingAll}
        title="Confirmación final de reset"
        message="Esta acción es irreversible. Escribe CONFIRMAR para continuar."
        expectedText="CONFIRMAR"
        confirmText="Resetear definitivamente"
        onCancel={() => {
          if (resettingAll) return;
          setResetStepTwoOpen(false);
        }}
        onConfirm={async () => {
          setResettingAll(true);
          setResetAllMessage('');
          try {
            const result = await clearWealthDataForFreshStart({ preserveFx: false });
            setFx(loadFxRates());
            setFxLiveMeta(loadFxLiveSyncMeta());
            setAvailableClosures(loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
            setAllRecords(loadWealthRecords());
            setFsStatus(getFirestoreStatus());
            setSelectedClosureToDelete('');
            setDeleteClosureMessage('');
            setCsvImportMessage('');
            setCsvImportWarnings([]);
            setCsvImportedResultVisible(false);
            setDeleteBlocksMessage('');
            setSyncMessage('');
            setFsDebug('');
            setBackupMessage('');
            setResetAllMessage(
              result.cloudCleared
                ? 'Reset completado. Datos limpiados en local y nube.'
                : 'Reset completado solo en local. Sin conexión con la nube por ahora.',
            );
            setResetStepTwoOpen(false);
          } finally {
            setResettingAll(false);
          }
        }}
      />

      <ConfirmActionModal
        open={csvConfirmOpen}
        busy={csvImporting}
        title="Confirmar importación CSV"
        message={`Se importará/reemplazará ${
          csvPreview.monthKeys.length === 1
            ? `el mes ${csvPreview.monthKeys[0]}`
            : `${csvPreview.monthKeys.length} meses (${csvPreview.monthKeys.join(', ')})`
        } según month_key.`}
        confirmText="Importar ahora"
        cancelText="Cancelar"
        onCancel={() => setCsvConfirmOpen(false)}
        onConfirm={() => {
          void importCsvNow();
        }}
      />

      <ConfirmActionModal
        open={fxFallbackDecisionOpen}
        title="No pude actualizar TC/UF online"
        message={`Valores guardados actuales: ${fxFallbackSavedText}`}
        confirmText="Mantener guardados"
        cancelText="Ingresar manualmente"
        onCancel={() => {
          setFxFallbackDecisionOpen(false);
          setFxLiveMessage('Decisión: ingresa los valores manualmente en los campos inferiores.');
        }}
        onConfirm={() => {
          setFxFallbackDecisionOpen(false);
          setFxLiveMessage(`Decisión: se mantienen valores guardados (${fxFallbackSavedText}).`);
        }}
      />

      <ConfirmActionModal
        open={deleteClosureConfirmOpen}
        tone="danger"
        busy={deletingClosure}
        title="Confirmar borrado de cierre"
        message={
          selectedClosureToDelete
            ? `Vas a borrar el cierre ${selectedClosureToDelete}. Esta acción no borra registros del mes.`
            : 'Selecciona un cierre antes de continuar.'
        }
        confirmText="Borrar cierre"
        cancelText="Cancelar"
        onCancel={() => setDeleteClosureConfirmOpen(false)}
        onConfirm={() => {
          void deleteSelectedClosureNow();
        }}
      />

      <ConfirmActionModal
        open={deleteAllClosuresConfirmOpen}
        tone="danger"
        busy={deletingClosure}
        title="Confirmar borrado total de cierres"
        message={`Se eliminarán todos los cierres guardados (${availableClosures.length}). No borra registros mensuales.`}
        confirmText="Borrar todos los cierres"
        cancelText="Cancelar"
        onCancel={() => setDeleteAllClosuresConfirmOpen(false)}
        onConfirm={() => {
          void deleteAllClosuresNow();
        }}
      />

      <ConfirmActionModal
        open={deleteBlocksConfirmOpen}
        tone="danger"
        busy={deletingBlocks}
        title="Confirmar borrado de bloques"
        message="Se eliminarán los bloques seleccionados del mes actual. Esta acción no se puede deshacer."
        confirmText="Borrar bloques"
        cancelText="Cancelar"
        onCancel={() => setDeleteBlocksConfirmOpen(false)}
        onConfirm={() => {
          void deleteSelectedBlocksNow();
        }}
      />
    </div>
  );
};
