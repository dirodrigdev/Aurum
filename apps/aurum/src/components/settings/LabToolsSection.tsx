import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Card } from '../Components';

interface LabToolsSectionProps {
  open: boolean;
  seedingDemo: boolean;
  repairingMarch2025: boolean;
  seedDemoMessage: string;
  onToggle: () => void;
  onLoadDemo: () => void;
  onRepairMarch2025: () => void;
}

export const LabToolsSection: React.FC<LabToolsSectionProps> = ({
  open,
  seedingDemo,
  repairingMarch2025,
  seedDemoMessage,
  onToggle,
  onLoadDemo,
  onRepairMarch2025,
}) => {
  return (
    <Card className="border border-indigo-200 bg-indigo-50/40 p-3">
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={onToggle}>
        <div>
          <div className="text-sm font-semibold text-slate-900">Laboratorio</div>
          <div className="text-[11px] text-slate-500">Herramientas de prueba</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs">
          <Button variant="secondary" disabled={seedingDemo} onClick={onLoadDemo}>
            {seedingDemo ? 'Cargando datos de prueba...' : 'Cargar datos de prueba'}
          </Button>
          <Button variant="outline" disabled={repairingMarch2025} onClick={onRepairMarch2025}>
            {repairingMarch2025 ? 'Reparando 2025-03...' : 'Reparar EUR/CLP 2025-03'}
          </Button>
          {!!seedDemoMessage && <div className="text-indigo-800">{seedDemoMessage}</div>}
        </div>
      )}
    </Card>
  );
};
