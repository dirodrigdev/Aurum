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
  statusReason: 'used' | 'not_required' | 'agotado' | 'sin_destinos_elegibles' | 'bloqueado_por_metadata' | 'no_mejora_rv_rf';
  operationCount: number;
  movedClp: number;
  reachedMix: { rv: number; rf: number };
  remainingGapRvPp: number;
};

export type InstrumentImplementationDestinationDiagnostic = {
  instrumentId: string;
  name: string;
  rv: number;
  eligible: boolean;
  used: boolean;
  reason: string;
};

export type InstrumentImplementationResidualCategory =
  | 'embedded_rf'
  | 'direct_rf'
  | 'cash'
  | 'captive'
  | 'outside_universe'
  | 'bucket_protected'
  | 'currency_restricted'
  | 'manager_restricted'
  | 'not_selected'
  | 'no_residual';

export type InstrumentImplementationResidualRow = {
  instrumentId: string;
  name: string;
  postAmountClp: number;
  rvPost: number;
  rfPost: number;
  rfClpEquivalent: number;
  movable: boolean;
  protected: boolean;
  category: InstrumentImplementationResidualCategory;
  reason: string;
};

export type InstrumentImplementationUniverseAuditRow = {
  instrumentId: string;
  name: string;
  blockLabel: string;
  amountClp: number;
  currency: string | null;
  rv: number;
  rf: number;
  movable: boolean;
  protected: boolean;
  includedAsSource: boolean;
  includedAsDestination: boolean;
  reason: string;
  fileFilter: string;
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

export type InstrumentImplementationAlternativePlanSummary = {
  planLevel: InstrumentImplementationStage;
  reachableMix: { rv: number; rf: number };
  gapVsIdealRvPp: number;
  operationCount: number;
  movedClp: number;
  maxFrictionUsed: InstrumentImplementationStage;
  warnings: string[];
};

export type InstrumentImplementationPlan = {
  planLevel: InstrumentImplementationStage;
  alternativePlans: InstrumentImplementationAlternativePlanSummary[];
  targetMixIdeal: { rv: number; rf: number };
  currentMix: { rv: number; rf: number };
  reachableMix: { rv: number; rf: number };
  gapVsIdealRvPp: number;
  equivalentToIdeal: boolean;
  structuralChangeRequired: boolean;
  transfers: InstrumentImplementationTransfer[];
  stageSummaries: InstrumentImplementationStageSummary[];
  destinationDiagnostics: InstrumentImplementationDestinationDiagnostic[];
  restrictionsApplied: InstrumentImplementationConstraintFlags;
  warnings: string[];
  baseTargetWeights: PortfolioWeights;
  reachableWeights: PortfolioWeights;
  residualRows: InstrumentImplementationResidualRow[];
  universeAudit: InstrumentImplementationUniverseAuditRow[];
};
