import React, { useMemo, useState } from 'react';
import type { ModelParameters } from '../domain/model/types';
import { loadInstrumentUniverseSnapshot } from '../domain/instrumentUniverse';
import { buildOperationalBucketProfile } from '../domain/bucketLab/operationalBucketProfile';
import { runOperationalBucketStress } from '../domain/bucketLab/operationalBucketStress';
import { runBucketTradeoffAnalysis } from '../domain/bucketLab/bucketTradeoff';
import { T } from './theme';

const candidateBuckets = [24, 36, 48, 60, 72, 96, 120];

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString('es-CL')}`;
const formatCompactMoney = (value: number) =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1).replace('.', ',')}MM` : formatMoney(value);
const formatPct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`;
const formatSignedMoney = (value: number) =>
  `${value >= 0 ? '+' : '-'}${formatCompactMoney(Math.abs(value))}`;
const formatMonths = (value: number) => `${value.toFixed(1).replace('.', ',')} meses`;
const layerLabel = (layer: string) => {
  const map: Record<string, string> = {
    hard_cash: 'Cash duro',
    near_cash: 'Near-cash',
    pure_fixed_income: 'RF pura',
    conservative_balanced: 'Balanceado conservador',
    moderate_balanced: 'Balanceado moderado',
    aggressive_balanced: 'Balanceado agresivo',
    equity_like: 'RV',
    restricted: 'Restringido',
    unknown: 'Desconocido',
  };
  return map[layer] || layer;
};

const estimateDefaultSpendClp = (params: ModelParameters): number => {
  const firstPhase = params.spendingPhases?.[0];
  if (!firstPhase || !Number.isFinite(firstPhase.amountReal) || firstPhase.amountReal <= 0) return 6_000_000;
  if (firstPhase.currency === 'CLP') return firstPhase.amountReal;
  const eurToUsd = Number(params.fx?.usdEurFixed ?? 1);
  const usdToClp = Number(params.fx?.clpUsdInitial ?? 900);
  return Math.max(1, firstPhase.amountReal * eurToUsd * usdToClp);
};

const estimateExpectedGrowth = (params: ModelParameters): number => {
  const returns = params.returns;
  const weights = params.weights;
  return (
    weights.rvGlobal * returns.rvGlobalAnnual +
    weights.rvChile * returns.rvChileAnnual +
    weights.rfGlobal * returns.rfGlobalAnnual +
    weights.rfChile * returns.rfChileUFAnnual
  );
};

export function BucketLabPage({ params }: { params: ModelParameters }) {
  const [monthlySpendClp, setMonthlySpendClp] = useState<number>(() => estimateDefaultSpendClp(params));
  const [bucketCurrentMonths, setBucketCurrentMonths] = useState<number>(params.bucketMonths ?? 48);
  const [expectedGrowthReturnAnnual, setExpectedGrowthReturnAnnual] = useState<number>(() =>
    estimateExpectedGrowth(params),
  );
  const [expectedDefensiveReturnAnnual, setExpectedDefensiveReturnAnnual] = useState<number>(
    () => Number(params.returns.rfChileUFAnnual || 0.02),
  );
  const [includeCaptive, setIncludeCaptive] = useState(false);
  const [includeRiskCapital, setIncludeRiskCapital] = useState(false);
  const [stressSensitivity, setStressSensitivity] = useState<'moderada' | 'severa' | 'extrema'>('severa');

  const universeSnapshot = useMemo(() => loadInstrumentUniverseSnapshot(), []);

  const profile = useMemo(
    () =>
      buildOperationalBucketProfile({
        snapshot: universeSnapshot,
        monthlySpendClp,
        includeCaptive,
        includeRiskCapital,
      }),
    [universeSnapshot, monthlySpendClp, includeCaptive, includeRiskCapital],
  );

  const stressScenarios = useMemo(() => {
    if (stressSensitivity === 'moderada') {
      return [
        { crisisMonths: 24, equityDrawdown: -0.2, fixedIncomeShock: 0 },
        { crisisMonths: 36, equityDrawdown: -0.2, fixedIncomeShock: -0.05 },
        { crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
      ];
    }
    if (stressSensitivity === 'extrema') {
      return [
        { crisisMonths: 60, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
        { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
        { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
        { crisisMonths: 120, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      ];
    }
    return [
      { crisisMonths: 36, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
      { crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.1 },
      { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
    ];
  }, [stressSensitivity]);

  const stressRows = useMemo(
    () =>
      runOperationalBucketStress({
        profile,
        scenarios: stressScenarios,
      }),
    [profile, stressScenarios],
  );

  const tradeoffRows = useMemo(
    () =>
      runBucketTradeoffAnalysis({
        profile,
        candidateMonths: candidateBuckets,
        currentBucketMonths: bucketCurrentMonths,
        expectedGrowthReturnAnnual,
        expectedDefensiveReturnAnnual,
        stressScenarios,
      }),
    [
      profile,
      bucketCurrentMonths,
      expectedGrowthReturnAnnual,
      expectedDefensiveReturnAnnual,
      stressScenarios,
    ],
  );

  const recommendation = useMemo(() => {
    if (profile.cleanDefensiveRunwayMonths >= 48) {
      return 'El bucket hard no cuenta toda la defensa. La defensa limpia total parece más relevante que el cash puro.';
    }
    if (profile.cleanDefensiveRunwayMonths < 24) {
      return 'La defensa limpia parece limitada; parte importante del colchón depende de vender balanceados.';
    }
    return 'Este análisis no cambia el motor M8. Sirve para evaluar si el bucket actual parece razonable o si conviene testear un escenario operativo más conservador.';
  }, [profile.cleanDefensiveRunwayMonths]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Bucket Lab</div>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Compara el costo de tener más defensa desde el inicio versus el riesgo de vender balanceados en una crisis larga.
        </div>
        <div style={{ display: 'inline-flex', width: 'fit-content', border: `1px solid ${T.warning}`, borderRadius: 999, padding: '3px 8px', color: T.warning, fontSize: 11, fontWeight: 700 }}>
          Read-only
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <InputNumber label="Gasto mensual CLP" value={monthlySpendClp} onChange={setMonthlySpendClp} />
        <InputNumber label="Bucket actual meses" value={bucketCurrentMonths} onChange={setBucketCurrentMonths} />
        <InputNumber
          label="Retorno crecimiento anual"
          value={expectedGrowthReturnAnnual}
          onChange={setExpectedGrowthReturnAnnual}
          step={0.001}
        />
        <InputNumber
          label="Retorno defensivo anual"
          value={expectedDefensiveReturnAnnual}
          onChange={setExpectedDefensiveReturnAnnual}
          step={0.001}
        />
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Toggle label="Incluir previsional cautivo" checked={includeCaptive} onChange={setIncludeCaptive} />
        <Toggle label="Incluir capital de riesgo" checked={includeRiskCapital} onChange={setIncludeRiskCapital} />
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
          <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Sensibilidad crisis</div>
          <select
            value={stressSensitivity}
            onChange={(event) => setStressSensitivity(event.target.value as 'moderada' | 'severa' | 'extrema')}
            style={{
              width: '100%',
              background: T.surfaceEl,
              color: T.textPrimary,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            <option value="moderada">Moderada</option>
            <option value="severa">Severa</option>
            <option value="extrema">Extrema</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <MetricCard title="Bucket hard cash" value={formatCompactMoney(profile.hardCashClp)} subtitle={formatMonths(profile.hardCashRunwayMonths)} />
        <MetricCard title="Defensa limpia" value={formatCompactMoney(profile.cleanDefensiveClp)} subtitle={formatMonths(profile.cleanDefensiveRunwayMonths)} />
        <MetricCard title="Defensa mixta" value={formatCompactMoney(profile.mixedFundClp)} subtitle={`+${formatMonths(profile.mixedFundRunwayMonths)} (vende balanceados)`} />
        <MetricCard title="RV embebida si uso balanceados" value={formatCompactMoney(profile.embeddedEquityClp)} subtitle={formatPct(profile.embeddedEquitySoldPct)} />
        <MetricCard title="Cobertura de datos" value={formatPct(profile.coveragePctByClp)} subtitle={profile.source === 'instrument_universe' ? 'Instrument Universe' : 'Sin fuente'} />
      </div>

      <TableCard title="Capas defensivas">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: T.textMuted, textAlign: 'left' }}>
              <th style={thStyle}>Capa</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Monto CLP</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>% port.</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Meses</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>RV embebida</th>
              <th style={thStyle}>Comentario</th>
            </tr>
          </thead>
          <tbody>
            {profile.layerSummaries.map((row) => (
              <tr key={row.layer} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={tdStyle}>{layerLabel(row.layer)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.amountClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPct(row.pctPortfolio)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMonths(row.runwayMonths)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.embeddedEquityClp)}</td>
                <td style={tdStyle}>{row.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Stress operativo simple">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: T.textMuted, textAlign: 'left' }}>
              <th style={thStyle}>Crisis</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>DD RV</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Shock RF</th>
              <th style={thStyle}>Defensa limpia</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Balanceados vendidos</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>RV embebida vendida</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>ForcedSalePenalty</th>
              <th style={thStyle}>Severidad</th>
            </tr>
          </thead>
          <tbody>
            {stressRows.map((row) => (
              <tr key={`${row.crisisMonths}-${row.equityDrawdown}-${row.fixedIncomeShock}`} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={tdStyle}>{row.crisisMonths}m</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPct(row.equityDrawdown)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPct(row.fixedIncomeShock)}</td>
                <td style={tdStyle}>{row.cleanDefensiveEnough ? 'Sí' : `No (agota en ${row.cleanDefensiveExhaustedMonth}m)`}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.balancedSoldClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.embeddedEquitySoldClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.forcedSalePenalty)}</td>
                <td style={tdStyle}>{row.stressSeverity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Tradeoff de bucket">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: T.textMuted, textAlign: 'left' }}>
              <th style={thStyle}>Bucket</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Capital defensivo</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Capital extra</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Costo oportunidad anual</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>RV embebida evitada</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>ForcedSale estimado</th>
              <th style={thStyle}>Lectura</th>
            </tr>
          </thead>
          <tbody>
            {tradeoffRows.map((row) => (
              <tr key={row.bucketMonths} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={tdStyle}>{row.bucketMonths}m</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.requiredDefensiveCapitalClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.extraDefensiveCapitalClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatSignedMoney(row.opportunityCostAnnual)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.avoidedEmbeddedEquitySaleClp)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactMoney(row.expectedForcedSaleCost)}</td>
                <td style={tdStyle}>{row.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textPrimary, fontWeight: 700, marginBottom: 6 }}>Recomendación preliminar</div>
        <div style={{ color: T.textSecondary, fontSize: 13 }}>{recommendation}</div>
      </div>

      {profile.warnings.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.warning}`, borderRadius: 12, padding: 12 }}>
          <div style={{ color: T.warning, fontWeight: 700, marginBottom: 6 }}>Warnings</div>
          {profile.warnings.slice(0, 10).map((warning) => (
            <div key={warning} style={{ color: T.textSecondary, fontSize: 12 }}>
              • {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InputNumber({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
}) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
      <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>{label}</div>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        style={{
          width: '100%',
          background: T.surfaceEl,
          border: `1px solid ${T.border}`,
          color: T.textPrimary,
          borderRadius: 8,
          padding: '8px 10px',
        }}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: T.textSecondary, fontSize: 12 }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{title}</div>
      <div style={{ color: T.textPrimary, fontWeight: 800, fontSize: 16, marginTop: 2 }}>{value}</div>
      <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 2 }}>{subtitle}</div>
    </div>
  );
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, overflowX: 'auto' }}>
      <div style={{ color: T.textPrimary, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '6px 4px',
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 4px',
  color: T.textSecondary,
  verticalAlign: 'top',
};
