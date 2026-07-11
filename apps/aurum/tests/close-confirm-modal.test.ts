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

  it('renders economic rates, origins and independent confirmations', () => {
    const html = renderToStaticMarkup(
      React.createElement(CloseConfirmModal, {
        open: true,
        closeMonthDraft: '2026-06',
        monthKey: '2026-07',
        realCurrentMonthKey: '2026-07',
        selectedClosureMonthKey: null,
        latestClosureSummary: 'Último cierre registrado: mayo de 2026.',
        latestClosureTechnicalUpdate: null,
        closeSequenceWarning: '',
        closeBlockingIssues: [],
        closeWarningIssues: [],
        closeInfo: '',
        closeError: '',
        closeFxReady: true,
        closePreview: {
          banks: 20_000_000,
          investments: 200_000_000,
          riskClp: 0,
          hasRisk: false,
          propertyNet: 100_000_000,
          hasProperty: true,
          nonMortgageDebt: 10_000_000,
          usdClp: 920,
          eurClp: 1050.38,
          ufClp: 40820.31,
          totalNetClp: 310_000_000,
        },
        closeFxDraft: { usdClp: '920', eurClp: '1050.38', ufClp: '40820.31' },
        fxGuidance: {
          loading: false,
          status: 'available',
          economicDate: '2026-06-30',
          suggestedFxRates: { usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 },
          previousClosureFxRates: { usdClp: 892.89, eurClp: 1040.06, ufClp: 40610.69 },
          rateOrigin: { usd: 'manual', eur: 'automatic', uf: 'automatic' },
          warnings: ['Estás utilizando una tasa manual distinta de la referencia sugerida.'],
          manualReason: '',
          confirmations: { economic: false, manual: false, fallback: false },
          requiresManualConfirmation: true,
          requiresFallbackConfirmation: false,
        },
        monthLabel: () => 'Junio 2026',
        onCloseMonthDraftChange: noop,
        onCloseFxDraftChange: noop,
        onManualReasonChange: noop,
        onFxConfirmationChange: noop,
        onResolveWithPrevious: noop,
        onResolveExclude: noop,
        onReview: noop,
        onCancel: noop,
        onAttemptClose: noop,
      }),
    );

    expect(html).toContain('Tasas del cierre');
    expect(html).toContain('2026-06-30');
    expect(html).toContain('Sugerida: 922,34');
    expect(html).toContain('Anterior: 892,89');
    expect(html).toContain('Motivo de tasas manuales');
    expect(html).toContain('Confirmo que las tasas utilizadas corresponden');
    expect(html).toContain('Confirmo que deseo utilizar tasas particulares');
    expect(html).toContain('disabled=""');
  });
});
