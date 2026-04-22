import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import type { M8Input, M8RiskCapitalPolicy } from './m8.types';
import { resolveCapital } from './capitalResolver';
import { toM8Input } from './m8Adapter';
import { runM8 } from './engineM8';

type ScenarioId = 'A_OFF' | 'B_ON_CURRENT' | 'C_ON_H40_LATE' | 'D_ON_H40_STRESS_PREHOUSE';

type ScenarioResult = {
  id: ScenarioId;
  nSim: number;
  policy: M8RiskCapitalPolicy;
  riskEnabled: boolean;
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
    nSim: 1000,
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
  options: { riskEnabled: boolean; policy: M8RiskCapitalPolicy; nSim: number },
): ScenarioResult => {
  const params = clone(base);
  params.simulation = { ...params.simulation, nSim: options.nSim };
  const risk = params.simulationComposition?.nonOptimizable?.riskCapital;
  if (params.simulationComposition && params.simulationComposition.nonOptimizable) {
    params.simulationComposition.nonOptimizable.riskCapital = {
      ...(risk ?? {}),
      totalCLP: options.riskEnabled ? Number(risk?.totalCLP ?? 0) : 0,
      clp: options.riskEnabled ? Number(risk?.clp ?? 0) : 0,
      usd: options.riskEnabled ? Number(risk?.usd ?? risk?.usdTotal ?? 0) : 0,
      usdTotal: options.riskEnabled ? Number(risk?.usdTotal ?? risk?.usd ?? 0) : 0,
      usdSnapshotCLP: Number(risk?.usdSnapshotCLP ?? params.fx.clpUsdInitial),
      source: typeof risk?.source === 'string' ? risk.source : 'summary_riskCapitalClp',
    };
  }

  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);
  input.risk_capital_policy = options.policy;
  const output = runM8(input);

  return {
    id,
    nSim: options.nSim,
    policy: options.policy,
    riskEnabled: options.riskEnabled,
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

const printTable = (title: string, results: ScenarioResult[]): void => {
  console.log(`\n${title}`);
  console.log('Scenario | nSim | policy | Success40 | Ruin20 | HouseSalePct | FirstCutYearP50 | MaxDDP50 | TerminalP50');
  console.log('---|---:|---|---:|---:|---:|---:|---:|---:');
  for (const row of results) {
    console.log(
      `${row.id} | ${row.nSim} | ${row.policy} | ${fmtPct(row.output.success40)} | ${fmtPct(row.output.ruin20)} | ${fmtPct(row.output.houseSalePct)} | ${fmtNum(row.output.firstCutYearP50)} | ${fmtNum(row.output.maxDdP50)} | ${Math.round(row.output.terminalP50)}`,
    );
  }
};

const buildNarrative = (results: ScenarioResult[]): Record<ScenarioId, string> => {
  const bestSuccess = [...results].sort((a, b) => b.output.success40 - a.output.success40)[0]?.id;
  const leastHouseSale = [...results].sort((a, b) => a.output.houseSalePct - b.output.houseSalePct)[0]?.id;
  const bestRuin20 = [...results].sort((a, b) => a.output.ruin20 - b.output.ruin20)[0]?.id;
  const out = {} as Record<ScenarioId, string>;
  for (const row of results) {
    const tags: string[] = [];
    if (row.id === bestSuccess) tags.push('mejor supervivencia');
    if (row.id === bestRuin20) tags.push('menor Ruin20');
    if (row.id === leastHouseSale) tags.push('menos venta de casa');
    if (tags.length === 0) tags.push('balance intermedio');
    out[row.id] = tags.join(' · ');
  }
  return out;
};

const main = (): void => {
  const base = buildBaseScenario();
  const riskFromSource = resolveRiskFromComposition(base);
  if (riskFromSource <= 0) {
    throw new Error('simulationComposition.nonOptimizable.riskCapital no trae valor positivo para auditar');
  }

  const baseline = [
    evaluateScenario('A_OFF', base, { riskEnabled: false, policy: 'reserve_late_full', nSim: 1000 }),
    evaluateScenario('B_ON_CURRENT', base, { riskEnabled: true, policy: 'reserve_late_full', nSim: 1000 }),
    evaluateScenario('C_ON_H40_LATE', base, { riskEnabled: true, policy: 'reserve_late_haircut40', nSim: 1000 }),
    evaluateScenario('D_ON_H40_STRESS_PREHOUSE', base, { riskEnabled: true, policy: 'reserve_stress_haircut40_prehouse20', nSim: 1000 }),
  ];

  printTable('A/B/C/D comparison (nSim=1000)', baseline);

  const sortedBySuccess = [...baseline].sort((a, b) => b.output.success40 - a.output.success40);
  const top1 = sortedBySuccess[0];
  const top2 = sortedBySuccess[1];
  const rerunNeeded = top1 && top2 ? Math.abs(top1.output.success40 - top2.output.success40) <= 0.007 : false;
  if (rerunNeeded && top1 && top2) {
    const rerun = [
      evaluateScenario(top1.id, base, { riskEnabled: top1.riskEnabled, policy: top1.policy, nSim: 3000 }),
      evaluateScenario(top2.id, base, { riskEnabled: top2.riskEnabled, policy: top2.policy, nSim: 3000 }),
    ];
    printTable('Tie-break rerun (top2 only, nSim=3000)', rerun);
  }

  const narratives = buildNarrative(baseline);
  console.log('\nScenario notes');
  for (const row of baseline) {
    console.log(`- ${row.id}: ${narratives[row.id]}`);
  }

  console.log('\nInput contract check');
  for (const row of baseline) {
    console.log(
      `- ${row.id}: capital_initial_clp=${Math.round(row.input.capital_initial_clp)} risk_capital_clp=${Math.round(row.input.risk_capital_clp ?? 0)} policy=${row.input.risk_capital_policy}`,
    );
  }
};

main();
