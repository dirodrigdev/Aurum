import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import type { M8Input, M8RiskCapitalPolicy } from './m8.types';
import { resolveCapital } from './capitalResolver';
import { toM8Input } from './m8Adapter';
import { runM8 } from './engineM8';

type ScenarioResult = {
  id: 'E_ACTUAL' | 'E_CYCLE_AWARE_MIN';
  policy: M8RiskCapitalPolicy;
  output: {
    success40: number;
    ruin20: number;
    houseSalePct: number;
    firstCutYearP50: number;
    maxDdP50: number;
    terminalP50: number;
    anyLargeSalePct: number;
    sale1Median: number;
    sale2Median: number;
  };
  input: Pick<M8Input, 'capital_initial_clp' | 'risk_capital_clp' | 'risk_capital_policy' | 'risk_capital_btc_driver'>;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fmtPct = (value: number): string => `${(value * 100).toFixed(2)}%`;
const fmtNum = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : 'NaN');

const resolveRiskFromComposition = (params: ModelParameters): number => {
  const risk = params.simulationComposition?.nonOptimizable?.riskCapital;
  if (!risk || typeof risk !== 'object') return 0;
  const record = risk as Record<string, unknown>;
  const hasTotal = Object.prototype.hasOwnProperty.call(record, 'totalCLP');
  const totalCLP = Number(record.totalCLP ?? 0);
  if (hasTotal && Number.isFinite(totalCLP) && totalCLP >= 0) return totalCLP;
  const clp = Number(record.clp ?? 0);
  const usdTotal = Number(record.usdTotal ?? record.usd ?? 0);
  const usdSnapshotCLP = Number(record.usdSnapshotCLP ?? 0);
  const safeClp = Number.isFinite(clp) && clp > 0 ? clp : 0;
  const safeUsdTotal = Number.isFinite(usdTotal) && usdTotal > 0 ? usdTotal : 0;
  const safeUsdSnapshot = Number.isFinite(usdSnapshotCLP) && usdSnapshotCLP > 0 ? usdSnapshotCLP : 0;
  return Math.max(0, safeClp + safeUsdTotal * safeUsdSnapshot);
};

const buildBaseScenario = (): ModelParameters => {
  const params = clone(DEFAULT_PARAMETERS);
  params.capitalSource = 'aurum';
  params.simulationBaseMonth = '2026-03';
  params.generatorType = 'student_t';
  params.activeScenario = 'base';
  params.simulation = {
    ...params.simulation,
    nSim: 500,
    seed: 42,
    horizonMonths: 480,
    useHistoricalData: false,
  };
  params.spendingPhases = [
    { durationMonths: 48, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 192, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 180, amountReal: 3_900_000, currency: 'CLP' },
    { durationMonths: 60, amountReal: 5_400_000, currency: 'CLP' },
  ];
  params.realEstatePolicy = {
    enabled: true,
    triggerRunwayMonths: 36,
    saleDelayMonths: 12,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 2_080_000_000,
    optimizableInvestmentsCLP: 1_401_000_000,
    nonOptimizable: {
      banksCLP: 0,
      nonMortgageDebtCLP: 0,
      realEstate: {
        propertyValueCLP: 600_000_000,
        mortgageDebtOutstandingCLP: 120_000_000,
        monthlyMortgagePaymentCLP: 1_500_000,
        ufSnapshotCLP: 40_000,
        snapshotMonth: '2026-03',
      },
      riskCapital: {
        totalCLP: 90_000_000,
        usdTotal: 100_000,
        usdSnapshotCLP: 900,
        source: 'summary_riskCapitalClp',
      },
    },
    mortgageProjectionStatus: 'uf_schedule',
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };
  return params;
};

const evaluate = (base: ModelParameters, id: ScenarioResult['id'], policy: M8RiskCapitalPolicy): ScenarioResult => {
  const params = clone(base);
  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);
  input.risk_capital_policy = policy;
  input.risk_capital_btc_driver = 'btc_like_v1';
  const output = runM8(input);
  return {
    id,
    policy,
    output: {
      success40: output.Success40,
      ruin20: output.ProbRuin20,
      houseSalePct: output.HouseSalePct,
      firstCutYearP50: output.FirstCutYearMedian ?? Number.NaN,
      maxDdP50: Number(output.maxDrawdownPercentiles?.[50] ?? Number.NaN),
      terminalP50: output.TerminalMedianCLP,
      anyLargeSalePct: output.RiskEAnyLargeSalePct ?? Number.NaN,
      sale1Median: output.RiskELargeSell1YearMedian ?? Number.NaN,
      sale2Median: output.RiskELargeSell2YearMedian ?? Number.NaN,
    },
    input: {
      capital_initial_clp: input.capital_initial_clp,
      risk_capital_clp: input.risk_capital_clp ?? 0,
      risk_capital_policy: input.risk_capital_policy,
      risk_capital_btc_driver: input.risk_capital_btc_driver,
    },
  };
};

const main = (): void => {
  const base = buildBaseScenario();
  const riskFromSource = resolveRiskFromComposition(base);
  if (riskFromSource <= 0) {
    throw new Error('simulationComposition.nonOptimizable.riskCapital no trae valor positivo');
  }

  const current = evaluate(base, 'E_ACTUAL', 'btc_like_realista_e');
  const cycleMin = evaluate(base, 'E_CYCLE_AWARE_MIN', 'btc_like_realista_e_cycle_min');

  console.log('\nE_ACTUAL vs E_CYCLE_AWARE_MIN (base, nSim=500)');
  console.log('Scenario | Success40 | Ruin20 | HouseSalePct | FirstCutYearP50 | MaxDDP50 | TerminalP50 | AnyLargeSalePct | Sale1YearMedian | Sale2YearMedian');
  console.log('---|---:|---:|---:|---:|---:|---:|---:|---:|---:');
  for (const row of [current, cycleMin]) {
    console.log(
      `${row.id} | ${fmtPct(row.output.success40)} | ${fmtPct(row.output.ruin20)} | ${fmtPct(row.output.houseSalePct)} | ${fmtNum(row.output.firstCutYearP50)} | ${fmtNum(row.output.maxDdP50)} | ${Math.round(row.output.terminalP50)} | ${fmtPct(row.output.anyLargeSalePct)} | ${fmtNum(row.output.sale1Median)} | ${fmtNum(row.output.sale2Median)}`,
    );
  }

  const delta = cycleMin.output.success40 - current.output.success40;
  const verdict = delta > 0.001 ? 'Cycle-aware mejora' : delta < -0.001 ? 'Cycle-aware empeora' : 'Cycle-aware empata';
  console.log(`\nVeredicto: ${verdict} (Delta Success40=${(delta * 100).toFixed(2)} pp)`);
  console.log(
    `Lectura ventas: AnyLargeSale ${fmtPct(current.output.anyLargeSalePct)} -> ${fmtPct(cycleMin.output.anyLargeSalePct)}, Venta1 mediana ${fmtNum(current.output.sale1Median)} -> ${fmtNum(cycleMin.output.sale1Median)}, Venta2 mediana ${fmtNum(current.output.sale2Median)} -> ${fmtNum(cycleMin.output.sale2Median)}`,
  );
  console.log(
    `Input contract: capital_initial_clp=${Math.round(current.input.capital_initial_clp)} risk_capital_clp=${Math.round(current.input.risk_capital_clp ?? 0)} (igual en ambos)`,
  );
};

main();
