import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Button, Card, Input } from '../components/Components';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import {
  loadBankTokens,
  loadClosures,
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
    const eurMatch = source.match(/EUR:([^·]+)/i);
    const ufMatch = source.match(/UF:([^·]+)/i);
    if (usdMatch?.[1]) parts.push(humanizeSingle(usdMatch[1], 'USD'));
    if (eurMatch?.[1]) parts.push(humanizeSingle(eurMatch[1], 'EUR'));
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
    let runningHydrate = false;
    let lastHydrateAt = 0;
    const HYDRATE_THROTTLE_MS = 20_000;

    const refreshLocal = () => {
      setFx(loadFxRates());
      setFxLiveMeta(loadFxLiveSyncMeta());
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
      <Card className="p-4">
        <div className="text-lg font-bold text-slate-900">Ajustes</div>
        <div className="mt-1 text-sm text-slate-600">Configuración general de Aurum.</div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Sesión activa</div>
        <div className="text-xs text-slate-600">
          Usa el mismo correo y UID en notebook/celular para sincronizar el mismo patrimonio.
        </div>
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
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Respaldo Aurum (JSON)</div>
        <div className="text-xs text-slate-600">
          Descarga un respaldo completo antes de cargar historia real (incluye patrimonio, cierres, instrumentos, TC/UF y tokens bancarios guardados).
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
        {!!backupMessage && <div className="text-xs text-slate-600">{backupMessage}</div>}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Tipos de cambio (consolidado CLP)</div>
        <div className="text-xs text-slate-600">
          Puedes actualizarlos en línea (fuentes automáticas) o ajustar manualmente si necesitas corrección puntual.
        </div>
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
                    ? `Manteniendo valores guardados manualmente: ${savedText}.`
                    : `Actualización online no disponible. Revisa/ajusta manualmente (actuales: ${savedText}).`,
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
        {!!fxLiveMessage && (
          <div className="text-xs text-slate-600">{fxLiveMessage}</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">USD a CLP</div>
            <Input
              value={fx.usdClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, usdClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">EUR a CLP</div>
            <Input
              value={fx.eurClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, eurClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">UF a CLP</div>
            <Input
              value={fx.ufClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, ufClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Importar historia mensual (CSV)</div>
        <div className="text-xs text-slate-600">
          Carga cierres históricos con sus TC/UF congelados por mes. El importador reemplaza el mes si ya existe.
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
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Simulación de cierres</div>
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
      </Card>
    </div>
  );
};
