import React from 'react';
import type { MidasPresentationViewModel, PresentationScenarioId } from '../domain/dashboard/presentationModel';

type PresentationPageProps = {
  model: MidasPresentationViewModel;
  onOpenEcosystem: () => void;
};

const percent = (value: number | null): string => value === null
  ? 'No disponible'
  : `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;

const years = (value: number | null): string => value === null
  ? 'No disponible'
  : `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} años de media`;

const scenarioTone: Record<PresentationScenarioId, string> = {
  favorable: 'favorable', evaluado: 'evaluado', adverso: 'adverso',
};

export function PresentationPage({ model, onOpenEcosystem }: PresentationPageProps) {
  return (
    <div className="midas-presentation" data-testid="midas-presentation" data-privacy-mode="relative-only">
      <style>{`
        .midas-presentation{--mp-ink:#F2F5FB;--mp-muted:#A5B0C2;--mp-dim:#758197;--mp-line:rgba(205,218,242,.16);min-height:100vh;background:radial-gradient(ellipse at 78% -10%,rgba(55,91,163,.18),transparent 42%),#0B1220;color:var(--mp-ink);font-family:"SF Pro Display","Helvetica Neue",system-ui,sans-serif;padding:clamp(24px,5vw,56px) 22px 32px}.midas-presentation *{box-sizing:border-box}.mp-wrap{max-width:1040px;margin:0 auto}.mp-brand{display:flex;align-items:center;justify-content:space-between;gap:16px;color:#CAD4E5;font-size:12px;letter-spacing:.12em;text-transform:uppercase}.mp-brand strong{color:#D5BB84;font-weight:800}.mp-privacy{font-size:10px;letter-spacing:.05em;text-transform:none;color:var(--mp-dim)}.mp-hero{padding:clamp(40px,7vw,72px) 0 34px;border-bottom:1px solid var(--mp-line)}.mp-hero h1{max-width:780px;margin:0;font-size:clamp(34px,6vw,58px);line-height:1.04;letter-spacing:-.045em;font-weight:650}.mp-hero p{margin:18px 0 0;color:#B9C4D7;font-size:16px;line-height:1.55}.mp-horizon{display:inline-flex;gap:8px;align-items:center;margin-top:24px;color:#D5BB84;font-size:13px;font-weight:650}.mp-horizon .mp-unavailable{color:var(--mp-muted);font-weight:500}.mp-section{padding:30px 0;border-bottom:1px solid var(--mp-line)}.mp-kicker{margin:0 0 16px;color:#8998B1;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.mp-metrics{display:grid;grid-template-columns:1fr 1fr .8fr;align-items:start;gap:30px}.mp-metric{min-width:0}.mp-metric.primary .mp-number{font-size:clamp(32px,4.4vw,46px)}.mp-number{font-size:clamp(23px,3vw,31px);font-weight:650;letter-spacing:-.035em;font-variant-numeric:tabular-nums;white-space:nowrap}.mp-metric .mp-number.mp-unavailable{color:var(--mp-muted);font-size:20px;font-weight:500;letter-spacing:0}.mp-label{margin-top:8px;color:#D8E0ED;font-size:14px;font-weight:650}.mp-help{max-width:330px;margin-top:7px;color:var(--mp-muted);font-size:12px;line-height:1.5}.mp-chart-head{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:22px}.mp-chart-head h2{margin:0;font-size:22px;letter-spacing:-.025em}.mp-chart-head p{margin:5px 0 0;color:var(--mp-muted);font-size:12px}.mp-axis{display:grid;grid-template-columns:minmax(88px,130px) 1fr 108px;align-items:center;gap:12px;margin-bottom:7px;color:#9EACC1;font-size:12px;font-variant-numeric:tabular-nums}.mp-ticks{display:flex;justify-content:space-between}.mp-row{display:grid;grid-template-columns:minmax(88px,130px) 1fr 108px;align-items:center;gap:12px;min-height:42px}.mp-row-label{color:#B7C2D3;font-size:12px}.mp-row.evaluado .mp-row-label{color:#F3F5FA;font-weight:750}.mp-track{height:16px;position:relative;background:linear-gradient(to bottom,transparent calc(50% - .5px),rgba(216,226,245,.2) calc(50% - .5px),rgba(216,226,245,.2) calc(50% + .5px),transparent calc(50% + .5px))}.mp-dot{position:absolute;left:var(--mp-point);top:50%;width:10px;height:10px;border-radius:50%;transform:translate(-50%,-50%);background:#8998BC;box-shadow:0 0 0 4px rgba(137,152,188,.13)}.mp-dot.favorable{background:#7289B8;box-shadow:0 0 0 4px rgba(114,137,184,.13)}.mp-dot.adverso{background:#A5B3CF;box-shadow:0 0 0 4px rgba(165,179,207,.12)}.mp-dot.evaluado{width:14px;height:14px;background:#D5BB84;box-shadow:0 0 0 5px rgba(213,187,132,.14)}.mp-row-value{text-align:right;font-size:12px;color:#AEBBD0;font-variant-numeric:tabular-nums}.mp-row.evaluado .mp-row-value{color:#F2F5FB;font-weight:750}.mp-row .mp-row-value.mp-unavailable{color:var(--mp-muted);font-weight:500}.mp-footnote{margin:13px 0 0;color:#9EACC1;font-size:12px;line-height:1.5}.mp-conclusions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:26px}.mp-conclusion{border-top:1px solid rgba(213,187,132,.36);padding-top:12px}.mp-conclusion h3{margin:0;color:#D5BB84;font-size:11px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.mp-conclusion p{margin:8px 0 0;color:#C4CEDD;font-size:13px;line-height:1.55}.mp-close{padding:36px 0 0;text-align:center}.mp-close p{margin:0 auto 20px;color:#D7DFEA;font-size:clamp(17px,2.5vw,22px);line-height:1.4;font-weight:550}.mp-cta{appearance:none;border:1px solid rgba(213,187,132,.48);border-radius:999px;padding:12px 18px;background:rgba(213,187,132,.1);color:#E7D2A6;font:700 13px/1.25 system-ui,sans-serif;cursor:pointer}.mp-cta:hover,.mp-cta:focus-visible{background:rgba(213,187,132,.18);outline:2px solid #D5BB84;outline-offset:3px}
        @media(max-width:680px){.midas-presentation{padding:20px 18px 28px}.mp-hero{padding:40px 0 26px}.mp-hero p{font-size:14px}.mp-section{padding:24px 0}.mp-metrics{grid-template-columns:1fr 1fr;gap:20px 14px}.mp-metric.primary .mp-number{font-size:32px}.mp-metric.secondary{grid-column:1/-1;padding-top:14px;border-top:1px solid var(--mp-line)}.mp-chart-head{display:block}.mp-chart-head h2{font-size:20px}.mp-axis,.mp-row{grid-template-columns:76px minmax(60px,1fr) 82px;gap:8px}.mp-row{min-height:40px}.mp-row-label,.mp-row-value{font-size:12px}.mp-conclusions{grid-template-columns:1fr;gap:16px}.mp-conclusion{display:grid;grid-template-columns:112px 1fr;gap:12px;align-items:start}.mp-conclusion p{margin:0}.mp-close{padding-top:28px}}
        @media(max-width:360px){.mp-axis,.mp-row{grid-template-columns:68px minmax(44px,1fr) 82px;gap:6px}.mp-number{font-size:21px}.mp-metric.primary .mp-number{font-size:28px}}
        @media(max-width:680px){.mp-number{white-space:normal;line-height:1.12}.mp-metric.primary .mp-number{font-size:clamp(21px,6vw,25px)}}
      `}</style>
      <div className="mp-wrap">
        <header className="mp-brand"><span><strong>MIDAS</strong> · Proyección</span><span className="mp-privacy">Presentación · Datos relativos</span></header>

        <section className="mp-hero" aria-labelledby="mp-title">
          <h1 id="mp-title">¿Puede mantenerse el plan sin deteriorar la calidad de vida?</h1>
          <p>Estimaciones bajo los supuestos del escenario evaluado.</p>
          <div className="mp-horizon">Horizonte: <span className={model.horizonYears === null ? 'mp-unavailable' : undefined}>{model.horizonYears === null ? 'No disponible' : `${model.horizonYears} años`}</span></div>
        </section>

        <section className="mp-section" aria-labelledby="mp-indicators-title">
          <h2 className="mp-kicker" id="mp-indicators-title">Señales principales</h2>
          <div className="mp-metrics">
            <div className="mp-metric primary"><div className={`mp-number${model.completionPct === null ? ' mp-unavailable' : ''}`}>{percent(model.completionPct)}</div><div className="mp-label">Completar el horizonte</div><div className="mp-help">Sin agotamiento</div></div>
            <div className="mp-metric primary"><div className={`mp-number${model.qualitySurvivalPct === null ? ' mp-unavailable' : ''}`}>{percent(model.qualitySurvivalPct)}</div><div className="mp-label">Mantener calidad de vida</div><div className="mp-help">Aplica el filtro estricto de calidad definido por MIDAS; no es una medida subjetiva de bienestar.</div></div>
            <div className="mp-metric secondary"><div className={`mp-number${model.severeCutYearsMean === null ? ' mp-unavailable' : ''}`}>{years(model.severeCutYearsMean)}</div><div className="mp-label">Recortes fuertes</div></div>
          </div>
        </section>

        <section className="mp-section" aria-labelledby="mp-scenarios-title">
          <div className="mp-chart-head"><div><h2 id="mp-scenarios-title">El resultado cambia con el entorno</h2><p>Probabilidad de completar el mismo horizonte sin agotamiento</p></div></div>
          <div className="mp-axis" aria-hidden="true"><span /> <div className="mp-ticks"><span>0 %</span><span>50 %</span><span>100 %</span></div><span /></div>
          <div role="img" aria-label="Probabilidad de completar el mismo horizonte sin agotamiento por escenario">
            {model.scenarios.map((scenario) => (
              <div className={`mp-row ${scenario.id}`} key={scenario.id}>
                <div className="mp-row-label">{scenario.label}</div>
                <div className="mp-track">{scenario.completionPct === null ? null : <span className={`mp-dot ${scenarioTone[scenario.id]}`} style={{ '--mp-point': `${scenario.completionPct}%` } as React.CSSProperties} />}</div>
                <div className={`mp-row-value${scenario.completionPct === null ? ' mp-unavailable' : ''}`}>{percent(scenario.completionPct)}</div>
              </div>
            ))}
          </div>
          <p className="mp-footnote">Probabilidad de completar el mismo horizonte sin agotamiento. Cada punto representa un escenario independiente.</p>
        </section>

        <section className="mp-section" aria-label="Conclusiones ejecutivas">
          <div className="mp-conclusions">
            <article className="mp-conclusion"><h3>Duración</h3><p>{model.conclusions.duration}</p></article>
            <article className="mp-conclusion"><h3>Calidad de vida</h3><p>{model.conclusions.quality}</p></article>
            <article className="mp-conclusion"><h3>Fragilidad principal</h3><p>{model.conclusions.fragility}</p></article>
          </div>
        </section>

        <footer className="mp-close">
          <p>Las decisiones futuras pueden cambiar los hábitos presentes.</p>
          <button type="button" className="mp-cta" onClick={onOpenEcosystem}>Ver el ecosistema →</button>
        </footer>
      </div>
    </div>
  );
}
