export type FirestoreStatusState =
  | 'ok'
  | 'checking'
  | 'quota'
  | 'denied'
  | 'unavailable'
  | 'error';

export type FirestoreStatus = {
  state: FirestoreStatusState;
  code?: string;
  message?: string;
  at: number; // epoch ms
};

const DEFAULT_STATUS: FirestoreStatus = { state: 'checking', at: Date.now() };

let _status: FirestoreStatus = DEFAULT_STATUS;
const listeners = new Set<(s: FirestoreStatus) => void>();

const notify = () => {
  listeners.forEach((fn) => {
    try {
      fn(_status);
    } catch {
      // ignore
    }
  });
};

export function getFirestoreStatus(): FirestoreStatus {
  return _status;
}

export function subscribeFirestoreStatus(fn: (s: FirestoreStatus) => void): () => void {
  listeners.add(fn);
  // entrega estado actual
  try {
    fn(_status);
  } catch {
    // ignore
  }
  return () => listeners.delete(fn);
}

export function setFirestoreOk(): void {
  if (_status.state === 'ok') return;
  _status = { state: 'ok', at: Date.now() };
  notify();
}

export function setFirestoreChecking(): void {
  if (_status.state === 'checking') return;
  _status = { state: 'checking', at: Date.now() };
  notify();
}

export function setFirestoreDenied(): void {
  if (_status.state === 'denied') return;
  _status = { state: 'denied', at: Date.now(), message: 'Dispositivo no autorizado' };
  notify();
}

export function setFirestoreStatusFromError(err: any): void {
  const code: string = err?.code ?? '';
  const message: string = err?.message ?? '';

  // Firestore puede devolver:
  // - permission-denied
  // - resource-exhausted (cuotas)
  // - unavailable (red / backend)
  // - failed-precondition (billing disabled / proyecto en estado raro)
  let state: FirestoreStatusState = 'error';

  if (code === 'permission-denied') state = 'denied';
  else if (code === 'resource-exhausted') state = 'quota';
  else if (code === 'unavailable') state = 'unavailable';
  else if (code === 'failed-precondition') state = 'error';

  // Evitar spam: si ya estamos en el mismo estado+code, no re-notificar
  if (_status.state === state && _status.code === code) return;

  _status = {
    state,
    code: code || undefined,
    message: message || undefined,
    at: Date.now(),
  };
  notify();
}
