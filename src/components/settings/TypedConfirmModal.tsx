import React, { useEffect, useState } from 'react';
import { Button, Card, Input } from '../Components';

interface TypedConfirmModalProps {
  open: boolean;
  busy?: boolean;
  title: string;
  message: string;
  expectedText: string;
  expectedHint?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const TypedConfirmModal: React.FC<TypedConfirmModalProps> = ({
  open,
  busy = false,
  title,
  message,
  expectedText,
  expectedHint,
  confirmText = 'Continuar',
  onCancel,
  onConfirm,
}) => {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  if (!open) return null;

  const enabled = typed === expectedText && !busy;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/55 px-4">
      <Card className="w-full max-w-md space-y-4 border border-red-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.35)]">
        <div>
          <div className="text-lg font-semibold text-red-800">{title}</div>
          <div className="mt-2 text-sm text-slate-600">{message}</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          Escribe exactamente <span className="font-semibold">{expectedHint || expectedText}</span> para habilitar la
          acción.
        </div>
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={expectedText}
          autoComplete="off"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!enabled}>
            {busy ? 'Procesando...' : confirmText}
          </Button>
        </div>
      </Card>
    </div>
  );
};
