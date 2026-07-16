import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StrategyDashboardModel } from '../domain/dashboard/strategyDashboardModel';
import { DashboardPage } from './DashboardPage';

export const dashboardTestModel: StrategyDashboardModel = {
  status: 'ready',
  statusMessage: 'Resultado vigente.',
  hero: {
    eyebrow: 'Lectura estratégica · MIDAS M8',
    headline: '¿El plan se sostiene hasta los 88 años?',
    conclusion: 'La estrategia presenta una probabilidad de sostenibilidad del 91,8% hasta los 88 años.',
    tone: 'positive',
    privacyNote: 'Vista de presentación: los valores monetarios permanecen ocultos.',
  },
  primaryMetrics: [
    { id: 'success', label: 'Sostenibilidad hasta los 88 años', value: 0.918, unit: '%', tone: 'positive', detail: 'Probabilidad de completar el horizonte sin agotamiento.' },
    { id: 'ruin', label: 'Agotamiento antes de los 88 años', value: 0.082, unit: '%', tone: 'positive', detail: 'Riesgo complementario al éxito del plan.' },
    { id: 'horizon', label: 'Horizonte evaluado', value: 40, unit: 'años', tone: 'neutral', detail: 'Duración total considerada por el motor.' },
    { id: 'withdrawal-rate', label: 'Tasa inicial de retiro', value: 0.047, unit: '%', tone: 'positive', detail: 'Relación anual inicial.' },
    { id: 'qol-score', label: 'Índice de calidad de vida', value: 78, unit: 'puntos', tone: 'positive', detail: 'Bueno alto' },
  ],
  currentAge: 48,
  targetAge: 88,
  horizonYears: 40,
  scenarioLabel: 'Base',
  rates: [
    { id: 'expected-return', label: 'Retorno real esperado del mix', value: 0.052, detail: 'Promedio ponderado.' },
    { id: 'inflation', label: 'Inflación considerada', value: 0.03, detail: 'Supuesto anual.' },
  ],
  house: { active: true, label: 'Venta de vivienda considerada', detail: 'Liquidez contingente.', probability: 0.18, expectedAge: 71, relativeShare: null, dependence: 'media' },
  riskReserve: { active: true, label: 'Capital de riesgo activado', detail: 'Reserva contingente.', probability: null, expectedAge: null, relativeShare: 0.05, dependence: 'baja' },
  mix: [
    { id: 'equity', label: 'Renta variable', share: 0.6, color: '#63F5B1' },
    { id: 'fixed-income', label: 'Renta fija', share: 0.35, color: '#6D9DFF' },
    { id: 'liquidity', label: 'Liquidez', share: 0.05, color: '#E8C774' },
  ],
  regionalExposure: [
    { id: 'global', label: 'Sleeves globales', share: 0.61, color: '#9A7BFF' },
    { id: 'chile', label: 'Sleeves Chile', share: 0.39, color: '#47C7D8' },
  ],
  layers: [
    { id: 'operational', label: 'Liquidez operativa', horizonLabel: '0–2 años', categories: ['EUR', 'USD utilizable', 'Caja CLP'], role: 'Absorber gasto próximo.' },
    { id: 'growth', label: 'Capa de crecimiento', horizonLabel: 'Largo plazo', categories: ['Renta variable global'], role: 'Sostener crecimiento real.' },
  ],
  scenarios: [
    { id: 'optimistic', label: 'Entorno favorable', success: 0.96, note: 'Comparador vigente.' },
    { id: 'base', label: 'Escenario activo', success: 0.918, note: 'Base' },
    { id: 'pessimistic', label: 'Entorno adverso', success: 0.83, note: 'Comparador vigente.' },
  ],
  quality: [
    { id: 'qualitySurvivalRate', label: 'Supervivencia con calidad', value: 0.61, valueKind: 'percent', status: 'positive', statusLabel: 'Bueno', explanation: 'Filtro estricto de calidad.' },
    { id: 'severeCutYearsMean', label: 'Años medios de recorte severo', value: 1.5, valueKind: 'years', status: 'warning', statusLabel: 'Atención', explanation: 'Tiempo promedio en recorte.' },
  ],
  signals: [
    { id: 'sustainability', label: 'Sostenibilidad general', status: 'positive', statusLabel: 'Saludable', explanation: 'Basado en la probabilidad al horizonte.' },
    { id: 'liquidity', label: 'Liquidez de corto plazo', status: 'positive', statusLabel: 'Saludable', explanation: 'Capa operativa suficiente.' },
    { id: 'house-dependence', label: 'Dependencia de venta de vivienda', status: 'warning', statusLabel: 'Seguimiento', explanation: 'Incidencia de venta en las trayectorias.' },
  ],
  interpretation: {
    strength: 'Sostenibilidad general dentro de rango.',
    mainRisk: 'Dependencia de vivienda para seguimiento.',
    dependence: 'No se observa una dependencia extraordinaria dominante.',
    watchVariable: 'Vigilar retorno real esperado.',
    qualityOfLife: 'Calidad de vida consistente con el escenario.',
    generalState: 'La estrategia mantiene una probabilidad alta de sostenibilidad.',
  },
};

const markup = renderToStaticMarkup(<DashboardPage model={dashboardTestModel} onOpenSimulation={() => {}} onOpenSensitivity={() => {}} onOpenSettings={() => {}} />);

assert(markup.includes('data-testid="midas-dashboard"'));
assert(markup.includes('91,8%'));
assert(markup.includes('8,2%'));
assert(markup.includes('Horizonte evaluado'));
assert(markup.includes('Tasas consideradas'));
assert(markup.includes('Venta prevista alrededor de los 71 años'));
assert(markup.includes('Capital de riesgo'));
assert(markup.includes('Mix estratégico considerado'));
assert(markup.includes('Secuencia de retiro'));
assert(markup.includes('Calidad de vida'));
assert(markup.includes('Semáforos del plan'));
assert(markup.includes('Vista de presentación: los valores monetarios permanecen ocultos'));
assert.equal(markup.includes('title='), false, 'Dashboard must not hide values in native tooltips');
assert.doesNotMatch(markup, /(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
assert.doesNotMatch(markup, /(?:\$|€)\s*\d/);

const emptyMarkup = renderToStaticMarkup(<DashboardPage model={{ ...dashboardTestModel, status: 'empty', statusMessage: 'Ejecuta una simulación para generar los indicadores del Dashboard.' }} onOpenSimulation={() => {}} onOpenSensitivity={() => {}} onOpenSettings={() => {}} />);
assert(emptyMarkup.includes('dashboard-empty-state'));
assert(emptyMarkup.includes('Ejecuta una simulación'));
assert.equal(emptyMarkup.includes('91,8%'), false);

console.log('DashboardPage tests passed');
