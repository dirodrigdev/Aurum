import React from 'react';

type EcosystemPageProps = { onBack: () => void };

const apps = [
  { name: 'GastApp', action: 'observa', detail: 'Registra y revela patrones del comportamiento cotidiano.', href: 'https://gastapp-chi.vercel.app/#/presentation' },
  { name: 'Aurum', action: 'integra', detail: 'Ordena y evalúa la situación patrimonial actual.', href: 'https://aurum-chi-eight.vercel.app/#/presentation' },
  { name: 'MIDAS', action: 'proyecta', detail: 'Evalúa la sostenibilidad futura y la calidad de vida.', href: '#/presentation' },
] as const;

export function EcosystemPage({ onBack }: EcosystemPageProps) {
  return (
    <main className="midas-ecosystem" data-testid="midas-ecosystem" data-privacy-mode="static-no-personal-data">
      <style>{`
        .midas-ecosystem{min-height:100vh;background:#0B1220;color:#F2F5FB;padding:clamp(28px,6vw,64px) 22px;font-family:"SF Pro Display","Helvetica Neue",system-ui,sans-serif}.midas-ecosystem *{box-sizing:border-box}.midas-eco-wrap{max-width:1000px;margin:0 auto}.midas-eco-kicker{color:#D5BB84;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.midas-eco-hero{padding:54px 0 44px}.midas-eco-hero h1{max-width:780px;margin:12px 0 0;font-size:clamp(34px,6vw,58px);line-height:1.04;letter-spacing:-.045em;font-weight:650}.midas-eco-flow{display:grid;grid-template-columns:1fr 58px 1fr 58px 1fr;align-items:center;border-top:1px solid rgba(205,218,242,.18);border-bottom:1px solid rgba(205,218,242,.18);padding:28px 0}.midas-eco-step{min-width:0}.midas-eco-step a{color:#F2F5FB;text-decoration:none;font-size:clamp(20px,3vw,29px);font-weight:700;letter-spacing:-.03em}.midas-eco-step a:hover,.midas-eco-step a:focus-visible{color:#D5BB84}.midas-eco-step span{display:block;margin-top:8px;color:#D5BB84;font-size:13px}.midas-eco-step p{max-width:250px;margin:12px 0 0;color:#A5B0C2;font-size:12px;line-height:1.55}.midas-eco-arrow{text-align:center;color:#8390A5;font-size:20px}.midas-eco-connection{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:25px 0;border-bottom:1px solid rgba(205,218,242,.12)}.midas-eco-connection p{margin:0;color:#B8C3D5;font-size:13px;line-height:1.55}.midas-eco-return{max-width:700px;margin:44px auto 0;text-align:center;color:#E3E9F2;font-size:clamp(18px,3vw,25px);line-height:1.4;font-weight:550}.midas-eco-note{max-width:620px;margin:12px auto 0;text-align:center;color:#8997AD;font-size:12px;line-height:1.55}.midas-eco-links{display:flex;justify-content:center;gap:22px;flex-wrap:wrap;margin-top:30px}.midas-eco-links a,.midas-eco-links button{padding:0;border:0;background:none;color:#D5BB84;font:600 12px system-ui,sans-serif;text-decoration:underline;text-underline-offset:4px;cursor:pointer}.midas-eco-links .midas-eco-back{color:#AAB6C8}@media(max-width:650px){.midas-ecosystem{padding:24px 18px}.midas-eco-hero{padding:44px 0 34px}.midas-eco-flow{grid-template-columns:1fr;gap:18px;padding:22px 0}.midas-eco-step p{max-width:none;margin-top:7px}.midas-eco-arrow{display:none}.midas-eco-step:nth-child(1)::after,.midas-eco-step:nth-child(3)::after{content:'↓';display:block;margin:15px 0 0 0;color:#8390A5;font-size:18px}.midas-eco-connection{grid-template-columns:1fr;gap:12px;padding:19px 0}.midas-eco-return{margin-top:32px}}
      `}</style>
      <div className="midas-eco-wrap">
        <header className="midas-eco-hero">
          <div className="midas-eco-kicker">El ecosistema</div>
          <h1>Del comportamiento cotidiano a las decisiones de largo plazo</h1>
        </header>
        <section className="midas-eco-flow" aria-label="GastApp observa, Aurum integra y MIDAS proyecta">
          {apps.map((app, index) => (
            <React.Fragment key={app.name}>
              <div className="midas-eco-step">
                <a href={app.href}>{app.name}</a>
                <span>{app.action}</span>
                <p>{app.detail}</p>
              </div>
              {index < apps.length - 1 ? <div className="midas-eco-arrow" aria-hidden="true">→</div> : null}
            </React.Fragment>
          ))}
        </section>
        <section className="midas-eco-connection" aria-label="Cómo se conectan las aplicaciones">
          <p><strong>GastApp → Aurum.</strong> La información mensual de GastApp alimenta análisis en Aurum.</p>
          <p><strong>Aurum → MIDAS.</strong> La base patrimonial de Aurum sirve de partida para MIDAS.</p>
        </section>
        <p className="midas-eco-return">Las decisiones futuras pueden modificar los hábitos presentes.</p>
        <p className="midas-eco-note">Es una relación entre decisiones y comportamiento, no un envío automático de datos de vuelta.</p>
        <nav className="midas-eco-links" aria-label="Navegación del ecosistema">
          <a href="https://gastapp-chi.vercel.app/#/presentation">Volver a GastApp</a>
          <button type="button" className="midas-eco-back" onClick={onBack}>Volver a MIDAS</button>
        </nav>
      </div>
    </main>
  );
}
