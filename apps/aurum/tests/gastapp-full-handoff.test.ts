/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestGastappFullDownload, requestGastappReportDownload } from '../src/services/gastappFullHandoff';

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

  it('transporta los tres formatos al único publisher GastApp', async () => {
    const popup = { closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const promise = requestGastappReportDownload('ai_json');
    const target = String(open.mock.calls[0]?.[0] || '');
    const url = new URL(target);
    const actionId = url.searchParams.get('handoffId');
    expect(url.searchParams.get('gastappAction')).toBe('download_report');
    expect(url.searchParams.get('reportKind')).toBe('ai_json');
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://gastapp-chi.vercel.app',
      data: { type: 'gastapp_report_handoff', actionId, kind: 'ai_json', status: 'success', update: 'not_required', byteLength: 10 },
    }));
    await expect(promise).resolves.toMatchObject({ status: 'success', kind: 'ai_json', update: 'not_required' });
  });
});
