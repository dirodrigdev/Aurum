import React from 'react';
import type { MidasEvaluationV1, QualityOfLifeMetricsV1 } from '../domain/model/types';
import { resolveQualityOfLifeKpiThreshold } from '../domain/model/qualityOfLifeKpiThresholds';
import { T, css } from './theme';
import { InfoHint } from './InfoHint';

type TrafficLight = 'green' | 'yellow' | 'red' | 'neutral';

const TRAFFIC_COLORS: Record<TrafficLight, string> = {
  green: '#32c97b',
  yellow: '#f4b740',
  red: '#ff6a6a',
  neutral: '#71829b',
};

const pickTraffic = (
  value: number | null | undefined,
  rules: { greenMin?: number; yellowMin?: number; greenMax?: number; yellowMax?: number },
): TrafficLight => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'neutral';
  if (rules.greenMin !== undefined) {
    if (value >= rules.greenMin) return 'green';
    if (rules.yellowMin !== undefined && value >= rules.yellowMin) return 'yellow';
    return 'red';
  }
  if (rules.greenMax !== undefined) {
    if (value <= rules.greenMax) return 'green';
    if (rules.yellowMax !== undefined && value <= rules.yellowMax) return 'yellow';
    return 'red';
  }
  return 'neutral';
};

const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'No disponible'
    : `${Math.round(value * 100)}%`;

const formatQasr = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'No disponible'
    : `${Math.round(value * 100)}/100`;

const formatScore = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'No disponible'
    : `${Math.round(value)}/100`;

const formatRatio = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'No disponible'
    : `${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

const formatMonths = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No disponible';
  if (Math.abs(value) <= 6) return `${Math.round(value)} meses`;
  const years = value / 12;
  return `${Math.round(value)} meses / ${years.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} años`;
};

const formatMoney = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No disponible';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 0 })}MM`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}MM`;
  }
  return `$${value.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;
};

const formatPhaseStress = (
  phases: QualityOfLifeMetricsV1['phaseStress'] | null | undefined,
): string => {
  if (!phases || phases.length === 0) return 'No disponible';
  return phases
    .map((phase) => `${phase.label} ${formatMonths(phase.monthsBelow85)}`)
    .join(' · ');
};

const metricInfo = {
  evaluation: [
    'Evaluación MIDAS preliminar',
    '',
    'Que mide:',
    'Resume no-ruina, calidad de vida, estrés temprano, continuidad del estrés y margen terminal usando solo métricas ya auditadas.',
    '',
    'Cómo leerlo:',
    'Es una clasificación descriptiva y auditable. No reemplaza el análisis técnico ni el MIDAS Score final.',
  ].join('\n'),
  csr: [
    'Éxito con calidad de vida (CSR-85/4)',
    '',
    'Que mide:',
    'Mide cuántas simulaciones logran sostener una vida razonable: sin ruina, con consumo promedio de al menos 85% del objetivo y sin más de 4 años de recorte severo.',
    '',
    'Cómo leerlo:',
    'Mientras más alto, mejor. Es más exigente que la probabilidad clásica de no ruina.',
    '',
    'Ejemplo aplicado:',
    'Si marca 82%, significa que en 82 de cada 100 escenarios simulados el patrimonio permite mantener una calidad de vida razonable bajo estas reglas.',
  ].join('\n'),
  qasrStrict: [
    'Calidad ajustada estricta (QASR)',
    '',
    'Que mide:',
    'Score conservador de calidad de consumo. Los escenarios con ruina cuentan como 0.',
    '',
    'Cómo leerlo:',
    'Un valor alto indica que el consumo se mantiene cerca del objetivo en la mayoría de escenarios, castigando fuerte los casos de ruina.',
    '',
    'Ejemplo aplicado:',
    'Si marca 78/100, significa que la simulación sostiene una calidad de consumo razonable, pero con fragilidad suficiente como para no considerarla plenamente robusta.',
  ].join('\n'),
  qualityMean: [
    'Calidad media en simulación',
    '',
    'Que mide:',
    'Mide la calidad de consumo observada antes del castigo estricto por ruina.',
    '',
    'Cómo leerlo:',
    'Sirve para entender cómo se comporta el consumo en los meses observados. La referencia conservadora sigue siendo la calidad ajustada estricta (QASR).',
    '',
    'Ejemplo aplicado:',
    'Si esta métrica es alta pero la calidad ajustada estricta es baja, probablemente hay escenarios que consumen bien durante un tiempo, pero terminan en ruina.',
  ].join('\n'),
  severeCutMean: [
    'Que mide:',
    'Mide cuánto tiempo promedio se vive con recortes severos de consumo.',
    '',
    'Cómo leerlo:',
    'Mientras más bajo, mejor. Muchos meses de recorte severo implican pérdida real de calidad de vida.',
    '',
    'Ejemplo aplicado:',
    'Si marca 30 meses, significa que en promedio los escenarios pasan 2 años y medio con recortes importantes de consumo.',
  ].join('\n'),
  severeCutP75: [
    'Que mide:',
    'Mide una racha severa en un escenario exigente, usando el percentil 75.',
    '',
    'Cómo leerlo:',
    'No es lo mismo tener recortes dispersos que varios meses o años seguidos. Esta métrica mira continuidad del estrés.',
    '',
    'Ejemplo aplicado:',
    'Si marca 36 meses, significa que en escenarios exigentes podrías enfrentar hasta 3 años seguidos de recorte severo.',
  ].join('\n'),
  houseSale: [
    'Que mide:',
    'Mide en cuántos escenarios se usa la casa como activo disponible.',
    '',
    'Cómo leerlo:',
    'No es fracaso. La venta se informa como una decisión económica posible dentro de la simulación.',
    '',
    'Ejemplo aplicado:',
    'Si marca 35%, significa que en 35 de cada 100 escenarios la simulación necesita vender la casa para sostener el plan.',
  ].join('\n'),
  cutBeforeSale: [
    'Recorte severo mientras se vende',
    '',
    'Que mide:',
    'Mide cuántos meses de recorte severo ocurren entre la activación de la venta de casa y la venta efectiva.',
    '',
    'Cómo leerlo:',
    'Mientras más bajo, mejor. No mide si vender es bueno o malo; mide si durante el proceso de venta se deteriora la calidad de vida.',
    'No cuenta todos los recortes históricos previos a la venta.',
    '',
    'Ejemplo aplicado:',
    'Si marca 3 meses, significa que en los escenarios donde se vende la casa hay, típicamente, 3 meses de recorte severo mientras se espera la entrada de liquidez.',
  ].join('\n'),
  terminal: [
    'Patrimonio final',
    '',
    'Que mide:',
    'Mide el margen patrimonial al final del horizonte.',
    '',
    'Cómo leerlo:',
    'Es referencia y desempate, no el objetivo principal. La prioridad es vivir bien durante el horizonte.',
    '',
    'Ejemplo aplicado:',
    'Si el P25 terminal es positivo, significa que en al menos 75% de los escenarios queda patrimonio al final. No significa que debas maximizarlo a costa de calidad de vida.',
  ].join('\n'),
  qualitySurvival: [
    'Supervivencia con calidad',
    '',
    'Que mide:',
    'Mide el porcentaje de escenarios que no caen en ruina, mantienen gasto promedio sobre 90% y no acumulan ni rachas ni meses severos por encima del umbral técnico.',
    '',
    'Cómo leerlo:',
    'Mientras más alto, mejor. Es una lectura preliminar y descriptiva; no es el MIDAS Score final.',
  ].join('\n'),
  stress85: [
    'Meses bajo 85%',
    '',
    'Que mide:',
    'Mide cuántos meses promedio por escenario quedan bajo 85% del gasto objetivo.',
    '',
    'Cómo leerlo:',
    'Mientras más bajo, mejor. Ayuda a distinguir simulaciones sin ruina pero con deterioro sostenido de calidad de vida.',
  ].join('\n'),
  earlyStress: [
    'Estrés temprano',
    '',
    'Que mide:',
    'Cuenta los meses bajo 85% durante los primeros 5 años de la simulación.',
    '',
    'Cómo leerlo:',
    'Mientras más bajo, mejor. Penaliza recortes que aparecen demasiado pronto.',
  ].join('\n'),
  terminalRatio: [
    'Terminal wealth ratio',
    '',
    'Que mide:',
    'Compara el patrimonio terminal mediano contra el capital inicial simulable.',
    '',
    'Cómo leerlo:',
    'Un ratio muy alto con mucho estrés puede sugerir subuso del patrimonio; uno muy bajo puede señalar poca holgura.',
  ].join('\n'),
};

const evaluationTraffic = (label: MidasEvaluationV1['label'] | undefined): TrafficLight => {
  if (label === 'Muy sólido') return 'green';
  if (label === 'Bueno alto' || label === 'Bueno') return 'yellow';
  if (label === 'Exigido' || label === 'Frágil') return 'red';
  return 'neutral';
};

function MetricRow({
  label,
  info,
  value,
  traffic = 'neutral',
  subtle,
}: {
  label: string;
  info?: string;
  value: string;
  traffic?: TrafficLight;
  subtle?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 3, borderBottom: `1px dashed ${T.border}`, paddingBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.textSecondary, fontSize: 11 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: TRAFFIC_COLORS[traffic],
              boxShadow: `0 0 0 2px rgba(0,0,0,0.12) inset`,
            }}
          />
          <span>{label}</span>
          {info ? <InfoHint text={info} /> : null}
        </div>
        <div style={{ ...css.mono, color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>{value}</div>
      </div>
      {subtle ? <div style={{ color: T.textMuted, fontSize: 10 }}>{subtle}</div> : null}
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, background: T.surfaceEl, padding: '10px 12px', display: 'grid', gap: 8 }}>
      <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </div>
  );
}

function PrimaryKpiCard({
  eyebrow,
  label,
  value,
  subtle,
  traffic,
  statusLabel,
  explanation,
}: {
  eyebrow?: string;
  label: string;
  value: string;
  subtle?: string;
  traffic?: TrafficLight;
  statusLabel: string;
  explanation: string;
}) {
  const tone = TRAFFIC_COLORS[traffic ?? 'neutral'];
  return (
    <div
      style={{
        border: `1px solid ${tone}33`,
        borderRadius: 12,
        background: `linear-gradient(180deg, ${tone}12 0%, ${T.surfaceEl} 100%)`,
        padding: '12px 13px',
        display: 'grid',
        gap: 5,
        alignContent: 'start',
      }}
    >
      {eyebrow ? (
        <div style={{ color: tone, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {eyebrow}
        </div>
      ) : null}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifySelf: 'start',
          color: tone,
          background: `${tone}12`,
          border: `1px solid ${tone}33`,
          borderRadius: 999,
          padding: '3px 8px',
          fontSize: 10,
          fontWeight: 800,
          whiteSpace: 'nowrap',
        }}
      >
        {statusLabel}
      </div>
      <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 700 }}>{label}</div>
      <div style={{ color: T.textPrimary, fontSize: 24, fontWeight: 900, lineHeight: 1.05 }}>{value}</div>
      {subtle ? <div style={{ color: T.textSecondary, fontSize: 11, lineHeight: 1.35 }}>{subtle}</div> : null}
      <div style={{ color: T.textMuted, fontSize: 10, lineHeight: 1.35 }}>{explanation}</div>
    </div>
  );
}

export function QualityOfLifeMetricsBlock({
  qualityOfLifeMetrics,
  midasEvaluation,
  isMobile,
}: {
  qualityOfLifeMetrics?: QualityOfLifeMetricsV1;
  midasEvaluation?: MidasEvaluationV1 | null;
  isMobile: boolean;
}) {
  if (!qualityOfLifeMetrics) {
    return (
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, background: T.surface, padding: isMobile ? '9px 10px' : '12px 14px' }}>
        <div style={{ color: T.textPrimary, fontSize: isMobile ? 13 : 14, fontWeight: 800 }}>Calidad de vida simulada</div>
        <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>No disponible para esta simulacion.</div>
      </div>
    );
  }

  const csrTraffic = pickTraffic(qualityOfLifeMetrics.csr85_4, { greenMin: 0.85, yellowMin: 0.7 });
  const qasrTraffic = pickTraffic(qualityOfLifeMetrics.qasrStrict, { greenMin: 0.8, yellowMin: 0.65 });
  const qualityMeanTraffic = pickTraffic(qualityOfLifeMetrics.qualityScoreMean, { greenMin: 0.85, yellowMin: 0.75 });
  const qualitySurvivalTraffic = pickTraffic(qualityOfLifeMetrics.qualitySurvivalRate, { greenMin: 0.8, yellowMin: 0.65 });
  const effectiveSpendingTraffic = pickTraffic(qualityOfLifeMetrics.averageEffectiveSpendingRatio, { greenMin: 0.95, yellowMin: 0.85 });
  const stress85Traffic = pickTraffic(qualityOfLifeMetrics.monthsBelow85, { greenMax: 6, yellowMax: 24 });
  const streak85Traffic = pickTraffic(qualityOfLifeMetrics.maxConsecutiveMonthsBelow85, { greenMax: 3, yellowMax: 6 });
  const earlyStressTraffic = pickTraffic(qualityOfLifeMetrics.earlyStressMonths, { greenMax: 3, yellowMax: 12 });
  const severeCutMeanTraffic = pickTraffic(qualityOfLifeMetrics.monthsInSevereCutMean, { greenMax: 12, yellowMax: 48 });
  const severeCutP75Traffic = pickTraffic(qualityOfLifeMetrics.maxConsecutiveSevereCutMonthsP75, { greenMax: 12, yellowMax: 48 });
  const severeCutYearsTraffic = pickTraffic(qualityOfLifeMetrics.severeCutYearsMean, { greenMax: 1, yellowMax: 4 });
  const severeCutDuringSale = qualityOfLifeMetrics.severeCutMonthsDuringHouseSaleMedian
    ?? qualityOfLifeMetrics.severeCutMonthsDuringHouseSaleMean;
  const severeCutDuringSaleTraffic = pickTraffic(severeCutDuringSale, { greenMax: 1, yellowMax: 6 });
  const csrThreshold = resolveQualityOfLifeKpiThreshold('csr85_4', qualityOfLifeMetrics);
  const strictSurvivalThreshold = resolveQualityOfLifeKpiThreshold('qualitySurvivalRate', qualityOfLifeMetrics);
  const effectiveSpendingThreshold = resolveQualityOfLifeKpiThreshold('averageEffectiveSpendingRatio', qualityOfLifeMetrics);
  const severeCutThreshold = resolveQualityOfLifeKpiThreshold('severeCutYearsMean', qualityOfLifeMetrics);
  const terminalThreshold = resolveQualityOfLifeKpiThreshold('terminalWealthRatio', qualityOfLifeMetrics);

  const shownWarnings = qualityOfLifeMetrics.warnings.slice(0, 3);
  const salesNeutral = 'neutral' as const;

  return (
    <section
      style={{
        order: 8,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        background: T.surface,
        padding: isMobile ? '10px 10px' : '12px 14px',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ color: T.textPrimary, fontSize: isMobile ? 13 : 14, fontWeight: 800 }}>
          Calidad de vida simulada
        </div>
        <div style={{ color: T.textMuted, fontSize: 11 }}>
          Mide no solo si el patrimonio dura, sino si permite mantener un nivel de vida razonable.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Qué mirar primero</div>
          <div style={{ color: T.textMuted, fontSize: 11 }}>
            Estos son los indicadores principales para leer calidad de vida antes de entrar al detalle técnico.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, minmax(0,1fr))', gap: 8 }}>
          <PrimaryKpiCard
            eyebrow="KPI principal"
            label="Éxito con calidad de vida"
            value={formatPercent(qualityOfLifeMetrics.csr85_4)}
            subtle="CSR-85/4"
            traffic={csrThreshold.status}
            statusLabel={csrThreshold.label}
            explanation={csrThreshold.explanation}
          />
          <PrimaryKpiCard
            label="Supervivencia con calidad estricta"
            value={formatPercent(qualityOfLifeMetrics.qualitySurvivalRate)}
            subtle="Escenarios sin ruina y sin deterioro prolongado."
            traffic={strictSurvivalThreshold.status}
            statusLabel={strictSurvivalThreshold.label}
            explanation={strictSurvivalThreshold.explanation}
          />
          <PrimaryKpiCard
            label="Consumo efectivo promedio"
            value={formatPercent(qualityOfLifeMetrics.averageEffectiveSpendingRatio)}
            subtle={`P25 / P50 ${formatPercent(qualityOfLifeMetrics.averageConsumptionRatioP25)} · ${formatPercent(qualityOfLifeMetrics.averageConsumptionRatioP50)}`}
            traffic={effectiveSpendingThreshold.status}
            statusLabel={effectiveSpendingThreshold.label}
            explanation={effectiveSpendingThreshold.explanation}
          />
          <PrimaryKpiCard
            label="Tiempo en recorte severo"
            value={qualityOfLifeMetrics.severeCutYearsMean === null || qualityOfLifeMetrics.severeCutYearsMean === undefined || !Number.isFinite(qualityOfLifeMetrics.severeCutYearsMean)
              ? 'No disponible'
              : `${qualityOfLifeMetrics.severeCutYearsMean.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} años`}
            subtle={`Meses bajo 85%: ${formatMonths(qualityOfLifeMetrics.monthsBelow85)}`}
            traffic={severeCutThreshold.status}
            statusLabel={severeCutThreshold.label}
            explanation={severeCutThreshold.explanation}
          />
          <PrimaryKpiCard
            label="Patrimonio final mediano"
            value={formatRatio(qualityOfLifeMetrics.terminalWealthRatio)}
            subtle="Patrimonio final mediano / capital inicial."
            traffic={terminalThreshold.status}
            statusLabel={terminalThreshold.label}
            explanation={terminalThreshold.explanation}
          />
        </div>
      </div>

      <details
        style={{ border: `1px solid ${T.border}`, borderRadius: 12, background: T.surfaceEl, padding: isMobile ? '8px 10px' : '10px 12px' }}
      >
        <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>Detalle de recortes y fases</span>
          <span style={{ color: T.textMuted, fontSize: 11 }}>Abrir detalle</span>
        </summary>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          <Group title="Evaluación MIDAS preliminar">
          <MetricRow
            label="Clasificación"
            info={metricInfo.evaluation}
            value={midasEvaluation?.label ?? 'No disponible'}
            traffic={evaluationTraffic(midasEvaluation?.label)}
            subtle={midasEvaluation?.capsApplied[0] ?? midasEvaluation?.alerts[0]}
          />
          <MetricRow
            label="Score preliminar"
            value={formatScore(midasEvaluation?.cappedScore ?? midasEvaluation?.rawScore)}
            traffic={evaluationTraffic(midasEvaluation?.label)}
            subtle={midasEvaluation?.rawScore != null && midasEvaluation?.cappedScore != null
              ? `raw ${formatScore(midasEvaluation.rawScore)}`
              : undefined}
          />
          <MetricRow
            label="Comparabilidad"
            value={
              !midasEvaluation
                ? 'No disponible'
                : midasEvaluation.isComparable
                  ? `Comparable · ${midasEvaluation.confidenceBand}`
                  : 'No comparable'
            }
            traffic={!midasEvaluation ? 'neutral' : midasEvaluation.isComparable ? 'green' : 'red'}
            subtle={midasEvaluation?.warnings[0]}
          />
          </Group>

          <Group title="Lectura principal">
            <MetricRow label="Éxito con calidad de vida (CSR-85/4)" info={metricInfo.csr} value={formatPercent(qualityOfLifeMetrics.csr85_4)} traffic={csrTraffic} />
            <MetricRow label="Supervivencia con calidad estricta" info={metricInfo.qualitySurvival} value={formatPercent(qualityOfLifeMetrics.qualitySurvivalRate)} traffic={qualitySurvivalTraffic} />
            <MetricRow label="Calidad ajustada estricta (QASR)" info={metricInfo.qasrStrict} value={formatQasr(qualityOfLifeMetrics.qasrStrict)} traffic={qasrTraffic} />
            <MetricRow label="Calidad media en simulación" info={metricInfo.qualityMean} value={formatQasr(qualityOfLifeMetrics.qualityScoreMean)} traffic={qualityMeanTraffic} />
          </Group>

          <Group title="Recortes">
            <MetricRow label="Meses bajo 85%" info={metricInfo.stress85} value={formatMonths(qualityOfLifeMetrics.monthsBelow85)} traffic={stress85Traffic} />
            <MetricRow label="Racha bajo 85% P75" value={formatMonths(qualityOfLifeMetrics.maxConsecutiveMonthsBelow85)} traffic={streak85Traffic} />
            <MetricRow label="Estrés temprano (años 1-5)" info={metricInfo.earlyStress} value={formatMonths(qualityOfLifeMetrics.earlyStressMonths)} traffic={earlyStressTraffic} />
            <MetricRow label="Recorte severo promedio" info={metricInfo.severeCutMean} value={formatMonths(qualityOfLifeMetrics.monthsInSevereCutMean)} traffic={severeCutMeanTraffic} />
            <MetricRow label="Racha severa P75" info={metricInfo.severeCutP75} value={formatMonths(qualityOfLifeMetrics.maxConsecutiveSevereCutMonthsP75)} traffic={severeCutP75Traffic} />
            <MetricRow
              label="Consumo efectivo promedio"
              value={formatPercent(qualityOfLifeMetrics.averageEffectiveSpendingRatio)}
              traffic={effectiveSpendingTraffic}
            />
            <MetricRow
              label="Consumo promedio P25 / P50"
              value={`${formatPercent(qualityOfLifeMetrics.averageConsumptionRatioP25)} · ${formatPercent(qualityOfLifeMetrics.averageConsumptionRatioP50)}`}
              traffic="neutral"
            />
            <MetricRow label="Estrés por fase (<85%)" value={formatPhaseStress(qualityOfLifeMetrics.phaseStress)} traffic="neutral" />
          </Group>

          <Group title="Casa">
            <MetricRow label="Probabilidad de venta de casa" info={metricInfo.houseSale} value={formatPercent(qualityOfLifeMetrics.houseSaleRate)} traffic={salesNeutral} />
            <MetricRow label="Venta mediana" value={qualityOfLifeMetrics.houseSaleYearMedian === null ? 'No disponible' : `año ${qualityOfLifeMetrics.houseSaleYearMedian.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`} traffic={salesNeutral} />
            <MetricRow label="Recorte severo mientras se vende" info={metricInfo.cutBeforeSale} value={formatMonths(severeCutDuringSale)} traffic={severeCutDuringSaleTraffic} />
          </Group>

          <Group title="Margen terminal">
            <MetricRow label="Patrimonio final P25" info={metricInfo.terminal} value={formatMoney(qualityOfLifeMetrics.terminalWealthP25)} traffic="neutral" />
            <MetricRow label="Patrimonio final P50" value={formatMoney(qualityOfLifeMetrics.terminalWealthP50)} traffic="neutral" />
            <MetricRow label="Patrimonio final mediano / capital inicial" info={metricInfo.terminalRatio} value={formatRatio(qualityOfLifeMetrics.terminalWealthRatio)} traffic="neutral" />
            <div style={{ color: T.textMuted, fontSize: 10 }}>Referencia, no objetivo principal.</div>
          </Group>
        </div>
      </details>

      {shownWarnings.length > 0 ? (
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Nota: algunos escenarios terminan antes del horizonte por ruina; por eso ciertas métricas de consumo usan datos parciales.
        </div>
      ) : null}
    </section>
  );
}
