import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Button, Card, Input } from '../components/Components';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import {
  loadBankTokens,
  loadClosures,
  saveClosures,
  clearCurrentMonthData,
  clearSimulationHistoryData,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  getSimulationHistoryMonthKeys,
  hydrateWealthFromCloud,
  getLastWealthSyncIssue,
  importHistoricalClosuresFromCsv,
  previewHistoricalClosuresCsv,
  loadFxLiveSyncMeta,
  loadFxRates,
  loadInvestmentInstruments,
  loadWealthRecords,
  refreshFxRatesFromLive,
  WEALTH_DATA_UPDATED_EVENT,
  saveFxRates,
  seedDemoWealthTimeline,
  syncWealthNow,
} from '../services/wealthStorage';
import { auth, signOutUser } from '../services/firebase';
import { getFirestoreStatus } from '../services/firestoreStatus';

export const SettingsAurum: React.FC = () => {
  const [fx, setFx] = useState(() => loadFxRates());
  const [fxDraft, setFxDraft] = useState(() => ({
    usdClp: String(Math.round(loadFxRates().usdClp)),
    eurUsd: String(loadFxRates().eurClp / Math.max(1, loadFxRates().usdClp)),
    ufClp: String(Math.round(loadFxRates().ufClp)),
  }));
  const [fxLiveMeta, setFxLiveMeta] = useState(() => loadFxLiveSyncMeta());
  const [fxLiveMessage, setFxLiveMessage] = useState('');
  const [syncingLiveFx, setSyncingLiveFx] = useState(false);
  const [csvDraft, setCsvDraft] = useState('');
  const [csvImportMessage, setCsvImportMessage] = useState('');
  const [csvImportWarnings, setCsvImportWarnings] = useState<string[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [clearSimMessage, setClearSimMessage] = useState('');
  const [clearMonthMessage, setClearMonthMessage] = useState('');
  const [clearingSim, setClearingSim] = useState(false);
  const [clearingMonth, setClearingMonth] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authUid, setAuthUid] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [fsDebug, setFsDebug] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [availableClosures, setAvailableClosures] = useState(() =>
    loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
  );
  const [selectedClosureToDelete, setSelectedClosureToDelete] = useState('');
  const [deleteClosureMessage, setDeleteClosureMessage] = useState('');
  const [deletingClosure, setDeletingClosure] = useState(false);

  const formatMonthLabel = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
    const dt = new Date(y, m - 1, 1);
    const label = dt.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const formatDateTime = (iso?: string) => {
    if (!iso) return 'sin fecha';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFxInteger = (value: number) =>
    Math.round(Number(value) || 0).toLocaleString('es-CL');

  const parseFxInput = (raw: string) => {
    const compact = String(raw || '').trim().replace(/\s+/g, '');
    if (!compact) return NaN;
    let normalized = compact;
    if (compact.includes(',') && compact.includes('.')) {
      if (compact.lastIndexOf(',') > compact.lastIndexOf('.')) {
        normalized = compact.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = compact.replace(/,/g, '');
      }
    } else if (compact.includes(',')) {
      normalized = compact.replace(',', '.');
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const syncDraftFromFx = (rates: { usdClp: number; eurClp: number; ufClp: number }) => {
    setFxDraft({
      usdClp: String(Math.round(rates.usdClp)),
      eurUsd: String(rates.eurClp / Math.max(1, rates.usdClp)),
      ufClp: String(Math.round(rates.ufClp)),
    });
  };

  const commitDraftFx = () => {
    const usdClp = parseFxInput(fxDraft.usdClp);
    const eurUsd = parseFxInput(fxDraft.eurUsd);
    const ufClp = parseFxInput(fxDraft.ufClp);
    if (![usdClp, eurUsd, ufClp].every((n) => Number.isFinite(n) && n > 0)) {
      syncDraftFromFx(fx);
      return;
    }
    const next = {
      usdClp,
      eurClp: usdClp * eurUsd,
      ufClp,
    };
    setFx(next);
    saveFxRates(next);
    syncDraftFromFx(next);
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

  const csvPreview = useMemo(() => previewHistoricalClosuresCsv(csvDraft), [csvDraft]);
  const csvPreviewMonthLabel =
    csvPreview.monthKeys.length === 1 ? formatMonthLabel(csvPreview.monthKeys[0]) : '';

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setAuthEmail(user?.email || '');
      setAuthUid(user?.uid || '');
    });
  }, []);

  useEffect(() => {
    syncDraftFromFx(fx);
  }, [fx]);

  useEffect(() => {
    let runningHydrate = false;
    let lastHydrateAt = 0;
    const HYDRATE_THROTTLE_MS = 20_000;

    const refreshLocal = () => {
      setFx(loadFxRates());
      setFxLiveMeta(loadFxLiveSyncMeta());
      setAvailableClosures(loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
    };
    const refreshFromCloudIfNeeded = async (force = false) => {
      if (runningHydrate) return;
      const now = Date.now();
      if (!force && now - lastHydrateAt < HYDRATE_THROTTLE_MS) {
        refreshLocal();
        return;
      }
      runningHydrate = true;
      try {
        await hydrateWealthFromCloud();
        lastHydrateAt = Date.now();
      } finally {
        runningHydrate = false;
      }
      refreshLocal();
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
    const onLocalWealthChange = () => refreshLocal();

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

  return (
    <div className="p-4 space-y-4">
      <Card className="border-0 bg-gradient-to-br from-[#103c35] via-[#165347] to-[#1f4a3a] p-5 text-[#f3eadb] shadow-[0_14px_30px_rgba(11,38,34,0.42)]">
        <div className="text-xs uppercase tracking-[0.22em] text-[#f3eadb]/90">Aurum Wealth</div>
        <div className="mt-1 text-2xl font-semibold">Ajustes</div>
        <div className="mt-1 text-sm text-[#e7dcc9]/95">
          Centro de configuración, respaldo y control de datos.
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-4 border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">Sincronización y mercado</div>
              <div className="text-xs text-slate-600">Sesión, nube y tipos de cambio.</div>
            </div>
            <div className="rounded-full border border-emerald-200 bg-emerald-100/70 px-2 py-1 text-[11px] font-medium text-emerald-800">
              Activo
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
                  const pushed = await syncWealthNow();
                  const hydrated = await hydrateWealthFromCloud();
                  const fs = getFirestoreStatus();
                  const detail = `${fs.state}${fs.code ? `/${fs.code}` : ''}`;
                  setSyncMessage(`Sync manual: push=${pushed ? 'ok' : 'fail'}, pull=${hydrated}, firestore=${detail}.`);
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
            {!!syncMessage && <div className="text-xs text-emerald-700">{syncMessage}</div>}
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
                    const keep = window.confirm(
                      `No pude actualizar TC/UF online.\n\nValores guardados actuales:\n${savedText}\n\nAceptar = mantener valores guardados\nCancelar = ingresarlos manualmente ahora`,
                    );
                    setFxLiveMessage(
                      keep
                        ? `Decisión: se mantienen valores guardados (${savedText}).`
                        : `Decisión: ingresa los valores manualmente en los campos inferiores.`,
                    );
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
                {fxLiveMeta.status === 'error' && !!fxLiveMeta.message && (
                  <div className="mt-0.5 break-words">{fxLiveMeta.message}</div>
                )}
              </div>
            )}
            {!!fxLiveMessage && <div className="text-xs text-slate-600">{fxLiveMessage}</div>}

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
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                  const filename = `aurum_backup_${stamp}.json`;
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = filename;
                  document.body.appendChild(anchor);
                  anchor.click();
                  anchor.remove();
                  URL.revokeObjectURL(url);
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

          <details className="rounded-xl border border-slate-200 bg-white/85 p-3">
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
              {!!csvPreview.warnings.length && (
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
                    const blob = new Blob([historicalCsvTemplate], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'HISTORIAL_AURUM_TEMPLATE.csv';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  }}
                >
                  Descargar formato para Gemini
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob([historicalSimpleCsvTemplate], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'HISTORIAL_AURUM_SIMPLE_TEMPLATE.csv';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
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
                    const text = await file.text();
                    setCsvDraft(text);
                    setCsvImportMessage(`Archivo cargado: ${file.name} (${Math.round(text.length / 1024)} KB).`);
                    setCsvImportWarnings([]);
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
                  onChange={(e) => setCsvDraft(e.target.value)}
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
                    const monthScope =
                      csvPreview.monthKeys.length === 1
                        ? `mes ${csvPreview.monthKeys[0]}`
                        : `${csvPreview.monthKeys.length} meses (${csvPreview.monthKeys.join(', ')})`;
                    const ok = window.confirm(
                      `Se importará/reemplazará ${monthScope} según month_key. ¿Confirmar importación?`,
                    );
                    if (!ok) return;

                    setCsvImporting(true);
                    setCsvImportMessage('');
                    setCsvImportWarnings([]);
                    try {
                      const result = await importHistoricalClosuresFromCsv(csvDraft);
                      const summary = [
                        result.importedMonths.length
                          ? `Importados: ${result.importedMonths.join(', ')}`
                          : 'Importados: 0',
                        result.replacedMonths.length
                          ? `Reemplazados: ${result.replacedMonths.join(', ')}`
                          : 'Reemplazados: 0',
                        result.skippedMonths.length
                          ? `Omitidos: ${result.skippedMonths.join(', ')}`
                          : 'Omitidos: 0',
                      ].join(' · ');
                      setCsvImportMessage(summary);
                      setCsvImportWarnings(result.warnings);
                    } catch (err: any) {
                      setCsvImportMessage(String(err?.message || 'No pude importar el historial CSV.'));
                      setCsvImportWarnings([]);
                    } finally {
                      setCsvImporting(false);
                    }
                  }}
                >
                  {csvImporting ? 'Importando historial...' : 'Importar historial CSV'}
                </Button>
                <Button
                  variant="outline"
                  disabled={csvImporting}
                  onClick={() => {
                    setCsvDraft('');
                    setCsvImportMessage('');
                    setCsvImportWarnings([]);
                  }}
                >
                  Limpiar CSV
                </Button>
              </div>

              {!!csvImportMessage && <div className="text-xs text-slate-700">{csvImportMessage}</div>}
              {!!csvImportWarnings.length && (
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
          <div className="text-xs text-slate-600">Pruebas controladas y borrado seguro con confirmación.</div>
        </div>

        <details className="rounded-xl border border-slate-200 bg-white/90 p-3">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            Abrir herramientas de testeo
          </summary>
          <div className="mt-3 space-y-4">
            <div className="space-y-2">
              <div className="text-xs text-slate-600">
                Crea datos demo: enero (cierre), febrero (cierre) y marzo en curso, para probar Hoy/Cierre/Evolución.
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  const timeline = seedDemoWealthTimeline();
                  setSeedMessage(`Demo cargada: ${timeline.janKey}, ${timeline.febKey} y ${timeline.marKey}.`);
                  setClearSimMessage('');
                  setClearMonthMessage('');
                }}
              >
                Cargar demo Ene-Feb-Mar
              </Button>
              {!!seedMessage && <div className="text-xs text-emerald-700">{seedMessage}</div>}
            </div>

            <div className="pt-2 border-t border-slate-200">
              <div className="text-xs text-slate-600 mb-2">
                Limpia solo meses históricos de simulación (no toca automáticamente el mes actual).
              </div>
              <Button
                variant="danger"
                disabled={clearingSim}
                onClick={async () => {
                  const candidates = getSimulationHistoryMonthKeys();
                  const monthText = candidates.length
                    ? candidates.map((m) => formatMonthLabel(m)).join(', ')
                    : 'meses históricos detectados';
                  const ok = window.confirm(
                    `Se eliminarán datos simulados de: ${monthText}. No se borrará automáticamente el mes actual. ¿Continuar?`,
                  );
                  if (!ok) return;
                  setClearingSim(true);
                  setSeedMessage('');
                  setSyncMessage('');
                  setFsDebug('');
                  setClearMonthMessage('');
                  try {
                    const result = await clearSimulationHistoryData();
                    if (!result.monthKeys.length || (result.removedRecords === 0 && result.removedClosures === 0)) {
                      setClearSimMessage(
                        'No encontré simulación histórica para eliminar (o ya estaba limpia).',
                      );
                    } else {
                      setClearSimMessage(
                        result.cloudCleared
                          ? `Simulación histórica eliminada (${result.removedClosures} cierres, ${result.removedRecords} registros).`
                          : `Simulación eliminada localmente (${result.removedClosures} cierres, ${result.removedRecords} registros). Firestore no se pudo actualizar ahora.`,
                      );
                    }
                  } finally {
                    setClearingSim(false);
                  }
                }}
              >
                {clearingSim ? 'Limpiando...' : 'Eliminar solo simulación histórica'}
              </Button>
              {!!clearSimMessage && <div className="mt-2 text-xs text-emerald-700">{clearSimMessage}</div>}
            </div>

            <div className="pt-2 border-t border-slate-200">
              <div className="text-xs text-slate-600 mb-2">
                Borra datos del mes actual por bloque (Inversiones y/o Bienes raíces), con confirmación.
              </div>
              <Button
                variant="outline"
                disabled={clearingMonth}
                onClick={async () => {
                  const month = currentMonthKey();
                  const inv = window.confirm(
                    `¿Quieres borrar Inversiones de ${formatMonthLabel(month)}?`,
                  );
                  const re = window.confirm(
                    `¿Quieres borrar Bienes raíces de ${formatMonthLabel(month)}?`,
                  );
                  if (!inv && !re) {
                    setClearMonthMessage('No se seleccionó ningún bloque para borrar.');
                    return;
                  }
                  const finalOk = window.confirm(
                    `Confirmar borrado del mes actual (${formatMonthLabel(month)}): ${inv ? 'Inversiones' : ''}${
                      inv && re ? ' + ' : ''
                    }${re ? 'Bienes raíces' : ''}.`,
                  );
                  if (!finalOk) return;

                  setClearingMonth(true);
                  setSeedMessage('');
                  setSyncMessage('');
                  setFsDebug('');
                  setClearSimMessage('');
                  try {
                    const result = await clearCurrentMonthData({
                      clearInvestments: inv,
                      clearRealEstate: re,
                    });
                    setClearMonthMessage(
                      result.cloudCleared
                        ? `Mes actual limpiado: ${result.removedRecords} registros (${result.removedInvestment} inversiones, ${result.removedRealEstate} bienes raíces/deuda hipotecaria).`
                        : `Mes limpiado localmente: ${result.removedRecords} registros. Firestore no se pudo actualizar ahora.`,
                    );
                  } finally {
                    setClearingMonth(false);
                  }
                }}
              >
                {clearingMonth ? 'Borrando...' : 'Borrar datos del mes actual (por bloque)'}
              </Button>
              {!!clearMonthMessage && <div className="mt-2 text-xs text-emerald-700">{clearMonthMessage}</div>}
            </div>

            <div className="pt-2 border-t border-slate-200 space-y-2">
              <div className="text-xs text-slate-600">
                Gestión de cierres: borra un cierre puntual o limpia todos los cierres guardados.
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={selectedClosureToDelete}
                  onChange={(e) => setSelectedClosureToDelete(e.target.value)}
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
                  onClick={async () => {
                    if (!selectedClosureToDelete) return;
                    const label = formatMonthLabel(selectedClosureToDelete);
                    const ok = window.confirm(
                      `Vas a borrar el cierre de ${label}. Esta acción no borra registros del mes, solo el cierre. ¿Continuar?`,
                    );
                    if (!ok) return;
                    const second = window.confirm(
                      `Confirmación final: ¿borrar cierre ${selectedClosureToDelete}?`,
                    );
                    if (!second) return;
                    setDeletingClosure(true);
                    setDeleteClosureMessage('');
                    try {
                      const current = loadClosures();
                      const next = current.filter((c) => c.monthKey !== selectedClosureToDelete);
                      saveClosures(next);
                      setAvailableClosures(next.sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
                      setSelectedClosureToDelete('');
                      setDeleteClosureMessage(`Cierre ${selectedClosureToDelete} eliminado.`);
                    } finally {
                      setDeletingClosure(false);
                    }
                  }}
                >
                  {deletingClosure ? 'Borrando...' : 'Borrar cierre seleccionado'}
                </Button>
              </div>
              <Button
                variant="danger"
                disabled={deletingClosure || !availableClosures.length}
                onClick={async () => {
                  const ok = window.confirm(
                    `Se eliminarán TODOS los cierres (${availableClosures.length}). No borra registros mensuales. ¿Continuar?`,
                  );
                  if (!ok) return;
                  const second = window.confirm('Confirmación final: ¿borrar todos los cierres?');
                  if (!second) return;
                  setDeletingClosure(true);
                  setDeleteClosureMessage('');
                  try {
                    saveClosures([]);
                    setAvailableClosures([]);
                    setSelectedClosureToDelete('');
                    setDeleteClosureMessage('Se eliminaron todos los cierres.');
                  } finally {
                    setDeletingClosure(false);
                  }
                }}
              >
                Borrar todos los cierres
              </Button>
              {!!deleteClosureMessage && (
                <div className="text-xs text-emerald-700">{deleteClosureMessage}</div>
              )}
            </div>
          </div>
        </details>
      </Card>
    </div>
  );
};
