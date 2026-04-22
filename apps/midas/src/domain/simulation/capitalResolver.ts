import type { AurumOptimizableInvestmentsSnapshot } from '../../integrations/aurum/types';
import type { ModelParameters } from '../model/types';

export interface CapitalResolverRealEstateSource {
  propertyValueCLP: number;
  mortgageDebtOutstandingCLP: number;
  monthlyMortgagePaymentCLP?: number;
  ufSnapshotCLP?: number;
  snapshotMonth?: string;
}

export interface CapitalResolverSimulationComposition {
  mode: 'legacy' | 'partial' | 'full';
  totalNetWorthCLP: number;
  optimizableInvestmentsCLP: number;
  nonOptimizable: {
    banksCLP: number;
    realEstate?: CapitalResolverRealEstateSource;
    riskCapital?: {
      enabled?: boolean;
      totalCLP?: number;
      clp?: number;
      usd?: number;
      usdTotal?: number;
      usdSnapshotCLP?: number;
      profile?: 'conservative' | 'base' | 'aggressive';
      source?: string;
    };
  };
}

export interface CapitalResolution {
  capitalInitial: number;
  simulationComposition: CapitalResolverSimulationComposition;
  sourceLabel: string;
}

export interface CapitalResolverInput {
  params: ModelParameters;
  aurumSnapshot?: AurumOptimizableInvestmentsSnapshot | null;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const finiteOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildRealEstateSource = (realEstate: unknown): CapitalResolverRealEstateSource | undefined => {
  if (!realEstate || typeof realEstate !== 'object') return undefined;
  const record = realEstate as Record<string, unknown>;
  const propertyValueCLP = finiteOrZero(record.propertyValueCLP);
  const mortgageDebtOutstandingCLP = finiteOrZero(record.mortgageDebtOutstandingCLP);
  const monthlyMortgagePaymentCLP = finiteOrZero(record.monthlyMortgagePaymentCLP);
  const ufSnapshotCLP = finiteOrZero(record.ufSnapshotCLP);
  const snapshotMonth = typeof record.snapshotMonth === 'string' ? record.snapshotMonth : undefined;

  if (
    propertyValueCLP <= 0 &&
    mortgageDebtOutstandingCLP <= 0 &&
    monthlyMortgagePaymentCLP <= 0 &&
    ufSnapshotCLP <= 0 &&
    !snapshotMonth
  ) {
    return undefined;
  }

  return {
    propertyValueCLP,
    mortgageDebtOutstandingCLP,
    ...(monthlyMortgagePaymentCLP > 0 ? { monthlyMortgagePaymentCLP } : {}),
    ...(ufSnapshotCLP > 0 ? { ufSnapshotCLP } : {}),
    ...(snapshotMonth ? { snapshotMonth } : {}),
  };
};

const buildRiskCapitalSource = (riskCapital: unknown):
  CapitalResolverSimulationComposition['nonOptimizable']['riskCapital'] | undefined => {
  if (!riskCapital || typeof riskCapital !== 'object') return undefined;
  const record = riskCapital as Record<string, unknown>;
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : undefined;
  const totalCLP = finiteOrZero(record.totalCLP);
  const clp = finiteOrZero(record.clp);
  const usd = finiteOrZero(record.usd);
  const usdTotal = finiteOrZero(record.usdTotal);
  const usdSnapshotCLP = finiteOrZero(record.usdSnapshotCLP);
  const profile = record.profile;
  const source = typeof record.source === 'string' ? record.source : undefined;

  if (enabled === undefined && totalCLP <= 0 && clp <= 0 && usd <= 0 && usdTotal <= 0 && usdSnapshotCLP <= 0 && !source) {
    return undefined;
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(totalCLP > 0 ? { totalCLP } : {}),
    ...(clp > 0 ? { clp } : {}),
    ...(usd > 0 ? { usd } : {}),
    ...(usdTotal > 0 ? { usdTotal } : {}),
    ...(usdSnapshotCLP > 0 ? { usdSnapshotCLP } : {}),
    ...(profile === 'conservative' || profile === 'base' || profile === 'aggressive' ? { profile } : {}),
    ...(source ? { source } : {}),
  };
};

export function resolveCapital(input: CapitalResolverInput): CapitalResolution {
  const { params, aurumSnapshot } = input;
  const capitalSource = params.capitalSource ?? 'aurum';

  if (capitalSource !== 'aurum' && capitalSource !== 'manual') {
    throw new Error('capitalSource invalido: debe ser "aurum" o "manual"');
  }

  if (capitalSource === 'aurum') {
    const simulationComposition = params.simulationComposition;
    const hasRuntimeComposition =
      simulationComposition &&
      Number.isFinite(simulationComposition.optimizableInvestmentsCLP) &&
      simulationComposition.optimizableInvestmentsCLP >= 0;

    if (!aurumSnapshot && !hasRuntimeComposition) {
      throw new Error('capitalSource=aurum requiere aurumSnapshot publicado o simulationComposition resuelta');
    }

    const optimizableInvestmentsCLP = aurumSnapshot
      ? aurumSnapshot.optimizableInvestmentsCLP
      : simulationComposition!.optimizableInvestmentsCLP;
    if (!isFiniteNumber(optimizableInvestmentsCLP)) {
      throw new Error('Aurum capital invalido: optimizableInvestmentsCLP faltante');
    }

    const banksCLP = aurumSnapshot
      ? (aurumSnapshot.version === 2 ? finiteOrZero(aurumSnapshot.nonOptimizable?.banksCLP) : 0)
      : finiteOrZero(simulationComposition?.nonOptimizable?.banksCLP);
    const realEstate = aurumSnapshot
      ? (aurumSnapshot.version === 2 ? buildRealEstateSource(aurumSnapshot.nonOptimizable?.realEstate) : undefined)
      : buildRealEstateSource(simulationComposition?.nonOptimizable?.realEstate);
    const riskCapitalFromComposition = buildRiskCapitalSource(simulationComposition?.nonOptimizable?.riskCapital);
    const riskCapitalFromSnapshot = aurumSnapshot?.riskCapital
      ? buildRiskCapitalSource(aurumSnapshot.riskCapital)
      : undefined;
    const riskCapital = riskCapitalFromComposition ?? riskCapitalFromSnapshot;
    const capitalInitial = optimizableInvestmentsCLP + banksCLP;
    const realEstateEquityCLP = realEstate
      ? Math.max(0, realEstate.propertyValueCLP - realEstate.mortgageDebtOutstandingCLP)
      : 0;

    return {
      capitalInitial,
      sourceLabel: aurumSnapshot?.snapshotLabel
        ? `Aurum · ${aurumSnapshot.snapshotLabel}`
        : params.label?.trim()
          ? `Aurum · ${params.label.replace(/^Desde Aurum\s*—\s*/iu, '')}`
          : 'Aurum · latest_confirmed_closure',
      simulationComposition: {
        mode: realEstate ? 'full' : 'legacy',
        totalNetWorthCLP: capitalInitial + realEstateEquityCLP,
        optimizableInvestmentsCLP,
        nonOptimizable: {
          banksCLP,
          ...(realEstate ? { realEstate } : {}),
          ...(riskCapital ? { riskCapital } : {}),
        },
      },
    };
  }

  const manualCapitalInitial = params.manualCapitalInput?.financialCapitalCLP ?? params.capitalInitial;
  if (!isFiniteNumber(manualCapitalInitial) || manualCapitalInitial < 0) {
    throw new Error('manualCapitalInput.financialCapitalCLP o capitalInitial debe ser >= 0');
  }

  const manualRealEstate = params.simulationComposition?.nonOptimizable?.realEstate;
  const realEstate =
    manualRealEstate && typeof manualRealEstate === 'object'
      ? {
          propertyValueCLP: finiteOrZero(manualRealEstate.propertyValueCLP),
          mortgageDebtOutstandingCLP: finiteOrZero(manualRealEstate.mortgageDebtOutstandingCLP),
          ...(Number.isFinite(manualRealEstate.monthlyMortgagePaymentCLP)
            ? { monthlyMortgagePaymentCLP: finiteOrZero(manualRealEstate.monthlyMortgagePaymentCLP) }
            : {}),
          ...(Number.isFinite(manualRealEstate.ufSnapshotCLP)
            ? { ufSnapshotCLP: finiteOrZero(manualRealEstate.ufSnapshotCLP) }
            : {}),
          ...(typeof manualRealEstate.snapshotMonth === 'string'
            ? { snapshotMonth: manualRealEstate.snapshotMonth }
            : {}),
        }
      : undefined;

  const capitalInitial = manualCapitalInitial;
  const realEstateEquityCLP = realEstate
    ? Math.max(0, realEstate.propertyValueCLP - realEstate.mortgageDebtOutstandingCLP)
    : 0;
  const riskCapital = buildRiskCapitalSource(params.simulationComposition?.nonOptimizable?.riskCapital);

  return {
    capitalInitial,
    sourceLabel: params.label?.trim() ? `Manual · ${params.label}` : 'Manual · capital inicial',
    simulationComposition: {
      mode: realEstate ? 'partial' : 'legacy',
      totalNetWorthCLP: capitalInitial + realEstateEquityCLP,
      optimizableInvestmentsCLP: capitalInitial,
      nonOptimizable: {
        banksCLP: 0,
        ...(realEstate ? { realEstate } : {}),
        ...(riskCapital ? { riskCapital } : {}),
      },
    },
  };
}
