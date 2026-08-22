/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestGastappFullDownload } from '../src/services/gastappFullHandoff';

describe('Aurum Full handoff', () => {
  afterEach(() => vi.restoreAllMocks());

  it('abre el único flujo de GastApp desde el clic y espera su confirmación', async () => {
    const popup = { closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const promise = requestGastappFullDownload();
    const target = String(open.mock.calls[0]?.[0] || '');
    const actionId = new URL(target).searchParams.get('handoffId');
    expect(target).toContain('gastappAction=download_full');
    expect(target).toContain('returnOrigin=http%3A%2F%2Flocalhost');
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://gastapp-chi.vercel.app',
      data: { type: 'gastapp_full_handoff', actionId, status: 'success', update: 'updated', byteLength: 10 },
    }));
    await expect(promise).resolves.toMatchObject({ status: 'success', update: 'updated' });
  });

  it('no duplica publisher en Aurum si el popup está bloqueado', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => requestGastappFullDownload()).toThrow('gastapp_full_handoff_popup_blocked');
  });
});
