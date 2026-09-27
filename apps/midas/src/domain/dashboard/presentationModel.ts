export type PresentationScenarioId = 'favorable' | 'evaluado' | 'adverso';
export type PresentationTone = 'positive' | 'warning' | 'negative' | 'neutral';
export type PresentationStatus = 'ready' | 'loading' | 'empty' | 'partial' | 'error';

export type MidasPresentationViewModel = {
  status: PresentationStatus;
  horizonYears: number | null;
  completionPct: number | null;
  qualitySurvivalPct: number | null;
  severeCutYearsMean: number | null;
  qualityTone: PresentationTone | null;
  severeCutsTone: PresentationTone | null;
  scenarios: Array<{ id: PresentationScenarioId; label: string; completionPct: number | null }>;
  fragility: 'quality' | 'severe-cuts' | 'none' | 'unavailable';
  conclusions: { duration: string; quality: string; fragility: string };
};

export type BuildMidasPresentationInput = {
  status: PresentationStatus;
  horizonYears: unknown;
  completionRate: unknown;
  qualitySurvivalRate: unknown;
  severeCutYearsMean: unknown;
  qualityTone: PresentationTone | null;
  severeCutsTone: PresentationTone | null;
  scenarios: ReadonlyArray<{ id: 'optimistic' | 'base' | 'pessimistic'; success: unknown }>;
};

const finite = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const pct = (value: unknown): number | null => {
  const rate = finite(value);
  if (rate === null) return null;
  return Math.max(0, Math.min(1, rate)) * 100;
};

export function buildMidasPresentationModel(input: BuildMidasPresentationInput): MidasPresentationViewModel {
  const horizonYears = finite(input.horizonYears);
  const completionPct = pct(input.completionRate);
  const qualitySurvivalPct = pct(input.qualitySurvivalRate);
  const severeCutYearsMean = finite(input.severeCutYearsMean);
  const scenariosById = new Map(input.scenarios.map((scenario) => [scenario.id, pct(scenario.success)]));
  const scenarios: MidasPresentationViewModel['scenarios'] = [
    { id: 'favorable', label: 'Favorable', completionPct: scenariosById.get('optimistic') ?? null },
    { id: 'evaluado', label: 'Evaluado', completionPct: scenariosById.get('base') ?? completionPct },
    { id: 'adverso', label: 'Adverso', completionPct: scenariosById.get('pessimistic') ?? null },
  ];

  const hasQuality = qualitySurvivalPct !== null;
  const hasCuts = severeCutYearsMean !== null;
  const fragility: MidasPresentationViewModel['fragility'] = !hasQuality && !hasCuts
    ? 'unavailable'
    : input.qualityTone === 'negative'
      ? 'quality'
      : input.severeCutsTone === 'negative'
        ? 'severe-cuts'
        : input.qualityTone === 'warning'
          ? 'quality'
          : input.severeCutsTone === 'warning'
            ? 'severe-cuts'
            : 'none';

  const qualityConclusion = input.qualityTone === 'positive'
    ? 'El filtro estricto de calidad de MIDAS se supera en una fracción alta de trayectorias.'
    : input.qualityTone === 'warning'
      ? 'El filtro estricto de calidad todavía deja una zona exigida a revisar.'
      : input.qualityTone === 'negative'
        ? 'Pocas trayectorias pasan el filtro estricto de calidad definido por MIDAS.'
        : 'La lectura de calidad de vida no está disponible en este resultado.';
  const cutsConclusion = input.severeCutsTone === 'positive'
    ? 'Los recortes fuertes ocupan poco tiempo en promedio.'
    : input.severeCutsTone === 'warning'
      ? 'El tiempo en recortes fuertes requiere atención.'
      : input.severeCutsTone === 'negative'
        ? 'El resultado pasa demasiado tiempo en recortes fuertes.'
        : 'El tiempo en recortes fuertes no está disponible.';

  return {
    status: input.status,
    horizonYears: horizonYears === null ? null : Math.round(horizonYears),
    completionPct,
    qualitySurvivalPct,
    severeCutYearsMean,
    qualityTone: input.qualityTone,
    severeCutsTone: input.severeCutsTone,
    scenarios,
    fragility,
    conclusions: {
      duration: completionPct === null
        ? 'La probabilidad de completar el horizonte sin agotamiento no está disponible.'
        : 'La sostenibilidad indica cuántas trayectorias completan el mismo horizonte sin agotamiento.',
      quality: `${qualityConclusion} ${cutsConclusion}`,
      fragility: fragility === 'quality'
        ? 'La calidad de vida es la fragilidad principal que muestran los indicadores disponibles.'
        : fragility === 'severe-cuts'
          ? 'La duración de los recortes fuertes es la fragilidad principal que muestran los indicadores disponibles.'
          : fragility === 'none'
            ? 'El resultado no muestra una fragilidad dominante con los indicadores disponibles.'
            : 'El resultado no permite identificar una fragilidad dominante.',
    },
  };
}
