import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import type { M8Input, M8RiskCapitalPolicy } from './m8.types';
import { resolveCapital } from './capitalResolver';
import { toM8Input } from './m8Adapter';
import { runM8 } from './engineM8';

type ScenarioId = 'B_ACTUAL' | 'E_REALISTA';

type ScenarioResult = {
  id: ScenarioId;
  nSim: number;
  policy: M8RiskCapitalPolicy;
  input: Pick<M8Input, 'capital_initial_clp' | 'risk_capital_clp' | 'risk_capital_policy'>;
  output: {
    success40: number;
    ruin20: number;
    houseSalePct: number;
    firstCutYearP50: number;
    maxDdP50: number;
    terminalP50: number;
  };
};

const fmtPct = (value: number): string => `${(value * 100).toFixed(2)}%`;
const fmtNum = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : 'NaN');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

const evaluateScenario = (
  id: ScenarioId,
  base: ModelParameters,
  policy: M8RiskCapitalPolicy,
  nSim: number,
): ScenarioResult => {
  const params = clone(base);
  params.simulation = { ...params.simulation, nSim };
  const risk = params.simulationComposition?.nonOptimizable?.riskCapital;
  if (params.simulationComposition && params.simulationComposition.nonOptimizable) {
    params.simulationComposition.nonOptimizable.riskCapital = {
      ...(risk ?? {}),
      totalCLP: Number(risk?.totalCLP ?? 0),
      clp: Number(risk?.clp ?? 0),
      usd: Number(risk?.usd ?? risk?.usdTotal ?? 0),
      usdTotal: Number(risk?.usdTotal ?? risk?.usd ?? 0),
      usdSnapshotCLP: Number(risk?.usdSnapshotCLP ?? params.fx.clpUsdInitial),
      source: typeof risk?.source === 'string' ? risk.source : 'summary_riskCapitalClp',
    };
  }
  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);
  input.risk_capital_policy = policy;
  const output = runM8(input);
  return {
    id,
    nSim,
    policy,
    input: {
      capital_initial_clp: input.capital_initial_clp,
      risk_capital_clp: input.risk_capital_clp ?? 0,
      risk_capital_policy: input.risk_capital_policy,
    },
    output: {
      success40: output.Success40,
      ruin20: output.ProbRuin20,
      houseSalePct: output.HouseSalePct,
      firstCutYearP50: output.FirstCutYearMedian ?? Number.NaN,
      maxDdP50: Number(output.maxDrawdownPercentiles?.[50] ?? Number.NaN),
      terminalP50: output.TerminalMedianCLP,
    },
  };
};

const printTable = (title: string, rows: ScenarioResult[]): void => {
  console.log(`\n${title}`);
  console.log('Scenario | nSim | policy | Success40 | Ruin20 | HouseSalePct | FirstCutYearP50 | MaxDDP50 | TerminalP50');
  console.log('---|---:|---|---:|---:|---:|---:|---:|---:');
  for (const row of rows) {
    console.log(
      `${row.id} | ${row.nSim} | ${row.policy} | ${fmtPct(row.output.success40)} | ${fmtPct(row.output.ruin20)} | ${fmtPct(row.output.houseSalePct)} | ${fmtNum(row.output.firstCutYearP50)} | ${fmtNum(row.output.maxDdP50)} | ${Math.round(row.output.terminalP50)}`,
    );
  }
};

const printVerdict = (b: ScenarioResult, e: ScenarioResult): void => {
  const diff = e.output.success40 - b.output.success40;
  const verdict = diff > 0.001 ? 'E mejora a B' : diff < -0.001 ? 'E empeora frente a B' : 'E empata con B';
  const timingRead = diff > 0.001
    ? 'mejora por timing de monetización'
    : Math.abs(diff) <= 0.005
      ? 'sin diferencia material'
      : 'mayor complejidad sin beneficio';
  console.log(`\nVerdict: ${verdict} (Delta Success40=${(diff * 100).toFixed(2)} pp)`);
  console.log(`Interpretación: ${timingRead}`);
};

const runPair = (base: ModelParameters, nSim: number): [ScenarioResult, ScenarioResult] => {
  const b = evaluateScenario('B_ACTUAL', base, 'reserve_late_full', nSim);
  const e = evaluateScenario('E_REALISTA', base, 'btc_like_realista_e', nSim);
  return [b, e];
};

const main = (): void => {
  const base = buildBaseScenario();
  const riskFromSource = resolveRiskFromComposition(base);
  if (riskFromSource <= 0) {
    throw new Error('simulationComposition.nonOptimizable.riskCapital no trae valor positivo');
  }

  const first = runPair(base, 500);
  printTable('B vs E (nSim=500)', first);

  const diff500 = Math.abs(first[0].output.success40 - first[1].output.success40);
  let last = first;
  if (diff500 <= 0.007) {
    const second = runPair(base, 1000);
    printTable('B vs E rerun (nSim=1000)', second);
    last = second;
    const diff1000 = Math.abs(second[0].output.success40 - second[1].output.success40);
    if (diff1000 <= 0.005) {
      const third = runPair(base, 3000);
      printTable('B vs E rerun final (nSim=3000)', third);
      last = third;
    }
  }

  printVerdict(last[0], last[1]);
  console.log('\nInput contract check');
  for (const row of last) {
    console.log(
      `- ${row.id}: capital_initial_clp=${Math.round(row.input.capital_initial_clp)} risk_capital_clp=${Math.round(row.input.risk_capital_clp ?? 0)} policy=${row.input.risk_capital_policy}`,
    );
  }
};

main();
