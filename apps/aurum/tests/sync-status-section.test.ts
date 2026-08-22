/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeGastappCanonicalV2DiagnosticState,
  GastappCanonicalV2Section,
} from '../src/components/settings/GastappCanonicalV2Section';
import { SyncStatusSection } from '../src/components/settings/SyncStatusSection';
import type { GastappCanonicalV2DiagnosticViewState } from '../src/components/settings/GastappCanonicalV2Section';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const base = (status: GastappCanonicalV2DiagnosticViewState['status']): GastappCanonicalV2DiagnosticViewState => ({
  status,
  message: '',
  technicalDetail: null,
  errorCode: null,
  contracts: null,
  pointer: null,
  downloads: {
    express: { status: 'idle', message: '' },
    full: { status: 'idle', message: '' },
  },
});

describe('Integración con GastApp en Ajustes', () => {
  it('maps loading to loading', () => {
    expect(describeGastappCanonicalV2DiagnosticState(base('loading'))).toBe('loading');
  });

  it('maps ok to ok', () => {
    expect(describeGastappCanonicalV2DiagnosticState(base('ok'))).toBe('ok');
  });

  it('maps idle and error to error fallback', () => {
    expect(describeGastappCanonicalV2DiagnosticState(base('idle'))).toBe('error');
    expect(describeGastappCanonicalV2DiagnosticState(base('error'))).toBe('error');
  });

  it('oculta stale en la vista normal y lo conserva sólo en detalles técnicos', async () => {
    const state = base('ok');
    state.pointer = {
      pointerVersion: 'gastapp-data-room-pointer-v2',
      storageBackend: 'firestore_blob',
      canonicalDataHash: `sha256:${'a'.repeat(64)}`,
      operationalDataHash: `sha256:${'c'.repeat(64)}`,
      operationalRevision: 7,
      fullSnapshotHash: `sha256:${'f'.repeat(64)}`,
      fullSnapshotOperationalDataHash: `sha256:${'d'.repeat(64)}`,
      fullSnapshotGeneratedAt: '2026-08-01T00:00:00.000Z',
      fullSnapshotStale: true,
      express: { document: 'gastapp_data_room_v2_artifacts/express_current', hash: `sha256:${'b'.repeat(64)}`, bytes: 26, mediaType: 'application/zip', generatedAt: null, operationalDataHash: null, operationalRevision: null, staleAgainstOperationalHash: null },
      full: { document: 'gastapp_data_room_v2_artifacts/full_current', hash: `sha256:${'f'.repeat(64)}`, bytes: 23, mediaType: 'application/zip', generatedAt: '2026-08-01T00:00:00.000Z', operationalDataHash: `sha256:${'d'.repeat(64)}`, operationalRevision: 6, staleAgainstOperationalHash: true },
      fullFreshness: {
        generatedAt: '2026-08-01T00:00:00.000Z',
        isStale: true,
        snapshotOperationalDataHash: `sha256:${'d'.repeat(64)}`,
        currentOperationalDataHash: `sha256:${'c'.repeat(64)}`,
        snapshotOperationalRevision: 6,
        currentOperationalRevision: 7,
      },
      raw: {},
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(GastappCanonicalV2Section, {
        state,
        onRefresh: vi.fn(),
        onDownload: vi.fn(),
      }));
    });

    expect(container.textContent).not.toContain('Informe completo: Versión anterior');
    expect(container.textContent).not.toContain('Pendiente de actualizar');
    expect(container.textContent).not.toContain('Versión anterior</span>');
    expect(container.textContent).toContain('Estado informe completo: Versión anterior conservada');
    expect(container.textContent).toContain('Hash operacional del snapshot:');
    expect(container.textContent).toContain('Hash operacional vigente:');
    expect(container.textContent).toContain('No afecta el gasto mensual oficial, los retornos ni el informe resumido.');
    expect(container.textContent).toContain('Integración con GastApp');
    expect(container.textContent).not.toContain('Data Room');
    expect(container.querySelector('details[open]')).toBeNull();
    expect(container.querySelector('a[href="https://gastapp-chi.vercel.app"]')).toBeTruthy();
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
        gastappCanonicalV2: base('idle'),
        midasPublication: {
          status: 'idle',
          message: 'Listo para publicar 2026-05. El cierre 2026-06 no tiene FX canónico.',
        },
        onToggle: vi.fn(),
        onSyncNow: vi.fn(),
        onSignOut: vi.fn(),
        onRefreshGastappCanonicalV2: vi.fn(),
        onDownloadGastappCanonicalV2: vi.fn(),
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
