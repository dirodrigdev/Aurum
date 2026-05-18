import type { InstrumentUniverseInstrument, InstrumentUniverseSnapshot } from './instrumentUniverse';
import type { PortfolioWeights } from './model/types';

export type InstrumentImplementationUniverse = {
  snapshot: InstrumentUniverseSnapshot;
  instruments: InstrumentUniverseInstrument[];
};

export type InstrumentImplementationConstraintFlags = {
  sameCurrency: boolean;
  sameManager: boolean;
  sameTaxWrapper: boolean;
  crossManager: boolean;
  crossCurrency: boolean;
};

export type InstrumentImplementationStage = 'clean' | 'cross_manager' | 'cross_currency';

export type InstrumentImplementationStageSummary = {
  stage: InstrumentImplementationStage;
  used: boolean;
  operationCount: number;
  movedClp: number;
  reachedMix: { rv: number; rf: number };
  remainingGapRvPp: number;
};

export type InstrumentImplementationTransfer = {
  fromInstrumentId: string;
  fromName: string;
  fromManager?: string | null;
  fromCurrency?: string | null;
  fromTaxWrapper?: string | null;
  toInstrumentId: string;
  toName: string;
  toManager?: string | null;
  toCurrency?: string | null;
  toTaxWrapper?: string | null;
  weightMoved: number;
  amountNativeMoved: number | null;
  nativeCurrency: string | null;
  amountClpMoved: number;
  stage: InstrumentImplementationStage;
  rationale: string;
  constraints: InstrumentImplementationConstraintFlags;
};

export type InstrumentImplementationPlan = {
  targetMixIdeal: { rv: number; rf: number };
  currentMix: { rv: number; rf: number };
  reachableMix: { rv: number; rf: number };
  gapVsIdealRvPp: number;
  equivalentToIdeal: boolean;
  structuralChangeRequired: boolean;
  transfers: InstrumentImplementationTransfer[];
  stageSummaries: InstrumentImplementationStageSummary[];
  restrictionsApplied: InstrumentImplementationConstraintFlags;
  warnings: string[];
  baseTargetWeights: PortfolioWeights;
  reachableWeights: PortfolioWeights;
};
