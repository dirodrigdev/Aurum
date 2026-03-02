import React, { useState } from 'react';
import { Card, Input } from '../components/Components';
import { loadFxRates, saveFxRates } from '../services/wealthStorage';

export const SettingsAurum: React.FC = () => {
  const [fx, setFx] = useState(() => loadFxRates());

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4">
        <div className="text-lg font-bold text-slate-900">Ajustes</div>
        <div className="mt-1 text-sm text-slate-600">Configuración general de Aurum.</div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Tipos de cambio (consolidado CLP)</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">USD a CLP</div>
            <Input
              value={fx.usdClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, usdClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">EUR a CLP</div>
            <Input
              value={fx.eurClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, eurClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">UF a CLP</div>
            <Input
              value={fx.ufClp}
              type="number"
              onChange={(e) => {
                const next = { ...fx, ufClp: Number(e.target.value) || 0 };
                setFx(next);
                saveFxRates(next);
              }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};
