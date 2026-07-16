import React from 'react';
import { T } from './theme';

type EcosystemPageProps = {
  onBack: () => void;
};

const apps = [
  { name: 'GastApp', action: 'Observa el gasto', detail: 'Registra, clasifica y detecta hábitos.', mark: '01', tone: '#F1C66D' },
  { name: 'Aurum', action: 'Ordena el patrimonio', detail: 'Consolida la evolución y muestra la salud financiera.', mark: '02', tone: '#63F5B1' },
  { name: 'MIDAS', action: 'Proyecta el futuro', detail: 'Simula escenarios y evalúa sostenibilidad y calidad de vida.', mark: '03', tone: '#8DA2FB' },
] as const;

const capabilities = [
  ['Acceso protegido', 'Cada aplicación utiliza autenticación.'],
  ['Datos persistentes en la nube', 'La información no depende del teléfono o navegador.'],
  ['Aplicaciones conectadas', 'Los datos relevantes pueden alimentar otras capas del ecosistema.'],
  ['Desarrollo versionado', 'Cada cambio queda registrado y controlado.'],
  ['Despliegue web', 'Las versiones se publican y actualizan online.'],
  ['Pruebas automáticas', 'Los flujos principales se verifican antes de cerrar cambios.'],
] as const;

export function EcosystemPage({ onBack }: EcosystemPageProps) {
  return (
    <div className="midas-ecosystem" data-testid="midas-ecosystem" data-privacy-mode="static-no-personal-data">
      <style>{`
        .midas-ecosystem { --eco-ink:#F4F7FC; --eco-muted:#9CA9BC; display:grid; gap:20px; color:var(--eco-ink); }
        .midas-ecosystem * { box-sizing:border-box; }
        .midas-eco-hero,.midas-eco-panel,.midas-eco-close { border:1px solid ${T.border}; background:linear-gradient(155deg,rgba(24,31,47,.98),rgba(13,19,31,.98)); box-shadow:0 22px 60px rgba(1,6,16,.26); }
        .midas-eco-hero { position:relative; overflow:hidden; border-radius:32px; padding:clamp(24px,5vw,52px); background:radial-gradient(circle at 82% 18%,rgba(99,245,177,.14),transparent 25%),radial-gradient(circle at 12% 84%,rgba(91,140,255,.22),transparent 36%),linear-gradient(145deg,#06152F,#0C254A 52%,#07152D); }
        .midas-eco-hero:after { content:''; position:absolute; right:-90px; top:-100px; width:300px; height:300px; border:1px solid rgba(255,255,255,.08); border-radius:50%; box-shadow:inset 0 0 0 44px rgba(255,255,255,.015),inset 0 0 0 88px rgba(99,245,177,.025); }
        .midas-eco-back { position:relative; z-index:1; border:1px solid rgba(255,255,255,.12); border-radius:999px; padding:8px 12px; background:rgba(255,255,255,.045); color:#C7D1E1; font-size:11px; font-weight:800; cursor:pointer; }
        .midas-eco-kicker { margin-top:34px; color:#D9BD8A; font-size:10px; font-weight:850; letter-spacing:.26em; text-transform:uppercase; }
        .midas-eco-hero h1 { position:relative; z-index:1; max-width:820px; margin:14px 0; font-size:clamp(34px,6vw,64px); line-height:.98; letter-spacing:-.055em; }
        .midas-eco-hero p { position:relative; z-index:1; max-width:720px; margin:0; color:#C8D1E0; font-size:clamp(14px,2vw,17px); line-height:1.58; }
        .midas-eco-panel { border-radius:28px; padding:clamp(18px,3vw,28px); }
        .midas-eco-panel-head { margin-bottom:18px; }
        .midas-eco-panel-head span { color:#7F8CA0; font-size:9px; font-weight:850; letter-spacing:.22em; text-transform:uppercase; }
        .midas-eco-panel-head h2 { margin:8px 0 0; font-size:clamp(22px,3vw,30px); letter-spacing:-.035em; }
        .midas-eco-flow { display:grid; gap:10px; }
        .midas-eco-app { min-width:0; padding:18px; border:1px solid rgba(255,255,255,.08); border-radius:22px; background:rgba(255,255,255,.025); }
        .midas-eco-app-top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .midas-eco-app-mark { font:800 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.16em; }
        .midas-eco-app h3 { margin:18px 0 5px; font-size:21px; }
        .midas-eco-app strong { display:block; font-size:13px; }
        .midas-eco-app p { margin:8px 0 0; color:var(--eco-muted); font-size:12px; line-height:1.5; }
        .midas-eco-arrow { display:grid; place-items:center; gap:2px; color:#64738A; font-size:9px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
        .midas-eco-arrow b { color:#63F5B1; font-size:22px; line-height:1; }
        .midas-eco-return { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:16px; border:1px solid rgba(141,162,251,.2); border-radius:999px; padding:10px 14px; color:#AFBFFF; background:rgba(91,140,255,.07); font-size:11px; text-align:center; }
        .midas-eco-synthesis { margin:18px 0 0; text-align:center; color:#E9EEF7; font-size:clamp(17px,2vw,22px); font-weight:850; letter-spacing:-.025em; }
        .midas-eco-capabilities { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
        .midas-eco-capability { min-width:0; min-height:118px; padding:16px; border:1px solid rgba(255,255,255,.07); border-radius:19px; background:rgba(255,255,255,.025); }
        .midas-eco-capability span { display:grid; place-items:center; width:28px; height:28px; border-radius:10px; background:rgba(99,245,177,.09); color:#63F5B1; font-size:12px; }
        .midas-eco-capability h3 { margin:12px 0 5px; font-size:13px; }
        .midas-eco-capability p { margin:0; color:var(--eco-muted); font-size:11px; line-height:1.45; }
        .midas-eco-stack { margin:16px 0 0; color:#738198; font:700 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; text-align:center; letter-spacing:.08em; }
        .midas-eco-close { border-color:rgba(99,245,177,.16); border-radius:28px; padding:clamp(22px,4vw,38px); text-align:center; background:radial-gradient(circle at top,rgba(99,245,177,.08),transparent 45%),#0D1B32; }
        .midas-eco-close h2 { margin:0; font-size:clamp(25px,4vw,40px); letter-spacing:-.045em; }
        .midas-eco-close p { max-width:630px; margin:12px auto 0; color:#AAB6C8; line-height:1.55; }
        @media (min-width:820px) { .midas-eco-flow { grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr) 72px minmax(0,1fr); align-items:stretch; } .midas-eco-arrow b { transform:rotate(-90deg); } .midas-eco-capabilities { grid-template-columns:repeat(3,minmax(0,1fr)); } }
        @media (max-width:540px) { .midas-eco-hero,.midas-eco-panel,.midas-eco-close { border-radius:24px; } .midas-eco-capabilities { grid-template-columns:1fr; } .midas-eco-capability { min-height:0; } }
      `}</style>

      <section className="midas-eco-hero">
        <button type="button" className="midas-eco-back" onClick={onBack}>← Volver al Dashboard</button>
        <div className="midas-eco-kicker">Ecosistema financiero personal</div>
        <h1>Un ecosistema para entender el presente y proyectar el futuro</h1>
        <p>Tres aplicaciones conectadas convierten el comportamiento cotidiano en una visión patrimonial y una estrategia de largo plazo.</p>
      </section>

      <section className="midas-eco-panel" aria-labelledby="midas-eco-flow-title">
        <div className="midas-eco-panel-head"><span>Capa 1 · Flujo funcional</span><h2 id="midas-eco-flow-title">De la observación a la decisión</h2></div>
        <div className="midas-eco-flow">
          {apps.map((app, index) => (
            <React.Fragment key={app.name}>
              <article className="midas-eco-app" data-ecosystem-app={app.name}>
                <div className="midas-eco-app-top"><span className="midas-eco-app-mark" style={{ color: app.tone }}>{app.mark}</span><span aria-hidden="true" style={{ color: app.tone }}>◆</span></div>
                <h3>{app.name}</h3><strong style={{ color: app.tone }}>{app.action}</strong><p>{app.detail}</p>
              </article>
              {index < apps.length - 1 ? <div className="midas-eco-arrow" aria-label={`${app.name} alimenta ${apps[index + 1].name}`}><span>alimenta</span><b>↓</b></div> : null}
            </React.Fragment>
          ))}
        </div>
        <div className="midas-eco-return"><span aria-hidden="true">↺</span> Las decisiones futuras pueden ajustar el comportamiento presente.</div>
        <p className="midas-eco-synthesis">GastApp observa. Aurum integra. MIDAS proyecta.</p>
      </section>

      <section className="midas-eco-panel" aria-labelledby="midas-eco-tech-title">
        <div className="midas-eco-panel-head"><span>Capa 2 · Base técnica</span><h2 id="midas-eco-tech-title">Una estructura simple, protegida y verificable</h2></div>
        <div className="midas-eco-capabilities">
          {capabilities.map(([title, detail], index) => <article className="midas-eco-capability" key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{detail}</p></article>)}
        </div>
        <p className="midas-eco-stack">Firebase Auth · Firestore · GitHub · Vercel · Playwright</p>
      </section>

      <section className="midas-eco-close">
        <h2>Comportamiento, patrimonio y futuro en una sola narrativa.</h2>
        <p>El sistema conecta lo que ocurre cada día con las decisiones que sostienen el largo plazo.</p>
      </section>
    </div>
  );
}
