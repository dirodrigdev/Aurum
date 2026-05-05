import React, { useEffect, useMemo, useState } from 'react';
import type { ModelParameters } from '../domain/model/types';
import { loadInstrumentUniverseSnapshot } from '../domain/instrumentUniverse';
import { buildOperationalBucketProfile } from '../domain/bucketLab/operationalBucketProfile';
import { runOperationalBucketStress } from '../domain/bucketLab/operationalBucketStress';
import { runBucketTradeoffAnalysis } from '../domain/bucketLab/bucketTradeoff';
import { buildBucketExpectedCostAnalysis } from '../domain/bucketLab/bucketExpectedCostAnalysis';
import { buildBucketDecisionSummary } from '../domain/bucketLab/bucketDecisionSummary';
import { describeExpectedValue, buildBucketTradeoffCards } from '../domain/bucketLab/bucketPresentation';
import { buildBucketSensitivitySummary } from '../domain/bucketLab/bucketSensitivitySummary';
import { T } from './theme';

const baseCandidateBuckets = [24, 36, 48, 60, 72, 96, 120];
const assumptionPresets = [
  { id: 'base', label: 'Base', forcedSalePenaltyPct: 0.3, prob36: 0.12, prob48: 0.08, prob60: 0.05, prob72: 0.03, prob96: 0.02 },
  { id: 'conservador', label: 'Conservador', forcedSalePenaltyPct: 0.4, prob36: 0.16, prob48: 0.12, prob60: 0.08, prob72: 0.05, prob96: 0.03 },
  { id: 'estres', label: 'Stress alto', forcedSalePenaltyPct: 0.5, prob36: 0.24, prob48: 0.16, prob60: 0.10, prob72: 0.06, prob96: 0.04 },
];

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString('es-CL')}`;
const formatCompactMoney = (value: number) =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1).replace('.', ',')}MM` : formatMoney(value);
const formatPct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`;
const formatSignedMoney = (value: number) =>
  `${value >= 0 ? '+' : '-'}${formatCompactMoney(Math.abs(value))}`;
const formatBenefitCostMoney = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) < 1) return '$0';
  return `${value > 0 ? '+' : '-'}${formatCompactMoney(Math.abs(value))}`;
};
const formatMonths = (value: number) => `${value.toFixed(1).replace('.', ',')} meses`;
const layerLabel = (layer: string) => {
  const map: Record<string, string> = {
    hard_cash: 'Cash duro',
    near_cash: 'Near-cash',
    pure_fixed_income: 'RF pura',
    conservative_balanced: 'Balanceado conservador',
    moderate_balanced: 'Balanceado moderado',
    aggressive_balanced: 'Balanceado agresivo',
    equity_like: 'RV',
    restricted: 'Restringido',
    unknown: 'Desconocido',
  };
  return map[layer] || layer;
};

const estimateDefaultSpendClp = (params: ModelParameters): number => {
  const firstPhase = params.spendingPhases?.[0];
  if (!firstPhase || !Number.isFinite(firstPhase.amountReal) || firstPhase.amountReal <= 0) return 6_000_000;
  if (firstPhase.currency === 'CLP') return firstPhase.amountReal;
  const eurToUsd = Number(params.fx?.usdEurFixed ?? 1);
  const usdToClp = Number(params.fx?.clpUsdInitial ?? 900);
  return Math.max(1, firstPhase.amountReal * eurToUsd * usdToClp);
};

const estimateExpectedGrowth = (params: ModelParameters): number => {
  const returns = params.returns;
  const weights = params.weights;
  return (
    weights.rvGlobal * returns.rvGlobalAnnual +
    weights.rvChile * returns.rvChileAnnual +
    weights.rfGlobal * returns.rfGlobalAnnual +
    weights.rfChile * returns.rfChileUFAnnual
  );
};

export function BucketLabPage({ params }: { params: ModelParameters }) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 760 : false,
  );
  const [monthlySpendClp, setMonthlySpendClp] = useState<number>(() => estimateDefaultSpendClp(params));
  const [bucketCurrentMonths, setBucketCurrentMonths] = useState<number>(params.bucketMonths ?? 48);
  const [expectedGrowthReturnAnnual, setExpectedGrowthReturnAnnual] = useState<number>(() =>
    estimateExpectedGrowth(params),
  );
  const [expectedDefensiveReturnAnnual, setExpectedDefensiveReturnAnnual] = useState<number>(
    () => Number(params.returns.rfChileUFAnnual || 0.02),
  );
  const [includeCaptive, setIncludeCaptive] = useState(false);
  const [includeRiskCapital, setIncludeRiskCapital] = useState(false);
  const [stressSensitivity, setStressSensitivity] = useState<'moderada' | 'severa' | 'extrema'>('severa');
  const [forcedSalePenaltyPct, setForcedSalePenaltyPct] = useState(0.3);
  const [prob36, setProb36] = useState(0.12);
  const [prob48, setProb48] = useState(0.08);
  const [prob60, setProb60] = useState(0.05);
  const [prob72, setProb72] = useState(0.03);
  const [prob96, setProb96] = useState(0.02);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const applyAssumptionPreset = (preset: (typeof assumptionPresets)[number]) => {
    setForcedSalePenaltyPct(preset.forcedSalePenaltyPct);
    setProb36(preset.prob36);
    setProb48(preset.prob48);
    setProb60(preset.prob60);
    setProb72(preset.prob72);
    setProb96(preset.prob96);
  };
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth < 760);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const universeSnapshot = useMemo(() => loadInstrumentUniverseSnapshot(), []);
  const optimizableInvestmentsClp = useMemo(() => {
    const value = Number(params.simulationComposition?.optimizableInvestmentsCLP ?? NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [params.simulationComposition?.optimizableInvestmentsCLP]);

  const candidateBuckets = useMemo(
    () => Array.from(new Set([...baseCandidateBuckets, Math.round(bucketCurrentMonths)])).filter((value) => value > 0).sort((a, b) => a - b),
    [bucketCurrentMonths],
  );

  const profile = useMemo(
    () =>
      buildOperationalBucketProfile({
        snapshot: universeSnapshot,
        monthlySpendClp,
        includeCaptive,
        includeRiskCapital,
        optimizableInvestmentsClp,
      }),
    [universeSnapshot, monthlySpendClp, includeCaptive, includeRiskCapital, optimizableInvestmentsClp],
  );

  const stressScenarios = useMemo(() => {
    if (stressSensitivity === 'moderada') {
      return [
        { crisisMonths: 36, equityDrawdown: -0.2, fixedIncomeShock: 0 },
        { crisisMonths: 48, equityDrawdown: -0.2, fixedIncomeShock: -0.05 },
        { crisisMonths: 60, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
        { crisisMonths: 72, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
        { crisisMonths: 96, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
      ];
    }
    if (stressSensitivity === 'extrema') {
      return [
        { crisisMonths: 36, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
        { crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.1 },
        { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
        { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
        { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      ];
    }
    return [
      { crisisMonths: 36, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
      { crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.1 },
      { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
    ];
  }, [stressSensitivity]);

  const stressRows = useMemo(
    () =>
      runOperationalBucketStress({
        profile,
        scenarios: stressScenarios,
      }),
    [profile, stressScenarios],
  );

  const tradeoffRows = useMemo(
    () =>
      runBucketTradeoffAnalysis({
        profile,
        candidateMonths: candidateBuckets,
        currentBucketMonths: bucketCurrentMonths,
        expectedGrowthReturnAnnual,
        expectedDefensiveReturnAnnual,
        stressScenarios,
      }),
    [
      profile,
      bucketCurrentMonths,
      expectedGrowthReturnAnnual,
      expectedDefensiveReturnAnnual,
      stressScenarios,
    ],
  );

  const expectedCostAnalysis = useMemo(
    () =>
      buildBucketExpectedCostAnalysis({
        profile,
        tradeoffRows,
        currentBucketMonths: bucketCurrentMonths,
        forcedSalePenaltyPct,
        crisisScenarioProbabilities: [
          { crisisMonths: 36, probability: prob36 },
          { crisisMonths: 48, probability: prob48 },
          { crisisMonths: 60, probability: prob60 },
          { crisisMonths: 72, probability: prob72 },
          { crisisMonths: 96, probability: prob96 },
        ],
      }),
    [profile, tradeoffRows, bucketCurrentMonths, forcedSalePenaltyPct, prob36, prob48, prob60, prob72, prob96],
  );

  const decision = useMemo(
    () =>
      buildBucketDecisionSummary({
        profile,
        stressRows,
        tradeoffRows,
        targetBucketMonths: bucketCurrentMonths,
        expectedCostAnalysis,
      }),
    [profile, stressRows, tradeoffRows, bucketCurrentMonths, expectedCostAnalysis],
  );
  const sensitivity = useMemo(
    () =>
      buildBucketSensitivitySummary({
        profile,
        tradeoffRows,
        currentBucketMonths: bucketCurrentMonths,
        forcedSalePenaltyPct,
        crisisScenarioProbabilities: [
          { crisisMonths: 36, probability: prob36 },
          { crisisMonths: 48, probability: prob48 },
          { crisisMonths: 60, probability: prob60 },
          { crisisMonths: 72, probability: prob72 },
          { crisisMonths: 96, probability: prob96 },
        ],
      }),
    [profile, tradeoffRows, bucketCurrentMonths, forcedSalePenaltyPct, prob36, prob48, prob60, prob72, prob96],
  );
  const bestValuePresentation = useMemo(
    () => describeExpectedValue(decision.differenceVsCurrentClp),
    [decision.differenceVsCurrentClp],
  );
  const tradeoffCards = useMemo(
    () => buildBucketTradeoffCards(expectedCostAnalysis.rows, expectedCostAnalysis.currentBucketMonths),
    [expectedCostAnalysis.rows, expectedCostAnalysis.currentBucketMonths],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          background: T.surface,
          border: `1px solid ${
            decision.recommendation === 'review_data'
              ? T.negative
              : decision.recommendation === 'consider_increase' || decision.recommendation === 'increase'
                ? T.warning
                : T.border
          }`,
          borderRadius: 18,
          padding: 14,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ color: T.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Lectura ejecutiva
            </div>
            <div style={{ color: T.textPrimary, fontSize: 24, fontWeight: 800 }}>{decision.headline}</div>
            <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.45, maxWidth: 760 }}>
              {decision.oneLineSummary}
            </div>
          </div>
          <div style={{ display: 'inline-flex', width: 'fit-content', border: `1px solid ${T.warning}`, borderRadius: 999, padding: '3px 8px', color: T.warning, fontSize: 11, fontWeight: 700 }}>
            Read-only
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <MetricCard title={`Actual ${expectedCostAnalysis.currentBucketMonths}m`} value={formatCompactMoney(decision.currentBucketExpectedTotalCostClp)} subtitle="Costo esperado anual ($/año)" badge="Actual" />
          <MetricCard
            title={`Mejor alternativa: ${decision.bestBucketMonths}m de bucket limpio`}
            value={bestValuePresentation.label}
            subtitle={`Costo esperado ${decision.bestBucketMonths}m: ${formatSignedMoney(decision.bestBucketExpectedTotalCostClp)}/año`}
            tone={bestValuePresentation.tone}
            badge="Recomendado"
          />
          <MetricCard
            title={
              decision.breakEvenProbability !== null
                ? `Break-even subir`
                : 'Supuesto clave'
            }
            value={
              decision.breakEvenProbability !== null
                ? formatPct(decision.breakEvenProbability)
                : formatPct(forcedSalePenaltyPct)
            }
            subtitle={
              decision.breakEvenProbability !== null
                ? 'Prob. mínima de crisis larga'
                : 'Penalización venta en baja'
            }
          />
        </div>

        <div style={{ display: 'grid', gap: 5 }}>
          {decision.decisionRationale.map((item) => (
            <div key={item} style={{ color: T.textSecondary, fontSize: 12 }}>
              • {item}
            </div>
          ))}
        </div>

        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Subir bucket tiene costo en todos los escenarios. Vender balanceados tiene costo solo si la crisis supera la defensa limpia.
        </div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          El bucket objetivo incluye solo cash, near-cash y RF pura vendible. Los balanceados son defensa mixta: se usan después y al venderlos también se vende RV embebida.
        </div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Estas probabilidades son supuestos para valorar escenarios, no predicciones.
        </div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          El scroll muestra el detalle del stress, los supuestos y el costo esperado comparado.
        </div>
      </div>

      <div
        style={{
          background: T.surface,
          border: `1px solid ${sensitivity.robustness === 'robust' ? T.border : T.warning}`,
          borderRadius: 12,
          padding: 10,
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: T.textPrimary, fontWeight: 700 }}>Robustez</div>
          <div style={{ color: sensitivity.robustness === 'robust' ? T.positive : T.warning, fontSize: 12, fontWeight: 700 }}>
            {sensitivity.message}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          {sensitivity.scenarios.map((scenario) => (
            <div key={scenario.id} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>{scenario.label}</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800, marginTop: 4 }}>{scenario.recommendedBucketMonths}m limpio</div>
              <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 3 }}>
                {formatSignedMoney(scenario.expectedTotalCostClp)}/año
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Bucket Lab</div>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Compara el costo de tener más defensa desde el inicio versus el riesgo de vender balanceados en una crisis larga.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <InputNumber label="Gasto mensual CLP" value={monthlySpendClp} onChange={setMonthlySpendClp} />
        <InputNumber label="Bucket actual meses" value={bucketCurrentMonths} onChange={setBucketCurrentMonths} />
        <InputNumber
          label="Retorno crecimiento anual"
          value={expectedGrowthReturnAnnual}
          onChange={setExpectedGrowthReturnAnnual}
          step={0.001}
        />
        <InputNumber
          label="Retorno defensivo anual"
          value={expectedDefensiveReturnAnnual}
          onChange={setExpectedDefensiveReturnAnnual}
          step={0.001}
        />
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Toggle label="Incluir previsional cautivo" checked={includeCaptive} onChange={setIncludeCaptive} />
        <Toggle label="Incluir capital de riesgo" checked={includeRiskCapital} onChange={setIncludeRiskCapital} />
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
          <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Sensibilidad crisis</div>
          <select
            value={stressSensitivity}
            onChange={(event) => setStressSensitivity(event.target.value as 'moderada' | 'severa' | 'extrema')}
            style={{
              width: '100%',
              background: T.surfaceEl,
              color: T.textPrimary,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            <option value="moderada">Moderada</option>
            <option value="severa">Severa</option>
            <option value="extrema">Extrema</option>
          </select>
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
        <button
          type="button"
          onClick={() => setShowAssumptions((prev) => !prev)}
          style={{
            background: 'transparent',
            border: 'none',
            color: T.textPrimary,
            fontWeight: 700,
            textAlign: 'left',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          Supuestos de valorización {showAssumptions ? '▾' : '▸'}
        </button>
        {showAssumptions ? (
          <>
            <div style={{ color: T.textSecondary, fontSize: 12 }}>
              El bucket grande se paga siempre vía menor crecimiento esperado. El bucket chico se paga solo si una crisis supera la defensa limpia y obliga a vender balanceados con RV embebida.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {assumptionPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyAssumptionPreset(preset)}
                  style={{
                    background: T.surfaceEl,
                    color: T.textPrimary,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '7px 10px',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <InputNumber label="Prob. crisis 36m" value={prob36} onChange={setProb36} step={0.01} />
              <InputNumber label="Prob. crisis 48m" value={prob48} onChange={setProb48} step={0.01} />
              <InputNumber label="Prob. crisis 60m" value={prob60} onChange={setProb60} step={0.01} />
              <InputNumber label="Prob. crisis 72m" value={prob72} onChange={setProb72} step={0.01} />
              <InputNumber label="Prob. crisis 96m" value={prob96} onChange={setProb96} step={0.01} />
              <InputNumber label="Penalización vender RV en baja" value={forcedSalePenaltyPct} onChange={setForcedSalePenaltyPct} step={0.01} />
            </div>
            <div style={{ color: T.textMuted, fontSize: 12 }}>
              Se usan bins exclusivos por duración para evitar doble conteo.
            </div>
          </>
        ) : null}
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <MetricCard title="Bucket hard cash" value={formatCompactMoney(profile.hardCashClp)} subtitle={formatMonths(profile.hardCashRunwayMonths)} />
        <MetricCard title="Bucket limpio" value={formatCompactMoney(profile.cleanDefensiveClp)} subtitle={formatMonths(profile.cleanDefensiveRunwayMonths)} />
        <MetricCard title="Defensa mixta" value={formatCompactMoney(profile.mixedFundClp)} subtitle={`+${formatMonths(profile.mixedFundRunwayMonths)} (vende balanceados)`} />
        <MetricCard title="RV embebida si uso balanceados" value={formatCompactMoney(profile.embeddedEquityClp)} subtitle={formatPct(profile.embeddedEquitySoldPct)} />
        <MetricCard
          title="Cobertura de datos"
          value={formatPct(profile.coveragePctByClp)}
          subtitle={
            profile.source === 'instrument_universe'
              ? profile.amountSource === 'weight_scaled_optimizable'
                ? 'Universe + optimizable vigente'
                : profile.amountSource === 'mixed'
                  ? 'Universe mixto (directo + escalado)'
                  : 'Instrument Universe (amountClp)'
              : 'Sin fuente'
          }
        />
      </div>

      <TableCard title="Capas defensivas">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: T.textMuted, textAlign: 'left' }}>
              <th style={thStyle}>Capa</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Monto CLP</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>% port.</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Meses</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>RV embebida</th>
              <th style={thStyle}>Comentario</th>
            </tr>
          </thead>
          <tbody>
            {profile.layerSummaries.map((row) => (
              <tr key={row.layer} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={tdStyle}>{layerLabel(row.layer)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.amountClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPct(row.pctPortfolio)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMonths(row.runwayMonths)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.embeddedEquityClp)}</td>
                <td style={tdStyle}>{row.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Stress operativo simple">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: T.textMuted, textAlign: 'left' }}>
              <th style={thStyle}>Crisis</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>DD RV</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Shock RF</th>
              <th style={thStyle}>Defensa limpia</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Balanceados vendidos</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>RV embebida vendida</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>ForcedSalePenalty</th>
              <th style={thStyle}>Severidad</th>
            </tr>
          </thead>
          <tbody>
            {stressRows.map((row) => (
              <tr key={`${row.crisisMonths}-${row.equityDrawdown}-${row.fixedIncomeShock}`} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={tdStyle}>{row.crisisMonths}m</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPct(row.equityDrawdown)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPct(row.fixedIncomeShock)}</td>
                <td style={tdStyle}>{row.cleanDefensiveEnough ? 'Sí' : `No (agota en ${row.cleanDefensiveExhaustedMonth}m)`}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.balancedSoldClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.embeddedEquitySoldClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.forcedSalePenalty)}</td>
                <td style={tdStyle}>{row.stressSeverity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Tradeoff de bucket">
        {isMobile ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {tradeoffCards.map((card) => (
              <div
                key={card.bucketMonths}
                style={{
                  background: T.surfaceEl,
                  border: `1px solid ${card.isCurrent ? T.primaryStrong : T.border}`,
                  borderRadius: 12,
                  padding: 10,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ color: T.textPrimary, fontWeight: 800 }}>{card.bucketMonths}m limpio</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {card.isRecommended ? <Badge label="Recomendado" tone="benefit" /> : null}
                    {card.isCurrent ? <Badge label="Actual" tone="primary" /> : null}
                  </div>
                </div>
                <TradeoffStat label="Bucket limpio requerido (capital único)" value={formatCompactMoney(card.cleanBucketRequiredClp)} />
                <TradeoffStat label={`${card.capitalLabel} (capital único)`} value={formatCompactMoney(card.capitalValueClp)} tone={card.capitalTone} />
                <TradeoffStat label={card.permanentLabel} value={`${formatBenefitCostMoney(card.permanentValueClp)}/año`} tone={card.permanentTone} />
                <TradeoffStat label={card.crisisCostLabel} value={`${formatBenefitCostMoney(card.crisisCostValueClp)}/año`} tone={card.crisisCostTone} />
                <TradeoffStat label={card.netResultLabel} value={`${formatBenefitCostMoney(card.netResultValueClp)}/año`} tone={card.netResultTone} />
                <TradeoffStat label={card.comparisonLabel} value={`${formatBenefitCostMoney(card.comparisonValueClp)}/año`} tone={card.comparisonTone} />
                <div style={{ color: T.textSecondary, fontSize: 12 }}>{card.comment}</div>
              </div>
            ))}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: T.textMuted, textAlign: 'left' }}>
                <th style={thStyle}>Bucket</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Bucket limpio requerido (capital único)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Capital único</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Permanente ($/año)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Costo esperado crisis</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Resultado neto</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Vs actual</th>
                <th style={thStyle}>Lectura</th>
              </tr>
            </thead>
            <tbody>
              {tradeoffCards.map((card) => (
                <tr key={card.bucketMonths} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span>{card.bucketMonths}m limpio</span>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {card.isRecommended ? <Badge label="Recomendado" tone="benefit" /> : null}
                        {card.isCurrent ? <Badge label="Actual" tone="primary" /> : null}
                      </div>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(card.cleanBucketRequiredClp)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: toneColor(card.capitalTone) }}>
                    {card.capitalLabel}: {formatCompactMoney(card.capitalValueClp)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: toneColor(card.permanentTone) }}>
                    {card.permanentLabel}: {formatBenefitCostMoney(card.permanentValueClp)}/año
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: toneColor(card.crisisCostTone) }}>
                    {formatBenefitCostMoney(card.crisisCostValueClp)}/año
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: toneColor(card.netResultTone) }}>
                    {formatBenefitCostMoney(card.netResultValueClp)}/año
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: toneColor(card.comparisonTone) }}>
                    {card.comparisonLabel}: {formatBenefitCostMoney(card.comparisonValueClp)}/año
                  </td>
                  <td style={tdStyle}>{card.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {profile.warnings.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.warning}`, borderRadius: 12, padding: 12 }}>
          <div style={{ color: T.warning, fontWeight: 700, marginBottom: 6 }}>Warnings</div>
          {profile.warnings.slice(0, 10).map((warning) => (
            <div key={warning} style={{ color: T.textSecondary, fontSize: 12 }}>
              • {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InputNumber({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
}) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
      <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>{label}</div>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        style={{
          width: '100%',
          background: T.surfaceEl,
          border: `1px solid ${T.border}`,
          color: T.textPrimary,
          borderRadius: 8,
          padding: '8px 10px',
        }}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: T.textSecondary, fontSize: 12 }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  tone = 'neutral',
  badge,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone?: 'neutral' | 'benefit' | 'cost';
  badge?: string;
}) {
  const valueColor = tone === 'benefit' ? T.positive : tone === 'cost' ? T.warning : T.textPrimary;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>{title}</div>
        {badge ? <Badge label={badge} tone={badge === 'Recomendado' ? 'benefit' : 'primary'} /> : null}
      </div>
      <div style={{ color: valueColor, fontWeight: 800, fontSize: 16, marginTop: 2 }}>{value}</div>
      <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 2 }}>{subtitle}</div>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'benefit' | 'primary' }) {
  const color = tone === 'benefit' ? T.positive : T.primary;
  return (
    <span
      style={{
        border: `1px solid ${color}`,
        color,
        borderRadius: 999,
        padding: '2px 6px',
        fontSize: 10,
        fontWeight: 800,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function toneColor(tone: 'benefit' | 'cost' | 'neutral') {
  return tone === 'benefit' ? T.positive : tone === 'cost' ? T.warning : T.textPrimary;
}

function TradeoffStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'benefit' | 'cost' | 'neutral';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ color: toneColor(tone), fontSize: 12, fontWeight: 700, textAlign: 'right' }}>{value}</div>
    </div>
  );
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, overflowX: 'auto' }}>
      <div style={{ color: T.textPrimary, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '6px 4px',
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 4px',
  color: T.textSecondary,
  verticalAlign: 'top',
};
