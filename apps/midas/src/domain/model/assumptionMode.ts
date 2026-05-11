export type AssumptionMode = 'base' | 'sandbox' | 'scenario';
export type StructuralAssumptionsSource = 'cloud' | 'missing' | 'not_implemented';

export type AssumptionModeDiagnostics = {
  assumptionMode: AssumptionMode;
  sandboxActive: boolean;
  localUnsyncedAdjustments: boolean;
  structuralAssumptionsSource: StructuralAssumptionsSource;
};

export type BuildAssumptionModeDiagnosticsInput = {
  assumptionMode?: AssumptionMode;
  sandboxActive?: boolean;
  localUnsyncedAdjustments?: boolean;
  structuralAssumptionsSource?: StructuralAssumptionsSource;
};

export function buildAssumptionModeDiagnostics(
  input: BuildAssumptionModeDiagnosticsInput = {},
): AssumptionModeDiagnostics {
  const sandboxActive = Boolean(input.sandboxActive);
  return {
    assumptionMode: input.assumptionMode ?? (sandboxActive ? 'sandbox' : 'base'),
    sandboxActive,
    localUnsyncedAdjustments: Boolean(input.localUnsyncedAdjustments),
    structuralAssumptionsSource: input.structuralAssumptionsSource ?? 'not_implemented',
  };
}
