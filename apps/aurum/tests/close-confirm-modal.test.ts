import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import { CloseConfirmModal } from '../src/components/patrimonio/CloseConfirmModal';
import { MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE } from '../src/services/monthlyCloseDebtGuard';

const noop = () => {};

describe('CloseConfirmModal close preview', () => {
  it('renders the actual close preview debt and total amounts', () => {
    const html = renderToStaticMarkup(
      React.createElement(CloseConfirmModal, {
        open: true,
        closeMonthDraft: '2026-05',
        monthKey: '2026-05',
        realCurrentMonthKey: '2026-05',
        selectedClosureMonthKey: null,
        latestClosureSummary: 'Último cierre registrado: abril de 2026.',
        latestClosureTechnicalUpdate: null,
        closeSequenceWarning: '',
        closeBlockingIssues: [],
        closeWarningIssues: [],
        closeInfo: '',
        closeError: '',
        closeFxReady: true,
        closePreview: {
          banks: 21_007_516,
          investments: 1_525_849_377,
          riskClp: 279_822_000,
          hasRisk: true,
          propertyNet: 252_754_619,
          hasProperty: true,
          nonMortgageDebt: 93_200_000,
          usdClp: 893,
          eurClp: 970,
          ufClp: 39_000,
          totalNetClp: 1_706_411_512,
        },
        closeFxDraft: {
          usdClp: '893',
          eurClp: '970',
          ufClp: '39000',
        },
        monthLabel: (monthKey: string) => (monthKey === '2026-05' ? 'Mayo 2026' : monthKey),
        onCloseMonthDraftChange: noop,
        onCloseFxDraftChange: noop,
        onResolveWithPrevious: noop,
        onResolveExclude: noop,
        onReview: noop,
        onCancel: noop,
        onAttemptClose: noop,
      }),
    );

    expect(html).toContain('Preview numérico del cierre');
    expect(html).toContain('Deuda no hipotecaria');
    expect(html).toContain('$93.200.000');
    expect(html).toContain('$1.706.411.512');
    expect(html).not.toContain('-$0');
    expect(html).not.toContain('El preview de cierre no está incorporando la deuda no hipotecaria vigente. Revisa antes de cerrar.');
  });

  it('hides debt-guard error when preview already includes relevant debt', () => {
    const html = renderToStaticMarkup(
      React.createElement(CloseConfirmModal, {
        open: true,
        closeMonthDraft: '2026-05',
        monthKey: '2026-05',
        realCurrentMonthKey: '2026-05',
        selectedClosureMonthKey: null,
        latestClosureSummary: 'Último cierre registrado: abril de 2026.',
        latestClosureTechnicalUpdate: null,
        closeSequenceWarning: '',
        closeBlockingIssues: [],
        closeWarningIssues: [],
        closeInfo: '',
        closeError: MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE,
        closeFxReady: true,
        closePreview: {
          banks: 21_007_516,
          investments: 1_525_849_377,
          riskClp: 279_822_000,
          hasRisk: true,
          propertyNet: 252_754_619,
          hasProperty: true,
          nonMortgageDebt: 93_200_000,
          usdClp: 893,
          eurClp: 970,
          ufClp: 39_000,
          totalNetClp: 1_706_411_514,
        },
        closeFxDraft: {
          usdClp: '893',
          eurClp: '970',
          ufClp: '39000',
        },
        monthLabel: (monthKey: string) => (monthKey === '2026-05' ? 'Mayo 2026' : monthKey),
        onCloseMonthDraftChange: noop,
        onCloseFxDraftChange: noop,
        onResolveWithPrevious: noop,
        onResolveExclude: noop,
        onReview: noop,
        onCancel: noop,
        onAttemptClose: noop,
      }),
    );

    expect(html).not.toContain(MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE);
    expect(html).toContain('Confirmar cierre');
    expect(html).toContain('Bloqueos: 0 · Advertencias: 0');
  });

  it('renders debt-guard message when preview debt is zero (bad case)', () => {
    const html = renderToStaticMarkup(
      React.createElement(CloseConfirmModal, {
        open: true,
        closeMonthDraft: '2026-05',
        monthKey: '2026-05',
        realCurrentMonthKey: '2026-05',
        selectedClosureMonthKey: null,
        latestClosureSummary: 'Último cierre registrado: abril de 2026.',
        latestClosureTechnicalUpdate: null,
        closeSequenceWarning: '',
        closeBlockingIssues: [],
        closeWarningIssues: [],
        closeInfo: '',
        closeError: MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE,
        closeFxReady: true,
        closePreview: {
          banks: 21_007_516,
          investments: 1_525_849_377,
          riskClp: 279_822_000,
          hasRisk: true,
          propertyNet: 252_754_619,
          hasProperty: true,
          nonMortgageDebt: 0,
          usdClp: 893,
          eurClp: 970,
          ufClp: 39_000,
          totalNetClp: 1_799_611_514,
        },
        closeFxDraft: {
          usdClp: '893',
          eurClp: '970',
          ufClp: '39000',
        },
        monthLabel: (monthKey: string) => (monthKey === '2026-05' ? 'Mayo 2026' : monthKey),
        onCloseMonthDraftChange: noop,
        onCloseFxDraftChange: noop,
        onResolveWithPrevious: noop,
        onResolveExclude: noop,
        onReview: noop,
        onCancel: noop,
        onAttemptClose: noop,
      }),
    );

    expect(html).toContain(MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE);
  });

  it('keeps rendering unrelated errors', () => {
    const html = renderToStaticMarkup(
      React.createElement(CloseConfirmModal, {
        open: true,
        closeMonthDraft: '2026-05',
        monthKey: '2026-05',
        realCurrentMonthKey: '2026-05',
        selectedClosureMonthKey: null,
        latestClosureSummary: 'Último cierre registrado: abril de 2026.',
        latestClosureTechnicalUpdate: null,
        closeSequenceWarning: '',
        closeBlockingIssues: [],
        closeWarningIssues: [],
        closeInfo: '',
        closeError: 'Error real distinto',
        closeFxReady: true,
        closePreview: {
          banks: 21_007_516,
          investments: 1_525_849_377,
          riskClp: 279_822_000,
          hasRisk: true,
          propertyNet: 252_754_619,
          hasProperty: true,
          nonMortgageDebt: 93_200_000,
          usdClp: 893,
          eurClp: 970,
          ufClp: 39_000,
          totalNetClp: 1_706_411_514,
        },
        closeFxDraft: {
          usdClp: '893',
          eurClp: '970',
          ufClp: '39000',
        },
        monthLabel: (monthKey: string) => (monthKey === '2026-05' ? 'Mayo 2026' : monthKey),
        onCloseMonthDraftChange: noop,
        onCloseFxDraftChange: noop,
        onResolveWithPrevious: noop,
        onResolveExclude: noop,
        onReview: noop,
        onCancel: noop,
        onAttemptClose: noop,
      }),
    );

    expect(html).toContain('Error real distinto');
  });
});
