import type {
  M8GeneratorParams,
  M8LegacyPortfolioWeights,
  M8OperationalWeights,
  M8PortfolioMix,
} from './m8.types';

export const M8_LEGACY_CORRELATION_ORDER = ['rvGlobal', 'rfGlobal', 'rvChile', 'rfChile'] as const;
export const M8_ORDER = ['eq_global', 'eq_chile', 'fi_global', 'fi_chile', 'usd_liquidity', 'clp_cash'] as const;

export const M8_STUDENT_T_DF = 7;

export const M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS = {
  rvGlobalAnnual: 0.069,
  rfGlobalAnnual: 0.024,
  rvChileAnnual: 0.074,
  rfChileRealAnnual: 0.019,
  rvGlobalVolAnnual: 0.150,
  rfGlobalVolAnnual: 0.045,
  rvChileVolAnnual: 0.190,
  rfChileVolAnnual: 0.035,
} as const;

export const M8_CANONICAL_CASH_RETURN_ASSUMPTIONS = {
  usd_liquidity_real_annual: 0.018,
  clp_cash_real_annual: 0.0025,
} as const;

export const M8_CANONICAL_CASH_VOLATILITY_ASSUMPTIONS = {
  usd_liquidity_vol_annual: 0.015,
  clp_cash_vol_annual: 0.002,
} as const;

export const M8_CANONICAL_PORTFOLIO_MIX: M8PortfolioMix = {
  eq_global: 0.438,
  eq_chile: 0.146,
  fi_global: 0.138,
  fi_chile: 0.194,
  usd_liquidity: 0.080,
  clp_cash: 0.004,
};

export const M8_CANONICAL_CORRELATION_MATRIX = [
  [1.00, 0.65, 0.05, 0.00, 0.05, 0.00],
  [0.65, 1.00, 0.05, 0.10, 0.05, 0.00],
  [0.05, 0.05, 1.00, 0.20, 0.50, 0.20],
  [0.00, 0.10, 0.20, 1.00, 0.20, 0.50],
  [0.05, 0.05, 0.50, 0.20, 1.00, 0.30],
  [0.00, 0.00, 0.20, 0.50, 0.30, 1.00],
] as const satisfies readonly (readonly number[])[];

export const M8_CANONICAL_LEGACY_CORRELATION_MATRIX = [
  [1.00, 0.05, 0.65, 0.00],
  [0.05, 1.00, 0.05, 0.20],
  [0.65, 0.05, 1.00, 0.10],
  [0.00, 0.20, 0.10, 1.00],
] as const satisfies readonly (readonly number[])[];

const cloneMatrix = (matrix: readonly (readonly number[])[]): number[][] => matrix.map((row) => row.slice());

const isSquareMatrix = (matrix: readonly (readonly number[])[]): boolean =>
  Array.isArray(matrix) && matrix.length > 0 && matrix.every((row) => Array.isArray(row) && row.length === matrix.length);

export const remapLegacyCorrelationMatrixToM8 = (legacyMatrix: readonly (readonly number[])[]): number[][] => {
  const size = Array.isArray(legacyMatrix) ? legacyMatrix.length : 0;

  if (!Array.isArray(legacyMatrix) || size === 0) {
    return cloneMatrix(M8_CANONICAL_CORRELATION_MATRIX);
  }

  if (!isSquareMatrix(legacyMatrix)) {
    throw new Error(`correlationMatrix invalida: se esperaba matriz cuadrada y se recibió ${size}x?`);
  }

  if (size === M8_CANONICAL_CORRELATION_MATRIX.length) {
    return cloneMatrix(legacyMatrix);
  }

  if (size !== M8_LEGACY_CORRELATION_ORDER.length) {
    throw new Error(`correlationMatrix invalida: se esperaba 4x4 o 6x6 y se recibió ${size}x${size}`);
  }

  const expanded = cloneMatrix(M8_CANONICAL_CORRELATION_MATRIX);
  const m8IndexByLegacyIndex = [0, 2, 1, 3] as const;

  for (let i = 0; i < legacyMatrix.length; i += 1) {
    for (let j = 0; j < legacyMatrix.length; j += 1) {
      expanded[m8IndexByLegacyIndex[i]][m8IndexByLegacyIndex[j]] = legacyMatrix[i][j];
    }
  }

  return expanded;
};

export const buildCanonicalM8GeneratorSleeves = (): M8GeneratorParams['sleeves'] => ({
  eq_global: {
    mean_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvGlobalAnnual,
    vol_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvGlobalVolAnnual,
  },
  eq_chile: {
    mean_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvChileAnnual,
    vol_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvChileVolAnnual,
  },
  fi_global: {
    mean_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfGlobalAnnual,
    vol_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfGlobalVolAnnual,
  },
  fi_chile: {
    mean_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfChileRealAnnual,
    vol_annual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfChileVolAnnual,
  },
  usd_liquidity: {
    mean_annual: M8_CANONICAL_CASH_RETURN_ASSUMPTIONS.usd_liquidity_real_annual,
    vol_annual: M8_CANONICAL_CASH_VOLATILITY_ASSUMPTIONS.usd_liquidity_vol_annual,
  },
  clp_cash: {
    mean_annual: M8_CANONICAL_CASH_RETURN_ASSUMPTIONS.clp_cash_real_annual,
    vol_annual: M8_CANONICAL_CASH_VOLATILITY_ASSUMPTIONS.clp_cash_vol_annual,
  },
});

const normalizeLegacyWeights = (
  weights?: M8LegacyPortfolioWeights | null,
): M8LegacyPortfolioWeights | null => {
  if (!weights) return null;
  const rvGlobal = Math.max(0, Number(weights.rvGlobal ?? 0));
  const rfGlobal = Math.max(0, Number(weights.rfGlobal ?? 0));
  const rvChile = Math.max(0, Number(weights.rvChile ?? 0));
  const rfChile = Math.max(0, Number(weights.rfChile ?? 0));
  const total = rvGlobal + rfGlobal + rvChile + rfChile;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return {
    rvGlobal: rvGlobal / total,
    rfGlobal: rfGlobal / total,
    rvChile: rvChile / total,
    rfChile: rfChile / total,
  };
};

export const buildCanonicalM8PortfolioMix = (
  legacyWeights?: M8LegacyPortfolioWeights | null,
  operationalWeights?: M8OperationalWeights,
): M8PortfolioMix => {
  const normalizedLegacy = normalizeLegacyWeights(legacyWeights);
  const base = normalizedLegacy
    ? {
        eq_global: normalizedLegacy.rvGlobal,
        eq_chile: normalizedLegacy.rvChile,
        fi_global: normalizedLegacy.rfGlobal,
        fi_chile: normalizedLegacy.rfChile,
        usd_liquidity: 0,
        clp_cash: 0,
      }
    : { ...M8_CANONICAL_PORTFOLIO_MIX };

  const hasOverlay =
    !!operationalWeights &&
    (operationalWeights.usd_liquidity > 0 || operationalWeights.clp_cash > 0);

  const raw = hasOverlay
    ? {
        ...base,
        usd_liquidity: operationalWeights.usd_liquidity,
        clp_cash: operationalWeights.clp_cash,
      }
    : base;

  const total = Object.values(raw).reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('M8 portfolio mix invalido: total debe ser > 0');
  }

  return {
    eq_global: raw.eq_global / total,
    eq_chile: raw.eq_chile / total,
    fi_global: raw.fi_global / total,
    fi_chile: raw.fi_chile / total,
    usd_liquidity: raw.usd_liquidity / total,
    clp_cash: raw.clp_cash / total,
  };
};
