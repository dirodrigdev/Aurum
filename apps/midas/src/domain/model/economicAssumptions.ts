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
  rvGlobalAnnual: 0.065,
  rfGlobalAnnual: 0.0305,
  rvChileAnnual: 0.075,
  rfChileRealAnnual: 0.0102,
  rvGlobalVolAnnual: 0.1532,
  rfGlobalVolAnnual: 0.0368,
  rvChileVolAnnual: 0.1141,
  rfChileVolAnnual: 0.0237,
  ipcChileAnnual: 0.0378,
  hicpEuroAnnual: 0.0213,
  clpUsdDriftAnnual: 0.020,
  eurUsdDriftAnnual: 0.0076,
  tcrealLT: 640.0,
  mrHalfLifeYears: 6.3,
  correlationMatrix: [
    [1.00, 0.15, 0.69, 0.32],
    [0.15, 1.00, 0.33, 0.33],
    [0.69, 0.33, 1.00, 0.23],
    [0.32, 0.33, 0.23, 1.00],
  ],
};
