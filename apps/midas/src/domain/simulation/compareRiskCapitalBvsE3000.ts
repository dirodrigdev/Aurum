import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import type { M8Input, M8Output, M8RiskCapitalPolicy } from './m8.types';
import { resolveCapital } from './capitalResolver';
import { toM8Input } from './m8Adapter';
import { runM8 } from './engineM8';

type ScenarioId = 'S1_BASE_ACTUAL' | 'S2_HIGHER_SPEND' | 'S3_STRESSED';

type PolicyRow = {
  policy: M8RiskCapitalPolicy;
  output: {
    success40: number;
    ruin20: number;
    houseSalePct: number;
    firstCutYearP50: number;
    maxDdP50: number;
    terminalP50: number;
  };
  riskInput: {
    capitalInitialClp: number;
    riskCapitalClp: number;
  };
  eSales?: {
    largeSales: NonNullable<M8Output['RiskELargeSalesStats']>;
    microSales: NonNullable<M8Output['RiskEMicroSalesStats']>;
  };
};

type ScenarioComparison = {
  scenario: ScenarioId;
  notes: string;
  nSim: number;
  b: PolicyRow;
  e: PolicyRow;
  verdict: 'E mejora a B' | 'E empata con B' | 'E empeora frente a B';
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
    nSim: 3000,
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

const applyScenarioVariant = (base: ModelParameters, scenario: ScenarioId): { params: ModelParameters; notes: string } => {
  const params = clone(base);
  if (scenario === 'S1_BASE_ACTUAL') {
    return { params, notes: 'Escenario actual base de simulación (sin cambios).' };
  }
  if (scenario === 'S2_HIGHER_SPEND') {
    params.spendingPhases = (params.spendingPhases ?? []).map((phase) => ({
      ...phase,
      amountReal: Math.round(phase.amountReal * 1.12),
    }));
    return { params, notes: 'Mayor exigencia de gasto: +12% en todas las fases.' };
  }
  params.activeScenario = 'pessimistic';
  return { params, notes: 'Escenario más estresado: escenario activo pessimistic, resto igual.' };
};

const runPolicy = (params: ModelParameters, policy: M8RiskCapitalPolicy): PolicyRow => {
  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);
  input.risk_capital_policy = policy;
  if (policy === 'btc_like_realista_e') {
    input.risk_capital_btc_driver = 'btc_like_v1';
  }
  const output = runM8(input);
  return {
    policy,
    output: {
      success40: output.Success40,
      ruin20: output.ProbRuin20,
      houseSalePct: output.HouseSalePct,
      firstCutYearP50: output.FirstCutYearMedian ?? Number.NaN,
      maxDdP50: Number(output.maxDrawdownPercentiles?.[50] ?? Number.NaN),
      terminalP50: output.TerminalMedianCLP,
    },
    riskInput: {
      capitalInitialClp: input.capital_initial_clp,
      riskCapitalClp: input.risk_capital_clp ?? 0,
    },
    eSales: policy === 'btc_like_realista_e'
      ? {
        largeSales: output.RiskELargeSalesStats ?? [],
        microSales: output.RiskEMicroSalesStats ?? {
          executionPct: Number.NaN,
          firstYearMedian: Number.NaN,
          lastYearMedian: Number.NaN,
          countMedian: Number.NaN,
          countMean: Number.NaN,
        },
      }
      : undefined,
  };
};

const scenarioCompare = (base: ModelParameters, scenario: ScenarioId): ScenarioComparison => {
  const { params, notes } = applyScenarioVariant(base, scenario);
  const b = runPolicy(params, 'reserve_late_full');
  const e = runPolicy(params, 'btc_like_realista_e');
  const delta = e.output.success40 - b.output.success40;
  const verdict: ScenarioComparison['verdict'] = delta > 0.001
    ? 'E mejora a B'
    : delta < -0.001
      ? 'E empeora frente a B'
      : 'E empata con B';
  return {
    scenario,
    notes,
    nSim: params.simulation.nSim,
    b,
    e,
    verdict,
  };
};

const printComparison = (rows: ScenarioComparison[]): void => {
  console.log('\nB_ACTUAL vs E_REALISTA(btc_like_v1) @ nSim=3000');
  console.log('Scenario | Success40(B) | Success40(E) | Ruin20(B) | Ruin20(E) | HouseSale(B) | HouseSale(E) | FirstCutP50(B) | FirstCutP50(E) | MaxDDP50(B) | MaxDDP50(E) | TerminalP50(B) | TerminalP50(E) | Veredicto');
  console.log('---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---');
  for (const row of rows) {
    console.log(
      `${row.scenario} | ${fmtPct(row.b.output.success40)} | ${fmtPct(row.e.output.success40)} | ${fmtPct(row.b.output.ruin20)} | ${fmtPct(row.e.output.ruin20)} | ${fmtPct(row.b.output.houseSalePct)} | ${fmtPct(row.e.output.houseSalePct)} | ${fmtNum(row.b.output.firstCutYearP50)} | ${fmtNum(row.e.output.firstCutYearP50)} | ${fmtNum(row.b.output.maxDdP50)} | ${fmtNum(row.e.output.maxDdP50)} | ${Math.round(row.b.output.terminalP50)} | ${Math.round(row.e.output.terminalP50)} | ${row.verdict}`,
    );
  }
};

const printESales = (rows: ScenarioComparison[]): void => {
  console.log('\nPatrón de ventas E_REALISTA (btc_like_v1)');
  for (const row of rows) {
    const eSales = row.e.eSales;
    if (!eSales) continue;
    console.log(`\n${row.scenario} — ${row.notes}`);
    console.log('Ventas grandes 20% (por orden):');
    console.log('Sale | ExecPct | YearP25 | YearMedian | YearP75 | YearMean');
    console.log('---|---:|---:|---:|---:|---:');
    for (const sale of eSales.largeSales) {
      console.log(
        `${sale.saleIndex} | ${fmtPct(sale.executionPct)} | ${fmtNum(sale.yearP25)} | ${fmtNum(sale.yearMedian)} | ${fmtNum(sale.yearP75)} | ${fmtNum(sale.yearMean)}`,
      );
    }
    const micro = eSales.microSales;
    console.log('Microventas 5% (20% final):');
    console.log(
      `ExecPct=${fmtPct(micro.executionPct)} | FirstMedian=${fmtNum(micro.firstYearMedian)} | LastMedian=${fmtNum(micro.lastYearMedian)} | CountMedian=${fmtNum(micro.countMedian)} | CountMean=${fmtNum(micro.countMean)}`,
    );
  }
};

const printContractCheck = (rows: ScenarioComparison[]): void => {
  console.log('\nSource-of-truth contract check');
  for (const row of rows) {
    console.log(
      `- ${row.scenario}: capital_initial_clp=${Math.round(row.b.riskInput.capitalInitialClp)} risk_capital_clp=${Math.round(row.b.riskInput.riskCapitalClp)} (B y E iguales)`,
    );
  }
};

const main = (): void => {
  const base = buildBaseScenario();
  const riskFromSource = resolveRiskFromComposition(base);
  if (riskFromSource <= 0) {
    throw new Error('simulationComposition.nonOptimizable.riskCapital no trae valor positivo');
  }
  const scenarios: ScenarioId[] = ['S1_BASE_ACTUAL', 'S2_HIGHER_SPEND', 'S3_STRESSED'];
  const rows = scenarios.map((scenario) => scenarioCompare(base, scenario));
  printComparison(rows);
  printESales(rows);
  printContractCheck(rows);
};

main();
