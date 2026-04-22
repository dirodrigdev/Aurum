import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import type { M8Input, M8RiskCapitalBtcDriver } from './m8.types';
import { resolveCapital } from './capitalResolver';
import { toM8Input } from './m8Adapter';
import { runM8 } from './engineM8';

type ScenarioId = 'E_EQ_PROXY' | 'E_BTC_LIKE';

type ScenarioResult = {
  id: ScenarioId;
  nSim: number;
  driver: M8RiskCapitalBtcDriver;
  input: Pick<M8Input, 'capital_initial_clp' | 'risk_capital_clp' | 'risk_capital_policy' | 'risk_capital_btc_driver'>;
  output: {
    success40: number;
    ruin20: number;
    houseSalePct: number;
    firstCutYearP50: number;
    maxDdP50: number;
    terminalP50: number;
    sale1YearP50: number;
    sale2YearP50: number;
    anyLargeSalePct: number;
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

const evaluateScenario = (id: ScenarioId, base: ModelParameters, driver: M8RiskCapitalBtcDriver, nSim: number): ScenarioResult => {
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
  input.risk_capital_policy = 'btc_like_realista_e';
  input.risk_capital_btc_driver = driver;
  const output = runM8(input);
  return {
    id,
    nSim,
    driver,
    input: {
      capital_initial_clp: input.capital_initial_clp,
      risk_capital_clp: input.risk_capital_clp ?? 0,
      risk_capital_policy: input.risk_capital_policy,
      risk_capital_btc_driver: input.risk_capital_btc_driver,
    },
    output: {
      success40: output.Success40,
      ruin20: output.ProbRuin20,
      houseSalePct: output.HouseSalePct,
      firstCutYearP50: output.FirstCutYearMedian ?? Number.NaN,
      maxDdP50: Number(output.maxDrawdownPercentiles?.[50] ?? Number.NaN),
      terminalP50: output.TerminalMedianCLP,
      sale1YearP50: output.RiskELargeSell1YearMedian ?? Number.NaN,
      sale2YearP50: output.RiskELargeSell2YearMedian ?? Number.NaN,
      anyLargeSalePct: output.RiskEAnyLargeSalePct ?? Number.NaN,
    },
  };
};

const printTable = (rows: ScenarioResult[]): void => {
  console.log('\nE_REALISTA driver comparison (nSim=500)');
  console.log('Scenario | driver | Success40 | Ruin20 | HouseSalePct | FirstCutYearP50 | MaxDDP50 | TerminalP50 | Sell1YearP50 | Sell2YearP50 | AnyLargeSalePct');
  console.log('---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:');
  for (const row of rows) {
    console.log(
      `${row.id} | ${row.driver} | ${fmtPct(row.output.success40)} | ${fmtPct(row.output.ruin20)} | ${fmtPct(row.output.houseSalePct)} | ${fmtNum(row.output.firstCutYearP50)} | ${fmtNum(row.output.maxDdP50)} | ${Math.round(row.output.terminalP50)} | ${fmtNum(row.output.sale1YearP50)} | ${fmtNum(row.output.sale2YearP50)} | ${fmtPct(row.output.anyLargeSalePct)}`,
    );
  }
};

const main = (): void => {
  const base = buildBaseScenario();
  const riskFromSource = resolveRiskFromComposition(base);
  if (riskFromSource <= 0) {
    throw new Error('simulationComposition.nonOptimizable.riskCapital no trae valor positivo');
  }
  const oldDriver = evaluateScenario('E_EQ_PROXY', base, 'eq_global_proxy', 500);
  const newDriver = evaluateScenario('E_BTC_LIKE', base, 'btc_like_v1', 500);
  printTable([oldDriver, newDriver]);

  console.log('\nInput contract check');
  for (const row of [oldDriver, newDriver]) {
    console.log(
      `- ${row.id}: capital_initial_clp=${Math.round(row.input.capital_initial_clp)} risk_capital_clp=${Math.round(row.input.risk_capital_clp ?? 0)} policy=${row.input.risk_capital_policy} driver=${row.input.risk_capital_btc_driver}`,
    );
  }
};

main();
