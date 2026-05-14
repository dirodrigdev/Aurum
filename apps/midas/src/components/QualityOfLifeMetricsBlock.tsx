import React from 'react';
import type { QualityOfLifeMetricsV1 } from '../domain/model/types';
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

const formatMonths = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No disponible';
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

const metricInfo = {
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
    'Calidad media observada',
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
    'Estrés antes de vender',
    '',
    'Que mide:',
    'Mide cuánto estrés de consumo ocurre antes de vender la casa.',
    'Se calcula sobre los escenarios donde la casa se vende.',
    '',
    'Cómo leerlo:',
    'Aquí sí importa evitar valores altos: no se penaliza vender, se penaliza sufrir demasiado antes de usar el activo.',
    '',
    'Ejemplo aplicado:',
    'Si marca 18 meses, significa que la simulación espera en promedio un año y medio de recortes antes de vender la casa.',
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

export function QualityOfLifeMetricsBlock({
  qualityOfLifeMetrics,
  isMobile,
}: {
  qualityOfLifeMetrics?: QualityOfLifeMetricsV1;
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
  const severeCutMeanTraffic = pickTraffic(qualityOfLifeMetrics.monthsInSevereCutMean, { greenMax: 12, yellowMax: 48 });
  const severeCutP75Traffic = pickTraffic(qualityOfLifeMetrics.maxConsecutiveSevereCutMonthsP75, { greenMax: 12, yellowMax: 48 });
  const cutBeforeSaleTraffic = pickTraffic(qualityOfLifeMetrics.monthsInCutBeforeHouseSaleMean, { greenMax: 6, yellowMax: 24 });

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

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        <Group title="Lectura principal">
          <MetricRow label="Éxito con calidad de vida (CSR-85/4)" info={metricInfo.csr} value={formatPercent(qualityOfLifeMetrics.csr85_4)} traffic={csrTraffic} />
          <MetricRow label="Calidad ajustada estricta (QASR)" info={metricInfo.qasrStrict} value={formatQasr(qualityOfLifeMetrics.qasrStrict)} traffic={qasrTraffic} />
          <MetricRow label="Calidad media observada" info={metricInfo.qualityMean} value={formatQasr(qualityOfLifeMetrics.qualityScoreMean)} traffic={qualityMeanTraffic} />
        </Group>

        <Group title="Recortes">
          <MetricRow label="Recorte severo promedio" info={metricInfo.severeCutMean} value={formatMonths(qualityOfLifeMetrics.monthsInSevereCutMean)} traffic={severeCutMeanTraffic} />
          <MetricRow label="Racha severa P75" info={metricInfo.severeCutP75} value={formatMonths(qualityOfLifeMetrics.maxConsecutiveSevereCutMonthsP75)} traffic={severeCutP75Traffic} />
          <MetricRow
            label="Consumo promedio P25 / P50"
            value={`${formatPercent(qualityOfLifeMetrics.averageConsumptionRatioP25)} · ${formatPercent(qualityOfLifeMetrics.averageConsumptionRatioP50)}`}
            traffic="neutral"
          />
        </Group>

        <Group title="Casa">
          <MetricRow label="Probabilidad de venta de casa" info={metricInfo.houseSale} value={formatPercent(qualityOfLifeMetrics.houseSaleRate)} traffic={salesNeutral} />
          <MetricRow label="Venta mediana" value={qualityOfLifeMetrics.houseSaleYearMedian === null ? 'No disponible' : `año ${qualityOfLifeMetrics.houseSaleYearMedian.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`} traffic={salesNeutral} />
          <MetricRow label="Estrés antes de vender" info={metricInfo.cutBeforeSale} value={formatMonths(qualityOfLifeMetrics.monthsInCutBeforeHouseSaleMean)} traffic={cutBeforeSaleTraffic} />
        </Group>

        <Group title="Margen terminal">
          <MetricRow label="Patrimonio final P25" info={metricInfo.terminal} value={formatMoney(qualityOfLifeMetrics.terminalWealthP25)} traffic="neutral" />
          <MetricRow label="Patrimonio final P50" value={formatMoney(qualityOfLifeMetrics.terminalWealthP50)} traffic="neutral" />
          <div style={{ color: T.textMuted, fontSize: 10 }}>Referencia, no objetivo principal.</div>
        </Group>
      </div>

      {shownWarnings.length > 0 ? (
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Nota: algunos escenarios terminan antes del horizonte por ruina; por eso ciertas métricas de consumo usan datos parciales.
        </div>
      ) : null}
    </section>
  );
}
