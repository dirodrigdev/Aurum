import {
  M8_CANONICAL_LEGACY_CORRELATION_MATRIX,
  M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS,
} from '../simulation/m8Calibration';

export interface EconomicAssumptions {
  rvGlobalAnnual: number;
  rfGlobalAnnual: number;
  rvChileAnnual: number;
  rfChileRealAnnual: number;
  rvGlobalVolAnnual: number;
  rfGlobalVolAnnual: number;
  rvChileVolAnnual: number;
  rfChileVolAnnual: number;
  ipcChileAnnual: number;
  hicpEuroAnnual: number;
  clpUsdDriftAnnual: number;
  eurUsdDriftAnnual: number;
  tcrealLT: number;
  mrHalfLifeYears: number;
  correlationMatrix: number[][];
}

// Capa economica comun para Motor 1 y Motor 2.
// La comparacion metodologica entre motores debe cambiar la capa estadistica,
// no los supuestos base de retornos, inflacion, FX o correlaciones.
export const BASE_ECONOMIC_ASSUMPTIONS: EconomicAssumptions = {
  rvGlobalAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvGlobalAnnual,
  rfGlobalAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfGlobalAnnual,
  rvChileAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvChileAnnual,
  rfChileRealAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfChileRealAnnual,
  rvGlobalVolAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvGlobalVolAnnual,
  rfGlobalVolAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfGlobalVolAnnual,
  rvChileVolAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvChileVolAnnual,
  rfChileVolAnnual: M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfChileVolAnnual,
  ipcChileAnnual: 0.0378,
  hicpEuroAnnual: 0.0213,
  clpUsdDriftAnnual: 0.020,
  eurUsdDriftAnnual: 0.0076,
  tcrealLT: 640.0,
  mrHalfLifeYears: 6.3,
  correlationMatrix: M8_CANONICAL_LEGACY_CORRELATION_MATRIX.map((row) => row.slice()),
};
