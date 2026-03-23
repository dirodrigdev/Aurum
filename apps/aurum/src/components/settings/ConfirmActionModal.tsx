import React from 'react';
import { Button, Card } from '../Components';

interface ConfirmActionModalProps {
  open: boolean;
  busy?: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  auxiliaryText?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
  onAuxiliaryAction?: () => void;
}

export const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
  open,
  busy = false,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  auxiliaryText,
  tone = 'default',
  onConfirm,
  onCancel,
  onAuxiliaryAction,
}) => {
  if (!open) return null;

  const isDanger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/55 px-4">
      <Card
        className={`w-full max-w-md space-y-4 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.35)] ${
          isDanger ? 'border border-red-200 bg-white' : 'border border-slate-200 bg-white'
        }`}
      >
        <div>
          <div className={`text-lg font-semibold ${isDanger ? 'text-red-800' : 'text-slate-900'}`}>{title}</div>
          <div className="mt-2 text-sm text-slate-600">{message}</div>
        </div>
        <div className="flex justify-end gap-2">
          {onAuxiliaryAction && auxiliaryText && (
            <Button variant="ghost" onClick={onAuxiliaryAction} disabled={busy}>
              {auxiliaryText}
            </Button>
          )}
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant={isDanger ? 'danger' : 'secondary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Procesando...' : confirmText}
          </Button>
        </div>
      </Card>
    </div>
  );
};
