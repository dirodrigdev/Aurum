import React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Patrimonio } from './pages/Patrimonio';
import { SettingsAurum } from './pages/SettingsAurum';

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
