import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CapitalSource,
  ManualCapitalAdjustment,
  ManualCapitalDestination,
  ModelParameters,
  PortfolioWeights,
  SimulationResults,
  ScenarioVariantId,
} from '../domain/model/types';
import { SCENARIO_VARIANTS } from '../domain/model/defaults';
import { buildSpendingPhaseUiLabels, normalizeModelSpendingPhases } from '../domain/model/spendingPhases';
import type { WeightsSourceMode } from '../domain/model/officialDistribution';
import type { OperativeFxResolution } from '../domain/model/operativeFx';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import { buildMidasEvaluation } from '../domain/model/midasEvaluation';
import type { SourceFreshnessPolicy } from '../domain/model/sourceFreshnessPolicy';
import type { SimulationResultDiagnostics } from '../domain/model/simulationResultDigest';
import type { ResultConfidence } from '../domain/model/resultConfidence';
import type { AssumptionModeDiagnostics } from '../domain/model/assumptionMode';
import type { M8Input } from '../domain/simulation/m8.types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import {
  buildRunCapitalBreakdown,
  DEFAULT_INCLUDE_NON_EXIGIBLE_DEBT_IN_RUN_CAPITAL,
} from '../domain/simulation/runCapitalPolicy';
import { T, css } from './theme';
import { HeroCard } from './HeroCard';
import { InfoHint } from './InfoHint';
import { QualityOfLifeMetricsBlock } from './QualityOfLifeMetricsBlock';
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
  ruinBandTop: number;
};

type LongevityPlus5Result = {
  success45: number;
  drop40To45Pp: number;
  carryAmong40: number | null;
  terminalP50All45: number | null;
};

type TraceSeverity = 'OK' | 'Aviso' | 'Alerta';

type TraceSource = {
  human: string;
  technical: string;
  value: string;
};

type AppliedTraceRow = {
  id: string;
  name: string;
  severity: TraceSeverity;
  usingNow: string;
  valueApplied: string;
  appliedAt: string;
  principal: TraceSource;
  fallback: TraceSource | null;
  reason: string;
  impact: string;
};

type FreshnessStatus = 'fresh' | 'aging' | 'stale' | 'unknown';
type CanonicalInputDisplayState = 'hydrating' | 'ready' | 'blocked' | 'missingCanonicalConfig' | 'timeout' | 'error';

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
const formatMoneyCompact = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}MM`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}MM`;
  }
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatAgeDaysCompact = (ageDays: number | null) => {
  if (ageDays === null || !Number.isFinite(ageDays)) return 'fecha no disponible';
  const roundedDays = Math.max(0, Math.round(ageDays));
  return `${roundedDays} ${roundedDays === 1 ? 'día' : 'días'}`;
};

export function buildMixSourceCompactLabel(input: {
  weightsSourceMode: WeightsSourceMode;
  instrumentUniverseCloudReadStatus: string | null;
  universeSourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
  sourcePolicy: SourceFreshnessPolicy | null;
}) {
  const { weightsSourceMode, instrumentUniverseCloudReadStatus, universeSourceOrigin, sourcePolicy } = input;
  if (weightsSourceMode === 'instrument-universe') {
    if (instrumentUniverseCloudReadStatus === 'loading') return 'Mix cloud pendiente';
    if (instrumentUniverseCloudReadStatus === 'timeout') return 'Instrument Universe timeout';
    if (instrumentUniverseCloudReadStatus === 'missing') return 'Falta Universe cloud';
    if (instrumentUniverseCloudReadStatus === 'error') return 'Error Universe cloud';
    if (universeSourceOrigin === 'firestore') {
      const instrumentUniverseSource = sourcePolicy?.sources.find((entry) => entry.id === 'instrumentUniverse') ?? null;
      if (!instrumentUniverseSource || instrumentUniverseSource.source !== 'cloud') return 'Mix cloud';
      const freshnessStatus = instrumentUniverseSource.freshness.expired ? 'actualizar' : 'vigente';
      return `Mix cloud · ${formatAgeDaysCompact(instrumentUniverseSource.freshness.ageDays)} · ${freshnessStatus}`;
    }
    if (universeSourceOrigin === 'bundled') return 'Mix respaldo';
    return 'Mix local';
  }
  if (weightsSourceMode === 'simulation') return 'Mix override';
  return 'Mix fallback';
}

const formatMonthYearLabel = (value: string | null | undefined): string => {
  if (!value) return 'Sin eventos futuros';
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return value;
  const parsed = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const formatSessionMoment = (atMs: number | null) => {
  if (atMs === null || !Number.isFinite(atMs) || atMs < 0) return 'Sin registro';
  const seconds = atMs / 1000;
  if (seconds < 60) return `t+${seconds.toFixed(1)}s`;
  return `t+${(seconds / 60).toFixed(1)}min`;
};

const CANONICAL_HYDRATION_TIMEOUT_MS = 12_000;
const HYDRATING_CANONICAL_BLOCK_REASONS = new Set([
  'auth_loading',
  'config_loading',
  'instrument_universe_loading',
  'aurum_snapshot_missing',
]);

function isCanonicalHydrationInProgress(blockedReason: string): boolean {
  return HYDRATING_CANONICAL_BLOCK_REASONS.has(blockedReason);
}

function resolveCanonicalInputDisplayState(input: {
  blocked: boolean;
  blockedReason: string;
  hydrationTimedOut: boolean;
}): CanonicalInputDisplayState {
  if (!input.blocked) return 'ready';
  if (input.blockedReason === 'config_missing') return 'missingCanonicalConfig';
  if (input.blockedReason === 'instrument_universe_timeout') return 'timeout';
  if (input.blockedReason === 'config_error' || input.blockedReason === 'aurum_snapshot_error') return 'error';
  if (input.blockedReason === 'instrument_universe_error') return 'error';
  if (input.hydrationTimedOut && isCanonicalHydrationInProgress(input.blockedReason)) return 'timeout';
  if (isCanonicalHydrationInProgress(input.blockedReason)) return 'hydrating';
  return 'blocked';
}

const parseIsoTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatRelativePublishedAt = (value: string | null | undefined) => {
  const parsed = parseIsoTimestamp(value);
  if (parsed === null) return 'Sin fecha';
  const diffMs = Date.now() - parsed;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Fecha inválida';
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) return 'Hace menos de 1h';
  if (diffHours < 48) return `Hace ${Math.round(diffHours)}h`;
  const diffDays = diffHours / 24;
  if (diffDays < 14) return `Hace ${diffDays.toFixed(diffDays < 7 ? 1 : 0)}d`;
  return `Hace ${Math.round(diffDays)}d`;
};

const getFreshnessStatus = (publishedAt: string | null | undefined): FreshnessStatus => {
  const parsed = parseIsoTimestamp(publishedAt);
  if (parsed === null) return 'unknown';
  const diffMs = Date.now() - parsed;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'unknown';
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours <= 48) return 'fresh';
  if (diffHours <= 24 * 7) return 'aging';
  return 'stale';
};

const freshnessPresentation = (status: FreshnessStatus) => {
  if (status === 'fresh') return { label: 'Fresh', color: T.positive };
  if (status === 'aging') return { label: 'Revisar', color: T.warning };
  if (status === 'stale') return { label: 'Stale', color: T.negative };
  return { label: 'Sin fecha', color: T.textMuted };
};

const cloneModelParams = (params: ModelParameters): ModelParameters => JSON.parse(JSON.stringify(params)) as ModelParameters;

const buildLongevityPlus5Params = (baseParams: ModelParameters): ModelParameters => {
  const next = cloneModelParams(baseParams);
  const extendedHorizon = next.simulation.horizonMonths + 60;
  next.simulation = {
    ...next.simulation,
    horizonMonths: extendedHorizon,
  };
  // Supuesto explícito: se prolonga la última fase con el mismo gasto real por 60 meses.
  const totalDuration = next.spendingPhases.reduce((sum, phase) => sum + phase.durationMonths, 0);
  const extraMonths = Math.max(0, extendedHorizon - totalDuration);
  if (extraMonths > 0 && next.spendingPhases.length > 0) {
    const lastIndex = next.spendingPhases.length - 1;
    const lastPhase = next.spendingPhases[lastIndex];
    next.spendingPhases = next.spendingPhases.map((phase, idx) => (
      idx === lastIndex ? { ...lastPhase, durationMonths: lastPhase.durationMonths + extraMonths } : phase
    ));
  }
  return next;
};

type TrafficLight = 'green' | 'yellow' | 'red' | 'neutral';

type SourceBadgeTone = 'ok' | 'warning' | 'alert' | 'neutral';

const TRAFFIC_COLORS: Record<TrafficLight, string> = {
  green: '#32c97b',
  yellow: '#f4b740',
  red: '#ff6a6a',
  neutral: '#71829b',
};

const FX_REL_TOLERANCE = 0.0005;

function classifyThreshold(value: number | null, thresholds: { greenMax?: number; yellowMax?: number; greenMin?: number; yellowMin?: number }): TrafficLight {
  if (value === null || !Number.isFinite(value)) return 'neutral';
  if (thresholds.greenMax !== undefined && value <= thresholds.greenMax) return 'green';
  if (thresholds.yellowMax !== undefined && value <= thresholds.yellowMax) return 'yellow';
  if (thresholds.greenMin !== undefined && value >= thresholds.greenMin) return 'green';
  if (thresholds.yellowMin !== undefined && value >= thresholds.yellowMin) return 'yellow';
  return 'red';
}

const isApproximatelyEqual = (a: number, b: number) => Math.abs(a - b) / a <= FX_REL_TOLERANCE;

const sourceBadgeTonePresentation = (tone: SourceBadgeTone) => {
  if (tone === 'ok') return { color: T.positive, bg: 'rgba(61, 212, 141, 0.14)', border: 'rgba(61, 212, 141, 0.35)' };
  if (tone === 'warning') return { color: T.warning, bg: 'rgba(255, 176, 32, 0.14)', border: 'rgba(255, 176, 32, 0.35)' };
  if (tone === 'alert') return { color: T.negative, bg: 'rgba(255, 106, 106, 0.14)', border: 'rgba(255, 106, 106, 0.35)' };
  return { color: T.textMuted, bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.35)' };
};

const resolveSourcePolicyTone = (status: SourceFreshnessPolicy['status']): SourceBadgeTone => {
  if (status === 'canonical_pure') return 'ok';
  if (status === 'canonical_with_warnings') return 'warning';
  if (status === 'using_recent_fallback') return 'warning';
  return 'alert';
};

const formatRiskCapitalInBaseLabel = (status: 'yes' | 'no' | 'unknown') => {
  if (status === 'yes') return 'Sí';
  if (status === 'no') return 'No';
  return 'No determinado';
};

export function computeMidasConsideredWealth(input: {
  referenceWealthClp: number | null;
  realEstateSupportClp: number | null;
  riskCapitalClp: number;
  realEstateEnabled: boolean;
  riskCapitalEnabled: boolean;
}) {
  const reference = Number(input.referenceWealthClp ?? NaN);
  if (!Number.isFinite(reference) || reference <= 0) {
    return {
      consideredWealthClp: null,
      excludedRealEstateClp: null,
      excludedRiskCapitalClp: input.riskCapitalEnabled ? 0 : Math.max(0, input.riskCapitalClp),
      missingRealEstateSupport: !input.realEstateEnabled && input.realEstateSupportClp === null,
    };
  }
  const support = Number(input.realEstateSupportClp ?? NaN);
  const safeSupport = Number.isFinite(support) && support > 0 ? support : 0;
  const safeRisk = Number.isFinite(input.riskCapitalClp) && input.riskCapitalClp > 0 ? input.riskCapitalClp : 0;
  const excludedRealEstateClp = input.realEstateEnabled ? 0 : safeSupport;
  const excludedRiskCapitalClp = input.riskCapitalEnabled ? 0 : safeRisk;
  return {
    consideredWealthClp: Math.max(0, reference - excludedRealEstateClp - excludedRiskCapitalClp),
    excludedRealEstateClp,
    excludedRiskCapitalClp,
    missingRealEstateSupport: !input.realEstateEnabled && input.realEstateSupportClp === null,
  };
}

export function computeEnabledResourcesForUi(input: {
  coreLiquidCapitalClp: number | null;
  realEstateSupportClp: number | null;
  riskCapitalClp: number;
  realEstateEnabled: boolean;
  riskCapitalEnabled: boolean;
  manualLocalAdjustmentsImpactClp: number;
}): number | null {
  const core = Number(input.coreLiquidCapitalClp ?? NaN);
  if (!Number.isFinite(core) || core <= 0) return null;
  const realEstate = Number(input.realEstateSupportClp ?? NaN);
  const safeRealEstate = Number.isFinite(realEstate) && realEstate > 0 ? realEstate : 0;
  const safeRisk = Number.isFinite(input.riskCapitalClp) && input.riskCapitalClp > 0 ? input.riskCapitalClp : 0;
  const safeManual = Number.isFinite(input.manualLocalAdjustmentsImpactClp) ? input.manualLocalAdjustmentsImpactClp : 0;
  const enabledResources = core
    + (input.realEstateEnabled ? safeRealEstate : 0)
    + (input.riskCapitalEnabled ? safeRisk : 0)
    + safeManual;
  return Math.max(0, enabledResources);
}

export function buildEnabledResourcesSubcopy(input: {
  realEstateEnabled: boolean;
  riskCapitalEnabled: boolean;
  hasManualT0Adjustments: boolean;
  hasFutureAdjustments: boolean;
}): string {
  const baseLabel = input.realEstateEnabled
    ? (input.riskCapitalEnabled ? 'Core + Depto + Riesgo' : 'Core + Depto')
    : (input.riskCapitalEnabled ? 'Core + Riesgo' : 'Core');
  const suffixes: string[] = [];
  if (input.hasManualT0Adjustments) suffixes.push('Ajuste T0');
  if (input.hasFutureAdjustments) suffixes.push('Aj. futuros');
  if (suffixes.length === 0) return baseLabel;
  return `${baseLabel} + ${suffixes.join(' + ')}`;
}

export function summarizeManualAdjustmentsT0(
  adjustments: ManualCapitalAdjustment[],
  toClp: (amount: number, currency: 'CLP' | 'USD' | 'EUR') => number,
) {
  const todayKey = new Date().toISOString().slice(0, 7);
  return adjustments.reduce((acc, adj) => {
    if (adj.effectiveDate > todayKey) return acc;
    const amountClp = Math.max(0, toClp(adj.amount, adj.currency));
    if (adj.direction === 'add') {
      acc.positiveClp += amountClp;
      acc.netClp += amountClp;
    } else {
      acc.negativeClp += amountClp;
      acc.netClp -= amountClp;
    }
    acc.count += 1;
    return acc;
  }, {
    positiveClp: 0,
    negativeClp: 0,
    netClp: 0,
    count: 0,
  });
}

export function summarizeManualAdjustmentsFuture(
  adjustments: ManualCapitalAdjustment[],
  toClp: (amount: number, currency: 'CLP' | 'USD' | 'EUR') => number,
) {
  const todayKey = new Date().toISOString().slice(0, 7);
  return adjustments.reduce((acc, adj) => {
    if (adj.effectiveDate <= todayKey) return acc;
    const amountClp = Math.max(0, toClp(adj.amount, adj.currency));
    if (adj.direction === 'add') {
      acc.positiveClp += amountClp;
      acc.netClp += amountClp;
    } else {
      acc.negativeClp += amountClp;
      acc.netClp -= amountClp;
    }
    acc.count += 1;
    if (acc.firstFutureDate === null || adj.effectiveDate < acc.firstFutureDate) {
      acc.firstFutureDate = adj.effectiveDate;
    }
    return acc;
  }, {
    positiveClp: 0,
    negativeClp: 0,
    netClp: 0,
    count: 0,
    firstFutureDate: null as string | null,
  });
}

export function deriveSleevesFromRvRfTarget(
  current: PortfolioWeights,
  targetRvPct: number,
): PortfolioWeights {
  const rvTarget = Math.max(0, Math.min(100, targetRvPct)) / 100;
  const rfTarget = 1 - rvTarget;
  const currentRvTotal = Math.max(0, current.rvGlobal + current.rvChile);
  const currentRfTotal = Math.max(0, current.rfGlobal + current.rfChile);
  const rvGlobalShare = currentRvTotal > 0 ? current.rvGlobal / currentRvTotal : 0.5;
  const rfGlobalShare = currentRfTotal > 0 ? current.rfGlobal / currentRfTotal : 0.5;

  const rvGlobal = rvTarget * rvGlobalShare;
  const rvChile = rvTarget * (1 - rvGlobalShare);
  const rfGlobal = rfTarget * rfGlobalShare;
  const rfChile = rfTarget * (1 - rfGlobalShare);
  const total = rvGlobal + rvChile + rfGlobal + rfChile;
  if (!Number.isFinite(total) || total <= 0) {
    return { rvGlobal: 0, rvChile: 0, rfGlobal: 0, rfChile: 1 };
  }
  return {
    rvGlobal: rvGlobal / total,
    rvChile: rvChile / total,
    rfGlobal: rfGlobal / total,
    rfChile: rfChile / total,
  };
}

function SourceBadge({
  label,
  tone,
}: {
  label: string;
  tone: SourceBadgeTone;
}) {
  const ui = sourceBadgeTonePresentation(tone);
  return (
    <span
      style={{
        color: ui.color,
        background: ui.bg,
        border: `1px solid ${ui.border}`,
        borderRadius: 999,
        padding: '2px 7px',
        fontSize: 10,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

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
  isScenarioAdjusted,
  aurumIntegrationStatus,
  aurumSnapshotLabel,
  aurumSnapshotPublishedAt,
  baseUpdatePending,
  hasPendingSnapshot,
  pendingSnapshotLabel,
  pendingSnapshotApplying,
  snapshotApplied,
  aurumSyncState,
  aurumSyncDiff,
  aurumSyncBaseOpt,
  aurumSyncLatestOpt,
  manualCapitalAdjustments,
  riskCapitalEnabled,
  riskCapitalEffective,
  riskCapitalCLP,
  riskCapitalUsdSnapshotCLP,
  recalcWorkerStatus,
  activeRecalcRequestId,
  appliedRecalcRequestId,
  activeRecalcSeed,
  appliedRecalcSeed,
  activeRecalcOwner,
  runtimeTimeline,
  bootstrapControlStatus,
  bootstrapControlResult,
  controlConcordance,
  patrimonioSourceTechnical,
  distributionSourceTechnical,
  fxSpotSourceTechnical,
  nonOptimizableBlocksTechnical,
  aurumFxSpotCLP,
  aurumFxSpotUsdEur,
  aurumFxSourceUsdEur,
  aurumFxSpotSource,
  operativeFxResolution,
  weightsSourceMode,
  weightsSourceLabel,
  universeSourceOrigin,
  cloudHydrationReady,
  simulationConfigSource,
  simulationConfigSavedAt,
  m8InputFingerprint,
  simulationResultDiagnostics,
  resultConfidence,
  assumptionModeDiagnostics,
  officialReferenceWeights,
  instrumentUniverseReferenceWeights,
  instrumentBaseReferenceWeights,
  activeWeights,
  auditModeEnabled,
  auditProbe,
  localReadOnlyMode,
  applyAurumHarness,
  onApplyPendingSnapshot,
  onRunApplyAurumHarness,
  onToggleRiskCapital,
  onCommitManualCapitalAdjustments,
  onSimulationTouch,
  onScenarioChange,
  onRestoreScenarioPreset,
  onRestoreOfficialDistribution,
  onSimOverridesChange,
  onUpdateParams,
  onRunSimulation,
  onResetSim,
  onOpenOptimization,
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
  isScenarioAdjusted: boolean;
  aurumIntegrationStatus: 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
  aurumSnapshotLabel: string | null;
  aurumSnapshotPublishedAt: string | null;
  baseUpdatePending: boolean;
  hasPendingSnapshot: boolean;
  pendingSnapshotLabel: string | null;
  pendingSnapshotApplying: boolean;
  snapshotApplied: boolean;
  aurumSyncState: 'unknown' | 'synced' | 'outdated';
  aurumSyncDiff: number | null;
  aurumSyncBaseOpt: number | null;
  aurumSyncLatestOpt: number | null;
  manualCapitalAdjustments: ManualCapitalAdjustment[];
  riskCapitalEnabled: boolean;
  riskCapitalEffective: boolean;
  riskCapitalCLP: number;
  riskCapitalUsdSnapshotCLP: number;
  recalcWorkerStatus: 'idle' | 'queued' | 'running' | 'done' | 'error';
  activeRecalcRequestId: number | null;
  appliedRecalcRequestId: number | null;
  activeRecalcSeed: number | null;
  appliedRecalcSeed: number | null;
  activeRecalcOwner: 'apply-aurum' | null;
  runtimeTimeline: Array<{ atMs: number; event: string; payload: string }>;
  bootstrapControlStatus: 'idle' | 'running' | 'done' | 'error';
  bootstrapControlResult: SimulationResults | null;
  controlConcordance: {
    status: 'green' | 'yellow' | 'red' | 'double-red' | 'pending' | 'na';
    message: string | null;
    diffAbsPp: number | null;
    centralProbRuin: number | null;
    controlProbRuin: number | null;
    centralZone: string | null;
    controlZone: string | null;
  };
  patrimonioSourceTechnical: string;
  distributionSourceTechnical: string;
  fxSpotSourceTechnical: string;
  nonOptimizableBlocksTechnical: string;
  aurumFxSpotCLP: number | null;
  aurumFxSpotUsdEur: number | null;
  aurumFxSourceUsdEur: number | null;
  aurumFxSpotSource: string | null;
  operativeFxResolution: OperativeFxResolution;
  weightsSourceMode: WeightsSourceMode;
  weightsSourceLabel: string;
  universeSourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
  cloudHydrationReady: boolean;
  simulationConfigSource: 'cloud' | 'local_cache' | 'fallback';
  simulationConfigSavedAt: string | null;
  m8InputFingerprint: M8InputFingerprint;
  simulationResultDiagnostics: SimulationResultDiagnostics;
  resultConfidence: ResultConfidence;
  assumptionModeDiagnostics: AssumptionModeDiagnostics;
  officialReferenceWeights: PortfolioWeights;
  instrumentUniverseReferenceWeights: PortfolioWeights | null;
  instrumentBaseReferenceWeights: PortfolioWeights | null;
  activeWeights: PortfolioWeights;
  auditModeEnabled: boolean;
  localReadOnlyMode?: {
    enabled: boolean;
    reason: string | null;
  };
  auditProbe: {
    heroSource: 'simResult' | 'lastStableCentral' | 'none';
    requestId: number | null;
    seed: number;
    nPaths: number;
    capitalInitial: number;
    capitalSource: CapitalSource;
    sourceLabel: string;
    riskCapitalEnabled: boolean;
    houseInclude: boolean;
    futureEventsCount: number;
    inputHash: string;
    m8Input: M8Input | null;
    heroResult: Record<string, unknown> | null;
    success40: number | null;
    probRuin40: number | null;
    probRuin20: number | null;
    normalizationsApplied?: {
      horizonMinForced: boolean;
      spendingPhasesNormalized: boolean;
      notes: string[];
    };
  } | null;
  applyAurumHarness: {
    status: 'idle' | 'running' | 'pass' | 'fail';
    startedAtMs: number | null;
    finishedAtMs: number | null;
    failureStep: string | null;
    details: string | null;
  };
  onApplyPendingSnapshot: () => void;
  onRunApplyAurumHarness: () => void;
  onToggleRiskCapital: () => void;
  onCommitManualCapitalAdjustments: (next: ManualCapitalAdjustment[]) => void;
  onSimulationTouch: (next?: SimulationPreset) => void;
  onScenarioChange: (next: ScenarioVariantId) => void;
  onRestoreScenarioPreset: () => void;
  onRestoreOfficialDistribution: () => void;
  onSimOverridesChange: (next: SimulationOverrides | null) => void;
  onUpdateParams: (patcher: (prev: ModelParameters) => ModelParameters) => void;
  onRunSimulation: () => void;
  onResetSim: () => void;
  onOpenOptimization: () => void;
}) {
  const [showSimToast, setShowSimToast] = useState(false);
  const simulationPanelRef = useRef<HTMLDivElement | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [simulationDataOpen, setSimulationDataOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 760 : true
  );
  const [keyMetricsOpen, setKeyMetricsOpen] = useState(true);
  const [moreMetricsOpen, setMoreMetricsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [modelBaseOpen, setModelBaseOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 760 : false
  );
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 390 : false
  );
  const [savingMovement, setSavingMovement] = useState(false);
  const [capitalLedgerOpen, setCapitalLedgerOpen] = useState(false);
  const [longevityOpen, setLongevityOpen] = useState(false);
  const [longevityRunning, setLongevityRunning] = useState(false);
  const [longevityResult, setLongevityResult] = useState<LongevityPlus5Result | null>(null);
  const [longevityError, setLongevityError] = useState<string | null>(null);
  const [openTraceRows, setOpenTraceRows] = useState<Record<string, boolean>>({});
  const [draftManualAdjustments, setDraftManualAdjustments] = useState<ManualCapitalAdjustment[]>(manualCapitalAdjustments);
  const draftManualAdjustmentsRef = useRef<ManualCapitalAdjustment[]>(manualCapitalAdjustments);
  const [spendingDraftByIndex, setSpendingDraftByIndex] = useState<Record<number, string>>({});
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null);
  const [canonicalHydrationTimedOut, setCanonicalHydrationTimedOut] = useState(false);
  const [movementForm, setMovementForm] = useState({
    direction: 'add' as 'add' | 'remove',
    amount: '',
    currency: 'CLP' as 'CLP' | 'USD' | 'EUR',
    effectiveDate: '',
    destination: 'liquidity' as ManualCapitalDestination,
    note: '',
  });
  const prevSimActive = useRef(false);
  const diagnosticsRef = useRef<HTMLDetailsElement | null>(null);
  const destinationOptions: Array<{ value: ManualCapitalDestination; label: string }> = [
    { value: 'liquidity', label: 'Liquidez / Bancos' },
    { value: 'investments', label: 'Inversiones financieras' },
    { value: 'risk', label: 'Capital de riesgo' },
    { value: 'other', label: 'Otros' },
  ];
  const hasSyncBanner = aurumSyncState === 'synced' && !hasPendingSnapshot && Boolean(pendingSnapshotLabel);
  const diffAbsLabel =
    aurumSyncDiff !== null && Number.isFinite(aurumSyncDiff)
      ? formatMoneyCompact(Math.abs(aurumSyncDiff))
      : '—';
  const baseOptLabel =
    aurumSyncBaseOpt !== null && Number.isFinite(aurumSyncBaseOpt)
      ? formatMoneyCompact(aurumSyncBaseOpt)
      : '—';
  const latestOptLabel =
    aurumSyncLatestOpt !== null && Number.isFinite(aurumSyncLatestOpt)
      ? formatMoneyCompact(aurumSyncLatestOpt)
      : '—';
  const openCapitalLedger = useCallback(() => {
    draftManualAdjustmentsRef.current = manualCapitalAdjustments;
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
  const scenarioFromParamsRaw = params.activeScenario as unknown;
  const activeScenarioForUi: ScenarioVariantId =
    scenarioFromParamsRaw === 'base' || scenarioFromParamsRaw === 'pessimistic' || scenarioFromParamsRaw === 'optimistic'
      ? scenarioFromParamsRaw
      : 'base';
  const hasInvalidScenarioInParams =
    scenarioFromParamsRaw != null &&
    scenarioFromParamsRaw !== 'base' &&
    scenarioFromParamsRaw !== 'pessimistic' &&
    scenarioFromParamsRaw !== 'optimistic';
  const scenarioUiLabel =
    activeScenarioForUi === 'base' ? 'Neutro' : activeScenarioForUi === 'pessimistic' ? 'Pesimista' : 'Optimista';
  const heroBaseChipLabel = 'Base';
  const canResetToBase = simActive;
  const simulationConfigSourceLabel =
    simulationConfigSource === 'cloud' ? 'Cloud canónico' : simulationConfigSource === 'local_cache' ? 'Cache local' : 'Fallback';
  const scenarioFromResultRaw = resultCentral?.params?.activeScenario as unknown;
  const scenarioFromResult =
    scenarioFromResultRaw === 'base' || scenarioFromResultRaw === 'pessimistic' || scenarioFromResultRaw === 'optimistic'
      ? scenarioFromResultRaw
      : null;
  const resultSeed = resultCentral?.params?.simulation?.seed ?? null;
  const activeCapitalSource = (resultCentral?.params?.capitalSource ?? params.capitalSource ?? 'aurum') as CapitalSource;
  const effectiveCapitalSource = snapshotApplied && activeCapitalSource === 'aurum'
    ? 'aurum'
    : activeCapitalSource === 'manual'
      ? 'manual'
      : 'local';
  const activeCapitalSourceLabel =
    effectiveCapitalSource === 'aurum'
      ? 'Aurum'
      : effectiveCapitalSource === 'manual'
        ? 'Manual'
        : 'Local';
  const effectiveBaseCapital = Number(params.capitalInitial ?? 0);
  const aurumTechnicalLabel = aurumSnapshotLabel
    ? `Aurum: ${aurumSnapshotLabel}`
    : aurumIntegrationStatus === 'missing'
      ? 'Aurum: snapshot no disponible'
      : aurumIntegrationStatus === 'unconfigured'
        ? 'Aurum: no configurado'
        : aurumIntegrationStatus === 'error'
          ? 'Aurum: error de integración'
          : 'Aurum: en espera';
  const localReadOnlyFallbackActive = Boolean(localReadOnlyMode?.enabled);
  const localReadOnlyFallbackCopy = 'Modo local de revisión: útil para QA visual. Los montos pueden no coincidir con Aurum productivo.';
  const workerRecalcActive = simWorking || recalcWorkerStatus === 'queued' || recalcWorkerStatus === 'running';
  const localReadOnlyVisualOnly = localReadOnlyFallbackActive && !workerRecalcActive;
  const isRecalculating = !localReadOnlyVisualOnly && simUiState !== 'error' && (heroPhase === 'boot' || heroPhase === 'stale');
  const runtimeDiagnostics =
    (m8InputFingerprint.diagnosticInput.runtimeDiagnostics as Record<string, unknown> | undefined) ?? {};
  const replayTrace =
    (m8InputFingerprint.diagnosticInput.replayTrace as Record<string, unknown> | undefined) ?? null;
  const instrumentUniverseDiagnostics =
    (m8InputFingerprint.diagnosticInput.instrumentUniverseDiagnostics as Record<string, unknown> | undefined) ?? {};
  const simulationRunStatus = String(runtimeDiagnostics.simulationRunStatus ?? '').toLowerCase();
  const canonicalInputReady = runtimeDiagnostics.canonicalInputReady !== false;
  const canonicalInputBlockedReason = String(
    runtimeDiagnostics.canonicalInputBlockedReason
    ?? runtimeDiagnostics.blockedReason
    ?? '',
  ).trim();
  const canonicalInputStatusMessage = String(runtimeDiagnostics.canonicalInputStatusMessage ?? '').trim();
  const canonicalInputPendingSource = String(runtimeDiagnostics.canonicalInputPendingSource ?? '').trim();
  const canonicalInputBlocked = !canonicalInputReady && canonicalInputBlockedReason.length > 0;
  const instrumentUniverseCloudReadStatus = String(instrumentUniverseDiagnostics.cloudReadStatus ?? '').trim();
  const instrumentUniverseCloudPath = String(instrumentUniverseDiagnostics.cloudPath ?? '').trim();
  const instrumentUniverseCloudErrorMessage = String(instrumentUniverseDiagnostics.cloudErrorMessage ?? '').trim();
  const sourcePolicy = (
    (m8InputFingerprint.diagnosticInput.sourcePolicy as SourceFreshnessPolicy | undefined)
    ?? ((m8InputFingerprint.diagnosticInput.replayTrace as { sourcePolicy?: SourceFreshnessPolicy } | undefined)?.sourcePolicy)
    ?? null
  );
  useEffect(() => {
    if (!canonicalInputBlocked || !isCanonicalHydrationInProgress(canonicalInputBlockedReason)) {
      setCanonicalHydrationTimedOut(false);
      return;
    }

    setCanonicalHydrationTimedOut(false);
    const timeout = window.setTimeout(() => {
      setCanonicalHydrationTimedOut(true);
    }, CANONICAL_HYDRATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [canonicalInputBlocked, canonicalInputBlockedReason]);
  useEffect(() => {
    setSimulationDataOpen(!isMobileViewport);
  }, [isMobileViewport]);
  const canonicalInputDisplayState = resolveCanonicalInputDisplayState({
    blocked: canonicalInputBlocked,
    blockedReason: canonicalInputBlockedReason,
    hydrationTimedOut: canonicalHydrationTimedOut,
  });
  const simTechnicalLabel = isRecalculating
    ? `Simulación: recalculando${lastRecalcCause ? ` (${lastRecalcCause})` : ''}`
    : canonicalInputBlocked
      ? `Simulación: ${canonicalInputDisplayState} (${canonicalInputBlockedReason})`
    : simUiState === 'ready'
      ? 'Simulación: lista'
      : simUiState === 'error'
        ? `Simulación: error (${simUiError || 'sin detalle'})`
        : 'Simulación: inicial';
  const hideResultBlocks = simUiState === 'error';
  const compositionSource = (baseUpdatePending
    ? params.simulationComposition
    : resultCentral?.params?.simulationComposition) ?? params.simulationComposition;
  const hasEffectiveRealEstate = Boolean(compositionSource?.nonOptimizable?.realEstate);
  const liquidarDeptoConfigured = params.realEstatePolicy?.enabled ?? true;
  const liquidarDeptoEnabled = hasEffectiveRealEstate && liquidarDeptoConfigured;
  const localReadOnlyDeptoUnavailable = localReadOnlyFallbackActive && !hasEffectiveRealEstate;
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
  // En modo bloques (full/partial), el capital visible es derivado del snapshot + bloques + ledger
  // y debe alinearse con el capital que efectivamente usa la corrida (resultCentral.params.capitalInitial).
  // En modo legacy sí existe un override manual directo por chip.
  const isDerivedCapital = compositionMode !== 'legacy';
  const effectiveCapital = isDerivedCapital
    ? effectiveBaseCapital
    : (simOverrides?.capital ?? baseCapital);
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
  const committedManualSummaryT0 = useMemo(
    () => summarizeManualAdjustmentsT0(manualCapitalAdjustments, toClp),
    [manualCapitalAdjustments, toClp],
  );
  const committedManualSummaryFuture = useMemo(
    () => summarizeManualAdjustmentsFuture(manualCapitalAdjustments, toClp),
    [manualCapitalAdjustments, toClp],
  );
  const draftManualSummaryT0 = useMemo(
    () => summarizeManualAdjustmentsT0(manualAdjustmentsSorted, toClp),
    [manualAdjustmentsSorted, toClp],
  );
  const draftManualSummaryFuture = useMemo(
    () => summarizeManualAdjustmentsFuture(manualAdjustmentsSorted, toClp),
    [manualAdjustmentsSorted, toClp],
  );
  const manualNetClp = useMemo(
    () => draftManualSummaryT0.netClp,
    [draftManualSummaryT0.netClp],
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
      const nextList = editingMovementId
        ? prev.map((item) => (item.id === next.id ? next : item))
        : [next, ...prev];
      draftManualAdjustmentsRef.current = nextList;
      if (editingMovementId) {
        return nextList;
      }
      return nextList;
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
              return draftManualAdjustmentsRef.current.map((item) => (item.id === next.id ? next : item));
            }
            return [next, ...draftManualAdjustmentsRef.current];
          })()
        : draftManualAdjustmentsRef.current;
      onCommitManualCapitalAdjustments(ledgerToCommit);
      closeCapitalLedger();
    }, 0);
  }, [closeCapitalLedger, editingMovementId, movementForm, onCommitManualCapitalAdjustments]);

  useEffect(() => {
    draftManualAdjustmentsRef.current = draftManualAdjustments;
  }, [draftManualAdjustments]);

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
    if (typeof window === 'undefined') return undefined;
    const onResize = () => {
      setIsMobileViewport(window.innerWidth <= 760);
      setIsCompactViewport(window.innerWidth <= 390);
    };
    onResize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const displayResult = hideResultBlocks ? null : resultCentral;
  const heroResult = heroPhase === 'ready' ? displayResult : heroPhase === 'stale' ? lastStableCentral : null;
  const showGhostResult = heroPhase === 'stale' && simUiState !== 'error';
  const showBootPlaceholder = heroPhase === 'boot';
  const riskToggleCopy = riskCapitalEnabled ? 'ON' : 'OFF';
  const harnessRunning = applyAurumHarness.status === 'running';
  const harnessStatusColor =
    applyAurumHarness.status === 'pass'
      ? T.positive
      : applyAurumHarness.status === 'fail'
        ? T.negative
        : T.textMuted;
  const probSuccess = displayResult ? 1 - displayResult.probRuin : null;
  const success40 = displayResult
    ? displayResult.success40 ?? (1 - (displayResult.probRuin40 ?? displayResult.probRuin))
    : null;
  const probRuin40 = displayResult?.probRuin40 ?? displayResult?.probRuin ?? null;
  const probRuin20 = displayResult?.probRuin20 ?? null;
  const heroProbSuccess = heroResult ? 1 - heroResult.probRuin : null;
  const ruinMedian = displayResult?.ruinTimingMedian ?? null;
  const ruinP10 = displayResult?.ruinTimingP10 ?? null;
  const ruinP25 = displayResult?.ruinTimingP25 ?? null;
  const ruinP75 = displayResult?.ruinTimingP75 ?? null;
  const ruinP90 = displayResult?.ruinTimingP90 ?? null;
  const ruinWindowLabel = ruinP25 !== null && ruinP75 !== null
    ? `${ruinP25.toFixed(1)}–${ruinP75.toFixed(1)} años`
    : '—';
  const ruinTypicalLabel = ruinMedian !== null ? `${ruinMedian.toFixed(1)} años` : '—';
  const firstRuinRelevantLabel = ruinP10 !== null ? `${ruinP10.toFixed(1)} años` : '—';
  const ruinCentral80Label = ruinP10 !== null && ruinP90 !== null
    ? `${ruinP10.toFixed(1)}–${ruinP90.toFixed(1)} años`
    : '—';
  const ruinHumanSummary = ruinMedian !== null && ruinP25 !== null && ruinP75 !== null
    ? `Si falla, normalmente ocurre entre los años ${ruinP25.toFixed(1)} y ${ruinP75.toFixed(1)} (año típico: ${ruinMedian.toFixed(1)}).`
    : 'Si falla, el motor estima el timing de ruina solo sobre los escenarios que efectivamente fracasan.';
  const heroRuinSummary = ruinMedian !== null && ruinP25 !== null && ruinP75 !== null
    ? isMobileViewport
      ? `Si falla: típico ${ruinMedian.toFixed(1)} años · rango ${ruinP25.toFixed(1)}–${ruinP75.toFixed(1)}`
      : ruinHumanSummary
    : ruinHumanSummary;
  const spendRatio = displayResult?.spendingRatioMedian ?? null;
  const p50AllPaths = displayResult?.p50TerminalAllPaths ?? displayResult?.terminalWealthPercentiles[50] ?? null;
  const p50Survivors = displayResult?.p50TerminalSurvivors ?? displayResult?.terminalWealthPercentiles[50] ?? null;
  const houseSalePct = displayResult?.houseSalePct ?? null;
  const triggerYearMedian = displayResult?.triggerYearMedian ?? null;
  const saleYearMedian = displayResult?.saleYearMedian ?? null;
  const cutScenarioPct = displayResult?.cutScenarioPct ?? null;
  const cutSeverityMean = displayResult?.cutSeverityMean ?? null;
  const firstCutYearMedian = displayResult?.firstCutYearMedian ?? null;
  const drawdownP50 = displayResult?.maxDrawdownPercentiles?.[50] ?? null;
  const cutShare = displayResult?.cutTimeShare ?? null;
  const houseSaleSummary =
    houseSalePct !== null && Number.isFinite(houseSalePct)
      ? `Venta de casa en ${(houseSalePct * 100).toFixed(1)}% de escenarios`
      : 'Venta de casa: —';
  const heroProbRuinLine = {
    label: 'Prob. ruina',
    detail: `${probRuin40 !== null ? `${(probRuin40 * 100).toFixed(1)}%` : '—'} · si falla: mediana a. ${
      ruinMedian !== null && Number.isFinite(ruinMedian) ? ruinMedian.toFixed(1) : '—'
    }`,
  };
  const heroHouseCostLine =
    houseSalePct !== null && Number.isFinite(houseSalePct)
      ? houseSalePct > 0
        ? {
            label: 'Casa',
            detail: `${(houseSalePct * 100).toFixed(1)}% escenarios · venta mediana a. ${
              saleYearMedian !== null && Number.isFinite(saleYearMedian) ? saleYearMedian.toFixed(1) : '—'
            }`,
          }
        : { label: 'Casa', detail: 'No se activa' }
      : { label: 'Casa', detail: 'No disponible' };
  const heroCutCostLine =
    cutScenarioPct !== null && Number.isFinite(cutScenarioPct)
      ? cutScenarioPct > 0
        ? {
            label: 'Cuts',
            detail: `${(cutScenarioPct * 100).toFixed(1)}% escenarios · recorte medio ${
              cutSeverityMean !== null && Number.isFinite(cutSeverityMean) ? `${(cutSeverityMean * 100).toFixed(1)}%` : '—'
            } · 1er cut a. ${
              firstCutYearMedian !== null && Number.isFinite(firstCutYearMedian) ? firstCutYearMedian.toFixed(1) : '—'
            }`,
          }
        : { label: 'Cuts', detail: 'No se activan' }
      : { label: 'Cuts', detail: 'No disponible' };
  const isRunActive = simulationRunStatus === 'queued' || simulationRunStatus === 'running';
  const heroShowsRunActive = isRunActive && !localReadOnlyVisualOnly;
  const primaryReasonCode = resultConfidence.reasons.find((item) => item.severity !== 'info')?.code ?? null;
  const blockingReasons = resultConfidence.reasons.filter((item) => item.severity === 'blocking');
  const hasOnlyRunResultBlockingReasons = blockingReasons.length > 0 && blockingReasons.every((item) => item.source === 'runResult');
  const reviewCause = useMemo(() => {
    if (!primaryReasonCode) return 'Resultado usable con salvedades.';
    if (primaryReasonCode.startsWith('instrumentUniverse_')) {
      return 'Resultado usable con salvedades.';
    }
    if (primaryReasonCode.startsWith('capitalAdjustments_')) {
      return 'Hay ajustes locales de capital no sincronizados.';
    }
    if (primaryReasonCode.startsWith('sandbox_') || primaryReasonCode === 'sandbox_active') {
      return 'Estás viendo una simulación temporal, no el Modelo Base.';
    }
    if (primaryReasonCode.startsWith('aurumSnapshot_')) {
      return 'La base de Aurum aplicada no es la fuente cloud final.';
    }
    return 'Resultado usable con salvedades.';
  }, [primaryReasonCode]);
  const reviewGap = useMemo(() => {
    if (!primaryReasonCode || primaryReasonCode.startsWith('instrumentUniverse_')) {
      return 'Falta: Sincronizar el mix aperturado por instrumento para llegar a OK.';
    }
    if (primaryReasonCode.startsWith('capitalAdjustments_')) {
      return 'Falta: Sincronizar o descartar los ajustes locales de capital.';
    }
    if (primaryReasonCode.startsWith('sandbox_') || primaryReasonCode === 'sandbox_active') {
      return 'Falta: Volver al Modelo Base o guardar el escenario temporal.';
    }
    if (primaryReasonCode.startsWith('aurumSnapshot_')) {
      return 'Falta: Aplicar la nueva base Aurum disponible.';
    }
    if (primaryReasonCode.startsWith('simulationConfig_')) {
      return 'Falta: Terminar la carga de configuración cloud de simulación.';
    }
    return 'Falta: Resolver la salvedad principal para llegar a OK.';
  }, [primaryReasonCode]);
  const heroPrimaryState = useMemo(() => {
    if (canonicalInputBlocked) {
      const pendingSourceCopy = canonicalInputPendingSource
        ? `Fuente pendiente: ${canonicalInputPendingSource}.`
        : 'Fuente pendiente: input canónico.';
      if (canonicalInputDisplayState === 'hydrating') {
        return {
          label: 'Hidratando',
          tone: T.warning,
          headline: 'Hidratando Modelo Base…',
          explanation: canonicalInputStatusMessage || 'Carga canónica en curso.',
          gap: pendingSourceCopy,
        };
      }
      if (canonicalInputDisplayState === 'missingCanonicalConfig') {
        return {
          label: 'Bloqueado',
          tone: T.negative,
          headline: 'Falta Modelo Base canónico',
          explanation: canonicalInputStatusMessage || 'No hay Modelo Base canónico guardado en cloud. Por seguridad, MIDAS no lo crea automáticamente desde cache local.',
          gap: `${pendingSourceCopy} Revisa Modelo Base antes de ejecutar simulación.`,
        };
      }
      if (canonicalInputDisplayState === 'timeout') {
        return {
          label: 'Timeout',
          tone: T.negative,
          headline: 'No se pudo completar la hidratación',
          explanation: canonicalInputStatusMessage || 'La carga canónica excedió el umbral seguro de espera.',
          gap: `${pendingSourceCopy} Razón técnica: ${canonicalInputBlockedReason}.`,
        };
      }
      if (canonicalInputDisplayState === 'error') {
        return {
          label: 'Error',
          tone: T.negative,
          headline: 'No se pudo completar la hidratación',
          explanation: canonicalInputStatusMessage || 'Una fuente canónica devolvió error.',
          gap: `${pendingSourceCopy} Razón técnica: ${canonicalInputBlockedReason}.`,
        };
      }
      return {
        label: 'Bloqueado',
        tone: T.negative,
        headline: 'Input canónico incompleto',
        explanation: canonicalInputStatusMessage || 'Aún no hay simulación válida para el input canónico.',
        gap: `${pendingSourceCopy} Razón técnica: ${canonicalInputBlockedReason}.`,
      };
    }
    if (heroShowsRunActive) {
      return {
        label: 'Calculando',
        tone: T.warning,
        headline: 'Calculando resultado final.',
        explanation: 'Falta terminar la simulación final.',
        gap: 'Falta: Esperar resultado final.',
      };
    }
    if (heroPhase === 'stale') {
      return {
        label: showGhostResult ? 'Resultado anterior' : 'Pendiente',
        tone: T.warning,
        headline: showGhostResult
          ? 'Resultado anterior · recalcular.'
          : 'Pendiente de recalcular.',
        explanation: showGhostResult
          ? 'La configuración cambió. El resultado visible pertenece a la configuración anterior.'
          : 'No hay resultado actualizado para esta configuración.',
        gap: 'Ejecuta simulación para validar Depto ON/OFF + Capital de riesgo ON/OFF.',
      };
    }
    if (resultConfidence.status === 'not_decisional' && hasOnlyRunResultBlockingReasons) {
      return {
        label: heroResult ? 'Resultado anterior' : 'Pendiente',
        tone: T.warning,
        headline: heroResult
          ? 'Resultado anterior · recalcular.'
          : 'Pendiente de recalcular.',
        explanation: 'No hay resultado actualizado para esta configuración.',
        gap: 'Ejecuta simulación para validar los cambios.',
      };
    }
    if (resultConfidence.status === 'not_decisional') {
      if (localReadOnlyFallbackActive) {
        return {
          label: 'Modo local',
          tone: T.warning,
          headline: 'Resultado no auditado para decisión productiva.',
          explanation: 'Datos locales/degradados por configuración cloud no disponible.',
          gap: 'Usa este modo para QA visual; valida decisiones con cloud config real.',
        };
      }
      return {
        label: 'No usar',
        tone: T.negative,
        headline: 'No hay resultado auditado para el input actual.',
        explanation: 'Falta recalcular un resultado auditado para este input.',
        gap: 'Falta: Recalcular resultado para el input actual. Si no cambia, recarga.',
      };
    }
    if (resultConfidence.status === 'review') {
      return {
        label: 'Revisar',
        tone: T.warning,
        headline: 'Resultado usable con salvedades.',
        explanation: reviewCause,
        gap: reviewGap,
      };
    }
    return {
      label: 'OK',
      tone: T.positive,
      headline: 'Resultado canónico.',
      explanation: 'Resultado canónico.',
      gap: null as string | null,
    };
  }, [
    T.negative,
    T.positive,
    T.warning,
    canonicalInputBlocked,
    canonicalInputBlockedReason,
    canonicalInputDisplayState,
    canonicalInputPendingSource,
    canonicalInputStatusMessage,
    hasOnlyRunResultBlockingReasons,
    heroPhase,
    heroResult,
    heroShowsRunActive,
    localReadOnlyFallbackActive,
    resultConfidence.status,
    reviewCause,
    reviewGap,
    showGhostResult,
  ]);
  const heroConfidenceBlock = useMemo(
    () => (
      <span style={{ display: 'grid', gap: 4 }}>
        <span style={{ color: T.textSecondary, fontSize: 12 }}>{heroPrimaryState.explanation}</span>
        {heroPrimaryState.gap && (
          <span style={{ color: T.textSecondary, fontSize: 11 }}>
            {heroPrimaryState.gap}
          </span>
        )}
      </span>
    ),
    [T.textSecondary, heroPrimaryState.explanation, heroPrimaryState.gap],
  );
  const openDiagnosticsFromHero = useCallback(() => {
    setDiagnosticsOpen(true);
    window.requestAnimationFrame(() => {
      diagnosticsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  const ruin40Light = classifyThreshold(probRuin40, { greenMax: 0.05, yellowMax: 0.15 });
  const ruin20Light = classifyThreshold(probRuin20, { greenMax: 0.02, yellowMax: 0.08 });
  const cutTimeLight = classifyThreshold(cutShare, { greenMax: 0.10, yellowMax: 0.25 });
  const houseSaleLight = classifyThreshold(houseSalePct, { greenMax: 0.10, yellowMax: 0.30 });
  const drawdownLight = classifyThreshold(drawdownP50, { greenMax: 0.20, yellowMax: 0.35 });
  const earlyRuinLight = classifyThreshold(ruinP10, { greenMin: 12, yellowMin: 6 });
  const rawFanChart = displayResult && Array.isArray(displayResult.fanChartData)
    ? displayResult.fanChartData
    : [];
  const breakEvenWealth = useMemo(() => {
    const fromYear0 = rawFanChart.length > 0 ? Number(rawFanChart[0].p50) : Number.NaN;
    if (Number.isFinite(fromYear0) && fromYear0 > 0) return fromYear0;
    return Number.isFinite(effectiveBaseCapital) && effectiveBaseCapital > 0 ? effectiveBaseCapital : 0;
  }, [effectiveBaseCapital, rawFanChart]);
  const ruinAlertTop = useMemo(() => {
    if (!Number.isFinite(breakEvenWealth) || breakEvenWealth <= 0) return 0;
    return Math.max(1, breakEvenWealth * 0.06);
  }, [breakEvenWealth]);
  const fanChartData: FanChartDatum[] = rawFanChart.map((point) => ({
    ...point,
    outerBase: point.p5,
    outerSpan: Math.max(0, point.p95 - point.p5),
    innerBase: point.p25,
    innerSpan: Math.max(0, point.p75 - point.p25),
    ruinBandTop: ruinAlertTop,
  }));
  const percentileRows = useMemo(() => {
    if (!displayResult) return [] as number[];
    const candidates = [25, 50, 75] as const;
    return candidates.filter((p) => {
      const survivorValue = p === 50
        ? displayResult.p50TerminalSurvivors ?? displayResult.terminalWealthPercentiles[50]
        : p === 25
          ? displayResult.terminalP25IfSuccess ?? displayResult.terminalWealthPercentiles[25]
          : displayResult.terminalP75IfSuccess ?? displayResult.terminalWealthPercentiles[75];
      const allPathsValue = p === 50
        ? displayResult.p50TerminalAllPaths
        : p === 25
          ? displayResult.terminalP25AllPaths
          : displayResult.terminalP75AllPaths;
      return Number.isFinite(survivorValue) || Number.isFinite(allPathsValue);
    });
  }, [displayResult]);
  const activeGenerator = useMemo(() => {
    const raw = displayResult?.params?.generatorType ?? params.generatorType ?? 'student_t';
    if (raw === 'student_t') return 'Student-t (df 7)';
    if (raw === 'gaussian_iid') return 'Gaussiano IID';
    if (raw === 'two_regime') return 'Two-regime (suave)';
    return String(raw);
  }, [displayResult?.params?.generatorType, params.generatorType]);
  const eurRate = params.fx.clpUsdInitial * params.fx.usdEurFixed;
  const rawFanYears = rawFanChart.at(-1)?.year ?? 40;
  const fanChartYears = Number.isFinite(rawFanYears)
    ? Math.max(5, Math.ceil(rawFanYears / 5) * 5)
    : 40;
  const fanChartTicks = Array.from({ length: Math.floor(fanChartYears / 5) }, (_, idx) => (idx + 1) * 5);
  const fanChartTicksMobile = Array.from(
    { length: Math.max(1, Math.floor(fanChartYears / 10)) },
    (_, idx) => (idx + 1) * 10
  ).filter((tick) => tick <= fanChartYears);
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
  const openSimulationPanelShortcut = () => {
    onSimulationTouch('custom');
    setAdvancedOpen(true);
    window.setTimeout(() => {
      simulationPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const updateTemporaryReturnPct = useCallback((nextPct: number) => {
    const clamped = Math.max(-10, Math.min(30, nextPct));
    const next: SimulationOverrides = {
      active: true,
      preset: 'custom',
      ...(simOverrides?.horizonYears !== undefined ? { horizonYears: simOverrides.horizonYears } : {}),
      ...(simOverrides?.capital !== undefined ? { capital: simOverrides.capital } : {}),
      returnPct: clamped / 100,
    };
    onSimOverridesChange(next);
  }, [onSimOverridesChange, simOverrides]);

  const updateTemporaryHorizonYears = useCallback((nextYears: number) => {
    const clampedYears = Math.max(1, Math.round(nextYears));
    const next: SimulationOverrides = {
      active: true,
      preset: 'custom',
      ...(simOverrides?.returnPct !== undefined ? { returnPct: simOverrides.returnPct } : {}),
      ...(simOverrides?.capital !== undefined ? { capital: simOverrides.capital } : {}),
      horizonYears: clampedYears,
    };
    onSimOverridesChange(next);
  }, [onSimOverridesChange, simOverrides]);

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
  const formatWeightMix = useCallback((weights: PortfolioWeights) => {
    const rv = Math.round((weights.rvGlobal + weights.rvChile) * 100);
    const rf = Math.round((weights.rfGlobal + weights.rfChile) * 100);
    const global = Math.round((weights.rvGlobal + weights.rfGlobal) * 100);
    const local = Math.round((weights.rvChile + weights.rfChile) * 100);
    return `RV/RF ${rv}/${rf} · Global/Local ${global}/${local}`;
  }, []);
  const activeWeightSummary = formatWeightMix(activeWeights);
  const officialWeightSummary = formatWeightMix(officialReferenceWeights);
  const universeWeightSummary = instrumentUniverseReferenceWeights
    ? formatWeightMix(instrumentUniverseReferenceWeights)
    : 'No disponible';
  const instrumentBaseWeightSummary = instrumentBaseReferenceWeights
    ? formatWeightMix(instrumentBaseReferenceWeights)
    : 'No disponible';
  const spendingPhases = useMemo(() => normalizeModelSpendingPhases(params), [params]);
  const spendingPhaseLabels = useMemo(() => buildSpendingPhaseUiLabels(spendingPhases), [spendingPhases]);
  const formatPct = (value: number | null | undefined, digits = 1) =>
    value !== null && value !== undefined && Number.isFinite(value)
      ? `${(value * 100).toFixed(digits)}%`
      : '—';
  const compactMixSummary = useMemo(() => {
    const weights = params.weights;
    const rv = (weights.rvGlobal + weights.rvChile) * 100;
    const rf = (weights.rfGlobal + weights.rfChile) * 100;
    return `RV ${rv.toFixed(1)} / RF ${rf.toFixed(1)}`;
  }, [params.weights]);
  const compactSpendSummary = useMemo(
    () => spendingPhases
      .map((phase, idx) => `F${idx + 1} ${formatMillionsMM(phase.amountReal / 1_000_000)}`)
      .join(' · '),
    [spendingPhases],
  );
  const midasEvaluation = useMemo(() => {
    const replayTrace =
      (m8InputFingerprint.diagnosticInput.replayTrace as Record<string, unknown> | undefined) ?? null;
    return buildMidasEvaluation({
      qualityOfLifeMetrics: resultCentral?.qualityOfLifeMetrics ?? null,
      inputAuditable: Boolean(replayTrace && m8InputFingerprint.hash && m8InputFingerprint.effectiveEngineInputHash),
      canUseForDecision: resultConfidence.canUseForDecision && (sourcePolicy?.isComparable ?? true),
      decisionStatus: resultConfidence.status,
      comparabilityWarnings: [
        ...m8InputFingerprint.warnings,
        ...(sourcePolicy?.warnings ?? []),
        ...(sourcePolicy?.forbiddenSourcesUsed ?? []),
        ...(sourcePolicy && !sourcePolicy.isPureCanonical ? [`source_policy:${sourcePolicy.status}`] : []),
        ...resultConfidence.reasons
          .filter((reason) => reason.severity !== 'info')
          .map((reason) => reason.code),
      ],
    });
  }, [m8InputFingerprint, resultCentral?.qualityOfLifeMetrics, resultConfidence, sourcePolicy]);
  const lastTimelineAtMs = runtimeTimeline.length > 0
    ? runtimeTimeline[runtimeTimeline.length - 1].atMs
    : null;
  const lastAutoAppliedAtMs = useMemo(() => {
    const events = runtimeTimeline.filter((entry) =>
      entry.event === 'snapshot_applied' ||
      entry.event === 'capital_visible_updated',
    );
    if (events.length === 0) return null;
    return events[events.length - 1].atMs;
  }, [runtimeTimeline]);
  const riskInCompositionRaw = Number(compositionSource?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
  const riskDetectedClp = Number.isFinite(riskInCompositionRaw) && riskInCompositionRaw > 0
    ? riskInCompositionRaw
    : Math.max(0, Number(riskCapitalCLP ?? 0));
  const localReadOnlyRiskUnavailable = localReadOnlyFallbackActive && riskDetectedClp <= 0;
  const riskCapitalToggleDisabled = isRecalculating || localReadOnlyRiskUnavailable;
  const riskCapitalToggleHelp = localReadOnlyRiskUnavailable
    ? 'Sin capital de riesgo disponible en modo local; ON/OFF no modifica recursos.'
    : riskCapitalEnabled
      ? 'Habilitado.'
      : 'No entra.';
  const mixComparisonWeights = instrumentUniverseReferenceWeights ?? instrumentBaseReferenceWeights ?? officialReferenceWeights;
  const mixDiffPp = useMemo(() => {
    const sumAbs = Math.abs(activeWeights.rvGlobal - mixComparisonWeights.rvGlobal)
      + Math.abs(activeWeights.rfGlobal - mixComparisonWeights.rfGlobal)
      + Math.abs(activeWeights.rvChile - mixComparisonWeights.rvChile)
      + Math.abs(activeWeights.rfChile - mixComparisonWeights.rfChile);
    return (sumAbs * 100) / 2;
  }, [activeWeights, mixComparisonWeights]);
  const aurumPrimaryFxClp = Number(operativeFxResolution.aurumCurrentClp ?? NaN);
  const hasAurumPrimaryFx = operativeFxResolution.aurumCurrentAvailable;
  const primaryFxClp = hasAurumPrimaryFx && Number.isFinite(aurumPrimaryFxClp) && aurumPrimaryFxClp > 0
    ? aurumPrimaryFxClp
    : null;
  const primaryFxTechnical = 'snapshot.fxReference.clpUsd';
  const backupFxClp = Number(params.fx.clpUsdInitial ?? NaN);
  const eurUsdModelValue = Number(params.fx.usdEurFixed ?? NaN);
  const aurumEurUsd = Number(aurumFxSpotUsdEur ?? NaN);
  const aurumSourceUsdEur = Number(aurumFxSourceUsdEur ?? NaN);
  const fxDiffPct = Number.isFinite(primaryFxClp) && primaryFxClp !== null && Number.isFinite(backupFxClp) && backupFxClp > 0
    ? Math.abs(backupFxClp - primaryFxClp) / primaryFxClp
    : null;
  const usingPrimaryFx = operativeFxResolution.usingAurumCurrent;
  const hasAurumEurUsd = Number.isFinite(aurumEurUsd) && aurumEurUsd > 0;
  const hasAurumSourceUsdEur = Number.isFinite(aurumSourceUsdEur) && aurumSourceUsdEur > 0;
  const usingAurumEurUsd = hasAurumEurUsd && Number.isFinite(eurUsdModelValue) && eurUsdModelValue > 0
    ? isApproximatelyEqual(aurumEurUsd, eurUsdModelValue)
    : false;
  const snapshotFreshness = useMemo(
    () => getFreshnessStatus(aurumSnapshotPublishedAt),
    [aurumSnapshotPublishedAt],
  );
  const snapshotFreshnessUi = freshnessPresentation(snapshotFreshness);
  const snapshotPublishedRelative = useMemo(
    () => formatRelativePublishedAt(aurumSnapshotPublishedAt),
    [aurumSnapshotPublishedAt],
  );
  const mixTrustSourceLabel = useMemo(() => {
    if (weightsSourceMode === 'instrument-universe') {
      return universeSourceOrigin === 'firestore'
        ? 'Mix aperturado por instrumento · cloud'
        : universeSourceOrigin === 'bundled'
          ? 'Mix aperturado por instrumento · versión interna de respaldo'
          : 'Mix aperturado por instrumento · copia local';
    }
    if (weightsSourceMode === 'instrument-base') return 'Mix por instrumento · respaldo';
    if (weightsSourceMode === 'system-defaults') return 'Mix por instrumento · defaults del sistema';
    if (weightsSourceMode === 'simulation') return 'Mix agregado M8 · override temporal';
    return weightsSourceLabel;
  }, [universeSourceOrigin, weightsSourceLabel, weightsSourceMode]);
  const riskFxMismatchPct = useMemo(() => {
    const riskFx = Number(riskCapitalUsdSnapshotCLP ?? NaN);
    const operativeFx = Number(operativeFxResolution.appliedClp ?? NaN);
    if (!Number.isFinite(riskFx) || riskFx <= 0 || !Number.isFinite(operativeFx) || operativeFx <= 0) return null;
    return Math.abs(riskFx - operativeFx) / operativeFx;
  }, [operativeFxResolution.appliedClp, riskCapitalUsdSnapshotCLP]);
  const capitalSentToMotorClp = useMemo(() => {
    const optimizable = Number(compositionSource?.optimizableInvestmentsCLP ?? NaN);
    const banks = Number(compositionSource?.nonOptimizable?.banksCLP ?? NaN);
    if (!Number.isFinite(optimizable)) return null;
    return Math.max(0, optimizable) + (Number.isFinite(banks) ? Math.max(0, banks) : 0);
  }, [compositionSource]);
  const patrimonioAurumBaseVisibleClp = useMemo(() => {
    const total = Number(compositionSource?.totalNetWorthCLP ?? NaN);
    return Number.isFinite(total) && total > 0 ? total : null;
  }, [compositionSource]);
  const runCapitalBreakdown = useMemo(() => buildRunCapitalBreakdown({
    composition: compositionSource,
    realEstateEnabled: liquidarDeptoEnabled,
    riskCapitalEnabled,
    manualLocalAdjustmentsImpactCLP: committedManualSummaryT0.netClp,
    riskCapitalOverrideCLP: riskDetectedClp,
    includeNonExigibleDebtInRunCapital: DEFAULT_INCLUDE_NON_EXIGIBLE_DEBT_IN_RUN_CAPITAL,
  }), [
    committedManualSummaryT0.netClp,
    compositionSource,
    liquidarDeptoEnabled,
    riskCapitalEnabled,
    riskDetectedClp,
  ]);
  const riskCapitalIncludedInAurumBase: 'yes' | 'no' | 'unknown' = runCapitalBreakdown.riskInReference;
  const referenceRiskAdjustmentClp = runCapitalBreakdown.referenceRiskAdjustmentCLP;
  const referenceCapitalCLP = runCapitalBreakdown.referenceCapitalCLP;
  const nonOptimizableVisibleClp = useMemo(() => {
    if (!Number.isFinite(patrimonioAurumBaseVisibleClp) || patrimonioAurumBaseVisibleClp === null || capitalSentToMotorClp === null) return null;
    return patrimonioAurumBaseVisibleClp - capitalSentToMotorClp;
  }, [capitalSentToMotorClp, patrimonioAurumBaseVisibleClp]);
  const realEstateConsideredClp = runCapitalBreakdown.realEstateSupportCLP > 0
    ? runCapitalBreakdown.realEstateSupportCLP
    : null;
  const consideredWealthResolution = computeMidasConsideredWealth({
    referenceWealthClp: referenceCapitalCLP,
    realEstateSupportClp: realEstateConsideredClp,
    riskCapitalClp: runCapitalBreakdown.riskCapitalCLP,
    realEstateEnabled: liquidarDeptoEnabled,
    riskCapitalEnabled,
  });
  const enabledResourcesImpactCLP = (
    (liquidarDeptoEnabled ? (realEstateConsideredClp ?? 0) : 0)
    + (riskCapitalEnabled ? Math.max(0, runCapitalBreakdown.riskCapitalCLP) : 0)
  );
  const nonExigibleDebtPolicyImpactCLP = runCapitalBreakdown.nonExigibleDebtPolicyImpactCLP;
  const nonMortgageDebtClp = runCapitalBreakdown.nonMortgageDebtCLP;
  const manualLocalAdjustmentsImpactCLP = runCapitalBreakdown.manualLocalAdjustmentsImpactCLP;
  const runCapitalCLP = Number.isFinite(effectiveBaseCapital) && effectiveBaseCapital > 0
    ? effectiveBaseCapital
    : null;
  const patrimonioConsideradoBaseMidasClp = computeEnabledResourcesForUi({
    coreLiquidCapitalClp: runCapitalCLP,
    realEstateSupportClp: realEstateConsideredClp,
    riskCapitalClp: runCapitalBreakdown.riskCapitalCLP,
    realEstateEnabled: liquidarDeptoEnabled,
    riskCapitalEnabled,
    manualLocalAdjustmentsImpactClp: 0,
  });
  const patrimonioConsideradoEfectivoCorridaClp = runCapitalCLP;
  const ajusteManualAplicadoCorridaClp = manualLocalAdjustmentsImpactCLP;
  const patrimonioReferenciaMidasClp = referenceCapitalCLP;
  const patrimonioTotalHoyAurumNetoClp = patrimonioReferenciaMidasClp;
  const patrimonioTotalHoyRiskClp = Math.max(0, runCapitalBreakdown.riskCapitalCLP);
  const patrimonioTotalHoyClp = patrimonioTotalHoyAurumNetoClp !== null
    ? Math.max(0, patrimonioTotalHoyAurumNetoClp + patrimonioTotalHoyRiskClp)
    : null;
  const recursosHabilitadosSubcopy = buildEnabledResourcesSubcopy({
    realEstateEnabled: liquidarDeptoEnabled,
    riskCapitalEnabled,
    hasManualT0Adjustments: Math.abs(ajusteManualAplicadoCorridaClp) > 0.5,
    hasFutureAdjustments: committedManualSummaryFuture.count > 0,
  });
  const runCapitalFromComponentsCLP = computeEnabledResourcesForUi({
    coreLiquidCapitalClp: runCapitalCLP,
    realEstateSupportClp: realEstateConsideredClp,
    riskCapitalClp: runCapitalBreakdown.riskCapitalCLP,
    realEstateEnabled: liquidarDeptoEnabled,
    riskCapitalEnabled,
    // runCapitalCLP ya refleja el capital core efectivo de la corrida (incluye T0 cuando aplica).
    // Aquí no se vuelve a sumar T0 para evitar doble conteo visual en "Recursos habilitados".
    manualLocalAdjustmentsImpactClp: 0,
  });
  const patrimonioAmpliadoModeloClp = runCapitalFromComponentsCLP;
  const motorCapitalMismatchClp = (
    runCapitalCLP !== null && capitalSentToMotorClp !== null
  )
    ? runCapitalCLP - capitalSentToMotorClp
    : null;
  const expandedVsMotorGapClp = (
    runCapitalCLP !== null && runCapitalFromComponentsCLP !== null
  ) ? runCapitalFromComponentsCLP - runCapitalCLP : null;
  const wealthConfigHasReference = patrimonioReferenciaMidasClp !== null && patrimonioReferenciaMidasClp > 0;
  const wealthConfigHasConsidered = patrimonioConsideradoEfectivoCorridaClp !== null && patrimonioConsideradoEfectivoCorridaClp > 0;
  const wealthAllowedExcessClp =
    Math.max(0, nonExigibleDebtPolicyImpactCLP)
    + Math.max(0, manualLocalAdjustmentsImpactCLP);
  const wealthConsideredExceedsReference = wealthConfigHasReference && wealthConfigHasConsidered
    ? patrimonioConsideradoEfectivoCorridaClp > (patrimonioReferenciaMidasClp + wealthAllowedExcessClp + 0.5)
    : false;
  const coreReferenceGapClp = wealthConfigHasReference && wealthConfigHasConsidered
    ? patrimonioReferenciaMidasClp - patrimonioConsideradoEfectivoCorridaClp
    : null;
  const expandedReferenceGapClp = wealthConfigHasReference && patrimonioAmpliadoModeloClp !== null
    ? patrimonioReferenciaMidasClp - patrimonioAmpliadoModeloClp
    : null;
  const wealthConfigTone: SourceBadgeTone = !wealthConfigHasReference || !wealthConfigHasConsidered || wealthConsideredExceedsReference
    ? 'alert'
    : consideredWealthResolution.missingRealEstateSupport
      ? 'warning'
    : riskCapitalIncludedInAurumBase === 'unknown' && riskDetectedClp > 0
      ? 'warning'
      : 'ok';
  const wealthConfigLabel = wealthConfigTone === 'ok'
    ? 'Configuración OK'
    : wealthConfigTone === 'warning'
      ? 'Configuración con advertencias'
      : 'Configuración inválida / revisar';
  const wealthConfigCopy = wealthConsideredExceedsReference
    ? 'El capital líquido del motor supera la referencia patrimonial. Revisar composición antes de usar.'
    : consideredWealthResolution.missingRealEstateSupport
      ? 'Configuración válida, pero falta valor canónico de respaldo/depto para explicar toda la diferencia.'
    : wealthConfigTone === 'alert'
      ? 'Faltan datos patrimoniales críticos para validar esta configuración.'
      : 'Configuración patrimonial válida para esta corrida.';
  const patrimonioMidasHoyAjustadoT0Clp = patrimonioAmpliadoModeloClp ?? patrimonioConsideradoEfectivoCorridaClp;
  const heroResourcesTodayNote = committedManualSummaryT0.count > 0
    ? `Recursos habilitados hoy · ${committedManualSummaryT0.count} ajuste${committedManualSummaryT0.count === 1 ? '' : 's'} T0`
    : 'Recursos habilitados hoy';
  const heroFutureAdjustmentsNote = committedManualSummaryFuture.count > 0
    ? `Ajustes futuros: ${committedManualSummaryFuture.netClp >= 0 ? '+' : '-'}${formatMoneyCompact(Math.abs(committedManualSummaryFuture.netClp))}${committedManualSummaryFuture.firstFutureDate ? ` en ${committedManualSummaryFuture.firstFutureDate.slice(0, 4)}` : ''}`
    : null;
  const heroWealthChipNote = heroFutureAdjustmentsNote
    ? `${heroResourcesTodayNote}\n${heroFutureAdjustmentsNote}`
    : heroResourcesTodayNote;
  const patrimonioSourceSummary = snapshotApplied ? 'Snapshot Aurum aplicado' : 'Modelo base local';
  const patrimonioSourceTone: SourceBadgeTone = snapshotApplied ? 'ok' : hasPendingSnapshot ? 'warning' : 'alert';
  const patrimonioSourceWarning = snapshotApplied
    ? null
    : hasPendingSnapshot
      ? 'Hay un snapshot Aurum detectado pendiente de aplicar.'
      : 'Esta corrida usa base local; puede diferir de Aurum.';
  const mixSourceTone: SourceBadgeTone = weightsSourceMode === 'instrument-universe'
    ? instrumentUniverseCloudReadStatus === 'loaded'
      ? (universeSourceOrigin === 'firestore' ? 'ok' : universeSourceOrigin === 'bundled' ? 'warning' : 'warning')
      : instrumentUniverseCloudReadStatus === 'loading'
        ? 'warning'
        : 'alert'
    : 'alert';
  const mixSourceWarning = weightsSourceMode === 'instrument-universe'
    ? instrumentUniverseCloudReadStatus === 'loading'
      ? 'Instrument Universe cloud sigue cargando; no lo tratamos como fuente lista.'
      : instrumentUniverseCloudReadStatus === 'timeout'
        ? 'Timeout de lectura cloud para Instrument Universe.'
        : instrumentUniverseCloudReadStatus === 'missing'
          ? 'Falta Instrument Universe cloud.'
          : instrumentUniverseCloudReadStatus === 'error'
            ? 'Error leyendo Instrument Universe cloud.'
            : universeSourceOrigin === 'cache-local'
              ? 'El mix aperturado por instrumento está usando copia local.'
              : universeSourceOrigin === 'bundled'
                ? 'El mix aperturado por instrumento está usando versión interna de respaldo.'
                : null
    : 'El mix aperturado por instrumento no está disponible y se está usando un respaldo.';
  const usdFxSourceSummary = usingPrimaryFx
    ? 'Aurum current'
    : operativeFxResolution.reasonCode === 'manual_override_applied'
      ? 'Manual local'
      : operativeFxResolution.aurumSource?.includes('closure')
        ? 'Aurum cierre'
        : 'Fallback operativo';
  const usdFxTone: SourceBadgeTone = usingPrimaryFx
    ? 'ok'
    : operativeFxResolution.reasonCode === 'manual_override_applied'
      ? 'warning'
      : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied'
        ? 'alert'
        : 'warning';
  const usdFxWarning = usingPrimaryFx
    ? null
    : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied'
      ? 'Aurum publica un FX current usable, pero esta corrida está aplicando fallback operativo.'
      : 'FX del modelo puede diferir de Aurum si no hay snapshot aplicado.';
  const eurFxSourceSummary = usingAurumEurUsd ? (snapshotApplied ? 'Snapshot Aurum' : 'Aurum current') : 'Estructural del modelo';
  const eurFxTone: SourceBadgeTone = usingAurumEurUsd ? 'ok' : hasAurumEurUsd ? 'alert' : 'warning';
  const eurFxWarning = usingAurumEurUsd
    ? null
    : hasAurumEurUsd
      ? 'Aurum publica USD/EUR usable, pero esta corrida está aplicando fallback estructural.'
      : 'EUR/USD no validado contra Aurum; usando valor estructural del modelo.';
  const dataSourceTone: SourceBadgeTone = (
    eurFxTone === 'alert' ||
    usdFxTone === 'alert' ||
    mixSourceTone === 'alert'
  )
    ? 'alert'
    : (
        eurFxTone === 'warning' ||
        usdFxTone === 'warning' ||
        mixSourceTone === 'warning' ||
        patrimonioSourceTone !== 'ok'
      )
      ? 'warning'
      : 'ok';
  const dataSourceStatusLabel = dataSourceTone === 'ok'
    ? 'OK'
    : dataSourceTone === 'warning'
      ? 'Revisar'
      : 'Alerta';
  const dataSourceStatusCopy = dataSourceTone === 'ok'
    ? 'Fuentes aplicadas y trazables.'
    : dataSourceTone === 'warning'
      ? 'Datos usables con advertencias de fuente.'
      : 'Inconsistencia o fallback crítico en fuentes.';
  const sourcePolicyTone: SourceBadgeTone = sourcePolicy ? resolveSourcePolicyTone(sourcePolicy.status) : dataSourceTone;
  const sourcePolicySummary = sourcePolicy
    ? `${sourcePolicy.label} · ${sourcePolicy.effectiveSourceSummary}`
    : dataSourceStatusCopy;
  const mixSourceCompactLabel = buildMixSourceCompactLabel({
    weightsSourceMode,
    instrumentUniverseCloudReadStatus,
    universeSourceOrigin,
    sourcePolicy,
  });
  const aurumDiffPct = Number.isFinite(aurumSyncLatestOpt) && aurumSyncLatestOpt !== null && aurumSyncLatestOpt > 0
    && Number.isFinite(aurumSyncBaseOpt) && aurumSyncBaseOpt !== null
    ? Math.abs(aurumSyncBaseOpt - aurumSyncLatestOpt) / aurumSyncLatestOpt
    : null;
  const appliedTraceRows = useMemo<AppliedTraceRow[]>(() => {
    const aurumSeverity: TraceSeverity = snapshotApplied
      ? 'OK'
      : aurumDiffPct !== null && aurumDiffPct > 0.05
        ? 'Alerta'
        : 'Aviso';
    const aurumReason = snapshotApplied
      ? 'Se usa la fuente principal porque el snapshot Aurum ya fue aplicado al escenario.'
      : hasPendingSnapshot
        ? 'Se usa respaldo porque hay snapshot detectado pendiente de aplicar.'
        : aurumIntegrationStatus === 'missing' || aurumIntegrationStatus === 'error' || aurumIntegrationStatus === 'unconfigured'
          ? 'Se usa respaldo porque la fuente principal no está disponible.'
          : 'Se usa respaldo por fallback activo del sistema en esta sesión.';

    let riskSeverity: TraceSeverity = 'OK';
    if (riskCapitalEnabled && riskDetectedClp <= 0) riskSeverity = 'Alerta';
    else if (riskCapitalEnabled && !riskCapitalEffective) riskSeverity = 'Alerta';
    else if (!riskCapitalEnabled && riskDetectedClp > 0) riskSeverity = 'Aviso';
    const riskReason = riskCapitalEnabled
      ? riskDetectedClp > 0
        ? 'Se aplicó porque el toggle está encendido y hay capital de riesgo detectado.'
        : 'No se aplicó porque no hay capital detectado en la fuente principal.'
      : riskDetectedClp > 0
        ? 'Se detectó el dato, pero no se aplica porque el toggle está apagado.'
        : 'Toggle apagado y sin capital detectado, no corresponde aplicar.';

    let mixSeverity: TraceSeverity;
    if (weightsSourceMode === 'instrument-universe') mixSeverity = 'OK';
    else if (weightsSourceMode === 'simulation') mixSeverity = mixDiffPp > 2 ? 'Alerta' : 'Aviso';
    else if (mixDiffPp > 2) mixSeverity = 'Alerta';
    else mixSeverity = 'Aviso';
    const mixFallbackName =
      weightsSourceMode === 'instrument-base'
        ? 'Mix por instrumento (respaldo)'
        : weightsSourceMode === 'system-defaults'
          ? 'Mix por instrumento (defaults del sistema)'
          : weightsSourceMode === 'simulation'
            ? 'Mix agregado M8 (override temporal)'
            : weightsSourceMode === 'json-official'
              ? 'Mix por instrumento (respaldo)'
              : weightsSourceMode === 'last-known-official'
                ? 'Último oficial válido'
                : 'Sin respaldo usable';
    const mixFallbackTech =
      weightsSourceMode === 'instrument-base'
        ? 'midas.instrument-base.v1'
        : weightsSourceMode === 'system-defaults'
          ? 'DEFAULT_PARAMETERS.weights'
          : weightsSourceMode === 'simulation'
            ? 'weightsSourceMode=simulation'
            : weightsSourceMode === 'json-official'
              ? 'officialDistribution / midas.instrument-base.v1'
              : weightsSourceMode === 'last-known-official'
                ? 'lastKnownOfficialWeights'
                : 'weightsSourceMode=error';
    const mixReason = weightsSourceMode === 'instrument-universe'
      ? 'Se usa la fuente principal porque el mix aperturado por instrumento está disponible y se pudo derivar al mix agregado M8.'
      : weightsSourceMode === 'simulation'
        ? 'Se usa override manual temporal en el mix agregado M8; no reemplaza la fuente estructural.'
        : weightsSourceMode === 'instrument-base'
          ? 'Se usa respaldo porque el mix aperturado por instrumento no está disponible o no alcanza para derivar el mix agregado M8.'
          : mixDiffPp <= 0.5
            ? 'Se usa fallback activo, sin diferencia material contra la mejor referencia disponible.'
            : 'Se usa fallback activo; la diferencia contra la mejor referencia disponible sí es material.';

    const fxSeverity: TraceSeverity = (() => {
      if (operativeFxResolution.reasonCode === 'aurum_current_applied') return 'OK';
      if (operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied') return 'Alerta';
      return 'Aviso';
    })();
    const fxReason = operativeFxResolution.reasonCode === 'aurum_current_applied'
      ? 'Se usa la fuente principal correcta de Aurum (FX current publicado).'
      : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied'
        ? 'Aurum publica FX current, pero el runtime está aplicando fallback operativo.'
        : `Se usa fallback porque Aurum no publica un FX current usable (${fxSpotSourceTechnical}).`;

    return [
      {
        id: 'aurum',
        name: 'Aurum importado',
        severity: aurumSeverity,
        usingNow: snapshotApplied
          ? 'Aurum (snapshot aplicado)'
          : 'Base local MIDAS',
        valueApplied: formatMoneyCompact(effectiveBaseCapital),
        appliedAt: formatSessionMoment(lastAutoAppliedAtMs),
        principal: {
          human: 'Aurum',
          technical: 'Aurum published optimizable snapshot',
          value: aurumSyncLatestOpt !== null && Number.isFinite(aurumSyncLatestOpt)
            ? formatMoneyCompact(aurumSyncLatestOpt)
            : 'No disponible',
        },
        fallback: {
          human: 'Base local MIDAS',
          technical: 'baseParams.simulationComposition',
          value: aurumSyncBaseOpt !== null && Number.isFinite(aurumSyncBaseOpt)
            ? formatMoneyCompact(aurumSyncBaseOpt)
            : formatMoneyCompact(effectiveBaseCapital),
        },
        reason: aurumReason,
        impact: aurumDiffPct === null
          ? 'Sin comparación material disponible'
          : aurumDiffPct > 0.05
            ? `Diferencia material ${(aurumDiffPct * 100).toFixed(2)}%`
            : aurumDiffPct > 0.01
              ? `Diferencia moderada ${(aurumDiffPct * 100).toFixed(2)}%`
              : `Sin diferencia material (${(aurumDiffPct * 100).toFixed(2)}%)`,
      },
      {
        id: 'risk-capital',
        name: 'Capital de riesgo',
        severity: riskSeverity,
        usingNow: riskCapitalEffective
          ? 'Aurum (riskCapital)'
          : 'No aplicado',
        valueApplied: riskCapitalEffective ? formatMoneyCompact(riskDetectedClp) : formatMoneyCompact(0),
        appliedAt: formatSessionMoment(lastTimelineAtMs),
        principal: {
          human: 'Aurum',
          technical: 'simulationComposition.nonOptimizable.riskCapital',
          value: riskDetectedClp > 0 ? formatMoneyCompact(riskDetectedClp) : 'No detectado',
        },
        fallback: null,
        reason: riskReason,
        impact: riskCapitalEffective
          ? 'Aplicado correctamente al escenario'
          : riskDetectedClp > 0
            ? 'Detectado, no aplicado por toggle'
            : 'Sin impacto (no disponible)',
      },
      {
        id: 'distribution',
        name: 'Mix aperturado por instrumento',
        severity: mixSeverity,
        usingNow: `${weightsSourceLabel} (${weightsSourceMode})`,
        valueApplied: activeWeightSummary,
        appliedAt: formatSessionMoment(lastTimelineAtMs),
        principal: {
          human: 'Mix aperturado por instrumento',
          technical: 'midas.instrument-universe.v1',
          value: universeWeightSummary,
        },
        fallback: {
          human: mixFallbackName,
          technical: mixFallbackTech,
          value: weightsSourceMode === 'system-defaults'
            ? officialWeightSummary
            : weightsSourceMode === 'simulation'
              ? instrumentBaseWeightSummary
              : instrumentBaseWeightSummary,
        },
        reason: mixReason,
        impact: mixDiffPp > 2
          ? `Diferencia material ${mixDiffPp.toFixed(2)} pp`
          : mixDiffPp > 0.5
            ? `Diferencia moderada ${mixDiffPp.toFixed(2)} pp`
            : `Sin diferencia material (${mixDiffPp.toFixed(2)} pp)`,
      },
      {
        id: 'fx',
        name: 'FX operativo',
        severity: fxSeverity,
        usingNow: usingPrimaryFx
          ? 'Aurum online/manual'
          : 'FX operativo del motor',
        valueApplied: `USD/CLP ${formatNumber(backupFxClp)}`,
        appliedAt: formatSessionMoment(lastTimelineAtMs),
        principal: {
          human: 'Aurum online/manual',
          technical: primaryFxTechnical,
          value: Number.isFinite(primaryFxClp) && primaryFxClp !== null
            ? `USD/CLP ${formatNumber(primaryFxClp)}`
            : 'No disponible',
        },
        fallback: {
          human: 'FX operativo del motor',
          technical: 'params.fx.clpUsdInitial',
          value: `USD/CLP ${formatNumber(backupFxClp)}`,
        },
        reason: fxReason,
        impact: fxDiffPct === null
          ? 'Sin comparación material disponible'
          : !usingPrimaryFx && hasAurumPrimaryFx
            ? `Diferencia vs FX activo de Aurum ${(fxDiffPct * 100).toFixed(2)}%`
          : fxDiffPct > 0.01
            ? `Diferencia material ${(fxDiffPct * 100).toFixed(2)}%`
          : fxDiffPct > 0.0025
              ? `Diferencia moderada ${(fxDiffPct * 100).toFixed(2)}%`
              : `Sin diferencia material (${(fxDiffPct * 100).toFixed(2)}%)`,
      },
    ];
  }, [
    activeWeightSummary,
    aurumDiffPct,
    aurumIntegrationStatus,
    aurumSyncBaseOpt,
    aurumSyncLatestOpt,
    backupFxClp,
    aurumFxSpotCLP,
    aurumFxSpotSource,
    operativeFxResolution,
    effectiveBaseCapital,
    fxDiffPct,
    hasAurumPrimaryFx,
    usingPrimaryFx,
    formatNumber,
    fxSpotSourceTechnical,
    hasPendingSnapshot,
    instrumentBaseWeightSummary,
    lastAutoAppliedAtMs,
    lastTimelineAtMs,
    mixDiffPp,
    officialWeightSummary,
    primaryFxClp,
    primaryFxTechnical,
    riskCapitalEffective,
    riskCapitalEnabled,
    riskDetectedClp,
    snapshotApplied,
    universeWeightSummary,
    weightsSourceMode,
    weightsSourceLabel,
  ]);
  const traceStatusCounts = useMemo(() => ({
    ok: appliedTraceRows.filter((row) => row.severity === 'OK').length,
    warning: appliedTraceRows.filter((row) => row.severity === 'Aviso').length,
    alert: appliedTraceRows.filter((row) => row.severity === 'Alerta').length,
  }), [appliedTraceRows]);
  const trustLayerStatusCounts = useMemo(() => {
    const snapshotLevel = snapshotFreshness === 'fresh' ? 'ok' : snapshotFreshness === 'aging' ? 'warning' : 'alert';
    const fxLevel = operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh'
      ? 'ok'
      : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale'
        ? 'alert'
        : 'warning';
    const mixLevel = weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled')
      ? 'ok'
      : weightsSourceMode === 'instrument-universe'
        ? 'warning'
        : 'alert';
    const riskLevel = riskFxMismatchPct === null || riskCapitalUsdSnapshotCLP <= 0 || riskFxMismatchPct <= 0.02
      ? 'ok'
      : riskFxMismatchPct > 0.05
        ? 'alert'
        : 'warning';
    const levels = [snapshotLevel, fxLevel, mixLevel, riskLevel];
    return {
      ok: levels.filter((level) => level === 'ok').length,
      warning: levels.filter((level) => level === 'warning').length,
      alert: levels.filter((level) => level === 'alert').length,
    };
  }, [
    operativeFxResolution.reasonCode,
    riskCapitalUsdSnapshotCLP,
    riskFxMismatchPct,
    snapshotFreshness,
    instrumentUniverseCloudReadStatus,
    universeSourceOrigin,
    weightsSourceMode,
  ]);
  const toggleTraceRow = useCallback((id: string) => {
    setOpenTraceRows((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const heroHorizonYears = useMemo(() => {
    const normalized = (m8InputFingerprint.normalizedInput ?? {}) as Record<string, unknown>;
    const years = Number(normalized.years ?? NaN);
    if (Number.isFinite(years) && years > 0) return Math.round(years);
    const simulation = normalized.simulation as Record<string, unknown> | undefined;
    const horizonMonths = Number(simulation?.horizonMonths ?? NaN);
    if (Number.isFinite(horizonMonths) && horizonMonths > 0) return Math.round(horizonMonths / 12);
    return null;
  }, [m8InputFingerprint.normalizedInput]);
  const heroQuestion = heroHorizonYears !== null
    ? `¿Llegarás a ${heroHorizonYears} años?`
    : '¿Llegarás al horizonte objetivo?';
  const appliedDataTechnicalBlock = (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: isMobileViewport ? '7px 8px' : '8px 10px',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ color: T.textPrimary, fontSize: isMobileViewport ? 12 : 13, fontWeight: 800 }}>
          Datos aplicados automáticamente
        </div>
        <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 10 : 11 }}>
          {appliedTraceRows.length} fuentes · {traceStatusCounts.ok} OK · {traceStatusCounts.warning} Aviso · {traceStatusCounts.alert} Alerta · última aplicación {formatSessionMoment(lastAutoAppliedAtMs)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 5 }}>
        {appliedTraceRows.map((row) => {
          const isOpen = Boolean(openTraceRows[row.id]);
          const severityColor = row.severity === 'OK' ? T.positive : row.severity === 'Aviso' ? T.warning : T.negative;
          return (
            <div
              key={row.id}
              style={{
                border: `1px solid ${T.border}`,
                background: T.surfaceEl,
                borderRadius: 8,
                padding: isMobileViewport ? '5px 7px' : '6px 9px',
                display: 'grid',
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={() => toggleTraceRow(row.id)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'inherit',
                  display: 'grid',
                  gap: 2,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: isMobileViewport ? 'wrap' : 'nowrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ color: T.textPrimary, fontSize: isMobileViewport ? 11 : 12, fontWeight: 800 }}>
                      {row.name}
                    </span>
                    <span
                      style={{
                        color: severityColor,
                        fontSize: 10,
                        fontWeight: 800,
                        background: 'rgba(148,163,184,0.12)',
                        border: '1px solid rgba(148,163,184,0.25)',
                        borderRadius: 999,
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.severity}
                    </span>
                  </div>
                  <span style={{ color: T.textMuted, fontSize: isMobileViewport ? 10 : 11, fontWeight: 700 }}>
                    {isOpen ? '▴' : '▾'}
                  </span>
                </div>
                <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                  Usando ahora: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{row.usingNow}</span> · Valor aplicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{row.valueApplied}</span>
                </div>
              </button>
              {isOpen && (
                <div style={{ display: 'grid', gap: 2, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Principal: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{row.principal.human}</span> ({row.principal.technical}) · {row.principal.value}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Respaldo: {row.fallback
                      ? <><span style={{ color: T.textPrimary, fontWeight: 700 }}>{row.fallback.human}</span> ({row.fallback.technical}) · {row.fallback.value}</>
                      : 'Sin respaldo definido'}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Usando ahora: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{row.usingNow}</span>
                  </div>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Motivo: <span style={{ color: T.textPrimary }}>{row.reason}</span>
                  </div>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Valor aplicado final: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{row.valueApplied}</span>
                  </div>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Impacto / diferencia: <span style={{ color: T.textPrimary }}>{row.impact}</span>
                  </div>
                  <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}>
                    Cuándo: {row.appliedAt}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
  const inputM8TechnicalBlock = (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: isMobileViewport ? '7px 8px' : '9px 10px',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ color: T.textPrimary, fontSize: isMobileViewport ? 11 : 12, fontWeight: 800 }}>
          Input M8: {m8InputFingerprint.hash} · {cloudHydrationReady ? 'cloud' : 'mixto cloud/cache'} · seed {Number(params.simulation?.seed ?? 0)} · nSim {Number(params.simulation?.nSim ?? 0)}
        </div>
        <button
          type="button"
          onClick={async () => {
            const runtimeDiagnostics =
              (m8InputFingerprint.diagnosticInput.runtimeDiagnostics as Record<string, unknown> | undefined) ?? {};
            const instrumentUniverseDiagnostics =
              (m8InputFingerprint.diagnosticInput.instrumentUniverseDiagnostics as Record<string, unknown> | undefined) ?? {};
            const replayTrace =
              (m8InputFingerprint.diagnosticInput.replayTrace as Record<string, unknown> | undefined) ?? null;
            const simulationRunDiagnostics = {
              simulationRunStatus: runtimeDiagnostics.simulationRunStatus ?? null,
              simulationRunStartedAt: runtimeDiagnostics.simulationRunStartedAt ?? null,
              simulationRunCompletedAt: runtimeDiagnostics.simulationRunCompletedAt ?? null,
              simulationRunError: runtimeDiagnostics.simulationRunError ?? null,
              blockedReason: runtimeDiagnostics.blockedReason ?? null,
              effectiveEngineInputHash: m8InputFingerprint.effectiveEngineInputHash,
              lastRunInputHash: runtimeDiagnostics.lastRunInputHash ?? null,
              lastRenderedResultHash: runtimeDiagnostics.lastRenderedResultHash ?? null,
              resultMetricsAvailable: runtimeDiagnostics.resultMetricsAvailable ?? false,
              resultSource: runtimeDiagnostics.resultSource ?? 'none',
              staleResult:
                runtimeDiagnostics.lastRenderedResultHash != null
                  ? runtimeDiagnostics.lastRenderedResultHash !== m8InputFingerprint.effectiveEngineInputHash
                  : Boolean(runtimeDiagnostics.staleResult ?? false),
              heroMetricsSource: runtimeDiagnostics.heroMetricsSource ?? 'none',
            };
            const payload = JSON.stringify({
              fingerprint: m8InputFingerprint.hash,
              effectiveEngineInputHash: m8InputFingerprint.effectiveEngineInputHash,
              diagnosticHash: m8InputFingerprint.diagnosticHash,
              hashIncludesDiagnostics: m8InputFingerprint.hashIncludesDiagnostics,
              createdAt: m8InputFingerprint.createdAt,
              sources: m8InputFingerprint.sources,
              warnings: m8InputFingerprint.warnings,
              sourcePolicy,
              replayTrace,
              normalizedInput: m8InputFingerprint.normalizedInput,
              diagnosticInput: m8InputFingerprint.diagnosticInput,
              instrumentUniverseDiagnostics,
              simulationRunDiagnostics,
              simulationResultDiagnostics,
              qualityOfLifeMetrics: resultCentral?.qualityOfLifeMetrics ?? null,
              midasEvaluation: midasEvaluation ?? null,
              resultConfidence,
              assumptionModeDiagnostics,
            }, null, 2);
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(payload);
              return;
            }
            window.prompt('Copiar input M8 aplicado', payload);
          }}
          style={{
            border: `1px solid ${T.border}`,
            background: T.surfaceEl,
            color: T.textPrimary,
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            padding: '5px 9px',
            cursor: 'pointer',
          }}
        >
          Copiar input M8 aplicado
        </button>
      </div>
      <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 10 : 11 }}>
        Parámetros simulación: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{simulationConfigSource === 'cloud' ? 'cloud' : simulationConfigSource === 'local_cache' ? 'cache local' : 'fallback'}</span>
        {simulationConfigSavedAt ? <> · actualizado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{formatRelativePublishedAt(simulationConfigSavedAt)}</span></> : null}
      </div>
      {sourcePolicy && (
        <div style={{ color: sourcePolicyTone === 'alert' ? T.negative : sourcePolicyTone === 'warning' ? T.warning : T.textMuted, fontSize: isMobileViewport ? 10 : 11 }}>
          Política de fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{sourcePolicy.label}</span>
          {' · '}
          {sourcePolicy.effectiveSourceSummary}
        </div>
      )}
      {replayTrace && (
        <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 10 : 11 }}>
          Trace replay: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{String((replayTrace.fingerprints as Record<string, unknown> | undefined)?.effectiveEngineInputFingerprint ?? '—')}</span>
          {' · '}
          estado <span style={{ color: T.textPrimary, fontWeight: 700 }}>{String((replayTrace.readiness as Record<string, unknown> | undefined)?.state ?? 'unknown')}</span>
        </div>
      )}
      {!cloudHydrationReady && (
        <div style={{ color: T.warning, fontSize: 10 }}>
          Sincronizando fuentes canónicas... resultado provisional desde cache local.
        </div>
      )}
      {m8InputFingerprint.warnings.length > 0 && (
        <div style={{ color: T.warning, fontSize: 10 }}>
          {m8InputFingerprint.warnings.join(' · ')}
        </div>
      )}
    </div>
  );

  const updateSpendingPhase = (index: number, amount: number) => {
    onUpdateParams((prev) => {
      const normalizedPrevPhases = normalizeModelSpendingPhases(prev);
      const next = {
        ...prev,
        spendingPhases: normalizedPrevPhases.map((p, i) => (i === index ? { ...p, amountReal: amount } : p)),
      };
      return next;
    });
  };
  const beginSpendingEdit = useCallback((index: number, currentAmount: number) => {
    setSpendingDraftByIndex((prev) => ({
      ...prev,
      [index]: String(Math.max(0, Math.round(currentAmount))),
    }));
  }, []);
  const updateSpendingDraft = useCallback((index: number, rawValue: string) => {
    const digitsOnly = rawValue.replace(/\D/g, '');
    setSpendingDraftByIndex((prev) => ({
      ...prev,
      [index]: digitsOnly,
    }));
  }, []);
  const commitSpendingDraft = useCallback((index: number) => {
    setSpendingDraftByIndex((prev) => {
      const draftValue = prev[index];
      if (typeof draftValue === 'string' && draftValue.trim() !== '') {
        const parsed = Number(draftValue);
        if (Number.isFinite(parsed) && parsed > 0) {
          updateSpendingPhase(index, parsed);
        }
      }
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }, [updateSpendingPhase]);

  const toggleLiquidarDepto = () => {
    if (!hasEffectiveRealEstate) return;
    onUpdateParams((prev) => ({
      ...prev,
      realEstatePolicy: {
        enabled: !(prev.realEstatePolicy?.enabled ?? true),
        triggerRunwayMonths: prev.realEstatePolicy?.triggerRunwayMonths ?? 36,
        saleDelayMonths: prev.realEstatePolicy?.saleDelayMonths ?? 12,
        saleCostPct: prev.realEstatePolicy?.saleCostPct ?? 0,
        realAppreciationAnnual: prev.realEstatePolicy?.realAppreciationAnnual ?? 0,
      },
    }));
  };
  const nSimOptions = [1000, 3000, 5000] as const;
  const currentNSim = Number(params.simulation?.nSim ?? 1000);
  const simulationDataSummary = useMemo(() => {
    const totalLabel = patrimonioTotalHoyClp !== null
      ? `Patrimonio hoy ${formatMoneyCompact(patrimonioTotalHoyClp)}`
      : 'Patrimonio hoy no disponible';
    const resourcesLabel = patrimonioAmpliadoModeloClp !== null
      ? `Recursos ${formatMoneyCompact(patrimonioAmpliadoModeloClp)}`
      : 'Recursos no disponibles';
    return [
      totalLabel,
      resourcesLabel,
      scenarioUiLabel,
      `${currentNSim} sim`,
      `Depto ${liquidarDeptoEnabled ? 'ON' : 'OFF'}`,
      `Capital riesgo ${riskCapitalEnabled ? 'ON' : 'OFF'}`,
    ].join(' · ');
  }, [currentNSim, liquidarDeptoEnabled, patrimonioAmpliadoModeloClp, patrimonioTotalHoyClp, riskCapitalEnabled, scenarioUiLabel]);
  const setNSim = (nSim: number) => {
    onUpdateParams((prev) => ({
      ...prev,
      simulation: {
        ...prev.simulation,
        nSim,
      },
    }));
  };
  const currentRvTotalPct = Math.round((params.weights.rvGlobal + params.weights.rvChile) * 1000) / 10;
  const currentRfTotalPct = Math.round((params.weights.rfGlobal + params.weights.rfChile) * 1000) / 10;
  const updateTemporaryRvTotalPct = (rvPct: number) => {
    const nextWeights = deriveSleevesFromRvRfTarget(params.weights, rvPct);
    onUpdateParams((prev) => ({ ...prev, weights: nextWeights }));
  };
  const runLongevityPlus5 = useCallback(async () => {
    if (longevityRunning || !displayResult) return;
    setLongevityRunning(true);
    setLongevityError(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const shadow45 = runSimulationCentral(buildLongevityPlus5Params(params));
      const success45 = shadow45.success40 ?? (1 - (shadow45.probRuin40 ?? shadow45.probRuin));
      const success40Base = displayResult.success40 ?? (1 - (displayResult.probRuin40 ?? displayResult.probRuin));
      const carryAmong40 = success40Base > 0 ? (success45 / success40Base) : null;
      setLongevityResult({
        success45,
        drop40To45Pp: (success40Base - success45) * 100,
        carryAmong40,
        terminalP50All45: shadow45.p50TerminalAllPaths ?? null,
      });
    } catch (error) {
      setLongevityError(error instanceof Error ? error.message : String(error));
    } finally {
      setLongevityRunning(false);
    }
  }, [displayResult, longevityRunning, params]);

  useEffect(() => {
    setLongevityResult(null);
    setLongevityError(null);
  }, [params]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobileViewport ? 10 : 14 }}>
      <div style={{ position: 'relative', order: isMobileViewport ? 1 : 2 }}>
        <style>{`
          @keyframes midasPulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.25); opacity: 1; }
          }
        `}</style>
        <div style={{ opacity: heroPrimaryState.label === 'No usar' ? 0.72 : 1 }}>
          <HeroCard
            label={heroQuestion.toUpperCase()}
            valuePct={showBootPlaceholder ? null : heroProbSuccess}
            stale={showGhostResult || heroShowsRunActive}
            subtitle={
              simUiState === 'error'
                ? `Error de recálculo: ${simUiError || 'reintenta'}`
                : heroShowsRunActive
                ? 'Calculando resultado final.'
                : displayResult
                  ? (
                    <span style={{ display: 'grid', gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={openDiagnosticsFromHero}
                          title="Ver diagnóstico"
                          style={{
                            background: 'transparent',
                            cursor: 'pointer',
                            border: `1px solid ${heroPrimaryState.tone}`,
                            color: heroPrimaryState.tone,
                            borderRadius: 999,
                            padding: '2px 8px',
                            fontSize: 10,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {heroPrimaryState.label}
                        </button>
                        <button
                          type="button"
                          onClick={openDiagnosticsFromHero}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            color: T.textSecondary,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {heroPrimaryState.headline}
                        </button>
                      </span>
                      {heroConfidenceBlock}
                      <span>{`${Math.round(displayResult.nRuin)}/${displayResult.nTotal} dieron ruina`}</span>
                      <span
                        style={{
                          display: 'grid',
                          gap: 3,
                          gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(3, minmax(0, 1fr))',
                        }}
                      >
                        {[heroProbRuinLine, heroHouseCostLine, heroCutCostLine].map((item) => (
                          <span
                            key={item.label}
                            style={{
                              display: 'grid',
                              gap: 1,
                              padding: '4px 6px',
                              borderRadius: 8,
                              background: T.surfaceEl,
                              border: `1px solid ${T.border}`,
                            }}
                          >
                            <span style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>
                              {item.label}
                            </span>
                            <span>{item.detail}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                  )
                  : (
                    <span style={{ display: 'grid', gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={canonicalInputBlocked ? openDiagnosticsFromHero : onRunSimulation}
                          title={canonicalInputBlocked ? 'Revisar detalle técnico' : 'Ejecutar simulación'}
                          style={{
                            background: 'transparent',
                            cursor: 'pointer',
                            border: `1px solid ${heroPrimaryState.tone}`,
                            color: heroPrimaryState.tone,
                            borderRadius: 999,
                            padding: '2px 8px',
                            fontSize: 10,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {canonicalInputBlocked ? heroPrimaryState.label : 'Ejecutar simulación'}
                        </button>
                        <button
                          type="button"
                          onClick={canonicalInputBlocked ? openDiagnosticsFromHero : onRunSimulation}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            color: T.textSecondary,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Aún no hay simulación válida
                        </button>
                      </span>
                      {heroConfidenceBlock}
                    </span>
                  )
            }
            footerContent={null}
            mode={simActive ? 'sim' : 'real'}
            chips={[
              {
                id: 'state',
                value: heroBaseChipLabel,
                onClick: canResetToBase
                  ? () => {
                      onRestoreScenarioPreset();
                      onResetSim();
                    }
                  : undefined,
                disabled: !canResetToBase,
              },
              { id: 'return', value: `${(effectiveReturn * 100).toFixed(1)}%`, onClick: openSimulationPanelShortcut },
              { id: 'years', value: `${formatNumber(effectiveYears)} años`, onClick: openSimulationPanelShortcut },
              {
                id: 'capital',
                value: patrimonioMidasHoyAjustadoT0Clp !== null ? formatCapital(patrimonioMidasHoyAjustadoT0Clp) : formatCapital(effectiveCapital),
                note: heroWealthChipNote,
                onClick: openSimulationPanelShortcut,
                accessory: (
                  <button
                    type="button"
                    onClick={() => {
                      resetMovementForm();
                      openCapitalLedger();
                    }}
                    style={{
                      width: isMobileViewport ? 28 : 30,
                      height: isMobileViewport ? 28 : 30,
                      background: T.primary,
                      border: 'none',
                      color: '#fff',
                      borderRadius: '50%',
                      padding: 0,
                      fontSize: isMobileViewport ? 18 : 19,
                      lineHeight: 1,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title="Agregar evento manual"
                    aria-label="Agregar evento manual"
                  >
                    +
                  </button>
                ),
              },
            ]}
          />
        </div>
        {!simActive && (
          <div style={{ marginTop: 8, color: T.textMuted, fontSize: 11 }}>
            {localReadOnlyFallbackActive
              ? localReadOnlyFallbackCopy
              : 'Modelo base canónico · sin escenario aplicado.'}
          </div>
        )}
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
        {simWorking && simActive && (
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: showSimToast ? 88 : 30, color: T.textMuted, fontSize: 11 }}>
            Recalculando simulación...
          </div>
        )}
      </div>
      {hasPendingSnapshot && pendingSnapshotLabel && (
        <div
          style={{
            order: 4,
            background: 'rgba(91, 140, 255, 0.10)',
            border: '1px solid rgba(91, 140, 255, 0.45)',
            borderRadius: 10,
            padding: isMobileViewport ? '6px 8px' : '8px 10px',
            color: T.textPrimary,
            fontSize: isMobileViewport ? 10 : 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: isMobileViewport ? 'wrap' : 'nowrap',
          }}
        >
          <span style={{ lineHeight: 1.3 }}>Nueva base Aurum disponible · {pendingSnapshotLabel}</span>
          <button
            type="button"
            onClick={onApplyPendingSnapshot}
            disabled={pendingSnapshotApplying}
            style={{
              background: T.primary,
              border: 'none',
              color: '#fff',
              borderRadius: 9,
              padding: isMobileViewport ? '5px 8px' : '6px 10px',
              fontSize: isMobileViewport ? 10 : 11,
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
      {hasSyncBanner && (
        <div
          style={{
            order: 4,
            background: 'rgba(46, 204, 113, 0.12)',
            border: '1px solid rgba(46, 204, 113, 0.45)',
            borderRadius: 10,
            padding: isMobileViewport ? '6px 8px' : '8px 10px',
            color: T.textPrimary,
            fontSize: isMobileViewport ? 10 : 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: isMobileViewport ? 'wrap' : 'nowrap',
          }}
        >
          <span style={{ lineHeight: 1.3 }}>
            Aurum ya sincronizado · Base {baseOptLabel} · Aurum {latestOptLabel} · Δ {diffAbsLabel}
          </span>
          <span style={{ color: T.textMuted, fontSize: 10 }}>{pendingSnapshotLabel}</span>
        </div>
      )}
      <details
        ref={diagnosticsRef}
        open={diagnosticsOpen}
        onToggle={(e) => setDiagnosticsOpen((e.currentTarget as HTMLDetailsElement).open)}
        style={{ order: 10 }}
      >
        <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
          Ver detalle técnico
        </summary>
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
      {appliedDataTechnicalBlock}
      {inputM8TechnicalBlock}
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: isMobileViewport ? '7px 8px' : '9px 10px',
          display: 'grid',
          gap: 6,
        }}
      >
        <div style={{ display: 'grid', gap: 2 }}>
          <div style={{ color: T.textPrimary, fontSize: isMobileViewport ? 12 : 13, fontWeight: 800 }}>
            Data Trust Layer
          </div>
          <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 10 : 11 }}>
            Fuente, frescura y respaldo de los datos que más mueven la simulación.
          </div>
          <div style={{ color: T.textMuted, fontSize: isMobileViewport ? 10 : 11 }}>
            Gastos aplicados: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{(params.spendingPhases ?? []).map((phase, idx) => `F${idx + 1} ${formatMillionsMM(Number(phase.amountReal ?? 0) / 1_000_000)}`).join(' · ')}</span> ·
            Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{simulationConfigSource === 'cloud' ? 'cloud' : simulationConfigSource === 'local_cache' ? 'local cache' : 'fallback'}</span>
          </div>
        </div>
        {isMobileViewport ? (
          <details>
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                color: T.textPrimary,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <span>Datos: {trustLayerStatusCounts.ok} OK · {trustLayerStatusCounts.warning} avisos · {trustLayerStatusCounts.alert} alertas</span>
              <span style={{ color: T.textMuted, fontSize: 10 }}>Ver detalle</span>
            </summary>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr)',
                gap: 6,
                marginTop: 6,
              }}
            >
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Snapshot Aurum</div>
                  <span style={{ color: snapshotFreshnessUi.color, border: `1px solid ${snapshotFreshnessUi.color}33`, background: `${snapshotFreshnessUi.color}14`, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                    {snapshotFreshnessUi.label}
                  </span>
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{patrimonioSourceTechnical}</span> · Publicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{snapshotPublishedRelative}</span>
                </div>
                {snapshotFreshness !== 'fresh' && (
                  <div style={{ color: snapshotFreshness === 'stale' ? T.negative : T.warning, fontSize: 10 }}>
                    Snapshot Aurum {snapshotFreshness === 'unknown' ? 'sin fecha auditable' : 'antiguo'}: revisa publicación antes de confiar en la simulación.
                  </div>
                )}
              </div>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>FX operativo</div>
                  <span style={{ color: operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? T.positive : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? T.negative : T.warning, border: `1px solid ${operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? T.positive : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? T.negative : T.warning}33`, background: `${operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? T.positive : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? T.negative : T.warning}14`, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                    {operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? 'OK' : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? 'Alerta' : 'Aviso'}
                  </span>
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Aplicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{Number.isFinite(backupFxClp) ? `USD/CLP ${formatNumber(backupFxClp)}` : 'No disponible'}</span>
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{usingPrimaryFx ? 'Aurum current' : operativeFxResolution.reasonCode === 'manual_override_applied' ? 'Manual' : operativeFxResolution.aurumSource?.includes('closure') ? 'Aurum cierre' : 'Respaldo interno'}</span> · Publicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{snapshotPublishedRelative}</span>
                </div>
                {!usingPrimaryFx && !operativeFxResolution.aurumSource?.includes('closure') && operativeFxResolution.reasonCode !== 'manual_override_applied' && (
                  <div style={{ color: T.warning, fontSize: 10 }}>
                    Usando respaldo interno de FX. Revisa la fuente antes de confiar en la simulación.
                  </div>
                )}
              </div>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Mix agregado M8</div>
                  <span style={{ color: weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? T.positive : weightsSourceMode === 'instrument-universe' ? T.warning : T.negative, border: `1px solid ${weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? T.positive : weightsSourceMode === 'instrument-universe' ? T.warning : T.negative}33`, background: `${weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? T.positive : weightsSourceMode === 'instrument-universe' ? T.warning : T.negative}14`, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                    {instrumentUniverseCloudReadStatus === 'loading' ? 'Cargando' : instrumentUniverseCloudReadStatus === 'timeout' ? 'Timeout' : instrumentUniverseCloudReadStatus === 'missing' ? 'Falta' : weightsSourceMode === 'instrument-universe' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? 'OK' : weightsSourceMode === 'instrument-universe' ? 'Copia local' : 'Respaldo'}
                  </span>
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{mixTrustSourceLabel}</span> · Aplicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{activeWeightSummary}</span>
                </div>
                {(weightsSourceMode !== 'instrument-universe' || (universeSourceOrigin !== 'firestore' && universeSourceOrigin !== 'bundled')) && (
                  <div style={{ color: weightsSourceMode === 'instrument-universe' ? T.warning : T.negative, fontSize: 10 }}>
                    {weightsSourceMode === 'instrument-universe'
                      ? 'El mix aperturado por instrumento está usando una copia local.'
                      : 'El mix aperturado por instrumento está en modo de respaldo.'}
                  </div>
                )}
              </div>
            </div>
          </details>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
              gap: 6,
            }}
          >
            <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Snapshot Aurum</div>
                <span style={{ color: snapshotFreshnessUi.color, border: `1px solid ${snapshotFreshnessUi.color}33`, background: `${snapshotFreshnessUi.color}14`, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                  {snapshotFreshnessUi.label}
                </span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{patrimonioSourceTechnical}</span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Publicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{snapshotPublishedRelative}</span>
              </div>
              {snapshotFreshness !== 'fresh' && (
                <div style={{ color: snapshotFreshness === 'stale' ? T.negative : T.warning, fontSize: 10 }}>
                  Snapshot Aurum {snapshotFreshness === 'unknown' ? 'sin fecha auditable' : 'antiguo'}: revisa publicación antes de confiar en la simulación.
                </div>
              )}
            </div>
            <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>FX operativo</div>
                <span style={{ color: operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? T.positive : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? T.negative : T.warning, border: `1px solid ${operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? T.positive : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? T.negative : T.warning}33`, background: `${operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? T.positive : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? T.negative : T.warning}14`, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                  {operativeFxResolution.reasonCode === 'aurum_current_applied' && snapshotFreshness === 'fresh' ? 'OK' : operativeFxResolution.reasonCode === 'aurum_current_available_but_not_applied' || snapshotFreshness === 'stale' ? 'Alerta' : 'Aviso'}
                </span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Aplicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{Number.isFinite(backupFxClp) ? `USD/CLP ${formatNumber(backupFxClp)}` : 'No disponible'}</span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{usingPrimaryFx ? 'Aurum current' : operativeFxResolution.reasonCode === 'manual_override_applied' ? 'Manual' : operativeFxResolution.aurumSource?.includes('closure') ? 'Aurum cierre' : 'Respaldo interno'}</span>
              </div>
              {!usingPrimaryFx && !operativeFxResolution.aurumSource?.includes('closure') && operativeFxResolution.reasonCode !== 'manual_override_applied' && (
                <div style={{ color: T.warning, fontSize: 10 }}>
                  Usando respaldo interno de FX. Revisa la fuente antes de confiar en la simulación.
                </div>
              )}
            </div>
            <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Mix agregado M8</div>
                <span style={{ color: weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? T.positive : weightsSourceMode === 'instrument-universe' ? T.warning : T.negative, border: `1px solid ${weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? T.positive : weightsSourceMode === 'instrument-universe' ? T.warning : T.negative}33`, background: `${weightsSourceMode === 'instrument-universe' && instrumentUniverseCloudReadStatus === 'loaded' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? T.positive : weightsSourceMode === 'instrument-universe' ? T.warning : T.negative}14`, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                  {instrumentUniverseCloudReadStatus === 'loading' ? 'Cargando' : instrumentUniverseCloudReadStatus === 'timeout' ? 'Timeout' : instrumentUniverseCloudReadStatus === 'missing' ? 'Falta' : weightsSourceMode === 'instrument-universe' && (universeSourceOrigin === 'firestore' || universeSourceOrigin === 'bundled') ? 'OK' : weightsSourceMode === 'instrument-universe' ? 'Copia local' : 'Respaldo'}
                </span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{mixTrustSourceLabel}</span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Aplicado: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{activeWeightSummary}</span>
              </div>
              {(weightsSourceMode !== 'instrument-universe' || (universeSourceOrigin !== 'firestore' && universeSourceOrigin !== 'bundled')) && (
                <div style={{ color: weightsSourceMode === 'instrument-universe' ? T.warning : T.negative, fontSize: 10 }}>
                  {weightsSourceMode === 'instrument-universe'
                    ? 'El mix aperturado por instrumento está usando una copia local.'
                    : 'El mix aperturado por instrumento está en modo de respaldo.'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
      </details>
      <div style={{ order: isMobileViewport ? 2 : 0 }}>
        <QualityOfLifeMetricsBlock
          qualityOfLifeMetrics={resultCentral?.qualityOfLifeMetrics}
          midasEvaluation={midasEvaluation}
          isMobile={isMobileViewport}
        />
      </div>
      <details
        open={modelBaseOpen}
        onToggle={(e) => setModelBaseOpen((e.currentTarget as HTMLDetailsElement).open)}
        style={{ order: 9, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: isMobileViewport ? '7px 8px' : '9px 10px' }}
      >
        <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
          Modelo Base
        </summary>
        <div style={{ marginTop: 8, color: T.textMuted, fontSize: 10 }}>
          Edita los supuestos oficiales guardados. La simulación temporal no modifica este modelo.
        </div>
        {simActive && (
          <div
            style={{
              marginTop: 8,
              background: 'rgba(255, 176, 32, 0.10)',
              border: `1px solid rgba(255, 176, 32, 0.30)`,
              borderRadius: 10,
              padding: '7px 9px',
              color: '#f6d38d',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Hay una simulación temporal activa. Cambiar el Modelo Base modifica la fuente oficial, no solo esta prueba.
          </div>
        )}
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {[
            `Persistencia ${simulationConfigSourceLabel}`,
            simulationConfigSavedAt ? `Actualizado ${formatRelativePublishedAt(simulationConfigSavedAt)}` : 'Sin timestamp cloud',
            `Escenario oficial ${scenarioUiLabel}`,
            `Origen del capital ${activeCapitalSourceLabel}`,
            `Origen del mix ${weightsSourceLabel}`,
          ].map((item) => (
            <span
              key={item}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 999,
                border: `1px solid ${T.border}`,
                background: T.surfaceEl,
                color: T.textSecondary,
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {item}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
          <div>
            <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Horizonte base</div>
            <div
              style={{
                border: `1px solid ${T.border}`,
                background: T.surfaceEl,
                borderRadius: 10,
                padding: '8px 10px',
                color: T.textPrimary,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {baseYears} años
            </div>
          </div>
          <div>
            <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Gasto por tramos</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {spendingPhases.map((phase, idx) => (
                <label key={idx} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: T.textSecondary, fontSize: 11, whiteSpace: 'nowrap' }}>
                    {spendingPhaseLabels[idx]?.title ?? `F${idx + 1}`}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={Object.prototype.hasOwnProperty.call(spendingDraftByIndex, idx)
                      ? (spendingDraftByIndex[idx] ?? '')
                      : formatCLP(phase.amountReal)}
                    onFocus={() => beginSpendingEdit(idx, phase.amountReal)}
                    onChange={(e) => updateSpendingDraft(idx, e.target.value)}
                    onBlur={() => commitSpendingDraft(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      padding: '6px 8px',
                      color: T.textPrimary,
                      fontSize: 12,
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? 'minmax(0,1fr)' : 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gridTemplateColumns: 'auto 120px', alignItems: 'center', gap: 6 }}>
              <span style={{ color: T.textMuted, fontSize: 11 }}>Fee anual</span>
              <input
                type="number"
                value={(params.feeAnnual * 100).toFixed(2)}
                onChange={(e) => onUpdateParams((prev) => ({ ...prev, feeAnnual: Number(e.target.value) / 100 }))}
                style={{
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: '6px 8px',
                  color: T.textPrimary,
                  fontSize: 12,
                }}
              />
            </label>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Monte Carlo oficial</div>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '6px 8px', color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
                {Number(params.simulation?.nSim ?? 0).toLocaleString('es-CL')}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Seed oficial</div>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '6px 8px', color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
                {Number(params.simulation?.seed ?? 0).toLocaleString('es-CL')}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Bucket months</div>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '6px 8px', color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
                {Number(params.bucketMonths ?? 0).toLocaleString('es-CL')}
              </div>
            </div>
          </div>
          <div
            style={{
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              borderRadius: 10,
              padding: '8px 10px',
              display: 'grid',
              gap: 4,
            }}
          >
            <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
              Origen del mix: Mix aperturado por instrumento ({weightsSourceLabel})
            </div>
            <div style={{ color: T.textMuted, fontSize: 11 }}>
              Activo: {activeWeightSummary}
            </div>
            <div style={{ color: T.textMuted, fontSize: 11 }}>
              Fuente estructural: {officialWeightSummary}
            </div>
            <div style={{ color: T.textMuted, fontSize: 11 }}>
              Origen del capital: Aurum
            </div>
          </div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            La configuración oficial se persiste en cloud existente (`simulationActiveV1`) cuando la sesión canónica está activa. No se creó storage nuevo.
          </div>
        </div>
      {auditModeEnabled && auditProbe && (
        <div
          style={{
            background: 'rgba(91, 140, 255, 0.08)',
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: '10px 12px',
            color: T.textPrimary,
            fontSize: 11,
            display: 'grid',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 800, color: T.primary }}>Auditoría determinista</div>
            <button
              type="button"
              onClick={async () => {
                const payload = JSON.stringify(auditProbe, null, 2);
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(payload);
                  return;
                }
                window.prompt('Copia la auditoría JSON', payload);
              }}
              style={{
                border: `1px solid ${T.border}`,
                background: T.surface,
                color: T.textPrimary,
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 800,
                padding: '5px 9px',
                cursor: 'pointer',
              }}
            >
              Copiar auditoría JSON
            </button>
          </div>
          <div>Hero source: {auditProbe.heroSource} · requestId: {auditProbe.requestId ?? '—'}</div>
          <div>Seed: {auditProbe.seed} · n_paths: {auditProbe.nPaths} · input hash: {auditProbe.inputHash}</div>
          {auditProbe.normalizationsApplied && auditProbe.normalizationsApplied.notes.length > 0 && (
            <div>Normalizaciones: {auditProbe.normalizationsApplied.notes.join(' · ')}</div>
          )}
          <div>
            capital_initial_clp: {formatCapital(auditProbe.capitalInitial)} · capital_source: {auditProbe.capitalSource} · sourceLabel: {auditProbe.sourceLabel}
          </div>
          <div>
            riskCapitalEnabled: {auditProbe.riskCapitalEnabled ? 'ON' : 'OFF'} · house.include_house: {auditProbe.houseInclude ? 'true' : 'false'} · future_events: {auditProbe.futureEventsCount}
          </div>
          <div>
            Success40: {auditProbe.success40 !== null ? `${(auditProbe.success40 * 100).toFixed(2)}%` : '—'} · ProbRuin40: {auditProbe.probRuin40 !== null ? `${(auditProbe.probRuin40 * 100).toFixed(2)}%` : '—'} · ProbRuin20: {auditProbe.probRuin20 !== null ? `${(auditProbe.probRuin20 * 100).toFixed(2)}%` : '—'}
          </div>
        </div>
      )}
      </details>
      <details
        open={simulationDataOpen}
        onToggle={(e) => setSimulationDataOpen((e.currentTarget as HTMLDetailsElement).open)}
        style={{ order: isMobileViewport ? 4 : 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: isMobileViewport ? '7px 8px' : '9px 10px' }}
      >
        <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 800, listStyle: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Datos de simulación</span>
            <span style={{ color: T.textMuted, fontSize: 11 }}>{simulationDataOpen ? 'Ocultar detalle' : 'Ver detalle'}</span>
          </div>
          <div style={{ color: T.textPrimary, fontSize: isMobileViewport ? 11 : 12, fontWeight: 700, marginTop: 4 }}>
            {simulationDataSummary}
          </div>
        </summary>
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Barra de decisión
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? 'repeat(2, minmax(0,1fr))' : '1.35fr 0.9fr 0.9fr 1.25fr 1.2fr 1.1fr', gap: 6 }}>
                <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>Patrimonio total hoy</div>
                  <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>{patrimonioTotalHoyClp !== null ? formatMoneyCompact(patrimonioTotalHoyClp) : 'No disponible'}</div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    {patrimonioTotalHoyAurumNetoClp !== null
                      ? `Aurum ${formatMoneyCompact(patrimonioTotalHoyAurumNetoClp)} + Cap. riesgo ${formatMoneyCompact(patrimonioTotalHoyRiskClp)}`
                      : 'Patrimonio contable total desde snapshot Aurum.'}
                  </div>
                </div>
                <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>Depto</div>
                  <button
                    type="button"
                    onClick={toggleLiquidarDepto}
                    disabled={isRecalculating || !hasEffectiveRealEstate}
                    title={localReadOnlyDeptoUnavailable ? 'No disponible en modo local: falta configuración/snapshot cloud.' : undefined}
                    style={{
                      background: liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.16)' : T.surface,
                      border: `1px solid ${liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.55)' : T.border}`,
                      color: liquidarDeptoEnabled ? T.positive : T.textSecondary,
                      borderRadius: 999,
                      padding: isMobileViewport ? '6px 8px' : '6px 10px',
                      fontSize: isMobileViewport ? 10 : 11,
                      fontWeight: 700,
                      cursor: isRecalculating || !hasEffectiveRealEstate ? 'not-allowed' : 'pointer',
                      opacity: isRecalculating || !hasEffectiveRealEstate ? 0.65 : 1,
                    }}
                  >
                    {liquidarDeptoEnabled ? 'ON' : hasEffectiveRealEstate ? 'OFF' : 'NO DISP'}
                  </button>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    {localReadOnlyDeptoUnavailable
                      ? 'No disponible en modo local: falta configuración/snapshot cloud.'
                      : liquidarDeptoEnabled
                        ? 'Respaldo habilitado.'
                        : 'No se usa como respaldo.'}
                  </div>
                </div>
                <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>Capital de riesgo</div>
                  <button
                    type="button"
                    onClick={onToggleRiskCapital}
                    disabled={riskCapitalToggleDisabled}
                    title={localReadOnlyRiskUnavailable ? 'Sin capital de riesgo disponible en modo local.' : undefined}
                    style={{
                      background: riskCapitalEnabled ? 'rgba(255, 176, 32, 0.18)' : T.surface,
                      border: `1px solid ${riskCapitalEnabled ? 'rgba(255, 176, 32, 0.55)' : T.border}`,
                      color: riskCapitalEnabled ? '#f6d38d' : T.textSecondary,
                      borderRadius: 999,
                      padding: isMobileViewport ? '6px 8px' : '6px 10px',
                      fontSize: isMobileViewport ? 10 : 11,
                      fontWeight: 700,
                      cursor: riskCapitalToggleDisabled ? 'not-allowed' : 'pointer',
                      opacity: riskCapitalToggleDisabled ? 0.65 : 1,
                    }}
                  >
                    {riskToggleCopy}
                  </button>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    {riskCapitalToggleHelp}
                  </div>
                </div>
                <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>Recursos habilitados esta corrida</div>
                  <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>
                    {patrimonioAmpliadoModeloClp !== null ? formatMoneyCompact(patrimonioAmpliadoModeloClp) : 'No disponible'}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    {recursosHabilitadosSubcopy}
                  </div>
                  <SourceBadge label={wealthConfigLabel} tone={wealthConfigTone} />
                </div>
                <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>Escenario</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[SCENARIO_VARIANTS[1], SCENARIO_VARIANTS[0], SCENARIO_VARIANTS[2]].map((variant) => {
                      const active = activeScenarioForUi === variant.id;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => onScenarioChange(variant.id)}
                          disabled={isRecalculating}
                          style={{
                            background: active ? T.primary : T.surface,
                            border: `1px solid ${active ? T.primary : T.border}`,
                            color: active ? '#fff' : T.textSecondary,
                            borderRadius: 999,
                            padding: isMobileViewport ? '5px 8px' : '5px 9px',
                            fontSize: isMobileViewport ? 10 : 11,
                            fontWeight: 700,
                            cursor: isRecalculating ? 'not-allowed' : 'pointer',
                            opacity: isRecalculating ? 0.65 : 1,
                          }}
                        >
                          {variant.id === 'base' ? 'Neutro' : variant.id === 'pessimistic' ? 'Pesimista' : 'Optimista'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    {isScenarioAdjusted ? 'Ajustada sobre preset base.' : 'Preset activo.'}
                  </div>
                </div>
                <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>Monte Carlo</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {nSimOptions.map((nSimOption) => {
                      const active = currentNSim === nSimOption;
                      return (
                        <button
                          key={nSimOption}
                          type="button"
                          onClick={() => setNSim(nSimOption)}
                          disabled={isRecalculating}
                          style={{
                            background: active ? T.primary : T.surface,
                            border: `1px solid ${active ? T.primary : T.border}`,
                            color: active ? '#fff' : T.textSecondary,
                            borderRadius: 999,
                            padding: isMobileViewport ? '5px 8px' : '5px 9px',
                            fontSize: isMobileViewport ? 10 : 11,
                            fontWeight: 700,
                            cursor: isRecalculating ? 'not-allowed' : 'pointer',
                            opacity: isRecalculating ? 0.65 : 1,
                            minWidth: isMobileViewport ? 52 : 60,
                          }}
                        >
                          {nSimOption}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>Trayectorias de esta corrida.</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <details>
                <summary style={{ cursor: 'pointer', color: T.textSecondary, fontSize: 10, fontWeight: 700 }}>
                  Ver desglose patrimonial
                </summary>
                <div style={{ marginTop: 6, display: 'grid', gap: 5, color: T.textMuted, fontSize: 10 }}>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Patrimonio Aurum base visible:</span> {patrimonioAurumBaseVisibleClp !== null ? formatMoneyCompact(patrimonioAurumBaseVisibleClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital de riesgo detectado:</span> {formatMoneyCompact(riskDetectedClp)}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Patrimonio total hoy (Aurum + capital de riesgo):</span> {patrimonioTotalHoyClp !== null ? formatMoneyCompact(patrimonioTotalHoyClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital de riesgo incluido en patrimonio Aurum base:</span> {formatRiskCapitalInBaseLabel(riskCapitalIncludedInAurumBase)}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Ajuste de referencia por capital de riesgo:</span> {formatMoneyCompact(referenceRiskAdjustmentClp)}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Foto Aurum neta (referencia patrimonial):</span> {patrimonioReferenciaMidasClp !== null ? formatMoneyCompact(patrimonioReferenciaMidasClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital inicial del motor:</span> {capitalSentToMotorClp !== null ? formatMoneyCompact(capitalSentToMotorClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital inicial configurado del motor:</span> {Number.isFinite(params.capitalInitial) ? formatMoneyCompact(params.capitalInitial) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Respaldo/depto detectado:</span> {realEstateConsideredClp !== null ? formatMoneyCompact(realEstateConsideredClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Deuda no hipotecaria (snapshot):</span> {formatMoneyCompact(nonMortgageDebtClp)}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Deuda no hipotecaria (reconciliación Aurum):</span> {formatMoneyCompact(nonMortgageDebtClp)}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Impacto deuda no exigible (diagnóstico):</span> {`${nonExigibleDebtPolicyImpactCLP >= 0 ? '+' : ''}${formatMoneyCompact(nonExigibleDebtPolicyImpactCLP)}`}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Depto habilitado:</span> {liquidarDeptoEnabled ? 'Sí' : 'No'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Respaldo/depto incluido en patrimonio considerado:</span> {liquidarDeptoEnabled ? 'Sí' : 'No'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Valor/respaldo depto considerado:</span> {realEstateConsideredClp !== null ? formatMoneyCompact(realEstateConsideredClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital de riesgo habilitado para esta corrida:</span> {riskCapitalEnabled ? 'Sí' : 'No'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital de riesgo incluido en patrimonio considerado:</span> {riskCapitalEnabled ? 'Sí' : 'No'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital inicial líquido del motor (corrida efectiva):</span> {patrimonioConsideradoEfectivoCorridaClp !== null ? formatMoneyCompact(patrimonioConsideradoEfectivoCorridaClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Recursos ampliados bajo modelo (sin ajustes T0):</span> {patrimonioConsideradoBaseMidasClp !== null ? formatMoneyCompact(patrimonioConsideradoBaseMidasClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Recursos ampliados bajo modelo (corrida efectiva):</span> {patrimonioAmpliadoModeloClp !== null ? formatMoneyCompact(patrimonioAmpliadoModeloClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Impacto recursos habilitados (Depto/Riesgo):</span> {`${enabledResourcesImpactCLP >= 0 ? '+' : ''}${formatMoneyCompact(enabledResourcesImpactCLP)}`}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Impacto ajustes manuales T0 (+):</span> {`${manualLocalAdjustmentsImpactCLP >= 0 ? '+' : ''}${formatMoneyCompact(manualLocalAdjustmentsImpactCLP)}`}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Ajustes futuros programados (no afectan hoy):</span> {committedManualSummaryFuture.count > 0 ? `${committedManualSummaryFuture.netClp >= 0 ? '+' : '-'}${formatMoneyCompact(Math.abs(committedManualSummaryFuture.netClp))}${committedManualSummaryFuture.firstFutureDate ? ` · desde ${committedManualSummaryFuture.firstFutureDate}` : ''}` : 'Sin eventos futuros'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital efectivo usado por MIDAS (input actual):</span> {runCapitalCLP !== null ? formatMoneyCompact(runCapitalCLP) : 'No disponible'}</div>
                  {motorCapitalMismatchClp !== null && Math.abs(motorCapitalMismatchClp) > 0.5 ? (
                    <div style={{ color: T.warning }}>
                      Inconsistencia de capital core ({`${motorCapitalMismatchClp >= 0 ? '+' : ''}${formatMoneyCompact(motorCapitalMismatchClp)}`}) entre input actual y capital líquido (optimizable + bancos).
                    </div>
                  ) : null}
                  {expandedVsMotorGapClp !== null && Math.abs(expandedVsMotorGapClp) > 0.5 ? (
                    <div style={{ color: T.textMuted }}>
                      Diferencia recursos ampliados vs capital core: {`${expandedVsMotorGapClp >= 0 ? '+' : ''}${formatMoneyCompact(expandedVsMotorGapClp)}`}.
                    </div>
                  ) : null}
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Diferencia referencia vs capital core motor:</span> {coreReferenceGapClp !== null ? formatMoneyCompact(coreReferenceGapClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Diferencia referencia vs recursos ampliados:</span> {expandedReferenceGapClp !== null ? formatMoneyCompact(expandedReferenceGapClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Explicación de la diferencia ampliada:</span> {expandedReferenceGapClp !== null && expandedReferenceGapClp > 0
                    ? [
                        consideredWealthResolution.excludedRealEstateClp !== null && consideredWealthResolution.excludedRealEstateClp > 0 ? `depto excluido ${formatMoneyCompact(consideredWealthResolution.excludedRealEstateClp)}` : null,
                        consideredWealthResolution.excludedRiskCapitalClp > 0 ? `capital de riesgo excluido ${formatMoneyCompact(consideredWealthResolution.excludedRiskCapitalClp)}` : null,
                      ].filter(Boolean).join(' · ') || 'Diferencia pendiente de clasificar en bloques canónicos.'
                    : [
                        nonExigibleDebtPolicyImpactCLP > 0 ? `deuda no exigible reincorporada ${formatMoneyCompact(nonExigibleDebtPolicyImpactCLP)}` : null,
                        manualLocalAdjustmentsImpactCLP !== 0 ? `ajuste manual T0 ${manualLocalAdjustmentsImpactCLP >= 0 ? '+' : ''}${formatMoneyCompact(manualLocalAdjustmentsImpactCLP)}` : null,
                      ].filter(Boolean).join(' · ') || 'Sin exclusiones materiales frente a la referencia.'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Capital no usado por esta simulación:</span> {nonOptimizableVisibleClp !== null ? formatMoneyCompact(nonOptimizableVisibleClp) : 'No disponible'}</div>
                  <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Fuente patrimonial:</span> {patrimonioSourceTechnical}</div>
                  <div style={{ color: wealthConfigTone === 'alert' ? T.negative : wealthConfigTone === 'warning' ? T.warning : T.textSecondary }}>
                    {wealthConfigCopy}
                  </div>
                  <div>
                    El patrimonio de referencia MIDAS puede diferir del patrimonio visible de Aurum porque incorpora capital de riesgo detectado para análisis. El switch decide si MIDAS puede usarlo en esta corrida.
                  </div>
                  {realEstateConsideredClp === null || nonOptimizableVisibleClp === null ? (
                    <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Nota:</span> Algunos valores no están disponibles en esta corrida.</div>
                  ) : null}
                </div>
              </details>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: isMobileViewport ? '7px 8px' : '6px 9px', display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', rowGap: 4 }}>
                  <span style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Fuente de datos
                  </span>
                  <SourceBadge label={sourcePolicy?.shortLabel ?? dataSourceStatusLabel} tone={sourcePolicyTone} />
                  {sourcePolicy ? (
                    <span style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>{sourcePolicySummary}</span>
                  ) : null}
                  <span style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>{snapshotApplied ? 'Snapshot Aurum aplicado' : 'Snapshot Aurum no aplicado'}</span>
                  <SourceBadge label={mixSourceCompactLabel} tone={mixSourceTone} />
                  <span style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                    USD/CLP aplicado {Number.isFinite(backupFxClp) ? formatNumber(backupFxClp) : 'No disponible'}
                  </span>
                  <SourceBadge label={usdFxSourceSummary} tone={usdFxTone} />
                  <span style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                    EUR/USD aplicado {Number.isFinite(eurUsdModelValue)
                      ? eurUsdModelValue.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : 'No disponible'}
                  </span>
                  <SourceBadge label={eurFxSourceSummary} tone={eurFxTone} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4, minHeight: isMobileViewport ? undefined : 18 }}>
                  {usdFxWarning ? (
                    <span style={{ color: usdFxTone === 'alert' ? T.negative : T.warning, fontSize: 10 }}>
                      {usdFxWarning}
                    </span>
                  ) : null}
                  {eurFxWarning ? (
                    <span style={{ color: eurFxTone === 'alert' ? T.negative : T.warning, fontSize: 10 }}>
                      {eurFxWarning}
                    </span>
                  ) : null}
                  {!usdFxWarning && !eurFxWarning ? (
                    <span style={{ color: T.textMuted, fontSize: 10 }}>{sourcePolicy ? sourcePolicySummary : dataSourceStatusCopy}</span>
                  ) : null}
                  <details style={{ marginTop: 0 }}>
                    <summary style={{ cursor: 'pointer', color: T.textSecondary, fontSize: 10, fontWeight: 700 }}>
                      Ver detalle técnico
                    </summary>
                    <div style={{ marginTop: 6, display: 'grid', gap: 5, color: T.textMuted, fontSize: 10 }}>
                      <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Patrimonio:</span> {patrimonioSourceTechnical}</div>
                      {sourcePolicy ? (
                        <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Política:</span> {sourcePolicy.label} · {sourcePolicy.effectiveSourceSummary}</div>
                      ) : null}
                      <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Mix:</span> {distributionSourceTechnical}</div>
                      <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Instrument Universe cloud:</span> {instrumentUniverseCloudReadStatus || 'sin estado'}</div>
                      {instrumentUniverseCloudPath ? (
                        <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Path esperado:</span> {instrumentUniverseCloudPath}</div>
                      ) : null}
                      {instrumentUniverseCloudErrorMessage ? (
                        <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Razón técnica universe:</span> {instrumentUniverseCloudErrorMessage}</div>
                      ) : null}
                      <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>USD/CLP:</span> {fxSpotSourceTechnical}</div>
                      <div>
                        <span style={{ color: T.textSecondary, fontWeight: 700 }}>EUR/USD:</span>{' '}
                        {usingAurumEurUsd
                          ? `Transformación aplicada: 1 / ${aurumSourceUsdEur.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} = ${eurUsdModelValue.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} EUR/USD.`
                          : 'Valor tomado desde params.fx.usdEurFixed.'}
                      </div>
                      {hasAurumSourceUsdEur ? (
                        <div>
                          <span style={{ color: T.textSecondary, fontWeight: 700 }}>Valor fuente Aurum:</span>{' '}
                          fxReference.usdEur = {aurumSourceUsdEur.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD/EUR
                        </div>
                      ) : null}
                      <div><span style={{ color: T.textSecondary, fontWeight: 700 }}>Bloques fuera del motor:</span> {nonOptimizableBlocksTechnical}</div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
      </div>
      </details>
      {!hideResultBlocks && displayResult && (
        <details
          open={keyMetricsOpen}
          onToggle={(e) => setKeyMetricsOpen((e.currentTarget as HTMLDetailsElement).open)}
          style={{
            order: 5,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
            padding: isMobileViewport ? '8px 10px' : '10px 12px',
          }}
        >
          <summary style={{ cursor: 'pointer', color: T.textPrimary, fontWeight: 800, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: isMobileViewport ? '9px 4px' : '4px 2px', minHeight: isMobileViewport ? 42 : 38 }}>
            <span>Lectura ampliada</span>
            <span style={{ color: T.textMuted }}>{keyMetricsOpen ? '▴' : '▾'}</span>
          </summary>
          <div
            style={{
              marginTop: 8,
              display: 'grid',
              gridTemplateColumns: isMobileViewport ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: isMobileViewport ? 8 : 10,
            }}
          >
            <MetricTile
              compact={isMobileViewport}
              label="Ruina a 40 años"
              value={probRuin40 !== null ? `${(probRuin40 * 100).toFixed(1)}%` : '—'}
              tone="negative"
              traffic={ruin40Light}
            />
            <MetricTile
              compact={isMobileViewport}
              label="Ruina a 20 años"
              value={probRuin20 !== null ? `${(probRuin20 * 100).toFixed(1)}%` : '—'}
              traffic={ruin20Light}
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Patrimonio terminal típico (todos los escenarios)" info="P50 considerando todos los escenarios simulados, incluidos los que llegan a ruina." />}
              value={p50AllPaths !== null ? formatCapital(p50AllPaths) : '—'}
              tone="primary"
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Patrimonio terminal típico (sobrevivientes)" info="P50 considerando solo escenarios que terminan solventes al final del horizonte." />}
              value={p50Survivors !== null ? formatCapital(p50Survivors) : '—'}
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Gasto ejecutado vs plan" info="Proporción de gasto efectivamente ejecutado respecto del plan base." />}
              value={spendRatio !== null ? `${(spendRatio * 100).toFixed(1)}%` : '—'}
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Tiempo en recorte" info="Porcentaje del tiempo total en que el gasto operó bajo recortes (cut1 o cut2)." />}
              value={displayResult.cutTimeShare !== undefined ? `${(displayResult.cutTimeShare * 100).toFixed(1)}%` : '—'}
              traffic={cutTimeLight}
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Drawdown máximo" info="Máxima caída relativa desde el peak de patrimonio en cada escenario; se resume en percentiles." />}
              value={
                `P50 ${((displayResult.maxDrawdownPercentiles[50] ?? 0) * 100).toFixed(1)}% · ` +
                `P75 ${((displayResult.maxDrawdownPercentiles[75] ?? 0) * 100).toFixed(1)}% · ` +
                `P90 ${((displayResult.maxDrawdownPercentiles[90] ?? 0) * 100).toFixed(1)}%`
              }
              fullMobile={isMobileViewport}
              traffic={drawdownLight}
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Casa como amortiguador" info="Indica en qué escenarios se activa venta de casa y en qué momento se gatilla/ejecuta." />}
              value={
                houseSalePct !== null && houseSalePct > 0
                  ? `Venta ${(houseSalePct * 100).toFixed(1)}% · Disparo ${triggerYearMedian !== null ? `año ${triggerYearMedian.toFixed(1)}` : '—'} · Venta ${saleYearMedian !== null ? `año ${saleYearMedian.toFixed(1)}` : '—'}`
                  : 'No se activa en los escenarios simulados'
              }
              fullMobile={isMobileViewport}
              traffic={houseSaleLight}
            />
            <MetricTile
              compact={isMobileViewport}
              label={<LabelWithInfo label="Primeras ruinas relevantes" info="P10 del año de ruina condicional: considera solo escenarios que sí fracasan." />}
              value={firstRuinRelevantLabel}
              subvalue={`80% central: ${ruinCentral80Label}`}
              traffic={earlyRuinLight}
            />
          </div>
          <div style={{ marginTop: 7, color: T.textSecondary, fontSize: isMobileViewport ? 10 : 11 }}>
            {houseSaleSummary}
          </div>

          <details
            open={moreMetricsOpen}
            onToggle={(e) => setMoreMetricsOpen((e.currentTarget as HTMLDetailsElement).open)}
            style={{
              marginTop: isMobileViewport ? 10 : 12,
              background: T.surfaceEl,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: isMobileViewport ? '8px 10px' : '10px 12px',
            }}
          >
            <summary style={{ cursor: 'pointer', color: T.textPrimary, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: isMobileViewport ? '9px 4px' : '4px 2px', minHeight: isMobileViewport ? 40 : 36 }}>
              <span>Lectura analítica y técnica</span>
              <span style={{ color: T.textMuted }}>{moreMetricsOpen ? '▴' : '▾'}</span>
            </summary>
            <div style={{ marginTop: 8, display: 'grid', gap: isMobileViewport ? 10 : 12 }}>
              <MetricGroup
                title="Supervivencia y ruina"
                compact={isMobileViewport}
                items={[
                  { label: 'Probabilidad de éxito (40 años)', value: `${((displayResult.success40 ?? (1 - displayResult.probRuin)) * 100).toFixed(1)}%` },
                  { label: 'Ruina condicional (P25–P75)', value: ruinWindowLabel },
                  { label: 'Año típico de ruina (condicional)', value: ruinTypicalLabel },
                  { label: 'Banda de incertidumbre (ruina)', value: `Ruina ${(displayResult.uncertaintyBand.low * 100).toFixed(1)}% – ${(displayResult.uncertaintyBand.high * 100).toFixed(1)}%` },
                ]}
              />
              <MetricGroup
                title="Consumo y recortes"
                compact={isMobileViewport}
                items={[
                  { label: 'Gasto ejecutado tramo 2', value: displayResult.spendFactorPhase2 !== undefined ? `${(displayResult.spendFactorPhase2 * 100).toFixed(1)}%` : '—' },
                  { label: 'Gasto ejecutado tramo 3', value: displayResult.spendFactorPhase3 !== undefined ? `${(displayResult.spendFactorPhase3 * 100).toFixed(1)}%` : '—' },
                  {
                    label: 'Meses de recorte',
                    value:
                      displayResult.spendFactorCutMonths !== undefined ||
                      displayResult.spendFactorNoCutMonths !== undefined ||
                      displayResult.spendFactorCut1Months !== undefined ||
                      displayResult.spendFactorCut2Months !== undefined
                        ? `Cut ${(displayResult.spendFactorCutMonths ?? 0).toFixed(1)} · Sin cut ${(displayResult.spendFactorNoCutMonths ?? 0).toFixed(1)} · C1 ${(displayResult.spendFactorCut1Months ?? 0).toFixed(1)} · C2 ${(displayResult.spendFactorCut2Months ?? 0).toFixed(1)}`
                        : '—',
                  },
                  {
                    label: 'Tiempo en estrés / recortes',
                    value: `Estrés ${((displayResult.stressTimeShare ?? 0) * 100).toFixed(1)}% · C1 ${((displayResult.cut1TimeShare ?? 0) * 100).toFixed(1)}% · C2 ${((displayResult.cut2TimeShare ?? 0) * 100).toFixed(1)}%`,
                  },
                ]}
              />
              <MetricGroup
                title="Patrimonio terminal"
                compact={isMobileViewport}
                items={[
                  { label: 'P25 todos los escenarios', value: displayResult.terminalP25AllPaths !== undefined ? formatCapital(displayResult.terminalP25AllPaths) : '—' },
                  { label: 'P25 solo sobrevivientes', value: displayResult.terminalP25IfSuccess !== undefined ? formatCapital(displayResult.terminalP25IfSuccess) : '—' },
                  { label: 'P75 todos los escenarios', value: displayResult.terminalP75AllPaths !== undefined ? formatCapital(displayResult.terminalP75AllPaths) : '—' },
                  { label: 'P75 solo sobrevivientes', value: displayResult.terminalP75IfSuccess !== undefined ? formatCapital(displayResult.terminalP75IfSuccess) : '—' },
                ]}
              />
              <MetricGroup
                title="Motor y soporte"
                compact={isMobileViewport}
                items={[
                  { label: 'Generador activo', value: activeGenerator },
                  {
                    label: 'Escenarios simulados',
                    value: Array.isArray(displayResult.terminalWealthAllPaths) ? `${displayResult.terminalWealthAllPaths.length}` : '—',
                  },
                ]}
              />
            </div>
          </details>
        </details>
      )}
      <div style={{ order: 5, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onOpenOptimization}
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            color: T.textSecondary,
            borderRadius: 999,
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Explorar optimización
        </button>
      </div>

      {!hideResultBlocks && displayResult && (
        <details
          open={longevityOpen}
          onToggle={(e) => setLongevityOpen((e.currentTarget as HTMLDetailsElement).open)}
          style={{
            order: 6,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: isMobileViewport ? '8px 10px' : '10px 12px',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              color: T.textPrimary,
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: isMobileViewport ? '9px 4px' : '4px 2px',
              minHeight: isMobileViewport ? 40 : 36,
            }}
          >
            <span>Prórroga +5 años</span>
            <span style={{ color: T.textMuted }}>{longevityOpen ? '▾' : '▸'}</span>
          </summary>
          {longevityOpen ? (
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              <div style={{ color: T.textMuted, fontSize: 11, lineHeight: 1.35 }}>
                Explora cuánto aguanta este escenario si necesitara durar cinco años más. Esta métrica no cambia el resultado oficial a 40 años.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  onClick={runLongevityPlus5}
                  disabled={longevityRunning}
                  style={{
                    background: longevityRunning ? T.surface : T.primary,
                    border: `1px solid ${longevityRunning ? T.border : T.primary}`,
                    color: longevityRunning ? T.textMuted : '#fff',
                    borderRadius: 999,
                    padding: isMobileViewport ? '6px 10px' : '6px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: longevityRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {longevityRunning ? 'Calculando prórroga +5…' : 'Calcular prórroga +5'}
                </button>
              </div>
              {longevityError ? (
                <div style={{ color: T.negative, fontSize: 11 }}>
                  {longevityError}
                </div>
              ) : null}
              {longevityResult ? (
                <div
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    padding: isMobileViewport ? '9px 10px' : '10px 12px',
                    display: 'grid',
                    gap: 4,
                    color: T.textSecondary,
                    fontSize: isMobileViewport ? 11 : 12,
                  }}
                >
                  <div>Éxito 45 años: {((longevityResult.success45 ?? 0) * 100).toFixed(1)}%</div>
                  <div>
                    Caída 40 → 45: {longevityResult.drop40To45Pp >= 0 ? '-' : '+'}{Math.abs(longevityResult.drop40To45Pp).toFixed(1)} pp
                  </div>
                  <div>
                    Prórroga +5 entre quienes llegaron a 40:{' '}
                    {longevityResult.carryAmong40 !== null ? `${(longevityResult.carryAmong40 * 100).toFixed(1)}%` : 'No disponible'}
                  </div>
                  <div>
                    Terminal P50 all a 45:{' '}
                    {longevityResult.terminalP50All45 !== null ? formatCapital(longevityResult.terminalP50All45) : '—'}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </details>
      )}

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, order: 3 }}>
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
          <span>Parámetros de simulación</span>
          <span style={{ color: T.textMuted }}>{advancedOpen ? '▴' : '▾'}</span>
        </button>
        {advancedOpen && (
          <div ref={simulationPanelRef} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11, lineHeight: 1.45 }}>
              Estos cambios son temporales. No modifican el Modelo Base.
            </div>

            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobileViewport ? 'minmax(0,1fr)' : 'repeat(3, minmax(0,1fr))' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Escenario temporal</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { id: 'pessimistic' as const, label: 'Pesimista' },
                    { id: 'base' as const, label: 'Neutro' },
                    { id: 'optimistic' as const, label: 'Optimista' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onScenarioChange(item.id)}
                      style={{
                        background: activeScenarioForUi === item.id ? T.primary : T.surfaceEl,
                        border: `1px solid ${activeScenarioForUi === item.id ? T.primary : T.border}`,
                        color: activeScenarioForUi === item.id ? '#fff' : T.textSecondary,
                        borderRadius: 999,
                        padding: '5px 9px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Horizonte (años)</span>
                <input
                  type="number"
                  min={1}
                  value={effectiveYears}
                  onChange={(e) => updateTemporaryHorizonYears(Number(e.target.value))}
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    color: T.textPrimary,
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Retorno (%)</span>
                <input
                  type="number"
                  step={0.1}
                  value={(effectiveReturn * 100).toFixed(2)}
                  onChange={(e) => updateTemporaryReturnPct(Number(e.target.value))}
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    color: T.textPrimary,
                    fontSize: 12,
                  }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobileViewport ? 'repeat(2, minmax(0,1fr))' : 'repeat(4, minmax(0,1fr))' }}>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 5 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Depto</div>
                <button
                  type="button"
                  onClick={toggleLiquidarDepto}
                  disabled={!hasEffectiveRealEstate}
                  title={localReadOnlyDeptoUnavailable ? 'No disponible en modo local: falta configuración/snapshot cloud.' : undefined}
                  style={{
                    background: liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.16)' : T.surface,
                    border: `1px solid ${liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.55)' : T.border}`,
                    color: liquidarDeptoEnabled ? T.positive : T.textSecondary,
                    borderRadius: 999,
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: hasEffectiveRealEstate ? 'pointer' : 'not-allowed',
                    opacity: hasEffectiveRealEstate ? 1 : 0.65,
                  }}
                >
                  {liquidarDeptoEnabled ? 'ON' : hasEffectiveRealEstate ? 'OFF' : 'NO DISP'}
                </button>
                {localReadOnlyDeptoUnavailable ? (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>No disponible en modo local.</div>
                ) : null}
              </div>
              <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 5 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Capital de riesgo</div>
                <button
                  type="button"
                  onClick={onToggleRiskCapital}
                  disabled={localReadOnlyRiskUnavailable}
                  title={localReadOnlyRiskUnavailable ? 'Sin capital de riesgo disponible en modo local.' : undefined}
                  style={{
                    background: riskCapitalEnabled ? 'rgba(255, 176, 32, 0.18)' : T.surface,
                    border: `1px solid ${riskCapitalEnabled ? 'rgba(255, 176, 32, 0.55)' : T.border}`,
                    color: riskCapitalEnabled ? '#f6d38d' : T.textSecondary,
                    borderRadius: 999,
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: localReadOnlyRiskUnavailable ? 'not-allowed' : 'pointer',
                    opacity: localReadOnlyRiskUnavailable ? 0.65 : 1,
                  }}
                >
                  {riskCapitalEnabled ? 'ON' : 'OFF'}
                </button>
                {localReadOnlyRiskUnavailable ? (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>Sin capital de riesgo disponible en modo local.</div>
                ) : null}
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Monte Carlo</span>
                <select
                  value={currentNSim}
                  onChange={(e) => setNSim(Number(e.target.value))}
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    color: T.textPrimary,
                    fontSize: 12,
                  }}
                >
                  {[1000, 3000, 5000].map((value) => (
                    <option key={value} value={value}>{value.toLocaleString('es-CL')}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>Fee anual (%)</span>
                <input
                  type="number"
                  step={0.01}
                  value={(params.feeAnnual * 100).toFixed(2)}
                  onChange={(e) => onUpdateParams((prev) => ({ ...prev, feeAnnual: Number(e.target.value) / 100 }))}
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    color: T.textPrimary,
                    fontSize: 12,
                  }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobileViewport ? 'minmax(0,1fr)' : 'repeat(2, minmax(0,1fr))' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>RV total (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={currentRvTotalPct.toFixed(1)}
                  onChange={(e) => updateTemporaryRvTotalPct(Number(e.target.value))}
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    color: T.textPrimary,
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 11 }}>RF total (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={currentRfTotalPct.toFixed(1)}
                  onChange={(e) => updateTemporaryRvTotalPct(100 - Number(e.target.value))}
                  style={{
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    color: T.textPrimary,
                    fontSize: 12,
                  }}
                />
              </label>
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Distribución interna proporcional al mix aperturado actual.
            </div>

            <div>
              <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Gasto temporal por tramo</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {spendingPhases.map((phase, idx) => (
                  <label key={idx} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: T.textSecondary, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {spendingPhaseLabels[idx]?.title ?? `F${idx + 1}`}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={Object.prototype.hasOwnProperty.call(spendingDraftByIndex, idx)
                        ? (spendingDraftByIndex[idx] ?? '')
                        : formatCLP(phase.amountReal)}
                      onFocus={() => beginSpendingEdit(idx, phase.amountReal)}
                      onChange={(e) => updateSpendingDraft(idx, e.target.value)}
                      onBlur={() => commitSpendingDraft(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                      style={{
                        background: T.surfaceEl,
                        border: `1px solid ${T.border}`,
                        borderRadius: 8,
                        padding: '6px 8px',
                        color: T.textPrimary,
                        fontSize: 12,
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div style={{ border: `1px solid ${T.border}`, background: T.surfaceEl, borderRadius: 8, padding: '8px 10px', display: 'grid', gap: 5 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>
                Capital usado por motor: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{capitalSentToMotorClp !== null ? formatMoneyCompact(capitalSentToMotorClp) : 'No disponible'}</span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 11 }}>
                Fuente: <span style={{ color: T.textPrimary, fontWeight: 700 }}>Aurum</span>
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Para ajustes de capital o flujos, usa + Evento.
              </div>
              <button
                type="button"
                onClick={() => {
                  resetMovementForm();
                  openCapitalLedger();
                }}
                style={{
                  justifySelf: 'start',
                  background: T.primary,
                  border: 'none',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Agregar evento patrimonial"
                aria-label="Agregar evento patrimonial"
              >
                + Evento
              </button>
            </div>

            <details>
              <summary style={{ cursor: 'pointer', color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                Avanzado técnico
              </summary>
              <div style={{ marginTop: 6, display: 'grid', gap: 5, color: T.textMuted, fontSize: 10 }}>
                <div>Generador: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{activeGenerator}</span></div>
                <div>IPC Chile anual: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{(params.inflation.ipcChileAnnual * 100).toFixed(2)}%</span></div>
                <div>HICP Eurozona anual: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{(params.inflation.hipcEurAnnual * 100).toFixed(2)}%</span></div>
                <div>TCREAL LT: <span style={{ color: T.textPrimary, fontWeight: 700 }}>{Number(params.fx.tcrealLT ?? 0).toLocaleString('es-CL')}</span></div>
                <div>Nota: TCREAL LT es supuesto estructural; no reemplaza USD/CLP ni EUR/USD operativo.</div>
              </div>
            </details>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={onRunSimulation}
                style={{
                  background: T.primary,
                  border: 'none',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '6px 11px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Ejecutar simulación
              </button>
            </div>
          </div>
        )}
      </div>

      {!hideResultBlocks && displayResult && (
        <>
          <div style={{ order: 7, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>TRAYECTORIAS SIMULADAS (TODOS LOS ESCENARIOS)</div>
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
                Escenario activo: {scenarioUiLabel}
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <ResponsiveContainer width="100%" height={isMobileViewport ? 200 : 240}>
                <AreaChart data={fanChartData} margin={{ top: 8, right: 6, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                  <XAxis
                    dataKey="year"
                    type="number"
                    domain={[0, fanChartYears]}
                    ticks={isMobileViewport ? fanChartTicksMobile : fanChartTicks}
                    tick={{ fill: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}
                    tickFormatter={(v: number | string) => String(v)}
                    stroke={T.border}
                    tickMargin={8}
                    label={{ value: 'Años', position: 'insideBottom', offset: -2, fill: T.textMuted, fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: T.textMuted, fontSize: isMobileViewport ? 9 : 10 }}
                    tickFormatter={(v: number | string) => formatMillionsMM(Number(v))}
                    stroke={T.border}
                    width={isMobileViewport ? 40 : 46}
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
                  <Area
                    type="monotone"
                    dataKey="ruinBandTop"
                    stroke="none"
                    fill={T.negative}
                    fillOpacity={0.12}
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Line type="monotone" dataKey="p50" stroke={T.primary} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="p10" stroke={T.negative} strokeWidth={1} strokeDasharray="3 3" dot={false} />
                  <ReferenceLine
                    y={breakEvenWealth}
                    stroke={T.warning}
                    strokeWidth={2.2}
                    label={isMobileViewport ? undefined : {
                      value: 'Ganancia 0',
                      fill: T.warning,
                      fontSize: 11,
                      position: 'insideTopRight',
                    }}
                  />
                  <ReferenceLine y={0} stroke={T.negative} strokeOpacity={0.75} strokeDasharray="4 2" strokeWidth={1.1} />
                  {(isMobileViewport ? [10, 20, 30, 40] : [5, 10, 15, 20, 25, 30, 35, 40])
                    .filter((x) => x <= fanChartYears)
                    .map((x) => (
                      <ReferenceLine key={x} x={x} stroke={T.metalDeep} strokeDasharray="2 3" />
                    ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8, color: T.textSecondary, fontSize: 11 }}>
              <span>Franja roja: zona de ruina · Línea roja punteada: umbral de ruina (wealth = 0) · Línea ámbar: umbral ganancia 0</span>
              <span>Eje temporal anual</span>
            </div>
          </div>
          <div style={{ order: 7, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>
              PERCENTILES TERMINALES (SOBREVIVIENTES VS TODOS)
            </div>
            {isMobileViewport ? (
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                {percentileRows.map((p) => {
                  const clpSurvivors = p === 25
                    ? displayResult.terminalP25IfSuccess ?? displayResult.terminalWealthPercentiles[25]
                    : p === 50
                      ? displayResult.p50TerminalSurvivors ?? displayResult.terminalWealthPercentiles[50]
                      : displayResult.terminalP75IfSuccess ?? displayResult.terminalWealthPercentiles[75];
                  const clpAll = p === 25
                    ? displayResult.terminalP25AllPaths
                    : p === 50
                      ? displayResult.p50TerminalAllPaths
                      : displayResult.terminalP75AllPaths;
                  const eur = Number.isFinite(clpSurvivors) ? clpSurvivors / eurRate / 1e6 : Number.NaN;
                  const dd = displayResult.maxDrawdownPercentiles[p];
                  const highlight = p === 50;
                  return (
                    <div
                      key={p}
                      style={{
                        background: highlight ? 'rgba(91, 140, 255, 0.10)' : T.surface,
                        border: `1px solid ${T.border}`,
                        borderRadius: 10,
                        padding: isCompactViewport ? '9px 10px' : '10px 12px',
                        display: 'grid',
                        gap: 5,
                      }}
                    >
                      <div style={{ color: highlight ? T.primary : T.textMuted, fontWeight: 800, fontSize: 12 }}>P{p}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: T.textSecondary, fontSize: 11 }}>Sobrevivientes</span>
                          <span style={{ ...css.mono, color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                            {Number.isFinite(clpSurvivors) ? `$${formatMillionsMM((clpSurvivors ?? 0) / 1e6)}` : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: T.textSecondary, fontSize: 11 }}>Todos los escenarios</span>
                          <span style={{ ...css.mono, color: T.textPrimary, fontSize: 11 }}>
                            {Number.isFinite(clpAll) ? `$${formatMillionsMM((clpAll ?? 0) / 1e6)}` : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: T.textSecondary, fontSize: 11 }}>EUR (sobrev.)</span>
                          <span style={{ ...css.mono, color: T.textPrimary, fontSize: 11 }}>
                            {Number.isFinite(eur) ? `€${formatMillionsMM(eur)}` : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: T.textSecondary, fontSize: 11 }}>DD máx (todos)</span>
                          <span style={{ ...css.mono, color: T.textPrimary, fontSize: 11 }}>
                            {Number.isFinite(dd) ? `${(dd * 100).toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ marginTop: 8, overflow: 'hidden', border: `1px solid ${T.border}`, borderRadius: 10 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '56px repeat(4, minmax(0, 1fr))',
                    gap: 0,
                    background: T.surfaceEl,
                    color: T.textMuted,
                    fontSize: 11,
                    padding: '10px 12px',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <span>P</span>
                  <span>Patrimonio terminal (sobrevivientes)</span>
                  <span>Patrimonio terminal (todos)</span>
                  <span>EUR equiv (sobrevivientes)</span>
                  <span>DD máx (todos)</span>
                </div>
                {percentileRows.map((p, rowIdx) => {
                  const clpSurvivors = p === 25
                    ? displayResult.terminalP25IfSuccess ?? displayResult.terminalWealthPercentiles[25]
                    : p === 50
                      ? displayResult.p50TerminalSurvivors ?? displayResult.terminalWealthPercentiles[50]
                      : displayResult.terminalP75IfSuccess ?? displayResult.terminalWealthPercentiles[75];
                  const clpAll = p === 25
                    ? displayResult.terminalP25AllPaths
                    : p === 50
                      ? displayResult.p50TerminalAllPaths
                      : displayResult.terminalP75AllPaths;
                  const eur = Number.isFinite(clpSurvivors) ? clpSurvivors / eurRate / 1e6 : Number.NaN;
                  const dd = displayResult.maxDrawdownPercentiles[p];
                  const highlight = p === 50;
                  return (
                    <div
                      key={p}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '56px repeat(4, minmax(0, 1fr))',
                        gap: 0,
                        padding: '10px 12px',
                        background: highlight ? 'rgba(91, 140, 255, 0.10)' : T.surface,
                        borderBottom: rowIdx === percentileRows.length - 1 ? 'none' : `1px solid ${T.border}`,
                        color: highlight ? T.primary : T.textPrimary,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: highlight ? T.primary : T.textMuted }}>P{p}</span>
                      <span style={{ ...css.mono, fontWeight: 700 }}>{Number.isFinite(clpSurvivors) ? `$${formatMillionsMM((clpSurvivors ?? 0) / 1e6)}` : '—'}</span>
                      <span style={{ ...css.mono }}>{Number.isFinite(clpAll) ? `$${formatMillionsMM((clpAll ?? 0) / 1e6)}` : '—'}</span>
                      <span style={{ ...css.mono }}>{Number.isFinite(eur) ? `€${formatMillionsMM(eur)}` : '—'}</span>
                      <span style={{ ...css.mono }}>{Number.isFinite(dd) ? `${(dd * 100).toFixed(1)}%` : '—'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ order: 8, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em', marginBottom: 4 }}>TCREAL</div>
            <div style={{ color: T.warning, fontSize: 12 }}>
              PRELIMINARY: Este parámetro usa supuestos internos, revísalo antes de tomar decisiones.
            </div>
          </div>
        </>
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
              maxHeight: 'calc(100vh - 32px)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ color: T.textPrimary, fontWeight: 700 }}>Ajustes de capital</div>
                <div style={{ color: T.textMuted, fontSize: 12, marginTop: 4 }}>
                  Agrega entradas o salidas T0/futuras para esta corrida.
                </div>
              </div>
              <button
                type="button"
                onClick={closeCapitalLedger}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  borderRadius: 999,
                  width: 30,
                  height: 30,
                  display: 'grid',
                  placeItems: 'center',
                  color: T.textSecondary,
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
                aria-label="Cerrar ajustes de capital"
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 12, padding: 10, borderRadius: 12, border: `1px solid ${T.border}`, background: T.surfaceEl }}>
              <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
                Recursos hoy {patrimonioAmpliadoModeloClp !== null ? formatMoneyCompact(patrimonioAmpliadoModeloClp) : 'No disponible'} · T0 {`${draftManualSummaryT0.netClp >= 0 ? '+' : ''}${formatMoneyCompact(draftManualSummaryT0.netClp)}`} · Futuros {`${draftManualSummaryFuture.netClp >= 0 ? '+' : ''}${formatMoneyCompact(draftManualSummaryFuture.netClp)}`}
              </div>
              <div style={{ marginTop: 4, color: T.textMuted, fontSize: 11 }}>
                Próximo evento: {formatMonthYearLabel(draftManualSummaryFuture.firstFutureDate)}
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingRight: 2 }}>
              <div style={{ marginTop: 2, color: T.textMuted, fontSize: 11 }}>
                Neto acumulado: {formatCLP(Math.round(manualNetClp))} CLP
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflow: 'auto' }}>
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
                        <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>
                          Ajuste expresado en valor T0/plata de hoy. Se aplica en simulación en la fecha configurada.
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
                              setDraftManualAdjustments((prev) => {
                                const nextDraft = prev.filter((item) => item.id !== adj.id);
                                draftManualAdjustmentsRef.current = nextDraft;
                                return nextDraft;
                              });
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

              <div style={{ marginTop: 2, display: 'grid', gridTemplateColumns: isMobileViewport ? 'minmax(0,1fr)' : 'repeat(2, minmax(0,1fr))', gap: 10 }}>
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

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

              <details style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: '8px 10px', background: T.surfaceEl }}>
                <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
                  Ver detalle técnico / conciliación
                </summary>
                <div style={{ marginTop: 8, display: 'grid', gap: 4, color: T.textMuted, fontSize: 11 }}>
                  <div>Foto Aurum neta (sin ajustes manuales): {patrimonioReferenciaMidasClp !== null ? formatMoneyCompact(patrimonioReferenciaMidasClp) : 'No disponible'}</div>
                  <div>Recursos ampliados bajo modelo antes de ajustes manuales: {patrimonioConsideradoBaseMidasClp !== null ? formatMoneyCompact(patrimonioConsideradoBaseMidasClp) : 'No disponible'}</div>
                  <div>Impacto deuda no hipotecaria no exigible: {`${nonExigibleDebtPolicyImpactCLP >= 0 ? '+' : ''}${formatMoneyCompact(nonExigibleDebtPolicyImpactCLP)}`}</div>
                  <div>Impacto recursos habilitados (Depto/Riesgo): {`${enabledResourcesImpactCLP >= 0 ? '+' : ''}${formatMoneyCompact(enabledResourcesImpactCLP)}`}</div>
                  <div>Ajustes T0 netos: {`${draftManualSummaryT0.netClp >= 0 ? '+' : ''}${formatMoneyCompact(draftManualSummaryT0.netClp)}`}</div>
                  <div>Ajustes futuros netos: {`${draftManualSummaryFuture.netClp >= 0 ? '+' : ''}${formatMoneyCompact(draftManualSummaryFuture.netClp)}`}</div>
                  <div>Primer evento futuro: {draftManualSummaryFuture.firstFutureDate ?? 'Sin eventos futuros'}</div>
                  <div>Capital inicial líquido del motor (corrida efectiva): {patrimonioConsideradoEfectivoCorridaClp !== null ? formatMoneyCompact(patrimonioConsideradoEfectivoCorridaClp) : 'No disponible'}</div>
                  <div>Recursos ampliados bajo modelo (corrida efectiva): {patrimonioAmpliadoModeloClp !== null ? formatMoneyCompact(patrimonioAmpliadoModeloClp) : 'No disponible'}</div>
                  <div>Capital inicial del motor: {Number.isFinite(params.capitalInitial) ? formatMoneyCompact(params.capitalInitial) : 'No disponible'}</div>
                  <div>Respaldo/depto habilitado: {liquidarDeptoEnabled ? 'Sí' : 'No'} · Capital de riesgo habilitado: {riskCapitalEnabled ? 'Sí' : 'No'}</div>
                  <div>Los ajustes manuales están expresados en valor T0/plata de hoy. Para la simulación se aplican en el momento configurado, según la lógica del modelo.</div>
                  <div>Los ajustes futuros no cambian los recursos habilitados hoy, pero sí forman parte de la corrida.</div>
                  <div>El capital del motor y los recursos ampliados pueden diferir: casa y riesgo viajan por canales separados del input M8.</div>
                </div>
              </details>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: T.surface }}>
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
              <button
                type="button"
                onClick={handleSaveAndClose}
                disabled={savingMovement}
                style={{
                  background: T.primary,
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  padding: '8px 14px',
                  fontWeight: 700,
                  cursor: savingMovement ? 'not-allowed' : 'pointer',
                  opacity: savingMovement ? 0.7 : 1,
                }}
              >
                {savingMovement ? 'Guardando...' : 'Guardar y salir'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
  compact = false,
  fullMobile = false,
  traffic,
  subvalue,
}: {
  label: React.ReactNode;
  value: string;
  tone?: 'primary' | 'negative' | 'muted';
  compact?: boolean;
  fullMobile?: boolean;
  traffic?: TrafficLight;
  subvalue?: string;
}) {
  const color =
    tone === 'primary'
      ? T.primary
      : tone === 'negative'
        ? T.negative
        : T.textPrimary;
  return (
    <div
      style={{
        background: T.surfaceEl,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: compact ? '10px 10px' : 12,
        gridColumn: fullMobile ? '1 / -1' : undefined,
      }}
    >
      <div style={{ color: T.textMuted, fontSize: compact ? 10 : 11, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.3 }}>
        {traffic ? (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: TRAFFIC_COLORS[traffic],
              boxShadow: `0 0 0 2px rgba(0,0,0,0.12) inset`,
              flexShrink: 0,
            }}
          />
        ) : null}
        {label}
      </div>
      <div style={{ ...css.mono, fontSize: compact ? 14 : 16, fontWeight: 800, color, marginTop: compact ? 5 : 6, lineHeight: compact ? 1.2 : 1.25 }}>{value}</div>
      {subvalue ? (
        <div style={{ color: T.textMuted, fontSize: 10, marginTop: 4, lineHeight: 1.3 }}>
          {subvalue}
        </div>
      ) : null}
    </div>
  );
}

function MetricGroup({
  title,
  items,
  compact = false,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
  compact?: boolean;
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', background: T.surface }}>
      <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.03em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0,1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: `1px dashed ${T.border}`, paddingBottom: 5 }}>
            <span style={{ color: T.textSecondary, fontSize: 11 }}>{item.label}</span>
            <span style={{ ...css.mono, color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LabelWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <>
      <span>{label}</span>
      <InfoHint text={info} />
    </>
  );
}
