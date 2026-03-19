import React, { useMemo, useState } from 'react';
import type { CashflowEvent, ModelParameters } from '../domain/model/types';
import { T, css } from './theme';

type NumberInputProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
};

const getWeight = (params: ModelParameters, path: string) => {
  switch (path) {
    case 'weights.rvGlobal':
      return params.weights.rvGlobal;
    case 'weights.rfGlobal':
      return params.weights.rfGlobal;
    case 'weights.rvChile':
      return params.weights.rvChile;
    case 'weights.rfChile':
    default:
      return params.weights.rfChile;
  }
};

function NumberInput({ label, value, onChange, suffix, min, max, step = 0.01 }: NumberInputProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: T.textSecondary, fontSize: 12 }}>{label}</span>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 10, padding: '10px 12px',
      }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: T.textPrimary,
            fontSize: 14,
            outline: 'none',
          }}
        />
        {suffix && <span style={{ color: T.textMuted, fontSize: 12 }}>{suffix}</span>}
      </div>
    </label>
  );
}

export function ParamSheet({
  open,
  onClose,
  params,
  onUpdate,
  cashflowEvents,
  onCashflowEventsChange,
  onReset,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  params: ModelParameters;
  onUpdate: (path: string, value: number) => void;
  cashflowEvents: CashflowEvent[];
  onCashflowEventsChange: (next: CashflowEvent[]) => void;
  onReset: () => void;
  onRun: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [eventForm, setEventForm] = useState({
    description: '',
    year: 1,
    type: 'inflow' as CashflowEvent['type'],
    amount: 0,
    currency: 'CLP' as CashflowEvent['currency'],
  });
  const weightSum = useMemo(
    () => params.weights.rvGlobal + params.weights.rfGlobal + params.weights.rvChile + params.weights.rfChile,
    [params.weights],
  );

  const addCashflowEvent = () => {
    const description = eventForm.description.trim();
    if (!description || !Number.isFinite(eventForm.amount) || eventForm.amount <= 0) return;
    const nextEvent: CashflowEvent = {
      id: `${Date.now().toString()}${Math.random().toString(36).slice(2)}`,
      description,
      month: (Math.max(1, Math.round(eventForm.year)) - 1) * 12 + 1,
      type: eventForm.type,
      amount: Math.abs(eventForm.amount),
      currency: eventForm.currency,
    };
    onCashflowEventsChange([...cashflowEvents, nextEvent]);
    setEventForm((prev) => ({ ...prev, description: '', amount: 0 }));
  };

  const removeCashflowEvent = (id: string) => {
    onCashflowEventsChange(cashflowEvents.filter((event) => event.id !== id));
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: open ? 40 : -1,
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div style={{
        position: 'absolute', inset: 0,
        background: open ? 'rgba(0,0,0,0.45)' : 'transparent',
        transition: 'background 180ms ease',
      }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          transform: open ? 'translateY(0)' : 'translateY(105%)',
          transition: 'transform 250ms ease',
          background: T.surfaceEl,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          border: `1px solid ${T.border}`,
          borderBottom: 'none',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 999, background: T.border, marginTop: 8 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 700 }}>Parámetros</div>
          <button
            onClick={onReset}
            style={{ background: 'transparent', border: 'none', color: T.primary, fontWeight: 700, cursor: 'pointer' }}
          >
            Reset
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '12px 16px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>BÁSICO</div>
          <NumberInput
            label="Capital inicial"
            value={params.capitalInitial}
            onChange={(v) => onUpdate('capitalInitial', v)}
            suffix="$ CLP"
            step={1_000_000}
          />
          <NumberInput
            label="Gasto Fase 1 (EUR/mes)"
            value={params.spendingPhases[0]?.amountReal ?? 0}
            onChange={(v) => onUpdate('spendingPhases.0.amountReal', v)}
            suffix="€"
          />
          <NumberInput
            label="Gasto Fase 2 (MM CLP/mes)"
            value={params.spendingPhases[1]?.amountReal ?? 0}
            onChange={(v) => onUpdate('spendingPhases.1.amountReal', v)}
            suffix="$"
            step={100000}
          />
          <NumberInput
            label="Gasto Fase 3 (MM CLP/mes)"
            value={params.spendingPhases[2]?.amountReal ?? 0}
            onChange={(v) => onUpdate('spendingPhases.2.amountReal', v)}
            suffix="$"
            step={100000}
          />

          <div style={{ marginTop: 4 }}>
            <div style={{ color: T.textSecondary, fontSize: 12, marginBottom: 8 }}>Pesos portafolio</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([
                ['RV Global', 'weights.rvGlobal'],
                ['RF Global', 'weights.rfGlobal'],
                ['RV Chile', 'weights.rvChile'],
                ['RF Chile UF', 'weights.rfChile'],
              ] as const).map(([label, path]) => (
                <div key={path}>
                  <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 4 }}>{label}</div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={getWeight(params, path)}
                    onChange={(e) => onUpdate(path, Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ ...css.mono, color: T.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {(getWeight(params, path) * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 6, ...css.mono, fontSize: 12, color: Math.abs(weightSum - 1) < 0.001 ? T.textSecondary : T.warning }}>
              Total: {(weightSum * 100).toFixed(0)}% {Math.abs(weightSum - 1) > 0.001 ? ' · Debe sumar 100%' : ''}
            </div>
          </div>

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: T.textMuted,
              fontWeight: 600,
              fontSize: 12,
              textAlign: 'left',
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            {showAdvanced ? 'Ocultar ajustes avanzados ▴' : 'Ver ajustes avanzados ▾'}
          </button>

          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
              <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>AVANZADO</div>
              <NumberInput
                label="IPC Chile anual"
                value={params.inflation.ipcChileAnnual}
                onChange={(v) => onUpdate('inflation.ipcChileAnnual', v)}
                suffix="‰"
                step={0.001}
              />
              <NumberInput
                label="HICP Eurozona anual"
                value={params.inflation.hipcEurAnnual}
                onChange={(v) => onUpdate('inflation.hipcEurAnnual', v)}
                suffix="‰"
                step={0.001}
              />
              <NumberInput
                label="TCREAL LT (PRELIMINARY)"
                value={params.fx.tcrealLT}
                onChange={(v) => onUpdate('fx.tcrealLT', v)}
                step={0.1}
              />
              <NumberInput
                label="Block length (bootstrap)"
                value={params.simulation.blockLength}
                onChange={(v) => onUpdate('simulation.blockLength', v)}
                step={1}
              />
              <NumberInput
                label="N° simulaciones"
                value={params.simulation.nSim}
                onChange={(v) => onUpdate('simulation.nSim', v)}
                step={100}
              />
              <NumberInput
                label="Fee anual"
                value={params.feeAnnual}
                onChange={(v) => onUpdate('feeAnnual', v)}
                step={0.0005}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>EVENTOS DE CAJA</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Descripción</span>
              <input
                type="text"
                value={eventForm.description}
                placeholder="ej: Herencia, Compra auto"
                onChange={(e) => setEventForm((prev) => ({ ...prev, description: e.target.value }))}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: T.textPrimary,
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <NumberInput
                label="Año"
                value={eventForm.year}
                onChange={(v) => setEventForm((prev) => ({ ...prev, year: Math.max(1, Math.min(40, Math.round(v))) }))}
                min={1}
                max={40}
                step={1}
              />
              <NumberInput
                label="Monto"
                value={eventForm.amount}
                onChange={(v) => setEventForm((prev) => ({ ...prev, amount: Math.max(0, v) }))}
                step={1}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textSecondary, fontSize: 12 }}>Tipo</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                  {([
                    ['Ingreso', 'inflow'],
                    ['Retiro', 'outflow'],
                  ] as const).map(([label, value]) => {
                    const active = eventForm.type === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setEventForm((prev) => ({ ...prev, type: value }))}
                        style={{
                          background: active ? T.primary : T.surface,
                          color: active ? '#fff' : T.textSecondary,
                          border: `1px solid ${active ? T.primary : T.border}`,
                          borderRadius: 10,
                          padding: '10px 12px',
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: T.textSecondary, fontSize: 12 }}>Moneda</span>
                <select
                  value={eventForm.currency}
                  onChange={(e) => setEventForm((prev) => ({ ...prev, currency: e.target.value as CashflowEvent['currency'] }))}
                  style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    color: T.textPrimary,
                    fontSize: 14,
                    outline: 'none',
                  }}
                >
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={addCashflowEvent}
              style={{
                alignSelf: 'flex-start',
                background: T.surface,
                color: T.primary,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Agregar evento
            </button>

            {cashflowEvents.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cashflowEvents.map((event) => {
                  const year = Math.floor((event.month - 1) / 12) + 1;
                  const isInflow = event.type === 'inflow';
                  const sign = isInflow ? '+' : '−';
                  const color = isInflow ? '#2f8f4e' : '#c44747';
                  return (
                    <div
                      key={event.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        background: T.surface,
                        border: `1px solid ${T.border}`,
                        borderRadius: 10,
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ color, fontWeight: 800, fontSize: 12 }}>
                          {isInflow ? '↑' : '↓'} Año {year} — {event.description}
                        </div>
                        <div style={{ color: T.textMuted, fontSize: 11 }}>
                          {sign}${event.amount.toLocaleString('es-CL')} {event.currency}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCashflowEvent(event.id)}
                        style={{
                          background: 'transparent',
                          border: `1px solid ${T.border}`,
                          color: T.textSecondary,
                          borderRadius: 999,
                          width: 28,
                          height: 28,
                          cursor: 'pointer',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, background: T.surfaceEl, borderTop: `1px solid ${T.border}` }}>
          <button
            onClick={() => { onRun(); onClose(); }}
            style={{
              width: '100%',
              background: T.primary,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '14px 0',
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            ▶ Ejecutar simulación
          </button>
        </div>
      </div>
    </div>
  );
}
