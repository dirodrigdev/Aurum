import type { ModelParameters, SpendingPhase } from './types';

export const SPENDING_PHASE_BASE_AMOUNTS_CLP = {
  phase1: 6_000_000,
  phase2: 6_000_000,
  phase3: 3_900_000,
  phase4: 5_400_000,
} as const;

const PHASE1_YEARS = 4; // años 0-3
const PHASE2_YEARS = 16; // años 4-20 (convención interna 1-based)
const PHASE4_YEARS = 5; // últimos 5 años

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const buildFixedSpendingDurations = (
  horizonMonths: number,
): [number, number, number, number] => {
  if (!Number.isInteger(horizonMonths) || horizonMonths <= 0) {
    throw new Error('simulation.horizonMonths debe ser entero positivo para construir tramos de gasto');
  }
  if (horizonMonths % 12 !== 0) {
    throw new Error('simulation.horizonMonths debe ser múltiplo de 12 para construir tramos anuales');
  }

  const horizonYears = horizonMonths / 12;
  let phase1Years = PHASE1_YEARS;
  let phase2Years = PHASE2_YEARS;
  let phase4Years = PHASE4_YEARS;
  let phase3Years = horizonYears - phase1Years - phase2Years - phase4Years;

  // Para horizontes cortos legacy, comprimimos manteniendo 4 tramos positivos.
  if (phase3Years <= 0) {
    phase1Years = Math.min(PHASE1_YEARS, Math.max(1, Math.floor(horizonYears * 0.2)));
    const remAfterPhase1 = Math.max(3, horizonYears - phase1Years);
    phase4Years = Math.min(PHASE4_YEARS, Math.max(1, Math.floor(remAfterPhase1 * 0.2)));
    const remMiddle = Math.max(2, horizonYears - phase1Years - phase4Years);
    phase2Years = Math.max(1, Math.floor(remMiddle / 2));
    phase3Years = Math.max(1, remMiddle - phase2Years);
  }

  const totalYears = phase1Years + phase2Years + phase3Years + phase4Years;
  if (totalYears !== horizonYears) {
    phase3Years += horizonYears - totalYears;
  }

  if (phase1Years < 1 || phase2Years < 1 || phase3Years < 1 || phase4Years < 1) {
    throw new Error('No se pudo asignar 4 tramos válidos para el horizonte configurado');
  }

  return [
    phase1Years * 12,
    phase2Years * 12,
    phase3Years * 12,
    phase4Years * 12,
  ];
};

const normalizePhaseAmount = (phase: SpendingPhase | undefined, fallbackAmount: number, eurToClp: number): number => {
  if (!phase || !isFinitePositive(phase.amountReal)) return fallbackAmount;
  if (phase.currency === 'EUR') return phase.amountReal * eurToClp;
  return phase.amountReal;
};

export const normalizeSpendingPhasesToFour = (
  phases: SpendingPhase[] | undefined,
  horizonMonths: number,
  eurToClp: number,
): SpendingPhase[] => {
  const [phase1Months, phase2Months, phase3Months, phase4Months] = buildFixedSpendingDurations(horizonMonths);

  const phaseList = Array.isArray(phases) ? phases : [];

  // Compatibilidad legacy 3 fases:
  // - Tramo 1 conserva fase 1 legacy
  // - Tramo 2 replica fase 1 legacy (6MM en modelo actual)
  // - Tramo 3 toma fase 2 legacy
  // - Tramo 4 toma fase 3 legacy
  const migratedFromLegacy = phaseList.length === 3
    ? [phaseList[0], phaseList[0], phaseList[1], phaseList[2]]
    : phaseList;

  return [
    {
      durationMonths: phase1Months,
      amountReal: normalizePhaseAmount(migratedFromLegacy[0], SPENDING_PHASE_BASE_AMOUNTS_CLP.phase1, eurToClp),
      currency: 'CLP',
    },
    {
      durationMonths: phase2Months,
      amountReal: normalizePhaseAmount(migratedFromLegacy[1], SPENDING_PHASE_BASE_AMOUNTS_CLP.phase2, eurToClp),
      currency: 'CLP',
    },
    {
      durationMonths: phase3Months,
      amountReal: normalizePhaseAmount(migratedFromLegacy[2], SPENDING_PHASE_BASE_AMOUNTS_CLP.phase3, eurToClp),
      currency: 'CLP',
    },
    {
      durationMonths: phase4Months,
      amountReal: normalizePhaseAmount(migratedFromLegacy[3], SPENDING_PHASE_BASE_AMOUNTS_CLP.phase4, eurToClp),
      currency: 'CLP',
    },
  ];
};

export const normalizeModelSpendingPhases = (params: ModelParameters): SpendingPhase[] => {
  const eurToClp = (params.fx?.clpUsdInitial ?? 1) * (params.fx?.usdEurFixed ?? 1);
  return normalizeSpendingPhasesToFour(params.spendingPhases, params.simulation.horizonMonths, eurToClp);
};

export type SpendingPhaseUiLabel = {
  title: string;
  subtitle?: string;
};

export const buildSpendingPhaseUiLabels = (
  phases: SpendingPhase[],
): SpendingPhaseUiLabel[] => {
  const boundaries = phases.reduce<number[]>((acc, phase) => {
    const prev = acc.length ? acc[acc.length - 1] : 0;
    acc.push(prev + Math.round(phase.durationMonths / 12));
    return acc;
  }, []);

  const phase2End = boundaries[1] ?? 20;
  const phase3End = boundaries[2] ?? (phase2End + 15);

  return [
    { title: 'Tramo 1 (años 0–3)' },
    { title: `Tramo 2 (años 4–${phase2End})` },
    { title: `Tramo 3 (años ${phase2End + 1}–${phase3End})` },
    { title: 'Tramo 4 (últimos 5 años)' },
  ];
};
