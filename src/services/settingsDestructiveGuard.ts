export type BackupDecisionState = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
};

export const defaultBackupDecisionState: BackupDecisionState = {
  open: false,
  title: '',
  message: '',
  confirmText: 'Continuar',
};

type PendingUnsafeActionRef = {
  current: null | (() => Promise<void> | void);
};

interface RunDestructiveActionWithBackupGuardInput {
  backupReason: string;
  actionLabel: string;
  onProceed: () => Promise<void> | void;
  backupBeforeDestructiveOperation: (reason: string) => Promise<{ ok: boolean }>;
  pendingUnsafeBackupActionRef: PendingUnsafeActionRef;
  setBackupDecisionState: (state: BackupDecisionState) => void;
  setBackupMessage: (message: string) => void;
}

export const createUnsafeBackupDecisionState = (actionLabel: string): BackupDecisionState => ({
  open: true,
  title: 'No pude generar respaldo previo',
  message:
    `Iba a ${actionLabel}, pero el respaldo automático falló. ` +
    'Si continúas ahora, la operación se ejecutará sin respaldo garantizado y podría ser irreversible.',
  confirmText: 'Continuar sin respaldo',
});

export const runDestructiveActionWithBackupGuard = async ({
  backupReason,
  actionLabel,
  onProceed,
  backupBeforeDestructiveOperation,
  pendingUnsafeBackupActionRef,
  setBackupDecisionState,
  setBackupMessage,
}: RunDestructiveActionWithBackupGuardInput) => {
  const backup = await backupBeforeDestructiveOperation(backupReason);
  if (backup.ok) {
    await onProceed();
    return;
  }

  pendingUnsafeBackupActionRef.current = onProceed;
  setBackupDecisionState(createUnsafeBackupDecisionState(actionLabel));
  setBackupMessage(
    'No pude generar backup automático. La operación quedó detenida hasta que confirmes continuar sin respaldo.',
  );
};
