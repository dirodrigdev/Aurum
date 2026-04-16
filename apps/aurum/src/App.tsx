import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { User, onAuthStateChanged } from 'firebase/auth';
import { Layout } from './components/Layout';
import { Patrimonio } from './pages/Patrimonio';
import { SettingsAurum } from './pages/SettingsAurum';
import { ClosingAurum } from './pages/ClosingAurum';
import { AnalysisAurum } from './pages/AnalysisAurum';
import { DashboardAurum } from './pages/DashboardAurum';
import { WEALTH_DELTA_TOAST_TRIGGER_EVENT } from './hooks/useWealthDelta';
import { auth, ensureAuthPersistence, signInWithGoogle } from './services/firebase';
import {
  FX_RATES_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  computeWealthHomeSectionAmounts,
  currentMonthKey,
  getIncompleteClosures,
  latestRecordsForMonth,
  localYmd,
  loadClosures,
  loadFxRates,
  loadIncludeRiskCapitalInTotals,
  loadWealthRecords,
  refreshFxRatesDailyIfNeeded,
  resolveRiskCapitalRecordsForTotals,
  subscribeWealthCloud,
  unsubscribeWealthCloud,
  type WealthFxRates,
} from './services/wealthStorage';
import { hydrateWealthFromCloudShared } from './services/wealthHydration';

const INCOMPLETE_CLOSURE_PROMPT_DAY_KEY = 'aurum.incomplete-closure.prompt.day.v1';
const CLOSING_FOCUS_MONTH_KEY = 'aurum.closing.focus.month.v1';
const FX_INDICATOR_READ_SNAPSHOT_KEY = 'aurum.fx-indicator-read-snapshot.v1';

type FxIndicatorSnapshot = {
  usdClp: number;
  eurClp: number;
  ufClp: number;
  readAt: string;
};

type FxIndicatorDiffRow = {
  key: 'usdClp' | 'eurClp' | 'ufClp' | 'eurUsd';
  label: string;
  previous: number;
  next: number;
  deltaAbs: number;
  deltaPct: number | null;
  changed: boolean;
};

type FxIndicatorPrompt = {
  rows: FxIndicatorDiffRow[];
  previousSnapshot: FxIndicatorSnapshot;
  currentSnapshot: FxIndicatorSnapshot;
  patrimonyDeltaClp: number;
};

type IncompletePrompt = {
  monthKey: string;
  missingCount: number;
  missingFx: boolean;
};

const toFinite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readFxIndicatorSnapshot = (): FxIndicatorSnapshot | null => {
  try {
    const raw = localStorage.getItem(FX_INDICATOR_READ_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const usdClp = toFinite(parsed?.usdClp);
    const eurClp = toFinite(parsed?.eurClp);
    const ufClp = toFinite(parsed?.ufClp);
    if (usdClp === null || eurClp === null || ufClp === null) return null;
    return {
      usdClp,
      eurClp,
      ufClp,
      readAt: String(parsed?.readAt || ''),
    };
  } catch {
    return null;
  }
};

const saveFxIndicatorSnapshot = (snapshot: FxIndicatorSnapshot) => {
  try {
    localStorage.setItem(FX_INDICATOR_READ_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
};

const buildSnapshotFromRates = (rates: WealthFxRates): FxIndicatorSnapshot => ({
  usdClp: Number(rates.usdClp),
  eurClp: Number(rates.eurClp),
  ufClp: Number(rates.ufClp),
  readAt: new Date().toISOString(),
});

const hasMeaningfulIndicatorDelta = (key: FxIndicatorDiffRow['key'], previous: number, next: number) => {
  const absDelta = Math.abs(next - previous);
  if (key === 'eurUsd') return absDelta >= 0.0005;
  return absDelta >= 0.5;
};

const buildFxIndicatorRows = (
  previous: FxIndicatorSnapshot,
  current: FxIndicatorSnapshot,
): FxIndicatorDiffRow[] => {
  const previousEurUsd = previous.eurClp / Math.max(1, previous.usdClp);
  const currentEurUsd = current.eurClp / Math.max(1, current.usdClp);
  const rows: Array<{ key: FxIndicatorDiffRow['key']; label: string; previous: number; next: number }> = [
    { key: 'usdClp', label: 'USD/CLP', previous: previous.usdClp, next: current.usdClp },
    { key: 'eurClp', label: 'EUR/CLP', previous: previous.eurClp, next: current.eurClp },
    { key: 'ufClp', label: 'UF/CLP', previous: previous.ufClp, next: current.ufClp },
    { key: 'eurUsd', label: 'EUR/USD', previous: previousEurUsd, next: currentEurUsd },
  ];

  return rows.map((row) => {
    const deltaAbs = row.next - row.previous;
    const deltaPct = row.previous !== 0 ? (deltaAbs / row.previous) * 100 : null;
    return {
      key: row.key,
      label: row.label,
      previous: row.previous,
      next: row.next,
      deltaAbs,
      deltaPct,
      changed: hasMeaningfulIndicatorDelta(row.key, row.previous, row.next),
    };
  });
};

const computeFxPatrimonyDelta = (previous: FxIndicatorSnapshot, current: FxIndicatorSnapshot): number => {
  const monthKey = currentMonthKey();
  const records = latestRecordsForMonth(loadWealthRecords(), monthKey);
  const includeRiskCapital = loadIncludeRiskCapitalInTotals();
  const recordsForTotals = resolveRiskCapitalRecordsForTotals(records, includeRiskCapital).recordsForTotals;
  const previousNet = computeWealthHomeSectionAmounts(recordsForTotals, previous).totalNetClp;
  const currentNet = computeWealthHomeSectionAmounts(recordsForTotals, current).totalNetClp;
  return currentNet - previousNet;
};

const formatIndicatorValue = (rowKey: FxIndicatorDiffRow['key'], value: number) => {
  const digits = rowKey === 'eurUsd' ? 4 : 0;
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatIndicatorDeltaAbs = (rowKey: FxIndicatorDiffRow['key'], value: number) => {
  const digits = rowKey === 'eurUsd' ? 4 : 0;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toLocaleString('es-CL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
};

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState('');
  const [incompletePrompt, setIncompletePrompt] = useState<IncompletePrompt | null>(null);
  const [fxIndicatorPrompt, setFxIndicatorPrompt] = useState<FxIndicatorPrompt | null>(null);

  useEffect(() => {
    void ensureAuthPersistence();
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setAuthError(
        'No pude validar la sesión automáticamente. Puedes continuar con "Entrar con Google".',
      );
    }, 6000);

    const unsub = onAuthStateChanged(
      auth,
      (nextUser) => {
        window.clearTimeout(timeout);
        setUser(nextUser);
        setLoading(false);
      },
      (err) => {
        window.clearTimeout(timeout);
        setAuthError(String(err?.message || 'Error inicializando autenticación.'));
        setLoading(false);
      },
    );
    return () => {
      window.clearTimeout(timeout);
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!user || user.isAnonymous) return;

    const runDailySync = () => {
      void refreshFxRatesDailyIfNeeded();
    };

    runDailySync();

    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      runDailySync();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      runDailySync();
    };
    const onFirstInteraction = () => {
      if (document.visibilityState !== 'visible') return;
      runDailySync();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onFirstInteraction);
    window.addEventListener('touchstart', onFirstInteraction);
    window.addEventListener('keydown', onFirstInteraction);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('touchstart', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, [user?.uid, user?.isAnonymous]);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setFxIndicatorPrompt(null);
      return;
    }

    const evaluateFxIndicatorPrompt = () => {
      const currentSnapshot = buildSnapshotFromRates(loadFxRates());
      const previousSnapshot = readFxIndicatorSnapshot();
      if (!previousSnapshot) {
        saveFxIndicatorSnapshot(currentSnapshot);
        console.info('[Aurum][fx-indicators] baseline inicial guardado, sin comparación previa.');
        return;
      }
      const rows = buildFxIndicatorRows(previousSnapshot, currentSnapshot);
      const changedRows = rows.filter((row) => row.changed);
      if (!changedRows.length) return;
      setFxIndicatorPrompt({
        rows: changedRows,
        previousSnapshot,
        currentSnapshot,
        patrimonyDeltaClp: computeFxPatrimonyDelta(previousSnapshot, currentSnapshot),
      });
    };

    evaluateFxIndicatorPrompt();
    window.addEventListener(FX_RATES_UPDATED_EVENT, evaluateFxIndicatorPrompt as EventListener);
    return () => {
      window.removeEventListener(FX_RATES_UPDATED_EVENT, evaluateFxIndicatorPrompt as EventListener);
    };
  }, [user?.uid, user?.isAnonymous]);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setIncompletePrompt(null);
      return;
    }
    const refreshIncompletePrompt = () => {
      const today = localYmd(new Date());
      const dismissedDay = String(localStorage.getItem(INCOMPLETE_CLOSURE_PROMPT_DAY_KEY) || '');
      if (dismissedDay === today) {
        setIncompletePrompt(null);
        return;
      }
      const incomplete = getIncompleteClosures(loadClosures())[0] || null;
      if (!incomplete) {
        setIncompletePrompt(null);
        return;
      }
      setIncompletePrompt({
        monthKey: incomplete.monthKey,
        missingCount: incomplete.missingFieldLabels.length,
        missingFx: incomplete.missingFx,
      });
    };

    refreshIncompletePrompt();
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshIncompletePrompt as EventListener);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshIncompletePrompt as EventListener);
    };
  }, [user?.uid, user?.isAnonymous]);

  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      await hydrateWealthFromCloudShared({ force: true, minIntervalMs: 0 });
      const unsub = await subscribeWealthCloud();
      if (cancelled) {
        unsub();
        return;
      }
      cleanup = unsub;
    })().catch(() => {
      // handled by storage/firestore status banners
    });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      else unsubscribeWealthCloud();
    };
  }, [user?.uid, user?.isAnonymous]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Aurum</div>
          <div className="mt-2 text-sm text-slate-500">Cargando sesión segura...</div>
        </div>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f6f3eb] to-[#e9efe4] p-6">
        <div className="w-full max-w-md rounded-3xl border border-[#ddd4c6] bg-white/90 p-7 shadow-lg">
          <div className="text-3xl font-bold text-slate-900">Aurum</div>
          <div className="mt-2 text-sm text-slate-600">
            Inicia sesión con tu cuenta Google para sincronizar el mismo patrimonio en todos tus dispositivos.
          </div>
          {user?.isAnonymous && (
            <div className="mt-2 text-xs text-amber-700">
              Se detectó sesión anónima anterior. Entra con Google para unificar datos entre dispositivos.
            </div>
          )}
          <button
            className="mt-6 w-full rounded-xl bg-[#2f4f2f] px-4 py-3 text-sm font-semibold text-white hover:bg-[#264226]"
            onClick={async () => {
              setAuthError('');
              try {
                await signInWithGoogle();
              } catch (err: any) {
                setAuthError(String(err?.message || 'No pude iniciar sesión con Google.'));
              }
            }}
          >
            Entrar con Google
          </button>
          {!!authError && <div className="mt-3 text-xs text-red-700">{authError}</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {!!fxIndicatorPrompt && (
        <div className="fixed inset-0 z-[121] bg-black/45 p-4 flex items-center justify-center">
          <div className="w-full max-w-xl rounded-2xl border border-blue-200 bg-white p-5 shadow-2xl">
            <div className="text-lg font-semibold text-slate-900">Actualización de indicadores</div>
            <div className="mt-1 text-sm text-slate-600">
              Se detectaron cambios en indicadores operativos que afectan la valorización actual.
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                <div>Indicador</div>
                <div className="text-right">Anterior</div>
                <div className="text-right">Nuevo</div>
                <div className="text-right">Delta</div>
                <div className="text-right">Delta %</div>
              </div>
              {fxIndicatorPrompt.rows.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] border-t border-slate-100 px-3 py-2 text-xs text-slate-700"
                >
                  <div className="font-medium">{row.label}</div>
                  <div className="text-right">{formatIndicatorValue(row.key, row.previous)}</div>
                  <div className="text-right font-semibold">{formatIndicatorValue(row.key, row.next)}</div>
                  <div className={`text-right font-semibold ${row.deltaAbs >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatIndicatorDeltaAbs(row.key, row.deltaAbs)}
                  </div>
                  <div className={`text-right ${row.deltaPct !== null && row.deltaPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {row.deltaPct === null
                      ? '—'
                      : `${row.deltaPct >= 0 ? '+' : ''}${row.deltaPct.toLocaleString('es-CL', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}%`}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-slate-500">
              Baseline leído: {fxIndicatorPrompt.previousSnapshot.readAt || 'sin fecha previa'}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg border border-[#7f5528] bg-[#9c6b36] px-4 py-2 text-sm font-semibold text-[#f6efe2] hover:bg-[#8b5f30]"
                onClick={() => {
                  saveFxIndicatorSnapshot(buildSnapshotFromRates(loadFxRates()));
                  window.dispatchEvent(
                    new CustomEvent(WEALTH_DELTA_TOAST_TRIGGER_EVENT, {
                      detail: {
                        delta: fxIndicatorPrompt.patrimonyDeltaClp,
                        reason: 'TC/UF actualizados',
                      },
                    }),
                  );
                  setFxIndicatorPrompt(null);
                }}
              >
                Leído
              </button>
            </div>
          </div>
        </div>
      )}
      {!fxIndicatorPrompt && !!incompletePrompt && (
        <div className="fixed inset-0 z-[120] bg-black/45 p-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl">
            <div className="text-lg font-semibold text-slate-900">Cierre mensual incompleto</div>
            <div className="mt-2 text-sm text-slate-600">
              El cierre de <span className="font-semibold">{incompletePrompt.monthKey}</span> aún no está completo.
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Faltan {incompletePrompt.missingCount} campos
              {incompletePrompt.missingFx ? ' + TC/UF del cierre' : ''}.
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  localStorage.setItem(INCOMPLETE_CLOSURE_PROMPT_DAY_KEY, localYmd(new Date()));
                  setIncompletePrompt(null);
                }}
              >
                Omitir
              </button>
              <button
                type="button"
                className="rounded-lg border border-[#7f5528] bg-[#9c6b36] px-3 py-2 text-sm font-semibold text-[#f6efe2] hover:bg-[#8b5f30]"
                onClick={() => {
                  localStorage.setItem(INCOMPLETE_CLOSURE_PROMPT_DAY_KEY, localYmd(new Date()));
                  localStorage.setItem(CLOSING_FOCUS_MONTH_KEY, incompletePrompt.monthKey);
                  window.location.hash = '#/closing';
                  setIncompletePrompt(null);
                }}
              >
                Completar ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const App: React.FC = () => {
  return (
    <AuthGate>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardAurum />} />
            <Route path="/patrimonio" element={<Patrimonio />} />
            <Route path="/closing" element={<ClosingAurum />} />
            <Route path="/analysis" element={<AnalysisAurum />} />
            <Route path="/settings" element={<SettingsAurum />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </AuthGate>
  );
};

export default App;
