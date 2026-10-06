import React from 'react';
import { AurumWordmark } from '../components/AurumWordmark';

const apps = [
  { name: 'GastApp', verb: 'observa', color: 'text-emerald-800', detail: 'Hábitos y cambios cotidianos.' },
  { name: 'aurum', verb: 'integra', color: 'text-blue-800', detail: 'Estructura y evolución patrimonial.' },
  { name: 'MIDAS', verb: 'proyecta', color: 'text-indigo-700', detail: 'Sostenibilidad y calidad de vida.' },
] as const;

export const EcosystemAurum: React.FC = () => <div className="min-h-screen bg-[#f7f7f3] text-slate-950" data-testid="aurum-ecosystem">
  <div className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
    <header className="flex items-center justify-between border-b border-slate-200 py-5 text-sm">
      <span className="font-semibold">GastApp · <AurumWordmark /> · MIDAS</span>
      <span className="text-xs text-slate-500">Presentación · Datos relativos</span>
    </header>
    <main>
      <section className="max-w-4xl pb-10 pt-12 sm:pt-16">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Ecosistema</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Del comportamiento cotidiano a las decisiones de largo plazo</h1>
      </section>
      <section className="border-y border-slate-200 py-9" aria-label="Mapa de las aplicaciones">
        <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-start">
          {apps.map((app, index) => <React.Fragment key={app.name}>
            <div><p className={`text-xl font-semibold ${app.color}`}>{app.name === 'aurum' ? <AurumWordmark /> : app.name} <span className="font-normal text-slate-700">{app.verb}</span></p><p className="mt-2 text-sm text-slate-600">{app.detail}</p></div>
            {index < 2 && <div className="text-slate-400" aria-hidden="true"><span className="md:hidden">↓</span><span className="hidden md:inline">→</span></div>}
          </React.Fragment>)}
        </div>
        <div className="mt-9 grid gap-4 text-sm text-slate-700 sm:grid-cols-2">
          <p><strong>GastApp → <AurumWordmark />:</strong> La información mensual de GastApp alimenta análisis en <AurumWordmark />.</p>
          <p><strong><AurumWordmark /> → MIDAS:</strong> La base patrimonial de <AurumWordmark /> sirve de partida para MIDAS.</p>
        </div>
      </section>
      <section className="max-w-3xl py-12">
        <h2 className="text-2xl font-semibold">Las decisiones futuras pueden modificar los hábitos presentes.</h2>
        <p className="mt-3 text-sm text-slate-600">Es una relación entre decisiones y comportamiento, no un envío automático de datos de vuelta.</p>
      </section>
      <a href="https://gastapp-chi.vercel.app/#/presentation" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">← Volver a GastApp</a>
    </main>
  </div>
</div>;
