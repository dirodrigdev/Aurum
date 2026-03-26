import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelParameters, SimulationResults, ScenarioVariantId } from '../domain/model/types';
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

const ruinToSuccessPct = (probRuin: number) => (1 - probRuin) * 100;

export function SimulationPage({
  resultCentral,
  resultFavorable,
  resultPrudent,
  params,
  simOverrides,
  simActive,
  simWorking,
  simUiState,
  simUiError,
  simulationPreset,
  stateLabel,
  aurumIntegrationStatus,
  aurumSnapshotLabel,
  baseUpdatePending,
  onSimulationTouch,
  onScenarioChange,
  onSimOverridesChange,
  onUpdateParams,
  onResetSim,
}: {
  resultCentral: SimulationResults | null;
  resultFavorable: SimulationResults | null;
  resultPrudent: SimulationResults | null;
  params: ModelParameters;
  simOverrides: SimulationOverrides | null;
  simActive: boolean;
  simWorking: boolean;
  simUiState: 'idle' | 'recalculating' | 'ready' | 'error';
  simUiError: string | null;
  simulationPreset: SimulationPreset;
  stateLabel: string;
  aurumIntegrationStatus: 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
  aurumSnapshotLabel: string | null;
  baseUpdatePending: boolean;
  onSimulationTouch: (next?: SimulationPreset) => void;
  onScenarioChange: (next: ScenarioVariantId) => void;
  onSimOverridesChange: (next: SimulationOverrides | null) => void;
  onUpdateParams: (patcher: (prev: ModelParameters) => ModelParameters) => void;
  onResetSim: () => void;
}) {
  const [showSimToast, setShowSimToast] = useState(false);
  const [activeChip, setActiveChip] = useState<'return' | 'years' | 'capital' | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const prevSimActive = useRef(false);
  const aurumStatusVisual = useMemo(() => {
    if (aurumIntegrationStatus === 'available') {
      return {
        copy: `Base Aurum · ${aurumSnapshotLabel ?? 'último cierre confirmado'}`,
        bg: 'rgba(61, 212, 141, 0.12)',
        border: 'rgba(61, 212, 141, 0.45)',
        color: T.positive,
      };
    }
    if (aurumIntegrationStatus === 'partial') {
      return {
        copy: `Base Aurum parcial · ${aurumSnapshotLabel ?? 'último cierre confirmado'}`,
        bg: 'rgba(255, 176, 32, 0.12)',
        border: 'rgba(255, 176, 32, 0.45)',
        color: T.warning,
      };
    }
    if (aurumIntegrationStatus === 'refreshing') {
      return {
        copy: `Actualizando base Aurum...`,
        bg: 'rgba(91, 140, 255, 0.14)',
        border: 'rgba(91, 140, 255, 0.45)',
        color: T.primary,
      };
    }
    if (aurumIntegrationStatus === 'loading') {
      return {
        copy: 'Sincronizando base Aurum...',
        bg: 'rgba(91, 140, 255, 0.14)',
        border: 'rgba(91, 140, 255, 0.45)',
        color: T.primary,
      };
    }
    if (aurumIntegrationStatus === 'missing') {
      return {
        copy: 'Base Aurum no disponible',
        bg: 'rgba(255, 176, 32, 0.12)',
        border: 'rgba(255, 176, 32, 0.45)',
        color: T.warning,
      };
    }
    if (aurumIntegrationStatus === 'unconfigured') {
      return {
        copy: 'Base Aurum no configurada',
        bg: 'rgba(148, 163, 184, 0.14)',
        border: 'rgba(148, 163, 184, 0.42)',
        color: T.textMuted,
      };
    }
    return {
      copy: 'Base Aurum con error',
      bg: 'rgba(255, 92, 92, 0.12)',
      border: 'rgba(255, 92, 92, 0.45)',
      color: T.negative,
    };
  }, [aurumIntegrationStatus, aurumSnapshotLabel]);

  const baseReturn = useMemo(() => computeWeightedReturn(params), [params]);
  const baseYears = Math.round(params.simulation.horizonMonths / 12);
  const baseCapital = params.capitalInitial;
  const liquidarDeptoEnabled = params.realEstatePolicy?.enabled ?? true;
  const aurumSyncing = aurumIntegrationStatus === 'loading' || aurumIntegrationStatus === 'refreshing';
  const hideResultBlocks = baseUpdatePending || aurumSyncing || simUiState === 'error';
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
  const simStatusVisual = useMemo(() => {
    if (baseUpdatePending || aurumSyncing) {
      return {
        bg: 'rgba(91, 140, 255, 0.14)',
        border: 'rgba(91, 140, 255, 0.45)',
        color: T.primary,
        copy: 'Recalculando con base Aurum actualizada...',
      };
    }
    if (simUiState === 'recalculating') {
      return {
        bg: 'rgba(91, 140, 255, 0.14)',
        border: 'rgba(91, 140, 255, 0.45)',
        color: T.primary,
        copy: 'Actualizando simulación...',
      };
    }
    if (simUiState === 'error') {
      return {
        bg: 'rgba(255, 92, 92, 0.12)',
        border: 'rgba(255, 92, 92, 0.45)',
        color: T.negative,
        copy: simUiError || 'No pude recalcular la simulación.',
      };
    }
    if (simUiState === 'ready') {
      return {
        bg: 'rgba(61, 212, 141, 0.12)',
        border: 'rgba(61, 212, 141, 0.4)',
        color: T.positive,
        copy: 'Simulación lista',
      };
    }
    return {
      bg: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.35)',
      color: T.textMuted,
      copy: simActive ? 'Esperando recálculo' : 'Estado base en espera',
    };
  }, [aurumSyncing, baseUpdatePending, simActive, simUiError, simUiState]);
  const effectiveReturn = simOverrides?.returnPct ?? baseReturn;
  const effectiveYears = simOverrides?.horizonYears ?? baseYears;
  const effectiveCapital = simOverrides?.capital ?? baseCapital;

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
  const probSuccess = displayResult ? 1 - displayResult.probRuin : null;
  const ruinMedian = displayResult?.ruinTimingMedian ?? null;
  const plausibleLow = resultPrudent ? ruinToSuccessPct(resultPrudent.probRuin) : null;
  const plausibleHigh = resultFavorable ? ruinToSuccessPct(resultFavorable.probRuin) : null;
  const spendRatio = displayResult?.spendingRatioMedian ?? null;
  const p50 = displayResult?.terminalWealthPercentiles[50] ?? null;
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
    plausibleLow,
    plausibleHigh,
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
      returnPct: simOverrides?.returnPct ?? baseReturn,
      horizonYears: simOverrides?.horizonYears ?? baseYears,
      capital: simOverrides?.capital ?? baseCapital,
      preset: 'custom',
    };
    if (activeChip === 'return') next.returnPct = parsed / 100;
    if (activeChip === 'years') next.horizonYears = Math.max(1, Math.round(parsed));
    if (activeChip === 'capital') next.capital = Math.max(1, parsed);
    onSimOverridesChange(next);
    setActiveChip(null);
  };

  const formatCLP = (value: number) =>
    value.toLocaleString('es-CL', { maximumFractionDigits: 0 });
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
          background: aurumStatusVisual.bg,
          border: `1px solid ${aurumStatusVisual.border}`,
          borderRadius: 12,
          padding: '10px 12px',
          color: aurumStatusVisual.color,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {aurumStatusVisual.copy}
      </div>
      <div
        style={{
          background: compositionStatusVisual.bg,
          border: `1px solid ${compositionStatusVisual.border}`,
          borderRadius: 12,
          padding: '9px 12px',
          color: compositionStatusVisual.color,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700 }}>{compositionStatusVisual.copy}</span>
        <span style={{ fontSize: 11, opacity: 0.92 }}>{compositionStatusVisual.detail}</span>
      </div>
      {baseUpdatePending && (
        <div
          style={{
            background: 'rgba(255, 176, 32, 0.12)',
            border: '1px solid rgba(255, 176, 32, 0.45)',
            borderRadius: 12,
            padding: '9px 12px',
            color: T.warning,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Base Aurum actualizada. Resultado pendiente de recalcular.
        </div>
      )}
      {motorWarnings.length > 0 && (
        <div
          style={{
            background: 'rgba(255, 176, 32, 0.10)',
            border: '1px solid rgba(255, 176, 32, 0.35)',
            borderRadius: 12,
            padding: '9px 12px',
            color: T.warning,
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span style={{ fontWeight: 700 }}>Motor · warnings</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {motorWarnings.slice(0, 4).map((warning) => (
              <span
                key={warning}
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(255, 176, 32, 0.16)',
                  border: '1px solid rgba(255, 176, 32, 0.45)',
                  fontSize: 10,
                }}
              >
                {warning}
              </span>
            ))}
          </div>
          {lastRebalanceMonth ? (
            <span style={{ opacity: 0.85 }}>
              Último rebalanceo anual: mes {lastRebalanceMonth}
            </span>
          ) : null}
        </div>
      )}
      <div
        style={{
          background: simStatusVisual.bg,
          border: `1px solid ${simStatusVisual.border}`,
          borderRadius: 12,
          padding: '9px 12px',
          color: simStatusVisual.color,
          fontSize: 12,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: simStatusVisual.color,
            opacity: simUiState === 'recalculating' ? 0.7 : 1,
            animation: simUiState === 'recalculating' ? 'midasPulse 1s ease-in-out infinite' : 'none',
          }}
        />
        <span>{simStatusVisual.copy}</span>
      </div>
      <div
        style={{
          background: 'rgba(91, 140, 255, 0.12)',
          border: `1px solid rgba(91, 140, 255, 0.45)`,
          borderRadius: 12,
          padding: '10px 12px',
          color: T.textPrimary,
          fontSize: 12,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span>Supuesto activo: {liquidarDeptoEnabled ? 'Liquidar depto ON' : 'Liquidar depto OFF'}</span>
        <button
          type="button"
          onClick={toggleLiquidarDepto}
          style={{
            background: liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.2)' : 'rgba(255, 176, 32, 0.2)',
            border: `1px solid ${liquidarDeptoEnabled ? 'rgba(61, 212, 141, 0.55)' : 'rgba(255, 176, 32, 0.55)'}`,
            borderRadius: 999,
            color: liquidarDeptoEnabled ? T.positive : T.warning,
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 10px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {liquidarDeptoEnabled ? 'Desactivar' : 'Activar'}
        </button>
      </div>
      {(aurumIntegrationStatus === 'missing' || aurumIntegrationStatus === 'unconfigured') && (
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Mostrando un capital local por defecto. Cuando Aurum publique el cierre, se reemplazará automáticamente.
        </div>
      )}
      {baseUpdatePending && (
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Resultado principal oculto hasta recalcular con la base Aurum nueva.
        </div>
      )}
      {!hideResultBlocks ? (
      <div style={{ position: 'relative' }}>
        <style>{`
          @keyframes midasPulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.25); opacity: 1; }
          }
        `}</style>
        <HeroCard
          label="¿LLEGARÁS AL AÑO 40?"
          valuePct={probSuccess}
          subtitle={
            displayResult
              ? `${Math.round(displayResult.nRuin)} de ${displayResult.nTotal} simulaciones en ruina`
              : 'Corre una simulación para ver resultados'
          }
          ruinCopy={ruinMedian ? `Timing mediano Año ${(ruinMedian / 12).toFixed(1)}` : 'Timing mediano: —'}
          mode={simActive ? 'sim' : 'real'}
          chips={[
            { id: 'state', value: stateLabel, onClick: simActive ? onResetSim : () => {} },
            { id: 'return', value: `${(effectiveReturn * 100).toFixed(1)}%`, onClick: () => openChip('return') },
            { id: 'years', value: `${formatNumber(effectiveYears)} años`, onClick: () => openChip('years') },
            { id: 'capital', value: formatCapital(effectiveCapital), onClick: () => openChip('capital') },
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
      ) : (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
        <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          SIMULACION
        </div>
        <div style={{ color: T.textPrimary, marginTop: 8, fontWeight: 700 }}>
          Resultado en recálculo
        </div>
        <div style={{ color: T.textSecondary, marginTop: 6, fontSize: 13 }}>
          Esperando resultado coherente con la base Aurum actual.
        </div>
      </div>
      )}

      {!hideResultBlocks && displayResult && probSuccess !== null && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PROBABILIDAD DE ÉXITO</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{`${Math.round(successAxisMin)}%`}</span>
            <div style={{ position: 'relative', flex: 1, height: 8, background: T.border, borderRadius: 999 }}>
              {plausibleLow !== null && plausibleHigh !== null && (() => {
                const left = mapSuccessPct(plausibleLow);
                const right = mapSuccessPct(plausibleHigh);
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${Math.min(left, right)}%`,
                      width: `${Math.max(0, Math.abs(right - left))}%`,
                      top: 0,
                      bottom: 0,
                      background: 'rgba(91, 140, 255, 0.22)',
                      borderRadius: 999,
                    }}
                  />
                );
              })()}
              {SCENARIO_VARIANTS.map((variant) => {
                const active = simulationPreset !== 'custom' && variant.id === simulationPreset;
                const successPct =
                  variant.id === 'pessimistic'
                    ? plausibleLow ?? 0
                    : variant.id === 'optimistic'
                      ? plausibleHigh ?? 0
                      : probSuccess !== null
                        ? probSuccess * 100
                        : 0;
                const left = mapSuccessPct(successPct);
                const zoneColor = successPct >= 90 ? T.positive : successPct >= 80 ? T.warning : T.negative;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => onScenarioChange(variant.id)}
                    title={`${variant.label}: ${successPct.toFixed(1)}%`}
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: active ? 14 : 12,
                      height: active ? 14 : 12,
                      borderRadius: '50%',
                      border: `2px solid ${zoneColor}`,
                      background: active ? zoneColor : T.surface,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                );
              })}
            </div>
            <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{`${Math.round(successAxisMax)}%`}</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 10 }}>
            Rango plausible:{' '}
            {plausibleLow !== null && plausibleHigh !== null
              ? `${Math.min(plausibleLow, plausibleHigh).toFixed(0)}% — ${Math.max(plausibleLow, plausibleHigh).toFixed(0)}%`
              : '—'}{' '}
            <span style={{ color: T.textMuted }}>Favorable ↔ Prudente</span>
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
          <span>Otros ajustes de simulación</span>
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
              <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Política inmobiliaria</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: '9px 10px',
                }}
              >
                <div>
                  <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>Liquidar depto</div>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>
                    {liquidarDeptoEnabled
                      ? 'Activado: el motor puede vender el inmueble según runway'
                      : 'Desactivado: el inmueble no se liquida en la simulación'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleLiquidarDepto}
                  style={{
                    background: liquidarDeptoEnabled ? T.positive : T.surface,
                    border: `1px solid ${liquidarDeptoEnabled ? T.positive : T.border}`,
                    color: liquidarDeptoEnabled ? '#00150a' : T.textSecondary,
                    borderRadius: 999,
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {liquidarDeptoEnabled ? 'ON' : 'OFF'}
                </button>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
        <InfoCard
          label="Gasto modelado / planificado"
          value={spendRatio !== null ? `${(spendRatio * 100).toFixed(1)}%` : '—'}
        />
        <InfoCard
          label="Patrimonio P50"
          value={p50 !== null ? `$${formatMillionsMM(p50 / 1e6)}` : '—'}
        />
      </div>
      )}

      {!hideResultBlocks && displayResult && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>FAN CHART</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', flex: 1 }}>
                {[SCENARIO_VARIANTS[1], SCENARIO_VARIANTS[0], SCENARIO_VARIANTS[2]].map((variant) => {
                  const isBase = variant.id === 'base';
                  const active = simulationPreset === variant.id;
                  const custom = simulationPreset === 'custom';
                  const highlightedReset = isBase && custom;
                  const working = active && simWorking;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => onScenarioChange(variant.id)}
                      style={{
                        background: active
                          ? T.primary
                          : highlightedReset
                            ? 'rgba(91, 140, 255, 0.12)'
                            : T.surfaceEl,
                        border: highlightedReset
                          ? `2px solid rgba(91, 140, 255, 0.72)`
                          : `1px solid ${active ? T.primary : T.border}`,
                        color: active || highlightedReset ? T.textPrimary : T.textSecondary,
                        fontSize: 11,
                        padding: '5px 10px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        opacity: custom && !isBase ? 0.45 : 1,
                        boxShadow: highlightedReset
                          ? 'inset 0 0 0 1px rgba(91, 140, 255, 0.25)'
                          : working
                            ? '0 0 0 2px rgba(91, 140, 255, 0.28)'
                            : 'none',
                        transition: 'opacity 0.2s, transform 0.2s',
                        transform: working ? 'scale(0.99)' : 'scale(1)',
                      }}
                    >
                      {variant.label}
                    </button>
                  );
                })}
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
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PERCENTILES</div>
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
