/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
  user: null as { uid: string; email: string | null } | null,
  readAuthenticatedClosureAudit: vi.fn(),
}));

vi.mock('../src/services/firebase', () => ({ auth: {} }));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, callback: (user: typeof mocks.user) => void) => {
    callback(mocks.user);
    return () => undefined;
  }),
}));

vi.mock('../src/services/closureAuditDiagnostic', () => ({
  isClosureAuditAuthorizedUser: (user: { email?: string | null } | null) =>
    String(user?.email || '').trim().toLowerCase() === 'diegorp.1978@gmail.com',
  readAuthenticatedClosureAudit: mocks.readAuthenticatedClosureAudit,
}));

import DevClosureAuditSection from '../src/components/settings/DevClosureAuditSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('temporary closure audit section', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const render = async (user: typeof mocks.user) => {
    mocks.user = user;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(DevClosureAuditSection)));
  };

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    mocks.user = null;
    mocks.readAuthenticatedClosureAudit.mockReset();
  });

  it('renders only for the authorized authenticated account, including normalized email', async () => {
    await render({ uid: 'hidden', email: '  DIEGORP.1978@GMAIL.COM ' });

    expect(container?.textContent).toContain('Diagnóstico temporal de cierres');
    const trigger = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Diagnóstico temporal de cierres'),
    );
    await act(async () => trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container?.textContent).toContain('Exportar auditoría read-only');
  });

  it.each([
    { uid: 'other', email: 'other@example.com' },
    null,
  ])('does not render for a non-authorized or unresolved session', async (user) => {
    await render(user);
    expect(container?.textContent).not.toContain('Diagnóstico temporal de cierres');
  });

  it('shows an authorization error when the read guard rejects a changed session', async () => {
    mocks.readAuthenticatedClosureAudit.mockResolvedValue({ status: 'unauthorized' });
    await render({ uid: 'hidden', email: 'diegorp.1978@gmail.com' });
    const header = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Diagnóstico temporal de cierres'),
    );
    await act(async () => header?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const exportButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
      button.textContent?.includes('Exportar auditoría read-only'),
    );
    await act(async () => exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.readAuthenticatedClosureAudit).toHaveBeenCalledOnce();
    expect(container?.textContent).toContain('No autorizado para ejecutar este diagnóstico.');
  });
});
