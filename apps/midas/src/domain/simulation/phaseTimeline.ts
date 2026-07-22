export type M8PhaseEndYears = {
  phase1EndYear: number;
  phase2EndYear: number;
  phase3EndYear: number;
};

export type M8PhaseBoundary = {
  phaseIndex: 1 | 2 | 3 | 4;
  startMonth: number;
  endMonth: number;
};

export const buildM8PhaseBoundaries = (
  horizonMonths: number,
  phaseEndYears: M8PhaseEndYears,
): [M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary] => {
  if (!Number.isInteger(horizonMonths) || horizonMonths <= 0) {
    throw new Error('horizonMonths debe ser entero positivo');
  }

  const endMonths = [
    phaseEndYears.phase1EndYear * 12,
    phaseEndYears.phase2EndYear * 12,
    phaseEndYears.phase3EndYear * 12,
    horizonMonths,
  ];
  let startMonth = 1;
  const boundaries = endMonths.map((endMonth, index) => {
    if (!Number.isInteger(endMonth) || endMonth < startMonth || endMonth > horizonMonths) {
      throw new Error('Las fronteras M8 deben ser enteras, crecientes y estar dentro del horizonte');
    }
    const boundary = {
      phaseIndex: (index + 1) as 1 | 2 | 3 | 4,
      startMonth,
      endMonth,
    };
    startMonth = endMonth + 1;
    return boundary;
  });

  if (startMonth !== horizonMonths + 1) {
    throw new Error('Las fronteras M8 no cubren exactamente el horizonte');
  }

  return boundaries as [M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary];
};

export const buildM8PhaseBoundariesFromDurations = (
  horizonMonths: number,
  durationsMonths: readonly [number, number, number, number],
): [M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary] => {
  const boundaries: M8PhaseBoundary[] = [];
  let startMonth = 1;
  for (const [index, durationMonths] of durationsMonths.entries()) {
    if (!Number.isInteger(durationMonths) || durationMonths <= 0) {
      throw new Error('Las duraciones de fase deben ser enteros positivos');
    }
    const endMonth = startMonth + durationMonths - 1;
    boundaries.push({
      phaseIndex: (index + 1) as 1 | 2 | 3 | 4,
      startMonth,
      endMonth,
    });
    startMonth = endMonth + 1;
  }
  if (startMonth !== horizonMonths + 1) {
    throw new Error('Las duraciones de fase no cubren exactamente el horizonte');
  }
  return boundaries as [M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary, M8PhaseBoundary];
};

export const resolveM8PhaseIndex = (
  monthIndex: number,
  phaseEndYears: M8PhaseEndYears,
): 1 | 2 | 3 | 4 => {
  const yearIndex = Math.floor((monthIndex - 1) / 12) + 1;
  if (yearIndex <= phaseEndYears.phase1EndYear) return 1;
  if (yearIndex <= phaseEndYears.phase2EndYear) return 2;
  if (yearIndex <= phaseEndYears.phase3EndYear) return 3;
  return 4;
};
