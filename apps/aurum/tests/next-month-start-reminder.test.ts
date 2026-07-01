/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { NextMonthStartReminder } from '../src/components/patrimonio/NextMonthStartReminder';
import { buildNextMonthStartReminderState } from '../src/pages/Patrimonio';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('next month start reminder', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('shows READY_TO_START only for the live month immediately after the latest close', () => {
    const reminder = buildNextMonthStartReminderState({
      monthKey: '2026-07',
      realCurrentMonthKey: '2026-07',
      latestClosedMonthKey: '2026-06',
      activeClosure: null,
      startEligibility: { canStart: true, reason: 'ready' },
      mortgageStatus: 'pending',
      now: new Date('2026-07-01T10:00:00Z'),
    });

    expect(reminder.status).toBe('POST_CLOSE_NEXT_MONTH_READY_TO_START');
    expect(reminder.primaryActionKind).toBe('start');
    expect(reminder.primaryActionLabel).toContain('Iniciar julio');
    expect(reminder.message).toContain('Junio de 2026 quedó cerrado');
  });

  it('shows review state when the live month requires hipoteca review', () => {
    const reminder = buildNextMonthStartReminderState({
      monthKey: '2026-07',
      realCurrentMonthKey: '2026-07',
      latestClosedMonthKey: '2026-06',
      activeClosure: null,
      startEligibility: { canStart: false, reason: 'mortgage_review' },
      mortgageStatus: 'review',
      now: new Date('2026-07-01T10:00:00Z'),
    });

    expect(reminder.status).toBe('NEXT_MONTH_REQUIRES_REVIEW');
    expect(reminder.primaryActionKind).toBe('review');
    expect(reminder.message).toContain('no cuadra con la amortización esperada');
  });

  it('suppresses the reminder while snoozed and does not show it for historical months', () => {
    const snoozed = buildNextMonthStartReminderState({
      monthKey: '2026-07',
      realCurrentMonthKey: '2026-07',
      latestClosedMonthKey: '2026-06',
      activeClosure: null,
      startEligibility: { canStart: true, reason: 'ready' },
      mortgageStatus: 'pending',
      snoozeUntil: '2026-07-01T22:00:00Z',
      now: new Date('2026-07-01T10:00:00Z'),
    });
    const historical = buildNextMonthStartReminderState({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-07',
      latestClosedMonthKey: '2026-06',
      activeClosure: null,
      startEligibility: { canStart: true, reason: 'ready' },
      mortgageStatus: 'pending',
      now: new Date('2026-07-01T10:00:00Z'),
    });

    expect(snoozed.status).toBe('REMIND_LATER');
    expect(historical.status).toBe('hidden');
  });

  it('marks the reminder as started once the mortgage is already applied', () => {
    const reminder = buildNextMonthStartReminderState({
      monthKey: '2026-07',
      realCurrentMonthKey: '2026-07',
      latestClosedMonthKey: '2026-06',
      activeClosure: null,
      startEligibility: { canStart: false, reason: 'mortgage_applied' },
      mortgageStatus: 'applied',
      now: new Date('2026-07-01T10:00:00Z'),
    });

    expect(reminder.status).toBe('NEXT_MONTH_STARTED');
  });

  it('calls the existing callback for start, snooze, and close actions', async () => {
    const onPrimaryAction = vi.fn();
    const onSnooze = vi.fn();
    const onCloseModal = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(NextMonthStartReminder, {
          reminder: {
            status: 'POST_CLOSE_NEXT_MONTH_READY_TO_START',
            monthKey: '2026-07',
            title: 'Mes cerrado correctamente',
            message: 'Junio de 2026 quedó cerrado. Ahora puedes iniciar julio.',
            primaryActionLabel: 'Iniciar julio de 2026',
            primaryActionKind: 'start',
          },
          modalOpen: true,
          onPrimaryAction,
          onSnooze,
          onCloseModal,
        }),
      );
    });

    const startButtons = Array.from(container.querySelectorAll('button')).filter((node) =>
      node.textContent?.includes('Iniciar julio de 2026'),
    );
    expect(startButtons.length).toBeGreaterThan(0);

    await act(async () => {
      startButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);

    const snoozeButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Recordarme después'),
    );
    expect(snoozeButton).toBeTruthy();

    await act(async () => {
      snoozeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSnooze).toHaveBeenCalledTimes(1);

    const closeButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent === 'Cerrar',
    );
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCloseModal).toHaveBeenCalledTimes(1);
  });
});
