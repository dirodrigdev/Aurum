export const GASTAPP_FULL_HANDOFF_ACTION = 'download_full';
export const GASTAPP_FULL_HANDOFF_MESSAGE = 'gastapp_full_handoff';
export const GASTAPP_FULL_HANDOFF_TARGET = 'https://gastapp-chi.vercel.app/';

export type GastappFullHandoffCompletion = {
  status: 'success';
  update: 'skipped_current' | 'updated';
  byteLength?: number;
  sha256?: string;
};

const makeActionId = () => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `aurum-${random}`;
};

/**
 * Opens GastApp directly from the user's click. GastApp remains the only Full
 * publisher; this function only transports the one-shot request and waits for
 * the result via postMessage. There is no polling or persistent listener.
 */
export const requestGastappFullDownload = (): Promise<GastappFullHandoffCompletion> => {
  if (typeof window === 'undefined') throw new Error('gastapp_full_handoff_browser_required');
  const actionId = makeActionId();
  const url = new URL(GASTAPP_FULL_HANDOFF_TARGET);
  url.searchParams.set('gastappAction', GASTAPP_FULL_HANDOFF_ACTION);
  url.searchParams.set('handoffId', actionId);
  url.searchParams.set('returnOrigin', window.location.origin);

  const popup = window.open(url.toString(), '_blank', 'popup,width=980,height=760');
  if (!popup) throw new Error('gastapp_full_handoff_popup_blocked');

  return new Promise<GastappFullHandoffCompletion>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('gastapp_full_handoff_timeout'));
    }, 5 * 60 * 1000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== new URL(GASTAPP_FULL_HANDOFF_TARGET).origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== GASTAPP_FULL_HANDOFF_MESSAGE || data.actionId !== actionId) return;
      cleanup();
      if (data.status !== 'success') {
        reject(new Error('gastapp_full_handoff_failed'));
        return;
      }
      resolve({
        status: 'success',
        update: data.update === 'updated' ? 'updated' : 'skipped_current',
        byteLength: typeof data.byteLength === 'number' ? data.byteLength : undefined,
        sha256: typeof data.sha256 === 'string' ? data.sha256 : undefined,
      });
    };
    window.addEventListener('message', onMessage);
  });
};
