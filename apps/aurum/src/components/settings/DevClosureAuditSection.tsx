import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ChevronDown } from 'lucide-react';
import { auth } from '../../services/firebase';
import { readAuthenticatedClosureAudit } from '../../services/closureAuditDiagnostic';
import { Button, Card } from '../Components';

const downloadAudit = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    if (document.body.contains(link)) document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};

const today = () => new Date().toISOString().slice(0, 10);

const DevClosureAuditSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(() => Boolean(auth.currentUser?.uid));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, (user) => setAuthenticated(Boolean(user?.uid))), []);

  if (!import.meta.env.DEV) return null;

  const exportAudit = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await readAuthenticatedClosureAudit();
      if (result.status === 'unauthenticated') {
        setAuthenticated(false);
        setMessage('Inicia sesión en Aurum para ejecutar el diagnóstico.');
        return;
      }
      if (result.status === 'error') {
        setMessage(result.message);
        return;
      }
      const filename = `aurum-closures-audit-${today()}.json`;
      downloadAudit(JSON.stringify(result.audit, null, 2), filename);
      const month = result.audit.latestConfirmedMonthKey || '—';
      setMessage(`${result.audit.closureCount} cierres encontrados. Último cierre: ${month}. Auditoría descargada correctamente.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border border-violet-200 bg-violet-50/50 p-3">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((value) => !value)}>
        <div>
          <div className="text-sm font-semibold text-slate-900">Diagnóstico local de cierres</div>
          <div className="text-[11px] text-slate-500">Solo desarrollo · lectura sanitizada</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          {!authenticated ? (
            <div>Inicia sesión en Aurum para ejecutar el diagnóstico.</div>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportAudit()}>
              {busy ? 'Leyendo cierres...' : 'Exportar auditoría read-only'}
            </Button>
          )}
          {!!message && <div className="text-violet-900">{message}</div>}
        </div>
      )}
    </Card>
  );
};

export default DevClosureAuditSection;
