import type { QualityOfLifeMetricsV1 } from './types';

export type QualityOfLifeKpiStatus = 'green' | 'yellow' | 'red' | 'neutral';

export type QualityOfLifeKpiThreshold = {
  status: QualityOfLifeKpiStatus;
  label: 'Bueno' | 'Atencion' | 'Critico' | 'Informativo';
  explanation: string;
  isInformationalOnly?: boolean;
};

export type QualityOfLifePrimaryKpiId =
  | 'csr85_4'
  | 'qualitySurvivalRate'
  | 'averageEffectiveSpendingRatio'
  | 'severeCutYearsMean'
  | 'terminalWealthRatio';

const informationalThreshold = (explanation: string): QualityOfLifeKpiThreshold => ({
  status: 'neutral',
  label: 'Informativo',
  explanation,
  isInformationalOnly: true,
});

export function resolveQualityOfLifeKpiThreshold(
  kpiId: QualityOfLifePrimaryKpiId,
  metrics: Pick<
    QualityOfLifeMetricsV1,
    'csr85_4' | 'qualitySurvivalRate' | 'averageEffectiveSpendingRatio' | 'severeCutYearsMean' | 'monthsBelow85' | 'terminalWealthRatio'
  >,
): QualityOfLifeKpiThreshold {
  if (kpiId === 'csr85_4') {
    const value = metrics.csr85_4;
    if (!Number.isFinite(value)) return informationalThreshold('No hay dato suficiente para clasificar este KPI.');
    if ((value as number) >= 0.8) return { status: 'green', label: 'Bueno', explanation: 'La mayoría de trayectorias sostiene una calidad de vida mínima aceptable.' };
    if ((value as number) >= 0.65) return { status: 'yellow', label: 'Atencion', explanation: 'La simulación logra calidad mínima aceptable, pero con margen todavía exigido.' };
    return { status: 'red', label: 'Critico', explanation: 'Pocas trayectorias logran sostener una calidad de vida mínima aceptable.' };
  }

  if (kpiId === 'qualitySurvivalRate') {
    const value = metrics.qualitySurvivalRate;
    if (!Number.isFinite(value)) return informationalThreshold('No hay dato suficiente para clasificar este KPI.');
    if ((value as number) >= 0.5) return { status: 'green', label: 'Bueno', explanation: 'La simulación supera un filtro estricto de calidad en una fracción alta de trayectorias.' };
    if ((value as number) >= 0.25) return { status: 'yellow', label: 'Atencion', explanation: 'El filtro estricto de calidad todavía deja una zona exigida a revisar.' };
    return { status: 'red', label: 'Critico', explanation: 'Muy pocas trayectorias pasan el filtro estricto de calidad; es una alerta de fragilidad.' };
  }

  if (kpiId === 'averageEffectiveSpendingRatio') {
    const value = metrics.averageEffectiveSpendingRatio;
    if (!Number.isFinite(value)) return informationalThreshold('No hay dato suficiente para clasificar este KPI.');
    if ((value as number) >= 0.97) return { status: 'green', label: 'Bueno', explanation: 'El gasto efectivo promedio se mantiene muy cerca del objetivo.' };
    if ((value as number) >= 0.93) return { status: 'yellow', label: 'Atencion', explanation: 'El gasto promedio se sostiene razonablemente, pero ya muestra recortes visibles.' };
    return { status: 'red', label: 'Critico', explanation: 'El gasto promedio cae demasiado respecto del objetivo.' };
  }

  if (kpiId === 'severeCutYearsMean') {
    const years = Number.isFinite(metrics.severeCutYearsMean)
      ? (metrics.severeCutYearsMean as number)
      : Number.isFinite(metrics.monthsBelow85)
        ? (metrics.monthsBelow85 as number) / 12
        : null;
    if (!Number.isFinite(years)) return informationalThreshold('No hay dato suficiente para clasificar este KPI.');
    if ((years as number) <= 1) return { status: 'green', label: 'Bueno', explanation: 'El tiempo promedio en recorte severo se mantiene bajo.' };
    if ((years as number) <= 3) return { status: 'yellow', label: 'Atencion', explanation: 'El tiempo promedio en recorte severo ya exige revisión, aunque todavía no es extremo.' };
    return { status: 'red', label: 'Critico', explanation: 'La simulación pasa demasiado tiempo promedio en recorte severo.' };
  }

  const terminalRatio = metrics.terminalWealthRatio;
  if (!Number.isFinite(terminalRatio)) {
    return informationalThreshold('Sirve como referencia de margen terminal, no como decisión aislada.');
  }
  const severeCutYears = Number.isFinite(metrics.severeCutYearsMean)
    ? (metrics.severeCutYearsMean as number)
    : Number.isFinite(metrics.monthsBelow85)
      ? (metrics.monthsBelow85 as number) / 12
      : null;
  if ((terminalRatio as number) < 0.5) {
    return { status: 'red', label: 'Critico', explanation: 'El margen terminal es muy bajo y puede señalar poca holgura al cierre del horizonte.' };
  }
  if ((terminalRatio as number) > 2 && Number.isFinite(severeCutYears) && (severeCutYears as number) > 1) {
    return { status: 'yellow', label: 'Atencion', explanation: 'Hay margen terminal alto junto con recortes relevantes; puede haber subuso del patrimonio.' };
  }
  return informationalThreshold('Ayuda a detectar subuso o margen terminal, pero no se interpreta solo.');
}
