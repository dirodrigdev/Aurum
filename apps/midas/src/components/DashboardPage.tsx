import React from 'react';
import type {
  DashboardMetric,
  DashboardShare,
  DashboardSignal,
  DashboardTone,
  StrategyDashboardModel,
} from '../domain/dashboard/strategyDashboardModel';
import { T } from './theme';

type DashboardPageProps = {
  model: StrategyDashboardModel;
  onOpenSimulation: () => void;
  onOpenSensitivity: () => void;
  onOpenSettings: () => void;
  onOpenEcosystem: () => void;
};

const toneColor: Record<DashboardTone, string> = {
  positive: '#63F5B1',
  warning: '#F1C66D',
  negative: '#FF7B86',
  neutral: '#AAB5C8',
};

const toneSurface: Record<DashboardTone, string> = {
  positive: 'rgba(99,245,177,0.10)',
  warning: 'rgba(241,198,109,0.11)',
  negative: 'rgba(255,123,134,0.10)',
  neutral: 'rgba(170,181,200,0.08)',
};

const formatPercent = (value: number | null, digits = 1): string =>
  value === null ? '—' : `${(value * 100).toLocaleString('es-CL', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

const formatMetric = (metric: DashboardMetric): string => {
  if (metric.value === null) return '—';
  if (metric.unit === '%') return formatPercent(metric.value);
  if (metric.unit === 'puntos') return metric.value.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return Math.round(metric.value).toLocaleString('es-CL');
};

const privacySafeText = (value: string): string => value;

function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <article className="midas-dash-metric" data-testid={`dashboard-metric-${metric.id}`}>
      <div className="midas-dash-metric-top">
        <span className="midas-dash-kicker">{metric.label}</span>
        <span className="midas-dash-dot" style={{ background: toneColor[metric.tone] }} aria-hidden="true" />
      </div>
      <div className="midas-dash-metric-value" style={{ color: toneColor[metric.tone] }}>
        {formatMetric(metric)}
        {metric.value !== null && metric.unit !== '%' && metric.unit !== 'puntos' ? <small>{metric.unit}</small> : null}
        {metric.value !== null && metric.unit === 'puntos' ? <small>/100{metric.category ? ` · ${metric.category}` : ''}</small> : null}
      </div>
      <div className="midas-dash-copy">{metric.detail}</div>
    </article>
  );
}

function ShareBar({ values }: { values: DashboardShare[] }) {
  return (
    <div className="midas-dash-share-wrap">
      <div className="midas-dash-share-bar" aria-label="Distribución porcentual de la estrategia">
        {values.map((item) => (
          <span key={item.id} style={{ width: `${Math.max(0, Math.min(100, item.share * 100))}%`, background: item.color }} />
        ))}
      </div>
      <div className="midas-dash-share-legend">
        {values.map((item) => (
          <div key={item.id} className="midas-dash-share-item">
            <span className="midas-dash-legend-dot" style={{ background: item.color }} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{formatPercent(item.share)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: DashboardSignal }) {
  return (
    <article className="midas-dash-signal" style={{ borderColor: `${toneColor[signal.status]}45`, background: toneSurface[signal.status] }}>
      <div className="midas-dash-signal-head">
        <span className="midas-dash-signal-light" style={{ background: toneColor[signal.status], boxShadow: `0 0 16px ${toneColor[signal.status]}50` }} aria-hidden="true" />
        <span>{signal.statusLabel}</span>
      </div>
      <h3>{signal.label}</h3>
      <p>{signal.explanation}</p>
    </article>
  );
}

function EmptyDashboard({ model, onOpenSimulation, onOpenEcosystem }: Pick<DashboardPageProps, 'model' | 'onOpenSimulation' | 'onOpenEcosystem'>) {
  const loading = model.status === 'loading';
  const errored = model.status === 'error';
  return (
    <section className="midas-dash-empty" data-testid="dashboard-empty-state" style={{ minHeight: 560, display: 'grid', justifyItems: 'center', alignContent: 'center', textAlign: 'center', padding: '40px 20px', border: `1px solid ${T.border}`, borderRadius: 30, background: `radial-gradient(circle at center,rgba(91,140,255,.08),transparent 35%),${T.surface}` }}>
      <div className={`midas-dash-empty-orbit${loading ? ' is-loading' : ''}`} aria-hidden="true">
        <span />
      </div>
      <div className="midas-dash-kicker">Dashboard estratégico</div>
      <h1>{loading ? 'Preparando una lectura segura del plan' : errored ? 'No pudimos completar la lectura' : 'Aún no hay indicadores para presentar'}</h1>
      <p>{model.statusMessage}</p>
      <p className="midas-dash-privacy">Vista de presentación: los valores monetarios permanecen ocultos.</p>
      <div className="midas-dash-actions" style={{ justifyContent: 'center' }}>
        {!loading ? <button type="button" className="midas-dash-primary-button" onClick={onOpenSimulation}>Ir a Simulación</button> : null}
        <button type="button" className="midas-dash-secondary-button" style={{ border: `1px solid ${T.border}`, borderRadius: 999, padding: '10px 14px', background: T.surfaceEl, color: '#C7D1E1', fontSize: 11, fontWeight: 800, cursor: 'pointer' }} onClick={onOpenEcosystem}>Ver ecosistema</button>
      </div>
    </section>
  );
}

export function DashboardPage({ model, onOpenSimulation, onOpenSensitivity, onOpenSettings, onOpenEcosystem }: DashboardPageProps) {
  if (model.status === 'loading' || model.status === 'empty' || model.status === 'error') {
    return <EmptyDashboard model={model} onOpenSimulation={onOpenSimulation} onOpenEcosystem={onOpenEcosystem} />;
  }

  const successMetric = model.primaryMetrics.find((metric) => metric.id === 'success') ?? null;
  const heroValue = successMetric ? formatMetric(successMetric) : '—';
  const mixGradient = model.mix.length
    ? `conic-gradient(${model.mix.map((item, index) => {
        const before = model.mix.slice(0, index).reduce((sum, current) => sum + current.share, 0) * 100;
        const after = before + item.share * 100;
        return `${item.color} ${before.toFixed(2)}% ${after.toFixed(2)}%`;
      }).join(', ')})`
    : T.surfaceEl;

  return (
    <div className="midas-dashboard" data-testid="midas-dashboard" data-privacy-mode="monetary-values-hidden">
      <style>{`
        .midas-dashboard { --dash-ink:#F4F7FC; --dash-muted:#8E9AAF; display:grid; gap:18px; color:var(--dash-ink); }
        .midas-dashboard * { box-sizing:border-box; }
        .midas-dash-hero { position:relative; overflow:hidden; min-height:355px; border:1px solid rgba(202,166,104,.42); border-radius:32px; padding:clamp(22px,4vw,42px); background:radial-gradient(circle at 82% 18%,rgba(99,245,177,.15),transparent 26%),radial-gradient(circle at 12% 86%,rgba(91,140,255,.19),transparent 34%),linear-gradient(145deg,#06152f 0%,#0d2850 50%,#07152d 100%); box-shadow:0 28px 80px rgba(1,7,20,.38); }
        .midas-dash-hero:after { content:''; position:absolute; inset:0; pointer-events:none; background:linear-gradient(120deg,rgba(255,255,255,.04),transparent 38%,rgba(255,255,255,.01)); }
        .midas-dash-orbit { position:absolute; right:-78px; top:-88px; width:310px; height:310px; border:1px solid rgba(255,255,255,.08); border-radius:50%; }
        .midas-dash-orbit:before,.midas-dash-orbit:after { content:''; position:absolute; border:1px solid rgba(255,255,255,.07); border-radius:50%; }
        .midas-dash-orbit:before { inset:38px; } .midas-dash-orbit:after { inset:82px; border-color:rgba(99,245,177,.18); }
        .midas-dash-hero-content { position:relative; z-index:1; display:grid; grid-template-columns:minmax(0,1.6fr) minmax(210px,.7fr); gap:28px; min-height:285px; }
        .midas-dash-kicker { color:#D9BD8A; font-size:10px; font-weight:850; letter-spacing:.24em; text-transform:uppercase; }
        .midas-dash-hero h1 { max-width:620px; margin:14px 0 12px; font-size:clamp(30px,5vw,51px); line-height:1.02; letter-spacing:-.055em; }
        .midas-dash-hero-copy { max-width:650px; margin:0; color:#C8D1E0; font-size:15px; line-height:1.58; }
        .midas-dash-privacy-pill { display:inline-flex; align-items:center; gap:8px; margin-top:20px; border:1px solid rgba(255,255,255,.12); border-radius:999px; padding:8px 12px; background:rgba(255,255,255,.045); color:#ABB8CB; font-size:11px; }
        .midas-dash-privacy-pill:before { content:'◆'; color:#63F5B1; font-size:8px; }
        .midas-dash-hero-score { align-self:end; justify-self:end; text-align:right; }
        .midas-dash-hero-score span { display:block; font-size:10px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:#93A2B8; }
        .midas-dash-hero-score strong { display:block; margin-top:8px; color:#63F5B1; font-size:clamp(64px,9vw,102px); line-height:.86; letter-spacing:-.08em; }
        .midas-dash-hero-score small { display:block; margin-top:12px; color:#B9C5D7; font-size:12px; }
        .midas-dash-section { display:grid; gap:12px; }
        .midas-dash-section-title { display:flex; align-items:end; justify-content:space-between; gap:12px; padding:0 3px; }
        .midas-dash-section-title h2 { margin:0; font-size:18px; letter-spacing:-.025em; }
        .midas-dash-section-title p { margin:0; color:var(--dash-muted); font-size:11px; }
        .midas-dash-metrics { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; }
        .midas-dash-metric { min-width:0; min-height:178px; padding:16px; border:1px solid ${T.border}; border-radius:22px; background:linear-gradient(180deg,rgba(27,33,48,.96),rgba(19,24,35,.98)); box-shadow:0 14px 34px rgba(2,7,16,.18); }
        .midas-dash-metric-top { display:flex; justify-content:space-between; gap:8px; min-height:34px; }
        .midas-dash-dot { width:8px; height:8px; margin-top:2px; border-radius:50%; flex:0 0 auto; }
        .midas-dash-metric-value { display:flex; align-items:baseline; gap:6px; margin-top:18px; font-size:clamp(34px,4.5vw,52px); font-weight:850; line-height:.9; letter-spacing:-.065em; }
        .midas-dash-metric-value small { color:#7F8A9E; font-size:11px; font-weight:700; letter-spacing:.02em; }
        .midas-dash-copy { margin-top:13px; color:#8E9AAF; font-size:11px; line-height:1.4; }
        .midas-dash-grid-two { display:grid; grid-template-columns:1.1fr .9fr; gap:12px; }
        .midas-dash-panel { min-width:0; border:1px solid ${T.border}; border-radius:26px; padding:20px; background:linear-gradient(155deg,rgba(24,31,47,.98),rgba(15,20,31,.98)); box-shadow:0 16px 40px rgba(1,6,16,.18); }
        .midas-dash-panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:18px; }
        .midas-dash-panel-head h2 { margin:0; font-size:20px; letter-spacing:-.03em; }
        .midas-dash-panel-head p { margin:5px 0 0; color:#8793A7; font-size:11px; }
        .midas-dash-strategy-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
        .midas-dash-strategy-card { min-width:0; padding:14px; border:1px solid rgba(255,255,255,.07); border-radius:18px; background:rgba(255,255,255,.025); }
        .midas-dash-strategy-card span { color:#78869B; font-size:9px; font-weight:800; letter-spacing:.15em; text-transform:uppercase; }
        .midas-dash-strategy-card strong { display:block; margin-top:7px; color:#EDF2F9; font-size:17px; }
        .midas-dash-strategy-card p { margin:6px 0 0; color:#8E9AAF; font-size:11px; line-height:1.4; }
        .midas-dash-rates { display:grid; gap:9px; }
        .midas-dash-rate { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 0; border-bottom:1px solid rgba(255,255,255,.065); }
        .midas-dash-rate:last-child { border-bottom:0; }
        .midas-dash-rate-label { color:#AAB5C6; font-size:12px; } .midas-dash-rate-label small { display:block; margin-top:3px; color:#68758A; font-size:9px; }
        .midas-dash-rate strong { color:#E8C774; font-size:21px; letter-spacing:-.04em; }
        .midas-dash-mix-layout { display:grid; grid-template-columns:190px minmax(0,1fr); align-items:center; gap:28px; }
        .midas-dash-donut { position:relative; width:172px; aspect-ratio:1; margin:auto; border-radius:50%; box-shadow:0 16px 40px rgba(0,0,0,.2); }
        .midas-dash-donut:after { content:'MIX'; position:absolute; inset:30px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.09); border-radius:50%; background:#111827; color:#C8D1E0; font-size:11px; font-weight:850; letter-spacing:.22em; }
        .midas-dash-share-wrap { display:grid; gap:14px; }
        .midas-dash-share-bar { display:flex; height:11px; overflow:hidden; border-radius:999px; background:#0C1321; }
        .midas-dash-share-bar span { display:block; height:100%; }
        .midas-dash-share-legend { display:grid; gap:10px; }
        .midas-dash-share-item { display:grid; grid-template-columns:10px minmax(0,1fr) auto; align-items:center; gap:8px; color:#9BA7B9; font-size:12px; }
        .midas-dash-share-item strong { color:#EDF2F9; font-size:14px; }
        .midas-dash-legend-dot { width:8px; height:8px; border-radius:50%; }
        .midas-dash-submix { margin-top:22px; padding-top:18px; border-top:1px solid rgba(255,255,255,.07); }
        .midas-dash-submix h3 { margin:0 0 12px; color:#91A0B5; font-size:10px; letter-spacing:.16em; text-transform:uppercase; }
        .midas-dash-layers { display:grid; gap:9px; }
        .midas-dash-layer { display:grid; grid-template-columns:42px minmax(0,1fr) auto; align-items:center; gap:12px; padding:12px; border:1px solid rgba(255,255,255,.07); border-radius:17px; background:rgba(255,255,255,.022); }
        .midas-dash-layer-index { display:grid; place-items:center; width:34px; height:34px; border-radius:12px; background:rgba(91,140,255,.13); color:#8BAEFF; font-weight:850; }
        .midas-dash-layer h3 { margin:0; font-size:13px; } .midas-dash-layer p { margin:4px 0 0; color:#748298; font-size:10px; }
        .midas-dash-layer-tags { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px; max-width:210px; }
        .midas-dash-layer-tags span { border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:4px 7px; color:#A9B5C7; font-size:9px; }
        .midas-dash-scenarios { display:grid; gap:14px; }
        .midas-dash-scenario { display:grid; grid-template-columns:130px minmax(0,1fr) 58px; align-items:center; gap:12px; }
        .midas-dash-scenario-label strong { display:block; font-size:12px; } .midas-dash-scenario-label small { color:#6F7C90; font-size:9px; }
        .midas-dash-scenario-track { height:9px; overflow:hidden; border-radius:999px; background:#0A1220; }
        .midas-dash-scenario-track span { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#4D78E8,#63F5B1); }
        .midas-dash-scenario-value { text-align:right; color:#DDE6F3; font-size:14px; font-weight:800; }
        .midas-dash-quality { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
        .midas-dash-quality-card { min-width:0; padding:15px; border:1px solid ${T.border}; border-radius:20px; background:#151B28; }
        .midas-dash-quality-card header { display:flex; justify-content:space-between; gap:8px; }
        .midas-dash-quality-card header span { color:#8E9AAF; font-size:10px; line-height:1.3; }
        .midas-dash-quality-card header b { font-size:9px; text-transform:uppercase; }
        .midas-dash-quality-value { margin-top:16px; font-size:32px; font-weight:850; letter-spacing:-.055em; }
        .midas-dash-quality-card p { margin:10px 0 0; color:#78859A; font-size:10px; line-height:1.4; }
        .midas-dash-signals { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
        .midas-dash-signal { min-width:0; min-height:150px; padding:14px; border:1px solid; border-radius:20px; }
        .midas-dash-signal-head { display:flex; align-items:center; gap:7px; color:#9EAABD; font-size:9px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
        .midas-dash-signal-light { width:9px; height:9px; border-radius:50%; }
        .midas-dash-signal h3 { margin:18px 0 0; font-size:14px; } .midas-dash-signal p { margin:7px 0 0; color:#7D899D; font-size:10px; line-height:1.42; }
        .midas-dash-interpretation { display:grid; grid-template-columns:1.15fr .85fr; gap:12px; }
        .midas-dash-insight { padding:22px; border:1px solid rgba(99,245,177,.18); border-radius:26px; background:radial-gradient(circle at top right,rgba(99,245,177,.08),transparent 34%),#0D1B32; }
        .midas-dash-insight h2 { margin:8px 0 10px; font-size:25px; letter-spacing:-.04em; } .midas-dash-insight p { margin:0; color:#AAB6C8; font-size:13px; line-height:1.55; }
        .midas-dash-reading-list { display:grid; gap:8px; }
        .midas-dash-reading-item { padding:12px 14px; border:1px solid ${T.border}; border-radius:17px; background:${T.surfaceEl}; }
        .midas-dash-reading-item span { display:block; color:#718097; font-size:9px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
        .midas-dash-reading-item p { margin:5px 0 0; color:#B9C3D2; font-size:11px; line-height:1.4; }
        .midas-dash-actions { display:flex; flex-wrap:wrap; gap:8px; }
        .midas-dash-primary-button,.midas-dash-secondary-button { border-radius:999px; padding:10px 14px; font-size:11px; font-weight:800; cursor:pointer; }
        .midas-dash-primary-button { border:1px solid #63F5B1; background:#63F5B1; color:#07142A; }
        .midas-dash-secondary-button { border:1px solid ${T.border}; background:${T.surfaceEl}; color:#C7D1E1; }
        .midas-dash-empty { min-height:560px; display:grid; justify-items:center; align-content:center; text-align:center; padding:40px 20px; border:1px solid ${T.border}; border-radius:30px; background:radial-gradient(circle at center,rgba(91,140,255,.08),transparent 35%),${T.surface}; }
        .midas-dash-empty h1 { margin:18px 0 10px; font-size:clamp(28px,5vw,46px); letter-spacing:-.05em; } .midas-dash-empty p { max-width:520px; margin:0 0 10px; color:#8E9AAF; line-height:1.55; }
        .midas-dash-empty-orbit { width:110px; height:110px; display:grid; place-items:center; border:1px solid rgba(91,140,255,.25); border-radius:50%; }
        .midas-dash-empty-orbit span { width:42px; height:42px; border:1px solid #63F5B1; border-radius:50%; box-shadow:0 0 30px rgba(99,245,177,.18); }
        .midas-dash-empty-orbit.is-loading { animation:midasDashboardSpin 2.4s linear infinite; }
        .midas-dash-privacy { font-size:11px; }
        @keyframes midasDashboardSpin { to { transform:rotate(360deg); } }
        @media (max-width:820px) { .midas-dash-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); } .midas-dash-grid-two,.midas-dash-interpretation { grid-template-columns:1fr; } .midas-dash-quality,.midas-dash-signals { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:620px) { .midas-dashboard { gap:14px; } .midas-dash-hero { min-height:440px; border-radius:26px; padding:22px 18px; } .midas-dash-hero-content { grid-template-columns:1fr; gap:16px; } .midas-dash-hero-score { justify-self:start; text-align:left; align-self:end; } .midas-dash-hero-score strong { font-size:72px; } .midas-dash-section-title { align-items:flex-start; flex-direction:column; gap:5px; } .midas-dash-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); } .midas-dash-metric { min-height:160px; padding:14px; } .midas-dash-metric:last-child { grid-column:1 / -1; } .midas-dash-panel { padding:16px; border-radius:22px; } .midas-dash-mix-layout { grid-template-columns:1fr; } .midas-dash-layer { grid-template-columns:38px minmax(0,1fr); } .midas-dash-layer-tags { grid-column:1 / -1; justify-content:flex-start; max-width:none; } .midas-dash-scenario { grid-template-columns:100px minmax(0,1fr) 48px; gap:8px; } .midas-dash-quality,.midas-dash-signals { grid-template-columns:1fr; } .midas-dash-signal { min-height:auto; } .midas-dash-strategy-grid { grid-template-columns:1fr; } }
        @media (prefers-reduced-motion:reduce) { .midas-dash-empty-orbit.is-loading { animation:none; } }
      `}</style>

      <section className="midas-dash-hero" data-testid="dashboard-hero">
        <div className="midas-dash-orbit" aria-hidden="true" />
        <div className="midas-dash-hero-content">
          <div>
            <div className="midas-dash-kicker">{model.hero.eyebrow}</div>
            <h1>{model.hero.headline}</h1>
            <p className="midas-dash-hero-copy">{model.hero.conclusion}</p>
            <div className="midas-dash-privacy-pill">{model.hero.privacyNote}</div>
          </div>
          <div className="midas-dash-hero-score">
            <span>Probabilidad de sostenibilidad</span>
            <strong>{heroValue}</strong>
            <small>{model.targetAge === null ? `${model.horizonYears ?? '—'} años evaluados` : `Hasta los ${model.targetAge} años`}</small>
          </div>
        </div>
      </section>

      <section className="midas-dash-section" aria-labelledby="dashboard-primary-heading">
        <div className="midas-dash-section-title">
          <h2 id="dashboard-primary-heading">Lectura principal</h2>
          <p>Resultados reales del escenario vigente</p>
        </div>
        <div className="midas-dash-metrics">{model.primaryMetrics.map((metric) => <MetricCard key={metric.id} metric={metric} />)}</div>
      </section>

      <div className="midas-dash-grid-two">
        <section className="midas-dash-panel" data-testid="dashboard-strategy">
          <div className="midas-dash-panel-head"><div><h2>Configuración estratégica</h2><p>Qué está evaluando el modelo activo</p></div><span className="midas-dash-kicker">{model.scenarioLabel}</span></div>
          <div className="midas-dash-strategy-grid">
            <div className="midas-dash-strategy-card"><span>Edad actual</span><strong>{model.currentAge ?? '—'} años</strong><p>Punto de partida temporal.</p></div>
            <div className="midas-dash-strategy-card"><span>Edad objetivo</span><strong>{model.targetAge ?? '—'} años</strong><p>Fin del horizonte evaluado.</p></div>
            <div className="midas-dash-strategy-card"><span>Vivienda</span><strong>{model.house.active ? 'Considerada' : 'No incorporada'}</strong><p>{model.house.expectedAge === null ? model.house.detail : `Venta prevista alrededor de los ${model.house.expectedAge} años.`}</p></div>
            <div className="midas-dash-strategy-card"><span>Capital de riesgo</span><strong>{model.riskReserve.active ? 'Activado' : 'Inactivo'}</strong><p>{model.riskReserve.active && model.riskReserve.relativeShare !== null ? `Participación relativa: ${formatPercent(model.riskReserve.relativeShare)}.` : model.riskReserve.detail}</p></div>
          </div>
        </section>
        <section className="midas-dash-panel" data-testid="dashboard-rates">
          <div className="midas-dash-panel-head"><div><h2>Tasas consideradas</h2><p>Supuestos porcentuales del escenario</p></div></div>
          <div className="midas-dash-rates">
            {model.rates.map((rate) => <div key={rate.id} className="midas-dash-rate"><div className="midas-dash-rate-label">{rate.label}<small>{rate.detail}</small></div><strong>{formatPercent(rate.value)}</strong></div>)}
          </div>
        </section>
      </div>

      <div className="midas-dash-grid-two">
        <section className="midas-dash-panel" data-testid="dashboard-mix">
          <div className="midas-dash-panel-head"><div><h2>Mix estratégico considerado</h2><p>Composición porcentual usada por MIDAS</p></div></div>
          <div className="midas-dash-mix-layout">
            <div className="midas-dash-donut" style={{ background: mixGradient }} aria-label="Mix porcentual del escenario activo" />
            <ShareBar values={model.mix} />
          </div>
          <div className="midas-dash-submix"><h3>Exposición relativa por sleeve</h3><ShareBar values={model.regionalExposure} /></div>
        </section>
        <section className="midas-dash-panel" data-testid="dashboard-layers">
          <div className="midas-dash-panel-head"><div><h2>Secuencia de retiro</h2><p>Orden conceptual de utilización</p></div></div>
          <div className="midas-dash-layers">
            {model.layers.map((layer, index) => <div key={layer.id} className="midas-dash-layer"><div className="midas-dash-layer-index">{index + 1}</div><div><h3>{layer.label} · {layer.horizonLabel}</h3><p>{layer.role}</p></div><div className="midas-dash-layer-tags">{layer.categories.map((category) => <span key={category}>{category}</span>)}</div></div>)}
          </div>
        </section>
      </div>

      <section className="midas-dash-panel" data-testid="dashboard-scenarios">
        <div className="midas-dash-panel-head"><div><h2>Lectura por escenarios</h2><p>Probabilidad relativa, sin proyectar valores monetarios</p></div></div>
        <div className="midas-dash-scenarios">
          {model.scenarios.map((scenario) => <div key={scenario.id} className="midas-dash-scenario"><div className="midas-dash-scenario-label"><strong>{scenario.label}</strong><small>{scenario.note}</small></div><div className="midas-dash-scenario-track"><span style={{ width: `${Math.max(0, Math.min(100, (scenario.success ?? 0) * 100))}%` }} /></div><div className="midas-dash-scenario-value">{formatPercent(scenario.success)}</div></div>)}
        </div>
      </section>

      <section className="midas-dash-section" data-testid="dashboard-quality">
        <div className="midas-dash-section-title"><h2>Calidad de vida</h2><p>Indicadores derivados de trayectorias M8</p></div>
        <div className="midas-dash-quality">
          {model.quality.map((item) => <article key={item.id} className="midas-dash-quality-card"><header><span>{item.label}</span><b style={{ color: toneColor[item.status] }}>{item.statusLabel}</b></header><div className="midas-dash-quality-value" style={{ color: toneColor[item.status] }}>{item.valueKind === 'percent' ? formatPercent(item.value) : item.value === null ? '—' : `${item.value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}${item.valueKind === 'years' ? ' años' : ''}`}</div><p>{item.explanation}</p></article>)}
        </div>
      </section>

      <section className="midas-dash-section" data-testid="dashboard-signals">
        <div className="midas-dash-section-title"><h2>Semáforos del plan</h2><p>Verde no significa garantía; indica dato dentro de rango</p></div>
        <div className="midas-dash-signals">{model.signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>

      <section className="midas-dash-interpretation" data-testid="dashboard-interpretation">
        <div className="midas-dash-insight">
          <div className="midas-dash-kicker">Lectura ejecutiva</div>
          <h2>{privacySafeText(model.interpretation.generalState)}</h2>
          <p>{privacySafeText(model.interpretation.qualityOfLife)}</p>
          <div className="midas-dash-actions" style={{ marginTop: 18 }}>
            <button type="button" className="midas-dash-primary-button" onClick={onOpenSimulation}>Ver Simulación</button>
            <button type="button" className="midas-dash-secondary-button" onClick={onOpenSensitivity}>Abrir Sensibilidad</button>
            <button type="button" className="midas-dash-secondary-button" onClick={onOpenSettings}>Revisar Ajustes</button>
            <button type="button" className="midas-dash-secondary-button" onClick={onOpenEcosystem}>Ver ecosistema</button>
          </div>
        </div>
        <div className="midas-dash-reading-list">
          <div className="midas-dash-reading-item"><span>Principal fortaleza</span><p>{privacySafeText(model.interpretation.strength)}</p></div>
          <div className="midas-dash-reading-item"><span>Principal riesgo</span><p>{privacySafeText(model.interpretation.mainRisk)}</p></div>
          <div className="midas-dash-reading-item"><span>Dependencia relevante</span><p>{privacySafeText(model.interpretation.dependence)}</p></div>
          <div className="midas-dash-reading-item"><span>Variable a vigilar</span><p>{privacySafeText(model.interpretation.watchVariable)}</p></div>
        </div>
      </section>
    </div>
  );
}
