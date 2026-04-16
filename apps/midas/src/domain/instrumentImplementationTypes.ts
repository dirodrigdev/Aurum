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
};

export type InstrumentImplementationTransfer = {
  fromInstrumentId: string;
  fromName: string;
  toInstrumentId: string;
  toName: string;
  weightMoved: number;
  amountClpMoved: number;
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
  restrictionsApplied: InstrumentImplementationConstraintFlags;
  warnings: string[];
  baseTargetWeights: PortfolioWeights;
  reachableWeights: PortfolioWeights;
};

