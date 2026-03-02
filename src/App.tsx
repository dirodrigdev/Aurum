import React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Patrimonio } from './pages/Patrimonio';

const SettingsAurum: React.FC = () => {
  return (
    <div className="p-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-lg font-bold text-slate-900">Aurum</div>
        <div className="mt-2 text-sm text-slate-600">
          Base inicial lista. El siguiente paso es conectar APIs bancarias/inversiones y reglas OCR avanzadas.
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/patrimonio" replace />} />
          <Route path="/patrimonio" element={<Patrimonio />} />
          <Route path="/settings" element={<SettingsAurum />} />
        </Route>
        <Route path="*" element={<Navigate to="/patrimonio" replace />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
