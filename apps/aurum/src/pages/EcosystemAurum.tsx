import React from 'react';
import { ArrowDown, ArrowLeft, BadgeCheck, Cloud, GitBranch, Globe2, Landmark, Link2, ReceiptText, RotateCcw, ShieldCheck, Telescope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Components';

const apps = [
  { name: 'GastApp', action: 'Observa el gasto', detail: 'Registra, clasifica y detecta hábitos.', icon: ReceiptText, accent: 'text-amber-700', surface: 'border-amber-200 bg-amber-50/80' },
  { name: 'Aurum', action: 'Ordena el patrimonio', detail: 'Consolida la evolución y muestra la salud financiera.', icon: Landmark, accent: 'text-emerald-700', surface: 'border-emerald-200 bg-emerald-50/80' },
  { name: 'MIDAS', action: 'Proyecta el futuro', detail: 'Simula escenarios y evalúa sostenibilidad y calidad de vida.', icon: Telescope, accent: 'text-blue-700', surface: 'border-blue-200 bg-blue-50/80' },
] as const;

const capabilities = [
  { title: 'Acceso protegido', detail: 'Cada aplicación utiliza autenticación.', icon: ShieldCheck },
  { title: 'Datos persistentes en la nube', detail: 'La información no depende del teléfono o navegador.', icon: Cloud },
  { title: 'Aplicaciones conectadas', detail: 'Los datos relevantes pueden alimentar otras capas del ecosistema.', icon: Link2 },
  { title: 'Desarrollo versionado', detail: 'Cada cambio queda registrado y controlado.', icon: GitBranch },
  { title: 'Despliegue web', detail: 'Las versiones se publican y actualizan online.', icon: Globe2 },
  { title: 'Pruebas automáticas', detail: 'Los flujos principales se verifican antes de cerrar cambios.', icon: BadgeCheck },
] as const;

export const EcosystemAurum: React.FC = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('aurum:presentation-route', { detail: { active: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent('aurum:presentation-route', { detail: { active: false } }));
    };
  }, []);

  return (
    <div className="space-y-5 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_32%)] px-3 py-3 sm:px-5" data-testid="aurum-ecosystem" data-privacy-mode="static-no-personal-data">
      <section className="relative overflow-hidden rounded-[32px] border border-[#5c4b3d] bg-[radial-gradient(circle_at_top_right,_rgba(99,245,177,0.11),transparent_30%),linear-gradient(145deg,#071834_0%,#0d2449_52%,#08142d_100%)] p-5 text-white shadow-[0_28px_80px_rgba(3,10,26,0.3)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border border-white/10 shadow-[inset_0_0_0_42px_rgba(255,255,255,0.018),inset_0_0_0_84px_rgba(99,245,177,0.025)]" />
        <button type="button" onClick={() => navigate('/dashboard')} className="relative inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"><ArrowLeft className="h-4 w-4" />Volver al Dashboard</button>
        <div className="relative mt-8 text-[10px] font-semibold uppercase tracking-[0.3em] text-[#d5c0a6]">Ecosistema financiero personal</div>
        <h1 className="relative mt-3 max-w-3xl text-[34px] font-semibold leading-[0.98] tracking-[-0.055em] sm:text-[52px]">Un ecosistema para entender el presente y proyectar el futuro</h1>
        <p className="relative mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">Tres aplicaciones conectadas convierten el comportamiento cotidiano en una visión patrimonial y una estrategia de largo plazo.</p>
      </section>

      <Card className="rounded-[28px] border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">Capa 1 · Flujo funcional</div>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900">De la observación a la decisión</h2>
        <div className="mt-5 grid gap-2 lg:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)_56px_minmax(0,1fr)] lg:items-stretch">
          {apps.map((app, index) => {
            const Icon = app.icon;
            return <React.Fragment key={app.name}><article className={`min-w-0 rounded-2xl border p-4 ${app.surface}`} data-ecosystem-app={app.name}><div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 ${app.accent}`}><Icon className="h-5 w-5" /></div><h3 className="mt-4 text-xl font-semibold text-slate-900">{app.name}</h3><div className={`mt-1 text-sm font-semibold ${app.accent}`}>{app.action}</div><p className="mt-2 text-sm leading-relaxed text-slate-600">{app.detail}</p></article>{index < apps.length - 1 ? <div className="flex items-center justify-center gap-1 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:flex-col"><span>alimenta</span><ArrowDown className="h-5 w-5 text-emerald-500 lg:-rotate-90" aria-label={`${app.name} alimenta ${apps[index + 1].name}`} /></div> : null}</React.Fragment>;
          })}
        </div>
        <div className="mx-auto mt-5 flex max-w-xl items-center justify-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-2.5 text-center text-xs text-blue-700"><RotateCcw className="h-4 w-4 shrink-0" />Las decisiones futuras pueden ajustar el comportamiento presente.</div>
        <p className="mt-5 text-center text-xl font-semibold tracking-[-0.03em] text-slate-900">GastApp observa. Aurum integra. MIDAS proyecta.</p>
      </Card>

      <Card className="rounded-[28px] border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">Capa 2 · Base técnica</div>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900">Una estructura simple, protegida y verificable</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((item) => { const Icon = item.icon; return <article key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"><div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm"><Icon className="h-[18px] w-[18px]" /></div><h3 className="mt-3 text-sm font-semibold text-slate-900">{item.title}</h3><p className="mt-1 text-xs leading-relaxed text-slate-600">{item.detail}</p></article>; })}
        </div>
        <p className="mt-5 text-center font-mono text-[10px] leading-relaxed tracking-[0.08em] text-slate-500">Firebase Auth · Firestore · GitHub · Vercel · Playwright</p>
      </Card>

      <section className="rounded-[28px] border border-emerald-400/15 bg-[#0a1630] px-5 py-8 text-center text-white shadow-[0_18px_50px_rgba(3,10,26,0.2)] sm:px-8">
        <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.045em] sm:text-[38px]">Comportamiento, patrimonio y futuro en una sola narrativa.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">El sistema conecta lo que ocurre cada día con las decisiones que sostienen el largo plazo.</p>
      </section>
    </div>
  );
};
