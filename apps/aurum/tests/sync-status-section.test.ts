/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeGastappDataRoomV2DiagnosticState,
  SyncStatusSection,
  type GastappDataRoomV2DiagnosticViewState,
} from '../src/components/settings/SyncStatusSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const base = (status: GastappDataRoomV2DiagnosticViewState['status']): GastappDataRoomV2DiagnosticViewState => ({
  status,
  sourceStatus: null,
  message: '',
  technicalDetail: null,
  manifest: null,
  summariesSample: [],
  rowsSample: [],
});

describe('SyncStatusSection gastapp v2 diagnostic label', () => {
  it('maps loading to loading', () => {
    expect(describeGastappDataRoomV2DiagnosticState(base('loading'))).toBe('loading');
  });

  it('maps ok to ok', () => {
    expect(describeGastappDataRoomV2DiagnosticState(base('ok'))).toBe('ok');
  });

  it('maps idle and error to error fallback', () => {
    expect(describeGastappDataRoomV2DiagnosticState(base('idle'))).toBe('error');
    expect(describeGastappDataRoomV2DiagnosticState(base('error'))).toBe('error');
  });
});

describe('SyncStatusSection MIDAS publication recovery', () => {
  it('keeps a visible retry action and reports the selected canonical closure', async () => {
    const onRepublishMidas = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(SyncStatusSection, {
        open: true,
        authUid: 'user-1',
        fsStatus: { state: 'ok', message: '', checkedAt: null },
        syncMessage: '',
        fsDebug: '',
        gastappDataRoomV2: base('idle'),
        midasPublication: {
          status: 'idle',
          message: 'Listo para publicar 2026-05. El cierre 2026-06 no tiene FX canónico.',
        },
        onToggle: vi.fn(),
        onSyncNow: vi.fn(),
        onSignOut: vi.fn(),
        onRefreshGastappDataRoomV2: vi.fn(),
        onRepublishMidas,
      }));
    });

    expect(container.textContent).toContain('Publicación Aurum → MIDAS');
    expect(container.textContent).toContain('Listo para publicar 2026-05');
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Regenerar publicación MIDAS'),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      await userEvent.setup().click(button!);
    });
    expect(onRepublishMidas).toHaveBeenCalledTimes(1);
  });
});
