import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManualCapitalAdjustment, ManualCapitalDestination, ModelParameters, SimulationResults, ScenarioVariantId } from '../domain/model/types';
import { SCENARIO_VARIANTS } from '../domain/model/defaults';
import { T, css } from './theme';
import { HeroCard } from './HeroCard';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

type FanChartDatum = SimulationResults['fanChartData'][number] & {
  outerBase: number;
  outerSpan: number;
  innerBase: number;
  innerSpan: number;
};

export type SimulationPreset = ScenarioVariantId | 'custom';

export type SimulationOverrides = {
  active: boolean;
  returnPct?: number;
  horizonYears?: number;
  capital?: number;
  preset?: 'optimista' | 'actual' | 'pesimista' | 'custom';
};

const computeWeightedReturn = (p: ModelParameters) =>
  p.weights.rvGlobal * p.returns.rvGlobalAnnual +
  p.weights.rfGlobal * p.returns.rfGlobalAnnual +
  p.weights.rvChile * p.returns.rvChileAnnual +
  p.weights.rfChile * p.returns.rfChileUFAnnual;

const formatMillionsMM = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const decimals = value !== 0 && Math.abs(value) < 1000 ? 1 : 0;
  return `${value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}MM`;
};
const formatCapital = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  return `$${formatMillionsMM(value / 1_000_000)}`;
};
const formatNumber = (value: number) =>
  value.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function SimulationPage({
  resultCentral,
  params,
  simOverrides,
  simActive,
  simWorking,
  simUiState,
  heroPhase,
  lastStableCentral,
  simUiError,
  lastRecalcCause,
  simulationPreset,
  stateLabel,
  aurumIntegrationStatus,
  aurumSnapshotLabel,
  baseUpdatePending,
  pendingSnapshotLabel,
  pendingSnapshotApplying,
  snapshotApplied,
  manualCapitalAdjustments,
  riskCapitalEnabled,
  riskCapitalEffective,
  riskCapitalCLP,
  recalcWorkerStatus,
  activeRecalcRequestId,
  appliedRecalcRequestId,
  onApplyPendingSnapshot,
  onToggleRiskCapital,
  onCommitManualCapitalAdjustments,
  onSimulationTouch,
  onScenarioChange,
  onSimOverridesChange,
  onUpdateParams,
  onResetSim,
}: {
  resultCentral: SimulationResults | null;
  params: ModelParameters;
  simOverrides: SimulationOverrides | null;
  simActive: boolean;
  simWorking: boolean;
  simUiState: 'boot' | 'stale' | 'ready' | 'error';
  heroPhase: 'boot' | 'stale' | 'ready';
  lastStableCentral: SimulationResults | null;
  simUiError: string | null;
  lastRecalcCause: string | null;
  simulationPreset: SimulationPreset;
  stateLabel: string;
  aurumIntegrationStatus: 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
  aurumSnapshotLabel: string | null;
  baseUpdatePending: boolean;
  pendingSnapshotLabel: string | null;
  pendingSnapshotApplying: boolean;
  snapshotApplied: boolean;
  manualCapitalAdjustments: ManualCapitalAdjustment[];
  riskCapitalEnabled: boolean;
  riskCapitalEffective: boolean;
  riskCapitalCLP: number;
  recalcWorkerStatus: 'idle' | 'queued' | 'running' | 'done' | 'error';
  activeRecalcRequestId: number | null;
  appliedRecalcRequestId: number | null;
  onApplyPendingSnapshot: () => void;
  onToggleRiskCapital: () => void;
  onCommitManualCapitalAdjustments: (next: ManualCapitalAdjustment[]) => void;
  onSimulationTouch: (next?: SimulationPreset) => void;
  onScenarioChange: (next: ScenarioVariantId) => void;
  onSimOverridesChange: (next: SimulationOverrides | null) => void;
  onUpdateParams: (patcher: (prev: ModelParameters) => ModelParameters) => void;
  onResetSim: () => void;
}) {
  const [showSimToast, setShowSimToast] = useState(false);
  const [activeChip, setActiveChip] = useState<'return' | 'years' | 'capital' | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(riskCapitalEnabled || riskCapitalCLP > 0);
  const [savingMovement, setSavingMovement] = useState(false);
  const [capitalLedgerOpen, setCapitalLedgerOpen] = useState(false);
  const [draftManualAdjustments, setDraftManualAdjustments] = useState<ManualCapitalAdjustment[]>(manualCapitalAdjustments);
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null);
  const [movementForm, setMovementForm] = useState({
    direction: 'add' as 'add' | 'remove',
    amount: '',
    currency: 'CLP' as 'CLP' | 'USD' | 'EUR',
    effectiveDate: '',
    destination: 'liquidity' as ManualCapitalDestination,
    note: '',
  });
  const prevSimActive = useRef(false);
  const destinationOptions: Array<{ value: ManualCapitalDestination; label: string }> = [
    { value: 'liquidity', label: 'Liquidez / Bancos' },
    { value: 'investments', label: 'Inversiones financieras' },
    { value: 'risk', label: 'Capital de riesgo' },
    { value: 'other', label: 'Otros' },
  ];
  const openCapitalLedger = useCallback(() => {
    setDraftManualAdjustments(manualCapitalAdjustments);
    setCapitalLedgerOpen(true);
    setSavingMovement(false);
    setEditingMovementId(null);
    setMovementForm({
      direction: 'add',
      amount: '',
      currency: 'CLP',
      effectiveDate: new Date().toISOString().slice(0, 7),
      destination: 'liquidity',
      note: '',
    });
  }, [manualCapitalAdjustments]);
  const closeCapitalLedger = useCallback(() => {
    setCapitalLedgerOpen(false);
    setSavingMovement(false);
    setEditingMovementId(null);
  }, []);
  const baseReturn = useMemo(() => computeWeightedReturn(params), [params]);
  const baseYears = Math.round(params.simulation.horizonMonths / 12);
  const baseCapital = params.capitalInitial;
  const liquidarDeptoEnabled = params.realEstatePolicy?.enabled ?? true;
  const aurumTechnicalLabel = aurumSnapshotLabel
    ? `Aurum: ${aurumSnapshotLabel}`
    : aurumIntegrationStatus === 'missing'
      ? 'Aurum: snapshot no disponible'
      : aurumIntegrationStatus === 'unconfigured'
        ? 'Aurum: no configurado'
        : aurumIntegrationStatus === 'error'
          ? 'Aurum: error de integración'
          : 'Aurum: en espera';
  const isRecalculating = simUiState !== 'error' && (heroPhase === 'boot' || heroPhase === 'stale');
  const simTechnicalLabel = isRecalculating
    ? `Simulación: recalculando${lastRecalcCause ? ` (${lastRecalcCause})` : ''}`
    : simUiState === 'ready'
      ? 'Simulación: lista'
      : simUiState === 'error'
        ? `Simulación: error (${simUiError || 'sin detalle'})`
        : 'Simulación: inicial';
  const hideResultBlocks = simUiState === 'error';
  const compositionSource = (baseUpdatePending
    ? params.simulationComposition
    : resultCentral?.params?.simulationComposition) ?? params.simulationComposition;
  const compositionDiagnostics = compositionSource?.diagnostics;
  const compositionMode = compositionSource?.mode ?? 'legacy';
  const diagnosticWarnings = compositionDiagnostics?.diagnosticWarnings ?? [];
  const lastRebalanceMonth = compositionDiagnostics?.lastRebalanceMonth;
  const compositionHasFallback =
    compositionSource?.mortgageProjectionStatus === 'fallback_incomplete' ||
    diagnosticWarnings.length > 0;
  const motorWarnings = useMemo(() => {
    const warnings: string[] = [];
    const add = (value: string) => {
      if (!warnings.includes(value)) warnings.push(value);
    };
    for (const entry of diagnosticWarnings) {
      const raw = String(entry || '');
      if (raw.startsWith('mortgage:')) {
        const code = raw.replace('mortgage:', '').split(':')[0];
        if (code === 'fallback-incomplete') {
          add('Hipoteca en modo aproximado');
        } else if (code === 'missing-inputs' || code === 'missing-uf' || code === 'missing-snapshot-month' || code === 'missing-equity') {
          add('Hipoteca: faltan datos base (UF/snapshot/equity)');
        } else if (code === 'amortization-first-month-mismatch') {
          add('Tabla UF desalineada con snapshot');
        } else if (code === 'amortization-missing-months') {
          add('Tabla UF con meses faltantes (fallback aplicado)');
        } else if (code === 'amortization-ended') {
          add('Tabla UF terminó: amortización=0 desde ese mes');
        } else if (code === 'empty-table') {
          add('Tabla UF vacía (sin amortización)');
        } else if (code === 'invalid-table') {
          add('Tabla UF inválida (revisar formato)');
        } else if (code === 'invalid-snapshot-month') {
          add('snapshotMonth inválido para hipoteca');
        } else {
          add(raw);
        }
      } else if (raw) {
        if (raw === 'risk-capital-without-load-bearing-block') {
          add('Capital de riesgo pendiente: requiere bloque load-bearing dedicado');
          continue;
        }
        add(raw);
      }
    }
    if (compositionSource?.mortgageProjectionStatus === 'fallback_incomplete') {
      add('Hipoteca en modo aproximado');
    }
    return warnings;
  }, [diagnosticWarnings, compositionSource?.mortgageProjectionStatus]);
  const compositionStatusVisual = useMemo(() => {
    if (compositionMode === 'full' && !compositionHasFallback) {
      return {
        copy: 'Composición: full',
        detail: 'Bloques patrimoniales completos activos',
        color: T.positive,
        border: 'rgba(61, 212, 141, 0.45)',
        bg: 'rgba(61, 212, 141, 0.12)',
      };
    }
    if (compositionMode === 'partial' || compositionHasFallback) {
      return {
        copy: 'Composición: partial',
        detail: 'Con fallback/limitaciones en parte de los bloques',
        color: T.warning,
        border: 'rgba(255, 176, 32, 0.45)',
        bg: 'rgba(255, 176, 32, 0.12)',
      };
    }
    return {
      copy: 'Composición: legacy',
      detail: 'Modo histórico sin bloques patrimoniales completos',
      color: T.textMuted,
      border: 'rgba(148, 163, 184, 0.35)',
      bg: 'rgba(148, 163, 184, 0.12)',
    };
  }, [compositionHasFallback, compositionMode]);
  const effectiveReturn = simOverrides?.returnPct ?? baseReturn;
  const effectiveYears = simOverrides?.horizonYears ?? baseYears;
  const effectiveCapital = simOverrides?.capital ?? baseCapital;
  const toClp = useCallback((amount: number, currency: 'CLP' | 'USD' | 'EUR') => {
    if (currency === 'CLP') return amount;
    const usdToClp = params.fx?.clpUsdInitial ?? 1;
    const usdToEur = params.fx?.usdEurFixed ?? 1;
    if (currency === 'USD') return amount * usdToClp;
    return amount * usdToClp * usdToEur;
  }, [params.fx]);
  const manualAdjustmentsSorted = useMemo(
    () => [...draftManualAdjustments].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    [draftManualAdjustments],
  );
  const manualNetClp = useMemo(
    () => manualAdjustmentsSorted.reduce((acc, adj) => {
      const signed = adj.direction === 'add' ? 1 : -1;
      return acc + signed * toClp(adj.amount, adj.currency);
    }, 0),
    [manualAdjustmentsSorted, toClp],
  );
  const resetMovementForm = useCallback(() => {
    setEditingMovementId(null);
    setMovementForm({
      direction: 'add',
      amount: '',
      currency: 'CLP',
      effectiveDate: new Date().toISOString().slice(0, 7),
      destination: 'liquidity',
      note: '',
    });
  }, []);
  const startEditMovement = useCallback((movement: ManualCapitalAdjustment) => {
    setEditingMovementId(movement.id);
    setMovementForm({
      direction: movement.direction,
      amount: String(movement.amount),
      currency: movement.currency,
      effectiveDate: movement.effectiveDate,
      destination: movement.destination,
      note: movement.note ?? '',
    });
  }, []);
  const handleSaveMovement = useCallback(() => {
    const amount = Number(movementForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const effectiveDate = movementForm.effectiveDate || new Date().toISOString().slice(0, 7);
    const next: ManualCapitalAdjustment = {
      id: editingMovementId ?? `manual-${Date.now()}`,
      direction: movementForm.direction,
      amount,
      currency: movementForm.currency,
      effectiveDate,
      destination: movementForm.destination,
      note: movementForm.note?.trim() || undefined,
    };
    setDraftManualAdjustments((prev) => {
      if (editingMovementId) {
        return prev.map((item) => (item.id === next.id ? next : item));
      }
      return [next, ...prev];
    });
    resetMovementForm();
  }, [editingMovementId, movementForm, resetMovementForm]);
  const handleSaveAndClose = useCallback(() => {
    const amount = Number(movementForm.amount);
    setSavingMovement(true);
    window.setTimeout(() => {
      const ledgerToCommit = Number.isFinite(amount) && amount > 0
        ? (() => {
            const effectiveDate = movementForm.effectiveDate || new Date().toISOString().slice(0, 7);
            const next: ManualCapitalAdjustment = {
              id: editingMovementId ?? `manual-${Date.now()}`,
              direction: movementForm.direction,
              amount,
              currency: movementForm.currency,
              effectiveDate,
              destination: movementForm.destination,
              note: movementForm.note?.trim() || undefined,
            };
            if (editingMovementId) {
              return draftManualAdjustments.map((item) => (item.id === next.id ? next : item));
            }
            return [next, ...draftManualAdjustments];
          })()
        : draftManualAdjustments;
      onCommitManualCapitalAdjustments(ledgerToCommit);
      closeCapitalLedger();
    }, 0);
  }, [closeCapitalLedger, draftManualAdjustments, editingMovementId, movementForm, onCommitManualCapitalAdjustments]);

  useEffect(() => {
    if (riskCapitalEnabled || riskCapitalCLP > 0) {
      setAdvancedOpen(true);
    }
  }, [riskCapitalEnabled, riskCapitalCLP]);

  useEffect(() => {
    if (simActive && !prevSimActive.current) {
      setShowSimToast(true);
      const timeout = window.setTimeout(() => setShowSimToast(false), 2600);
      return () => window.clearTimeout(timeout);
    }
    prevSimActive.current = simActive;
    return undefined;
  }, [simActive]);

  useEffect(() => {
    if (!simActive) {
      setActiveChip(null);
      setDraftValue('');
    }
  }, [simActive]);

  const displayResult = hideResultBlocks ? null : resultCentral;
  const heroResult = heroPhase === 'ready' ? displayResult : heroPhase === 'stale' ? lastStableCentral : null;
  const showGhostResult = heroPhase === 'stale' && simUiState !== 'error';
  const showBootPlaceholder = heroPhase === 'boot';
  const riskToggleCopy = riskCapitalEnabled ? 'ON' : 'OFF';
  const probSuccess = displayResult ? 1 - displayResult.probRuin : null;
  const heroProbSuccess = heroResult ? 1 - heroResult.probRuin : null;
  const ruinMedian = displayResult?.ruinTimingMedian ?? null;
  const ruinP25 = displayResult?.ruinTimingP25 ?? null;
  const ruinP75 = displayResult?.ruinTimingP75 ?? null;
  const ruinWindowLabel = ruinP25 !== null && ruinP75 !== null
    ? `${Math.round(ruinP25 / 12)}–${Math.round(ruinP75 / 12)}`
    : '—';
  const ruinTypicalLabel = ruinMedian !== null ? `${Math.round(ruinMedian / 12)}` : '—';
  const spendRatio = displayResult?.spendingRatioMedian ?? null;
  const p50AllPaths = displayResult?.p50TerminalAllPaths ?? displayResult?.terminalWealthPercentiles[50] ?? null;
  const p50Survivors = displayResult?.p50TerminalSurvivors ?? displayResult?.terminalWealthPercentiles[50] ?? null;
  const rawFanChart = displayResult && Array.isArray(displayResult.fanChartData)
    ? displayResult.fanChartData
    : [];
  const fanChartData: FanChartDatum[] = rawFanChart.map((point) => ({
    ...point,
    outerBase: point.p5,
    outerSpan: Math.max(0, point.p95 - point.p5),
    innerBase: point.p25,
    innerSpan: Math.max(0, point.p75 - point.p25),
  }));
  const percentileRows = [10, 25, 50, 75, 90] as const;
  const eurRate = params.fx.clpUsdInitial * params.fx.usdEurFixed;
  const rawFanYears = rawFanChart.at(-1)?.year ?? 40;
  const fanChartYears = Number.isFinite(rawFanYears)
    ? Math.max(5, Math.ceil(rawFanYears / 5) * 5)
    : 40;
  const fanChartTicks = Array.from({ length: Math.floor(fanChartYears / 5) }, (_, idx) => (idx + 1) * 5);
  const successValues = [
    probSuccess !== null ? probSuccess * 100 : null,
  ].filter((value): value is number => Number.isFinite(value));
  const axisMinCandidate = successValues.length
    ? Math.max(0, Math.floor((Math.min(...successValues) - 5) / 5) * 5)
    : 60;
  const axisMaxCandidate = successValues.length
    ? Math.min(100, Math.ceil((Math.max(...successValues) + 5) / 5) * 5)
    : 100;
  const successAxisMin = Math.max(0, Math.min(axisMinCandidate, axisMaxCandidate - 5));
  const successAxisMax = Math.min(100, Math.max(axisMaxCandidate, successAxisMin + 5));
  const successAxisSpan = Math.max(1, successAxisMax - successAxisMin);
  const mapSuccessPct = (value: number) =>
    Math.min(100, Math.max(0, ((value - successAxisMin) / successAxisSpan) * 100));
  const openChip = (chip: 'return' | 'years' | 'capital') => {
    onSimulationTouch('custom');
    setActiveChip(chip);
    if (chip === 'return') setDraftValue((effectiveReturn * 100).toFixed(2));
    if (chip === 'years') setDraftValue(String(effectiveYears));
    if (chip === 'capital') setDraftValue(String(Math.round(effectiveCapital)));
  };

  const applyChip = () => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      setActiveChip(null);
      return;
    }
    const next: SimulationOverrides = {
      active: true,
      preset: 'custom',
      ...(simOverrides?.returnPct !== undefined ? { returnPct: simOverrides.returnPct } : {}),
      ...(simOverrides?.horizonYears !== undefined ? { horizonYears: simOverrides.horizonYears } : {}),
      ...(simOverrides?.capital !== undefined ? { capital: simOverrides.capital } : {}),
    };
    if (activeChip === 'return') next.returnPct = parsed / 100;
    if (activeChip === 'years') next.horizonYears = Math.max(1, Math.round(parsed));
    if (activeChip === 'capital') next.capital = Math.max(1, parsed);
    onSimOverridesChange(next);
    setActiveChip(null);
  };

  const formatCLP = (value: number) =>
    value.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  const formatMovementAmount = (amount: number, currency: 'CLP' | 'USD' | 'EUR') => {
    if (currency === 'CLP') return `$${formatCLP(Math.round(amount))} CLP`;
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
  };
  const parseCLP = (raw: string) => {
    const cleaned = raw.replace(/\./g, '').replace(/,/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const updateSpendingPhase = (index: number, amount: number) => {
    onUpdateParams((prev) => {
      const next = { ...prev, spendingPhases: prev.spendingPhases.map((p, i) => (i === index ? { ...p, amountReal: amount } : p)) };
      return next;
    });
  };

  const updateRvRfMix = (rvPct: number) => {
    const rvTarget = Math.min(100, Math.max(0, rvPct)) / 100;
    onUpdateParams((prev) => {
      const rvTotal = prev.weights.rvGlobal + prev.weights.rvChile;
      const rfTotal = prev.weights.rfGlobal + prev.weights.rfChile;
      const rvRatio = rvTotal > 0 ? prev.weights.rvGlobal / rvTotal : 0.5;
      const rfRatio = rfTotal > 0 ? prev.weights.rfGlobal / rfTotal : 0.5;
      const nextRvGlobal = rvTarget * rvRatio;
      const nextRvChile = rvTarget * (1 - rvRatio);
      const rfTarget = 1 - rvTarget;
      const nextRfGlobal = rfTarget * rfRatio;
      const nextRfChile = rfTarget * (1 - rfRatio);
      return {
        ...prev,
        weights: {
          rvGlobal: nextRvGlobal,
          rvChile: nextRvChile,
          rfGlobal: nextRfGlobal,
          rfChile: nextRfChile,
        },
      };
    });
  };

  const updateGlobalLocalMix = (globalPct: number) => {
    const globalTarget = Math.min(100, Math.max(0, globalPct)) / 100;
    onUpdateParams((prev) => {
      const globalTotal = prev.weights.rvGlobal + prev.weights.rfGlobal;
      const localTotal = prev.weights.rvChile + prev.weights.rfChile;
      const globalRvRatio = globalTotal > 0 ? prev.weights.rvGlobal / globalTotal : 0.5;
      const localRvRatio = localTotal > 0 ? prev.weights.rvChile / localTotal : 0.5;
      const nextGlobalRv = globalTarget * globalRvRatio;
      const nextGlobalRf = globalTarget * (1 - globalRvRatio);
      const localTarget = 1 - globalTarget;
      const nextLocalRv = localTarget * localRvRatio;
      const nextLocalRf = localTarget * (1 - localRvRatio);
      return {
        ...prev,
        weights: {
          rvGlobal: nextGlobalRv,
          rfGlobal: nextGlobalRf,
          rvChile: nextLocalRv,
          rfChile: nextLocalRf,
        },
      };
    });
  };

  const handleEditBase = () => {
    if (window.confirm('Vas a modificar la configuración base guardada. ¿Quieres continuar?')) {
      window.alert('Editar modelo base aún no está disponible.');
    }
  };

  const toggleLiquidarDepto = () => {
    onUpdateParams((prev) => ({
      ...prev,
      realEstatePolicy: {
        enabled: !(prev.realEstatePolicy?.enabled ?? true),
        triggerRunwayMonths: prev.realEstatePolicy?.triggerRunwayMonths ?? 36,
        saleDelayMonths: prev.realEstatePolicy?.saleDelayMonths ?? 12,
        saleCostPct: prev.realEstatePolicy?.saleCostPct ?? 0,
      },
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 35,
          background: 'rgba(11, 16, 24, 0.92)',
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: '8px 10px',
          backdropFilter: 'blur(6px)',
        }}
      >
        {isRecalculating ? (
          <div style={{ color: T.primary, fontSize: 12, fontWeight: 700 }}>Calculando…</div>
        ) : displayResult && probSuccess !== null ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ color: T.textMuted, fontSize: 10 }}>Éxito</div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{(probSuccess * 100).toFixed(1)}%</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ color: T.textMuted, fontSize: 10 }}>Ruina {ruinWindowLabel}</div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{(100 - (probSuccess * 100)).toFixed(1)}%</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ color: T.textMuted, fontSize: 10 }}>Ruina típica</div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{ruinTypicalLabel}</div>
            </div>
          </div>
        ) : (
          <div style={{ color: T.textMuted, fontSize: 12, fontWeight: 700 }}>Simulación en espera</div>
        )}
      </div>
      {pendingSnapshotLabel && (
        <div
          style={{
            background: 'rgba(91, 140, 255, 0.10)',
            border: '1px solid rgba(91, 140, 255, 0.45)',
            borderRadius: 12,
            padding: '8px 10px',
            color: T.textPrimary,
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span>Nueva base Aurum disponible · {pendingSnapshotLabel}</span>
          <button
            type="button"
            onClick={onApplyPendingSnapshot}
            disabled={pendingSnapshotApplying}
            style={{
              background: T.primary,
              border: 'none',
              color: '#fff',
              borderRadius: 10,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: pendingSnapshotApplying ? 'not-allowed' : 'pointer',
              opacity: pendingSnapshotApplying ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {pendingSnapshotApplying ? 'Aplicando Aurum...' : 'Aplicar Aurum'}
          </button>
        </div>
      )}
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 10,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[SCENARIO_VARIANTS[1], SCENARIO_VARIANTS[0], SCENARIO_VARIANTS[2]].map((variant) => {
            const active = simulationPreset === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                onClick={() => onScenarioChange(variant.id)}
                disabled={isRecalculating}
                style={{
                  background: active ? T.primary : T.surfaceEl,
                  border: `1px solid ${active ? T.primary : T.border}`,
                  color: active ? '#fff' : T.textSecondary,
                  borderRadius: 999,
                  padding: '6px 11px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: isRecalculating ? 'not-allowed' : 'pointer',
                  opacity: isRecalculating ? 0.65 : 1,
                }}
              >
                {variant.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          <button
            type="button"
            onClick={toggleLiquidarDepto}
            disabled={isRecalculating}
            style={{
              background: liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.16)' : T.surfaceEl,
              border: `1px solid ${liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.55)' : T.border}`,
              color: liquidarDeptoEnabled ? T.positive : T.textSecondary,
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 11,
              fontWeight: 700,
              textAlign: 'left',
              cursor: isRecalculating ? 'not-allowed' : 'pointer',
              opacity: isRecalculating ? 0.65 : 1,
            }}
          >
            Incluir venta de departamento · {liquidarDeptoEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={onToggleRiskCapital}
            disabled={isRecalculating}
            style={{
              background: riskCapitalEnabled ? 'rgba(255, 176, 32, 0.18)' : T.surfaceEl,
              border: `1px solid ${riskCapitalEnabled ? 'rgba(255, 176, 32, 0.55)' : T.border}`,
              color: riskCapitalEnabled
                ? '#f6d38d'
                : T.textSecondary,
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 11,
              fontWeight: 700,
              textAlign: 'left',
              cursor: isRecalculating ? 'not-allowed' : 'pointer',
              opacity: isRecalculating ? 0.65 : 1,
            }}
          >
            Incluir capital de riesgo · {riskToggleCopy}
          </button>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <style>{`
          @keyframes midasPulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.25); opacity: 1; }
          }
        `}</style>
        <HeroCard
          label="¿LLEGARÁS AL AÑO 40?"
          valuePct={showBootPlaceholder ? null : heroProbSuccess}
          stale={showGhostResult}
          subtitle={
            simUiState === 'error'
              ? `Error de recálculo: ${simUiError || 'reintenta'}`
              : heroPhase !== 'ready'
              ? 'Calculando simulación...'
              : displayResult
                ? `${Math.round(displayResult.nRuin)} de ${displayResult.nTotal} simulaciones en ruina`
                : 'Corre una simulación para ver resultados'
          }
          ruinCopy={ruinMedian ? `Timing mediano Año ${(ruinMedian / 12).toFixed(1)}` : 'Timing mediano: —'}
          mode={simActive ? 'sim' : 'real'}
          chips={[
            { id: 'state', value: stateLabel, onClick: simActive ? onResetSim : () => {} },
            { id: 'return', value: `${(effectiveReturn * 100).toFixed(1)}%`, onClick: () => openChip('return') },
            { id: 'years', value: `${formatNumber(effectiveYears)} años`, onClick: () => openChip('years') },
            {
              id: 'capital',
              value: formatCapital(effectiveCapital),
              onClick: () => openChip('capital'),
              accessory: (
                <button
                  type="button"
                  onClick={() => {
                    resetMovementForm();
                    openCapitalLedger();
                  }}
                  style={{
                    background: T.primary,
                    border: 'none',
                    color: '#fff',
                    borderRadius: 999,
                    padding: '4px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              ),
            },
          ]}
        />
        {showSimToast && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 6,
              background: T.surfaceEl,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '8px 12px',
              color: T.textSecondary,
              fontSize: 11,
            }}
          >
            Esta simulación no se guardará.
          </div>
        )}
        {activeChip && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: showSimToast ? 42 : 6,
              width: 320,
              background: 'rgba(21, 25, 34, 0.98)',
              border: `1px solid rgba(91, 140, 255, 0.26)`,
              borderRadius: 12,
              padding: 12,
              boxShadow: '0 18px 34px rgba(0,0,0,0.36)',
              backdropFilter: 'blur(10px)',
              zIndex: 40,
            }}
          >
            <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 8 }}>
              {activeChip === 'return'
                ? 'Retorno promedio (%)'
                : activeChip === 'years'
                  ? 'Horizonte (años)'
                  : 'Capital inicial (CLP)'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="number"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                style={{
                  flex: 1,
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  color: T.textPrimary,
                }}
              />
              <button
                onClick={applyChip}
                style={{
                  background: T.primary,
                  border: 'none',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Aplicar
              </button>
              <button
                onClick={() => setActiveChip(null)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  color: T.textSecondary,
                  borderRadius: 10,
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {simWorking && simActive && (
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: showSimToast ? 88 : 30, color: T.textMuted, fontSize: 11 }}>
            Recalculando simulación...
          </div>
        )}
      </div>

      {!hideResultBlocks && displayResult && probSuccess !== null && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PROBABILIDAD DE ÉXITO</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{`${Math.round(successAxisMin)}%`}</span>
            <div style={{ position: 'relative', flex: 1, height: 8, background: T.border, borderRadius: 999 }}>
              {probSuccess !== null && (() => {
                const successPct = probSuccess * 100;
                const left = mapSuccessPct(successPct);
                const zoneColor = successPct >= 90 ? T.positive : successPct >= 80 ? T.warning : T.negative;
                return (
                  <span
                    title={`Éxito: ${successPct.toFixed(1)}%`}
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: `2px solid ${zoneColor}`,
                      background: zoneColor,
                      opacity: 0.95,
                      display: 'block',
                    }}
                  />
                );
              })()}
            </div>
            <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{`${Math.round(successAxisMax)}%`}</span>
          </div>
        </div>
      )}

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <button
          onClick={() => setAdvancedOpen((prev) => !prev)}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            color: T.textPrimary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <span>Otros parámetros</span>
          <span style={{ color: T.textMuted }}>{advancedOpen ? '▴' : '▾'}</span>
        </button>
        {advancedOpen && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Gasto por tramo</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                {params.spendingPhases.map((phase, idx) => (
                  <label key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ color: T.textSecondary, fontSize: 11 }}>
                      Tramo {idx + 1} ({Math.round(phase.durationMonths / 12)} años)
                    </span>
                    <input
                      type="text"
                      value={formatCLP(phase.amountReal)}
                      onChange={(e) => updateSpendingPhase(idx, parseCLP(e.target.value))}
                      style={{
                        background: T.surfaceEl,
                        border: `1px solid ${T.border}`,
                        borderRadius: 10,
                        padding: '8px 10px',
                        color: T.textPrimary,
                        fontSize: 12,
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Mix renta variable / renta fija</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: T.textSecondary, fontSize: 11 }}>RV (%)</span>
                  <input
                    type="number"
                    value={Math.round((params.weights.rvGlobal + params.weights.rvChile) * 100)}
                    onChange={(e) => updateRvRfMix(Number(e.target.value))}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '8px 10px',
                      color: T.textPrimary,
                      fontSize: 12,
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: T.textSecondary, fontSize: 11 }}>RF (%)</span>
                  <input
                    type="number"
                    value={Math.round((params.weights.rfGlobal + params.weights.rfChile) * 100)}
                    onChange={(e) => updateRvRfMix(100 - Number(e.target.value))}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '8px 10px',
                      color: T.textPrimary,
                      fontSize: 12,
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Mix global / local</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: T.textSecondary, fontSize: 11 }}>Global (%)</span>
                  <input
                    type="number"
                    value={Math.round((params.weights.rvGlobal + params.weights.rfGlobal) * 100)}
                    onChange={(e) => updateGlobalLocalMix(Number(e.target.value))}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '8px 10px',
                      color: T.textPrimary,
                      fontSize: 12,
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: T.textSecondary, fontSize: 11 }}>Local (%)</span>
                  <input
                    type="number"
                    value={Math.round((params.weights.rvChile + params.weights.rfChile) * 100)}
                    onChange={(e) => updateGlobalLocalMix(100 - Number(e.target.value))}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: '8px 10px',
                      color: T.textPrimary,
                      fontSize: 12,
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Fee anual</div>
              <input
                type="number"
                value={(params.feeAnnual * 100).toFixed(2)}
                onChange={(e) => onUpdateParams((prev) => ({ ...prev, feeAnnual: Number(e.target.value) / 100 }))}
                style={{
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  color: T.textPrimary,
                  fontSize: 12,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {!hideResultBlocks && (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
          gap: 10,
        }}
      >
        <InfoCard
          label="Gasto modelado / planificado"
          value={spendRatio !== null ? `${(spendRatio * 100).toFixed(1)}%` : '—'}
        />
        <InfoCard
          label="Patrimonio P50 (todos los paths)"
          value={p50AllPaths !== null ? `$${formatMillionsMM(p50AllPaths / 1e6)}` : '—'}
        />
      </div>
      )}

      {!hideResultBlocks && displayResult && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>FAN CHART</div>
              <div
                style={{
                  color: T.textSecondary,
                  fontSize: 11,
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  borderRadius: 999,
                  padding: '5px 10px',
                }}
              >
                Escenario activo: {stateLabel}
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={fanChartData} margin={{ top: 8, right: 6, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                  <XAxis
                    dataKey="year"
                    type="number"
                    domain={[0, fanChartYears]}
                    ticks={fanChartTicks}
                    tick={{ fill: T.textMuted, fontSize: 10 }}
                    tickFormatter={(v: number | string) => String(v)}
                    stroke={T.border}
                    tickMargin={8}
                    label={{ value: 'Años', position: 'insideBottom', offset: -2, fill: T.textMuted, fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: T.textMuted, fontSize: 10 }}
                    tickFormatter={(v: number | string) => formatMillionsMM(Number(v))}
                    stroke={T.border}
                    width={46}
                  />
                  <Tooltip
                    contentStyle={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      color: T.textPrimary,
                      fontSize: 11,
                    }}
                    formatter={(value: unknown) => [`${formatMillionsMM(Number(value))} CLP`]}
                    labelFormatter={(label: unknown) => `Año ${String(label)}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="outerBase"
                    stackId="outer"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="outerSpan"
                    stackId="outer"
                    stroke="none"
                    fill={T.fan1}
                    fillOpacity={0.4}
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="innerBase"
                    stackId="inner"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="innerSpan"
                    stackId="inner"
                    stroke="none"
                    fill={T.fan2}
                    fillOpacity={0.5}
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Line type="monotone" dataKey="p50" stroke={T.primary} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="p10" stroke={T.negative} strokeWidth={1} strokeDasharray="3 3" dot={false} />
                  <ReferenceLine y={0} stroke={T.negative} strokeDasharray="4 2" />
                  <ReferenceLine x={5} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={10} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={15} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={20} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={25} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={30} stroke={T.metalDeep} strokeDasharray="2 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8, color: T.textSecondary, fontSize: 11 }}>
              <span>Años en cortes de 5</span>
              <span>Fases marcadas en la barra</span>
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>
              PERCENTILES (sobrevivientes)
            </div>
            <div style={{ marginTop: 8, overflow: 'hidden', border: `1px solid ${T.border}`, borderRadius: 10 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '56px repeat(3, minmax(0, 1fr))',
                  gap: 0,
                  background: T.surfaceEl,
                  color: T.textMuted,
                  fontSize: 11,
                  padding: '10px 12px',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span>P</span>
                <span>CLP real</span>
                <span>EUR equiv</span>
                <span>DD máx</span>
              </div>
              {percentileRows.map((p) => {
                const clp = displayResult.terminalWealthPercentiles[p];
                const eur = clp / eurRate / 1e6;
                const dd = displayResult.maxDrawdownPercentiles[p];
                const highlight = p === 50;
                return (
                  <div
                    key={p}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '56px repeat(3, minmax(0, 1fr))',
                      gap: 0,
                      padding: '10px 12px',
                      background: highlight ? 'rgba(91, 140, 255, 0.10)' : T.surface,
                      borderBottom: p === 90 ? 'none' : `1px solid ${T.border}`,
                      color: highlight ? T.primary : T.textPrimary,
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: highlight ? T.primary : T.textMuted }}>P{p}</span>
                  <span style={{ ...css.mono, fontWeight: 700 }}>{`$${formatMillionsMM(clp / 1e6)}`}</span>
                  <span style={{ ...css.mono }}>{`€${formatMillionsMM(eur)}`}</span>
                    <span style={{ ...css.mono }}>{`${(dd * 100).toFixed(1)}%`}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em', marginBottom: 4 }}>TCREAL</div>
            <div style={{ color: T.warning, fontSize: 12 }}>
              PRELIMINARY: Este parámetro usa supuestos internos, revísalo antes de tomar decisiones.
            </div>
          </div>
        </>
      )}

      {(motorWarnings.length > 0 || compositionMode !== 'legacy' || lastRebalanceMonth || aurumIntegrationStatus !== 'available' || baseUpdatePending || Boolean(lastRecalcCause)) && (
        <details
          style={{
            marginTop: 12,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: '10px 12px',
            color: T.textSecondary,
            fontSize: 11,
          }}
        >
          <summary style={{ cursor: 'pointer', color: T.textPrimary, fontWeight: 700 }}>
            Detalles técnicos
          </summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: T.textMuted }}>{aurumTechnicalLabel}</div>
            <div style={{ color: T.textMuted }}>{simTechnicalLabel}</div>
            <div style={{ color: T.textMuted }}>
              heroPhase={heroPhase} · simUiState={simUiState} · worker={recalcWorkerStatus}
            </div>
            <div style={{ color: T.textMuted }}>
              requestId activo={activeRecalcRequestId ?? '—'} · aplicado={appliedRecalcRequestId ?? '—'}
            </div>
            <div style={{ color: T.textMuted }}>
              snapshotApplied={snapshotApplied ? 'yes' : 'no'} · pendingSnapshotApplying={pendingSnapshotApplying ? 'yes' : 'no'}
            </div>
            <div style={{ color: T.textMuted }}>
              riskEnabled={riskCapitalEnabled ? 'yes' : 'no'} · riskEffective={riskCapitalEffective ? 'yes' : 'no'}
            </div>
            <div style={{ color: T.textMuted }}>
              simResult={resultCentral ? 'present' : 'missing'} · lastStable={lastStableCentral ? 'present' : 'missing'}
            </div>
            <div style={{ color: T.textMuted }}>
              capitalVisible={formatCapital(effectiveCapital)}
            </div>
            {lastRecalcCause ? (
              <div style={{ color: T.textMuted }}>Último trigger de recálculo: {lastRecalcCause}</div>
            ) : null}
            <div style={{ color: compositionStatusVisual.color, fontWeight: 700 }}>{compositionStatusVisual.copy}</div>
            <div style={{ color: T.textMuted }}>{compositionStatusVisual.detail}</div>
            {displayResult ? (
              <>
                <div style={{ color: T.textMuted }}>
                  P50 terminal (todos los paths): ${formatMillionsMM((displayResult.p50TerminalAllPaths ?? 0) / 1e6)}
                </div>
                <div style={{ color: T.textMuted }}>
                  P50 terminal (solo sobrevivientes): ${formatMillionsMM((displayResult.p50TerminalSurvivors ?? 0) / 1e6)}
                </div>
              </>
            ) : null}
            {motorWarnings.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {motorWarnings.map((warning) => (
                  <span
                    key={warning}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'rgba(255, 176, 32, 0.16)',
                      border: '1px solid rgba(255, 176, 32, 0.45)',
                      color: T.warning,
                      fontSize: 10,
                    }}
                  >
                    {warning}
                  </span>
                ))}
              </div>
            )}
            {lastRebalanceMonth ? (
              <span style={{ color: T.textMuted }}>
                Último rebalanceo anual: mes {lastRebalanceMonth}
              </span>
            ) : null}
          </div>
        </details>
      )}

      {capitalLedgerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeCapitalLedger}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(6, 10, 24, 0.65)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 520,
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ color: T.textPrimary, fontWeight: 700 }}>Ajustes manuales de capital</div>
              <button
                type="button"
                onClick={handleSaveAndClose}
                disabled={savingMovement}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  borderRadius: 999,
                  padding: '6px 10px',
                  color: T.textSecondary,
                  fontSize: 12,
                  cursor: savingMovement ? 'not-allowed' : 'pointer',
                  opacity: savingMovement ? 0.6 : 1,
                }}
              >
                {savingMovement ? 'Guardando...' : 'Guardar y salir'}
              </button>
            </div>

            <div style={{ marginTop: 10, color: T.textMuted, fontSize: 11 }}>
              Neto acumulado: {formatCLP(Math.round(manualNetClp))} CLP
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 240, overflow: 'auto' }}>
              {manualAdjustmentsSorted.length === 0 ? (
                <div style={{ color: T.textSecondary, fontSize: 12 }}>
                  No hay movimientos cargados.
                </div>
              ) : (
                manualAdjustmentsSorted.map((adj) => {
                  const sign = adj.direction === 'add' ? '+' : '-';
                  const destinationLabel = destinationOptions.find((d) => d.value === adj.destination)?.label ?? 'Otros';
                  return (
                    <div key={adj.id} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
                      <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
                        {adj.effectiveDate} · {sign}{formatMovementAmount(adj.amount, adj.currency)} · {destinationLabel}
                      </div>
                      {adj.note && (
                        <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>
                          {adj.note}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => startEditMovement(adj)}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${T.border}`,
                            color: T.textSecondary,
                            borderRadius: 999,
                            padding: '4px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraftManualAdjustments((prev) => prev.filter((item) => item.id !== adj.id));
                            if (editingMovementId === adj.id) {
                              resetMovementForm();
                            }
                          }}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${T.negative}`,
                            color: T.negative,
                            borderRadius: 999,
                            padding: '4px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          Borrar
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Tipo</span>
                <select
                  value={movementForm.direction}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, direction: e.target.value as 'add' | 'remove' }))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', color: T.textPrimary }}
                >
                  <option value="add">Sumar</option>
                  <option value="remove">Restar</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Monto</span>
                <input
                  type="number"
                  value={movementForm.amount}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, amount: e.target.value }))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', color: T.textPrimary }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Moneda</span>
                <select
                  value={movementForm.currency}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, currency: e.target.value as 'CLP' | 'USD' | 'EUR' }))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', color: T.textPrimary }}
                >
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Fecha efectiva</span>
                <input
                  type="month"
                  value={movementForm.effectiveDate}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', color: T.textPrimary }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Destino</span>
                <select
                  value={movementForm.destination}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, destination: e.target.value as ManualCapitalDestination }))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', color: T.textPrimary }}
                >
                  {destinationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Nota</span>
                <input
                  type="text"
                  value={movementForm.note}
                  onChange={(e) => setMovementForm((prev) => ({ ...prev, note: e.target.value }))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', color: T.textPrimary }}
                />
              </label>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleSaveMovement}
                disabled={savingMovement}
                style={{
                  background: T.primary,
                  border: 'none',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '8px 14px',
                  fontWeight: 700,
                  cursor: savingMovement ? 'not-allowed' : 'pointer',
                  opacity: savingMovement ? 0.7 : 1,
                }}
              >
                {savingMovement ? 'Guardando...' : editingMovementId ? 'Guardar cambios' : 'Agregar movimiento'}
              </button>
              <button
                type="button"
                onClick={closeCapitalLedger}
                disabled={savingMovement}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  color: T.textSecondary,
                  borderRadius: 10,
                  padding: '8px 14px',
                  cursor: savingMovement ? 'not-allowed' : 'pointer',
                  opacity: savingMovement ? 0.6 : 1,
                }}
              >
                Cancelar
              </button>
              {editingMovementId && (
                <button
                  type="button"
                  onClick={resetMovementForm}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    color: T.textSecondary,
                    borderRadius: 10,
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar edición
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleEditBase}
        style={{
          alignSelf: 'center',
          marginTop: 10,
          background: 'transparent',
          border: `1px solid ${T.border}`,
          borderRadius: 999,
          padding: '8px 14px',
          color: T.textMuted,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Editar modelo base
      </button>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, fontSize: 18, fontWeight: 700, color: T.textPrimary, marginTop: 6 }}>{value}</div>
    </div>
  );
}
