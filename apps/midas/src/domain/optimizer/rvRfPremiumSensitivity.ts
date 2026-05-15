import type { ModelParameters } from '../model/types';
import type { QualityOptimizationCandidate } from './qualityRanking';
import { compareQualityOptimizationCandidates } from './qualityRanking';

export type RvRfPremiumSensitivityScenario = {
  id: 'base' | 'rv_plus_3' | 'rv_plus_6' | 'rv_plus_10' | 'rv_plus_6_rf_minus_1';
  label: string;
  rvAnnualDelta: number;
  rfAnnualDelta: number;
  warning: string | null;
};

export type RvRfPremiumSensitivityWinner = {
  winner: QualityOptimizationCandidate | null;
  warnings: string[];
};

export const RV_RF_PREMIUM_SENSITIVITY_SCENARIOS: RvRfPremiumSensitivityScenario[] = [
  { id: 'base', label: 'Base', rvAnnualDelta: 0, rfAnnualDelta: 0, warning: null },
  { id: 'rv_plus_3', label: 'RV +3pp real', rvAnnualDelta: 0.03, rfAnnualDelta: 0, warning: 'Sensibilidad no oficial: solo aumenta retornos esperados de RV.' },
  { id: 'rv_plus_6', label: 'RV +6pp real', rvAnnualDelta: 0.06, rfAnnualDelta: 0, warning: 'Sensibilidad no oficial: solo aumenta retornos esperados de RV.' },
  { id: 'rv_plus_10', label: 'RV +10pp real', rvAnnualDelta: 0.10, rfAnnualDelta: 0, warning: 'Sensibilidad no oficial: solo aumenta retornos esperados de RV.' },
  { id: 'rv_plus_6_rf_minus_1', label: 'RV +6pp / RF -1pp', rvAnnualDelta: 0.06, rfAnnualDelta: -0.01, warning: 'Sensibilidad no oficial: aumenta RV y reduce RF solo para diagnóstico.' },
];

export function applyRvRfPremiumSensitivity(
  params: ModelParameters,
  scenario: RvRfPremiumSensitivityScenario,
): { params: ModelParameters; warnings: string[] } {
  const next = JSON.parse(JSON.stringify(params)) as ModelParameters;
  next.returns = {
    ...next.returns,
    rvGlobalAnnual: next.returns.rvGlobalAnnual + scenario.rvAnnualDelta,
    rvChileAnnual: next.returns.rvChileAnnual + scenario.rvAnnualDelta,
    rfGlobalAnnual: next.returns.rfGlobalAnnual + scenario.rfAnnualDelta,
    rfChileUFAnnual: next.returns.rfChileUFAnnual + scenario.rfAnnualDelta,
  };
  return {
    params: next,
    warnings: scenario.warning ? [scenario.warning] : [],
  };
}

export function pickSensitivityWinner(
  candidates: QualityOptimizationCandidate[],
): RvRfPremiumSensitivityWinner {
  const rankable = candidates.filter((candidate) => candidate.qasrStrict !== null);
  if (!rankable.length) {
    return {
      winner: null,
      warnings: ['No hay vía limpia para rankear sensibilidad: faltan métricas de calidad de vida.'],
    };
  }
  const winner = [...rankable].sort(compareQualityOptimizationCandidates)[0] ?? null;
  return { winner, warnings: [] };
}

export function explainSensitivityShift(baseRvPct: number | null, sensitivityRvPcts: number[]): string {
  if (baseRvPct === null || !sensitivityRvPcts.length) {
    return 'No hay vía limpia para aplicar overrides temporales sin tocar configuración base.';
  }
  const maxRv = Math.max(...sensitivityRvPcts);
  if (maxRv > baseRvPct + 5) {
    return 'El resultado conservador base parece depender fuertemente de la prima RV-RF asumida.';
  }
  return 'Incluso con mayor prima RV, el ranking QoL sigue priorizando estabilidad de consumo. Revisar si QASR/recortes están castigando demasiado la volatilidad.';
}
