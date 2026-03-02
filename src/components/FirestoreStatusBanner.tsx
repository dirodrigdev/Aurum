import React, { useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, Lock, WifiOff } from 'lucide-react';
import { FirestoreStatus, subscribeFirestoreStatus } from '../services/firestoreStatus';
import { cn } from './Components';

export const FirestoreStatusBanner = () => {
  const [status, setStatus] = useState<FirestoreStatus>({ state: 'checking', at: 0 });

  useEffect(() => {
    return subscribeFirestoreStatus(setStatus);
  }, []);

  if (status.state === 'ok' || status.state === 'checking') return null;

  let msg = status.code ? `Error Firestore (${status.code})` : 'Error de conexión';
  let Icon = AlertTriangle;
  let colorClass = 'bg-red-500';

  if (status.state === 'quota') {
    msg = 'Cuota de lectura excedida. Espera unas horas.';
    Icon = CloudOff;
    colorClass = 'bg-orange-500';
  } else if (status.state === 'denied') {
    msg = 'Acceso denegado (revisar Settings > UID)';
    Icon = Lock;
    colorClass = 'bg-red-600';
  } else if (status.state === 'unavailable') {
    msg = 'Sin conexión a internet';
    Icon = WifiOff;
    colorClass = 'bg-slate-500';
  }

  return (
    <div className={cn('text-white px-4 py-2 text-xs font-bold flex items-center justify-center gap-2', colorClass)}>
      <Icon size={14} />
      <span>{msg}</span>
    </div>
  );
};
