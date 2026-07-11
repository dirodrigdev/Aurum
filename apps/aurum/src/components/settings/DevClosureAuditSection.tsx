import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ChevronDown } from 'lucide-react';
import { auth } from '../../services/firebase';
import {
  isClosureAuditAuthorizedUser,
  readAuthenticatedClosureAudit,
} from '../../services/closureAuditDiagnostic';
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
  const [authResolved, setAuthResolved] = useState(false);
  const [authorized, setAuthorized] = useState(() => false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        setAuthorized(isClosureAuditAuthorizedUser(user));
        setAuthResolved(true);
      }),
    [],
  );

  if (!authResolved || !authorized) return null;

  const exportAudit = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await readAuthenticatedClosureAudit();
      if (result.status === 'unauthenticated') {
        setMessage('Inicia sesión en Aurum para ejecutar el diagnóstico.');
        return;
      }
      if (result.status === 'unauthorized') {
        setMessage('No autorizado para ejecutar este diagnóstico.');
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
          <div className="text-sm font-semibold text-slate-900">Diagnóstico temporal de cierres</div>
          <div className="text-[11px] text-slate-500">Lectura sanitizada sin modificaciones</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <div>Genera una auditoría sanitizada y de solo lectura de los cierres asociados a esta cuenta.</div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportAudit()}>
            {busy ? 'Leyendo cierres...' : 'Exportar auditoría read-only'}
          </Button>
          {!!message && <div className="text-violet-900">{message}</div>}
        </div>
      )}
    </Card>
  );
};

export default DevClosureAuditSection;
