export type OperativeFxSourceMode = 'aurum-current' | 'manual-override' | 'fallback';

export type OperativeFxReasonCode =
  | 'aurum_current_applied'
  | 'aurum_current_available_but_not_applied'
  | 'manual_override_applied'
  | 'fallback_runtime_applied'
  | 'no_usable_fx';

export type OperativeFxResolution = {
  sourceMode: OperativeFxSourceMode;
  reasonCode: OperativeFxReasonCode;
  aurumSource: string | null;
  aurumCandidateClp: number | null;
  aurumCurrentClp: number | null;
  aurumCurrentAvailable: boolean;
  runtimeClp: number | null;
  manualOverrideClp: number | null;
  appliedClp: number | null;
  usingAurumCurrent: boolean;
};

export type AurumEurUsdForMidasResolution = {
  sourceUsdEur: number | null;
  eurUsdForMidas: number | null;
  valid: boolean;
  reasonCode:
    | 'aurum_usd_eur_converted'
    | 'missing_source'
    | 'invalid_source_usd_eur'
    | 'source_usd_eur_out_of_range'
    | 'converted_eur_usd_out_of_range';
};

const REL_TOLERANCE = 0.0005;

const asPositiveFinite = (value: number | null | undefined): number | null => {
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const approximatelyEqual = (a: number, b: number) => Math.abs(a - b) / a <= REL_TOLERANCE;

export function isAurumCurrentFxSource(source: string | null | undefined): boolean {
  const normalized = String(source ?? '').trim().toLowerCase();
  if (!normalized) return false;
  // A closure-backed reference is the canonical economic FX for MIDAS. It is
  // distinct from a browser's live/local FX, but still authoritative here.
  if (normalized === 'closure_fx_metadata') return true;
  if (normalized.includes('closure')) return false;
  if (normalized.includes('active')) return true;
  if (normalized.includes('manual')) return true;
  if (normalized.includes('live')) return true;
  return false;
}

export function resolveAurumEurUsdForMidas(sourceUsdEurValue: number | null | undefined): AurumEurUsdForMidasResolution {
  const sourceUsdEur = asPositiveFinite(sourceUsdEurValue);
  if (sourceUsdEur === null) {
    return {
      sourceUsdEur: null,
      eurUsdForMidas: null,
      valid: false,
      reasonCode: sourceUsdEurValue == null ? 'missing_source' : 'invalid_source_usd_eur',
    };
  }
  // Legacy naming trap:
  // - Aurum publishes fxReference.usdEur as USD/EUR (usdClp / eurClp).
  // - MIDAS params.fx.usdEurFixed is consumed by the model as EUR/USD.
  // Convert exactly once at the boundary, before feeding MIDAS params.
  if (sourceUsdEur < 0.6 || sourceUsdEur > 1.2) {
    return {
      sourceUsdEur,
      eurUsdForMidas: null,
      valid: false,
      reasonCode: 'source_usd_eur_out_of_range',
    };
  }
  const eurUsdForMidas = 1 / sourceUsdEur;
  if (!Number.isFinite(eurUsdForMidas) || eurUsdForMidas < 0.8 || eurUsdForMidas > 1.4) {
    return {
      sourceUsdEur,
      eurUsdForMidas: null,
      valid: false,
      reasonCode: 'converted_eur_usd_out_of_range',
    };
  }
  return {
    sourceUsdEur,
    eurUsdForMidas,
    valid: true,
    reasonCode: 'aurum_usd_eur_converted',
  };
}

export function resolveOperativeMasterFx(input: {
  aurumFxClp: number | null | undefined;
  aurumFxSource: string | null | undefined;
  runtimeFxClp: number | null | undefined;
  manualOverrideFxClp?: number | null | undefined;
}): OperativeFxResolution {
  const aurumCandidateClp = asPositiveFinite(input.aurumFxClp);
  const runtimeClp = asPositiveFinite(input.runtimeFxClp);
  const manualOverrideClp = asPositiveFinite(input.manualOverrideFxClp);
  const aurumSource = typeof input.aurumFxSource === 'string' && input.aurumFxSource.trim().length > 0
    ? input.aurumFxSource.trim()
    : null;
  const aurumCurrentAvailable = aurumCandidateClp !== null && isAurumCurrentFxSource(aurumSource);
  const aurumCurrentClp = aurumCurrentAvailable ? aurumCandidateClp : null;
  const usingAurumCurrent =
    aurumCurrentClp !== null &&
    runtimeClp !== null &&
    approximatelyEqual(aurumCurrentClp, runtimeClp);

  if (aurumCurrentClp !== null) {
    if (usingAurumCurrent) {
      return {
        sourceMode: 'aurum-current',
        reasonCode: 'aurum_current_applied',
        aurumSource,
        aurumCandidateClp,
        aurumCurrentClp,
        aurumCurrentAvailable,
        runtimeClp,
        manualOverrideClp,
        appliedClp: runtimeClp,
        usingAurumCurrent,
      };
    }
    return {
      sourceMode: 'fallback',
      reasonCode: 'aurum_current_available_but_not_applied',
      aurumSource,
      aurumCandidateClp,
      aurumCurrentClp,
      aurumCurrentAvailable,
      runtimeClp,
      manualOverrideClp,
      appliedClp: runtimeClp,
      usingAurumCurrent,
    };
  }

  if (manualOverrideClp !== null) {
    return {
      sourceMode: 'manual-override',
      reasonCode: 'manual_override_applied',
      aurumSource,
      aurumCandidateClp,
      aurumCurrentClp: null,
      aurumCurrentAvailable,
      runtimeClp,
      manualOverrideClp,
      appliedClp: manualOverrideClp,
      usingAurumCurrent: false,
    };
  }

  if (runtimeClp !== null) {
    return {
      sourceMode: 'fallback',
      reasonCode: 'fallback_runtime_applied',
      aurumSource,
      aurumCandidateClp,
      aurumCurrentClp: null,
      aurumCurrentAvailable,
      runtimeClp,
      manualOverrideClp,
      appliedClp: runtimeClp,
      usingAurumCurrent: false,
    };
  }

  return {
    sourceMode: 'fallback',
    reasonCode: 'no_usable_fx',
    aurumSource,
    aurumCandidateClp,
    aurumCurrentClp: null,
    aurumCurrentAvailable,
    runtimeClp,
    manualOverrideClp,
    appliedClp: null,
    usingAurumCurrent: false,
  };
}
