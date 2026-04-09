import React, { useCallback, useMemo, useState } from 'react';
import type { ModelParameters, PortfolioWeights, SimulationResults } from '../domain/model/types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import { T } from './theme';

type SourceMode = 'base' | 'simulation';
type GoalId = '2pp' | '5pp';
type Difficulty = 'Bajo' | 'Medio' | 'Alto';

type LeverId =
  | 'mix_rv_rf'
  | 'bucket_months'
  | 'spend_phase_1'
  | 'spend_phase_2'
  | 'spend_phase_3'
  | 'cuts_policy'
  | 'house_trigger_policy';

type LeverResult = {
  id: LeverId;
  variable: string;
  currentValue: string;
  requiredValue: string;
  changeNeeded: string;
  impactPp: number;
  difficulty: Difficulty;
  comment: string;
  reachesGoal: boolean;
  utilityScore: number;
};

type SimSnapshot = {
  success40: number;
  ruin20: number;
  houseSalePct: number;
  cutScenarioPct: number;
  cutSeverityMean: number;
  firstCutYearP50: number | null;
};

const LEVER_LABELS: Record<LeverId, string> = {
  mix_rv_rf: 'Mix RF/RV',
  bucket_months: 'Bucket',
  spend_phase_1: 'Gasto fase 1',
  spend_phase_2: 'Gasto fase 2',
  spend_phase_3: 'Gasto fase 3',
  cuts_policy: 'Política de cuts',
  house_trigger_policy: 'Política/trigger venta casa',
};

function cloneParams(params: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(params)) as ModelParameters;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

function formatPp(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')} pp`;
}

function formatAmount(value: number): string {
  return value.toLocaleString('es-CL', { maximumFractionDigits: 0 });
}

function formatMonths(value: number): string {
  return `${Math.round(value)} meses`;
}

function safeNumber(value: number | undefined | null, fallback = 0): number {
  return Number.isFinite(value ?? Number.NaN) ? Number(value) : fallback;
}

function summarizeRiskMix(params: ModelParameters): string {
  const rv = params.weights.rvGlobal + params.weights.rvChile;
  const rf = params.weights.rfGlobal + params.weights.rfChile;
  return `${Math.round(rv * 100)}/${Math.round(rf * 100)}`;
}

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

function hasRiskCapitalEnabled(params: ModelParameters): boolean {
  const risk = Number(params.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
  return Number.isFinite(risk) && risk > 0;
}

function buildDeltaSummary(baseParams: ModelParameters, candidateParams: ModelParameters): string {
  const deltas: string[] = [];
  const baseMix = summarizeRiskMix(baseParams);
  const candidateMix = summarizeRiskMix(candidateParams);
  if (baseMix !== candidateMix) deltas.push(`mix ${candidateMix}`);
  if (!approxEqual(baseParams.feeAnnual, candidateParams.feeAnnual)) {
    deltas.push(`fee ${formatPct(candidateParams.feeAnnual)}`);
  }
  if (baseParams.simulation.nSim !== candidateParams.simulation.nSim) {
    deltas.push(`nSim ${candidateParams.simulation.nSim}`);
  }
  const baseHouseEnabled = Boolean(baseParams.realEstatePolicy?.enabled);
  const candidateHouseEnabled = Boolean(candidateParams.realEstatePolicy?.enabled);
  if (baseHouseEnabled !== candidateHouseEnabled) {
    deltas.push(`venta de casa ${candidateHouseEnabled ? 'ON' : 'OFF'}`);
  }
  const baseRiskCapital = hasRiskCapitalEnabled(baseParams);
  const candidateRiskCapital = hasRiskCapitalEnabled(candidateParams);
  if (baseRiskCapital !== candidateRiskCapital) {
    deltas.push(`capital de riesgo ${candidateRiskCapital ? 'ON' : 'OFF'}`);
  }
  return deltas.length ? `Cambios vs base: ${deltas.join(' · ')}` : 'Sin cambios temporales respecto de la base vigente';
}

function toSnapshot(result: SimulationResults): SimSnapshot {
  return {
    success40: safeNumber(result.success40, 1 - safeNumber(result.probRuin40, result.probRuin)),
    ruin20: safeNumber(result.probRuin20, 0),
    houseSalePct: safeNumber(result.houseSalePct, 0),
    cutScenarioPct: safeNumber(result.cutScenarioPct, 0),
    cutSeverityMean: safeNumber(result.cutSeverityMean, 0),
    firstCutYearP50: Number.isFinite(result.firstCutYearMedian ?? Number.NaN)
      ? Number(result.firstCutYearMedian)
      : null,
  };
}

function buildCandidateWeights(currentWeights: PortfolioWeights, rvPct: number): PortfolioWeights {
  const globalShare = Math.max(0, Math.min(1, (currentWeights.rvGlobal + currentWeights.rfGlobal) || 0.5));
  const localShare = Math.max(0, Math.min(1, 1 - globalShare));
  const rv = rvPct / 100;
  const rf = 1 - rv;
  return {
    rvGlobal: rv * globalShare,
    rvChile: rv * localShare,
    rfGlobal: rf * globalShare,
    rfChile: rf * localShare,
  };
}

function difficultyWeight(level: Difficulty): number {
  if (level === 'Bajo') return 1;
  if (level === 'Medio') return 2;
  return 3;
}

function evaluateLeverCandidates(
  baselineParams: ModelParameters,
  baseline: SimSnapshot,
  goalSuccess: number,
  id: LeverId,
): { best: LeverResult | null } {
  const evaluate = (candidateParams: ModelParameters): SimSnapshot => toSnapshot(runSimulationCentral(candidateParams));

  const current = cloneParams(baselineParams);
  const candidates: Array<{
    valueLabel: string;
    changeLabel: string;
    params: ModelParameters;
    difficulty: Difficulty;
    comment: string;
  }> = [];

  if (id === 'mix_rv_rf') {
    const currentRv = Math.round((current.weights.rvGlobal + current.weights.rvChile) * 100);
    for (let rv = 20; rv <= 90; rv += 5) {
      if (rv === currentRv) continue;
      const next = cloneParams(current);
      next.weights = buildCandidateWeights(current.weights, rv);
      const rf = 100 - rv;
      candidates.push({
        valueLabel: `RV ${rv}% / RF ${rf}%`,
        changeLabel: `${rv - currentRv >= 0 ? '+' : ''}${rv - currentRv} pp en RV`,
        params: next,
        difficulty: 'Medio',
        comment: 'Ajusta riesgo estructural de la cartera sin tocar gastos.',
      });
    }
  } else if (id === 'bucket_months') {
    const currentBucket = Math.max(6, safeNumber(current.bucketMonths, 24));
    const options = [
      Math.max(6, currentBucket - 12),
      Math.max(6, currentBucket - 6),
      currentBucket + 6,
      currentBucket + 12,
    ].filter((v, i, arr) => arr.indexOf(v) === i && v !== currentBucket && v <= 60);
    for (const option of options) {
      const next = cloneParams(current);
      next.bucketMonths = option;
      candidates.push({
        valueLabel: formatMonths(option),
        changeLabel: `${option - currentBucket >= 0 ? '+' : ''}${option - currentBucket} meses`,
        params: next,
        difficulty: 'Bajo',
        comment: option > currentBucket
          ? 'Más liquidez táctica para amortiguar caídas.'
          : 'Menos liquidez táctica para priorizar rendimiento esperado.',
      });
    }
  } else if (id === 'spend_phase_1' || id === 'spend_phase_2' || id === 'spend_phase_3') {
    const phaseIndex = id === 'spend_phase_1' ? 0 : id === 'spend_phase_2' ? 1 : 2;
    const currentPhase = current.spendingPhases[phaseIndex];
    if (currentPhase) {
      const currentAmount = safeNumber(currentPhase.amountReal, 0);
      const factors = [0.98, 0.95, 0.92, 0.9, 0.85];
      for (const factor of factors) {
        const nextAmount = Math.max(0, currentAmount * factor);
        if (Math.abs(nextAmount - currentAmount) < 1e-6) continue;
        const next = cloneParams(current);
        next.spendingPhases[phaseIndex] = {
          ...next.spendingPhases[phaseIndex],
          amountReal: nextAmount,
        };
        candidates.push({
          valueLabel: formatAmount(nextAmount),
          changeLabel: `${(((nextAmount / currentAmount) - 1) * 100).toFixed(1).replace('.', ',')}%`,
          params: next,
          difficulty: factor >= 0.95 ? 'Medio' : 'Alto',
          comment: 'Recorte directo del gasto del tramo para mejorar supervivencia.',
        });
      }
    }
  } else if (id === 'cuts_policy') {
    const sr = current.spendingRule;
    const levels = [
      { softDelta: -0.02, hardDelta: -0.03, dd15: -0.01, dd25: -0.02, label: 'Ajuste leve' },
      { softDelta: -0.05, hardDelta: -0.08, dd15: -0.02, dd25: -0.04, label: 'Ajuste medio' },
      { softDelta: -0.08, hardDelta: -0.12, dd15: -0.03, dd25: -0.06, label: 'Ajuste intenso' },
    ];
    for (const level of levels) {
      const next = cloneParams(current);
      next.spendingRule = {
        ...next.spendingRule,
        softCut: Math.max(0.70, Math.min(1, sr.softCut + level.softDelta)),
        hardCut: Math.max(0.55, Math.min(1, sr.hardCut + level.hardDelta)),
        dd15Threshold: Math.max(0.05, sr.dd15Threshold + level.dd15),
        dd25Threshold: Math.max(0.10, sr.dd25Threshold + level.dd25),
      };
      candidates.push({
        valueLabel: `${Math.round(next.spendingRule.softCut * 100)}/${Math.round(next.spendingRule.hardCut * 100)}`,
        changeLabel: level.label,
        params: next,
        difficulty: level.label === 'Ajuste leve' ? 'Medio' : 'Alto',
        comment: 'Recortes más exigentes: sube resiliencia, pero eleva sacrificio de consumo.',
      });
    }
  } else if (id === 'house_trigger_policy') {
    const currentPolicy = current.realEstatePolicy ?? {
      enabled: false,
      triggerRunwayMonths: 36,
      saleDelayMonths: 12,
      saleCostPct: 0,
      realAppreciationAnnual: 0,
    };
    const triggerOptions = currentPolicy.enabled ? [
      Math.max(6, currentPolicy.triggerRunwayMonths - 18),
      Math.max(6, currentPolicy.triggerRunwayMonths - 12),
      Math.max(6, currentPolicy.triggerRunwayMonths - 6),
    ] : [48, 36, 24, 18];
    const uniqueOptions = triggerOptions.filter((v, i, arr) => arr.indexOf(v) === i);
    for (const trigger of uniqueOptions) {
      const next = cloneParams(current);
      next.realEstatePolicy = {
        ...currentPolicy,
        enabled: true,
        triggerRunwayMonths: trigger,
      };
      candidates.push({
        valueLabel: `ON · trigger ${formatMonths(trigger)}`,
        changeLabel: currentPolicy.enabled
          ? `Trigger ${currentPolicy.triggerRunwayMonths}→${trigger} meses`
          : 'Activar venta de casa',
        params: next,
        difficulty: 'Medio',
        comment: 'Aporta liquidez de rescate, con costo patrimonial y operativo.',
      });
    }
  }

  let best: LeverResult | null = null;
  for (const candidate of candidates) {
    const sim = evaluate(candidate.params);
    const impactPp = (sim.success40 - baseline.success40) * 100;
    const reachesGoal = sim.success40 >= goalSuccess;
    const utilityScore = impactPp / difficultyWeight(candidate.difficulty);
    const result: LeverResult = {
      id,
      variable:
        id === 'mix_rv_rf' ? 'Mix RF/RV' :
        id === 'bucket_months' ? 'Bucket' :
        id === 'spend_phase_1' ? 'Gasto fase 1' :
        id === 'spend_phase_2' ? 'Gasto fase 2' :
        id === 'spend_phase_3' ? 'Gasto fase 3' :
        id === 'cuts_policy' ? 'Política de cuts' :
        'Política/trigger venta casa',
      currentValue:
        id === 'mix_rv_rf' ? summarizeRiskMix(current) :
        id === 'bucket_months' ? formatMonths(safeNumber(current.bucketMonths, 24)) :
        id === 'spend_phase_1' ? formatAmount(safeNumber(current.spendingPhases[0]?.amountReal, 0)) :
        id === 'spend_phase_2' ? formatAmount(safeNumber(current.spendingPhases[1]?.amountReal, 0)) :
        id === 'spend_phase_3' ? formatAmount(safeNumber(current.spendingPhases[2]?.amountReal, 0)) :
        id === 'cuts_policy' ? `${Math.round(current.spendingRule.softCut * 100)}/${Math.round(current.spendingRule.hardCut * 100)}` :
        current.realEstatePolicy?.enabled
          ? `ON · trigger ${formatMonths(current.realEstatePolicy.triggerRunwayMonths)}`
          : 'OFF',
      requiredValue: candidate.valueLabel,
      changeNeeded: candidate.changeLabel,
      impactPp,
      difficulty: candidate.difficulty,
      comment: candidate.comment,
      reachesGoal,
      utilityScore,
    };
    if (!best) {
      best = result;
      continue;
    }
    const bestPenalty = best.reachesGoal ? 0 : 100;
    const nextPenalty = result.reachesGoal ? 0 : 100;
    const bestScore = bestPenalty + (-best.utilityScore);
    const nextScore = nextPenalty + (-result.utilityScore);
    if (nextScore < bestScore) best = result;
  }

  return { best };
}

export function PalancasPage({
  baseParams,
  simulationParams,
  simulationActive,
  simulationLabel,
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
}) {
  const [sourceMode, setSourceMode] = useState<SourceMode>(simulationActive ? 'simulation' : 'base');
  const [goal, setGoal] = useState<GoalId>('2pp');
  const [running, setRunning] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<SimSnapshot | null>(null);
  const [rows, setRows] = useState<LeverResult[]>([]);

  const activeParams = sourceMode === 'simulation' && simulationActive ? simulationParams : baseParams;
  const activeLabel = sourceMode === 'simulation' && simulationActive ? (simulationLabel ?? 'Simulación activa') : 'Base vigente';
  const sourceDescription = sourceMode === 'simulation' && simulationActive
    ? 'Simulación activa: usa los cambios temporales que estás probando'
    : 'Base vigente: usa la configuración persistida del caso';
  const sourceDeltaSummary = sourceMode === 'simulation' && simulationActive
    ? buildDeltaSummary(baseParams, simulationParams)
    : 'Sin cambios temporales respecto de la base vigente';

  const targetDeltaPp = goal === '2pp' ? 2 : 5;

  const runLevers = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setProgressLabel('Preparando baseline...');
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const baseResult = toSnapshot(runSimulationCentral(activeParams));
      setBaseline(baseResult);
      const targetSuccess = baseResult.success40 + (targetDeltaPp / 100);

      const leverIds: LeverId[] = [
        'mix_rv_rf',
        'bucket_months',
        'spend_phase_1',
        'spend_phase_2',
        'spend_phase_3',
        'cuts_policy',
        'house_trigger_policy',
      ];

      const nextRows: LeverResult[] = [];
      for (const [index, id] of leverIds.entries()) {
        setProgressLabel(`Analizando ${index + 1} de ${leverIds.length}: ${LEVER_LABELS[id]}`);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        const out = evaluateLeverCandidates(activeParams, baseResult, targetSuccess, id);
        if (out.best) nextRows.push(out.best);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }

      nextRows.sort((a, b) => {
        const goalA = a.reachesGoal ? 0 : 1;
        const goalB = b.reachesGoal ? 0 : 1;
        if (goalA !== goalB) return goalA - goalB;
        return b.utilityScore - a.utilityScore;
      });
      setRows(nextRows);
    } finally {
      setRunning(false);
      setProgressLabel(null);
    }
  }, [activeParams, running, targetDeltaPp]);

  const summary = useMemo(() => {
    if (!baseline || !rows.length) return null;
    const reaches = rows.filter((row) => row.reachesGoal).length;
    return {
      baseSuccess: baseline.success40,
      targetSuccess: baseline.success40 + (targetDeltaPp / 100),
      reaches,
      total: rows.length,
    };
  }, [baseline, rows, targetDeltaPp]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Palancas</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Explora qué cambios podrían mejorar el resultado del plan completo.
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>Fuente del escenario</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: T.textMuted, fontSize: 11 }}>Referencia activa</div>
          <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>{activeLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSourceMode('base')}
            style={{
              background: sourceMode === 'base' ? T.primary : T.surfaceEl,
              border: `1px solid ${sourceMode === 'base' ? T.primary : T.border}`,
              color: sourceMode === 'base' ? '#fff' : T.textSecondary,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Base vigente
          </button>
          <button
            type="button"
            onClick={() => simulationActive && setSourceMode('simulation')}
            disabled={!simulationActive}
            style={{
              background: sourceMode === 'simulation' ? T.primary : T.surfaceEl,
              border: `1px solid ${sourceMode === 'simulation' ? T.primary : T.border}`,
              color: sourceMode === 'simulation' ? '#fff' : T.textSecondary,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: simulationActive ? 'pointer' : 'not-allowed',
              opacity: simulationActive ? 1 : 0.65,
            }}
          >
            Simulación activa
          </button>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ color: T.textSecondary, fontSize: 11 }}>{sourceDescription}</div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>{sourceDeltaSummary}</div>
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>Meta de mejora</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            { id: '2pp', label: '+2 pp' },
            { id: '5pp', label: '+5 pp' },
          ] as const).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setGoal(item.id)}
              style={{
                background: goal === item.id ? T.primary : T.surfaceEl,
                border: `1px solid ${goal === item.id ? T.primary : T.border}`,
                color: goal === item.id ? '#fff' : T.textSecondary,
                borderRadius: 999,
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div>
          <button
            type="button"
            onClick={runLevers}
            disabled={running}
            style={{
              background: running ? T.surfaceEl : T.primary,
              border: `1px solid ${running ? T.border : T.primary}`,
              color: running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Evaluando...' : 'Evaluar palancas'}
          </button>
        </div>
        {running && progressLabel ? (
          <div style={{ color: T.textSecondary, fontSize: 11 }}>
            {progressLabel}
          </div>
        ) : null}
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Estimación orientativa por sensibilidad local (una variable a la vez) sobre el modelo completo. No reemplaza la simulación integral.
        </div>
      </div>

      {summary && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 4 }}>
          <div style={{ color: T.textSecondary, fontSize: 11 }}>
            Éxito actual: {formatPct(summary.baseSuccess)} · Meta: {formatPct(summary.targetSuccess)}
          </div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            {summary.reaches}/{summary.total} palancas alcanzan la meta por sí solas. Si no alcanza, combinar palancas puede ser necesario.
          </div>
        </div>
      )}

      {running && rows.length === 0 ? (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
          <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>
            Evaluando palancas del modelo completo
          </div>
          <div style={{ color: T.textSecondary, fontSize: 11 }}>
            {progressLabel ?? 'Preparando análisis...'}
          </div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            Mantenemos la página visible mientras corre el cálculo.
          </div>
        </div>
      ) : null}

      {rows.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {running ? (
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Actualizando resultados sin borrar la evaluación anterior.
            </div>
          ) : null}
          {rows.map((row) => (
            <div key={row.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 4 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>{row.variable}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Valor actual: <strong>{row.currentValue}</strong> · Valor requerido: <strong>{row.requiredValue}</strong>
              </div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Cambio necesario: <strong>{row.changeNeeded}</strong> · Impacto estimado: <strong>{formatPp(row.impactPp)}</strong>
              </div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Costo/dificultad: <strong>{row.difficulty}</strong> · {row.reachesGoal ? 'Alcanza la meta por sí sola' : 'No alcanza la meta por sí sola'}
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>{row.comment}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
